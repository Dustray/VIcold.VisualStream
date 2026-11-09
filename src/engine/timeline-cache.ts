import type { ReplayDataSource, ReplayDensity, ReplayEvent, TimeRange } from '../core/types'

export interface TimelineRequest {
  source: ReplayDataSource
  range: TimeRange
  trackIds: number[]
  density: boolean
  resolution: number
}
interface TimelineData { events: ReplayEvent[]; bins: ReplayDensity[]; dense: boolean }
export interface TimelineSegment { range: TimeRange; data: TimelineData }
export interface TimelineTrackData extends TimelineData { segments?: TimelineSegment[] }
interface TimelineEntry {
  source: ReplayDataSource
  offset: bigint
  range: TimeRange
  resolution: number
  requestedDensity: boolean
  tracks: Map<number, TimelineTrackData>
  weight: number
}

export class TimelineCache {
  private entries: TimelineEntry[] = []
  private generation = 0
  private views = new WeakMap<ReplayDataSource, Map<number, { offset: bigint; fallback?: TimelineTrackData; data: TimelineTrackData }>>()
  private pending: { request: TimelineRequest; offset: bigint; generation: number; promise: Promise<void> }[] = []

  clear(): void { this.generation++; this.entries = []; this.views = new WeakMap() }

  retain(sources: ReplayDataSource[]): void {
    this.generation++
    this.views = new WeakMap()
    this.entries = this.entries.filter(entry => sources.includes(entry.source) && entry.offset === entry.source.offset)
  }

  private coversTrack(request: TimelineRequest, trackId: number): boolean {
    const ranges: TimeRange[] = []
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index]!
      if (entry.source !== request.source || entry.offset !== request.source.offset) continue
      const track = entry.tracks.get(trackId)
      if (!track) continue
      if (track.dense && (entry.requestedDensity !== request.density || entry.resolution > request.resolution * 1.5)) continue
      if (track.dense && !request.density && (request.range.end - request.range.start) * 2n < entry.range.end - entry.range.start) continue
      if (entry.range.start <= request.range.start && entry.range.end >= request.range.end) return true
      if (entry.range.start < request.range.end && entry.range.end > request.range.start) ranges.push(entry.range)
    }
    ranges.sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0)
    let end = request.range.start
    for (const range of ranges) {
      if (range.start > end) return false
      if (range.end > end) end = range.end
      if (end >= request.range.end) return true
    }
    return false
  }

  covers(request: TimelineRequest): boolean { return request.trackIds.every(trackId => this.coversTrack(request, trackId)) }
  read(request: TimelineRequest, trackId: number, fallback?: TimelineTrackData): TimelineTrackData | undefined {
    let views = this.views.get(request.source)
    if (!views) { views = new Map(); this.views.set(request.source, views) }
    let view = views.get(trackId)
    if (!view || view.offset !== request.source.offset || view.fallback !== fallback) {
      const entries = this.entries.filter(entry => entry.source === request.source && entry.offset === request.source.offset && entry.tracks.has(trackId))
        .reverse().sort((left, right) => Number(left.tracks.get(trackId)!.dense) - Number(right.tracks.get(trackId)!.dense) || left.resolution - right.resolution)
      const layers = entries.map(entry => ({ range: entry.range, data: entry.tracks.get(trackId)! }))
      if (fallback) layers.push({ range: request.source.range, data: fallback })
      const boundaries = [...new Set(layers.flatMap(layer => [layer.range.start, layer.range.end]))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      const segments: TimelineSegment[] = []
      for (let index = 1; index < boundaries.length; index++) {
        const start = boundaries[index - 1]!
        const end = boundaries[index]!
        const layer = layers.find(layer => layer.range.start <= start && layer.range.end >= end)
        if (!layer) continue
        const previous = segments.at(-1)
        if (previous?.data === layer.data && previous.range.end === start) previous.range.end = end
        else segments.push({ range: { start, end }, data: layer.data })
      }
      view = { offset: request.source.offset, fallback, data: { events: [], bins: [], dense: segments.some(segment => segment.data.dense), segments } }
      views.set(trackId, view)
    }
    const segments = view.data.segments!
    const covering = segments.find(segment => segment.range.start <= request.range.start && segment.range.end >= request.range.end)
    if (covering) return covering.data
    return segments.some(segment => segment.range.start < request.range.end && segment.range.end > request.range.start) ? view.data : undefined
  }

  async load(request: TimelineRequest): Promise<void> {
    if (!request.trackIds.length || this.covers(request)) return
    const pending = this.pending.find(item => item.generation === this.generation
      && item.request.source === request.source && item.offset === request.source.offset
      && item.request.density === request.density && item.request.resolution <= request.resolution * 1.5
      && item.request.range.start <= request.range.start && item.request.range.end >= request.range.end
      && request.trackIds.every(trackId => item.request.trackIds.includes(trackId)))
    if (pending) {
      await pending.promise
      if (pending.generation === this.generation && pending.offset === request.source.offset && !this.covers(request)) await this.load(request)
      return
    }
    const missing = { ...request, range: { ...request.range }, trackIds: request.trackIds.filter(trackId => !this.coversTrack(request, trackId)) }
    const operation = { request: missing, offset: request.source.offset, generation: this.generation, promise: this.fetch(missing) }
    this.pending.push(operation)
    try { await operation.promise }
    finally { this.pending = this.pending.filter(item => item !== operation) }
  }

  private async fetch(request: TimelineRequest): Promise<void> {
    const generation = this.generation
    const offset = request.source.offset
    const range = { ...request.range }
    const buckets = Math.min(4096, Math.max(100, Math.ceil(Number(range.end - range.start) / Math.max(1, request.resolution) / 3)))
    const query = { ...range, trackIds: request.trackIds }
    let events: ReplayEvent[] = []
    let bins: ReplayDensity[] = []
    let dense = request.density
    if (dense) bins = await request.source.density({ ...query, buckets })
    else {
      const page = await request.source.events({ ...query, limit: 50000 })
      if (page.truncated) { bins = await request.source.density({ ...query, buckets }); dense = true }
      else events = page.events
    }
    if (generation !== this.generation || offset !== request.source.offset) return
    const tracks = new Map(request.trackIds.map(trackId => [trackId, { events: [], bins: [], dense } as TimelineTrackData]))
    events.sort((left, right) => {
      const difference = (right.end - right.start) - (left.end - left.start)
      return difference < 0n ? -1 : difference > 0n ? 1 : 0
    })
    for (const event of events) tracks.get(event.trackId)?.events.push(event)
    for (const bin of bins) tracks.get(bin.trackId)?.bins.push(bin)
    this.entries.push({ source: request.source, offset, range, tracks, requestedDensity: request.density, resolution: request.resolution, weight: events.length + bins.length + tracks.size })
    for (const trackId of tracks.keys()) this.views.get(request.source)?.delete(trackId)
    let weight = this.entries.reduce((total, entry) => total + entry.weight, 0)
    while (this.entries.length > 1 && (this.entries.length > 12 || weight > 150000)) {
      const removed = this.entries.shift()!
      weight -= removed.weight
      for (const trackId of removed.tracks.keys()) this.views.get(removed.source)?.delete(trackId)
    }
  }
}

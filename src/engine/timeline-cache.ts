import type { ReplayDataSource, ReplayDensity, ReplayEvent, TimeRange } from '../core/types'

export interface TimelineRequest {
  source: ReplayDataSource
  range: TimeRange
  trackIds: number[]
  density: boolean
  resolution: number
}
export interface TimelineTrackData { events: ReplayEvent[]; bins: ReplayDensity[]; dense: boolean }
interface TimelineEntry {
  sourceId: string
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

  clear(): void { this.generation++; this.entries = [] }

  private find(request: TimelineRequest, trackId: number, exact: boolean): TimelineTrackData | undefined {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index]!
      if (entry.sourceId !== request.source.source.metadata.id || entry.offset !== request.source.offset) continue
      const track = entry.tracks.get(trackId)
      if (!track) continue
      if (exact) {
        if (entry.range.start > request.range.start || entry.range.end < request.range.end || entry.requestedDensity !== request.density) continue
        if (request.density && track.dense && entry.resolution > request.resolution * 1.5) continue
      } else if (entry.range.start > request.range.start || entry.range.end < request.range.end) continue
      return track
    }
    return undefined
  }

  covers(request: TimelineRequest): boolean { return request.trackIds.every(trackId => this.find(request, trackId, true) !== undefined) }
  read(request: TimelineRequest, trackId: number): TimelineTrackData | undefined { return this.find(request, trackId, true) ?? this.find(request, trackId, false) }

  async load(request: TimelineRequest): Promise<void> {
    if (!request.trackIds.length || this.covers(request)) return
    const generation = this.generation
    const offset = request.source.offset
    const sourceId = request.source.source.metadata.id
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
    this.entries.push({ sourceId, offset, range, tracks, requestedDensity: request.density, resolution: dense ? Number(range.end - range.start) / buckets / 3 : request.resolution, weight: events.length + bins.length + tracks.size })
    let weight = this.entries.reduce((total, entry) => total + entry.weight, 0)
    while (this.entries.length > 1 && (this.entries.length > 12 || weight > 150000)) weight -= this.entries.shift()!.weight
  }
}

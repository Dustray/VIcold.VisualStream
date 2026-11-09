import type { ReplayDensity, ReplayEvent, TimeRange } from '../core/types'
import type { TimelineTrackData } from './timeline-cache'

const projectionLimit = 1n << 52n

export interface TimelineSpan<Item extends TimeRange> {
  item: Item
  start: number
  end: number
  paint: string
  label: string
}

export interface TimelineGeometry {
  origin: bigint
  events: TimelineSpan<ReplayEvent>[]
  bins: TimelineSpan<ReplayDensity>[]
}

export class TimelineGeometryCache {
  private readonly rows = new Map<string, { tracks: TimelineTrackData[]; eventDepth?: number; geometry: TimelineGeometry }>()

  constructor(private readonly paint: (name: string) => string, private readonly label: (name: string) => string = name => name.replace('TASK_', '')) {}

  read(id: string, tracks: TimelineTrackData[], origin: bigint, eventDepth?: number): TimelineGeometry {
    const cached = this.rows.get(id)
    const distance = cached ? origin - cached.geometry.origin : 0n
    if (cached && cached.eventDepth === eventDepth && distance > -projectionLimit && distance < projectionLimit && cached.tracks.length === tracks.length && tracks.every((track, index) => track === cached.tracks[index])) return cached.geometry
    const project = <Item extends ReplayEvent | ReplayDensity>(item: Item, range?: TimeRange): TimelineSpan<Item> => ({
      item,
      start: Number((range && range.start > item.start ? range.start : item.start) - origin),
      end: Number((range && range.end < item.end ? range.end : item.end) - origin),
      paint: this.paint(item.name ?? ''),
      label: this.label(item.name ?? ''),
    })
    const events: TimelineSpan<ReplayEvent>[] = []
    const bins: TimelineSpan<ReplayDensity>[] = []
    for (const track of tracks) {
      const segments = track.segments ?? [{ data: track, range: undefined }]
      const fragments = track.segments ? new Map<number, TimelineSpan<ReplayEvent>>() : null
      for (const { data, range } of segments) {
        for (const event of data.events) {
          if ((eventDepth !== undefined && event.depth !== eventDepth) || (range && (event.start >= range.end || event.end <= range.start))) continue
          const span = project(event, range)
          const previous = fragments?.get(event.id)
          if (previous && previous.end >= span.start) previous.end = Math.max(previous.end, span.end)
          else { events.push(span); fragments?.set(event.id, span) }
        }
        for (const bin of data.bins) {
          if ((eventDepth === undefined || (bin.depth ?? 0) === eventDepth) && (!range || bin.start < range.end && bin.end > range.start)) bins.push(project(bin, range))
        }
      }
    }
    events.sort((left, right) => {
      const difference = (right.item.end - right.item.start) - (left.item.end - left.item.start)
      return difference < 0n ? -1 : difference > 0n ? 1 : 0
    })
    const geometry = { origin, events, bins }
    this.rows.set(id, { tracks: [...tracks], eventDepth, geometry })
    return geometry
  }

  retain(ids: Iterable<string>): void {
    const visible = new Set(ids)
    for (const id of this.rows.keys()) if (!visible.has(id)) this.rows.delete(id)
  }

  clear(): void { this.rows.clear() }
}

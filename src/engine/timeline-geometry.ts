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
  private readonly rows = new Map<string, { tracks: TimelineTrackData[]; geometry: TimelineGeometry }>()

  constructor(private readonly paint: (name: string) => string) {}

  read(id: string, tracks: TimelineTrackData[], origin: bigint): TimelineGeometry {
    const cached = this.rows.get(id)
    const distance = cached ? origin - cached.geometry.origin : 0n
    if (cached && distance > -projectionLimit && distance < projectionLimit && cached.tracks.length === tracks.length && tracks.every((track, index) => track === cached.tracks[index])) return cached.geometry
    const events = tracks.flatMap(track => track.events).sort((left, right) => {
      const difference = (right.end - right.start) - (left.end - left.start)
      return difference < 0n ? -1 : difference > 0n ? 1 : 0
    })
    const bins = tracks.flatMap(track => track.bins)
    const project = <Item extends ReplayEvent | ReplayDensity>(item: Item): TimelineSpan<Item> => ({
      item,
      start: Number(item.start - origin),
      end: Number(item.end - origin),
      paint: this.paint(item.name ?? ''),
      label: item.name?.replace('TASK_', '') ?? '',
    })
    const geometry = { origin, events: events.map(project), bins: bins.map(project) }
    this.rows.set(id, { tracks: [...tracks], geometry })
    return geometry
  }

  retain(ids: Iterable<string>): void {
    const visible = new Set(ids)
    for (const id of this.rows.keys()) if (!visible.has(id)) this.rows.delete(id)
  }

  clear(): void { this.rows.clear() }
}

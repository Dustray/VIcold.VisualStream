import type { ReplayDensity } from '../core/types'
import type { TimelineGeometry, TimelineSpan } from './timeline-geometry'

type DensitySpan = TimelineSpan<ReplayDensity>
interface DensityRange { start: number; end: number }

function compare(left: DensitySpan, right: DensitySpan): number {
  const duration = (right.end - right.start) - (left.end - left.start)
  if (duration) return duration
  if (left.item.sourceId !== right.item.sourceId) return left.item.sourceId < right.item.sourceId ? -1 : 1
  return left.item.trackId - right.item.trackId || (left.item.depth ?? 0) - (right.item.depth ?? 0) || left.start - right.start || left.end - right.end || (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
}

export class TimelineDensityCache {
  private readonly levels = new WeakMap<TimelineGeometry, { width: bigint; bins: DensitySpan[]; range?: DensityRange }>()

  read(geometry: TimelineGeometry, resolution: number, viewport?: DensityRange): DensitySpan[] {
    const width = BigInt(Math.max(1, Math.round(resolution * 3)))
    const cached = this.levels.get(geometry)
    if (cached?.width === width && (!cached.range || viewport && cached.range.start <= viewport.start && cached.range.end >= viewport.end)) return cached.bins
    const bucketWidth = Number(width)
    const padding = viewport ? Math.max(bucketWidth, (viewport.end - viewport.start) / 2) : 0
    const range = viewport && { start: viewport.start - padding, end: viewport.end + padding }
    const phase = Number((geometry.origin % width + width) % width)
    const merged = new Map<number, { span: DensitySpan; representative: DensitySpan }>()
    const bins: DensitySpan[] = []
    for (const span of geometry.bins) {
      if (range && (span.start >= range.end + bucketWidth || span.end <= range.start - bucketWidth)) continue
      if (span.end - span.start >= bucketWidth || span.start !== Number(span.item.start - geometry.origin) || span.end !== Number(span.item.end - geometry.origin)) {
        bins.push(span)
        continue
      }
      const bucket = Math.floor((span.start + phase) / bucketWidth)
      const entry = merged.get(bucket)
      if (!entry) { merged.set(bucket, { span: { ...span, item: { ...span.item } }, representative: span }); continue }
      const existing = entry.span
      const count = existing.item.count + span.item.count
      const start = existing.item.start < span.item.start ? existing.item.start : span.item.start
      const end = existing.item.end > span.item.end ? existing.item.end : span.item.end
      const duration = span.item.representativeDuration ?? span.item.end - span.item.start
      const previousDuration = entry.representative.item.representativeDuration ?? entry.representative.item.end - entry.representative.item.start
      if (duration > previousDuration || duration === previousDuration && compare(span, entry.representative) < 0) {
        existing.item = { ...span.item }
        existing.paint = span.paint
        existing.label = span.label
        entry.representative = span
      }
      existing.item.count = count
      existing.item.start = start
      existing.item.end = end
      existing.start = Math.min(existing.start, span.start)
      existing.end = Math.max(existing.end, span.end)
    }
    for (const entry of merged.values()) bins.push(entry.span)
    bins.sort(compare)
    this.levels.set(geometry, { width, bins, range })
    return bins
  }
}

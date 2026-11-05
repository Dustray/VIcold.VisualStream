import type { TimeRange } from './types'

export const NS_PER_MS = 1_000_000n
export const NS_PER_SECOND = 1_000_000_000n
export function timeBuckets(range: TimeRange, buckets: number): TimeRange[] {
  const span = range.end - range.start
  if (span <= 0n || !Number.isFinite(buckets) || buckets < 1) return []
  const count = Math.min(2048, Math.trunc(buckets))
  const length = span < BigInt(count) ? Number(span) : count
  return Array.from({ length }, (_, index) => ({ start: range.start + span * BigInt(index) / BigInt(length), end: range.start + span * BigInt(index + 1) / BigInt(length) }))
}
export const clampTime = (value: bigint, range: TimeRange): bigint => value < range.start ? range.start : value > range.end ? range.end : value
export const duration = (range: TimeRange): bigint => range.end - range.start

export function formatTime(value: bigint, precision = 3): string {
  const absolute = value < 0n ? -value : value
  const sign = value < 0n ? '−' : ''
  if (absolute >= NS_PER_SECOND) return `${sign}${(Number(absolute) / 1e9).toFixed(precision)} s`
  if (absolute >= NS_PER_MS) return `${sign}${(Number(absolute) / 1e6).toFixed(precision)} ms`
  if (absolute >= 1000n) return `${sign}${(Number(absolute) / 1e3).toFixed(precision > 1 ? 2 : precision)} μs`
  return `${sign}${absolute} ns`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

export function parseMilliseconds(value: string): bigint | null {
  value = value.trim()
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value)) return null
  const negative = value.startsWith('-')
  const [whole, fractional = ''] = value.replace('-', '').split('.')
  const result = BigInt(whole!) * NS_PER_MS + BigInt(fractional.padEnd(6, '0'))
  return negative ? -result : result
}

export function fitRange(requested: TimeRange, bounds: TimeRange, minimum = 100n): TimeRange {
  const full = duration(bounds)
  const span = duration(requested) < minimum ? minimum : duration(requested)
  if (span >= full) return { ...bounds }
  const start = requested.start < bounds.start ? bounds.start : requested.start + span > bounds.end ? bounds.end - span : requested.start
  return { start, end: start + span }
}

export const palette = ['#8cafff', '#64d4be', '#b6a0f7', '#e6b774', '#e48fb2', '#77c4e8', '#c9d486', '#b3bdf2']
export function eventColor(name: string): string {
  const key = name.replace(/( )?\d+/g, '')
  let hash = 2166136261
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
  return palette[(hash >>> 0) % palette.length]!
}

export function unionDuration(ranges: TimeRange[]): bigint {
  const sorted = ranges.filter(range => range.end > range.start).sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0)
  if (!sorted.length) return 0n
  let total = 0n
  let start = sorted[0]!.start
  let end = sorted[0]!.end
  for (const range of sorted.slice(1)) {
    if (range.start > end) { total += end - start; start = range.start; end = range.end }
    else if (range.end > end) end = range.end
  }
  return total + end - start
}

import { describe, expect, it } from 'vitest'
import type { ReplayDensity } from '../../src/core/types'
import { TimelineDensityCache } from '../../src/engine/timeline-density'
import { TimelineGeometryCache, type TimelineGeometry } from '../../src/engine/timeline-geometry'

function bin(name: string, start: bigint, end: bigint, extra: Partial<ReplayDensity> = {}): ReplayDensity {
  return { sourceId: 'source', trackId: 1, name, start, end, count: 1, ...extra }
}

function geometry(bins: ReplayDensity[], origin = 0n): TimelineGeometry {
  return new TimelineGeometryCache(name => name, name => name).read('row', [{ events: [], bins, dense: true }], origin)
}

describe('stable timeline density painting', () => {
  it('keeps nearby long operators separate and draws shorter overlapping operators last', () => {
    const cache = new TimelineDensityCache()
    const parent = bin('parent', 100n, 400n)
    const child = bin('child', 101n, 200n)
    const prepared = geometry([child, parent])
    const spans = cache.read(prepared, 10)
    expect(spans.map(span => span.label)).toEqual(['parent', 'child'])
    expect(spans.map(span => [span.start, span.end])).toEqual([[100, 400], [101, 200]])
    expect(spans[0]!.item).toBe(parent)
    expect(spans[1]!.item).toBe(child)
    expect(cache.read(prepared, 10)).toBe(spans)
  })

  it.each([0n, 10n ** 19n, -(10n ** 19n)])('anchors tiny operator groups to time across geometry rebasing near %s', origin => {
    const cache = new TimelineDensityCache()
    const bins = Array.from({ length: 40 }, (_, index) => bin(`op_${index}`, origin + BigInt(index * 3), origin + BigInt(index * 3 + 2)))
    const paint = (anchor: bigint) => cache.read(geometry(bins, anchor), 10).map(span => ({ name: span.label, start: anchor + BigInt(span.start), end: anchor + BigInt(span.end), count: span.item.count }))
    const expected = paint(origin)
    expect(expected.length).toBeGreaterThan(1)
    expect(expected.length).toBeLessThan(bins.length)
    for (let step = -20; step < 20; step++) expect(paint(origin + BigInt(step))).toEqual(expected)
  })

  it('chooses representative colors and labels deterministically without mutating source bins', () => {
    const cache = new TimelineDensityCache()
    const inputs = [bin('later', 7n, 12n), bin('earlier', 1n, 6n), bin('short', 9n, 11n)]
    const original = structuredClone(inputs)
    const first = cache.read(geometry(inputs), 10)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ label: 'earlier', paint: 'earlier', start: 1, end: 12, item: { name: 'earlier', count: 3, start: 1n, end: 12n } })
    expect(cache.read(geometry([...inputs].reverse()), 10)).toEqual(first)
    expect(inputs).toEqual(original)
  })

  it('uses representative task duration for merged colors instead of the growing aggregate extent', () => {
    const cache = new TimelineDensityCache()
    const spans = cache.read(geometry([
      bin('first', 1n, 3n, { representativeDuration: 10n }),
      bin('second', 10n, 12n, { representativeDuration: 11n }),
      bin('longest', 20n, 22n, { representativeDuration: 12n }),
    ]), 10)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ label: 'longest', paint: 'longest', item: { count: 3, name: 'longest' } })
  })

  it('keeps clipped cache fragments separate so aggregation cannot cover a loaded fine gap', () => {
    const cache = new TimelineDensityCache()
    const source = bin('coarse', 0n, 30n)
    const prepared = new TimelineGeometryCache(name => name).read('row', [{ events: [], bins: [], dense: true, segments: [
      { range: { start: 0n, end: 1n }, data: { events: [], bins: [source], dense: true } },
      { range: { start: 2n, end: 3n }, data: { events: [], bins: [source], dense: true } },
    ] }], 0n)
    const spans = cache.read(prepared, 10)
    expect(spans.map(span => [span.start, span.end])).toEqual([[0, 1], [2, 3]])
  })

  it('updates prepared density after zoom or replacement data while panning reuses it', () => {
    const cache = new TimelineDensityCache()
    const input = geometry([bin('first', 0n, 2n), bin('second', 6n, 8n)])
    const wide = cache.read(input, 10)
    expect(wide).toHaveLength(1)
    for (let frame = 0; frame < 60; frame++) expect(cache.read(input, 10)).toBe(wide)
    const close = cache.read(input, 1)
    expect(close).not.toBe(wide)
    expect(close).toHaveLength(2)
    expect(cache.read(geometry([bin('replacement', 0n, 2n)]), 1)[0]!.label).toBe('replacement')
    expect(cache.read(geometry([]), 1)).toEqual([])
  })

  it('prepares only a buffered visible range and reuses it until panning needs more data', () => {
    const cache = new TimelineDensityCache()
    const prepared = geometry(Array.from({ length: 10000 }, (_, index) => bin(`op_${index}`, BigInt(index * 10), BigInt(index * 10 + 5))))
    const visible = cache.read(prepared, 1, { start: 1000, end: 1100 })
    expect(visible.length).toBeLessThan(25)
    expect(visible.length).toBeGreaterThan(15)
    expect(cache.read(prepared, 1, { start: 1030, end: 1130 })).toBe(visible)
    const moved = cache.read(prepared, 1, { start: 1200, end: 1300 })
    expect(moved).not.toBe(visible)
    expect(moved.some(span => span.label === 'op_125')).toBe(true)
    expect(cache.read(prepared, 1)).toHaveLength(10000)
  })

  it('keeps long operators crossing the buffered range and includes complete tiny buckets at its edges', () => {
    const cache = new TimelineDensityCache()
    const prepared = geometry([
      bin('long', 0n, 1000n), bin('tiny_first', 107n, 109n), bin('tiny_second', 116n, 118n),
    ])
    const full = cache.read(prepared, 10)
    const partial = new TimelineDensityCache().read(prepared, 10, { start: 100, end: 110 })
    expect(partial.find(span => span.label === 'long')).toBe(full.find(span => span.label === 'long'))
    const visible = (spans: typeof full) => spans.filter(span => span.start < 110 && span.end > 100)
    expect(visible(partial)).toEqual(visible(full))
  })
})

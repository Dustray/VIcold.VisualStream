import { describe, expect, it, vi } from 'vitest'
import type { ReplayDensity, ReplayEvent } from '../../src/core/types'
import type { TimelineTrackData } from '../../src/engine/timeline-cache'
import { TimelineGeometryCache } from '../../src/engine/timeline-geometry'

function event(id: number, start: bigint, end: bigint): ReplayEvent {
  return { id, start, end, name: `TASK_GEMM_${id}`, trackId: 1, depth: 0, argSetId: 0, incomplete: false, sourceId: 'source', deviceId: 'device', cuId: 'cu', groupId: 'group' }
}

function track(events: ReplayEvent[], bins: ReplayDensity[] = []): TimelineTrackData {
  return { events, bins, dense: bins.length > 0 }
}

describe('prepared timeline geometry', () => {
  it('draws a known event once across adjoining and separated cache regions using its original bounds', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    const original = event(1, 10n, 290n)
    const input: TimelineTrackData = { events: [], bins: [], dense: false, segments: [
      { range: { start: 0n, end: 150n }, data: track([original]) },
      { range: { start: 150n, end: 200n }, data: track([{ ...original }]) },
      { range: { start: 250n, end: 300n }, data: track([{ ...original }]) },
    ] }
    const geometry = cache.read('row', [input], 0n)
    expect(geometry.events.map(span => [span.start, span.end])).toEqual([[10, 290]])
    expect(geometry.events[0]!.item).toBe(original)
    expect(original).toMatchObject({ start: 10n, end: 290n })
  })
  it('clips coarse fallback to missing regions while preserving original event times and fine gaps', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    const fine = event(1, 40n, 90n)
    const bin: ReplayDensity = { sourceId: 'source', trackId: 1, start: 0n, end: 300n, count: 100 }
    const input: TimelineTrackData = { events: [], bins: [], dense: true, segments: [
      { range: { start: 0n, end: 50n }, data: track([], [bin]) },
      { range: { start: 50n, end: 200n }, data: track([fine]) },
      { range: { start: 200n, end: 300n }, data: track([], [bin]) },
    ] }
    const geometry = cache.read('row', [input], 0n)
    expect(geometry.events).toHaveLength(1)
    expect(geometry.events[0]).toMatchObject({ start: 40, end: 90 })
    expect(geometry.events[0]!.item).toBe(fine)
    expect(fine.start).toBe(40n)
    expect(geometry.bins.map(span => [span.start, span.end])).toEqual([[0, 50], [200, 300]])
    expect(cache.read('row', [input], 20n)).toBe(geometry)
  })
  it('deduplicates exact density events across zoom levels without joining distinct same-name events', () => {
    const cache = new TimelineGeometryCache(name => name)
    const bin: ReplayDensity = { sourceId: 'source', trackId: 1, start: 0n, end: 100n, count: 1, name: 'PyTorch Profiler (0)', event: { id: 0, start: 0n, end: 300n } }
    const next: ReplayDensity = { ...bin, start: 310n, end: 400n, event: { id: 1, start: 310n, end: 400n } }
    const input: TimelineTrackData = { events: [], bins: [], dense: true, segments: [
      { range: { start: 0n, end: 100n }, data: track([], [bin]) },
      { range: { start: 100n, end: 200n }, data: track([], [{ ...bin, start: 100n, end: 200n }]) },
      { range: { start: 200n, end: 400n }, data: track([], [{ ...bin, start: 200n, end: 300n }, next]) },
    ] }
    expect(cache.read('row', [input], 0n).bins.map(span => [span.start, span.end])).toEqual([[0, 300], [310, 400]])
    expect(bin).toMatchObject({ start: 0n, end: 100n })
  })
  it('replaces density fragments of a known raw event with its one complete interval', () => {
    const cache = new TimelineGeometryCache(name => name)
    const original = event(1, 0n, 300n)
    const bin: ReplayDensity = { sourceId: 'source', trackId: 1, start: 0n, end: 300n, count: 1, name: original.name, event: { id: 1, start: 0n, end: 300n } }
    const input: TimelineTrackData = { events: [], bins: [], dense: true, segments: [
      { range: { start: 0n, end: 100n }, data: track([], [bin]) },
      { range: { start: 100n, end: 200n }, data: track([original]) },
      { range: { start: 200n, end: 300n }, data: track([], [bin]) },
    ] }
    const geometry = cache.read('row', [input], 0n)
    expect(geometry.events).toMatchObject([{ start: 0, end: 300, item: original }])
    expect(geometry.bins).toEqual([])
  })
  it('paints shorter overlapping events last across tracks without modifying query results', () => {
    const paint = vi.fn(() => '#123456ff')
    const cache = new TimelineGeometryCache(paint)
    const short = event(1, 15n, 25n)
    const long = event(2, 10n, 90n)
    const middle = event(3, 20n, 50n)
    const first = track([short, long])
    const second = track([middle])
    const geometry = cache.read('row', [first, second], 10n)
    expect(geometry.events.map(span => span.item)).toEqual([long, middle, short])
    expect(geometry.events[2]).toMatchObject({ start: 5, end: 15, paint: '#123456ff', label: 'GEMM_1' })
    expect(geometry.events[2]!.item).toBe(short)
    expect(first.events).toEqual([short, long])
    expect(cache.read('row', [first, second], 20n)).toBe(geometry)
    expect(paint).toHaveBeenCalledTimes(3)
  })

  it('preserves nanosecond differences at large absolute timestamps and rebases after distant jumps', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    const origin = 10n ** 19n
    const distant = origin + (1n << 54n)
    const input = track([event(1, origin + 1n, origin + 2n), event(2, distant + 1n, distant + 2n)])
    const first = cache.read('row', [input], origin)
    expect(first.events[0]).toMatchObject({ start: 1, end: 2 })
    const moved = cache.read('row', [input], distant)
    expect(moved).not.toBe(first)
    expect(moved.events[1]).toMatchObject({ start: 1, end: 2 })
    expect(moved.events[1]!.item.start).toBe(distant + 1n)
  })

  it('refreshes replaced track data and keeps density records independent of paint geometry', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    const bin: ReplayDensity = { start: 100n, end: 200n, count: 4, name: 'TASK_COPY_1', trackId: 1, sourceId: 'source', cuId: 'cu', groupId: 'group' }
    const input = track([], [bin])
    const first = cache.read('row', [input], 90n)
    expect(first.bins[0]).toMatchObject({ start: 10, end: 110, label: 'COPY_1' })
    expect(first.bins[0]!.item).toBe(bin)
    const shifted = track([], [{ ...bin, start: 110n, end: 210n }])
    const next = cache.read('row', [shifted], 90n)
    expect(next).not.toBe(first)
    expect(next.bins[0]).toMatchObject({ start: 20, end: 120 })
    expect(bin).toMatchObject({ start: 100n, end: 200n, count: 4 })
    expect(cache.read('row', [shifted, input], 90n).bins).toHaveLength(2)
  })

  it('releases rows that leave the viewport and invalidates cached paint on a theme change', () => {
    let color = '#123456ff'
    const cache = new TimelineGeometryCache(() => color)
    const input = track([event(1, 0n, 10n)])
    const first = cache.read('first', [input], 0n)
    const second = cache.read('second', [input], 0n)
    cache.retain(['second'])
    expect(cache.read('second', [input], 0n)).toBe(second)
    expect(cache.read('first', [input], 0n)).not.toBe(first)
    color = '#abcdefff'
    cache.clear()
    const updated = cache.read('second', [input], 0n)
    expect(updated).not.toBe(second)
    expect(updated.events[0]!.paint).toBe(color)
  })

  it('projects only the requested nesting depth and includes all depths in a folded summary', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    const input = track([event(1, 0n, 100n), { ...event(2, 10n, 20n), depth: 1 }], [
      { trackId: 1, sourceId: 'source', start: 0n, end: 100n, count: 1, depth: 0 },
      { trackId: 1, sourceId: 'source', start: 10n, end: 20n, count: 1, depth: 1 },
    ])
    const parent = cache.read('row', [input], 0n, 0)
    expect(parent.events.map(span => span.item.id)).toEqual([1])
    expect(parent.bins.map(span => span.item.depth)).toEqual([0])
    const child = cache.read('row', [input], 0n, 1)
    expect(child).not.toBe(parent)
    expect(child.events.map(span => span.item.id)).toEqual([2])
    expect(child.bins.map(span => span.item.depth)).toEqual([1])
    const summary = cache.read('row', [input], 0n)
    expect(summary.events).toHaveLength(2)
    expect(summary.bins).toHaveLength(2)
  })

  it('accepts rows whose tracks have no loaded events yet', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    expect(cache.read('empty', [], 100n)).toEqual({ origin: 100n, events: [], bins: [] })
    expect(cache.read('empty', [track([event(1, 101n, 102n)])], 100n).events).toHaveLength(1)
  })
})

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

  it('accepts rows whose tracks have no loaded events yet', () => {
    const cache = new TimelineGeometryCache(() => '#123456ff')
    expect(cache.read('empty', [], 100n)).toEqual({ origin: 100n, events: [], bins: [] })
    expect(cache.read('empty', [track([event(1, 101n, 102n)])], 100n).events).toHaveLength(1)
  })
})

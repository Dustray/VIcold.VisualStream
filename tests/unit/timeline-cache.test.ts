import { describe, expect, it, vi } from 'vitest'
import type { ReplayDataSource, ReplayEvent } from '../../src/core/types'
import { TimelineCache, type TimelineRequest } from '../../src/engine/timeline-cache'

function request(density = true): TimelineRequest {
  const source = {
    source: { metadata: { id: 'source' } }, offset: 0n,
    density: vi.fn(async () => [{ sourceId: 'source', trackId: 1, cuId: 'cu1', groupId: 'group1', start: 0n, end: 300n, count: 5 }]),
    events: vi.fn(async () => ({ events: [{ id: 1, trackId: 1, sourceId: 'source', start: 50n, end: 100n }] as ReplayEvent[], truncated: false })),
  } as unknown as ReplayDataSource
  return { source, density, range: { start: 0n, end: 300n }, trackIds: [1, 2, 3], resolution: 1 }
}

describe('timeline prefetch cache', () => {
  it('reuses buffered time ranges and adjacent tracks without repeating source queries', async () => {
    const cache = new TimelineCache()
    const full = request()
    await cache.load(full)
    const moved = { ...full, range: { start: 100n, end: 200n }, trackIds: [1, 2] }
    expect(cache.covers(moved)).toBe(true)
    await cache.load(moved)
    expect(full.source.density).toHaveBeenCalledTimes(1)
    expect(cache.read(moved, 1)?.bins[0]?.count).toBe(5)
    expect(cache.read(moved, 2)).toEqual({ events: [], bins: [], dense: true })
    expect(cache.covers({ ...moved, trackIds: [4] })).toBe(false)
    expect(cache.covers({ ...moved, range: { start: 250n, end: 350n } })).toBe(false)
    expect(cache.read({ ...moved, range: { start: 250n, end: 350n } }, 1)?.segments).toHaveLength(1)
    expect(cache.covers({ ...moved, resolution: 0.1 })).toBe(false)
    expect(cache.covers({ ...moved, density: false })).toBe(false)
  })

  it('retains exact events across zoom levels and invalidates shifted source data', async () => {
    const cache = new TimelineCache()
    const full = request(false)
    await cache.load(full)
    const zoomed = { ...full, range: { start: 50n, end: 100n }, trackIds: [1], resolution: 0.001 }
    expect(cache.covers(zoomed)).toBe(true)
    expect(cache.read(zoomed, 1)?.events[0]?.id).toBe(1)
    full.source.offset = 1n
    expect(cache.covers(zoomed)).toBe(false)
    expect(cache.read(zoomed, 1)).toBeUndefined()
  })

  it('reuses truncated pages at the same scale but refines them after zooming', async () => {
    const cache = new TimelineCache()
    const full = request(false)
    vi.mocked(full.source.events).mockResolvedValueOnce({ events: [], truncated: true })
    await cache.load(full)
    await cache.load(full)
    expect(full.source.events).toHaveBeenCalledTimes(1)
    const moved = { ...full, range: { start: 50n, end: 200n }, trackIds: [1], resolution: 0.001 }
    expect(cache.covers(moved)).toBe(false)
    expect(cache.read(moved, 1)?.dense).toBe(true)
    await cache.load(moved)
    expect(cache.covers(moved)).toBe(true)
    expect(cache.read(moved, 1)?.dense).toBe(false)
    expect(full.source.events).toHaveBeenCalledTimes(2)
    expect(full.source.density).toHaveBeenCalledTimes(1)
  })

  it('shares in-flight loads when the same session is remounted', async () => {
    const cache = new TimelineCache()
    const full = request()
    let finish!: (value: Awaited<ReturnType<ReplayDataSource['density']>>) => void
    vi.mocked(full.source.density).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const initial = cache.load(full)
    const remounted = cache.load({ ...full, trackIds: [1] })
    expect(full.source.density).toHaveBeenCalledTimes(1)
    finish([])
    await Promise.all([initial, remounted])
    expect(cache.covers(full)).toBe(true)
    expect(full.source.density).toHaveBeenCalledTimes(1)
  })

  it('keeps exact visible events when a larger prefetch falls back to density', async () => {
    const cache = new TimelineCache()
    const visible = request(false)
    await cache.load(visible)
    vi.mocked(visible.source.events).mockResolvedValueOnce({ events: [], truncated: true })
    await cache.load({ ...visible, range: { start: 0n, end: 600n } })
    expect(cache.read(visible, 1)?.dense).toBe(false)
    expect(cache.read(visible, 1)?.events[0]?.id).toBe(1)
  })

  it('fills only uncovered regions with coarse data and retains fine details when a viewport crosses a cached edge', async () => {
    const cache = new TimelineCache()
    const fine = request(false)
    fine.source = { ...fine.source, range: { start: 0n, end: 1000n } }
    await cache.load(fine)
    const fallback = { events: [], bins: [{ sourceId: 'source', trackId: 1, start: 0n, end: 1000n, count: 100 }], dense: true }
    const moved = { ...fine, range: { start: 200n, end: 500n } }
    const view = cache.read(moved, 1, fallback)!
    expect(cache.covers(moved)).toBe(false)
    expect(view.segments?.map(segment => ({ range: segment.range, dense: segment.data.dense }))).toEqual([
      { range: { start: 0n, end: 300n }, dense: false },
      { range: { start: 300n, end: 1000n }, dense: true },
    ])
    expect(cache.read({ ...moved, range: { start: 250n, end: 550n } }, 1, fallback)).toBe(view)
    expect(cache.read({ ...fine, density: true, range: { start: 0n, end: 200n } }, 1, fallback)?.dense).toBe(false)
    expect(cache.covers({ ...fine, density: true })).toBe(true)
    expect(cache.read({ ...moved, range: { start: 1001n, end: 1100n } }, 1, fallback)).toBeUndefined()
    fine.source.offset = 10n
    expect(cache.read(moved, 1)).toBeUndefined()
  })

  it('chooses the finest density in overlapping regions and does not rebuild unaffected tracks', async () => {
    const cache = new TimelineCache()
    const broad = request()
    await cache.load(broad)
    const otherTrack = cache.read(broad, 2)
    await cache.load({ ...broad, range: { start: 100n, end: 200n }, resolution: 0.1, trackIds: [1] })
    const composed = cache.read(broad, 1)!
    expect(composed.segments?.map(segment => segment.range)).toEqual([
      { start: 0n, end: 100n }, { start: 100n, end: 200n }, { start: 200n, end: 300n },
    ])
    expect(cache.read(broad, 2)).toBe(otherTrack)
    expect(composed.segments![1]!.data).toBe(cache.read({ ...broad, range: { start: 120n, end: 180n } }, 1))
  })

  it('queries only missing tracks and isolates interpretations of the same trace', async () => {
    const cache = new TimelineCache()
    const full = request(false)
    await cache.load({ ...full, trackIds: [1] })
    await cache.load(full)
    expect(full.source.events).toHaveBeenLastCalledWith(expect.objectContaining({ trackIds: [2, 3] }))
    const otherModel = { ...full.source }
    expect(cache.covers({ ...full, source: otherModel })).toBe(false)
    cache.retain([full.source])
    expect(cache.covers(full)).toBe(true)
    cache.retain([])
    expect(cache.covers(full)).toBe(false)
  })

  it('reuses adjacent cached regions together without querying them again and still detects real gaps', async () => {
    const cache = new TimelineCache()
    const full = request(false)
    await cache.load({ ...full, range: { start: 0n, end: 150n } })
    await cache.load({ ...full, range: { start: 150n, end: 300n } })
    expect(cache.covers(full)).toBe(true)
    await cache.load(full)
    expect(full.source.events).toHaveBeenCalledTimes(2)
    expect(cache.covers({ ...full, range: { start: 0n, end: 301n } })).toBe(false)
    await cache.load({ ...full, range: { start: 400n, end: 600n } })
    expect(cache.covers({ ...full, range: { start: 100n, end: 500n } })).toBe(false)
  })

  it('discards late results after a source reset and bounds retained query regions', async () => {
    const cache = new TimelineCache()
    const full = request()
    let finish!: (value: Awaited<ReturnType<ReplayDataSource['density']>>) => void
    vi.mocked(full.source.density).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = cache.load(full)
    cache.clear()
    finish([])
    await pending
    expect(cache.covers(full)).toBe(false)
    for (let index = 0; index < 14; index++) await cache.load({ ...full, range: { start: BigInt(index * 1000), end: BigInt(index * 1000 + 300) } })
    expect(cache.covers(full)).toBe(false)
    expect(cache.covers({ ...full, range: { start: 13000n, end: 13300n } })).toBe(true)
  })
})

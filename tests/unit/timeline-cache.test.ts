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
    expect(cache.read({ ...moved, range: { start: 250n, end: 350n } }, 1)).toBeUndefined()
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

  it('caches density fallback for a truncated event page without querying it repeatedly', async () => {
    const cache = new TimelineCache()
    const full = request(false)
    vi.mocked(full.source.events).mockResolvedValue({ events: [], truncated: true })
    await cache.load(full)
    const moved = { ...full, range: { start: 50n, end: 200n }, trackIds: [1], resolution: 0.001 }
    expect(cache.covers(moved)).toBe(true)
    expect(cache.read(moved, 1)?.dense).toBe(true)
    await cache.load(moved)
    expect(full.source.events).toHaveBeenCalledTimes(1)
    expect(full.source.density).toHaveBeenCalledTimes(1)
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

import { describe, expect, it, vi } from 'vitest'
import { DefaultModel } from '../../src/models/default'
import { trackRows } from '../../src/engine/track-tree'
import { parseProject } from '../../src/core/project'
import type { ParsedTraceSource, RawSpan, RawTrack } from '../../src/core/types'

function source(): ParsedTraceSource {
  const events: RawSpan[] = [
    { id: 1, trackId: 5, name: 'TASK_LINEAR_1', start: 1000n, end: 2000n, depth: 0, argSetId: 4, incomplete: false },
    { id: 2, trackId: 9, name: 'ordinary event', start: 1200n, end: 1500n, depth: 1, argSetId: 0, incomplete: true },
  ]
  return {
    metadata: { id: 'source', filename: 'ordinary.trace', fingerprint: 'a'.repeat(64), bytes: 10, parserId: 'perfetto', parserVersion: '1', start: 1000n, end: 4000n, eventCount: 2, trackCount: 2, counterCount: 0, incompleteCount: 1, engineVersion: 'test' },
    tracks: vi.fn(async () => [{ id: 5, parentId: null, name: 'thread' }, { id: 9, parentId: 5, name: 'nested' }]),
    events: vi.fn(async () => ({ events, truncated: false })),
    density: vi.fn(async () => [{ trackId: 9, start: 1000n, end: 1500n, count: 2, name: 'ordinary event' }]),
    search: vi.fn(async () => events), statistics: vi.fn(async () => ({ count: 2, sumDuration: 1300n, unionDuration: 1000n })),
    groupedStatistics: vi.fn(async () => []), activity: vi.fn(async () => []), boundary: vi.fn(async () => 2000n), args: vi.fn(async () => ({ kind: 'custom' })), close: vi.fn(),
  }
}

describe('default compute interpretation', () => {
  it('keeps every raw event without inferring hardware or requiring block names', async () => {
    const raw = source()
    const model = await new DefaultModel().build(raw)
    expect(model.device).toBeNull()
    expect(model.trackMap.size).toBe(0)
    const result = await model.events({ start: 0n, end: 3000n })
    expect(raw.events).toHaveBeenCalledWith({ start: 1000n, end: 4000n })
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toMatchObject({ id: 1, sourceId: 'source', name: 'TASK_LINEAR_1', trackId: 5, start: 0n, end: 1000n, argSetId: 4 })
    expect(result.events[1]).toMatchObject({ id: 2, trackId: 9, depth: 1, incomplete: true })
    expect(result.events.every(event => !('cuId' in event) && !('deviceId' in event) && !('groupId' in event))).toBe(true)
    await expect(model.cuStatistics()).rejects.toThrow('不提供 CU')
    await expect(model.activity()).rejects.toThrow('不提供 CU')
    expect(raw.activity).not.toHaveBeenCalled()
    expect(raw.groupedStatistics).not.toHaveBeenCalled()
  })

  it('shifts all queries consistently and preserves density, names, statistics and null boundaries', async () => {
    const raw = source()
    const model = await new DefaultModel().build(raw)
    model.offset = -500n
    expect(model.range).toEqual({ start: -500n, end: 2500n })
    expect(await model.density({ start: -500n, end: 1500n, trackIds: [9], buckets: 3 })).toEqual([{ sourceId: 'source', trackId: 9, start: -500n, end: 0n, count: 2, name: 'ordinary event' }])
    expect(raw.density).toHaveBeenCalledWith({ start: 1000n, end: 3000n, trackIds: [9], buckets: 3, byDepth: true })
    expect((await model.search('event', 50)).map(event => event.id)).toEqual([1, 2])
    expect(raw.search).toHaveBeenCalledWith('event', 50)
    expect(await model.statistics({ start: -500n, end: 1500n })).toEqual({ count: 2, sumDuration: 1300n, unionDuration: 1000n })
    expect(raw.statistics).toHaveBeenCalledWith({ start: 1000n, end: 3000n })
    expect(await model.boundary(0n, 1)).toBe(500n)
    expect(raw.boundary).toHaveBeenCalledWith(1500n, 1)
    raw.boundary = async () => null
    expect(await model.boundary(0n, -1)).toBeNull()
  })

  it('uses the query offset snapshot when a later offset change races with the result', async () => {
    const raw = source()
    let finish!: (value: Awaited<ReturnType<ParsedTraceSource['events']>>) => void
    raw.events = () => new Promise(resolve => { finish = resolve })
    const model = await new DefaultModel().build(raw)
    const pending = model.events({ start: 0n, end: 3000n })
    model.offset = 500n
    finish({ events: [{ id: 1, trackId: 9, name: 'event', depth: 0, argSetId: 0, start: 1000n, end: 2000n, incomplete: false }], truncated: true })
    expect(await pending).toMatchObject({ events: [{ start: 0n, end: 1000n }], truncated: true })
  })

  it('preserves nanosecond precision for large absolute timestamps', async () => {
    const raw = source()
    const origin = (1n << 60n) + 7n
    raw.metadata.start = origin
    raw.metadata.end = origin + 1000n
    raw.events = async () => ({ events: [{ id: 1, trackId: 9, name: 'event', depth: 0, argSetId: 0, start: origin + 1n, end: origin + 11n, incomplete: false }], truncated: false })
    const model = await new DefaultModel().build(raw)
    expect((await model.events({ start: 0n, end: 1000n })).events[0]).toMatchObject({ start: 1n, end: 11n })
  })

  it('accepts default projects while rejecting unregistered compute models', () => {
    const project = { version: 1, computeModel: { id: 'default', version: '1' }, sources: [{ filename: 'trace', fingerprint: 'a'.repeat(64), parser: { id: 'perfetto', version: '1' }, offset: '0' }], time: '0', speed: 0.0001, viewport: { start: '0', end: '3000' }, selection: null, loop: false, bookmarks: [] }
    expect(parseProject(JSON.stringify(project)).computeModel.id).toBe('default')
    expect(() => parseProject(JSON.stringify({ ...project, computeModel: { id: 'unknown', version: '1' } }))).toThrow('计算模式')
  })
})

describe('raw track hierarchy', () => {
  const tracks: RawTrack[] = [{ id: 2, parentId: 1, name: 'group_0' }, { id: 1, parentId: null, name: 'block_0' }, { id: 3, parentId: 2, name: 'group_0' }, { id: 4, parentId: null, name: 'ordinary' }]
  it('keeps original names, unique track identities and parent order without CU labels', () => {
    const rows = trackRows('source', tracks, new Set())
    expect(rows.map(row => row.trackIds[0])).toEqual([1, 2, 3, 4])
    expect(rows.map(row => row.label)).toEqual(['block_0', 'group_0', 'group_0', 'ordinary'])
    expect(rows.map(row => row.treeDepth)).toEqual([0, 1, 2, 0])
    expect(new Set(rows.map(row => row.id)).size).toBe(4)
    expect(rows.every(row => row.cuId === undefined)).toBe(true)
    expect(rows[0]!.id).not.toBe(trackRows('other', tracks, new Set())[0]!.id)
  })
  it('collapses descendants without reattaching them as roots', () => {
    const rows = trackRows('source', tracks, new Set(['source/track/1']))
    expect(rows.map(row => row.trackIds[0])).toEqual([1, 4])
    expect(rows[0]).toMatchObject({ hasChildren: true, collapsed: true })
    expect(rows.map(row => row.trackIds)).toEqual([[1, 2, 3], [4]])
  })
  it('summarizes only the descendants hidden by each folded branch and restores raw tracks on expansion', () => {
    const folded = trackRows('source', tracks, new Set(['source/track/2']))
    expect(folded.map(row => row.trackIds)).toEqual([[1], [2, 3], [4]])
    const nested = trackRows('source', tracks, new Set(['source/track/1', 'source/track/2']))
    expect(nested.map(row => row.trackIds)).toEqual([[1, 2, 3], [4]])
    const expanded = trackRows('source', tracks, new Set())
    expect(expanded.map(row => row.trackIds)).toEqual([[1], [2], [3], [4]])
  })
  it('includes every branch once in folded summaries even with cyclic or detached tracks', () => {
    const rows = trackRows('source', [{ id: 1, parentId: 2, name: 'cycle' }, { id: 2, parentId: 1, name: 'cycle' }, { id: 3, parentId: 1, name: 'child' }, { id: 4, parentId: 99, name: 'detached' }], new Set(['source/track/1', 'source/track/2']))
    expect(rows.map(row => row.trackIds)).toEqual([[4], [1, 2, 3]])
  })
  it('keeps orphan, empty, self-referential and cyclic tracks exactly once', () => {
    const rows = trackRows('source', [{ id: 1, parentId: 2, name: 'cycle' }, { id: 2, parentId: 1, name: 'cycle' }, { id: 3, parentId: 99, name: '' }, { id: 4, parentId: 4, name: 'self' }], new Set())
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map(row => row.trackIds[0])).size).toBe(4)
    expect(rows.find(row => row.trackIds[0] === 3)?.label).toBe('轨道 3')
  })
})

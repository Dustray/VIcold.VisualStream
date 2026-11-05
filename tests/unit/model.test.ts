import { describe, expect, it, vi } from 'vitest'
import { MegakernelModel } from '../../src/models/megakernel'
import { parseProject } from '../../src/core/project'
import { fitRange, parseMilliseconds, unionDuration } from '../../src/core/time'
import type { ParsedTraceSource, RawSpan, RawTrack } from '../../src/core/types'

function source(id = 'source-a'): ParsedTraceSource {
  const tracks: RawTrack[] = [{ id: 0, parentId: null, name: 'block_0' }, { id: 1, parentId: 0, name: 'group_0' }, { id: 2, parentId: 1, name: 'group_0' }, { id: 3, parentId: null, name: 'block_1' }, { id: 4, parentId: 3, name: 'group_0' }]
  const event: RawSpan = { id: 1, trackId: 2, name: 'TASK_EXAMPLE', depth: 0, argSetId: 0, start: 1000n, end: 2000n, incomplete: false }
  return { metadata: { id, filename: 'demo_rank0_gpu1.trace', bytes: 10, fingerprint: 'a'.repeat(64), parserId: 'custom', parserVersion: '1', start: 1000n, end: 4000n, eventCount: 1, trackCount: 5, counterCount: 0, incompleteCount: 0, engineVersion: 'test' }, tracks: async () => tracks, events: vi.fn(async () => ({ events: [event], truncated: false })), density: async () => [], statistics: async () => ({ count: 1, sumDuration: 1000n, unionDuration: 1000n }), search: async () => [event], boundary: async () => 2000n, args: async () => ({}), close: vi.fn() }
}

describe('Megakernel compute interpretation', () => {
  it('is independent from file encoding and keeps group identity local to each CU', async () => {
    const raw = source()
    const model = await new MegakernelModel().build(raw)
    expect(model.device.cus.map(cu => cu.index)).toEqual([0, 1])
    expect(model.device.cus.every(cu => cu.groups.length === 1)).toBe(true)
    expect(model.device.cus[0]!.groups[0]!.id).not.toBe(model.device.cus[1]!.groups[0]!.id)
    expect(model.trackMap.get(2)).toEqual(model.trackMap.get(1))
    model.offset = 500n
    const result = await model.events({ start: 500n, end: 1500n })
    expect(raw.events).toHaveBeenCalledWith({ start: 1000n, end: 2000n })
    expect(result.events[0]).toMatchObject({ start: 500n, end: 1500n, sourceId: 'source-a' })
    const other = await new MegakernelModel().build(source('source-b'))
    expect(other.device.cus[0]!.id).not.toBe(model.device.cus[0]!.id)
    expect(await model.boundary(500n, 1)).toBe(1500n)
  })

  it('rejects an unrelated trace with no block hierarchy', async () => {
    const raw = source()
    raw.tracks = async () => [{ id: 1, parentId: null, name: 'thread' }]
    await expect(new MegakernelModel().build(raw)).rejects.toThrow('block_')
  })
})

describe('time and project validation', () => {
  it('handles exact nanoseconds, negative offsets, clipping and overlapping durations', () => {
    expect(parseMilliseconds(' -1.000001 ')).toBe(-1000001n)
    expect(parseMilliseconds('1.0000001')).toBeNull()
    expect(fitRange({ start: 999n, end: 999n }, { start: 0n, end: 1000n })).toEqual({ start: 900n, end: 1000n })
    expect(unionDuration([{ start: 0n, end: 20n }, { start: 3n, end: 5n }, { start: 15n, end: 30n }, { start: 50n, end: 70n }])).toBe(50n)
  })

  it('validates project references and 64 bit times', () => {
    const project = { version: 1, computeModel: { id: 'megakernel', version: '1' }, sources: [{ filename: 'a', fingerprint: 'a'.repeat(64), parser: { id: 'perfetto', version: '1' }, offset: '0' }], time: '9007199254740993', viewport: { start: '0', end: '9223372036854775807' }, speed: 0.001, selection: null, loop: false, bookmarks: [] }
    expect(parseProject(JSON.stringify(project)).time).toBe('9007199254740993')
    expect(() => parseProject(JSON.stringify({ ...project, time: '9223372036854775808' }))).toThrow()
    expect(() => parseProject(JSON.stringify({ ...project, sources: [{ ...project.sources[0], fingerprint: 'bad' }] }))).toThrow()
    expect(() => parseProject(JSON.stringify({ ...project, computeModel: { id: 'hipprof', version: '1' } }))).toThrow()
  })
})

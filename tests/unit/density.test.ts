import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SqlRow } from '../../src/core/types'
import { eventColor } from '../../src/core/time'
import { queryDensity } from '../../src/parsers/perfetto/density'

describe('colored density aggregation', () => {
  it.each([0n, 9007199254740993n])('keeps representative names, counts and exact clipping at origin %s', async origin => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER, name TEXT)')
      const insert = database.prepare('INSERT INTO slice VALUES (?, ?, ?, ?, ?)')
      for (const span of [
        { id: 1, track: 1, start: -10, duration: 20, name: 'SHORT_1' },
        { id: 2, track: 1, start: 2, duration: 40, name: 'TASK_RMS_NORM_12' },
        { id: 3, track: 1, start: 50, duration: 45, name: 'TASK_RMS_NORM_99' },
        { id: 4, track: 1, start: 99, duration: 10, name: 'TINY_1' },
        { id: 5, track: 2, start: 60, duration: -1, name: 'OPEN_1' },
        { id: 6, track: 1, start: 55, duration: 0, name: 'ZERO_1' },
      ]) insert.run(span.id, span.track, origin + BigInt(span.start), span.duration, span.name)
      const engine = { query: vi.fn(async (sql: string) => {
        const statement = database.prepare(sql)
        statement.setReadBigInts(true)
        return statement.all() as SqlRow[]
      }) }
      const bins = await queryDensity(engine, { start: origin, end: origin + 100n, buckets: 2 }, origin + 110n)
      expect(bins).toEqual([
        { trackId: 1, start: origin, end: origin + 42n, count: 2, name: 'TASK_RMS_NORM_12', representativeDuration: 40n },
        { trackId: 1, start: origin + 50n, end: origin + 100n, count: 2, name: 'TASK_RMS_NORM_99', representativeDuration: 45n },
        { trackId: 2, start: origin + 60n, end: origin + 100n, count: 1, name: 'OPEN_1', representativeDuration: 40n, event: { id: 5, start: origin + 60n, end: origin + 110n } },
      ])
      expect(eventColor(bins[0]!.name!)).toBe(eventColor(bins[1]!.name!))
      expect(await queryDensity(engine, { start: origin, end: origin + 100n, buckets: 2, trackIds: [2] }, origin + 110n)).toEqual([bins[2]])
    } finally { database.close() }
  })

  it('keeps nested density lanes separate while retaining combined queries for Megakernel', async () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec("CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER, name TEXT, depth INTEGER); INSERT INTO slice VALUES (1, 7, 0, 100, 'parent', 0), (2, 7, 10, 20, 'child', 1)")
      const engine = { query: async (sql: string) => { const statement = database.prepare(sql); statement.setReadBigInts(true); return statement.all() as SqlRow[] } }
      const lanes = await queryDensity(engine, { start: 0n, end: 100n, buckets: 1, byDepth: true }, 100n)
      expect(lanes.map(bin => ({ depth: bin.depth, count: bin.count, name: bin.name }))).toEqual([{ depth: 0, count: 1, name: 'parent' }, { depth: 1, count: 1, name: 'child' }])
      const combined = await queryDensity(engine, { start: 0n, end: 100n, buckets: 1 }, 100n)
      expect(combined).toHaveLength(1)
      expect(combined[0]).toMatchObject({ count: 2, name: 'parent' })
      expect(combined[0]?.depth).toBeUndefined()
    } finally { database.close() }
  })

  it('chooses the longest clipped representative and resolves duration ties by original record ID', async () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec("CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER, name TEXT); INSERT INTO slice VALUES (9, 1, 5, 90, 'same duration, later id'), (2, 1, 0, 90, '算子 👾'), (1, 1, -90, 100, 'long before clipping'), (3, 1, 15, 60, 'shorter')")
      const engine = { query: async (sql: string) => { const statement = database.prepare(sql); statement.setReadBigInts(true); return statement.all() as SqlRow[] } }
      expect(await queryDensity(engine, { start: 0n, end: 100n, buckets: 1 }, 100n)).toEqual([{ trackId: 1, start: 0n, end: 95n, count: 4, name: '算子 👾', representativeDuration: 90n }])
    } finally { database.close() }
  })

  it.each([0n, 9007199254740993n])('retains exact single-event identity and full bounds across overlapping query ranges at %s', async origin => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER, name TEXT)')
      const insert = database.prepare('INSERT INTO slice VALUES (?, ?, ?, ?, ?)')
      insert.run(0, 1, origin, 100n, 'PyTorch Profiler (0)')
      insert.run(1, 1, origin + 110n, 90n, 'PyTorch Profiler (0)')
      const engine = { query: async (sql: string) => { const statement = database.prepare(sql); statement.setReadBigInts(true); return statement.all() as SqlRow[] } }
      for (const [start, end] of [[10n, 40n], [35n, 65n], [80n, 100n]]) {
        const bins = await queryDensity(engine, { start: origin + start!, end: origin + end!, buckets: 5 }, origin + 200n)
        expect(bins).toHaveLength(1)
        expect(bins[0]).toMatchObject({ start: origin + start!, end: origin + end!, count: 1, event: { id: 0, start: origin, end: origin + 100n } })
      }
      const later = await queryDensity(engine, { start: origin + 120n, end: origin + 160n, buckets: 5 }, origin + 200n)
      expect(later[0]?.event).toEqual({ id: 1, start: origin + 110n, end: origin + 200n })
    } finally { database.close() }
  })

  it('skips invalid, empty or unmapped queries', async () => {
    const engine = { query: vi.fn(async () => []) }
    for (const query of [
      { start: 0n, end: 10n, buckets: 0 }, { start: 0n, end: 10n, buckets: Infinity },
      { start: 10n, end: 10n, buckets: 10 }, { start: 0n, end: 10n, buckets: 10, trackIds: [] },
    ]) expect(await queryDensity(engine, query, 10n)).toEqual([])
    expect(engine.query).not.toHaveBeenCalled()
  })
})

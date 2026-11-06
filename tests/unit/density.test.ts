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
        { trackId: 2, start: origin + 60n, end: origin + 100n, count: 1, name: 'OPEN_1', representativeDuration: 40n },
      ])
      expect(eventColor(bins[0]!.name!)).toBe(eventColor(bins[1]!.name!))
      expect(await queryDensity(engine, { start: origin, end: origin + 100n, buckets: 2, trackIds: [2] }, origin + 110n)).toEqual([bins[2]])
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

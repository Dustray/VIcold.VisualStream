import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SqlRow } from '../../src/core/types'
import { timeBuckets } from '../../src/core/time'
import { queryActivity } from '../../src/parsers/perfetto/activity'
import { queryGroupedStatistics } from '../../src/parsers/perfetto/grouped-statistics'

describe('overview activity histograms', () => {
  it.each([0n, -1000n, 9007199254740993n])('merges overlapping tracks per CU before splitting time at origin %s', async origin => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER)')
      const insert = database.prepare('INSERT INTO slice VALUES (?, ?, ?, ?)')
      const spans = [[1, 1, 0, 100], [2, 1, 10, 10], [3, 2, 90, 30], [4, 2, 120, 10], [5, 1, 150, 50], [6, 3, 100, 100], [7, 3, 180, -1], [8, 99, 0, 300], [9, 1, 250, 0]]
      for (const [id, track, start, length] of spans) insert.run(id!, track!, origin + BigInt(start!), length!)
      const engine = { query: vi.fn(async (sql: string) => {
        const statement = database.prepare(sql)
        statement.setReadBigInts(true)
        return statement.all() as SqlRow[]
      }) }
      const groups = [{ id: "cu/'0", trackIds: [1, 2, 2] }, { id: 'cu/1', trackIds: [3] }, { id: 'idle', trackIds: [4] }]
      const range = { start: origin, end: origin + 300n }
      const bins = await queryActivity(engine, range, groups, 3, range.end)
      expect(engine.query).toHaveBeenCalledTimes(1)
      expect(bins.map(bin => bin.busyDuration)).toEqual([100n, 180n, 100n])
      expect(bins.map(bin => Number(bin.busyDuration) / Number((bin.end - bin.start) * 3n))).toEqual([1 / 3, 0.6, 1 / 3])
      const totals = await queryGroupedStatistics(engine, range, groups, range.end)
      expect(bins.reduce((total, bin) => total + bin.busyDuration, 0n)).toBe(totals.reduce((total, item) => total + item.unionDuration, 0n))
      const clipped = await queryActivity(engine, { start: origin + 80n, end: origin + 160n }, groups, 4, range.end)
      expect(clipped.map(bin => bin.busyDuration)).toEqual([20n, 40n, 30n, 30n])
      const outside = await queryActivity(engine, { start: origin + 350n, end: origin + 400n }, groups, 2, range.end)
      expect(outside.map(bin => bin.busyDuration)).toEqual([0n, 0n])
    } finally { database.close() }
  })

  it('returns zero bins for idle groups and avoids queries for invalid or unmapped ranges', async () => {
    const engine = { query: vi.fn(async () => []) }
    expect(await queryActivity(engine, { start: 0n, end: 3n }, [{ id: 'idle', trackIds: [] }], 180, 3n)).toEqual([
      { start: 0n, end: 1n, busyDuration: 0n }, { start: 1n, end: 2n, busyDuration: 0n }, { start: 2n, end: 3n, busyDuration: 0n },
    ])
    expect(await queryActivity(engine, { start: 5n, end: 5n }, [{ id: 'cu', trackIds: [1] }], 180, 10n)).toEqual([])
    expect(await queryActivity(engine, { start: 0n, end: 10n }, [], 0, 10n)).toEqual([])
    expect(engine.query).not.toHaveBeenCalled()
  })

  it('partitions nanoseconds without gaps, zero-width bins or a lost remainder', () => {
    expect(timeBuckets({ start: -4n, end: 7n }, 3)).toEqual([{ start: -4n, end: -1n }, { start: -1n, end: 3n }, { start: 3n, end: 7n }])
    expect(timeBuckets({ start: 0n, end: 10n }, Number.NaN)).toEqual([])
    expect(timeBuckets({ start: 0n, end: 10n }, Infinity)).toEqual([])
  })
})

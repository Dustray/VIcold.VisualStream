import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import type { DeviceResource, GroupStatistics, SqlRow } from '../../src/core/types'
import { summarizeCuUtilization } from '../../src/engine/cu-utilization'
import { queryGroupedStatistics } from '../../src/parsers/perfetto/grouped-statistics'

describe('CU interval statistics', () => {
  it.each([0n, 9_007_199_254_740_993n])('unions overlapping tracks per CU with exact nanoseconds at origin %s', async origin => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE slice (id INTEGER, track_id INTEGER, ts INTEGER, dur INTEGER)')
      const insert = database.prepare('INSERT INTO slice VALUES (?, ?, ?, ?)')
      const spans = [[1, 1, 0, 100], [2, 1, 10, 10], [3, 2, 90, 30], [4, 2, 120, 10], [5, 1, 150, 50], [6, 3, 100, 100], [7, 3, 180, -1], [8, 99, 0, 300], [9, 1, 250, 0], [10, 1, 300, 20]]
      for (const [id, track, start, length] of spans) insert.run(id!, track!, origin + BigInt(start!), length!)
      const engine = { query: vi.fn(async (sql: string) => {
        const statement = database.prepare(sql)
        statement.setReadBigInts(true)
        return statement.all() as SqlRow[]
      }) }
      const groups = [{ id: "cu/'0", trackIds: [1, 2, 2] }, { id: 'cu/1', trackIds: [3] }, { id: 'cu/2', trackIds: [4] }]
      const full = await queryGroupedStatistics(engine, { start: origin, end: origin + 300n }, groups, origin + 300n)
      expect(full).toEqual([
        { groupId: "cu/'0", count: 6, sumDuration: 200n, unionDuration: 180n },
        { groupId: 'cu/1', count: 2, sumDuration: 220n, unionDuration: 200n },
        { groupId: 'cu/2', count: 0, sumDuration: 0n, unionDuration: 0n },
      ])
      expect(engine.query).toHaveBeenCalledTimes(1)
      const selected = await queryGroupedStatistics(engine, { start: origin + 80n, end: origin + 160n }, groups, origin + 300n)
      expect(selected.map(item => item.unionDuration)).toEqual([60n, 60n, 0n])
      expect(selected.map(item => item.count)).toEqual([4, 1, 0])
      const outside = await queryGroupedStatistics(engine, { start: origin + 350n, end: origin + 400n }, groups, origin + 300n)
      expect(outside.every(item => item.unionDuration === 0n && item.count === 0)).toBe(true)
    } finally { database.close() }
  })

  it('returns zero for idle groups and skips queries for empty ranges or groups', async () => {
    const engine = { query: vi.fn(async () => []) }
    expect(await queryGroupedStatistics(engine, { start: 0n, end: 10n }, [{ id: 'idle', trackIds: [] }], 10n)).toEqual([{ groupId: 'idle', count: 0, sumDuration: 0n, unionDuration: 0n }])
    expect(await queryGroupedStatistics(engine, { start: 10n, end: 10n }, [{ id: 'cu', trackIds: [1] }], 10n)).toEqual([{ groupId: 'cu', count: 0, sumDuration: 0n, unionDuration: 0n }])
    expect(engine.query).not.toHaveBeenCalled()
  })
})

describe('CU utilization summaries', () => {
  const devices: DeviceResource[] = [
    { id: 'first', label: 'first', rank: 0, inferred: true, cus: [{ id: 'first/0', deviceId: 'first', index: 0, groups: [] }, { id: 'first/1', deviceId: 'first', index: 1, groups: [] }] },
    { id: 'second', label: 'second', rank: 1, inferred: true, cus: [{ id: 'second/0', deviceId: 'second', index: 0, groups: [] }] },
  ]
  const statistics: GroupStatistics[] = [
    { groupId: 'first/0', count: 5, sumDuration: 500n, unionDuration: 100n },
    { groupId: 'first/1', count: 2, sumDuration: 80n, unionDuration: 50n },
  ]

  it('weights all recorded CUs equally, counts idle CUs and never adds overlapping task durations', () => {
    const full = summarizeCuUtilization({ start: 0n, end: 100n }, devices, statistics)
    expect(full.ratio).toBe(0.5)
    expect(full.busyDuration).toBe(150n)
    expect(full.capacity).toBe(300n)
    expect(full.equivalentCus).toBe(1.5)
    expect(full.items.map(item => item.ratio)).toEqual([1, 0.5, 0])
    expect(full.items.map(item => item.idleDuration)).toEqual([0n, 50n, 100n])
    expect(summarizeCuUtilization({ start: 0n, end: 100n }, [devices[0]!], statistics).ratio).toBe(0.75)
    expect(summarizeCuUtilization({ start: 0n, end: 100n }, [devices[1]!], statistics).ratio).toBe(0)
  })

  it('keeps undefined utilization unknown when no CUs or no time are available', () => {
    expect(summarizeCuUtilization({ start: 0n, end: 100n }, [], []).ratio).toBeNull()
    const empty = summarizeCuUtilization({ start: 50n, end: 50n }, devices, [])
    expect(empty.ratio).toBeNull()
    expect(empty.items.every(item => item.ratio === null)).toBe(true)
  })
})

import type { GroupStatistics, SqlRow, TimeRange, TrackGroup } from '../../core/types'

export async function queryGroupedStatistics(engine: { query(sql: string): Promise<SqlRow[]> }, range: TimeRange, groups: TrackGroup[], traceEnd: bigint): Promise<GroupStatistics[]> {
  const empty = () => groups.map(group => ({ groupId: group.id, count: 0, sumDuration: 0n, unionDuration: 0n }))
  if (range.end <= range.start) return empty()
  const members = groups.flatMap((group, index) => [...new Set(group.trackIds)].filter(Number.isSafeInteger).map(track => `(${index}, ${track})`))
  if (!members.length) return empty()
  const end = `(CASE WHEN dur < 0 THEN ${traceEnd} ELSE ts + dur END)`
  const rows = await engine.query(`WITH members(group_index, track_id) AS (VALUES ${members.join(',')}),
    clipped AS (
      SELECT group_index, slice.id, MAX(ts, ${range.start}) AS begin_ns, MIN(${end}, ${range.end}) AS end_ns
      FROM slice JOIN members ON slice.track_id = members.track_id
      WHERE ts < ${range.end} AND ${end} > ${range.start}
    ), ordered AS (
      SELECT *, MAX(end_ns) OVER (PARTITION BY group_index ORDER BY begin_ns, end_ns, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM clipped
    ), segmented AS (
      SELECT *, SUM(CASE WHEN previous_end IS NULL OR begin_ns > previous_end THEN 1 ELSE 0 END)
        OVER (PARTITION BY group_index ORDER BY begin_ns, end_ns, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS segment_id FROM ordered
    ), merged AS (
      SELECT group_index, MIN(begin_ns) AS begin_ns, MAX(end_ns) AS end_ns FROM segmented GROUP BY group_index, segment_id
    ), totals AS (
      SELECT group_index, COUNT(*) AS count, SUM(end_ns - begin_ns) AS sum_duration FROM clipped GROUP BY group_index
    ), unions AS (
      SELECT group_index, SUM(end_ns - begin_ns) AS union_duration FROM merged GROUP BY group_index
    ) SELECT totals.group_index, count, sum_duration, union_duration FROM totals JOIN unions USING(group_index)`)
  const byGroup = new Map(rows.map(row => [Number(row.group_index), row]))
  return groups.map((group, index) => {
    const row = byGroup.get(index)
    return { groupId: group.id, count: Number(row?.count ?? 0), sumDuration: BigInt(row?.sum_duration?.toString() ?? '0'), unionDuration: BigInt(row?.union_duration?.toString() ?? '0') }
  })
}

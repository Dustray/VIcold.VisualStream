import type { ActivityBin, SqlRow, TimeRange, TrackGroup } from '../../core/types'
import { timeBuckets } from '../../core/time'

export async function queryActivity(engine: { query(sql: string): Promise<SqlRow[]> }, range: TimeRange, groups: TrackGroup[], buckets: number, traceEnd: bigint): Promise<ActivityBin[]> {
  const bins = timeBuckets(range, buckets).map(bin => ({ ...bin, busyDuration: 0n }))
  const members = groups.flatMap((group, index) => [...new Set(group.trackIds)].filter(Number.isSafeInteger).map(track => `(${index}, ${track})`))
  if (!bins.length || !members.length) return bins
  const end = `(CASE WHEN dur < 0 THEN ${traceEnd} ELSE ts + dur END)`
  const rows = await engine.query(`WITH members(group_index, track_id) AS (VALUES ${members.join(',')}),
    clipped AS (
      SELECT group_index, slice.id, MAX(ts, ${range.start}) AS begin_ns, MIN(${end}, ${range.end}) AS end_ns
      FROM slice JOIN members ON slice.track_id = members.track_id
      WHERE ts < ${range.end} AND ${end} > ${range.start} AND dur != 0
    ), ordered AS (
      SELECT *, MAX(end_ns) OVER (PARTITION BY group_index ORDER BY begin_ns, end_ns, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM clipped
    ), segmented AS (
      SELECT *, SUM(CASE WHEN previous_end IS NULL OR begin_ns > previous_end THEN 1 ELSE 0 END)
        OVER (PARTITION BY group_index ORDER BY begin_ns, end_ns, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS segment_id FROM ordered
    ), merged AS (
      SELECT group_index, MIN(begin_ns) AS begin_ns, MAX(end_ns) AS end_ns FROM segmented GROUP BY group_index, segment_id
    ), buckets(bucket_index, moment) AS (VALUES ${bins.map((bin, index) => `(${index}, ${bin.start})`).join(',')}, (${bins.length}, ${range.end})),
    changes AS (
      SELECT begin_ns AS moment, 1 AS delta, -1 AS bucket_index FROM merged
      UNION ALL SELECT end_ns, -1, -1 FROM merged
      UNION ALL SELECT moment, 0, bucket_index FROM buckets
    ), moments AS (
      SELECT moment, SUM(delta) AS delta, MAX(bucket_index) AS bucket_index FROM changes GROUP BY moment
    ), levels AS (
      SELECT moment, LEAD(moment) OVER (ORDER BY moment) AS next_moment,
        SUM(delta) OVER (ORDER BY moment ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS active_groups,
        MAX(bucket_index) OVER (ORDER BY moment ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bucket_index FROM moments
    ) SELECT bucket_index, SUM((next_moment - moment) * active_groups) AS busy_duration FROM levels WHERE next_moment IS NOT NULL GROUP BY bucket_index ORDER BY bucket_index`)
  for (const row of rows) bins[Number(row.bucket_index)]!.busyDuration = BigInt(row.busy_duration?.toString() ?? '0')
  return bins
}

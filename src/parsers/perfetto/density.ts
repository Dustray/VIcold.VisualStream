import type { DensityBin, EventQuery, SqlRow } from '../../core/types'

export async function queryDensity(engine: { query(sql: string): Promise<SqlRow[]> }, query: EventQuery & { buckets: number }, traceEnd: bigint): Promise<DensityBin[]> {
  if (query.end <= query.start || !Number.isFinite(query.buckets) || query.buckets <= 0 || query.trackIds?.length === 0) return []
  const width = (query.end - query.start) / BigInt(Math.max(1, Math.trunc(query.buckets))) || 1n
  const tracks = query.trackIds ? ` AND track_id IN (${query.trackIds.map(value => Math.trunc(value)).join(',')})` : ''
  const end = `(CASE WHEN dur < 0 THEN ${traceEnd} ELSE ts + dur END)`
  const rows = await engine.query(`WITH clipped AS (
    SELECT id, track_id, name, MAX(ts, ${query.start}) AS begin_ns, MIN(${end}, ${query.end}) AS end_ns,
      CAST((MAX(ts, ${query.start}) - ${query.start}) / ${width} AS INT) AS bucket
    FROM slice WHERE ts < ${query.end} AND ${end} > ${query.start} AND dur != 0${tracks}
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY track_id, bucket ORDER BY end_ns - begin_ns DESC, id) AS rank FROM clipped
  ) SELECT track_id, MIN(begin_ns) AS begin_ns, MAX(end_ns) AS end_ns, COUNT(*) AS count,
    MAX(CASE WHEN rank = 1 THEN name END) AS name, MAX(end_ns - begin_ns) AS representative_duration
    FROM ranked GROUP BY track_id, bucket ORDER BY track_id, bucket`)
  return rows.map(row => ({ trackId: Number(row.track_id), start: BigInt(String(row.begin_ns)), end: BigInt(String(row.end_ns)), count: Number(row.count), name: String(row.name ?? ''), representativeDuration: BigInt(String(row.representative_duration)) }))
}

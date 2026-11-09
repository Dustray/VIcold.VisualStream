import type { DensityBin, DensityQuery, SqlRow } from '../../core/types'

export async function queryDensity(engine: { query(sql: string): Promise<SqlRow[]> }, query: DensityQuery, traceEnd: bigint): Promise<DensityBin[]> {
  if (query.end <= query.start || !Number.isFinite(query.buckets) || query.buckets <= 0 || query.trackIds?.length === 0) return []
  const width = (query.end - query.start) / BigInt(Math.max(1, Math.trunc(query.buckets))) || 1n
  const tracks = query.trackIds ? ` AND track_id IN (${query.trackIds.map(value => Math.trunc(value)).join(',')})` : ''
  const end = `(CASE WHEN dur < 0 THEN ${traceEnd} ELSE ts + dur END)`
  const depth = query.byDepth ? ', depth' : ''
  const rows = await engine.query(`WITH clipped AS (
    SELECT id, track_id${depth}, name, ts AS event_start, ${end} AS event_end, MAX(ts, ${query.start}) AS begin_ns, MIN(${end}, ${query.end}) AS end_ns,
      CAST((MAX(ts, ${query.start}) - ${query.start}) / ${width} AS INT) AS bucket
    FROM slice WHERE ts < ${query.end} AND ${end} > ${query.start} AND dur != 0${tracks}
  ) SELECT track_id${depth}, MIN(begin_ns) AS begin_ns, MAX(end_ns) AS end_ns, COUNT(*) AS count,
    SUBSTR(MAX(PRINTF('%020lld%020lld%s', end_ns - begin_ns, 9223372036854775807 - id, name)), 41) AS name,
    MAX(end_ns - begin_ns) AS representative_duration,
    MIN(id) AS event_id, MIN(event_start) AS event_start, MAX(event_end) AS event_end
    FROM clipped GROUP BY track_id${depth}, bucket ORDER BY track_id${depth}, bucket`)
  return rows.map(row => ({
    trackId: Number(row.track_id), start: BigInt(String(row.begin_ns)), end: BigInt(String(row.end_ns)), count: Number(row.count),
    name: String(row.name ?? ''), representativeDuration: BigInt(String(row.representative_duration)),
    ...(query.byDepth ? { depth: Number(row.depth) } : {}),
    ...(Number(row.count) === 1 ? { event: { id: Number(row.event_id), start: BigInt(String(row.event_start)), end: BigInt(String(row.event_end)) } } : {}),
  }))
}

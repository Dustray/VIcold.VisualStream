import type { DensityBin, EventQuery, ImportProgress, ParsedTraceSource, RawSpan, SourceMetadata, SqlRow, TimeRange, TraceFileParser, TrackGroup } from '../../core/types'
import { queryDensity } from './density'
import { PerfettoEngine } from './engine'
import { queryGroupedStatistics } from './grouped-statistics'
import { queryActivity } from './activity'
import { traceFileLimit, traceFileLimitMessage } from '../../core/files'

const integer = (value: SqlRow[string]): bigint => typeof value === 'bigint' ? value : BigInt(String(value ?? 0))
const number = (value: SqlRow[string]): number => Number(value ?? 0)
const text = (value: SqlRow[string]): string => String(value ?? '')

export class PerfettoParser implements TraceFileParser {
  readonly id = 'perfetto'
  async probe(file: File): Promise<boolean> {
    const header = new Uint8Array(await file.slice(0, 64).arrayBuffer())
    return header.length > 2 && header[0] === 10
  }
  async open(file: File, progress: (value: ImportProgress) => void): Promise<ParsedTraceSource> {
    if (file.size > traceFileLimit) throw new Error(traceFileLimitMessage)
    progress({ stage: '启动本地 Perfetto 引擎', fraction: 0.03 })
    const engine = new PerfettoEngine()
    await engine.initialize()
    const buffer = new Uint8Array(await file.arrayBuffer())
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    for (let offset = 0; offset < buffer.length; offset += 1024 * 1024) {
      await engine.append(buffer.subarray(offset, offset + 1024 * 1024))
      progress({ stage: '解析轨道与事件', fraction: 0.1 + 0.7 * Math.min(1, (offset + 1024 * 1024) / buffer.length) })
    }
    await engine.finish()
    progress({ stage: '建立查询与时间索引', fraction: 0.88 })
    const summary = (await engine.query('SELECT MIN(ts) AS start, MAX(ts + MAX(dur, 0)) AS end, COUNT(*) AS count, SUM(CASE WHEN dur < 0 THEN 1 ELSE 0 END) AS incomplete FROM slice'))[0]!
    if (!number(summary.count) || summary.start === null) throw new Error('文件中没有可重放的区间事件。')
    const tracks = (await engine.query('SELECT COUNT(*) AS count FROM track'))[0]!
    const counters = (await engine.query('SELECT COUNT(*) AS count FROM counter'))[0]!
    const manifest = await fetch('/vendor/perfetto/manifest.json').then(response => response.json()) as { version: string }
    const metadata: SourceMetadata = { id: crypto.randomUUID(), filename: file.name, bytes: file.size, fingerprint, parserId: this.id, parserVersion: '1', start: integer(summary.start), end: integer(summary.end), eventCount: number(summary.count), incompleteCount: number(summary.incomplete), trackCount: number(tracks.count), counterCount: number(counters.count), engineVersion: manifest.version }
    progress({ stage: '读取轨道元数据', fraction: 0.96 })
    return new PerfettoSource(engine, metadata)
  }
}

class PerfettoSource implements ParsedTraceSource {
  constructor(private readonly engine: PerfettoEngine, readonly metadata: SourceMetadata) {}
  async tracks() {
    const rows = await this.engine.query(`SELECT track.id, track.name, track.parent_id,
      EXTRACT_ARG(track.source_arg_set_id, 'trace_id') AS uuid,
      EXTRACT_ARG(track.dimension_arg_set_id, 'parent_track_uuid') AS parent_uuid
      FROM track ORDER BY track.id`)
    const uuidToTrack = new Map(rows.filter(row => row.uuid !== null).map(row => [String(row.uuid), number(row.id)]))
    return rows.map(row => ({ id: number(row.id), name: text(row.name), parentId: row.parent_id !== null ? number(row.parent_id) : row.parent_uuid !== null ? uuidToTrack.get(String(row.parent_uuid)) ?? null : null }))
  }
  private endExpression(): string { return `(CASE WHEN dur < 0 THEN ${this.metadata.end} ELSE ts + dur END)` }
  private where(query: EventQuery): string {
    const tracks = query.trackIds ? ` AND track_id IN (${query.trackIds.length ? query.trackIds.map(value => Math.trunc(value)).join(',') : '-1'})` : ''
    return `ts < ${query.end} AND ${this.endExpression()} > ${query.start}${tracks}`
  }
  private span(row: SqlRow): RawSpan {
    const start = integer(row.ts)
    const length = integer(row.dur)
    return { id: number(row.id), trackId: number(row.track_id), name: text(row.name), depth: number(row.depth), argSetId: number(row.arg_set_id), start, end: length < 0n ? this.metadata.end : start + length, incomplete: length < 0n }
  }
  async events(query: EventQuery) {
    const limit = Math.min(250000, Math.max(1, query.limit ?? 50000))
    const rows = await this.engine.query(`SELECT id, track_id, name, ts, dur, depth, arg_set_id FROM slice WHERE ${this.where(query)} ORDER BY ts, id LIMIT ${limit + 1}`)
    return { events: rows.slice(0, limit).map(row => this.span(row)), truncated: rows.length > limit }
  }
  async density(query: EventQuery & { buckets: number }): Promise<DensityBin[]> {
    return queryDensity(this.engine, query, this.metadata.end)
  }
  async statistics(query: EventQuery) {
    const rows = await this.engine.query(`WITH clipped AS (SELECT MAX(ts, ${query.start}) AS begin_ns, MIN(${this.endExpression()}, ${query.end}) AS end_ns FROM slice WHERE ${this.where(query)}), ordered AS (SELECT *, MAX(end_ns) OVER (ORDER BY begin_ns, end_ns ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM clipped), grouped AS (SELECT *, SUM(CASE WHEN previous_end IS NULL OR begin_ns > previous_end THEN 1 ELSE 0 END) OVER (ORDER BY begin_ns, end_ns ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS group_id FROM ordered), merged AS (SELECT MIN(begin_ns) AS begin_ns, MAX(end_ns) AS end_ns FROM grouped GROUP BY group_id) SELECT (SELECT COUNT(*) FROM clipped) AS count, (SELECT COALESCE(SUM(end_ns - begin_ns), 0) FROM clipped) AS sum_duration, (SELECT COALESCE(SUM(end_ns - begin_ns), 0) FROM merged) AS union_duration`)
    const row = rows[0]!
    return { count: number(row.count), sumDuration: integer(row.sum_duration), unionDuration: integer(row.union_duration) }
  }
  groupedStatistics(range: TimeRange, groups: TrackGroup[]) { return queryGroupedStatistics(this.engine, range, groups, this.metadata.end) }
  activity(range: TimeRange, groups: TrackGroup[], buckets: number) { return queryActivity(this.engine, range, groups, buckets, this.metadata.end) }
  async search(value: string, limit = 100) {
    const literal = value.replaceAll("'", "''")
    return (await this.engine.query(`SELECT id, track_id, name, ts, dur, depth, arg_set_id FROM slice WHERE INSTR(LOWER(name), LOWER('${literal}')) > 0 ORDER BY ts, id LIMIT ${Math.min(200, Math.max(1, Math.trunc(limit)))}`)).map(row => this.span(row))
  }
  async args(argSetId: number) {
    const rows = await this.engine.query(`SELECT key, display_value FROM args WHERE arg_set_id = ${Math.trunc(argSetId)}`)
    return Object.fromEntries(rows.map(row => [text(row.key), text(row.display_value)]))
  }
  async boundary(time: bigint, direction: -1 | 1) {
    const aggregate = direction > 0 ? 'MIN' : 'MAX'
    const comparison = direction > 0 ? '>' : '<'
    const row = (await this.engine.query(`SELECT ${aggregate}(value) AS value FROM (SELECT ${aggregate}(ts) AS value FROM slice WHERE ts ${comparison} ${time} UNION ALL SELECT ${aggregate}(${this.endExpression()}) AS value FROM slice WHERE ${this.endExpression()} ${comparison} ${time})`))[0]!
    return row.value === null ? null : integer(row.value)
  }
  close(): void { this.engine.close() }
}

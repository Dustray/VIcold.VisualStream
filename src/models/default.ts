import type { ComputeModelPlugin, EventQuery, ParsedTraceSource, RawSpan, ReplayDataSource, ReplayEvent, TimeRange } from '../core/types'

export class DefaultModel implements ComputeModelPlugin {
  readonly id = 'default'
  async build(source: ParsedTraceSource): Promise<DefaultDataSource> { return new DefaultDataSource(source) }
}

class DefaultDataSource implements ReplayDataSource {
  readonly modelId = 'default'
  readonly device = null
  readonly trackMap = new Map<number, { cuId: string; groupId: string }>()
  readonly diagnostics: string[]
  offset = 0n

  constructor(readonly source: ParsedTraceSource) {
    this.diagnostics = ['按原始轨道和区间事件重放，不推断计算卡、CU 或硬件利用率。']
    if (source.metadata.incompleteCount) this.diagnostics.push(`${source.metadata.incompleteCount} 个区间未闭合，显示至记录结束并标记不完整。`)
  }
  get range(): TimeRange { return { start: this.offset, end: this.source.metadata.end - this.source.metadata.start + this.offset } }
  private rawQuery(query: EventQuery, shift: bigint): EventQuery { return { ...query, start: query.start + shift, end: query.end + shift } }
  private mapEvent(event: RawSpan, shift: bigint): ReplayEvent {
    return { ...event, sourceId: this.source.metadata.id, start: event.start - shift, end: event.end - shift }
  }
  async events(query: EventQuery) {
    const shift = this.source.metadata.start - this.offset
    const page = await this.source.events(this.rawQuery(query, shift))
    return { events: page.events.map(event => this.mapEvent(event, shift)), truncated: page.truncated }
  }
  async density(query: EventQuery & { buckets: number }) {
    const shift = this.source.metadata.start - this.offset
    const bins = await this.source.density({ ...this.rawQuery(query, shift), buckets: query.buckets })
    return bins.map(bin => ({ ...bin, sourceId: this.source.metadata.id, start: bin.start - shift, end: bin.end - shift }))
  }
  statistics(query: EventQuery) { return this.source.statistics(this.rawQuery(query, this.source.metadata.start - this.offset)) }
  async cuStatistics(): Promise<never> { throw new Error('默认计算模式不提供 CU 利用率') }
  async activity(): Promise<never> { throw new Error('默认计算模式不提供 CU 任务利用率') }
  async search(text: string, limit = 100) {
    const shift = this.source.metadata.start - this.offset
    return (await this.source.search(text, limit)).map(event => this.mapEvent(event, shift))
  }
  async boundary(time: bigint, direction: -1 | 1) {
    const shift = this.source.metadata.start - this.offset
    const value = await this.source.boundary(time + shift, direction)
    return value === null ? null : value - shift
  }
}

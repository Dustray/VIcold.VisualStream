import type { ComputeModelPlugin, CuResource, DeviceResource, EventQuery, GroupResource, ParsedTraceSource, RawSpan, RawTrack, ReplayDataSource, ReplayEvent, TimeRange } from '../core/types'

export class MegakernelModel implements ComputeModelPlugin {
  readonly id = 'megakernel'

  async build(source: ParsedTraceSource): Promise<ReplayDataSource> {
    const tracks = await source.tracks()
    const byId = new Map(tracks.map(track => [track.id, track]))
    const sourceId = source.metadata.id
    const gpuHint = source.metadata.filename.match(/(?:^|_)gpu(\d+)/i)?.[1]
    const rankHint = source.metadata.filename.match(/(?:^|_)rank(\d+)/i)?.[1]
    const device: DeviceResource = { id: `${sourceId}/device`, label: gpuHint ? `计算卡 ${gpuHint}` : '计算卡', rank: rankHint === undefined ? null : Number(rankHint), inferred: true, cus: [] }
    const cus = new Map<number, CuResource>()
    const trackMap = new Map<number, { cuId: string; groupId: string }>()
    const diagnostics: string[] = []

    const ancestry = (track: RawTrack): RawTrack[] => {
      const result: RawTrack[] = []
      const visited = new Set<number>()
      let current: RawTrack | undefined = track
      while (current && !visited.has(current.id)) {
        visited.add(current.id)
        result.push(current)
        current = current.parentId === null ? undefined : byId.get(current.parentId)
      }
      return result
    }

    for (const track of tracks) {
      const ancestors = ancestry(track)
      const block = ancestors.find(parent => /^block_\d+$/.test(parent.name))
      if (!block) continue
      const cuIndex = Number(block.name.slice(6))
      let cu = cus.get(cuIndex)
      if (!cu) {
        cu = { id: `${device.id}/cu/${cuIndex}`, index: cuIndex, deviceId: device.id, groups: [] }
        cus.set(cuIndex, cu)
      }
      const groupTrack = ancestors.find(parent => /^group_\d+$/.test(parent.name))
      const groupIndex = groupTrack ? Number(groupTrack.name.slice(6)) : 0
      let group = cu.groups.find(candidate => candidate.index === groupIndex)
      if (!group) {
        group = { id: `${cu.id}/group/${groupIndex}`, index: groupIndex, cuId: cu.id, trackIds: [] } satisfies GroupResource
        cu.groups.push(group)
      }
      group.trackIds.push(track.id)
      trackMap.set(track.id, { cuId: cu.id, groupId: group.id })
    }
    if (!cus.size) throw new Error('文件已解码，但未发现 block_<编号> 层级，无法使用 Megakernel 计算模式解释。')
    device.cus = [...cus.values()].sort((left, right) => left.index - right.index)
    for (const cu of device.cus) cu.groups.sort((left, right) => left.index - right.index)
    if (!source.metadata.counterCount) diagnostics.push('此文件未采集硬件 counter；显示记录任务活动，不代表硬件利用率。')
    if (source.metadata.incompleteCount) diagnostics.push(`${source.metadata.incompleteCount} 个区间未闭合，显示至记录结束并标记不完整。`)
    diagnostics.push('设备 / rank 标签来自文件名提示；多来源时钟默认按相对起点对齐，尚未验证。')

    return new MegakernelDataSource(source, device, trackMap, diagnostics)
  }
}

class MegakernelDataSource implements ReplayDataSource {
  offset = 0n
  constructor(readonly source: ParsedTraceSource, readonly device: DeviceResource, readonly trackMap: ReadonlyMap<number, { cuId: string; groupId: string }>, readonly diagnostics: string[]) {}
  get range(): TimeRange { return { start: this.offset, end: this.source.metadata.end - this.source.metadata.start + this.offset } }
  private rawQuery(query: EventQuery): EventQuery { return { ...query, start: query.start + this.source.metadata.start - this.offset, end: query.end + this.source.metadata.start - this.offset } }
  private mapEvent(event: RawSpan): ReplayEvent | null {
    const resource = this.trackMap.get(event.trackId)
    if (!resource) return null
    return { ...event, ...resource, sourceId: this.source.metadata.id, deviceId: this.device.id, start: event.start - this.source.metadata.start + this.offset, end: event.end - this.source.metadata.start + this.offset }
  }
  async events(query: EventQuery) {
    const page = await this.source.events(this.rawQuery(query))
    return { events: page.events.map(event => this.mapEvent(event)).filter((event): event is ReplayEvent => event !== null), truncated: page.truncated }
  }
  async density(query: EventQuery & { buckets: number }) {
    const bins = await this.source.density({ ...this.rawQuery(query), buckets: query.buckets })
    return bins.flatMap(bin => {
      const resource = this.trackMap.get(bin.trackId)
      return resource ? [{ ...bin, ...resource, sourceId: this.source.metadata.id, start: bin.start - this.source.metadata.start + this.offset, end: bin.end - this.source.metadata.start + this.offset }] : []
    })
  }
  statistics(query: EventQuery) { return this.source.statistics(this.rawQuery(query)) }
  cuStatistics(range: TimeRange) { return this.source.groupedStatistics(this.rawQuery(range), this.device.cus.map(cu => ({ id: cu.id, trackIds: [...new Set(cu.groups.flatMap(group => group.trackIds))] }))) }
  async search(text: string, limit = 100) { return (await this.source.search(text, limit)).map(event => this.mapEvent(event)).filter((event): event is ReplayEvent => event !== null) }
  async boundary(time: bigint, direction: -1 | 1) {
    const value = await this.source.boundary(time + this.source.metadata.start - this.offset, direction)
    return value === null ? null : value - this.source.metadata.start + this.offset
  }
}

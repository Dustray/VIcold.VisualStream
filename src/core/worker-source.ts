import type { ActivityBin, DensityBin, DensityQuery, EventPage, EventQuery, GroupStatistics, ImportProgress, ParsedTraceSource, RangeStatistics, RawSpan, RawTrack, SourceMetadata, TimeRange, TrackGroup } from './types'

export class WorkerTraceSource implements ParsedTraceSource {
  metadata!: SourceMetadata
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly worker = new Worker(new URL('../workers/trace.worker.ts', import.meta.url), { type: 'module' })

  private constructor(onProgress: (value: ImportProgress) => void) {
    this.worker.onmessage = event => {
      const message = event.data
      if (message.kind === 'progress') { onProgress(message.progress as ImportProgress); return }
      const pending = this.pending.get(message.id as number)
      if (!pending) return
      this.pending.delete(message.id as number)
      if (message.kind === 'error') pending.reject(new Error(String(message.error)))
      else pending.resolve(message.result)
    }
    this.worker.onerror = event => this.fail(new Error(event.message || '解析 Worker 意外退出'))
    this.worker.onmessageerror = () => this.fail(new Error('解析线程返回的数据无法读取'))
  }

  static async open(file: File, onProgress: (value: ImportProgress) => void, signal?: AbortSignal, parserId = 'auto'): Promise<WorkerTraceSource> {
    const source = new WorkerTraceSource(onProgress)
    const abort = () => source.close()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) throw new Error('导入已取消')
      source.metadata = await source.call<SourceMetadata>('open', { file, parserId })
      return source
    } catch (error) { source.close(); throw error }
    finally { signal?.removeEventListener('abort', abort) }
  }

  tracks() { return this.call<RawTrack[]>('tracks', null) }
  events(query: EventQuery) { return this.call<EventPage>('events', query) }
  density(query: DensityQuery) { return this.call<DensityBin[]>('density', query) }
  statistics(query: EventQuery) { return this.call<RangeStatistics>('statistics', query) }
  groupedStatistics(range: TimeRange, groups: TrackGroup[]) { return this.call<GroupStatistics[]>('groupedStatistics', { range, groups }) }
  activity(range: TimeRange, groups: TrackGroup[], buckets: number) { return this.call<ActivityBin[]>('activity', { range, groups, buckets }) }
  search(text: string, limit?: number) { return this.call<RawSpan[]>('search', { text, limit }) }
  args(argSetId: number) { return this.call<Record<string, string>>('args', argSetId) }
  boundary(time: bigint, direction: -1 | 1) { return this.call<bigint | null>('boundary', { time, direction }) }
  close(): void { if (this.closed) return; this.closed = true; this.worker.terminate(); this.fail(new Error('来源已关闭或导入已取消')) }
  private fail(error: Error): void { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear() }
  private call<Result>(method: string, payload: unknown): Promise<Result> {
    if (this.closed) return Promise.reject(new Error('来源已关闭'))
    return new Promise<Result>((resolve, reject) => {
      const id = this.sequence++
      this.pending.set(id, { resolve: value => resolve(value as Result), reject })
      this.worker.postMessage({ id, method, payload })
    })
  }
}

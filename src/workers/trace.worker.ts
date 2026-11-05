import { ParserRegistry } from '../core/registry'
import type { EventQuery, ParsedTraceSource, TimeRange, TrackGroup } from '../core/types'
import { PerfettoParser } from '../parsers/perfetto/parser'

const registry = new ParserRegistry().register(new PerfettoParser())
let source: ParsedTraceSource | null = null
let queue = Promise.resolve()
const context = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void }

context.onmessage = (event: MessageEvent<{ id: number; method: string; payload: unknown }>) => {
  const { id, method, payload } = event.data
  queue = queue.then(async () => {
    try {
      let result: unknown
      if (method === 'open') {
        const { file, parserId } = payload as { file: File; parserId: string }
        const parser = parserId === 'auto' ? await registry.detect(file) : registry.get(parserId)
        if (!await parser.probe(file)) throw new Error(`文件内容与所选解析器 ${parser.id} 不匹配`)
        source = await parser.open(file, progress => context.postMessage({ kind: 'progress', progress }))
        result = source.metadata
      } else {
        if (!source) throw new Error('文件尚未打开')
        if (method === 'tracks') result = await source.tracks()
        else if (method === 'events') result = await source.events(payload as EventQuery)
        else if (method === 'density') result = await source.density(payload as EventQuery & { buckets: number })
        else if (method === 'statistics') result = await source.statistics(payload as EventQuery)
        else if (method === 'groupedStatistics') { const query = payload as { range: TimeRange; groups: TrackGroup[] }; result = await source.groupedStatistics(query.range, query.groups) }
        else if (method === 'activity') { const query = payload as { range: TimeRange; groups: TrackGroup[]; buckets: number }; result = await source.activity(query.range, query.groups, query.buckets) }
        else if (method === 'search') { const query = payload as { text: string; limit?: number }; result = await source.search(query.text, query.limit) }
        else if (method === 'args') result = await source.args(payload as number)
        else if (method === 'boundary') { const query = payload as { time: bigint; direction: -1 | 1 }; result = await source.boundary(query.time, query.direction) }
        else throw new Error(`未知查询：${method}`)
      }
      context.postMessage({ kind: 'result', id, result })
    } catch (error) { context.postMessage({ kind: 'error', id, error: error instanceof Error ? error.message : String(error) }) }
  })
}

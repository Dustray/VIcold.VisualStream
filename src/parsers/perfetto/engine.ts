import type { SqlRow } from '../../core/types'
import { encodeRequest, QueryRows, RpcFrames } from './protocol'

interface PendingRequest { method: number; query: QueryRows; resolve: (rows: SqlRow[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export class PerfettoEngine {
  private worker!: Worker
  private port!: MessagePort
  private sequence = 0
  private readonly frames = new RpcFrames()
  private pending: PendingRequest | null = null
  private queue: Promise<unknown> = Promise.resolve()

  async initialize(): Promise<void> {
    this.worker = new Worker('/vendor/perfetto/engine_bundle.js')
    this.worker.onerror = event => this.fail(new Error(event.message || 'Perfetto 原生引擎异常'))
    const channel = new MessageChannel()
    this.port = channel.port2
    this.port.onmessage = event => this.receive(event.data as Uint8Array)
    const memory64 = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 0]))
    const response = await fetch(`/vendor/perfetto/${memory64 ? 'trace_processor_memory64.wasm' : 'trace_processor.wasm'}`)
    if (!response.ok) throw new Error('Perfetto 运行文件缺失，请先执行 npm run setup:assets。')
    const wasmModule = await WebAssembly.compile(await response.arrayBuffer())
    this.worker.postMessage({ port: channel.port1, wasmModule }, [channel.port1])
  }

  append(bytes: Uint8Array): Promise<void> { return this.enqueue(async () => { await this.request(1, { appendTraceData: bytes }) }) }
  finish(): Promise<void> { return this.enqueue(async () => { await this.request(2, {}) }) }
  query(sql: string): Promise<SqlRow[]> { return this.enqueue(() => this.request(3, { queryArgs: { sqlQuery: sql } })) }
  close(): void { this.worker?.terminate(); this.port?.close(); this.fail(new Error('Perfetto 引擎已关闭')) }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
  private request(method: number, payload: Record<string, unknown>): Promise<SqlRow[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; reject(new Error('Perfetto 查询超时，请缩小范围或重新导入文件。')) }, 60000)
      this.pending = { method, query: new QueryRows(), resolve, reject, timer }
      this.port.postMessage(encodeRequest(this.sequence++, method, payload))
    })
  }
  private receive(bytes: Uint8Array): void {
    try {
      for (const message of this.frames.push(bytes)) {
        if (message.fatalError) throw new Error(message.fatalError)
        const pending = this.pending
        if (!pending || message.response !== pending.method) continue
        if (message.appendResult?.error) throw new Error(message.appendResult.error)
        const complete = pending.method !== 3 || (message.queryResult && pending.query.append(message.queryResult))
        if (complete) {
          clearTimeout(pending.timer)
          this.pending = null
          pending.resolve(pending.query.rows)
        }
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
  }
  private fail(error: Error): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }
}

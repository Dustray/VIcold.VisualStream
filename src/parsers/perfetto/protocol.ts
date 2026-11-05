import protobuf from 'protobufjs'
import type { SqlRow, SqlValue } from '../../core/types'

const schema = `syntax = "proto2";
message QueryArgs { optional string sql_query = 1; }
message AppendResult { optional string error = 2; }
message QueryResult {
  repeated string column_names = 1;
  optional string error = 2;
  message Batch {
    repeated uint32 cells = 1 [packed = true];
    repeated int64 varint_cells = 2 [packed = true];
    repeated double float64_cells = 3 [packed = true];
    repeated bytes blob_cells = 4;
    optional string string_cells = 5;
    optional bool is_last_batch = 6;
  }
  repeated Batch batch = 3;
}
message Rpc {
  optional int64 seq = 1;
  optional uint32 request = 2;
  optional uint32 response = 3;
  optional string fatal_error = 5;
  optional bytes append_trace_data = 101;
  optional QueryArgs query_args = 103;
  optional AppendResult append_result = 201;
  optional QueryResult query_result = 203;
}
message Stream { repeated Rpc msg = 1; }`

const root = protobuf.parse(schema).root
const rpcType = root.lookupType('Rpc')
const streamType = root.lookupType('Stream')

export interface RpcMessage {
  response?: number
  fatalError?: string
  appendResult?: { error?: string }
  queryResult?: {
    columnNames?: string[]
    error?: string
    batch?: { cells?: number[]; varintCells?: string[]; float64Cells?: number[]; blobCells?: Uint8Array[]; stringCells?: string; isLastBatch?: boolean }[]
  }
}

export function encodeRequest(sequence: number, method: number, payload: Record<string, unknown>): Uint8Array {
  return streamType.encode(streamType.create({ msg: [{ seq: sequence, request: method, ...payload }] })).finish()
}

export function decodeMessage(bytes: Uint8Array): RpcMessage {
  return rpcType.toObject(rpcType.decode(bytes), { longs: String }) as RpcMessage
}

export class RpcFrames {
  private pending = new Uint8Array(0)

  push(bytes: Uint8Array): RpcMessage[] {
    const buffer = new Uint8Array(this.pending.length + bytes.length)
    buffer.set(this.pending)
    buffer.set(bytes, this.pending.length)
    let offset = 0
    const messages: RpcMessage[] = []
    while (offset < buffer.length) {
      const frameStart = offset
      if (buffer[offset++] !== 10) throw new Error('Perfetto RPC 帧头异常')
      let size = 0
      let shift = 0
      let complete = false
      while (offset < buffer.length && shift < 35) {
        const byte = buffer[offset++]!
        size += (byte & 127) * 2 ** shift
        if (byte < 128) { complete = true; break }
        shift += 7
      }
      if (!complete || offset + size > buffer.length) { offset = frameStart; break }
      messages.push(decodeMessage(buffer.subarray(offset, offset + size)))
      offset += size
    }
    this.pending = buffer.slice(offset)
    return messages
  }
}

export class QueryRows {
  columns: string[] = []
  rows: SqlRow[] = []
  private cells: SqlValue[] = []

  append(result: NonNullable<RpcMessage['queryResult']>): boolean {
    if (result.error) throw new Error(result.error)
    if (result.columnNames?.length) this.columns = result.columnNames
    let last = false
    for (const batch of result.batch ?? []) {
      let integerIndex = 0
      let floatIndex = 0
      let stringIndex = 0
      let blobIndex = 0
      const strings = (batch.stringCells ?? '').split('\0')
      for (const type of batch.cells ?? []) {
        let value: SqlValue = null
        if (type === 2) value = BigInt(batch.varintCells?.[integerIndex++] ?? 0)
        else if (type === 3) value = batch.float64Cells?.[floatIndex++] ?? 0
        else if (type === 4) value = strings[stringIndex++] ?? ''
        else if (type === 5) value = batch.blobCells?.[blobIndex++] ?? new Uint8Array()
        this.cells.push(value)
        if (this.cells.length === this.columns.length && this.columns.length) {
          this.rows.push(Object.fromEntries(this.columns.map((column, index) => [column, this.cells[index]!])))
          this.cells = []
        }
      }
      if (batch.isLastBatch) last = true
    }
    if (last && this.cells.length) throw new Error('Perfetto 返回了不完整的数据行')
    return last
  }
}

import { describe, expect, it } from 'vitest'
import { QueryRows, RpcFrames, encodeRequest } from '../../src/parsers/perfetto/protocol'

describe('Perfetto wire protocol', () => {
  it('reassembles a stream split at each byte', () => {
    const bytes = encodeRequest(7, 3, { queryArgs: { sqlQuery: 'SELECT 1' } })
    const frames = new RpcFrames()
    const messages = [...bytes].flatMap(byte => frames.push(new Uint8Array([byte])))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ request: 3 })
  })

  it('preserves 64 bit timestamps and incomplete rows across batches', () => {
    const query = new QueryRows()
    expect(query.append({ columnNames: ['ts', 'name', 'value'], batch: [{ cells: [2, 4], varintCells: ['9007199254740993'], stringCells: 'task\0' }] })).toBe(false)
    expect(query.append({ batch: [{ cells: [3, 1, 4, 5], float64Cells: [1.25], stringCells: 'other\0', blobCells: [new Uint8Array([1, 2])], isLastBatch: true }] })).toBe(true)
    expect(query.rows).toEqual([{ ts: 9007199254740993n, name: 'task', value: 1.25 }, { ts: null, name: 'other', value: new Uint8Array([1, 2]) }])
  })

  it('rejects malformed responses instead of silently dropping cells', () => {
    expect(() => new QueryRows().append({ error: 'bad SQL' })).toThrow('bad SQL')
    expect(() => new QueryRows().append({ columnNames: ['a', 'b'], batch: [{ cells: [1], isLastBatch: true }] })).toThrow()
    expect(() => new RpcFrames().push(new Uint8Array([9]))).toThrow()
  })
})

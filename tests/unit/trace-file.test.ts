import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { probeTraceFile, streamTraceFile } from '../../src/parsers/perfetto/trace-file'

describe('Perfetto file input', () => {
  it('recognizes protobuf, JSON object and array traces, including gzip and a UTF-8 BOM', async () => {
    const inputs = [new Uint8Array([10, 2, 8, 1]), new TextEncoder().encode('\ufeff {"displayTimeUnit":"ms","traceEvents":[]}'), new TextEncoder().encode('[{"ph":"X","name":"event"}]')]
    for (const bytes of inputs) {
      expect(await probeTraceFile(new File([bytes], 'trace'))).toBe(true)
      expect(await probeTraceFile(new File([Uint8Array.from(gzipSync(bytes))], 'trace.gz'))).toBe(true)
    }
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('{"version":1,"computeModel":{}}'), new Uint8Array([31, 139, 0, 0])]) expect(await probeTraceFile(new File([bytes], 'unknown'))).toBe(false)
  })

  it('reads bounded chunks and retains the original SHA-256 fingerprint without buffering the whole file', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 37)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    const file = new File([bytes], 'large.json.gz')
    file.arrayBuffer = () => Promise.reject(new Error('whole-file reads are forbidden'))
    const lengths: number[] = []
    const offsets: number[] = []
    const hash = await streamTraceFile(file, async (part, loaded) => { lengths.push(part.length); offsets.push(loaded) })
    expect(lengths).toEqual([1024 * 1024, 1024 * 1024, 37])
    expect(offsets).toEqual([1024 * 1024, 2 * 1024 * 1024, bytes.length])
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('stops reading after a failed append and supports empty fingerprints', async () => {
    let calls = 0
    await expect(streamTraceFile(new File([new Uint8Array(3 * 1024 * 1024)], 'trace'), async () => { calls++; throw new Error('parse failed') })).rejects.toThrow('parse failed')
    expect(calls).toBe(1)
    expect(await streamTraceFile(new File([], 'empty'), async () => {})).toBe(createHash('sha256').digest('hex'))
  })
})

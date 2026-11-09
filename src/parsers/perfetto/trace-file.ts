import { sha256 } from '@noble/hashes/sha2.js'

export async function probeTraceFile(file: File): Promise<boolean> {
  const prefix = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
  const recognizable = (bytes: Uint8Array) => {
    if (bytes[0] === 10) return true
    const text = new TextDecoder().decode(bytes).trimStart()
    return text.startsWith('{') && /"traceEvents"\s*:\s*\[/.test(text) || text.startsWith('[') && /"ph"\s*:/.test(text)
  }
  if (prefix[0] !== 31 || prefix[1] !== 139) return recognizable(prefix)
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  try {
    const bytes = new Uint8Array(65536)
    let length = 0
    while (length < bytes.length) {
      const result = await reader.read()
      if (result.done) break
      const part = result.value.subarray(0, bytes.length - length)
      bytes.set(part, length)
      length += part.length
    }
    return recognizable(bytes.subarray(0, length))
  } catch { return false }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function streamTraceFile(file: File, append: (bytes: Uint8Array, loaded: number) => Promise<void>): Promise<string> {
  const hash = sha256.create()
  const chunkSize = 1024 * 1024
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer())
      hash.update(bytes)
      await append(bytes, Math.min(file.size, offset + bytes.length))
    }
    return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('')
  } finally { hash.destroy() }
}

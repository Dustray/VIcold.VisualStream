import type { ProjectSnapshot } from './types'

export function parseProject(text: string): ProjectSnapshot {
  const value = JSON.parse(text) as ProjectSnapshot
  if (value.version !== 1 || value.computeModel?.id !== 'megakernel' || value.computeModel.version !== '1') throw new Error('不支持的项目版本或计算模式')
  if (!Array.isArray(value.sources) || value.sources.length > 16 || !value.sources.length) throw new Error('项目来源列表无效')
  const timestamp = (time: unknown): time is string => typeof time === 'string' && /^-?\d{1,19}$/.test(time) && BigInt(time) >= -(1n << 63n) && BigInt(time) < (1n << 63n)
  if (!timestamp(value.time) || !timestamp(value.viewport?.start) || !timestamp(value.viewport?.end) || BigInt(value.viewport.end) <= BigInt(value.viewport.start)) throw new Error('项目时间范围无效')
  if (!Number.isFinite(value.speed) || value.speed < 0.000001 || value.speed > 1000) throw new Error('项目播放速度无效')
  for (const source of value.sources) if (source.parser?.id !== 'perfetto' || source.parser.version !== '1' || !/^[a-f0-9]{64}$/.test(source.fingerprint) || typeof source.filename !== 'string' || !timestamp(source.offset)) throw new Error('项目文件引用或解析器配置无效')
  if (value.selection && (!timestamp(value.selection.start) || !timestamp(value.selection.end) || BigInt(value.selection.end) <= BigInt(value.selection.start))) throw new Error('项目选区无效')
  if (!Array.isArray(value.bookmarks) || value.bookmarks.length > 1000 || value.bookmarks.some(bookmark => typeof bookmark.id !== 'string' || typeof bookmark.label !== 'string' || !timestamp(bookmark.time))) throw new Error('项目书签无效')
  if (typeof value.loop !== 'boolean') throw new Error('项目循环配置无效')
  return value
}

export async function persistProject(snapshot: ProjectSnapshot): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('visualstream', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put(snapshot, 'last')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  })
}

export async function readLastProject(): Promise<ProjectSnapshot | null> {
  return new Promise(resolve => {
    const request = indexedDB.open('visualstream', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onerror = () => resolve(null)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('projects', 'readonly')
      const record = transaction.objectStore('projects').get('last')
      record.onsuccess = () => { const result = record.result as ProjectSnapshot | undefined; database.close(); resolve(result ?? null) }
      record.onerror = () => { database.close(); resolve(null) }
    }
  })
}

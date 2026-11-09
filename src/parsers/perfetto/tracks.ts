import type { RawTrack, SqlRow } from '../../core/types'

export function buildTrackHierarchy(rows: SqlRow[]): RawTrack[] {
  const uuidToTrack = new Map(rows.filter(row => row.uuid != null).map(row => [String(row.uuid), Number(row.id)]))
  const processes = new Map<number, RawTrack>()
  const tracks = rows.map(row => {
    let parentId = row.parent_id != null ? Number(row.parent_id) : row.parent_uuid != null ? uuidToTrack.get(String(row.parent_uuid)) ?? null : null
    if (parentId === null && row.upid != null) {
      parentId = -Number(row.upid) - 1
      if (!processes.has(parentId)) processes.set(parentId, { id: parentId, name: String(row.process_name || `进程 ${row.pid}`), subtitle: `PID ${row.pid}`, parentId: null, virtual: true })
    }
    const name = String(row.name || row.thread_name || (row.tid != null ? `线程 ${row.tid}` : row.type === 'legacy_chrome_global_instants' ? '全局瞬时事件' : `轨道 ${row.id}`))
    return { id: Number(row.id), name, parentId, maxDepth: Math.max(0, Number(row.max_depth ?? 0)) }
  })
  return [...processes.values(), ...tracks]
}

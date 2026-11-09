import type { RawTrack, TimelineRow } from '../core/types'

export function trackRows(sourceId: string, tracks: RawTrack[], collapsed: ReadonlySet<string>): TimelineRow[] {
  const byId = new Map(tracks.map(track => [track.id, track]))
  const children = new Map<number, RawTrack[]>()
  const roots: RawTrack[] = []
  for (const track of tracks) {
    if (track.parentId === null || track.parentId === track.id || !byId.has(track.parentId)) roots.push(track)
    else {
      const siblings = children.get(track.parentId) ?? []
      siblings.push(track)
      children.set(track.parentId, siblings)
    }
  }
  const rows: TimelineRow[] = []
  const visited = new Set<number>()
  function append(root: RawTrack): void {
    const pending: { track: RawTrack; depth: number; summary?: TimelineRow }[] = [{ track: root, depth: 0 }]
    while (pending.length) {
      const { track, depth, summary } = pending.pop()!
      if (visited.has(track.id)) continue
      visited.add(track.id)
      const id = `${sourceId}/track/${track.id}`
      const descendants = children.get(track.id) ?? []
      let owner = summary
      if (owner) { if (!track.virtual) owner.trackIds.push(track.id) }
      else {
        const row: TimelineRow = { id, kind: 'track', label: track.name || `轨道 ${track.id}`, subtitle: track.subtitle ?? `#${track.id}`, sourceId, treeDepth: depth, hasChildren: descendants.length > 0 || (track.maxDepth ?? 0) > 0, collapsed: collapsed.has(id), trackIds: track.virtual ? [] : [track.id], eventDepth: collapsed.has(id) ? undefined : track.maxDepth !== undefined ? 0 : undefined }
        rows.push(row)
        if (row.collapsed) owner = row
        else for (let eventDepth = 1; eventDepth <= (track.maxDepth ?? 0); eventDepth++) rows.push({ id: `${id}/depth/${eventDepth}`, kind: 'track', label: `嵌套 ${eventDepth}`, subtitle: `#${track.id}`, sourceId, treeDepth: depth + 1, trackIds: [track.id], eventDepth })
      }
      for (let index = descendants.length - 1; index >= 0; index--) pending.push({ track: descendants[index]!, depth: depth + 1, summary: owner })
    }
  }
  for (const root of roots) append(root)
  for (const track of tracks) if (!visited.has(track.id)) append(track)
  return rows
}

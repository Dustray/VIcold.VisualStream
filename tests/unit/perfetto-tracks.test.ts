import { describe, expect, it } from 'vitest'
import { buildTrackHierarchy } from '../../src/parsers/perfetto/tracks'
import { trackRows } from '../../src/engine/track-tree'
import type { SqlRow } from '../../src/core/types'

describe('Perfetto process and nested tracks', () => {
  it('groups threads by process identity and retains thread names, numeric IDs and nesting', () => {
    const tracks = buildTrackHierarchy([
      { id: 0n, name: null, tid: 120n, thread_name: 'CPU scheduler', upid: 1n, pid: 100n, process_name: 'TP0', max_depth: 2n },
      { id: 1n, name: null, tid: 121n, thread_name: 'stream 7', upid: 1n, pid: 100n, process_name: 'TP0', max_depth: 0n },
      { id: 2n, name: null, tid: 120n, thread_name: null, upid: 2n, pid: 101n, process_name: 'TP0', max_depth: 1n },
    ])
    expect(tracks.filter(track => track.virtual)).toHaveLength(2)
    expect(tracks.find(track => track.id === 0)).toMatchObject({ parentId: -2, name: 'CPU scheduler', maxDepth: 2 })
    expect(tracks.find(track => track.id === 2)).toMatchObject({ parentId: -3, name: '线程 120' })
    const rows = trackRows('source', tracks, new Set())
    expect(rows.filter(row => row.trackIds.includes(0)).map(row => row.eventDepth)).toEqual([0, 1, 2])
    expect(rows.find(row => row.id === 'source/track/-2')?.trackIds).toEqual([])
    const folded = trackRows('source', tracks, new Set(['source/track/-2', 'source/track/0', 'source/track/-3']))
    expect(folded.map(row => row.trackIds)).toEqual([[0, 1], [2]])
  })

  it('preserves protobuf parent UUIDs and explicit names before adding process grouping', () => {
    const rows: SqlRow[] = [
      { id: 0n, name: 'block_0', uuid: 42n, parent_id: null, parent_uuid: null, max_depth: 0n },
      { id: 1n, name: 'group_0', uuid: 43n, parent_id: null, parent_uuid: 42n, max_depth: 0n },
      { id: 2n, name: 'named', parent_id: 1n, thread_name: 'fallback', upid: 1n, pid: 100n, max_depth: 0n },
      { id: 3n, name: null, type: 'legacy_chrome_global_instants', max_depth: 0n },
    ]
    const tracks = buildTrackHierarchy(rows)
    expect(tracks.map(track => track.parentId)).toEqual([null, 0, 1, null])
    expect(tracks.map(track => track.name)).toEqual(['block_0', 'group_0', 'named', '全局瞬时事件'])
  })
})

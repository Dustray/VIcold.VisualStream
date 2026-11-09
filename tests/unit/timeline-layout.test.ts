import { describe, expect, it } from 'vitest'
import type { TimelineRow } from '../../src/core/types'
import { TimelineLayout } from '../../src/engine/timeline-layout'

const rows: TimelineRow[] = [
  { id: 'source', sourceId: 'trace', kind: 'source', label: 'trace', subtitle: '', trackIds: [] },
  { id: 'track', sourceId: 'trace', kind: 'track', label: 'CPU', subtitle: '', trackIds: [1], eventDepth: 0 },
  { id: 'nested1', sourceId: 'trace', kind: 'track', label: '嵌套 1', subtitle: '', trackIds: [1], eventDepth: 1 },
  { id: 'nested2', sourceId: 'trace', kind: 'track', label: '嵌套 2', subtitle: '', trackIds: [1], eventDepth: 2 },
  { id: 'other', sourceId: 'trace', kind: 'track', label: 'GPU', subtitle: '', trackIds: [2] },
]

describe('timeline row layout', () => {
  it('compacts only nested event lanes and locates rows at their boundaries', () => {
    const layout = new TimelineLayout(rows, true)
    expect(rows.map((_, index) => layout.height(index))).toEqual([29, 29, 19, 19, 29])
    expect(rows.map((_, index) => layout.top(index))).toEqual([0, 29, 58, 77, 96])
    expect(layout.totalHeight).toBe(125)
    expect([-10, 0, 28, 29, 57, 58, 76, 77, 95, 96, 1000].map(position => layout.indexAt(position))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('keeps the existing uniform layout for Megakernel and handles empty timelines', () => {
    const layout = new TimelineLayout(rows)
    expect(rows.map((_, index) => layout.height(index))).toEqual([29, 29, 29, 29, 29])
    expect(layout.totalHeight).toBe(145)
    const empty = new TimelineLayout([], true)
    expect(empty.totalHeight).toBe(0)
    expect(empty.indexAt(0)).toBe(-1)
  })
})

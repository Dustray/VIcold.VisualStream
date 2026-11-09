import type { TimelineRow } from '../core/types'

export class TimelineLayout {
  private readonly offsets: number[] = [0]
  private readonly heights: number[]
  readonly totalHeight: number

  constructor(rows: readonly TimelineRow[], compactNested = false) {
    this.heights = rows.map(row => compactNested && row.kind === 'track' && (row.eventDepth ?? 0) > 0 ? 19 : 29)
    for (const height of this.heights) this.offsets.push(this.offsets[this.offsets.length - 1]! + height)
    this.totalHeight = this.offsets[this.offsets.length - 1]!
  }

  top(index: number): number { return this.offsets[index] ?? 0 }
  height(index: number): number { return this.heights[index] ?? 29 }
  indexAt(position: number): number {
    if (!this.heights.length) return -1
    let lower = 0
    let upper = this.heights.length
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2)
      if (this.offsets[middle + 1]! <= position) lower = middle + 1
      else upper = middle
    }
    return Math.min(lower, this.heights.length - 1)
  }
}

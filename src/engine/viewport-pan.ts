import { duration, fitRange } from '../core/time'
import type { TimeRange } from '../core/types'

interface FrameScheduler {
  now(): number
  request(callback: (time: number) => void): number
  cancel(frame: number): void
}

export class ViewportPan {
  private target: bigint | null = null
  private lastWall = 0
  private frame: number | null = null

  constructor(
    private readonly read: () => TimeRange,
    private readonly bounds: () => TimeRange,
    private readonly update: (range: TimeRange) => void,
    private readonly activeChanged: (active: boolean) => void,
    private readonly scheduler: FrameScheduler = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: frame => cancelAnimationFrame(frame) },
  ) {}

  pan(delta: bigint): void {
    if (!delta) return
    const range = this.read()
    const span = duration(range)
    const start = (this.target ?? range.start) + delta
    this.target = fitRange({ start, end: start + span }, this.bounds()).start
    if (this.target === range.start) { this.cancel(); return }
    if (this.frame !== null) return
    this.lastWall = this.scheduler.now()
    this.activeChanged(true)
    this.frame = this.scheduler.request(time => this.advance(time))
  }

  cancel(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.target = null
    this.activeChanged(false)
  }

  private advance(wall: number): void {
    this.frame = null
    if (this.target === null) return
    const range = this.read()
    const span = duration(range)
    this.target = fitRange({ start: this.target, end: this.target + span }, this.bounds()).start
    const elapsed = Math.max(0, wall - this.lastWall)
    this.lastWall = wall
    const distance = this.target - range.start
    const threshold = span / 10000n || 1n
    const next = (distance < 0n ? -distance : distance) <= threshold ? this.target : range.start + BigInt(Math.round(Number(distance) * (1 - Math.exp(-elapsed / 40))))
    this.update({ start: next, end: next + span })
    if (this.target === null || next === this.target) { this.cancel(); return }
    this.frame = this.scheduler.request(time => this.advance(time))
  }
}

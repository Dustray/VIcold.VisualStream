import { duration, fitRange } from '../core/time'
import type { TimeRange } from '../core/types'

interface FrameScheduler {
  now(): number
  request(callback: (time: number) => void): number
  cancel(frame: number): void
}

export class ViewportZoom {
  private targetSpan: bigint | null = null
  private anchor = 0n
  private ratio = 0.5
  private lastWall = 0
  private frame: number | null = null

  constructor(
    private readonly read: () => TimeRange,
    private readonly bounds: () => TimeRange,
    private readonly update: (range: TimeRange) => void,
    private readonly activeChanged: (active: boolean) => void,
    private readonly scheduler: FrameScheduler = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: frame => cancelAnimationFrame(frame) },
  ) {}

  zoom(factor: number, ratio = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(ratio)) return
    const range = this.read()
    const full = duration(this.bounds())
    if (full <= 0n) return
    const minimum = full < 100n ? full : 100n
    const scaled = Number(this.targetSpan ?? duration(range)) * factor
    const target = scaled >= Number(full) ? full : BigInt(Math.max(Number(minimum), Math.round(scaled)))
    if (target === duration(range)) { this.cancel(); return }
    this.ratio = Math.max(0, Math.min(1, ratio))
    this.anchor = range.start + BigInt(Math.round(Number(duration(range)) * this.ratio))
    this.targetSpan = target
    if (this.frame !== null) return
    this.lastWall = this.scheduler.now()
    this.activeChanged(true)
    this.frame = this.scheduler.request(time => this.advance(time))
  }

  cancel(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.targetSpan = null
    this.activeChanged(false)
  }

  private advance(wall: number): void {
    this.frame = null
    if (this.targetSpan === null) return
    const span = duration(this.read())
    const elapsed = Math.max(0, wall - this.lastWall)
    this.lastWall = wall
    const distance = Math.log(Number(this.targetSpan) / Number(span))
    const difference = span > this.targetSpan ? span - this.targetSpan : this.targetSpan - span
    const next = Math.abs(distance) < 0.0005 || difference <= 1n ? this.targetSpan : BigInt(Math.round(Number(span) * Math.exp(distance * (1 - Math.exp(-elapsed / 45)))))
    const start = this.anchor - BigInt(Math.round(Number(next) * this.ratio))
    this.update(fitRange({ start, end: start + next }, this.bounds()))
    if (next === this.targetSpan) { this.cancel(); return }
    this.frame = this.scheduler.request(time => this.advance(time))
  }
}

import { clampTime, duration } from '../core/time'
import type { TimeRange } from '../core/types'

export interface ClockSnapshot { time: bigint; playing: boolean; buffering: boolean; speed: number }
export class PlaybackClock {
  private range: TimeRange = { start: 0n, end: 1n }
  private loopRange: TimeRange | null = null
  private anchorTime = 0n
  private anchorWall = 0
  private currentTime = 0n
  private running = false
  private waiting = false
  private rate = 1
  private frame: number | null = null
  private readonly listeners = new Set<(value: ClockSnapshot) => void>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  subscribe(listener: (value: ClockSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): ClockSnapshot { return { time: this.currentTime, playing: this.running, buffering: this.waiting, speed: this.rate } }
  configure(range: TimeRange): void { this.pause(); this.range = range; this.loopRange = null; this.seek(range.start) }
  seek(time: bigint): void { this.currentTime = clampTime(time, this.range); this.reanchor(); this.emit() }
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0.000001 || speed > 1000) throw new Error('播放速度应在 0.000001× 到 1000× 之间')
    this.advance(this.now())
    this.rate = speed
    this.reanchor()
    this.emit()
  }
  setLoop(range: TimeRange | null): void { this.loopRange = range && range.end > range.start ? range : null }
  setBuffering(waiting: boolean): void {
    if (waiting === this.waiting) return
    this.advance(this.now())
    this.waiting = waiting
    this.reanchor()
    this.emit()
  }
  play(): void {
    if (this.currentTime >= this.range.end) this.seek(this.loopRange?.start ?? this.range.start)
    this.running = true
    this.reanchor()
    this.emit()
    this.schedule()
  }
  pause(): void {
    this.advance(this.now())
    this.running = false
    if (this.frame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame)
    this.frame = null
    this.emit()
  }
  toggle(): void { if (this.running) this.pause(); else this.play() }
  dispose(): void { this.pause(); this.listeners.clear() }

  advance(wall: number): void {
    if (!this.running || this.waiting) return
    const elapsed = Math.max(0, wall - this.anchorWall)
    let time = this.anchorTime + BigInt(Math.round(elapsed * this.rate * 1e6))
    if (this.loopRange && time >= this.loopRange.end) {
      time = this.loopRange.start + (time - this.loopRange.start) % duration(this.loopRange)
      this.anchorTime = time
      this.anchorWall = wall
    }
    if (time >= this.range.end) { time = this.range.end; this.running = false }
    this.currentTime = clampTime(time, this.range)
    this.emit()
  }

  private reanchor(): void { this.anchorTime = this.currentTime; this.anchorWall = this.now() }
  private emit(): void { const value = this.snapshot(); for (const listener of this.listeners) listener(value) }
  private schedule(): void {
    if (this.frame !== null || typeof requestAnimationFrame === 'undefined') return
    this.frame = requestAnimationFrame(() => { this.frame = null; this.advance(this.now()); if (this.running) this.schedule() })
  }
}

interface FrameScheduler {
  now(): number
  request(callback: (time: number) => void): number
  cancel(frame: number): void
}

export class ScrollMotion {
  private target: number | null = null
  private frame: number | null = null
  private lastWall = 0
  private position = 0

  constructor(
    private readonly read: () => number,
    private readonly maximum: () => number,
    private readonly update: (position: number) => void,
    private readonly scheduler: FrameScheduler = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: frame => cancelAnimationFrame(frame) },
  ) {}

  move(delta: number): void {
    if (!Number.isFinite(delta) || !delta) return
    this.target = Math.max(0, Math.min(Math.max(0, this.maximum()), (this.target ?? this.read()) + delta))
    if (this.frame !== null) return
    this.position = this.read()
    this.lastWall = this.scheduler.now()
    this.frame = this.scheduler.request(time => this.advance(time))
  }

  cancel(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.target = null
  }

  private advance(wall: number): void {
    this.frame = null
    if (this.target === null) return
    this.target = Math.max(0, Math.min(Math.max(0, this.maximum()), this.target))
    const current = this.position
    const elapsed = Math.max(0, wall - this.lastWall)
    this.lastWall = wall
    const distance = this.target - current
    const next = Math.abs(distance) < 0.75 ? this.target : current + distance * (1 - Math.exp(-elapsed / 40))
    this.position = next
    this.update(next)
    if (this.target === null || next === this.target) { this.cancel(); return }
    this.frame = this.scheduler.request(time => this.advance(time))
  }
}

export type NavigationKey = 'w' | 'a' | 's' | 'd'

interface FrameScheduler {
  now(): number
  request(callback: (time: number) => void): number
  cancel(frame: number): void
}

export class KeyboardNavigation {
  private readonly held = new Set<NavigationKey>()
  private current: NavigationKey | null = null
  private started = 0
  private lastWall = 0
  private frame: number | null = null

  constructor(
    private readonly step: (key: NavigationKey, elapsed: number | null) => void,
    private readonly scheduler: FrameScheduler = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: frame => cancelAnimationFrame(frame) },
  ) {}

  get active(): boolean { return this.current !== null }

  press(key: NavigationKey, repeat = false): void {
    if (repeat || this.held.has(key)) return
    this.held.add(key)
    this.current = key
    this.started = this.lastWall = this.scheduler.now()
    this.step(key, null)
    this.schedule()
  }

  release(key: NavigationKey): void {
    this.held.delete(key)
    if (this.current !== key) return
    const previous = [...this.held].at(-1)
    if (!previous) { this.cancel(); return }
    this.current = previous
    this.lastWall = this.scheduler.now()
    this.started = this.lastWall - 80
  }

  cancel(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.current = null
    this.held.clear()
  }

  private schedule(): void {
    if (this.current !== null && this.frame === null) this.frame = this.scheduler.request(wall => this.advance(wall))
  }

  private advance(wall: number): void {
    this.frame = null
    if (this.current === null) return
    const elapsed = Math.min(50, Math.max(0, wall - Math.max(this.lastWall, this.started + 80)))
    this.lastWall = wall
    if (elapsed > 0) this.step(this.current, elapsed)
    this.schedule()
  }
}

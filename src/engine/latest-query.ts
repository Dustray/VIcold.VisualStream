export class LatestQuery<Result> {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: { version: number; query: () => Promise<Result> } | null = null
  private running = false
  private version = 0

  constructor(private readonly resolve: (result: Result) => void, private readonly reject: (error: unknown) => void) {}

  schedule(query: () => Promise<Result>, delay = 150): void {
    this.cancel()
    this.pending = { version: this.version, query }
    this.timer = setTimeout(() => { this.timer = null; void this.run() }, delay)
  }

  cancel(): void {
    this.version++
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private async run(): Promise<void> {
    if (this.running || this.timer !== null || !this.pending) return
    const request = this.pending
    this.pending = null
    this.running = true
    try {
      const result = await request.query()
      if (request.version === this.version) this.resolve(result)
    } catch (error) {
      if (request.version === this.version) this.reject(error)
    } finally {
      this.running = false
      void this.run()
    }
  }
}

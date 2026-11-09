import { expect, test } from '@playwright/test'

type ZoomState = {
  queries: { method: string; start: string; end: string }[]
  active: number
  delay: number
  capture: boolean
  paints: { details: number; coarseCenter: number }[]
}

test('rapid wheel zoom fetches its destination early and keeps details across cache boundaries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const state: ZoomState = { queries: [], active: 0, delay: 0, capture: false, paints: [] }
    ;(window as typeof window & { zoomState: ZoomState }).zoomState = state
    const clearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if (state.capture && this.canvas.classList.contains('timeline-background')) state.paints.push({ details: 0, coarseCenter: 0 })
      clearRect.apply(this, args)
    }
    const roundRect = CanvasRenderingContext2D.prototype.roundRect
    CanvasRenderingContext2D.prototype.roundRect = function(...args) {
      if (state.capture && this.canvas.classList.contains('timeline-background')) state.paints.at(-1)!.details++
      roundRect.apply(this, args)
    }
    const fillRect = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function(horizontal, vertical, width, height) {
      if (state.capture && this.canvas.classList.contains('timeline-background') && horizontal >= 170 && vertical > 31 && height === 19) {
        const plot = this.canvas.clientWidth - 183
        if (horizontal < 170 + plot * 0.7 && horizontal + width > 170 + plot * 0.3) state.paints.at(-1)!.coarseCenter++
      }
      fillRect.call(this, horizontal, vertical, width, height)
    }
    window.Worker = new Proxy(window.Worker, {
      construct(WorkerClass, args) {
        const worker = Reflect.construct(WorkerClass, args) as Worker
        const pending = new Set<number>()
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (message: { id: number; method: string; payload?: { start: bigint; end: bigint; trackIds?: number[] } }, options?: StructuredSerializeOptions | Transferable[]) => {
          if (['events', 'density'].includes(message.method) && message.payload?.trackIds) {
            state.queries.push({ method: message.method, start: message.payload.start.toString(), end: message.payload.end.toString() })
            pending.add(message.id)
            state.active++
          }
          if (Array.isArray(options)) send(message, options)
          else send(message, options)
        }
        worker.addEventListener('message', event => {
          if (!pending.delete(event.data.id)) return
          if (!state.delay) { state.active--; return }
          event.stopImmediatePropagation()
          setTimeout(() => { state.active--; worker.dispatchEvent(new MessageEvent('message', { data: event.data })) }, state.delay)
        })
        return worker
      },
    })
  })
  await page.goto('/')
  const traceEvents = Array.from({ length: 120000 }, (_, index) => ({ ph: 'X', pid: 1, tid: 1, name: `detail_${index % 8}`, ts: index * 200, dur: 150 }))
  await page.getByTestId('trace-input').setInputFiles({ name: 'wheel.perfetto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ traceEvents })) })
  const overlay = page.locator('.timeline-overlay')
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(overlay).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.timeline-mode')).toHaveText('密度聚合')
  const whole = await page.evaluate(() => (window as typeof window & { zoomState: ZoomState }).zoomState.queries[0]!)
  await overlay.evaluate(element => {
    const state = (window as typeof window & { zoomState: ZoomState }).zoomState
    state.queries = []
    const box = element.getBoundingClientRect()
    for (let index = 0; index < 8; index++) element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -500, clientX: box.x + 170 + (box.width - 183) / 2, clientY: box.y + 15, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.timeline-mode')).toHaveText('原始区间')
  await expect(overlay).toHaveAttribute('aria-busy', 'false')
  await page.waitForTimeout(400)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { zoomState: ZoomState }).zoomState.active)).toBe(0)
  const first = await page.evaluate(() => (window as typeof window & { zoomState: ZoomState }).zoomState.queries[0]!)
  expect(first.method).toBe('events')
  expect(BigInt(first.end) - BigInt(first.start)).toBeLessThan((BigInt(whole.end) - BigInt(whole.start)) / 1000n)

  const paints = await overlay.evaluate(async element => {
    const state = (window as typeof window & { zoomState: ZoomState }).zoomState
    state.delay = 800
    state.capture = true
    const box = element.getBoundingClientRect()
    element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 500, clientX: box.x + 170 + (box.width - 183) / 2, clientY: box.y + 15, bubbles: true, cancelable: true }))
    for (let index = 0; index < 22; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    state.capture = false
    state.delay = 0
    return state.paints
  })
  expect(paints.length).toBeGreaterThan(12)
  expect(paints.every(paint => paint.details > 10)).toBe(true)
  expect(paints.every(paint => paint.coarseCenter === 0)).toBe(true)
  await expect(overlay).toHaveAttribute('aria-busy', 'false')
  expect(errors).toEqual([])
})

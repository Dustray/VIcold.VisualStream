import { expect, test } from '@playwright/test'

type PanState = { capture: boolean; paints: string[][]; queries: number }

test('A/D panning keeps overlapping density operators and their labels stable between queries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const state: PanState = { capture: false, paints: [], queries: 0 }
    ;(window as typeof window & { panState: PanState }).panState = state
    const clearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if (state.capture && this.canvas.classList.contains('timeline-background')) state.paints.push([])
      clearRect.apply(this, args)
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function(text, horizontal, vertical, maximumWidth) {
      if (state.capture && this.canvas.classList.contains('timeline-background') && text.startsWith('steady_')) state.paints.at(-1)!.push(text)
      if (maximumWidth === undefined) fillText.call(this, text, horizontal, vertical)
      else fillText.call(this, text, horizontal, vertical, maximumWidth)
    }
    window.Worker = new Proxy(window.Worker, {
      construct(WorkerClass, args) {
        const worker = Reflect.construct(WorkerClass, args) as Worker
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (message: { method: string; payload?: { trackIds?: number[] } }, options?: StructuredSerializeOptions | Transferable[]) => {
          if (['events', 'density'].includes(message.method) && message.payload?.trackIds) state.queries++
          if (Array.isArray(options)) send(message, options)
          else send(message, options)
        }
        return worker
      },
    })
  })
  await page.goto('/')
  const traceEvents = [
    { ph: 'X', pid: 1, tid: 1, name: 'begin', ts: 0, dur: 1 },
    { ph: 'X', pid: 1, tid: 1, name: 'steady_parent', ts: 450000, dur: 200000 },
    { ph: 'X', pid: 1, tid: 1, name: 'steady_child', ts: 451000, dur: 100000 },
    { ph: 'X', pid: 1, tid: 1, name: 'end', ts: 999999, dur: 1 },
  ]
  await page.getByTestId('trace-input').setInputFiles({ name: 'pan.perfetto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ traceEvents })) })
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await page.getByRole('button', { name: '全部收起轨道', exact: true }).click()
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.timeline-mode')).toHaveText('密度聚合')
  await page.waitForTimeout(650)
  const before = await page.evaluate(() => {
    const state = (window as typeof window & { panState: PanState }).panState
    state.capture = true
    return state.queries
  })
  for (const key of ['d', 'a']) {
    await page.keyboard.down(key)
    await page.evaluate(async () => {
      for (let index = 0; index < 18; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    await page.keyboard.up(key)
  }
  const state = await page.evaluate(() => (window as typeof window & { panState: PanState }).panState)
  expect(state.queries).toBe(before)
  expect(state.paints.length).toBeGreaterThan(25)
  expect(state.paints.every(labels => labels.filter(label => label === 'steady_child').length === 1)).toBe(true)
  expect(state.paints.every(labels => labels.filter(label => label === 'steady_parent').length === 1)).toBe(true)
  expect(errors).toEqual([])
})

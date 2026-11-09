import { expect, test } from '@playwright/test'

type LongEventState = { capture: boolean; labels: string[][] }

test('zooming preserves one continuous long profiler event across cached density and raw ranges', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const state: LongEventState = { capture: false, labels: [] }
    ;(window as typeof window & { longEventState: LongEventState }).longEventState = state
    const clearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if (state.capture && this.canvas.classList.contains('timeline-background')) state.labels.push([])
      clearRect.apply(this, args)
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function(text, horizontal, vertical, maximumWidth) {
      if (state.capture && this.canvas.classList.contains('timeline-background') && text.startsWith('PyTorch')) state.labels.at(-1)!.push(text)
      if (maximumWidth === undefined) fillText.call(this, text, horizontal, vertical)
      else fillText.call(this, text, horizontal, vertical, maximumWidth)
    }
  })
  await page.goto('/')
  const traceEvents = [
    { ph: 'X', pid: 1, tid: 1, name: 'PyTorch Profiler (0)', ts: 0, dur: 24000000 },
    ...Array.from({ length: 4000 }, (_, index) => ({ ph: 'X', pid: 1, tid: 1, name: `child_${index % 8}`, ts: index * 6000 + 1000, dur: 4000 })),
  ]
  await page.getByTestId('trace-input').setInputFiles({ name: 'long-event.perfetto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ traceEvents })) })
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  const overlay = page.locator('.timeline-overlay')
  await expect(overlay).toHaveAttribute('aria-busy', 'false')
  await page.waitForTimeout(500)
  await page.evaluate(() => { (window as typeof window & { longEventState: LongEventState }).longEventState.capture = true })
  for (const [deltaY, ratio] of [[-500, 0.35], [-500, 0.6], [400, 0.4], [500, 0.6], [-500, 0.7], [500, 0.3]]) {
    await overlay.evaluate((element, point) => {
      const box = element.getBoundingClientRect()
      element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: point.deltaY, clientX: box.x + 170 + (box.width - 183) * point.ratio, clientY: box.y + 15, bubbles: true, cancelable: true }))
    }, { deltaY: deltaY!, ratio: ratio! })
    await expect(overlay).toHaveAttribute('aria-busy', 'false')
    await page.waitForTimeout(400)
  }
  const labels = await page.evaluate(() => (window as typeof window & { longEventState: LongEventState }).longEventState.labels)
  expect(labels.length).toBeGreaterThan(30)
  expect(labels.filter(frame => frame.length !== 1).slice(0, 5)).toEqual([])
  expect(errors).toEqual([])
})

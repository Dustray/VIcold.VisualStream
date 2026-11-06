import { expect, test, type Page } from '@playwright/test'
import { openSettings, openWorkspace } from './workspace'

type Counters = { cuCells: number; cuMeasurements: number; cuResizes: number; overviewFills: number; overviewBlits: number }
type StatisticsState = { delay: number; requests: Record<string, { start: string; end: string }[]>; active: Record<string, number>; maximum: Record<string, number> }

async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async count => {
    for (let index = 0; index < count; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }, count)
}

test('CU selection repaints only changed cells and playback reuses the overview chart', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const counters: Counters = { cuCells: 0, cuMeasurements: 0, cuResizes: 0, overviewFills: 0, overviewBlits: 0 }
    ;(window as unknown as { renderCounts: Counters }).renderCounts = counters
    const originalRoundRect = CanvasRenderingContext2D.prototype.roundRect
    CanvasRenderingContext2D.prototype.roundRect = function(...args) {
      if (this.canvas.classList.contains('cu-grid-canvas')) counters.cuCells++
      originalRoundRect.apply(this, args)
    }
    const originalMeasure = CanvasRenderingContext2D.prototype.measureText
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      if (this.canvas.classList.contains('cu-grid-canvas')) counters.cuMeasurements++
      return originalMeasure.call(this, text)
    }
    for (const dimension of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, { ...descriptor, set(value) {
        if (this.classList.contains('cu-grid-canvas')) counters.cuResizes++
        descriptor.set!.call(this, value)
      } })
    }
    const originalFill = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function(...args) {
      if (this.canvas.classList.contains('timeline-overview') || (!this.canvas.isConnected && this.canvas.height === Math.round(34 * Math.min(devicePixelRatio, 2)))) counters.overviewFills++
      originalFill.apply(this, args)
    }
    const originalImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function(image: CanvasImageSource, ...coordinates: number[]) {
      if (this.canvas.classList.contains('timeline-overview')) counters.overviewBlits++
      Reflect.apply(originalImage, this, [image, ...coordinates])
    }
  })
  await openWorkspace(page)
  await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
  await expect(page.locator('.timeline-overview')).toHaveAttribute('aria-busy', 'false')
  await frames(page)
  const original = await page.locator('.cu-grid-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await page.evaluate(() => Object.assign((window as unknown as { renderCounts: Counters }).renderCounts, { cuCells: 0, cuMeasurements: 0, cuResizes: 0, overviewFills: 0, overviewBlits: 0 }))
  await page.locator('.cu-grid-canvas').click({ position: { x: 25, y: 20 } })
  await frames(page)
  await expect(page.locator('.inspector')).toContainText('CU 0')
  await page.locator('.cu-grid-canvas').click({ position: { x: 25, y: 20 } })
  await frames(page)
  expect(await page.locator('.cu-grid-canvas').evaluate((canvas: HTMLCanvasElement, original) => canvas.toDataURL() === original, original)).toBe(true)
  const selection = await page.evaluate(() => ({ ...(window as unknown as { renderCounts: Counters }).renderCounts }))
  expect(selection.cuCells).toBe(2)
  expect(selection.cuResizes).toBe(0)
  expect(selection.cuMeasurements).toBe(0)

  await page.getByRole('combobox', { name: '全局概览指标' }).selectOption('density')
  await frames(page)
  await page.evaluate(() => Object.assign((window as unknown as { renderCounts: Counters }).renderCounts, { overviewFills: 0, overviewBlits: 0, cuResizes: 0 }))
  await page.getByRole('button', { name: '播放重放', exact: true }).click()
  const before = await page.getByTestId('playback-time').innerText()
  await frames(page, 40)
  await expect(page.getByTestId('playback-time')).not.toHaveText(before)
  await expect.poll(() => page.evaluate(() => (window as unknown as { renderCounts: Counters }).renderCounts.overviewBlits)).toBeGreaterThanOrEqual(30)
  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  await frames(page)
  const playback = await page.evaluate(() => ({ ...(window as unknown as { renderCounts: Counters }).renderCounts }))
  expect(playback.overviewBlits).toBeGreaterThanOrEqual(30)
  expect(playback.overviewFills).toBe(playback.overviewBlits * 4)
  expect(playback.cuResizes).toBe(0)
  console.log('render counters', { selection, playback })

  await page.evaluate(() => Object.assign((window as unknown as { renderCounts: Counters }).renderCounts, { overviewFills: 0 }))
  await page.setViewportSize({ width: 1740, height: 1000 })
  await frames(page)
  const resized = await page.evaluate(() => (window as unknown as { renderCounts: Counters }).renderCounts.overviewFills)
  expect(resized).toBeGreaterThanOrEqual(181)
  expect(errors).toEqual([])
})

for (const ratio of [1, 2]) {
  test.describe(`cached canvas rendering at ${ratio}x pixel density`, () => {
    test.use({ deviceScaleFactor: ratio })
    test('restores partially painted cells and refreshes the overview on theme changes', async ({ page }) => {
      await openWorkspace(page)
      await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
      await expect(page.locator('.timeline-overview')).toHaveAttribute('aria-busy', 'false')
      await frames(page)
      const grid = page.locator('.cu-grid-canvas')
      const original = await grid.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      await grid.click({ position: { x: 25, y: 20 } })
      await frames(page)
      await grid.press('ArrowRight')
      await frames(page)
      await grid.press('ArrowDown')
      await frames(page)
      await grid.press('Enter')
      await frames(page)
      expect(await grid.evaluate((canvas: HTMLCanvasElement, original) => canvas.toDataURL() === original, original)).toBe(true)

      const overview = page.locator('.timeline-overview')
      const classic = await overview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      await openSettings(page)
      await page.getByRole('combobox', { name: '界面主题' }).selectOption('light')
      await page.getByRole('button', { name: '关闭对话框' }).click()
      await frames(page)
      expect(await overview.evaluate((canvas: HTMLCanvasElement, classic) => canvas.toDataURL() === classic, classic)).toBe(false)
      await openSettings(page)
      await page.getByRole('combobox', { name: '界面主题' }).selectOption('classic')
      await page.getByRole('button', { name: '关闭对话框' }).click()
      await frames(page)
      expect(await overview.evaluate((canvas: HTMLCanvasElement, classic) => canvas.toDataURL() === classic, classic)).toBe(true)
    })
  })
}

test('slow selection statistics keep one running query and discard obsolete ranges', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const state: StatisticsState = { delay: 0, requests: { statistics: [], groupedStatistics: [] }, active: { statistics: 0, groupedStatistics: 0 }, maximum: { statistics: 0, groupedStatistics: 0 } }
    ;(window as unknown as { statisticsState: StatisticsState }).statisticsState = state
    window.Worker = new Proxy(window.Worker, {
      construct(WorkerClass, args) {
        const worker = Reflect.construct(WorkerClass, args) as Worker
        const pending = new Map<number, string>()
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (message: { id: number; method: string; payload: { start: bigint; end: bigint; range?: { start: bigint; end: bigint } } }, options?: StructuredSerializeOptions | Transferable[]) => {
          if (state.requests[message.method]) {
            const range = message.payload.range ?? message.payload
            state.requests[message.method]!.push({ start: String(range.start), end: String(range.end) })
            state.active[message.method]!++
            state.maximum[message.method] = Math.max(state.maximum[message.method]!, state.active[message.method]!)
            pending.set(message.id, message.method)
          }
          if (Array.isArray(options)) send(message, options)
          else send(message, options)
        }
        worker.addEventListener('message', event => {
          const method = pending.get(event.data.id as number)
          if (!method) return
          pending.delete(event.data.id as number)
          if (!state.delay) { state.active[method]!--; return }
          event.stopImmediatePropagation()
          setTimeout(() => { state.active[method]!--; worker.dispatchEvent(new MessageEvent('message', { data: event.data })) }, state.delay)
        })
        return worker
      },
    })
  })
  await openWorkspace(page)
  await page.getByRole('button', { name: 'CU 利用率', exact: true }).click()
  const panel = page.getByRole('region', { name: 'CU 利用率统计' })
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  const total = await panel.locator('.utilization-total-busy').getAttribute('title')
  await page.evaluate(() => {
    const state = (window as unknown as { statisticsState: StatisticsState }).statisticsState
    state.requests = { statistics: [], groupedStatistics: [] }
    state.maximum = { statistics: 0, groupedStatistics: 0 }
    state.delay = 900
  })
  const bounds = (await page.locator('.timeline-overlay').boundingBox())!
  const left = bounds.x + 170
  const width = bounds.width - 183
  await page.mouse.move(left + width * 0.1, bounds.y + 92)
  await page.mouse.down()
  await page.mouse.move(left + width * 0.2, bounds.y + 92, { steps: 4 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { statisticsState: StatisticsState }).statisticsState.requests.statistics!.length)).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as unknown as { statisticsState: StatisticsState }).statisticsState.requests.groupedStatistics!.length)).toBe(1)
  await page.mouse.move(left + width * 0.7, bounds.y + 92, { steps: 20 })
  await page.mouse.up()
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByText('覆盖事件', { exact: true }).locator('..').locator('dd')).not.toHaveText(/计算中|—|^0$/)
  const state = await page.evaluate(() => (window as unknown as { statisticsState: StatisticsState }).statisticsState)
  expect(state.maximum).toEqual({ statistics: 1, groupedStatistics: 1 })
  expect(state.requests.statistics).toHaveLength(2)
  expect(state.requests.groupedStatistics).toHaveLength(2)
  expect(state.requests.statistics![1]).toEqual(state.requests.groupedStatistics![1])
  expect(BigInt(state.requests.statistics![1]!.end)).toBeGreaterThan(BigInt(state.requests.statistics![0]!.end))
  console.log('selection statistics requests', state.requests)

  await page.mouse.move(left + width * 0.3, bounds.y + 92)
  await page.mouse.down()
  await page.mouse.move(left + width * 0.5, bounds.y + 92, { steps: 3 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as unknown as { statisticsState: StatisticsState }).statisticsState.requests.statistics!.length)).toBe(3)
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: '整个时间周期', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => page.evaluate(() => (window as unknown as { statisticsState: StatisticsState }).statisticsState.active.statistics)).toBe(0)
  await expect(panel.locator('.utilization-total-busy')).toHaveAttribute('title', total!)
  await expect(page.getByRole('heading', { name: '选择一段时间', exact: true })).toBeVisible()
  await expect(page.getByText('覆盖事件', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

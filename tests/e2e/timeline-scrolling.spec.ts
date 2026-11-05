import { expect, test, type Page } from '@playwright/test'

type QueryState = { requests: number; delay: number }

async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: QueryState = { requests: 0, delay: 0 }
    ;(window as unknown as { timelineQueries: QueryState }).timelineQueries = state
    window.Worker = new Proxy(window.Worker, {
      construct(WorkerClass, args) {
        const worker = Reflect.construct(WorkerClass, args) as Worker
        const queries = new Set<number>()
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (message: { id: number; method: string; payload?: { trackIds?: number[] } }, options?: StructuredSerializeOptions | Transferable[]) => {
          if (['events', 'density'].includes(message.method) && message.payload?.trackIds) { state.requests++; queries.add(message.id) }
          if (Array.isArray(options)) send(message, options)
          else send(message, options)
        }
        worker.addEventListener('message', event => {
          const message = event.data as { id: number; kind: string }
          if (queries.delete(message.id) && message.kind === 'result' && state.delay) {
            event.stopImmediatePropagation()
            setTimeout(() => worker.dispatchEvent(new MessageEvent('message', { data: event.data })), state.delay)
          }
        })
        return worker
      },
    })
  })
  await page.goto('/')
  await expect(page.locator('.sidebar-info')).toContainText('128,200')
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  await expect(page.locator('.timeline-overview-summary')).toContainText('全程 63.66%')
}

async function scrollFrames(page: Page, direction: 'vertical' | 'horizontal', frames: number): Promise<{ queries: number; painted: number[] }> {
  return page.evaluate(async ({ direction, frames }) => {
    const state = (window as unknown as { timelineQueries: QueryState }).timelineQueries
    state.delay = 250
    const initial = state.requests
    const canvas = document.querySelector<HTMLCanvasElement>('.timeline-background')!
    const overlay = document.querySelector<HTMLCanvasElement>('.timeline-overlay')!
    const scroller = document.querySelector<HTMLDivElement>('.timeline-vertical-scroller')!
    const painted: number[] = []
    for (let index = 0; index < frames; index++) {
      if (direction === 'vertical') { scroller.scrollTop += 29; scroller.dispatchEvent(new Event('scroll')) }
      else overlay.dispatchEvent(new WheelEvent('wheel', { deltaX: 45, bubbles: true, cancelable: true }))
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const ratio = canvas.width / canvas.clientWidth
      const vertical = 31 + (Math.floor((canvas.clientHeight - 31) / 29) - 2) * 29 + 14
      const pixels = canvas.getContext('2d')!.getImageData(Math.round((canvas.clientWidth - 100) * ratio), Math.round(vertical * ratio), Math.round(80 * ratio), 1).data
      let colored = 0
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset + 2]! > 70 && pixels[offset + 2]! > pixels[offset]! * 1.2) colored++
      painted.push(colored)
    }
    return { queries: state.requests - initial, painted }
  }, { direction, frames })
}

test('vertical scrolling paints adjacent CUs immediately and coalesces slow pending queries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepare(page)
  const adjacent = await scrollFrames(page, 'vertical', 4)
  expect(adjacent.queries).toBe(0)
  expect(adjacent.painted.every(pixels => pixels > 10)).toBe(true)
  const continuing = await scrollFrames(page, 'vertical', 32)
  expect(continuing.queries).toBeLessThanOrEqual(8)
  expect(continuing.painted.every(pixels => pixels > 10)).toBe(true)
  expect(errors).toEqual([])
})

test('horizontal scrolling paints buffered time immediately while new queries are delayed', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepare(page)
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
    await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  }
  const adjacent = await scrollFrames(page, 'horizontal', 8)
  expect(adjacent.queries).toBe(0)
  expect(adjacent.painted.every(pixels => pixels > 10)).toBe(true)
  const continuing = await scrollFrames(page, 'horizontal', 20)
  expect(continuing.queries).toBeLessThanOrEqual(4)
  expect(continuing.painted.every(pixels => pixels > 10)).toBe(true)
  expect(errors).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'

type QueryState = { queries: { method: string; start: string; end: string; tracks: number[] }[]; active: number; labels: string[] }

async function state(page: Page): Promise<QueryState> {
  return page.evaluate(() => (window as typeof window & { timelineCacheQueries: QueryState }).timelineCacheQueries)
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  await page.waitForTimeout(200)
  await expect.poll(async () => (await state(page)).active).toBe(0)
}

test('large traces prioritize visible details and retain them across zoom levels and session tabs', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const state: QueryState = { queries: [], active: 0, labels: [] }
    ;(window as typeof window & { timelineCacheQueries: QueryState }).timelineCacheQueries = state
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function(text, horizontal, vertical, maxWidth) {
      if (this.canvas.classList.contains('timeline-background') && text.startsWith('detail_')) state.labels.push(text)
      if (maxWidth === undefined) fillText.call(this, text, horizontal, vertical)
      else fillText.call(this, text, horizontal, vertical, maxWidth)
    }
    window.Worker = new Proxy(window.Worker, {
      construct(WorkerClass, args) {
        const worker = Reflect.construct(WorkerClass, args) as Worker
        const pending = new Set<number>()
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (message: { id: number; method: string; payload?: { start: bigint; end: bigint; trackIds?: number[] } }, options?: StructuredSerializeOptions | Transferable[]) => {
          if (['events', 'density'].includes(message.method) && message.payload?.trackIds) {
            state.queries.push({ method: message.method, start: message.payload.start.toString(), end: message.payload.end.toString(), tracks: message.payload.trackIds })
            pending.add(message.id)
            state.active++
          }
          if (Array.isArray(options)) send(message, options)
          else send(message, options)
        }
        worker.addEventListener('message', event => { if (pending.delete(event.data.id)) state.active-- })
        return worker
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: '导入计算模式', exact: true })).toHaveValue('default')
  const traceEvents = Array.from({ length: 120000 }, (_, index) => ({ ph: 'X', pid: 1, tid: 1, name: `detail_${index % 8}`, ts: index * 200, dur: 150 }))
  await page.getByTestId('trace-input').setInputFiles({ name: 'large.perfetto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ traceEvents })) })
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await settled(page)
  await expect(page.locator('.timeline-mode')).toHaveText('密度聚合')
  const fullQuery = (await state(page)).queries[0]!
  let before = (await state(page)).queries.length
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await settled(page)
  const zoomQuery = (await state(page)).queries[before]!
  expect(BigInt(zoomQuery.end) - BigInt(zoomQuery.start)).toBeLessThan(BigInt(fullQuery.end) - BigInt(fullQuery.start))
  for (let index = 0; index < 13; index++) {
    await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
    await settled(page)
  }
  await expect(page.locator('.timeline-mode')).toHaveText('原始区间')
  await expect.poll(async () => (await state(page)).labels.length).toBeGreaterThan(0)
  before = (await state(page)).queries.length
  await page.getByRole('button', { name: '缩小时间轴', exact: true }).click()
  await settled(page)
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await settled(page)
  expect((await state(page)).queries).toHaveLength(before)
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByRole('tab', { name: /会话 1/ }).click()
  await expect(page.locator('.timeline-mode')).toHaveText('原始区间')
  await settled(page)
  expect((await state(page)).queries).toHaveLength(before)
  expect(errors).toEqual([])
})

import { expect, test } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const trace = JSON.stringify({ displayTimeUnit: 'ms', traceEvents: [
  { ph: 'M', name: 'process_name', pid: 100, tid: 0, args: { name: 'TP0' } },
  { ph: 'M', name: 'thread_name', pid: 100, tid: 120, args: { name: 'CPU0' } },
  { ph: 'M', name: 'thread_name', pid: 100, tid: 7, args: { name: 'Stream7' } },
  { ph: 'M', name: 'process_name', pid: 101, tid: 0, args: { name: 'TP1' } },
  { ph: 'M', name: 'thread_name', pid: 101, tid: 8, args: { name: 'Copy8' } },
  { ph: 'X', cat: 'cpu_op', name: 'decode_step', pid: 100, tid: 120, ts: 1000, dur: 1000 },
  { ph: 'X', cat: 'cpu_op', name: 'attention', pid: 100, tid: 120, ts: 1100, dur: 300 },
  { ph: 'X', cat: 'cpu_op', name: 'leaf_gemm', pid: 100, tid: 120, ts: 1200, dur: 100, args: { tp_rank: 0, shape: '64x128' } },
  { ph: 'B', cat: 'python', name: 'python_step', pid: 100, tid: 120, ts: 1500 },
  { ph: 'E', cat: 'python', name: 'python_step', pid: 100, tid: 120, ts: 1600 },
  { ph: 'X', cat: 'kernel', name: 'fused_attention', pid: 100, tid: 7, ts: 1120, dur: 450 },
  { ph: 'X', cat: 'gpu_memcpy', name: 'Memcpy HtoD', pid: 101, tid: 8, ts: 1050, dur: 80 },
  { ph: 's', cat: 'ac2g', name: 'launch', id: 1, pid: 100, tid: 120, ts: 1110 },
  { ph: 'f', cat: 'ac2g', name: 'launch', id: 1, pid: 100, tid: 7, ts: 1120, bp: 'e' },
] })

for (const compressed of [false, true]) test(`default mode reads ${compressed ? 'gzip' : 'plain'} JSON with named processes, threads and nested event lanes`, async ({ page }) => {
  await page.addInitScript(() => {
    const recorded = window as typeof window & { rawTrackLabels: string[]; rawTrackRows: Record<string, number>; rawTrackBoxes: { left: number; top: number; width: number; height: number }[]; rawTrackText: Record<string, { left: number; top: number; align: string }> }
    recorded.rawTrackLabels = []
    recorded.rawTrackRows = {}
    recorded.rawTrackBoxes = []
    recorded.rawTrackText = {}
    const roundRect = CanvasRenderingContext2D.prototype.roundRect
    CanvasRenderingContext2D.prototype.roundRect = function(horizontal, vertical, width, height, radii) {
      if (this.canvas.classList.contains('timeline-background')) recorded.rawTrackBoxes.push({ left: horizontal, top: vertical, width, height })
      roundRect.call(this, horizontal, vertical, width, height, radii)
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, horizontal, vertical, maxWidth) {
      if (this.canvas.classList.contains('timeline-background')) {
        if (recorded.rawTrackLabels.length > 5000) recorded.rawTrackLabels = []
        recorded.rawTrackLabels.push(text)
        recorded.rawTrackRows[text] = vertical
        recorded.rawTrackText[text] = { left: horizontal, top: vertical, align: this.textAlign }
      }
      if (maxWidth === undefined) fillText.call(this, text, horizontal, vertical)
      else fillText.call(this, text, horizontal, vertical, maxWidth)
    }
  })
  await page.goto('/')
  await page.getByRole('combobox', { name: '导入计算模式', exact: true }).selectOption('default')
  await page.getByRole('combobox', { name: '导入文件解析器', exact: true }).selectOption('auto')
  await page.getByTestId('trace-input').setInputFiles({ name: `nested.perfetto.json${compressed ? '.gz' : ''}`, mimeType: 'application/octet-stream', buffer: compressed ? gzipSync(trace) : Buffer.from(trace) })
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { rawTrackLabels: string[] }).rawTrackLabels)).toEqual(expect.arrayContaining(['TP0', 'TP1', 'CPU0', 'Stream7', 'Copy8', '嵌套 1', '嵌套 2']))
  const geometry = await page.evaluate(() => {
    const state = window as typeof window & { rawTrackRows: Record<string, number>; rawTrackBoxes: { left: number; top: number; width: number; height: number }[]; rawTrackText: Record<string, { left: number; top: number; align: string }> }
    return { rows: state.rawTrackRows, boxes: state.rawTrackBoxes, text: state.rawTrackText }
  })
  const firstNested = geometry.rows['嵌套 1']! - 9.5
  const secondNested = geometry.rows['嵌套 2']! - 9.5
  expect(secondNested - firstNested).toBe(19)
  expect(geometry.rows['嵌套 1']! - geometry.rows.CPU0!).toBe(24)
  expect(geometry.boxes).toEqual(expect.arrayContaining([expect.objectContaining({ top: firstNested, height: 19 }), expect.objectContaining({ top: secondNested, height: 19 })]))
  for (const name of ['attention', 'leaf_gemm', 'decode_step']) {
    const label = geometry.text[name]!
    expect(label.align).toBe('center')
    expect(geometry.boxes.some(box => Math.abs(box.left + box.width / 2 - label.left) < 0.01 && Math.abs(box.top + box.height / 2 - label.top) < 0.01)).toBe(true)
  }
  expect(geometry.text.attention!.top).toBe(geometry.rows['嵌套 1'])
  expect(geometry.text.leaf_gemm!.top).toBe(geometry.rows['嵌套 2'])
  const canvas = (await page.locator('.timeline-overlay').boundingBox())!
  await page.mouse.click(canvas.x + 170 + (canvas.width - 183) * 0.25, canvas.y + secondNested + 9)
  await expect(page.locator('.event-title')).toContainText('leaf_gemm')
  await page.screenshot({ path: '.local/screenshots/default-nested-compact.png' })
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const longLabel = await page.evaluate(() => (window as typeof window & { rawTrackText: Record<string, { left: number; align: string }> }).rawTrackText.decode_step!)
  expect(longLabel.align).toBe('center')
  expect(longLabel.left).toBeCloseTo(170 + (canvas.width - 184) / 2, 1)
  const expanded = (await page.locator('.timeline-footer').innerText()).match(/\d+ 条展示轨道/)![0]
  await page.getByRole('button', { name: '全部收起轨道', exact: true }).click()
  await expect(page.locator('.timeline-footer')).not.toContainText(expanded)
  await page.getByRole('textbox', { name: '搜索任务或事件', exact: true }).fill('leaf_gemm')
  await page.locator('.search-result').click()
  await expect(page.locator('.event-title')).toContainText('leaf_gemm')
  await expect(page.locator('.detail-list').first()).toContainText('原始轨道')
  await expect(page.locator('.inspector-scroll')).toContainText('64x128')
  await page.getByRole('button', { name: '定位到此事件', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { rawTrackLabels: string[] }).rawTrackLabels)).toContain('leaf_gemm')
  await page.getByRole('button', { name: '全部展开轨道', exact: true }).click()
  await expect(page.locator('.timeline-footer')).toContainText(expanded)
})

const sampleDirectory = process.env.VISUALSTREAM_TRACE_SAMPLES
for (const kind of ['monokernel', 'native']) test(`local ${kind} gzip sample imports, folds, locates and plays in default mode`, async ({ page }) => {
  test.skip(!sampleDirectory, 'Set VISUALSTREAM_TRACE_SAMPLES to the local sample directory')
  test.setTimeout(600000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('combobox', { name: '导入计算模式', exact: true }).selectOption('default')
  const timer = setInterval(async () => { try { console.log(`${kind}: ${(await page.locator('.import-progress').allInnerTexts()).join(' ')}`) } catch {} }, 20000)
  try {
    await page.getByTestId('trace-input').setInputFiles(path.join(sampleDirectory!, `qwen38_flash_next_tp8_b1_512-64_${kind}.perfetto.json.gz`))
    await expect(page.locator('.file-entry')).toHaveCount(1, { timeout: 480000 })
    await expect(page.locator('.import-progress')).toHaveCount(0, { timeout: 120000 })
    await expect(page.locator('.sidebar-info')).toContainText(kind === 'monokernel' ? '1,435,556' : '13,325,156')
    await expect(page.locator('.toast.error')).toHaveCount(0)
    await page.getByRole('button', { name: '全部收起轨道', exact: true }).click()
    await expect(page.locator('.timeline-query-loading')).toHaveCount(0, { timeout: 120000 })
    await page.screenshot({ path: `.local/screenshots/default-${kind}-overview.png` })
    await page.getByRole('textbox', { name: '搜索任务或事件', exact: true }).fill('aten::empty')
    await page.locator('.search-result').first().click({ timeout: 60000 })
    await expect(page.locator('.event-title')).toContainText('aten::empty')
    await page.getByRole('button', { name: '定位到此事件', exact: true }).click()
    await expect(page.locator('.timeline-query-loading')).toHaveCount(0, { timeout: 120000 })
    await page.screenshot({ path: `.local/screenshots/default-${kind}-event.png` })
    await page.getByRole('button', { name: '播放重放', exact: true }).click()
    await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '暂停重放', exact: true }).click()
    expect(errors).toEqual([])
  } finally { clearInterval(timer) }
})

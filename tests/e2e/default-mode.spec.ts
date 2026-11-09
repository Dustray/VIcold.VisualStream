import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'
import { importTraces, openWorkspace } from './workspace'

async function mode(page: Page, value: 'default' | 'megakernel'): Promise<void> {
  await page.getByRole('combobox', { name: '导入计算模式', exact: true }).selectOption(value)
  await expect(page.locator('.mode-tag')).toHaveText(value === 'default' ? '默认' : 'Megakernel')
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}
async function snapshot(page: Page): Promise<ProjectSnapshot> {
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = await (await downloading).path()
  if (!file) throw new Error('Missing project file')
  return JSON.parse(await readFile(file, 'utf8')) as ProjectSnapshot
}
async function expectGenericViews(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '资源矩阵', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'CU 利用率', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '筛选计算卡', exact: true })).toHaveCount(0)
  await expect(page.locator('.device-section')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '全局概览指标', exact: true })).toHaveValue('density')
  await expect(page.getByRole('combobox', { name: '全局概览指标', exact: true }).locator('option')).toHaveCount(1)
}

test('default mode replays the original Megakernel tracks, selects events and keeps selection controls', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: '导入计算模式', exact: true })).toHaveValue('default')
  await expectGenericViews(page)
  await importTraces(page)
  await expect(page.getByRole('button', { name: '当前任务', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const resource = page.locator('.file-resource')
  await expect(resource).toContainText('原始轨道')
  const trackCount = Number((await resource.innerText()).match(/(\d+) 条/)?.[1])
  expect(trackCount).toBeGreaterThan(76)
  const expandedRowCount = Number((await page.locator('.timeline-footer').innerText()).match(/(\d+) 条展示轨道/)?.[1])
  expect(expandedRowCount).toBeGreaterThan(trackCount)
  await expect(page.locator('.tasks-view th')).toHaveText(['任务名称', '来源文件', '原始轨道', '开始', '持续时间'])
  await expect(page.locator('.tasks-view tbody tr').first()).toBeVisible()
  await page.screenshot({ path: '.local/screenshots/default-mode-tracks.png' })
  const timeline = (await page.locator('.timeline-overlay').boundingBox())!
  await page.mouse.click(timeline.x + 18, timeline.y + 31 + 29 + 14)
  await expect(page.locator('.timeline-footer')).not.toContainText(`${expandedRowCount} 条展示轨道`)
  await page.mouse.click(timeline.x + 18, timeline.y + 31 + 29 + 14)
  await expect(page.locator('.timeline-footer')).toContainText(`${expandedRowCount} 条展示轨道`)
  const previousScroll = await page.locator('.timeline-vertical-scroller').evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop })
  expect(previousScroll).toBeGreaterThan(0)
  await page.locator('.tasks-view tbody tr').first().click()
  await expect(page.locator('.inspector-heading h3')).toHaveText('选中事件')
  await expect(page.locator('.event-tags')).not.toContainText('CU')
  await expect(page.locator('.detail-list').first().locator('dt')).toContainText(['开始时间', '结束时间', '持续时间', '来源文件', '原始轨道', '记录 ID'])
  await page.getByRole('button', { name: '定位到此事件', exact: true }).click()
  await expect.poll(() => page.locator('.timeline-vertical-scroller').evaluate(element => element.scrollTop)).toBeLessThan(previousScroll)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  await page.screenshot({ path: '.local/screenshots/default-mode-event.png' })
  await page.getByRole('button', { name: '适配全部时间', exact: true }).click()
  await page.mouse.move(timeline.x + 300, timeline.y + 95)
  await page.mouse.down()
  await page.mouse.move(timeline.x + 550, timeline.y + 95, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '播放选区', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 CU 利用率', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '播放选区', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  const saved = await snapshot(page)
  expect(saved.computeModel.id).toBe('default')
  expect(saved.selection).not.toBeNull()
  expect(saved.loop).toBe(true)
  await expectGenericViews(page)
  expect(errors).toEqual([])
})

test('folded raw tracks show descendant events and bulk controls restore the full hierarchy', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await mode(page, 'default')
  const expand = page.getByRole('button', { name: '全部展开轨道', exact: true })
  const collapse = page.getByRole('button', { name: '全部收起轨道', exact: true })
  await expect(expand).toBeDisabled()
  await expect(collapse).toBeDisabled()
  await importTraces(page)
  const trackCount = Number((await page.locator('.file-resource').innerText()).match(/(\d+) 条/)?.[1])
  const footer = page.locator('.timeline-footer')
  const rowCount = async () => Number((await footer.innerText()).match(/(\d+) 条展示轨道/)?.[1])
  const paintedPixels = (row: number) => page.locator('.timeline-background').evaluate((element, index) => {
    const canvas = element as HTMLCanvasElement
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    const pixels = canvas.getContext('2d')!.getImageData(Math.ceil(175 * ratio), Math.ceil((31 + index * 29 + 5) * ratio), Math.floor(canvas.width - 193 * ratio), Math.floor(18 * ratio)).data
    let painted = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset]!
      const green = pixels[offset + 1]!
      const blue = pixels[offset + 2]!
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 45 && Math.max(red, green, blue) > 110) painted++
    }
    return painted
  }, row)
  const expandedRowCount = await rowCount()
  expect(expandedRowCount).toBeGreaterThan(trackCount)
  const emptyRowPixels = await paintedPixels(1)
  await collapse.click()
  await expect.poll(rowCount).toBeLessThan(expandedRowCount)
  const collapsedCount = await rowCount()
  expect(collapsedCount).toBeGreaterThan(1)
  await expect.poll(() => paintedPixels(1)).toBeGreaterThan(emptyRowPixels + 100)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  await page.screenshot({ path: '.local/screenshots/default-mode-collapsed.png' })
  const timeline = (await page.locator('.timeline-overlay').boundingBox())!
  await page.mouse.click(timeline.x + 18, timeline.y + 31 + 29 + 14)
  await expect.poll(rowCount).toBeGreaterThan(collapsedCount)
  expect(await rowCount()).toBeLessThan(expandedRowCount)
  await expect.poll(() => paintedPixels(2)).toBeGreaterThan(emptyRowPixels + 100)
  await expand.click()
  await expect(footer).toContainText(`${expandedRowCount} 条展示轨道`)
  await expect.poll(() => paintedPixels(1)).toBe(emptyRowPixels)
  await mode(page, 'megakernel')
  await expect(expand).toHaveCount(0)
  await expect(collapse).toHaveCount(0)
  expect(errors).toEqual([])
})

test('switching an imported dual-card trace between default and Megakernel preserves state and workers', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let workerCount = 0
  page.on('worker', () => workerCount++)
  await openWorkspace(page, 'dual')
  await page.getByRole('region', { name: '当前会话', exact: true }).getByRole('checkbox').nth(1).uncheck()
  const timeline = (await page.locator('.timeline-overlay').boundingBox())!
  await page.mouse.move(timeline.x + 300, timeline.y + 95)
  await page.mouse.down()
  await page.mouse.move(timeline.x + 550, timeline.y + 95, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: '添加时间书签', exact: true }).click()
  const before = await snapshot(page)
  const workersBefore = workerCount
  await mode(page, 'default')
  await expectGenericViews(page)
  await expect(page.locator('.file-entry')).toHaveCount(2)
  await expect(page.getByRole('region', { name: '当前会话', exact: true }).getByRole('checkbox').nth(1)).not.toBeChecked()
  expect(await snapshot(page)).toEqual({ ...before, computeModel: { id: 'default', version: '1' } })
  await mode(page, 'megakernel')
  await expect(page.getByRole('button', { name: '资源矩阵', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'CU 利用率', exact: true })).toBeVisible()
  await expect(page.locator('.device-section')).toHaveCount(1)
  expect(await snapshot(page)).toEqual(before)
  expect(workerCount).toBe(workersBefore)
  expect(errors).toEqual([])
})

test('history follows the selected mode and default projects restore in an independent session', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await mode(page, 'default')
  await page.getByRole('region', { name: '历史文件', exact: true }).getByRole('button', { name: /^打开历史文件 / }).click()
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expectGenericViews(page)
  await page.getByRole('button', { name: '添加时间书签', exact: true }).click()
  const saved = await snapshot(page)
  await page.getByTestId('project-input').setInputFiles({ name: '原始轨道分析.vstream.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  await expect(page.getByRole('tab')).toHaveCount(3)
  await expect(page.locator('.mode-tag')).toHaveText('默认')
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  expect(await snapshot(page)).toEqual(saved)
  await expectGenericViews(page)
  await page.getByRole('tab', { name: /会话 1/ }).click()
  await expect(page.locator('.mode-tag')).toHaveText('Megakernel')
  await expect(page.getByRole('button', { name: '资源矩阵', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '原始轨道分析 1', exact: true }).click()
  await expectGenericViews(page)
  expect(errors).toEqual([])
})

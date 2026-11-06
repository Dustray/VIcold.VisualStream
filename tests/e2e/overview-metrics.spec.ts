import { expect, test, type Page } from '@playwright/test'
import { openSettings, openWorkspace, importTraces } from './workspace'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'

async function ready(page: Page, count = '128,200'): Promise<void> {
  await expect(page.locator('.sidebar-info')).toContainText(count)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

async function summary(page: Page): Promise<{ busy: bigint; capacity: bigint; percent: number }> {
  await expect(page.locator('.timeline-overview')).toHaveAttribute('aria-busy', 'false')
  const label = page.locator('.timeline-overview-summary')
  await expect(label).toHaveText(/^全程 [\d.]+% · 0–100%$/)
  const values = (await label.getAttribute('title'))!.match(/^(\d+) \/ (\d+) CU·ns$/)!
  return { busy: BigInt(values[1]!), capacity: BigInt(values[2]!), percent: Number((await label.textContent())!.match(/[\d.]+/)![0]) }
}

async function project(page: Page): Promise<ProjectSnapshot> {
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = await (await downloading).path()
  return JSON.parse(await readFile(file!, 'utf8')) as ProjectSnapshot
}

async function compareFullUtilization(page: Page, values: Awaited<ReturnType<typeof summary>>): Promise<void> {
  await page.getByRole('button', { name: 'CU 利用率', exact: true }).click()
  const panel = page.getByRole('region', { name: 'CU 利用率统计' })
  await panel.getByRole('button', { name: '整个时间周期', exact: true }).click()
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await expect(panel.locator('.utilization-total-busy')).toHaveAttribute('title', `${values.busy} ns`)
  expect(Number.parseFloat((await panel.locator('.utilization-total').textContent())!)).toBe(values.percent)
}

test('overview switches metrics without changing replay state and matches exact full CU activity', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  await ready(page)
  const metric = page.getByRole('combobox', { name: '全局概览指标' })
  await expect(metric).toHaveValue('utilization')
  await metric.selectOption('density')
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const track = await page.locator('.timeline-overlay').boundingBox()
  if (!track) throw new Error('Timeline is missing')
  await page.mouse.move(track.x + 450, track.y + 90)
  await page.mouse.down()
  await page.mouse.move(track.x + 700, track.y + 90, { steps: 6 })
  await page.mouse.up()
  const before = await project(page)
  await metric.selectOption('utilization')
  const values = await summary(page)
  expect(values.percent).toBeGreaterThan(0)
  expect(values.percent).toBeLessThanOrEqual(100)
  const after = await project(page)
  expect(after.viewport).toEqual(before.viewport)
  expect(after.time).toBe(before.time)
  expect(after.selection).toEqual(before.selection)
  await compareFullUtilization(page, values)
  const overview = await page.locator('.timeline-overview').boundingBox()
  if (!overview) throw new Error('Overview is missing')
  await page.mouse.move(overview.x + 170 + (overview.width - 183) * 0.5, overview.y + 16)
  await expect(page.locator('.overview-tooltip')).toContainText(/任务利用率 [\d.]+%/)
  const fullSpan = values.capacity / 76n
  const handle = overview.x + 170 + Number(BigInt(after.viewport.end)) / Number(fullSpan) * (overview.width - 183)
  await page.mouse.move(handle, overview.y + 16)
  await page.mouse.down()
  await page.mouse.move(handle - 50, overview.y + 16, { steps: 6 })
  await page.mouse.up()
  const resized = await project(page)
  expect(BigInt(resized.viewport.end) - BigInt(resized.viewport.start)).toBeLessThan(BigInt(after.viewport.end) - BigInt(after.viewport.start))
  expect(await summary(page)).toEqual(values)
  await page.screenshot({ path: '.local/screenshots/overview-utilization.png' })
  await metric.selectOption('density')
  await expect(page.locator('.timeline-overview-summary')).toHaveCount(0)
  await expect(page.locator('.timeline-overview')).toHaveAttribute('aria-label', /全局任务密度/)
  const restored = await project(page)
  expect(restored.viewport).toEqual(resized.viewport)
  expect(restored.time).toBe(resized.time)
  await metric.selectOption('utilization')
  expect(await summary(page)).toEqual(values)
  expect(errors).toEqual([])
})

test('global utilization updates for new cards and offsets while ignoring the card filter', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  await ready(page)
  await page.getByRole('combobox', { name: '全局概览指标' }).selectOption('utilization')
  await summary(page)
  await importTraces(page, 'dual', true)
  await ready(page, '445,328')
  const full = await summary(page)
  await compareFullUtilization(page, full)
  const filter = page.getByRole('combobox', { name: '筛选计算卡' })
  await filter.selectOption((await filter.locator('option').nth(1).getAttribute('value'))!)
  expect(await summary(page)).toEqual(full)
  await filter.selectOption({ label: '所有计算卡' })
  const oldTitle = await page.locator('.timeline-overview-summary').getAttribute('title')
  await openSettings(page, '会话设置')
  const offset = page.locator('.source-offset input').nth(1)
  await offset.fill('200')
  await offset.press('Tab')
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await expect(page.locator('.timeline-overview-summary')).not.toHaveAttribute('title', oldTitle!)
  const shifted = await summary(page)
  expect(shifted.busy).toBe(full.busy)
  expect(shifted.capacity).toBeGreaterThan(full.capacity)
  expect(shifted.percent).toBeLessThan(full.percent)
  await compareFullUtilization(page, shifted)
  const overview = await page.locator('.timeline-overview').boundingBox()
  if (!overview) throw new Error('Overview is missing')
  await page.mouse.move(overview.x + 170 + (overview.width - 183) * 0.5, overview.y + 16)
  await expect(page.locator('.overview-tooltip')).toContainText('任务利用率 0.00%')
  await page.screenshot({ path: '.local/screenshots/overview-utilization-tp2.png' })
  expect(errors).toEqual([])
})

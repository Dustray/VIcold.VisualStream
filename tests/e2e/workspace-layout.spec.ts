import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'
import { openWorkspace } from './workspace'

async function dragSplit(page: Page, ratio: number): Promise<void> {
  const workspace = await page.locator('.workspace-content').boundingBox()
  const handle = await page.getByRole('separator', { name: '调整视图与时间轴高度' }).boundingBox()
  if (!workspace || !handle) throw new Error('Workspace splitter is missing')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, workspace.y + workspace.height * ratio, { steps: 15 })
  await page.mouse.up()
}

async function project(page: Page): Promise<ProjectSnapshot> {
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const filename = await (await downloading).path()
  if (!filename) throw new Error('Project was not saved')
  return JSON.parse(await readFile(filename, 'utf8')) as ProjectSnapshot
}

test('splitter reaches the top, restores the previous height, and remembers the layout', async ({ page }) => {
  await page.goto('/')
  const upper = page.locator('.upper-workspace')
  const splitter = page.getByRole('separator', { name: '调整视图与时间轴高度' })
  const maximize = page.getByRole('button', { name: '最大化时间轴面板', exact: true })
  const restore = page.getByRole('button', { name: '还原时间轴面板', exact: true })
  await expect(splitter).toHaveAttribute('aria-valuenow', '54')
  await dragSplit(page, 0.15)
  const compactHeight = (await upper.boundingBox())!.height
  expect(compactHeight).toBeLessThan(170)
  const previousRatio = await splitter.getAttribute('aria-valuenow')
  await dragSplit(page, 0)
  await expect(upper).toBeHidden()
  await expect(splitter).toHaveAttribute('aria-valuenow', '0')
  await expect(restore).toHaveAttribute('aria-pressed', 'true')
  const workspace = (await page.locator('.workspace-content').boundingBox())!
  const handle = (await splitter.boundingBox())!
  expect(handle.y).toBeCloseTo(workspace.y, 0)
  expect(await page.locator('body').evaluate(element => element.style.cursor)).toBe('')
  await restore.click()
  await expect(splitter).toHaveAttribute('aria-valuenow', previousRatio!)
  expect((await upper.boundingBox())!.height).toBeCloseTo(compactHeight, 0)
  await maximize.click()
  await dragSplit(page, 0.42)
  await expect(upper).toBeVisible()
  const draggedRatio = await splitter.getAttribute('aria-valuenow')
  expect(Number(draggedRatio)).toBeCloseTo(42, 0)
  await maximize.click()
  await page.reload()
  await expect(upper).toBeHidden()
  await expect(restore).toBeVisible()
  await restore.click()
  await expect(splitter).toHaveAttribute('aria-valuenow', draggedRatio!)
  await expect(upper).toBeVisible()
})

test('maximized timeline resizes its canvas and preserves replay state and keyboard playback', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  const timeline = page.locator('.timeline-overlay')
  const initialBounds = (await timeline.boundingBox())!
  await timeline.click({ position: { x: initialBounds.width * 0.4, y: 15 } })
  await page.mouse.move(initialBounds.x + 300, initialBounds.y + 95)
  await page.mouse.down()
  await page.mouse.move(initialBounds.x + 600, initialBounds.y + 95, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  const before = await project(page)
  expect(before.selection).not.toBeNull()
  const maximize = page.getByRole('button', { name: '最大化时间轴面板', exact: true })
  const state = (await page.locator('.play-state').boundingBox())!
  expect((await maximize.boundingBox())!.x).toBeGreaterThanOrEqual(state.x + state.width)
  await maximize.click()
  await expect(page.locator('.upper-workspace')).toBeHidden()
  expect((await timeline.boundingBox())!.height).toBeGreaterThan(initialBounds.height + 200)
  await expect.poll(() => timeline.evaluate(element => {
    const canvas = element as HTMLCanvasElement
    return Math.abs(canvas.height / devicePixelRatio - canvas.clientHeight)
  })).toBeLessThan(2)
  const after = await project(page)
  expect(after.viewport).toEqual(before.viewport)
  expect(after.selection).toEqual(before.selection)
  expect(after.time).toBe(before.time)
  await page.setViewportSize({ width: 1040, height: 640 })
  expect(await page.locator('.playback-bar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.locator('.play-state')).toHaveText('已暂停')
  await page.keyboard.press('Space')
  await expect(page.locator('.play-state')).toHaveText('正在重放')
  await page.getByRole('button', { name: '还原时间轴面板', exact: true }).click()
  await expect(page.locator('.upper-workspace')).toBeVisible()
  await expect(page.locator('.play-state')).toHaveText('正在重放')
  await page.keyboard.press('Space')
  await expect(page.locator('.play-state')).toHaveText('已暂停')
  const splitter = page.getByRole('separator', { name: '调整视图与时间轴高度' })
  const time = (await project(page)).time
  await splitter.focus()
  await page.keyboard.press('Home')
  await expect(page.locator('.upper-workspace')).toBeHidden()
  expect((await project(page)).time).toBe(time)
  await splitter.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.upper-workspace')).toBeVisible()
  await splitter.focus()
  await page.keyboard.press('End')
  await expect(splitter).toHaveAttribute('aria-valuenow', '72')
  expect((await project(page)).time).toBe(time)
  await page.screenshot({ path: '.local/screenshots/timeline-restored.png' })
  await page.getByRole('button', { name: '最大化时间轴面板', exact: true }).click()
  await page.screenshot({ path: '.local/screenshots/timeline-maximized.png' })
  expect(errors).toEqual([])
})

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

async function dragSidebar(page: Page, width: number): Promise<void> {
  const sidebar = (await page.locator('.sidebar').boundingBox())!
  const handle = (await page.getByRole('separator', { name: '调整资源管理器宽度' }).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(sidebar.x + width + handle.width / 2, handle.y + handle.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('collapsed sidebar utilities stay at the bottom and release space to the current session', async ({ page }) => {
  await page.goto('/')
  const session = page.getByRole('region', { name: '当前会话', exact: true })
  const history = page.getByRole('region', { name: '历史文件', exact: true })
  const originalHeight = (await session.boundingBox())!.height
  await page.getByRole('button', { name: '重放信息', exact: true }).click()
  await page.getByRole('button', { name: '时间书签', exact: true }).click()
  await expect(page.locator('#replay-information')).toBeHidden()
  await expect(page.locator('#time-bookmarks')).toBeHidden()
  const enlargedHeight = (await session.boundingBox())!.height
  expect(enlargedHeight).toBeGreaterThan(originalHeight + 120)
  const sidebar = (await page.locator('.sidebar').boundingBox())!
  const utilities = (await page.locator('.sidebar-utilities').boundingBox())!
  expect(sidebar.y + sidebar.height - utilities.y - utilities.height).toBeCloseTo(10, 0)
  await history.getByRole('button', { name: /历史文件/ }).click()
  expect((await session.boundingBox())!.height).toBeGreaterThan(enlargedHeight + 30)
  await session.getByRole('button', { name: /当前会话/ }).click()
  await history.getByRole('button', { name: /历史文件/ }).click()
  expect((await history.boundingBox())!.height).toBeGreaterThan((await session.boundingBox())!.height + 100)
  await page.setViewportSize({ width: 1040, height: 640 })
  for (const name of ['当前会话', '历史文件', '重放信息', '时间书签']) {
    const heading = (await page.getByRole('button', { name: new RegExp(`^${name}`) }).boundingBox())!
    const bounds = (await page.locator('.sidebar').boundingBox())!
    expect(heading.y).toBeGreaterThanOrEqual(bounds.y)
    expect(heading.y + heading.height).toBeLessThanOrEqual(bounds.y + bounds.height)
  }
  expect(await page.locator('.sidebar').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
})

test('sidebar file lists scroll independently while section titles and bottom controls remain visible', async ({ page }) => {
  await openWorkspace(page, 'all')
  await page.setViewportSize({ width: 1040, height: 640 })
  await page.getByRole('button', { name: '重放信息', exact: true }).click()
  await page.getByRole('button', { name: '时间书签', exact: true }).click()
  const session = page.getByRole('region', { name: '当前会话', exact: true })
  const history = page.getByRole('region', { name: '历史文件', exact: true })
  await expect(history.locator('.history-entry')).toHaveCount(3)
  expect((await session.boundingBox())!.height).toBeGreaterThan((await history.boundingBox())!.height)
  const sessionTitle = session.getByRole('button', { name: /^当前会话/ })
  const historyTitle = history.getByRole('button', { name: /^历史文件/ })
  const sessionPosition = (await sessionTitle.boundingBox())!.y
  const historyPosition = (await historyTitle.boundingBox())!.y
  for (const selector of ['.file-list', '.history-file-list']) {
    const list = page.locator(selector)
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    const bounds = (await list.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  }
  expect((await sessionTitle.boundingBox())!.y).toBeCloseTo(sessionPosition, 0)
  expect((await historyTitle.boundingBox())!.y).toBeCloseTo(historyPosition, 0)
  expect(await page.locator('.sidebar').evaluate(element => element.scrollTop)).toBe(0)
  await expect(page.getByRole('button', { name: '重放信息', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '时间书签', exact: true })).toBeInViewport()
  await expect(session.getByRole('checkbox', { checked: true })).toHaveCount(3)
  await page.screenshot({ path: '.local/screenshots/sidebar-panels-compact.png' })
})

test('resource explorer width supports dragging, keyboard adjustment, persistence and reset', async ({ page }) => {
  await page.goto('/')
  const splitter = page.getByRole('separator', { name: '调整资源管理器宽度' })
  await expect(splitter).toHaveAttribute('aria-valuenow', '228')
  const initial = (await page.locator('.workspace').boundingBox())!
  await dragSidebar(page, 360)
  await expect(splitter).toHaveAttribute('aria-valuenow', '360')
  expect((await page.locator('.sidebar').boundingBox())!.width).toBe(360)
  expect((await page.locator('.workspace').boundingBox())!.x - initial.x).toBe(132)
  await page.reload()
  await expect(splitter).toHaveAttribute('aria-valuenow', '360')
  await splitter.focus()
  await page.keyboard.press('ArrowRight')
  await expect(splitter).toHaveAttribute('aria-valuenow', '376')
  await page.keyboard.press('ArrowLeft')
  await expect(splitter).toHaveAttribute('aria-valuenow', '360')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await expect(splitter).toHaveAttribute('aria-valuenow', '200')
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowRight')
  await expect(splitter).toHaveAttribute('aria-valuenow', '520')
  await page.keyboard.press('Enter')
  await expect(splitter).toHaveAttribute('aria-valuenow', '228')
  await dragSidebar(page, 100)
  await expect(splitter).toHaveAttribute('aria-valuenow', '200')
  await dragSidebar(page, 1000)
  await expect(splitter).toHaveAttribute('aria-valuenow', '520')
  await splitter.dblclick()
  await expect(splitter).toHaveAttribute('aria-valuenow', '228')

  const handle = (await splitter.boundingBox())!
  await page.mouse.move(handle.x + 3, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 43, handle.y + handle.height / 2)
  await expect(splitter).toHaveClass(/dragging/)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(splitter).not.toHaveClass(/dragging/)
  await expect(splitter).toHaveAttribute('aria-valuenow', '268')
  await page.mouse.move(handle.x + 143, handle.y + handle.height / 2)
  await page.mouse.up()
  await expect(splitter).toHaveAttribute('aria-valuenow', '268')
  expect(await page.locator('body').evaluate(element => element.style.cursor)).toBe('')
  expect(await page.evaluate(() => localStorage.getItem('visualstream.sidebarWidth'))).toBe('268')
})

test('resource explorer adapts to narrow windows while preserving replay state and preferred width', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  const timeline = page.locator('.timeline-overlay')
  const bounds = (await timeline.boundingBox())!
  await timeline.click({ position: { x: 320, y: 15 } })
  await page.mouse.move(bounds.x + 300, bounds.y + 95)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 500, bounds.y + 95, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  const before = await project(page)
  expect(before.selection).not.toBeNull()
  const splitter = page.getByRole('separator', { name: '调整资源管理器宽度' })
  await dragSidebar(page, 520)
  await expect(splitter).toHaveAttribute('aria-valuenow', '520')
  await page.setViewportSize({ width: 1040, height: 760 })
  await expect(splitter).toHaveAttribute('aria-valuenow', '234')
  expect((await page.locator('.workspace').boundingBox())!.width).toBeGreaterThanOrEqual(800)
  expect(await page.evaluate(() => localStorage.getItem('visualstream.sidebarWidth'))).toBe('520')
  await expect.poll(() => timeline.evaluate((canvas: HTMLCanvasElement) => Math.abs(canvas.width / Math.min(devicePixelRatio, 2) - canvas.clientWidth))).toBeLessThan(2)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect(splitter).toHaveAttribute('aria-valuenow', '520')
  await expect.poll(() => timeline.evaluate((canvas: HTMLCanvasElement) => Math.abs(canvas.width / Math.min(devicePixelRatio, 2) - canvas.clientWidth))).toBeLessThan(2)
  const after = await project(page)
  expect(after.viewport).toEqual(before.viewport)
  expect(after.time).toBe(before.time)
  expect(after.selection).toEqual(before.selection)
  await page.screenshot({ path: '.local/screenshots/sidebar-resized.png' })
  expect(errors).toEqual([])
})

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

import { expect, test, type Page } from '@playwright/test'
import { openSettings, openWorkspace } from './workspace'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'

async function ready(page: Page): Promise<void> {
  await openWorkspace(page)
  await expect(page.locator('.sidebar-info')).toContainText('128,200')
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

async function project(page: Page): Promise<ProjectSnapshot> {
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = await (await downloading).path()
  if (!file) throw new Error('Project was not saved')
  return JSON.parse(await readFile(file, 'utf8')) as ProjectSnapshot
}

function width(snapshot: ProjectSnapshot): bigint { return BigInt(snapshot.viewport.end) - BigInt(snapshot.viewport.start) }

test('A and D animate the viewport, accumulate short taps, and yield to direct navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const positions: number[] = []
    ;(window as unknown as { panPositions: number[] }).panPositions = positions
    const original = CanvasRenderingContext2D.prototype.strokeRect
    CanvasRenderingContext2D.prototype.strokeRect = function(horizontal, vertical, width, height) {
      if (this.canvas.classList.contains('timeline-overview')) positions.push(horizontal)
      original.call(this, horizontal, vertical, width, height)
    }
  })
  await ready(page)
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
    await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  }
  const initial = await project(page)
  const distance = width(initial) / 10n
  const start = await page.evaluate(() => {
    const positions = (window as unknown as { panPositions: number[] }).panPositions
    const last = positions.at(-1)!
    positions.length = 0
    return last
  })
  await page.keyboard.press('d')
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'true')
  const right = await project(page)
  expect(BigInt(right.viewport.start)).toBe(BigInt(initial.viewport.start) + distance)
  expect(width(right)).toBe(width(initial))
  const positions = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return (window as unknown as { panPositions: number[] }).panPositions
  })
  expect(new Set(positions).size).toBeGreaterThan(5)
  const end = positions.at(-1)!
  expect(positions.some(position => position > start && position < end)).toBe(true)
  await page.keyboard.press('a')
  expect((await project(page)).viewport).toEqual(initial.viewport)
  await page.keyboard.press('d')
  await page.keyboard.press('d')
  await page.keyboard.press('d')
  const repeated = await project(page)
  expect(BigInt(repeated.viewport.start)).toBe(BigInt(initial.viewport.start) + distance * 3n)
  expect(width(repeated)).toBe(width(initial))
  expect(repeated.time).toBe(initial.time)
  expect(repeated.selection).toEqual(initial.selection)
  await page.keyboard.press('a')
  await page.getByRole('button', { name: '适配全部时间', exact: true }).click()
  const fitted = await project(page)
  expect(BigInt(fitted.viewport.start)).toBe(0n)
  expect(width(fitted)).toBe(width(initial) * 4n)
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
})

async function framesFor(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate(milliseconds => new Promise<void>(resolve => {
    const end = performance.now() + milliseconds
    const frame = (wall: number) => { if (wall >= end) resolve(); else requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  }), milliseconds)
}

test('holding WASD keeps moving without repeated keydown events and preserves the pointer anchor', async ({ page }) => {
  await ready(page)
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
    await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  }
  for (let index = 0; index < 7; index++) await page.keyboard.press('d')
  const initial = await project(page)
  const canvas = (await page.locator('.timeline-overlay').boundingBox())!
  const horizontal = Math.floor(170 + (canvas.width - 183) * 0.7)
  const ratio = (horizontal - 170) / (canvas.width - 183)
  const anchor = (snapshot: ProjectSnapshot) => BigInt(snapshot.viewport.start) + BigInt(Math.round(Number(width(snapshot)) * ratio))
  let previous = initial
  for (const key of ['w', 's', 'a', 'd']) {
    await page.mouse.move(canvas.x + horizontal, canvas.y + 15)
    await page.keyboard.down(key)
    await framesFor(page, 400)
    await page.keyboard.up(key)
    const after = await project(page)
    if (key === 'w' || key === 's') {
      if (key === 'w') expect(width(after)).toBeLessThan(width(previous) * 65n / 100n)
      else expect(width(after)).toBeGreaterThan(width(previous) * 16n / 10n)
      expect(Number(anchor(after) - anchor(previous))).toBeLessThanOrEqual(8)
      expect(Number(anchor(after) - anchor(previous))).toBeGreaterThanOrEqual(-8)
    } else {
      const distance = BigInt(after.viewport.start) - BigInt(previous.viewport.start)
      const travel = key === 'a' ? -distance : distance
      expect(travel).toBeGreaterThan(width(previous) * 3n / 10n)
      expect(travel).toBeLessThan(width(previous) * 65n / 100n)
      expect(width(after)).toBe(width(previous))
    }
    expect(after.time).toBe(initial.time)
    expect(after.selection).toEqual(initial.selection)
    previous = after
  }
})

test('held navigation stops for text focus, window blur and direct navigation without sticky keys', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.down('d')
  await framesFor(page, 150)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).focus()
  const focused = await project(page)
  await framesFor(page, 300)
  expect((await project(page)).viewport).toEqual(focused.viewport)
  await page.keyboard.up('d')
  await page.keyboard.down('w')
  await framesFor(page, 150)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const blurred = await project(page)
  await page.keyboard.down('w')
  await framesFor(page, 300)
  expect((await project(page)).viewport).toEqual(blurred.viewport)
  await page.keyboard.up('w')
  await page.keyboard.down('d')
  await framesFor(page, 150)
  await page.keyboard.press('f')
  const fitted = await project(page)
  await framesFor(page, 300)
  expect((await project(page)).viewport).toEqual(fitted.viewport)
  await page.keyboard.up('d')
  expect(fitted.viewport.start).toBe('0')
})

test('keyboard and wheel zoom keep the pointer time fixed independently of the playhead and selection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const canvas = page.locator('.timeline-overlay')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Timeline is missing')
  const plot = box.width - 183
  await canvas.click({ position: { x: 170 + plot * 0.15, y: 15 } })
  await page.mouse.move(box.x + 170 + plot * 0.1, box.y + 92)
  await page.mouse.down()
  await page.mouse.move(box.x + 170 + plot * 0.3, box.y + 92, { steps: 4 })
  await page.mouse.up()
  const original = await project(page)
  const horizontal = Math.floor(170 + plot * 0.8)
  const ratio = (horizontal - 170) / plot
  const anchor = BigInt(original.viewport.start) + BigInt(Math.round(Number(width(original)) * ratio))
  const atPointer = (snapshot: ProjectSnapshot) => BigInt(snapshot.viewport.start) + BigInt(Math.round(Number(width(snapshot)) * ratio))
  await page.mouse.move(box.x + horizontal, box.y + 15)
  await page.keyboard.press('w')
  const zoomed = await project(page)
  expect(width(zoomed)).toBe(BigInt(Math.round(Number(width(original)) * 0.8)))
  expect(atPointer(zoomed)).toBe(anchor)
  expect(zoomed.time).toBe(original.time)
  expect(zoomed.selection).toEqual(original.selection)
  await page.mouse.move(box.x + horizontal, box.y + 15)
  await page.keyboard.press('s')
  expect((await project(page)).viewport).toEqual(original.viewport)

  const wheel = async (deltaY: number, deltaMode: number, count = 1) => {
    await canvas.evaluate((element, input) => {
      const bounds = element.getBoundingClientRect()
      for (let index = 0; index < input.count; index++) element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: input.deltaY, deltaMode: input.deltaMode, clientX: bounds.left + input.horizontal, clientY: bounds.top + 15 }))
    }, { deltaY, deltaMode, count, horizontal })
  }
  await wheel(-100, 0)
  const pixels = await project(page)
  expect(width(pixels)).toBeLessThan(width(original))
  expect(atPointer(pixels)).toBe(anchor)
  await page.keyboard.press('f')
  await wheel(-6.25, 1)
  expect((await project(page)).viewport).toEqual(pixels.viewport)
  await page.keyboard.press('f')
  await wheel(-100, 0, 4)
  const accumulated = await project(page)
  expect(width(accumulated)).toBeLessThan(width(pixels) * 3n / 4n)
  expect(atPointer(accumulated)).toBe(anchor)
  expect(accumulated.time).toBe(original.time)
  expect(accumulated.selection).toEqual(original.selection)
  await page.mouse.move(box.x + horizontal, box.y + 15)
  await page.keyboard.press('w')
  await page.keyboard.press('f')
  expect((await project(page)).viewport).toEqual(original.viewport)
  await page.getByRole('slider', { name: '重放速度' }).fill('0')
  await page.getByRole('button', { name: '播放重放', exact: true }).click()
  await page.mouse.move(box.x + horizontal, box.y + 15)
  await page.keyboard.press('w')
  const playing = await project(page)
  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  expect(atPointer(playing)).toBe(anchor)
  expect(width(playing)).toBe(BigInt(Math.round(Number(width(original)) * 0.8)))
  expect((await project(page)).viewport).toEqual(playing.viewport)
  expect(errors).toEqual([])
})

test('numbered instances of an operator share colors while retaining their original names', async ({ page }) => {
  await ready(page)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).fill('TASK_RMS_NORM_HOPPER_')
  const results = page.locator('.search-result')
  await expect(results.nth(1)).toBeVisible()
  const names = await results.locator('strong').allTextContents()
  expect(new Set(names).size).toBeGreaterThan(1)
  expect(names.every(name => /^TASK_RMS_NORM_HOPPER_\d+$/.test(name))).toBe(true)
  const colors = await results.locator('.event-dot').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
  expect(new Set(colors).size).toBe(1)
  await results.first().click()
  await expect(page.locator('.event-title h3')).toHaveText(names[0]!)
  await expect(page.locator('.event-title .event-dot')).toHaveCSS('background-color', colors[0]!)
  const different = names.findIndex(name => name !== names[0])
  await page.locator('.inspector-tabs').getByRole('button', { name: /搜索/ }).click()
  await results.nth(different).click()
  await expect(page.locator('.event-title h3')).toHaveText(names[different]!)
  await expect(page.locator('.event-title .event-dot')).toHaveCSS('background-color', colors[0]!)
})

test('operator clicks seek to the pointer time, left drag selects, and right drag pans without changing time', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).fill('TASK_RMS_NORM')
  await expect(page.locator('.search-result').first()).toBeVisible()
  await page.locator('.search-result').first().click()
  await page.getByRole('button', { name: '定位到此事件' }).click()
  await expect(page.locator('.timeline-mode')).toHaveText('原始区间')
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
  const before = await project(page)
  const canvas = await page.locator('.timeline-overlay').boundingBox()
  if (!canvas) throw new Error('Timeline is missing')
  const cu = Number((await page.locator('.event-tags span').nth(1).innerText()).match(/CU\s+(\d+)/)?.[1])
  expect(Number.isFinite(cu)).toBe(true)
  const scrollTop = await page.locator('.timeline-vertical-scroller').evaluate(element => element.scrollTop)
  const vertical = 31 + (cu + 1) * 29 - scrollTop + 14
  expect(vertical).toBeGreaterThan(31)
  expect(vertical).toBeLessThan(canvas.height)
  const plotWidth = canvas.width - 183
  const horizontal = Math.floor(170 + plotWidth * 0.65)
  const expectedTime = BigInt(before.viewport.start) + BigInt(Math.round((horizontal - 170) / plotWidth * Number(width(before))))
  await page.locator('.timeline-overlay').click({ position: { x: horizontal, y: vertical } })
  const clicked = await project(page)
  expect(clicked.time).toBe(expectedTime.toString())
  expect(BigInt(clicked.time)).toBeGreaterThan(BigInt(before.time))
  await expect(page.locator('.event-title')).toContainText('TASK_RMS_NORM')

  const left = Math.floor(170 + plotWidth * 0.25)
  const right = Math.floor(170 + plotWidth * 0.75)
  await page.mouse.move(canvas.x + left, canvas.y + vertical)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(canvas.x + right, canvas.y + vertical, { steps: 12 })
  await page.mouse.up({ button: 'left' })
  const selected = await project(page)
  expect(selected.selection).toEqual({
    start: (BigInt(before.viewport.start) + BigInt(Math.round((left - 170) / plotWidth * Number(width(before))))).toString(),
    end: (BigInt(before.viewport.start) + BigInt(Math.round((right - 170) / plotWidth * Number(width(before))))).toString(),
  })
  expect(selected.time).toBe(clicked.time)

  await page.mouse.move(canvas.x + horizontal, canvas.y + vertical)
  await page.mouse.down({ button: 'right' })
  await expect(page.locator('.timeline-overlay')).toHaveClass(/panning/)
  await page.mouse.move(canvas.x + horizontal + 90, canvas.y + vertical, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await expect(page.locator('.timeline-overlay')).not.toHaveClass(/panning/)
  const panned = await project(page)
  expect(BigInt(panned.viewport.start)).toBeLessThan(BigInt(selected.viewport.start))
  expect(width(panned)).toBe(width(selected))
  expect(panned.time).toBe(selected.time)
  expect(panned.selection).toEqual(selected.selection)
  expect(errors).toEqual([])
})

test('locating a CU event uses the event range while preserving an existing selection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).fill('TASK_RMS_NORM')
  await expect(page.locator('.search-result').first()).toBeVisible()
  await page.locator('.search-result').first().click()
  await page.getByRole('button', { name: '定位到此事件' }).click()
  const eventView = await project(page)
  const name = await page.locator('.event-title h3').innerText()
  const cu = Number((await page.locator('.event-tags span').nth(1).innerText()).match(/CU\s+(\d+)/)?.[1])
  expect(Number.isFinite(cu)).toBe(true)
  await page.getByRole('button', { name: '适配全部时间', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const timeline = (await page.locator('.timeline-overlay').boundingBox())!
  const plot = timeline.width - 183
  await page.mouse.move(timeline.x + 170 + plot * 0.6, timeline.y + 92)
  await page.mouse.down()
  await page.mouse.move(timeline.x + 170 + plot * 0.8, timeline.y + 92, { steps: 8 })
  await page.mouse.up()
  const selected = await project(page)
  expect(selected.selection).not.toBeNull()
  expect(BigInt(selected.selection!.start)).toBeGreaterThan(BigInt(eventView.viewport.end))

  const grid = page.locator('.cu-grid-canvas')
  const gridWidth = await grid.evaluate(element => element.clientWidth)
  const columns = Math.max(4, Math.min(16, Math.floor((gridWidth + 6) / 80)))
  const cellWidth = (gridWidth - 4 - 6 * (columns - 1)) / columns
  const position = { x: 2 + cu % columns * (cellWidth + 6) + 20, y: 2 + Math.floor(cu / columns) * 49 + 20 }
  await grid.click({ position })
  await expect(page.getByRole('button', { name: '定位到此事件' })).toHaveCount(0)
  await grid.click({ position })
  await expect(page.locator('.event-title h3')).toHaveText(name)
  await page.getByRole('button', { name: '定位到此事件' }).click()
  const located = await project(page)
  expect(located.viewport).toEqual(eventView.viewport)
  expect(located.time).toBe(eventView.time)
  expect(located.selection).toEqual(selected.selection)

  await page.locator('.inspector-tabs').getByRole('button', { name: '选区', exact: true }).click()
  await page.locator('.inspector').getByRole('button', { name: '缩放到选区', exact: true }).click()
  const selectionView = await project(page)
  expect(selectionView.selection).toEqual(selected.selection)
  expect(BigInt(selectionView.viewport.start)).toBeLessThanOrEqual(BigInt(selected.selection!.start))
  expect(BigInt(selectionView.viewport.end)).toBeGreaterThanOrEqual(BigInt(selected.selection!.end))
  expect(selectionView.viewport).not.toEqual(eventView.viewport)
  expect(selectionView.time).toBe(eventView.time)
  expect(errors).toEqual([])
})

test('WASD, slow speeds and global Space work with control focus while text inputs keep normal typing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const timeline = await page.locator('.timeline-overlay').boundingBox()
  if (!timeline) throw new Error('Timeline is missing')
  await page.mouse.click(timeline.x + 170 + (timeline.width - 183) / 2, timeline.y + 15)
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const original = await project(page)
  await page.keyboard.press('w')
  const zoomed = await project(page)
  expect(width(zoomed)).toBe(BigInt(Math.round(Number(width(original)) * 0.8)))
  await page.keyboard.press('a')
  const earlier = await project(page)
  expect(BigInt(earlier.viewport.start)).toBe(BigInt(zoomed.viewport.start) - width(zoomed) / 10n)
  expect(width(earlier)).toBe(width(zoomed))
  await page.keyboard.press('d')
  const later = await project(page)
  expect(later.viewport).toEqual(zoomed.viewport)
  await page.keyboard.press('s')
  const unzoomed = await project(page)
  expect(unzoomed.viewport).toEqual(original.viewport)

  const speed = page.getByRole('slider', { name: '重放速度' })
  await speed.fill('1')
  await expect(speed).toHaveValue('1')
  await speed.fill('0')
  await expect(speed).toHaveValue('0')
  await speed.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '播放重放', exact: true }).click()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加时间书签', exact: true }).focus()
  await page.keyboard.down('Space')
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await expect(page.locator('.bookmark-list')).not.toContainText('标记 1')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()

  const search = page.getByRole('textbox', { name: '搜索任务或事件' })
  await search.fill('')
  await search.press('Space')
  await expect(search).toHaveValue(' ')
  await search.pressSequentially('wasd')
  await expect(search).toHaveValue(' wasd')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()
  expect((await project(page)).viewport).toEqual(original.viewport)
  await search.fill('')

  await openSettings(page, '会话设置')
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: '关闭对话框' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  const timeInput = dialog.getByRole('textbox', { name: '时间位置（ms）' })
  await timeInput.fill('50')
  await timeInput.press('Space')
  await expect(timeInput).toHaveValue('50 ')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭对话框' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(errors).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.sidebar-info')).toContainText('128,200')
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

async function project(page: Page): Promise<ProjectSnapshot> {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = await (await downloading).path()
  if (!path) throw new Error('Missing project')
  return JSON.parse(await readFile(path, 'utf8')) as ProjectSnapshot
}

test('speed slider uses discrete presets, separates demo mode, and supports keyboard focus', async ({ page }) => {
  await ready(page)
  const slider = page.getByRole('slider', { name: '重放速度' })
  const demo = page.getByRole('checkbox', { name: '20s 演示' })
  await expect(demo).toBeChecked()
  await expect(slider).toHaveAttribute('max', '8')
  await expect(slider).toHaveAttribute('step', '1')
  const initial = await project(page)
  expect(initial.speed).toBe(Number(BigInt(initial.viewport.end) - BigInt(initial.viewport.start)) / 20e9)
  await slider.fill('5')
  await expect(page.locator('.speed-value')).toHaveText('0.5×')
  await expect(demo).not.toBeChecked()
  await demo.check()
  expect((await project(page)).speed).toBe(initial.speed)
  await demo.uncheck()
  await expect(page.locator('.speed-value')).toHaveText('0.5×')
  await slider.fill('0')
  await expect(slider).toHaveAttribute('aria-valuetext', '0.00001×')
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', '0.0001×')
  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuetext', '10×')
  await slider.fill('0')
  await demo.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await expect(demo).not.toBeChecked()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeVisible()
})

test('E and Q step speeds, synchronize demo and slider, and leave text editing alone', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const slider = page.getByRole('slider', { name: '重放速度' })
  const demo = page.getByRole('checkbox', { name: '20s 演示' })
  const speed = page.locator('.speed-value')
  const paused = page.getByRole('button', { name: '播放重放', exact: true })
  await expect(demo).toBeChecked()
  await page.keyboard.press('e')
  await expect(speed).toHaveText('0.01×')
  await expect(slider).toHaveValue('3')
  await expect(demo).not.toBeChecked()
  await expect(paused).toBeVisible()
  await page.keyboard.press('q')
  await expect(speed).toHaveText('0.001×')
  await page.keyboard.press('Q')
  await expect(speed).toHaveText('0.0001×')
  await demo.check()
  await page.keyboard.press('q')
  await expect(speed).toHaveText('0.001×')
  await expect(demo).not.toBeChecked()
  await slider.fill('0')
  await slider.press('q')
  await expect(slider).toHaveValue('0')
  await slider.press('e')
  await expect(slider).toHaveValue('1')
  await page.keyboard.down('e')
  await page.keyboard.down('e')
  await page.keyboard.down('e')
  await page.keyboard.up('e')
  await expect(speed).toHaveText('0.1×')
  await slider.fill('8')
  await slider.press('e')
  await expect(speed).toHaveText('10×')
  await slider.press('q')
  await expect(speed).toHaveText('2×')
  const search = page.getByRole('textbox', { name: '搜索任务或事件' })
  await search.fill('')
  await search.pressSequentially('qeQE')
  await expect(search).toHaveValue('qeQE')
  await expect(speed).toHaveText('2×')
  await search.fill('')
  await page.getByRole('button', { name: '会话设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '会话设置' })
  await dialog.getByRole('textbox', { name: '自定义速度（×）' }).fill('0.07')
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect(speed).toHaveText('0.07×')
  await page.keyboard.press('e')
  await expect(speed).toHaveText('0.07×')
  await dialog.getByRole('button', { name: '关闭对话框' }).click()
  await page.keyboard.press('e')
  await expect(speed).toHaveText('0.1×')
  await page.keyboard.press('q')
  await expect(speed).toHaveText('0.01×')
  await slider.fill('0')
  await paused.click()
  await page.keyboard.press('e')
  await expect(speed).toHaveText('0.0001×')
  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  expect(errors).toEqual([])
})

test('wheel scroll interpolates both axes and reaches the requested position', async ({ page }) => {
  await ready(page)
  const samples = await page.evaluate(async () => {
    const overlay = document.querySelector('.timeline-overlay')!
    const scroller = document.querySelector('.timeline-vertical-scroller')!
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    const positions: number[] = []
    for (let index = 0; index < 24; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      positions.push(scroller.scrollTop)
    }
    return positions
  })
  const firstMovement = samples.find(position => position > 0)!
  expect(firstMovement).toBeGreaterThan(0)
  expect(firstMovement).toBeLessThan(120)
  expect(new Set(samples).size).toBeGreaterThan(4)
  expect(samples.at(-1)).toBe(120)
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const before = await project(page)
  const movement = await page.evaluate(async () => {
    const overlay = document.querySelector('.timeline-overlay')!
    const canvas = document.querySelector<HTMLCanvasElement>('.timeline-background')!
    const scroller = document.querySelector('.timeline-vertical-scroller')!
    const ratio = canvas.width / canvas.clientWidth
    const hashes: number[] = []
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 120, bubbles: true, cancelable: true }))
    for (let index = 0; index < 28; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const pixels = canvas.getContext('2d')!.getImageData(Math.round(170 * ratio), Math.round(29 * ratio), Math.round((canvas.clientWidth - 183) * ratio), 1).data
      let hash = 0
      for (const value of pixels) hash = Math.imul(hash, 31) + value | 0
      hashes.push(hash)
    }
    return { hashes, top: scroller.scrollTop, plotWidth: canvas.clientWidth - 183 }
  })
  expect(new Set(movement.hashes).size).toBeGreaterThan(3)
  expect(movement.top).toBe(240)
  const after = await project(page)
  const span = BigInt(before.viewport.end) - BigInt(before.viewport.start)
  expect(BigInt(after.viewport.end) - BigInt(after.viewport.start)).toBe(span)
  const expected = BigInt(Math.round(120 / movement.plotWidth * Number(span)))
  const difference = BigInt(after.viewport.start) - BigInt(before.viewport.start) - expected
  expect(difference < 0n ? -difference : difference).toBeLessThanOrEqual(1n)
})

test('overview-level tasks keep category colors and narrow tasks show ellipsized labels', async ({ page }) => {
  await page.addInitScript(() => {
    const labels: string[] = []
    ;(window as unknown as { timelineLabels: string[] }).timelineLabels = labels
    const original = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function(text, horizontal, vertical, maximumWidth) {
      if (this.canvas.classList.contains('timeline-background') && text.endsWith('...')) labels.push(text)
      if (maximumWidth === undefined) original.call(this, text, horizontal, vertical)
      else original.call(this, text, horizontal, vertical, maximumWidth)
    }
  })
  await ready(page)
  await expect(page.locator('.timeline-mode')).toHaveText('密度聚合')
  const categories = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.timeline-background')!
    const ratio = canvas.width / canvas.clientWidth
    const pixels = canvas.getContext('2d')!.getImageData(Math.round(170 * ratio), Math.round(66 * ratio), Math.round((canvas.clientWidth - 183) * ratio), 1).data
    const palette = ['8cafff', '64d4be', 'b6a0f7', 'e6b774', 'e48fb2', '77c4e8', 'c9d486', 'b3bdf2']
    const colors = new Set<string>()
    const background = [14, 19, 28]
    for (const color of palette) {
      const expected = [0, 2, 4].map((offset, index) => Math.round(parseInt(color.slice(offset, offset + 2), 16) * 176 / 255 + background[index]! * 79 / 255))
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (expected.every((value, index) => Math.abs(value - pixels[offset + index]!) <= 3)) { colors.add(color); break }
      }
    }
    return colors.size
  })
  expect(categories).toBeGreaterThanOrEqual(2)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).fill('TASK_RMS_NORM')
  await expect(page.locator('.search-result').first()).toBeVisible()
  await page.locator('.search-result').first().click()
  await page.getByRole('button', { name: '定位到此事件' }).click()
  await expect(page.locator('.timeline-mode')).toHaveText('原始区间')
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: '缩小时间轴', exact: true }).click()
    await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { timelineLabels: string[] }).timelineLabels.length)).toBeGreaterThan(0)
  await expect(page.locator('.event-title')).toContainText('TASK_RMS_NORM')
})

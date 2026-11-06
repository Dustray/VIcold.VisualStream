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

test('four themes update page and canvases, improve text contrast, persist, and preserve replay state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const theme = page.getByRole('combobox', { name: '界面主题' })
  await expect(theme.locator('option')).toHaveCount(4)
  await expect(theme).toHaveValue('classic')
  await page.getByRole('slider', { name: '重放速度' }).fill('1')
  await page.getByRole('button', { name: '放大时间轴', exact: true }).click()
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  const bounds = await page.locator('.timeline-overlay').boundingBox()
  if (!bounds) throw new Error('Missing timeline')
  await page.mouse.move(bounds.x + 350, bounds.y + 100)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 550, bounds.y + 100, { steps: 8 })
  await page.mouse.up()
  const original = await project(page)
  const canvasColors = new Set<string>()
  const gridImages = new Set<string>()
  for (const value of ['light', 'dark', 'classic']) {
    await theme.selectOption(value)
    await expect(page.locator('html')).toHaveAttribute('data-theme', value)
    const appearance = await page.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const sidebar = getComputedStyle(document.querySelector('.sidebar')!)
      const text = getComputedStyle(document.querySelector('.sidebar-info dt')!)
      const canvas = document.querySelector<HTMLCanvasElement>('.timeline-background')!
      const pixel = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data
      function luminance(color: string): number {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const foreground = luminance(text.color)
      const background = luminance(sidebar.backgroundColor)
      return {
        contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        smallFont: parseFloat(getComputedStyle(document.querySelector('.small-caps')!).fontSize),
        labelFont: parseFloat(getComputedStyle(document.querySelector('.import-configuration label')!).fontSize),
        canvasColor: Array.from(pixel).join(','),
        grid: document.querySelector<HTMLCanvasElement>('.cu-grid-canvas')!.toDataURL(),
      }
    })
    if (value !== 'classic') expect(appearance.contrast).toBeGreaterThanOrEqual(4.5)
    expect(appearance.smallFont).toBeGreaterThanOrEqual(10)
    expect(appearance.labelFont).toBeGreaterThanOrEqual(11)
    canvasColors.add(appearance.canvasColor)
    gridImages.add(appearance.grid)
    const current = await project(page)
    expect(current.viewport).toEqual(original.viewport)
    expect(current.selection).toEqual(original.selection)
    expect(current.time).toBe(original.time)
    expect(current.speed).toBe(original.speed)
  }
  expect(canvasColors.size).toBe(3)
  expect(gridImages.size).toBe(3)
  await theme.selectOption('light')
  await page.reload()
  await expect(theme).toHaveValue('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(errors).toEqual([])
})

test('system preference follows live changes while explicit themes remain fixed', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await ready(page)
  const theme = page.getByRole('combobox', { name: '界面主题' })
  await theme.selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(theme).toHaveValue('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await theme.selectOption('classic')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic')
  await theme.selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

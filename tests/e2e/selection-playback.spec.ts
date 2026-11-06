import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ProjectSnapshot } from '../../src/core/types'
import { openWorkspace } from './workspace'

async function project(page: Page): Promise<ProjectSnapshot> {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = await (await downloading).path()
  if (!file) throw new Error('Project was not saved')
  return JSON.parse(await readFile(file, 'utf8')) as ProjectSnapshot
}

async function samples(page: Page, frames = 100): Promise<number[]> {
  return page.evaluate(async frames => {
    const values: number[] = []
    for (let index = 0; index < frames; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      values.push(Number.parseFloat(document.querySelector('[data-testid="playback-time"] strong')!.textContent!))
    }
    return values
  }, frames)
}

test('selection playback starts inside the selection, loops, pauses and restarts at its beginning', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openWorkspace(page)
  await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
  await expect(page.getByRole('button', { name: '播放选区', exact: true })).toHaveCount(0)
  const timeline = (await page.locator('.timeline-overlay').boundingBox())!
  const plot = timeline.width - 183
  await page.mouse.move(timeline.x + 170 + plot * 0.6, timeline.y + 92)
  await page.mouse.down()
  await page.mouse.move(timeline.x + 170 + plot * 0.62, timeline.y + 92, { steps: 5 })
  await page.mouse.up()
  const selected = await project(page)
  expect(selected.loop).toBe(false)
  expect(selected.selection).not.toBeNull()
  const start = Number(BigInt(selected.selection!.start)) / 1e6
  const end = Number(BigInt(selected.selection!.end)) / 1e6
  expect(Number(BigInt(selected.time)) / 1e6).toBeLessThan(start)

  await page.getByRole('slider', { name: '重放速度' }).fill('5')
  await page.getByRole('button', { name: '播放选区', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '循环选区', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('slider', { name: '重放速度' })).toHaveAttribute('aria-valuetext', '0.01×')
  const values = await samples(page)
  expect(values.length).toBe(100)
  expect(values.every(value => value >= start - 0.001 && value < end + 0.001)).toBe(true)
  expect(values.some((value, index) => index > 0 && value < values[index - 1]!)).toBe(true)

  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  const paused = await page.getByTestId('playback-time').locator('strong').innerText()
  await samples(page, 5)
  await expect(page.getByTestId('playback-time').locator('strong')).toHaveText(paused)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '暂停重放', exact: true })).toBeVisible()
  const resumed = await samples(page, 20)
  expect(resumed.every(value => value >= start - 0.001 && value < end + 0.001)).toBe(true)

  await page.getByRole('slider', { name: '重放速度' }).fill('0')
  await page.getByRole('button', { name: '播放选区', exact: true }).click()
  const restarted = await samples(page, 3)
  expect(restarted.every(value => value >= start - 0.001 && value < start + (end - start) / 4)).toBe(true)
  await page.getByRole('button', { name: '暂停重放', exact: true }).click()
  const saved = await project(page)
  expect(saved.selection).toEqual(selected.selection)
  expect(saved.loop).toBe(true)
  expect(saved.speed).toBe(0.00001)
  await page.getByRole('button', { name: '清除选区', exact: true }).click()
  await expect(page.getByRole('button', { name: '循环选区', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: '播放选区', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

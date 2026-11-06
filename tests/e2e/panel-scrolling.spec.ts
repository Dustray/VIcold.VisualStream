import { expect, test, type Locator, type Page } from '@playwright/test'
import { openWorkspace } from './workspace'

async function hoverVisibleCell(page: Page, panel: Locator, selector = 'tbody td'): Promise<void> {
  const point = await panel.evaluate((element, selector) => {
    const bounds = element.getBoundingClientRect()
    const cells = [...element.querySelectorAll(selector)]
    const cell = cells.find(cell => {
      const box = cell.getBoundingClientRect()
      return box.top >= bounds.top + 10 && box.bottom < bounds.bottom - 15 && box.left >= bounds.left && box.right <= bounds.right
    })
    if (!cell) throw new Error('No table cell is visible in the scrollable panel')
    const box = cell.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }, selector)
  await page.mouse.move(point.x, point.y)
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('tbody'), point)).toBe(true)
}

for (const view of [
  { name: '当前任务', selector: '.tasks-view' },
  { name: 'CU 利用率', selector: '.cu-utilization' },
]) {
  test(`${view.name} continues scrolling over table rows in wide and narrow windows`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('visualstream.upperRatio', '25'))
    await openWorkspace(page)
    const timeline = page.locator('.timeline-overlay')
    const bounds = (await timeline.boundingBox())!
    await timeline.click({ position: { x: 170 + (bounds.width - 183) * 0.32, y: 15 } })
    await page.getByRole('button', { name: view.name, exact: true }).click()
    const panel = page.locator(view.selector)
    await expect.poll(() => panel.locator('tbody tr').count()).toBeGreaterThanOrEqual(20)
    for (const width of [1600, 1040]) {
      await page.setViewportSize({ width, height: 800 })
      await panel.evaluate(element => { element.scrollTop = 0 })
      expect(await panel.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(500)
      const panelBounds = (await panel.boundingBox())!
      await page.mouse.move(panelBounds.x + 3, panelBounds.y + panelBounds.height / 2)
      await page.mouse.wheel(0, 350)
      await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
      await hoverVisibleCell(page, panel)
      const before = await panel.evaluate(element => element.scrollTop)
      await page.mouse.wheel(0, 250)
      await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(before + 100)
      await hoverVisibleCell(page, panel)
      const lower = await panel.evaluate(element => element.scrollTop)
      await page.mouse.wheel(0, -200)
      await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeLessThan(lower - 100)
      if (view.name === 'CU 利用率') {
        await hoverVisibleCell(page, panel, '.utilization-meter')
        const meterPosition = await panel.evaluate(element => element.scrollTop)
        await page.mouse.wheel(0, 100)
        await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(meterPosition + 50)
      }
      await hoverVisibleCell(page, panel)
      await page.mouse.wheel(0, 10000)
      await expect.poll(() => panel.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
      await hoverVisibleCell(page, panel)
      await page.mouse.wheel(0, -300)
      await expect.poll(() => panel.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(100)
      if (view.name === 'CU 利用率' && width === 1040) {
        const table = panel.locator('.utilization-table-scroll')
        expect(await table.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
        await hoverVisibleCell(page, panel)
        await page.mouse.wheel(250, 0)
        await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      }
      expect(await page.locator('.app-shell').evaluate(element => element.scrollTop)).toBe(0)
      expect(await page.locator('.timeline-vertical-scroller').evaluate(element => element.scrollTop)).toBe(0)
    }
    expect(errors).toEqual([])
  })
}

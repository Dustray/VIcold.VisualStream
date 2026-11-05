import { expect, test, type Page } from '@playwright/test'

async function ready(page: Page, count = '128,200'): Promise<void> {
  await expect(page.locator('.sidebar-info')).toContainText(count)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.summary-grid strong').first()).not.toHaveText('0')
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

async function verifyTotals(page: Page, cuCount: number): Promise<number> {
  const panel = page.getByRole('region', { name: 'CU 利用率统计' })
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  const rows = panel.locator('tbody tr')
  await expect(rows).toHaveCount(cuCount)
  const period = (await panel.locator('.utilization-period').getAttribute('title'))!.match(/^(-?\d+) → (-?\d+) ns$/)!
  const span = BigInt(period[2]!) - BigInt(period[1]!)
  const values = await rows.evaluateAll(elements => elements.map(element => ({
    busy: element.querySelector('.utilization-busy')!.getAttribute('title')!.replace(' ns', ''),
    ratio: Number(element.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')),
  })))
  const busy = values.reduce((total, item) => total + BigInt(item.busy), 0n)
  for (const item of values) {
    expect(BigInt(item.busy)).toBeGreaterThanOrEqual(0n)
    expect(BigInt(item.busy)).toBeLessThanOrEqual(span)
    expect(item.ratio).toBeCloseTo(Number(BigInt(item.busy)) / Number(span) * 100, 3)
  }
  await expect(panel.locator('.utilization-total-busy')).toHaveAttribute('title', `${busy} ns`)
  const ratio = Number.parseFloat((await panel.locator('.utilization-total').textContent())!)
  expect(ratio).toBeCloseTo(Number(busy) / Number(span * BigInt(cuCount)) * 100, 2)
  return ratio
}

async function brush(page: Page, left: number, right: number): Promise<void> {
  const bounds = await page.locator('.timeline-overlay').boundingBox()
  if (!bounds) throw new Error('Timeline is missing')
  const plot = bounds.width - 183
  await page.mouse.move(bounds.x + 170 + plot * left, bounds.y + 92)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 170 + plot * right, bounds.y + 92, { steps: 8 })
  await page.mouse.up()
}

test('real TP1 reports full and selected CU utilization, supports sorting and CU selection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'CU 利用率', exact: true }).click()
  const panel = page.getByRole('region', { name: 'CU 利用率统计' })
  await expect(panel.getByRole('button', { name: '当前选区', exact: true })).toBeDisabled()
  const full = await verifyTotals(page, 76)
  expect(full).toBeGreaterThan(0)
  expect(full).toBeLessThanOrEqual(100)
  const fullRange = await panel.locator('.utilization-period').getAttribute('title')
  await page.getByRole('combobox', { name: 'CU 利用率排序' }).selectOption('descending')
  const rates = await panel.getByRole('meter').evaluateAll(elements => elements.map(element => Number(element.getAttribute('aria-valuenow'))))
  expect(rates).toEqual([...rates].sort((left, right) => right - left))
  await panel.locator('tbody tr').first().getByRole('button').click()
  await expect(panel.locator('tbody tr.selected')).toHaveCount(1)
  await expect(panel.locator('.utilization-table-heading')).toContainText('已选 CU')
  const canvas = await page.locator('.timeline-overlay').boundingBox()
  if (!canvas) throw new Error('Timeline is missing')
  await page.mouse.move(canvas.x + 600, canvas.y + 18)
  await page.keyboard.press('w')
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  await expect(panel.locator('.utilization-period')).toHaveAttribute('title', fullRange!)
  expect(await verifyTotals(page, 76)).toBe(full)
  await page.keyboard.press('f')
  await brush(page, 0.2, 0.55)
  await expect(panel.getByRole('button', { name: '当前选区', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await verifyTotals(page, 76)
  const selectedRange = await panel.locator('.utilization-period').getAttribute('title')
  expect(selectedRange).not.toBe(fullRange)
  await panel.getByRole('button', { name: '整个时间周期', exact: true }).click()
  expect(await verifyTotals(page, 76)).toBe(full)
  await expect(panel.locator('.utilization-period')).toHaveAttribute('title', fullRange!)
  await panel.getByRole('button', { name: '当前选区', exact: true }).click()
  await verifyTotals(page, 76)
  await expect(panel.locator('.utilization-period')).toHaveAttribute('title', selectedRange!)
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: '当前选区', exact: true })).toBeDisabled()
  expect(await verifyTotals(page, 76)).toBe(full)
  await page.screenshot({ path: '.local/screenshots/cu-utilization.png' })
  expect(errors).toEqual([])
})

test('real TP2 aggregates both cards, filters by device and recomputes offsets and empty selections', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'TP2 · 双卡' }).click()
  await ready(page, '445,328')
  await page.getByRole('button', { name: 'CU 利用率', exact: true }).click()
  const panel = page.getByRole('region', { name: 'CU 利用率统计' })
  const full = await verifyTotals(page, 152)
  await expect(panel.locator('.utilization-device')).toHaveCount(2)
  const ids = await panel.locator('tbody tr').evaluateAll(elements => elements.map(element => element.getAttribute('data-cu-id')))
  expect(new Set(ids).size).toBe(152)
  const filter = page.getByRole('combobox', { name: '筛选计算卡' })
  const device = await filter.locator('option').nth(1).getAttribute('value')
  await filter.selectOption(device!)
  await verifyTotals(page, 76)
  await expect(panel.locator('.utilization-device')).toHaveCount(0)
  await filter.selectOption({ label: '所有计算卡' })
  expect(await verifyTotals(page, 152)).toBe(full)

  await page.getByRole('button', { name: '会话设置', exact: true }).click()
  const offset = page.locator('.source-offset input').nth(1)
  await offset.fill('200')
  await offset.press('Tab')
  await page.getByRole('button', { name: '关闭对话框' }).click()
  const shifted = await verifyTotals(page, 152)
  expect(shifted).toBeLessThan(full)
  await brush(page, 0.45, 0.55)
  await expect(panel.getByRole('button', { name: '当前选区', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await verifyTotals(page, 152)).toBe(0)
  const inactive = await panel.locator('.utilization-busy').evaluateAll(elements => elements.every(element => element.getAttribute('title') === '0 ns'))
  expect(inactive).toBe(true)
  await expect(panel.locator('.utilization-description')).toContainText('不代表硬件计数器')
  await page.screenshot({ path: '.local/screenshots/cu-utilization-tp2.png' })
  expect(errors).toEqual([])
})

import { expect, test, type Locator, type Page } from '@playwright/test'
import { openWorkspace } from './workspace'

async function ready(page: Page): Promise<void> {
  await openWorkspace(page)
  await expect(page.locator('.sidebar-info')).toContainText('128,200')
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

async function nativeActions(target: Locator): Promise<{ context: boolean; drag: boolean; middle: boolean; selection: boolean }> {
  return target.evaluate(element => {
    const events = {
      context: new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      drag: new DragEvent('dragstart', { bubbles: true, cancelable: true }),
      middle: new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }),
      selection: new Event('selectstart', { bubbles: true, cancelable: true }),
    }
    for (const event of Object.values(events)) element.dispatchEvent(event)
    return { context: events.context.defaultPrevented, drag: events.drag.defaultPrevented, middle: events.middle.defaultPrevented, selection: events.selection.defaultPrevented }
  })
}

test('workbench chrome avoids browser selection, menus, dragging and page zoom while inputs retain editing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  await expect(page.getByRole('group', { name: '窗口控制' })).toHaveCount(0)
  const heading = page.locator('.sidebar-title')
  expect(await heading.evaluate(element => getComputedStyle(element).userSelect)).toBe('none')
  expect(await nativeActions(heading)).toEqual({ context: true, drag: true, middle: true, selection: true })
  const bounds = await heading.boundingBox()
  if (!bounds) throw new Error('Sidebar title is missing')
  await page.mouse.move(bounds.x + 3, bounds.y + 5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + 5, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
  await page.keyboard.press('Control+a')
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')

  const search = page.getByRole('textbox', { name: '搜索任务或事件' })
  await expect(search).toHaveAttribute('autocomplete', 'off')
  expect(await search.evaluate(element => (element as HTMLInputElement).spellcheck)).toBe(false)
  expect(await search.evaluate(element => getComputedStyle(element).userSelect)).toBe('text')
  expect(await nativeActions(search)).toEqual({ context: false, drag: false, middle: false, selection: false })
  await search.fill('wasd')
  await search.press('Control+a')
  await search.press('Backspace')
  await expect(search).toHaveValue('')
  await search.pressSequentially(' TASK_RMS_NORM')
  await expect(search).toHaveValue(' TASK_RMS_NORM')
  const wheel = await heading.evaluate(element => {
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: -80, bubbles: true, cancelable: true })
    const normal = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
    element.dispatchEvent(zoom)
    element.dispatchEvent(normal)
    return { zoom: zoom.defaultPrevented, normal: normal.defaultPrevented, overscroll: getComputedStyle(document.querySelector('.inspector-scroll')!).overscrollBehavior, overflow: getComputedStyle(document.body).overflow }
  })
  expect(wheel).toEqual({ zoom: true, normal: false, overscroll: 'none', overflow: 'hidden' })
  expect(errors).toEqual([])
})

test('event details retain local selection and copy semantics without selecting the whole workbench', async ({ page }) => {
  await ready(page)
  await page.getByRole('textbox', { name: '搜索任务或事件' }).fill('TASK_RMS_NORM')
  await expect(page.locator('.search-result').first()).toBeVisible()
  await page.locator('.search-result').first().click()
  const name = page.locator('.event-title h3')
  await expect(name).toContainText('TASK_RMS_NORM')
  expect(await name.evaluate(element => getComputedStyle(element).userSelect)).toBe('text')
  expect(await nativeActions(name)).toEqual({ context: false, drag: true, middle: true, selection: false })
  await name.dblclick()
  expect((await page.evaluate(() => window.getSelection()?.toString()))!.length).toBeGreaterThan(0)
  await page.keyboard.press('Control+a')
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await name.textContent())
  expect(await page.locator('.detail-list dd').first().evaluate(element => getComputedStyle(element).userSelect)).toBe('text')
  await page.locator('.sidebar-title').click()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
  await page.keyboard.press('Control+a')
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
})

test('text drags stay in editors while external file drops still import', async ({ page }) => {
  await ready(page)
  const textDrag = await page.getByRole('textbox', { name: '搜索任务或事件' }).evaluate(element => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'TASK_RMS_NORM')
    const enter = new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true })
    const over = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true })
    const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
    for (const event of [enter, over, drop]) element.dispatchEvent(event)
    return [enter.defaultPrevented, over.defaultPrevented, drop.defaultPrevented]
  })
  expect(textDrag).toEqual([false, false, false])
  await expect(page.locator('.drop-overlay')).toHaveCount(0)
  const file = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['invalid trace'], 'desktop-drop.perfetto-trace', { type: 'application/octet-stream' }))
    return transfer
  })
  const shell = page.locator('.app-shell')
  await shell.dispatchEvent('dragenter', { dataTransfer: file })
  await expect(page.locator('.drop-overlay')).toBeVisible()
  const accepted = await shell.evaluate((element, transfer) => {
    const event = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, file)
  expect(accepted).toBe(true)
  await shell.dispatchEvent('drop', { dataTransfer: file })
  await expect(page.locator('.drop-overlay')).toHaveCount(0)
  await expect(page.locator('.toast.error')).toBeVisible()
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await file.dispose()
})

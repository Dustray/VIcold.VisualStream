import { expect, type Page } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export async function importTraces(page: Page, kind: 'single' | 'dual' | 'all' = 'single', replace = false): Promise<void> {
  if (replace) {
    const remove = page.getByRole('region', { name: '当前会话', exact: true }).getByRole('button', { name: /^移除 / })
    while (await remove.count()) await remove.first().click()
  }
  const files = (await readdir('trace_demo')).filter(name => name.endsWith('.perfetto-trace') && (kind === 'all' || name.includes(kind === 'single' ? '_tp1_' : '_tp2_'))).sort()
  await page.getByTestId('trace-input').setInputFiles(files.map(file => path.resolve('trace_demo', file)))
  await expect(page.locator('.file-entry')).toHaveCount(files.length)
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.timeline-query-loading')).toHaveCount(0)
}

export async function openWorkspace(page: Page, kind: 'single' | 'dual' | 'all' = 'single'): Promise<void> {
  await page.goto('/')
  await page.getByRole('combobox', { name: '导入计算模式', exact: true }).selectOption('megakernel')
  await importTraces(page, kind)
}

export async function openSettings(page: Page, section: '界面主题' | '会话设置' = '界面主题'): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: section, exact: true }).click()
}

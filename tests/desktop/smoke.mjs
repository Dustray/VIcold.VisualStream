import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

if (process.platform !== 'win32') throw new Error('This desktop smoke test currently requires Windows and WebView2.')
const root = fileURLToPath(new URL('../..', import.meta.url))
const replayOnly = process.argv.includes('--replay-only')
const executable = path.resolve(root, process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? 'src-tauri/target/release/visualstream.exe')
await stat(executable).catch(() => { throw new Error('Build the desktop app first: npm run desktop:build') })
const output = path.resolve(root, '.local/desktop-check', String(Date.now()))
await mkdir(output, { recursive: true })
const selectedTrace = path.join(output, '\u63a8\u7406\u8bb0\u5f55 TP2.perfetto-trace')
const savedProject = path.join(output, '\u56de\u653e\u9879\u76ee.vstream.json')
const fixtures = await readdir(path.join(root, 'trace_demo'))
const singleTrace = fixtures.find(name => name.includes('_tp1_') && name.endsWith('.perfetto-trace'))
const dualTrace = fixtures.find(name => name.includes('_tp2_') && name.endsWith('.perfetto-trace'))
assert.ok(singleTrace && dualTrace, 'Trace fixtures are missing')
await copyFile(path.join(root, 'trace_demo', dualTrace), selectedTrace)

const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const endpoint = `http://127.0.0.1:${port}`
const app = spawn(executable, [], {
  cwd: root,
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-data'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? ''} --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appOutput = ''
app.stdout.on('data', bytes => { appOutput += bytes })
app.stderr.on('data', bytes => { appOutput += bytes })
const helpers = new Set()
let browser
let page

function nativeDialog(selectedPath) {
  const argumentsList = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests/desktop/native-dialog.ps1'), '-AppProcessId', String(app.pid)]
  if (selectedPath) argumentsList.push('-SelectedPath', selectedPath)
  else argumentsList.push('-Cancel')
  const helper = spawn('powershell.exe', argumentsList, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  helpers.add(helper)
  let outputText = ''
  helper.stdout.on('data', bytes => { outputText += bytes })
  helper.stderr.on('data', bytes => { outputText += bytes })
  return new Promise((resolve, reject) => {
    helper.once('error', reject)
    helper.once('exit', code => { helpers.delete(helper); code === 0 ? resolve() : reject(new Error(`File dialog automation failed: ${outputText}`)) })
  })
}

async function chooseNativeFile(button, selectedPath) {
  const selected = nativeDialog(selectedPath)
  await Promise.all([button.click(), selected])
}

try {
  await expect.poll(async () => {
    if (app.exitCode !== null) throw new Error(`Desktop exited: ${appOutput}`)
    return fetch(`${endpoint}/json/version`).then(response => response.ok).catch(() => false)
  }, { timeout: 30000 }).toBe(true)
  browser = await chromium.connectOverCDP(endpoint)
  page = browser.contexts()[0].pages()[0]
  assert.ok(page, 'Desktop webview is missing')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForURL(/^https?:\/\/tauri\.localhost\//, { timeout: 30000 })
  await page.locator('.app-shell').waitFor()
  await page.evaluate(() => {
    globalThis.__desktopToasts = []
    new MutationObserver(() => {
      const text = document.querySelector('.toast')?.textContent
      if (text && globalThis.__desktopToasts.at(-1) !== text) globalThis.__desktopToasts.push(text)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  expect(page.url()).toMatch(/^https?:\/\/tauri\.localhost\//)
  await expect(page.locator('.brand')).toHaveText('VisualStream')
  await expect(page.locator('.brand-version')).toHaveCount(0)
  await expect(page.locator('.header-separator')).toHaveText('|')
  await expect(page.getByRole('group', { name: '\u7a97\u53e3\u63a7\u5236' })).toBeVisible()
  assert.equal(await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated', { label: 'main' })), false)
  await page.getByRole('button', { name: '\u6700\u5927\u5316\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }))).toBe(true)
  await expect(page.getByRole('button', { name: '\u8fd8\u539f\u7a97\u53e3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '\u8fd8\u539f\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }))).toBe(false)
  await expect(page.getByRole('button', { name: '\u6700\u5927\u5316\u7a97\u53e3', exact: true })).toBeVisible()
  await expect(page.locator('.file-entry')).toHaveCount(0)
  await expect(page.locator('.speed-value')).toHaveText('0.0001×')
  if (replayOnly) await page.getByTestId('trace-input').setInputFiles(path.join(root, 'trace_demo', singleTrace))
  else await chooseNativeFile(page.getByRole('button', { name: /\u5bfc\u5165 trace \u6587\u4ef6/ }), path.join(root, 'trace_demo', singleTrace))
  await expect(page.locator('.file-entry strong').first()).toHaveText(singleTrace)
  await expect(page.locator('.sidebar-info')).toContainText('128,200', { timeout: 45000 })
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '\u6682\u505c\u91cd\u653e', exact: true })).toBeVisible()
  await page.keyboard.press('Space')

  if (replayOnly) {
    await page.getByTestId('trace-input').setInputFiles(selectedTrace)
    await expect(page.locator('.sidebar-info')).toContainText('350,864', { timeout: 45000 })
    await expect(page.locator('.import-progress')).toHaveCount(0)
    const demo = page.getByRole('checkbox', { name: '20s 演示' })
    const slider = page.getByRole('slider', { name: '重放速度' })
    await expect(demo).not.toBeChecked()
    await demo.check()
    await expect(slider).toBeDisabled()
    await demo.uncheck()
    await expect(slider).toBeEnabled()
    await expect(slider).toHaveAttribute('aria-valuetext', '0.0001×')
    await slider.fill('1')
    await expect(slider).toHaveAttribute('aria-valuetext', '0.00005×')
    const session = page.getByRole('region', { name: '当前会话', exact: true })
    const files = session.getByRole('checkbox')
    await files.first().uncheck()
    await expect(page.locator('.device-section')).toHaveCount(1)
    await files.nth(1).uncheck()
    await expect(page.locator('.device-section')).toHaveCount(0)
    await expect(page.locator('.timeline-footer')).toContainText('0 条展示轨道')
    await expect(page.getByRole('button', { name: '播放重放', exact: true })).toBeDisabled()
    await session.getByRole('button', { name: /当前会话/ }).click()
    await expect(page.locator('#session-file-list')).toBeHidden()
    await session.getByRole('button', { name: /当前会话/ }).click()
    await session.getByRole('button', { name: '全选', exact: true }).click()
    await expect(page.locator('.device-section')).toHaveCount(2)
  } else {
    await chooseNativeFile(page.getByRole('button', { name: /\u5bfc\u5165 trace \u6587\u4ef6/ }))
    await expect(page.locator('.file-entry')).toHaveCount(1)
    await expect(page.locator('.toast.error')).toHaveCount(0)

    await chooseNativeFile(page.getByRole('button', { name: /\u5bfc\u5165 trace \u6587\u4ef6/ }), selectedTrace)
    await expect(page.locator('.sidebar-info')).toContainText('350,864', { timeout: 45000 })
    await expect(page.locator('.import-progress')).toHaveCount(0)
    await expect(page.locator('.file-entry')).toHaveCount(2)
    await expect(page.locator('.file-entry')).toContainText(['', '\u63a8\u7406\u8bb0\u5f55 TP2'])

    await chooseNativeFile(page.getByRole('button', { name: '\u4fdd\u5b58\u9879\u76ee', exact: true }), savedProject)
    await expect.poll(() => readFile(savedProject, 'utf8').catch(() => '')).not.toBe('')
    const project = JSON.parse(await readFile(savedProject, 'utf8'))
    assert.equal(project.version, 1)
    assert.equal(project.sources.length, 2)
    assert.equal(project.sources[1].filename, path.basename(selectedTrace))

    const speedSlider = page.getByRole('slider', { name: '\u91cd\u653e\u901f\u5ea6' })
    const savedRateText = await speedSlider.getAttribute('aria-valuetext')
    assert.ok(savedRateText)
    await speedSlider.fill('8')
    await expect(speedSlider).not.toHaveAttribute('aria-valuetext', savedRateText)
    await chooseNativeFile(page.getByRole('button', { name: '\u6253\u5f00\u9879\u76ee', exact: true }), savedProject)
    await expect(page.locator('.toast')).toContainText('\u5df2\u6062\u590d')
    await expect(speedSlider).toHaveAttribute('aria-valuetext', savedRateText)
    await expect(page.locator('.toast.error')).toHaveCount(0)
  }
  await page.reload()
  await expect(page.locator('.file-entry')).toHaveCount(0)
  await expect(page.locator('.history-entry')).toHaveCount(2)
  await page.getByRole('button', { name: `打开历史文件 ${singleTrace}`, exact: true }).click()
  await expect(page.locator('.sidebar-info')).toContainText('128,200', { timeout: 45000 })
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'desktop.png') })
  await page.setViewportSize({ width: 1040, height: 800 })
  assert.equal(await page.locator('.app-header').evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await expect(page.locator('.app-header')).toHaveCSS('height', '40px')
  await expect(page.locator('.app-header').getByRole('combobox', { name: '界面主题' })).toHaveCount(0)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('combobox', { name: '界面主题' }).selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await settings.getByRole('tab', { name: '会话设置', exact: true }).click()
  await expect(settings.locator('.source-offset')).toHaveCount(1)
  await page.screenshot({ path: path.join(output, 'desktop-settings.png') })
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()
  const viewportLabel = page.locator('.timeline-heading-actions > span').first()
  const fullViewport = await viewportLabel.textContent()
  await page.keyboard.down('w')
  await page.evaluate(() => new Promise(resolve => {
    const end = performance.now() + 400
    const frame = wall => { if (wall >= end) resolve(); else requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  }))
  await page.keyboard.up('w')
  await expect(page.locator('.timeline-overlay')).toHaveAttribute('aria-busy', 'false')
  assert.ok(Number.parseFloat(await viewportLabel.textContent()) < Number.parseFloat(fullViewport) * 0.65)
  await page.keyboard.press('f')
  await expect(viewportLabel).toHaveText(fullViewport)
  await page.getByRole('button', { name: 'CU 利用率', exact: true }).click()
  const utilization = page.getByRole('region', { name: 'CU 利用率统计' })
  await expect(utilization).toHaveAttribute('aria-busy', 'false')
  await expect(utilization.getByRole('meter')).toHaveCount(76)
  const meter = utilization.getByRole('meter').nth(20)
  await meter.hover()
  const beforeWheel = await utilization.evaluate(element => element.scrollTop)
  await page.mouse.wheel(0, 240)
  await expect.poll(() => utilization.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeWheel + 100)
  await meter.hover()
  const afterWheel = await utilization.evaluate(element => element.scrollTop)
  await page.mouse.wheel(0, -180)
  await expect.poll(() => utilization.evaluate(element => element.scrollTop)).toBeLessThan(afterWheel - 100)
  await page.getByRole('button', { name: '资源矩阵', exact: true }).click()
  const upperPanel = page.locator('.upper-workspace')
  const upperHeight = (await upperPanel.boundingBox()).height
  const timelineHeight = (await page.locator('.timeline-overlay').boundingBox()).height
  await page.getByRole('button', { name: '最大化时间轴面板', exact: true }).click()
  await expect(upperPanel).toBeHidden()
  assert.ok((await page.locator('.timeline-overlay').boundingBox()).height > timelineHeight + 200)
  assert.equal(await page.locator('.playback-bar').evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: path.join(output, 'desktop-timeline-maximized.png') })
  await page.getByRole('button', { name: '还原时间轴面板', exact: true }).click()
  await expect(upperPanel).toBeVisible()
  assert.ok(Math.abs((await upperPanel.boundingBox()).height - upperHeight) < 1)
  const closeButton = await page.locator('.window-close').boundingBox()
  assert.ok(closeButton && closeButton.x + closeButton.width <= 1040)
  await page.screenshot({ path: path.join(output, 'desktop-1040.png') })
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: '\u6700\u5c0f\u5316\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }))).toBe(true)
  await page.evaluate(() => document.querySelector('.window-close').click()).catch(() => {})
  await expect.poll(() => app.exitCode, { timeout: 10000 }).not.toBeNull()
  console.log(`Desktop ${replayOnly ? 'replay' : 'full'} smoke passed: ${replayOnly ? 'packaged parser, empty startup, window controls, playback, speed presets, demo mode, file selection, collapsing sections and persistent history' : 'native dialogs, unicode paths, project save and restore, window controls and persistent history'}. Artifacts: ${output}`)
} catch (error) {
  if (page && !page.isClosed()) {
    console.error('Desktop state:', JSON.stringify(await page.evaluate(() => ({ toasts: globalThis.__desktopToasts, progress: document.querySelector('.import-progress')?.textContent, footer: document.querySelector('.app-footer')?.textContent })).catch(() => 'webview is navigating'), null, 2))
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  }
  throw error
} finally {
  for (const helper of helpers) helper.kill()
  await browser?.close().catch(() => {})
  app.kill()
}

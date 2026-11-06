import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

if (process.platform !== 'win32') throw new Error('This desktop smoke test currently requires Windows and WebView2.')
const root = fileURLToPath(new URL('../..', import.meta.url))
const executable = path.resolve(root, process.argv[2] ?? 'src-tauri/target/release/visualstream.exe')
await stat(executable).catch(() => { throw new Error('Build the desktop app first: npm run desktop:build') })
const output = path.resolve(root, '.local/desktop-check', String(Date.now()))
await mkdir(output, { recursive: true })
const selectedTrace = path.join(output, '\u63a8\u7406\u8bb0\u5f55 TP2.perfetto-trace')
const savedProject = path.join(output, '\u56de\u653e\u9879\u76ee.vstream.json')
const samples = JSON.parse(await readFile(path.join(root, 'public/samples/manifest.json'), 'utf8')).files
const sample = samples.find(file => file.name.includes('_tp2_'))
assert.ok(sample, 'TP2 sample was not prepared')
await copyFile(path.join(root, 'trace_demo', sample.name), selectedTrace)

const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const endpoint = `http://127.0.0.1:${port}`
const app = spawn(executable, [], {
  cwd: root,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? ''} --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
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
  await expect(page.locator('.brand-version')).toHaveText('DESKTOP')
  await expect(page.getByRole('group', { name: '\u7a97\u53e3\u63a7\u5236' })).toBeVisible()
  assert.equal(await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated', { label: 'main' })), false)
  await page.getByRole('button', { name: '\u6700\u5927\u5316\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }))).toBe(true)
  await expect(page.getByRole('button', { name: '\u8fd8\u539f\u7a97\u53e3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '\u8fd8\u539f\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }))).toBe(false)
  await expect(page.getByRole('button', { name: '\u6700\u5927\u5316\u7a97\u53e3', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar-info')).toContainText('128,200', { timeout: 45000 })
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '\u6682\u505c\u91cd\u653e', exact: true })).toBeVisible()
  await page.keyboard.press('Space')

  const canceled = nativeDialog()
  await Promise.all([page.getByRole('button', { name: /\u5bfc\u5165 trace \u6587\u4ef6/ }).click(), canceled])
  await expect(page.locator('.file-entry')).toHaveCount(1)
  await expect(page.locator('.toast.error')).toHaveCount(0)

  const opened = nativeDialog(selectedTrace)
  await Promise.all([page.getByRole('button', { name: /\u5bfc\u5165 trace \u6587\u4ef6/ }).click(), opened])
  await expect(page.locator('.sidebar-info')).toContainText('350,864', { timeout: 45000 })
  await expect(page.locator('.import-progress')).toHaveCount(0)
  await expect(page.locator('.file-entry')).toHaveCount(2)
  await expect(page.locator('.file-entry')).toContainText(['', '\u63a8\u7406\u8bb0\u5f55 TP2'])

  const saved = nativeDialog(savedProject)
  await Promise.all([page.getByRole('button', { name: '\u4fdd\u5b58\u9879\u76ee', exact: true }).click(), saved])
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
  const restored = nativeDialog(savedProject)
  await Promise.all([page.getByRole('button', { name: '\u6253\u5f00\u9879\u76ee', exact: true }).click(), restored])
  await expect(page.locator('.toast')).toContainText('\u5df2\u6062\u590d')
  await expect(speedSlider).toHaveAttribute('aria-valuetext', savedRateText)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'desktop.png') })
  await page.setViewportSize({ width: 1040, height: 800 })
  assert.equal(await page.locator('.app-header').evaluate(element => element.scrollWidth <= element.clientWidth), true)
  const closeButton = await page.locator('.window-close').boundingBox()
  assert.ok(closeButton && closeButton.x + closeButton.width <= 1040)
  await page.screenshot({ path: path.join(output, 'desktop-1040.png') })
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: '\u6700\u5c0f\u5316\u7a97\u53e3', exact: true }).click()
  await expect.poll(() => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }))).toBe(true)
  await page.evaluate(() => document.querySelector('.window-close').click()).catch(() => {})
  await expect.poll(() => app.exitCode, { timeout: 10000 }).not.toBeNull()
  console.log(`Desktop smoke passed: packaged resources, frameless window controls, playback, cancel, native trace import, unicode paths, project save and restore. Artifacts: ${output}`)
} catch (error) {
  if (page && !page.isClosed()) {
    console.error('Desktop state:', await page.evaluate(() => ({ toasts: globalThis.__desktopToasts, progress: document.querySelector('.import-progress')?.textContent, footer: document.querySelector('.app-footer')?.textContent })).catch(() => 'webview is navigating'))
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  }
  throw error
} finally {
  for (const helper of helpers) helper.kill()
  await browser?.close().catch(() => {})
  app.kill()
}

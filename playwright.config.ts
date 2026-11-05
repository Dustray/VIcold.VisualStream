import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1600, height: 1000 }, headless: true, launchOptions: existsSync(edge) ? { executablePath: edge } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30000 },
})

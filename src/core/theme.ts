import { ref } from 'vue'
import { eventColor as baseEventColor, palette } from './time'

export type ThemePreference = 'classic' | 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const dark = {
  'surface-base': '#111722',
  'surface-panel': '#18212f',
  'surface-raised': '#202c3e',
  'surface-hover': '#2a3b53',
  'surface-selected': '#2d4569',
  'text-primary': '#f0f4fc',
  'text-secondary': '#d0dbea',
  'text-muted': '#a9b8cd',
  'border': '#3d4d65',
  'border-strong': '#61738d',
  'accent': '#a9c7ff',
  'on-accent': '#0e213f',
  'success': '#8be3c3',
  'warning': '#f4cf88',
  'danger': '#ffb4be',
  'success-background': '#173d34',
  'warning-background': '#352c1b',
  'danger-background': '#392532',
  'selection-fill': '#a9c7ff1a',
  'selection-stroke': '#a9c7ffb0',
  'canvas-background': '#101722',
  'canvas-panel': '#1a2433',
  'canvas-grid': '#2d3b50',
  'canvas-label': '#e1eaf7',
  'canvas-muted': '#b4c3d9',
  'operator-ink': '#0f1827',
  'scrollbar': '#61738d',
  'backdrop': '#050a12cc',
  'drop-background': '#102743f0',
}
type ThemeToken = keyof typeof dark
const light: Record<ThemeToken, string> = {
  'surface-base': '#f2f5fa',
  'surface-panel': '#ffffff',
  'surface-raised': '#eaf0f8',
  'surface-hover': '#e2ebf7',
  'surface-selected': '#d6e5ff',
  'text-primary': '#16243a',
  'text-secondary': '#2c3e56',
  'text-muted': '#52657d',
  'border': '#c7d2e1',
  'border-strong': '#94a7c0',
  'accent': '#2458a6',
  'on-accent': '#ffffff',
  'success': '#14765b',
  'warning': '#8e5d09',
  'danger': '#a52b49',
  'success-background': '#e0f3eb',
  'warning-background': '#fff2d6',
  'danger-background': '#fce9ef',
  'selection-fill': '#2458a61a',
  'selection-stroke': '#2458a6b0',
  'canvas-background': '#f8fafd',
  'canvas-panel': '#edf2f9',
  'canvas-grid': '#dde5ef',
  'canvas-label': '#20324c',
  'canvas-muted': '#52657d',
  'operator-ink': '#ffffff',
  'scrollbar': '#94a7c0',
  'backdrop': '#17263e66',
  'drop-background': '#edf4fff0',
}
const lightOperators = ['#2959a4', '#147866', '#7041a6', '#975b12', '#aa375e', '#106b8f', '#626b0d', '#4d5796']
export const themePreference = ref<ThemePreference>('classic')
export const resolvedTheme = ref<ResolvedTheme>('classic')
let systemTheme: MediaQueryList | null = null

export function themeColor(token: ThemeToken, fallback: string): string {
  return resolvedTheme.value === 'classic' ? fallback : (resolvedTheme.value === 'light' ? light : dark)[token]
}

export function operatorColor(name: string): string {
  const color = baseEventColor(name)
  return resolvedTheme.value === 'light' ? lightOperators[palette.indexOf(color)]! : color
}

export function operatorOpacity(selected = false): string {
  return resolvedTheme.value === 'classic' ? selected ? 'e0' : 'b0' : 'ff'
}

function applyTheme(): void {
  const next = themePreference.value === 'system' ? systemTheme?.matches ? 'dark' : 'light' : themePreference.value
  const root = document.documentElement
  for (const token of Object.keys(dark) as ThemeToken[]) {
    if (next === 'classic') root.style.removeProperty(`--vs-${token}`)
    else root.style.setProperty(`--vs-${token}`, (next === 'light' ? light : dark)[token])
  }
  root.style.colorScheme = next === 'light' ? 'light' : 'dark'
  root.dataset.theme = next
  root.dataset.themePreference = themePreference.value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'classic' ? '#0c0f16' : next === 'light' ? light['surface-base'] : dark['surface-base'])
  resolvedTheme.value = next
}

export function setThemePreference(value: string): void {
  if (!['classic', 'light', 'dark', 'system'].includes(value)) return
  themePreference.value = value as ThemePreference
  applyTheme()
  try { localStorage.setItem('visualstream.theme', value) } catch {}
}

function systemChanged(): void { if (themePreference.value === 'system') applyTheme() }
function storageChanged(event: StorageEvent): void {
  if (event.key !== 'visualstream.theme' && event.key !== null) return
  const value = event.newValue ?? 'classic'
  themePreference.value = ['classic', 'light', 'dark', 'system'].includes(value) ? value as ThemePreference : 'classic'
  applyTheme()
}

export function initializeTheme(): void {
  if (systemTheme) return
  systemTheme = matchMedia('(prefers-color-scheme: dark)')
  try {
    const stored = localStorage.getItem('visualstream.theme')
    if (stored && ['classic', 'light', 'dark', 'system'].includes(stored)) themePreference.value = stored as ThemePreference
  } catch {}
  applyTheme()
  systemTheme.addEventListener('change', systemChanged)
  window.addEventListener('storage', storageChanged)
}

if (import.meta.hot) import.meta.hot.dispose(() => { systemTheme?.removeEventListener('change', systemChanged); window.removeEventListener('storage', storageChanged) })

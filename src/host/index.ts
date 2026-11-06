import { browserHost } from './browser'
import type { WorkspaceHost } from './types'

let host: WorkspaceHost = browserHost

export function workspaceHost(): WorkspaceHost { return host }
export function setWorkspaceHost(value: WorkspaceHost): void { host = value }

export async function initializeHost(): Promise<void> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (isTauri()) {
    const { desktopHost } = await import('./tauri')
    setWorkspaceHost(desktopHost)
  }
}

import type { WorkspaceHost } from './types'

export const browserHost: WorkspaceHost = {
  kind: 'browser',
  async saveProjectFile(content, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  },
}

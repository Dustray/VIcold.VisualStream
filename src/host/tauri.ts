import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { projectFileLimit, projectFileLimitMessage, traceFileLimit, traceFileLimitMessage } from '../core/files'
import type { WorkspaceHost } from './types'

async function readPickedFile(path: string, limit: number, limitMessage: string): Promise<File> {
  const metadata = await stat(path)
  if (!metadata.isFile) throw new Error('请选择文件，不能打开目录。')
  if (metadata.size > limit) throw new Error(limitMessage)
  const bytes = await readFile(path)
  if (bytes.byteLength > limit) throw new Error(limitMessage)
  const filename = path.split(/[\\/]/).pop() || 'untitled'
  return new File([bytes], filename, { lastModified: metadata.mtime?.getTime() ?? Date.now() })
}

export const desktopHost: WorkspaceHost = {
  kind: 'desktop',
  window: {
    minimize: () => getCurrentWindow().minimize(),
    toggleMaximize: () => getCurrentWindow().toggleMaximize(),
    close: () => getCurrentWindow().close(),
    isMaximized: () => getCurrentWindow().isMaximized(),
    onResized: listener => getCurrentWindow().onResized(listener),
  },
  async openTraceFiles() {
    const paths = await open({ title: '导入推理记录', multiple: true, directory: false, filters: [{ name: 'Perfetto trace', extensions: ['perfetto-trace', 'pftrace', 'trace', 'pb'] }] })
    if (!paths) return null
    const files: File[] = []
    for (const path of paths) files.push(await readPickedFile(path, traceFileLimit, traceFileLimitMessage))
    return files
  },
  async openProjectFile() {
    const path = await open({ title: '打开 VisualStream 项目', multiple: false, directory: false, filters: [{ name: 'VisualStream 项目', extensions: ['json'] }] })
    return path ? readPickedFile(path, projectFileLimit, projectFileLimitMessage) : null
  },
  async saveProjectFile(content, filename) {
    const path = await save({ title: '保存 VisualStream 项目', defaultPath: filename, filters: [{ name: 'VisualStream 项目', extensions: ['json'] }] })
    if (!path) return false
    await writeTextFile(path, content)
    return true
  },
}

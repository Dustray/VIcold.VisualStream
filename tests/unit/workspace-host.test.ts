import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { browserHost } from '../../src/host/browser'
import { desktopHost } from '../../src/host/tauri'
import { initializeHost, setWorkspaceHost, workspaceHost } from '../../src/host'
import { projectFileLimit, traceFileLimit } from '../../src/core/files'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), stat: vi.fn(), writeTextFile: vi.fn() }))

describe('workspace hosts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setWorkspaceHost(browserHost)
    vi.mocked(stat).mockResolvedValue({ isFile: true, size: 3, mtime: new Date('2026-11-06T00:00:00Z') } as Awaited<ReturnType<typeof stat>>)
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([10, 1, 3]))
  })

  afterEach(() => { vi.unstubAllGlobals(); setWorkspaceHost(browserHost) })

  it('keeps browser file inputs independent of desktop APIs and accepts another host', async () => {
    await initializeHost()
    expect(workspaceHost()).toBe(browserHost)
    expect(workspaceHost().openTraceFiles).toBeUndefined()
    expect(workspaceHost().openProjectFile).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
    const extensionHost = { kind: 'vscode' as const, saveProjectFile: vi.fn().mockResolvedValue(true) }
    setWorkspaceHost(extensionHost)
    expect(workspaceHost()).toBe(extensionHost)
  })

  it('loads the desktop adapter only inside Tauri', async () => {
    vi.stubGlobal('isTauri', true)
    await initializeHost()
    expect(workspaceHost()).toBe(desktopHost)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens several traces preserving unicode names, bytes and timestamps', async () => {
    vi.mocked(open).mockResolvedValue(['D:\\推理记录\\卡 0.perfetto-trace', 'D:\\推理记录\\卡 1.pb'])
    const files = await desktopHost.openTraceFiles!()
    expect(files?.map(file => file.name)).toEqual(['卡 0.perfetto-trace', '卡 1.pb'])
    expect(files?.[0]?.lastModified).toBe(Date.parse('2026-11-06T00:00:00Z'))
    expect(new Uint8Array(await files![0]!.arrayBuffer())).toEqual(new Uint8Array([10, 1, 3]))
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, directory: false }))
  })

  it('treats canceling open and save as no operation', async () => {
    vi.mocked(open).mockResolvedValue(null)
    vi.mocked(save).mockResolvedValue(null)
    expect(await desktopHost.openTraceFiles!()).toBeNull()
    expect(await desktopHost.openProjectFile!()).toBeNull()
    expect(await desktopHost.saveProjectFile('{}', 'replay.vstream.json')).toBe(false)
    expect(stat).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('rejects oversized traces before transferring them across IPC', async () => {
    vi.mocked(open).mockResolvedValue(['D:\\huge.trace'])
    vi.mocked(stat).mockResolvedValue({ isFile: true, size: traceFileLimit + 1 } as Awaited<ReturnType<typeof stat>>)
    await expect(desktopHost.openTraceFiles!()).rejects.toThrow('1 GB')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('rejects directories and propagates read failures', async () => {
    vi.mocked(open).mockResolvedValue('D:\\project.json')
    vi.mocked(stat).mockResolvedValueOnce({ isFile: false, size: 0 } as Awaited<ReturnType<typeof stat>>)
    await expect(desktopHost.openProjectFile!()).rejects.toThrow('不能打开目录')
    expect(readFile).not.toHaveBeenCalled()
    vi.mocked(readFile).mockRejectedValueOnce(new Error('file was removed'))
    await expect(desktopHost.openProjectFile!()).rejects.toThrow('file was removed')
  })

  it('opens projects and enforces their smaller size limit even if the file grows', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/项目.vstream.json')
    vi.mocked(readFile).mockResolvedValueOnce(new TextEncoder().encode('{"version":1}'))
    const file = await desktopHost.openProjectFile!()
    expect(file?.name).toBe('项目.vstream.json')
    expect(await file?.text()).toBe('{"version":1}')
    vi.mocked(readFile).mockResolvedValueOnce(new Uint8Array(projectFileLimit + 1))
    await expect(desktopHost.openProjectFile!()).rejects.toThrow('4 MB')
  })

  it('writes the selected path exactly and exposes write failures', async () => {
    vi.mocked(save).mockResolvedValue('D:\\项目\\回放.vstream.json')
    const content = '{"version":1,"time":"9007199254740993"}'
    expect(await desktopHost.saveProjectFile(content, 'visualstream.vstream.json')).toBe(true)
    expect(writeTextFile).toHaveBeenCalledWith('D:\\项目\\回放.vstream.json', content)
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('disk full'))
    await expect(desktopHost.saveProjectFile(content, 'visualstream.vstream.json')).rejects.toThrow('disk full')
  })
})

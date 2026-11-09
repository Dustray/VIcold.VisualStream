import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import { useSessionsStore } from '../../src/stores/sessions'
import type { ParsedTraceSource, ProjectSnapshot, RawTrack } from '../../src/core/types'

const storage = vi.hoisted(() => ({ files: new Map<string, File>(), open: vi.fn() }))
vi.mock('../../src/core/worker-source', () => ({ WorkerTraceSource: { open: storage.open } }))
vi.mock('../../src/core/file-history', () => ({
  readFileHistory: async () => [],
  readHistoryFile: async (fingerprint: string) => storage.files.get(fingerprint) ?? null,
  rememberFile: async (file: File, fingerprint: string, parserId: string, computeModelId: string) => {
    storage.files.set(fingerprint, file)
    return { filename: file.name, fingerprint, bytes: file.size, parserId, computeModelId, lastModified: 0, openedAt: 0 }
  },
  forgetFile: async (fingerprint: string) => { storage.files.delete(fingerprint) },
}))

const tracks: RawTrack[] = [{ id: 0, parentId: null, name: 'block_0' }, { id: 1, parentId: 0, name: 'group_0' }]
function source(filename = 'gpu0.trace', fingerprint = 'a'.repeat(64)): ParsedTraceSource {
  return {
    metadata: { id: crypto.randomUUID(), filename, fingerprint, bytes: 10, parserId: 'perfetto', parserVersion: '1', start: 1000n, end: 100001000n, eventCount: 1, trackCount: 2, counterCount: 0, incompleteCount: 0, engineVersion: 'test' },
    tracks: vi.fn(async () => tracks), events: async () => ({ events: [], truncated: false }), density: async () => [],
    statistics: async () => ({ count: 1, sumDuration: 1000n, unionDuration: 1000n }), groupedStatistics: async () => [], activity: async () => [], search: async () => [], boundary: async () => null, args: async () => ({}), close: vi.fn(),
  }
}
function project(): ProjectSnapshot {
  return { version: 1, computeModel: { id: 'megakernel', version: '1' }, sources: [{ filename: 'gpu0.trace', fingerprint: 'a'.repeat(64), parser: { id: 'perfetto', version: '1' }, offset: '0' }], time: '12000000', speed: 0.0005, viewport: { start: '10000000', end: '40000000' }, selection: { start: '11000000', end: '15000000' }, loop: true, bookmarks: [{ id: 'saved', label: 'saved', time: '12000000' }] }
}

describe('independent replay sessions', () => {
  let pinia: Pinia
  let sessions: ReturnType<typeof useSessionsStore>
  beforeEach(() => {
    vi.useFakeTimers()
    storage.files.clear()
    storage.open.mockReset().mockImplementation(async (file: File) => source(file.name, file.name.includes('gpu1') ? 'b'.repeat(64) : 'a'.repeat(64)))
    pinia = createPinia()
    setActivePinia(pinia)
    sessions = useSessionsStore()
  })
  afterEach(() => { sessions.dispose(); vi.clearAllTimers(); vi.useRealTimers() })

  it('starts every new session in default mode with generic task and density views', () => {
    for (const session of [sessions.activeSession, sessions.createSession()]) {
      expect(session.store.computeModelId).toBe('default')
      expect(session.store.supportsCu).toBe(false)
      expect(session.store.activeView).toBe('tasks')
      expect(session.store.overviewMetric).toBe('density')
    }
  })

  it('retains timeline data across tabs and releases it when its source or session closes', async () => {
    const first = sessions.activeSession
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const request = { source: first.store.sources[0]!, range: { ...first.store.bounds }, trackIds: [1], resolution: 1, density: false }
    await first.store.timelineCache.load(request)
    sessions.createSession()
    sessions.activate(first.id)
    expect(first.store.timelineCache.covers(request)).toBe(true)
    await first.store.setComputeModel('megakernel')
    expect(first.store.timelineCache.covers(request)).toBe(false)
    const changed = { ...request, source: first.store.sources[0]! }
    await first.store.timelineCache.load(changed)
    sessions.close(first.id)
    expect(first.store.timelineCache.covers(changed)).toBe(false)
  })

  it('retains files, viewport, selection, speed and bookmarks while pausing inactive playback', async () => {
    const first = sessions.activeSession
    await first.store.importFiles([new File(['one'], 'gpu0.trace'), new File(['two'], 'gpu1.trace')])
    first.store.seek(20000000n)
    first.store.setViewport({ start: 10000000n, end: 40000000n })
    first.store.setSelection({ start: 15000000n, end: 25000000n })
    first.store.clock.setSpeed(0.0005)
    first.store.addBookmark()
    first.store.activeView = 'tasks'
    first.store.clock.play()
    const second = sessions.createSession()
    expect(first.store.playing).toBe(false)
    expect(second.store.sources).toHaveLength(0)
    await second.store.importFiles([new File(['one'], 'gpu0.trace')])
    second.store.seek(5000000n)
    expect(second.store.sources[0]!.source).not.toBe(first.store.sources[0]!.source)
    sessions.activate(first.id)
    expect(first.store.sources).toHaveLength(2)
    expect(first.store.currentTime).toBe(20000000n)
    expect(first.store.viewport).toEqual({ start: 10000000n, end: 40000000n })
    expect(first.store.selection).toEqual({ start: 15000000n, end: 25000000n })
    expect(first.store.speed).toBe(0.0005)
    expect(first.store.bookmarks).toHaveLength(1)
    expect(first.store.activeView).toBe('tasks')
    expect(storage.open).toHaveBeenCalledTimes(3)
    expect(second.store.currentTime).toBe(5000000n)
    expect(second.store.bookmarks).toHaveLength(0)
  })

  it('releases only the closed session and creates an empty session when the last tab closes', async () => {
    const first = sessions.activeSession
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const raw = first.store.sources[0]!.source
    const second = sessions.createSession()
    await second.store.importFiles([new File(['two'], 'gpu1.trace')])
    sessions.close(first.id)
    expect(raw.close).toHaveBeenCalledOnce()
    expect(pinia.state.value[first.store.$id]).toBeUndefined()
    expect(second.store.sources[0]!.source.close).not.toHaveBeenCalled()
    expect(sessions.activeId).toBe(second.id)
    sessions.close(second.id)
    expect(sessions.sessions).toHaveLength(1)
    expect(sessions.activeSession.id).not.toBe(second.id)
    expect(sessions.activeSession.store.sources).toHaveLength(0)
  })

  it('shares local history while keeping imported worker ownership separate', async () => {
    const first = sessions.activeSession
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const second = sessions.createSession()
    expect(second.store.historyFiles).toHaveLength(1)
    await second.store.openHistory('a'.repeat(64))
    expect(second.store.sources).toHaveLength(1)
    expect(storage.open).toHaveBeenCalledTimes(2)
    await second.store.removeHistory('a'.repeat(64))
    expect(first.store.historyFiles).toHaveLength(0)
    expect(first.store.sources).toHaveLength(1)
    expect(second.store.sources).toHaveLength(1)
  })

  it('finishes a background import in its original session without stealing the active tab', async () => {
    const first = sessions.activeSession
    let finish!: (value: ParsedTraceSource) => void
    storage.open.mockImplementationOnce(() => new Promise<ParsedTraceSource>(resolve => { finish = resolve }))
    const importing = first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const second = sessions.createSession()
    finish(source())
    await importing
    expect(sessions.activeId).toBe(second.id)
    expect(second.store.sources).toHaveLength(0)
    expect(first.store.sources).toHaveLength(1)
  })

  it('discards a parser that resolves after its session was closed', async () => {
    let finish!: (value: ParsedTraceSource) => void
    storage.open.mockImplementationOnce(() => new Promise<ParsedTraceSource>(resolve => { finish = resolve }))
    const first = sessions.activeSession
    const importing = first.store.importFiles([new File(['one'], 'gpu0.trace')])
    sessions.close(first.id)
    const raw = source()
    finish(raw)
    await importing
    expect(raw.close).toHaveBeenCalledOnce()
    expect(first.store.sources).toHaveLength(0)
    expect(sessions.activeSession.store.sources).toHaveLength(0)
  })

  it('closes a source during model construction and ignores its late tracks', async () => {
    await sessions.activeSession.store.setComputeModel('megakernel')
    const raw = source()
    let finish!: (value: RawTrack[]) => void
    raw.tracks = vi.fn(() => new Promise<RawTrack[]>(resolve => { finish = resolve }))
    storage.open.mockResolvedValueOnce(raw)
    const first = sessions.activeSession
    const importing = first.store.importFiles([new File(['one'], 'gpu0.trace')])
    await nextTick()
    expect(raw.tracks).toHaveBeenCalledOnce()
    sessions.close(first.id)
    expect(raw.close).toHaveBeenCalledOnce()
    raw.tracks = async () => tracks
    finish(tracks)
    await importing
    expect(first.store.sources).toHaveLength(0)
    expect(sessions.activeSession.store.sources).toHaveLength(0)
  })

  it('opens a saved project in a new tab and restores it from shared history', async () => {
    const first = sessions.activeSession
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    first.store.seek(30000000n)
    await sessions.openProject(new File([JSON.stringify(project())], '分析项目.vstream.json'))
    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.activeSession.name).toBe('分析项目')
    expect(sessions.activeSession.store.currentTime).toBe(12000000n)
    expect(sessions.activeSession.store.selection).toEqual({ start: 11000000n, end: 15000000n })
    expect(sessions.activeSession.store.looping).toBe(true)
    expect(first.store.currentTime).toBe(30000000n)
    expect(first.store.sources[0]!.source.close).not.toHaveBeenCalled()
  })

  it('reinterprets existing files without reopening workers and preserves the replay coordinates', async () => {
    const store = sessions.activeSession.store
    await sessions.activeSession.store.setComputeModel('megakernel')
    await store.importFiles([new File(['one'], 'gpu0.trace'), new File(['two'], 'gpu1.trace')])
    store.seek(20000000n)
    store.setViewport({ start: 10000000n, end: 40000000n })
    store.setSelection({ start: 15000000n, end: 25000000n })
    store.addBookmark()
    store.toggleSource(store.sources[1]!.source.metadata.id)
    const raw = store.sources.map(model => model.source)
    expect(await store.setComputeModel('default')).toBe(true)
    expect(store.supportsCu).toBe(false)
    expect(store.sources.every(model => model.device === null)).toBe(true)
    expect(store.activeView).toBe('tasks')
    expect(store.overviewMetric).toBe('density')
    expect(store.rows.filter(row => row.kind === 'track')).toHaveLength(2)
    expect(store.currentTime).toBe(20000000n)
    expect(store.viewport).toEqual({ start: 10000000n, end: 40000000n })
    expect(store.selection).toEqual({ start: 15000000n, end: 25000000n })
    expect(store.bookmarks).toHaveLength(1)
    expect(store.selectedSources).toHaveLength(1)
    expect(await store.setComputeModel('megakernel')).toBe(true)
    expect(store.supportsCu).toBe(true)
    expect(store.activeView).toBe('resources')
    expect(store.overviewMetric).toBe('utilization')
    expect(storage.open).toHaveBeenCalledTimes(2)
    for (const source of raw) expect(source.close).not.toHaveBeenCalled()
  })

  it('uses the selected default mode for history and restores the mode from a project', async () => {
    const first = sessions.activeSession
    await sessions.activeSession.store.setComputeModel('megakernel')
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const second = sessions.createSession()
    await second.store.setComputeModel('default')
    await second.store.openHistory('a'.repeat(64))
    expect(second.store.sources[0]!.modelId).toBe('default')
    await sessions.openProject(new File([JSON.stringify({ ...project(), computeModel: { id: 'default', version: '1' } })], 'default.vstream.json'))
    expect(sessions.activeSession.store.computeModelId).toBe('default')
    expect(sessions.activeSession.store.sources[0]!.device).toBeNull()
    expect(sessions.activeSession.store.currentTime).toBe(12000000n)
    expect(first.store.supportsCu).toBe(true)
  })

  it('reveals the raw track of a selected event without manufacturing a CU selection', async () => {
    const store = sessions.activeSession.store
    await store.setComputeModel('default')
    await store.importFiles([new File(['one'], 'gpu0.trace')])
    const sourceId = store.sources[0]!.source.metadata.id
    store.toggleTrack(`${sourceId}/track/0`)
    expect(store.rows.filter(row => row.kind === 'track')).toHaveLength(1)
    await store.selectEvent({ id: 1, sourceId, trackId: 1, name: 'event', depth: 0, argSetId: 0, start: 0n, end: 1000n, incomplete: false })
    expect(store.rows.filter(row => row.kind === 'track')).toHaveLength(2)
    expect(store.selectedCuId).toBeNull()
    expect(store.timelineFocus).toEqual({ sourceId, trackId: 1 })
  })

  it('expands and folds displayed raw tracks without changing hidden files or other sessions', async () => {
    const first = sessions.activeSession
    const store = first.store
    await store.setComputeModel('default')
    await store.importFiles([new File(['one'], 'gpu0.trace'), new File(['two'], 'gpu1.trace')])
    store.setTracksExpanded(false)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0, 1], [0, 1]])
    const hiddenId = store.sources[1]!.source.metadata.id
    store.toggleSource(hiddenId)
    store.setTracksExpanded(true)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0], [1]])
    store.toggleSource(hiddenId)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0], [1], [0, 1]])
    store.setTracksExpanded(false)
    sessions.createSession()
    sessions.activate(first.id)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0, 1], [0, 1]])
    store.setTracksExpanded(true)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0], [1], [0], [1]])
    expect(storage.open).toHaveBeenCalledTimes(2)
  })

  it('reveals the exact nested lane when selecting an event inside a folded process', async () => {
    const store = sessions.activeSession.store
    await store.setComputeModel('default')
    const raw = source()
    raw.tracks = async () => [{ id: -1, parentId: null, name: 'process', virtual: true }, { id: 0, parentId: -1, name: 'thread', maxDepth: 2 }]
    storage.open.mockResolvedValueOnce(raw)
    await store.importFiles([new File(['nested'], 'nested.json.gz')])
    const sourceId = store.sources[0]!.source.metadata.id
    store.setTracksExpanded(false)
    expect(store.rows.filter(row => row.kind === 'track').map(row => row.trackIds)).toEqual([[0]])
    await store.selectEvent({ id: 3, sourceId, trackId: 0, name: 'nested', depth: 2, argSetId: 0, start: 10n, end: 20n, incomplete: false })
    expect(store.timelineFocus).toEqual({ sourceId, trackId: 0, eventDepth: 2 })
    expect(store.rows.find(row => row.id === `${sourceId}/track/0/depth/2`)).toMatchObject({ eventDepth: 2, trackIds: [0] })
  })

  it('keeps the current model and workers if a new interpretation fails', async () => {
    const store = sessions.activeSession.store
    await store.setComputeModel('default')
    const raw = source()
    raw.tracks = async () => [{ id: 1, parentId: null, name: 'ordinary' }]
    storage.open.mockResolvedValueOnce(raw)
    await store.importFiles([new File(['one'], 'ordinary.trace')])
    expect(await store.setComputeModel('megakernel')).toBe(false)
    expect(store.computeModelId).toBe('default')
    expect(store.sources[0]!.source).toBe(raw)
    expect(raw.close).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
    expect(store.toast?.kind).toBe('error')
  })

  it('discards a cancelled or closed mode switch without repopulating the session', async () => {
    const first = sessions.activeSession
    await sessions.activeSession.store.setComputeModel('megakernel')
    await first.store.importFiles([new File(['one'], 'gpu0.trace')])
    const cancelled = first.store.setComputeModel('default')
    first.store.cancelImport()
    expect(await cancelled).toBe(false)
    expect(first.store.computeModelId).toBe('megakernel')
    const closed = first.store.setComputeModel('default')
    sessions.close(first.id)
    expect(await closed).toBe(false)
    expect(first.store.sources).toHaveLength(0)
    expect(sessions.activeSession.store.sources).toHaveLength(0)
  })

  it('reuses an empty tab, rejects invalid projects and ignores closed file-picker targets', async () => {
    const first = sessions.activeSession
    await sessions.openProject(new File(['invalid'], 'bad.json'))
    expect(sessions.sessions).toHaveLength(1)
    expect(first.store.toast?.kind).toBe('error')
    await sessions.openProject(new File([JSON.stringify(project())], 'missing.vstream.json'))
    expect(sessions.sessions).toHaveLength(1)
    expect(sessions.activeSession.name).toBe('missing')
    expect(first.store.pendingProject).not.toBeNull()
    sessions.close(first.id)
    await sessions.openProject(new File([JSON.stringify(project())], 'closed.vstream.json'), first.id)
    expect(sessions.sessions).toHaveLength(1)
    expect(sessions.activeSession.store.pendingProject).toBeNull()
  })
})

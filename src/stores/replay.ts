import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { ComputeModelRegistry } from '../core/registry'
import { WorkerTraceSource } from '../core/worker-source'
import { clampTime, duration, fitRange, formatTime, timeBuckets } from '../core/time'
import { parseProject, persistProject } from '../core/project'
import { defaultPlaybackSpeed, stepPlaybackSpeed } from '../core/playback-speed'
import { projectFileLimit, projectFileLimitMessage } from '../core/files'
import { forgetFile, readFileHistory, readHistoryFile, rememberFile, type HistoryFile } from '../core/file-history'
import { workspaceHost } from '../host'
import type { ActivityBin, Bookmark, ImportProgress, ProjectSnapshot, RangeStatistics, RawTrack, ReplayDataSource, ReplayDensity, ReplayEvent, TimelineRow, TimeRange } from '../core/types'
import { IntervalIndex } from '../engine/interval-index'
import { PlaybackClock } from '../engine/playback-clock'
import { ViewportZoom } from '../engine/viewport-zoom'
import { ViewportPan } from '../engine/viewport-pan'
import { MegakernelModel } from '../models/megakernel'

const modes = new ComputeModelRegistry().register(new MegakernelModel())

export const useReplayStore = defineStore('replay', () => {
  const sources = shallowRef<ReplayDataSource[]>([])
  const computeModelId = ref('megakernel')
  const sourceParserId = ref('perfetto')
  const historyFiles = shallowRef<HistoryFile[]>([])
  const historyLoading = ref(true)
  const selectedSourceIds = ref(new Set<string>())
  const timelineFocus = shallowRef<{ sourceId: string } | null>(null)
  const loading = ref(false)
  const progress = ref<ImportProgress>({ stage: '', fraction: 0 })
  const currentTime = ref(0n)
  const playing = ref(false)
  const buffering = ref(false)
  const speed = ref(defaultPlaybackSpeed)
  const viewport = ref<TimeRange>({ start: 0n, end: 1n })
  const zooming = ref(false)
  const panningViewport = ref(false)
  let zoomPointer: number | null = null
  const selection = ref<TimeRange | null>(null)
  const looping = ref(false)
  const following = ref(true)
  const spaceHeld = ref(false)
  const spaceUsed = ref(false)
  const selectedEvent = shallowRef<ReplayEvent | null>(null)
  const selectedCuId = ref<string | null>(null)
  const selectedDeviceId = ref<string | null>(null)
  const eventArgs = ref<Record<string, string>>({})
  const activeEvents = shallowRef<ReplayEvent[]>([])
  const overview = shallowRef<ReplayDensity[]>([])
  const overviewMetric = ref<'density' | 'utilization'>('utilization')
  const overviewActivity = shallowRef<ActivityBin[]>([])
  const overviewActivityLoading = ref(false)
  const overviewActivityError = ref<string | null>(null)
  const bookmarks = ref<Bookmark[]>([])
  const expandedGroups = ref(new Set<string>())
  const searchText = ref('')
  const searchResults = shallowRef<ReplayEvent[]>([])
  const searching = ref(false)
  const selectionStats = shallowRef<RangeStatistics | null>(null)
  const statisticsLoading = ref(false)
  const toast = ref<{ message: string; kind: 'error' | 'info' } | null>(null)
  const activeView = ref<'resources' | 'tasks' | 'utilization' | 'metrics'>('resources')
  const pendingProject = shallowRef<ProjectSnapshot | null>(null)
  const trackCache = new Map<string, RawTrack[]>()
  const clock = markRaw(new PlaybackClock())
  clock.setSpeed(defaultPlaybackSpeed)
  let importAbort: AbortController | null = null
  let loadGeneration = 0
  let activeGeneration = 0
  let activeTarget: bigint | null = null
  let activeLoading = false
  let activeCache: { range: TimeRange; index: IntervalIndex<ReplayEvent> } | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let searchVersion = 0
  let statisticsVersion = 0
  let overviewVersion = 0
  let overviewActivityVersion = 0

  clock.subscribe(value => { currentTime.value = value.time; playing.value = value.playing; buffering.value = value.buffering; speed.value = value.speed })
  const bounds = computed<TimeRange>(() => sources.value.length ? { start: sources.value.reduce((result, source) => source.range.start < result ? source.range.start : result, sources.value[0]!.range.start), end: sources.value.reduce((result, source) => source.range.end > result ? source.range.end : result, sources.value[0]!.range.end) } : { start: 0n, end: 1n })
  const viewportZoom = markRaw(new ViewportZoom(() => viewport.value, () => bounds.value, range => { viewport.value = range }, active => { zooming.value = active }))
  const viewportPan = markRaw(new ViewportPan(() => viewport.value, () => bounds.value, range => { viewport.value = range }, active => { panningViewport.value = active }))
  watch(bounds, stopZoom, { flush: 'sync' })
  const totalEvents = computed(() => sources.value.reduce((result, source) => result + source.source.metadata.eventCount, 0))
  const selectedSources = computed(() => sources.value.filter(source => selectedSourceIds.value.has(source.source.metadata.id)))
  const displayedSources = computed(() => selectedSources.value.filter(source => !selectedDeviceId.value || source.device.id === selectedDeviceId.value))
  const devices = computed(() => selectedSources.value.map(source => source.device))
  const cus = computed(() => devices.value.flatMap(device => device.cus))
  const displayedDevices = computed(() => displayedSources.value.map(source => source.device))
  const diagnostics = computed(() => [...new Set(sources.value.flatMap(source => source.diagnostics))])
  const activeByCu = computed(() => {
    const result = new Map<string, ReplayEvent[]>()
    for (const event of activeEvents.value) { const items = result.get(event.cuId) ?? []; items.push(event); result.set(event.cuId, items) }
    return result
  })
  const rows = computed<TimelineRow[]>(() => displayedSources.value.flatMap(source => {
    const result: TimelineRow[] = [{ id: source.device.id, kind: 'device', label: source.device.label, subtitle: source.device.rank === null ? 'Megakernel' : `Rank ${source.device.rank}`, sourceId: source.source.metadata.id, trackIds: [] }]
    for (const cu of source.device.cus) for (const group of cu.groups) {
      result.push({ id: group.id, kind: 'group', label: `CU ${String(cu.index).padStart(2, '0')}`, subtitle: `group_${group.index}`, sourceId: source.source.metadata.id, cuId: cu.id, groupId: group.id, trackIds: group.trackIds })
      if (expandedGroups.value.has(group.id)) for (const trackId of group.trackIds) {
        const track = trackCache.get(source.source.metadata.id)?.find(track => track.id === trackId)
        result.push({ id: `${group.id}/track/${trackId}`, kind: 'track', label: track?.name || `轨道 ${trackId}`, subtitle: `#${trackId}`, sourceId: source.source.metadata.id, cuId: cu.id, groupId: group.id, trackIds: [trackId] })
      }
    }
    return result
  }))

  function notify(message: string, kind: 'error' | 'info' = 'info'): void {
    if (toastTimer) clearTimeout(toastTimer)
    toast.value = { message, kind }
    toastTimer = setTimeout(() => { toast.value = null }, kind === 'error' ? 12000 : 4500)
  }
  function reset(): void {
    stopZoom()
    clock.pause()
    activeGeneration++
    activeTarget = null
    activeCache = null
    for (const source of sources.value) source.source.close()
    sources.value = []
    selectedSourceIds.value = new Set()
    clock.configure({ start: 0n, end: 1n })
    viewport.value = { start: 0n, end: 1n }
    trackCache.clear()
    activeEvents.value = []
    overview.value = []
    selectedEvent.value = null
    selectedCuId.value = null
    selectedDeviceId.value = null
    eventArgs.value = {}
    selection.value = null
    bookmarks.value = []
    searchResults.value = []
    searchText.value = ''
    searchVersion++
    statisticsVersion++
    overviewVersion++
    searching.value = false
    statisticsLoading.value = false
    selectionStats.value = null
    expandedGroups.value = new Set()
    looping.value = false
    clock.setLoop(null)
    clock.setBuffering(false)
  }

  async function initialize(): Promise<void> {
    try {
      const saved = await readFileHistory()
      historyFiles.value = [...historyFiles.value, ...saved.filter(file => !historyFiles.value.some(existing => existing.fingerprint === file.fingerprint))].sort((left, right) => right.openedAt - left.openedAt)
    } catch { notify('无法读取本机历史文件，仍可直接导入记录。', 'error') }
    finally { historyLoading.value = false }
  }

  async function importFiles(files: File[], replace = false): Promise<void> {
    importAbort?.abort()
    importAbort = new AbortController()
    const controller = importAbort
    const generation = ++loadGeneration
    const oldTime = currentTime.value
    if (replace) reset()
    clock.pause()
    loading.value = true
    try {
      for (const [index, file] of files.entries()) {
        progress.value = { stage: `导入 ${index + 1}/${files.length} · ${file.name}`, fraction: 0 }
        const source = await WorkerTraceSource.open(file, value => { if (generation === loadGeneration) progress.value = value }, controller.signal, sourceParserId.value)
        if (generation !== loadGeneration) { source.close(); return }
        const existing = sources.value.find(existing => existing.source.metadata.fingerprint === source.metadata.fingerprint)
        if (existing) { source.close(); selectedSourceIds.value.add(existing.source.metadata.id); selectedDeviceId.value = null; notify(`文件已在当前会话中：${file.name}`); continue }
        try {
          const model = await modes.get(computeModelId.value).build(source)
          trackCache.set(source.metadata.id, await source.tracks())
          sources.value = [...sources.value, markRaw(model)]
          selectedSourceIds.value.add(source.metadata.id)
          selectedDeviceId.value = null
          try {
            const history = await rememberFile(file, source.metadata.fingerprint, source.metadata.parserId, computeModelId.value)
            historyFiles.value = [history, ...historyFiles.value.filter(existing => existing.fingerprint !== history.fingerprint)]
          } catch { notify(`文件已导入，但无法保存到历史记录：${file.name}`, 'error') }
        } catch (error) { source.close(); throw error }
      }
      if (!sources.value.length) return
      clock.configure(bounds.value)
      clock.setLoop(looping.value ? selection.value : null)
      viewport.value = { ...bounds.value }
      const target = replace ? bounds.value.start : clampTime(oldTime, bounds.value)
      clock.seek(target)
      progress.value = { stage: '生成全局任务密度', fraction: 0.98 }
      await refreshOverview()
      if (pendingProject.value) applyPendingProject()
      else notify(`已载入 ${sources.value.length} 个来源 · ${cus.value.length} 个 CU · ${totalEvents.value.toLocaleString()} 个事件`)
    } catch (error) { if (!controller.signal.aborted) notify(error instanceof Error ? error.message : String(error), 'error') }
    finally {
      if (generation === loadGeneration) {
        loading.value = false
        progress.value = { stage: '', fraction: 1 }
        void refreshActive(currentTime.value, true)
      }
    }
  }

  function cancelImport(): void {
    importAbort?.abort()
    loadGeneration++
    loading.value = false
    clock.setBuffering(false)
    if (sources.value.length) { clock.configure(bounds.value); fit(); void refreshOverview(); void refreshActive(currentTime.value, true) }
    notify('导入已取消')
  }

  function focusSource(id: string): void {
    const source = sources.value.find(source => source.source.metadata.id === id)
    if (!source) return
    if (!selectedSourceIds.value.has(id)) { notify('请先勾选该文件，再定位到时间轴'); return }
    if (selectedDeviceId.value !== source.device.id) selectedDeviceId.value = null
    timelineFocus.value = { sourceId: id }
  }
  function toggleSource(id: string): void {
    if (selectedSourceIds.value.has(id)) selectedSourceIds.value.delete(id)
    else selectedSourceIds.value.add(id)
    selectedDeviceId.value = null
  }
  function selectAllSources(selected: boolean): void {
    selectedSourceIds.value = new Set(selected ? sources.value.map(source => source.source.metadata.id) : [])
    selectedDeviceId.value = null
  }
  async function openHistory(fingerprint: string): Promise<void> {
    if (loading.value) return
    const existing = sources.value.find(source => source.source.metadata.fingerprint === fingerprint)
    if (existing) { selectedSourceIds.value.add(existing.source.metadata.id); selectedDeviceId.value = null; return }
    const history = historyFiles.value.find(file => file.fingerprint === fingerprint)
    if (!history) return
    try {
      const file = await readHistoryFile(fingerprint)
      if (!file) throw new Error('历史文件已不存在，请重新导入原文件。')
      computeModelId.value = history.computeModelId
      sourceParserId.value = history.parserId
      await importFiles([file])
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error') }
  }
  async function removeHistory(fingerprint: string): Promise<void> {
    try {
      await forgetFile(fingerprint)
      historyFiles.value = historyFiles.value.filter(file => file.fingerprint !== fingerprint)
    } catch (error) { notify(`无法移除历史文件：${error instanceof Error ? error.message : String(error)}`, 'error') }
  }

  watch(displayedSources, () => {
    activeGeneration++
    activeTarget = null
    activeCache = null
    activeEvents.value = []
    const visible = new Set(displayedSources.value.map(source => source.source.metadata.id))
    if (selectedEvent.value && !visible.has(selectedEvent.value.sourceId)) { selectedEvent.value = null; eventArgs.value = {} }
    if (selectedCuId.value && !displayedDevices.value.some(device => device.cus.some(cu => cu.id === selectedCuId.value))) selectedCuId.value = null
    if (!displayedSources.value.length) { clock.pause(); clock.setBuffering(false) }
    else if (!loading.value) void refreshActive(currentTime.value, true)
  })
  watch(selectedSources, () => { if (!loading.value) void refreshOverview() })

  async function refreshOverview(): Promise<void> {
    const version = ++overviewVersion
    try {
      const bins = (await Promise.all(selectedSources.value.map(source => source.density({ ...source.range, buckets: 180 })))).flat()
      if (version === overviewVersion) overview.value = bins
    } catch (error) { if (version === overviewVersion) notify(String(error), 'error') }
  }
  async function refreshOverviewActivity(): Promise<void> {
    if (!selectedSources.value.length || overviewActivity.value.length || overviewActivityLoading.value || loading.value) return
    const version = ++overviewActivityVersion
    const range = { ...bounds.value }
    const models = [...selectedSources.value]
    overviewActivityLoading.value = true
    overviewActivityError.value = null
    try {
      const results = await Promise.all(models.map(source => source.activity(range, 180)))
      if (version !== overviewActivityVersion) return
      const bins = timeBuckets(range, 180).map(bin => ({ ...bin, busyDuration: 0n }))
      for (const result of results) for (const [index, bin] of result.entries()) bins[index]!.busyDuration += bin.busyDuration
      overviewActivity.value = bins
    } catch (error) { if (version === overviewActivityVersion) overviewActivityError.value = error instanceof Error ? error.message : String(error) }
    finally { if (version === overviewActivityVersion) overviewActivityLoading.value = false }
  }
  watch([selectedSources, overviewMetric, loading], ([models], [previousModels]) => {
    if (models !== previousModels) {
      overviewActivityVersion++
      overviewActivity.value = []
      overviewActivityLoading.value = false
      overviewActivityError.value = null
    }
    if (overviewMetric.value === 'utilization') void refreshOverviewActivity()
  })
  function removeSource(id: string): void {
    clock.pause()
    const model = sources.value.find(source => source.source.metadata.id === id)
    model?.source.close()
    sources.value = sources.value.filter(source => source.source.metadata.id !== id)
    selectedSourceIds.value.delete(id)
    trackCache.delete(id)
    activeGeneration++
    activeCache = null
    selectedDeviceId.value = null
    selectedCuId.value = null
    selectedEvent.value = null
    if (sources.value.length) { clock.configure(bounds.value); viewport.value = { ...bounds.value }; void refreshOverview(); void refreshActive(currentTime.value, true) }
    else reset()
  }

  async function refreshActive(time: bigint, force = false): Promise<void> {
    if (!displayedSources.value.length || loading.value) return
    if (time === bounds.value.end) { activeEvents.value = []; clock.setBuffering(false); return }
    if (!force && activeCache && time >= activeCache.range.start && time < activeCache.range.end) { activeEvents.value = activeCache.index.at(time); return }
    activeTarget = time
    clock.setBuffering(true)
    if (activeLoading) return
    activeLoading = true
    try {
      while (activeTarget !== null && displayedSources.value.length) {
        const target = activeTarget
        activeTarget = null
        const generation = activeGeneration
        const width = duration(bounds.value) / 30n > 5_000_000n ? 5_000_000n : duration(bounds.value) / 30n || 1000n
        const range = fitRange({ start: target - width / 4n, end: target + width * 3n / 4n }, bounds.value)
        const pages = await Promise.all(displayedSources.value.map(source => source.events({ ...range, limit: 250000 }))).catch(error => { if (generation !== activeGeneration) return null; throw error })
        if (!pages) continue
        if (generation !== activeGeneration || activeTarget !== null) continue
        if (pages.some(page => page.truncated)) throw new Error('活动窗口超过 25 万事件，请使用更小的记录或后续原生解析后端。')
        activeCache = { range, index: markRaw(new IntervalIndex(pages.flatMap(page => page.events))) }
        activeEvents.value = activeCache.index.at(currentTime.value)
      }
    } catch (error) { clock.pause(); notify(error instanceof Error ? error.message : String(error), 'error') }
    finally { activeLoading = false; clock.setBuffering(false); if (activeTarget !== null && !loading.value) void refreshActive(activeTarget, true) }
  }

  watch(currentTime, time => {
    void refreshActive(time)
    if (playing.value && following.value && !zooming.value && !panningViewport.value && (time < viewport.value.start || time > viewport.value.end - duration(viewport.value) / 10n)) {
      const span = duration(viewport.value)
      setViewport({ start: time - span / 5n, end: time + span * 4n / 5n })
    }
  })
  function seek(time: bigint): void { clock.seek(time) }
  function stepSpeed(direction: -1 | 1): void {
    const next = stepPlaybackSpeed(speed.value, direction)
    if (next !== speed.value) clock.setSpeed(next)
  }
  function stopZoom(): void { viewportZoom.cancel(); viewportPan.cancel() }
  function stopPan(): void { viewportPan.cancel() }
  function setZoomPointer(ratio: number | null): void { zoomPointer = ratio }
  function setViewport(range: TimeRange): void { stopZoom(); viewport.value = fitRange(range, bounds.value) }
  function fit(): void { setViewport(bounds.value) }
  function pan(delta: bigint): void {
    viewportZoom.cancel()
    if (playing.value) following.value = false
    viewportPan.pan(delta)
  }
  function zoom(factor: number, anchor?: bigint): void {
    viewportPan.cancel()
    if (playing.value) following.value = false
    const ratio = anchor === undefined ? zoomPointer ?? 0.5 : Number(anchor - viewport.value.start) / Number(duration(viewport.value))
    viewportZoom.zoom(factor, ratio)
  }
  function zoomSelection(): void {
    const range = selection.value ?? (selectedEvent.value ? { start: selectedEvent.value.start, end: selectedEvent.value.end } : null)
    if (!range) return
    const margin = duration(range) / 10n || 100n
    setViewport({ start: range.start - margin, end: range.end + margin })
  }
  async function selectEvent(event: ReplayEvent): Promise<void> {
    selectedEvent.value = event
    selectedCuId.value = event.cuId
    eventArgs.value = {}
    const source = sources.value.find(source => source.source.metadata.id === event.sourceId)
    if (source && event.argSetId) {
      try {
        const args = await source.source.args(event.argSetId)
        if (selectedEvent.value?.id === event.id && selectedEvent.value.sourceId === event.sourceId) eventArgs.value = args
      } catch (error) { if (sources.value.includes(source)) notify(String(error), 'error') }
    }
  }
  function selectCu(id: string, toggle = false): void {
    if (toggle && selectedCuId.value === id) {
      selectedCuId.value = null
      selectedEvent.value = null
      eventArgs.value = {}
      return
    }
    selectedCuId.value = id
    const event = activeByCu.value.get(id)?.[0]
    if (event) void selectEvent(event)
    else { selectedEvent.value = null; eventArgs.value = {} }
  }
  function toggleGroup(id: string): void { const next = new Set(expandedGroups.value); if (next.has(id)) next.delete(id); else next.add(id); expandedGroups.value = next }
  async function step(direction: -1 | 1): Promise<void> {
    clock.pause()
    try {
      const values = (await Promise.all(displayedSources.value.map(source => source.boundary(currentTime.value, direction)))).filter((value): value is bigint => value !== null)
      const next = values.reduce<bigint | null>((result, value) => result === null || (direction > 0 ? value < result : value > result) ? value : result, null)
      if (next !== null) seek(next)
    } catch (error) { notify(String(error), 'error') }
  }
  function setSelection(range: TimeRange | null): void {
    const clipped = range ? { start: clampTime(range.start, bounds.value), end: clampTime(range.end, bounds.value) } : null
    selection.value = clipped && clipped.end > clipped.start ? clipped : null
    if (!selection.value) looping.value = false
    clock.setLoop(looping.value ? selection.value : null)
  }
  function toggleLoop(): void { if (!selection.value) { notify('先拖动框选一个时间区间'); return }; looping.value = !looping.value; clock.setLoop(looping.value ? selection.value : null) }
  function addBookmark(): void { bookmarks.value = [...bookmarks.value, { id: crypto.randomUUID(), time: currentTime.value, label: `标记 ${bookmarks.value.length + 1}` }]; notify(`已标记 ${formatTime(currentTime.value)}`) }
  function removeBookmark(id: string): void { bookmarks.value = bookmarks.value.filter(bookmark => bookmark.id !== id) }
  function setOffset(sourceId: string, value: bigint): void {
    clock.pause()
    const time = currentTime.value
    const model = sources.value.find(source => source.source.metadata.id === sourceId)
    if (!model) return
    model.offset = value
    sources.value = [...sources.value]
    activeGeneration++
    activeCache = null
    clock.configure(bounds.value)
    clock.seek(clampTime(time, bounds.value))
    looping.value = false
    setSelection(null)
    selectedEvent.value = null
    eventArgs.value = {}
    fit()
    void refreshOverview()
    void refreshActive(currentTime.value, true)
    notify('已更新相对时钟偏移；对齐依据仍需人工验证')
  }

  watch([searchText, displayedSources], ([value]) => {
    const version = ++searchVersion
    if (!value.trim()) { searchResults.value = []; searching.value = false; return }
    searching.value = true
    setTimeout(async () => {
      if (version !== searchVersion) return
      try {
        const results = (await Promise.all(displayedSources.value.map(source => source.search(value.trim(), 100)))).flat().sort((left, right) => left.start < right.start ? -1 : 1)
        if (version === searchVersion) searchResults.value = results.slice(0, 100)
      } catch (error) { if (version === searchVersion) notify(String(error), 'error') }
      finally { if (version === searchVersion) searching.value = false }
    }, 200)
  })
  watch([selection, displayedSources], async ([range]) => {
    const version = ++statisticsVersion
    selectionStats.value = null
    if (!range) { statisticsLoading.value = false; return }
    statisticsLoading.value = true
    try {
      const results = await Promise.all(displayedSources.value.map(source => source.statistics(range)))
      if (version === statisticsVersion) selectionStats.value = { count: results.reduce((result, item) => result + item.count, 0), sumDuration: results.reduce((result, item) => result + item.sumDuration, 0n), unionDuration: results.length === 1 ? results[0]!.unionDuration : -1n }
    } catch (error) { if (version === statisticsVersion) notify(String(error), 'error') }
    finally { if (version === statisticsVersion) statisticsLoading.value = false }
  })

  function snapshot(): ProjectSnapshot {
    return { version: 1, computeModel: { id: 'megakernel', version: '1' }, sources: sources.value.map(model => ({ filename: model.source.metadata.filename, fingerprint: model.source.metadata.fingerprint, parser: { id: 'perfetto', version: '1' }, offset: model.offset.toString() })), visibleSources: selectedSources.value.map(source => source.source.metadata.fingerprint), time: currentTime.value.toString(), speed: speed.value, viewport: { start: viewport.value.start.toString(), end: viewport.value.end.toString() }, selection: selection.value ? { start: selection.value.start.toString(), end: selection.value.end.toString() } : null, loop: looping.value, bookmarks: bookmarks.value.map(bookmark => ({ ...bookmark, time: bookmark.time.toString() })) }
  }
  async function saveProject(): Promise<void> {
    if (!sources.value.length) return
    try {
      const project = snapshot()
      if (!await workspaceHost().saveProjectFile(JSON.stringify(project, null, 2), 'visualstream.vstream.json')) return
      await persistProject(project).catch(() => {})
      notify('项目已保存，原始 trace 通过指纹关联')
    } catch (error) { notify(`保存项目失败：${error instanceof Error ? error.message : String(error)}`, 'error') }
  }
  async function openProject(file: File): Promise<void> {
    try {
      if (file.size > projectFileLimit) throw new Error(projectFileLimitMessage)
      const project = parseProject(await file.text())
      pendingProject.value = project
      if (project.sources.every(expected => sources.value.some(model => model.source.metadata.fingerprint === expected.fingerprint))) { applyPendingProject(); return }
      const missing = project.sources.filter(expected => !sources.value.some(source => source.source.metadata.fingerprint === expected.fingerprint))
      const files = await Promise.all(missing.map(expected => readHistoryFile(expected.fingerprint)))
      if (files.every((file): file is File => file !== null)) {
        await importFiles(files)
      } else notify('项目已读取，请重新导入原始 trace 文件以验证指纹并恢复位置。')
    } catch (error) { pendingProject.value = null; notify(error instanceof Error ? error.message : String(error), 'error') }
  }
  function applyPendingProject(): void {
    const project = pendingProject.value
    if (!project) return
    if (!project.sources.every(expected => sources.value.some(model => model.source.metadata.fingerprint === expected.fingerprint))) { notify('项目仍缺少匹配指纹的源文件，请继续导入。'); return }
    const fingerprints = new Set(project.sources.map(source => source.fingerprint))
    selectedDeviceId.value = null
    selectedCuId.value = null
    selectedEvent.value = null
    eventArgs.value = {}
    for (const model of sources.value) if (!fingerprints.has(model.source.metadata.fingerprint)) { model.source.close(); trackCache.delete(model.source.metadata.id) }
    sources.value = sources.value.filter(model => fingerprints.has(model.source.metadata.fingerprint))
    selectedSourceIds.value = new Set(sources.value.filter(model => !project.visibleSources || project.visibleSources.includes(model.source.metadata.fingerprint)).map(model => model.source.metadata.id))
    for (const expected of project.sources) sources.value.find(model => model.source.metadata.fingerprint === expected.fingerprint)!.offset = BigInt(expected.offset)
    sources.value = [...sources.value]
    activeGeneration++
    activeCache = null
    clock.configure(bounds.value)
    clock.setSpeed(project.speed)
    setViewport({ start: BigInt(project.viewport.start), end: BigInt(project.viewport.end) })
    setSelection(project.selection ? { start: BigInt(project.selection.start), end: BigInt(project.selection.end) } : null)
    looping.value = project.loop && !!selection.value
    clock.setLoop(looping.value ? selection.value : null)
    bookmarks.value = project.bookmarks.map(bookmark => ({ ...bookmark, time: BigInt(bookmark.time) }))
    seek(BigInt(project.time))
    void refreshOverview()
    void refreshActive(currentTime.value, true)
    pendingProject.value = null
    notify('项目布局、书签、时钟偏移与播放位置已恢复')
  }

  return { sources, timelineFocus, focusSource, computeModelId, sourceParserId, historyFiles, historyLoading, selectedSourceIds, selectedSources, displayedSources, loading, progress, currentTime, playing, buffering, speed, viewport, zooming, panningViewport, bounds, selection, looping, following, spaceHeld, spaceUsed, selectedEvent, selectedCuId, selectedDeviceId, eventArgs, activeEvents, activeByCu, overview, overviewMetric, overviewActivity, overviewActivityLoading, overviewActivityError, bookmarks, expandedGroups, searchText, searchResults, searching, selectionStats, statisticsLoading, toast, activeView, pendingProject, devices, displayedDevices, cus, totalEvents, diagnostics, rows, clock, initialize, toggleSource, selectAllSources, openHistory, removeHistory, importFiles, cancelImport, removeSource, seek, stepSpeed, setViewport, stopZoom, stopPan, setZoomPointer, fit, pan, zoom, zoomSelection, selectEvent, selectCu, toggleGroup, step, setSelection, toggleLoop, addBookmark, removeBookmark, setOffset, notify, saveProject, openProject }
})

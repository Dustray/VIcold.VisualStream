<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, ArrowDownToLine, ArrowRight, Bookmark, ChevronDown, ChevronRight, CircleHelp, Cpu, FileChartColumn, FolderOpen, Gauge, Grid2X2, HardDrive, Info, Layers3, LoaderCircle, Pause, Play, Plus, Repeat2, RotateCcw, Search, Settings2, ShieldCheck, SkipBack, SkipForward, Terminal, Upload, Workflow, X } from 'lucide-vue-next'
import Button from './components/ui/Button.vue'
import CuGrid from './components/CuGrid.vue'
import CuUtilization from './components/CuUtilization.vue'
import Inspector from './components/Inspector.vue'
import Timeline from './components/Timeline.vue'
import PlaybackSpeed from './components/PlaybackSpeed.vue'
import ThemeSelect from './components/ThemeSelect.vue'
import WindowControls from './components/WindowControls.vue'
import { duration, formatBytes, formatTime, parseMilliseconds } from './core/time'
import { operatorColor as eventColor } from './core/theme'
import { useReplayStore } from './stores/replay'
import { workspaceHost } from './host'

const store = useReplayStore()
const host = workspaceHost()
const pickingFiles = ref(false)
const traceInput = ref<HTMLInputElement | null>(null)
const projectInput = ref<HTMLInputElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const workspace = ref<HTMLDivElement | null>(null)
const modal = ref<'help' | 'settings' | null>(null)
const dragDepth = ref(0)
const storedRatio = Number(localStorage.getItem('visualstream.upperRatio') ?? 54)
const upperRatio = ref(Number.isFinite(storedRatio) ? Math.max(28, Math.min(72, storedRatio)) : 54)
const timeInput = ref('')
const customSpeed = ref('')
const progressPercent = computed(() => Math.round(store.progress.fraction * 100))
const sourceTitle = computed(() => store.sources.length === 1 ? store.sources[0]!.source.metadata.filename.replace('.perfetto-trace', '') : store.sources.length > 1 ? `多卡会话 · ${store.sources.length} 个来源` : '未打开会话')
const sourceForEvent = (sourceId: string) => store.sources.find(source => source.source.metadata.id === sourceId)
const cuIndex = (cuId: string) => store.cus.find(cu => cu.id === cuId)?.index ?? '—'
const totalBytes = computed(() => store.sources.reduce((total, source) => total + source.source.metadata.bytes, 0))
let resizing = false
const copyableSelector = '[data-copyable], .event-title h3, .detail-list dd, .source-footnote, .sidebar-info dd, .time-hero'

async function filesSelected(event: Event): Promise<void> { const input = event.target as HTMLInputElement; const files = [...input.files ?? []]; input.value = ''; if (files.length) await store.importFiles(files) }
async function projectSelected(event: Event): Promise<void> { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (file) await store.openProject(file) }
async function chooseTraceFiles(): Promise<void> {
  if (pickingFiles.value || store.loading) return
  if (!host.openTraceFiles) { traceInput.value?.click(); return }
  pickingFiles.value = true
  try {
    const files = await host.openTraceFiles()
    if (files?.length) await store.importFiles(files)
  } catch (error) { store.notify(`打开记录失败：${error instanceof Error ? error.message : String(error)}`, 'error') }
  finally { pickingFiles.value = false }
}
async function chooseProjectFile(): Promise<void> {
  if (pickingFiles.value || store.loading) return
  if (!host.openProjectFile) { projectInput.value?.click(); return }
  pickingFiles.value = true
  try {
    const file = await host.openProjectFile()
    if (file) await store.openProject(file)
  } catch (error) { store.notify(`打开项目失败：${error instanceof Error ? error.message : String(error)}`, 'error') }
  finally { pickingFiles.value = false }
}
function isFileDrag(event: DragEvent): boolean { return event.dataTransfer?.types.includes('Files') ?? false }
function dragEnter(event: DragEvent): void { if (isFileDrag(event)) { event.preventDefault(); dragDepth.value++ } }
function dragLeave(event: DragEvent): void { if (isFileDrag(event)) { event.preventDefault(); dragDepth.value = Math.max(0, dragDepth.value - 1) } }
function dragOver(event: DragEvent): void {
  if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer!.dropEffect = 'copy' }
  else if (!isTextTarget(event)) event.preventDefault()
}
function drop(event: DragEvent): void {
  if (!isFileDrag(event)) { if (!isTextTarget(event)) event.preventDefault(); return }
  event.preventDefault()
  dragDepth.value = 0
  const files = [...event.dataTransfer?.files ?? []]
  if (files.length === 1 && files[0]!.name.endsWith('.json')) void store.openProject(files[0]!)
  else if (files.length) void store.importFiles(files)
}
function applyCustomSpeed(): void { try { store.clock.setSpeed(Number(customSpeed.value)); customSpeed.value = '' } catch (error) { store.notify(String(error), 'error') } }
function seekInput(): void { const value = parseMilliseconds(timeInput.value); if (value === null) { store.notify('请输入毫秒时间，最多保留六位小数'); return }; store.seek(value); timeInput.value = '' }
function offsetChanged(sourceId: string, event: Event): void { const value = parseMilliseconds((event.target as HTMLInputElement).value); if (value === null) store.notify('时钟偏移需要有效的毫秒数', 'error'); else store.setOffset(sourceId, value) }
function resizeStart(event: PointerEvent): void { resizing = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); document.body.style.cursor = 'row-resize'; event.preventDefault() }
function resizeMove(event: PointerEvent): void { if (!resizing || !workspace.value) return; const bounds = workspace.value.getBoundingClientRect(); upperRatio.value = Math.max(28, Math.min(72, (event.clientY - bounds.top) / bounds.height * 100)) }
function resizeEnd(): void { if (!resizing) return; resizing = false; document.body.style.cursor = ''; localStorage.setItem('visualstream.upperRatio', String(upperRatio.value)) }
function eventElement(event: Event): Element | null { return event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null }
function isTextTarget(event: Event): boolean {
  const target = eventElement(event)
  if (!target) return false
  if ((target instanceof HTMLElement && target.isContentEditable) || target.closest('textarea, [role="textbox"], [role="searchbox"]')) return true
  const input = target.closest('input')
  return input instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'hidden'].includes(input.type)
}
function isCopyableTarget(event: Event): boolean { return !!eventElement(event)?.closest(copyableSelector) }
function preventNativeSelection(event: Event): void { if (!isTextTarget(event) && !isCopyableTarget(event)) event.preventDefault() }
function preventNativeDrag(event: DragEvent): void { if (!isTextTarget(event)) event.preventDefault() }
function preventAutoScroll(event: MouseEvent): void { if (event.button === 1 && !isTextTarget(event)) event.preventDefault() }
function preventPageZoom(event: WheelEvent): void { if (event.ctrlKey || event.metaKey) event.preventDefault() }
function clearTextSelection(event: PointerEvent): void { if (!isTextTarget(event) && !isCopyableTarget(event)) window.getSelection()?.removeAllRanges() }
function selectAll(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'a' || event.isComposing || isTextTarget(event)) return
  event.preventDefault()
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const target = eventElement(event)?.closest(copyableSelector)
  const element = target ?? (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest(copyableSelector)
  if (!selection || !element) return
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}
function spaceKeydown(event: KeyboardEvent): void {
  if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTextTarget(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat && !store.spaceHeld && store.sources.length && !store.loading) { store.spaceHeld = true; store.spaceUsed = false }
}
function keydown(event: KeyboardEvent): void {
  selectAll(event)
  if (event.key === 'Escape') { modal.value = null; store.setSelection(null); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchInput.value?.focus(); return }
  if (isTextTarget(event) || modal.value || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '?') { modal.value = 'help'; return }
  if (!store.sources.length) return
  const key = event.key.toLowerCase()
  const target = eventElement(event)
  if ((target instanceof HTMLSelectElement || target instanceof HTMLInputElement && target.type === 'range') && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown'].includes(key)) return
  if (key === 'w' || key === 's') { event.preventDefault(); const factor = event.repeat ? 0.9 : 0.8; store.zoom(key === 'w' ? factor : 1 / factor) }
  else if (key === 'e' || key === 'q') { event.preventDefault(); store.stepSpeed(key === 'e' ? 1 : -1) }
  else if (key === 'a' || key === 'd') {
    event.preventDefault()
    const distance = duration(store.viewport) / 5n || 1n
    const delta = key === 'a' ? -distance : distance
    store.pan(delta)
  }
  else if (key === 'f') store.fit()
  else if (key === 'z') store.zoomSelection()
  else if (key === 'b') store.addBookmark()
  else if (key === 'arrowleft') { event.preventDefault(); void store.step(-1) }
  else if (key === 'arrowright') { event.preventDefault(); void store.step(1) }
  else if (key === 'home') { event.preventDefault(); store.seek(store.bounds.start) }
  else if (key === 'end') { event.preventDefault(); store.seek(store.bounds.end) }
  else if (key === 'i') store.setSelection({ start: store.currentTime, end: store.selection && store.selection.end > store.currentTime ? store.selection.end : store.bounds.end })
  else if (key === 'o') store.setSelection({ start: store.selection && store.selection.start < store.currentTime ? store.selection.start : store.bounds.start, end: store.currentTime })
}
function keyup(event: KeyboardEvent): void {
  if (event.code !== 'Space' || !store.spaceHeld) return
  event.preventDefault()
  event.stopPropagation()
  const toggle = !store.spaceUsed && !isTextTarget(event) && !!store.sources.length && !store.loading
  store.spaceHeld = false
  store.spaceUsed = false
  if (toggle) store.clock.toggle()
}
function visibility(): void { if (document.hidden) { store.clock.pause(); store.stopZoom() } }
function blur(): void { store.spaceHeld = false; store.spaceUsed = false; store.stopZoom(); store.setZoomPointer(null); resizeEnd() }
onMounted(() => { document.addEventListener('keydown', spaceKeydown, true); document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup, true); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur); void store.initialize() })
onBeforeUnmount(() => { document.removeEventListener('keydown', spaceKeydown, true); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup, true); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur); store.clock.dispose(); for (const source of store.sources) source.source.close() })
</script>

<template>
  <div class="app-shell" spellcheck="false" @dragenter="dragEnter" @dragleave="dragLeave" @dragover="dragOver" @drop="drop" @dragstart="preventNativeDrag" @selectstart="preventNativeSelection" @contextmenu="preventNativeSelection" @mousedown="preventAutoScroll" @pointerdown="clearTextSelection" @wheel="preventPageZoom">
    <input ref="traceInput" class="sr-only" type="file" multiple accept=".perfetto-trace,.pftrace,.trace,.pb" data-testid="trace-input" @change="filesSelected" />
    <input ref="projectInput" class="sr-only" type="file" accept=".json" data-testid="project-input" @change="projectSelected" />
    <header class="app-header" :class="{ 'desktop-header': !!host.window }" :data-tauri-drag-region="host.window ? '' : undefined">
      <div class="brand"><span class="brand-symbol"><Workflow :size="21" /></span><span>visualstream<span class="brand-version">{{ host.kind === 'desktop' ? 'DESKTOP' : 'PREVIEW' }}</span></span></div>
      <div class="header-section"><span class="header-slash">/</span><span class="header-workspace">推理重放工作台</span><span class="mode-tag"><Layers3 :size="12" />Megakernel</span></div>
      <div class="header-actions"><ThemeSelect /><span class="local-status"><ShieldCheck :size="13" />本地解析</span><span class="header-divider" /><button class="icon-button" title="打开项目" aria-label="打开项目" :disabled="pickingFiles || store.loading" @click="chooseProjectFile()"><FolderOpen :size="17" /></button><Button variant="secondary" size="sm" :disabled="!store.sources.length" @click="store.saveProject()"><ArrowDownToLine :size="14" />保存项目</Button><button class="icon-button" title="快捷键与帮助" aria-label="快捷键与帮助" @click="modal = 'help'"><CircleHelp :size="17" /></button><button class="icon-button" title="会话设置" aria-label="会话设置" @click="modal = 'settings'"><Settings2 :size="17" /></button></div>
      <WindowControls v-if="host.window" :controls="host.window" @error="store.notify($event, 'error')" />
    </header>

    <div class="app-body">
      <aside class="sidebar">
        <div class="sidebar-title"><span>资源管理器</span><span class="small-caps">EXPLORER</span></div>
        <div class="import-configuration"><label>计算模式<select v-model="store.computeModelId" aria-label="导入计算模式" :disabled="store.loading"><option value="megakernel">Megakernel</option></select></label><label>文件解析<select v-model="store.sourceParserId" aria-label="导入文件解析器" :disabled="store.loading"><option value="perfetto">Perfetto</option><option value="auto">自动识别</option></select></label></div>
        <Button class="import-button" variant="outline" :disabled="store.loading || pickingFiles" @click="chooseTraceFiles()"><Plus :size="15" />导入 trace 文件<kbd>＋</kbd></Button>
        <div class="sidebar-section-heading"><span><ChevronDown :size="12" />当前会话</span><span class="count-badge">{{ store.sources.length }}</span></div>
        <div class="file-list">
          <div v-for="source in store.sources" :key="source.source.metadata.id" class="file-entry" :class="{ selected: store.selectedDeviceId === source.device.id }">
            <button class="file-main" :title="source.source.metadata.filename" @click="store.selectedDeviceId = store.selectedDeviceId === source.device.id ? null : source.device.id"><FileChartColumn :size="16" /><span><strong>{{ source.source.metadata.filename.replace('qwen3_bs1_64x1024_', '').replace('_steps60-68.perfetto-trace', '') }}</strong><small>{{ formatBytes(source.source.metadata.bytes) }}<span>·</span>Perfetto</small></span></button><button class="file-remove" :aria-label="`移除 ${source.source.metadata.filename}`" @click="store.removeSource(source.source.metadata.id)"><X :size="12" /></button>
            <div class="file-resource"><span class="tree-line" /><Cpu :size="12" /><span>{{ source.device.label }}</span><span>{{ source.device.cus.length }} CU</span></div>
          </div>
          <div v-if="!store.sources.length" class="sidebar-empty"><FolderOpen :size="24" /><p>将 trace 拖放到此处</p><span>Perfetto Protobuf</span></div>
        </div>
        <div class="sidebar-section-heading"><span>内置真实样例</span></div><div class="sample-buttons"><button :disabled="store.loading" @click="store.loadSamples('single')"><HardDrive :size="13" /><span>TP1 · 单卡</span><ArrowRight :size="12" /></button><button :disabled="store.loading" @click="store.loadSamples('dual')"><Layers3 :size="13" /><span>TP2 · 双卡</span><ArrowRight :size="12" /></button></div>
        <div class="sidebar-rule" />
        <div class="sidebar-section-heading"><span>重放信息</span><Activity :size="12" /></div><dl class="sidebar-info"><div><dt>计算模式</dt><dd>Megakernel</dd></div><div><dt>源解析器</dt><dd>Perfetto</dd></div><div><dt>资源层级</dt><dd>卡 / CU / Group</dd></div><div><dt>记录时长</dt><dd>{{ store.sources.length ? formatTime(duration(store.bounds)) : '—' }}</dd></div><div><dt>区间事件</dt><dd>{{ store.totalEvents.toLocaleString() }}</dd></div><div><dt>源文件大小</dt><dd>{{ formatBytes(totalBytes) }}</dd></div></dl>
        <div v-if="store.sources.length > 1" class="alignment-note"><Info :size="14" /><span>相对起点对齐<br /><small>跨卡时钟尚未验证</small></span><button class="icon-button" aria-label="配置时钟对齐" @click="modal = 'settings'"><Settings2 :size="12" /></button></div>
        <div class="sidebar-rule" /><div class="sidebar-section-heading"><span>时间书签</span><button class="icon-button" title="添加书签 · B" aria-label="添加书签" :disabled="!store.sources.length" @click="store.addBookmark()"><Plus :size="13" /></button></div><div class="bookmark-list"><div v-for="bookmark in store.bookmarks" :key="bookmark.id"><button @click="store.seek(bookmark.time)"><Bookmark :size="12" /><span>{{ bookmark.label }}</span><small>{{ formatTime(bookmark.time, 2) }}</small></button><button class="bookmark-remove" aria-label="删除书签" @click="store.removeBookmark(bookmark.id)"><X :size="11" /></button></div><p v-if="!store.bookmarks.length">在重要时刻按 <kbd>B</kbd> 添加标记</p></div>
        <div class="sidebar-bottom"><div class="browser-note"><ShieldCheck :size="14" /><span>文件在浏览器内处理<br /><small>源数据不会上传至服务器</small></span></div><button class="sidebar-help" @click="modal = 'help'"><Terminal :size="13" /><span>快捷键</span><kbd>?</kbd></button></div>
      </aside>

      <main class="workspace">
        <div class="workspace-toolbar"><div class="workspace-breadcrumb"><span>重放</span><ChevronRight :size="13" /><strong :title="sourceTitle">{{ sourceTitle }}</strong></div><label class="search-box"><Search :size="14" /><input ref="searchInput" v-model="store.searchText" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="搜索任务或事件…" aria-label="搜索任务或事件" /><button v-if="store.searchText" class="icon-button" aria-label="清除搜索" @click="store.searchText = ''"><X :size="12" /></button><kbd v-else>Ctrl F</kbd></label></div>
        <div ref="workspace" class="workspace-content">
          <div class="upper-workspace" :style="{ flexBasis: `${upperRatio}%` }">
            <section class="hardware-panel">
              <div class="view-toolbar"><div class="view-tabs"><button :class="{ active: store.activeView === 'resources' }" @click="store.activeView = 'resources'"><Grid2X2 :size="14" />资源矩阵</button><button :class="{ active: store.activeView === 'tasks' }" @click="store.activeView = 'tasks'"><Layers3 :size="14" />当前任务</button><button :class="{ active: store.activeView === 'utilization' }" @click="store.activeView = 'utilization'"><Activity :size="14" />CU 利用率</button><button :class="{ active: store.activeView === 'metrics' }" @click="store.activeView = 'metrics'"><Gauge :size="14" />硬件指标</button></div><select v-model="store.selectedDeviceId" class="device-select" aria-label="筛选计算卡"><option :value="null">所有计算卡</option><option v-for="device in store.devices" :key="device.id" :value="device.id">{{ device.label }}{{ device.rank === null ? '' : ` · Rank ${device.rank}` }}</option></select></div>
              <div v-if="store.activeView === 'resources'" class="hardware-scroll">
                <div v-for="device in store.displayedDevices" :key="device.id" class="device-section"><div class="device-heading"><div class="device-icon"><Cpu :size="18" /></div><div><h2>{{ device.label }}<span v-if="device.rank !== null">Rank {{ device.rank }}</span></h2><p>Megakernel<span>·</span>{{ device.cus.length }} 个已记录 CU<span>·</span>{{ device.cus.reduce((total, cu) => total + cu.groups.length, 0) }} Groups</p></div><div class="device-activity"><span class="tiny-dot green" /><strong>{{ device.cus.filter(cu => store.activeByCu.has(cu.id)).length }}</strong><span>/ {{ device.cus.length }} 有任务</span></div></div><CuGrid :device="device" /></div>
                <div v-if="!store.sources.length" class="hardware-empty"><div class="empty-symbol"><Workflow :size="32" /></div><h2>让推理过程清晰可见</h2><p>导入 Megakernel 的 Perfetto trace，<br />在时间与计算资源之间自由探索。</p><Button :disabled="store.loading || pickingFiles" @click="chooseTraceFiles()"><Upload :size="15" />选择 trace 文件</Button></div>
                <div v-if="store.sources.length" class="grid-legend"><span><i class="legend-square active" />有记录任务</span><span><i class="legend-square" />无记录任务</span><span><i class="legend-square selected" />已选中</span><span class="legend-right">点击 CU 联动时间轴<span>·</span>颜色对应算子类型（忽略编号）</span></div>
              </div>
              <div v-else-if="store.activeView === 'tasks'" class="tasks-view"><div class="table-caption"><span>当前位置的记录任务</span><strong>{{ store.activeEvents.length }} 个活动区间</strong></div><table><thead><tr><th>任务名称</th><th>计算卡</th><th>CU</th><th>开始</th><th>持续时间</th></tr></thead><tbody><tr v-for="event in store.activeEvents.filter(event => !store.selectedDeviceId || event.deviceId === store.selectedDeviceId).slice(0, 100)" :key="`${event.sourceId}-${event.id}`" @click="store.selectEvent(event)"><td><span class="event-dot" :style="{ background: eventColor(event.name) }" />{{ event.name }}</td><td>{{ sourceForEvent(event.sourceId)?.device.label }}</td><td>{{ cuIndex(event.cuId) }}</td><td>{{ formatTime(event.start) }}</td><td>{{ formatTime(event.end - event.start) }}</td></tr></tbody></table><p v-if="!store.activeEvents.length" class="muted-description table-empty">当前位置没有记录任务。</p><p v-if="store.activeEvents.length > 100" class="muted-description">最多展示 100 个当前任务。</p></div>
              <CuUtilization v-else-if="store.activeView === 'utilization'" /><div v-else class="metrics-empty"><div class="empty-symbol"><Gauge :size="30" /></div><h3>当前记录未提供硬件指标</h3><p>CU 任务活动由 trace 区间重放。<br />计算利用率、显存、拷贝与通信带宽需要对应的采集数据。</p><span class="quiet-tag">未采集的数据保持未知</span></div>
            </section>
            <Inspector />
          </div>
          <div class="workspace-resizer" role="separator" aria-label="调整视图与时间轴高度" aria-orientation="horizontal" tabindex="0" @pointerdown="resizeStart" @pointermove="resizeMove" @pointerup="resizeEnd" @pointercancel="resizeEnd" @keydown.up.prevent="upperRatio = Math.max(28, upperRatio - 3)" @keydown.down.prevent="upperRatio = Math.min(72, upperRatio + 3)"><span /></div>
          <div class="playback-bar"><div class="playback-controls"><button class="icon-button" aria-label="回到起点" title="回到起点 · Home" :disabled="!store.sources.length" @click="store.seek(store.bounds.start)"><RotateCcw :size="15" /></button><button class="icon-button" aria-label="前一个事件" title="前一个事件 · ←" :disabled="!store.sources.length" @click="store.step(-1)"><SkipBack :size="15" /></button><button class="play-button" :aria-label="store.playing ? '暂停重放' : '播放重放'" :disabled="!store.sources.length || store.loading" title="播放 / 暂停 · Space" @click="store.clock.toggle()"><LoaderCircle v-if="store.buffering" :size="17" class="spin" /><Pause v-else-if="store.playing" :size="17" fill="currentColor" /><Play v-else :size="17" fill="currentColor" /></button><button class="icon-button" aria-label="下一个事件" title="下一个事件 · →" :disabled="!store.sources.length" @click="store.step(1)"><SkipForward :size="15" /></button><span class="toolbar-divider" /><div class="playback-time" data-testid="playback-time"><strong>{{ formatTime(store.currentTime) }}</strong><span>/ {{ store.sources.length ? formatTime(duration(store.bounds)) : '—' }}</span></div></div><div class="playback-options"><PlaybackSpeed /><button class="icon-button" :class="{ selected: store.looping }" aria-label="循环选区" :aria-pressed="store.looping" title="循环选区" @click="store.toggleLoop()"><Repeat2 :size="16" /></button><button class="icon-button" aria-label="添加时间书签" title="添加书签 · B" :disabled="!store.sources.length" @click="store.addBookmark()"><Bookmark :size="15" /></button><span class="toolbar-divider" /><span class="play-state"><span class="tiny-dot" :class="{ green: store.playing, blue: store.buffering }" />{{ store.buffering ? '缓冲中' : store.playing ? '正在重放' : '已暂停' }}</span></div></div>
          <Timeline />
        </div>
      </main>
    </div>
    <footer class="app-footer"><div><span class="connection-dot" />本地会话<span class="footer-dot">·</span>{{ store.sources.length }} 个来源<span class="footer-dot">·</span>{{ store.cus.length }} CU</div><div><span>MODE</span>Megakernel<span class="footer-dot">·</span><span>ENGINE</span>{{ store.sources[0]?.source.metadata.engineVersion ?? 'Perfetto WASM' }}<span class="footer-dot">·</span>VisualStream 0.1</div></footer>

    <div v-if="store.loading" class="import-progress" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100"><div><LoaderCircle :size="16" class="spin" /><strong>{{ store.progress.stage }}</strong><span>{{ progressPercent }}%</span><button class="icon-button" aria-label="取消导入" @click="store.cancelImport()"><X :size="14" /></button></div><div class="progress-track"><span :style="{ width: `${progressPercent}%` }" /></div></div>
    <div v-if="store.toast" class="toast" :class="store.toast.kind" :role="store.toast.kind === 'error' ? 'alert' : 'status'"><Activity :size="16" /><span>{{ store.toast.message }}</span><button class="icon-button" aria-label="关闭提示" @click="store.toast = null"><X :size="14" /></button></div>
    <div v-if="dragDepth > 0" class="drop-overlay"><div><Upload :size="38" /><h2>释放以导入 trace</h2><p>Megakernel + Perfetto · 支持多个计算卡来源</p></div></div>

    <div v-if="modal" class="modal-backdrop" @pointerdown.self="modal = null"><section class="modal" role="dialog" aria-modal="true" :aria-label="modal === 'help' ? '快捷键与帮助' : '会话设置'"><header><div><span class="eyebrow">VISUALSTREAM</span><h2>{{ modal === 'help' ? '探索重放工作台' : '会话设置' }}</h2></div><button class="icon-button" aria-label="关闭对话框" @click="modal = null"><X :size="18" /></button></header><div class="modal-body">
      <template v-if="modal === 'help'"><p class="muted-description">载入 trace 后，用统一播放头联动资源矩阵、当前任务与时间轴。所有显示均来自记录，未采集的指标保持未知。</p><table class="shortcut-table"><tbody><tr><td>全局播放 / 暂停（文本框编辑时除外）</td><td><kbd>Space</kbd></td></tr><tr><td>以指针为中心平滑缩放</td><td><kbd>Ctrl / ⌘</kbd> + 滚轮</td></tr><tr><td>平移时间窗口</td><td>右键 / 中键拖动</td></tr><tr><td>创建统计选区</td><td>在轨道区按住左键拖动</td></tr><tr><td>以指针为中心小幅放大 / 缩小</td><td><kbd>W</kbd> / <kbd>S</kbd></td></tr><tr><td>调快 / 调慢重放速度</td><td><kbd>E</kbd> / <kbd>Q</kbd></td></tr><tr><td>向左 / 向右平移</td><td><kbd>A</kbd> / <kbd>D</kbd></td></tr><tr><td>精确定位时间</td><td>点击事件中的任意位置</td></tr><tr><td>前后事件边界</td><td><kbd>←</kbd> <kbd>→</kbd></td></tr><tr><td>适配全部 / 缩放选区</td><td><kbd>F</kbd> / <kbd>Z</kbd></td></tr><tr><td>设置循环入点 / 出点</td><td><kbd>I</kbd> / <kbd>O</kbd></td></tr><tr><td>添加时间书签</td><td><kbd>B</kbd></td></tr><tr><td>搜索任务</td><td><kbd>Ctrl / ⌘</kbd> + <kbd>F</kbd></td></tr></tbody></table><div class="notice"><ShieldCheck :size="15" />文件在本地浏览器内解析；重放显示采集时的活动，不是当前硬件监控。</div></template>
      <template v-else><div class="settings-grid"><label>计算模式<span>Megakernel v1</span></label><label>源文件解析器<span>Perfetto v1</span></label><label>计算资源解释<span>多卡 → CU → Group</span></label><label>渲染方式<span>Canvas 2D · 分级细节</span></label></div><div class="section-label">精确跳转与速度</div><div class="settings-input-row"><label>时间位置（ms）<input v-model="timeInput" inputmode="decimal" placeholder="例如 50.125" @keydown.enter="seekInput" /></label><Button variant="secondary" size="sm" @click="seekInput">跳转</Button></div><div class="settings-input-row"><label>自定义速度（×）<input v-model="customSpeed" inputmode="decimal" placeholder="0.001 — 1000" @keydown.enter="applyCustomSpeed" /></label><Button variant="secondary" size="sm" @click="applyCustomSpeed">应用</Button></div><div class="section-label">来源与时钟偏移</div><div v-for="source in store.sources" :key="source.source.metadata.id" class="source-offset"><span :title="source.source.metadata.filename">{{ source.device.label }}{{ source.device.rank === null ? '' : ` · Rank ${source.device.rank}` }}</span><label><input :value="Number(source.offset) / 1e6" type="number" step="0.001" :aria-label="`${source.device.label} 的时钟偏移`" @change="offsetChanged(source.source.metadata.id, $event)" /><span>ms</span></label></div><div class="notice"><ShieldCheck :size="15" />不同来源默认相对起点对齐。填写偏移不等于已经验证物理时钟同步；设备与 rank 标签来自文件名提示。</div><div class="section-label">导入诊断</div><p v-for="message in store.diagnostics" :key="message" class="diagnostic-item">{{ message }}</p></template>
    </div></section></div>
  </div>
</template>

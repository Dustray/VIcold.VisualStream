<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from 'vue'
import { ChevronDown, ChevronRight, Cpu, FileChartColumn, FolderOpen, History, Layers3, X } from 'lucide-vue-next'
import { formatBytes } from '../core/time'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const sessionExpanded = toRef(store.ui, 'sessionExpanded')
const historyExpanded = toRef(store.ui, 'historyExpanded')
const splitRatio = toRef(store.ui, 'fileSplitRatio')
const storageKey = 'visualstream.fileSplitRatio'
const storedRatio = localStorage.getItem(storageKey)
if (splitRatio.value === null && storedRatio !== null) {
  const value = Number(storedRatio)
  if (Number.isFinite(value) && value > 0 && value < 1) splitRatio.value = value
}
const sessionPanel = ref<HTMLElement | null>(null)
const separator = ref<HTMLElement | null>(null)
const availableHeight = ref(0)
const measuredRatio = ref(0.75)
const bothExpanded = computed(() => sessionExpanded.value && historyExpanded.value)
const minimumSessionHeight = 92
const minimumHistoryHeight = 72
const sessionHeight = computed(() => Math.max(minimumSessionHeight, Math.min(availableHeight.value - minimumHistoryHeight, availableHeight.value * (splitRatio.value ?? measuredRatio.value))))
const ratio = computed(() => splitRatio.value === null || !availableHeight.value ? measuredRatio.value : sessionHeight.value / availableHeight.value)
const manualLayout = computed(() => bothExpanded.value && splitRatio.value !== null && availableHeight.value > 0)
const sessionStyle = computed(() => manualLayout.value ? { flex: `0 0 ${sessionHeight.value}px`, minHeight: `${minimumSessionHeight}px` } : undefined)
const historyStyle = computed(() => manualLayout.value ? { flex: '1 1 0px', maxHeight: 'none', minHeight: `${minimumHistoryHeight}px` } : undefined)
const drag = shallowRef<{ pointerId: number; origin: number; height: number; cursor: string } | null>(null)
let observer: ResizeObserver | null = null

function saveRatio(): void {
  if (splitRatio.value === null) localStorage.removeItem(storageKey)
  else localStorage.setItem(storageKey, String(splitRatio.value))
}
function setRatio(value: number, save = true): void {
  if (!availableHeight.value) return
  splitRatio.value = Math.max(minimumSessionHeight / availableHeight.value, Math.min(1 - minimumHistoryHeight / availableHeight.value, value))
  if (save) saveRatio()
}
function resetRatio(): void { splitRatio.value = null; saveRatio() }
function resizeStart(event: PointerEvent): void {
  if (event.button !== 0 || drag.value || !sessionPanel.value) return
  drag.value = { pointerId: event.pointerId, origin: event.clientY, height: sessionPanel.value.getBoundingClientRect().height, cursor: document.body.style.cursor }
  separator.value?.setPointerCapture(event.pointerId)
  document.body.style.cursor = 'row-resize'
  event.preventDefault()
}
function resizeMove(event: PointerEvent): void {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId || !availableHeight.value) return
  setRatio((current.height + event.clientY - current.origin) / availableHeight.value, false)
}
function resizeEnd(): void {
  const current = drag.value
  if (!current) return
  drag.value = null
  if (separator.value?.hasPointerCapture(current.pointerId)) separator.value.releasePointerCapture(current.pointerId)
  document.body.style.cursor = current.cursor
  saveRatio()
}
watch(bothExpanded, expanded => { if (!expanded) resizeEnd() })
onMounted(() => {
  const container = sessionPanel.value?.parentElement
  if (container) {
    const updateHeight = () => {
      availableHeight.value = Math.max(0, container.getBoundingClientRect().height - 8)
      if (bothExpanded.value && sessionPanel.value && availableHeight.value) measuredRatio.value = sessionPanel.value.getBoundingClientRect().height / availableHeight.value
    }
    updateHeight()
    observer = new ResizeObserver(updateHeight)
    observer.observe(container)
    if (sessionPanel.value) observer.observe(sessionPanel.value)
  }
  window.addEventListener('blur', resizeEnd)
})
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('blur', resizeEnd); resizeEnd() })
const inSession = (fingerprint: string) => store.sources.some(source => source.source.metadata.fingerprint === fingerprint)
</script>

<template>
  <section ref="sessionPanel" aria-label="当前会话" class="sidebar-panel session-files" :class="{ 'is-collapsed': !sessionExpanded }" :style="sessionStyle">
    <button class="sidebar-section-heading sidebar-section-toggle" :aria-expanded="sessionExpanded" aria-controls="session-file-list" @click="sessionExpanded = !sessionExpanded">
      <span><ChevronDown v-if="sessionExpanded" :size="12" /><ChevronRight v-else :size="12" />当前会话</span><span class="count-badge">{{ store.selectedSources.length }} / {{ store.sources.length }}</span>
    </button>
    <div v-show="sessionExpanded" id="session-file-list" class="sidebar-panel-body session-file-content">
      <div v-if="store.sources.length" class="file-selection-actions"><button @click="store.selectAllSources(true)">全选</button><button @click="store.selectAllSources(false)">清空选择</button><span>勾选显示</span></div>
      <div class="file-list">
        <div v-for="source in store.sources" :key="source.source.metadata.id" class="file-entry" :class="{ selected: store.selectedSourceIds.has(source.source.metadata.id) }" @click="store.focusSource(source.source.metadata.id)">
          <input class="file-checkbox" type="checkbox" :aria-label="source.source.metadata.filename" :checked="store.selectedSourceIds.has(source.source.metadata.id)" @click.stop @change="store.toggleSource(source.source.metadata.id)" />
          <button class="file-main" :title="source.source.metadata.filename" :aria-label="`定位文件 ${source.source.metadata.filename}`">
            <FileChartColumn :size="15" /><span><strong>{{ source.source.metadata.filename }}</strong><small>{{ formatBytes(source.source.metadata.bytes) }}<span>·</span>Perfetto</small></span>
          </button>
          <button class="file-remove" :aria-label="`移除 ${source.source.metadata.filename}`" :disabled="store.loading" @click.stop="store.removeSource(source.source.metadata.id)"><X :size="12" /></button>
          <div v-if="source.device" class="file-resource"><span class="tree-line" /><Cpu :size="12" /><span>{{ source.device.label }}</span><span v-if="source.device.rank !== null" class="file-rank">Rank {{ source.device.rank }}</span><span>{{ source.device.cus.length }} CU</span></div>
          <div v-else class="file-resource"><span class="tree-line" /><Layers3 :size="12" /><span>原始轨道</span><span>{{ source.source.metadata.trackCount }} 条</span></div>
        </div>
        <div v-if="!store.sources.length" class="sidebar-empty"><FolderOpen :size="24" /><p>将 trace 拖放到此处</p><span>或使用上方导入按钮</span></div>
      </div>
    </div>
  </section>
  <div
    v-if="bothExpanded"
    ref="separator"
    class="file-panels-resizer"
    :class="{ dragging: drag !== null }"
    role="separator"
    aria-label="调整当前会话与历史文件高度"
    aria-orientation="horizontal"
    aria-controls="session-file-list history-file-list"
    :aria-valuenow="Math.round(ratio * 100)"
    :aria-valuemin="availableHeight ? Math.round(minimumSessionHeight / availableHeight * 100) : 0"
    :aria-valuemax="availableHeight ? Math.round((1 - minimumHistoryHeight / availableHeight) * 100) : 100"
    :aria-valuetext="`当前会话 ${Math.round(ratio * 100)}%，历史文件 ${100 - Math.round(ratio * 100)}%`"
    title="拖动调整列表高度，双击恢复自动分配"
    tabindex="0"
    @pointerdown="resizeStart"
    @pointermove="resizeMove"
    @pointerup="resizeEnd"
    @pointercancel="resizeEnd"
    @lostpointercapture="resizeEnd"
    @dblclick="resetRatio"
    @keydown.up.prevent.stop="setRatio(ratio - 0.05)"
    @keydown.down.prevent.stop="setRatio(ratio + 0.05)"
    @keydown.home.prevent.stop="setRatio(0)"
    @keydown.end.prevent.stop="setRatio(1)"
    @keydown.enter.prevent.stop="resetRatio"
  ><span /></div>
  <section aria-label="历史文件" class="sidebar-panel history-files" :class="{ 'is-collapsed': !historyExpanded, 'is-primary': !sessionExpanded }" :style="historyStyle">
    <button class="sidebar-section-heading sidebar-section-toggle" :aria-expanded="historyExpanded" aria-controls="history-file-list" @click="historyExpanded = !historyExpanded">
      <span><ChevronDown v-if="historyExpanded" :size="12" /><ChevronRight v-else :size="12" />历史文件</span><span class="count-badge">{{ store.historyFiles.length }}</span>
    </button>
    <div v-show="historyExpanded" id="history-file-list" class="sidebar-panel-body history-file-list">
      <div v-for="file in store.historyFiles" :key="file.fingerprint" class="history-entry">
        <button class="history-file" :title="file.filename" :aria-label="`打开历史文件 ${file.filename}`" :disabled="store.loading" @click="store.openHistory(file.fingerprint)"><History :size="14" /><span><strong>{{ file.filename }}</strong><small>{{ formatBytes(file.bytes) }} · {{ inSession(file.fingerprint) ? '当前会话中' : '添加到当前会话' }}</small></span></button>
        <button class="file-remove" :aria-label="`从历史记录中移除 ${file.filename}`" @click="store.removeHistory(file.fingerprint)"><X :size="12" /></button>
      </div>
      <p v-if="!store.historyFiles.length" class="history-empty">{{ store.historyLoading ? '正在读取历史文件…' : '导入的文件会保存在本机，方便再次打开。' }}</p>
    </div>
  </section>
</template>

<style scoped>
.file-panels-resizer { display: flex; flex: 0 0 8px; align-items: center; justify-content: center; min-height: 8px; margin: -8px 0; cursor: row-resize; touch-action: none; border-radius: 3px; }
.file-panels-resizer span { width: 28px; height: 2px; border-radius: 2px; background: var(--vs-border-strong, #405575); pointer-events: none; }
.file-panels-resizer:hover,.file-panels-resizer:focus-visible,.file-panels-resizer.dragging { background: var(--vs-surface-hover, #233857); }
.file-panels-resizer:hover span,.file-panels-resizer:focus-visible span,.file-panels-resizer.dragging span { background: var(--vs-accent, #9abaff); }
</style>

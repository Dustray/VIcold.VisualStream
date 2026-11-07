<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

const defaultWidth = 228
const minimumWidth = 200
const storageKey = 'visualstream.sidebarWidth'
const storedWidth = Number(localStorage.getItem(storageKey) ?? defaultWidth)
const preferredWidth = ref(Number.isFinite(storedWidth) ? Math.max(minimumWidth, Math.min(520, storedWidth)) : defaultWidth)
const maximumWidth = ref(520)
const width = computed(() => Math.min(preferredWidth.value, maximumWidth.value))
const sidebar = ref<HTMLElement | null>(null)
const separator = ref<HTMLElement | null>(null)
const drag = shallowRef<{ pointerId: number; origin: number; width: number; cursor: string } | null>(null)
let observer: ResizeObserver | null = null

function clampWidth(value: number): number { return Math.round(Math.max(minimumWidth, Math.min(maximumWidth.value, value))) }
function saveWidth(): void { localStorage.setItem(storageKey, String(preferredWidth.value)) }
function setWidth(value: number): void { preferredWidth.value = clampWidth(value); saveWidth() }
function resizeStart(event: PointerEvent): void {
  if (event.button !== 0 || drag.value) return
  drag.value = { pointerId: event.pointerId, origin: event.clientX, width: width.value, cursor: document.body.style.cursor }
  separator.value?.setPointerCapture(event.pointerId)
  document.body.style.cursor = 'col-resize'
  event.preventDefault()
}
function resizeMove(event: PointerEvent): void {
  const current = drag.value
  if (!current || event.pointerId !== current.pointerId) return
  preferredWidth.value = clampWidth(current.width + event.clientX - current.origin)
}
function resizeEnd(): void {
  const current = drag.value
  if (!current) return
  drag.value = null
  if (separator.value?.hasPointerCapture(current.pointerId)) separator.value.releasePointerCapture(current.pointerId)
  document.body.style.cursor = current.cursor
  saveWidth()
}

onMounted(() => {
  const container = sidebar.value?.parentElement
  if (container) {
    const updateMaximum = () => { maximumWidth.value = Math.max(minimumWidth, Math.min(520, container.clientWidth - 800 - 6)) }
    updateMaximum()
    observer = new ResizeObserver(updateMaximum)
    observer.observe(container)
  }
  window.addEventListener('blur', resizeEnd)
})
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('blur', resizeEnd); resizeEnd() })
</script>

<template>
  <aside id="resource-explorer" ref="sidebar" class="sidebar" aria-label="资源管理器" :style="{ width: `${width}px` }"><slot /></aside>
  <div
    ref="separator"
    class="sidebar-resizer"
    :class="{ dragging: drag !== null }"
    role="separator"
    aria-label="调整资源管理器宽度"
    aria-orientation="vertical"
    aria-controls="resource-explorer"
    :aria-valuenow="width"
    :aria-valuetext="`${width} 像素`"
    :aria-valuemin="minimumWidth"
    :aria-valuemax="maximumWidth"
    title="拖动调整资源管理器宽度，双击恢复默认"
    tabindex="0"
    @pointerdown="resizeStart"
    @pointermove="resizeMove"
    @pointerup="resizeEnd"
    @pointercancel="resizeEnd"
    @lostpointercapture="resizeEnd"
    @dblclick="setWidth(defaultWidth)"
    @keydown.left.prevent.stop="setWidth(width - 16)"
    @keydown.right.prevent.stop="setWidth(width + 16)"
    @keydown.home.prevent.stop="setWidth(minimumWidth)"
    @keydown.end.prevent.stop="setWidth(maximumWidth)"
    @keydown.enter.prevent.stop="setWidth(defaultWidth)"
  ><span /></div>
</template>

<style scoped>
.sidebar-resizer { width: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: col-resize; touch-action: none; background: var(--vs-surface-panel, #10151e); border-right: 1px solid var(--vs-border, #242d3d); }
.sidebar-resizer span { width: 2px; height: 30px; border-radius: 2px; background: var(--vs-border-strong, #405575); pointer-events: none; }
.sidebar-resizer:hover,.sidebar-resizer:focus-visible,.sidebar-resizer.dragging { background: var(--vs-surface-hover, #233857); }
.sidebar-resizer:hover span,.sidebar-resizer:focus-visible span,.sidebar-resizer.dragging span { background: var(--vs-accent, #9abaff); }
</style>

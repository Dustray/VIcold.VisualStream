<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DeviceResource } from '../core/types'
import { operatorColor as eventColor, resolvedTheme, themeColor } from '../core/theme'
import { fitTimelineLabel } from '../engine/timeline-label'
import { useReplayStore } from '../stores/replay'

const props = defineProps<{ device: DeviceResource }>()
const store = useReplayStore()
const canvas = ref<HTMLCanvasElement | null>(null)
const wrapper = ref<HTMLDivElement | null>(null)
const height = ref(260)
const hovered = ref<{ index: number; text: string; left: number; top: number } | null>(null)
let observer: ResizeObserver | null = null
let frame = 0
let columns = 12
let cellWidth = 65
const cellHeight = 43
const gap = 6
const padding = 2

function draw(): void {
  frame = 0
  const element = canvas.value
  if (!element || !wrapper.value) return
  const width = wrapper.value.clientWidth
  columns = Math.max(4, Math.min(16, Math.floor((width + gap) / 80)))
  cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns
  const nextHeight = Math.ceil(props.device.cus.length / columns) * (cellHeight + gap) - gap + padding * 2
  height.value = nextHeight
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  element.width = Math.round(width * ratio)
  element.height = Math.round(nextHeight * ratio)
  const context = element.getContext('2d')!
  context.scale(ratio, ratio)
  context.clearRect(0, 0, width, nextHeight)
  for (const [index, cu] of props.device.cus.entries()) {
    const left = padding + (index % columns) * (cellWidth + gap)
    const top = padding + Math.floor(index / columns) * (cellHeight + gap)
    const events = store.activeByCu.get(cu.id) ?? []
    const color = events.length ? eventColor(events[0]!.name) : themeColor('canvas-muted', '#465268')
    const selected = store.selectedCuId === cu.id
    context.fillStyle = events.length ? `${color}16` : themeColor('surface-raised', '#131923')
    context.strokeStyle = selected ? themeColor('accent', '#b0c6ff') : events.length ? `${color}55` : themeColor('border', '#252d3b')
    context.lineWidth = selected ? 1.6 : 1
    context.beginPath()
    context.roundRect(left, top, cellWidth, cellHeight, 5)
    context.fill()
    context.stroke()
    if (events.length) { context.fillStyle = color; context.fillRect(left + 7, top + 9, 3, 3) }
    context.fillStyle = events.length ? themeColor('text-primary', '#dce5f4') : themeColor('text-muted', '#657187')
    context.font = '11px "Segoe UI", sans-serif'
    context.fillText(`CU ${String(cu.index).padStart(2, '0')}`, left + (events.length ? 14 : 8), top + 13)
    context.font = '11px "Segoe UI", sans-serif'
    context.fillStyle = events.length ? color : themeColor('canvas-muted', '#465268')
    const label = events.length ? events[0]!.name.replace('TASK_', '') : '—'
    context.save()
    context.beginPath()
    context.rect(left + 7, top + 20, cellWidth - 13, 16)
    context.clip()
    context.fillText(fitTimelineLabel(label, cellWidth - 15, text => context.measureText(text).width), left + 8, top + 32)
    context.restore()
    if (events.length > 1) { context.fillStyle = themeColor('surface-panel', '#10151f'); context.fillRect(left + cellWidth - 20, top + 4, 16, 12); context.fillStyle = themeColor('text-secondary', '#9daec8'); context.fillText(`+${events.length - 1}`, left + cellWidth - 18, top + 13) }
  }
}
function schedule(): void { if (!frame) frame = requestAnimationFrame(draw) }
function hit(event: PointerEvent): number {
  const bounds = canvas.value!.getBoundingClientRect()
  const horizontal = event.clientX - bounds.left - padding
  const vertical = event.clientY - bounds.top - padding
  const column = Math.floor(horizontal / (cellWidth + gap))
  const row = Math.floor(vertical / (cellHeight + gap))
  if (column < 0 || column >= columns || horizontal % (cellWidth + gap) > cellWidth || vertical % (cellHeight + gap) > cellHeight) return -1
  const index = row * columns + column
  return index < props.device.cus.length ? index : -1
}
function move(event: PointerEvent): void {
  const index = hit(event)
  if (index < 0) { hovered.value = null; return }
  const cu = props.device.cus[index]!
  const events = store.activeByCu.get(cu.id) ?? []
  hovered.value = { index, text: events.length ? events.slice(0, 4).map(event => event.name).join(' · ') : '当前位置无记录任务', left: event.offsetX, top: event.offsetY }
}
function select(event: PointerEvent): void { const index = hit(event); if (index >= 0) store.selectCu(props.device.cus[index]!.id) }
function keyboard(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const current = Math.max(0, props.device.cus.findIndex(cu => cu.id === store.selectedCuId))
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : event.key === 'ArrowUp' ? -columns : 0
  store.selectCu(props.device.cus[Math.max(0, Math.min(props.device.cus.length - 1, current + delta))]!.id)
}
watch(() => [store.activeEvents, store.selectedCuId, props.device], schedule)
watch(resolvedTheme, schedule)
onMounted(() => { observer = new ResizeObserver(schedule); if (wrapper.value) observer.observe(wrapper.value); schedule() })
onBeforeUnmount(() => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame) })
</script>

<template>
  <div ref="wrapper" class="cu-grid-wrapper" :style="{ minHeight: `${height}px` }">
    <canvas ref="canvas" class="cu-grid-canvas" :style="{ height: `${height}px` }" tabindex="0" role="img" :aria-label="`${device.label}，${device.cus.length} 个 CU 的实时记录任务`" @pointermove="move" @pointerleave="hovered = null" @pointerdown="select" @keydown="keyboard" />
    <div v-if="hovered" class="canvas-tooltip" :style="{ left: `${Math.min(hovered.left + 12, Math.max(0, (wrapper?.clientWidth ?? 300) - 260))}px`, top: `${hovered.top + 18}px` }"><strong>CU {{ device.cus[hovered.index]?.index }} · group_0</strong><span>{{ hovered.text }}</span></div>
  </div>
</template>

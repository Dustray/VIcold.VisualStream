<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crosshair, Expand, Focus, LoaderCircle, Minus, Plus } from 'lucide-vue-next'
import { duration, eventColor, formatTime } from '../core/time'
import type { ReplayDensity, ReplayEvent, TimelineRow, TimeRange } from '../core/types'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const viewportElement = ref<HTMLDivElement | null>(null)
const background = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const overviewCanvas = ref<HTMLCanvasElement | null>(null)
const scroller = ref<HTMLDivElement | null>(null)
const querying = ref(false)
const dense = ref(true)
const panning = ref(false)
const scrollTop = ref(0)
const tooltip = ref<{ left: number; top: number; label: string; description: string } | null>(null)
const gutter = 170
const ruler = 31
const rowHeight = 29
let width = 900
let height = 280
let observer: ResizeObserver | null = null
let drawFrame = 0
let overlayFrame = 0
let queryTimer: ReturnType<typeof setTimeout> | null = null
let queryVersion = 0
let data: { events: ReplayEvent[]; bins: ReplayDensity[] } = { events: [], bins: [] }
const cache = new Map<string, { events: ReplayEvent[]; bins: ReplayDensity[]; dense: boolean }>()
let hits: { event?: ReplayEvent; bin?: ReplayDensity; left: number; right: number; top: number; bottom: number }[] = []
let gesture: { kind: 'pan' | 'scrub' | 'select'; x: number; y: number; origin: bigint; viewport: TimeRange; event: ReplayEvent | null; resume: boolean; moved: boolean } | null = null
let overviewGesture: { kind: 'left' | 'right' | 'move'; x: number; range: TimeRange } | null = null

function context(canvas: HTMLCanvasElement, canvasWidth: number, canvasHeight: number): CanvasRenderingContext2D {
  const ratio = Math.min(devicePixelRatio || 1, 2)
  const targetWidth = Math.max(1, Math.round(canvasWidth * ratio))
  const targetHeight = Math.max(1, Math.round(canvasHeight * ratio))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) { canvas.width = targetWidth; canvas.height = targetHeight }
  const result = canvas.getContext('2d')!
  result.setTransform(ratio, 0, 0, ratio, 0, 0)
  result.clearRect(0, 0, canvasWidth, canvasHeight)
  return result
}
function plotWidth(): number { return Math.max(1, width - gutter - 13) }
function toX(time: bigint): number { return gutter + Number(time - store.viewport.start) / Number(duration(store.viewport)) * plotWidth() }
function toTime(horizontal: number): bigint { return store.viewport.start + BigInt(Math.round((horizontal - gutter) / plotWidth() * Number(duration(store.viewport)))) }
function position(event: PointerEvent | WheelEvent): { x: number; y: number } { const bounds = overlay.value!.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top } }
function rememberPointer(horizontal: number): void { store.setZoomPointer(horizontal < gutter || horizontal > width - 13 ? null : (horizontal - gutter) / plotWidth()) }
function pointerLeave(): void { tooltip.value = null; store.setZoomPointer(null) }
function visibleRows(): TimelineRow[] { const first = Math.max(0, Math.floor(scrollTop.value / rowHeight) - 1); return store.rows.slice(first, Math.min(store.rows.length, Math.ceil((scrollTop.value + height - ruler) / rowHeight) + 2)) }
function scheduleBackground(): void { if (!drawFrame) drawFrame = requestAnimationFrame(draw); scheduleOverlay() }
function scheduleOverlay(): void { if (!overlayFrame) overlayFrame = requestAnimationFrame(drawOverlay) }
function invalidate(): void {
  scheduleBackground()
  if (queryTimer) clearTimeout(queryTimer)
  queryVersion++
  queryTimer = setTimeout(() => { void query() }, 30)
}

async function query(): Promise<void> {
  const version = ++queryVersion
  const visible = visibleRows().filter(row => row.kind !== 'device')
  if (!store.sources.length || !visible.length) { data = { events: [], bins: [] }; scheduleBackground(); return }
  querying.value = true
  const queryRange = { ...store.viewport }
  const useDensity = Number(duration(queryRange)) / plotWidth() > 18000
  const nextEvents: ReplayEvent[] = []
  const nextBins: ReplayDensity[] = []
  let anyDensity = useDensity
  try {
    await Promise.all(store.sources.map(async source => {
      const trackIds = [...new Set(visible.filter(row => row.sourceId === source.source.metadata.id).flatMap(row => row.trackIds))]
      if (!trackIds.length) return
      const key = `${source.source.metadata.id}:${source.offset}:${queryRange.start}:${queryRange.end}:${useDensity}:${Math.round(plotWidth())}:${trackIds.join(',')}`
      let entry = cache.get(key)
      if (!entry) {
        if (useDensity) entry = { events: [], bins: await source.density({ ...queryRange, trackIds, buckets: Math.max(100, Math.round(plotWidth() / 3)) }), dense: true }
        else {
          const page = await source.events({ ...queryRange, trackIds, limit: 35000 })
          entry = page.truncated ? { events: [], bins: await source.density({ ...queryRange, trackIds, buckets: Math.max(100, Math.round(plotWidth() / 3)) }), dense: true } : { events: page.events, bins: [], dense: false }
        }
        cache.set(key, entry)
        if (cache.size > 20) cache.delete(cache.keys().next().value!)
      }
      nextEvents.push(...entry.events)
      nextBins.push(...entry.bins)
      anyDensity ||= entry.dense
    }))
    if (version !== queryVersion) return
    dense.value = anyDensity
    data = { events: nextEvents, bins: nextBins }
    scheduleBackground()
  } catch (error) { if (version === queryVersion) store.notify(error instanceof Error ? error.message : String(error), 'error') }
  finally { if (version === queryVersion) querying.value = false }
}

function draw(): void {
  drawFrame = 0
  if (!background.value || !viewportElement.value) return
  width = viewportElement.value.clientWidth
  height = viewportElement.value.clientHeight
  const canvas = context(background.value, width, height)
  canvas.fillStyle = '#0e131c'
  canvas.fillRect(0, 0, width, height)
  canvas.fillStyle = '#121925'
  canvas.fillRect(0, 0, gutter, height)
  canvas.fillStyle = '#121925'
  canvas.fillRect(0, 0, width, ruler)
  canvas.font = '10px "Segoe UI", sans-serif'
  canvas.textBaseline = 'middle'
  const ideal = Number(duration(store.viewport)) / Math.max(2, plotWidth() / 130)
  const power = 10 ** Math.floor(Math.log10(Math.max(1, ideal)))
  const step = BigInt(Math.max(1, Math.ceil(ideal / power / (ideal / power <= 2 ? 1 : ideal / power <= 5 ? 2.5 : 5)) * (ideal / power <= 2 ? 1 : ideal / power <= 5 ? 2.5 : 5) * power))
  let tick = store.viewport.start / step * step
  if (tick < store.viewport.start) tick += step
  canvas.save()
  canvas.beginPath(); canvas.rect(gutter, 0, plotWidth(), height); canvas.clip()
  for (; tick <= store.viewport.end; tick += step) {
    const horizontal = Math.round(toX(tick)) + 0.5
    canvas.strokeStyle = '#222b3b'
    canvas.setLineDash([2, 4]); canvas.beginPath(); canvas.moveTo(horizontal, ruler); canvas.lineTo(horizontal, height); canvas.stroke(); canvas.setLineDash([])
    canvas.fillStyle = '#8290a6'; canvas.fillText(formatTime(tick, 1), horizontal + 6, 15)
    canvas.strokeStyle = '#354055'; canvas.beginPath(); canvas.moveTo(horizontal, ruler - 5); canvas.lineTo(horizontal, ruler); canvas.stroke()
  }
  canvas.restore()
  canvas.fillStyle = '#77869e'; canvas.fillText('资源 / 原始轨道', 15, 15)
  hits = []
  const visible = visibleRows()
  for (const row of visible) {
    const index = store.rows.indexOf(row)
    const top = ruler + index * rowHeight - scrollTop.value
    if (top < ruler - rowHeight || top > height) continue
    canvas.save(); canvas.beginPath(); canvas.rect(0, ruler, width, height - ruler); canvas.clip()
    const selected = row.cuId === store.selectedCuId
    if (row.kind === 'device') { canvas.fillStyle = '#19212e'; canvas.fillRect(0, top, width, rowHeight) }
    else if (selected) { canvas.fillStyle = '#8cafff0d'; canvas.fillRect(0, top, width, rowHeight) }
    canvas.strokeStyle = '#202735'; canvas.beginPath(); canvas.moveTo(0, top + rowHeight - 0.5); canvas.lineTo(width, top + rowHeight - 0.5); canvas.stroke()
    canvas.fillStyle = selected ? '#c0d2ff' : row.kind === 'device' ? '#b5c1d3' : '#9caac0'
    canvas.font = `${row.kind === 'device' ? '600 ' : ''}10px "Segoe UI", sans-serif`
    canvas.save(); canvas.beginPath(); canvas.rect(0, top, gutter - 4, rowHeight); canvas.clip()
    if (row.kind === 'group') { canvas.fillStyle = '#64738b'; canvas.fillText(store.expandedGroups.has(row.id) ? '▾' : '▸', 12, top + 14); canvas.fillStyle = selected ? '#c0d2ff' : '#a1afc3' }
    canvas.fillText(row.label, row.kind === 'track' ? 29 : row.kind === 'device' ? 13 : 26, top + 14)
    canvas.fillStyle = '#596b86'; canvas.font = '9px "Segoe UI", sans-serif'; canvas.textAlign = 'right'; canvas.fillText(row.subtitle, gutter - 13, top + 14); canvas.textAlign = 'left'
    canvas.restore()
    if (row.kind !== 'device') {
      canvas.save(); canvas.beginPath(); canvas.rect(gutter, top + 2, plotWidth(), rowHeight - 4); canvas.clip()
      const tracks = new Set(row.trackIds)
      const bins = data.bins.filter(bin => bin.sourceId === row.sourceId && tracks.has(bin.trackId))
      const merged = new Map<number, ReplayDensity>()
      for (const bin of bins) {
        const bucket = Math.floor((toX(bin.start) - gutter) / 3)
        const existing = merged.get(bucket)
        if (existing) { existing.count += bin.count; if (bin.end > existing.end) existing.end = bin.end }
        else merged.set(bucket, { ...bin })
      }
      for (const bin of merged.values()) {
        const left = Math.max(gutter, toX(bin.start))
        const right = Math.min(width - 13, toX(bin.end))
        if (right < gutter || left > width) continue
        canvas.fillStyle = selected ? `rgba(135, 174, 244, ${Math.min(0.9, 0.27 + Math.log2(bin.count + 1) * 0.13)})` : `rgba(103, 136, 190, ${Math.min(0.86, 0.2 + Math.log2(bin.count + 1) * 0.13)})`
        canvas.fillRect(left, top + 7, Math.max(2, right - left - 0.5), rowHeight - 14)
        hits.push({ bin, left, right: Math.max(left + 2, right), top: top + 4, bottom: top + rowHeight - 3 })
      }
      const events = data.events.filter(event => event.sourceId === row.sourceId && tracks.has(event.trackId)).sort((left, right) => Number((right.end - right.start) - (left.end - left.start)))
      for (const event of events) {
        const left = Math.max(gutter, toX(event.start))
        const right = Math.min(width - 13, toX(event.end))
        if (right < gutter || left > width) continue
        const chosen = event.id === store.selectedEvent?.id && event.sourceId === store.selectedEvent.sourceId
        const color = eventColor(event.name)
        canvas.fillStyle = `${color}${chosen ? 'e0' : 'b0'}`
        canvas.beginPath(); canvas.roundRect(left, top + 5, Math.max(1, right - left - 1), rowHeight - 10, 2); canvas.fill()
        if (chosen) { canvas.strokeStyle = '#eff5ff'; canvas.stroke() }
        if (right - left > 65) { canvas.save(); canvas.beginPath(); canvas.rect(left + 3, top + 5, right - left - 7, rowHeight - 10); canvas.clip(); canvas.fillStyle = '#111824'; canvas.font = '9px "Segoe UI", sans-serif'; canvas.fillText(event.name.replace('TASK_', ''), left + 5, top + 14); canvas.restore() }
        hits.push({ event, left, right: Math.max(left + 2, right), top: top + 4, bottom: top + rowHeight - 3 })
      }
      canvas.restore()
    }
    canvas.restore()
  }
  canvas.strokeStyle = '#303b50'; canvas.beginPath(); canvas.moveTo(gutter - 0.5, 0); canvas.lineTo(gutter - 0.5, height); canvas.stroke()
  canvas.strokeStyle = '#2a3446'; canvas.beginPath(); canvas.moveTo(0, ruler - 0.5); canvas.lineTo(width, ruler - 0.5); canvas.stroke()
  drawOverview()
}

function drawOverlay(): void {
  overlayFrame = 0
  if (!overlay.value) return
  const canvas = context(overlay.value, width, height)
  canvas.save(); canvas.beginPath(); canvas.rect(gutter, 0, plotWidth(), height); canvas.clip()
  if (store.selection) {
    const left = toX(store.selection.start)
    const right = toX(store.selection.end)
    canvas.fillStyle = '#93b5ff18'; canvas.fillRect(left, ruler, right - left, height - ruler)
    canvas.strokeStyle = '#9abafa8a'; canvas.setLineDash([4, 3]); canvas.strokeRect(left + 0.5, ruler, right - left, height - ruler); canvas.setLineDash([])
  }
  for (const bookmark of store.bookmarks) {
    const horizontal = toX(bookmark.time)
    canvas.fillStyle = '#e1b77d'; canvas.beginPath(); canvas.moveTo(horizontal, 2); canvas.lineTo(horizontal + 4, 6); canvas.lineTo(horizontal, 10); canvas.lineTo(horizontal - 4, 6); canvas.closePath(); canvas.fill()
  }
  const playhead = Math.round(toX(store.currentTime)) + 0.5
  canvas.strokeStyle = '#c0d3ff'; canvas.lineWidth = 1; canvas.beginPath(); canvas.moveTo(playhead, 8); canvas.lineTo(playhead, height); canvas.stroke()
  canvas.fillStyle = '#c0d3ff'; canvas.beginPath(); canvas.moveTo(playhead - 5, 0); canvas.lineTo(playhead + 5, 0); canvas.lineTo(playhead + 5, 5); canvas.lineTo(playhead, 10); canvas.lineTo(playhead - 5, 5); canvas.closePath(); canvas.fill()
  canvas.restore()
  drawOverview()
}

function drawOverview(): void {
  if (!overviewCanvas.value) return
  const canvasWidth = overviewCanvas.value.clientWidth
  const canvas = context(overviewCanvas.value, canvasWidth, 34)
  canvas.fillStyle = '#101620'; canvas.fillRect(0, 0, canvasWidth, 34)
  canvas.font = '9px "Segoe UI", sans-serif'; canvas.fillStyle = '#6d7c94'; canvas.fillText('全局任务密度', 15, 20)
  const chartWidth = Math.max(1, canvasWidth - gutter - 13)
  const values = new Array<number>(180).fill(0)
  const full = Number(duration(store.bounds))
  for (const bin of store.overview) { const index = Math.max(0, Math.min(179, Math.floor(Number(bin.start - store.bounds.start) / full * 180))); values[index]! += bin.count }
  const maximum = Math.max(1, ...values)
  for (const [index, value] of values.entries()) {
    canvas.fillStyle = '#415d88'
    const barHeight = Math.log1p(value) / Math.log1p(maximum) * 20
    canvas.fillRect(gutter + index * chartWidth / values.length, 27 - barHeight, Math.max(1, chartWidth / values.length - 1), barHeight)
  }
  const left = gutter + Number(store.viewport.start - store.bounds.start) / full * chartWidth
  const right = gutter + Number(store.viewport.end - store.bounds.start) / full * chartWidth
  canvas.fillStyle = '#9bbdff0d'; canvas.fillRect(left, 3, right - left, 27)
  canvas.strokeStyle = '#9bbdff70'; canvas.strokeRect(left + 0.5, 3.5, Math.max(1, right - left - 1), 26)
  canvas.fillStyle = '#a7c0ed'; canvas.fillRect(left, 10, 2, 12); canvas.fillRect(right - 2, 10, 2, 12)
  const playhead = gutter + Number(store.currentTime - store.bounds.start) / full * chartWidth
  canvas.fillStyle = '#c0d3ff'; canvas.fillRect(playhead, 3, 1, 27)
}

function pointerDown(event: PointerEvent): void {
  if (!store.sources.length || ![0, 1, 2].includes(event.button)) return
  store.stopZoom()
  const point = position(event)
  rememberPointer(point.x)
  const pan = event.button === 1 || event.button === 2 || store.spaceHeld
  if (point.x < gutter && !pan) {
    const row = store.rows[Math.floor((point.y - ruler + scrollTop.value) / rowHeight)]
    if (row?.kind === 'group') { store.toggleGroup(row.id); if (row.cuId) store.selectCu(row.cuId) }
    return
  }
  const hit = [...hits].reverse().find(hit => point.x >= hit.left && point.x <= hit.right && point.y >= hit.top && point.y <= hit.bottom)
  if (store.spaceHeld) store.spaceUsed = true
  gesture = { kind: pan ? 'pan' : point.y <= ruler ? 'scrub' : 'select', x: point.x, y: point.y, origin: toTime(point.x), viewport: { ...store.viewport }, event: hit?.event ?? null, resume: store.playing, moved: false }
  panning.value = pan
  if (!pan) store.clock.pause()
  if (gesture.kind === 'scrub') store.seek(gesture.origin)
  overlay.value?.setPointerCapture(event.pointerId)
  tooltip.value = null
  event.preventDefault()
}
function pointerMove(event: PointerEvent): void {
  const point = position(event)
  rememberPointer(point.x)
  if (gesture) {
    gesture.moved ||= Math.abs(point.x - gesture.x) > 3 || Math.abs(point.y - gesture.y) > 3
    if (gesture.kind === 'pan') {
      const delta = BigInt(Math.round((point.x - gesture.x) / plotWidth() * Number(duration(gesture.viewport))))
      store.setViewport({ start: gesture.viewport.start - delta, end: gesture.viewport.end - delta })
    } else if (gesture.kind === 'scrub') store.seek(toTime(Math.max(gutter, Math.min(width - 13, point.x))))
    else if (gesture.moved) {
      const current = toTime(Math.max(gutter, Math.min(width - 13, point.x)))
      store.setSelection(current > gesture.origin ? { start: gesture.origin, end: current } : { start: current, end: gesture.origin })
    }
    return
  }
  const hit = [...hits].reverse().find(hit => point.x >= hit.left && point.x <= hit.right && point.y >= hit.top && point.y <= hit.bottom)
  tooltip.value = hit ? { left: Math.max(gutter, Math.min(point.x + 14, width - 285)), top: Math.max(ruler + 5, Math.min(point.y + 15, height - 64)), label: hit.event?.name ?? `聚合区间 · ${hit.bin!.count} 条记录`, description: hit.event ? `${formatTime(hit.event.start)} → ${formatTime(hit.event.end)} · ${formatTime(hit.event.end - hit.event.start)}` : '放大或展开原始轨道以查看独立任务' } : null
}
function pointerUp(event: PointerEvent): void {
  if (!gesture) return
  const previous = gesture
  gesture = null
  panning.value = false
  if (overlay.value?.hasPointerCapture(event.pointerId)) overlay.value.releasePointerCapture(event.pointerId)
  if (previous.kind === 'select' && !previous.moved) {
    if (previous.event) void store.selectEvent(previous.event)
    store.seek(previous.origin)
  }
  if (previous.kind === 'scrub' && previous.resume) store.clock.play()
}
function doubleClick(event: MouseEvent): void {
  const bounds = overlay.value!.getBoundingClientRect()
  const horizontal = event.clientX - bounds.left
  const vertical = event.clientY - bounds.top
  const hit = [...hits].reverse().find(hit => horizontal >= hit.left && horizontal <= hit.right && vertical >= hit.top && vertical <= hit.bottom)
  if (hit?.event) { void store.selectEvent(hit.event); const margin = (hit.event.end - hit.event.start) / 5n || 100n; store.setViewport({ start: hit.event.start - margin, end: hit.event.end + margin }) }
  else store.zoom(0.25, toTime(horizontal))
}
function wheel(event: WheelEvent): void {
  rememberPointer(Math.max(gutter, Math.min(width - 13, position(event).x)))
  if (event.ctrlKey || event.metaKey) {
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1)
    store.zoom(Math.exp(Math.max(-1, Math.min(1, delta * 0.002))))
  }
  else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    const delta = BigInt(Math.round((event.deltaX || event.deltaY) / plotWidth() * Number(duration(store.viewport))))
    store.setViewport({ start: store.viewport.start + delta, end: store.viewport.end + delta })
  } else if (scroller.value) scroller.value.scrollTop += event.deltaY
}
function scroll(): void { scrollTop.value = scroller.value?.scrollTop ?? 0; invalidate() }
function overviewDown(event: PointerEvent): void {
  if (!store.sources.length) return
  store.stopZoom()
  const bounds = overviewCanvas.value!.getBoundingClientRect()
  const horizontal = event.clientX - bounds.left
  if (horizontal < gutter) return
  const chartWidth = overviewCanvas.value!.clientWidth - gutter - 13
  const left = gutter + Number(store.viewport.start - store.bounds.start) / Number(duration(store.bounds)) * chartWidth
  const right = gutter + Number(store.viewport.end - store.bounds.start) / Number(duration(store.bounds)) * chartWidth
  overviewGesture = { kind: Math.abs(horizontal - left) < 8 ? 'left' : Math.abs(horizontal - right) < 8 ? 'right' : 'move', x: horizontal, range: { ...store.viewport } }
  if (horizontal < left || horizontal > right) { const center = store.bounds.start + BigInt(Math.round((horizontal - gutter) / chartWidth * Number(duration(store.bounds)))); const half = duration(store.viewport) / 2n; store.setViewport({ start: center - half, end: center + half }); overviewGesture.range = { ...store.viewport } }
  overviewCanvas.value?.setPointerCapture(event.pointerId)
}
function overviewMove(event: PointerEvent): void {
  if (!overviewGesture) return
  const bounds = overviewCanvas.value!.getBoundingClientRect()
  const chartWidth = overviewCanvas.value!.clientWidth - gutter - 13
  const delta = BigInt(Math.round((event.clientX - bounds.left - overviewGesture.x) / chartWidth * Number(duration(store.bounds))))
  const range = overviewGesture.range
  if (overviewGesture.kind === 'left') store.setViewport({ start: range.start + delta < range.end - 100n ? range.start + delta : range.end - 100n, end: range.end })
  else if (overviewGesture.kind === 'right') store.setViewport({ start: range.start, end: range.end + delta > range.start + 100n ? range.end + delta : range.start + 100n })
  else store.setViewport({ start: range.start + delta, end: range.end + delta })
}
function overviewUp(event: PointerEvent): void { overviewGesture = null; if (overviewCanvas.value?.hasPointerCapture(event.pointerId)) overviewCanvas.value.releasePointerCapture(event.pointerId) }

watch(() => [store.viewport, store.rows, store.sources], invalidate)
watch(() => [store.currentTime, store.selection, store.bookmarks], scheduleOverlay, { deep: false })
watch(() => [store.selectedEvent, store.selectedCuId], scheduleBackground)
watch(() => store.overview, scheduleBackground)
watch(() => store.selectedCuId, id => {
  if (!id || !scroller.value) return
  const index = store.rows.findIndex(row => row.cuId === id)
  const top = index * rowHeight
  if (top < scrollTop.value || top > scrollTop.value + height - ruler - rowHeight) scroller.value.scrollTop = top
})
onMounted(() => {
  observer = new ResizeObserver(() => { width = viewportElement.value?.clientWidth ?? width; height = viewportElement.value?.clientHeight ?? height; invalidate() })
  if (viewportElement.value) observer.observe(viewportElement.value)
  invalidate()
})
onBeforeUnmount(() => { store.stopZoom(); store.setZoomPointer(null); observer?.disconnect(); queryVersion++; if (queryTimer) clearTimeout(queryTimer); if (drawFrame) cancelAnimationFrame(drawFrame); if (overlayFrame) cancelAnimationFrame(overlayFrame) })
</script>

<template>
  <section class="timeline" aria-label="推理重放时间轴">
    <div class="timeline-heading"><div class="section-label"><span class="tiny-dot blue" />时间轴<span class="timeline-mode">{{ dense ? '密度聚合' : '原始区间' }}</span></div><div class="timeline-heading-actions"><span>{{ formatTime(store.viewport.end - store.viewport.start) }} 可视范围</span><button class="icon-button" aria-label="缩小时间轴" title="缩小 · S" @click="store.zoom(2)"><Minus :size="14" /></button><button class="icon-button" aria-label="放大时间轴" title="放大 · W" @click="store.zoom(0.5)"><Plus :size="14" /></button><span class="toolbar-divider" /><button class="icon-button" aria-label="适配全部时间" title="适配全部时间 · F" @click="store.fit()"><Expand :size="14" /></button><button class="icon-button" aria-label="缩放到选区" title="缩放到选区 · Z" @click="store.zoomSelection()"><Focus :size="14" /></button><button class="icon-button" :class="{ selected: store.following }" aria-label="跟随播放头" :aria-pressed="store.following" title="跟随播放头" @click="store.following = !store.following"><Crosshair :size="14" /></button></div></div>
    <canvas ref="overviewCanvas" class="timeline-overview" height="34" aria-label="全局任务密度与可视窗口，可拖动边缘缩放" @pointerdown="overviewDown" @pointermove="overviewMove" @pointerup="overviewUp" @pointercancel="overviewUp" />
    <div ref="viewportElement" class="timeline-viewport">
      <canvas ref="background" class="timeline-background" aria-hidden="true" />
      <canvas ref="overlay" class="timeline-overlay" :class="{ panning }" :aria-busy="store.zooming" role="img" aria-label="轨道与任务时间轴。左键拖动框选，右键拖动平移，W 在鼠标处放大，S 在鼠标处缩小，A 向左平移，D 向右平移。点击事件定位到鼠标对应时间。" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @pointerleave="pointerLeave" @dblclick="doubleClick" @wheel.prevent="wheel" @contextmenu.prevent />
      <div ref="scroller" class="timeline-vertical-scroller" @scroll="scroll"><div :style="{ height: `${store.rows.length * rowHeight + ruler}px` }" /></div>
      <div v-if="querying" class="timeline-query-loading"><LoaderCircle :size="12" class="spin" />更新窗口</div>
      <div v-if="tooltip && !gesture" class="canvas-tooltip timeline-tooltip" :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"><strong>{{ tooltip.label }}</strong><span>{{ tooltip.description }}</span></div>
      <div v-if="!store.sources.length && !store.loading" class="timeline-empty"><Focus :size="27" /><span>导入 trace，开始探索推理过程</span></div>
    </div>
    <div class="timeline-footer"><span><span class="tiny-dot" />{{ store.rows.length }} 条展示轨道 · {{ dense ? '放大查看独立任务' : '点击事件查看详情' }}</span><span>W / S 缩放<span class="footer-dot">·</span>A / D 平移<span class="footer-dot">·</span>右键 拖动<span class="footer-dot">·</span>左键 框选</span></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crosshair, Expand, Focus, LoaderCircle, Minus, Plus } from 'lucide-vue-next'
import { duration, formatTime } from '../core/time'
import { operatorColor as eventColor, operatorOpacity, resolvedTheme, themeColor } from '../core/theme'
import type { ReplayDensity, ReplayEvent, TimelineRow, TimeRange } from '../core/types'
import { useReplayStore } from '../stores/replay'
import { TimelineCache, type TimelineRequest, type TimelineTrackData } from '../engine/timeline-cache'
import { ScrollMotion } from '../engine/scroll-motion'
import { fitTimelineLabel } from '../engine/timeline-label'

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
const overviewHover = ref<{ left: number; index: number } | null>(null)
const overviewBusy = computed(() => store.overviewActivity.reduce((total, bin) => total + bin.busyDuration, 0n))
const overviewCapacity = computed(() => duration(store.bounds) * BigInt(store.cus.length))
const overviewSummary = computed(() => {
  if (store.overviewActivityLoading) return '正在统计…'
  if (store.overviewActivityError) return '统计失败，切换后重试'
  if (!store.overviewActivity.length || !overviewCapacity.value) return '暂无数据 · 0–100%'
  return `全程 ${(Number(overviewBusy.value) / Number(overviewCapacity.value) * 100).toFixed(2)}% · 0–100%`
})
const overviewTooltip = computed(() => {
  const bin = overviewHover.value && store.overviewActivity[overviewHover.value.index]
  if (store.overviewMetric !== 'utilization' || !bin || !store.cus.length) return null
  return { left: overviewHover.value!.left, label: `任务利用率 ${(Number(bin.busyDuration) / Number((bin.end - bin.start) * BigInt(store.cus.length)) * 100).toFixed(2)}%`, description: `${formatTime(bin.start)} – ${formatTime(bin.end)} · ${store.cus.length} 个已记录 CU` }
})
const gutter = 170
const ruler = 31
const rowHeight = 29
let width = 900
let height = 280
let observer: ResizeObserver | null = null
let drawFrame = 0
let overlayFrame = 0
let overviewBase: HTMLCanvasElement | null = null
let overviewKey: unknown[] = []
let queryFrame = 0
let queryRunning = false
let queryRequested = false
let disposed = false
let queryVersion = 0
let data = new Map<string, TimelineTrackData>()
const verticalMotion = new ScrollMotion(
  () => scroller.value?.scrollTop ?? 0,
  () => scroller.value ? scroller.value.scrollHeight - scroller.value.clientHeight : 0,
  position => { if (scroller.value) { scroller.value.scrollTop = position; scroll() } },
)
const labelWidths = new Map<string, number>()
function stopMotion(): void { store.stopPan(); verticalMotion.cancel() }
function drawLabel(canvas: CanvasRenderingContext2D, name: string, left: number, right: number, top: number): void {
  if (right - left < 17) return
  canvas.font = '11px "Segoe UI", sans-serif'
  const label = fitTimelineLabel(name.replace('TASK_', ''), right - left - 8, text => {
    let width = labelWidths.get(text)
    if (width === undefined) {
      width = canvas.measureText(text).width
      if (labelWidths.size >= 4096) labelWidths.clear()
      labelWidths.set(text, width)
    }
    return width
  })
  if (!label) return
  canvas.save(); canvas.beginPath(); canvas.rect(left + 3, top + 5, right - left - 6, rowHeight - 10); canvas.clip()
  canvas.fillStyle = themeColor('operator-ink', '#111824'); canvas.fillText(label, left + 4, top + 14); canvas.restore()
}
const cache = new TimelineCache()
const overviewTracks = computed(() => {
  const tracks = new Map<string, ReplayDensity[]>()
  for (const bin of store.overview) {
    const key = `${bin.sourceId}:${bin.trackId}`
    const bins = tracks.get(key) ?? []
    bins.push(bin)
    tracks.set(key, bins)
  }
  return tracks
})
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
function visibleRows(padding = 0): TimelineRow[] { const first = Math.max(0, Math.floor(scrollTop.value / rowHeight) - 1 - padding); return store.rows.slice(first, Math.min(store.rows.length, Math.ceil((scrollTop.value + height - ruler) / rowHeight) + 2 + padding)) }
function scheduleBackground(): void { if (!drawFrame) drawFrame = requestAnimationFrame(draw); scheduleOverlay() }
function scheduleOverlay(): void { if (!overlayFrame) overlayFrame = requestAnimationFrame(drawOverlay) }
function invalidate(): void {
  updateData()
  scheduleBackground()
  queryRequested = true
  if (!queryFrame) queryFrame = requestAnimationFrame(() => { queryFrame = 0; void query() })
}

function requests(timePadding = 0n, rowPadding = 0): TimelineRequest[] {
  const visible = visibleRows(rowPadding).filter(row => row.kind !== 'device')
  const range = { start: store.viewport.start - timePadding > store.bounds.start ? store.viewport.start - timePadding : store.bounds.start, end: store.viewport.end + timePadding < store.bounds.end ? store.viewport.end + timePadding : store.bounds.end }
  const resolution = Number(duration(store.viewport)) / plotWidth()
  return store.displayedSources.map(source => ({ source, range, resolution, density: resolution > 18000, trackIds: [...new Set(visible.filter(row => row.sourceId === source.source.metadata.id).flatMap(row => row.trackIds))] })).filter(request => request.trackIds.length)
}

function updateData(): void {
  const next = new Map<string, TimelineTrackData>()
  let anyDensity = false
  let missing = false
  for (const request of requests()) {
    missing ||= !cache.covers(request)
    for (const trackId of request.trackIds) {
      const key = `${request.source.source.metadata.id}:${trackId}`
      const track = cache.read(request, trackId) ?? { events: [], bins: overviewTracks.value.get(key) ?? [], dense: true }
      next.set(key, track)
      anyDensity ||= track.dense
    }
  }
  data = next
  dense.value = anyDensity
  querying.value = missing && !store.loading
}

async function query(): Promise<void> {
  if (queryRunning || disposed) return
  queryRequested = false
  if (store.loading) return
  const rowCount = Math.max(1, Math.ceil((height - ruler) / rowHeight))
  const warm = requests(duration(store.viewport) / 4n, Math.ceil(rowCount / 3))
  if (warm.every(request => cache.covers(request))) { updateData(); scheduleBackground(); return }
  const pending = requests(duration(store.viewport), rowCount).filter(request => {
    const required = warm.find(candidate => candidate.source === request.source)
    return !required || !cache.covers(required)
  })
  const version = queryVersion
  queryRunning = true
  try {
    await Promise.all(pending.map(async request => {
      await cache.load(request)
      if (version === queryVersion && !disposed) { updateData(); scheduleBackground() }
    }))
  } catch (error) { if (version === queryVersion) store.notify(error instanceof Error ? error.message : String(error), 'error') }
  finally {
    queryRunning = false
    if (!disposed) {
      querying.value = false
      if (queryRequested) void query()
    }
  }
}

function draw(): void {
  drawFrame = 0
  if (!background.value || !viewportElement.value) return
  width = viewportElement.value.clientWidth
  height = viewportElement.value.clientHeight
  const canvas = context(background.value, width, height)
  canvas.fillStyle = themeColor('canvas-background', '#0e131c')
  canvas.fillRect(0, 0, width, height)
  canvas.fillStyle = themeColor('canvas-panel', '#121925')
  canvas.fillRect(0, 0, gutter, height)
  canvas.fillStyle = themeColor('canvas-panel', '#121925')
  canvas.fillRect(0, 0, width, ruler)
  canvas.font = '11px "Segoe UI", sans-serif'
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
    canvas.strokeStyle = themeColor('canvas-grid', '#222b3b')
    canvas.setLineDash([2, 4]); canvas.beginPath(); canvas.moveTo(horizontal, ruler); canvas.lineTo(horizontal, height); canvas.stroke(); canvas.setLineDash([])
    canvas.fillStyle = themeColor('canvas-muted', '#8290a6'); canvas.fillText(formatTime(tick, 1), horizontal + 6, 15)
    canvas.strokeStyle = themeColor('border-strong', '#354055'); canvas.beginPath(); canvas.moveTo(horizontal, ruler - 5); canvas.lineTo(horizontal, ruler); canvas.stroke()
  }
  canvas.restore()
  canvas.fillStyle = themeColor('canvas-muted', '#77869e'); canvas.fillText('资源 / 原始轨道', 15, 15)
  hits = []
  const visible = visibleRows()
  for (const row of visible) {
    const index = store.rows.indexOf(row)
    const top = ruler + index * rowHeight - scrollTop.value
    if (top < ruler - rowHeight || top > height) continue
    canvas.save(); canvas.beginPath(); canvas.rect(0, ruler, width, height - ruler); canvas.clip()
    const selected = row.cuId === store.selectedCuId
    if (row.kind === 'device') { canvas.fillStyle = themeColor('surface-raised', '#19212e'); canvas.fillRect(0, top, width, rowHeight) }
    else if (selected) { canvas.fillStyle = themeColor('selection-fill', '#8cafff0d'); canvas.fillRect(0, top, width, rowHeight) }
    canvas.strokeStyle = themeColor('canvas-grid', '#202735'); canvas.beginPath(); canvas.moveTo(0, top + rowHeight - 0.5); canvas.lineTo(width, top + rowHeight - 0.5); canvas.stroke()
    canvas.fillStyle = selected ? themeColor('accent', '#c0d2ff') : row.kind === 'device' ? themeColor('canvas-label', '#b5c1d3') : themeColor('canvas-label', '#9caac0')
    canvas.font = `${row.kind === 'device' ? '600 ' : ''}11px "Segoe UI", sans-serif`
    canvas.save(); canvas.beginPath(); canvas.rect(0, top, gutter - 4, rowHeight); canvas.clip()
    if (row.kind === 'group') { canvas.fillStyle = themeColor('canvas-muted', '#64738b'); canvas.fillText(store.expandedGroups.has(row.id) ? '▾' : '▸', 12, top + 14); canvas.fillStyle = selected ? themeColor('accent', '#c0d2ff') : themeColor('canvas-label', '#a1afc3') }
    canvas.fillText(row.label, row.kind === 'track' ? 29 : row.kind === 'device' ? 13 : 26, top + 14)
    canvas.fillStyle = themeColor('canvas-muted', '#596b86'); canvas.font = '11px "Segoe UI", sans-serif'; canvas.textAlign = 'right'; canvas.fillText(row.subtitle, gutter - 13, top + 14); canvas.textAlign = 'left'
    canvas.restore()
    if (row.kind !== 'device') {
      canvas.save(); canvas.beginPath(); canvas.rect(gutter, top + 2, plotWidth(), rowHeight - 4); canvas.clip()
      const tracks = row.trackIds.map(trackId => data.get(`${row.sourceId}:${trackId}`)).filter((track): track is TimelineTrackData => track !== undefined)
      const bins = tracks.flatMap(track => track.bins).filter(bin => bin.start < store.viewport.end && bin.end > store.viewport.start)
      const merged = new Map<number, ReplayDensity>()
      for (const bin of bins) {
        const bucket = Math.floor((toX(bin.start) - gutter) / 3)
        const existing = merged.get(bucket)
        if (existing) {
          existing.count += bin.count
          if ((bin.representativeDuration ?? 0n) > (existing.representativeDuration ?? 0n)) { existing.name = bin.name; existing.representativeDuration = bin.representativeDuration }
          if (bin.end > existing.end) existing.end = bin.end
        }
        else merged.set(bucket, { ...bin })
      }
      for (const bin of merged.values()) {
        const left = Math.max(gutter, toX(bin.start))
        const right = Math.min(width - 13, toX(bin.end))
        if (right < gutter || left > width) continue
        canvas.fillStyle = `${eventColor(bin.name ?? '')}${operatorOpacity(selected)}`
        canvas.fillRect(left, top + 5, Math.max(2, right - left - 0.5), rowHeight - 10)
        if (bin.name) drawLabel(canvas, bin.name, left, right, top)
        hits.push({ bin, left, right: Math.max(left + 2, right), top: top + 4, bottom: top + rowHeight - 3 })
      }
      const events = tracks.flatMap(track => track.events).filter(event => event.start < store.viewport.end && event.end > store.viewport.start).sort((left, right) => Number((right.end - right.start) - (left.end - left.start)))
      for (const event of events) {
        const left = Math.max(gutter, toX(event.start))
        const right = Math.min(width - 13, toX(event.end))
        if (right < gutter || left > width) continue
        const chosen = event.id === store.selectedEvent?.id && event.sourceId === store.selectedEvent.sourceId
        const color = eventColor(event.name)
        canvas.fillStyle = `${color}${operatorOpacity(chosen)}`
        canvas.beginPath(); canvas.roundRect(left, top + 5, Math.max(1, right - left - 1), rowHeight - 10, 2); canvas.fill()
        if (chosen) { canvas.strokeStyle = themeColor('accent', '#eff5ff'); canvas.stroke() }
        drawLabel(canvas, event.name, left, right, top)
        hits.push({ event, left, right: Math.max(left + 2, right), top: top + 4, bottom: top + rowHeight - 3 })
      }
      canvas.restore()
    }
    canvas.restore()
  }
  canvas.strokeStyle = themeColor('border-strong', '#303b50'); canvas.beginPath(); canvas.moveTo(gutter - 0.5, 0); canvas.lineTo(gutter - 0.5, height); canvas.stroke()
  canvas.strokeStyle = themeColor('border', '#2a3446'); canvas.beginPath(); canvas.moveTo(0, ruler - 0.5); canvas.lineTo(width, ruler - 0.5); canvas.stroke()
}

function drawOverlay(): void {
  overlayFrame = 0
  if (!overlay.value) return
  const canvas = context(overlay.value, width, height)
  canvas.save(); canvas.beginPath(); canvas.rect(gutter, 0, plotWidth(), height); canvas.clip()
  if (store.selection) {
    const left = toX(store.selection.start)
    const right = toX(store.selection.end)
    canvas.fillStyle = themeColor('selection-fill', '#93b5ff18'); canvas.fillRect(left, ruler, right - left, height - ruler)
    canvas.strokeStyle = themeColor('selection-stroke', '#9abafa8a'); canvas.setLineDash([4, 3]); canvas.strokeRect(left + 0.5, ruler, right - left, height - ruler); canvas.setLineDash([])
  }
  for (const bookmark of store.bookmarks) {
    const horizontal = toX(bookmark.time)
    canvas.fillStyle = themeColor('warning', '#e1b77d'); canvas.beginPath(); canvas.moveTo(horizontal, 2); canvas.lineTo(horizontal + 4, 6); canvas.lineTo(horizontal, 10); canvas.lineTo(horizontal - 4, 6); canvas.closePath(); canvas.fill()
  }
  const playhead = Math.round(toX(store.currentTime)) + 0.5
  canvas.strokeStyle = themeColor('accent', '#c0d3ff'); canvas.lineWidth = 1; canvas.beginPath(); canvas.moveTo(playhead, 8); canvas.lineTo(playhead, height); canvas.stroke()
  canvas.fillStyle = themeColor('accent', '#c0d3ff'); canvas.beginPath(); canvas.moveTo(playhead - 5, 0); canvas.lineTo(playhead + 5, 0); canvas.lineTo(playhead + 5, 5); canvas.lineTo(playhead, 10); canvas.lineTo(playhead - 5, 5); canvas.closePath(); canvas.fill()
  canvas.restore()
  drawOverview()
}

function drawOverviewBase(canvas: CanvasRenderingContext2D, canvasWidth: number): void {
  canvas.fillStyle = themeColor('canvas-background', '#101620'); canvas.fillRect(0, 0, canvasWidth, 34)
  const chartWidth = Math.max(1, canvasWidth - gutter - 13)
  const full = Number(duration(store.bounds))
  if (store.overviewMetric === 'utilization') {
    canvas.strokeStyle = themeColor('canvas-grid', '#36544a66'); canvas.beginPath(); canvas.moveTo(gutter, 7); canvas.lineTo(gutter + chartWidth, 7); canvas.moveTo(gutter, 17); canvas.lineTo(gutter + chartWidth, 17); canvas.stroke()
    for (const bin of store.overviewActivity) {
      const capacity = (bin.end - bin.start) * BigInt(store.cus.length)
      const ratio = capacity > 0n ? Math.max(0, Math.min(1, Number(bin.busyDuration) / Number(capacity))) : 0
      const left = gutter + Number(bin.start - store.bounds.start) / full * chartWidth
      const barWidth = Number(bin.end - bin.start) / full * chartWidth
      canvas.fillStyle = themeColor('success', '#439c86'); canvas.fillRect(left, 27 - ratio * 20, Math.max(1, barWidth - 1), ratio * 20)
    }
  } else {
    const values = new Array<number>(180).fill(0)
    for (const bin of store.overview) { const index = Math.max(0, Math.min(179, Math.floor(Number(bin.start - store.bounds.start) / full * 180))); values[index]! += bin.count }
    const maximum = Math.max(1, ...values)
    for (const [index, value] of values.entries()) {
      canvas.fillStyle = themeColor('accent', '#415d88')
      const barHeight = Math.log1p(value) / Math.log1p(maximum) * 20
      canvas.fillRect(gutter + index * chartWidth / values.length, 27 - barHeight, Math.max(1, chartWidth / values.length - 1), barHeight)
    }
  }
}

function drawOverview(): void {
  if (!overviewCanvas.value) return
  const canvasWidth = overviewCanvas.value.clientWidth
  if (canvasWidth <= 0) return
  const nextKey = [canvasWidth, Math.min(devicePixelRatio || 1, 2), resolvedTheme.value, store.overviewMetric, store.overview, store.overviewActivity, store.bounds.start, store.bounds.end, store.cus.length]
  if (!overviewBase || nextKey.some((value, index) => value !== overviewKey[index])) {
    overviewBase ??= document.createElement('canvas')
    drawOverviewBase(context(overviewBase, canvasWidth, 34), canvasWidth)
    overviewKey = nextKey
  }
  const canvas = context(overviewCanvas.value, canvasWidth, 34)
  canvas.drawImage(overviewBase, 0, 0, canvasWidth, 34)
  const chartWidth = Math.max(1, canvasWidth - gutter - 13)
  const full = Number(duration(store.bounds))
  const left = gutter + Number(store.viewport.start - store.bounds.start) / full * chartWidth
  const right = gutter + Number(store.viewport.end - store.bounds.start) / full * chartWidth
  canvas.fillStyle = themeColor('selection-fill', '#9bbdff0d'); canvas.fillRect(left, 3, right - left, 27)
  canvas.strokeStyle = themeColor('selection-stroke', '#9bbdff70'); canvas.strokeRect(left + 0.5, 3.5, Math.max(1, right - left - 1), 26)
  canvas.fillStyle = themeColor('accent', '#a7c0ed'); canvas.fillRect(left, 10, 2, 12); canvas.fillRect(right - 2, 10, 2, 12)
  const playhead = gutter + Number(store.currentTime - store.bounds.start) / full * chartWidth
  canvas.fillStyle = themeColor('accent', '#c0d3ff'); canvas.fillRect(playhead, 3, 1, 27)
}

function pointerDown(event: PointerEvent): void {
  if (!store.displayedSources.length || ![0, 1, 2].includes(event.button)) return
  stopMotion()
  store.stopZoom()
  const point = position(event)
  rememberPointer(point.x)
  const pan = event.button === 1 || event.button === 2 || store.spaceHeld
  if (point.x < gutter && !pan) {
    const row = store.rows[Math.floor((point.y - ruler + scrollTop.value) / rowHeight)]
    if (row?.kind === 'group') { store.toggleGroup(row.id); if (row.cuId) store.selectCu(row.cuId, true) }
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
  tooltip.value = hit ? { left: Math.max(gutter, Math.min(point.x + 14, width - 285)), top: Math.max(ruler + 5, Math.min(point.y + 15, height - 64)), label: hit.event?.name ?? `聚合区间 · ${hit.bin!.count} 条记录`, description: hit.event ? `${formatTime(hit.event.start)} → ${formatTime(hit.event.end)} · ${formatTime(hit.event.end - hit.event.start)}` : `代表算子：${hit.bin!.name ?? '未知'} · 放大查看独立任务` } : null
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
  tooltip.value = null
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1
  if (event.ctrlKey || event.metaKey) {
    stopMotion()
    const delta = event.deltaY * unit
    store.zoom(Math.exp(Math.max(-1, Math.min(1, delta * 0.002))))
  }
  else {
    const horizontal = (event.shiftKey ? event.deltaX || event.deltaY : event.deltaX) * unit
    if (horizontal) store.pan(BigInt(Math.round(horizontal / plotWidth() * Number(duration(store.viewport)))))
    if (!event.shiftKey) verticalMotion.move(event.deltaY * unit)
  }
}
function scroll(): void { scrollTop.value = scroller.value?.scrollTop ?? 0; invalidate() }
function overviewDown(event: PointerEvent): void {
  if (!store.displayedSources.length) return
  stopMotion()
  overviewHover.value = null
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
  const bounds = overviewCanvas.value!.getBoundingClientRect()
  const chartWidth = overviewCanvas.value!.clientWidth - gutter - 13
  if (!overviewGesture) {
    const horizontal = event.clientX - bounds.left
    const index = Math.floor((horizontal - gutter) / chartWidth * store.overviewActivity.length)
    overviewHover.value = index >= 0 && index < store.overviewActivity.length ? { left: Math.max(gutter, Math.min(bounds.width - 270, horizontal + 12)), index } : null
    return
  }
  const delta = BigInt(Math.round((event.clientX - bounds.left - overviewGesture.x) / chartWidth * Number(duration(store.bounds))))
  const range = overviewGesture.range
  if (overviewGesture.kind === 'left') store.setViewport({ start: range.start + delta < range.end - 100n ? range.start + delta : range.end - 100n, end: range.end })
  else if (overviewGesture.kind === 'right') store.setViewport({ start: range.start, end: range.end + delta > range.start + 100n ? range.end + delta : range.start + 100n })
  else store.setViewport({ start: range.start + delta, end: range.end + delta })
}
function overviewUp(event: PointerEvent): void { overviewGesture = null; if (overviewCanvas.value?.hasPointerCapture(event.pointerId)) overviewCanvas.value.releasePointerCapture(event.pointerId) }

watch(() => [store.viewport, store.rows, store.loading], invalidate)
watch(() => store.displayedSources, () => { stopMotion(); queryVersion++; cache.clear(); invalidate() })
watch(() => [store.currentTime, store.selection, store.bookmarks], scheduleOverlay, { deep: false })
watch(() => [store.selectedEvent, store.selectedCuId], scheduleBackground)
watch(() => store.timelineFocus, target => {
  if (!target || !scroller.value) return
  const index = store.rows.findIndex(row => row.kind === 'device' && row.sourceId === target.sourceId)
  if (index < 0) return
  verticalMotion.cancel()
  scroller.value.scrollTop = index * rowHeight
  scroll()
}, { flush: 'post' })
watch(resolvedTheme, () => { labelWidths.clear(); scheduleBackground() })
watch(() => [store.overview, store.overviewMetric, store.overviewActivity], () => { overviewHover.value = null; updateData(); scheduleBackground() })
watch(() => store.selectedCuId, id => {
  if (!id || !scroller.value) return
  verticalMotion.cancel()
  const index = store.rows.findIndex(row => row.cuId === id)
  const top = index * rowHeight
  if (top < scrollTop.value || top > scrollTop.value + height - ruler - rowHeight) scroller.value.scrollTop = top
})
onMounted(() => {
  observer = new ResizeObserver(() => { width = viewportElement.value?.clientWidth ?? width; height = viewportElement.value?.clientHeight ?? height; invalidate() })
  if (viewportElement.value) observer.observe(viewportElement.value)
  invalidate()
})
onBeforeUnmount(() => { disposed = true; stopMotion(); store.stopZoom(); store.setZoomPointer(null); observer?.disconnect(); queryVersion++; cache.clear(); if (queryFrame) cancelAnimationFrame(queryFrame); if (drawFrame) cancelAnimationFrame(drawFrame); if (overlayFrame) cancelAnimationFrame(overlayFrame) })
</script>

<template>
  <section class="timeline" aria-label="推理重放时间轴">
    <div class="timeline-heading"><div class="section-label"><span class="tiny-dot blue" />时间轴<span class="timeline-mode">{{ dense ? '密度聚合' : '原始区间' }}</span></div><div class="timeline-heading-actions"><span>{{ formatTime(store.viewport.end - store.viewport.start) }} 可视范围</span><button class="icon-button" aria-label="缩小时间轴" :disabled="!store.displayedSources.length" title="缩小 · S" @click="store.zoom(2)"><Minus :size="14" /></button><button class="icon-button" aria-label="放大时间轴" :disabled="!store.displayedSources.length" title="放大 · W" @click="store.zoom(0.5)"><Plus :size="14" /></button><span class="toolbar-divider" /><button class="icon-button" aria-label="适配全部时间" :disabled="!store.displayedSources.length" title="适配全部时间 · F" @click="store.fit()"><Expand :size="14" /></button><button class="icon-button" aria-label="缩放到选区" :disabled="!store.displayedSources.length || !store.selection" title="缩放到选区 · Z" @click="store.zoomSelection()"><Focus :size="14" /></button><button class="icon-button" :class="{ selected: store.following }" aria-label="跟随播放头" :disabled="!store.displayedSources.length" :aria-pressed="store.following" title="跟随播放头" @click="store.following = !store.following"><Crosshair :size="14" /></button></div></div>
    <div class="timeline-overview-strip">
      <canvas ref="overviewCanvas" class="timeline-overview" height="34" role="img" :aria-label="`${store.overviewMetric === 'density' ? '全局任务密度' : '全局任务利用率'}与可视窗口，可拖动边缘缩放`" :aria-busy="store.overviewActivityLoading" @pointerdown="overviewDown" @pointermove="overviewMove" @pointerup="overviewUp" @pointercancel="overviewUp" @pointerleave="overviewHover = null" />
      <div class="timeline-overview-controls">
        <select v-model="store.overviewMetric" aria-label="全局概览指标" title="任务利用率按每段时间内各 CU 的活动时间并集计算，纵轴固定为 0–100%；统计所有计算卡，独立于当前选区和卡筛选。">
          <option value="density">全局任务密度</option>
          <option value="utilization">全局任务利用率</option>
        </select>
        <span v-if="store.overviewMetric === 'utilization'" class="timeline-overview-summary" :title="store.overviewActivityError ?? `${overviewBusy} / ${overviewCapacity} CU·ns`">{{ overviewSummary }}</span>
        <span v-else>事件数量 · 对数刻度</span>
      </div>
      <div v-if="overviewTooltip" class="canvas-tooltip overview-tooltip" :style="{ left: `${overviewTooltip.left}px` }"><strong>{{ overviewTooltip.label }}</strong><span>{{ overviewTooltip.description }}</span></div>
    </div>
    <div ref="viewportElement" class="timeline-viewport">
      <canvas ref="background" class="timeline-background" aria-hidden="true" />
      <canvas ref="overlay" class="timeline-overlay" :class="{ panning }" :aria-busy="store.zooming || store.panningViewport" role="img" aria-label="轨道与任务时间轴。左键拖动框选，右键拖动平移，W 在鼠标处放大，S 在鼠标处缩小，A 向左平移，D 向右平移。点击事件定位到鼠标对应时间。" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @pointerleave="pointerLeave" @dblclick="doubleClick" @wheel.prevent="wheel" @contextmenu.prevent />
      <div ref="scroller" class="timeline-vertical-scroller" @scroll="scroll" @wheel.prevent="wheel" @pointerdown="stopMotion"><div :style="{ height: `${store.rows.length * rowHeight + ruler}px` }" /></div>
      <div v-if="querying" class="timeline-query-loading"><LoaderCircle :size="12" class="spin" />更新窗口</div>
      <div v-if="tooltip && !gesture" class="canvas-tooltip timeline-tooltip" :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"><strong>{{ tooltip.label }}</strong><span>{{ tooltip.description }}</span></div>
      <div v-if="!store.displayedSources.length && !store.loading" class="timeline-empty"><Focus :size="27" /><span>{{ store.sources.length ? '在左侧勾选要显示的文件' : '导入 trace，开始探索推理过程' }}</span></div>
    </div>
    <div class="timeline-footer"><span><span class="tiny-dot" />{{ store.rows.length }} 条展示轨道 · {{ dense ? '放大查看独立任务' : '点击事件查看详情' }}</span><span>W / S 缩放<span class="footer-dot">·</span>A / D 平移<span class="footer-dot">·</span>右键 拖动<span class="footer-dot">·</span>左键 框选</span></div>
  </section>
</template>

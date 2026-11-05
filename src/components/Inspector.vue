<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Activity, ArrowUpRight, Braces, ChevronRight, Crosshair, Info, Layers3, Search, X } from 'lucide-vue-next'
import { eventColor, formatTime } from '../core/time'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const tab = ref<'details' | 'range' | 'search'>('details')
const eventSource = computed(() => store.sources.find(source => source.source.metadata.id === store.selectedEvent?.sourceId))
const cu = computed(() => store.cus.find(cu => cu.id === store.selectedCuId))
const range = computed(() => store.selection)
watch(() => store.searchText, value => { if (value.trim()) tab.value = 'search' })
watch(() => store.selection, value => { if (value) tab.value = 'range' })
watch(() => store.selectedEvent, value => { if (value) tab.value = 'details' })
function locate(): void { if (!store.selectedEvent) return; store.seek(store.selectedEvent.start); store.zoomSelection() }
</script>

<template>
  <aside class="inspector">
    <div class="inspector-tabs"><button :class="{ active: tab === 'details' }" @click="tab = 'details'">详情</button><button :class="{ active: tab === 'range' }" @click="tab = 'range'">选区<span v-if="store.selection" class="tiny-dot" /></button><button :class="{ active: tab === 'search' }" @click="tab = 'search'"><Search :size="13" />搜索<span v-if="store.searchResults.length" class="tiny-count">{{ store.searchResults.length }}</span></button></div>
    <div class="inspector-scroll">
      <template v-if="tab === 'details'">
        <template v-if="store.selectedEvent">
          <div class="eyebrow">选中事件</div><div class="event-title"><span class="event-dot" :style="{ background: eventColor(store.selectedEvent.name) }" /><h3>{{ store.selectedEvent.name }}</h3></div>
          <div class="event-tags"><span>原始任务</span><span>CU {{ cu?.index }}</span><span>group_{{ cu?.groups.find(group => group.id === store.selectedEvent?.groupId)?.index ?? 0 }}</span></div>
          <button class="locate-button" @click="locate"><Crosshair :size="13" />定位到此事件<ArrowUpRight :size="13" /></button>
          <dl class="detail-list"><div><dt>开始时间</dt><dd>{{ formatTime(store.selectedEvent.start) }}</dd></div><div><dt>结束时间</dt><dd>{{ formatTime(store.selectedEvent.end) }}</dd></div><div><dt>持续时间</dt><dd class="text-accent">{{ formatTime(store.selectedEvent.end - store.selectedEvent.start) }}</dd></div><div><dt>计算卡</dt><dd>{{ eventSource?.device.label }}</dd></div><div><dt>原始轨道</dt><dd>#{{ store.selectedEvent.trackId }}</dd></div><div><dt>记录 ID</dt><dd>#{{ store.selectedEvent.id }}</dd></div></dl>
          <div v-if="store.selectedEvent.incomplete" class="notice warning"><Info :size="14" />此区间未闭合，显示到记录结束。</div>
          <div class="section-label"><Braces :size="13" />记录属性</div><dl v-if="Object.keys(store.eventArgs).length" class="detail-list"><div v-for="(value, key) in store.eventArgs" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl><p v-else class="muted-description">此事件没有额外属性。算子与模型层映射尚未提供。</p>
          <div class="source-footnote">{{ eventSource?.source.metadata.filename }}</div>
        </template>
        <template v-else>
          <div class="inspector-heading"><Activity :size="16" /><h3>{{ cu ? `CU ${cu.index}` : '当前位置' }}</h3><span class="live-badge">{{ store.buffering ? '缓冲' : store.playing ? '重放中' : '已暂停' }}</span></div>
          <div class="time-hero">{{ formatTime(store.currentTime) }}</div>
          <div class="summary-grid"><div><strong>{{ store.activeByCu.size }}</strong><span>有记录任务的 CU</span></div><div><strong>{{ store.activeEvents.length }}</strong><span>活动任务</span></div></div>
          <div class="section-label"><Layers3 :size="13" />{{ cu ? '此 CU 的当前任务' : '当前活动任务' }}</div>
          <div class="live-task-list"><button v-for="event in (cu ? store.activeByCu.get(cu.id) ?? [] : store.activeEvents).slice(0, 7)" :key="`${event.sourceId}-${event.id}`" @click="store.selectEvent(event)"><span class="event-dot" :style="{ background: eventColor(event.name) }" /><span>{{ event.name }}</span><ChevronRight :size="12" /></button><p v-if="!(cu ? store.activeByCu.get(cu.id)?.length : store.activeEvents.length)" class="muted-description">当前位置没有记录任务。</p></div>
          <div class="section-label">采集能力</div><dl class="detail-list"><div><dt>资源层级</dt><dd>CU → Group</dd></div><div><dt>任务区间</dt><dd class="text-green">已记录</dd></div><div><dt>硬件利用率</dt><dd>未采集</dd></div><div><dt>算子映射</dt><dd>未提供</dd></div></dl><div class="notice"><Info :size="14" />任务活动来自 trace，不代表实测算力利用率。</div>
        </template>
      </template>
      <template v-else-if="tab === 'range'">
        <div class="inspector-heading"><Crosshair :size="16" /><h3>区间统计</h3><button v-if="range" class="icon-button" aria-label="清除选区" @click="store.setSelection(null)"><X :size="14" /></button></div>
        <template v-if="range"><div class="time-hero">{{ formatTime(range.end - range.start) }}</div><dl class="detail-list"><div><dt>区间开始</dt><dd>{{ formatTime(range.start) }}</dd></div><div><dt>区间结束</dt><dd>{{ formatTime(range.end) }}</dd></div><div><dt>覆盖事件</dt><dd>{{ store.statisticsLoading ? '计算中…' : store.selectionStats?.count.toLocaleString() ?? '—' }}</dd></div><div><dt>累计事件耗时</dt><dd>{{ store.selectionStats ? formatTime(store.selectionStats.sumDuration) : '—' }}</dd></div><div><dt>记录活动并集</dt><dd>{{ store.selectionStats && store.selectionStats.unionDuration >= 0n ? formatTime(store.selectionStats.unionDuration) : store.sources.length > 1 ? '多来源独立统计' : '—' }}</dd></div></dl><div class="inspector-actions"><button class="subtle-button" @click="store.zoomSelection()">缩放到选区</button><button class="subtle-button" :class="{ selected: store.looping }" @click="store.toggleLoop()">{{ store.looping ? '关闭循环' : '循环此区间' }}</button></div><div class="notice"><Info :size="14" />事件裁剪到选区边界；累计耗时包含并发，可以大于区间长度。</div></template>
        <div v-else class="empty-inspector"><Crosshair :size="26" /><h4>选择一段时间</h4><p>在时间轴轨道区拖动框选，即可查看事件数量和耗时。</p></div>
      </template>
      <template v-else>
        <div class="eyebrow">事件搜索</div><p class="muted-description">{{ store.searching ? '正在查询原始记录…' : store.searchText.trim() ? `找到 ${store.searchResults.length} 条记录，最多展示 100 条。` : '使用工作区顶部的搜索框查找任务。' }}</p>
        <button v-for="event in store.searchResults" :key="`${event.sourceId}-${event.id}`" class="search-result" @click="store.selectEvent(event); store.seek(event.start)"><span class="event-dot" :style="{ background: eventColor(event.name) }" /><span><strong>{{ event.name }}</strong><small>{{ formatTime(event.start) }} · {{ formatTime(event.end - event.start) }}</small></span><ArrowUpRight :size="13" /></button>
      </template>
    </div>
  </aside>
</template>

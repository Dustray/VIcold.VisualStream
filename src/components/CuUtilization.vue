<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Info, LoaderCircle } from 'lucide-vue-next'
import { duration, formatTime } from '../core/time'
import type { GroupStatistics, TimeRange } from '../core/types'
import { summarizeCuUtilization } from '../engine/cu-utilization'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const scope = ref<'full' | 'selection'>(store.selection ? 'selection' : 'full')
const sort = ref<'cu' | 'descending' | 'ascending'>('cu')
const loading = ref(false)
const error = ref('')
const statistics = shallowRef<GroupStatistics[] | null>(null)
const resolvedRange = shallowRef<TimeRange>({ ...store.bounds })
const range = computed(() => scope.value === 'selection' && store.selection ? store.selection : store.bounds)
const report = computed(() => statistics.value ? summarizeCuUtilization(resolvedRange.value, store.displayedDevices, statistics.value) : null)
const devices = computed(() => new Map(store.devices.map(device => [device.id, device])))
const perDevice = computed(() => statistics.value ? store.displayedDevices.map(device => ({ device, report: summarizeCuUtilization(resolvedRange.value, [device], statistics.value!) })) : [])
const items = computed(() => {
  const rows = [...(report.value?.items ?? [])]
  if (sort.value !== 'cu') rows.sort((left, right) => ((left.ratio ?? 0) - (right.ratio ?? 0)) * (sort.value === 'ascending' ? 1 : -1))
  return rows
})
const selected = computed(() => report.value?.items.find(item => item.cuId === store.selectedCuId))
const cache = new Map<string, GroupStatistics[]>()
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

function percent(ratio: number | null | undefined): string { return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(2)}%` }
function deviceLabel(id: string): string {
  const device = devices.value.get(id)
  return device ? `${device.label}${device.rank === null ? '' : ` · Rank ${device.rank}`}` : ''
}
function refresh(): void {
  const version = ++generation
  if (timer) clearTimeout(timer)
  statistics.value = null
  error.value = ''
  loading.value = !!store.displayedSources.length
  if (!store.displayedSources.length) return
  const period = { ...range.value }
  const queries = store.displayedSources.map(source => ({ source, key: `${source.source.metadata.id}:${source.offset}:${period.start}:${period.end}` }))
  timer = setTimeout(async () => {
    timer = null
    try {
      const values = await Promise.all(queries.map(async ({ source, key }) => {
        const cached = cache.get(key)
        if (cached) return cached
        const result = await source.cuStatistics(period)
        cache.set(key, result)
        if (cache.size > 16) cache.delete(cache.keys().next().value!)
        return result
      }))
      if (version !== generation) return
      resolvedRange.value = period
      statistics.value = values.flat()
    } catch (failure) { if (version === generation) error.value = failure instanceof Error ? failure.message : String(failure) }
    finally { if (version === generation) loading.value = false }
  }, 180)
}

watch(() => store.selection, value => { scope.value = value ? 'selection' : 'full' })
watch([() => store.displayedSources, range], refresh, { immediate: true })
onBeforeUnmount(() => { generation++; if (timer) clearTimeout(timer) })
</script>

<template>
  <section class="cu-utilization" aria-label="CU 利用率统计" :aria-busy="loading">
    <div class="utilization-controls">
      <div class="utilization-scopes" role="group" aria-label="利用率统计范围">
        <button :aria-pressed="scope === 'full'" @click="scope = 'full'">整个时间周期</button>
        <button :aria-pressed="scope === 'selection'" :disabled="!store.selection" @click="scope = 'selection'">当前选区</button>
      </div>
      <span class="utilization-period" :title="`${range.start} → ${range.end} ns`">{{ formatTime(range.start) }} → {{ formatTime(range.end) }}</span>
      <span v-if="loading" class="utilization-loading" role="status"><LoaderCircle :size="13" class="spin" />正在统计…</span>
    </div>
    <div class="utilization-description"><Info :size="13" /><p>按任务记录估算：每个 CU 的活动时间并集 ÷ 统计时长。重叠任务只计一次，未记录任务的时段按无活动计；仅包含已记录 CU，不代表硬件计数器测得的计算单元忙碌率。</p></div>
    <div v-if="!store.displayedSources.length" class="utilization-empty">{{ store.sources.length ? '在左侧勾选文件后查看 CU 利用率。' : '导入记录后即可查看 CU 利用率。' }}</div>
    <div v-else-if="error" class="utilization-error" role="alert"><p>利用率统计失败：{{ error }}</p><button class="subtle-button" @click="refresh">重新计算</button></div>
    <template v-else>
      <div class="utilization-summary">
        <div><span>CU 总体利用率</span><strong class="utilization-total">{{ percent(report?.ratio) }}</strong><small>{{ report?.items.length ?? store.displayedDevices.reduce((total, device) => total + device.cus.length, 0) }} 个已记录 CU · 按容量加权</small></div>
        <div><span>累计活动时间</span><strong class="utilization-total-busy" :title="report ? `${report.busyDuration} ns` : ''">{{ report ? formatTime(report.busyDuration) : '—' }}</strong><small>各 CU 活动并集之和</small></div>
        <div><span>平均活动 CU</span><strong>{{ report?.equivalentCus?.toFixed(2) ?? '—' }}</strong><small>统计区间内的等效活动数量</small></div>
        <div><span>统计时长</span><strong>{{ formatTime(duration(range)) }}</strong><small>{{ scope === 'selection' ? '时间轴划取范围' : '所有来源的完整时间范围' }}</small></div>
      </div>
      <div v-if="perDevice.length > 1" class="utilization-devices">
        <div v-for="entry in perDevice" :key="entry.device.id" class="utilization-device"><span>{{ deviceLabel(entry.device.id) }}<small>{{ entry.report.items.length }} CU</small></span><strong>{{ percent(entry.report.ratio) }}</strong></div>
      </div>
      <div class="utilization-table-heading"><span>{{ selected ? `已选 CU ${selected.index} · ${deviceLabel(selected.deviceId)} · ${percent(selected.ratio)}` : '每个 CU 的利用率' }}</span><label>排序<select v-model="sort" aria-label="CU 利用率排序"><option value="cu">CU 编号</option><option value="descending">利用率从高到低</option><option value="ascending">利用率从低到高</option></select></label></div>
      <div class="utilization-table-scroll">
        <table class="utilization-table"><thead><tr><th>CU</th><th>计算卡</th><th>利用率</th><th>活动时间</th><th>无记录任务</th><th>任务数量</th></tr></thead>
          <tbody><tr v-for="item in items" :key="item.cuId" :class="{ selected: item.cuId === store.selectedCuId }" :data-cu-id="item.cuId">
            <td><button :aria-label="`选择 ${deviceLabel(item.deviceId)} CU ${item.index}`" :aria-pressed="item.cuId === store.selectedCuId" @click="store.selectCu(item.cuId, true)">CU {{ String(item.index).padStart(2, '0') }}</button></td><td>{{ deviceLabel(item.deviceId) }}</td>
            <td><div class="utilization-value"><div class="utilization-meter" role="meter" :aria-label="`${deviceLabel(item.deviceId)} CU ${item.index} 利用率`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="item.ratio === null ? undefined : (item.ratio * 100).toFixed(4)"><i :style="{ width: `${(item.ratio ?? 0) * 100}%` }" /></div><span>{{ percent(item.ratio) }}</span></div></td>
            <td class="utilization-busy" :title="`${item.busyDuration} ns`">{{ formatTime(item.busyDuration) }}</td><td :title="`${item.idleDuration} ns`">{{ formatTime(item.idleDuration) }}</td><td>{{ item.eventCount.toLocaleString() }}</td>
          </tr></tbody>
        </table>
        <p v-if="!loading && !items.length" class="utilization-empty">当前筛选下没有已记录 CU。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cu-utilization { min-height: 0; flex: 1; overflow: auto; padding: 16px 18px; }
.utilization-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.utilization-scopes { display: inline-flex; border: 1px solid var(--vs-border, #304565); border-radius: 5px; padding: 3px; background: var(--vs-surface-panel, #121d2d); }
.utilization-scopes button { border-radius: 3px; padding: 6px 10px; color: var(--vs-text-secondary, #839dbc); font-size: 12px; }
.utilization-scopes button[aria-pressed="true"] { color: var(--vs-text-primary, #c4d9fc); background: var(--vs-surface-selected, #2a4265); }
.utilization-scopes button:disabled { opacity: .4; cursor: default; }
.utilization-period { font-size: 11px; color: var(--vs-text-secondary, #829bbd); font-variant-numeric: tabular-nums; }
.utilization-loading { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11px; color: var(--vs-accent, #9ab9e9); }
.utilization-description { display: flex; gap: 7px; color: var(--vs-text-secondary, #7891b2); margin: 12px 0 16px; font-size: 11px; line-height: 1.7; }
.utilization-description svg { flex-shrink: 0; margin-top: 2px; }
.utilization-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--vs-border, #2c405d); border-radius: 6px; background: var(--vs-surface-raised, #152135); }
.utilization-summary > div { padding: 12px; border-right: 1px solid var(--vs-border, #2c405d); min-width: 0; }
.utilization-summary > div:last-child { border: 0; }
.utilization-summary span { display: block; font-size: 11px; color: var(--vs-text-secondary, #819aba); }
.utilization-summary strong { display: block; font-size: 21px; font-weight: 500; color: var(--vs-text-primary, #b7d1fb); margin: 8px 0; font-variant-numeric: tabular-nums; }
.utilization-summary small { display: block; font-size: 11px; color: var(--vs-text-muted, #667f9f); line-height: 1.6; }
.utilization-devices { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.utilization-device { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 15px; border: 1px solid var(--vs-border, #283d58); border-radius: 4px; padding: 9px 12px; font-size: 12px; color: var(--vs-text-secondary, #91a9c9); }
.utilization-device small { margin-left: 10px; font-size: 11px; color: var(--vs-text-muted, #6480a4); }
.utilization-device strong { font-variant-numeric: tabular-nums; font-weight: 500; color: var(--vs-success, #9bc8be); }
.utilization-table-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 17px 0 8px; font-size: 11px; color: var(--vs-text-secondary, #90a9cc); }
.utilization-table-heading label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vs-text-muted, #6c86a9); }
.utilization-table-heading select { font-size: 11px; padding: 4px 7px; }
.utilization-table-scroll { overflow-x: auto; }
.utilization-table { min-width: 585px; }
.utilization-table th { white-space: nowrap; }
.utilization-table th:nth-child(3) { width: 27%; }
.utilization-table td { white-space: nowrap; font-size: 11px; padding: 9px 6px; }
.utilization-table tr.selected { background: var(--vs-surface-selected, #1d3351); }
.utilization-table td button { text-align: left; color: var(--vs-text-primary, #acc8ef); padding: 3px 0; }
.utilization-value { display: flex; align-items: center; gap: 9px; }
.utilization-value > span { min-width: 47px; text-align: right; }
.utilization-meter { flex: 1; height: 5px; min-width: 45px; border-radius: 3px; overflow: hidden; background: var(--vs-surface-raised, #22344e); }
.utilization-meter i { display: block; height: 100%; border-radius: inherit; background: var(--vs-success, #79b9b2); }
.utilization-empty { text-align: center; padding: 35px 10px; font-size: 12px; color: var(--vs-text-secondary, #7891b2); }
.utilization-error { padding: 20px 0; font-size: 12px; color: var(--vs-danger, #efb1b5); }
.utilization-error button { margin-top: 10px; }
@media (max-width: 1200px) { .utilization-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .utilization-summary > div:nth-child(2) { border-right: 0; } .utilization-summary > div:nth-child(-n+2) { border-bottom: 1px solid var(--vs-border, #2c405d); } }
</style>

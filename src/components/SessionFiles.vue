<script setup lang="ts">
import { toRef } from 'vue'
import { ChevronDown, ChevronRight, Cpu, FileChartColumn, FolderOpen, History, Layers3, X } from 'lucide-vue-next'
import { formatBytes } from '../core/time'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const sessionExpanded = toRef(store.ui, 'sessionExpanded')
const historyExpanded = toRef(store.ui, 'historyExpanded')
const inSession = (fingerprint: string) => store.sources.some(source => source.source.metadata.fingerprint === fingerprint)
</script>

<template>
  <section aria-label="当前会话" class="sidebar-panel session-files" :class="{ 'is-collapsed': !sessionExpanded }">
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
  <section aria-label="历史文件" class="sidebar-panel history-files" :class="{ 'is-collapsed': !historyExpanded, 'is-primary': !sessionExpanded }">
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

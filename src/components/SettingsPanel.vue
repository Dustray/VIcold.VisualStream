<script setup lang="ts">
import { ref } from 'vue'
import { Palette, Settings2, ShieldCheck } from 'lucide-vue-next'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import Button from './ui/Button.vue'
import ThemeSelect from './ThemeSelect.vue'
import { parseMilliseconds } from '../core/time'
import { useReplayStore } from '../stores/replay'

withDefaults(defineProps<{ initialTab?: 'appearance' | 'session' }>(), { initialTab: 'appearance' })
const store = useReplayStore()
const timeInput = ref('')
const customSpeed = ref('')

function seekInput(): void {
  const value = parseMilliseconds(timeInput.value)
  if (value === null) { store.notify('请输入毫秒时间，最多保留六位小数'); return }
  store.seek(value)
  timeInput.value = ''
}
function applyCustomSpeed(): void {
  try { store.clock.setSpeed(Number(customSpeed.value)); customSpeed.value = '' }
  catch (error) { store.notify(String(error), 'error') }
}
function offsetChanged(sourceId: string, event: Event): void {
  const value = parseMilliseconds((event.target as HTMLInputElement).value)
  if (value === null) store.notify('时钟偏移需要有效的毫秒数', 'error')
  else store.setOffset(sourceId, value)
}
</script>

<template>
  <TabsRoot :default-value="initialTab" class="settings-panel">
    <TabsList class="settings-tabs" aria-label="设置分类">
      <TabsTrigger value="appearance"><Palette :size="15" />界面主题</TabsTrigger>
      <TabsTrigger value="session"><Settings2 :size="15" />会话设置</TabsTrigger>
    </TabsList>
    <TabsContent value="appearance" class="settings-tab-content">
      <div class="settings-appearance-row">
        <div><h3>界面主题</h3><p>选择工作台的界面配色</p></div>
        <ThemeSelect />
      </div>
      <p class="settings-description">主题选择会自动保存在当前设备。选择「跟随系统」后，界面会随系统的明亮或深暗模式切换。</p>
    </TabsContent>
    <TabsContent value="session" class="settings-tab-content">
      <div class="settings-grid">
        <label>计算模式<span>{{ store.computeModelLabel }} v1</span></label>
        <label>源文件解析器<span>Perfetto v1</span></label>
        <label>{{ store.supportsCu ? '计算资源解释' : '轨道解释' }}<span>{{ store.supportsCu ? '多卡 → CU → Group' : '文件 → 原始轨道' }}</span></label>
        <label>渲染方式<span>Canvas 2D · 分级细节</span></label>
      </div>
      <div class="section-label">精确跳转与速度</div>
      <div class="settings-input-row"><label>时间位置（ms）<input v-model="timeInput" inputmode="decimal" placeholder="例如 50.125" @keydown.enter="seekInput" /></label><Button variant="secondary" size="sm" @click="seekInput">跳转</Button></div>
      <div class="settings-input-row"><label>自定义速度（×）<input v-model="customSpeed" inputmode="decimal" placeholder="0.001 — 1000" @keydown.enter="applyCustomSpeed" /></label><Button variant="secondary" size="sm" @click="applyCustomSpeed">应用</Button></div>
      <div class="section-label">来源与时钟偏移</div>
      <div v-for="source in store.sources" :key="source.source.metadata.id" class="source-offset"><span :title="source.source.metadata.filename">{{ source.device ? `${source.device.label}${source.device.rank === null ? '' : ` · Rank ${source.device.rank}`}` : source.source.metadata.filename }}</span><label><input :value="Number(source.offset) / 1e6" type="number" step="0.001" :aria-label="`${source.device?.label ?? source.source.metadata.filename} 的时钟偏移`" @change="offsetChanged(source.source.metadata.id, $event)" /><span>ms</span></label></div>
      <p v-if="!store.sources.length" class="settings-description">导入 trace 后，可在这里调整各来源的时钟偏移。</p>
      <div class="notice"><ShieldCheck :size="15" />不同来源默认相对起点对齐。填写偏移不等于已经验证物理时钟同步；{{ store.supportsCu ? '设备与 rank 标签来自文件名提示。' : '默认模式按文件保留原始轨道。' }}</div>
      <div class="section-label">导入诊断</div>
      <p v-for="message in store.diagnostics" :key="message" class="diagnostic-item">{{ message }}</p>
      <p v-if="!store.diagnostics.length" class="settings-description">暂无导入诊断。</p>
    </TabsContent>
  </TabsRoot>
</template>

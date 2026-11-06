<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { duration } from '../core/time'
import { defaultPlaybackSpeed, playbackSpeeds as speeds } from '../core/playback-speed'
import { useReplayStore } from '../stores/replay'

const store = useReplayStore()
const lastPreset = ref(speeds.indexOf(defaultPlaybackSpeed))
const demoSpeed = computed(() => Math.max(0.000001, Number(duration(store.bounds)) / 20e9))
const demo = ref(false)
const preset = computed(() => speeds.findIndex(value => Math.abs(value - store.speed) < 1e-10))
const position = computed(() => preset.value < 0 ? lastPreset.value : preset.value)
const speedLabel = computed(() => `${store.speed.toLocaleString('en-US', { maximumFractionDigits: 6 })}×`)
watch([preset, demo], ([index, enabled]) => { if (!enabled && index >= 0) lastPreset.value = index }, { immediate: true, flush: 'sync' })
watch([() => store.speed, demoSpeed, () => store.sources.length], () => {
  if (!store.sources.length || Math.abs(store.speed - demoSpeed.value) >= 1e-10) demo.value = false
}, { flush: 'sync' })

function changeSpeed(event: Event): void {
  if (demo.value) return
  const index = Number((event.target as HTMLInputElement).value)
  const speed = speeds[index]
  if (speed === undefined) return
  lastPreset.value = index
  store.clock.setSpeed(speed)
}
function toggleDemo(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked
  const speed = enabled ? demoSpeed.value : speeds[lastPreset.value]!
  demo.value = enabled
  store.clock.setSpeed(speed)
}
</script>

<template>
  <div class="playback-speed">
    <label class="speed-slider-label" :title="`重放速度 ${speedLabel} · 拖动切换固定档位 · E 加速 / Q 减速`">
      <span>速度</span>
      <input type="range" min="0" :max="speeds.length - 1" step="1" :value="position" :disabled="demo" aria-label="重放速度" :aria-valuetext="demo ? `${speedLabel}，20s 演示` : speedLabel" list="playback-speed-stops" @input="changeSpeed" />
      <datalist id="playback-speed-stops"><option v-for="(speed, index) in speeds" :key="speed" :value="index" :label="`${speed}×`" /></datalist>
      <output class="speed-value">{{ speedLabel }}</output>
    </label>
    <label class="demo-speed-label" title="按完整时间范围计算速度，约 20 秒播放完整段推理">
      <input type="checkbox" :checked="demo" :disabled="!store.sources.length" @change="toggleDemo" />20s 演示
    </label>
  </div>
</template>

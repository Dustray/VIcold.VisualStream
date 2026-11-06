<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Copy, Minus, Square, X } from 'lucide-vue-next'
import type { WorkspaceWindow } from '../host/types'

const props = defineProps<{ controls: WorkspaceWindow }>()
const emit = defineEmits<{ error: [message: string] }>()
const maximized = ref(false)
let unlisten: (() => void) | undefined
let disposed = false

async function updateMaximized(): Promise<void> {
  try { maximized.value = await props.controls.isMaximized() }
  catch (error) { if (!disposed) emit('error', String(error)) }
}
async function action(operation: () => Promise<void>): Promise<void> {
  try { await operation(); if (!disposed) await updateMaximized() }
  catch (error) { emit('error', String(error)) }
}
onMounted(async () => {
  try {
    const cleanup = await props.controls.onResized(() => { void updateMaximized() })
    if (disposed) { cleanup(); return }
    unlisten = cleanup
    await updateMaximized()
  } catch (error) { if (!disposed) emit('error', String(error)) }
})
onBeforeUnmount(() => { disposed = true; unlisten?.() })
</script>

<template>
  <div class="window-controls" role="group" aria-label="窗口控制">
    <button type="button" class="window-button" aria-label="最小化窗口" title="最小化" @click="action(controls.minimize)"><Minus :size="15" /></button>
    <button type="button" class="window-button" :aria-label="maximized ? '还原窗口' : '最大化窗口'" :title="maximized ? '还原' : '最大化'" @click="action(controls.toggleMaximize)"><Copy v-if="maximized" :size="13" /><Square v-else :size="13" /></button>
    <button type="button" class="window-button window-close" aria-label="关闭窗口" title="关闭" @click="action(controls.close)"><X :size="17" /></button>
  </div>
</template>

<style scoped>
.window-controls { display: flex; align-self: stretch; flex-shrink: 0; margin-left: 4px; border-left: 1px solid var(--vs-border, #242d3d); }
.window-button { display: flex; align-items: center; justify-content: center; width: 46px; height: 100%; border: 0; border-radius: 0; background: transparent; color: var(--vs-text-secondary, #99a7bd); cursor: default; }
.window-button:hover { background: var(--vs-surface-hover, #23354d); color: var(--vs-text-primary, #c7d2e3); }
.window-button:focus-visible { outline: 2px solid var(--vs-accent, #9dbbfa); outline-offset: -3px; }
.window-close:hover { background: #c42b1c; color: #fff; }
</style>

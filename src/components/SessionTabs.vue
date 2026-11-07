<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { FolderOpen, LoaderCircle, Plus, X } from 'lucide-vue-next'
import { useSessionsStore } from '../stores/sessions'

const sessions = useSessionsStore()
const editingId = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const draftName = ref('')

function focusActive(): void {
  void nextTick(() => {
    const tab = document.getElementById(`session-tab-${sessions.activeId}`)
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    tab?.focus({ preventScroll: true })
  })
}
function activate(id: string): void { sessions.activate(id); focusActive() }
function create(): void { sessions.createSession(); focusActive() }
function close(id: string): void {
  const wasActive = id === sessions.activeId
  sessions.close(id)
  if (wasActive) focusActive()
}
function startRename(id: string, name: string): void {
  editingId.value = id
  draftName.value = name
  void nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() })
}
function finishRename(): void {
  if (!editingId.value) return
  sessions.rename(editingId.value, draftName.value)
  editingId.value = null
}
function navigate(event: KeyboardEvent, id: string): void {
  const index = sessions.sessions.findIndex(session => session.id === id)
  let target = index
  if (event.key === 'ArrowRight') target = (index + 1) % sessions.sessions.length
  else if (event.key === 'ArrowLeft') target = (index + sessions.sessions.length - 1) % sessions.sessions.length
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = sessions.sessions.length - 1
  else if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); close(id); return }
  else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); startRename(id, sessions.sessions[index]!.name); return }
  else return
  event.preventDefault()
  event.stopPropagation()
  activate(sessions.sessions[target]!.id)
}
onMounted(() => { document.getElementById(`session-tab-${sessions.activeId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
</script>

<template>
  <div class="session-tabs">
    <div class="session-tab-list" role="tablist" aria-label="重放会话" @wheel="($event.currentTarget as HTMLElement).scrollLeft += $event.deltaY">
      <div v-for="session in sessions.sessions" :key="session.id" class="session-tab-entry" :class="{ active: session.id === sessions.activeId }" @auxclick.middle.prevent="close(session.id)">
        <input v-if="editingId === session.id" :ref="element => { nameInput = element as HTMLInputElement | null }" v-model="draftName" class="session-name-input" maxlength="80" aria-label="会话名称" @blur="finishRename" @keydown.enter.prevent.stop="finishRename(); focusActive()" @keydown.esc.prevent.stop="editingId = null; focusActive()" />
        <button v-else :id="`session-tab-${session.id}`" class="session-tab" role="tab" :aria-selected="session.id === sessions.activeId" aria-controls="replay-session-panel" :tabindex="session.id === sessions.activeId ? 0 : -1" :title="`${session.name} · ${session.store.sources.length} 个文件 · 双击重命名`" @click="activate(session.id)" @dblclick="startRename(session.id, session.name)" @keydown="navigate($event, session.id)">
          <LoaderCircle v-if="session.store.loading" :size="14" class="spin" /><FolderOpen v-else :size="14" />
          <span class="session-tab-name">{{ session.name }}</span><span v-if="session.store.sources.length" class="session-tab-count">{{ session.store.sources.length }}</span>
        </button>
        <button class="session-tab-close" :aria-label="`关闭会话 ${session.name}`" :tabindex="session.id === sessions.activeId ? 0 : -1" title="关闭会话" @click="close(session.id)"><X :size="12" /></button>
      </div>
    </div>
    <button class="new-session-button icon-button" aria-label="新建会话" title="新建会话" @click="create"><Plus :size="16" /></button>
  </div>
</template>

<style scoped>
.session-tabs { display: flex; align-items: center; flex: 1; min-width: 0; height: 100%; gap: 5px; }
.session-tab-list { display: flex; min-width: 0; height: 100%; overflow-x: auto; overflow-y: hidden; align-items: stretch; gap: 3px; scrollbar-width: thin; }
.session-tab-entry { display: flex; flex: 0 0 auto; align-items: center; position: relative; max-width: 230px; border: 1px solid transparent; border-bottom: 2px solid transparent; padding: 0 5px 0 9px; gap: 2px; color: var(--vs-text-muted, #6b7f9d); }
.session-tab-entry:hover { background: var(--vs-surface-hover, #1c2a3e); color: var(--vs-text-primary, #c7d2e3); }
.session-tab-entry.active { border-color: var(--vs-border, #2a3548); border-bottom-color: var(--vs-accent, #9abaff); background: var(--vs-surface-selected, #1b2a42); color: var(--vs-text-primary, #c7d2e3); }
.session-tab { display: flex; align-items: center; gap: 7px; min-width: 0; height: 100%; padding: 0 5px 0 0; font-size: 12px; color: inherit; }
.session-tab > svg { flex-shrink: 0; color: var(--vs-text-secondary, #9eb1ce); }
.session-tab-name { min-width: 38px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }
.session-tab-count { flex-shrink: 0; padding: 1px 5px; border-radius: 4px; font-size: 10px; color: var(--vs-text-secondary, #9eb1ce); background: var(--vs-surface-panel, #101722); }
.session-tab-close { display: grid; place-items: center; flex-shrink: 0; width: 22px; height: 24px; border-radius: 4px; color: var(--vs-text-muted, #6b7f9d); opacity: 0; }
.session-tab-entry:hover .session-tab-close, .session-tab-entry.active .session-tab-close, .session-tab-entry:focus-within .session-tab-close { opacity: 1; }
.session-tab-close:hover { color: var(--vs-text-primary, #c7d2e3); background: var(--vs-surface-hover, #1c2a3e); }
.new-session-button { flex-shrink: 0; }
.session-name-input { width: 140px; height: 28px; min-width: 0; border: 1px solid var(--vs-accent, #9abaff); border-radius: 4px; padding: 0 5px; font-size: 12px; }
</style>

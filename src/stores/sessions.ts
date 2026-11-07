import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { defineStore, getActivePinia } from 'pinia'
import { projectFileLimit, projectFileLimitMessage } from '../core/files'
import { parseProject } from '../core/project'
import { createReplayStore, type ReplayStore } from './replay'

export interface ReplaySession { id: string; name: string; store: ReplayStore }

export const useSessionsStore = defineStore('sessions', () => {
  const pinia = getActivePinia()!
  const sessions = shallowRef<ReplaySession[]>([])
  const activeId = ref('')
  const activeSession = computed(() => sessions.value.find(session => session.id === activeId.value)!)
  let nextNumber = 1

  function suspend(store: ReplayStore): void {
    store.clock.pause()
    store.stopZoom()
    store.setZoomPointer(null)
    store.spaceHeld = false
    store.spaceUsed = false
  }
  function activate(id: string): void {
    if (activeId.value === id || !sessions.value.some(session => session.id === id)) return
    if (activeSession.value) suspend(activeSession.value.store)
    activeId.value = id
  }
  function createSession(name?: string, makeActive = true): ReplaySession {
    const id = crypto.randomUUID()
    const session = { id, name: name?.trim() || `会话 ${nextNumber++}`, store: createReplayStore(id, pinia) }
    sessions.value = [...sessions.value, session]
    if (makeActive || !activeId.value) activate(id)
    return session
  }
  function rename(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 80)
    if (trimmed) sessions.value = sessions.value.map(session => session.id === id ? { ...session, name: trimmed } : session)
  }
  function release(session: ReplaySession): void {
    suspend(session.store)
    session.store.$dispose()
    delete pinia.state.value[session.store.$id]
  }
  function close(id: string): void {
    const index = sessions.value.findIndex(session => session.id === id)
    if (index < 0) return
    const session = sessions.value[index]!
    if (activeId.value === id) {
      suspend(session.store)
      activeId.value = sessions.value[index + 1]?.id ?? sessions.value[index - 1]?.id ?? ''
    }
    sessions.value = sessions.value.filter(session => session.id !== id)
    release(session)
    if (!sessions.value.length) createSession()
  }
  async function openProject(file: File, originId = activeId.value): Promise<void> {
    const origin = sessions.value.find(session => session.id === originId)
    if (!origin) return
    try {
      if (file.size > projectFileLimit) throw new Error(projectFileLimitMessage)
      const project = parseProject(await file.text())
      if (!sessions.value.some(session => session.id === originId)) return
      const name = file.name.replace(/(?:\.vstream)?\.json$/i, '') || '未命名项目'
      const target = !origin.store.sources.length && !origin.store.loading && !origin.store.pendingProject
        ? origin : createSession(name, activeId.value === originId)
      rename(target.id, name)
      await target.store.restoreProject(project)
    } catch (error) { origin.store.notify(`打开项目失败：${error instanceof Error ? error.message : String(error)}`, 'error') }
  }
  function dispose(): void {
    for (const session of sessions.value) release(session)
    sessions.value = []
    activeId.value = ''
  }

  createSession()
  onScopeDispose(dispose)
  return { sessions, activeId, activeSession, createSession, activate, rename, close, openProject, dispose }
})

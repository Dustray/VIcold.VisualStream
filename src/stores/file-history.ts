import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { forgetFile, readFileHistory, rememberFile, type HistoryFile } from '../core/file-history'

export const useFileHistoryStore = defineStore('file-history', () => {
  const files = shallowRef<HistoryFile[]>([])
  const loading = ref(true)
  let initialization: Promise<void> | null = null

  function initialize(): Promise<void> {
    initialization ??= readFileHistory().then(saved => {
      files.value = [...files.value, ...saved.filter(file => !files.value.some(existing => existing.fingerprint === file.fingerprint))].sort((left, right) => right.openedAt - left.openedAt)
    }).finally(() => { loading.value = false })
    return initialization
  }
  async function remember(file: File, fingerprint: string, parserId: string, computeModelId: string): Promise<void> {
    const history = await rememberFile(file, fingerprint, parserId, computeModelId)
    files.value = [history, ...files.value.filter(existing => existing.fingerprint !== history.fingerprint)]
  }
  async function remove(fingerprint: string): Promise<void> {
    await forgetFile(fingerprint)
    files.value = files.value.filter(file => file.fingerprint !== fingerprint)
  }

  return { files, loading, initialize, remember, remove }
})

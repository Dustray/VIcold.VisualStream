import { openWorkspaceDatabase } from './database'

export interface HistoryFile {
  fingerprint: string
  filename: string
  bytes: number
  lastModified: number
  openedAt: number
  parserId: string
  computeModelId: string
}
interface StoredFile extends HistoryFile { blob: Blob }

async function fileRequest<Result>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {
  const database = await openWorkspaceDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', mode)
    const request = operation(transaction.objectStore('files'))
    transaction.oncomplete = () => { database.close(); resolve(request.result) }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error) }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? request.error) }
  })
}

export async function readFileHistory(): Promise<HistoryFile[]> {
  const files = await fileRequest<StoredFile[]>('readonly', store => store.getAll())
  return files.map(({ blob, ...metadata }) => metadata).sort((left, right) => right.openedAt - left.openedAt)
}

export async function rememberFile(file: File, fingerprint: string, parserId: string, computeModelId: string): Promise<HistoryFile> {
  const metadata: HistoryFile = { fingerprint, filename: file.name, bytes: file.size, lastModified: file.lastModified, openedAt: Date.now(), parserId, computeModelId }
  await fileRequest('readwrite', store => store.put({ ...metadata, blob: file } satisfies StoredFile))
  return metadata
}

export async function readHistoryFile(fingerprint: string): Promise<File | null> {
  const stored = await fileRequest<StoredFile | undefined>('readonly', store => store.get(fingerprint))
  return stored ? new File([stored.blob], stored.filename, { lastModified: stored.lastModified }) : null
}

export async function forgetFile(fingerprint: string): Promise<void> {
  await fileRequest('readwrite', store => store.delete(fingerprint))
}

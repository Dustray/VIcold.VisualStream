export async function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('visualstream', 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects')
      if (!database.objectStoreNames.contains('files')) database.createObjectStore('files', { keyPath: 'fingerprint' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

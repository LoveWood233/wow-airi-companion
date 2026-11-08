import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'

export const storage = createStorage({
  driver: memoryDriver(),
})

const localDriver = indexedDbDriver({ base: 'airi-local' })
storage.mount('local', localDriver)
storage.mount('outbox', indexedDbDriver({ base: 'airi-sync-queue' }))

/** Enumerates canonical keys for saved local data. Driver keys include their physical prefix, which callers must not pass back to storage. */
export async function localStorageKeys(): Promise<string[]> {
  if (!localDriver.getKeys)
    throw new Error('Local storage cannot enumerate saved data')
  const keys = await localDriver.getKeys('', {})
  return keys.filter((key): key is string => typeof key === 'string' && key.startsWith('airi-local:'))
    .map(key => `local:${key.slice('airi-local:'.length)}`)
}

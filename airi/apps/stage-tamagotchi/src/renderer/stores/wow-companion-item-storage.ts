import type { GameVersion } from '../../shared/wow-companion'
import type { ItemStorageQuery, ItemStorageQueryResult } from '../../shared/wow-companion-item-storage'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

import { wowItemStorageClear, wowItemStorageQuery } from '../../shared/eventa/wow-companion-item-storage'

function profile() {
  return shallowReactive({ result: null as ItemStorageQueryResult | null, busy: false, error: false, revision: 0 })
}

/** Each game owns its visible query. Changing filters or leaving the page invalidates late IPC replies. */
export const useWowItemStorageStore = defineStore('wow-item-storage', () => {
  const invokeQuery = useElectronEventaInvoke(wowItemStorageQuery)
  const invokeClear = useElectronEventaInvoke(wowItemStorageClear)
  const profiles = { retail: profile(), forever: profile() }

  function reset(game: GameVersion) {
    const state = profiles[game]
    state.revision++
    state.result = null
    state.busy = false
    state.error = false
  }

  async function query(input: ItemStorageQuery) {
    const state = profiles[input.game]
    const revision = ++state.revision
    state.result = null
    state.busy = true
    state.error = false
    try {
      const result = await invokeQuery(input)
      if (revision === state.revision) {
        state.result = result
        state.error = Boolean(result.storageError)
      }
    }
    catch {
      if (revision === state.revision)
        state.error = true
    }
    finally {
      if (revision === state.revision)
        state.busy = false
    }
  }

  async function clear() {
    reset('retail')
    reset('forever')
    try {
      await invokeClear()
    }
    finally {
      reset('retail')
      reset('forever')
    }
  }

  return { profiles, query, reset, clear }
})

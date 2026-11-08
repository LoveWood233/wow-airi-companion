import type { ClaimMemoryNotice, CollectEquipmentMemory, CollectMemory, CompanionMemoryState, EditMemory, MemoryCharacter, MemoryEntryAction, RememberMemory, SetMemoryLimit, SuppressMemory } from '../../shared/wow-companion-memory'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { wowMemoryActivate, wowMemoryClaimNotice, wowMemoryClear, wowMemoryCollect, wowMemoryCollectEquipment, wowMemoryEdit, wowMemoryForget, wowMemoryGet, wowMemoryGetCapacity, wowMemoryRemember, wowMemorySetLimit, wowMemorySuppress } from '../../shared/eventa/wow-companion-memory'

/** Window-local management state. Main owns memory writes, game evidence, and relationship rewards. */
export const useWowCompanionMemoriesStore = defineStore('wow-companion-memories', () => {
  const personaId = shallowRef('default')
  const state = shallowRef<CompanionMemoryState | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef(false)
  let revision = 0
  const get = useElectronEventaInvoke(wowMemoryGet)
  const getCapacity = useElectronEventaInvoke(wowMemoryGetCapacity)
  const setLimit = useElectronEventaInvoke(wowMemorySetLimit)
  const claimNotice = useElectronEventaInvoke(wowMemoryClaimNotice)
  const activate = useElectronEventaInvoke(wowMemoryActivate)
  const save = useElectronEventaInvoke(wowMemoryRemember)
  const change = useElectronEventaInvoke(wowMemoryEdit)
  const collectEntry = useElectronEventaInvoke(wowMemoryCollect)
  const collectEquipmentEntry = useElectronEventaInvoke(wowMemoryCollectEquipment)
  const suppressEntry = useElectronEventaInvoke(wowMemorySuppress)
  const forgetEntry = useElectronEventaInvoke(wowMemoryForget)
  const clearEntries = useElectronEventaInvoke(wowMemoryClear)

  function selectPersona(persona: string) {
    if (persona === personaId.value)
      return
    revision++
    personaId.value = persona
    state.value = null
    loading.value = false
    error.value = false
  }

  async function refresh() {
    const request = ++revision
    const persona = personaId.value
    if (state.value?.relationship.personaId !== persona)
      state.value = null
    loading.value = true
    error.value = false
    try {
      const result = await get({ personaId: persona })
      if (request === revision && persona === personaId.value)
        state.value = result
    }
    catch {
      if (request === revision)
        error.value = true
    }
    finally {
      if (request === revision)
        loading.value = false
    }
  }

  async function apply(operation: Promise<CompanionMemoryState>) {
    const result = await operation
    if (result.relationship.personaId === personaId.value)
      state.value = result
    return result
  }

  /** Per-turn readers bind their captured persona and Warcraft identity rather than consulting later UI selection. */
  function readFor(persona: string, character?: MemoryCharacter) {
    return get({ personaId: persona, ...(character ? { character } : {}) })
  }

  async function clear() {
    revision++
    await clearEntries()
    state.value = null
  }

  return {
    personaId,
    state,
    loading,
    error,
    refresh,
    selectPersona,
    readFor,
    readCapacity: (persona: string) => getCapacity({ personaId: persona }),
    setLimit: (input: SetMemoryLimit) => apply(setLimit(input)),
    claimNotice: (input: ClaimMemoryNotice) => claimNotice(input),
    activate: (persona: string | null) => activate({ personaId: persona }),
    remember: (input: RememberMemory) => apply(save(input)),
    edit: (input: EditMemory) => apply(change(input)),
    collect: (input: CollectMemory) => apply(collectEntry(input)),
    collectEquipment: (input: CollectEquipmentMemory) => apply(collectEquipmentEntry(input)),
    suppress: (input: SuppressMemory) => apply(suppressEntry(input)),
    forget: (input: MemoryEntryAction) => apply(forgetEntry(input)),
    clear,
  }
})

import type { DshPetConfigure, DshPetLibraryState } from '../../shared/dsh-pet-library'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { parse } from 'valibot'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'

import builtinManifest from '../public/dsh-pet/builtin/pack.json'

import { dshPetPackSchema } from '../../shared/dsh-pet'
import { dshPetLibraryStateSchema } from '../../shared/dsh-pet-library'
import { dshPetChanged, dshPetConfigure, dshPetGet, dshPetImport } from '../../shared/eventa/dsh-pet'

const builtin = parse(dshPetPackSchema, { ...builtinManifest, baseUrl: './dsh-pet/builtin' })

/** The bundled pack paints immediately while native persistence restores the chosen pack and scale. */
export const useDshPetStore = defineStore('dsh-pet', () => {
  const context = useElectronEventaContext()
  const get = useElectronEventaInvoke(dshPetGet)
  const configureNative = useElectronEventaInvoke(dshPetConfigure)
  const importNative = useElectronEventaInvoke(dshPetImport)
  const state = shallowRef<DshPetLibraryState>({ selectedId: builtin.id, scale: 1, packs: [builtin] })
  const busy = ref(false)
  const failed = ref(false)
  const initialized = ref(false)
  let loading: Promise<void> | undefined
  const pack = computed(() => state.value.packs.find(pack => pack.id === state.value.selectedId) ?? builtin)
  const scale = computed(() => state.value.scale)
  const stop = context.value.on(dshPetChanged, ({ body }) => {
    try {
      state.value = parse(dshPetLibraryStateSchema, body)
    }
    catch {
      failed.value = true
    }
  })
  onScopeDispose(stop)

  async function refresh() {
    failed.value = false
    try {
      state.value = parse(dshPetLibraryStateSchema, await get())
      initialized.value = true
    }
    catch {
      failed.value = true
    }
  }

  function initialize() {
    if (initialized.value)
      return Promise.resolve()
    loading ??= refresh().finally(() => loading = undefined)
    return loading
  }

  async function update(operation: () => Promise<DshPetLibraryState | null>) {
    if (busy.value)
      return false
    busy.value = true
    failed.value = false
    try {
      const next = await operation()
      if (!next)
        return false
      state.value = parse(dshPetLibraryStateSchema, next)
      initialized.value = true
      return true
    }
    catch {
      failed.value = true
      return false
    }
    finally {
      busy.value = false
    }
  }

  function configure(input: DshPetConfigure) {
    return update(() => configureNative(input))
  }

  function importPack() {
    return update(() => importNative())
  }

  return { state, pack, scale, busy, failed, initialized, initialize, refresh, configure, importPack }
})

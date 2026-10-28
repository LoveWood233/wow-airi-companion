import type { LauncherErrorCode, LauncherExecutable, LauncherSaveRequest, LauncherState, LauncherTarget } from '../../shared/wow-launcher'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { wowLauncherGet, wowLauncherLaunch, wowLauncherPick, wowLauncherSave } from '../../shared/eventa/wow-launcher'

/** Renderer state mirrors persisted main-process settings. Every launch uses and validates the main-process path. */
export const useWowLauncherStore = defineStore('tamagotchi-wow-launcher', () => {
  const get = useElectronEventaInvoke(wowLauncherGet)
  const pickFile = useElectronEventaInvoke(wowLauncherPick)
  const saveConfig = useElectronEventaInvoke(wowLauncherSave)
  const launchProgram = useElectronEventaInvoke(wowLauncherLaunch)
  const state = shallowRef<LauncherState>()
  const executable = shallowRef<LauncherExecutable>()
  const busy = ref(false)
  const loading = ref(false)
  const errorCode = ref<LauncherErrorCode | 'request-failed'>()
  const outcome = ref<'saved' | 'cleared' | 'launched'>()
  let revision = 0

  function clearFeedback() {
    errorCode.value = undefined
    outcome.value = undefined
    executable.value = undefined
  }

  async function refresh() {
    const currentRevision = ++revision
    loading.value = true
    try {
      const result = await get()
      if (currentRevision !== revision)
        return
      state.value = result
      errorCode.value = result.error
    }
    catch {
      if (currentRevision === revision)
        errorCode.value = 'request-failed'
    }
    finally {
      if (currentRevision === revision)
        loading.value = false
    }
  }

  async function browse() {
    if (busy.value)
      return null
    busy.value = true
    clearFeedback()
    try {
      return (await pickFile()).path
    }
    catch {
      errorCode.value = 'request-failed'
      return null
    }
    finally {
      busy.value = false
    }
  }

  async function save(request: LauncherSaveRequest) {
    if (busy.value)
      return false
    busy.value = true
    revision++
    loading.value = false
    clearFeedback()
    try {
      const result = await saveConfig(request)
      if (!result.ok) {
        errorCode.value = result.code
        return false
      }
      state.value = result.state
      executable.value = result.executable
      outcome.value = request.path.trim() ? 'saved' : 'cleared'
      return true
    }
    catch {
      errorCode.value = 'request-failed'
      return false
    }
    finally {
      busy.value = false
    }
  }

  async function launch(target?: LauncherTarget) {
    if (busy.value)
      return false
    busy.value = true
    revision++
    loading.value = false
    clearFeedback()
    try {
      const result = await launchProgram(target ? { target } : {})
      if (!result.ok) {
        errorCode.value = result.code
        return false
      }
      state.value = result.state
      outcome.value = 'launched'
      return true
    }
    catch {
      errorCode.value = 'request-failed'
      return false
    }
    finally {
      busy.value = false
    }
  }

  return { state, executable, busy, loading, errorCode, outcome, clearFeedback, refresh, browse, save, launch }
})

import type { WowDataCacheStatus } from '../../shared/wow-data-cache'
import type { WowDataUpdateStatus } from '../../shared/wow-data-update'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import { wowDataCacheClear, wowDataCacheStatus } from '../../shared/eventa/wow-data-cache'
import { wowDataUpdateActivate, wowDataUpdateCancel, wowDataUpdateCheck, wowDataUpdateChooseGame, wowDataUpdateChooseTools, wowDataUpdateGet, wowDataUpdateStart } from '../../shared/eventa/wow-data-update'

type UpdateAction = 'choose-game' | 'choose-tools' | 'check' | 'start' | 'cancel' | 'activate'

/** The settings page owns this monitor. Polling reads status and cannot start an export or change the selected snapshot. */
export const useWowDataUpdateStore = defineStore('wow-data-update', () => {
  const getStatus = useElectronEventaInvoke(wowDataUpdateGet)
  const chooseGameRoot = useElectronEventaInvoke(wowDataUpdateChooseGame)
  const chooseToolsRoot = useElectronEventaInvoke(wowDataUpdateChooseTools)
  const inspectDependencies = useElectronEventaInvoke(wowDataUpdateCheck)
  const startExport = useElectronEventaInvoke(wowDataUpdateStart)
  const cancelExport = useElectronEventaInvoke(wowDataUpdateCancel)
  const selectSnapshot = useElectronEventaInvoke(wowDataUpdateActivate)
  const getCache = useElectronEventaInvoke(wowDataCacheStatus)
  const clearQueryCache = useElectronEventaInvoke(wowDataCacheClear)
  const status = ref<WowDataUpdateStatus | null>(null)
  const cache = ref<WowDataCacheStatus | null>(null)
  const busy = ref(false)
  const cacheBusy = ref(false)
  const pendingAction = ref<UpdateAction | null>(null)
  const errorCode = ref<string | null>(null)
  const cacheErrorCode = ref<string | null>(null)
  const feedback = ref<'cache-cleared' | 'snapshot-selected' | null>(null)
  const running = computed(() => Boolean(status.value?.job && ['checking', 'exporting', 'building-sqlite', 'verifying'].includes(status.value.job.phase)))
  let generation = 0
  let cacheGeneration = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let monitoring = false
  let statusRead = 0

  function stopMonitoring() {
    monitoring = false
    generation++
    cacheGeneration++
    clearTimeout(timer)
    timer = undefined
    busy.value = false
    cacheBusy.value = false
    pendingAction.value = null
  }

  function accept(value: WowDataUpdateStatus) {
    status.value = value
    errorCode.value = value.errorCode ?? null
  }

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    if (!monitoring || busy.value)
      return
    timer = setTimeout(() => {
      void refresh()
    }, running.value ? 1000 : 300_000)
  }

  async function refresh() {
    const current = generation
    const read = ++statusRead
    try {
      const value = await getStatus()
      if (current === generation && read === statusRead && monitoring)
        accept(value)
    }
    catch {
      if (current === generation && read === statusRead && monitoring)
        errorCode.value = 'bridge-unavailable'
    }
    finally {
      if (current === generation && read === statusRead)
        schedule()
    }
  }

  async function inspectCache() {
    const current = ++cacheGeneration
    cacheBusy.value = true
    try {
      const value = await getCache()
      if (current === cacheGeneration) {
        cache.value = value
        cacheErrorCode.value = value.errorCode ?? null
      }
    }
    catch {
      if (current === cacheGeneration)
        cacheErrorCode.value = 'cache-unavailable'
    }
    finally {
      if (current === cacheGeneration)
        cacheBusy.value = false
    }
  }

  async function initialize() {
    stopMonitoring()
    monitoring = true
    errorCode.value = null
    cacheErrorCode.value = null
    feedback.value = null
    await Promise.allSettled([refresh(), inspectCache()])
  }

  async function run(action: UpdateAction, operation: () => Promise<WowDataUpdateStatus>) {
    if (busy.value)
      return
    const current = ++generation
    clearTimeout(timer)
    timer = undefined
    busy.value = true
    pendingAction.value = action
    errorCode.value = null
    feedback.value = null
    try {
      const value = await operation()
      if (current !== generation)
        return
      accept(value)
      if (action === 'activate' && !value.errorCode)
        feedback.value = 'snapshot-selected'
    }
    catch {
      if (current === generation)
        errorCode.value = 'bridge-unavailable'
    }
    finally {
      if (current === generation) {
        busy.value = false
        pendingAction.value = null
        schedule()
      }
    }
  }

  async function clearCache() {
    if (cacheBusy.value)
      return
    const current = ++cacheGeneration
    cacheBusy.value = true
    cacheErrorCode.value = null
    feedback.value = null
    try {
      const value = await clearQueryCache()
      if (current !== cacheGeneration)
        return
      cache.value = value
      cacheErrorCode.value = value.errorCode ?? null
      if (!value.errorCode)
        feedback.value = 'cache-cleared'
    }
    catch {
      if (current === cacheGeneration)
        cacheErrorCode.value = 'cache-unavailable'
    }
    finally {
      if (current === cacheGeneration)
        cacheBusy.value = false
    }
  }

  onScopeDispose(stopMonitoring)

  return {
    status,
    cache,
    busy,
    cacheBusy,
    pendingAction,
    errorCode,
    cacheErrorCode,
    feedback,
    running,
    initialize,
    refresh,
    inspectCache,
    clearCache,
    stopMonitoring,
    chooseGame: () => run('choose-game', chooseGameRoot),
    chooseTools: () => run('choose-tools', chooseToolsRoot),
    check: () => run('check', inspectDependencies),
    start: () => run('start', startExport),
    cancel: () => run('cancel', cancelExport),
    activate: (id: string) => run('activate', () => selectSnapshot({ id })),
  }
})

import type { StatisticsConfigure, StatisticsState } from '../../shared/wow-statistics'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { parse } from 'valibot'
import { ref, shallowRef } from 'vue'

import { wowStatisticsAcknowledge, wowStatisticsConfigure, wowStatisticsGet } from '../../shared/eventa/wow-statistics'
import { statisticsStateSchema } from '../../shared/wow-statistics'

/** Each window reads the native owner. Closing the disclosure leaves collection disabled until a later explicit acknowledgement. */
export const useWowStatisticsStore = defineStore('wow-statistics', () => {
  const get = useElectronEventaInvoke(wowStatisticsGet)
  const configureNative = useElectronEventaInvoke(wowStatisticsConfigure)
  const acknowledgeNative = useElectronEventaInvoke(wowStatisticsAcknowledge)
  const state = shallowRef<StatisticsState | null>(null)
  const busy = ref(false)
  const failed = ref(false)
  const deferred = ref(false)
  let loading: Promise<void> | undefined
  let revision = 0

  async function refresh() {
    const current = ++revision
    failed.value = false
    try {
      const value = parse(statisticsStateSchema, await get())
      if (current === revision)
        state.value = value
    }
    catch {
      if (current === revision)
        failed.value = true
    }
  }

  function initialize() {
    if (state.value)
      return Promise.resolve()
    loading ??= refresh().finally(() => {
      loading = undefined
    })
    return loading
  }

  async function update(operation: () => Promise<StatisticsState>) {
    if (busy.value)
      return false
    busy.value = true
    failed.value = false
    const current = ++revision
    try {
      const value = parse(statisticsStateSchema, await operation())
      if (current === revision)
        state.value = value
      return true
    }
    catch {
      if (current === revision)
        failed.value = true
      return false
    }
    finally {
      busy.value = false
    }
  }

  function acknowledge(enabled: boolean) {
    return update(() => acknowledgeNative({ enabled }))
  }

  function configure(input: StatisticsConfigure) {
    return update(() => configureNative(input))
  }

  function defer() {
    deferred.value = true
  }

  return { state, busy, failed, deferred, initialize, refresh, acknowledge, configure, defer }
})

import type { RetailDatabaseKind, RetailDatabaseQuery, RetailDatabaseResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowRetailDatabaseStatus } from '../../shared/wow-retail-database'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { retailDatabaseQuerySchema, retailDatabaseResultSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { defineStore } from 'pinia'
import { parse, safeParse } from 'valibot'
import { ref } from 'vue'

import { wowRetailDatabaseClear, wowRetailDatabasePick, wowRetailDatabaseQuery, wowRetailDatabaseStatus } from '../../shared/eventa/wow-retail-database'

export const useWowRetailDatabaseStore = defineStore('wow-retail-database', () => {
  const getStatus = useElectronEventaInvoke(wowRetailDatabaseStatus)
  const pick = useElectronEventaInvoke(wowRetailDatabasePick)
  const clear = useElectronEventaInvoke(wowRetailDatabaseClear)
  const invokeQuery = useElectronEventaInvoke(wowRetailDatabaseQuery)
  const status = ref<WowRetailDatabaseStatus | null>(null)
  const kind = ref<RetailDatabaseKind>('item')
  const query = ref('')
  const results = ref<RetailDatabaseResult | null>(null)
  const detail = ref<RetailDatabaseResult | null>(null)
  const stats = ref<RetailDatabaseResult | null>(null)
  const busy = ref(false)
  const errorCode = ref<string | null>(null)
  let generation = 0
  let lastSearch: { kind: RetailDatabaseKind, query: string } | undefined

  function clearResults() {
    results.value = null
    detail.value = null
    stats.value = null
    lastSearch = undefined
  }

  function acceptStatus(value: WowRetailDatabaseStatus) {
    if (status.value && (status.value.revision !== value.revision || status.value.path !== value.path))
      clearResults()
    status.value = value
  }

  function acceptResult(target: 'results' | 'detail' | 'stats', value: RetailDatabaseResult) {
    const previous = detail.value?.source ?? results.value?.source ?? stats.value?.source
    if (value.source && previous && previous.datasetId !== value.source.datasetId)
      clearResults()
    if (target === 'results')
      results.value = value
    else if (target === 'detail')
      detail.value = value
    else
      stats.value = value
    errorCode.value = value.outcome === 'error' ? value.errorCode ?? 'query-failed' : null
  }

  async function initialize() {
    const current = ++generation
    busy.value = false
    errorCode.value = null
    try {
      const value = await getStatus()
      if (current === generation) {
        acceptStatus(value)
        errorCode.value = value.errorCode ?? null
      }
    }
    catch {
      if (current === generation)
        errorCode.value = 'bridge-unavailable'
    }
  }

  async function change(operation: () => Promise<WowRetailDatabaseStatus>) {
    const current = ++generation
    busy.value = true
    errorCode.value = null
    try {
      const value = await operation()
      if (current !== generation)
        return
      const changed = !status.value || status.value.revision !== value.revision || status.value.path !== value.path
      acceptStatus(value)
      errorCode.value = value.errorCode ?? null
      if (changed && value.configured && !value.errorCode) {
        const result = parse(retailDatabaseResultSchema, await invokeQuery({ operation: 'stats' }))
        if (current === generation)
          acceptResult('stats', result)
      }
    }
    catch {
      if (current === generation)
        errorCode.value = 'bridge-unavailable'
    }
    finally {
      if (current === generation)
        busy.value = false
    }
  }

  async function run(input: RetailDatabaseQuery, target: 'results' | 'detail' | 'stats') {
    if (busy.value)
      return
    const parsed = safeParse(retailDatabaseQuerySchema, input)
    if (!parsed.success) {
      errorCode.value = 'query-invalid'
      return
    }
    const current = ++generation
    busy.value = true
    errorCode.value = null
    try {
      const selected = await getStatus()
      if (current !== generation)
        return
      acceptStatus(selected)
      if (!selected.configured) {
        errorCode.value = 'database-unconfigured'
        return
      }
      const value = parse(retailDatabaseResultSchema, await invokeQuery(parsed.output))
      if (current !== generation)
        return
      if (value.operation !== input.operation || (input.operation === 'fetch' && value.entries.some(entry => entry.id !== input.id))) {
        errorCode.value = 'query-failed'
        return
      }
      acceptResult(target, value)
      if (value.outcome !== 'error' && input.operation === 'search')
        lastSearch = { kind: input.kind, query: input.query }
      if (value.errorCode === 'database-changed') {
        clearResults()
        const selected = await getStatus()
        if (current === generation)
          acceptStatus(selected)
      }
    }
    catch {
      if (current === generation)
        errorCode.value = 'bridge-unavailable'
    }
    finally {
      if (current === generation)
        busy.value = false
    }
  }

  function search(offset = 0) {
    const text = query.value.trim()
    if (offset > 0 && (!lastSearch || lastSearch.kind !== kind.value || lastSearch.query !== text)) {
      errorCode.value = 'query-invalid'
      return Promise.resolve()
    }
    return run({ operation: 'search', kind: kind.value, query: text, limit: 20, offset }, 'results')
  }

  return {
    status,
    kind,
    query,
    results,
    detail,
    stats,
    busy,
    errorCode,
    initialize,
    search,
    fetch: (id: string) => run({ operation: 'fetch', id }, 'detail'),
    inspect: () => run({ operation: 'stats' }, 'stats'),
    pickDatabase: () => change(pick),
    clearDatabase: () => change(clear),
  }
})

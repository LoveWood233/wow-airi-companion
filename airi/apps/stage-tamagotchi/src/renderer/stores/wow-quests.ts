import type { WowQuestFaction, WowQuestQuery, WowQuestResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { GameVersion } from '../../shared/wow-companion'

import { enrichWowQuestEntries, queryWowQuestLog, readWowQuestQuery } from '@proj-airi/stage-shared/wow-knowledge'
import { useNow } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { readCurrentCompanionPlayer } from '../utils/wow-companion-observation'
import { createWowQuestClient, projectWowQuestContext } from '../utils/wow-quest-client'
import { useWowCompanionStore } from './wow-companion'

/** The settings page owns filters and results. Its shared client never exposes this state to model tools. */
export const useWowQuestsStore = defineStore('wow-quests', () => {
  const companion = useWowCompanionStore()
  const now = useNow({ interval: 1000 })
  const game = ref<GameVersion>('forever')
  const level = ref<number>()
  const faction = ref<WowQuestFaction>('Unknown')
  const zone = ref('')
  const query = ref('')
  const busy = ref(false)
  const errorCode = ref<string | null>(null)
  const rawResults = ref<WowQuestResult | null>(null)
  const rawDetail = ref<WowQuestResult | null>(null)
  const lastSearch = ref<Extract<WowQuestQuery, { operation: 'search' }> | null>(null)
  const lastDetail = ref<Extract<WowQuestQuery, { operation: 'detail' }> | null>(null)
  let generation = 0
  let lastIdentity = ''
  let touched = false

  const readState = (selected: GameVersion) => companion.profiles[selected].error ? undefined : companion.profiles[selected].state
  const client = createWowQuestClient(readState)
  const state = computed(() => readState(game.value))
  const player = computed(() => readCurrentCompanionPlayer(state.value, now.value.getTime()))
  const context = computed(() => projectWowQuestContext(state.value, now.value.getTime()))
  const snapshot = computed(() => context.value.snapshot ?? null)
  const receivedAt = computed(() => snapshot.value ? state.value?.bridge?.questsReceivedAt ?? null : null)
  const identity = computed(() => {
    const observed = state.value?.bridge?.snapshot
    return observed ? JSON.stringify([game.value, observed.account, observed.guid, observed.session]) : ''
  })
  const telemetryStatus = computed(() => {
    if (snapshot.value)
      return snapshot.value.log.complete && !snapshot.value.log.truncated ? 'ready' : 'partial'
    const observed = state.value?.bridge?.quests
    return player.value && observed && observed.guid === player.value.guid && observed.session === player.value.session ? 'stale' : 'unknown'
  })

  function currentResult(result: WowQuestResult | null, input: WowQuestQuery | null) {
    if (!result || !input || !['ok', 'empty'].includes(result.outcome))
      return result
    if (input.game === 'retail')
      return queryWowQuestLog(input, context.value)
    const entries = enrichWowQuestEntries(result.entries, input, context.value)
    const sources = result.sources.filter(source => source.kind !== 'quest-log')
    if (context.value.snapshot && entries.some(entry => entry.progress.observedAt))
      sources.push({ kind: 'quest-log', game: input.game, name: '角色任务遥测', observedAt: context.value.snapshot.observedAt })
    return { ...result, entries, sources }
  }
  const results = computed(() => currentResult(rawResults.value, lastSearch.value))
  const detail = computed(() => currentResult(rawDetail.value, lastDetail.value))
  const requestedDetailId = computed(() => lastDetail.value?.questId)

  function clearResults() {
    generation++
    busy.value = false
    errorCode.value = null
    rawResults.value = null
    rawDetail.value = null
    lastSearch.value = null
    lastDetail.value = null
  }

  function useCurrentConditions() {
    if (!player.value)
      return
    level.value = player.value.level > 0 ? player.value.level : undefined
    faction.value = player.value.faction ?? 'Unknown'
    zone.value = game.value === 'forever' ? player.value.zone : ''
    touched = false
  }

  watch(game, () => {
    touched = false
    lastIdentity = ''
    level.value = undefined
    faction.value = 'Unknown'
    zone.value = ''
    query.value = ''
    clearResults()
    useCurrentConditions()
  }, { flush: 'sync' })
  watch(identity, (key) => {
    if (!key || key === lastIdentity)
      return
    const first = !lastIdentity
    lastIdentity = key
    clearResults()
    if (!first || !touched)
      useCurrentConditions()
  }, { flush: 'sync' })

  async function initialize(initialGame?: GameVersion) {
    clearResults()
    if (initialGame)
      game.value = initialGame
    await companion.refresh(game.value)
    companion.start()
    if (!touched)
      useCurrentConditions()
  }

  async function run(input: WowQuestQuery, target: 'results' | 'detail') {
    if (busy.value)
      return
    const current = ++generation
    busy.value = true
    errorCode.value = null
    try {
      const response = await client.query(input)
      if (current !== generation || input.game !== game.value)
        return
      if (target === 'results') {
        rawResults.value = response
        if (input.operation === 'search')
          lastSearch.value = input
        rawDetail.value = null
        lastDetail.value = null
      }
      else {
        rawDetail.value = response
        if (input.operation === 'detail')
          lastDetail.value = input
      }
      errorCode.value = response.errorCode ?? null
    }
    catch {
      if (current === generation)
        errorCode.value = 'source-unavailable'
    }
    finally {
      if (current === generation)
        busy.value = false
    }
  }

  async function search(offset = 0) {
    const input = readWowQuestQuery({ operation: 'search', game: game.value, level: level.value, faction: faction.value, ...(zone.value.trim() ? { zone: zone.value.trim() } : {}), ...(query.value.trim() ? { query: query.value.trim() } : {}), limit: 20, offset })
    if (!input || input.operation !== 'search') {
      errorCode.value = 'invalid-query'
      return
    }
    const previous = lastSearch.value
    if (offset > 0 && (!previous || (['game', 'level', 'faction', 'zone', 'query'] as const).some(key => input[key] !== previous[key]))) {
      errorCode.value = 'invalid-query'
      return
    }
    await run(input, 'results')
  }

  async function openDetail(questId: number, origin: 'search' | 'current' | 'detail' = 'search') {
    const basis = origin === 'search' ? lastSearch.value : origin === 'detail' ? lastDetail.value : null
    const requestedLevel = basis?.level ?? player.value?.level ?? level.value
    const requestedFaction = basis?.faction ?? player.value?.faction ?? faction.value
    const input = readWowQuestQuery({ operation: 'detail', game: game.value, questId, ...(requestedLevel && requestedLevel > 0 ? { level: requestedLevel } : {}), ...(requestedFaction ? { faction: requestedFaction } : {}) })
    if (!input || input.operation !== 'detail') {
      errorCode.value = 'invalid-query'
      return
    }
    await run(input, 'detail')
  }

  return {
    game,
    level,
    faction,
    zone,
    query,
    busy,
    errorCode,
    player,
    snapshot,
    telemetryStatus,
    receivedAt,
    results,
    detail,
    requestedDetailId,
    identity,
    initialize,
    search,
    openDetail,
    useCurrentConditions,
    selectGame: (value: GameVersion) => game.value = value,
    editLevel: (value: number | undefined) => {
      touched = true
      level.value = value
    },
    editFaction: (value: WowQuestFaction) => {
      touched = true
      faction.value = value
    },
    editZone: (value: string) => {
      touched = true
      zone.value = value
    },
    editQuery: (value: string) => {
      touched = true
      query.value = value
    },
  }
})

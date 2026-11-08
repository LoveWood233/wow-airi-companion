import type { WowBuildQuery, WowBuildResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { GameVersion } from '../../shared/wow-companion'

import { readWowBuildQuery } from '@proj-airi/stage-shared/wow-knowledge'
import { useNow } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { createWowBuildClient, projectWowBuildContext, wowBuildObservationKey } from '../utils/wow-build-client'
import { readCurrentCompanionPlayer } from '../utils/wow-companion-observation'
import { useWowCompanionStore } from './wow-companion'

/** Form state belongs only to the settings page. The model tool uses its own independent build client. */
export const useWowBuildsStore = defineStore('wow-builds', () => {
  const companion = useWowCompanionStore()
  const now = useNow({ interval: 1000 })
  const game = ref<GameVersion>('forever')
  const mode = ref<'talents' | 'plan' | 'gear' | 'spell'>('talents')
  const classId = ref<number>()
  const level = ref<number>()
  const nodeId = ref<number>()
  const spellId = ref<number>()
  const planText = ref('')
  const slot = ref(16)
  const itemId = ref<number>()
  const busy = ref(false)
  const errorCode = ref<string | null>(null)
  const result = ref<WowBuildResult | null>(null)
  const lastRequest = ref<WowBuildQuery | null>(null)
  const resultBasis = ref('')
  let generation = 0
  let touched = false
  let lastIdentity = ''

  const readState = (selected: GameVersion) => companion.profiles[selected].error ? undefined : companion.profiles[selected].state
  const client = createWowBuildClient(readState)
  const state = computed(() => readState(game.value))
  const player = computed(() => readCurrentCompanionPlayer(state.value, now.value.getTime()))
  const context = computed(() => projectWowBuildContext(state.value, now.value.getTime()))
  const talents = computed(() => context.value.talents ? state.value?.bridge?.talents ?? null : null)
  const loadout = computed(() => context.value.loadout ?? null)
  const identity = computed(() => {
    const observed = state.value?.bridge?.snapshot
    return observed ? JSON.stringify([game.value, observed.account, observed.guid, observed.session]) : ''
  })
  const resultStale = computed(() => !!result.value && !!lastRequest.value && resultBasis.value !== wowBuildObservationKey(state.value, context.value, lastRequest.value.operation))

  function clearResult() {
    generation++
    busy.value = false
    errorCode.value = null
    result.value = null
    lastRequest.value = null
    resultBasis.value = ''
  }

  function useCurrentConditions() {
    classId.value = context.value.classId
    level.value = player.value && player.value.level > 0 ? player.value.level : undefined
    touched = false
  }

  watch(game, () => {
    lastIdentity = ''
    touched = false
    classId.value = undefined
    level.value = undefined
    nodeId.value = undefined
    spellId.value = undefined
    planText.value = ''
    itemId.value = undefined
    clearResult()
    useCurrentConditions()
  }, { flush: 'sync' })
  watch(identity, (key) => {
    if (!key || key === lastIdentity)
      return
    const first = !lastIdentity
    lastIdentity = key
    clearResult()
    if (!first || !touched)
      useCurrentConditions()
  }, { flush: 'sync' })
  watch(() => context.value.classId, () => {
    if (!touched)
      useCurrentConditions()
  })

  async function initialize(initialGame?: GameVersion) {
    clearResult()
    if (initialGame)
      game.value = initialGame
    await companion.refresh(game.value)
    companion.start()
    if (!touched)
      useCurrentConditions()
  }

  async function execute(request: WowBuildQuery) {
    if (busy.value)
      return
    const current = ++generation
    const capturedBasis = wowBuildObservationKey(state.value, context.value, request.operation)
    busy.value = true
    errorCode.value = null
    try {
      const response = await client.query(request)
      if (current !== generation || request.game !== game.value)
        return
      result.value = response
      lastRequest.value = request
      resultBasis.value = capturedBasis
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

  async function submit() {
    if (busy.value)
      return
    const operation = mode.value === 'gear' ? 'compare-item' : mode.value === 'plan' ? 'compare-talents' : mode.value
    const raw = operation === 'compare-item'
      ? { operation, game: game.value, slot: slot.value, itemId: itemId.value }
      : operation === 'spell'
        ? { operation, game: game.value, spellId: spellId.value, ...(classId.value ? { classId: classId.value } : {}) }
        : { operation, game: game.value, classId: classId.value, level: level.value, ...(operation === 'compare-talents' ? { build: planText.value } : nodeId.value !== undefined ? { nodeId: nodeId.value } : {}) }
    const request = readWowBuildQuery(raw)
    if (!request) {
      errorCode.value = 'invalid-query'
      return
    }
    await execute(request)
  }

  return {
    game,
    mode,
    classId,
    level,
    nodeId,
    spellId,
    planText,
    slot,
    itemId,
    busy,
    errorCode,
    result,
    lastRequest,
    resultStale,
    player,
    talents,
    loadout,
    context,
    identity,
    initialize,
    submit,
    execute,
    useCurrentConditions,
    selectGame: (value: GameVersion) => game.value = value,
    editClassId: (value: number | undefined) => {
      touched = true
      classId.value = value
    },
    editLevel: (value: number | undefined) => {
      touched = true
      level.value = value
    },
  }
})

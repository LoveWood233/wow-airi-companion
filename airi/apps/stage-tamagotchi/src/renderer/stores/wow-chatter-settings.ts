import type { Ref } from 'vue'

import type { Snapshot } from '../../shared/wow-companion'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { normalizeChatterCombats } from './wow-companion-chatter-policy'
import { normalizeInteractionMinutes, normalizeRegularInteractionMinutes } from './wow-companion-idle'
import { interactionScene, isQuietTime, normalizeClock, ProactiveBudget } from './wow-companion-rhythm'

function boundedInteger(value: unknown, initial: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : initial
}

function preference<T>(key: string, initial: T, normalize: (value: unknown) => T): Ref<T> {
  const stored = useLocalStorageManualReset(key, initial, {
    flush: 'sync',
    serializer: {
      read(raw) {
        try {
          return normalize(JSON.parse(raw))
        }
        catch {
          // Corrupt storage cannot grant screenshot access or create an unbounded timer.
          return initial
        }
      },
      write: value => JSON.stringify(normalize(value)),
    },
  })
  return computed({ get: () => normalize(stored.value), set: value => stored.value = normalize(value) })
}

/** Preferences persist across windows. Each runtime owner keeps its own timers and in-flight images outside this store. */
export const useWowChatterSettingsStore = defineStore('wow-chatter-settings', () => {
  const regularEnabled = preference('settings/wow-chatter/regular-enabled', true, value => typeof value === 'boolean' ? value : true)
  const regularIntervalMinutes = preference('settings/wow-chatter/regular-interval-minutes', 5, normalizeRegularInteractionMinutes)
  const combatsRequired = preference('settings/wow-chatter/combats-required', 5, normalizeChatterCombats)
  const sceneryEnabled = preference('settings/wow-chatter/scenery-enabled', false, value => typeof value === 'boolean' ? value : false)
  const sceneryIntervalMinutes = preference('settings/wow-chatter/scenery-interval-minutes', 10, value => normalizeInteractionMinutes(value, 10))
  const locationEnabled = preference('settings/wow-chatter/location-enabled', true, value => typeof value === 'boolean' ? value : true)
  const questEnabled = preference('settings/wow-chatter/quest-enabled', false, value => value === true)
  const quietEnabled = preference('settings/wow-chatter/quiet-enabled', false, value => value === true)
  const quietStart = preference('settings/wow-chatter/quiet-start', '22:00', value => normalizeClock(value, '22:00'))
  const quietEnd = preference('settings/wow-chatter/quiet-end', '08:00', value => normalizeClock(value, '08:00'))
  const sceneEnabled = preference('settings/wow-chatter/scene-enabled', false, value => value === true)
  const outdoorRegular = preference('settings/wow-chatter/outdoor-regular', 0, value => value === 0 ? 0 : normalizeRegularInteractionMinutes(value))
  const outdoorScenery = preference('settings/wow-chatter/outdoor-scenery', 0, value => boundedInteger(value, 0, 0, 60))
  const instanceRegular = preference('settings/wow-chatter/instance-regular', 0, value => value === 0 ? 0 : normalizeRegularInteractionMinutes(value))
  const instanceScenery = preference('settings/wow-chatter/instance-scenery', 0, value => boundedInteger(value, 0, 0, 60))
  const budgetEnabled = preference('settings/wow-chatter/budget-enabled', false, value => value === true)
  const hourlyLimit = preference('settings/wow-chatter/hourly-limit', 30, value => boundedInteger(value, 30, 1, 1000))
  const budget = new ProactiveBudget()

  function quiet(now = Date.now()) {
    return quietEnabled.value && isQuietTime(now, quietStart.value, quietEnd.value)
  }

  function interval(kind: 'regular' | 'scenery', snapshot: Snapshot | null | undefined) {
    const base = kind === 'regular' ? regularIntervalMinutes.value : sceneryIntervalMinutes.value
    if (!sceneEnabled.value)
      return base
    const scene = interactionScene(snapshot)
    if (scene === 'outdoor')
      return (kind === 'regular' ? outdoorRegular.value : outdoorScenery.value) || base
    if (scene === 'instance')
      return (kind === 'regular' ? instanceRegular.value : instanceScenery.value) || base
    return base
  }

  function usage(now = Date.now()) {
    return budget.usage(now, hourlyLimit.value)
  }

  function canGenerate(count = 1, now = Date.now()) {
    return !budgetEnabled.value || usage(now).remaining >= count
  }

  /** Only the Main Stage runtime owner reserves work. Failed attempts keep their timestamp, including while the cap is disabled. */
  function consume(now = Date.now()) {
    return budget.consume(now, budgetEnabled.value ? hourlyLimit.value : undefined)
  }

  return {
    regularEnabled,
    regularIntervalMinutes,
    combatsRequired,
    sceneryEnabled,
    sceneryIntervalMinutes,
    locationEnabled,
    questEnabled,
    quietEnabled,
    quietStart,
    quietEnd,
    sceneEnabled,
    outdoorRegular,
    outdoorScenery,
    instanceRegular,
    instanceScenery,
    budgetEnabled,
    hourlyLimit,
    quiet,
    interval,
    usage,
    canGenerate,
    consume,
  }
})

import type { GameVersion } from '../../shared/wow-companion'

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** Each guide step opens an existing settings page. Progress never changes configuration or proves that setup succeeded. */
export const guideSteps = [
  { id: 'welcome', path: '/settings/wow-guide' },
  { id: 'model', path: '/settings/models' },
  { id: 'providers', path: '/settings/providers' },
  { id: 'chat', path: '/settings/modules/consciousness' },
  { id: 'speech', path: '/settings/modules/speech' },
  { id: 'connection', path: '/settings/wow-companion' },
  { id: 'chatter', path: '/settings/wow-chatter' },
  { id: 'vision', path: '/settings/wow-screen-assist' },
  { id: 'knowledge', path: '/settings/modules/mcp' },
  { id: 'launcher', path: '/settings/wow-launcher' },
  { id: 'finish', path: '/settings/wow-guide' },
] as const

/** Persisted progress belongs to the local profile. The overlay and its pause state belong to one settings renderer. */
export const useWowGuideStore = defineStore('wow-guide', () => {
  const offered = useLocalStorage('wow-companion/guide/offered-v1', false)
  const outcome = useLocalStorage<'new' | 'started' | 'completed' | 'skipped'>('wow-companion/guide/outcome-v1', 'new')
  const savedIndex = useLocalStorage('wow-companion/guide/step-v1', 0)
  const game = useLocalStorage<GameVersion>('wow-companion/guide/game-v1', 'retail')
  const active = ref(false)
  const paused = ref(false)
  const index = computed(() => Number.isInteger(savedIndex.value) ? Math.max(0, Math.min(guideSteps.length - 1, savedIndex.value)) : 0)
  const step = computed(() => guideSteps[index.value]!)
  const path = computed(() => step.value.id === 'connection' && game.value === 'forever' ? '/settings/wow-companion-forever' : step.value.path)

  function start(restart = true) {
    offered.value = true
    outcome.value = 'started'
    if (restart)
      savedIndex.value = 0
    active.value = true
    paused.value = false
  }
  function close(completed = false) {
    outcome.value = completed ? 'completed' : 'skipped'
    offered.value = true
    active.value = false
    paused.value = false
  }
  function move(offset: number) {
    savedIndex.value = Math.max(0, Math.min(guideSteps.length - 1, index.value + offset))
  }
  return { offered, outcome, game, active, paused, index, step, path, start, close, move }
})

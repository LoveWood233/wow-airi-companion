import type { WowScreenGame } from '../../shared/wow-screen-assist'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/** Only preferences persist. Storage events keep the settings window and the chat owner in sync. */
export const useWowScreenAssistSettingsStore = defineStore('wow-screen-assist-settings', () => {
  const enabled = useLocalStorageManualReset('settings/wow-screen-assist/enabled', true)
  const game = useLocalStorageManualReset<WowScreenGame | 'auto'>('settings/wow-screen-assist/game', 'auto')
  return { enabled, game }
})

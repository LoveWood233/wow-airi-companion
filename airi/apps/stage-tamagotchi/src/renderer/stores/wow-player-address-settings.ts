import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { normalizePlayerAddressName, parsePlayerAddressRequest } from './wow-player-address-request'

interface AddressPreference {
  mode: 'character' | 'custom'
  customName: string
}

/** One local preference applies to both game profiles. Storage events update the other desktop windows. */
export const useWowPlayerAddressSettingsStore = defineStore('wow-player-address-settings', () => {
  const preference = useLocalStorageManualReset<AddressPreference>('settings/wow-companion/player-address', {
    mode: 'character',
    customName: '',
  })
  const customName = computed(() => typeof preference.value?.customName === 'string'
    ? normalizePlayerAddressName(preference.value.customName) ?? ''
    : '')
  // An invalid stored name cannot override a live character name.
  const mode = computed(() => preference.value?.mode === 'custom' && customName.value ? 'custom' : 'character')

  function setCharacterName() {
    if (preference.value?.mode === 'character')
      return
    preference.value = { mode: 'character', customName: customName.value }
  }

  function setCustomName(value: string) {
    const name = normalizePlayerAddressName(value)
    if (!name)
      return false
    if (mode.value !== 'custom' || customName.value !== name)
      preference.value = { mode: 'custom', customName: name }
    return true
  }

  function applyRequest(text: string) {
    const request = parsePlayerAddressRequest(text)
    if (!request)
      return false
    if (request.mode === 'custom')
      return setCustomName(request.name)
    setCharacterName()
    return true
  }

  return { mode, customName, setCharacterName, setCustomName, applyRequest }
})

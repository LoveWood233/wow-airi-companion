import type { ScreenAssistError, ScreenAssistStatus } from './wow-screen-assist-controller'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useVisionInference } from '@proj-airi/stage-ui/composables/vision/use-vision-inference'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import { wowScreenCapture } from '../../shared/eventa/wow-screen-assist'
import { i18n } from '../modules/i18n'
import { WowScreenAssistController } from './wow-screen-assist-controller'
import { useWowScreenAssistSettingsStore } from './wow-screen-assist-settings'

/** Only the full desktop stage registers this observer. Settings windows cannot start captures. */
export const useWowScreenAssistStore = defineStore('wow-screen-assist', () => {
  const settings = useWowScreenAssistSettingsStore()
  const sessions = useChatSessionStore()
  const cards = useAiriCardStore()
  const chat = useChatStore()
  const capture = useElectronEventaInvoke(wowScreenCapture)
  const { runVisionInference } = useVisionInference()
  const configured = computed(() => {
    const selection = ownerVision(sessions.activeSessionId)
    return !!selection?.provider && !!selection?.model
  })
  const status = ref<ScreenAssistStatus>('idle')
  const error = ref<ScreenAssistError>()
  const toastId = 'wow-screen-assist'
  let unregister: (() => void) | undefined
  let started = false

  function ownerVision(sessionId: string) {
    const characterId = sessions.sessionMetas[sessionId]?.characterId
    if (!characterId)
      return undefined
    try {
      return cards.getModules(characterId).vision
    }
    catch {
      // Removed characters and unloaded defaults grant no provider access for a live capture.
      return undefined
    }
  }

  const controller = new WowScreenAssistController({
    capture,
    read: runVisionInference,
    report(next, code) {
      status.value = next
      error.value = code
      if (next === 'idle')
        toast.dismiss(toastId)
      else if (next === 'error')
        toast.error(i18n.global.t(`wow-companion.screen-assist.errors.${code}`), { id: toastId })
      else if (next === 'ready')
        toast.success(i18n.global.t('wow-companion.screen-assist.ready'), { id: toastId })
      else
        toast.loading(i18n.global.t(`wow-companion.screen-assist.${next}`), { id: toastId })
    },
  })

  function updateRegistration() {
    if (!started || !settings.enabled) {
      unregister?.()
      unregister = undefined
      controller.stop()
      return
    }
    unregister ??= chat.registerRequestContext('wow:screen-assist', (input) => {
      // The session owns its vision selection, even when the user selects another character while this turn waits.
      const selection = ownerVision(input.sessionId)
      return controller.assist(input, {
        enabled: settings.enabled,
        game: settings.game,
        selection: { provider: selection?.provider ?? '', model: selection?.model ?? '' },
      })
    })
  }

  function start() {
    started = true
    updateRegistration()
  }

  function stop() {
    started = false
    updateRegistration()
  }

  watch(() => settings.enabled, updateRegistration, { flush: 'sync' })

  return { configured, status, error, start, stop }
})

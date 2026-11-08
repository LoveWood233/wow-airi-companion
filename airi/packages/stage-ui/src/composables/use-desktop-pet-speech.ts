import type { SpeechClip, SpeechClipEnd, TurnRef } from '@proj-airi/core-agent'
import type { CaptionChannelEvent } from '@proj-airi/stage-shared'

import { defineInvokeHandler } from '@moeru/eventa'
import { BrowserPlayback } from '@proj-airi/audio/browser'
import { turnKey } from '@proj-airi/core-agent'
import { normalizeActPayload, Playback } from '@proj-airi/pipelines-audio'
import { useBroadcastChannel, useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { PlaybackCaption } from '../libs/speech/playback-caption'
import { getSpeechBusContext, speechOutputGetPlaybackState, speechOutputPlaybackStateChangedEvent } from '../services/speech/bus'
import { useLlmStreamingControlStore } from '../stores/ai/chat-llm/streaming-control'
import { useAudioContext, useSpeakingStore } from '../stores/audio'
import { useChatStore } from '../stores/chat'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useSpeechStore } from '../stores/modules/speech'
import { useSpeechOutputControlStore } from '../stores/speech-output-control'
import { useVoiceStore } from '../stores/voice'

interface SpokenTurn {
  text: string
  played: boolean
  finishing: boolean
}

type PresentationEvent = { type: 'assistant-reset' } | { type: 'assistant-append', text: string }

/**
 * Owns desktop chat speech independently of avatar rendering. Mount once in the main character page.
 * Voice response identity isolates concurrent playback. Disposal disconnects the host and cancels its remaining responses.
 */
export function useDesktopPetSpeech() {
  const chat = useChatStore()
  const sessions = useChatSessionStore()
  const cards = useAiriCardStore()
  const speech = useSpeechStore()
  const voice = useVoiceStore()
  const streaming = useLlmStreamingControlStore()
  const { audioContext } = useAudioContext()
  const { nowSpeaking, mouthOpenSize } = storeToRefs(useSpeakingStore())
  const { speechMuted, speechVolume } = storeToRefs(useSpeechOutputControlStore())
  const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
  const { post: postPresentation } = useBroadcastChannel<PresentationEvent, PresentationEvent>({ name: 'airi-chat-present' })
  const spokenCaption = ref('')
  const textCaption = ref('')
  const emotion = ref('neutral')
  const voicing = shallowRef(false)
  const playing = new Set<string>()
  const turns = new Map<string, SpokenTurn>()
  let textCaptionTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const lifetime = new AbortController()

  const destination = audioContext.createGain()
  destination.connect(audioContext.destination)
  const playback = new Playback(new BrowserPlayback(audioContext, { destination }))
  const captions = new PlaybackCaption(text => spokenCaption.value = text)
  const bus = getSpeechBusContext()
  const stopPlaybackState = defineInvokeHandler(bus, speechOutputGetPlaybackState, () => ({ speaking: nowSpeaking.value, voicing: voicing.value }))
  watch([nowSpeaking, voicing], ([speaking, isVoicing]) => {
    bus.emit(speechOutputPlaybackStateChangedEvent, { speaking, voicing: isVoicing })
  }, { immediate: true })
  watch(speechVolume, volume => destination.gain.setTargetAtTime(volume, audioContext.currentTime, 0.05), { immediate: true })
  watch(() => voice.activeTurns, (active) => {
    captions.updateActiveTurns(active)
    const activeKeys = new Set(active.map(turnKey))
    for (const [key, state] of turns) {
      if (!activeKeys.has(key) && !state.finishing)
        turns.delete(key)
    }
    if (active.length === 0)
      voicing.value = false
  }, { flush: 'sync' })

  function clearTextCaption() {
    clearTimeout(textCaptionTimer)
    textCaptionTimer = undefined
    textCaption.value = ''
  }

  function resetPresentation() {
    try {
      postCaption({ type: 'caption-assistant', text: '' })
      postPresentation({ type: 'assistant-reset' })
    }
    catch (error) {
      console.warn('[Pet speech] Failed to reset presentation', error)
    }
  }

  function playSpecial(special: string, turn: TurnRef) {
    return streaming.dispatchWith(special, { turnId: turn.turnId })
  }

  const disconnectVoice = voice.connectOutput((turn) => {
    const key = turnKey(turn)
    const state: SpokenTurn = { text: '', played: false, finishing: false }
    turns.set(key, state)
    const caption = captions.connectTurn(turn)
    const output = {
      playback,
      onSpecial: (special: string) => void playSpecial(special, turn),
      onPlaybackStart: (clip: SpeechClip) => {
        if (disposed)
          return
        state.played = true
        clearTextCaption()
        caption.onPlaybackStart(clip)
        playing.add(`${key}:${clip.id}`)
        nowSpeaking.value = true
        voicing.value = true
        try {
          postCaption({ type: 'caption-assistant', text: clip.text })
          postPresentation({ type: 'assistant-append', text: clip.text })
        }
        catch (error) {
          console.warn('[Pet speech] Failed to publish presentation', error)
        }
      },
      onPlaybackEnd: (clip: SpeechClip, end: SpeechClipEnd) => {
        if (disposed)
          return
        caption.onPlaybackEnd(clip, end)
        playing.delete(`${key}:${clip.id}`)
        nowSpeaking.value = playing.size > 0
        mouthOpenSize.value = 0
      },
    }
    if (speechMuted.value)
      return { ...output, synthesize: async () => null }
    try {
      const characterId = sessions.sessionMetas[turn.sessionId]?.characterId
      if (!characterId)
        throw new Error('The response session has no character')
      return speech.createOutput(turn, cards.getModules(characterId).speech, output, audioContext)
    }
    catch (error) {
      console.warn('[Pet speech] Speech output is unavailable', error)
      return { ...output, synthesize: async () => null }
    }
  })

  async function finishResponse(turn: TurnRef) {
    const key = turnKey(turn)
    const state = turns.get(key)
    if (!state || state.finishing)
      return
    state.finishing = true
    try {
      const outcome = await voice.finishResponse(turn)
      if (disposed || turns.get(key) !== state)
        return
      // Optional or failed TTS leaves a completed active conversation readable beside the pet.
      if (!state.played && state.text.trim() && turn.sessionId === sessions.activeSessionId && (outcome === 'finished' || outcome === 'failed')) {
        clearTextCaption()
        textCaption.value = state.text.trim()
        textCaptionTimer = setTimeout(clearTextCaption, 8000)
      }
    }
    catch (error) {
      console.warn('[Pet speech] Response completion failed', error)
    }
    finally {
      if (turns.get(key) === state)
        turns.delete(key)
    }
  }

  watch(speechMuted, (muted) => {
    if (!muted)
      return
    for (const turn of voice.activeTurns) {
      captions.closeTurn(turn)
      voice.getSpeech(turn)?.cancel('Speech muted')
    }
  })

  const cleanups = [
    streaming.onSignal(async (signal, context) => {
      if (signal.type === 'act') {
        const act = normalizeActPayload(signal.payload)
        if (act.emotion)
          emotion.value = act.emotion.name
      }
      else if (signal.type === 'delay') {
        const turn = voice.activeTurns.find(turn => turn.turnId === context.turnId)
        const speechSignal = turn ? voice.getSpeech(turn)?.signal : undefined
        const stop = speechSignal ? AbortSignal.any([lifetime.signal, speechSignal]) : lifetime.signal
        if (stop.aborted)
          return
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const finish = () => {
            clearTimeout(timer)
            stop.removeEventListener('abort', finish)
            resolve()
          }
          timer = setTimeout(finish, signal.seconds * 1000)
          stop.addEventListener('abort', finish, { once: true })
        })
      }
    }),
    chat.onBeforeMessageComposed(async (_message, context) => {
      if (!context.speaks)
        return
      voice.startResponse(context)
      emotion.value = 'neutral'
      if (context.sessionId === sessions.activeSessionId) {
        clearTextCaption()
        resetPresentation()
      }
    }),
    chat.onTokenLiteral(async (literal, context) => {
      if (!context.speaks)
        return
      const state = turns.get(turnKey(context))
      if (state)
        state.text += literal
      if (!speechMuted.value)
        await voice.getSpeech(context)?.write(literal)
    }),
    chat.onTokenSpecial(async (special, context) => {
      if (!context.speaks)
        return
      if (speechMuted.value)
        await playSpecial(special, context)
      else
        voice.getSpeech(context)?.special(special)
    }),
    chat.onStreamEnd(async (context) => {
      if (context.speaks)
        void finishResponse(context)
    }),
    chat.onAssistantResponseEnd(async (_message, context) => {
      if (context.speaks)
        void finishResponse(context)
    }),
  ]

  useEventListener(['click', 'touchstart', 'keydown'], () => void audioContext.resume().catch(() => {}), { once: true, passive: true })
  onScopeDispose(() => {
    disposed = true
    lifetime.abort('Pet speech host disposed')
    cleanups.forEach(stop => stop())
    disconnectVoice()
    captions.dispose()
    clearTextCaption()
    turns.clear()
    playing.clear()
    nowSpeaking.value = false
    mouthOpenSize.value = 0
    voicing.value = false
    bus.emit(speechOutputPlaybackStateChangedEvent, { speaking: false, voicing: false })
    stopPlaybackState()
    destination.disconnect()
  })

  return {
    speaking: computed(() => nowSpeaking.value),
    thinking: computed(() => chat.sending),
    caption: computed(() => textCaption.value || spokenCaption.value),
    emotion,
  }
}

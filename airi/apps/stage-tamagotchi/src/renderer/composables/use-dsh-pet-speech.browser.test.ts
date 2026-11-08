import type { ChatStreamEventContext } from '@proj-airi/stage-ui/types/chat'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useDshPetSpeech } from './use-dsh-pet-speech'

const synthesize = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<ArrayBuffer>>())
vi.mock('@xsai/generate-speech', () => ({ generateSpeech: synthesize }))

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  synthesize.mockReset()
  localStorage.clear()
})

function audioFixture(durationMs = 160) {
  const samples = Math.ceil(16_000 * durationMs / 1000)
  const bytes = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(bytes)
  const write = (offset: number, text: string) => [...text].forEach((value, index) => view.setUint8(offset + index, value.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples * 2, true)
  return bytes
}

async function host(configured = false) {
  const nativeFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith('data:') || url.endsWith('.wasm'))
      return nativeFetch(input, init)
    return Promise.resolve(Response.json({ data: [], voices: [] }))
  }))
  const pinia = createPinia()
  let surface: ReturnType<typeof useDshPetSpeech> | undefined
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup() {
      useSettingsStageModel().setRuntimeEnabled(false)
      surface = useDshPetSpeech()
      return () => h('div', [h('button', { onClick: () => void useAudioContext(pinia).audioContext.resume() }, 'Resume test audio'), h('p', surface?.caption.value)])
    },
  })
  app.use(pinia).use(PiniaColada).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(root)
  if (!surface)
    throw new Error('Speech host did not mount')
  const audio = useAudioContext(pinia).audioContext
  await page.getByRole('button', { name: 'Resume test audio' }).click()
  await vi.waitFor(() => expect(audio.state).toBe('running'))
  cleanups.push(async () => {
    app.unmount()
    disposePinia(pinia)
    root.remove()
    await audio.close()
  })
  const cards = useAiriCardStore(pinia)
  await cards.initialize()
  if (configured) {
    await useProviderConfigStore(pinia).ensureProvider('openai-compatible-audio-speech', 'openai-compatible-audio-speech', {
      apiKey: 'synthetic-test-key',
      baseUrl: 'https://speech.invalid/v1/',
    })
  }
  const cardId = await cards.addCard({
    name: 'Pet speech fixture',
    version: '1',
    description: '',
    extensions: { airi: { modules: { speech: { provider: configured ? 'openai-compatible-audio-speech' : 'speech-noop', model: configured ? 'tts-1' : '', voice_id: configured ? 'alloy' : '' } } } },
  }, 'scratch')
  const sessions = useChatSessionStore(pinia)
  const sessionId = await sessions.createSession(cardId)
  sessions.activeSessionId = sessionId
  const chat = useChatStore(pinia)
  const controls = useSpeechOutputControlStore(pinia)
  const context: ChatStreamEventContext = {
    sessionId,
    turnId: crypto.randomUUID(),
    speaks: true,
    contexts: {},
    composedMessage: [],
    message: { role: 'user', content: 'Hello' },
  }
  return { app, pinia, surface, root, chat, controls, context, voice: useVoiceStore(pinia) }
}

async function reply(environment: Awaited<ReturnType<typeof host>>, text: string, context = environment.context) {
  await environment.chat.emitBeforeMessageComposedHooks('Hello', context)
  await environment.chat.emitTokenLiteralHooks(text, context)
  await environment.chat.emitStreamEndHooks(context)
}

describe('dsh-pet desktop speech host', () => {
  it('keeps completed chat readable without a configured voice and clears it after eight seconds', async () => {
    const env = await host()
    await reply(env, 'Welcome back, champion.')
    await vi.waitFor(() => expect(env.surface.caption.value).toBe('Welcome back, champion.'))
    expect(env.surface.speaking.value).toBe(false)
    expect(synthesize).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(env.surface.caption.value).toBe(''), { timeout: 9500 })
  })

  it('plays configured TTS through real Web Audio and retains playback subtitles for three seconds', async () => {
    synthesize.mockImplementation(async () => audioFixture())
    const env = await host(true)
    await reply(env, 'The road awaits.')
    await vi.waitFor(() => expect(env.surface.speaking.value).toBe(true))
    expect(env.surface.caption.value).toBe('The road awaits.')
    await vi.waitFor(() => expect(env.surface.speaking.value).toBe(false))
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(env.surface.caption.value).toBe('The road awaits.')
    await vi.waitFor(() => expect(env.surface.caption.value).toBe(''), { timeout: 4500 })
  })

  it('does not synthesize muted responses and ignores background replies', async () => {
    synthesize.mockImplementation(async () => audioFixture())
    const env = await host(true)
    env.controls.setSpeechMuted(true)
    await reply(env, 'Quietly, then.')
    await vi.waitFor(() => expect(env.surface.caption.value).toBe('Quietly, then.'))
    expect(synthesize).not.toHaveBeenCalled()
    await env.chat.emitTokenSpecialHooks('<|ACT {"emotion":{"name":"happy","intensity":0.8}}|>', env.context)
    expect(env.surface.emotion.value).toBe('happy')
    await reply(env, 'Background task.', { ...env.context, turnId: crypto.randomUUID(), speaks: false })
    expect(env.surface.caption.value).toBe('Quietly, then.')
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('uses the same host for standalone Warcraft notices and honors the existing stop control', async () => {
    synthesize.mockImplementation(async () => audioFixture(3000))
    const env = await host(true)
    const turn = { sessionId: env.context.sessionId, turnId: `wow-event:${crypto.randomUUID()}` }
    env.voice.startResponse(turn)
    await env.voice.getSpeech(turn)?.write('For the Horde!')
    const completion = env.voice.finishResponse(turn)
    await vi.waitFor(() => expect(env.surface.speaking.value).toBe(true))
    expect(env.surface.caption.value).toBe('For the Horde!')
    expect(env.voice.activeTurns).toContainEqual(turn)
    await env.controls.requestStopSpeaking({ reason: 'manual-all' })
    expect(await completion).toBe('interrupted')
    await vi.waitFor(() => expect(env.surface.speaking.value).toBe(false))
    expect(env.voice.activeTurns).toEqual([])
  })

  it('falls back to completed text when a configured speech provider fails', async () => {
    synthesize.mockRejectedValue(new Error('Synthetic provider failure'))
    const env = await host(true)
    await reply(env, 'I am still here.')
    await vi.waitFor(() => expect(env.surface.caption.value).toBe('I am still here.'))
    expect(env.surface.speaking.value).toBe(false)
    expect(synthesize).toHaveBeenCalledTimes(1)
  })

  it('cancels pending synthesis on disposal and permits a replacement host', async () => {
    const pending = Promise.withResolvers<ArrayBuffer>()
    synthesize.mockImplementation(() => pending.promise)
    const env = await host(true)
    await reply(env, 'Still preparing.')
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1))
    env.app.unmount()
    pending.resolve(audioFixture())
    await vi.waitFor(() => expect(env.voice.activeTurns).toEqual([]))
    expect(env.surface.speaking.value).toBe(false)
    expect(env.surface.caption.value).toBe('')
    synthesize.mockReset()
    const next = await host()
    await reply(next, 'A fresh host.')
    await vi.waitFor(() => expect(next.surface.caption.value).toBe('A fresh host.'))
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('cancels a pending streaming delay when the speech host unmounts', async () => {
    const env = await host()
    env.controls.setSpeechMuted(true)
    await nextTick()
    await env.chat.emitBeforeMessageComposedHooks('Hello', env.context)
    let settled = false
    const delay = env.chat.emitTokenSpecialHooks('<|DELAY 60|>', env.context).then(() => settled = true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    env.app.unmount()
    await delay
    expect(settled).toBe(true)
  })
})

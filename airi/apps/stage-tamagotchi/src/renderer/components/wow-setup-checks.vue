<script setup lang="ts">
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { CompanionState, GameVersion } from '../../shared/wow-companion'
import type { SetupCheck, SetupEnvironment, SetupInspection } from '../../shared/wow-setup'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useLLM } from '@proj-airi/stage-ui/stores/ai/chat-llm/llm'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldInput, SettingsCard } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { generateSpeech } from '@xsai/generate-speech'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { wowCompanionGet } from '../../shared/eventa/wow-companion'
import { wowSetupEnvironment, wowSetupInspect, wowSetupInstall, wowSetupPick } from '../../shared/eventa/wow-setup'
import { formatCompanionError } from '../../shared/wow-companion-errors'

const props = defineProps<{ game: GameVersion }>()
const { t } = useI18n()
const router = useRouter()
const tn = (key: string) => t(`wow-companion.setup.${key}`)
const inspect = useElectronEventaInvoke(wowSetupInspect)
const environment = useElectronEventaInvoke(wowSetupEnvironment)
const pick = useElectronEventaInvoke(wowSetupPick)
const install = useElectronEventaInvoke(wowSetupInstall)
const getState = useElectronEventaInvoke(wowCompanionGet)
const chat = useConsciousnessStore()
const speech = useSpeechStore()
const providers = useProviderStore()
const config = useProviderConfigStore()
const directory = useLocalStorage(`wow-companion/setup/${props.game}/directory`, '')
const report = ref<SetupInspection>()
const env = ref<SetupEnvironment>()
const state = ref<CompanionState>()
const checking = ref(false)
const installing = ref(false)
const error = ref('')
const backup = ref('')
const checkedAt = ref<number>()
const chatResult = ref<SetupCheck>({ status: 'untested', code: 'not-tested' })
const speechResult = ref<SetupCheck>({ status: 'untested', code: 'not-tested' })
const reply = ref('')
const testBusy = ref<'chat' | 'speech'>()
const previewReady = ref(false)
let generation = 0
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined
let control: AbortController | undefined
let audio: HTMLAudioElement | undefined
let audioUrl: string | undefined
let polling = false

function stopTests() {
  control?.abort()
  audio?.pause()
  audio = undefined
  if (audioUrl)
    URL.revokeObjectURL(audioUrl)
  audioUrl = undefined
  previewReady.value = false
  testBusy.value = undefined
}
watch(() => [chat.activeProvider, chat.activeModel, speech.activeSpeechProvider, speech.activeSpeechModel, speech.activeSpeechVoiceId], () => {
  stopTests()
  chatResult.value = { status: 'untested', code: 'not-tested' }
  speechResult.value = { status: 'untested', code: 'not-tested' }
  reply.value = ''
})
watch(() => config.getProviderConfig(chat.activeProvider), () => {
  control?.abort()
  chatResult.value = { status: 'untested', code: 'not-tested' }
}, { deep: true })

const liveCheck = computed<SetupCheck>(() => {
  const value = state.value
  const bridge = value?.bridge
  if (!value)
    return { status: 'untested', code: 'bridge-unavailable' }
  if (!value?.settings.enabled)
    return { status: 'unconfigured', code: 'connection-disabled' }
  if (bridge?.source === 'demo')
    return { status: 'failed', code: 'demo-not-live' }
  const seen = Date.parse(bridge?.lastSeen ?? '')
  if (!value.error && !bridge?.error && bridge?.status === 'live' && bridge.source === 'screen'
    && bridge.snapshot?.online && bridge.snapshot.guid && bridge.snapshot.name && !bridge.config.paused
    && bridge.ageSeconds !== null && bridge.ageSeconds >= 0 && bridge.ageSeconds <= 5
    && Number.isFinite(seen) && Math.abs(Date.now() - seen) <= 5000) {
    return { status: 'passed', code: 'live-character' }
  }
  return { status: 'failed', code: 'calibrate' }
})
const chatCheck = computed<SetupCheck>(() => chat.chatReady ? chatResult.value : { status: 'unconfigured', code: 'chat-configure' })
const speechConfig = computed(() => config.getProviderConfig(speech.activeSpeechProvider))
watch(speechConfig, () => {
  stopTests()
  speechResult.value = { status: 'untested', code: 'not-tested' }
}, { deep: true })
const voice = computed(() => speech.activeSpeechVoiceId || (typeof speechConfig.value?.voice === 'string' ? speechConfig.value.voice : ''))
const speechModel = computed(() => speech.activeSpeechModel || (typeof speechConfig.value?.model === 'string' ? speechConfig.value.model : ''))
const speechCheck = computed<SetupCheck>(() => speech.activeSpeechProvider && speech.activeSpeechProvider !== 'speech-noop' && voice.value && speechModel.value
  ? speechResult.value
  : { status: 'unconfigured', code: 'speech-configure' })
const bridgeCheck = computed<SetupCheck>(() => {
  if (!env.value)
    return { status: 'untested', code: 'not-tested' }
  if (env.value.resources.status === 'passed' && !['running', 'external'].includes(env.value.runtime.status))
    return { status: 'untested', code: 'bridge-not-started' }
  return env.value.resources
})
const rows = computed(() => [
  { id: 'client', check: report.value?.client ?? { status: 'untested', code: 'not-tested' }, detail: report.value?.clientVersion },
  { id: 'addon', check: report.value?.addon ?? { status: 'untested', code: 'not-tested' }, detail: report.value?.addonVersion },
  { id: 'python', check: env.value?.python ?? { status: 'untested', code: 'not-tested' }, detail: env.value?.pythonPath },
  { id: 'bridge', check: bridgeCheck.value, detail: env.value?.runtime.error ? formatCompanionError(env.value.runtime.error, t) : env.value?.runtime.status },
  { id: 'capture', check: liveCheck.value, detail: liveCheck.value.status === 'passed' ? `${state.value?.bridge?.snapshot?.name} · ${state.value?.bridge?.snapshot?.realm} · ${state.value?.bridge?.lastSeen}` : '' },
  { id: 'chat', check: chatCheck.value, detail: chat.activeModel },
  { id: 'speech', check: speechCheck.value, detail: voice.value },
])

async function poll() {
  if (polling || disposed || router.currentRoute.value.path !== '/settings/wow-guide')
    return
  polling = true
  const game = props.game
  try {
    const value = await getState({ game })
    if (!disposed && props.game === game)
      state.value = value
  }
  catch {
    if (!disposed && props.game === game)
      state.value = undefined
  }
  finally { polling = false }
}
async function check() {
  if (checking.value || installing.value)
    return
  const request = ++generation
  checking.value = true
  error.value = ''
  report.value = undefined
  env.value = undefined
  try {
    const results = await Promise.allSettled([inspect({ game: props.game, directory: directory.value }), environment({ game: props.game }), poll()])
    if (disposed || request !== generation)
      return
    if (results[0].status === 'fulfilled') {
      report.value = results[0].value
      directory.value = report.value.directory
    }
    if (results[1].status === 'fulfilled')
      env.value = results[1].value
    if (results.some(result => result.status === 'rejected'))
      error.value = tn('check-failed')
    checkedAt.value = Date.now()
  }
  finally {
    if (!disposed && request === generation)
      checking.value = false
  }
}
async function choose() {
  try {
    const selected = await pick()
    if (selected && !disposed) {
      directory.value = selected
      await check()
    }
  }
  catch { error.value = tn('check-failed') }
}
async function installAddon() {
  if (installing.value || checking.value)
    return
  installing.value = true
  error.value = ''
  try {
    const result = await install({ game: props.game, directory: directory.value })
    if (!disposed) {
      report.value = result.inspection
      backup.value = result.backup ?? ''
      error.value = tn('restart-game')
    }
  }
  catch {
    if (!disposed)
      error.value = tn('install-failed')
  }
  finally {
    if (!disposed)
      installing.value = false
  }
}
async function test(kind: 'chat' | 'speech') {
  if (testBusy.value)
    return
  stopTests()
  const operation = new AbortController()
  control = operation
  const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(30_000)])
  testBusy.value = kind
  try {
    if (kind === 'chat') {
      reply.value = ''
      chatResult.value = { status: 'untested', code: 'not-tested' }
      const provider = await chat.getChatProviderInstance(chat.activeProvider)
      signal.throwIfAborted()
      let text = ''
      await useLLM().stream(chat.activeModel, provider, { turns: [{ id: 'setup-test', type: 'user', content: [{ type: 'text', text: t('wow-companion.setup.chat-prompt') }] }] }, {
        providerId: chat.activeProvider,
        supportsTools: false,
        taskTools: [],
        maxTokens: 80,
        abortSignal: signal,
        onStreamEvent(event) {
          if (event.type === 'text-delta')
            text += event.text
        },
      })
      signal.throwIfAborted()
      if (!text.trim())
        throw new Error('empty-response')
      reply.value = text.trim().slice(0, 300)
      chatResult.value = { status: 'passed', code: 'chat-response' }
    }
    else {
      speechResult.value = { status: 'untested', code: 'not-tested' }
      const provider = await providers.getProviderInstance<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>(speech.activeSpeechProvider)
      signal.throwIfAborted()
      const bytes = await generateSpeech({ ...provider.speech(speechModel.value, speechConfig.value), input: tn('speech-phrase'), voice: voice.value, abortSignal: signal })
      signal.throwIfAborted()
      if (!bytes.byteLength)
        throw new Error('empty-audio')
      audioUrl = URL.createObjectURL(new Blob([bytes]))
      audio = new Audio(audioUrl)
      audio.onerror = () => {
        if (!disposed && control === operation) {
          speechResult.value = { status: 'failed', code: 'test-failed' }
          previewReady.value = false
        }
      }
      await audio.play()
      signal.throwIfAborted()
      previewReady.value = true
      speechResult.value = { status: 'untested', code: 'confirm-heard' }
    }
  }
  catch {
    if (!disposed && !operation.signal.aborted) {
      const result: SetupCheck = { status: 'failed', code: 'test-failed' }
      if (kind === 'chat')
        chatResult.value = result
      else speechResult.value = result
    }
  }
  finally {
    if (control === operation)
      testBusy.value = undefined
  }
}
onMounted(() => {
  void check()
  timer = setInterval(() => void poll(), 1500)
})
onScopeDispose(() => {
  disposed = true
  generation++
  clearInterval(timer)
  stopTests()
})
</script>

<template>
  <SettingsCard :aria-label="tn('title')" role="region" data-testid="wow-setup-checks">
    <h2 :class="['text-lg font-semibold']">
      {{ tn('title') }}
    </h2>
    <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <FieldInput v-model="directory" :label="tn('directory')" :description="tn('directory-help')" :disabled="checking || installing" @update:model-value="report = undefined" />
    <div :class="['flex flex-wrap gap-2']">
      <Button :disabled="checking || installing" @click="choose">
        {{ tn('choose') }}
      </Button>
      <Button :loading="checking" :disabled="installing" @click="check">
        {{ tn('check') }}
      </Button>
    </div>
    <p v-if="checkedAt" :class="['text-xs text-neutral-500']">
      {{ tn('checked-at') }} {{ new Date(checkedAt).toLocaleTimeString() }}
    </p>
    <p v-if="error" role="status" :class="['text-sm break-words']">
      {{ error }}
    </p>
    <p v-if="backup" :class="['text-xs break-all']">
      {{ tn('backup') }} {{ backup }}
    </p>
    <div v-for="row in rows" :key="row.id" :class="['rounded-xl border border-neutral-200 p-4 dark:border-neutral-700']" :data-testid="`setup-${row.id}`">
      <div :class="['flex flex-wrap items-center justify-between gap-2']">
        <h3 :class="['font-medium']">
          {{ tn(`labels.${row.id}`) }}
        </h3>
        <span :class="['text-xs font-medium', row.check.status === 'passed' ? 'text-green-700 dark:text-green-300' : 'text-neutral-600 dark:text-neutral-300']">{{ tn(`statuses.${row.check.status}`) }}</span>
      </div>
      <p :class="['mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
        {{ tn(`codes.${row.check.code}`) }}
      </p>
      <p v-if="row.detail" :class="['mt-1 text-xs break-all text-neutral-500']">
        {{ row.detail }}
      </p>
      <div :class="['mt-3 flex flex-wrap gap-2']">
        <Button v-if="row.id === 'addon' && report?.client.status === 'passed' && report.sourceAvailable" size="sm" :disabled="checking || installing" :loading="installing" @click="installAddon">
          {{ tn('install') }}
        </Button>
        <Button v-if="row.id === 'capture' || row.id === 'bridge'" size="sm" @click="router.push(game === 'retail' ? '/settings/wow-companion' : '/settings/wow-companion-forever')">
          {{ tn('calibrate') }}
        </Button>
        <template v-if="row.id === 'chat'">
          <Button size="sm" :loading="testBusy === 'chat'" :disabled="!chat.chatReady || !!testBusy" @click="test('chat')">
            {{ tn('test-chat') }}
          </Button>
          <Button size="sm" @click="router.push('/settings/modules/consciousness')">
            {{ tn('configure') }}
          </Button>
          <p v-if="reply" :class="['w-full text-sm break-words']">
            {{ reply }}
          </p>
        </template>
        <template v-if="row.id === 'speech'">
          <Button size="sm" :loading="testBusy === 'speech'" :disabled="speechCheck.status === 'unconfigured' || !!testBusy" @click="test('speech')">
            {{ tn('preview') }}
          </Button>
          <Button size="sm" @click="router.push('/settings/modules/speech')">
            {{ tn('configure') }}
          </Button>
          <Button v-if="previewReady" size="sm" @click="speechResult = { status: 'passed', code: 'heard' }; previewReady = false">
            {{ tn('heard') }}
          </Button>
          <Button v-if="previewReady" size="sm" @click="speechResult = { status: 'failed', code: 'not-heard' }; stopTests()">
            {{ tn('not-heard') }}
          </Button>
        </template>
      </div>
    </div>
    <Button v-if="testBusy" size="sm" @click="stopTests">
      {{ tn('cancel-test') }}
    </Button>
    <p :class="['text-xs text-neutral-500']">
      {{ tn('cost-note') }}
    </p>
  </SettingsCard>
</template>

<script setup lang="ts">
import type { PlaybackGroup } from '@proj-airi/pipelines-audio'

import { BrowserPlayback } from '@proj-airi/audio/browser'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Playback } from '@proj-airi/pipelines-audio'
import { useLLM } from '@proj-airi/stage-ui/stores/ai/chat-llm/llm'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createMcpTools } from '@proj-airi/stage-ui/tools/mcp'
import { Button, FieldInput, SettingsCard } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronMcpCallTool, electronMcpListTools } from '../../shared/eventa'
import { WowMcpEvidence } from '../utils/wow-mcp-evidence'

type Phase = 'connection' | 'tools' | 'answer' | 'sources' | 'speech'
type Status = 'untested' | 'running' | 'passed' | 'failed'
const phases: Phase[] = ['connection', 'tools', 'answer', 'sources', 'speech']
const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.mcp-check.${key}`)
const chat = useConsciousnessStore()
const cards = useAiriCardStore()
const speech = useSpeechStore()
const config = useProviderConfigStore()
const llm = useLLM()
const listTools = useElectronEventaInvoke(electronMcpListTools)
const callTool = useElectronEventaInvoke(electronMcpCallTool)
const question = ref(tn('default-question'))
const answer = ref('')
const links = ref<string[]>([])
const calls = ref<string[]>([])
const statuses = ref<Record<Phase, Status>>({ connection: 'untested', tools: 'untested', answer: 'untested', sources: 'untested', speech: 'untested' })
const busy = ref(false)
const previewReady = ref(false)
const message = ref('')
// Only time and outcome persist. Prompts, replies, receipts, and credentials remain outside this record.
const latest = useLocalStorage<{ at: number, status: 'passed' | 'failed' | 'untested' }>('wow-companion/mcp-acceptance-v1', { at: 0, status: 'untested' })
const persona = computed(() => cards.getSystemPrompt(cards.activeCardId))
let operation: AbortController | undefined
let audioContext: AudioContext | undefined
let playback: PlaybackGroup | undefined
let disposed = false

function save(status: 'passed' | 'failed' | 'untested') {
  latest.value = { at: Date.now(), status }
}

function cancel() {
  operation?.abort()
  operation = undefined
  void playback?.stop({ fadeMs: 0 }).catch(() => {})
  playback = undefined
  void audioContext?.close().catch(() => {})
  audioContext = undefined
  if (busy.value) {
    for (const phase of phases) {
      if (statuses.value[phase] === 'running')
        statuses.value[phase] = 'untested'
    }
    save('untested')
  }
  busy.value = false
  previewReady.value = false
}

function reset() {
  cancel()
  for (const phase of phases)
    statuses.value[phase] = 'untested'
  answer.value = ''
  links.value = []
  calls.value = []
  message.value = ''
}

watch(() => [chat.activeProvider, chat.activeModel, speech.activeSpeechProvider, speech.activeSpeechModel, speech.activeSpeechVoiceId, speech.pitch, speech.rate, speech.ssmlEnabled, persona.value], reset)
watch(() => [config.getProviderConfig(chat.activeProvider), config.getProviderConfig(speech.activeSpeechProvider)], reset, { deep: true })
watch(question, reset)

async function run() {
  if (busy.value || !chat.chatReady || !question.value.trim())
    return
  reset()
  const control = new AbortController()
  operation = control
  const signal = AbortSignal.any([control.signal, AbortSignal.timeout(90_000)])
  const current = () => !disposed && operation === control && !signal.aborted
  busy.value = true
  let phase: Phase = 'connection'
  try {
    statuses.value.connection = 'running'
    const evidence = new WowMcpEvidence({ listTools: () => listTools(), callTool: payload => callTool(payload) }, signal)
    await evidence.listTools()
    signal.throwIfAborted()
    statuses.value.connection = 'passed'
    phase = 'tools'
    statuses.value.tools = 'running'
    const tools = await Promise.all(createMcpTools({
      listTools: () => evidence.listTools(),
      callTool: async (payload) => {
        const result = await evidence.callTool(payload)
        if (current()) {
          calls.value = evidence.receipts.map(receipt => receipt.name)
          statuses.value.tools = evidence.assess('').searched ? 'passed' : 'failed'
        }
        return result
      },
    }))
    const provider = await chat.getChatProviderInstance(chat.activeProvider)
    signal.throwIfAborted()
    phase = 'answer'
    statuses.value.answer = 'running'
    await llm.stream(chat.activeModel, provider, { turns: [
      { id: 'acceptance-persona', type: 'system', authority: 'system', content: [{ type: 'text', text: persona.value }] },
      { id: 'acceptance-policy', type: 'system', authority: 'system', content: [{ type: 'text', text: tn('policy') }] },
      { id: 'acceptance-question', type: 'user', content: [{ type: 'text', text: question.value.trim() }] },
    ] }, {
      providerId: chat.activeProvider,
      supportsTools: true,
      taskTools: tools,
      maxTokens: 900,
      abortSignal: signal,
      onStreamEvent(event) {
        if (!current())
          return
        if (event.type === 'tool-call')
          answer.value = ''
        if (event.type === 'text-delta')
          answer.value += event.text
      },
    })
    signal.throwIfAborted()
    const result = evidence.assess(answer.value)
    links.value = result.sources
    statuses.value.tools = result.searched ? 'passed' : 'failed'
    statuses.value.answer = answer.value.trim() ? 'passed' : 'failed'
    statuses.value.sources = result.citations ? 'passed' : 'failed'
    if (!result.searched || !result.citations || !answer.value.trim()) {
      message.value = tn('evidence-failed')
      save('failed')
    }
    else {
      message.value = tn('ready-speech')
      save('untested')
    }
  }
  catch {
    if (operation === control && !disposed) {
      statuses.value[phase] = control.signal.aborted ? 'untested' : 'failed'
      if (statuses.value.answer === 'running')
        statuses.value.answer = 'failed'
      if (statuses.value.tools === 'running')
        statuses.value.tools = 'failed'
      message.value = tn('request-failed')
      save(control.signal.aborted ? 'untested' : 'failed')
    }
  }
  finally {
    if (operation === control) {
      busy.value = false
      operation = undefined
    }
  }
}

async function preview() {
  if (busy.value || !speech.configured || statuses.value.sources !== 'passed')
    return
  cancel()
  const control = new AbortController()
  operation = control
  const signal = AbortSignal.any([control.signal, AbortSignal.timeout(60_000)])
  busy.value = true
  statuses.value.speech = 'running'
  const context = new AudioContext()
  audioContext = context
  const audioPlayback = new Playback(new BrowserPlayback(context))
  const group = audioPlayback.openGroup('mcp-acceptance')
  playback = group
  signal.addEventListener('abort', () => {
    void group.stop({ fadeMs: 0 }).catch(() => {})
  }, { once: true })
  try {
    await context.resume()
    signal.throwIfAborted()
    const turn = { sessionId: 'mcp-acceptance', turnId: crypto.randomUUID() }
    const output = speech.createOutput(turn, { provider: speech.activeSpeechProvider, model: speech.activeSpeechModel, voice_id: speech.activeSpeechVoiceId }, { playback: audioPlayback }, context)
    const text = answer.value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\[[^\]]*\]/g, '').replace(/[*#`]/g, '')
    let count = 0
    if ('stream' in output) {
      const reader = (await output.stream(new ReadableStream<string>({
        start(controller) {
          controller.enqueue(text)
          controller.close()
        },
      }), signal)).getReader()
      try {
        while (true) {
          const part = await reader.read()
          if (part.done)
            break
          signal.throwIfAborted()
          if (await group.enqueue({ id: `${count++}`, audio: part.value.audio, signal }) !== 'ended')
            throw new Error('playback-failed')
        }
      }
      finally { await reader.cancel().catch(() => {}) }
    }
    else {
      const audio = await output.synthesize({ ...turn, streamId: turn.turnId, intentId: turn.turnId, segmentId: turn.turnId, sequence: 0, text, special: null, reason: 'flush', priority: 0, createdAt: Date.now() }, signal)
      if (!audio?.size || await group.enqueue({ id: turn.turnId, audio, signal }) !== 'ended')
        throw new Error('empty-or-failed-audio')
      count++
    }
    const receipt = await group.finish()
    signal.throwIfAborted()
    if (!count || receipt.status === 'failed' || !receipt.played.length)
      throw new Error('no-playback')
    if (operation === control && !disposed) {
      statuses.value.speech = 'untested'
      previewReady.value = true
      message.value = tn('confirm-speech')
    }
  }
  catch {
    if (operation === control && !disposed) {
      statuses.value.speech = control.signal.aborted ? 'untested' : 'failed'
      message.value = tn('speech-failed')
      save(control.signal.aborted ? 'untested' : 'failed')
    }
  }
  finally {
    await group.stop({ fadeMs: 0 }).catch(() => {})
    await context.close().catch(() => {})
    if (operation === control) {
      busy.value = false
      operation = undefined
      playback = undefined
      audioContext = undefined
    }
  }
}

function confirm(heard: boolean) {
  statuses.value.speech = heard ? 'passed' : 'failed'
  previewReady.value = false
  save(heard ? 'passed' : 'failed')
}

onScopeDispose(() => {
  disposed = true
  cancel()
})
</script>

<template>
  <SettingsCard data-testid="wow-mcp-check" :aria-label="tn('title')" role="region">
    <h2 :class="['text-lg font-semibold']">
      {{ tn('title') }}
    </h2>
    <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <FieldInput v-model="question" :label="tn('question')" :disabled="busy" />
    <p :class="['text-xs text-neutral-500']">
      {{ chat.activeModel }} · {{ speech.activeSpeechVoiceId }}
    </p>
    <div :class="['flex flex-wrap gap-2']">
      <Button :disabled="busy || !chat.chatReady || !question.trim()" @click="run">
        {{ tn('run') }}
      </Button>
      <Button :disabled="busy || !speech.configured || statuses.sources !== 'passed'" @click="preview">
        {{ tn('preview') }}
      </Button>
      <Button v-if="busy" @click="cancel">
        {{ tn('cancel') }}
      </Button>
    </div>
    <p v-if="!chat.chatReady || !speech.configured" :class="['text-sm']">
      {{ tn('configure') }}
    </p>
    <ol :class="['grid gap-2 sm:grid-cols-2']" aria-live="polite">
      <li v-for="phase in phases" :key="phase" :data-testid="`mcp-${phase}`" :class="['rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']">
        {{ tn(`phases.${phase}`) }} · {{ tn(`statuses.${statuses[phase]}`) }}
      </li>
    </ol>
    <p v-if="calls.length" :class="['text-xs break-all']">
      {{ tn('calls') }} {{ calls.join(' → ') }}
    </p>
    <p v-if="message" role="status" :class="['text-sm']">
      {{ message }}
    </p>
    <p v-if="answer" :class="['whitespace-pre-wrap text-sm break-words']">
      {{ answer }}
    </p>
    <ul v-if="links.length" :class="['space-y-1 text-sm break-all']">
      <li v-for="link in links" :key="link">
        <a :href="link" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-300']">{{ link }}</a>
      </li>
    </ul>
    <div v-if="previewReady" :class="['flex flex-wrap gap-2']">
      <Button @click="confirm(true)">
        {{ tn('heard') }}
      </Button>
      <Button @click="confirm(false)">
        {{ tn('not-heard') }}
      </Button>
    </div>
    <p v-if="latest.at" :class="['text-xs text-neutral-500']">
      {{ tn('latest') }} {{ new Date(latest.at).toLocaleString() }} · {{ tn(`statuses.${latest.status}`) }}
    </p>
    <p :class="['text-xs text-neutral-500']">
      {{ tn('cost') }}
    </p>
  </SettingsCard>
</template>

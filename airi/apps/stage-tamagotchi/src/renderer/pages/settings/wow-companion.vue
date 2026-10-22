<script setup lang="ts">
import type { CaptureSettings, CompanionSettings, DemoRequest } from '../../../shared/wow-companion'

import { errorMessageFrom } from '@moeru/std'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { Button, FieldCheckbox, FieldInput, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { defaultSettings } from '../../../shared/wow-companion'
import { useWowCompanionStore } from '../../stores/wow-companion'

const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.${key}`)
const companion = useWowCompanionStore()
const consciousness = useConsciousnessStore()
const settings = reactive<CompanionSettings>({ ...defaultSettings })
const capture = reactive<CaptureSettings>({ x: 8, y: 8, cellSize: 2, pollMs: 500, paused: false })
const busy = ref(false)
const message = ref('')
const actionError = ref('')
let settingsLoaded = false
let captureLoaded = false

const bridge = computed(() => companion.state.bridge)
const snapshot = computed(() => bridge.value?.snapshot)
const status = computed(() => {
  if (!companion.state.settings.enabled)
    return 'disabled'
  if (companion.error || companion.state.error)
    return 'disconnected'
  return bridge.value?.status ?? 'waiting'
})
const isCurrent = computed(() => status.value === 'live' || status.value === 'demo')
const error = computed(() => actionError.value || companion.error || companion.state.error || bridge.value?.error)
const preferences = ['enabled', 'muted', 'quietInCombat', 'levelUp', 'zone', 'death', 'revive', 'allowDemo'] as const
const demoActions = ['level_up', 'zone', 'death', 'revive', 'combat'] as const

watch(() => companion.state, (value) => {
  if (!settingsLoaded) {
    Object.assign(settings, value.settings)
    settingsLoaded = true
  }
  if (!captureLoaded && value.bridge) {
    Object.assign(capture, value.bridge.config)
    captureLoaded = true
  }
})

async function perform(action: () => Promise<void>) {
  busy.value = true
  actionError.value = ''
  message.value = ''
  try {
    await action()
    message.value = tn('saved')
  }
  catch (cause) {
    actionError.value = errorMessageFrom(cause) ?? tn('failed')
  }
  finally {
    busy.value = false
  }
}

function demo(enabled: boolean, action: DemoRequest['action'] = 'none') {
  return perform(() => companion.demo({ enabled, action }))
}

onMounted(() => companion.start())
</script>

<template>
  <div :class="['mx-auto max-w-4xl pb-12', 'flex flex-col gap-5']">
    <SettingsCard :title="tn('connection')" :description="tn('description')">
      <div :class="['flex flex-col gap-3']">
        <div :class="['flex flex-wrap items-center gap-3']">
          <span :class="['rounded-full px-3 py-1 text-sm font-medium', isCurrent ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300']">
            {{ tn(`status.${status}`) }}
          </span>
          <span v-if="bridge?.lastSeen" :class="['text-xs text-neutral-500']">{{ tn('last-seen') }} {{ new Date(bridge.lastSeen).toLocaleTimeString() }}</span>
        </div>
        <p v-if="status === 'demo'" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('demo-warning') }}
        </p>
        <p v-if="!consciousness.activeProvider || !consciousness.activeModel" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('model-required') }}
        </p>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('start-bridge') }}
        </p>
        <p v-if="error" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
          {{ error }}
        </p>
        <p v-if="message" role="status" :class="['text-sm text-primary-600 dark:text-primary-300']">
          {{ message }}
        </p>
        <div v-if="snapshot" :class="['grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-3', 'bg-neutral-50 dark:bg-neutral-900', !isCurrent && 'opacity-60']">
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('player') }}
            </p><p>{{ snapshot.name }} · {{ snapshot.realm }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('level') }}
            </p><p :class="['text-2xl font-semibold']">
              {{ snapshot.level }}
            </p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('zone-label') }}
            </p><p>{{ snapshot.zone }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('class-spec') }}
            </p><p>{{ snapshot.class }} / {{ snapshot.spec }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('activity') }}
            </p><p>{{ tn(snapshot.dead ? 'dead' : snapshot.combat ? 'combat' : 'exploring') }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('freshness') }}
            </p><p>{{ tn(isCurrent ? 'current' : 'historical') }}</p>
          </div>
        </div>
        <p v-else :class="['text-sm text-neutral-500']">
          {{ tn('no-character') }}
        </p>
      </div>
    </SettingsCard>

    <SettingsCard :title="tn('preferences')" :description="tn('preferences-description')">
      <div :class="['flex flex-col gap-5']">
        <FieldCheckbox v-for="key in preferences" :key="key" v-model="settings[key]" :label="tn(`options.${key}`)" :description="tn(`hints.${key}`)" :disabled="busy" />
        <FieldInput v-model="settings.cooldownSeconds" type="number" :label="tn('cooldown')" :description="tn('cooldown-description')" :disabled="busy" />
        <div>
          <Button color="primary" variant="primary" :loading="busy" @click="perform(() => companion.setSettings({ ...settings }))">
            {{ tn('save-preferences') }}
          </Button>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard :title="tn('capture')" :description="tn('capture-description')">
      <div :class="['grid grid-cols-2 gap-4']">
        <FieldInput v-model="capture.x" type="number" :label="tn('capture-x')" :disabled="busy" />
        <FieldInput v-model="capture.y" type="number" :label="tn('capture-y')" :disabled="busy" />
        <FieldInput v-model="capture.cellSize" type="number" :label="tn('cell-size')" :disabled="busy" />
        <FieldInput v-model="capture.pollMs" type="number" :label="tn('poll-ms')" :disabled="busy" />
        <FieldCheckbox v-model="capture.paused" :label="tn('pause-capture')" :disabled="busy" />
      </div>
      <p :class="['my-4 text-sm text-neutral-500']">
        {{ tn('capture-help') }}
      </p>
      <Button :loading="busy" :disabled="!bridge" @click="perform(() => companion.setCapture({ ...capture }))">
        {{ tn('save-capture') }}
      </Button>
    </SettingsCard>

    <SettingsCard :title="tn('demo')" :description="tn('demo-description')">
      <div :class="['flex flex-wrap gap-2']">
        <Button :loading="busy" :disabled="!bridge" @click="demo(bridge?.source !== 'demo')">
          {{ tn(bridge?.source === 'demo' ? 'stop-demo' : 'start-demo') }}
        </Button>
        <Button v-for="action in demoActions" :key="action" :disabled="busy || bridge?.source !== 'demo'" @click="demo(true, action)">
          {{ tn(`actions.${action}`) }}
        </Button>
      </div>
    </SettingsCard>

    <SettingsCard :title="tn('events')" :description="tn('events-description')">
      <ol v-if="bridge?.events.length" :class="['flex max-h-80 flex-col gap-3 overflow-y-auto']">
        <li v-for="event in [...bridge.events].reverse()" :key="event.id" :class="['rounded-lg p-3', 'bg-neutral-50 dark:bg-neutral-900']">
          <div :class="['flex items-center justify-between gap-3 text-sm']">
            <strong>{{ event.demo ? `[${tn('demo-label')}] ` : '' }}{{ event.title }}</strong>
            <time :datetime="event.timestamp" :class="['shrink-0 text-xs text-neutral-500']">{{ new Date(event.timestamp).toLocaleTimeString() }}</time>
          </div>
          <p :class="['mt-1 text-sm text-neutral-500']">
            {{ event.detail }}
          </p>
        </li>
      </ol>
      <p v-else :class="['text-sm text-neutral-500']">
        {{ tn('no-events') }}
      </p>
    </SettingsCard>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.title
  subtitleKey: settings.title
  descriptionKey: wow-companion.description
  icon: i-solar:gamepad-bold-duotone
  settingsEntry: true
  order: 8
  stageTransition:
    name: slide
</route>

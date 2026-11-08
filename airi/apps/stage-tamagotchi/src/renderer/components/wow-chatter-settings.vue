<script setup lang="ts">
import type { CSSProperties } from 'vue'

import { Button, FieldCheckbox, FieldInput, Input, Range, SettingsCard } from '@proj-airi/ui'
import { useNow } from '@vueuse/core'
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useWowChatterSettingsStore } from '../stores/wow-chatter-settings'

const settings = useWowChatterSettingsStore()
const router = useRouter()
const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.chatter.${key}`)
const now = useNow({ interval: 1000 })
const usage = computed(() => settings.usage(now.value.getTime()))
const sceneFields = ['outdoorRegular', 'outdoorScenery', 'instanceRegular', 'instanceScenery'] as const
type SceneField = typeof sceneFields[number]

const sceneDrafts = reactive<Record<SceneField, number | undefined>>({
  outdoorRegular: settings.outdoorRegular,
  outdoorScenery: settings.outdoorScenery,
  instanceRegular: settings.instanceRegular,
  instanceScenery: settings.instanceScenery,
})
for (const field of sceneFields)
  watch(() => settings[field], value => sceneDrafts[field] = value)

// Commit whole entries so typing a leading one can still produce a valid value such as twelve.
function saveSceneFrequency(field: SceneField) {
  settings[field] = sceneDrafts[field] ?? Number.NaN
  sceneDrafts[field] = settings[field]
}

const intervalValue = (minutes: number) => t('wow-companion.chatter.interval-value', { minutes })
const combatValue = (count: number) => t('wow-companion.chatter.combat-count-value', { count })
const frequentScreenshots = computed(() => settings.sceneryIntervalMinutes <= 5)
// The warning segment ends at five minutes on the slider's 1–60 minute domain.
const redBoundary = (5 - 1) / (60 - 1) * 100
const sceneryTrack = `linear-gradient(to right, #dc2626 0%, #dc2626 ${redBoundary}%, #16a34a ${redBoundary}%, #16a34a 100%)`

function rangeStyle(track: string, thumb: string): CSSProperties {
  return {
    '--track-background': track,
    '--track-background-hover': track,
    '--track-background-active': track,
    '--track-value-background': 'transparent',
    '--track-value-background-hover': 'transparent',
    '--track-value-background-active': 'transparent',
    '--thumb-background': thumb,
    '--thumb-background-hover': thumb,
    '--thumb-background-active': thumb,
    '--thumb-width': '1rem',
    '--thumb-height': '1.75rem',
  }
}

const regularStyle = rangeStyle('#16a34a', '#15803d')
const sceneryStyle = computed(() => rangeStyle(sceneryTrack, frequentScreenshots.value ? '#dc2626' : '#15803d'))
</script>

<template>
  <div data-testid="wow-chatter-settings" :class="['mx-auto min-w-0 w-full max-w-3xl pb-12', 'flex flex-col gap-5']">
    <header>
      <h2 :class="['text-xl font-semibold']">
        {{ tn('title') }}
      </h2>
      <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('description') }}
      </p>
    </header>

    <SettingsCard>
      <section aria-labelledby="wow-regular-title" :class="['min-w-0', 'flex flex-col gap-5']">
        <header>
          <h3 id="wow-regular-title" :class="['text-base font-semibold']">
            {{ tn('regular-title') }}
          </h3>
          <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('regular-description') }}
          </p>
        </header>
        <FieldCheckbox
          v-model="settings.regularEnabled"
          :label="tn('regular-enabled')"
          :description="tn('regular-enabled-description')"
        />
        <div :class="['min-w-0', 'flex flex-col gap-3']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <label for="wow-regular-interval" :class="['text-sm font-medium']">{{ tn('regular-interval') }}</label>
            <output for="wow-regular-interval" :class="['text-sm tabular-nums']">{{ intervalValue(settings.regularIntervalMinutes) }}</output>
          </div>
          <div :class="['rounded-lg p-1', 'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500']">
            <Range
              id="wow-regular-interval"
              v-model="settings.regularIntervalMinutes"
              data-testid="wow-regular-interval"
              :min="2" :max="30" :step="1"
              :aria-valuemin="2" :aria-valuemax="30" :aria-valuenow="settings.regularIntervalMinutes"
              :aria-valuetext="intervalValue(settings.regularIntervalMinutes)"
              :style="regularStyle"
              :class="['block w-full']"
            />
          </div>
          <div aria-hidden="true" :class="['flex justify-between text-xs text-neutral-500 dark:text-neutral-400']">
            <span>{{ intervalValue(2) }}</span><span>{{ intervalValue(30) }}</span>
          </div>
        </div>
        <div :class="['min-w-0', 'flex flex-col gap-3']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <label for="wow-regular-combats" :class="['text-sm font-medium']">{{ tn('combats-required') }}</label>
            <output for="wow-regular-combats" :class="['text-sm tabular-nums']">{{ combatValue(settings.combatsRequired) }}</output>
          </div>
          <div :class="['rounded-lg p-1', 'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500']">
            <Range
              id="wow-regular-combats"
              v-model="settings.combatsRequired"
              data-testid="wow-regular-combats"
              :min="5" :max="30" :step="1"
              :aria-valuemin="5" :aria-valuemax="30" :aria-valuenow="settings.combatsRequired"
              :aria-valuetext="combatValue(settings.combatsRequired)"
              aria-describedby="wow-regular-combats-description"
              :style="regularStyle"
              :class="['block w-full']"
            />
          </div>
          <div aria-hidden="true" :class="['flex justify-between text-xs text-neutral-500 dark:text-neutral-400']">
            <span>{{ combatValue(5) }}</span><span>{{ combatValue(30) }}</span>
          </div>
          <p id="wow-regular-combats-description" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('combats-required-description') }}
          </p>
        </div>
        <div :class="['flex flex-col items-start gap-2']">
          <Button @click="router.push('/settings/wow-memories')">
            {{ tn('manage-memories') }}
          </Button>
        </div>
      </section>
    </SettingsCard>

    <SettingsCard>
      <section aria-labelledby="wow-scenery-title" :class="['min-w-0', 'flex flex-col gap-5']">
        <header>
          <h3 id="wow-scenery-title" :class="['text-base font-semibold']">
            {{ tn('scenery-title') }}
          </h3>
          <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('scenery-description') }}
          </p>
        </header>
        <FieldCheckbox
          v-model="settings.sceneryEnabled"
          :label="tn('scenery-enabled')"
          :description="tn('scenery-enabled-description')"
        />
        <div :class="['min-w-0', 'flex flex-col gap-3']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <label for="wow-scenery-interval" :class="['text-sm font-medium']">{{ tn('scenery-interval') }}</label>
            <output for="wow-scenery-interval" :class="['text-sm tabular-nums']">{{ intervalValue(settings.sceneryIntervalMinutes) }}</output>
          </div>
          <div :class="['rounded-lg p-1', 'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500']">
            <Range
              id="wow-scenery-interval"
              v-model="settings.sceneryIntervalMinutes"
              data-testid="wow-scenery-interval"
              :min="1" :max="60" :step="1"
              :aria-valuemin="1" :aria-valuemax="60" :aria-valuenow="settings.sceneryIntervalMinutes"
              :aria-valuetext="intervalValue(settings.sceneryIntervalMinutes)"
              :aria-describedby="frequentScreenshots ? 'wow-scenery-quota-warning' : undefined"
              :style="sceneryStyle"
              :class="['block w-full']"
            />
          </div>
          <div aria-hidden="true" :class="['flex justify-between text-xs text-neutral-500 dark:text-neutral-400']">
            <span>{{ intervalValue(1) }}</span><span>{{ intervalValue(60) }}</span>
          </div>
          <p
            v-if="frequentScreenshots"
            id="wow-scenery-quota-warning"
            data-testid="wow-scenery-quota-warning"
            role="status"
            :class="['text-sm text-red-700 dark:text-red-300']"
          >
            {{ tn('quota-warning') }}
          </p>
        </div>
        <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ tn('image-use') }}
        </p>
        <div :class="['flex flex-col items-start gap-2']">
          <Button @click="router.push('/settings/modules/vision')">
            {{ tn('configure-vision') }}
          </Button>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('vision-description') }}
          </p>
        </div>
      </section>
    </SettingsCard>
    <SettingsCard>
      <section aria-labelledby="wow-location-title" :class="['min-w-0', 'flex flex-col gap-5']">
        <header>
          <h3 id="wow-location-title" :class="['text-base font-semibold']">
            {{ tn('location-title') }}
          </h3>
          <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('location-description') }}
          </p>
        </header>
        <FieldCheckbox
          v-model="settings.locationEnabled"
          :label="tn('location-enabled')"
          :description="tn('location-enabled-description')"
        />
      </section>
    </SettingsCard>
    <SettingsCard>
      <section :aria-label="tn('quiet-title')" :class="['flex flex-col gap-4']">
        <h3 :class="['text-base font-semibold']">
          {{ tn('quiet-title') }}
        </h3>
        <FieldCheckbox v-model="settings.quietEnabled" :label="tn('quiet-enabled')" :description="tn('quiet-description')" />
        <div :class="['grid gap-4 sm:grid-cols-2']">
          <FieldInput v-model="settings.quietStart" type="time" :label="tn('quiet-start')" :disabled="!settings.quietEnabled" />
          <FieldInput v-model="settings.quietEnd" type="time" :label="tn('quiet-end')" :disabled="!settings.quietEnabled" />
        </div>
        <p role="status" :class="['text-sm']">
          {{ tn(settings.quiet(now.getTime()) ? 'quiet-active' : 'quiet-inactive') }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('death-description') }}
        </p>
      </section>
    </SettingsCard>
    <SettingsCard>
      <section :aria-label="tn('scene-title')" :class="['flex flex-col gap-4']">
        <h3 :class="['text-base font-semibold']">
          {{ tn('scene-title') }}
        </h3>
        <FieldCheckbox v-model="settings.sceneEnabled" :label="tn('scene-enabled')" :description="tn('scene-description')" />
        <div :class="['grid gap-4 sm:grid-cols-2']">
          <label v-for="field in sceneFields" :key="field" :class="['max-w-full', 'flex flex-col gap-4']">
            <span>
              <span :class="['block text-sm font-medium']">{{ tn(`scene-fields.${field}`) }}</span>
              <span :class="['block text-xs text-neutral-500 dark:text-neutral-400']">{{ tn(field.endsWith('Regular') ? 'regular-scene-inherit' : 'scene-inherit') }}</span>
            </span>
            <Input
              v-model="sceneDrafts[field]"
              type="number"
              :min="0" :max="field.endsWith('Regular') ? 30 : 60" :step="1"
              :disabled="!settings.sceneEnabled"
              @change="saveSceneFrequency(field)"
              @blur="saveSceneFrequency(field)"
            />
          </label>
        </div>
      </section>
    </SettingsCard>
    <SettingsCard>
      <section :aria-label="tn('budget-title')" :class="['flex flex-col gap-4']">
        <h3 :class="['text-base font-semibold']">
          {{ tn('budget-title') }}
        </h3>
        <FieldCheckbox v-model="settings.budgetEnabled" :label="tn('budget-enabled')" :description="tn('budget-description')" />
        <FieldInput type="number" :model-value="settings.hourlyLimit" :label="tn('budget-limit')" :disabled="!settings.budgetEnabled" @update:model-value="settings.hourlyLimit = Number($event)" />
        <p role="status" data-testid="wow-model-budget" :class="['text-sm']">
          {{ t('wow-companion.chatter.budget-usage', { used: usage.used, remaining: usage.remaining, limit: settings.hourlyLimit }) }}
        </p>
        <p v-if="settings.budgetEnabled && usage.remaining === 0" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('budget-exhausted') }}
        </p>
        <p v-if="usage.nextAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('budget-next') }} {{ new Date(usage.nextAt).toLocaleTimeString() }}
        </p>
      </section>
    </SettingsCard>
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('operation-description') }}
    </p>
  </div>
</template>

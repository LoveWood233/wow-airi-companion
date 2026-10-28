<script setup lang="ts">
import { Button, FieldCheckbox, SettingsCard } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useWowScreenAssistSettingsStore } from '../stores/wow-screen-assist-settings'

const settings = useWowScreenAssistSettingsStore()
const router = useRouter()
const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.screen-assist.${key}`)
const games = ['auto', 'retail', 'forever', 'classic'] as const
</script>

<template>
  <div data-testid="wow-screen-assist-settings" :class="['mx-auto max-w-3xl pb-12', 'flex flex-col gap-5']">
    <header>
      <h2 :class="['text-xl font-semibold']">{{ tn('title') }}</h2>
      <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">{{ tn('description') }}</p>
    </header>
    <SettingsCard>
      <FieldCheckbox v-model="settings.enabled" :label="tn('enabled')" :description="tn('enabled-description')" />
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">{{ tn('image-use') }}</p>
      <div>
        <h3 :class="['mb-2 text-sm font-medium']">{{ tn('target') }}</h3>
        <div role="group" :aria-label="tn('target')" :class="['flex flex-wrap gap-2']">
          <Button
            v-for="game in games" :key="game"
            :aria-pressed="settings.game === game"
            :variant="settings.game === game ? 'primary' : 'secondary'"
            :color="settings.game === game ? 'primary' : 'neutral'"
            @click="settings.game = game"
          >{{ tn(`games.${game}`) }}</Button>
        </div>
        <p :class="['mt-2 text-xs text-neutral-500 dark:text-neutral-400']">{{ tn('target-description') }}</p>
      </div>
      <div :class="['flex flex-col items-start gap-2']">
        <Button @click="router.push('/settings/modules/vision')">{{ tn('configure-vision') }}</Button>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ tn('vision-description') }}</p>
      </div>
    </SettingsCard>
    <SettingsCard>
      <h3 :class="['text-base font-semibold']">{{ tn('examples-title') }}</h3>
      <ul :class="['list-disc pl-5', 'flex flex-col gap-3 text-sm']">
        <li>{{ tn('examples.terrain') }}</li>
        <li>{{ tn('examples.quest') }}</li>
        <li>{{ tn('examples.scene') }}</li>
      </ul>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">{{ tn('command') }}</p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ tn('limits') }}</p>
    </SettingsCard>
  </div>
</template>

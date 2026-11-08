<script setup lang="ts">
import { Button, FieldRange, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DshPetStage from '../../../components/dsh-pet-stage.vue'

import { useDshPetStore } from '../../../stores/dsh-pet'

const pet = useDshPetStore()
const { t } = useI18n()
const tn = (key: string) => t(`dsh-pet.${key}`)
const percentage = ref(100)
const previewError = ref(false)
const scale = computed(() => percentage.value / 100)
watch(() => pet.scale, value => percentage.value = Math.round(value * 100), { immediate: true })
watch(() => pet.pack.id, () => previewError.value = false)

function select(selectedId: string) {
  return pet.configure({ selectedId, scale: pet.scale })
}

function saveScale() {
  return pet.configure({ selectedId: pet.pack.id, scale: scale.value })
}

onMounted(() => pet.initialize())
</script>

<template>
  <div :class="['min-w-0 flex flex-col gap-5 pb-12']" :aria-busy="pet.busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ tn('preview') }}
      </h2>
      <div :class="['relative h-72 min-w-0 overflow-hidden rounded-2xl bg-neutral-100/70 dark:bg-neutral-800/50']">
        <DshPetStage
          :pack="pet.pack"
          :scale="scale"
          :class="['h-full w-full']"
          @reset="previewError = false"
          @error="previewError = true"
        />
      </div>
      <p v-if="previewError" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ tn('preview-error') }}
      </p>
      <FieldRange v-model="percentage" :min="50" :max="200" :step="5" :label="tn('scale')" :format-value="value => `${value}%`" />
      <div :class="['flex justify-end']">
        <Button :disabled="pet.busy" @click="saveScale">
          {{ tn('save') }}
        </Button>
      </div>
    </SettingsCard>
    <SettingsCard>
      <div :class="['flex flex-wrap items-center justify-between gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ tn('packs') }}
        </h2>
        <Button :disabled="pet.busy" @click="pet.importPack">
          {{ tn('import') }}
        </Button>
      </div>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('import-hint') }}
      </p>
      <div :class="['grid min-w-0 gap-3 sm:grid-cols-2']">
        <button
          v-for="pack in pet.state.packs"
          :key="pack.id"
          type="button"
          :disabled="pet.busy"
          :aria-pressed="pack.id === pet.pack.id"
          :class="['min-w-0 flex items-center justify-between gap-3 border-2 rounded-xl p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-400', pack.id === pet.pack.id ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/30' : 'border-neutral-200 dark:border-neutral-700']"
          @click="select(pack.id)"
        >
          <span :class="['min-w-0 break-words']">
            <span :class="['block font-medium']">{{ pack.name }}</span>
            <span :class="['mt-1 block text-xs text-neutral-500 dark:text-neutral-400']">{{ pack.files.length }} {{ tn('animations') }}</span>
          </span>
          <span v-if="pack.id === pet.pack.id" :class="['shrink-0 text-xs text-primary-600 dark:text-primary-300']">{{ tn('selected') }}</span>
        </button>
      </div>
      <p v-if="pet.failed" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ tn('operation-error') }}
      </p>
    </SettingsCard>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: dsh-pet.title
  subtitleKey: settings.title
  descriptionKey: dsh-pet.description
  icon: i-solar:cat-bold-duotone
  settingsEntry: true
  order: 4
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>

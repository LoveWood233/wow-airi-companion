<script setup lang="ts">
import type { Availability } from 'xsai-chromium-prompt'

import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  label?: string
  description?: string
  checkAvailability: () => Promise<Availability>
  download: (onProgress: (progress: number) => void) => Promise<Availability>
  setVaild: () => void
}>()

const availability = ref('unavailable')
const progress = ref(0)

onMounted(async () => {
  const availabilityNow = await props.checkAvailability()
  availability.value = availabilityNow
  if (availabilityNow === 'available') {
    progress.value = 1
    props.setVaild()
  }
})

async function download() {
  const resultAvailability = await props.download(p => progress.value = p)
  availability.value = resultAvailability
}

const { t: translateCompanion } = useI18n({ useScope: 'global' })
</script>

<template>
  <div class="max-w-full">
    <label class="flex flex-col gap-4">
      <div>
        <div class="flex items-center gap-1 text-sm font-medium">
          <slot name="label">
            {{ props.label }}
          </slot>
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400" text-wrap>
          <slot name="description">
            {{ props.description }}
          </slot>
        </div>
      </div>
    </label>
    <div w-full flex flex-row gap-2>
      <div w-full>
        <div
          class="flex items-center justify-between whitespace-nowrap rounded-lg bg-violet-100 px-3 py-2 text-sm dark:bg-violet-900"
          :style="{ width: `${(progress * 100)}%` }"
        >
          <span>{{ availability }}</span>
          <span>({{ (progress * 100).toFixed(2) }}%)</span>
        </div>
      </div>
      <button rounded-lg bg="blue-100 dark:blue-900" px-4 py-2 @click="download">
        {{ translateCompanion('companion-extra.download-a479c9') }}
      </button>
    </div>
  </div>
</template>

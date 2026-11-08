<script setup lang="ts">
import { Button, FieldCheckbox } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowStatisticsStore } from '../stores/wow-statistics'

const statistics = useWowStatisticsStore()
const { t } = useI18n()
const tn = (key: string) => t(`wow-statistics.${key}`)
const enabled = ref(true)
const open = computed(() => !!statistics.state && !statistics.state.disclosed && !statistics.deferred)
onMounted(() => statistics.initialize())
</script>

<template>
  <DialogRoot :open="open" @update:open="value => !value && statistics.defer()">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-9998 bg-black/40']" />
      <DialogContent :class="['fixed left-1/2 top-1/2 z-9999 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl p-6 shadow-xl outline-none -translate-x-1/2 -translate-y-1/2', 'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100']">
        <DialogTitle :class="['text-lg font-semibold']">
          {{ tn('disclosure-title') }}
        </DialogTitle>
        <DialogDescription :class="['mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
          {{ tn('disclosure-intro') }}
        </DialogDescription>
        <ul :class="['mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed']">
          <li>{{ tn('collect') }}</li>
          <li>{{ tn('no-content') }}</li>
          <li>{{ tn('coverage') }}</li>
          <li>{{ tn('installation-limit') }}</li>
          <li>{{ tn('control') }}</li>
        </ul>
        <p v-if="!statistics.state?.configured" :class="['mt-4 rounded-xl bg-neutral-100 p-3 text-sm dark:bg-neutral-800']">
          {{ tn('not-configured') }}
        </p>
        <p v-else :class="['mt-4 break-all text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('endpoint') }}: {{ statistics.state.endpoint }}
        </p>
        <div :class="['mt-5']">
          <FieldCheckbox v-model="enabled" :label="tn('default-enabled')" :disabled="statistics.busy" />
        </div>
        <p v-if="statistics.failed" role="alert" :class="['mt-3 text-sm text-red-700 dark:text-red-300']">
          {{ tn('operation-failed') }}
        </p>
        <div :class="['mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap']">
          <Button variant="primary" color="primary" :disabled="statistics.busy" @click="statistics.acknowledge(enabled)">
            {{ tn('continue') }}
          </Button>
          <Button :disabled="statistics.busy" @click="statistics.acknowledge(false)">
            {{ tn('disable') }}
          </Button>
          <Button :disabled="statistics.busy" @click="statistics.defer()">
            {{ tn('later') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

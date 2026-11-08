<script setup lang="ts">
import { stageOpaqueAttribute } from '../../composables/use-stage-painted-mask'

defineProps<{
  /** The stage supplies the current spoken sentence and clears it after playback. */
  text: string
}>()
</script>

<template>
  <div
    v-if="text.trim()"
    data-testid="speech-caption-bubble"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    :[stageOpaqueAttribute]="true"
    :class="[
      'pointer-events-none absolute right-16 top-[clamp(4.5rem,15%,7.5rem)]',
      'w-fit max-w-[min(22rem,calc(100%-5rem))]',
      'rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md',
      'border-primary-200/70 bg-white/90 text-neutral-900',
      'dark:border-primary-700/50 dark:bg-neutral-900/90 dark:text-neutral-50',
    ]"
  >
    <span
      aria-hidden="true"
      :[stageOpaqueAttribute]="true"
      :class="[
        'pointer-events-none absolute bottom--1.5 left-6 size-3 rotate-45 border-b border-r',
        'border-primary-200/70 bg-white/90',
        'dark:border-primary-700/50 dark:bg-neutral-900/90',
      ]"
    />
    <p :class="['relative m-0 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]']">
      {{ text }}
    </p>
  </div>
</template>

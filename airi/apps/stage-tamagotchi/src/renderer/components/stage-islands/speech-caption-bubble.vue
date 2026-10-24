<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { ref, watch } from 'vue'

import { stageOpaqueAttribute } from '../../composables/use-stage-painted-mask'

const props = defineProps<{
  /** The stage supplies the current spoken sentence and clears it after playback. */
  text: string
  /** The prompt owner controls availability and expiry. This component never starts a timer. */
  actions?: {
    id: string
    acceptLabel: string
    declineLabel: string
    hint: string
    disabled?: boolean
  }
}>()

const emit = defineEmits<{
  choose: [id: string, choice: 'accept' | 'decline']
}>()

const actionsElement = ref<HTMLElement>()
const acceptElement = ref<HTMLElement>()
const declineElement = ref<HTMLElement>()
const actionsFocused = ref(false)

function handleFocusOut(event: FocusEvent) {
  actionsFocused.value = event.relatedTarget instanceof Node
    && !!actionsElement.value?.contains(event.relatedTarget)
}

watch(() => props.actions?.id, () => {
  actionsFocused.value = false
})

// The desktop page uses these exact button bounds to restore native pointer input.
defineExpose({ acceptElement, declineElement, actionsFocused })
</script>

<template>
  <div
    v-if="text.trim() || actions"
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
    <div
      v-if="actions"
      :key="actions.id"
      ref="actionsElement"
      :class="['pointer-events-none relative mt-3']"
      @focusin="actionsFocused = true"
      @focusout="handleFocusOut"
    >
      <div :class="['flex flex-wrap gap-2']">
        <span ref="acceptElement" :class="['inline-flex']">
          <Button
            type="button"
            color="primary"
            variant="primary"
            size="sm"
            :disabled="actions.disabled"
            :class="['pointer-events-auto [-webkit-app-region:no-drag]']"
            @pointerdown.stop
            @keydown.stop
            @click.stop="emit('choose', actions.id, 'accept')"
          >
            {{ actions.acceptLabel }}
          </Button>
        </span>
        <span ref="declineElement" :class="['inline-flex']">
          <Button
            type="button"
            size="sm"
            :disabled="actions.disabled"
            :class="['pointer-events-auto [-webkit-app-region:no-drag]']"
            @pointerdown.stop
            @keydown.stop
            @click.stop="emit('choose', actions.id, 'decline')"
          >
            {{ actions.declineLabel }}
          </Button>
        </span>
      </div>
      <p :class="['mb-0 mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300 [overflow-wrap:anywhere]']">
        {{ actions.hint }}
      </p>
    </div>
  </div>
</template>

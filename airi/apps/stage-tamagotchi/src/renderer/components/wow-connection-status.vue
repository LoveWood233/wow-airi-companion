<script setup lang="ts">
import type { BridgeStatus } from '../../shared/wow-companion'

import { Button, Progress, SettingsCard } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ bridge: BridgeStatus | null, enabled: boolean, busy: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.connection-details.${key}`)
const diagnostic = computed(() => props.bridge?.connection)
const phase = computed(() => {
  if (!props.enabled)
    return 'disabled'
  if (props.bridge?.source === 'demo')
    return 'demo'
  if (props.bridge?.config.paused)
    return 'paused'
  if (diagnostic.value?.phase === 'connected' && props.bridge?.snapshot?.online === false)
    return 'waiting-character'
  if (diagnostic.value?.phase === 'connected' && props.bridge?.status !== 'live')
    return 'stale'
  return diagnostic.value?.phase ?? 'unavailable'
})
const canRetry = computed(() => props.enabled && props.bridge?.source === 'screen' && !props.bridge.config.paused && !!diagnostic.value)
const timestamp = (value: string) => new Date(value).toLocaleTimeString()
</script>

<template>
  <SettingsCard :aria-label="tn('title')" role="region" data-testid="wow-connection-status">
    <h2 :class="['text-lg font-semibold']">
      {{ tn('title') }}
    </h2>
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('description') }}
    </p>
    <p role="status" :class="['font-medium']">
      {{ tn(`phases.${phase}`) }}
    </p>
    <p v-if="diagnostic?.reason && enabled && bridge?.source === 'screen' && !bridge.config.paused" :class="['text-sm break-words']">
      {{ tn(`reasons.${diagnostic.reason}`) }}
    </p>
    <template v-if="diagnostic && enabled && bridge?.source === 'screen' && !bridge.config.paused">
      <p :class="['text-sm']">
        {{ t('wow-companion.connection-details.confirmation', { count: diagnostic.consecutive }) }}
      </p>
      <Progress :progress="diagnostic.consecutive / 3 * 100" role="progressbar" :aria-label="tn('heartbeat')" :aria-valuemin="0" :aria-valuemax="3" :aria-valuenow="diagnostic.consecutive" />
      <p v-if="diagnostic.lastFrameAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('last-frame') }} {{ timestamp(diagnostic.lastFrameAt) }}
      </p>
      <p v-if="bridge.lastSeen" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('last-heartbeat') }} {{ timestamp(bridge.lastSeen) }}
      </p>
      <p v-if="diagnostic.retrySeconds > 0" :class="['text-sm']">
        {{ t('wow-companion.connection-details.retry-after', { seconds: diagnostic.retrySeconds }) }}
      </p>
      <p v-if="diagnostic.calibration" :class="['text-xs break-words text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-companion.connection-details.position', { x: diagnostic.calibration.x, y: diagnostic.calibration.y, px: diagnostic.calibration.pitchX.toFixed(2), py: diagnostic.calibration.pitchY.toFixed(2) }) }}
      </p>
      <p v-if="diagnostic.calibratedAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('calibrated-at') }} {{ timestamp(diagnostic.calibratedAt) }}
      </p>
    </template>
    <p v-if="!diagnostic && bridge" :class="['text-sm']">
      {{ tn('update-bridge') }}
    </p>
    <Button :disabled="busy || !canRetry" :loading="busy" @click="emit('retry')">
      {{ tn('retry') }}
    </Button>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('retry-help') }}
    </p>
    <section :aria-label="tn('transfers')" :class="['flex flex-col gap-3']">
      <h3 :class="['font-medium']">
        {{ tn('transfers') }}
      </h3>
      <p v-if="!bridge?.transfers?.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('no-transfers') }}
      </p>
      <article v-for="transfer in bridge?.transfers" :key="transfer.kind" :data-testid="`transfer-${transfer.kind}`" :class="['rounded-lg border border-neutral-200 p-3 dark:border-neutral-700', 'flex flex-col gap-2']">
        <p :class="['text-sm']">
          {{ tn(`kinds.${transfer.kind}`) }} · {{ tn(`transfer-phases.${transfer.phase}`) }}
        </p>
        <p :class="['text-sm tabular-nums']">
          {{ transfer.received }} / {{ transfer.total }}
        </p>
        <Progress :progress="transfer.received / transfer.total * 100" role="progressbar" :aria-label="tn(`kinds.${transfer.kind}`)" :aria-valuemin="0" :aria-valuemax="transfer.total" :aria-valuenow="transfer.received" />
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-companion.connection-details.transfer-time', { elapsed: transfer.elapsedSeconds, timeout: transfer.timeoutSeconds }) }}
        </p>
      </article>
    </section>
  </SettingsCard>
</template>

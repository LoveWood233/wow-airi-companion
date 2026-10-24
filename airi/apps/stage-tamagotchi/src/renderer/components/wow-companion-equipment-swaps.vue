<script setup lang="ts">
import type { BridgeStatus } from '../../shared/wow-companion'
import type { EquipmentSwap } from '../../shared/wow-companion-equipment-swaps'

import { SettingsCard } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { emptyEquipmentSwaps } from '../../shared/wow-companion-equipment-swaps'

const props = defineProps<{ bridge: BridgeStatus | null, current: boolean }>()
const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.equipment-swaps.${key}`)
const entries = computed(() => {
  const snapshot = props.bridge?.snapshot
  if (!snapshot || props.bridge?.source !== 'screen' || !props.bridge.equipmentSwaps)
    return emptyEquipmentSwaps
  return props.bridge.equipmentSwaps.filter(result => result.g === snapshot.guid && result.s === snapshot.session).slice(-10).reverse()
})

function itemName(result: EquipmentSwap) {
  const item = props.bridge?.equipment?.find(item => item.guid === result.g && item.session === result.s && item.id === result.e && item.itemID === result.item)
  return item?.name ?? t('wow-companion.equipment.unnamed', { id: result.item })
}
</script>

<template>
  <SettingsCard>
    <section :aria-label="tn('title')" :class="['min-w-0 flex flex-col gap-3']">
      <header>
        <h2 :class="['text-lg font-semibold']">
          {{ tn('title') }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('description') }}
        </p>
      </header>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ tn('confirmation') }}
      </p>
      <p v-if="bridge?.equipmentSwapError" role="status" :class="['break-words text-sm text-amber-700 dark:text-amber-300']">
        {{ tn('read-error') }} {{ bridge.equipmentSwapError }}
      </p>
      <p v-if="bridge && bridge.equipmentSwaps === undefined" :class="['text-sm text-amber-700 dark:text-amber-300']">
        {{ tn('bridge-update') }}
      </p>
      <p v-else-if="!entries.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('empty') }}
      </p>
      <p v-else-if="!current || bridge?.equipmentSwapError" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
        {{ tn('historical') }}
      </p>
      <ol :class="['flex flex-col gap-3']">
        <li v-for="result in entries" :key="`${result.s}:${result.id}`" :class="['min-w-0 rounded-xl p-3', 'border border-neutral-200 dark:border-neutral-800']">
          <div :class="['flex flex-wrap items-start justify-between gap-2']">
            <h3 :class="['min-w-0 break-words font-medium']">
              {{ itemName(result) }}
            </h3>
            <span :class="['shrink-0 rounded-full px-2 py-1 text-xs', 'bg-neutral-100 dark:bg-neutral-800']">
              {{ tn(`status.${result.st}`) }}
            </span>
          </div>
          <p :class="['mt-2 break-words text-sm']">
            {{ result.st === 'expired' ? tn('expired-reason') : tn(`reason.${result.r}`) }}
          </p>
          <p :class="['mt-2 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn(`slots.${result.slot}`) }} · {{ tn('previous') }}
            {{ result.old === 0 ? tn('empty-slot') : t('wow-companion.equipment.unnamed', { id: result.old }) }}
          </p>
          <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('observed') }}
            <time v-if="result.at > 0" :datetime="new Date(result.at * 1000).toISOString()">{{ new Date(result.at * 1000).toLocaleString(locale) }}</time>
            <span v-else>{{ t('wow-companion.equipment.unavailable') }}</span>
          </p>
        </li>
      </ol>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('scope-note') }}
      </p>
    </section>
  </SettingsCard>
</template>

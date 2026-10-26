<script setup lang="ts">
import type { Snapshot } from '../../shared/wow-companion'
import type { EquipmentComparison } from '../../shared/wow-companion-equipment-comparisons'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { assessEquipment } from '../../shared/wow-companion-equipment-comparisons'

const props = defineProps<{ comparison: EquipmentComparison | undefined, current: Snapshot | null }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.comparison.${key}`)
const assessment = computed(() => props.comparison ? assessEquipment(props.comparison) : null)
const staleSpec = computed(() => props.comparison && (!props.current || props.comparison.guid !== props.current.guid || props.comparison.spec !== props.current.spec || props.comparison.class !== props.current.class))
const stats = computed(() => {
  if (!props.comparison)
    return undefined
  const values = new Map<string, { key: string, previous: number | null, next: number | null }>()
  if (props.comparison.current) {
    for (const stat of props.comparison.current.stats)
      values.set(stat.key, { key: stat.key, previous: stat.value, next: props.comparison.candidate.complete ? 0 : null })
  }
  for (const stat of props.comparison.candidate.stats) {
    const value = values.get(stat.key)
    if (value)
      value.next = stat.value
    else
      values.set(stat.key, { key: stat.key, previous: props.comparison.current?.complete ? 0 : null, next: stat.value })
  }
  return [...values.values()]
})
function statLabel(key: string) {
  const path = `wow-companion.equipment.stats.${key}`
  return te(path) ? t(path) : key
}
function amount(value: number | null) {
  return value === null ? tn('unknown') : value.toLocaleString(locale.value, { maximumFractionDigits: 3 })
}
</script>

<template>
  <section :aria-label="tn('title')" :class="['rounded-lg border border-neutral-200 p-3 dark:border-neutral-800', 'flex flex-col gap-3']">
    <h4 :class="['text-sm font-medium']">
      {{ tn('title') }}
    </h4>
    <p v-if="!comparison" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('missing') }}
    </p>
    <template v-else-if="assessment">
      <p :class="['text-sm font-medium']">
        {{ tn(`verdict.${assessment.verdict}`) }} · {{ tn(`reason.${assessment.reason}`) }}
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('historical') }}
        <time v-if="comparison.observedAt" :datetime="new Date(comparison.observedAt * 1000).toISOString()">{{ new Date(comparison.observedAt * 1000).toLocaleString(locale) }}</time>
      </p>
      <p v-if="staleSpec" :class="['text-xs text-amber-700 dark:text-amber-300']">
        {{ tn('stale-spec') }}
      </p>
      <div :class="['max-w-full overflow-x-auto']">
        <table :class="['min-w-100 w-full text-left text-sm']">
          <thead>
            <tr>
              <th scope="col" :class="['px-2 py-1']">
                {{ tn('attribute') }}
              </th>
              <th scope="col" :class="['px-2 py-1']">
                {{ comparison.current?.name || tn('unknown') }}
              </th>
              <th scope="col" :class="['px-2 py-1']">
                {{ comparison.candidate.name }}
              </th>
              <th scope="col" :class="['px-2 py-1']">
                {{ tn('difference') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" :class="['px-2 py-1 font-medium']">
                {{ tn('type') }}
              </th>
              <td :class="['px-2 py-1']">
                {{ comparison.current?.subtype || tn('unknown') }}
              </td>
              <td :class="['px-2 py-1']">
                {{ comparison.candidate.subtype || tn('unknown') }}
              </td>
              <td :class="['px-2 py-1']">
                —
              </td>
            </tr>
            <tr>
              <th scope="row" :class="['px-2 py-1 font-medium']">
                {{ tn('item-level') }}
              </th>
              <td :class="['px-2 py-1']">
                {{ comparison.current?.itemID === 0 ? tn('empty-slot') : comparison.current?.itemLevel ?? tn('unknown') }}
              </td>
              <td :class="['px-2 py-1']">
                {{ comparison.candidate.itemLevel }}
              </td>
              <td :class="['px-2 py-1']">
                {{ comparison.current && comparison.current.itemID ? amount(comparison.candidate.itemLevel - comparison.current.itemLevel) : tn('unknown') }}
              </td>
            </tr>
            <tr v-for="stat in stats" :key="stat.key">
              <th scope="row" :class="['break-words px-2 py-1 font-medium']">
                {{ statLabel(stat.key) }}
              </th>
              <td :class="['px-2 py-1 tabular-nums']">
                {{ amount(stat.previous) }}
              </td>
              <td :class="['px-2 py-1 tabular-nums']">
                {{ amount(stat.next) }}
              </td>
              <td :class="['px-2 py-1 tabular-nums']">
                <template v-if="stat.next !== null && stat.previous !== null">
                  {{ stat.next > stat.previous ? '+' : '' }}{{ amount(stat.next - stat.previous) }}
                </template>
                <template v-else>
                  {{ tn('unknown') }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('limitation') }}
      </p>
    </template>
  </section>
</template>

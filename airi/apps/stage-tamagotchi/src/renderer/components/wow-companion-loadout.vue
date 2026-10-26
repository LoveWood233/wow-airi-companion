<script setup lang="ts">
import type { GameVersion, Snapshot } from '../../shared/wow-companion'
import type { EquipmentLoadoutsState } from '../../shared/wow-companion-loadout'

import { Button, Collapsible, SettingsCard } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ game: GameVersion, history: EquipmentLoadoutsState, current: Snapshot | null, error: string | null }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.loadout.${key}`)
const selectedKey = ref('')
const entries = computed(() => [...props.history.entries].sort((a, b) => b.receivedAt - a.receivedAt))
const currentKey = computed(() => props.current ? JSON.stringify([props.current.account, props.current.guid]) : '')
const selected = computed(() => selectedKey.value ? entries.value.find(entry => JSON.stringify([entry.account, entry.loadout.guid]) === selectedKey.value) : entries.value[0])
const waiting = computed(() => props.current && (!entries.value.some(entry => entry.account === props.current?.account && entry.loadout.guid === props.current.guid && entry.loadout.session === props.current.session)))

watch(currentKey, (key) => {
  if (key)
    selectedKey.value = key
}, { immediate: true })

function statLabel(key: string) {
  const path = `wow-companion.equipment.stats.${key}`
  return te(path) ? t(path) : key
}
</script>

<template>
  <SettingsCard role="region" :aria-label="tn('title')">
    <header>
      <h2 :class="['text-lg font-semibold']">
        {{ tn('title') }}
      </h2>
      <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('description') }}
      </p>
    </header>
    <p v-if="history.storageError" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ history.storageError }}
    </p>
    <p v-if="error" role="status" :class="['break-words text-sm text-amber-700 dark:text-amber-300']">
      {{ error }}
    </p>
    <p v-if="waiting" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
      {{ tn('waiting') }}
    </p>
    <p v-if="!entries.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('empty') }}
    </p>
    <div v-if="entries.length" :class="['flex flex-wrap gap-2']" :aria-label="tn('characters')">
      <Button
        v-for="entry in entries" :key="JSON.stringify([entry.account, entry.loadout.guid])"
        size="sm" :aria-pressed="selected === entry"
        @click="selectedKey = JSON.stringify([entry.account, entry.loadout.guid])"
      >
        {{ entry.name || entry.loadout.guid }} · {{ entry.realm }} · {{ entry.account }}
      </Button>
    </div>
    <div v-if="selected" :class="['flex min-w-0 flex-col gap-3']">
      <p :class="['break-words text-sm']">
        {{ selected.name }} · {{ selected.realm }}
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('received') }} <time :datetime="new Date(selected.receivedAt).toISOString()">{{ new Date(selected.receivedAt).toLocaleString(locale) }}</time>
        · {{ tn('observed') }}
        <time v-if="selected.loadout.observedAt > 0" :datetime="new Date(selected.loadout.observedAt * 1000).toISOString()">{{ new Date(selected.loadout.observedAt * 1000).toLocaleString(locale) }}</time>
        <span v-else>{{ tn('unknown') }}</span>
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('historical') }}
      </p>
      <ol :class="['grid grid-cols-1 gap-2 sm:grid-cols-2']">
        <li v-for="slot in selected.loadout.slots" :key="slot.slot" :class="['min-w-0 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
          <h3 :class="['break-words text-sm font-medium']">
            {{ t(`wow-companion.equipment-swaps.slots.${slot.slot}`) }}
          </h3>
          <template v-if="slot.item">
            <p :class="['mt-1 break-words text-sm']">
              {{ slot.item.name ?? tn('unknown') }} · {{ t('wow-companion.equipment.item-level') }} {{ slot.item.itemLevel ?? tn('unknown') }}
            </p>
            <p :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
              {{ slot.item.type ?? tn('unknown') }} · {{ slot.item.subtype ?? tn('unknown') }}
            </p>
            <p v-if="!slot.item.infoComplete || !slot.item.statsComplete || !slot.item.tooltipComplete || slot.item.truncated" :class="['text-xs text-amber-700 dark:text-amber-300']">
              {{ tn('incomplete') }}
            </p>
            <Collapsible>
              <template #trigger="{ visible, setVisible }">
                <Button size="sm" :aria-expanded="visible" @click="setVisible(!visible)">
                  {{ t(`wow-companion.equipment.${visible ? 'hide-details' : 'show-details'}`) }}
                </Button>
              </template>
              <div :class="['mt-3 flex flex-col gap-3']">
                <dl :class="['text-sm']">
                  <div v-for="stat in slot.item.stats" :key="stat.key" :class="['flex justify-between gap-3']">
                    <dt :class="['break-words']">
                      {{ statLabel(stat.key) }}
                    </dt><dd>{{ stat.value.toLocaleString(locale) }}</dd>
                  </div>
                </dl>
                <ul :class="['max-h-80 overflow-y-auto text-sm']">
                  <li v-for="(line, index) in slot.item.tooltip" :key="index" :class="['whitespace-pre-wrap break-words']">
                    {{ line }}
                  </li>
                </ul>
                <p :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ slot.item.link }}
                </p>
              </div>
            </Collapsible>
          </template>
          <p v-else :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn(slot.state === 'empty' ? 'empty-slot' : 'unknown') }}
          </p>
        </li>
      </ol>
    </div>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('note') }}
    </p>
  </SettingsCard>
</template>

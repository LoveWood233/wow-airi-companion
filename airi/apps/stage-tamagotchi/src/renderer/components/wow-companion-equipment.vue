<script setup lang="ts">
import type { BridgeStatus, GameVersion } from '../../shared/wow-companion'
import type { EquipmentHistoryState } from '../../shared/wow-companion-equipment-history'

import { Button, Collapsible, SettingsCard } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ game: GameVersion, bridge: BridgeStatus | null, history: EquipmentHistoryState }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.equipment.${key}`)
const entries = computed(() => [...props.history.entries].reverse().map(entry => ({
  entry,
  item: entry.record,
  detailsId: `equipment-${props.game}-${encodeURIComponent(JSON.stringify([entry.account, entry.record.guid, entry.record.session, entry.record.id]))}`,
})))

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
      {{ tn('storage-error') }} {{ history.storageError }}
    </p>
    <p v-if="bridge?.equipmentError" role="status" :class="['break-words text-sm text-amber-700 dark:text-amber-300']">
      {{ tn('read-error') }} {{ bridge.equipmentError }}
    </p>
    <p v-if="bridge && bridge.equipment === undefined" :class="['text-sm text-amber-700 dark:text-amber-300']">
      {{ tn('bridge-update') }}
    </p>
    <p v-if="!entries.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('empty') }}
    </p>
    <div :class="['flex flex-col gap-3']">
      <article
        v-for="{ entry, item, detailsId } in entries" :key="detailsId"
        :aria-label="item.name ?? t('wow-companion.equipment.unnamed', { id: item.itemID })"
        :class="['min-w-0 rounded-xl p-4', 'border border-neutral-200 dark:border-neutral-800', 'flex flex-col gap-3']"
      >
        <div>
          <p :class="['mb-2 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('historical') }}
          </p>
          <h3 :class="['break-words font-semibold']">
            {{ item.name ?? t('wow-companion.equipment.unnamed', { id: item.itemID }) }}
          </h3>
          <p :class="['mt-1 break-words text-sm text-neutral-500 dark:text-neutral-400']">
            {{ item.type ?? tn('unavailable') }} · {{ item.subtype ?? tn('unavailable') }}
            · {{ tn('item-level') }} {{ item.itemLevel ?? tn('unavailable') }}
            · ×{{ item.quantity }}
          </p>
          <p :class="['mt-1 break-words text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('character') }} {{ entry.name }} · {{ tn('realm') }} {{ entry.realm }}
          </p>
          <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('received') }}
            <time :datetime="new Date(entry.receivedAt).toISOString()">{{ new Date(entry.receivedAt).toLocaleString(locale) }}</time>
          </p>
          <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('observed') }}
            <time v-if="item.observedAt > 0" :datetime="new Date(item.observedAt * 1000).toISOString()">{{ new Date(item.observedAt * 1000).toLocaleString(locale) }}</time>
            <span v-else>{{ tn('unavailable') }}</span>
          </p>
        </div>
        <ul :class="['flex flex-wrap gap-2 text-xs']" :aria-label="tn('completeness')">
          <li v-for="field in ['infoComplete', 'statsComplete', 'tooltipComplete'] as const" :key="field" :class="['rounded-full px-2 py-1', 'bg-neutral-100 dark:bg-neutral-800']">
            {{ tn(field) }}: {{ tn(item[field] ? 'complete' : 'incomplete') }}
          </li>
          <li v-if="item.truncated" :class="['rounded-full px-2 py-1', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200']">
            {{ tn('truncated') }}
          </li>
        </ul>
        <Collapsible>
          <template #trigger="{ visible, setVisible }">
            <Button
              size="sm" :aria-expanded="visible" :aria-controls="detailsId"
              @click="setVisible(!visible)"
            >
              {{ tn(visible ? 'hide-details' : 'show-details') }}
            </Button>
          </template>
          <div :id="detailsId" :class="['mt-4 flex flex-col gap-4']">
            <dl :class="['grid grid-cols-2 gap-3 text-sm sm:grid-cols-3']">
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn('quality') }}
                </dt>
                <dd>{{ item.quality === null ? tn('unavailable') : tn(`qualities.${item.quality}`) }}</dd>
              </div>
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn('required-level') }}
                </dt>
                <dd>{{ item.requiredLevel ?? tn('unavailable') }}</dd>
              </div>
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn('slot') }}
                </dt>
                <dd :class="['break-all']">
                  {{ item.equipLoc ?? tn('unavailable') }}
                </dd>
              </div>
            </dl>
            <div>
              <h4 :class="['mb-2 text-sm font-medium']">
                {{ tn('attributes') }}
              </h4>
              <dl v-if="item.stats.length" :class="['grid grid-cols-1 gap-2 text-sm sm:grid-cols-2']">
                <div v-for="(stat, index) in item.stats" :key="index" :class="['flex min-w-0 justify-between gap-3']">
                  <dt :class="['break-words']">
                    {{ statLabel(stat.key) }}
                  </dt>
                  <dd :class="['shrink-0 tabular-nums']">
                    {{ stat.value.toLocaleString(locale) }}
                  </dd>
                </div>
              </dl>
              <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn(item.statsComplete ? 'no-stats' : 'unavailable') }}
              </p>
            </div>
            <div>
              <h4 :class="['mb-2 text-sm font-medium']">
                {{ tn('tooltip') }}
              </h4>
              <ul v-if="item.tooltip.length" :class="['max-h-80 overflow-y-auto rounded-lg p-3 text-sm', 'bg-neutral-50 dark:bg-neutral-900', 'flex flex-col gap-1']">
                <li v-for="(line, index) in item.tooltip" :key="index" :class="['whitespace-pre-wrap break-words']">
                  {{ line }}
                </li>
              </ul>
              <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('unavailable') }}
              </p>
            </div>
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('effect-note') }}
            </p>
            <p :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('item-link') }} {{ item.link || tn('unavailable') }}
            </p>
          </div>
        </Collapsible>
      </article>
    </div>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('session-note') }}
    </p>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('history-note') }}
    </p>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('capture-note') }}
    </p>
  </SettingsCard>
</template>

<script setup lang="ts">
import type { GameVersion, Snapshot } from '../../shared/wow-companion'
import type { LevelHistoryCharacter, LevelHistoryState } from '../../shared/wow-companion-level-history'

import { Button, Collapsible, SettingsCard } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ game: GameVersion, history: LevelHistoryState, current: Snapshot | null }>()
const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.level-history.${key}`)
const characters = computed(() => [...props.history.characters]
  .sort((left, right) => Number(isCurrent(right)) - Number(isCurrent(left)) || right.lastSeen - left.lastSeen)
  .map((character) => {
    const complete = character.records.filter(record => record.durationBasis === 'complete' && record.durationMs !== null)
    return {
      character,
      records: [...character.records].reverse(),
      completeCount: complete.length,
      averageMs: complete.length ? complete.reduce((sum, record) => sum + record.durationMs!, 0) / complete.length : null,
      detailsId: `level-history-${props.game}-${encodeURIComponent(JSON.stringify([character.account, character.guid]))}`,
    }
  }))

function isCurrent(character: LevelHistoryCharacter) {
  return props.current?.account === character.account && props.current.guid === character.guid
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  })
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null)
    return tn('unknown-duration')
  const totalSeconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor(totalSeconds % 86400 / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  const values = { days, hours, minutes, seconds }
  if (days > 0)
    return t('wow-companion.level-history.duration-days', values)
  if (hours > 0)
    return t('wow-companion.level-history.duration-hours', values)
  if (minutes > 0)
    return t('wow-companion.level-history.duration-minutes', values)
  return t('wow-companion.level-history.duration-seconds', values)
}
</script>

<template>
  <SettingsCard :aria-label="tn('title')">
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
    <p v-if="!characters.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('empty') }}
    </p>
    <div :class="['flex flex-col gap-3']">
      <article
        v-for="{ character, records, completeCount, averageMs, detailsId } in characters" :key="detailsId"
        :aria-label="`${character.name || character.guid} · ${character.realm} · ${character.account}`"
        :class="['min-w-0 rounded-xl p-4', 'border border-neutral-200 dark:border-neutral-800', 'flex flex-col gap-3']"
      >
        <div>
          <div :class="['flex flex-wrap items-center gap-2']">
            <h3 :class="['break-words font-semibold']">
              {{ character.name || character.guid }} · {{ character.realm }}
            </h3>
            <span v-if="isCurrent(character)" :class="['rounded-full px-2 py-1 text-xs', 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100']">
              {{ tn('current-character') }}
            </span>
          </div>
          <p :class="['mt-1 break-all text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('account') }} {{ character.account }}
          </p>
          <p :class="['mt-1 text-sm']">
            {{ t('wow-companion.level-history.current-level', { level: character.currentLevel }) }}
          </p>
        </div>
        <dl :class="['grid grid-cols-1 gap-3 text-sm sm:grid-cols-2']">
          <div>
            <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('complete-count') }}
            </dt>
            <dd :class="['mt-1 font-medium tabular-nums']">
              {{ completeCount }}
            </dd>
          </div>
          <div>
            <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('average') }}
            </dt>
            <dd :class="['mt-1 font-medium tabular-nums']">
              {{ formatDuration(averageMs) }}
            </dd>
          </div>
        </dl>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('first-seen') }} <time :datetime="new Date(character.firstSeen).toISOString()">{{ formatDate(character.firstSeen) }}</time>
        </p>
        <Collapsible>
          <template #trigger="{ visible, setVisible }">
            <Button
              size="sm" :aria-expanded="visible" :aria-controls="detailsId"
              @click="setVisible(!visible)"
            >
              {{ tn(visible ? 'hide-records' : 'show-records') }}
            </Button>
          </template>
          <div :id="detailsId" :class="['mt-3 max-h-96 overflow-auto']">
            <table :class="['min-w-150 w-full text-left text-sm']">
              <caption :class="['mb-2 text-left text-xs text-neutral-500 dark:text-neutral-400']">
                {{ tn('table-description') }}
              </caption>
              <thead :class="['text-neutral-500 dark:text-neutral-400']">
                <tr>
                  <th v-for="column in ['level-change', 'recorded-at', 'duration', 'source-title']" :key="column" scope="col" :class="['whitespace-nowrap px-2 py-2 font-medium']">
                    {{ tn(column) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in records" :key="record.id" :class="['border-t border-neutral-200 dark:border-neutral-800']">
                  <th scope="row" :class="['whitespace-nowrap px-2 py-3 font-medium tabular-nums']">
                    {{ record.fromLevel === null ? record.level : `${record.fromLevel} → ${record.level}` }}
                  </th>
                  <td :class="['whitespace-nowrap px-2 py-3 text-xs tabular-nums']">
                    <time :datetime="new Date(record.recordedAt).toISOString()">{{ formatDate(record.recordedAt) }}</time>
                  </td>
                  <td :class="['px-2 py-3']">
                    <p :class="['whitespace-nowrap tabular-nums']">
                      {{ formatDuration(record.durationMs) }}
                    </p>
                    <p v-if="record.durationBasis === 'partial'" :class="['mt-1 max-w-52 text-xs text-amber-700 dark:text-amber-300']">
                      {{ tn('partial') }}
                    </p>
                  </td>
                  <td :class="['min-w-36 px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                    {{ tn(`source.${record.source}`) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Collapsible>
      </article>
    </div>
    <ul :class="['list-disc pl-5 text-xs text-neutral-500 dark:text-neutral-400', 'flex flex-col gap-2']">
      <li>{{ tn('offline-note') }}</li>
      <li>{{ tn('observation-note') }}</li>
      <li>{{ tn('average-note') }}</li>
    </ul>
  </SettingsCard>
</template>

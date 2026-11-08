<script setup lang="ts">
import type { WowQuestResult } from '@proj-airi/stage-shared/wow-knowledge'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

/** Displays a validated recorded result. Opening the local assistant is an explicit navigation, never an automatic source query. */
defineProps<{ report: WowQuestResult }>()
const { t } = useI18n()
const tn = (key: string) => t(`wow-quest-reference.${key}`)
const desktop = isStageTamagotchi()
</script>

<template>
  <section data-testid="wow-quest-card" :aria-label="tn('title')" :class="['min-w-0 flex flex-col gap-3 rounded-xl p-3 text-xs', 'bg-white/80 text-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-100']">
    <header :class="['flex flex-wrap items-center justify-between gap-2']">
      <h3 :class="['m-0 text-sm font-semibold']">
        {{ tn('title') }}
      </h3>
      <span>{{ tn(`games.${report.game}`) }}</span>
    </header>
    <p v-if="report.outcome !== 'ok'" role="status" :class="['m-0']">
      {{ tn(`states.${report.outcome}`) }}
    </p>
    <p v-if="report.notices.some(notice => ['source-partial', 'quest-log-partial'].includes(notice)) || report.entries.some(entry => entry.notices.includes('result-truncated'))" :class="['m-0 text-amber-800 dark:text-amber-200']">
      {{ tn('partial-source') }}
    </p>
    <p :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('limits') }}
    </p>
    <ol v-if="report.entries.length" :class="['m-0 flex list-none flex-col gap-3 p-0']">
      <li v-for="entry in report.entries.slice(0, 5)" :key="entry.id" :class="['min-w-0 flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
        <h4 :class="['m-0 min-w-0 break-words font-semibold']">
          {{ entry.title ?? entry.id }}
        </h4>
        <span>{{ tn(`progress.${entry.progress.status}`) }}</span>
        <span v-if="entry.level !== undefined">{{ tn('level') }}: {{ entry.level }}{{ entry.levelTemporary ? ` · ${tn('temporary')}` : '' }}</span>
        <span v-if="entry.zone" :class="['break-words']">{{ entry.zone }}{{ entry.zoneTemporary ? ` · ${tn('temporary')}` : '' }}</span>
        <ul v-if="entry.risks.length" :class="['m-0 pl-4 text-amber-800 dark:text-amber-200']">
          <li v-for="risk in entry.risks" :key="risk.code">
            {{ tn(`risks.${risk.code}`) }}
          </li>
        </ul>
        <p v-if="entry.starts.some(actor => actor.temporary) || entry.ends.some(actor => actor.temporary) || entry.locations.some(mark => mark.temporary)" :class="['m-0 text-amber-800 dark:text-amber-200']">
          {{ tn('temporary-note') }}
        </p>
        <a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer" :class="['self-start text-primary-700 underline dark:text-primary-300']">{{ tn('open-source') }}</a>
        <RouterLink v-if="desktop" :to="{ path: '/settings/wow-quests', query: { game: report.game, id: entry.id } }" :class="['self-start text-primary-700 underline dark:text-primary-300']">
          {{ tn('open-assistant') }}
        </RouterLink>
      </li>
    </ol>
    <p v-if="report.entries.length > 5 || report.hasMore" :class="['m-0']">
      {{ tn('partial-list') }}
    </p>
    <dl :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]']">
      <template v-for="source in report.sources" :key="source.kind">
        <dt>{{ tn('source') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ source.kind === 'quest-log' ? tn('quest-log') : source.name }}
        </dd>
        <template v-if="source.build">
          <dt>{{ tn('build') }}</dt><dd :class="['m-0 break-words']">
            {{ source.build }}
          </dd>
        </template>
        <template v-if="source.receivedAt || source.observedAt">
          <dt>{{ tn(source.kind === 'quest-log' ? 'observed-at' : 'received-at') }}</dt><dd :class="['m-0 break-words']">
            {{ source.receivedAt ?? source.observedAt }}
          </dd>
        </template>
        <template v-if="source.cache">
          <dt>{{ tn(`cache.${source.cache.status}`) }}</dt><dd :class="['m-0 break-words']">
            {{ source.cache.servedAt }}
          </dd>
          <dt>{{ tn('cache.expires') }}</dt><dd :class="['m-0 break-words']">
            {{ source.cache.expiresAt }}
          </dd>
        </template>
      </template>
    </dl>
  </section>
</template>

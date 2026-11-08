<script setup lang="ts">
import type { RetailDatabaseAnswer } from '@proj-airi/stage-shared/wow-knowledge'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { Button } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

/** Renders one recorded local database query. Expanding fields never queries a model, game, or database. */
defineProps<{ report: RetailDatabaseAnswer }>()
const { t } = useI18n()
const tn = (key: string) => t(`wow-retail.${key}`)
const desktop = isStageTamagotchi()
const expanded = ref(new Set<string>())

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id))
    next.add(id)
  expanded.value = next
}

function recordRoute(id: string) {
  return { path: '/settings/wow-retail-database', query: { id } }
}
</script>

<template>
  <section
    data-testid="wow-retail-card"
    :aria-label="tn('title')"
    :aria-busy="report.status === 'loading'"
    :class="['min-w-0 flex flex-col gap-3 rounded-xl p-3 text-xs', 'bg-white/80 text-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-100']"
  >
    <header :class="['flex flex-wrap items-center justify-between gap-2']">
      <h3 :class="['m-0 flex items-center gap-1.5 text-sm font-semibold']">
        <span :class="['i-solar:database-bold-duotone', 'shrink-0 text-primary-600 dark:text-primary-300']" aria-hidden="true" />
        {{ tn(`operations.${report.operation}`) }}
      </h3>
      <span :class="['rounded-full px-2 py-1 text-[11px]', 'bg-primary-100/70 text-primary-800 dark:bg-primary-950/70 dark:text-primary-200']">{{ tn('game') }}</span>
    </header>
    <p v-if="report.query" :class="['m-0 break-words text-neutral-600 dark:text-neutral-300']">
      {{ tn('query') }}: {{ report.query }}
    </p>
    <p v-if="report.requestedId" :class="['m-0 break-all text-neutral-600 dark:text-neutral-300']">
      {{ tn('record-id') }}: {{ report.requestedId }}
    </p>
    <dl :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]']">
      <dt>{{ tn('source') }}</dt>
      <dd :class="['m-0 min-w-0 break-words']">
        {{ report.source?.name ?? tn('source-unavailable') }}
      </dd>
      <template v-if="report.source">
        <dt>{{ tn('build') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ report.source.build }}
        </dd>
        <dt>{{ tn('locale') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ report.source.locale }}
        </dd>
        <dt>{{ tn('exported-at') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ report.source.exportedAt }}
        </dd>
        <dt>{{ tn('hotfixes') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ tn(report.source.hotfixesApplied ? 'hotfixes-yes' : 'hotfixes-no') }}
        </dd>
        <dt>{{ tn('dataset') }}</dt>
        <dd :class="['m-0 min-w-0 break-all']">
          {{ report.source.datasetId }}
        </dd>
      </template>
      <template v-if="report.receivedAt">
        <dt>{{ tn(report.cache?.status === 'hit' ? 'cache.source-received-at' : 'received-at') }}</dt>
        <dd :class="['m-0 break-words']">
          {{ report.receivedAt }}
        </dd>
      </template>
      <template v-if="report.cache">
        <dt>{{ tn('cache.status') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ tn(`cache.${report.cache.status}`) }}
        </dd>
        <dt>{{ tn('cache.served-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.cache.servedAt }}
        </dd>
        <dt>{{ tn('cache.expires-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.cache.expiresAt }}
        </dd>
      </template>
    </dl>
    <p v-if="report.cache?.status === 'hit'" :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('cache.note') }}
    </p>
    <p
      v-if="report.status !== 'success'"
      :role="report.status === 'error' || report.status === 'invalid' ? 'alert' : 'status'"
      :class="['m-0 rounded-lg p-2 leading-relaxed', 'bg-neutral-100 dark:bg-neutral-800']"
    >
      {{ report.errorCode ? tn(`errors.${report.errorCode}`) : tn(`states.${report.status}`) }}
    </p>
    <ul v-if="report.notices.length" :class="['m-0 flex list-none flex-col gap-1 rounded-lg p-2 leading-relaxed', 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200']">
      <li v-for="notice in report.notices" :key="notice">
        {{ tn(`notices.${notice}`) }}
      </li>
    </ul>
    <dl v-if="report.stats" :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1']">
      <template v-for="(count, kind) in report.stats.counts" :key="kind">
        <dt>{{ tn(`kinds.${kind}`) }}</dt>
        <dd :class="['m-0']">
          {{ count }}
        </dd>
      </template>
    </dl>
    <ol v-if="report.entries.length" :class="['m-0 flex list-none flex-col gap-3 p-0']">
      <li v-for="entry in report.entries" :key="entry.id" :class="['min-w-0 flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
        <span :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">{{ tn(`kinds.${entry.kind}`) }}</span>
        <h4 :class="['m-0 min-w-0 break-words text-sm font-semibold']">
          {{ entry.title }}
        </h4>
        <span :class="['break-all text-[10px] text-neutral-500 dark:text-neutral-400']">{{ entry.id }}</span>
        <RouterLink v-if="desktop" :to="recordRoute(entry.id)" :aria-label="t('wow-retail.open-entry', { title: entry.title })" :class="['self-start text-primary-700 underline underline-offset-2 dark:text-primary-300']">
          {{ tn('open-local') }}
        </RouterLink>
        <dl :class="['m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1']">
          <template v-for="field in expanded.has(entry.id) ? entry.fields : entry.fields.slice(0, 8)" :key="field.key">
            <dt :class="['min-w-0 break-all text-neutral-500 dark:text-neutral-400']">
              {{ field.key }}
            </dt>
            <dd :class="['m-0 min-w-0 whitespace-pre-wrap break-words']">
              {{ field.value === '' ? tn('empty-text') : field.value }}
            </dd>
          </template>
        </dl>
        <Button v-if="entry.fields.length > 8" :aria-expanded="expanded.has(entry.id)" :aria-label="t('wow-retail.toggle-entry', { title: entry.title })" @click="toggle(entry.id)">
          {{ tn(expanded.has(entry.id) ? 'less' : 'more') }}
        </Button>
        <div v-if="entry.links.length" :class="['flex flex-col gap-1']">
          <h5 :class="['m-0 font-medium']">
            {{ tn('related') }}
          </h5>
          <template v-for="link in entry.links" :key="`${link.kind}-${link.id}`">
            <RouterLink v-if="desktop" :to="recordRoute(link.id)" :class="['break-words text-primary-700 underline dark:text-primary-300']">
              {{ link.title ? `${link.title} · ${link.id}` : link.id }}
            </RouterLink>
            <span v-else :class="['break-words']">{{ link.title ? `${link.title} · ${link.id}` : link.id }}</span>
          </template>
        </div>
      </li>
    </ol>
    <p v-if="report.hasMore" role="status" :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ t('wow-retail.page', { count: report.entries.length, offset: report.offset }) }}
    </p>
    <p v-if="report.partial" :class="['m-0 leading-relaxed text-amber-800 dark:text-amber-300']">
      {{ tn('partial') }}
    </p>
    <footer :class="['flex flex-col gap-1 border-t pt-2 text-[11px]', 'border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']">
      <template v-if="report.source">
        <span :class="['font-medium']">{{ tn('tables') }}</span>
        <span v-for="table in report.source.tables" :key="table.name" :class="['break-words']">
          {{ table.name }} · {{ t('wow-retail.table-rows', { count: table.rows }) }} · {{ tn(`table-status.${table.status}`) }}
        </span>
      </template>
      <span>{{ tn('source-note') }}</span>
    </footer>
  </section>
</template>

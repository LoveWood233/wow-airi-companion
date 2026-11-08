<script setup lang="ts">
import type { RetailDatabaseKind } from '@proj-airi/stage-shared/wow-knowledge'

import { retailDatabaseQuerySchema } from '@proj-airi/stage-shared/wow-knowledge'
import { Button, Collapsible, FieldInput, FieldSelect, SettingsCard } from '@proj-airi/ui'
import { safeParse } from 'valibot'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowRetailDatabaseStore } from '../stores/wow-retail-database'

const props = defineProps<{ initialRecordId?: string }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-retail-query.${key}`)
const database = useWowRetailDatabaseStore()
const kinds: RetailDatabaseKind[] = ['item', 'map', 'uimap', 'area', 'spell', 'encounter']
const kindOptions = computed(() => kinds.map(kind => ({ value: kind, label: tn(`kinds.${kind}`) })))
const sourceResult = computed(() => [database.detail, database.results, database.stats].find(result => result?.source))
const source = computed(() => sourceResult.value?.source ?? null)
const receivedAt = computed(() => sourceResult.value?.receivedAt)
const notices = computed(() => [...new Set([...(database.results?.notices ?? []), ...(database.detail?.notices ?? []), ...(database.stats?.notices ?? [])])])
const initialized = ref(false)
let linkedRecord = ''

function message(group: 'notices' | 'errors', code: string) {
  const key = `wow-retail-query.${group}.${code}`
  return te(key) ? t(key) : group === 'errors' ? tn('errors.generic') : code
}

function date(value: string) {
  const parsed = new Date(value)
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(locale.value) : value || tn('source.unknown')
}

async function loadLinkedRecord(id: string | undefined) {
  if (!id || !safeParse(retailDatabaseQuerySchema, { operation: 'fetch', id }).success || !database.status?.configured)
    return
  const key = `${database.status.revision}:${id}`
  if (key === linkedRecord)
    return
  linkedRecord = key
  await database.fetch(id)
}

async function pick() {
  await database.pickDatabase()
  await loadLinkedRecord(props.initialRecordId)
}

async function clear() {
  await database.clearDatabase()
  linkedRecord = ''
}

async function open(id: string) {
  if (safeParse(retailDatabaseQuerySchema, { operation: 'fetch', id }).success)
    await database.fetch(id)
}

onMounted(async () => {
  await database.initialize()
  initialized.value = true
})
watch([initialized, () => props.initialRecordId, () => database.busy, () => database.status?.revision], async ([ready, id, busy]) => {
  if (ready && !busy)
    await loadLinkedRecord(id)
})
</script>

<template>
  <div data-testid="wow-retail-database" :class="['mx-auto max-w-4xl flex flex-col gap-5 pb-12', 'text-neutral-900 dark:text-neutral-100']" :aria-busy="database.busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>

    <SettingsCard role="region" :aria-label="tn('database.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('database.title') }}
      </h2>
      <p v-if="!database.status?.configured" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('database.unconfigured') }}
      </p>
      <template v-else>
        <p v-if="!source" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('database.selected') }}
        </p>
        <dl v-if="database.status.path" :class="['text-sm']">
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('database.local-path') }}
          </dt>
          <dd :class="['mt-1 break-all']" data-testid="retail-database-path">
            {{ database.status.path }}
          </dd>
        </dl>
      </template>
      <div :class="['flex flex-wrap gap-2']">
        <Button :disabled="database.busy" variant="primary" color="primary" @click="pick">
          {{ tn(database.status?.configured ? 'database.replace' : 'database.choose') }}
        </Button>
        <Button :disabled="database.busy || !database.status?.configured" @click="database.inspect()">
          {{ tn('database.inspect') }}
        </Button>
        <Button :disabled="database.busy || !database.status?.configured" @click="clear">
          {{ tn('database.clear') }}
        </Button>
      </div>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('database.note') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('database.readonly') }}
      </p>
    </SettingsCard>

    <p v-if="database.errorCode" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ message('errors', database.errorCode) }}
    </p>

    <SettingsCard role="region" :aria-label="tn('query.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('query.title') }}
      </h2>
      <form :class="['flex flex-col gap-4']" @submit.prevent="database.search()">
        <FieldSelect v-model="database.kind" :label="tn('query.kind')" :options="kindOptions" layout="vertical" :disabled="database.busy" />
        <FieldInput :model-value="database.query" :label="tn('query.text')" :placeholder="tn('query.placeholder')" :disabled="database.busy" @update:model-value="database.query = $event ?? ''" />
        <Button type="submit" :loading="database.busy" :disabled="database.busy || !database.status?.configured || !database.query.trim()" variant="primary" color="primary" :class="['self-start']">
          {{ tn('query.search') }}
        </Button>
      </form>
    </SettingsCard>

    <SettingsCard v-if="database.stats?.stats" role="region" :aria-label="tn('stats.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('stats.title') }}
      </h2>
      <dl :class="['grid grid-cols-2 gap-3 sm:grid-cols-3']">
        <div v-for="kind in kinds" :key="kind" :class="['rounded-lg p-3', 'bg-neutral-100 dark:bg-neutral-800']">
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn(`kinds.${kind}`) }}
          </dt>
          <dd :class="['mt-1 text-sm font-medium']">
            {{ t('wow-retail-query.stats.count', { count: database.stats.stats.counts[kind].toLocaleString(locale) }) }}
          </dd>
        </div>
      </dl>
    </SettingsCard>

    <ul v-if="notices.length" :class="['list-disc rounded-lg p-3 pl-7 text-sm leading-relaxed', 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200']" :aria-label="tn('source.title')">
      <li v-for="notice in notices" :key="notice">
        {{ message('notices', notice) }}
      </li>
    </ul>

    <SettingsCard role="region" :aria-label="tn('query.results')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('query.results') }}
      </h2>
      <p v-if="!database.results" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('query.no-search') }}
      </p>
      <p v-else-if="database.results.outcome === 'empty'" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('query.empty') }}
      </p>
      <template v-else-if="database.results.entries.length">
        <ol :class="['flex flex-col gap-3']">
          <li v-for="entry in database.results.entries" :key="entry.id" :class="['min-w-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
            <div :class="['min-w-0 flex flex-1 flex-col gap-1']">
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ tn(`kinds.${entry.kind}`) }} · {{ entry.id }}</span>
              <h3 :class="['break-words text-sm font-medium']">
                {{ entry.title }}
              </h3>
            </div>
            <Button :disabled="database.busy" :aria-label="`${tn('query.open')} · ${entry.title}`" @click="open(entry.id)">
              {{ tn('query.open') }}
            </Button>
          </li>
        </ol>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-retail-query.query.page', { from: database.results.offset + 1, to: database.results.offset + database.results.entries.length }) }}
        </p>
        <p v-if="database.results.hasMore" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('query.partial') }}
        </p>
        <div :class="['flex flex-wrap gap-2']">
          <Button :disabled="database.busy || database.results.offset === 0" @click="database.search(Math.max(0, database.results.offset - database.results.limit))">
            {{ tn('query.previous') }}
          </Button>
          <Button :disabled="database.busy || !database.results.hasMore" @click="database.search(database.results.offset + database.results.limit)">
            {{ tn('query.next') }}
          </Button>
        </div>
      </template>
    </SettingsCard>

    <SettingsCard v-if="database.detail" role="region" :aria-label="tn('detail.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('detail.title') }}
      </h2>
      <p v-if="database.detail.outcome === 'not_found'" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('detail.missing') }}
      </p>
      <article v-for="entry in database.detail.entries" :key="entry.id" :class="['min-w-0 flex flex-col gap-3']" data-testid="retail-database-detail">
        <h3 :class="['break-words text-base font-semibold']">
          {{ entry.title }}
        </h3>
        <p :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn(`kinds.${entry.kind}`) }} · {{ t('wow-retail-query.query.id', { id: entry.id }) }}
        </p>
        <dl v-if="entry.fields.length" :aria-label="tn('detail.fields')" :class="['grid grid-cols-1 gap-3 text-sm sm:grid-cols-2']">
          <div v-for="(field, index) in entry.fields" :key="index" :class="['min-w-0']">
            <dt :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
              {{ field.key }}
            </dt>
            <dd :class="['mt-1 whitespace-pre-wrap break-words']">
              {{ field.value }}
            </dd>
          </div>
        </dl>
        <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('detail.no-fields') }}
        </p>
        <ul v-if="entry.notices.length" :class="['list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          <li v-for="(notice, index) in entry.notices" :key="index">
            {{ message('notices', notice) }}
          </li>
        </ul>
        <div v-if="entry.links.length" :class="['flex flex-col gap-2']">
          <h4 :class="['text-sm font-medium']">
            {{ tn('detail.links') }}
          </h4>
          <Button v-for="link in entry.links" :key="link.id" :disabled="database.busy" :aria-label="t('wow-retail-query.detail.related', { title: link.title ?? link.id })" :class="['self-start text-left']" @click="open(link.id)">
            {{ link.title ?? link.id }} · {{ link.id }}
          </Button>
        </div>
        <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
          {{ tn('source.no-web-link') }}
        </p>
      </article>
    </SettingsCard>

    <SettingsCard v-if="source" role="region" :aria-label="tn('source.title')" data-testid="retail-database-source">
      <h2 :class="['text-lg font-semibold']">
        {{ source.name }}
      </h2>
      <p :class="['text-sm']">
        {{ tn('source.game') }}
      </p>
      <dl :class="['grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm']">
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ tn('source.build') }}
        </dt><dd :class="['min-w-0 break-words']">
          {{ source.build }}
        </dd>
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ tn('source.locale') }}
        </dt><dd :class="['min-w-0 break-words']">
          {{ source.locale }}
        </dd>
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ tn('source.exported') }}
        </dt><dd :class="['min-w-0 break-words']">
          {{ date(source.exportedAt) }}
        </dd>
        <template v-if="receivedAt">
          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            {{ tn(sourceResult?.cache?.status === 'hit' ? 'source.original-received' : 'source.received') }}
          </dt><dd :class="['min-w-0 break-words']">
            {{ date(receivedAt) }}
          </dd>
        </template>
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ tn('source.hotfixes') }}
        </dt><dd :class="['min-w-0 break-words']">
          {{ tn(source.hotfixesApplied ? 'source.hotfixes-applied' : 'source.hotfixes-not-applied') }}
        </dd>
      </dl>
      <template v-if="sourceResult?.cache?.status === 'hit'">
        <p :class="['text-xs text-primary-700 dark:text-primary-300']">
          {{ tn('source.cache-hit') }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-retail-query.source.cache-served', { time: date(sourceResult.cache.servedAt) }) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-retail-query.source.cache-expires', { time: date(sourceResult.cache.expiresAt) }) }}
        </p>
      </template>
      <p v-if="source.tables.some(table => table.encrypted)" :class="['text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
        {{ tn('source.encrypted') }}
      </p>
      <Collapsible v-if="source.tables.length">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" @click="setVisible(!visible)">
            {{ tn('source.tables') }}
          </Button>
        </template>
        <ul :class="['mt-3 max-h-64 overflow-y-auto text-xs leading-relaxed']">
          <li v-for="table in source.tables" :key="table.name" :class="['mb-2 break-words']">
            {{ table.name }} · {{ tn(`source.${table.status}`) }} · {{ t('wow-retail-query.source.rows', { count: table.rows }) }}
          </li>
        </ul>
      </Collapsible>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('source.local-only') }}
      </p>
    </SettingsCard>
  </div>
</template>

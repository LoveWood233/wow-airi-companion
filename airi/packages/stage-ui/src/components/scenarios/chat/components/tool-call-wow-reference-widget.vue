<script setup lang="ts">
import type { WowReferenceAnswer, WowReferenceEntry } from '@proj-airi/stage-shared/wow-knowledge'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { safeWowReferenceUrl } from '@proj-airi/stage-shared/wow-knowledge'
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

/** Shows facts from one database response. Rendering never requests more data or asks a model to fill missing fields. */
const props = defineProps<{ report: WowReferenceAnswer }>()
const { t, te } = useI18n()
const tn = (key: string) => t(`wow-reference.${key}`)
const expanded = ref(new Set<string>())
const supportsPlanning = isStageTamagotchi()
const notices = computed(() => [...new Set(props.report.notices)])
const partial = computed(() => props.report.hasMore || (props.report.total !== undefined && props.report.total > props.report.entries.length))

function label(group: 'fields' | 'sections' | 'notices', key: string) {
  const path = `wow-reference.${group}.${key}`
  return te(path) ? t(path) : tn(`${group}.other`)
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id))
    next.add(id)
  expanded.value = next
}

function canExpand(entry: WowReferenceEntry) {
  return entry.sections.some(section => section.lines.length > 3)
}
</script>

<template>
  <section
    data-testid="wow-reference-card"
    :aria-label="tn('title')"
    :aria-busy="report.status === 'loading'"
    :class="['min-w-0 flex flex-col gap-3 rounded-xl p-3 text-xs', 'bg-white/80 text-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-100']"
  >
    <header :class="['flex flex-wrap items-center justify-between gap-2']">
      <h3 :class="['m-0 flex items-center gap-1.5 text-sm font-semibold']">
        <span :class="['i-solar:book-bookmark-bold-duotone', 'shrink-0 text-primary-600 dark:text-primary-300']" aria-hidden="true" />
        {{ tn(`modes.${report.mode}`) }}
      </h3>
      <span :class="['rounded-full px-2 py-1 text-[11px]', 'bg-primary-100/70 text-primary-800 dark:bg-primary-950/70 dark:text-primary-200']">{{ tn('game') }}</span>
    </header>
    <p v-if="report.query" :class="['m-0 break-words text-neutral-600 dark:text-neutral-300']">
      {{ tn('query') }}: {{ report.query }}
    </p>
    <dl :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]']">
      <dt>{{ tn('build') }}</dt>
      <dd :class="['m-0 min-w-0 break-words']">
        {{ report.build ?? tn('unknown-build') }}
      </dd>
      <template v-if="report.buildCreatedAt">
        <dt>{{ tn('build-created-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.buildCreatedAt }}
        </dd>
      </template>
      <template v-if="report.updatedAt">
        <dt>{{ tn('updated-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.updatedAt }}
        </dd>
      </template>
      <template v-if="report.collectedAt">
        <dt>{{ tn('collected-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.collectedAt }}
        </dd>
      </template>
      <template v-if="report.receivedAt">
        <dt>{{ tn(report.cache?.status === 'hit' ? 'cache.source-received-at' : 'received-at') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
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
      <template v-if="report.realm">
        <dt>{{ tn('realm') }}</dt>
        <dd :class="['m-0 min-w-0 break-words']">
          {{ report.realm }}
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
      {{ tn(`states.${report.status}`) }}
    </p>
    <ul v-if="notices.length" :class="['m-0 flex list-none flex-col gap-1 rounded-lg p-2 leading-relaxed', 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200']">
      <li v-for="notice in notices" :key="notice">
        {{ label('notices', notice) }}
      </li>
    </ul>
    <ol v-if="report.entries.length" :class="['m-0 flex list-none flex-col gap-3 p-0']">
      <li v-for="entry in report.entries" :key="entry.id" :class="['min-w-0 flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
        <div :class="['flex flex-wrap items-center gap-2']">
          <span :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">{{ tn(`kinds.${entry.kind}`) }}</span>
          <span v-if="entry.temporary" :class="['text-[11px] font-medium text-amber-800 dark:text-amber-300']">{{ tn('temporary') }}</span>
          <span v-if="entry.incomplete" :class="['text-[11px] font-medium text-amber-800 dark:text-amber-300']">{{ tn('incomplete') }}</span>
        </div>
        <h4 :class="['m-0 min-w-0 break-words text-sm font-semibold']">
          <a v-if="safeWowReferenceUrl(entry.url)" :href="safeWowReferenceUrl(entry.url)" target="_blank" rel="noopener noreferrer" :class="['text-primary-700 underline underline-offset-2 dark:text-primary-300']">{{ entry.title }}</a>
          <span v-else>{{ entry.title }}</span>
        </h4>
        <span :class="['break-all text-[10px] text-neutral-500 dark:text-neutral-400']">{{ entry.id }}</span>
        <p v-if="entry.summary" :class="['m-0 whitespace-pre-wrap break-words leading-relaxed']">
          {{ entry.summary }}
        </p>
        <dl v-if="entry.fields.length" :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1']">
          <template v-for="(field, index) in entry.fields" :key="`${field.key}-${index}`">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ label('fields', field.key) }}
            </dt>
            <dd :class="['m-0 min-w-0 whitespace-pre-wrap break-words']">
              <span v-if="field.temporary">{{ tn('temporary') }} · </span>{{ field.value }}
            </dd>
          </template>
        </dl>
        <div v-for="(section, index) in entry.sections" :key="`${section.key}-${index}`" :class="['min-w-0 flex flex-col gap-1']">
          <h5 :class="['m-0 font-medium']">
            {{ label('sections', section.key) }}<span v-if="section.temporary" :class="['ml-1 text-amber-800 dark:text-amber-300']">{{ tn('temporary') }}</span>
          </h5>
          <ul :class="['m-0 flex flex-col gap-1 pl-4 leading-relaxed']">
            <li v-for="(line, lineIndex) in expanded.has(entry.id) ? section.lines : section.lines.slice(0, 3)" :key="lineIndex" :class="['min-w-0 whitespace-pre-wrap break-words']">
              {{ line }}
            </li>
          </ul>
        </div>
        <RouterLink v-if="supportsPlanning && entry.kind === 'recipe'" :to="{ path: '/settings/wow-professions', query: { recipe: entry.id } }" :class="['self-start rounded-lg px-3 py-2 text-xs font-medium', 'bg-primary-100 text-primary-800 dark:bg-primary-950 dark:text-primary-200']">
          {{ tn('plan-recipe') }}
        </RouterLink>
        <Button v-if="canExpand(entry)" :aria-expanded="expanded.has(entry.id)" :aria-label="t('wow-reference.expand-entry', { title: entry.title })" @click="toggle(entry.id)">
          {{ tn(expanded.has(entry.id) ? 'less' : 'more') }}
        </Button>
      </li>
    </ol>
    <p v-if="partial" role="status" :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ t(report.total === undefined ? 'wow-reference.partial-unknown' : 'wow-reference.partial', { count: report.entries.length, total: report.total }) }}
    </p>
    <p v-if="report.mode === 'search' && report.status === 'success'" :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('search-help') }}
    </p>
    <footer :class="['flex flex-col gap-1 border-t pt-2 text-[11px]', 'border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']">
      <a v-if="safeWowReferenceUrl(report.sourceUrl)" :href="safeWowReferenceUrl(report.sourceUrl)" target="_blank" rel="noopener noreferrer" :class="['break-words text-primary-700 underline dark:text-primary-300']">{{ report.source }}</a>
      <span v-else>{{ report.source }}</span>
      <span>{{ tn('source-note') }}</span>
    </footer>
  </section>
</template>

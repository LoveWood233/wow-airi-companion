<script setup lang="ts">
import type { WowBuildQuery, WowBuildResult } from '@proj-airi/stage-shared/wow-knowledge'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

/** Displays recorded evidence without requesting more data. The full assistant opens only through an explicit link. */
const props = defineProps<{ report: WowBuildResult, request: WowBuildQuery }>()
const { t, te } = useI18n()
const tn = (key: string) => t(`wow-build-reference.${key}`)
const desktop = isStageTamagotchi()

function nodeRoute(nodeId: number) {
  const request = props.request
  return request.operation === 'talents' || request.operation === 'compare-talents'
    ? { path: '/settings/wow-builds', query: { game: request.game, classId: request.classId, level: request.level, nodeId } }
    : undefined
}

function detailRoute() {
  const request = props.request
  if (request.operation === 'compare-item')
    return { path: '/settings/wow-builds', query: { game: request.game, slot: request.slot, itemId: request.itemId } }
  if (request.operation === 'spell')
    return { path: '/settings/wow-builds', query: { game: request.game, spellId: request.spellId } }
  return { path: '/settings/wow-builds', query: { game: request.game } }
}

function statLabel(key: string) {
  const translated = `wow-companion.equipment.stats.${key}`
  return te(translated) ? t(translated) : key
}
</script>

<template>
  <section data-testid="wow-build-card" :aria-label="tn('title')" :class="['min-w-0 flex flex-col gap-3 rounded-xl p-3 text-xs', 'bg-white/80 text-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-100']">
    <header :class="['flex flex-wrap items-center justify-between gap-2']">
      <h3 :class="['m-0 text-sm font-semibold']">
        {{ tn(`operations.${report.operation}`) }}
      </h3>
      <span>{{ tn(`games.${report.game}`) }}</span>
    </header>
    <p v-if="report.outcome !== 'ok'" role="status" :class="['m-0']">
      {{ tn(`states.${report.outcome}`) }}
    </p>
    <p :class="['m-0 leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('limits') }}
    </p>
    <a v-if="report.referenceUrl" :href="report.referenceUrl" target="_blank" rel="noopener noreferrer" :class="['self-start text-primary-700 underline dark:text-primary-300']">{{ tn('open-source') }}</a>
    <p v-if="report.plan" :class="['m-0 text-amber-800 dark:text-amber-200']">
      {{ tn(`plans.${report.plan.validation}`) }}
    </p>
    <ul v-if="report.plan?.adjustments.length" :class="['m-0 list-disc pl-4 text-amber-800 dark:text-amber-200']">
      <li v-for="(adjustment, index) in report.plan.adjustments" :key="index">
        {{ adjustment }}
      </li>
    </ul>
    <ol v-if="report.nodes.length" :class="['m-0 flex list-none flex-col gap-3 p-0']">
      <li v-for="node in report.nodes.slice(0, 5)" :key="node.nodeId" :class="['min-w-0 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
        <h4 :class="['m-0 break-words font-semibold']">
          {{ node.name ?? `#${node.nodeId}` }}
        </h4>
        <p :class="['mt-1']">
          {{ tn('current-rank') }}: {{ node.currentRank ?? tn('unknown') }}
        </p>
        <p :class="['mt-1']">
          {{ tn('purchased-rank') }}: {{ node.purchasedRank ?? tn('unknown') }}
        </p>
        <p v-if="node.plannedRank !== undefined" :class="['mt-1']">
          {{ tn('planned-rank') }}: {{ node.plannedRank }}
        </p>
        <p v-if="node.delta !== undefined" :class="['mt-1']">
          {{ tn('rank-delta') }}: {{ node.delta > 0 ? '+' : '' }}{{ node.delta }}
        </p>
        <p :class="['mt-1 text-amber-800 dark:text-amber-200']">
          {{ tn(`mapping.${node.mapping}`) }}
        </p>
        <p v-if="node.ranks.find(rank => rank.rank === (node.plannedRank ?? node.currentRank))?.description" :class="['mt-2 whitespace-pre-wrap break-words']">
          <span :class="['block font-medium']">{{ tn(node.plannedRank !== undefined ? 'planned-description' : 'current-description') }}</span>
          {{ node.ranks.find(rank => rank.rank === (node.plannedRank ?? node.currentRank))?.description }}
        </p>
        <RouterLink v-if="desktop && nodeRoute(node.nodeId)" :to="nodeRoute(node.nodeId)!" :class="['mt-2 block text-primary-700 underline dark:text-primary-300']">
          {{ tn('open-node') }}
        </RouterLink>
      </li>
    </ol>
    <p v-if="report.nodes.length > 5" :class="['m-0']">
      {{ tn('partial-nodes') }}
    </p>
    <article v-if="report.spell" :class="['min-w-0 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
      <h4 :class="['m-0 break-words font-semibold']">
        {{ report.spell.name ?? `#${report.spell.spellId}` }}
      </h4>
      <p v-if="report.spell.description" :class="['mt-2 whitespace-pre-wrap break-words']">
        {{ report.spell.description }}
      </p>
      <p v-else :class="['mt-2 text-amber-800 dark:text-amber-200']">
        {{ tn('spell-unresolved') }}
      </p>
      <a v-if="report.spell.url" :href="report.spell.url" target="_blank" rel="noopener noreferrer" :class="['mt-2 block text-primary-700 underline dark:text-primary-300']">{{ tn('open-source') }}</a>
    </article>
    <article v-if="report.item" :class="['min-w-0 flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-700']">
      <h4 :class="['m-0 break-words font-semibold']">
        {{ report.item.candidate.name ?? `#${report.item.candidate.itemId}` }}
      </h4>
      <p :class="['m-0']">
        {{ tn(`slots.${report.item.compatibility}`) }}
      </p>
      <p :class="['m-0 text-amber-800 dark:text-amber-200']">
        {{ tn('item-basis') }}
      </p>
      <div v-if="report.item.differences.length" :class="['overflow-x-auto']">
        <table :class="['w-full border-collapse text-left text-xs']">
          <thead>
            <tr>
              <th :class="['p-1']">
                {{ tn('stat') }}
              </th><th :class="['p-1']">
                {{ tn('observed') }}
              </th><th :class="['p-1']">
                {{ tn('catalog') }}
              </th><th :class="['p-1']">
                {{ tn('delta') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.item.differences.slice(0, 8)" :key="row.key">
              <th :class="['break-words p-1 font-normal']">
                {{ statLabel(row.key) }}
              </th><td :class="['p-1']">
                {{ row.current ?? tn('unknown') }}
              </td><td :class="['p-1']">
                {{ row.candidate ?? tn('unknown') }}
              </td><td :class="['p-1']">
                {{ row.delta === undefined ? tn('unknown') : `${row.delta > 0 ? '+' : ''}${row.delta}` }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else :class="['m-0']">
        {{ tn('stats-unresolved') }}
      </p>
      <p v-if="report.item.notices.some(notice => ['weapon-pair-requires-review', 'two-hand-requires-review'].includes(notice))" :class="['m-0 text-amber-800 dark:text-amber-200']">
        {{ tn('weapon-review') }}
      </p>
      <p v-for="(effect, index) in report.item.candidate.effects.slice(0, 3)" :key="index" :class="['m-0 whitespace-pre-wrap break-words']">
        {{ effect }}
      </p>
      <a v-if="report.item.candidate.url" :href="report.item.candidate.url" target="_blank" rel="noopener noreferrer" :class="['self-start text-primary-700 underline dark:text-primary-300']">{{ tn('open-source') }}</a>
    </article>
    <RouterLink v-if="desktop" :to="detailRoute()" :class="['self-start text-primary-700 underline dark:text-primary-300']">
      {{ tn('open-assistant') }}
    </RouterLink>
    <dl :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]']">
      <template v-for="source in report.sources" :key="source.kind">
        <dt>{{ tn('source') }}</dt><dd :class="['m-0 break-words']">
          {{ source.kind === 'wuxianwow' || source.kind === 'retail-db2' ? source.name : tn(`sources.${source.kind}`) }}
        </dd>
        <template v-if="source.build">
          <dt>{{ tn('build') }}</dt><dd :class="['m-0 break-words']">
            {{ source.build }}
          </dd>
        </template>
        <template v-if="source.receivedAt || source.observedAt">
          <dt>{{ tn(source.observedAt ? 'observed-at' : 'received-at') }}</dt><dd :class="['m-0 break-words']">
            {{ source.receivedAt ?? source.observedAt }}
          </dd>
        </template>
        <template v-if="source.database">
          <dt>{{ tn('exported-at') }}</dt><dd :class="['m-0 break-words']">
            {{ source.database.exportedAt }} · {{ source.database.locale }}
          </dd>
        </template>
        <template v-if="source.cache">
          <dt>{{ tn(`cache.${source.cache.status}`) }}</dt><dd :class="['m-0 break-words']">
            {{ source.cache.servedAt }}
          </dd><dt>{{ tn('cache.expires') }}</dt><dd :class="['m-0 break-words']">
            {{ source.cache.expiresAt }}
          </dd>
        </template>
      </template>
    </dl>
  </section>
</template>

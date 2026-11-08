<script setup lang="ts">
import { readWowBuildQuery, safeWowReferenceUrl } from '@proj-airi/stage-shared/wow-knowledge'
import { Button, Collapsible, FieldInput, FieldSelect, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowBuildsStore } from '../stores/wow-builds'

const props = defineProps<{ initialGame?: string, linkedQuery?: Record<string, unknown> }>()
const builds = useWowBuildsStore()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-builds.${key}`)
const unknown = computed(() => tn('current.unknown-value'))
const planExample = JSON.stringify([{ nodeId: 105958, rank: 3 }])
const games = computed(() => ['forever', 'retail'].map(value => ({ value, label: tn(`games.${value}`) })))
const modes = computed(() => ['talents', 'spell', 'plan', 'gear'].map(value => ({ value, label: tn(`query.${value === 'spell' ? 'spells' : value}`) })))
const slots = computed(() => Array.from({ length: 19 }, (_, index) => ({ value: index + 1, label: tn(`slots.${index + 1}`) })))
const initialized = ref(false)
const candidateNotices = computed(() => [...new Set(builds.result?.item?.candidate.notices ?? [])].filter(notice => !builds.result?.notices.includes(notice)))
const comparisonNotices = computed(() => [...new Set(builds.result?.item?.notices ?? [])].filter(notice => !builds.result?.notices.includes(notice) && !candidateNotices.value.includes(notice)))
let linkedRecord = ''

function number(value: number | string | undefined) {
  return value === undefined || value === '' ? undefined : Number(value)
}

function date(value: string) {
  const parsed = new Date(value)
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(locale.value) : value || unknown.value
}

function boolean(value: boolean | null | undefined) {
  return value === true ? tn('nodes.yes') : value === false ? tn('nodes.no') : unknown.value
}

function message(group: 'notices' | 'errors', code: string) {
  const key = `wow-builds.${group}.${code}`
  return te(key) ? t(key) : group === 'errors' ? tn('errors.generic') : code
}

function stat(key: string) {
  const path = `wow-companion.equipment.stats.${key}`
  return te(path) ? t(path) : key
}

function fieldLabel(key: string) {
  return te(`wow-builds.fields.${key}`) ? tn(`fields.${key}`) : key
}

async function openSpell(spellId: number) {
  const request = readWowBuildQuery({ operation: 'spell', game: builds.game, spellId, ...(builds.lastRequest && 'classId' in builds.lastRequest && builds.lastRequest.classId ? { classId: builds.lastRequest.classId } : {}) })
  if (request)
    await builds.execute(request)
}

async function openNode(nodeId: number) {
  const basis = builds.lastRequest
  const request = readWowBuildQuery({ operation: 'talents', game: builds.game, nodeId, classId: basis && 'classId' in basis ? basis.classId : builds.classId, level: basis && 'level' in basis ? basis.level : builds.level })
  if (request)
    await builds.execute(request)
}

async function loadLinkedRecord() {
  if (!initialized.value || builds.busy || !props.linkedQuery)
    return
  const request = readWowBuildQuery(props.linkedQuery)
  if (!request || request.operation === 'compare-talents')
    return
  const key = JSON.stringify(request)
  if (linkedRecord === key)
    return
  linkedRecord = key
  builds.selectGame(request.game)
  builds.mode = request.operation === 'compare-item' ? 'gear' : request.operation
  if ('classId' in request && request.classId !== undefined)
    builds.editClassId(request.classId)
  if ('level' in request)
    builds.editLevel(request.level)
  if (request.operation === 'talents')
    builds.nodeId = request.nodeId
  if (request.operation === 'spell')
    builds.spellId = request.spellId
  if (request.operation === 'compare-item') {
    builds.itemId = request.itemId
    builds.slot = request.slot
  }
  await builds.execute(request)
}

onMounted(async () => {
  const game = props.initialGame ?? props.linkedQuery?.game
  await builds.initialize(game === 'forever' || game === 'retail' ? game : undefined)
  initialized.value = true
  await loadLinkedRecord()
})
watch([() => props.linkedQuery, () => builds.busy], loadLinkedRecord)
watch(() => props.initialGame, (game) => {
  if (game === 'forever' || game === 'retail')
    builds.selectGame(game)
})
</script>

<template>
  <div data-testid="wow-builds" :class="['mx-auto min-w-0 max-w-4xl flex flex-col gap-5 pb-12', 'text-neutral-900 dark:text-neutral-100']" :aria-busy="builds.busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <FieldSelect :model-value="builds.game" :label="tn('query.game')" :options="games" layout="vertical" @update:model-value="builds.selectGame($event === 'retail' ? 'retail' : 'forever')" />

    <SettingsCard role="region" :aria-label="tn('current.title')" data-testid="wow-builds-current">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('current.title') }}
      </h2>
      <p v-if="!builds.player" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('current.unknown') }}
      </p>
      <p v-else :class="['break-words text-sm font-medium']">
        {{ t('wow-builds.current.character', { name: builds.player.name, realm: builds.player.realm, level: builds.player.level }) }} · {{ builds.player.class }}
      </p>
      <section data-testid="wow-builds-talents" :aria-label="tn('current.talents')" :class="['min-w-0 flex flex-col gap-3']">
        <h3 :class="['text-base font-semibold']">
          {{ tn('current.talents') }}
        </h3>
        <p v-if="!builds.talents" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('current.talents-unknown') }}
        </p>
        <template v-else>
          <p role="status" :class="['text-sm leading-relaxed', builds.talents.status === 'active' ? 'text-neutral-600 dark:text-neutral-300' : 'text-amber-700 dark:text-amber-300']">
            {{ tn(builds.talents.status === 'unknown' ? 'current.status-unknown' : `current.${builds.talents.status}`) }}
          </p>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-builds.current.observed', { time: date(new Date(builds.talents.observedAt * 1000).toISOString()) }) }}
          </p>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-builds.current.build', { build: builds.talents.clientBuild ?? unknown }) }}
          </p>
          <p :class="['text-xs']">
            {{ t('wow-builds.current.class-id', { id: builds.talents.classID ?? unknown }) }} · {{ t('wow-builds.current.specialization', { id: builds.talents.specID ?? unknown }) }}
          </p>
          <p v-if="builds.talents.configName" :class="['break-words text-xs']">
            {{ t('wow-builds.current.config', { name: builds.talents.configName }) }}
          </p>
          <p :class="['text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
            {{ tn('current.selected-scope') }}
          </p>
          <p v-if="!builds.talents.complete || builds.talents.truncated" :class="['text-xs text-amber-700 dark:text-amber-300']">
            {{ tn('current.partial') }}
          </p>
          <p :class="['text-sm']">
            {{ t('wow-builds.current.talent-coverage', { count: builds.talents.nodes.length, zeros: builds.talents.knownZeroNodes.length }) }}
          </p>
          <Collapsible v-for="node in builds.talents.nodes" :key="`${node.treeID}:${node.nodeID}`" :label="`${t('wow-builds.current.node', { id: node.nodeID })} · ${t('wow-builds.current.active-rank', { rank: node.activeRank ?? unknown })}`" :data-testid="`current-talent-${node.nodeID}`">
            <div :class="['mt-2 flex flex-col gap-2 text-sm']">
              <p>{{ t('wow-builds.current.purchased', { rank: node.ranksPurchased ?? unknown }) }} · {{ t('wow-builds.current.max-rank', { rank: node.maxRanks ?? unknown }) }}</p>
              <p>{{ t('wow-builds.nodes.available', { value: boolean(node.isAvailable) }) }} · {{ t('wow-builds.nodes.visible', { value: boolean(node.isVisible) }) }} · {{ t('wow-builds.nodes.edges', { value: boolean(node.meetsEdgeRequirements) }) }}</p>
              <p v-if="!node.entriesComplete || !node.conditionsComplete" :class="['text-xs text-amber-700 dark:text-amber-300']">
                {{ tn('current.partial') }}
              </p>
              <div v-for="entry in node.entries" :key="entry.entryID" :class="['flex flex-wrap items-center gap-2']">
                <span>{{ t('wow-builds.current.entry', { id: entry.entryID }) }} · {{ entry.isActive === true ? tn('current.selected') : entry.isActive === false ? tn('current.not-selected') : unknown }}</span>
                <Button v-if="entry.spellID !== null" :disabled="builds.busy" @click="openSpell(entry.spellID)">
                  {{ t('wow-builds.nodes.spell', { id: entry.spellID }) }}
                </Button>
              </div>
              <ul :class="['flex flex-col gap-1 text-xs']">
                <li v-for="condition in node.conditions" :key="condition.conditionID">
                  {{ t('wow-builds.nodes.condition', { id: condition.conditionID }) }} · {{ condition.isMet === true ? tn('nodes.met') : condition.isMet === false ? tn('nodes.unmet') : unknown }}<span v-if="condition.playerLevel !== null"> · {{ t('wow-builds.nodes.condition-level', { level: condition.playerLevel }) }}</span><span v-if="condition.spentAmountRequired !== null"> · {{ t('wow-builds.nodes.condition-spent', { count: condition.spentAmountRequired }) }}</span>
                </li>
              </ul>
            </div>
          </Collapsible>
          <Collapsible v-if="builds.talents.knownZeroNodes.length" :label="tn('current.zeros')">
            <p :class="['break-words text-xs']">
              {{ builds.talents.knownZeroNodes.map(node => node.nodeID).join(', ') }}
            </p>
          </Collapsible>
        </template>
      </section>
      <h3 :class="['text-base font-semibold']">
        {{ tn('current.equipment') }}
      </h3>
      <p v-if="!builds.loadout" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
        {{ tn('current.equipment-unknown') }}
      </p>
      <template v-else>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-builds.current.observed', { time: date(builds.loadout.observedAt) }) }}
        </p>
        <ol :class="['grid min-w-0 gap-2 sm:grid-cols-2']">
          <li v-for="equipped in builds.loadout.slots" :key="equipped.slot" :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']" :data-testid="`build-slot-${equipped.slot}`">
            <h4 :class="['text-sm font-semibold']">
              {{ tn(`slots.${equipped.slot}`) }}
            </h4>
            <p v-if="!equipped.item" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn(equipped.state === 'empty' ? 'current.empty-slot' : 'current.unknown-slot') }}
            </p>
            <template v-else>
              <p :class="['mt-1 break-words text-sm']">
                {{ equipped.item.name ?? t('wow-builds.current.item', { id: equipped.item.itemID }) }}
              </p>
              <p :class="['mt-1 text-xs']">
                {{ t('wow-builds.current.item-level', { level: equipped.item.itemLevel ?? unknown }) }} · {{ t('wow-builds.current.required-level', { level: equipped.item.requiredLevel ?? unknown }) }}
              </p>
              <p v-if="!equipped.item.infoComplete || !equipped.item.statsComplete || !equipped.item.tooltipComplete || equipped.item.truncated" :class="['mt-1 text-xs text-amber-700 dark:text-amber-300']">
                {{ tn('current.incomplete') }}
              </p>
              <Collapsible :label="tn('current.details')" :class="['mt-2']">
                <dl :class="['mt-2 text-xs']">
                  <div v-for="attribute in equipped.item.stats" :key="attribute.key" :class="['flex justify-between gap-2']">
                    <dt :class="['break-words']">
                      {{ stat(attribute.key) }}
                    </dt><dd>{{ attribute.value.toLocaleString(locale) }}</dd>
                  </div>
                </dl>
                <ul :class="['mt-2 flex flex-col gap-1 text-xs']">
                  <li v-for="(line, index) in equipped.item.tooltip" :key="index" :class="['whitespace-pre-wrap break-words']">
                    {{ line }}
                  </li>
                </ul>
                <p :class="['mt-2 break-all text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ equipped.item.link }}
                </p>
              </Collapsible>
            </template>
          </li>
        </ol>
        <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
          {{ tn('current.historical') }}
        </p>
      </template>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('query.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('query.title') }}
      </h2>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('query.description') }}
      </p>
      <form :class="['min-w-0 flex flex-col gap-4']" @submit.prevent="builds.submit()">
        <FieldSelect v-model="builds.mode" :label="tn('query.title')" :options="modes" layout="vertical" :disabled="builds.busy" />
        <div v-if="builds.mode !== 'gear'" :class="['grid gap-4 sm:grid-cols-2']">
          <FieldInput :model-value="builds.classId" type="number" :label="tn('query.class-id')" :disabled="builds.busy" @update:model-value="builds.editClassId(number($event))" />
          <FieldInput v-if="builds.mode !== 'spell'" :model-value="builds.level" type="number" :label="tn('query.level')" :disabled="builds.busy" @update:model-value="builds.editLevel(number($event))" />
        </div>
        <FieldInput v-if="builds.mode === 'talents'" :model-value="builds.nodeId" type="number" :label="tn('query.node')" :disabled="builds.busy" @update:model-value="builds.nodeId = number($event)" />
        <FieldInput v-if="builds.mode === 'spell'" :model-value="builds.spellId" type="number" :label="tn('query.spell')" :disabled="builds.busy" @update:model-value="builds.spellId = number($event)" />
        <FieldInput v-if="builds.mode === 'plan'" v-model="builds.planText" :single-line="false" :label="tn('query.paste')" :description="t('wow-builds.query.plan-help', { example: planExample })" :disabled="builds.busy" />
        <template v-if="builds.mode === 'gear'">
          <FieldSelect v-model="builds.slot" :label="tn('query.slot')" :options="slots" layout="vertical" :disabled="builds.busy" />
          <FieldInput :model-value="builds.itemId" type="number" :label="tn('query.item')" :disabled="builds.busy" @update:model-value="builds.itemId = number($event)" />
        </template>
        <div :class="['flex flex-wrap gap-2']">
          <Button v-if="builds.mode !== 'gear'" :disabled="builds.busy || !builds.player" @click="builds.useCurrentConditions()">
            {{ tn('query.use-player') }}
          </Button>
          <Button type="submit" :disabled="builds.busy" :loading="builds.busy" variant="primary" color="primary">
            {{ tn(`query.${builds.mode === 'plan' ? 'compare-plan' : builds.mode === 'gear' ? 'compare-gear' : builds.mode === 'talents' ? 'search' : 'submit'}`) }}
          </Button>
        </div>
      </form>
    </SettingsCard>
    <p v-if="builds.errorCode" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ message('errors', builds.errorCode) }}
    </p>

    <SettingsCard role="region" :aria-label="tn('query.results')" data-testid="wow-builds-result">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('query.results') }}
      </h2>
      <p v-if="!builds.result" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('query.no-query') }}
      </p>
      <template v-else>
        <p v-if="builds.resultStale" role="status" :class="['text-sm leading-relaxed text-amber-700 dark:text-amber-300']">
          {{ tn('query.stale') }}
        </p>
        <p v-if="builds.result.outcome !== 'ok'" role="status" :class="['text-sm']">
          {{ tn(`query.${builds.result.outcome === 'unsupported' ? 'unsupported' : builds.result.outcome === 'empty' ? 'empty' : 'unavailable'}`) }}
        </p>
        <ul v-if="builds.result.notices.length" :class="['list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          <li v-for="notice in builds.result.notices" :key="notice">
            {{ message('notices', notice) }}
          </li>
        </ul>
        <a v-if="safeWowReferenceUrl(builds.result.referenceUrl)" :href="safeWowReferenceUrl(builds.result.referenceUrl)" target="_blank" rel="noopener noreferrer" :class="['text-sm text-primary-600 underline dark:text-primary-400']">{{ tn('query.open-source') }}</a>
        <section v-if="builds.result.plan" :aria-label="tn('plan.title')" :class="['min-w-0 flex flex-col gap-2']">
          <h3 :class="['text-base font-semibold']">
            {{ tn('plan.title') }}
          </h3>
          <p :class="['text-sm leading-relaxed']">
            {{ tn(`plan.${builds.result.plan.validation}`) }}
          </p>
          <p v-if="builds.result.plan.total !== undefined" :class="['text-xs']">
            {{ t('wow-builds.plan.total', { count: builds.result.plan.total }) }}
          </p>
          <p v-if="builds.result.plan.cap !== undefined" :class="['text-xs']">
            {{ t('wow-builds.plan.cap', { count: builds.result.plan.cap }) }}
          </p>
          <p v-if="builds.result.plan.remaining !== undefined" :class="['text-xs']">
            {{ t('wow-builds.plan.remaining', { count: builds.result.plan.remaining }) }}
          </p>
          <p v-if="builds.result.plan.normalized" :class="['break-all text-xs']">
            {{ tn('plan.normalized') }}: {{ builds.result.plan.normalized }}
          </p>
          <ul :class="['list-disc pl-5 text-sm']">
            <li v-for="(adjustment, index) in builds.result.plan.adjustments" :key="index" :class="['break-words']">
              {{ message('notices', adjustment) }}
            </li>
          </ul>
        </section>
        <article v-for="node in builds.result.nodes" :key="node.nodeId" :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']" :data-testid="`build-node-${node.nodeId}`">
          <h3 :class="['break-words text-base font-semibold']">
            {{ node.name ?? t('wow-builds.nodes.name-unknown', { id: node.nodeId }) }}
          </h3>
          <p :class="['mt-1 text-xs']">
            {{ t('wow-builds.current.node', { id: node.nodeId }) }}<span v-if="node.group"> · {{ t('wow-builds.nodes.group', { name: node.group }) }}</span>
          </p>
          <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-builds.nodes.mapping', { status: tn(`nodes.${node.mapping}`) }) }}
          </p>
          <dl :class="['mt-3 grid grid-cols-2 gap-2 text-sm']">
            <div v-for="field in [{ key: 'current', value: node.currentRank }, { key: 'purchased', value: node.purchasedRank }, ...(builds.result.operation === 'compare-talents' ? [{ key: 'planned', value: node.plannedRank }, { key: 'delta', value: node.delta }] : []), { key: 'maximum', value: node.maxRank }]" :key="field.key">
              <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ tn(`nodes.${field.key}`) }}
              </dt><dd>{{ field.value ?? unknown }}</dd>
            </div>
          </dl>
          <p v-if="node.gate !== undefined" :class="['mt-2 text-sm']">
            {{ t('wow-builds.nodes.gate', { count: node.gate }) }}
          </p>
          <h4 :class="['mt-3 text-sm font-semibold']">
            {{ tn('nodes.prerequisites') }}
          </h4>
          <p v-if="!node.prerequisites.length" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('nodes.no-prerequisites') }}
          </p>
          <div :class="['mt-2 flex flex-wrap gap-2']">
            <Button v-for="requirement in node.prerequisites" :key="requirement.nodeId" :disabled="builds.busy" :aria-label="t('wow-builds.nodes.node', { id: requirement.nodeId })" @click="openNode(requirement.nodeId)">
              {{ requirement.name ?? requirement.nodeId }}<span v-if="requirement.rank !== undefined"> · {{ requirement.rank }}</span><span v-if="requirement.any"> · {{ tn('nodes.any') }}</span>
            </Button>
          </div>
          <ul :class="['mt-3 flex flex-col gap-2 text-sm']">
            <li v-for="rank in node.ranks" :key="rank.rank" :class="['break-words']">
              {{ t('wow-builds.nodes.rank', { rank: rank.rank }) }} · {{ rank.description ?? unknown }} <Button v-if="rank.spellId !== undefined" :disabled="builds.busy" @click="openSpell(rank.spellId)">
                {{ t('wow-builds.nodes.spell', { id: rank.spellId }) }}
              </Button>
            </li>
          </ul>
          <div v-if="node.activeSpellIds.length" :class="['mt-3 flex flex-wrap items-center gap-2']">
            <span :class="['text-xs']">{{ tn('nodes.active-spells') }}</span><Button v-for="spellId in node.activeSpellIds" :key="spellId" :disabled="builds.busy" @click="openSpell(spellId)">
              {{ t('wow-builds.nodes.spell', { id: spellId }) }}
            </Button>
          </div>
          <Collapsible v-if="node.conditions.length" :label="tn('nodes.conditions')" :class="['mt-3']">
            <ul :class="['mt-2 flex flex-col gap-2 text-xs']">
              <li v-for="condition in node.conditions" :key="condition.conditionId">
                {{ t('wow-builds.nodes.condition', { id: condition.conditionId }) }} · {{ condition.isMet === true ? tn('nodes.met') : condition.isMet === false ? tn('nodes.unmet') : unknown }}<span v-if="condition.playerLevel !== undefined"> · {{ t('wow-builds.nodes.condition-level', { level: condition.playerLevel }) }}</span><span v-if="condition.spentAmountRequired !== undefined"> · {{ t('wow-builds.nodes.condition-spent', { count: condition.spentAmountRequired }) }}</span>
              </li>
            </ul>
          </Collapsible>
          <ul :class="['mt-3 list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
            <li v-for="notice in node.notices" :key="notice">
              {{ message('notices', notice) }}
            </li>
          </ul>
        </article>
        <section v-if="builds.result.spell" :class="['min-w-0 flex flex-col gap-3']" data-testid="wow-build-spell">
          <h3 :class="['text-base font-semibold']">
            <a v-if="safeWowReferenceUrl(builds.result.spell.url)" :href="safeWowReferenceUrl(builds.result.spell.url)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ builds.result.spell.name ?? t('wow-builds.spell.id', { id: builds.result.spell.spellId }) }}</a><span v-else>{{ builds.result.spell.name ?? t('wow-builds.spell.id', { id: builds.result.spell.spellId }) }}</span>
          </h3>
          <p :class="['text-xs']">
            {{ t('wow-builds.spell.id', { id: builds.result.spell.spellId }) }}
          </p>
          <p v-if="builds.result.spell.description" :class="['whitespace-pre-wrap break-words text-sm']">
            {{ builds.result.spell.description }}
          </p>
          <p v-if="builds.result.spell.origin" :class="['text-xs']">
            {{ t('wow-builds.spell.origin', { origin: builds.result.spell.origin }) }}
          </p>
          <dl :class="['flex flex-col gap-2 text-xs']">
            <div v-for="field in builds.result.spell.fields" :key="field.key">
              <dt :class="['break-words font-medium']">
                {{ fieldLabel(field.key) }}
              </dt><dd :class="['whitespace-pre-wrap break-words']">
                {{ field.value }}
              </dd>
            </div>
          </dl>
          <ul :class="['list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
            <li v-for="notice in builds.result.spell.notices" :key="notice">
              {{ message('notices', notice) }}
            </li>
          </ul>
        </section>
        <section v-if="builds.result.item" :class="['min-w-0 flex flex-col gap-3']" data-testid="wow-build-item">
          <h3 :class="['text-base font-semibold']">
            {{ tn('gear.title') }} · {{ tn(`slots.${builds.result.item.slot}`) }}
          </h3>
          <p :class="['text-sm']">
            {{ t('wow-builds.gear.compatibility', { status: tn(`gear.${builds.result.item.compatibility}`) }) }}
          </p>
          <p :class="['text-xs text-amber-700 dark:text-amber-300']">
            {{ t('wow-builds.gear.basis', { status: tn(`gear.${builds.result.item.basis}`) }) }}
          </p>
          <div :class="['grid min-w-0 gap-3 sm:grid-cols-2']">
            <div :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']">
              <h4 :class="['text-sm font-semibold']">
                {{ tn('gear.baseline') }}
              </h4><p :class="['mt-2 break-words text-sm']">
                {{ builds.result.item.baseline?.name ?? tn(builds.result.item.baselineState === 'empty' ? 'current.empty-slot' : 'current.unknown-slot') }}
              </p><p v-if="builds.result.item.baseline" :class="['mt-2 text-xs']">
                {{ t('wow-builds.current.item-level', { level: builds.result.item.baseline.itemLevel ?? unknown }) }}
              </p><Collapsible v-if="builds.result.item.baseline" :label="tn('current.details')" :class="['mt-2']">
                <ul :class="['mt-2 flex flex-col gap-1 text-xs']">
                  <li v-for="(line, index) in builds.result.item.baseline.tooltip" :key="index" :class="['whitespace-pre-wrap break-words']">
                    {{ line }}
                  </li>
                </ul><p :class="['mt-2 break-all text-xs']">
                  {{ builds.result.item.baseline.link }}
                </p>
              </Collapsible>
            </div>
            <div :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']">
              <h4 :class="['text-sm font-semibold']">
                {{ tn('gear.candidate') }}
              </h4><p :class="['mt-2 break-words text-sm']">
                <a v-if="safeWowReferenceUrl(builds.result.item.candidate.url)" :href="safeWowReferenceUrl(builds.result.item.candidate.url)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ builds.result.item.candidate.name ?? t('wow-builds.current.item', { id: builds.result.item.candidate.itemId }) }}</a><span v-else>{{ builds.result.item.candidate.name ?? t('wow-builds.current.item', { id: builds.result.item.candidate.itemId }) }}</span>
              </p><p :class="['mt-2 text-xs']">
                {{ t('wow-builds.current.item-level', { level: builds.result.item.candidate.itemLevel ?? unknown }) }} · {{ t('wow-builds.current.required-level', { level: builds.result.item.candidate.requiredLevel ?? unknown }) }}
              </p><ul :class="['mt-2 list-disc pl-4 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
                <li v-for="notice in candidateNotices" :key="notice">
                  {{ message('notices', notice) }}
                </li>
              </ul>
            </div>
          </div>
          <h4 :class="['text-sm font-semibold']">
            {{ tn('gear.differences') }}
          </h4>
          <p v-if="!builds.result.item.differences.length" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('gear.no-differences') }}
          </p>
          <div v-if="builds.result.item.differences.length" :class="['min-w-0 overflow-x-auto']">
            <table :class="['w-full text-xs']">
              <thead>
                <tr>
                  <th :class="['p-1 text-left']">
                    {{ tn('gear.attribute') }}
                  </th><th :class="['p-1 text-right']">
                    {{ tn('gear.current') }}
                  </th><th :class="['p-1 text-right']">
                    {{ tn('gear.proposed') }}
                  </th><th :class="['p-1 text-right']">
                    {{ tn('gear.delta') }}
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="difference in builds.result.item.differences" :key="difference.key">
                  <th :class="['break-words p-1 text-left font-normal']">
                    {{ stat(difference.key) }}
                  </th><td :class="['p-1 text-right']">
                    {{ difference.current ?? unknown }}
                  </td><td :class="['p-1 text-right']">
                    {{ difference.candidate ?? unknown }}
                  </td><td :class="['p-1 text-right']">
                    {{ difference.delta ?? unknown }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Collapsible v-if="builds.result.item.candidate.effects.length" :label="tn('gear.effects')">
            <ul :class="['mt-2 flex flex-col gap-2 text-sm']">
              <li v-for="(effect, index) in builds.result.item.candidate.effects" :key="index" :class="['whitespace-pre-wrap break-words']">
                {{ effect }}
              </li>
            </ul>
          </Collapsible>
          <Collapsible v-if="builds.result.item.candidate.fields.length" :label="tn('gear.raw-fields')">
            <dl :class="['mt-2 flex flex-col gap-2 text-xs']">
              <div v-for="field in builds.result.item.candidate.fields" :key="field.key">
                <dt :class="['break-words font-medium']">
                  {{ fieldLabel(field.key) }}
                </dt><dd :class="['whitespace-pre-wrap break-words']">
                  {{ field.value }}
                </dd>
              </div>
            </dl>
          </Collapsible>
          <ul :class="['list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
            <li v-for="notice in comparisonNotices" :key="notice">
              {{ message('notices', notice) }}
            </li>
          </ul>
        </section>
        <p :class="['text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          {{ tn('query.no-simulation') }}
        </p>
        <footer v-if="builds.result.sources.length" :class="['flex flex-col gap-3 border-t border-neutral-200 pt-3 text-xs leading-relaxed text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']" :aria-label="tn('source.title')">
          <div v-for="(source, index) in builds.result.sources" :key="`${source.kind}:${index}`" :class="['min-w-0 break-words']">
            <a v-if="safeWowReferenceUrl(source.sourceUrl)" :href="safeWowReferenceUrl(source.sourceUrl)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ source.name }}</a><span v-else>{{ source.name }}</span>
            <p v-if="source.kind !== 'equipment-observation'">
              {{ t('wow-builds.source.build', { build: source.build ?? unknown }) }}
            </p>
            <p v-if="source.receivedAt">
              {{ t('wow-builds.source.received', { time: date(source.receivedAt) }) }}
            </p>
            <p v-if="source.observedAt">
              {{ t('wow-builds.source.observed', { time: date(source.observedAt) }) }}
            </p>
            <template v-if="source.cache?.status === 'hit'">
              <p>{{ tn('source.cache-hit') }}</p><p>{{ t('wow-builds.source.cache-read', { time: date(source.cache.servedAt) }) }}</p><p>{{ t('wow-builds.source.cache-expires', { time: date(source.cache.expiresAt) }) }}</p>
            </template>
            <template v-if="source.database">
              <p>{{ t('wow-builds.source.locale', { locale: source.database.locale }) }}</p><p>{{ t('wow-builds.source.exported', { time: date(source.database.exportedAt) }) }}</p><p v-if="!source.database.hotfixesApplied">
                {{ tn('source.hotfixes') }}
              </p><p v-if="source.database.tables.some(table => table.encrypted)">
                {{ tn('source.encrypted') }}
              </p>
            </template>
          </div>
        </footer>
      </template>
    </SettingsCard>
  </div>
</template>

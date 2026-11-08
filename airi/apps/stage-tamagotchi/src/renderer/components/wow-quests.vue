<script setup lang="ts">
import type { WowQuestFaction, WowQuestLogEntry, WowQuestRisk } from '@proj-airi/stage-shared/wow-knowledge'

import { readWowQuestProgress, readWowQuestQuery, safeWowReferenceUrl } from '@proj-airi/stage-shared/wow-knowledge'
import { Button, Collapsible, FieldCheckbox, FieldInput, FieldSelect, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowChatterSettingsStore } from '../stores/wow-chatter-settings'
import { useWowQuestsStore } from '../stores/wow-quests'

const props = defineProps<{ initialGame?: string, initialQuestId?: string }>()
const quests = useWowQuestsStore()
const chatter = useWowChatterSettingsStore()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-quests.${key}`)
const factions: WowQuestFaction[] = ['Alliance', 'Horde', 'Neutral', 'Unknown']
const factionOptions = computed(() => factions.map(value => ({ value, label: tn(`factions.${value}`) })))
const gameOptions = computed(() => ['forever', 'retail'].map(value => ({ value, label: tn(`games.${value}`) })))
const sections = computed(() => [
  { id: 'results', title: tn('query.results'), result: quests.results, empty: tn('query.no-query') },
  { id: 'detail', title: tn('detail.title'), result: quests.detail, empty: tn('detail.empty') },
])
const initialized = ref(false)
let linkedRecord = ''

function message(group: 'errors' | 'notices', code: string) {
  const key = `wow-quests.${group}.${code}`
  return te(key) ? t(key) : group === 'errors' ? tn('errors.generic') : code
}

function date(value: string) {
  const parsed = new Date(value)
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(locale.value) : value || tn('current.unknown-value')
}

function progress(row: WowQuestLogEntry) {
  return readWowQuestProgress(row.questID, { game: quests.game, guid: quests.snapshot?.guid, session: quests.snapshot?.session, snapshot: quests.snapshot ?? undefined }, quests.game)
}

function risk(value: WowQuestRisk) {
  return t(`wow-quests.risks.${value.code}`, { questLevel: value.questLevel ?? tn('current.unknown-value'), minimumLevel: value.minimumLevel ?? tn('current.unknown-value'), playerLevel: value.playerLevel ?? tn('current.unknown-value') })
}

function updateLevel(value: string | number | undefined) {
  quests.editLevel(value === undefined || value === '' ? undefined : Number(value))
}

async function loadLinkedRecord() {
  const game = props.initialGame
  const id = props.initialQuestId
  if (!initialized.value || quests.busy || (game !== 'forever' && game !== 'retail') || !id || !/^quest:[1-9]\d{0,9}$/.test(id))
    return
  const request = readWowQuestQuery({ operation: 'detail', game, questId: Number(id.slice(6)) })
  if (!request || request.operation !== 'detail')
    return
  const key = `${game}:${id}`
  if (linkedRecord === key)
    return
  linkedRecord = key
  quests.selectGame(game)
  await quests.openDetail(request.questId, 'current')
}

onMounted(async () => {
  await quests.initialize(props.initialGame === 'forever' || props.initialGame === 'retail' ? props.initialGame : undefined)
  initialized.value = true
  await loadLinkedRecord()
})
watch([() => props.initialGame, () => props.initialQuestId, () => quests.busy], loadLinkedRecord)
</script>

<template>
  <div data-testid="wow-quests" :class="['mx-auto min-w-0 max-w-4xl flex flex-col gap-5 pb-12', 'text-neutral-900 dark:text-neutral-100']" :aria-busy="quests.busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <FieldSelect :model-value="quests.game" :label="tn('query.game')" :options="gameOptions" layout="vertical" @update:model-value="quests.selectGame($event === 'retail' ? 'retail' : 'forever')" />

    <SettingsCard role="region" :aria-label="tn('current.title')" data-testid="wow-quests-current">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('current.title') }}
      </h2>
      <p v-if="quests.player" :class="['break-words text-sm font-medium']">
        {{ t('wow-quests.current.character', { name: quests.player.name, realm: quests.player.realm, level: quests.player.level }) }}
      </p>
      <p role="status" :class="['text-sm leading-relaxed', quests.telemetryStatus === 'ready' ? 'text-neutral-600 dark:text-neutral-300' : 'text-amber-700 dark:text-amber-300']">
        {{ tn(`current.${quests.telemetryStatus}`) }}
      </p>
      <template v-if="quests.snapshot">
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-quests.current.observed', { time: date(quests.snapshot.observedAt) }) }}
        </p>
        <p v-if="quests.receivedAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-quests.current.received', { time: date(quests.receivedAt) }) }}
        </p>
        <p :class="['text-sm']">
          {{ t('wow-quests.current.coverage', { count: quests.snapshot.log.entries.length, total: quests.snapshot.log.total ?? tn('current.unknown-value') }) }}
        </p>
        <p v-if="quests.snapshot.log.complete && !quests.snapshot.log.truncated && !quests.snapshot.log.entries.length" :class="['text-sm']">
          {{ tn('current.no-quests') }}
        </p>
        <article v-for="row in quests.snapshot.log.entries" :key="row.questID" :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']" :data-testid="`quest-log-${row.questID}`">
          <h3 :class="['break-words text-sm font-semibold']">
            {{ row.title ?? t('wow-quests.query.unknown-name', { id: row.questID }) }}
          </h3>
          <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-quests.query.quest-id', { id: row.questID }) }} · {{ t('wow-quests.query.level-label', { level: row.level && row.level > 0 ? row.level : tn('current.unknown-value') }) }}
          </p>
          <p v-if="row.header" :class="['mt-1 break-words text-xs']">
            {{ t('wow-quests.query.category-label', { category: row.header }) }}
          </p>
          <p :class="['mt-2 text-sm font-medium']">
            {{ tn(`progress.${progress(row).status}`) }}
          </p>
          <Collapsible :label="tn('current.objectives')" :class="['mt-2']">
            <p v-if="!row.objectivesComplete" :class="['text-xs text-amber-700 dark:text-amber-300']">
              {{ tn('current.objectives-partial') }}
            </p>
            <p v-if="!row.objectives.length" :class="['text-sm']">
              {{ tn('current.no-objectives') }}
            </p>
            <ul :class="['flex flex-col gap-2 text-sm']">
              <li v-for="objective in row.objectives" :key="objective.index" :class="['break-words']">
                <span>{{ objective.text ?? tn('current.unknown-value') }}</span>
                <span v-if="objective.fulfilled !== null && objective.required !== null"> · {{ t('wow-quests.current.objective-count', { fulfilled: objective.fulfilled, required: objective.required }) }}</span>
                <span> · {{ tn(objective.finished === true ? 'current.finished' : objective.finished === false ? 'current.unfinished' : 'current.unknown-value') }}</span>
              </li>
            </ul>
          </Collapsible>
          <Button :disabled="quests.busy" :class="['mt-3']" :aria-label="`${tn('current.detail')} · ${row.title ?? row.questID}`" @click="quests.openDetail(row.questID, 'current')">
            {{ tn('current.detail') }}
          </Button>
        </article>
        <Collapsible :label="tn('current.flags')">
          <p :class="['text-sm leading-relaxed']">
            {{ tn('current.flags-description') }}
          </p>
          <p :class="['mt-2 text-xs']">
            {{ t('wow-quests.current.flags-coverage', { count: quests.snapshot.completion.ids.length, total: quests.snapshot.completion.total ?? tn('current.unknown-value') }) }}
          </p>
          <p v-if="!quests.snapshot.completion.complete || quests.snapshot.completion.truncated" :class="['mt-2 text-xs text-amber-700 dark:text-amber-300']">
            {{ tn('current.flags-partial') }}
          </p>
          <p :class="['mt-2 break-words text-sm']">
            {{ quests.snapshot.completion.ids.length ? quests.snapshot.completion.ids.join(', ') : tn('current.no-flags') }}
          </p>
        </Collapsible>
        <Collapsible :label="tn('current.turnins')">
          <p v-if="!quests.snapshot.completion.turnIns.length" :class="['text-sm']">
            {{ tn('current.no-turnins') }}
          </p>
          <ul :class="['flex flex-col gap-2 text-sm']">
            <li v-for="(turnin, index) in quests.snapshot.completion.turnIns" :key="`${turnin.questID}:${index}`">
              {{ t('wow-quests.current.turnin', { id: turnin.questID, time: date(turnin.observedAt) }) }}
            </li>
          </ul>
        </Collapsible>
      </template>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('query.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('query.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('query.description') }}
      </p>
      <form :class="['min-w-0 flex flex-col gap-4']" @submit.prevent="quests.search()">
        <div :class="['grid min-w-0 gap-4 sm:grid-cols-2']">
          <FieldInput :model-value="quests.level" type="number" :min="1" :max="255" :step="1" :label="tn('query.level')" :disabled="quests.busy" @update:model-value="updateLevel" />
          <FieldSelect :model-value="quests.faction" :label="tn('query.faction')" :options="factionOptions" layout="vertical" :disabled="quests.busy" @update:model-value="quests.editFaction($event as WowQuestFaction)" />
        </div>
        <FieldInput :model-value="quests.zone" :label="tn(quests.game === 'retail' ? 'query.category' : 'query.zone')" :disabled="quests.busy" @update:model-value="quests.editZone($event ?? '')" />
        <p v-if="quests.game === 'retail'" :class="['text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          {{ tn('query.category-note') }}
        </p>
        <FieldInput :model-value="quests.query" :label="tn('query.text')" :disabled="quests.busy" @update:model-value="quests.editQuery($event ?? '')" />
        <div :class="['flex flex-wrap gap-2']">
          <Button :disabled="quests.busy || !quests.player" @click="quests.useCurrentConditions()">
            {{ tn('query.use-player') }}
          </Button>
          <Button type="submit" :disabled="quests.busy" :loading="quests.busy" variant="primary" color="primary">
            {{ tn('query.search') }}
          </Button>
        </div>
      </form>
    </SettingsCard>

    <p v-if="quests.errorCode" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ message('errors', quests.errorCode) }}
    </p>

    <SettingsCard v-for="section in sections" :key="section.id" role="region" :aria-label="section.title" :data-testid="`wow-quests-${section.id}`">
      <h2 :class="['text-lg font-semibold']">
        {{ section.title }}
      </h2>
      <p v-if="!section.result" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ section.empty }}
      </p>
      <template v-else>
        <p v-if="section.result.outcome === 'empty'" role="status" :class="['text-sm']">
          {{ tn('query.empty') }}
        </p>
        <p v-if="section.result.outcome === 'unavailable' || section.result.outcome === 'error'" role="status" :class="['text-sm']">
          {{ tn('query.unavailable') }}
        </p>
        <ul v-if="section.result.notices.length" :class="['list-disc pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          <li v-for="notice in section.result.notices" :key="notice">
            {{ message('notices', notice) }}
          </li>
        </ul>
        <article v-for="entry in section.result.entries" :key="entry.id" :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']" :data-testid="`${section.id}-${entry.id}`">
          <h3 :class="['break-words text-base font-semibold']">
            <a v-if="safeWowReferenceUrl(entry.url)" :href="safeWowReferenceUrl(entry.url)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ entry.title ?? t('wow-quests.query.unknown-name', { id: entry.questId }) }}</a>
            <span v-else>{{ entry.title ?? t('wow-quests.query.unknown-name', { id: entry.questId }) }}</span>
          </h3>
          <div :class="['mt-2 flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
            <p>{{ t('wow-quests.query.quest-id', { id: entry.questId }) }}</p>
            <p v-if="entry.level !== undefined">
              {{ t('wow-quests.query.level-label', { level: entry.level }) }} <span v-if="entry.levelTemporary">({{ tn('query.temporary') }})</span>
            </p>
            <p v-if="entry.minLevel !== undefined">
              {{ t('wow-quests.query.min-level', { level: entry.minLevel }) }} <span v-if="entry.minLevelTemporary">({{ tn('query.temporary') }})</span>
            </p>
            <p v-if="entry.zone">
              {{ t('wow-quests.query.region-label', { zone: entry.zone }) }} <span v-if="entry.zoneTemporary">({{ tn('query.temporary') }})</span>
            </p>
            <p v-if="entry.logCategory">
              {{ t('wow-quests.query.category-label', { category: entry.logCategory }) }}
            </p>
            <p v-if="entry.faction">
              {{ t('wow-quests.query.faction-label', { faction: tn(`factions.${entry.faction}`) }) }} <span v-if="entry.factionTemporary">({{ tn('query.temporary') }})</span>
            </p>
            <p v-if="entry.type">
              {{ t('wow-quests.query.type-label', { type: entry.type }) }}
            </p>
          </div>
          <p :class="['mt-3 text-sm font-medium']">
            {{ tn(`progress.${entry.progress.status}`) }}
          </p>
          <p v-if="entry.progress.observedAt" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-quests.source.observed', { time: date(entry.progress.observedAt) }) }}
          </p>
          <ul v-if="entry.risks.length" :class="['mt-2 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300']">
            <li v-for="(item, index) in entry.risks" :key="index">
              {{ risk(item) }}
            </li>
          </ul>
          <ul v-if="entry.notices.length" :class="['mt-2 list-disc pl-5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
            <li v-for="notice in entry.notices" :key="notice">
              {{ message('notices', notice) }}
            </li>
          </ul>
          <Button v-if="section.id === 'results'" :disabled="quests.busy" :class="['mt-3']" :aria-label="`${tn('query.open')} · ${entry.title ?? entry.questId}`" @click="quests.openDetail(entry.questId)">
            {{ tn('query.open') }}
          </Button>
          <template v-else>
            <p :class="['mt-4 text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
              {{ tn('detail.unverified') }}
            </p>
            <div v-for="actors in [{ key: 'starts', values: entry.starts }, { key: 'ends', values: entry.ends }]" :key="actors.key" :class="['mt-4']">
              <h4 :class="['text-sm font-semibold']">
                {{ tn(`detail.${actors.key}`) }}
              </h4>
              <p v-if="!actors.values.length" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ tn('detail.actors-unknown') }}
              </p>
              <ul :class="['mt-1 flex flex-col gap-1 text-sm']">
                <li v-for="(actor, index) in actors.values" :key="index" :class="['break-words']">
                  {{ actor.name }} · {{ tn(`actors.${actor.kind}`) }}<span v-if="actor.id !== undefined"> · {{ actor.id }}</span><span v-if="actor.temporary"> · {{ tn('query.temporary') }}</span>
                </li>
              </ul>
            </div>
            <h4 :class="['mt-4 text-sm font-semibold']">
              {{ tn('detail.prerequisites') }}
            </h4>
            <ul :class="['mt-1 flex flex-col gap-2 text-sm']">
              <li v-for="(requirement, index) in entry.requirements" :key="index" :class="['break-words']">
                {{ requirement.name ?? requirement.text ?? tn('current.unknown-value') }}
                <span v-if="requirement.objectiveId !== undefined"> · {{ t('wow-quests.detail.objective-id', { id: requirement.objectiveId }) }}</span>
                <span v-if="requirement.itemId !== undefined"> · {{ t('wow-quests.detail.item-id', { id: requirement.itemId }) }}</span>
                <span v-if="requirement.count !== undefined"> · {{ t('wow-quests.detail.count', { count: requirement.count }) }}</span>
                <span v-if="requirement.temporary"> · {{ tn('query.temporary') }}</span>
              </li>
            </ul>
            <Collapsible v-if="entry.conditions.length" :label="tn('detail.conditions')" :class="['mt-3']">
              <dl :class="['flex flex-col gap-2 text-sm']">
                <div v-for="(condition, index) in entry.conditions" :key="index" :class="['break-words']">
                  <dt :class="['font-medium']">
                    {{ te(`wow-quests.conditions.${condition.key}`) ? tn(`conditions.${condition.key}`) : tn('conditions.unknown') }} <span v-if="condition.temporary">· {{ tn('query.temporary') }}</span>
                  </dt><dd>{{ condition.value }}</dd>
                </div>
              </dl>
            </Collapsible>
            <h4 :class="['mt-4 text-sm font-semibold']">
              {{ tn('detail.locations') }}
            </h4>
            <p v-if="!entry.locations.length" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('detail.coordinates-unknown') }}
            </p>
            <ul :class="['mt-1 flex flex-col gap-2 text-sm']">
              <li v-for="(location, index) in entry.locations" :key="index" :class="['break-words']">
                <p :class="['text-xs font-medium']">
                  {{ tn(`locations.${location.kind}`) }}
                </p>
                <p>{{ location.mapName ?? tn('detail.map-unknown') }}<span v-if="location.mapId !== undefined"> · {{ t('wow-quests.detail.map', { id: location.mapId }) }}</span></p>
                <p>{{ location.who ?? location.place ?? location.text ?? '' }}</p>
                <p>{{ location.x !== undefined && location.y !== undefined ? t('wow-quests.detail.coordinates', { x: (location.x * 100).toFixed(2), y: (location.y * 100).toFixed(2) }) : tn('detail.coordinates-unknown') }}<span v-if="location.temporary"> · {{ tn('query.temporary') }}</span></p>
                <p v-if="location.source" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ location.source }}
                </p>
                <a v-if="safeWowReferenceUrl(location.mapUrl)" :href="safeWowReferenceUrl(location.mapUrl)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ location.mapName ?? tn('detail.locations') }}</a>
              </li>
            </ul>
            <p :class="['mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
              {{ tn('detail.coordinate-note') }}
            </p>
            <div v-for="chain in [{ key: 'previous', values: entry.previous }, { key: 'next', values: entry.next ? [entry.next] : [] }, { key: 'chain', values: entry.chain }]" :key="chain.key" :class="['mt-4']">
              <h4 :class="['text-sm font-semibold']">
                {{ tn(`detail.${chain.key}`) }}
              </h4>
              <p v-if="!chain.values.length" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ tn('detail.no-chain') }}
              </p>
              <div :class="['mt-2 flex flex-wrap gap-2']">
                <Button v-for="reference in chain.values" :key="reference.questId" :disabled="quests.busy || reference.current === true" :aria-label="t('wow-quests.detail.chain-open', { title: reference.title ?? reference.questId })" @click="quests.openDetail(reference.questId, 'detail')">
                  {{ reference.title ?? reference.questId }}<span v-if="reference.temporary"> · {{ tn('query.temporary') }}</span>
                </Button>
              </div>
            </div>
            <p v-if="entry.reward" :class="['mt-4 break-words text-sm']">
              {{ tn('detail.reward') }}: {{ entry.reward }}
            </p>
          </template>
        </article>
        <div v-if="section.id === 'results' && section.result.outcome === 'ok'" :class="['flex flex-wrap items-center gap-2']">
          <Button :disabled="quests.busy || section.result.offset === 0" @click="quests.search(Math.max(0, section.result.offset - section.result.limit))">
            {{ tn('query.previous') }}
          </Button>
          <Button :disabled="quests.busy || !section.result.hasMore" @click="quests.search(section.result.offset + section.result.limit)">
            {{ tn('query.next') }}
          </Button>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t('wow-quests.query.page', { count: section.result.entries.length, offset: section.result.offset }) }}</span>
        </div>
        <footer v-if="section.result.sources.length" :class="['flex flex-col gap-3 border-t border-neutral-200 pt-3 text-xs leading-relaxed text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']" :aria-label="tn('source.title')">
          <div v-for="(source, index) in section.result.sources" :key="`${source.kind}:${index}`" :class="['min-w-0 break-words']">
            <a v-if="safeWowReferenceUrl(source.sourceUrl)" :href="safeWowReferenceUrl(source.sourceUrl)" target="_blank" rel="noopener noreferrer" :class="['text-primary-600 underline dark:text-primary-400']">{{ source.name }}</a><span v-else>{{ source.name }}</span>
            <p v-if="source.kind !== 'quest-log'">
              {{ t('wow-quests.source.build', { build: source.build ?? tn('source.unknown-build') }) }}
            </p>
            <p v-if="source.receivedAt">
              {{ t('wow-quests.source.received', { time: date(source.receivedAt) }) }}
            </p>
            <p v-if="source.observedAt">
              {{ t('wow-quests.source.observed', { time: date(source.observedAt) }) }}
            </p>
            <template v-if="source.cache?.status === 'hit'">
              <p>{{ tn('source.cache-hit') }}</p>
              <p>{{ t('wow-quests.source.cache-read', { time: date(source.cache.servedAt) }) }}</p>
              <p>{{ t('wow-quests.source.cache-expires', { time: date(source.cache.expiresAt) }) }}</p>
            </template>
          </div>
        </footer>
      </template>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('reminders.title')" data-testid="wow-quest-reminders">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('reminders.title') }}
      </h2>
      <FieldCheckbox v-model="chatter.questEnabled" :label="tn('reminders.enabled')" :description="tn('reminders.description')" />
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('reminders.constraints') }}
      </p>
    </SettingsCard>
  </div>
</template>

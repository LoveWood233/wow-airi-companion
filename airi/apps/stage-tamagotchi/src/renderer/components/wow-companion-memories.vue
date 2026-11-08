<script setup lang="ts">
import type { CompanionMemoryEntry, CompanionMemoryState } from '../../shared/wow-companion-memory'
import type { useWowCompanionMemoriesStore } from '../stores/wow-companion-memories'

import { errorMessageFrom } from '@moeru/std'
import { Button, DoubleCheckButton, Input, Progress, SettingsCard, Textarea } from '@proj-airi/ui'
import { useNow } from '@vueuse/core'
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { memoryCapacityDefaults, suggestedMemoryGrowthRules } from '../../shared/wow-companion-memory'

type MemoryActions = Pick<ReturnType<typeof useWowCompanionMemoriesStore>, 'refresh' | 'remember' | 'edit' | 'collect' | 'suppress' | 'forget' | 'setLimit'>

const props = defineProps<{
  personaId: string
  personaName: string
  state: CompanionMemoryState | null
  loading: boolean
  error: boolean
  actions: MemoryActions
}>()

const { t, locale } = useI18n()
const key = 'wow-companion.memory'
const now = useNow({ interval: 60_000 })
const inputId = useId()
const editingId = ref<string | null>(null)
const editingText = ref('')
const preferenceText = ref('')
const limitDraft = ref<number>()
const pending = ref(false)
const actionFailed = ref<'' | 'storage' | 'capacity'>('')
let generation = 0
const entries = computed(() => props.state?.relationship.personaId === props.personaId
  ? props.state.entries.filter(entry => entry.personaId === props.personaId).toSorted((left, right) => right.occurredAt - left.occurredAt)
  : [])
const points = computed(() => props.state?.relationship.personaId === props.personaId ? props.state.relationship.points : 0)
const stage = computed(() => props.state?.relationship.personaId === props.personaId ? props.state.relationship.stage : 0)
const maximum = suggestedMemoryGrowthRules.stageThresholds[3]
const disabled = computed(() => pending.value || props.loading)
const capacity = computed(() => props.state?.relationship.personaId === props.personaId ? props.state.capacity : undefined)
const validLimit = computed(() => typeof limitDraft.value === 'number' && Number.isInteger(limitDraft.value)
  && limitDraft.value >= memoryCapacityDefaults.minimum && limitDraft.value <= memoryCapacityDefaults.maximum)
const diary = computed(() => entries.value.filter(entry => entry.source === 'game-live'
  && (entry.fact?.kind === 'level' || entry.fact?.kind === 'location')
  && new Date(entry.occurredAt).toDateString() === now.value.toDateString()))

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))

function fact(entry: CompanionMemoryEntry) {
  if (entry.fact?.kind === 'level') {
    return entry.fact.fromLevel === null
      ? t(`${key}.facts.level-initial`, { level: entry.fact.level })
      : t(`${key}.facts.level`, { from: entry.fact.fromLevel, level: entry.fact.level })
  }
  if (entry.fact?.kind === 'location')
    return t(`${key}.facts.location`, { zone: entry.fact.zone || t(`${key}.facts.unknown-location`) })
  if (entry.fact?.kind === 'equipment')
    return t(`${key}.facts.equipment`, { item: entry.fact.record.name || t(`${key}.facts.unknown-equipment`, { id: entry.fact.record.itemID }) })
  return ''
}

function character(entry: CompanionMemoryEntry) {
  return entry.character
    ? `${entry.characterName || entry.character.guid} · ${t(`${key}.game.${entry.character.game}`)}`
    : t(`${key}.metadata.general`)
}

function canEdit(entry: CompanionMemoryEntry) {
  return entry.fact === null && (entry.source === 'user' || entry.source === 'confirmed-inference') && Boolean(entry.text)
}

async function run(action: () => Promise<unknown>, saved?: () => void) {
  if (disabled.value)
    return
  const current = generation
  pending.value = true
  actionFailed.value = ''
  try {
    await action()
    if (current === generation)
      saved?.()
  }
  catch (cause) {
    if (current === generation)
      actionFailed.value = errorMessageFrom(cause)?.includes('memory-capacity-full') ? 'capacity' : 'storage'
  }
  finally {
    if (current === generation)
      pending.value = false
  }
}

function rememberPreference() {
  const text = preferenceText.value.trim()
  if (!text || capacity.value?.full)
    return
  void run(() => props.actions.remember({ personaId: props.personaId, kind: 'preference', text, source: 'user', collected: false }), () => {
    preferenceText.value = ''
  })
}

function saveLimit() {
  if (!capacity.value || !validLimit.value || typeof limitDraft.value !== 'number')
    return
  const limit = limitDraft.value
  void run(() => props.actions.setLimit({ personaId: props.personaId, limit }))
}

function beginEdit(entry: CompanionMemoryEntry) {
  editingId.value = entry.id
  editingText.value = entry.text
}

function saveEdit(entry: CompanionMemoryEntry) {
  const text = editingText.value.trim()
  if (!text)
    return
  void run(() => props.actions.edit({ personaId: props.personaId, id: entry.id, text }), () => {
    editingId.value = null
  })
}

watch(() => props.personaId, () => {
  generation++
  pending.value = false
  actionFailed.value = ''
  editingId.value = null
  editingText.value = ''
  preferenceText.value = ''
  limitDraft.value = capacity.value?.limit
})
watch(() => capacity.value?.limit, (limit) => {
  limitDraft.value = limit
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <div :class="['mx-auto min-w-0 w-full max-w-3xl', 'flex flex-col gap-4 pb-6']" :aria-busy="disabled">
    <div :class="['flex flex-wrap items-center justify-between gap-3']">
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t(`${key}.card`, { name: personaName }) }}
      </p>
      <Button size="sm" :disabled="disabled" @click="run(() => actions.refresh())">
        {{ t(`${key}.refresh`) }}
      </Button>
    </div>
    <p v-if="loading && !state" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t(`${key}.loading`) }}
    </p>
    <p v-if="error || actionFailed === 'storage' || state?.storageError" role="alert" :class="['rounded-xl p-3 text-sm', 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200']">
      {{ t(`${key}.error`) }}
    </p>
    <p v-if="actionFailed === 'capacity'" role="alert" :class="['rounded-xl p-3 text-sm', 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200']">
      {{ t(`${key}.limits.full`) }}
    </p>

    <SettingsCard>
      <section :aria-label="t(`${key}.relationship.title`)" :class="['flex flex-col gap-3']">
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <h2 :class="['text-lg font-semibold']">
            {{ t(`${key}.relationship.title`) }}
          </h2>
          <span :class="['rounded-full px-3 py-1 text-sm font-medium', 'bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-200']">
            {{ t(`${key}.relationship.stages.${stage}`) }}
          </span>
        </div>
        <p :class="['text-sm tabular-nums']">
          {{ t(`${key}.relationship.points`, { points }) }}
        </p>
        <div role="progressbar" :aria-label="t(`${key}.relationship.title`)" :aria-valuemin="0" :aria-valuemax="maximum" :aria-valuenow="Math.min(points, maximum)" :aria-valuetext="t(`${key}.relationship.progress`, { points, maximum })">
          <Progress :progress="Math.min(100, points / maximum * 100)" />
        </div>
        <ol :class="['grid grid-cols-2 gap-2 text-xs sm:grid-cols-4']">
          <li v-for="(threshold, index) in suggestedMemoryGrowthRules.stageThresholds" :key="index" :class="['rounded-lg px-2 py-2', index <= stage ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400']">
            {{ t(`${key}.relationship.stages.${index}`) }} · {{ threshold }}
          </li>
        </ol>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.relationship.rules`, { level: suggestedMemoryGrowthRules.levelPoints, location: suggestedMemoryGrowthRules.firstLocationPoints, maximum: suggestedMemoryGrowthRules.dailyMaximum }) }}
        </p>
      </section>
    </SettingsCard>

    <SettingsCard v-if="capacity">
      <section :aria-label="t(`${key}.limits.title`)" :class="['flex flex-col gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ t(`${key}.limits.title`) }}
        </h2>
        <p :class="['text-sm tabular-nums']">
          {{ t(`${key}.limits.usage`, { used: capacity.used, limit: capacity.limit }) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.limits.description`) }}
        </p>
        <p v-if="capacity.full" role="status" :class="['rounded-lg p-3 text-sm', 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200']">
          {{ t(`${key}.limits.full`) }}
        </p>
        <form :class="['flex flex-col gap-3']" @submit.prevent="saveLimit">
          <label :for="`${inputId}-limit`" :class="['text-sm font-medium']">{{ t(`${key}.limits.label`) }}</label>
          <Input :id="`${inputId}-limit`" v-model="limitDraft" type="number" :min="memoryCapacityDefaults.minimum" :max="memoryCapacityDefaults.maximum" :step="1" :required="true" :disabled="disabled" :aria-invalid="!validLimit" :aria-describedby="`${inputId}-limit-help`" />
          <p :id="`${inputId}-limit-help`" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t(`${key}.limits.range`) }}
          </p>
          <div>
            <Button type="submit" color="primary" variant="primary" size="sm" :disabled="disabled || !validLimit || limitDraft === capacity.limit">
              {{ t(`${key}.limits.save`) }}
            </Button>
          </div>
        </form>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.limits.retention`) }}
        </p>
      </section>
    </SettingsCard>

    <SettingsCard>
      <section :aria-label="t(`${key}.manual.title`)" :class="['flex flex-col gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ t(`${key}.manual.title`) }}
        </h2>
        <form :class="['flex flex-col gap-3']" @submit.prevent="rememberPreference">
          <label :for="inputId" :class="['text-sm font-medium']">{{ t(`${key}.manual.label`) }}</label>
          <Textarea :id="inputId" v-model="preferenceText" :rows="3" :maxlength="2000" :disabled="disabled" :submit-on-enter="false" :placeholder="t(`${key}.manual.placeholder`)" />
          <div>
            <Button type="submit" color="primary" variant="primary" size="sm" :disabled="disabled || capacity?.full || !preferenceText.trim()">
              {{ t(`${key}.manual.save`) }}
            </Button>
          </div>
        </form>
      </section>
    </SettingsCard>

    <SettingsCard>
      <section :aria-label="t(`${key}.diary.title`)" :class="['flex flex-col gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ t(`${key}.diary.title`) }}
        </h2>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.diary.description`) }}
        </p>
        <ul v-if="diary.length" :class="['flex flex-col gap-2']">
          <li v-for="entry in diary" :key="entry.id" :class="['border-l-2 border-primary-300 pl-3 text-sm dark:border-primary-700']">
            <p>{{ fact(entry) }}</p>
            <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
              {{ character(entry) }} · {{ dateFormatter.format(entry.occurredAt) }}
            </p>
          </li>
        </ul>
        <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.diary.empty`) }}
        </p>
      </section>
    </SettingsCard>

    <SettingsCard>
      <section :aria-label="t(`${key}.title`)" :class="['flex flex-col gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ t(`${key}.title`) }}
        </h2>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.retention`) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.status.suppressed-description`) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.forget.description`) }}
        </p>
        <p v-if="!entries.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ t(`${key}.empty`) }}
        </p>
        <article v-for="entry in entries" :key="entry.id" :data-testid="`memory-entry-${entry.id}`" :class="['flex min-w-0 flex-col gap-3 rounded-xl border p-4', 'border-neutral-200 dark:border-neutral-800']">
          <div :class="['flex flex-wrap items-center gap-2 text-xs']">
            <h3 :class="['font-semibold']">
              {{ t(`${key}.kinds.${entry.kind}`) }}
            </h3>
            <span v-if="entry.collected">{{ t(`${key}.status.collected`) }}</span>
            <span v-if="entry.kind === 'preference'">{{ t(`${key}.status.permanent`) }}</span>
            <span v-if="entry.suppressed" :class="['text-amber-700 dark:text-amber-300']">{{ t(`${key}.status.suppressed`) }}</span>
            <span v-if="entry.expired">{{ t(`${key}.status.expired`) }}</span>
          </div>
          <dl :class="['flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400']">
            <div>
              <dt :class="['inline']">
                {{ t(`${key}.metadata.character`) }}
              </dt><dd :class="['inline break-words']">
                {{ character(entry) }}
              </dd>
            </div>
            <div>
              <dt :class="['inline']">
                {{ t(`${key}.metadata.source`) }}
              </dt><dd :class="['inline']">
                {{ t(`${key}.sources.${entry.source}`) }}
              </dd>
            </div>
            <div>
              <dt :class="['inline']">
                {{ t(`${key}.metadata.time`) }}
              </dt><dd :class="['inline']">
                <time :datetime="new Date(entry.occurredAt).toISOString()">{{ dateFormatter.format(entry.occurredAt) }}</time>
              </dd>
            </div>
          </dl>
          <p v-if="entry.fact" :class="['break-words text-sm font-medium']">
            {{ fact(entry) }}
          </p>
          <form v-if="editingId === entry.id" :class="['flex flex-col gap-2']" @submit.prevent="saveEdit(entry)">
            <label :for="`${inputId}-${entry.id}`" :class="['text-sm']">{{ t(`${key}.edit.label`) }}</label>
            <Textarea :id="`${inputId}-${entry.id}`" v-model="editingText" :rows="3" :maxlength="2000" :disabled="disabled" :submit-on-enter="false" />
            <p v-if="entry.fact" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t(`${key}.edit.immutable`) }}
            </p>
            <div :class="['flex flex-wrap gap-2']">
              <Button type="submit" size="sm" variant="primary" color="primary" :disabled="disabled || !editingText.trim()">
                {{ t(`${key}.actions.save`) }}
              </Button>
              <Button type="button" size="sm" :disabled="disabled" @click="editingId = null">
                {{ t(`${key}.actions.cancel`) }}
              </Button>
            </div>
          </form>
          <p v-else-if="entry.text" :class="['whitespace-pre-wrap break-words text-sm']">
            {{ entry.text }}
          </p>
          <div :class="['flex flex-wrap gap-2']">
            <Button v-if="canEdit(entry) && editingId !== entry.id" size="sm" :disabled="disabled" @click="beginEdit(entry)">
              {{ t(`${key}.actions.edit`) }}
            </Button>
            <Button v-if="entry.kind !== 'preference'" size="sm" :disabled="disabled || (!entry.collected && capacity?.full)" :aria-pressed="entry.collected" @click="run(() => actions.collect({ personaId, id: entry.id, collected: !entry.collected }))">
              {{ t(`${key}.actions.${entry.collected ? 'uncollect' : 'collect'}`) }}
            </Button>
            <Button size="sm" :disabled="disabled" :aria-pressed="entry.suppressed" @click="run(() => actions.suppress({ personaId, id: entry.id, suppressed: !entry.suppressed }))">
              {{ t(`${key}.actions.${entry.suppressed ? 'resume' : 'suppress'}`) }}
            </Button>
            <DoubleCheckButton size="sm" :disabled="disabled" @confirm="run(() => actions.forget({ personaId, id: entry.id }))">
              {{ t(`${key}.actions.forget`) }}
              <template #confirm>
                {{ t(`${key}.actions.confirm-forget`) }}
              </template>
              <template #cancel>
                {{ t(`${key}.actions.cancel`) }}
              </template>
            </DoubleCheckButton>
          </div>
        </article>
      </section>
    </SettingsCard>
  </div>
</template>

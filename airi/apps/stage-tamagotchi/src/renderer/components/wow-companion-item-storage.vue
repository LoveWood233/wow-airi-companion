<script setup lang="ts">
import type { GameVersion } from '../../shared/wow-companion'
import type { ItemStorageQuery, ItemStorageRow, ItemStorageSummary } from '../../shared/wow-companion-item-storage'

import { Button, Collapsible, FieldSelect, Input, SettingsCard } from '@proj-airi/ui'
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowItemStorageStore } from '../stores/wow-companion-item-storage'

const props = defineProps<{ game: GameVersion, summary?: ItemStorageSummary }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.item-storage.${key}`)
const storage = useWowItemStorageStore()
const profile = computed(() => storage.profiles[props.game])
const searchId = useId()
const opened = ref(false)
const selectedCharacter = ref('all')
const scope = ref<'all' | 'bags' | 'bank' | 'account-bank'>('all')
const category = ref<NonNullable<ItemStorageQuery['category']>>('all')
const search = ref('')
const appliedSearch = ref('')
const offset = ref(0)
const pageSize = 50
const characterOptions = computed(() => [
  { value: 'all', label: tn('all-characters') },
  ...(props.summary?.characters.map(character => ({ value: JSON.stringify([character.account, character.guid]), label: `${character.name} · ${character.realm}` })) ?? []),
])
const scopeOptions = computed(() => ['all', 'bags', 'bank', 'account-bank'].map(value => ({ value, label: tn(`scopes.${value}`) })))
const categoryOptions = computed(() => ['all', 'equipment', 'profession', 'profession-product'].map(value => ({ value, label: tn(`categories.${value}`) })))
const selected = computed(() => props.summary?.characters.find(character => JSON.stringify([character.account, character.guid]) === selectedCharacter.value))
const result = computed(() => profile.value.result)
const range = computed(() => ({ start: result.value?.rows.length ? offset.value + 1 : 0, end: offset.value + (result.value?.rows.length ?? 0), total: result.value?.total ?? 0 }))

function load() {
  opened.value = true
  const character = selected.value
  const input: ItemStorageQuery = {
    game: props.game,
    limit: pageSize,
    offset: offset.value,
    ...(character ? { account: character.account, ...(scope.value !== 'account-bank' ? { guid: character.guid } : {}) } : {}),
    ...(scope.value !== 'all' ? { scope: scope.value } : {}),
    category: category.value,
    ...(appliedSearch.value ? { search: appliedSearch.value } : {}),
  }
  void storage.query(input)
}

function submit() {
  offset.value = 0
  appliedSearch.value = search.value.trim()
  load()
}

function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * pageSize)
  load()
}

function date(value: number | null) {
  return value === null ? tn('unknown') : new Date(value).toLocaleString(locale.value)
}

function rowKey(row: ItemStorageRow) {
  return JSON.stringify([row.game, row.account, row.guid, row.scope, row.container, row.slot])
}

function statName(key: string) {
  const name = `wow-companion.equipment.stats.${key}`
  return te(name) ? t(name) : key
}

watch([selectedCharacter, scope, category], () => {
  offset.value = 0
  storage.reset(props.game)
  if (opened.value)
    load()
})
watch(() => props.game, (_game, previous) => {
  storage.reset(previous)
  opened.value = false
  selectedCharacter.value = 'all'
  search.value = ''
  appliedSearch.value = ''
  offset.value = 0
})
onScopeDispose(() => storage.reset(props.game))
</script>

<template>
  <SettingsCard>
    <section :aria-label="tn('title')" :aria-busy="profile.busy" :class="['min-w-0 flex flex-col gap-4']">
      <header>
        <h2 :class="['text-lg font-semibold']">
          {{ tn('title') }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('description') }}
        </p>
      </header>
      <p v-if="summary?.storageError || summary?.transferError || profile.error" role="alert" :class="['text-sm text-red-700 dark:text-red-300']">
        {{ tn('error') }}
      </p>
      <p v-if="!summary?.characters.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('empty') }}
      </p>
      <div v-for="character in summary?.characters" :key="JSON.stringify([character.account, character.guid])" :class="['min-w-0 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700']">
        <h3 :class="['break-words text-sm font-medium']">
          {{ character.name }} · {{ character.realm }}
        </h3>
        <p :class="['mt-1 text-sm']">
          {{ tn('bags') }}: {{ character.bags }} · {{ tn('bank') }}: {{ character.bankObservedAt === null ? tn('unknown') : character.bank }}
        </p>
        <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('scanned') }}: {{ date(character.bankObservedAt) }}
        </p>
        <p v-if="character.incomplete" :class="['mt-1 text-xs text-amber-700 dark:text-amber-300']">
          {{ tn('partial') }}
        </p>
      </div>
      <p v-if="summary" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-companion.item-storage.shared', { count: summary.sharedBankObservedAt === null ? tn('unknown') : summary.sharedBankItems }) }}
      </p>
      <p v-if="summary" :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-companion.item-storage.file', { name: summary.fileName }) }}
      </p>

      <form :class="['flex flex-col gap-3']" @submit.prevent="submit">
        <div :class="['grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3']">
          <FieldSelect v-model="selectedCharacter" layout="vertical" :label="tn('character')" :options="characterOptions" />
          <FieldSelect v-model="scope" layout="vertical" :label="tn('location')" :options="scopeOptions" />
          <FieldSelect v-model="category" layout="vertical" :label="tn('category')" :options="categoryOptions" />
        </div>
        <div :class="['flex flex-col gap-2 sm:flex-row sm:items-end']">
          <div :class="['min-w-0 flex flex-1 flex-col gap-1']">
            <label :for="searchId" :class="['text-sm font-medium']">{{ tn('search') }}</label>
            <Input :id="searchId" v-model="search" :maxlength="120" :placeholder="tn('search-placeholder')" />
          </div>
          <Button type="submit" size="sm" color="primary" variant="primary" :disabled="profile.busy">
            {{ tn(opened ? 'refresh' : 'browse') }}
          </Button>
        </div>
      </form>

      <template v-if="opened">
        <p v-if="profile.busy" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('loading') }}
        </p>
        <p v-else-if="result && !result.rows.length && !profile.error" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('no-results') }}
        </p>
        <ol :class="['flex flex-col gap-3']">
          <li v-for="row in result?.rows" :key="rowKey(row)" data-testid="storage-item" :class="['min-w-0 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700']">
            <div :class="['flex flex-wrap items-start justify-between gap-2']">
              <h3 :class="['min-w-0 break-words text-sm font-semibold']">
                {{ row.item?.name || (row.item ? t('wow-companion.equipment.unnamed', { id: row.item.itemID }) : tn('unknown-item')) }}
              </h3>
              <span :class="['rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800']">{{ tn(`categories.${row.category}`) }}</span>
            </div>
            <p :class="['mt-2 break-words text-sm']">
              {{ t('wow-companion.item-storage.quantity', { count: row.quantity }) }} · {{ tn(`scopes.${row.scope}`) }} · {{ t('wow-companion.item-storage.slot', { container: row.container, slot: row.slot }) }}
            </p>
            <p :class="['mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400']">
              {{ row.scope === 'account-bank' ? tn('shared-owner') : `${row.name} · ${row.realm}` }}
            </p>
            <p v-if="row.item" :class="['mt-1 break-words text-xs']">
              {{ [row.item.type, row.item.subtype].filter(Boolean).join(' · ') }} · {{ t('wow-companion.item-storage.item-level', { level: row.item.itemLevel ?? tn('unknown') }) }}
            </p>
            <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('observed') }}: {{ date(row.observedAt) }}
            </p>
            <p v-if="row.cached || row.uncertain || !row.complete" :class="['mt-2 text-xs text-amber-700 dark:text-amber-300']">
              {{ tn(row.uncertain ? 'uncertain' : 'historical') }}
            </p>
            <p v-if="row.category === 'profession-product'" :class="['mt-2 text-xs text-amber-700 dark:text-amber-300']">
              <strong>{{ tn('crafting-unknown') }}</strong> · {{ tn('crafting-note') }}
            </p>
            <Collapsible v-if="row.item" :class="['mt-2 text-xs']">
              <template #trigger="{ visible, setVisible }">
                <Button size="sm" :aria-expanded="visible" @click="setVisible(!visible)">
                  {{ tn('details') }}
                </Button>
              </template>
              <code :class="['mt-2 block break-all whitespace-pre-wrap text-neutral-500 dark:text-neutral-400']">{{ row.item.link }}</code>
              <dl v-if="row.item.stats.length" :class="['mt-2 grid grid-cols-2 gap-x-3 gap-y-1']">
                <template v-for="stat in row.item.stats" :key="stat.key">
                  <dt>{{ statName(stat.key) }}</dt><dd>{{ stat.value }}</dd>
                </template>
              </dl>
              <p v-for="(line, index) in row.item.tooltip" :key="index" :class="['mt-1 break-words']">
                {{ line }}
              </p>
              <p v-if="row.item.truncated" :class="['mt-2 text-amber-700 dark:text-amber-300']">
                {{ tn('truncated') }}
              </p>
              <p v-else-if="!row.item.infoComplete || !row.item.statsComplete || !row.item.tooltipComplete" :class="['mt-2 text-amber-700 dark:text-amber-300']">
                {{ tn('partial') }}
              </p>
            </Collapsible>
          </li>
        </ol>
        <div v-if="result" :class="['flex flex-wrap items-center justify-between gap-3']">
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-companion.item-storage.page', range) }}
          </p>
          <div :class="['flex gap-2']">
            <Button size="sm" :disabled="profile.busy || offset === 0" @click="page(-1)">
              {{ tn('previous') }}
            </Button>
            <Button size="sm" :disabled="profile.busy || range.end >= range.total" @click="page(1)">
              {{ tn('next') }}
            </Button>
          </div>
        </div>
      </template>
    </section>
  </SettingsCard>
</template>

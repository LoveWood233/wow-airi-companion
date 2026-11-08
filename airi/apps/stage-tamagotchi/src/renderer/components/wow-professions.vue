<script setup lang="ts">
import { safeWowReferenceUrl } from '@proj-airi/stage-shared/wow-knowledge'
import { Button, Collapsible, FieldInput, FieldSelect, SettingsCard } from '@proj-airi/ui'
import { useClipboard } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowProfessionsStore } from '../stores/wow-professions'

const props = defineProps<{ initialRecipeId?: string }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-professions.${key}`)
const planner = useWowProfessionsStore()
const { copy, copied } = useClipboard({ legacy: true })
const copyFailed = ref(false)
const searched = ref(false)
const initialized = ref(false)
const manualItemId = ref<number>()
const manualQuantity = ref<number>()
const manualOptions = computed(() => planner.manualItemOptions.map(item => ({ value: item.itemID, label: `${item.name || t('wow-professions.plan.item-id', { id: item.itemID })} · #${item.itemID}` })))
const routeOptions = computed(() => [
  { value: 'best' as const, label: tn('leveling.best') },
  { value: 'free' as const, label: tn('leveling.free') },
])
const inventoryStatus = computed(() => planner.inventorySummary?.status ?? 'unknown')
const hasMaterials = computed(() => Boolean(planner.plan?.materials.length))
const hasMissing = computed(() => planner.plan?.materials.some(material => material.missing > 0) ?? false)
const copyText = computed(() => {
  if (!planner.plan)
    return ''
  const lines = [tn('plan.title'), tn('game'), '无限图鉴 wuxianwow.com · https://wuxianwow.com/']
  for (const material of planner.plan.materials) {
    lines.push(`${material.name || t('wow-professions.plan.item-id', { id: material.itemId })} (${material.itemId}) · ${tn('plan.required')} ${material.required} · ${tn(material.missingKind === 'exact' ? 'plan.missing' : 'plan.missing-upper-bound')} ${material.missing}`)
  }
  if (planner.plan.materials.some(material => material.missingKind !== 'exact'))
    lines.push(tn('plan.missing-unknown'))
  const sourceUrls = planner.mode === 'leveling' ? [planner.route?.url] : planner.selectedRecipes.map(selection => selection.recipe.url)
  for (const url of sourceUrls) {
    const safeUrl = safeWowReferenceUrl(url)
    if (safeUrl)
      lines.push(safeUrl)
  }
  lines.push(t('wow-professions.source.build', { build: planner.sourceEvidence?.build ?? tn('source.unknown-build') }))
  if (planner.sourceEvidence?.receivedAt)
    lines.push(t('wow-professions.source.received', { time: planner.sourceEvidence.receivedAt }))
  if (planner.sourceEvidence?.cache?.status === 'hit') {
    lines.push(tn('source.cache-hit'))
    lines.push(t('wow-professions.source.cache-served', { time: planner.sourceEvidence.cache.servedAt }))
    lines.push(t('wow-professions.source.cache-expires', { time: planner.sourceEvidence.cache.expiresAt }))
  }
  return lines.join('\n')
})

function time(value: number | string | undefined) {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return value.trim() ? value : tn('plan.unknown')
  const date = new Date(typeof value === 'number' ? value * 1000 : value ?? '')
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale.value) : typeof value === 'string' && value.trim() ? value : tn('plan.unknown')
}

function money(copper: number) {
  return t('wow-professions.budget.money', { gold: Math.floor(copper / 10000), silver: Math.floor(copper / 100) % 100, copper: copper % 100 })
}

function notice(value: string) {
  const key = `wow-professions.notices.${value}`
  return te(key) ? t(key) : value
}

function error(code: string) {
  const key = `wow-professions.errors.${code}`
  return te(key) ? t(key) : tn('errors.generic')
}

function extraQuantity(itemId: number) {
  return planner.manualMaterials.find(item => item.itemID === itemId)?.quantity ?? 0
}

function saveExtra() {
  if (manualItemId.value === undefined || manualQuantity.value === undefined)
    return
  planner.setManualMaterial(manualItemId.value, manualQuantity.value)
}

async function search() {
  searched.value = true
  await planner.searchRecipes()
}

async function copyMaterials() {
  copyFailed.value = false
  try {
    await copy(copyText.value)
  }
  catch {
    copyFailed.value = true
  }
}

onMounted(async () => {
  await planner.initialize()
  initialized.value = true
})

watch([initialized, () => props.initialRecipeId], async ([ready, id]) => {
  if (!ready || !id || !/^recipe:[1-9]\d{0,11}$/.test(id))
    return
  planner.mode = 'recipe'
  await planner.addRecipe(id)
})
</script>

<template>
  <div data-testid="wow-professions" :class="['mx-auto max-w-4xl flex flex-col gap-5 pb-12', 'text-neutral-900 dark:text-neutral-100']" :aria-busy="planner.loading">
    <header :class="['flex flex-col gap-2']">
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('description') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('game-note') }}
      </p>
    </header>

    <div role="group" :aria-label="tn('title')" :class="['flex flex-wrap gap-2']">
      <Button v-for="mode in (['recipe', 'leveling'] as const)" :key="mode" :aria-pressed="planner.mode === mode" :variant="planner.mode === mode ? 'primary' : 'secondary'" :color="planner.mode === mode ? 'primary' : 'neutral'" :disabled="planner.loading" @click="planner.mode = mode">
        {{ tn(`modes.${mode}`) }}
      </Button>
    </div>

    <p v-if="planner.errorCode" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ error(planner.errorCode) }}
    </p>

    <SettingsCard v-if="planner.mode === 'recipe'" role="region" :aria-label="tn('recipe.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('recipe.title') }}
      </h2>
      <form :class="['flex flex-col gap-3']" @submit.prevent="search">
        <FieldInput :model-value="planner.query" :label="tn('recipe.search')" :description="tn('recipe.search-description')" :placeholder="tn('recipe.search-placeholder')" :disabled="planner.loading" @update:model-value="planner.query = $event ?? ''" />
        <Button type="submit" variant="primary" color="primary" :loading="planner.loading" :disabled="!planner.query.trim() || planner.loading" :class="['self-start']">
          {{ tn('recipe.find') }}
        </Button>
      </form>
      <p v-if="searched && !planner.loading && !planner.errorCode && !planner.recipeChoices.length" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('recipe.empty') }}
      </p>
      <ol v-if="planner.recipeChoices.length" :aria-label="tn('recipe.results')" :class="['flex flex-col gap-2']">
        <li v-for="recipe in planner.recipeChoices" :key="recipe.id" :class="['min-w-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
          <div :class="['min-w-0 flex flex-1 flex-col gap-1']">
            <a v-if="safeWowReferenceUrl(recipe.url)" :href="safeWowReferenceUrl(recipe.url)" target="_blank" rel="noopener noreferrer" :class="['break-words text-sm text-primary-700 underline dark:text-primary-300']">{{ recipe.title }}</a>
            <span v-else :class="['break-words text-sm']">{{ recipe.title }}</span>
            <span :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">{{ recipe.id }}</span>
          </div>
          <Button :disabled="planner.loading || planner.selectedRecipes.some(selection => selection.recipe.id === recipe.id)" @click="planner.addRecipe(recipe.id)">
            {{ tn(planner.selectedRecipes.some(selection => selection.recipe.id === recipe.id) ? 'recipe.added' : 'recipe.add') }}
          </Button>
        </li>
      </ol>
      <h3 :class="['text-sm font-semibold']">
        {{ tn('recipe.selected') }}
      </h3>
      <p v-if="!planner.selectedRecipes.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('recipe.none') }}
      </p>
      <ol v-else :class="['flex flex-col gap-3']">
        <li v-for="selection in planner.selectedRecipes" :key="selection.recipe.id" :class="['min-w-0 flex flex-col gap-3 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <h4 :class="['min-w-0 break-words text-sm font-medium']">
              {{ selection.recipe.name }}
            </h4>
            <Button size="sm" :disabled="planner.loading" :aria-label="`${tn('recipe.remove')} · ${selection.recipe.name}`" @click="planner.removeRecipe(selection.recipe.id)">
              {{ tn('recipe.remove') }}
            </Button>
          </div>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ selection.recipe.products.length ? t('wow-professions.recipe.output', { quantity: selection.recipe.products.map(product => `${product.name} × ${product.count}`).join(' · ') }) : tn('recipe.output-unknown') }}
          </p>
          <div role="group" :aria-label="`${tn('recipe.unit')} · ${selection.recipe.name}`" :class="['flex flex-wrap gap-2']">
            <Button v-for="unit in (['crafts', 'products'] as const)" :key="unit" size="sm" :aria-pressed="selection.unit === unit" :disabled="planner.loading || (unit === 'products' && (!selection.recipe.complete || selection.recipe.products.length !== 1 || selection.recipe.products[0]!.count <= 0))" @click="planner.setRecipeUnit(selection.recipe.id, unit)">
              {{ tn(`recipe.${unit}`) }}
            </Button>
          </div>
          <p v-if="!selection.recipe.complete || selection.recipe.products.length !== 1 || selection.recipe.products[0]!.count <= 0" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('recipe.products-unavailable') }}
          </p>
          <FieldInput type="number" :model-value="selection.quantity" :label="`${tn(selection.unit === 'crafts' ? 'recipe.crafts' : 'recipe.products')} · ${selection.recipe.name}`" :disabled="planner.loading" @update:model-value="planner.setRecipeQuantity(selection.recipe.id, $event ?? 0)" />
          <ul v-if="selection.recipe.notices.length" :class="['list-disc pl-4 text-xs text-amber-700 dark:text-amber-300']">
            <li v-for="(value, index) in selection.recipe.notices" :key="index">
              {{ notice(value) }}
            </li>
          </ul>
          <a v-if="safeWowReferenceUrl(selection.recipe.url)" :href="safeWowReferenceUrl(selection.recipe.url)" target="_blank" rel="noopener noreferrer" :class="['self-start break-words text-xs text-primary-700 underline dark:text-primary-300']">{{ tn('plan.source') }} · {{ selection.recipe.name }}</a>
        </li>
      </ol>
    </SettingsCard>

    <SettingsCard v-else role="region" :aria-label="tn('leveling.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('leveling.title') }}
      </h2>
      <form :class="['flex flex-col gap-4']" @submit.prevent="planner.loadRoute()">
        <FieldInput :model-value="planner.profession" :label="tn('leveling.profession')" :description="tn('leveling.profession-description')" :disabled="planner.loading" @update:model-value="planner.profession = $event ?? ''" />
        <div :class="['grid grid-cols-1 gap-4 sm:grid-cols-2']">
          <FieldInput type="number" :model-value="planner.fromSkill" :label="tn('leveling.from')" :description="tn('leveling.range-description')" :disabled="planner.loading" @update:model-value="planner.fromSkill = $event ?? 0" />
          <FieldInput type="number" :model-value="planner.toSkill" :label="tn('leveling.to')" :disabled="planner.loading" @update:model-value="planner.toSkill = $event ?? 0" />
        </div>
        <FieldSelect v-model="planner.routeChoice" :label="tn('leveling.route')" :options="routeOptions" :disabled="planner.loading" layout="vertical" />
        <Button type="submit" variant="primary" color="primary" :loading="planner.loading" :disabled="!planner.profession.trim() || planner.loading" :class="['self-start']">
          {{ tn('leveling.load') }}
        </Button>
      </form>
      <p :class="['text-sm leading-relaxed text-amber-700 dark:text-amber-300']">
        {{ tn('leveling.estimate') }}
      </p>
      <a v-if="safeWowReferenceUrl(planner.route?.url)" :href="safeWowReferenceUrl(planner.route?.url)" target="_blank" rel="noopener noreferrer" :class="['self-start break-words text-xs text-primary-700 underline dark:text-primary-300']">{{ tn('source.open') }}</a>
      <template v-if="planner.route?.training?.length">
        <h3 :class="['text-sm font-semibold']">
          {{ tn('leveling.training') }}
        </h3>
        <ul :class="['list-disc pl-5 text-sm leading-relaxed']">
          <li v-for="(training, index) in planner.route.training" :key="index" :class="['mb-2 break-words']">
            {{ t('wow-professions.leveling.training-at', { skill: training.atSkill, name: training.name }) }}
            <span v-if="training.requiredLevel !== undefined"> · {{ t('wow-professions.leveling.training-level', { level: training.requiredLevel }) }}</span>
            <span v-if="training.levelAssumed" :class="['text-amber-700 dark:text-amber-300']"> · {{ tn('leveling.training-assumed') }}</span>
          </li>
        </ul>
        <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
          {{ tn('leveling.training-note') }}
        </p>
      </template>
      <Collapsible v-if="planner.route?.method?.length">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" @click="setVisible(!visible)">
            {{ tn('source.method') }}
          </Button>
        </template>
        <ul :class="['mt-3 list-disc pl-5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300']">
          <li v-for="(premise, index) in planner.route.method" :key="index" :class="['mb-2 break-words']">
            {{ premise }}
          </li>
        </ul>
      </Collapsible>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('inventory.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('inventory.title') }}
      </h2>
      <p v-if="planner.inventorySummary?.name" :class="['break-words text-sm']">
        {{ t('wow-professions.inventory.character', { name: planner.inventorySummary.name, realm: planner.inventorySummary.realm ?? '' }) }}
      </p>
      <p role="status" data-testid="profession-inventory-status" :class="['text-sm leading-relaxed', inventoryStatus === 'ready' ? 'text-neutral-600 dark:text-neutral-300' : 'text-amber-700 dark:text-amber-300']">
        {{ tn(`inventory.${inventoryStatus}`) }}
      </p>
      <p v-if="planner.inventorySummary?.observedAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-professions.inventory.observed', { time: time(planner.inventorySummary.observedAt) }) }}
      </p>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('inventory.bank-unknown') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('inventory.manual-note') }}
      </p>
      <form v-if="manualOptions.length" :class="['flex flex-col gap-3']" @submit.prevent="saveExtra">
        <FieldSelect v-model="manualItemId" :label="tn('inventory.related-material')" :description="tn('inventory.related-description')" :options="manualOptions" :placeholder="tn('inventory.choose-material')" :disabled="planner.loading" layout="vertical" />
        <FieldInput v-model="manualQuantity" type="number" :label="tn('inventory.new-extra')" :description="tn('inventory.new-extra-description')" :disabled="planner.loading" />
        <Button type="submit" :disabled="planner.loading || manualItemId === undefined || manualQuantity === undefined || manualQuantity < 0" :class="['self-start']">
          {{ tn('inventory.save-extra') }}
        </Button>
      </form>
      <ul v-if="planner.manualMaterials.length" :class="['flex flex-col gap-3']" :aria-label="tn('inventory.saved-extra')">
        <li v-for="material in planner.manualMaterials" :key="material.itemID" :class="['flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
          <FieldInput type="number" :model-value="material.quantity" :label="`${tn('inventory.saved-extra')} · ${material.name}`" :disabled="planner.loading" @update:model-value="planner.setManualMaterial(material.itemID, $event ?? 0)" />
          <Button size="sm" :disabled="planner.loading" :aria-label="`${tn('inventory.remove-extra')} · ${material.name}`" :class="['self-start']" @click="planner.setManualMaterial(material.itemID, 0)">
            {{ tn('inventory.remove-extra') }}
          </Button>
        </li>
      </ul>
      <Button :disabled="planner.loading || !planner.manualMaterials.length" :class="['self-start']" @click="planner.clearManualMaterials()">
        {{ tn('inventory.clear') }}
      </Button>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('plan.title')">
      <div :class="['flex flex-wrap items-center justify-between gap-3']">
        <h2 :class="['text-lg font-semibold']">
          {{ tn('plan.title') }}
        </h2>
        <Button :disabled="!hasMaterials || planner.loading" @click="copyMaterials">
          {{ tn('plan.copy') }}
        </Button>
      </div>
      <p v-if="copied || copyFailed" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
        {{ tn(copyFailed ? 'plan.copy-failed' : 'plan.copied') }}
      </p>
      <pre v-if="copyFailed" tabindex="0" :class="['max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs', 'bg-neutral-100 dark:bg-neutral-800']">{{ copyText }}</pre>
      <p v-if="!planner.plan" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('plan.empty') }}
      </p>
      <template v-else>
        <ul v-if="planner.plan.notices.length" :class="['list-disc rounded-lg p-3 pl-7 text-xs leading-relaxed', 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200']">
          <li v-for="(value, index) in planner.plan.notices" :key="index">
            {{ notice(value) }}
          </li>
        </ul>
        <p v-if="planner.plan.materials.some(material => material.missingKind !== 'exact')" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('plan.missing-unknown') }}
        </p>
        <p v-else-if="planner.plan.status === 'ready' && !hasMissing" :class="['text-sm text-primary-700 dark:text-primary-300']">
          {{ tn('plan.no-missing') }}
        </p>
        <ol :class="['flex flex-col gap-3']">
          <li v-for="material in planner.plan.materials" :key="material.itemId" :data-testid="`profession-material-${material.itemId}`" :class="['min-w-0 flex flex-col gap-3 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
            <h3 :class="['min-w-0 break-words text-sm font-medium']">
              {{ material.name || t('wow-professions.plan.item-id', { id: material.itemId }) }}
            </h3>
            <dl :class="['grid grid-cols-3 gap-2 text-sm']">
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn('plan.required') }}
                </dt><dd :class="['mt-1 font-medium']">
                  {{ material.required }}
                </dd>
              </div>
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn(material.missingKind === 'exact' ? 'plan.bags' : 'plan.known-bags') }}
                </dt><dd :class="['mt-1 font-medium']">
                  {{ inventoryStatus === 'unknown' || inventoryStatus === 'stale' ? tn('plan.unknown') : material.owned }}
                </dd>
              </div>
              <div>
                <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ tn(material.missingKind === 'exact' ? 'plan.missing' : 'plan.missing-upper-bound') }}
                </dt><dd :class="['mt-1 font-medium text-primary-700 dark:text-primary-300']">
                  {{ material.missing }}
                </dd>
              </div>
            </dl>
            <FieldInput type="number" :model-value="extraQuantity(material.itemId)" :label="`${tn('inventory.manual')} · ${material.name || material.itemId}`" :description="tn('inventory.manual-description')" :disabled="planner.loading" @update:model-value="planner.setManualMaterial(material.itemId, $event ?? 0)" />
          </li>
        </ol>
        <template v-if="planner.plan.steps.length">
          <h3 :class="['text-sm font-semibold']">
            {{ tn('leveling.steps') }}
          </h3>
          <ol :class="['list-decimal pl-5 text-sm leading-relaxed']">
            <li v-for="(step, index) in planner.plan.steps" :key="index" :class="['mb-2 break-words']">
              {{ step.name }} · {{ t('wow-professions.leveling.crafts', { count: step.crafts }) }}
              <span v-if="step.startSkill !== undefined && step.endSkill !== undefined"> · {{ t('wow-professions.leveling.span', { from: step.startSkill, to: step.endSkill }) }}</span>
              <span v-if="step.prep"> · {{ tn('leveling.prep') }}</span>
            </li>
          </ol>
        </template>
        <p v-if="planner.plan.products.length" :class="['break-words text-sm']">
          {{ t('wow-professions.plan.products', { products: planner.plan.products.map(product => `${product.name} × ${product.count}`).join(' · ') }) }}
        </p>
      </template>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('budget.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('budget.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('budget.description') }}
      </p>
      <Button :disabled="!hasMaterials || !hasMissing || planner.loading || planner.budgetLoading" :loading="planner.budgetLoading" :class="['self-start']" @click="planner.estimateBudget()">
        {{ tn('budget.estimate') }}
      </Button>
      <template v-if="planner.budget">
        <p :class="['text-sm font-medium']">
          {{ t('wow-professions.budget.total', { price: money(planner.budget.knownCopper) }) }}
        </p>
        <p v-if="!planner.budget.complete" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('budget.incomplete') }}
        </p>
        <p v-if="planner.budget.missingPriceItemIds.length" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('budget.missing-prices') }}
        </p>
        <p v-if="planner.budget.collectedAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-professions.budget.collected', { time: time(planner.budget.collectedAt) }) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ planner.budget.realm || planner.budget.faction ? t('wow-professions.budget.scope', { scope: [planner.budget.realm, planner.budget.faction].filter(Boolean).join(' · ') }) : tn('budget.unknown-scope') }}
        </p>
        <p :class="['text-xs leading-relaxed text-amber-700 dark:text-amber-300']">
          {{ tn('budget.scope-unverified') }}
        </p>
        <p v-if="planner.budget.stale" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('budget.stale') }}
        </p>
        <ul v-if="planner.budget.notices?.length" :class="['list-disc pl-4 text-xs text-amber-700 dark:text-amber-300']">
          <li v-for="(value, index) in planner.budget.notices" :key="index">
            {{ notice(value) }}
          </li>
        </ul>
      </template>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('budget.historical') }}
      </p>
    </SettingsCard>

    <footer :class="['flex flex-col gap-2 border-t pt-4 text-xs', 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400']">
      <a href="https://wuxianwow.com/" target="_blank" rel="noopener noreferrer" :class="['self-start text-primary-700 underline dark:text-primary-300']">无限图鉴 wuxianwow.com</a>
      <span>{{ tn('game') }}</span>
      <span>{{ t('wow-professions.source.build', { build: planner.sourceEvidence?.build ?? tn('source.unknown-build') }) }}</span>
      <span v-if="planner.sourceEvidence?.receivedAt">{{ t(planner.sourceEvidence.cache?.status === 'hit' ? 'wow-professions.source.original-received' : 'wow-professions.source.received', { time: time(planner.sourceEvidence.receivedAt) }) }}</span>
      <template v-if="planner.sourceEvidence?.cache?.status === 'hit'">
        <span>{{ tn('source.cache-hit') }}</span>
        <span>{{ t('wow-professions.source.cache-served', { time: time(planner.sourceEvidence.cache.servedAt) }) }}</span>
        <span>{{ t('wow-professions.source.cache-expires', { time: time(planner.sourceEvidence.cache.expiresAt) }) }}</span>
      </template>
      <span v-if="planner.sourceEvidence?.updatedAt">{{ t('wow-professions.source.updated', { time: time(planner.sourceEvidence.updatedAt) }) }}</span>
      <span :class="['leading-relaxed']">{{ tn('source.uncertainty') }}</span>
    </footer>
  </div>
</template>

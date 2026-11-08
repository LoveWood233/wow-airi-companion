import type { WowCraftingPlan, WowCraftingPrices, WowCraftingRecipe, WowCraftingRoute, WowCraftingStock } from '@proj-airi/stage-shared/wow-knowledge'

import type { ProfessionSourceEvidence } from '../utils/wow-profession-source'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { planWowCraftingRecipes, planWowCraftingRoute } from '@proj-airi/stage-shared/wow-knowledge'
import { useNow } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { electronMcpCallTool, electronMcpListTools } from '../../shared/eventa'
import { WowProfessionSource } from '../utils/wow-profession-source'
import { useWowCompanionStore } from './wow-companion'

interface SelectedRecipe { recipe: WowCraftingRecipe, quantity: number, unit: 'crafts' | 'products' }
interface ManualMaterial { itemID: number, name: string, quantity: number }

export const useWowProfessionsStore = defineStore('wow-professions', () => {
  const companion = useWowCompanionStore()
  const now = useNow({ interval: 1000 })
  const callTool = useElectronEventaInvoke(electronMcpCallTool)
  const listTools = useElectronEventaInvoke(electronMcpListTools)
  const source = new WowProfessionSource({ callTool, listTools, trustedWowEvidence: true })
  const mode = ref<'recipe' | 'leveling'>('recipe')
  const query = ref('')
  const quantity = ref(1)
  const profession = ref('')
  const fromSkill = ref(1)
  const toSkill = ref(75)
  const routeChoice = ref<'best' | 'free'>('free')
  const recipeChoices = ref<Array<{ id: string, title: string, url?: string }>>([])
  const selectedRecipes = ref<SelectedRecipe[]>([])
  const route = ref<WowCraftingRoute | null>(null)
  const routeRecipes = ref<WowCraftingRecipe[]>([])
  const plan = ref<WowCraftingPlan | null>(null)
  const manualMaterials = ref<ManualMaterial[]>([])
  const sourceEvidence = ref<ProfessionSourceEvidence | null>(null)
  const loading = ref(false)
  const budgetLoading = ref(false)
  const errorCode = ref<string | null>(null)
  const prices = ref<WowCraftingPrices>()
  const budget = computed(() => plan.value?.budget ?? null)
  const manualItemOptions = computed(() => {
    const items = new Map<number, string>()
    const recipes = mode.value === 'leveling' ? routeRecipes.value : selectedRecipes.value.map(entry => entry.recipe)
    for (const recipe of recipes) {
      for (const item of [...recipe.reagents, ...recipe.products])
        items.set(item.itemId, item.name)
    }
    return [...items].map(([itemID, name]) => ({ itemID, name }))
  })
  const bridge = computed(() => companion.profiles.forever.state.bridge)
  const characterKey = computed(() => {
    const snapshot = bridge.value?.snapshot
    return snapshot ? JSON.stringify(['forever', snapshot.account, snapshot.guid, snapshot.session]) : 'forever:unknown'
  })
  const inventorySummary = computed(() => {
    const current = bridge.value
    const snapshot = current?.snapshot
    const inventory = current?.inventory
    const identity = { name: snapshot?.name, realm: snapshot?.realm, bank: 'unknown' as const, observedAt: inventory?.observedAt }
    const profile = companion.profiles.forever
    if (!profile.state.settings.enabled || profile.state.error || profile.error || current?.error || current?.inventoryError
      || !current || current.source !== 'screen' || !snapshot?.online || !inventory || inventory.guid !== snapshot.guid || inventory.session !== snapshot.session) {
      return { ...identity, status: 'unknown' as const }
    }
    if (current.status !== 'live' || now.value.getTime() / 1000 - inventory.observedAt > 180 || inventory.observedAt > now.value.getTime() / 1000 + 30)
      return { ...identity, status: 'stale' as const }
    return { ...identity, status: inventory.complete ? 'ready' as const : 'partial' as const }
  })

  function calculate() {
    const status = inventorySummary.value.status
    const items: WowCraftingStock[] = status === 'ready' || status === 'partial'
      ? (bridge.value?.inventory?.items ?? []).map(item => ({ itemId: item.itemID, count: item.quantity }))
      : []
    const options = {
      inventory: { completeness: status === 'ready' ? 'complete' as const : status === 'partial' ? 'partial' as const : 'unknown' as const, items },
      manualItems: manualMaterials.value.map(item => ({ itemId: item.itemID, count: item.quantity })),
      prices: prices.value,
      now: new Date().toISOString(),
    }
    plan.value = mode.value === 'leveling'
      ? route.value ? planWowCraftingRoute(route.value, { ...options, recipes: routeRecipes.value }) : null
      : selectedRecipes.value.length ? planWowCraftingRecipes(selectedRecipes.value.map(entry => ({ recipe: entry.recipe, target: { mode: entry.unit, quantity: entry.quantity } })), options) : null
  }

  async function initialize() {
    try {
      companion.start()
      await companion.refresh('forever')
    }
    catch { errorCode.value = 'generic' }
  }

  async function run(operation: () => Promise<void>) {
    if (loading.value || budgetLoading.value)
      return
    loading.value = true
    errorCode.value = null
    try {
      await operation()
      sourceEvidence.value = source.evidence ? { ...source.evidence } : null
      calculate()
    }
    catch (error) {
      const code = errorMessageFrom(error)
      errorCode.value = code && ['invalid-range', 'invalid-quantity', 'recipe-unavailable', 'source-unavailable', 'price-unavailable'].includes(code) ? code : 'generic'
    }
    finally { loading.value = false }
  }

  async function searchRecipes() {
    if (loading.value || budgetLoading.value)
      return
    recipeChoices.value = []
    await run(async () => {
      recipeChoices.value = await source.search(query.value)
    })
  }

  async function addRecipe(id: string) {
    if (selectedRecipes.value.some(entry => entry.recipe.id === id) || selectedRecipes.value.length >= 12)
      return
    await run(async () => {
      if (!Number.isSafeInteger(quantity.value) || quantity.value < 1 || quantity.value > 100_000)
        throw new Error('invalid-quantity')
      await source.discover()
      const recipe = await source.recipe(id)
      selectedRecipes.value.push({ recipe, quantity: quantity.value, unit: 'crafts' })
    })
  }

  function setRecipeQuantity(id: string, value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
      errorCode.value = 'invalid-quantity'
      return
    }
    const entry = selectedRecipes.value.find(entry => entry.recipe.id === id)
    if (entry)
      entry.quantity = value
    errorCode.value = null
    calculate()
  }

  function setRecipeUnit(id: string, value: 'crafts' | 'products') {
    const entry = selectedRecipes.value.find(entry => entry.recipe.id === id)
    if (!entry || (value === 'products' && (!entry.recipe.complete || entry.recipe.products.length !== 1)))
      return
    entry.unit = value
    calculate()
  }

  function removeRecipe(id: string) {
    selectedRecipes.value = selectedRecipes.value.filter(entry => entry.recipe.id !== id)
    calculate()
  }

  async function loadRoute() {
    if (loading.value || budgetLoading.value)
      return
    route.value = null
    routeRecipes.value = []
    plan.value = null
    prices.value = undefined
    await run(async () => {
      const result = await source.route(profession.value, fromSkill.value, toSkill.value, routeChoice.value)
      route.value = result.route
      routeRecipes.value = result.recipes
    })
  }

  function setManualMaterial(itemID: number, value: number) {
    if (!Number.isSafeInteger(itemID) || itemID <= 0 || !Number.isSafeInteger(value) || value < 0 || value > 100_000) {
      errorCode.value = 'invalid-quantity'
      return
    }
    manualMaterials.value = manualMaterials.value.filter(item => item.itemID !== itemID)
    if (value > 0)
      manualMaterials.value.push({ itemID, name: manualItemOptions.value.find(item => item.itemID === itemID)?.name ?? plan.value?.materials.find(item => item.itemId === itemID)?.name ?? `#${itemID}`, quantity: value })
    errorCode.value = null
    calculate()
  }

  function clearManualMaterials() {
    manualMaterials.value = []
    calculate()
  }

  async function estimateBudget() {
    if (!plan.value || plan.value.status === 'invalid' || loading.value || budgetLoading.value)
      return
    budgetLoading.value = true
    errorCode.value = null
    const identity = characterKey.value
    try {
      const result = await source.prices(plan.value.materials.filter(item => item.missing > 0).map(item => item.itemId))
      if (identity !== characterKey.value)
        return
      if (!result)
        throw new Error('price-unavailable')
      prices.value = result
      sourceEvidence.value = source.evidence ? { ...source.evidence } : null
      calculate()
    }
    catch {
      if (identity === characterKey.value)
        errorCode.value = 'price-unavailable'
    }
    finally { budgetLoading.value = false }
  }

  watch(characterKey, () => {
    manualMaterials.value = []
    prices.value = undefined
    calculate()
  }, { flush: 'sync' })
  watch([mode, inventorySummary, () => bridge.value?.inventory], calculate)

  return {
    mode,
    query,
    quantity,
    profession,
    fromSkill,
    toSkill,
    routeChoice,
    recipeChoices,
    selectedRecipes,
    route,
    plan,
    manualMaterials,
    manualItemOptions,
    inventorySummary,
    sourceEvidence,
    loading,
    budgetLoading,
    errorCode,
    budget,
    initialize,
    searchRecipes,
    addRecipe,
    setRecipeQuantity,
    setRecipeUnit,
    removeRecipe,
    loadRoute,
    setManualMaterial,
    clearManualMaterials,
    calculate,
    estimateBudget,
  }
})

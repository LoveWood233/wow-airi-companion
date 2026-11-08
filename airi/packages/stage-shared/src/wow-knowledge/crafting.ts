/** Item quantities use safe whole numbers. Recipe IDs and item IDs belong to separate namespaces. */
export interface WowCraftingStock { itemId: number, count: number }
export interface WowCraftingQuantity extends WowCraftingStock { name: string }

/** Only structured item identities and fixed yields can supply exact crafting arithmetic. */
export interface WowCraftingRecipe {
  id: string
  recipeId: number
  spellId?: number
  name: string
  profession?: string
  reagents: WowCraftingQuantity[]
  products: WowCraftingQuantity[]
  url?: string
  build?: string
  updatedAt?: string
  complete: boolean
  notices: string[]
}

export interface WowCraftingTarget { mode: 'crafts' | 'products', quantity: number, productItemId?: number }
export interface WowCraftingSelection { recipe: WowCraftingRecipe, target: WowCraftingTarget }
export interface WowCraftingInventory { completeness: 'complete' | 'partial' | 'unknown', items: readonly WowCraftingStock[] }
export interface WowCraftingQuote { itemId: number, unitCopper: number }

/** A quote group belongs to one snapshot. Its original collection label remains visible even when its date cannot be parsed. */
export interface WowCraftingPrices {
  realm?: string
  faction?: string
  collectedAt: string
  collectedAtEpochMs?: number
  quotes: WowCraftingQuote[]
  complete?: boolean
  notices?: string[]
  source?: string
  sourceUrl?: string
}

export interface WowCraftingRoutePrep {
  recipeId: number
  name: string
  atSkill: number
  crafts: number
  materials: WowCraftingQuantity[]
  complete: boolean
}
export interface WowCraftingRouteStep {
  recipeId: number
  name: string
  startSkill: number
  endSkill: number
  crafts: number
  materials: WowCraftingQuantity[]
  prep: WowCraftingRoutePrep[]
  estimated: boolean
}
export interface WowCraftingTraining {
  atSkill: number
  name: string
  requiredLevel?: number
  levelAssumed: boolean
  newMaxSkill?: number
}
export interface WowCraftingRoute {
  route: 'best' | 'free'
  profession?: string
  fromSkill: number
  toSkill: number
  steps: WowCraftingRouteStep[]
  complete: boolean
  notices: string[]
  url?: string
  build?: string
  method?: string[]
  training?: WowCraftingTraining[]
}

export interface WowCraftingPlanStep {
  recipeId: number
  name: string
  crafts: number
  prep: boolean
  startSkill?: number
  endSkill?: number
}
export interface WowCraftingMaterial {
  itemId: number
  name: string
  required: number
  owned: number
  manual: number
  missing: number
  missingKind: 'exact' | 'upper-bound'
}
export interface WowCraftingBudget {
  knownCopper: number
  complete: boolean
  missingPriceItemIds: number[]
  stale: boolean
  realm?: string
  faction?: string
  collectedAt: string
  notices?: string[]
}
export interface WowCraftingPlan {
  status: 'ready' | 'incomplete' | 'invalid'
  crafts?: number
  materials: WowCraftingMaterial[]
  products: WowCraftingQuantity[]
  steps: WowCraftingPlanStep[]
  notices: string[]
  budget?: WowCraftingBudget
}
export interface WowCraftingOptions {
  inventory?: WowCraftingInventory
  /** These quantities are extra stock outside the automatic snapshot. They never replace the snapshot's known amounts. */
  manualItems?: readonly WowCraftingStock[]
  prices?: WowCraftingPrices
  now?: string
  /** @default 86400000 */
  maxPriceAgeMs?: number
  /** Route calculation requires the actual records for all selected steps and preparation recipes. */
  recipes?: readonly WowCraftingRecipe[]
}

interface Operation { recipe: WowCraftingRecipe, step: WowCraftingPlanStep }
interface Consumption { purchased: Map<number, number>, owned: Map<number, number>, manual: Map<number, number>, produced: Map<number, number> }

class CalculationFailure extends Error {
  constructor(readonly notice: string) { super(notice) }
}

function whole(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new CalculationFailure('invalid-quantity')
  return value
}

function add(left: number, right: number) {
  const value = left + right
  if (!Number.isSafeInteger(value))
    throw new CalculationFailure('quantity-overflow')
  return value
}

function multiply(left: number, right: number) {
  const value = left * right
  if (!Number.isSafeInteger(value))
    throw new CalculationFailure('quantity-overflow')
  return value
}

function increase(map: Map<number, number>, itemId: number, count: number) {
  map.set(itemId, add(map.get(itemId) ?? 0, count))
}

function stock(items?: readonly WowCraftingStock[]) {
  const result = new Map<number, number>()
  if (items) {
    for (const item of items)
      increase(result, whole(item.itemId, 1), whole(item.count))
  }
  return result
}

function take(map: Map<number, number>, itemId: number, required: number) {
  const count = Math.min(map.get(itemId) ?? 0, required)
  map.set(itemId, (map.get(itemId) ?? 0) - count)
  return count
}

function consume(operations: readonly Operation[], inventory?: readonly WowCraftingStock[], manualItems?: readonly WowCraftingStock[]): Consumption {
  const available = stock(inventory)
  const extra = stock(manualItems)
  const result: Consumption = { purchased: new Map(), owned: new Map(), manual: new Map(), produced: new Map() }
  for (const { recipe, step } of operations) {
    for (const item of recipe.reagents) {
      let remaining = multiply(whole(item.count, 1), step.crafts)
      remaining -= take(result.produced, whole(item.itemId, 1), remaining)
      const owned = take(available, item.itemId, remaining)
      remaining -= owned
      const manual = take(extra, item.itemId, remaining)
      remaining -= manual
      increase(result.owned, item.itemId, owned)
      increase(result.manual, item.itemId, manual)
      increase(result.purchased, item.itemId, remaining)
    }
    for (const item of recipe.products)
      increase(result.produced, whole(item.itemId, 1), multiply(whole(item.count, 1), step.crafts))
  }
  return result
}

function empty(status: WowCraftingPlan['status'], notices: string[], steps: WowCraftingPlanStep[] = []): WowCraftingPlan {
  return { status, materials: [], products: [], steps, notices: [...new Set(notices)] }
}

function productCrafts(recipe: WowCraftingRecipe, target: WowCraftingTarget) {
  const quantity = whole(target.quantity, 1)
  if (target.mode === 'crafts')
    return quantity
  if (target.mode !== 'products')
    throw new CalculationFailure('invalid-quantity')
  const productId = target.productItemId ?? (recipe.products.length === 1 ? recipe.products[0]?.itemId : undefined)
  if (productId === undefined)
    throw new CalculationFailure('ambiguous-product')
  const products = recipe.products.filter(item => item.itemId === productId)
  if (!products.length || !recipe.complete)
    throw new CalculationFailure('unknown-yield')
  let count = 0
  for (const product of products)
    count = add(count, whole(product.count, 1))
  // Integer division avoids a floating point addition near MAX_SAFE_INTEGER.
  return Math.floor(quantity / count) + (quantity % count === 0 ? 0 : 1)
}

function budget(materials: WowCraftingMaterial[], prices: WowCraftingPrices, options: WowCraftingOptions, notices: Set<string>): WowCraftingBudget {
  const budgetNotices = new Set(prices.notices)
  const quotes = new Map<number, number>()
  for (const quote of prices.quotes) {
    whole(quote.itemId, 1)
    whole(quote.unitCopper)
    const previous = quotes.get(quote.itemId)
    if (previous !== undefined && previous !== quote.unitCopper)
      throw new CalculationFailure('conflicting-prices')
    quotes.set(quote.itemId, quote.unitCopper)
  }
  const now = options.now ? Date.parse(options.now) : undefined
  const maximumAge = whole(options.maxPriceAgeMs ?? 86_400_000)
  const timestamp = prices.collectedAtEpochMs !== undefined && Number.isSafeInteger(prices.collectedAtEpochMs) ? prices.collectedAtEpochMs : undefined
  const age = now !== undefined && timestamp !== undefined ? now - timestamp : undefined
  const stale = age !== undefined && age > maximumAge
  if (!Number.isFinite(now) || timestamp === undefined) {
    notices.add('price-date-unknown')
    budgetNotices.add('price-date-unknown')
  }
  if (stale) {
    notices.add('price-stale')
    budgetNotices.add('price-stale')
  }
  if (age !== undefined && age < -300_000) {
    notices.add('price-date-future')
    budgetNotices.add('price-date-future')
  }
  const missingPriceItemIds: number[] = []
  let knownCopper = 0
  for (const material of materials) {
    if (!material.missing)
      continue
    const price = quotes.get(material.itemId)
    if (price === undefined)
      missingPriceItemIds.push(material.itemId)
    else
      knownCopper = add(knownCopper, multiply(price, material.missing))
  }
  if (missingPriceItemIds.length || prices.complete === false) {
    notices.add('price-incomplete')
    budgetNotices.add('price-incomplete')
  }
  return {
    knownCopper,
    complete: missingPriceItemIds.length === 0 && prices.complete !== false && !stale
      && !['price-date-unknown', 'price-date-future', 'estimated-skillups', 'incomplete-route', 'incomplete-reagents'].some(notice => notices.has(notice))
      && materials.every(item => item.missingKind === 'exact'),
    missingPriceItemIds,
    stale,
    realm: prices.realm,
    faction: prices.faction,
    collectedAt: prices.collectedAt,
    notices: [...budgetNotices],
  }
}

function trimPreparation(operations: Operation[], options: WowCraftingOptions) {
  const available = stock(options.inventory?.items)
  for (const [itemId, count] of stock(options.manualItems))
    increase(available, itemId, count)
  const trimmed: Operation[] = []
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index]!
    if (operation.step.prep) {
      let neededCrafts = 0
      for (const product of operation.recipe.products) {
        let balance = -(available.get(product.itemId) ?? 0)
        let deficit = 0
        for (const future of operations.slice(index + 1)) {
          for (const item of future.recipe.reagents) {
            if (item.itemId === product.itemId) {
              balance = add(balance, multiply(item.count, future.step.crafts))
              deficit = Math.max(deficit, balance)
            }
          }
          for (const item of future.recipe.products) {
            if (item.itemId === product.itemId)
              balance = add(balance, -multiply(item.count, future.step.crafts))
          }
        }
        neededCrafts = Math.max(neededCrafts, Math.floor(deficit / product.count) + (deficit % product.count === 0 ? 0 : 1))
      }
      // A shortened target interval cannot require all preparation intended for later, unselected steps.
      operation.step.crafts = Math.min(operation.step.crafts, neededCrafts)
    }
    if (!operation.step.crafts)
      continue
    for (const item of operation.recipe.reagents)
      take(available, item.itemId, multiply(item.count, operation.step.crafts))
    for (const item of operation.recipe.products)
      increase(available, item.itemId, multiply(item.count, operation.step.crafts))
    trimmed.push(operation)
  }
  return trimmed
}

function calculate(operations: Operation[], options: WowCraftingOptions, initialNotices: string[]): WowCraftingPlan {
  const notices = new Set(initialNotices)
  const completeness = options.inventory?.completeness ?? 'unknown'
  if (completeness !== 'complete')
    notices.add(completeness === 'partial' ? 'inventory-incomplete' : 'inventory-unknown')
  const required = consume(operations)
  const remaining = consume(operations, options.inventory?.items, options.manualItems)
  const names = new Map<number, string>()
  for (const { recipe } of operations) {
    for (const item of [...recipe.reagents, ...recipe.products])
      names.set(item.itemId, item.name)
    for (const notice of recipe.notices)
      notices.add(notice)
    if (!recipe.complete)
      notices.add('incomplete-recipe')
  }
  const materials: WowCraftingMaterial[] = [...required.purchased].filter(([, count]) => count > 0).map(([itemId, count]) => ({
    itemId,
    name: names.get(itemId) ?? String(itemId),
    required: count,
    owned: remaining.owned.get(itemId) ?? 0,
    manual: remaining.manual.get(itemId) ?? 0,
    missing: remaining.purchased.get(itemId) ?? 0,
    missingKind: completeness === 'complete' ? 'exact' : 'upper-bound',
  }))
  const products = [...remaining.produced].filter(([, count]) => count > 0).map(([itemId, count]) => ({ itemId, name: names.get(itemId) ?? String(itemId), count }))
  let crafts = 0
  for (const operation of operations)
    crafts = add(crafts, operation.step.crafts)
  const plan: WowCraftingPlan = { status: notices.size ? 'incomplete' : 'ready', crafts, materials, products, steps: operations.map(operation => operation.step), notices: [] }
  if (options.prices) {
    try {
      plan.budget = budget(materials, options.prices, options, notices)
    }
    catch (error) {
      if (!(error instanceof CalculationFailure))
        throw error
      // An unusable optional price cannot erase otherwise valid material requirements.
      notices.add(error.notice === 'quantity-overflow' ? 'price-overflow' : error.notice)
    }
  }
  if (notices.size)
    plan.status = 'incomplete'
  plan.notices = [...notices]
  return plan
}

/** Plans a batch once, so repeated material IDs share one stock balance. The selection order also controls intermediate reuse. */
export function planWowCraftingRecipes(selections: readonly WowCraftingSelection[], options: WowCraftingOptions = {}): WowCraftingPlan {
  try {
    if (!selections.length || selections.length > 40)
      return empty('invalid', ['invalid-selection'])
    const operations = selections.map(({ recipe, target }) => ({
      recipe,
      step: { recipeId: whole(recipe.recipeId, 1), name: recipe.name, crafts: productCrafts(recipe, target), prep: false },
    }))
    if (operations.some(operation => !operation.recipe.complete) && operations.length > 1)
      return empty('incomplete', ['incomplete-recipe'], operations.map(operation => operation.step))
    return calculate(operations, options, [])
  }
  catch (error) {
    if (error instanceof CalculationFailure)
      return empty('invalid', [error.notice])
    throw error
  }
}

/** Product targets round up by a proven fixed batch yield. Craft targets count executions, including recipes without item products. */
export function planWowCraftingRecipe(recipe: WowCraftingRecipe, target: WowCraftingTarget, options: WowCraftingOptions = {}): WowCraftingPlan {
  return planWowCraftingRecipes([{ recipe, target }], options)
}

/** Replays only selected route steps. Missing hydration suppresses procurement numbers instead of treating intermediate items as purchases. */
export function planWowCraftingRoute(route: WowCraftingRoute, options: WowCraftingOptions = {}): WowCraftingPlan {
  const steps: WowCraftingPlanStep[] = []
  try {
    const recipes = new Map(options.recipes?.map(recipe => [recipe.recipeId, recipe]))
    const operations: Operation[] = []
    let hydrated = true
    for (const step of route.steps) {
      for (const prep of step.prep) {
        const planned = { recipeId: prep.recipeId, name: prep.name, crafts: whole(prep.crafts, 1), prep: true }
        steps.push(planned)
        const recipe = recipes.get(prep.recipeId)
        if (recipe?.complete && recipe.products.length)
          operations.push({ recipe, step: planned })
        else
          hydrated = false
      }
      const planned = { recipeId: step.recipeId, name: step.name, crafts: whole(step.crafts, 1), prep: false, startSkill: step.startSkill, endSkill: step.endSkill }
      steps.push(planned)
      const recipe = recipes.get(step.recipeId)
      if (recipe?.complete && recipe.products.length)
        operations.push({ recipe, step: planned })
      else
        hydrated = false
    }
    if (!hydrated)
      return empty('incomplete', [...route.notices, 'missing-route-recipes'], steps)
    if (!steps.length)
      return empty('incomplete', [...route.notices, 'incomplete-route'])
    return calculate(trimPreparation(operations, options), options, route.complete ? route.notices : [...route.notices, 'incomplete-route'])
  }
  catch (error) {
    if (error instanceof CalculationFailure)
      return empty('invalid', [error.notice], steps)
    throw error
  }
}

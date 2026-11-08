import type { WowCraftingInventory, WowCraftingRecipe } from './crafting'

import { describe, expect, it } from 'vitest'

import priceItemFixture from './fixtures/crafting-price-item.json'
import pricesFixture from './fixtures/crafting-prices.json'
import batchFixture from './fixtures/crafting-recipe-batch.json'
import jsonldFixture from './fixtures/crafting-recipe-jsonld.json'
import routeFixture from './fixtures/crafting-route-engineering.json'
import routeRecipesFixture from './fixtures/crafting-route-recipes.json'
import recipeFixture from './fixtures/reference-recipe.json'

import { planWowCraftingRecipe, planWowCraftingRecipes, planWowCraftingRoute } from './crafting'
import { readWowCraftingPayload, readWowCraftingPrices, readWowCraftingRecipe, readWowCraftingRoute } from './crafting-source'

const completeStock: WowCraftingInventory = { completeness: 'complete', items: [] }
const options = { inventory: completeStock }

function recipe(raw: unknown): WowCraftingRecipe {
  const result = readWowCraftingRecipe(raw)
  if (!result)
    throw new Error('Fixture is not a recipe')
  return result
}

function engineering(from = 150, to = 225) {
  const result = readWowCraftingRoute(routeFixture, 'free', from, to)
  if (!result)
    throw new Error('Fixture is not a route')
  return result
}

function routeRecipes() {
  return [recipe(jsonldFixture), recipe(batchFixture), ...routeRecipesFixture.map(recipe)]
}

describe('crafting source records', () => {
  it('keeps recipe identity separate from its crafting spell and reads recorded envelopes', () => {
    const result = readWowCraftingRecipe(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(recipeFixture) }] }))
    expect(result?.recipeId).toBe(8796)
    expect(result?.spellId).toBe(16153)
    expect(result?.reagents).toEqual([{ itemId: 10620, name: '瑟银矿石', count: 1 }])
    expect(result?.products).toEqual([{ itemId: 12359, name: '瑟银锭', count: 1 }])
    expect(result?.complete).toBe(true)
  })

  it('reads JSON-LD item quantities and the current dataset build', () => {
    const result = recipe({ structuredContent: jsonldFixture })
    expect(result.recipeId).toBe(6858)
    expect(result.spellId).toBe(12585)
    expect(result.products).toEqual([{ itemId: 10505, name: '实心炸药', count: 1 }])
    expect(result.reagents).toEqual([{ itemId: 7912, name: '坚固的石头', count: 2 }])
    expect(result.build).toBe('1.60.1.70707')
    expect(result.profession).toBe('工程学')
  })

  it('does not turn a spell identity, wrong product, failed query, or prose into a recipe', () => {
    expect(readWowCraftingRecipe({ id: 'spell:16153', title: 'Example' })).toBeUndefined()
    expect(readWowCraftingRecipe({ ...recipeFixture, product: 'wow' })).toBeUndefined()
    expect(readWowCraftingRecipe({ ...recipeFixture, outcome: 'not_found' })).toBeUndefined()
    expect(readWowCraftingRecipe({ isError: true, structuredContent: recipeFixture })).toBeUndefined()
    expect(readWowCraftingRecipe('材料：瑟银矿石×1')).toBeUndefined()
  })

  it('marks random yields and missing item IDs without inventing quantities', () => {
    const result = recipe({ ...recipeFixture, metadata: { ...recipeFixture.metadata, products: [{ item_id: 12359, name: 'Random', count: 1, count_max: 2 }], reagents: [{ name: 'Missing identity', count: 1 }] } })
    expect(result.products).toEqual([])
    expect(result.reagents).toEqual([])
    expect(result.complete).toBe(false)
    expect(result.notices).toContain('unknown-yield')
    expect(result.notices).toContain('incomplete-reagents')
  })

  it('rejects conflicting recipe identities and unbounded payloads', () => {
    expect(readWowCraftingRecipe({ ...recipeFixture, metadata: { ...recipeFixture.metadata, recipe_id: 9 } })).toBeUndefined()
    expect(readWowCraftingPayload(' '.repeat(2 * 1024 * 1024 + 1))).toBeUndefined()
    expect(readWowCraftingPayload({ toolResult: { toolResult: recipeFixture } })?.id).toBe('recipe:8796')
  })

  it('clips a route and preserves typed preparation IDs without parsing material prose', () => {
    const result = engineering(160, 205)
    expect(result.steps.map(step => [step.startSkill, step.endSkill, step.crafts])).toEqual([[160, 175, 15], [175, 200, 25], [200, 205, 5]])
    expect(result.steps[2]?.prep[0]?.recipeId).toBe(6858)
    expect(result.steps[2]?.prep[0]?.materials).toEqual([])
    expect(result.steps[2]?.prep[0]?.complete).toBe(false)
    expect(result.complete).toBe(true)
  })

  it('flags uncertain skill increases and missing route coverage', () => {
    const result = engineering(285, 290)
    expect(result.steps[0]?.estimated).toBe(true)
    expect(result.notices).toContain('estimated-skillups')
    const earlier = engineering(125, 175)
    expect(earlier.complete).toBe(false)
    expect(earlier.notices).toContain('incomplete-route')
    expect(readWowCraftingRoute(routeFixture, 'free', 225, 150)).toBeUndefined()
    expect(readWowCraftingRoute(routeFixture, 'free', 150, 301)).toBeUndefined()
  })

  it('retains actual training gates and source counting assumptions within the selected range', () => {
    const result = engineering(150, 225)
    expect(result.training).toEqual([{ atSkill: 150, name: '高级工程学', requiredLevel: 20, levelAssumed: true, newMaxSkill: 225 }])
    expect(result.method).toContain(routeFixture.method.counting)
    expect(result.method).toContain(routeFixture.method.learn_point)
    expect(engineering(225, 250).training).toEqual([{ atSkill: 225, name: '专家级工程学', requiredLevel: 35, levelAssumed: true, newMaxSkill: 300 }])
  })
})

describe('crafting material plans', () => {
  it('rounds target products up to a fixed crafting batch and distinguishes execution counts', () => {
    const result = planWowCraftingRecipe(recipe(batchFixture), { mode: 'products', quantity: 201 }, options)
    expect(result.crafts).toBe(2)
    expect(result.products).toEqual([{ itemId: 10512, name: '高速秘银弹头', count: 400 }])
    expect(result.materials.map(item => item.required)).toEqual([2, 2])
    const executions = planWowCraftingRecipe(recipe(batchFixture), { mode: 'crafts', quantity: 201 }, options)
    expect(executions.crafts).toBe(201)
    expect(executions.products[0]?.count).toBe(40200)
  })

  it('requires a chosen product for a recipe with several outputs', () => {
    const selected = recipe(recipeFixture)
    selected.products.push({ itemId: 2, name: 'Second product', count: 3 })
    expect(planWowCraftingRecipe(selected, { mode: 'products', quantity: 5 }, options).notices).toContain('ambiguous-product')
    const result = planWowCraftingRecipe(selected, { mode: 'products', quantity: 5, productItemId: 2 }, options)
    expect(result.crafts).toBe(2)
    expect(result.products.find(item => item.itemId === 2)?.count).toBe(6)
  })

  it('merges duplicate material IDs across a batch before consuming each automatic and extra balance', () => {
    const selected = recipe(recipeFixture)
    selected.reagents.push({ itemId: 10620, name: 'Same material', count: 2 })
    const result = planWowCraftingRecipes([{ recipe: selected, target: { mode: 'crafts', quantity: 2 } }, { recipe: selected, target: { mode: 'crafts', quantity: 1 } }], {
      inventory: { completeness: 'complete', items: [{ itemId: 10620, count: 3 }, { itemId: 10620, count: 1 }] },
      manualItems: [{ itemId: 10620, count: 2 }],
    })
    expect(result.materials).toEqual([{ itemId: 10620, name: 'Same material', required: 9, owned: 4, manual: 2, missing: 3, missingKind: 'exact' }])
  })

  it('reuses the actual product of an earlier selected recipe', () => {
    const result = planWowCraftingRecipes([
      { recipe: recipe(jsonldFixture), target: { mode: 'crafts', quantity: 2 } },
      { recipe: recipe(batchFixture), target: { mode: 'crafts', quantity: 2 } },
    ], options)
    expect(result.materials.map(item => [item.itemId, item.required])).toEqual([[7912, 4], [3860, 2]])
    expect(result.products).toEqual([{ itemId: 10512, name: '高速秘银弹头', count: 400 }])
  })

  it('treats partial stock as known lower stock and marks computed shortages as upper bounds', () => {
    const result = planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity: 10 }, {
      inventory: { completeness: 'partial', items: [{ itemId: 10620, count: 3 }] },
      manualItems: [{ itemId: 10620, count: 2 }],
    })
    expect(result.materials[0]?.missing).toBe(5)
    expect(result.materials[0]?.missingKind).toBe('upper-bound')
    expect(result.status).toBe('incomplete')
    expect(result.notices).toContain('inventory-incomplete')
  })

  it('does not invent a complete empty inventory when no snapshot exists', () => {
    const result = planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity: 2 })
    expect(result.materials[0]?.missingKind).toBe('upper-bound')
    expect(result.notices).toContain('inventory-unknown')
    expect(result.materials[0]?.missing).toBe(2)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid target %s', (quantity) => {
    const result = planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity }, options)
    expect(result.status).toBe('invalid')
    expect(result.materials).toEqual([])
  })

  it('rejects overflow and invalid stock instead of rounding or clamping it', () => {
    const result = planWowCraftingRecipe(recipe(batchFixture), { mode: 'crafts', quantity: Number.MAX_SAFE_INTEGER }, options)
    expect(result.notices).toContain('quantity-overflow')
    expect(result.materials).toEqual([])
    expect(planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity: 1 }, { manualItems: [{ itemId: 10620, count: -1 }] }).status).toBe('invalid')
  })

  it('replays engineering outputs and preparation instead of buying every remaining reagent', () => {
    const result = planWowCraftingRoute(engineering(), { ...options, recipes: routeRecipes() })
    expect(result.materials.map(item => [item.itemId, item.required])).toEqual([[7912, 110], [3860, 70], [4338, 25], [10558, 5]])
    expect(result.materials.some(item => item.itemId === 10505 || item.itemId === 10561)).toBe(false)
    expect(result.steps.find(step => step.prep)?.crafts).toBe(30)
    expect(result.notices).toContain('hidden-product')
  })

  it('reduces preparation for a shorter target interval and excludes later steps', () => {
    const result = planWowCraftingRoute(engineering(150, 205), { ...options, recipes: routeRecipes() })
    expect(result.steps.find(step => step.prep)?.crafts).toBe(5)
    expect(result.materials.find(item => item.itemId === 7912)?.required).toBe(60)
    expect(result.materials.some(item => item.itemId === 10558)).toBe(false)
    expect(result.steps.at(-1)?.endSkill).toBe(205)
  })

  it('suppresses procurement totals when any selected intermediate output is unavailable', () => {
    const result = planWowCraftingRoute(engineering(), { ...options, recipes: [recipe(jsonldFixture)] })
    expect(result.status).toBe('incomplete')
    expect(result.materials).toEqual([])
    expect(result.steps.length).toBeGreaterThan(1)
    expect(result.notices).toContain('missing-route-recipes')
  })

  it('uses known intermediate stock to reduce preparation while retaining every leveling craft', () => {
    const result = planWowCraftingRoute(engineering(150, 205), {
      inventory: { completeness: 'partial', items: [{ itemId: 10505, count: 3 }] },
      manualItems: [{ itemId: 10505, count: 2 }],
      recipes: routeRecipes(),
    })
    expect(result.steps.some(step => step.prep)).toBe(false)
    expect(result.steps.filter(step => !step.prep).map(step => step.crafts)).toEqual([25, 25, 5])
    expect(result.materials.find(item => item.itemId === 7912)?.required).toBe(50)
    expect(result.materials.find(item => item.itemId === 10505)).toMatchObject({ required: 5, owned: 3, manual: 2, missing: 0, missingKind: 'upper-bound' })
  })
})

describe('historical price budgets', () => {
  it('keeps original source notices and parses only an explicit collection timezone', () => {
    const result = readWowCraftingPrices(priceItemFixture)
    expect(result?.collectedAt).toBe('北京时间 2026-10-26 16:49')
    expect(result?.collectedAtEpochMs).toBe(Date.parse('2026-10-26T16:49:00+08:00'))
    expect(result?.quotes).toEqual([{ itemId: 4499, unitCopper: 500000 }])
    expect(result?.realm).toBe('CAMWOW CN5 Realm 3 PvP')
    expect(result?.faction).toBe('联盟拍卖行')
    expect(result?.notices).toContain(priceItemFixture.snapshot.notice)
    expect(result?.notices).toContain(priceItemFixture.stale_notice)
    expect(readWowCraftingPrices({ ...priceItemFixture, snapshot: { ...priceItemFixture.snapshot, collected_at: '2026-10-26 16:49' } })?.collectedAtEpochMs).toBeUndefined()
  })

  it('keeps paginated prices partial and never substitutes a different random variant or old day', () => {
    expect(readWowCraftingPrices(pricesFixture)?.complete).toBe(false)
    const result = readWowCraftingPrices({ ...priceItemFixture, today: null, other_variants: [priceItemFixture.today] })
    expect(result?.quotes).toEqual([])
    expect(result?.complete).toBe(false)
    expect(readWowCraftingPrices({ ...priceItemFixture, today: { ...priceItemFixture.today, item_id: 2 } })?.quotes).toEqual([])
  })

  it('rejects automatic random bonus selection even when the base item ID matches', () => {
    for (const bonus of [123, '123', '0', [], { id: 123 }]) {
      const atRoot = readWowCraftingPrices({ ...priceItemFixture, bonus })
      const inQuote = readWowCraftingPrices({ ...priceItemFixture, today: { ...priceItemFixture.today, bonus } })
      for (const result of [atRoot, inQuote]) {
        expect(result?.quotes).toEqual([])
        expect(result?.complete).toBe(false)
        expect(result?.notices).toContain('variant-price-unverified')
      }
    }
    expect(readWowCraftingPrices({ ...priceItemFixture, bonus: 0, today: { ...priceItemFixture.today, bonus: 0 } })?.quotes).toEqual([{ itemId: 4499, unitCopper: 500000 }])
    expect(readWowCraftingPrices({ ...pricesFixture, results: [{ ...pricesFixture.results[0], bonus: 123 }] })?.quotes).toEqual([])
  })

  it('does not merge snapshots with different realm, faction, or collection time', () => {
    for (const change of [{ realm: 'Other' }, { side: '部落拍卖行' }, { collected_at: '北京时间 2026-10-25 16:49' }]) {
      const result = readWowCraftingPrices([priceItemFixture, { ...priceItemFixture, snapshot: { ...priceItemFixture.snapshot, ...change }, today: { ...priceItemFixture.today, item_id: 2 }, item_id: 2 }])
      expect(result?.complete).toBe(false)
      expect(result?.quotes).toEqual([{ itemId: 4499, unitCopper: 500000 }])
      expect(result?.notices).toContain('conflicting-price-snapshots')
    }
  })

  it('marks stale and missing prices and never labels the known subtotal as the full cost', () => {
    const sourcePrices = readWowCraftingPrices(priceItemFixture)
    if (!sourcePrices)
      throw new Error('Missing price fixture')
    const prices = { ...sourcePrices, quotes: [{ itemId: 3860, unitCopper: 500000 }] }
    const result = planWowCraftingRecipe(recipe(batchFixture), { mode: 'crafts', quantity: 2 }, { ...options, prices, now: '2026-11-01T00:00:00Z' })
    expect(result.budget?.knownCopper).toBe(1000000)
    expect(result.budget?.missingPriceItemIds).toEqual([10505])
    expect(result.budget?.stale).toBe(true)
    expect(result.budget?.complete).toBe(false)
    expect(result.budget?.notices).toContain(priceItemFixture.snapshot.notice)
    expect(result.notices).toContain('price-incomplete')
    expect(result.notices).toContain('price-stale')
  })

  it('calculates an exact in-scope quote total while retaining the original snapshot label', () => {
    const prices = { collectedAt: '北京时间 2026-10-26 16:49', collectedAtEpochMs: Date.parse('2026-10-26T08:49:00Z'), quotes: [{ itemId: 10620, unitCopper: 50 }] }
    const result = planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity: 5 }, { ...options, prices, now: '2026-10-26T09:00:00Z', manualItems: [{ itemId: 10620, count: 2 }] })
    expect(result.budget?.knownCopper).toBe(150)
    expect(result.budget?.complete).toBe(true)
    expect(result.budget?.collectedAt).toBe(prices.collectedAt)
    expect(result.status).toBe('ready')
  })

  it('retains material requirements when an optional budget exceeds the safe copper range', () => {
    const result = planWowCraftingRecipe(recipe(recipeFixture), { mode: 'crafts', quantity: 2 }, {
      ...options,
      prices: { collectedAt: '2026-10-26T08:49:00Z', collectedAtEpochMs: Date.parse('2026-10-26T08:49:00Z'), quotes: [{ itemId: 10620, unitCopper: Number.MAX_SAFE_INTEGER }] },
      now: '2026-10-26T09:00:00Z',
    })
    expect(result.materials[0]?.required).toBe(2)
    expect(result.budget).toBeUndefined()
    expect(result.notices).toContain('price-overflow')
    expect(result.status).toBe('incomplete')
  })

  it('keeps a fully quoted skill route approximate when skill-up probabilities are unknown', () => {
    const route = engineering(150, 175)
    route.notices.push('estimated-skillups')
    route.steps[0]!.estimated = true
    const result = planWowCraftingRoute(route, {
      ...options,
      recipes: routeRecipes(),
      prices: { collectedAt: '2026-10-26T08:49:00Z', collectedAtEpochMs: Date.parse('2026-10-26T08:49:00Z'), quotes: [{ itemId: 7912, unitCopper: 1 }] },
      now: '2026-10-26T09:00:00Z',
    })
    expect(result.budget?.knownCopper).toBe(50)
    expect(result.budget?.complete).toBe(false)
    expect(result.notices).toContain('estimated-skillups')
  })
})

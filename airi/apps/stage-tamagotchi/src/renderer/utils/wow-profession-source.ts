import type { WowCraftingPrices, WowCraftingRecipe, WowDataCacheEvidence } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import { readWowCraftingPrices, readWowCraftingRecipe, readWowCraftingRoute, readWowReferenceAnswer } from '@proj-airi/stage-shared/wow-knowledge'
import { WowReferenceRuntime } from '@proj-airi/stage-ui/libs/wow-reference-runtime'

export interface ProfessionSourceEvidence {
  cache?: WowDataCacheEvidence
  build?: string
  receivedAt?: string
  updatedAt?: string
}

/** Owns explicit read-only requests. Page initialization never fetches a remote catalog or recipe. */
export class WowProfessionSource {
  private readonly runtime: WowReferenceRuntime
  private tools = new Set<string>()
  evidence: ProfessionSourceEvidence | null = null

  constructor(transport: McpToolRuntime) {
    this.runtime = new WowReferenceRuntime(transport)
  }

  async discover() {
    const tools = await this.runtime.listTools()
    this.tools = new Set(tools.filter(tool => tool.serverName === 'wuxianwow' && tool.name === `wuxianwow::${tool.toolName}`).map(tool => tool.toolName))
    this.evidence = null
  }

  private async request(tool: string, args: Record<string, unknown>) {
    if (!this.tools.has(tool))
      throw new Error('source-unavailable')
    const result = await this.runtime.callTool({ name: `wuxianwow::${tool}`, arguments: args })
    if (result.isError)
      throw new Error('source-unavailable')
    this.evidence = {
      cache: result.cache,
      build: result.wowReference?.build ?? this.evidence?.build,
      receivedAt: result.wowReference?.receivedAt ?? new Date().toISOString(),
    }
    return result
  }

  async search(query: string) {
    if (!query.trim() || query.length > 160)
      throw new Error('invalid-query')
    await this.discover()
    const args = { query: query.trim(), kind: 'recipe', limit: 20 }
    const result = await this.request('search', args)
    const report = readWowReferenceAnswer(result, JSON.stringify({ name: 'wuxianwow::search', arguments: JSON.stringify(args) }))
    if (!report || !['success', 'empty'].includes(report.status))
      throw new Error('source-unavailable')
    return report.entries.filter(entry => entry.kind === 'recipe').map(entry => ({ id: entry.id, title: entry.title, url: entry.url }))
  }

  async recipe(id: string) {
    if (!/^recipe:[1-9]\d{0,11}$/.test(id))
      throw new Error('recipe-unavailable')
    const recipe = readWowCraftingRecipe(await this.request('fetch', { id }))
    if (!recipe || recipe.id !== id)
      throw new Error('recipe-unavailable')
    return recipe
  }

  async route(profession: string, fromSkill: number, toSkill: number, choice: 'best' | 'free') {
    if (!profession.trim() || profession.length > 80 || !Number.isInteger(fromSkill) || !Number.isInteger(toSkill) || fromSkill < 1 || toSkill > 300 || fromSkill >= toSkill)
      throw new Error('invalid-range')
    await this.discover()
    const result = await this.request('leveling_route', { profession: profession.trim(), from_skill: fromSkill, route: choice, section: 'all' })
    const route = readWowCraftingRoute(result, choice, fromSkill, toSkill)
    if (!route)
      throw new Error('source-unavailable')
    const ids = [...new Set(route.steps.flatMap(step => [step.recipeId, ...step.prep.map(prep => prep.recipeId)]))]
    if (ids.length > 40)
      throw new Error('source-limit')
    const recipes: WowCraftingRecipe[] = []
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch = await Promise.allSettled(ids.slice(offset, offset + 4).map(id => this.recipe(`recipe:${id}`)))
      for (const entry of batch) {
        if (entry.status === 'fulfilled')
          recipes.push(entry.value)
      }
    }
    return { route, recipes }
  }

  async prices(itemIds: readonly number[]): Promise<WowCraftingPrices | undefined> {
    const ids = [...new Set(itemIds)]
    if (ids.length > 60 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))
      throw new Error('source-limit')
    await this.discover()
    let combined: WowCraftingPrices | undefined
    let incomplete = false
    const notices = new Set<string>()
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch = await Promise.allSettled(ids.slice(offset, offset + 4).map(async (id) => {
        const prices = readWowCraftingPrices(await this.request('auction_house', { view: 'item', item_id: id }))
        if (!prices)
          return undefined
        return { ...prices, quotes: prices.quotes.filter(quote => quote.itemId === id) }
      }))
      for (const result of batch) {
        if (result.status !== 'fulfilled' || !result.value) {
          incomplete = true
          continue
        }
        const prices = result.value
        if (!combined)
          combined = { ...prices, quotes: [] }
        if (combined.collectedAt !== prices.collectedAt || combined.realm !== prices.realm || combined.faction !== prices.faction) {
          incomplete = true
          notices.add('conflicting-price-snapshots')
          continue
        }
        incomplete ||= prices.complete === false
        for (const notice of prices.notices ?? [])
          notices.add(notice)
        combined.quotes.push(...prices.quotes)
      }
    }
    if (combined) {
      combined.complete = !incomplete
      combined.notices = [...notices]
    }
    return combined
  }
}

import type { RetailDatabaseQuery, RetailDatabaseResult, WowBuildContext, WowBuildQuery, WowBuildResult, WowBuildSourceEvidence } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpToolRuntime } from '../tools/mcp'

import { compareWowBuildItem, explainWowTalentNodes, parseWowTalentPlan, readWowBuildItem, readWowBuildQuery, readWowBuildSourceEvidence, readWowBuildSpell, readWowBuildTalents, wowBuildFailure } from '@proj-airi/stage-shared/wow-knowledge'

import { WowReferenceRuntime } from './wow-reference-runtime'

export interface WowBuildRetailPort { query: (request: RetailDatabaseQuery) => Promise<RetailDatabaseResult> }

function observations(query: WowBuildQuery, context?: WowBuildContext): WowBuildSourceEvidence[] {
  const result: WowBuildSourceEvidence[] = []
  if (context?.game !== query.game)
    return result
  if (context.talents && context.guid === context.talents.guid && context.session === context.talents.session && context.talents.status === 'active' && context.talents.hasStagedChanges === false)
    result.push({ kind: 'talent-observation', game: query.game, name: '已提交天赋观察', observedAt: context.talents.observedAt, build: context.talents.clientBuild ?? undefined })
  if (context.loadout && context.guid === context.loadout.guid && context.session === context.loadout.session)
    result.push({ kind: 'equipment-observation', game: query.game, name: '最近穿戴快照', observedAt: context.loadout.observedAt })
  return result
}

/** Explicit queries explain references and observations. This runtime never learns talents, imports game codes, or equips items. */
export class WowBuildSource {
  private readonly runtime: WowReferenceRuntime

  constructor(transport: McpToolRuntime, private readonly retail?: WowBuildRetailPort) {
    this.runtime = new WowReferenceRuntime(transport)
  }

  private async local(query: WowBuildQuery, context?: WowBuildContext): Promise<WowBuildResult> {
    const sources = observations(query, context)
    if (query.operation === 'talents' || query.operation === 'compare-talents') {
      const plan = query.operation === 'compare-talents' ? parseWowTalentPlan(query.build) : undefined
      if (query.operation === 'compare-talents' && (!plan || plan.kind !== 'nodes'))
        return wowBuildFailure(query, plan ? 'unsupported-plan' : 'invalid-plan')
      const nodes = explainWowTalentNodes([], query, context, undefined, plan)
      if (!sources.some(source => source.kind === 'talent-observation'))
        return wowBuildFailure(query, 'telemetry-unavailable')
      const notices = ['retail-observations-only', 'missing-nodes-not-zero', 'prerequisites-partial', 'no-performance-score']
      return { operation: query.operation, game: query.game, outcome: nodes.length ? 'ok' : 'empty', classId: query.classId, nodes, ...(plan ? { plan: { kind: plan.kind, validation: 'partial', adjustments: [] } as const } : {}), sources: sources.filter(source => source.kind === 'talent-observation'), notices }
    }
    if (!this.retail)
      return wowBuildFailure(query, 'database-unavailable')
    const id = query.operation === 'spell' ? `spell:${query.spellId}` : `item:${query.itemId}`
    const response = await this.retail.query({ operation: 'fetch', id })
    if (response.outcome === 'error' || !response.source)
      return wowBuildFailure(query, 'database-unavailable')
    const source: WowBuildSourceEvidence = { kind: 'retail-db2', game: 'retail', name: '正式服本地 DB2', build: response.source.build, receivedAt: response.receivedAt, cache: response.cache, database: response.source }
    const row = response.entries.find(entry => entry.id === id)
    if (!row)
      return { operation: query.operation, game: query.game, outcome: 'empty', nodes: [], sources: [source], notices: ['local-db2-only'] }
    if (query.operation === 'spell')
      return { operation: query.operation, game: query.game, outcome: 'ok', nodes: [], spell: { spellId: query.spellId, name: row.title, fields: row.fields, notices: ['raw-spell-template', 'level-scaling-unresolved'] }, sources: [source], notices: ['local-db2-only'] }
    const candidate = { itemId: query.itemId, name: row.title, stats: [], statsComplete: false, effects: [], fields: row.fields, notices: ['raw-item-fields', 'candidate-stats-partial', 'base-item-not-instance'] }
    return { operation: query.operation, game: query.game, outcome: 'ok', nodes: [], item: compareWowBuildItem(candidate, query, context), sources: [source, ...sources.filter(source => source.kind === 'equipment-observation')], notices: ['local-db2-only', 'item-scaling-unresolved', 'no-performance-score'] }
  }

  async query(request: WowBuildQuery, context?: WowBuildContext): Promise<WowBuildResult> {
    const query = readWowBuildQuery(request)
    if (!query)
      throw new Error('invalid-query')
    try {
      if (query.game === 'retail')
        return await this.local(query, context)
      const plan = query.operation === 'compare-talents' ? parseWowTalentPlan(query.build) : undefined
      if (query.operation === 'compare-talents' && !plan)
        return wowBuildFailure(query, 'invalid-plan')
      if (plan?.kind === 'source' && plan.classId !== undefined && (query.operation === 'compare-talents' && plan.classId !== query.classId))
        return wowBuildFailure(query, 'invalid-plan')
      const tools = await this.runtime.listTools()
      const tool = query.operation === 'spell' ? 'spellbook' : query.operation === 'compare-item' ? 'item_usage' : 'talents'
      if (!tools.some(entry => entry.serverName === 'wuxianwow' && entry.name === `wuxianwow::${tool}` && entry.toolName === tool))
        return wowBuildFailure(query, 'source-unavailable')
      const args = query.operation === 'spell'
        ? { spell_id: query.spellId, ...(query.classId ? { class: String(query.classId) } : {}), compact: false }
        : query.operation === 'compare-item'
          ? { item_id: query.itemId }
          : { class: String(query.classId), level: Math.min(60, query.level), compact: false, ...(plan?.kind === 'source' ? { build: plan.build } : {}) }
      const raw = await this.runtime.callTool({ name: `wuxianwow::${tool}`, arguments: args })
      if (raw.isError)
        return wowBuildFailure(query, 'source-unavailable')
      const evidence = readWowBuildSourceEvidence(raw)
      const sources = [evidence, ...observations(query, context).filter(source => source.kind === (query.operation === 'compare-item' ? 'equipment-observation' : 'talent-observation'))]
      if (query.operation === 'spell') {
        const spell = readWowBuildSpell(raw, query.spellId)
        return spell ? { operation: query.operation, game: query.game, outcome: 'ok', nodes: [], spell, sources: [evidence], notices: ['base-spell-values'] } : wowBuildFailure(query, 'source-invalid')
      }
      if (query.operation === 'compare-item') {
        const candidate = readWowBuildItem(raw, query.itemId)
        return candidate ? { operation: query.operation, game: query.game, outcome: 'ok', nodes: [], item: compareWowBuildItem(candidate, query, context), sources, notices: ['base-item-not-instance', 'no-performance-score'] } : wowBuildFailure(query, 'source-invalid')
      }
      const catalog = readWowBuildTalents(raw, query.classId)
      if (!catalog)
        return wowBuildFailure(query, 'source-invalid')
      if (plan?.kind === 'source' && !catalog.plan)
        return wowBuildFailure(query, 'source-invalid')
      const nodes = explainWowTalentNodes(catalog.nodes, query, context, evidence.build, plan)
      const notices = ['missing-nodes-not-zero', 'no-performance-score', ...(query.level > 60 ? ['source-level-capped'] : []), ...(nodes.length === 180 ? ['result-truncated'] : [])]
      return { operation: query.operation, game: query.game, outcome: nodes.length ? 'ok' : 'empty', classId: query.classId, referenceUrl: catalog.url, nodes, sources, notices, ...(plan ? { plan: { kind: plan.kind, normalized: catalog.plan?.normalized, validation: catalog.plan ? catalog.plan.adjustments.length ? 'source-adjusted' : 'source-validated' : 'partial', total: catalog.plan?.total, cap: catalog.plan?.cap, remaining: catalog.plan?.remaining, adjustments: catalog.plan?.adjustments ?? [] } as const } : {}) }
    }
    catch { return wowBuildFailure(query, 'source-unavailable') }
  }
}

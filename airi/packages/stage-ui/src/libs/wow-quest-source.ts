import type { WowQuestContext, WowQuestQuery, WowQuestResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpToolRuntime } from '../tools/mcp'

import { queryWowQuestLog, readWowQuestQuery, readWowQuestSource, wowQuestFailure } from '@proj-airi/stage-shared/wow-knowledge'

import { WowReferenceRuntime } from './wow-reference-runtime'

/** Explicit queries share the normal reference cache. Neither page initialization nor reminders trigger these network calls. */
export class WowQuestSource {
  private readonly runtime: WowReferenceRuntime

  constructor(transport: McpToolRuntime) {
    this.runtime = new WowReferenceRuntime(transport)
  }

  /** One query reads one bounded list or one selected task. Chain references never trigger recursive requests. */
  async query(request: WowQuestQuery, context?: WowQuestContext): Promise<WowQuestResult> {
    const query = readWowQuestQuery(request)
    if (!query)
      throw new Error('invalid-query')
    if (query.game === 'retail')
      return queryWowQuestLog(query, context)
    try {
      const tools = await this.runtime.listTools()
      if (!tools.some(tool => tool.serverName === 'wuxianwow' && tool.toolName === 'quests' && tool.name === 'wuxianwow::quests'))
        return wowQuestFailure(query, 'source-unavailable')
      const args: Record<string, unknown> = query.operation === 'detail'
        ? { id: query.questId }
        : {
            view: 'confirmed',
            sort: 'level',
            level_min: Math.max(1, query.level - 3),
            level_max: Math.min(255, query.level + 3),
            req_max: query.level,
            ...(query.faction === 'Alliance' ? { side: '联盟' } : query.faction === 'Horde' ? { side: '部落' } : {}),
            ...(query.zone ? { zone: query.zone.trim() } : {}),
            ...(query.query ? { query: query.query.trim() } : {}),
            limit: query.limit ?? 20,
            offset: query.offset ?? 0,
          }
      const raw = await this.runtime.callTool({ name: 'wuxianwow::quests', arguments: args })
      if (raw.isError)
        return wowQuestFailure(query, 'source-unavailable')
      const result = readWowQuestSource(raw, query, context)
      if (!result)
        return wowQuestFailure(query, 'source-invalid')
      if (query.operation === 'search' && (query.faction === 'Unknown' || query.faction === 'Neutral'))
        result.notices.push('faction-filter-unavailable')
      return result
    }
    catch { return wowQuestFailure(query, 'source-unavailable') }
  }
}

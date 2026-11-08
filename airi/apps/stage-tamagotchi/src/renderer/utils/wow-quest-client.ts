import type { WowQuestContext, WowQuestQuery, WowQuestResult } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import type { CompanionState, GameVersion } from '../../shared/wow-companion'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { wowQuestFailure } from '@proj-airi/stage-shared/wow-knowledge'
import { WowQuestSource } from '@proj-airi/stage-ui/libs/wow-quest-source'

import { electronMcpCallTool, electronMcpListTools } from '../../shared/eventa'
import { readCurrentCompanionPlayer } from './wow-companion-observation'

type ReadQuestState = (game: GameVersion) => CompanionState | undefined

/**
 * Copies a fresh character-matched quest snapshot. Coverage and completion evidence retain their original meanings.
 * @example projectWowQuestContext(undefined).game // => 'unknown'
 */
export function projectWowQuestContext(state: CompanionState | undefined, nowMs = Date.now()): WowQuestContext {
  const player = readCurrentCompanionPlayer(state, nowMs)
  const quests = state?.bridge?.quests
  if (!state || !player || !quests || state.bridge?.questsError
    || quests.guid !== player.guid || quests.session !== player.session || !Number.isSafeInteger(quests.observedAt)
    || nowMs - quests.observedAt * 1000 > 180_000 || quests.observedAt * 1000 - nowMs > 30_000) {
    return { game: 'unknown' }
  }
  return {
    game: state.game,
    guid: player.guid,
    session: player.session,
    snapshot: {
      guid: quests.guid,
      session: quests.session,
      observedAt: new Date(quests.observedAt * 1000).toISOString(),
      log: { ...quests.log, entries: quests.log.entries.map(entry => ({ ...entry, objectives: entry.objectives.map(objective => ({ ...objective })) })) },
      completion: { ...quests.completion, ids: [...quests.completion.ids], turnIns: quests.completion.turnIns.map(entry => ({ questID: entry.questID, observedAt: new Date(entry.observedAt * 1000).toISOString() })) },
    },
  }
}

function contextKey(state: CompanionState | undefined, context: WowQuestContext) {
  const player = state?.bridge?.snapshot
  return JSON.stringify([state?.game, player?.account, player?.guid, player?.session, context.game, context.guid, context.session, context.snapshot ? state?.bridge?.quests?.id : null, context.snapshot?.observedAt])
}

/** The page and model tool own separate clients. A client retains transport state, never page filters or displayed results. */
export class WowQuestClient {
  private readonly source: WowQuestSource

  /** State readers exclude a profile with a failed bridge transport before projecting its last retained snapshot. */
  constructor(transport: McpToolRuntime, private readonly readState: ReadQuestState) {
    this.source = new WowQuestSource(transport)
  }

  async query(request: WowQuestQuery): Promise<WowQuestResult> {
    const state = this.readState(request.game)
    const context = projectWowQuestContext(state)
    const key = contextKey(state, context)
    const result = await this.source.query(request, context)
    const current = this.readState(request.game)
    if (contextKey(current, projectWowQuestContext(current)) !== key)
      return wowQuestFailure(request, 'telemetry-unavailable')
    return result
  }
}

/** Binds trusted Electron receipts without importing the page store. Construction does not discover tools or query a database. */
export function createWowQuestClient(readState: ReadQuestState): WowQuestClient {
  const listTools = useElectronEventaInvoke(electronMcpListTools)
  const callTool = useElectronEventaInvoke(electronMcpCallTool)
  return new WowQuestClient({ listTools, callTool, trustedWowEvidence: true }, readState)
}

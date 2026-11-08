import type { RetailDatabaseQuery, RetailDatabaseResult, WowBuildContext, WowBuildQuery, WowBuildResult } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import type { CompanionState, GameVersion } from '../../shared/wow-companion'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { wowBuildFailure } from '@proj-airi/stage-shared/wow-knowledge'
import { WowBuildSource } from '@proj-airi/stage-ui/libs/wow-build-source'

import { electronMcpCallTool, electronMcpListTools } from '../../shared/eventa'
import { wowRetailDatabaseQuery } from '../../shared/eventa/wow-retail-database'
import { readCurrentCompanionPlayer } from './wow-companion-observation'

type ReadBuildState = (game: GameVersion) => CompanionState | undefined
interface RetailQueryPort { query: (request: RetailDatabaseQuery) => Promise<RetailDatabaseResult> }

/**
 * Copies only current character-matched observations. Equipment keeps its original capture clock; it has no periodic age guarantee.
 * @example projectWowBuildContext(undefined).game // => 'unknown'
 */
export function projectWowBuildContext(state: CompanionState | undefined, nowMs = Date.now()): WowBuildContext {
  const player = readCurrentCompanionPlayer(state, nowMs)
  if (!state || !player)
    return { game: 'unknown' }
  const context: WowBuildContext = { game: state.game, guid: player.guid, session: player.session }
  const talents = state.bridge?.talents
  if (talents && !state.bridge?.talentsError && talents.guid === player.guid && talents.session === player.session
    && talents.observedAt > 0 && nowMs - talents.observedAt * 1000 <= 180_000 && talents.observedAt * 1000 - nowMs <= 5000) {
    context.classId = talents.classID ?? undefined
    context.talents = {
      guid: talents.guid,
      session: talents.session,
      observedAt: new Date(talents.observedAt * 1000).toISOString(),
      clientBuild: talents.clientBuild,
      locale: talents.locale,
      classID: talents.classID,
      status: talents.status,
      hasStagedChanges: talents.hasStagedChanges,
      scope: talents.scope,
      complete: talents.complete,
      truncated: talents.truncated,
      knownZeroNodes: talents.knownZeroNodes.map(node => ({ ...node })),
      nodes: talents.nodes.map(node => ({ ...node, entries: node.entries.map(entry => ({ ...entry })), conditions: node.conditions.map(condition => ({ ...condition })) })),
    }
  }
  const loadout = state.bridge?.equipmentLoadout
  if (loadout && !state.bridge?.equipmentLoadoutError && loadout.guid === player.guid && loadout.session === player.session
    && loadout.observedAt > 0 && loadout.observedAt * 1000 - nowMs <= 5000) {
    context.loadout = {
      guid: loadout.guid,
      session: loadout.session,
      observedAt: new Date(loadout.observedAt * 1000).toISOString(),
      slots: loadout.slots.map(slot => ({ ...slot, item: slot.item ? { ...slot.item, stats: slot.item.stats.map(stat => ({ ...stat })), tooltip: [...slot.item.tooltip] } : null })),
    }
  }
  return context
}

/** Identifies the character observations used by this operation. An unrelated talent refresh does not invalidate equipment facts. */
export function wowBuildObservationKey(state: CompanionState | undefined, context: WowBuildContext, operation: WowBuildQuery['operation']) {
  const player = state?.bridge?.snapshot
  const talents = operation === 'talents' || operation === 'compare-talents'
  const equipment = operation === 'compare-item'
  return JSON.stringify([state?.game, player?.account, player?.guid, player?.session, context.game, talents ? player?.level : null, talents && context.talents ? state?.bridge?.talents?.id : null, talents ? context.talents?.observedAt : null, equipment && context.loadout ? state?.bridge?.equipmentLoadout?.id : null, equipment ? context.loadout?.observedAt : null])
}

/** Independent clients keep model calls separate from page drafts and displayed explanations. */
export class WowBuildClient {
  private readonly source: WowBuildSource

  constructor(transport: McpToolRuntime, private readonly readState: ReadBuildState, retail?: RetailQueryPort) {
    this.source = new WowBuildSource(transport, retail)
  }

  async query(request: WowBuildQuery): Promise<WowBuildResult> {
    const state = this.readState(request.game)
    const context = projectWowBuildContext(state)
    const key = wowBuildObservationKey(state, context, request.operation)
    const result = await this.source.query(request, context)
    const current = this.readState(request.game)
    return wowBuildObservationKey(current, projectWowBuildContext(current), request.operation) === key ? result : wowBuildFailure(request, 'telemetry-unavailable')
  }
}

/** Construction binds local IPC only. It never discovers tools, opens a database, or starts a model request. */
export function createWowBuildClient(readState: ReadBuildState): WowBuildClient {
  const listTools = useElectronEventaInvoke(electronMcpListTools)
  const callTool = useElectronEventaInvoke(electronMcpCallTool)
  const query = useElectronEventaInvoke(wowRetailDatabaseQuery)
  return new WowBuildClient({ listTools, callTool, trustedWowEvidence: true }, readState, { query })
}

import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import { readWowQuestProgress } from '@proj-airi/stage-shared/wow-knowledge'
import { describe, expect, it, vi } from 'vitest'

import list from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/quest-list-horde.json'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { readCurrentCompanionPlayer } from './wow-companion-observation'
import { projectWowQuestContext, WowQuestClient } from './wow-quest-client'

function state() {
  const value = loadoutStateFixture()
  value.game = 'forever'
  value.settings.enabled = true
  value.bridge!.snapshot!.level = 15
  value.bridge!.questsReceivedAt = new Date().toISOString()
  value.bridge!.quests = {
    v: 1,
    id: 1,
    session: 'login',
    guid: 'Player-1',
    observedAt: Math.floor(Date.now() / 1000),
    source: 'quest-log',
    log: { complete: true, truncated: false, total: 1, entries: [{ questID: 844, title: 'Observed quest', level: 12, header: 'Barrens', readyForTurnIn: false, failed: false, objectivesComplete: true, objectives: [{ index: 1, text: 'Collect beaks', type: 'item', fulfilled: 2, required: 7, finished: false }] }] },
    completion: { source: 'completed-api', scope: 'unknown', complete: false, truncated: true, total: 600, ids: [845], turnIns: [{ questID: 846, observedAt: Math.floor(Date.now() / 1000) }] },
  }
  return value
}

function response(value: unknown): McpCallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function transport(): McpToolRuntime {
  return {
    listTools: vi.fn(async () => [{ name: 'wuxianwow::quests', toolName: 'quests', serverName: 'wuxianwow', inputSchema: {} }]),
    callTool: vi.fn(async () => response(list)),
  }
}

describe('quest client character evidence boundary', () => {
  it('converts epoch observations into copied evidence without promoting flags or objective coverage', () => {
    const original = state()
    const context = projectWowQuestContext(original)
    expect(context.snapshot?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(readWowQuestProgress(844, context, 'forever').status).toBe('active')
    expect(readWowQuestProgress(845, context, 'forever').status).toBe('completed-flag')
    expect(readWowQuestProgress(846, context, 'forever').status).toBe('turned-in')
    expect(readWowQuestProgress(847, context, 'forever').status).toBe('unknown')
    context.snapshot!.log.entries[0].objectives[0].fulfilled = 7
    context.snapshot!.completion.ids.push(847)
    expect(original.bridge!.quests!.log.entries[0].objectives[0].fulfilled).toBe(2)
    expect(original.bridge!.quests!.completion.ids).toEqual([845])
  })

  it('requires enabled live screen observations with a current heartbeat', () => {
    const value = state()
    expect(projectWowQuestContext(value).game).toBe('forever')
    value.settings.enabled = false
    expect(projectWowQuestContext(value)).toEqual({ game: 'unknown' })
    value.settings.enabled = true
    value.bridge!.lastSeen = new Date(Date.now() - 6000).toISOString()
    expect(readCurrentCompanionPlayer(value)).toBeUndefined()
    value.bridge!.lastSeen = new Date().toISOString()
    value.bridge!.source = 'demo'
    expect(projectWowQuestContext(value)).toEqual({ game: 'unknown' })
  })

  it('rejects stale, future, mismatched, or incomplete-transport quest evidence', () => {
    const value = state()
    const quests = value.bridge!.quests!
    quests.observedAt -= 181
    expect(projectWowQuestContext(value).snapshot).toBeUndefined()
    quests.observedAt = Math.floor(Date.now() / 1000) + 31
    expect(projectWowQuestContext(value).snapshot).toBeUndefined()
    quests.observedAt = Math.floor(Date.now() / 1000)
    quests.guid = 'Player-other'
    expect(projectWowQuestContext(value).snapshot).toBeUndefined()
    quests.guid = 'Player-1'
    value.bridge!.questsError = 'fragments incomplete'
    expect(projectWowQuestContext(value).snapshot).toBeUndefined()
  })

  it('allows an explicit read while the character is dead, in combat, or speech muted', () => {
    const value = state()
    value.settings.muted = true
    value.bridge!.snapshot!.combat = true
    value.bridge!.snapshot!.dead = true
    expect(projectWowQuestContext(value).snapshot?.log.entries).toHaveLength(1)
  })

  it('does not discover tools on construction and keeps Retail queries local', async () => {
    const value = state()
    value.game = 'retail'
    const rpc = transport()
    const client = new WowQuestClient(rpc, () => value)
    expect(rpc.listTools).not.toHaveBeenCalled()
    const result = await client.query({ operation: 'search', game: 'retail', level: 15, faction: 'Horde' })
    expect(result.entries[0]?.questId).toBe(844)
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('drops a response when the character changes even if both characters lack quest snapshots', async () => {
    const value = state()
    value.bridge!.quests = null
    const rpc = transport()
    const pending = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockReturnValueOnce(pending.promise)
    const client = new WowQuestClient(rpc, () => value)
    const result = client.query({ operation: 'search', game: 'forever', level: 15, faction: 'Horde' })
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(1))
    value.bridge!.snapshot!.guid = 'Player-other'
    pending.resolve(response(list))
    expect((await result).errorCode).toBe('telemetry-unavailable')
  })

  it('keeps database references usable without claiming player progress when telemetry is unavailable', async () => {
    const result = await new WowQuestClient(transport(), () => undefined).query({ operation: 'search', game: 'forever', level: 15, faction: 'Horde', limit: 4 })
    expect(result.outcome).toBe('ok')
    expect(result.entries.every(entry => entry.progress.status === 'unknown')).toBe(true)
    expect(result.sources.every(source => source.kind !== 'quest-log')).toBe(true)
  })
})

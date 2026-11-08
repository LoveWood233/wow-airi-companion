import type { InferInput, InferOutput } from 'valibot'

import type { BridgeStatus, GameVersion } from './wow-companion'
import type { LevelHistoryState } from './wow-companion-level-history'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, strictObject, string, trim, variant } from 'valibot'

import { gameVersionSchema } from './wow-companion'
import { equipmentSchema } from './wow-companion-equipment'

const identity = pipe(string(), minLength(1), maxLength(160))
const label = pipe(string(), maxLength(256))
const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const timestamp = pipe(count, maxValue(8_640_000_000_000_000))
const digest = pipe(string(), check(value => /^[a-f0-9]{64}$/.test(value)))
const ownerText = pipe(string(), trim(), minLength(1), maxLength(2000))

/** Long-term limits apply to preferences and collections, independently of the ordinary 100-entry retention rule. */
export const memoryCapacityDefaults = Object.freeze({ limit: 1000, minimum: 100, maximum: 100_000 })
const capacityLimit = pipe(number(), integer(), minValue(memoryCapacityDefaults.minimum), maxValue(memoryCapacityDefaults.maximum))
const noticeKind = picklist(['context-limited', 'capacity-full'])
const capacitySchema = strictObject({ personaId: identity, limit: capacityLimit })
const noticeReceiptSchema = strictObject({
  personaId: identity,
  kind: noticeKind,
  day: pipe(string(), check(value => /^\d{4}-\d{2}-\d{2}$/.test(value))),
})

export const setMemoryLimitSchema = capacitySchema
export type SetMemoryLimit = InferOutput<typeof setMemoryLimitSchema>
export const claimMemoryNoticeSchema = strictObject({ personaId: identity, kind: noticeKind })
export type ClaimMemoryNotice = InferOutput<typeof claimMemoryNoticeSchema>
export type MemoryNoticeKind = ClaimMemoryNotice['kind']

/** Persona-wide admission status contains no remembered text or game evidence. */
export interface MemoryCapacity {
  limit: number
  used: number
  full: boolean
}

/** The game scopes account and character identifiers. A login session never changes this identity. */
export const memoryCharacterSchema = strictObject({ game: gameVersionSchema, account: identity, guid: identity })
export type MemoryCharacter = InferOutput<typeof memoryCharacterSchema>

/** Structured game evidence stays separate from text written or confirmed by the owner. */
export const memoryFactSchema = variant('kind', [
  strictObject({ kind: literal('level'), fromLevel: nullable(pipe(count, maxValue(255))), level: pipe(count, minValue(1), maxValue(255)), durationMs: nullable(count) }),
  strictObject({ kind: literal('location'), map: pipe(count, minValue(1)), zone: label, instanceType: picklist(['none', 'party', 'raid', 'pvp', 'arena', 'scenario', 'unknown']) }),
  strictObject({ kind: literal('equipment'), record: equipmentSchema }),
])
export type MemoryFact = InferOutput<typeof memoryFactSchema>

/** Saved facts belong to one companion card and optionally one Warcraft character. */
export const companionMemoryEntrySchema = pipe(strictObject({
  id: identity,
  personaId: identity,
  character: nullable(memoryCharacterSchema),
  characterName: nullable(label),
  kind: picklist(['preference', 'experience', 'session-goal', 'equipment']),
  source: picklist(['user', 'confirmed-inference', 'game-live', 'game-gap', 'game-baseline']),
  sourceId: nullable(digest),
  text: pipe(string(), maxLength(2000)),
  fact: nullable(memoryFactSchema),
  occurredAt: timestamp,
  updatedAt: timestamp,
  collected: boolean(),
  suppressed: boolean(),
  /** This is the real game login, not an AIRI conversation ID. */
  gameSessionId: nullable(identity),
  /** Optional provenance only. It does not control the lifetime of a game goal. */
  chatSessionId: nullable(identity),
  expiresAt: nullable(timestamp),
  expired: boolean(),
}), check(entry => Boolean(entry.text.trim()) || entry.fact !== null, 'A memory requires text or evidence'), check(entry => entry.kind !== 'session-goal' || (entry.character !== null && entry.gameSessionId !== null), 'A game goal requires a character and game session'), check(entry => entry.kind !== 'equipment' || (entry.collected && entry.fact?.kind === 'equipment'), 'Equipment memories require an explicit collection'))
export type CompanionMemoryEntry = InferOutput<typeof companionMemoryEntrySchema>

/** Relationships change through local rules. Models never receive a score mutation operation. */
export const companionRelationshipSchema = strictObject({
  personaId: identity,
  points: count,
  visitedLocations: array(digest),
  updatedAt: timestamp,
})
export type CompanionRelationship = InferOutput<typeof companionRelationshipSchema>

const observationCursorSchema = strictObject({
  character: memoryCharacterSchema,
  bridgeInstanceId: identity,
  gameSessionId: nullable(identity),
  frameSessionId: identity,
  seq: count,
  tick: count,
  eventId: count,
  levelId: count,
  observedAt: timestamp,
})

const rewardSchema = strictObject({
  sourceId: digest,
  personaId: identity,
  kind: picklist(['level', 'first-location']),
  points: count,
  day: pipe(string(), check(value => /^\d{4}-\d{2}-\d{2}$/.test(value))),
})

/** One durable snapshot commits memories, deduplication receipts, and relationship changes together. */
export const companionMemoryArchiveSchema = pipe(strictObject({
  version: literal(1),
  entries: array(companionMemoryEntrySchema),
  relationships: array(companionRelationshipSchema),
  cursors: array(observationCursorSchema),
  seenSources: array(digest),
  forgottenSources: array(digest),
  rewards: array(rewardSchema),
  // Version 1 permanently supports archives without policy fields: default capacity and no consumed notices.
  capacities: optional(array(capacitySchema)),
  noticeReceipts: optional(array(noticeReceiptSchema)),
}), check(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, 'Duplicate memory identity'), check(value => new Set(value.relationships.map(entry => entry.personaId)).size === value.relationships.length, 'Duplicate relationship identity'), check(value => new Set(value.cursors.map(entry => JSON.stringify(entry.character))).size === value.cursors.length, 'Duplicate character cursor'), check(value => new Set(value.seenSources).size === value.seenSources.length && new Set(value.forgottenSources).size === value.forgottenSources.length, 'Duplicate memory receipt'), check(value => new Set(value.rewards.map(entry => `${entry.personaId}:${entry.sourceId}`)).size === value.rewards.length, 'Duplicate relationship reward'), check(value => !value.capacities || new Set(value.capacities.map(row => row.personaId)).size === value.capacities.length, 'Duplicate memory capacity'), check(value => !value.noticeReceipts || new Set(value.noticeReceipts.map(row => `${row.personaId}:${row.kind}`)).size === value.noticeReceipts.length, 'Duplicate memory notice'), check((value) => {
  const ordinary = new Map<string, number>()
  for (const entry of value.entries) {
    if (entry.kind === 'preference' || entry.collected)
      continue
    const count = (ordinary.get(entry.personaId) ?? 0) + 1
    if (count > 100)
      return false
    ordinary.set(entry.personaId, count)
  }
  return true
}, 'Too many ordinary memories'))
export type CompanionMemoryArchive = InferOutput<typeof companionMemoryArchiveSchema>

/** The desktop binds the persona and character before calling memory operations. */
export const memoryScopeSchema = strictObject({ personaId: identity, character: optional(memoryCharacterSchema) })
export type MemoryScope = InferOutput<typeof memoryScopeSchema>

export const rememberMemorySchema = strictObject({
  personaId: identity,
  character: optional(memoryCharacterSchema),
  characterName: optional(label),
  kind: picklist(['preference', 'experience', 'session-goal']),
  text: ownerText,
  source: optional(picklist(['user', 'confirmed-inference']), 'user'),
  sourceId: optional(pipe(string(), minLength(1), maxLength(512))),
  gameSessionId: optional(identity),
  chatSessionId: optional(identity),
  expiresAt: optional(timestamp),
  collected: optional(boolean(), false),
})
export type RememberMemory = InferInput<typeof rememberMemorySchema>

export const memoryEntryActionSchema = strictObject({ personaId: identity, id: identity })
export type MemoryEntryAction = InferOutput<typeof memoryEntryActionSchema>
export const editMemorySchema = strictObject({ personaId: identity, id: identity, text: ownerText })
export type EditMemory = InferOutput<typeof editMemorySchema>
export const collectMemorySchema = strictObject({ personaId: identity, id: identity, collected: boolean() })
export type CollectMemory = InferOutput<typeof collectMemorySchema>
export const suppressMemorySchema = strictObject({ personaId: identity, id: identity, suppressed: boolean() })
export type SuppressMemory = InferOutput<typeof suppressMemorySchema>
export const collectEquipmentMemorySchema = strictObject({
  personaId: identity,
  character: memoryCharacterSchema,
  characterName: optional(label),
  record: equipmentSchema,
  text: optional(pipe(string(), maxLength(2000)), ''),
  gameSessionId: optional(identity),
  chatSessionId: optional(identity),
})
export type CollectEquipmentMemory = InferInput<typeof collectEquipmentMemorySchema>

/** Rules are an explicit constructor option. An omitted option records memories without awarding growth. */
export interface MemoryGrowthRules {
  levelPoints: number
  firstLocationPoints: number
  dailyMaximum: number
  stageThresholds: readonly [number, number, number, number]
}

/** Proposed values remain centralized until the owner enables the growth rules. */
export const suggestedMemoryGrowthRules: MemoryGrowthRules = Object.freeze({
  levelPoints: 10,
  firstLocationPoints: 5,
  dailyMaximum: 30,
  stageThresholds: Object.freeze([0, 50, 150, 300] as const),
})

/** Management reads include suppressed and expired rows. Conversation selection must filter both flags. */
export interface CompanionMemoryState {
  entries: CompanionMemoryEntry[]
  relationship: CompanionRelationship & { stage: 0 | 1 | 2 | 3 }
  storageError: string | null
  /** Every repository read supplies this persona-wide count, even when its entries are scoped to one character. */
  capacity?: MemoryCapacity
}

/** Main supplies validated device observations once, independently of renderer speech and timer owners. */
export interface MemoryObservation {
  game: GameVersion
  bridge: BridgeStatus | null
  levels?: LevelHistoryState
  error?: string | null
}

export const expireSessionGoalsSchema = strictObject({
  personaId: identity,
  character: optional(memoryCharacterSchema),
  gameSessionId: optional(identity),
})
export type ExpireSessionGoals = InferOutput<typeof expireSessionGoalsSchema>

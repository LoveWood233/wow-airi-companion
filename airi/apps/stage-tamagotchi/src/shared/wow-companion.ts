import type { InferOutput } from 'valibot'

import type { EquipmentHistoryState } from './wow-companion-equipment-history'
import type { GoldState } from './wow-companion-gold'

import { array, boolean, finite, integer, literal, looseObject, maxLength, maxValue, minValue, nullable, number, object, optional, picklist, pipe, string } from 'valibot'

import { equipmentSchema } from './wow-companion-equipment'
import { equipmentOfferSchema } from './wow-companion-equipment-offer'
import { equipmentSwapsSchema } from './wow-companion-equipment-swaps'
import { copperSchema, moneyIdSchema } from './wow-companion-gold'

const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const label = pipe(string(), maxLength(256))

/** A fixed profile selects the local decoder, settings, and ledger. Renderer input cannot select paths or ports. */
export const gameVersionSchema = picklist(['retail', 'forever'])
export type GameVersion = InferOutput<typeof gameVersionSchema>

export const gameProfiles = {
  retail: { port: 18765, protocol: 'WCP1', captureFile: 'bridge-config.json', settingsNamespace: 'wow-companion', goldFile: 'wow-companion-gold-v1.json', historyFile: 'wow-companion-equipment-history-v1.json' },
  forever: { port: 18766, protocol: 'WCF1', captureFile: 'bridge-config-forever.json', settingsNamespace: 'wow-companion-forever', goldFile: 'wow-companion-forever-gold-v1.json', historyFile: 'wow-companion-forever-equipment-history-v1.json' },
} as const satisfies Record<GameVersion, object>

/** Validated observations from the local screen decoder. The outer bridge protocol identifies the game. */
export const snapshotSchema = looseObject({
  v: literal(2),
  session: label,
  seq: count,
  tick: count,
  guid: label,
  name: label,
  realm: label,
  level: pipe(count, maxValue(255)),
  class: label,
  spec: count,
  map: count,
  zone: label,
  combat: boolean(),
  dead: boolean(),
  online: boolean(),
  account: moneyIdSchema,
  moneyEpoch: moneyIdSchema,
  copper: nullable(copperSchema),
  earned: copperSchema,
  spent: copperSchema,
})

export const eventSchema = object({
  id: count,
  type: picklist(['connected', 'level_up', 'zone', 'death', 'revive', 'combat_start', 'combat_end', 'offline']),
  timestamp: string(),
  title: label,
  detail: pipe(string(), maxLength(2048)),
  snapshot: nullable(snapshotSchema),
  demo: boolean(),
})

export const captureSchema = object({
  x: pipe(number(), integer(), minValue(-32768), maxValue(32767)),
  y: pipe(number(), integer(), minValue(-32768), maxValue(32767)),
  cellSize: pipe(number(), integer(), minValue(1), maxValue(12)),
  pollMs: pipe(number(), integer(), minValue(250), maxValue(5000)),
  paused: boolean(),
})

export const bridgeSchema = looseObject({
  // Retail 2.2 remains a supported bridge. Its status response omits these fields.
  game: optional(gameVersionSchema),
  protocol: optional(picklist(['WCP1', 'WCF1'])),
  instanceId: label,
  status: picklist(['live', 'stale', 'waiting', 'demo', 'paused']),
  source: picklist(['screen', 'demo']),
  snapshot: nullable(snapshotSchema),
  lastSeen: nullable(string()),
  ageSeconds: nullable(pipe(number(), finite())),
  eventCursor: count,
  events: pipe(array(eventSchema), maxLength(500)),
  // Published bridges without equipment support remain a supported source of character observations.
  equipment: optional(pipe(array(equipmentSchema), maxLength(10))),
  equipmentError: optional(nullable(pipe(string(), maxLength(2048)))),
  // Published bridges without confirmation results remain supported for their existing observations.
  equipmentSwaps: optional(equipmentSwapsSchema),
  equipmentSwapError: optional(nullable(pipe(string(), maxLength(2048)))),
  // Bridges without offers still provide character observations and equipment history.
  equipmentOffer: optional(nullable(equipmentOfferSchema)),
  equipmentOfferError: optional(nullable(pipe(string(), maxLength(2048)))),
  config: captureSchema,
  error: nullable(string()),
})

/** Persisted user choices. Demo forwarding is separate from synthetic capture. */
export const settingsSchema = object({
  enabled: boolean(),
  muted: boolean(),
  quietInCombat: boolean(),
  allowDemo: boolean(),
  levelUp: boolean(),
  zone: boolean(),
  death: boolean(),
  revive: boolean(),
  cooldownSeconds: pipe(number(), integer(), minValue(0), maxValue(300)),
})

export type Snapshot = InferOutput<typeof snapshotSchema>
export type CompanionEvent = InferOutput<typeof eventSchema>
export type CaptureSettings = InferOutput<typeof captureSchema>
export type BridgeStatus = InferOutput<typeof bridgeSchema>
export type CompanionSettings = InferOutput<typeof settingsSchema>

export const defaultSettings: CompanionSettings = {
  enabled: true,
  muted: false,
  quietInCombat: true,
  allowDemo: false,
  levelUp: true,
  zone: true,
  death: true,
  revive: true,
  cooldownSeconds: 20,
}

/** Main owns this cache. A null bridge or an error means no current game observation. */
export interface CompanionState {
  game: GameVersion
  settings: CompanionSettings
  bridge: BridgeStatus | null
  error: string | null
  updatedAt: number
  gold: GoldState
  equipmentHistory: EquipmentHistoryState
}

export const demoSchema = object({
  enabled: boolean(),
  action: picklist(['none', 'level_up', 'zone', 'death', 'revive', 'combat']),
})

export type DemoRequest = InferOutput<typeof demoSchema>

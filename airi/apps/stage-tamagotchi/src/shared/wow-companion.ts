import type { InferOutput } from 'valibot'

import { array, boolean, finite, integer, literal, looseObject, maxLength, maxValue, minValue, nullable, number, object, picklist, pipe, string } from 'valibot'

const count = pipe(number(), integer(), minValue(0))
const label = pipe(string(), maxLength(256))

/** Validated observations from the local WCP1 screen decoder. */
export const snapshotSchema = looseObject({
  v: literal(1),
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
  instanceId: label,
  status: picklist(['live', 'stale', 'waiting', 'demo', 'paused']),
  source: picklist(['screen', 'demo']),
  snapshot: nullable(snapshotSchema),
  lastSeen: nullable(string()),
  ageSeconds: nullable(pipe(number(), finite())),
  eventCursor: count,
  events: pipe(array(eventSchema), maxLength(500)),
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
  settings: CompanionSettings
  bridge: BridgeStatus | null
  error: string | null
  updatedAt: number
}

export const demoSchema = object({
  enabled: boolean(),
  action: picklist(['none', 'level_up', 'zone', 'death', 'revive', 'combat']),
})

export type DemoRequest = InferOutput<typeof demoSchema>

import type { BridgeStatus, CompanionEvent, Snapshot } from '../../shared/wow-companion'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { bridgeSchema, captureSchema, defaultSettings, eventSchema, settingsSchema, snapshotSchema } from '../../shared/wow-companion'
import { CompanionPolicy } from './wow-companion-policy'

const now = Date.parse('2026-10-22T10:00:00Z')
const snapshot: Snapshot = {
  v: 3,
  session: 'login-1',
  seq: 1,
  tick: 1,
  guid: 'Player-1',
  name: '旅人',
  realm: '艾泽拉斯',
  level: 29,
  class: 'MAGE',
  faction: 'Alliance',
  race: '人类',
  spec: 64,
  map: 84,
  zone: '暴风城',
  combat: false,
  dead: false,
  online: true,
  account: 'account-1',
  moneyEpoch: 'money-1',
  copper: 12345,
  earned: 0,
  spent: 0,
}

function event(id: number, type: CompanionEvent['type'] = 'level_up', overrides: Partial<CompanionEvent> = {}): CompanionEvent {
  return { id, type, timestamp: new Date(now).toISOString(), title: '升级', detail: '29 → 30', snapshot: { ...snapshot, level: 30 }, demo: false, ...overrides }
}

function bridge(events: CompanionEvent[] = [], overrides: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    instanceId: 'decoder-1',
    status: 'live',
    source: 'screen',
    snapshot: { ...snapshot },
    lastSeen: new Date(now).toISOString(),
    ageSeconds: 0,
    eventCursor: events.at(-1)?.id ?? 0,
    events,
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    inventory: null,
    inventoryReceivedAt: null,
    inventoryError: null,
    quests: null,
    questsReceivedAt: null,
    questsError: null,
    talents: null,
    talentsReceivedAt: null,
    talentsError: null,
    config: { x: 8, y: 8, cellSize: 2, pollMs: 500, paused: false },
    error: null,
    ...overrides,
  }
}

describe('woW companion notification policy', () => {
  it('establishes a baseline and emits one upgrade only once', () => {
    const policy = new CompanionPolicy()
    expect(policy.accept(bridge([event(1)]), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(1), event(2)]), defaultSettings, now)?.id).toBe(2)
    expect(policy.accept(bridge([event(1), event(2)]), defaultSettings, now + 1000)).toBeUndefined()
  })

  it('does not replay after restart with an equal cursor or after a character switch', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), defaultSettings, now)?.id).toBe(1)
    expect(policy.accept(bridge([event(1)], { instanceId: 'decoder-2' }), defaultSettings, now + 30_000)).toBeUndefined()
    expect(policy.accept(bridge([event(2)], { snapshot: { ...snapshot, guid: 'Player-2' } }), defaultSettings, now + 30_000)).toBeUndefined()
  })

  it('drops stale observations and establishes a fresh baseline after reconnect', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)], { status: 'stale' }), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(1), event(2)]), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(3)]), defaultSettings, now)?.id).toBe(3)
  })

  it('keeps an upgrade during combat and emits it when combat ends', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    const fighting = bridge([event(1)], { snapshot: { ...snapshot, combat: true } })
    expect(policy.accept(fighting, defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(1), event(2, 'zone')]), defaultSettings, now + 1000)?.type).toBe('level_up')
  })

  it('discards old deferred reactions instead of speaking after a long fight', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    policy.accept(bridge([event(1)], { snapshot: { ...snapshot, combat: true } }), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), defaultSettings, now + 31_000)).toBeUndefined()
  })

  it('does not accumulate muted notifications', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), { ...defaultSettings, muted: true }, now)).toBeUndefined()
    expect(policy.accept(bridge([event(1)]), defaultSettings, now + 1000)).toBeUndefined()
  })

  it('requires explicit opt-in for demo reactions', () => {
    const policy = new CompanionPolicy()
    const demo = { status: 'demo' as const, source: 'demo' as const }
    policy.accept(bridge([], demo), defaultSettings, now)
    expect(policy.accept(bridge([event(1, 'level_up', { demo: true })], demo), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(2, 'level_up', { demo: true })], demo), { ...defaultSettings, allowDemo: true }, now)?.id).toBe(2)
  })

  it('holds one event through the cooldown and honors changes to its switch', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), defaultSettings, now)?.id).toBe(1)
    expect(policy.accept(bridge([event(2, 'zone')]), defaultSettings, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([event(2, 'zone')]), { ...defaultSettings, zone: false }, now + 20_000)).toBeUndefined()
  })

  it('ignores unknown maps, foreign sessions, and implausible event times', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1, 'zone', { snapshot: { ...snapshot, map: 0 } })]), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(2, 'level_up', { snapshot: { ...snapshot, session: 'other' } })]), defaultSettings, now)).toBeUndefined()
    expect(policy.accept(bridge([event(3, 'level_up', { timestamp: 'not-a-date' })]), defaultSettings, now)).toBeUndefined()
  })

  it('keeps money updates silent without a companion event', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([], { snapshot: { ...snapshot, seq: 2, copper: 22345, earned: 10000 } }), defaultSettings, now + 1000)).toBeUndefined()
  })

  it('keeps coordinate-only movement silent while preserving later real events', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge([], { snapshot: { ...snapshot, px: 1234, py: 5678 } }), defaultSettings, now)
    expect(policy.accept(bridge([], { snapshot: { ...snapshot, seq: 2, tick: 2, px: 1250, py: 5700 } }), defaultSettings, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([event(1)], { snapshot: { ...snapshot, seq: 3, tick: 3, px: 1250, py: 5700 } }), defaultSettings, now + 2000)?.type).toBe('level_up')
  })
})

describe('event telemetry notices', () => {
  const fighting = { ...snapshot, combat: true, loginId: 'login-combat', combatEnds: 1 }
  const healthEvent = event(2, 'low_health', { healthPercent: 19, snapshot: fighting })
  const lootEvent = event(1, 'loot', { itemId: 117, itemName: 'Tough Jerky', quantity: 2, snapshot: fighting })

  it('plays a low-health alert in combat despite the ordinary cooldown', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), defaultSettings, now)?.type).toBe('level_up')
    const combat = bridge([healthEvent], { snapshot: fighting })
    expect(policy.accept(combat, defaultSettings, now + 1000)).toEqual(healthEvent)
    expect(policy.accept(combat, defaultSettings, now + 2000)).toBeUndefined()
  })

  it.each([
    { ...fighting, combat: false },
    { ...fighting, combatEnds: 2 },
    { ...fighting, dead: true },
  ])('discards an alert after its fight ends: %j', (current) => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([healthEvent], { snapshot: current }), defaultSettings, now + 1000)).toBeUndefined()
  })

  it('plays a recent alert while login progress arrives on its separate frame', () => {
    const policy = new CompanionPolicy()
    const alert = { ...healthEvent, snapshot: { ...snapshot, combat: true } }
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([alert], { snapshot: fighting }), defaultSettings, now + 1000)).toEqual(alert)
  })

  it('discards old or muted health alerts', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([healthEvent], { snapshot: fighting }), { ...defaultSettings, muted: true }, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([{ ...healthEvent, id: 3 }], { snapshot: fighting }), defaultSettings, now + 12_000)).toBeUndefined()
  })

  it('plays a loot notice once after combat and keeps the measured quantity', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([lootEvent], { snapshot: fighting }), defaultSettings, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([lootEvent], { snapshot: { ...fighting, combat: false } }), defaultSettings, now + 2000)).toEqual(lootEvent)
    expect(policy.accept(bridge([lootEvent]), defaultSettings, now + 3000)).toBeUndefined()
  })

  it('validates threshold and loot data at the bridge boundary', () => {
    expect(parse(eventSchema, healthEvent).healthPercent).toBe(19)
    expect(parse(eventSchema, { ...lootEvent, itemName: null }).itemName).toBeNull()
    expect(() => parse(eventSchema, { ...healthEvent, healthPercent: 20 })).toThrow()
    expect(() => parse(eventSchema, { ...healthEvent, healthPercent: undefined })).toThrow()
    expect(() => parse(eventSchema, { ...lootEvent, itemId: 0 })).toThrow()
    expect(() => parse(eventSchema, { ...lootEvent, quantity: 1.5 })).toThrow()
    expect(() => parse(eventSchema, { ...lootEvent, itemName: undefined })).toThrow()
    expect(parse(bridgeSchema, { ...bridge(), needsProfile: true }).needsProfile).toBe(true)
  })
})

describe('area level warnings', () => {
  const destination = { ...snapshot, map: 1434, zone: '荆棘谷', instanceType: 'none' as const }
  const warning = event(2, 'level_gate', { snapshot: destination, playerLevel: 28, minimumLevel: 30 })

  it('accepts the first warning after a same-session map load during the ordinary cooldown', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    expect(policy.accept(bridge([event(1)]), defaultSettings, now)?.type).toBe('level_up')
    const loading = bridge([event(1)], { status: 'waiting', snapshot: { ...snapshot, online: false } })
    expect(policy.accept(loading, defaultSettings, now + 1000)).toBeUndefined()
    const arrival = bridge([event(1), warning], { snapshot: destination })
    expect(policy.accept(arrival, defaultSettings, now + 2000)).toEqual(warning)
    expect(policy.accept(arrival, defaultSettings, now + 3000)).toBeUndefined()
  })

  it('drops a warning deferred by combat when the character leaves the area', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), defaultSettings, now)
    const fighting = bridge([warning], { snapshot: { ...destination, combat: true } })
    expect(policy.accept(fighting, defaultSettings, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([warning]), defaultSettings, now + 2000)).toBeUndefined()
    expect(policy.accept(bridge([warning], { snapshot: destination }), defaultSettings, now + 3000)).toBeUndefined()
  })

  it('requires a measured level below the area minimum and an outdoor observation', () => {
    expect(parse(eventSchema, warning).playerLevel).toBe(28)
    expect(() => parse(eventSchema, { ...warning, playerLevel: 30 })).toThrow()
    expect(() => parse(eventSchema, { ...warning, playerLevel: undefined })).toThrow()
    expect(() => parse(eventSchema, { ...warning, snapshot: { ...destination, instanceType: 'party' } })).toThrow()
  })
})

describe('death interaction lifecycle', () => {
  const settings = { ...defaultSettings, cooldownSeconds: 0, death: true, revive: true, quietInCombat: true }

  it('responds once per death and permits a new response after resurrection', () => {
    const policy = new CompanionPolicy()
    policy.accept(bridge(), settings, now)
    const dead = { ...snapshot, dead: true, combat: true }
    expect(policy.accept(bridge([event(1, 'death', { snapshot: dead })], { snapshot: dead }), settings, now)?.type).toBe('death')
    expect(policy.accept(bridge([event(2, 'death', { snapshot: dead })], { snapshot: dead }), settings, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([event(3, 'revive')]), settings, now + 2000)?.type).toBe('revive')
    expect(policy.accept(bridge([event(4, 'death', { snapshot: dead })], { snapshot: dead }), settings, now + 3000)?.type).toBe('death')
  })

  it('does not replay death when the owner connects to an already dead character', () => {
    const policy = new CompanionPolicy()
    const dead = { ...snapshot, dead: true }
    policy.accept(bridge([], { snapshot: dead }), settings, now)
    expect(policy.accept(bridge([event(1, 'death', { snapshot: dead })], { snapshot: dead }), settings, now + 1000)).toBeUndefined()
  })

  it('honors death switches and mute', () => {
    const dead = { ...snapshot, dead: true }
    for (const disabled of [{ ...settings, death: false }, { ...settings, muted: true }]) {
      const policy = new CompanionPolicy()
      policy.accept(bridge(), disabled, now)
      expect(policy.accept(bridge([event(1, 'death', { snapshot: dead })], { snapshot: dead }), disabled, now)).toBeUndefined()
    }
  })

  it('discards a pending death when the character revives during cooldown', () => {
    const policy = new CompanionPolicy()
    const cooldown = { ...settings, cooldownSeconds: 10 }
    const dead = { ...snapshot, dead: true }
    policy.accept(bridge(), cooldown, now)
    policy.accept(bridge([event(1)]), cooldown, now)
    expect(policy.accept(bridge([event(2, 'death', { snapshot: dead })], { snapshot: dead }), cooldown, now + 1000)).toBeUndefined()
    expect(policy.accept(bridge([event(3, 'revive')]), cooldown, now + 10_000)?.type).toBe('revive')
  })
})

describe('woW companion input boundary', () => {
  it('accepts map coordinate boundaries and normalizes published snapshots without a pair', () => {
    for (const [px, py] of [[0, 10000], [10000, 0], [1234, 5678]]) {
      const observation = parse(snapshotSchema, { ...snapshot, px, py })
      expect(observation.px).toBe(px)
      expect(observation.py).toBe(py)
    }
    expect(parse(snapshotSchema, snapshot)).toMatchObject({ px: null, py: null })
    expect(parse(snapshotSchema, { ...snapshot, px: null, py: null })).toMatchObject({ px: null, py: null })
  })

  it.each([
    { px: null },
    { py: null },
    { px: 1 },
    { py: 1 },
    { px: null, py: 1 },
    { px: 1, py: null },
    { px: undefined, py: undefined },
    { px: -1, py: 0 },
    { px: 10001, py: 0 },
    { px: 0.5, py: 0 },
    { px: Number.NaN, py: 0 },
    { px: Number.POSITIVE_INFINITY, py: 0 },
    { px: true, py: 0 },
    { px: '1234', py: 5678 },
  ])('rejects malformed or incomplete map coordinates: %j', (coordinates) => {
    expect(() => parse(snapshotSchema, { ...snapshot, ...coordinates })).toThrow()
    expect(() => parse(snapshotSchema, { ...snapshot, online: false, ...coordinates })).toThrow()
  })

  it.each([{ map: 0 }, { online: false }])('clears otherwise valid coordinates when their map observation is unavailable: %j', (change) => {
    expect(parse(snapshotSchema, { ...snapshot, px: 1234, py: 5678, ...change })).toMatchObject({ px: null, py: null })
  })

  it('accepts fast capture intervals and enforces the polling bounds', () => {
    const capture = { x: 8, y: 8, cellSize: 1, pollMs: 100, paused: false }
    expect(parse(captureSchema, capture).pollMs).toBe(100)
    expect(parse(captureSchema, { ...capture, pollMs: 5000 }).pollMs).toBe(5000)
    for (const pollMs of [99, 100.5, 5001])
      expect(() => parse(captureSchema, { ...capture, pollMs })).toThrow()
  })

  it.each(['Alliance', 'Horde', 'Neutral', null] as const)('accepts the reported faction %s without inferring it from Pandaren', (faction) => {
    expect(parse(snapshotSchema, { ...snapshot, faction, race: '熊猫人' }).faction).toBe(faction)
    expect(parse(snapshotSchema, { ...snapshot, faction, race: null }).race).toBeNull()
  })

  it.each([
    { v: 2 },
    { faction: undefined },
    { faction: 'Unknown' },
    { faction: 'horde' },
    { race: undefined },
    { race: '' },
    { race: '熊'.repeat(17) },
    { race: '人\n类' },
    { race: '人\u007F类' },
    { race: '人\u0085类' },
    { race: '\uD800' },
  ])('rejects invalid identity observations: %j', (changes) => {
    expect(() => parse(snapshotSchema, { ...snapshot, ...changes })).toThrow()
  })

  it('accepts a race label at the UTF-8 byte limit', () => {
    expect(parse(snapshotSchema, { ...snapshot, race: '熊'.repeat(16) }).race).toBe('熊'.repeat(16))
  })

  it('accepts the bridge contract and rejects invalid control values', () => {
    expect(parse(bridgeSchema, bridge()).snapshot?.name).toBe('旅人')
    expect(() => parse(settingsSchema, { ...defaultSettings, cooldownSeconds: -1 })).toThrow()
    expect(() => parse(bridgeSchema, bridge([], { snapshot: { ...snapshot, level: -1 } }))).toThrow()
  })
})

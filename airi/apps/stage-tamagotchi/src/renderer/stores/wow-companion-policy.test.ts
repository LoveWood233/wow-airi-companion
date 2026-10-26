import type { BridgeStatus, CompanionEvent, Snapshot } from '../../shared/wow-companion'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { bridgeSchema, captureSchema, defaultSettings, settingsSchema, snapshotSchema } from '../../shared/wow-companion'
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
})

describe('woW companion input boundary', () => {
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

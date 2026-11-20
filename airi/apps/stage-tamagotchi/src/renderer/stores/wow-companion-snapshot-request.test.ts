import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { characterSnapshotKind, snapshotUnavailable } from './wow-companion-snapshot-request'

describe('character snapshot recovery', () => {
  it.each([
    ['装备如何', 'equipment'],
    ['我当前有多少金币', 'gold'],
    ['我几级了', 'level'],
    ['我的背包材料', 'inventory'],
    ['我当前天赋如何', 'talents'],
    ['任务日志', 'quests'],
    ['我的经验还差多少', 'experience'],
    ['副本重置时间', 'lockouts'],
    ['今天的日程', 'schedule'],
    ['我有多少声望', 'reputation'],
    ['我学了哪些配方', 'professions'],
    ['我完成了哪些成就', 'achievements'],
    ['探索进度', 'exploration'],
    ['银行库存', 'bank'],
  ])('recognizes %s as %s', (text, kind) => {
    expect(characterSnapshotKind(text)).toBe(kind)
  })

  it.each(['你好', '瑟银锭配方', '装备哪里掉落', '推荐战士天赋', '金币拍卖价格'])('does not require personal snapshots for %s', (text) => {
    expect(characterSnapshotKind(text)).toBeUndefined()
  })

  it('requires a current matching complete loadout and still accepts a known zero balance', () => {
    const state = loadoutStateFixture()
    const bridge = state.bridge!
    const current = { game: state.game, snapshot: bridge.snapshot! }
    const now = Date.now()
    bridge.equipmentLoadout!.slots[1] = { slot: 2, state: 'empty', item: null }
    expect(snapshotUnavailable('equipment', [state], current, now)).toBe(false)
    bridge.snapshot!.copper = 0
    expect(snapshotUnavailable('gold', [state], current, now)).toBe(false)
    bridge.snapshot!.copper = null
    expect(snapshotUnavailable('gold', [state], current, now)).toBe(true)
    bridge.equipmentLoadout!.session = 'old-session'
    expect(snapshotUnavailable('equipment', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('equipment', [state], undefined, now)).toBe(true)
  })

  it('does not let a fresh pulse renew the login profile or equipment observation', () => {
    const state = loadoutStateFixture()
    const bridge = state.bridge!
    const now = Date.now()
    const snapshot = bridge.snapshot!
    const current = { game: state.game, snapshot }
    bridge.equipmentLoadout!.slots[1] = { slot: 2, state: 'empty', item: null }
    snapshot.profileObservedAt = now - 60_000
    bridge.equipmentLoadout!.observedAt = Math.floor(now / 1000) - 60
    expect(snapshotUnavailable('equipment', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('level', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('gold', [state], current, now)).toBe(true)
    snapshot.profileObservedAt = now
    bridge.equipmentLoadout!.observedAt = Math.floor(now / 1000)
    expect(snapshotUnavailable('equipment', [state], current, now)).toBe(false)
    expect(snapshotUnavailable('level', [state], current, now)).toBe(false)
    expect(snapshotUnavailable('gold', [state], current, now)).toBe(false)
  })

  it('uses the latest matching low-frequency record even when the profile heartbeat carries an older level and balance', () => {
    const state = loadoutStateFixture()
    const bridge = state.bridge!
    const now = Date.now()
    const player = bridge.snapshot!
    const current = { game: state.game, snapshot: player }
    player.profileObservedAt = now - 740_000
    bridge.lowFrequency = true
    bridge.archive = {
      progress: {
        v: 1,
        id: 1,
        section: 'progress',
        session: player.session,
        guid: player.guid,
        observedAt: Math.floor(now / 1000) - 720,
        data: { level: 31, xp: 4, xpMax: 100, copper: '0' },
      },
    }
    expect(snapshotUnavailable('level', [state], current, now)).toBe(false)
    expect(snapshotUnavailable('experience', [state], current, now)).toBe(false)
    expect(snapshotUnavailable('gold', [state], current, now)).toBe(false)
    const progress = bridge.archive.progress!
    progress.guid = 'another-player'
    expect(snapshotUnavailable('experience', [state], current, now)).toBe(true)
  })

  it('rejects missing, partial, stale, and error observations without consulting historical equipment', () => {
    const state = loadoutStateFixture()
    const current = { game: state.game, snapshot: state.bridge!.snapshot! }
    const now = Date.now()
    expect(snapshotUnavailable('equipment', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('inventory', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('talents', [state], current, now)).toBe(true)
    expect(snapshotUnavailable('quests', [state], current, now)).toBe(true)
    state.bridge!.status = 'stale'
    expect(snapshotUnavailable('level', [state], current, now)).toBe(true)
  })
})

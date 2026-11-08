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

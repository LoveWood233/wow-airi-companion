import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

import { loadoutBridgeFixture, loadoutFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { CompanionLoadouts } from './wow-companion-loadouts'

describe('persistent equipped-item snapshots', () => {
  let file: string
  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'airi-loadouts-'))
    file = join(directory, 'loadouts.json')
    onTestFinished(async () => {
      if (!resolve(directory).startsWith(resolve(tmpdir(), 'airi-loadouts-')))
        throw new Error('Refusing cleanup outside the loadout test prefix')
      await rm(directory, { recursive: true, force: true })
    })
  })

  it('saves all slots across restart and caches immutable repeated observations', async () => {
    const store = new CompanionLoadouts(file)
    const bridge = loadoutBridgeFixture()
    await store.observe(bridge)
    const view = store.read()
    await store.observe(bridge)
    expect(store.read()).toBe(view)
    expect(view.entries[0].loadout.slots).toHaveLength(19)
    expect(view.entries[0].loadout.slots[1].state).toBe('unknown')
    expect(view.entries[0].loadout.slots[2].state).toBe('empty')
    expect(Object.isFrozen(view.entries[0].loadout.slots)).toBe(true)
    const restarted = new CompanionLoadouts(file)
    await restarted.load()
    expect(restarted.read().entries).toEqual(view.entries)
    await restarted.observe(bridge)
    expect(restarted.read().latestCharacter?.loginObservedAt).toBe(view.latestCharacter?.loginObservedAt)
  })

  it('keeps more than ten characters and separates accounts with the same GUID', async () => {
    const store = new CompanionLoadouts(file)
    for (let i = 0; i < 13; i++)
      await store.observe(loadoutBridgeFixture(loadoutFixture({ guid: `Player-${i}` })))
    const alternateAccount = loadoutBridgeFixture()
    alternateAccount.snapshot!.account = 'another-account'
    await store.observe(alternateAccount)
    expect(store.read().entries).toHaveLength(14)
    expect(store.read().entries.filter(entry => entry.loadout.guid === 'Player-1')).toHaveLength(2)
  })

  it('replaces the whole revision and accepts a lower ID in a new matching session', async () => {
    const store = new CompanionLoadouts(file)
    await store.observe(loadoutBridgeFixture(loadoutFixture({ id: 10 })))
    const next = loadoutFixture({ id: 11, reason: 'equipment_changed' })
    next.slots[0] = { slot: 1, state: 'empty', item: null }
    await store.observe(loadoutBridgeFixture(next))
    await store.observe(loadoutBridgeFixture(loadoutFixture({ id: 9 })))
    expect(store.read().entries).toHaveLength(1)
    expect(store.read().entries[0].loadout.id).toBe(11)
    expect(store.read().entries[0].loadout.slots[0].item).toBeNull()
    await store.observe(loadoutBridgeFixture(loadoutFixture({ session: 'new-login' })))
    expect(store.read().entries[0].loadout.id).toBe(1)
    expect(store.read().entries[0].loadout.session).toBe('new-login')
  })

  it.each(['demo', 'stale', 'offline', 'capture-error', 'loadout-error', 'mismatch', 'partial'] as const)('ignores %s equipment', async (kind) => {
    const store = new CompanionLoadouts(file)
    const bridge = loadoutBridgeFixture()
    if (kind === 'demo') {
      bridge.status = 'demo'
      bridge.source = 'demo'
    }
    if (kind === 'stale')
      bridge.status = 'stale'
    if (kind === 'offline')
      bridge.snapshot!.online = false
    if (kind === 'capture-error')
      bridge.error = 'obscured'
    if (kind === 'loadout-error')
      bridge.equipmentLoadoutError = 'invalid'
    if (kind === 'mismatch')
      bridge.snapshot!.guid = 'Player-another'
    if (kind === 'partial')
      bridge.equipmentLoadout = null
    await store.observe(bridge)
    expect(store.read().entries).toHaveLength(0)
  })

  it('records a new character before its equipment arrives and does not promote old sessions on recovery', async () => {
    const store = new CompanionLoadouts(file)
    const first = loadoutBridgeFixture()
    await store.observe(first)
    const newCharacter = loadoutBridgeFixture(loadoutFixture({ guid: 'Player-new', session: 'new-login' }))
    newCharacter.equipmentLoadout = null
    await store.observe(newCharacter)
    const latest = store.read().latestCharacter
    expect(latest?.guid).toBe('Player-new')
    await store.observe(first)
    expect(store.read().latestCharacter).toEqual(latest)
    expect(store.read().entries).toHaveLength(1)
  })

  it('rejects known old sessions after a new login, before and after desktop restart', async () => {
    const store = new CompanionLoadouts(file)
    await store.observe(loadoutBridgeFixture(loadoutFixture({ id: 10, session: 'old-login' })))
    const pending = loadoutBridgeFixture(loadoutFixture({ session: 'new-login' }))
    pending.equipmentLoadout = null
    await store.observe(pending)
    await store.observe(loadoutBridgeFixture(loadoutFixture({ id: 11, session: 'old-login' })))
    expect(store.read().entries[0].loadout.id).toBe(10)
    await store.observe(loadoutBridgeFixture(loadoutFixture({ session: 'new-login' })))
    const restarted = new CompanionLoadouts(file)
    await restarted.load()
    await restarted.observe(loadoutBridgeFixture(loadoutFixture({ id: 12, session: 'old-login' })))
    expect(restarted.read().entries[0].loadout.session).toBe('new-login')
    expect(restarted.read().entries[0].loadout.id).toBe(1)
  })

  it('keeps corrupt files intact and exposes the storage failure', async () => {
    await writeFile(file, '{broken', 'utf8')
    const store = new CompanionLoadouts(file)
    await store.observe(loadoutBridgeFixture())
    expect(store.read().storageError).toContain('Cannot load')
    expect(store.read().entries).toHaveLength(0)
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })
})

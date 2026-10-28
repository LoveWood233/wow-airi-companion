import type { InstalledAddon } from '../../../shared/wow-addons'

import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { WowAddonSettings } from './wow-addons-settings'

const directories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wow-addons-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  const secrets = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from([8, 3, 4, 1])),
    decryptString: vi.fn(() => 'example-credential'),
  }
  return { path, secrets, store: new WowAddonSettings(path, secrets) }
}

function receipt(clientDirectory = 'client-one'): InstalledAddon {
  return {
    game: 'retail',
    clientDirectory,
    modId: 1,
    fileId: 2,
    name: 'Bags',
    version: '2',
    gameVersionTypeId: 517,
    folders: ['Bags'],
    installedAt: '2026-10-27T00:00:00.000Z',
  }
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('woW addon settings', () => {
  it('persists an encrypted key and restores only its status to the renderer', () => {
    const { path, secrets, store } = fixture()
    const value = store.save({ apiKey: 'example-credential', clients: store.read().clients })
    expect(value.hasApiKey).toBe(true)
    expect(value).not.toHaveProperty('apiKey')
    expect(readFileSync(path, 'utf8')).not.toContain('example-credential')
    const restored = new WowAddonSettings(path, secrets)
    expect(restored.apiKey()).toBe('example-credential')
    expect(secrets.decryptString).toHaveBeenCalledWith(Buffer.from([8, 3, 4, 1]))
  })

  it('preserves a key during path edits and removes it only on explicit clear', () => {
    const { store } = fixture()
    store.save({ apiKey: 'example-credential', clients: store.read().clients })
    const clients = store.read().clients
    clients.classic = { directory: 'classic-client', gameVersionTypeId: 22 }
    expect(store.save({ clients, apiKey: '' }).hasApiKey).toBe(true)
    expect(store.read().clients.classic.directory).toBe('classic-client')
    expect(store.save({ clients, clearApiKey: true }).hasApiKey).toBe(false)
    expect(() => store.apiKey()).toThrow('curseforge-api-key-required')
  })

  it('refuses to store a new key without OS encryption', () => {
    const { store, secrets } = fixture()
    secrets.isEncryptionAvailable.mockReturnValue(false)
    expect(() => store.save({ apiKey: 'example-credential', clients: store.read().clients })).toThrow('wow-addons-key-storage-unavailable')
    expect(store.read().hasApiKey).toBe(false)
    expect(secrets.encryptString).not.toHaveBeenCalled()
  })

  it('keeps ownership isolated by client directory and updates only the matching project receipt', () => {
    const { store, path, secrets } = fixture()
    store.recordInstallation(receipt())
    store.recordInstallation(receipt('client-two'))
    store.recordInstallation({ ...receipt(), fileId: 3 })
    const restored = new WowAddonSettings(path, secrets)
    expect(restored.installed('retail')).toHaveLength(2)
    expect(restored.installed('retail').find(item => item.clientDirectory === 'client-one')?.fileId).toBe(3)
    expect(restored.installed('classic')).toHaveLength(0)
    const copy = restored.installed('retail')
    copy[0].folders.push('Unrelated')
    expect(restored.installed('retail')[0].folders).not.toContain('Unrelated')
  })

  it('preserves an invalid settings file instead of replacing its ownership records', () => {
    const { path, secrets } = fixture()
    writeFileSync(path, '{broken')
    const restored = new WowAddonSettings(path, secrets)
    expect(() => restored.read()).toThrow('wow-addons-settings-invalid')
    expect(() => restored.recordInstallation(receipt())).toThrow('wow-addons-settings-invalid')
    expect(readFileSync(path, 'utf8')).toBe('{broken')
  })

  it('reports an unreadable encrypted key without exposing the storage exception', () => {
    const { store, secrets } = fixture()
    store.save({ apiKey: 'example-credential', clients: store.read().clients })
    secrets.decryptString.mockImplementation(() => {
      throw new Error('private storage details')
    })
    expect(() => store.apiKey()).toThrow('wow-addons-key-unreadable')
  })
})

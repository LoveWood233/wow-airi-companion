import type { ChatSessionRecord, ChatSessionsIndex } from '@proj-airi/stage-ui/types/chat-session'

import { chatAssetsRepo } from '@proj-airi/stage-ui/database/repos/chat-assets.repo'
import { localStorageKeys, storage } from '@proj-airi/stage-ui/database/storage'
import { chatAssetRef, storeChatAsset } from '@proj-airi/stage-ui/libs/chat-assets'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BrowserBackupStorage } from './wow-browser-backup'

const meta = { sessionId: 'backup-test-session', userId: 'backup-test-user', characterId: 'backup-test-card', createdAt: 1, updatedAt: 2, cloudChatId: 'remote', cloudMaxSeq: 10, recipeId: 'recipe', task: { status: 'running' as const, startedAt: 1 }, hidden: true }
const indexKey = `local:chat:index:${meta.userId}`
const sessionKey = `local:chat:sessions:${meta.sessionId}`
const outboxKey = 'outbox:backup-test-send'
const preferences = ['airi-cards', 'settings/language', 'settings/providers/openai/apiKey']
const boundary = new BrowserBackupStorage()

async function clear() {
  for (const key of await localStorageKeys()) {
    if (key === indexKey || key === sessionKey || key.startsWith('local:chat:sessions:restored-'))
      await storage.removeItem(key)
  }
  await storage.removeItem(outboxKey)
  await chatAssetsRepo.releaseOwner(meta.sessionId)
  preferences.forEach(key => localStorage.removeItem(key))
}

async function seed(record: ChatSessionRecord = { meta, messages: [{ role: 'user', content: 'hello' }] }) {
  const index: ChatSessionsIndex = { userId: meta.userId, characters: { [meta.characterId]: { activeSessionId: meta.sessionId, sessions: { [meta.sessionId]: meta } } } }
  await storage.setItemRaw(indexKey, index)
  await storage.setItemRaw(sessionKey, record)
  await storage.setItemRaw(outboxKey, { pending: true })
}

beforeEach(clear)
afterEach(clear)

describe('saved browser backup with real IndexedDB', () => {
  it('enumerates canonical local keys without reading or including send queues', async () => {
    await seed()
    const keys = await localStorageKeys()
    expect(keys).toContain(indexKey)
    expect(keys).toContain(sessionKey)
    expect(keys).not.toContain(outboxKey)
    expect(keys.some(key => key.includes('airi-local'))).toBe(false)
    expect((await boundary.read(false, true)).chats).toBeNull()
    const snapshot = await boundary.read(true, true)
    expect(snapshot.chats?.map(([key]) => key)).toEqual([indexKey, sessionKey])
  })

  it('excludes credential settings and scrubs structured persona credentials', async () => {
    localStorage.setItem('airi-cards', JSON.stringify({ prompt: 'hello', options: { token: 'private', api_key: 'private', name: 'Hero' } }))
    localStorage.setItem('settings/providers/openai/apiKey', 'keep-secret')
    const snapshot = await boundary.read(false, true)
    expect(JSON.stringify(snapshot)).not.toContain('private')
    expect(JSON.stringify(snapshot)).not.toContain('keep-secret')
    await boundary.apply({ preferences: [['settings/language', '"en"']], chats: null }, { settings: true, history: false, chats: false }, false)
    expect(localStorage.getItem('airi-cards')).toBeNull()
    expect(localStorage.getItem('settings/providers/openai/apiKey')).toBe('keep-secret')
  })

  it('does not read unrelated malformed settings when only history is selected', async () => {
    localStorage.setItem('airi-cards', '{broken')
    expect(await boundary.read(false, true, false)).toEqual({ preferences: [], chats: null })
  })

  it('inlines actual attachment bytes and adds local chat copies without changing existing sessions or queues', async () => {
    const ref = await storeChatAsset(new Uint8Array([1, 2, 3]), 'image/png', meta.sessionId)
    await seed({ meta, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: ref } }] }] })
    const snapshot = await boundary.read(true, true)
    expect(JSON.stringify(snapshot)).toContain('data:image/png;base64,AQID')
    expect(JSON.stringify(snapshot)).not.toContain(ref)
    await boundary.apply(snapshot, { settings: false, history: false, chats: true }, false)
    const keys = await localStorageKeys()
    const restoredKey = keys.find(key => key.startsWith('local:chat:sessions:restored-'))!
    expect(restoredKey).toBeTruthy()
    const record = await storage.getItemRaw<ChatSessionRecord>(restoredKey)
    expect(record?.meta.bindings).toEqual(['backup-local'])
    expect(record?.meta.cloudChatId).toBeUndefined()
    expect(record?.meta.task).toBeUndefined()
    expect(record?.meta.recipeId).toBeUndefined()
    expect(record?.meta.hidden).toBe(false)
    expect((await storage.getItemRaw<ChatSessionRecord>(sessionKey))?.meta).toEqual(meta)
    expect(await storage.getItemRaw(outboxKey)).toEqual({ pending: true })
    const index = await storage.getItemRaw<ChatSessionsIndex>(indexKey)
    expect(Object.keys(index!.characters[meta.characterId].sessions)).toHaveLength(2)
    expect(index?.characters[meta.characterId].activeSessionId).toBe(meta.sessionId)
  })

  it('rolls back exact browser keys and leaves credential and outbox state intact', async () => {
    await seed()
    localStorage.setItem('settings/language', '"en"')
    localStorage.setItem('settings/providers/openai/apiKey', 'keep-secret')
    const previous = await boundary.read(true, false)
    await boundary.apply(previous, { settings: true, history: false, chats: true }, false)
    localStorage.setItem('settings/language', '"zh-Hans"')
    await boundary.apply(previous, { settings: true, history: false, chats: true }, true)
    expect(await boundary.read(true, false)).toEqual(previous)
    expect(localStorage.getItem('settings/providers/openai/apiKey')).toBe('keep-secret')
    expect(await storage.getItemRaw(outboxKey)).toEqual({ pending: true })
  })

  it('refuses an incomplete portable chat backup when its attachment is missing', async () => {
    await seed({ meta, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: chatAssetRef('missing-backup-test-asset') } }] }] })
    await expect(boundary.read(true, true)).rejects.toThrow('backup-missing-assets')
    expect((await boundary.read(true, false)).chats).not.toBeNull()
  })
})

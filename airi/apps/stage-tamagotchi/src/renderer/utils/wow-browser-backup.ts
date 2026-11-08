import type { ChatSessionRecord, ChatSessionsIndex } from '@proj-airi/stage-ui/types/chat-session'
import type { InferOutput } from 'valibot'

import type { BackupSelection, BrowserBackup } from '../../shared/wow-backup'

import { localStorageKeys, storage } from '@proj-airi/stage-ui/database/storage'
import { chatAssetIdsOf, inlineChatAssets } from '@proj-airi/stage-ui/libs/chat-assets'
import { parse } from 'valibot'

import { backupChatIndexSchema, backupChatRecordSchema, browserBackupSchema, isBackupChatKey, isBackupPreference, scrubBackupPreference } from '../../shared/wow-backup'

/** Saved browser data is independent from live Pinia stores. Cold restore uses this boundary before any store owner starts. */
export class BrowserBackupStorage {
  async read(includeChats: boolean, portable: boolean, includeSettings = true): Promise<BrowserBackup> {
    const preferences: BrowserBackup['preferences'] = []
    for (const key of Object.keys(localStorage).sort()) {
      if (!includeSettings || !isBackupPreference(key))
        continue
      const value = localStorage.getItem(key)
      if (value !== null)
        preferences.push([key, portable ? scrubBackupPreference(value) : value])
    }
    const chats: BrowserBackup['chats'] = includeChats ? [] : null
    if (chats) {
      const keys = (await localStorageKeys()).filter(isBackupChatKey).sort()
      const referenced = new Set<string>()
      for (const key of keys.filter(key => key.startsWith('local:chat:index:'))) {
        const index = await storage.getItemRaw<ChatSessionsIndex>(key)
        if (!index)
          continue
        chats.push([key, JSON.stringify(index)])
        for (const character of Object.values(index.characters)) {
          for (const id of Object.keys(character.sessions))
            referenced.add(id)
        }
      }
      for (const key of keys.filter(key => key.startsWith('local:chat:sessions:'))) {
        if (portable && !referenced.has(key.slice('local:chat:sessions:'.length)))
          continue
        const record = await storage.getItemRaw<ChatSessionRecord>(key)
        if (!record)
          continue
        const messages = portable ? await inlineChatAssets(record.messages) : record.messages
        if (portable && chatAssetIdsOf(messages).size > 0)
          throw new Error('backup-missing-assets')
        chats.push([key, JSON.stringify({ ...record, messages })])
      }
    }
    return parse(browserBackupSchema, { preferences, chats })
  }

  /** Rollback restores exact saved keys. Imports add local chat copies and never revive a task or a cloud send queue. */
  async apply(input: BrowserBackup, selection: BackupSelection, rollback: boolean) {
    const data = parse(browserBackupSchema, input)
    if (selection.settings) {
      for (const key of Object.keys(localStorage)) {
        if (isBackupPreference(key))
          localStorage.removeItem(key)
      }
      for (const [key, value] of data.preferences)
        localStorage.setItem(key, rollback ? value : scrubBackupPreference(value))
    }
    if (!selection.chats || data.chats === null)
      return
    if (rollback) {
      for (const key of (await localStorageKeys()).filter(isBackupChatKey))
        await storage.removeItem(key)
      for (const [key, value] of data.chats)
        await storage.setItemRaw(key, JSON.parse(value))
      return
    }
    const indexes = new Map<string, InferOutput<typeof backupChatIndexSchema>>()
    for (const [key, text] of data.chats) {
      if (!key.startsWith('local:chat:sessions:'))
        continue
      const record = parse(backupChatRecordSchema, JSON.parse(text))
      const id = `restored-${crypto.randomUUID()}`
      const userId = record.meta.userId
      const characterId = record.meta.characterId
      if (!/^[\w-]{1,160}$/.test(userId) || !/^[\w-]{1,160}$/.test(characterId) || [userId, characterId].some(id => ['__proto__', 'constructor', 'prototype'].includes(id)))
        throw new Error('backup-invalid')
      let index = indexes.get(userId)
      if (!index) {
        const current = await storage.getItemRaw(`local:chat:index:${userId}`)
        index = current ? parse(backupChatIndexSchema, current) : { userId, characters: {} }
        indexes.set(userId, index)
      }
      const meta = { ...record.meta, sessionId: id, bindings: ['backup-local'], cloudChatId: undefined, cloudMaxSeq: undefined, task: undefined, recipeId: undefined, parentSessionId: undefined, hidden: false }
      const character = index.characters[characterId] ?? { activeSessionId: id, sessions: {} }
      character.sessions[id] = meta
      index.characters[characterId] = character
      await storage.setItemRaw(`local:chat:sessions:${id}`, { ...record, meta })
    }
    for (const [userId, index] of indexes)
      await storage.setItemRaw(`local:chat:index:${userId}`, index)
  }
}

import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, looseObject, maxLength, maxValue, minValue, nullable, number, picklist, pipe, record, regex, safeParse, strictObject, string, tuple } from 'valibot'

export const backupFileIds = [
  'retail-settings',
  'forever-settings',
  'launcher',
  'retail-capture',
  'forever-capture',
  'retail-calibration',
  'forever-calibration',
  'retail-gold',
  'forever-gold',
  'retail-levels',
  'forever-levels',
  'retail-equipment',
  'forever-equipment',
  'retail-comparisons',
  'forever-comparisons',
  'retail-loadouts',
  'forever-loadouts',
  'companion-memories',
  'item-storage',
] as const
export type BackupFileId = typeof backupFileIds[number]
export type BackupScope = 'settings' | 'history' | 'chats'

const sensitive = /api[-_]?key|token|password|secret|authorization|credential/i
const preferencePrefixes = ['settings/wow-chatter/', 'settings/wow-screen-assist/', 'wow-companion/guide/', 'wow-companion/setup/', 'settings/consciousness/', 'settings/speech/', 'settings/vision/', 'settings/theme/']
const preferenceNames = new Set(['airi-cards', 'airi-card-module-defaults', 'memory/enabled', 'memory/entries', 'settings/language', 'settings/streamer-mode', 'settings/disable-transitions', 'settings/use-page-specific-transitions', 'wow-companion/group-buff-seen-v1', 'wow-companion/calendar-seen-v1'])

/** Only these preferences can cross the backup boundary. Provider credentials and arbitrary storage keys remain outside it. */
export function isBackupPreference(key: string) {
  return !sensitive.test(key) && (preferenceNames.has(key) || preferencePrefixes.some(prefix => key.startsWith(prefix)))
}

/** Chat key selection excludes outboxes, tombstones, and authentication. Import handles session metadata separately. */
export function isBackupChatKey(key: string) {
  return /^local:chat:(?:index|sessions):[\w-]{1,160}$/.test(key) && !/:(?:__proto__|constructor|prototype)$/.test(key)
}

/**
 * Removes structured credential fields from portable preference values. Text authored by the user stays intact.
 * @example scrubBackupPreference('{"name":"A","apiKey":"hidden"}') // => '{"name":"A"}'
 */
export function scrubBackupPreference(raw: string): string {
  if (!/^\s*[[{]/.test(raw))
    return raw
  const clean = (value: unknown, depth: number): unknown => {
    if (depth > 80)
      throw new Error('backup-invalid')
    if (Array.isArray(value))
      return value.map(item => clean(item, depth + 1))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key))
        .map(([key, item]) => [key, clean(item, depth + 1)]))
    }
    return value
  }
  return JSON.stringify(clean(JSON.parse(raw), 0))
}

const entry = tuple([pipe(string(), maxLength(256)), pipe(string(), maxLength(140 * 1024 * 1024))])
const unique = (entries: [string, string][]) => new Set(entries.map(([key]) => key)).size === entries.length
const identity = pipe(string(), regex(/^[\w-]{1,160}$/), check(value => !['__proto__', 'constructor', 'prototype'].includes(value)))
const metaSchema = looseObject({ sessionId: identity, userId: identity, characterId: identity, createdAt: number(), updatedAt: number() })
export const backupChatRecordSchema = looseObject({ meta: metaSchema, messages: array(looseObject({ role: picklist(['user', 'assistant', 'system', 'tool', 'error']) })) })
export const backupChatIndexSchema = looseObject({ userId: identity, characters: record(identity, looseObject({ activeSessionId: string(), sessions: record(identity, metaSchema) })) })

function validChatEntry([key, text]: [string, string]) {
  try {
    const parsed: unknown = JSON.parse(text)
    if (key.startsWith('local:chat:sessions:')) {
      const value = safeParse(backupChatRecordSchema, parsed)
      return value.success && key === `local:chat:sessions:${value.output.meta.sessionId}`
    }
    const value = safeParse(backupChatIndexSchema, parsed)
    return value.success && key === `local:chat:index:${value.output.userId}`
  }
  catch { return false }
}

export const browserBackupSchema = strictObject({
  preferences: pipe(array(entry), maxLength(2000), check(unique), check(entries => entries.every(([key]) => isBackupPreference(key)))),
  chats: nullable(pipe(array(entry), maxLength(20_000), check(unique), check(entries => entries.every(([key]) => isBackupChatKey(key))), check(entries => entries.every(validChatEntry)))),
})
export type BrowserBackup = InferOutput<typeof browserBackupSchema>

export const backupSelectionSchema = strictObject({ settings: boolean(), history: boolean(), chats: boolean() })
export type BackupSelection = InferOutput<typeof backupSelectionSchema>

export const backupFileSchema = strictObject({ id: picklist(backupFileIds), data: nullable(pipe(string(), maxLength(64 * 1024 * 1024))) })
export type BackupFile = InferOutput<typeof backupFileSchema>

export const backupPayloadSchema = strictObject({
  browser: browserBackupSchema,
  files: pipe(array(backupFileSchema), maxLength(backupFileIds.length), check(files => new Set(files.map(file => file.id)).size === files.length)),
})
export type BackupPayload = InferOutput<typeof backupPayloadSchema>

export const backupArchiveSchema = strictObject({
  format: literal('wow-companion-backup'),
  version: literal(1),
  appVersion: pipe(string(), maxLength(80)),
  createdAt: pipe(number(), integer(), minValue(0), maxValue(8_640_000_000_000_000)),
  payload: backupPayloadSchema,
  manifest: pipe(array(strictObject({ scope: picklist(['settings', 'history', 'chats']), key: pipe(string(), maxLength(300)), bytes: number(), sha256: pipe(string(), maxLength(64)) })), maxLength(25_000)),
  sha256: pipe(string(), maxLength(64)),
})
export type BackupArchive = InferOutput<typeof backupArchiveSchema>

export interface BackupPreview {
  id: string
  appVersion: string
  createdAt: number
  sha256: string
  manifest: BackupArchive['manifest']
  scopes: BackupSelection
}

/** The maintenance renderer only reads or applies whitelisted storage. It starts before normal application owners. */
export interface BackupBrowserPort {
  read: (includeChats: boolean, portable: boolean, includeSettings: boolean) => Promise<BrowserBackup>
  apply: (data: BrowserBackup, selection: BackupSelection, rollback: boolean) => Promise<void>
}

export interface BackupStatus {
  pending: BackupPreview | null
  last: { at: number, outcome: 'restored' | 'rolled-back', checkpoint: string } | null
}

export interface BackupColdTask {
  operation: 'read' | 'apply'
  includeChats?: boolean
  portable?: boolean
  data?: BrowserBackup
  selection?: BackupSelection
  rollback?: boolean
}

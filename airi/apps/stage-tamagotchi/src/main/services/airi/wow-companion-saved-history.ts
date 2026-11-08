import type { InferOutput } from 'valibot'

import type { GameVersion } from '../../../shared/wow-companion'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { array, boolean, check, integer, literal, looseObject, maxValue, minValue, number, optional, parse, picklist, pipe, record, string } from 'valibot'

import { snapshotSchema } from '../../../shared/wow-companion'
import { copperSchema, moneyIdSchema } from '../../../shared/wow-companion-gold'
import { equipmentLoadoutSchema } from '../../../shared/wow-companion-loadout'
import { launcherConfigSchema } from '../../../shared/wow-launcher'

const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const moneyRow = looseObject({ id: count, observedAt: count, deltaCopper: pipe(number(), integer(), minValue(-Number.MAX_SAFE_INTEGER), maxValue(Number.MAX_SAFE_INTEGER)), balanceCopper: copperSchema, epoch: moneyIdSchema, source: literal('addon-money-observation') })
const levelRow = looseObject({ id: count, level: count, fromLevel: optional(count), observedAt: count, durationSeconds: optional(count), durationBasis: picklist(['complete', 'partial', 'unknown']) })
const historySchema = pipe(looseObject({
  version: literal(1),
  game: picklist(['retail', 'forever']),
  account: moneyIdSchema,
  updatedAt: count,
  characters: record(string(), looseObject({
    snapshot: optional(snapshotSchema),
    equipment: optional(equipmentLoadoutSchema),
    lastSeen: optional(count),
    money: array(moneyRow),
    levels: array(levelRow),
    levelSeconds: pipe(number(), minValue(0)),
    levelComplete: boolean(),
    moneySequence: optional(count),
  })),
}), check(value => Object.entries(value.characters).every(([guid, character]) => (!character.snapshot
  || (character.snapshot.guid === guid && character.snapshot.account === value.account)) && (!character.equipment || character.equipment.guid === guid)), 'Invalid saved character identity'))
const fileSchema = looseObject({ version: literal(1), game: picklist(['retail', 'forever']), accounts: array(looseObject({ sourceFile: string(), history: historySchema })) })

/** Imported addon histories retain their offline provenance and never revive live player state. */
export type SavedAddonHistory = InferOutput<typeof fileSchema>

/** Decodes only a quoted snapshotJSON value. It never evaluates the surrounding Lua program. */
export function readSavedSnapshot(source: Buffer) {
  if (source.length > 64 * 1024 * 1024)
    throw new Error('SavedVariables exceeds 64 MiB')
  const match = /\["snapshotJSON"\]\s*=\s*"/.exec(source.toString('latin1'))
  if (!match)
    throw new Error('SavedVariables has no quoted snapshotJSON')
  const bytes: number[] = []
  for (let index = match.index + match[0].length; index < source.length; index++) {
    const byte = source[index]!
    if (byte === 34)
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    if (byte !== 92) {
      bytes.push(byte)
      continue
    }
    const next = source[++index]
    if (next === undefined)
      break
    if (next >= 48 && next <= 57) {
      let decimal = next - 48
      for (let digit = 1; digit < 3 && source[index + 1] !== undefined && source[index + 1]! >= 48 && source[index + 1]! <= 57; digit++)
        decimal = decimal * 10 + source[++index]! - 48
      if (decimal > 255)
        throw new Error('Invalid Lua byte escape')
      bytes.push(decimal)
    }
    else if (next === 34 || next === 92) {
      bytes.push(next)
    }
    else if (next === 110) {
      bytes.push(10)
    }
    else if (next === 114) {
      bytes.push(13)
    }
    else if (next === 116) {
      bytes.push(9)
    }
    else {
      throw new Error('Unsupported Lua string escape')
    }
  }
  throw new Error('Truncated saved snapshotJSON')
}

/** Scans the configured client's account SavedVariables every 30 seconds and retains the last valid import per addon account. */
export class CompanionSavedHistory {
  private data: SavedAddonHistory
  private loaded = false
  private blocked = false
  private nextScan = 0
  private readonly signatures = new Map<string, string>()
  private readonly output: string

  constructor(private readonly userData: string, private readonly game: GameVersion) {
    this.data = { version: 1, game, accounts: [] }
    this.output = join(userData, `wow-companion-${game}-addon-history-v1.json`)
  }

  read(): SavedAddonHistory { return this.data }

  async refresh() {
    if (this.blocked || Date.now() < this.nextScan)
      return
    this.nextScan = Date.now() + 30_000
    try {
      if (!this.loaded) {
        this.loaded = true
        try {
          this.data = parse(fileSchema, JSON.parse(await readFile(this.output, 'utf8')))
          if (this.data.game !== this.game)
            throw new Error('Saved history belongs to another game')
        }
        catch (cause) {
          if (typeof cause !== 'object' || cause === null || !('code' in cause) || cause.code !== 'ENOENT') {
            this.blocked = true
            throw cause
          }
        }
      }
      const config = parse(launcherConfigSchema, JSON.parse(await readFile(join(this.userData, 'wow-launcher-v1.json'), 'utf8')))
      const executable = config.paths[this.game]
      if (!executable)
        return
      const root = dirname(executable)
      for (const directory of new Set([join(root, 'WTF', 'Account'), join(dirname(root), 'WTF', 'Account')])) {
        let accounts
        try {
          accounts = await readdir(directory, { withFileTypes: true })
        }
        catch {
          continue
        }
        for (const account of accounts) {
          if (!account.isDirectory() || account.isSymbolicLink())
            continue
          const sourceFile = join(directory, account.name, 'SavedVariables', this.game === 'retail' ? 'WoWMapCompanion.lua' : 'WoWForeverCompanion.lua')
          try {
            const metadata = await stat(sourceFile)
            const signature = `${metadata.mtimeMs}:${metadata.size}`
            if (metadata.size > 64 * 1024 * 1024 || this.signatures.get(sourceFile) === signature)
              continue
            const snapshot = parse(looseObject({ offlineHistory: optional(historySchema) }), readSavedSnapshot(await readFile(sourceFile)))
            const history = snapshot.offlineHistory
            // Snapshot-only SavedVariables are a supported source with no recoverable historical records.
            if (!history) {
              this.signatures.set(sourceFile, signature)
              continue
            }
            if (history.game !== this.game)
              throw new Error('Wrong SavedVariables game')
            const previous = this.data.accounts.find(entry => entry.history.account === history.account)
            if (!previous || history.updatedAt >= previous.history.updatedAt) {
              const entry = { sourceFile, history }
              if (previous)
                this.data.accounts[this.data.accounts.indexOf(previous)] = entry
              else
                this.data.accounts.push(entry)
              await this.save()
            }
            this.signatures.set(sourceFile, signature)
          }
          catch (cause) {
            if (typeof cause !== 'object' || cause === null || !('code' in cause) || cause.code !== 'ENOENT')
              console.error('Addon history import failed:', sourceFile, errorMessageFrom(cause))
          }
        }
      }
    }
    catch (cause) {
      if (typeof cause !== 'object' || cause === null || !('code' in cause) || cause.code !== 'ENOENT')
        console.error('Addon history scan failed:', errorMessageFrom(cause))
    }
  }

  private async save() {
    const temporary = `${this.output}.${randomUUID()}.tmp`
    try {
      await mkdir(this.userData, { recursive: true })
      const file = await open(temporary, 'wx')
      try {
        await file.writeFile(JSON.stringify(this.data, null, 2), 'utf8')
        await file.sync()
      }
      finally { await file.close() }
      await rename(temporary, this.output)
    }
    finally { await rm(temporary, { force: true }) }
  }
}

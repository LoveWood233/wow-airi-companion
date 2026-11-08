import type { InferOutput } from 'valibot'

import type { CompanionState, GameVersion } from '../../../shared/wow-companion'
import type { SavedAddonHistory } from './wow-companion-saved-history'

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { array, check, integer, literal, looseObject, minValue, null_, nullable, number, object, parse, picklist, pipe, regex, string } from 'valibot'

const amount = pipe(string(), regex(/^(?:0|[1-9]\d*)$/))
const count = pipe(number(), integer(), minValue(0))
const checkpoint = object({ account: string(), guid: string(), earned: amount, spent: amount, copper: count, observedAt: count })
const transaction = object({
  id: string(),
  account: string(),
  guid: string(),
  name: string(),
  realm: string(),
  kind: picklist(['observed-change', 'counter-reset']),
  fromObservedAt: count,
  toObservedAt: count,
  incomeCopper: nullable(amount),
  expenseCopper: nullable(amount),
  balanceBeforeCopper: count,
  balanceAfterCopper: count,
  occurredAt: null_(),
  reason: null_(),
})
const savedSchema = pipe(looseObject({
  version: literal(1),
  game: picklist(['retail', 'forever']),
  checkpoints: array(checkpoint),
  goldJournal: array(transaction),
}), check(value => new Set(value.checkpoints.map(row => JSON.stringify([row.account, row.guid]))).size === value.checkpoints.length
  && new Set(value.goldJournal.map(row => row.id)).size === value.goldJournal.length, 'Duplicate archive identities'))

/**
 * Publishes offline character data and a receipt-interval money journal in one fixed JSON file per game.
 * Existing stores remain authoritative. Corrupt journals block replacement, and atomic writes preserve the previous complete archive.
 */
export class CompanionArchive {
  private checkpoints: InferOutput<typeof checkpoint>[] = []
  private goldJournal: InferOutput<typeof transaction>[] = []
  private loading: Promise<void> | undefined
  private queue: Promise<void> = Promise.resolve()
  private blocked = false
  private lastAttempt = -Infinity
  private latest: CompanionState | undefined
  private addonHistory: SavedAddonHistory | undefined

  constructor(private readonly filePath: string, private readonly game: GameVersion) {}

  /** Input comes from the accepted persistent stores, never from demo or unvalidated bridge frames. */
  observe(state: CompanionState, force = false, addonHistory?: SavedAddonHistory) {
    const operation = this.queue.then(async () => {
      this.loading ??= this.load()
      await this.loading
      if (this.blocked || state.game !== this.game)
        return
      this.latest = state
      if (addonHistory)
        this.addonHistory = addonHistory
      if (!state.gold.storageError) {
        for (const account of state.gold.accounts) {
          for (const character of account.characters) {
            const next = { account: account.account, guid: character.guid, earned: character.earned, spent: character.spent, copper: character.copper, observedAt: character.lastSeen }
            const index = this.checkpoints.findIndex(row => row.account === next.account && row.guid === next.guid)
            const previous = this.checkpoints[index]
            if (previous && next.observedAt < previous.observedAt)
              continue
            if (previous && (previous.earned !== next.earned || previous.spent !== next.spent || previous.copper !== next.copper)) {
              const reset = BigInt(next.earned) < BigInt(previous.earned) || BigInt(next.spent) < BigInt(previous.spent)
              this.goldJournal.push({
                id: randomUUID(),
                account: next.account,
                guid: next.guid,
                name: character.name,
                realm: character.realm,
                kind: reset ? 'counter-reset' : 'observed-change',
                fromObservedAt: previous.observedAt,
                toObservedAt: next.observedAt,
                incomeCopper: reset ? null : (BigInt(next.earned) - BigInt(previous.earned)).toString(),
                expenseCopper: reset ? null : (BigInt(next.spent) - BigInt(previous.spent)).toString(),
                balanceBeforeCopper: previous.copper,
                balanceAfterCopper: next.copper,
                occurredAt: null,
                reason: null,
              })
            }
            if (index === -1)
              this.checkpoints.push(next)
            else
              this.checkpoints[index] = next
          }
        }
      }
      if (force || Date.now() - this.lastAttempt >= 5000)
        await this.save()
    })
    this.queue = operation.catch((cause) => {
      console.error('Character archive failed:', this.filePath, errorMessageFrom(cause))
    })
    return this.queue
  }

  /** Normal shutdown drains queued observations and saves the latest archive without the five-second throttle. */
  async flush() {
    await this.queue
    if (this.latest)
      await this.observe(this.latest, true)
  }

  private async load() {
    try {
      const saved = parse(savedSchema, JSON.parse(await readFile(this.filePath, 'utf8')))
      if (saved.game !== this.game)
        throw new Error('Archive belongs to another game')
      this.checkpoints = saved.checkpoints
      this.goldJournal = saved.goldJournal
    }
    catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT')
        return
      this.blocked = true
      throw cause
    }
  }

  private async save() {
    const state = this.latest
    if (!state)
      return
    this.lastAttempt = Date.now()
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const file = await open(temporary, 'wx')
      try {
        await file.writeFile(JSON.stringify({
          version: 1,
          game: this.game,
          updatedAt: Date.now(),
          moneyUnit: 'copper',
          goldTotals: {
            balanceCopper: state.gold.accounts.reduce((sum, account) => sum + BigInt(account.balance), 0n).toString(),
            earnedCopper: state.gold.accounts.reduce((sum, account) => sum + BigInt(account.earned), 0n).toString(),
            spentCopper: state.gold.accounts.reduce((sum, account) => sum + BigInt(account.spent), 0n).toString(),
            scope: 'Last known balances of observed characters, including offline characters.',
          },
          gold: state.gold,
          addonHistory: this.addonHistory,
          equipmentLoadouts: state.equipmentLoadouts,
          equipmentHistory: state.equipmentHistory,
          levelHistory: state.levelHistory,
          checkpoints: this.checkpoints,
          goldJournal: this.goldJournal,
          journalSemantics: 'Changes between desktop observations, possibly multiple transactions. Exact transaction times and reasons are unknown. History starts at the first archive baseline.',
        }, null, 2), 'utf8')
        await file.sync()
      }
      finally {
        await file.close()
      }
      await rename(temporary, this.filePath)
    }
    finally {
      await rm(temporary, { force: true })
    }
  }
}

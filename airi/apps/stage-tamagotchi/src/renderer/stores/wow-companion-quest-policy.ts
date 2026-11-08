import type { InferOutput } from 'valibot'

import type { CompanionState, Snapshot } from '../../shared/wow-companion'
import type { QuestAdviceCandidate } from '../../shared/wow-companion-quests'

import { array, finite, integer, maxLength, minValue, number, object, pipe, safeParse, string } from 'valibot'

import { hasFreshCompanionObservation } from '../utils/wow-companion-observation'
import { canInteract } from './wow-companion-idle'

const receiptsSchema = pipe(array(object({ key: pipe(string(), maxLength(1024)), attemptedAt: pipe(number(), finite(), integer(), minValue(0)) })), maxLength(1024))

/** One attempt ledger covers both games and survives renderer restarts. Failed attempts retain their cooldown and deduplication receipt. */
export type QuestReminderReceipts = InferOutput<typeof receiptsSchema>

/** Candidates contain observed facts only. Task readiness never means that the player handed in the task. */
export interface QuestReminder {
  key: string
  kind: 'ready' | 'turned-in' | 'level-risk' | 'leveling'
  game: CompanionState['game']
  snapshot: Snapshot
  quest: { questID: number, title: string | null, level: number | null }
  level: number
  eventAt?: number
}

/**
 * Reads a bounded persisted attempt ledger. Invalid storage cannot create a reminder candidate.
 * @example readQuestReminderReceipts([{ key: 'ready:1', attemptedAt: 1000 }]) // => [{ key: 'ready:1', attemptedAt: 1000 }]
 */
export function readQuestReminderReceipts(value: unknown): QuestReminderReceipts {
  const result = safeParse(receiptsSchema, value)
  return result.success ? result.output : []
}

function currentQuests(state: CompanionState, now: number) {
  if (!canInteract(state, now))
    return undefined
  const quests = state.bridge.quests
  const snapshot = state.bridge.snapshot
  if (state.bridge.questsError || !quests || quests.session !== snapshot.session || quests.guid !== snapshot.guid
    || quests.observedAt <= 0 || now - quests.observedAt * 1000 > 180_000 || quests.observedAt * 1000 - now > 5000
    || !quests.advice || quests.advice.playerLevel !== snapshot.level) {
    return undefined
  }
  return { quests, snapshot, advice: quests.advice }
}

function identity(state: CompanionState, snapshot: Snapshot) {
  return [state.game, snapshot.account, snapshot.guid, snapshot.session]
}

function key(state: CompanionState, snapshot: Snapshot, kind: QuestReminder['kind'], questID: number, detail?: number) {
  return JSON.stringify([...identity(state, snapshot), kind, questID, detail ?? null])
}

function eventKey(candidate: QuestAdviceCandidate) {
  return JSON.stringify([candidate.kind, candidate.questID, candidate.eventAt])
}

function currentCandidate(candidate: QuestAdviceCandidate, now: number) {
  return candidate.eventAt === null || (candidate.eventAt * 1000 <= now + 5000
    && now - candidate.eventAt * 1000 <= (candidate.kind === 'leveling' ? 120_000 : 180_000))
}

/** Rechecks producer candidates after provider waits and during playback. New revisions retain only the same correlated observation. */
export function questReminderCurrent(state: CompanionState, reminder: QuestReminder, now: number): boolean {
  const current = currentQuests(state, now)
  if (!current || JSON.stringify(identity(state, current.snapshot)) !== JSON.stringify(identity(state, reminder.snapshot)))
    return false
  const { quests, snapshot, advice } = current
  const candidate = advice.candidates.find(candidate => candidate.kind === reminder.kind && candidate.questID === reminder.quest.questID
    && candidate.eventAt === (reminder.eventAt ?? null))
  if (!candidate || !currentCandidate(candidate, now) || snapshot.level !== reminder.level)
    return false
  if (reminder.kind === 'turned-in')
    return true
  const quest = quests.log.entries.find(entry => entry.questID === reminder.quest.questID)
  return !!quest && quest.title === reminder.quest.title && quest.level === reminder.quest.level
}

/**
 * Maintains session baselines without inferring task completion from removals or incomplete history.
 * The owner persists a receipt before starting generation. Busy or quiet periods do not accumulate repeated opportunities.
 */
export class QuestReminderPolicy {
  private readonly baselines = new Map<CompanionState['game'], { identity: string, events?: Set<string> }>()

  reset() {
    this.baselines.clear()
  }

  observe(state: CompanionState, now: number, eligibility: { enabled: boolean, eligible: boolean, busy: boolean }, receipts: QuestReminderReceipts): QuestReminder | undefined {
    if (!eligibility.enabled || !hasFreshCompanionObservation(state, now)) {
      this.baselines.delete(state.game)
      return undefined
    }
    const snapshot = { ...state.bridge.snapshot }
    const currentIdentity = JSON.stringify(identity(state, snapshot))
    let baseline = this.baselines.get(state.game)
    if (!baseline || baseline.identity !== currentIdentity) {
      baseline = { identity: currentIdentity }
      this.baselines.set(state.game, baseline)
    }
    const current = currentQuests(state, now)
    if (!current)
      return undefined
    const { quests, advice } = current
    const candidates = advice.candidates
    const events = candidates.filter(candidate => candidate.eventAt !== null).map(eventKey)
    const seen = baseline.events
    // Keep unseen turn-ins while busy, but never replay history that existed when observation started.
    if (eligibility.eligible && !eligibility.busy)
      baseline.events = new Set(events)
    if (!eligibility.eligible || eligibility.busy || receipts.some(receipt => now - receipt.attemptedAt < 180_000))
      return undefined

    for (const candidate of candidates) {
      if (!currentCandidate(candidate, now) || (candidate.eventAt !== null && (!seen || seen.has(eventKey(candidate)))))
        continue
      const quest = quests.log.entries.find(quest => quest.questID === candidate.questID)
      if (candidate.kind !== 'turned-in' && !quest)
        continue
      let detail = candidate.eventAt ?? undefined
      if (candidate.kind === 'level-risk')
        detail = quest?.level ?? undefined
      if (candidate.kind === 'leveling')
        detail = snapshot.level
      const candidateKey = key(state, snapshot, candidate.kind, candidate.questID, detail)
      if (!receipts.some(receipt => receipt.key === candidateKey)) {
        return {
          key: candidateKey,
          kind: candidate.kind,
          game: state.game,
          snapshot,
          level: snapshot.level,
          quest: { questID: candidate.questID, title: quest?.title ?? null, level: quest?.level ?? null },
          ...(candidate.eventAt !== null ? { eventAt: candidate.eventAt } : {}),
        }
      }
    }
  }
}

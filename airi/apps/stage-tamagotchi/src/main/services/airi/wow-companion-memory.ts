import type { ClaimMemoryNotice, CollectEquipmentMemory, CollectMemory, CompanionMemoryArchive, CompanionMemoryEntry, CompanionMemoryState, EditMemory, ExpireSessionGoals, MemoryCapacity, MemoryCharacter, MemoryEntryAction, MemoryGrowthRules, MemoryObservation, MemoryScope, RememberMemory, SetMemoryLimit, SuppressMemory } from '../../../shared/wow-companion-memory'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { check, integer, maxValue, minValue, number, parse, pipe, safeParse, strictObject, tuple } from 'valibot'

import { snapshotSchema } from '../../../shared/wow-companion'
import { claimMemoryNoticeSchema, collectEquipmentMemorySchema, collectMemorySchema, companionMemoryArchiveSchema, companionMemoryEntrySchema, editMemorySchema, expireSessionGoalsSchema, memoryCapacityDefaults, memoryCharacterSchema, memoryEntryActionSchema, memoryScopeSchema, rememberMemorySchema, setMemoryLimitSchema, suggestedMemoryGrowthRules, suppressMemorySchema } from '../../../shared/wow-companion-memory'

const score = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const growthSchema = pipe(strictObject({
  levelPoints: score,
  firstLocationPoints: score,
  dailyMaximum: score,
  stageThresholds: tuple([score, score, score, score]),
}), check(value => value.stageThresholds[0] === 0 && value.stageThresholds.every((threshold, index, all) => index === 0 || threshold > all[index - 1]!), 'Invalid relationship stages'))

function hash(parts: readonly unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function sameCharacter(left: MemoryCharacter, right: MemoryCharacter) {
  return left.game === right.game && left.account === right.account && left.guid === right.guid
}

function localDay(now: number) {
  const date = new Date(now)
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

/**
 * One main-process owner serializes mutations and atomically saves facts, rewards, and deletion receipts.
 * Device cursors are global. Only the active companion receives new witnessed facts, never copies of past device history.
 * Corrupt storage blocks writes. Cursor-only checkpoints save periodically, while owner edits and memories save immediately.
 */
export class CompanionMemoryRepository {
  static validateBackup(value: unknown) { return parse(companionMemoryArchiveSchema, value) }

  private archive: CompanionMemoryArchive = { version: 1, entries: [], relationships: [], cursors: [], seenSources: [], forgottenSources: [], rewards: [] }
  private activePersona: string | null = null
  private storageError: string | null = null
  private blocked = false
  private dirty = false
  private loading: Promise<void> | undefined
  private queue: Promise<void> = Promise.resolve()
  private lastSavedAt = 0
  private mutationEpoch = 0
  private readonly observedCharacters = new Set<string>()
  private readonly growth: MemoryGrowthRules | undefined

  constructor(private readonly filePath: string, options: { growth?: MemoryGrowthRules } = {}) {
    this.growth = options.growth ? parse(growthSchema, options.growth) : undefined
  }

  /** Loads once. Call before exposing a management snapshot or starting device observations. */
  load() {
    this.loading ??= this.loadFile()
    return this.loading
  }

  /** Changes runtime ownership only. Selecting a card does not replay device history or award growth. */
  setActivePersona(personaId: string | null) {
    return this.enqueue(async () => {
      await this.load()
      this.activePersona = personaId === null ? null : parse(memoryScopeSchema, { personaId }).personaId
    })
  }

  /** Returns only the bound card and optional character, including management flags for hidden and expired entries. */
  read(input: MemoryScope): CompanionMemoryState {
    const scope = parse(memoryScopeSchema, input)
    const entries = this.archive.entries.filter(entry => entry.personaId === scope.personaId
      && (!scope.character || entry.character === null || sameCharacter(entry.character, scope.character)))
    const relationship = this.archive.relationships.find(entry => entry.personaId === scope.personaId)
      ?? { personaId: scope.personaId, points: 0, visitedLocations: [], updatedAt: 0 }
    const thresholds = this.growth?.stageThresholds ?? suggestedMemoryGrowthRules.stageThresholds
    let stage: 0 | 1 | 2 | 3 = 0
    for (const candidate of [1, 2, 3] as const) {
      if (relationship.points >= thresholds[candidate])
        stage = candidate
    }
    const now = Date.now()
    return { entries: structuredClone(entries).map(entry => entry.expiresAt !== null && entry.expiresAt <= now ? { ...entry, expired: true } : entry), relationship: { ...structuredClone(relationship), stage }, storageError: this.storageError, capacity: this.capacity(scope.personaId) }
  }

  /** Polling admission status never serializes remembered text or complete equipment records. */
  readCapacity(input: Pick<MemoryScope, 'personaId'>): MemoryCapacity {
    return this.capacity(parse(memoryScopeSchema, input).personaId)
  }

  /** Changes future admission only. Lowering the limit never deletes existing preferences or collections. */
  setLimit(input: SetMemoryLimit) {
    const request = parse(setMemoryLimitSchema, input)
    return this.mutate(() => {
      const capacities = this.archive.capacities ??= []
      const current = capacities.find(row => row.personaId === request.personaId)
      if (current)
        current.limit = request.limit
      else capacities.push(request)
      this.dirty = true
    }).then(() => this.read({ personaId: request.personaId }))
  }

  /** Atomically consumes one local-calendar-day notice across renderers and restarts. Failed persistence grants no display permission. */
  claimNotice(input: ClaimMemoryNotice) {
    const request = parse(claimMemoryNoticeSchema, input)
    const epoch = this.mutationEpoch
    return this.enqueue(async () => {
      await this.load()
      if (epoch !== this.mutationEpoch)
        throw new Error('memory-reset')
      if (this.blocked)
        throw new Error('memory-storage-blocked')
      if (request.kind === 'capacity-full' && !this.capacity(request.personaId).full)
        return false
      const day = localDay(Date.now())
      const previous = this.archive.noticeReceipts
      const receipt = previous?.find(row => row.personaId === request.personaId && row.kind === request.kind)
      // Clock rollback cannot allow another notice from a day already consumed.
      if (receipt && receipt.day >= day)
        return false
      const previousDirty = this.dirty
      this.archive.noticeReceipts = [
        ...(previous?.filter(row => row.personaId !== request.personaId || row.kind !== request.kind) ?? []),
        { ...request, day },
      ]
      this.dirty = true
      if (!await this.save(true)) {
        this.archive.noticeReceipts = previous
        this.dirty = previousDirty
        throw new Error('memory-write-failed')
      }
      return true
    })
  }

  /** Saves owner text or an explicitly confirmed inference. An extraction retry with the same source cannot revive a forgotten entry. */
  remember(input: RememberMemory) {
    const request = parse(rememberMemorySchema, input)
    return this.mutate(() => {
      const sourceId = request.sourceId ? hash(['owner', request.personaId, request.sourceId]) : null
      if (sourceId && this.archive.forgottenSources.includes(hash([request.personaId, sourceId])))
        return undefined
      const existing = sourceId && this.archive.entries.find(entry => entry.personaId === request.personaId && entry.sourceId === sourceId)
      if (existing)
        return structuredClone(existing)
      if (request.kind === 'session-goal') {
        const cursor = this.archive.cursors.find(row => request.character && sameCharacter(row.character, request.character))
        if (!request.gameSessionId || cursor?.gameSessionId !== request.gameSessionId)
          throw new Error('memory-game-login-required')
      }
      const sameText = request.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
      const duplicate = request.kind === 'experience'
        ? undefined
        : this.archive.entries.find(entry => entry.personaId === request.personaId
          && entry.kind === request.kind && entry.fact === null && !entry.expired
          && ((entry.character === null && request.character === undefined)
            || (entry.character !== null && request.character !== undefined && sameCharacter(entry.character, request.character)))
          && (request.kind !== 'session-goal' || entry.gameSessionId === request.gameSessionId)
          && entry.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ') === sameText)
      if (duplicate) {
        if (sourceId && !this.archive.seenSources.includes(sourceId)) {
          this.archive.seenSources.push(sourceId)
          this.dirty = true
        }
        return structuredClone(duplicate)
      }
      // Alias receipts also survive forgetting or pruning the one deduplicated preference.
      if (sourceId && this.archive.seenSources.includes(sourceId))
        return undefined
      if (request.kind === 'preference' || request.collected)
        this.requireCapacity(request.personaId)
      if (sourceId)
        this.archive.seenSources.push(sourceId)
      if (request.kind === 'session-goal') {
        this.expireGoals(entry => entry.personaId === request.personaId && entry.character !== null && request.character !== undefined
          && sameCharacter(entry.character, request.character) && entry.gameSessionId === request.gameSessionId)
      }
      const now = Date.now()
      const entry = parse(companionMemoryEntrySchema, {
        id: randomUUID(),
        personaId: request.personaId,
        character: request.character ?? null,
        characterName: request.characterName ?? null,
        kind: request.kind,
        source: request.source,
        sourceId,
        text: request.text.trim(),
        fact: null,
        occurredAt: now,
        updatedAt: now,
        collected: request.collected,
        suppressed: false,
        gameSessionId: request.gameSessionId ?? null,
        chatSessionId: request.chatSessionId ?? null,
        expiresAt: request.expiresAt ?? null,
        expired: false,
      })
      this.archive.entries.push(entry)
      this.dirty = true
      return structuredClone(entry)
    })
  }

  /** Edits owner text without changing the source evidence or another companion's entry. */
  edit(input: EditMemory) {
    const request = parse(editMemorySchema, input)
    return this.mutate(() => {
      const entry = this.findEntry(request)
      if (!entry || entry.fact !== null)
        return false
      entry.text = request.text.trim()
      entry.updatedAt = Date.now()
      this.dirty = true
      return true
    })
  }

  /** Retains an entry beyond the ordinary limit. Removing an equipment collection drops that separate copy. */
  collect(input: CollectMemory) {
    const request = parse(collectMemorySchema, input)
    if (!request.collected) {
      return this.changeEntry(request, (entry) => {
        if (entry.kind === 'equipment')
          this.removeEntry(entry)
        else entry.collected = false
      })
    }
    return this.changeEntry(request, (entry) => {
      if (entry.kind !== 'preference' && !entry.collected)
        this.requireCapacity(request.personaId)
      entry.collected = true
    })
  }

  /** Changes proactive eligibility while keeping the fact and its reward receipts. */
  suppress(input: SuppressMemory) {
    const request = parse(suppressMemorySchema, input)
    return this.changeEntry(request, (entry) => {
      entry.suppressed = request.suppressed
    })
  }

  /** Deletes one bound entry and preserves a source tombstone. It never changes relationship points. */
  forget(input: MemoryEntryAction) {
    const request = parse(memoryEntryActionSchema, input)
    return this.mutate(() => {
      const entry = this.findEntry(request)
      if (!entry)
        return false
      this.removeEntry(entry)
      return true
    })
  }

  /** Equipment reaches long-term memory only through this explicit owner collection operation. */
  collectEquipment(input: CollectEquipmentMemory) {
    const request = parse(collectEquipmentMemorySchema, input)
    if (request.record.guid !== request.character.guid)
      return Promise.reject(new Error('memory-equipment-character'))
    return this.mutate(() => {
      const sourceId = hash(['equipment', request.character, request.record.session, request.record.id])
      const existing = this.archive.entries.find(entry => entry.personaId === request.personaId && entry.sourceId === sourceId)
      if (existing)
        return structuredClone(existing)
      this.requireCapacity(request.personaId)
      const now = Date.now()
      const entry = parse(companionMemoryEntrySchema, {
        id: randomUUID(),
        personaId: request.personaId,
        character: request.character,
        characterName: request.characterName ?? null,
        kind: 'equipment',
        source: 'user',
        sourceId,
        text: request.text.trim(),
        fact: { kind: 'equipment', record: request.record },
        occurredAt: now,
        updatedAt: now,
        collected: true,
        suppressed: false,
        gameSessionId: request.gameSessionId ?? null,
        chatSessionId: request.chatSessionId ?? null,
        expiresAt: null,
        expired: false,
      })
      this.archive.entries.push(entry)
      this.dirty = true
      return structuredClone(entry)
    })
  }

  /** Invalidates goals for one real game login. A conversation thread never identifies a game session. */
  expireSessionGoals(input: ExpireSessionGoals) {
    const request = parse(expireSessionGoalsSchema, input)
    return this.mutate(() => this.expireGoals(entry => entry.personaId === request.personaId
      && (!request.character || (entry.character !== null && sameCharacter(entry.character, request.character)))
      && (!request.gameSessionId || entry.gameSessionId === request.gameSessionId)))
  }

  /** Consumes trusted main-process evidence once. Baselines, reconnects, demos, gaps, and stale frames grant no witnessed growth. */
  observe(input: MemoryObservation) {
    const epoch = this.mutationEpoch
    return this.enqueue(async () => {
      await this.load()
      if (this.blocked || epoch !== this.mutationEpoch)
        return
      const bridge = input.bridge
      const now = Date.now()
      if (input.error || !bridge || bridge.error || bridge.status !== 'live' || bridge.source !== 'screen'
        || (bridge.game !== undefined && bridge.game !== input.game) || !bridge.instanceId
        || bridge.ageSeconds === null || bridge.ageSeconds < 0 || bridge.ageSeconds > 5) {
        return
      }
      const parsed = safeParse(snapshotSchema, bridge.snapshot)
      if (!parsed.success)
        return
      const snapshot = parsed.output
      const identity = safeParse(memoryCharacterSchema, { game: input.game, account: snapshot.account, guid: snapshot.guid })
      if (!identity.success || !snapshot.session)
        return
      const character = identity.output
      // The decoder session changes on /reload. Only the capability's login ID proves a real game login.
      const gameSessionId = typeof snapshot.loginId === 'string' ? snapshot.loginId : null
      if (!snapshot.online) {
        if (gameSessionId !== null)
          this.expireGoals(entry => entry.character !== null && sameCharacter(entry.character, character) && entry.gameSessionId === gameSessionId)
        await this.save(true)
        return
      }
      const characterId = hash([character])
      const firstObservation = !this.observedCharacters.has(characterId)
      this.observedCharacters.add(characterId)
      const levels = input.levels?.storageError ? undefined : input.levels?.characters.find(row => row.account === character.account && row.guid === character.guid)
      const levelId = levels?.records.at(-1)?.id ?? 0
      const eventId = Math.max(bridge.eventCursor, ...bridge.events.map(event => event.id))
      const cursor = this.archive.cursors.find(row => sameCharacter(row.character, character))
      const reset = firstObservation || !cursor || cursor.bridgeInstanceId !== bridge.instanceId || cursor.frameSessionId !== snapshot.session || cursor.gameSessionId !== gameSessionId
        || now < cursor.observedAt || now - cursor.observedAt > 5000
      if (reset) {
        if (gameSessionId !== null && (!cursor || cursor.gameSessionId !== gameSessionId))
          this.expireGoals(entry => entry.character !== null && sameCharacter(entry.character, character) && entry.gameSessionId !== gameSessionId)
        const next = { character, bridgeInstanceId: bridge.instanceId, gameSessionId, frameSessionId: snapshot.session, seq: snapshot.seq, tick: snapshot.tick, eventId, levelId, observedAt: now }
        if (cursor)
          Object.assign(cursor, next)
        else this.archive.cursors.push(next)
        this.dirty = true
        await this.save(true)
        return
      }
      if (!cursor || snapshot.seq < cursor.seq || snapshot.tick < cursor.tick)
        return
      this.expireGoals(entry => entry.expiresAt !== null && entry.expiresAt <= now)
      let witnessed = false
      for (const record of levels?.records ?? []) {
        if (cursor.levelId === 0 || record.id <= cursor.levelId || record.source !== 'live')
          continue
        const sourceId = hash(['level', character, record.id])
        witnessed = this.recordWitness(sourceId, character, snapshot.name, gameSessionId, record.recordedAt, { kind: 'level', fromLevel: record.fromLevel, level: record.level, durationMs: record.durationMs }) || witnessed
      }
      for (const event of bridge.events) {
        const eventSnapshot = event.snapshot
        if (event.id <= cursor.eventId || event.type !== 'zone' || event.demo || !eventSnapshot?.online
          || eventSnapshot.guid !== character.guid || eventSnapshot.account !== character.account || eventSnapshot.session !== snapshot.session || eventSnapshot.map <= 0) {
          continue
        }
        const sourceId = hash(['location', character, snapshot.session, bridge.instanceId, event.id])
        const eventTime = Date.parse(event.timestamp)
        witnessed = this.recordWitness(sourceId, character, eventSnapshot.name, gameSessionId, Number.isFinite(eventTime) && eventTime >= 0 ? Math.min(eventTime, now) : now, { kind: 'location', map: eventSnapshot.map, zone: eventSnapshot.zone, instanceType: eventSnapshot.instanceType ?? 'unknown' }) || witnessed
      }
      if (cursor.seq !== snapshot.seq || cursor.tick !== snapshot.tick || cursor.eventId !== eventId || cursor.levelId !== levelId) {
        Object.assign(cursor, { seq: snapshot.seq, tick: snapshot.tick, eventId: Math.max(cursor.eventId, eventId), levelId: Math.max(cursor.levelId, levelId), observedAt: now })
        this.dirty = true
      }
      this.prune()
      await this.save(witnessed)
    })
  }

  /** Writes pending cursor checkpoints and waits for all accepted owner operations before backup or exit. */
  flush() {
    return this.enqueue(async () => {
      await this.load()
      await this.save(true)
    })
  }

  /** Produces the validated durable snapshot after pending observations drain. Backup errors never masquerade as an empty archive. */
  async serializeBackup() {
    await this.flush()
    if (this.blocked || this.storageError)
      throw new Error('memory-backup-unavailable')
    return JSON.stringify(parse(companionMemoryArchiveSchema, this.archive))
  }

  /**
   * Invalidates queued mutations, drains an in-flight write, then saves an empty archive.
   * The caller cancels extraction tasks not yet submitted to this repository before clearing data.
   */
  clear() {
    this.mutationEpoch++
    return this.enqueue(async () => {
      await this.load()
      this.archive = { version: 1, entries: [], relationships: [], cursors: [], seenSources: [], forgottenSources: [], rewards: [] }
      this.observedCharacters.clear()
      this.blocked = false
      this.storageError = null
      this.dirty = true
      if (!await this.save(true))
        throw new Error('memory-write-failed')
    })
  }

  private findEntry(request: MemoryEntryAction) {
    return this.archive.entries.find(entry => entry.personaId === request.personaId && entry.id === request.id)
  }

  private capacity(personaId: string): MemoryCapacity {
    const limit = this.archive.capacities?.find(row => row.personaId === personaId)?.limit ?? memoryCapacityDefaults.limit
    let used = 0
    for (const entry of this.archive.entries) {
      if (entry.personaId === personaId && (entry.kind === 'preference' || entry.collected))
        used++
    }
    return { limit, used, full: used >= limit }
  }

  private requireCapacity(personaId: string) {
    if (this.capacity(personaId).full)
      throw new Error('memory-capacity-full')
  }

  private changeEntry(request: MemoryEntryAction, change: (entry: CompanionMemoryEntry) => void) {
    return this.mutate(() => {
      const entry = this.findEntry(request)
      if (!entry)
        return false
      change(entry)
      entry.updatedAt = Date.now()
      this.dirty = true
      return true
    })
  }

  private removeEntry(entry: CompanionMemoryEntry) {
    if (entry.sourceId) {
      const receipt = hash([entry.personaId, entry.sourceId])
      if (!this.archive.forgottenSources.includes(receipt))
        this.archive.forgottenSources.push(receipt)
    }
    this.archive.entries = this.archive.entries.filter(candidate => candidate !== entry)
    this.dirty = true
  }

  private expireGoals(matches: (entry: CompanionMemoryEntry) => boolean) {
    let changed = 0
    for (const entry of this.archive.entries) {
      if (entry.kind === 'session-goal' && !entry.expired && matches(entry)) {
        entry.expired = true
        entry.updatedAt = Date.now()
        this.dirty = true
        changed++
      }
    }
    return changed
  }

  private recordWitness(sourceId: string, character: MemoryCharacter, name: string, gameSessionId: string | null, occurredAt: number, fact: NonNullable<CompanionMemoryEntry['fact']>) {
    if (this.archive.seenSources.includes(sourceId))
      return false
    this.archive.seenSources.push(sourceId)
    this.dirty = true
    const personaId = this.activePersona
    if (!personaId || this.archive.forgottenSources.includes(hash([personaId, sourceId])))
      return false
    const now = Date.now()
    this.archive.entries.push(parse(companionMemoryEntrySchema, {
      id: randomUUID(),
      personaId,
      character,
      characterName: name,
      kind: 'experience',
      source: 'game-live',
      sourceId,
      text: '',
      fact,
      occurredAt,
      updatedAt: now,
      collected: false,
      suppressed: false,
      gameSessionId,
      chatSessionId: null,
      expiresAt: null,
      expired: false,
    }))
    let relationship = this.archive.relationships.find(row => row.personaId === personaId)
    if (!relationship) {
      relationship = { personaId, points: 0, visitedLocations: [], updatedAt: now }
      this.archive.relationships.push(relationship)
    }
    let rewardKind: 'level' | 'first-location' | undefined
    if (fact.kind === 'level') {
      rewardKind = 'level'
    }
    else if (fact.kind === 'location') {
      const location = hash([character.game, fact.map])
      if (!relationship.visitedLocations.includes(location)) {
        relationship.visitedLocations.push(location)
        rewardKind = 'first-location'
      }
    }
    if (this.growth && rewardKind) {
      const day = localDay(now)
      const used = this.archive.rewards.filter(row => row.personaId === personaId && row.day === day).reduce((sum, row) => sum + row.points, 0)
      const requested = rewardKind === 'level' ? this.growth.levelPoints : this.growth.firstLocationPoints
      const points = Math.min(requested, Math.max(0, this.growth.dailyMaximum - used))
      this.archive.rewards.push({ personaId, sourceId, kind: rewardKind, points, day })
      relationship.points += points
    }
    relationship.updatedAt = now
    return true
  }

  private prune() {
    const byPersona = new Map<string, CompanionMemoryEntry[]>()
    for (const entry of this.archive.entries) {
      if (entry.kind === 'preference' || entry.collected)
        continue
      const rows = byPersona.get(entry.personaId)
      if (rows)
        rows.push(entry)
      else byPersona.set(entry.personaId, [entry])
    }
    const discarded = new Set<string>()
    for (const entries of byPersona.values()) {
      for (const entry of entries.slice(0, Math.max(0, entries.length - 100)))
        discarded.add(entry.id)
    }
    if (discarded.size) {
      this.archive.entries = this.archive.entries.filter(entry => !discarded.has(entry.id))
      this.dirty = true
    }
  }

  private mutate<T>(operation: () => T) {
    const epoch = this.mutationEpoch
    return this.enqueue(async () => {
      await this.load()
      if (epoch !== this.mutationEpoch)
        throw new Error('memory-reset')
      if (this.blocked)
        throw new Error('memory-storage-blocked')
      const result = operation()
      this.prune()
      if (!await this.save(true))
        throw new Error('memory-write-failed')
      return result
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => {}, () => {})
    return result
  }

  private async loadFile() {
    try {
      this.archive = parse(companionMemoryArchiveSchema, JSON.parse(await readFile(this.filePath, 'utf8')))
      this.lastSavedAt = Date.now()
    }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return
      this.blocked = true
      this.storageError = `memory-read: ${errorMessageFrom(error) ?? ''}`
    }
  }

  private async save(force: boolean) {
    if (this.blocked)
      return false
    if (!this.dirty || (!force && Date.now() - this.lastSavedAt < 60_000))
      return true
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const valid = parse(companionMemoryArchiveSchema, this.archive)
      await mkdir(dirname(this.filePath), { recursive: true })
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(valid), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      await rename(temporary, this.filePath)
      this.dirty = false
      this.storageError = null
      this.lastSavedAt = Date.now()
      return true
    }
    catch (error) {
      this.storageError = `memory-write: ${errorMessageFrom(error) ?? ''}`
      return false
    }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
}

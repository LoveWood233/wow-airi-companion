import type { MemoryNoticeKind } from '../../shared/wow-companion-memory'
import type { EquipmentPromptPlayback } from './wow-companion-equipment-prompt'

/** A pending notice retains its conversation and observed player scope until the Stage can present it. */
export interface MemoryNotice {
  personaId: string
  kind: MemoryNoticeKind
  sessionId: string
  scope: string
  text: string
}

/**
 * Defers two bounded notices until foreground work settles. Main owns the durable daily receipt.
 * A changed persona or player drops pending evidence. Cancellation never starts a late audio turn.
 */
export class MemoryNoticeController {
  private readonly pending = new Map<MemoryNoticeKind, MemoryNotice>()
  private readonly attempted = new Set<string>()
  private attemptDay = ''
  private retryAt = 0
  private operation: { request: MemoryNotice, deadline: number, playback?: EquipmentPromptPlayback, cancelDelay?: () => void } | undefined
  private stopping = 0

  constructor(private readonly platform: {
    claim: (request: MemoryNotice) => Promise<boolean>
    current: (request: MemoryNotice, ownedTurnId?: string) => boolean
    present: (request: MemoryNotice) => EquipmentPromptPlayback | undefined
    clear: () => void
    report: () => void
  }) {}

  get busy() { return !!this.operation || this.stopping > 0 }
  get request() { return this.operation?.request }
  get turnId() { return this.operation?.playback?.turnId }

  enqueue(request: MemoryNotice) {
    const day = new Date().toDateString()
    if (day !== this.attemptDay) {
      this.attemptDay = day
      this.attempted.clear()
    }
    if (this.attempted.has(JSON.stringify([request.personaId, request.kind])))
      return
    this.pending.set(request.kind, request)
  }

  /** The caller supplies the current scope even while busy, so stale pending notices cannot survive a character switch. */
  update(scope: string | undefined) {
    for (const [kind, request] of this.pending) {
      if (request.scope !== scope)
        this.pending.delete(kind)
    }
    const active = this.operation
    if (active && (active.request.scope !== scope || Date.now() >= active.deadline || !this.platform.current(active.request, active.playback?.turnId)))
      this.interrupt()
    if (this.busy || Date.now() < this.retryAt)
      return
    const next = this.pending.get('capacity-full') ?? this.pending.get('context-limited')
    if (!next || !this.platform.current(next))
      return
    this.pending.delete(next.kind)
    if (this.attempted.has(JSON.stringify([next.personaId, next.kind])))
      return
    void this.run(next)
  }

  interrupt() {
    const operation = this.operation
    this.operation = undefined
    if (!operation)
      return
    operation.cancelDelay?.()
    this.platform.clear()
    if (operation.playback) {
      this.stopping++
      void operation.playback.stop().catch(() => this.platform.report()).finally(() => this.stopping--)
    }
  }

  reset() {
    this.pending.clear()
    this.attempted.clear()
    this.retryAt = 0
    this.interrupt()
  }

  private async run(request: MemoryNotice) {
    const operation: NonNullable<MemoryNoticeController['operation']> = { request, deadline: Date.now() + 120_000 }
    this.operation = operation
    try {
      const claimed = await this.platform.claim(request)
      if (this.operation !== operation)
        return
      this.attempted.add(JSON.stringify([request.personaId, request.kind]))
      if (!claimed || !this.platform.current(request))
        return
      // The receipt precedes presentation. A crash or cancellation can skip a notice, but cannot replay it all day.
      operation.playback = this.platform.present(request)
      if (operation.playback) {
        await operation.playback.done
      }
      else {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 12_000)
          operation.cancelDelay = () => {
            clearTimeout(timeout)
            resolve()
          }
        })
      }
    }
    catch {
      if (this.operation === operation) {
        this.retryAt = Date.now() + 30_000
        this.platform.report()
      }
    }
    finally {
      if (this.operation === operation)
        this.operation = undefined
    }
  }
}

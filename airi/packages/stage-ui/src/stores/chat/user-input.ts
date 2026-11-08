import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'

/** One persisted local owner message, with the final text available to this device. */
export interface UserInput {
  readonly sessionId: string
  readonly messageId: string
  /** The durable user message is also the model turn's correlation identity. */
  readonly turnId: string
  readonly personaId: string
  readonly text: string
  /** Consumers must check this signal immediately before committing external effects. */
  readonly signal: AbortSignal
}

export type UserInputObserver = (input: UserInput) => void | Promise<void>
export type UserTurnToolFactory = (input: UserInput) => Tool[] | Promise<Tool[]>

interface Subscription<T> {
  handler: T
  lifetime: AbortController
}

interface InputRecord {
  input: UserInput
  controller: AbortController
  toolsLifetime: AbortController
  tools: Map<Subscription<UserTurnToolFactory>, Promise<Tool[]>>
}

interface Operation {
  sessionId: string
  messageId: string
  controller: AbortController
}

/**
 * Window-local owner input delivery. The host authorizes persisted sources before publication.
 * Observers run without delaying generation. Tool factories run once per turn and retain its scope.
 * Removing a subscription or cancelling a turn aborts its in-flight consumers, including after generation ends.
 */
export class UserInputs {
  private readonly observers = new Map<string, Subscription<UserInputObserver>>()
  private readonly factories = new Map<string, Subscription<UserTurnToolFactory>>()
  private readonly delivered = new Set<string>()
  private readonly inputs = new Map<string, InputRecord>()
  private readonly operations = new Set<Operation>()

  get hasToolFactories() {
    return this.factories.size > 0
  }

  register(id: string, handler: UserInputObserver) {
    return this.subscribe(this.observers, id, handler)
  }

  registerTools(id: string, handler: UserTurnToolFactory) {
    return this.subscribe(this.factories, id, handler)
  }

  private subscribe<T>(subscriptions: Map<string, Subscription<T>>, id: string, handler: T) {
    subscriptions.get(id)?.lifetime.abort(new DOMException('User input subscription replaced', 'AbortError'))
    const subscription = { handler, lifetime: new AbortController() }
    subscriptions.set(id, subscription)
    return () => {
      subscription.lifetime.abort(new DOMException('User input subscription removed', 'AbortError'))
      if (subscriptions.get(id) === subscription)
        subscriptions.delete(id)
    }
  }

  /** Empty text can be completed later. Once published, the same persisted identity cannot publish again. */
  publish(source: Omit<UserInput, 'turnId'>) {
    const text = source.text.trim()
    const key = JSON.stringify([source.sessionId, source.messageId])
    if (!text || source.signal.aborted || this.delivered.has(key))
      return
    const controller = new AbortController()
    const input = Object.freeze({ ...source, text, turnId: source.messageId, signal: AbortSignal.any([source.signal, controller.signal]) })
    this.delivered.add(key)
    this.inputs.set(key, { input, controller, toolsLifetime: new AbortController(), tools: new Map() })
    for (const [id, subscription] of this.observers) {
      const operation = this.operation(input)
      const signal = AbortSignal.any([input.signal, subscription.lifetime.signal, operation.controller.signal])
      // Invoke through the first await so a consumer can capture its game scope before tools are built.
      try {
        signal.throwIfAborted()
        const result = subscription.handler({ ...input, signal })
        void Promise.resolve(result).catch((error: unknown) => {
          if (!signal.aborted)
            console.warn(`[chat] User input observer "${id}" failed:`, errorMessageFrom(error))
        }).finally(() => this.operations.delete(operation))
      }
      catch (error) {
        this.operations.delete(operation)
        if (!signal.aborted)
          console.warn(`[chat] User input observer "${id}" failed:`, errorMessageFrom(error))
      }
    }
  }

  private operation(input: UserInput) {
    const operation = { sessionId: input.sessionId, messageId: input.messageId, controller: new AbortController() }
    this.operations.add(operation)
    return operation
  }

  /** Factories receive the same immutable owner text and persona on every model step of this turn. */
  async tools(sessionId: string, turnId: string): Promise<Tool[]> {
    const record = this.inputs.get(JSON.stringify([sessionId, turnId]))
    if (!record || record.input.signal.aborted)
      return []
    const results = await Promise.all([...this.factories].map(async ([id, subscription]) => {
      let pending = record.tools.get(subscription)
      if (!pending) {
        const operation = this.operation(record.input)
        const signal = AbortSignal.any([record.input.signal, record.toolsLifetime.signal, subscription.lifetime.signal, operation.controller.signal])
        pending = Promise.resolve().then(async () => {
          signal.throwIfAborted()
          const tools = await subscription.handler({ ...record.input, signal })
          signal.throwIfAborted()
          if (this.factories.get(id) !== subscription)
            return []
          return tools.map(tool => ({
            ...tool,
            execute: (...args: Parameters<Tool['execute']>) => {
              signal.throwIfAborted()
              return tool.execute(...args)
            },
          }))
        }).catch((error: unknown) => {
          if (!signal.aborted)
            console.warn(`[chat] User turn tool factory "${id}" failed:`, errorMessageFrom(error))
          return []
        }).finally(() => this.operations.delete(operation))
        record.tools.set(subscription, pending)
      }
      const tools = await pending
      return subscription.lifetime.signal.aborted || this.factories.get(id) !== subscription ? [] : tools
    }))
    return record.input.signal.aborted || this.inputs.get(JSON.stringify([sessionId, turnId])) !== record ? [] : results.flat()
  }

  /** Generation releases tool factories, while already-running observers can still finish. */
  release(sessionId: string, turnId: string) {
    const key = JSON.stringify([sessionId, turnId])
    this.inputs.get(key)?.toolsLifetime.abort(new DOMException('User input turn finished', 'AbortError'))
    this.inputs.delete(key)
  }

  cancel(sessionId?: string, turnId?: string) {
    for (const operation of this.operations) {
      if ((!sessionId || operation.sessionId === sessionId) && (!turnId || operation.messageId === turnId))
        operation.controller.abort(new DOMException('User input cancelled', 'AbortError'))
    }
    for (const [key, record] of this.inputs) {
      if ((!sessionId || record.input.sessionId === sessionId) && (!turnId || record.input.messageId === turnId)) {
        record.controller.abort(new DOMException('User input cancelled', 'AbortError'))
        this.inputs.delete(key)
      }
    }
  }

  clear() {
    this.cancel()
    for (const subscription of [...this.observers.values(), ...this.factories.values()])
      subscription.lifetime.abort(new DOMException('User input owner disposed', 'AbortError'))
    this.observers.clear()
    this.factories.clear()
    this.delivered.clear()
  }
}

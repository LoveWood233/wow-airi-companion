import type { Tool } from '@xsai/shared-chat'

import type { UserInput } from './user-input'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { UserInputs } from './user-input'

function source(overrides: Partial<Omit<UserInput, 'turnId'>> = {}) {
  return { sessionId: 'session-a', messageId: 'message-a', personaId: 'sylvanas', text: 'Remember that I like exploring.', signal: new AbortController().signal, ...overrides }
}

const tool: Tool = { type: 'function', function: { name: 'remember_preference', parameters: { type: 'object', properties: {} } }, execute: async () => 'saved' }

describe('local owner user input delivery', () => {
  it('waits for available text, delivers an identity once, and isolates sessions', () => {
    const inputs = new UserInputs()
    const observed = vi.fn()
    inputs.register('memory', observed)
    inputs.publish(source({ text: '' }))
    expect(observed).not.toHaveBeenCalled()
    inputs.publish(source())
    inputs.publish(source({ text: 'The same message cannot write again.' }))
    inputs.publish(source({ sessionId: 'session-b' }))
    expect(observed).toHaveBeenCalledTimes(2)
    expect(observed.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-a', messageId: 'message-a', turnId: 'message-a', personaId: 'sylvanas' })
    expect(observed.mock.calls[1]?.[0]).toMatchObject({ sessionId: 'session-b' })
  })

  it('does not await observers and isolates synchronous and asynchronous failures', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    const inputs = new UserInputs()
    const pending = Promise.withResolvers<void>()
    const good = vi.fn()
    inputs.register('slow', () => pending.promise)
    inputs.register('throws', () => {
      throw new Error('observer failed')
    })
    inputs.register('rejects', async () => {
      throw new Error('observer rejected')
    })
    inputs.register('good', good)
    expect(inputs.publish(source())).toBeUndefined()
    expect(good).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(2))
    pending.resolve()
  })

  it('aborts a removed observer without removing the same id replacement', async () => {
    const inputs = new UserInputs()
    const pending = Promise.withResolvers<void>()
    const writes: string[] = []
    const old = inputs.register('memory', async (input) => {
      await pending.promise
      if (!input.signal.aborted)
        writes.push(input.text)
    })
    inputs.publish(source())
    const replacement = vi.fn()
    inputs.register('memory', replacement)
    old()
    pending.resolve()
    await Promise.resolve()
    inputs.publish(source({ messageId: 'new-message' }))
    expect(writes).toEqual([])
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('cancels an observer after generation released its input', async () => {
    const inputs = new UserInputs()
    const pending = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    inputs.register('memory', async (input) => {
      signal = input.signal
      await pending.promise
    })
    inputs.publish(source())
    inputs.release('session-a', 'message-a')
    inputs.cancel('session-a', 'message-a')
    expect(signal?.aborted).toBe(true)
    pending.resolve()
  })

  it('keeps a request cancellation isolated from another session', () => {
    const inputs = new UserInputs()
    const first = new AbortController()
    const signals = new Map<string, AbortSignal>()
    inputs.register('memory', async (input) => {
      signals.set(input.sessionId, input.signal)
      await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    inputs.publish(source({ signal: first.signal }))
    inputs.publish(source({ sessionId: 'session-b' }))
    first.abort()
    expect(signals.get('session-a')?.aborted).toBe(true)
    expect(signals.get('session-b')?.aborted).toBe(false)
    inputs.clear()
    expect(signals.get('session-b')?.aborted).toBe(true)
  })

  it('builds tools once per turn from frozen scoped input and does not authorize another turn', async () => {
    const inputs = new UserInputs()
    const factory = vi.fn(async (_input: UserInput) => [tool])
    inputs.registerTools('memory', factory)
    const input = source()
    inputs.publish(input)
    input.personaId = 'changed-card'
    const first = await inputs.tools('session-a', 'message-a')
    expect(first.map(tool => tool.function.name)).toEqual(['remember_preference'])
    expect(await inputs.tools('session-a', 'message-a')).toEqual(first)
    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ personaId: 'sylvanas', text: 'Remember that I like exploring.' })
    expect(await inputs.tools('session-b', 'message-a')).toEqual([])
    inputs.release('session-a', 'message-a')
    expect(await inputs.tools('session-a', 'message-a')).toEqual([])
    expect(() => first[0]?.execute('{}', { messages: [], toolCallId: 'finished-turn' })).toThrow('User input turn finished')
  })

  it('discards a late factory after removal or cancellation and keeps other factories working', async () => {
    const inputs = new UserInputs()
    const pending = Promise.withResolvers<Tool[]>()
    const remove = inputs.registerTools('slow', () => pending.promise)
    inputs.registerTools('good', () => [tool])
    inputs.publish(source())
    const tools = inputs.tools('session-a', 'message-a')
    await Promise.resolve()
    remove()
    pending.resolve([tool])
    expect((await tools).map(tool => tool.function.name)).toEqual(['remember_preference'])
    inputs.publish(source({ messageId: 'next' }))
    inputs.cancel('session-a', 'next')
    expect(await inputs.tools('session-a', 'next')).toEqual([])
  })
})

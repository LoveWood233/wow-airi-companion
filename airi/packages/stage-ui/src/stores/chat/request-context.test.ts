import type { Conversation } from '@proj-airi/core-agent'

import { describe, expect, it, vi } from 'vitest'

import { ChatRequestContexts } from './request-context'

function conversation(): Conversation {
  return { turns: [{ id: 'turn-0', type: 'user', content: [{ type: 'text', text: 'Look at the game' }] }] }
}

const request = () => ({ sessionId: 'local', turnId: 'turn', text: 'Look at the game', signal: new AbortController().signal })

describe('request-owned observations', () => {
  it('adds observations to a copy without changing history or the next conversation', async () => {
    const contexts = new ChatRequestContexts()
    contexts.register('game', async input => `Observed for ${input.sessionId}/${input.turnId}`)
    const original = conversation()
    const result = await contexts.apply(original, request())
    expect(JSON.stringify(result)).toContain('Observed for local/turn')
    expect(JSON.stringify(original)).not.toContain('Observed')
    contexts.clear()
    expect(await contexts.apply(original, request())).toBe(original)
  })

  it('does not observe a conversation whose current turn differs from the request', async () => {
    const contexts = new ChatRequestContexts()
    const read = vi.fn(async () => 'Unrelated screen')
    contexts.register('game', read)
    const original = conversation()
    expect(await contexts.apply(original, { ...request(), turnId: 'different-turn' })).toBe(original)
    expect(read).not.toHaveBeenCalled()
  })

  it('discards a late result after the request is cancelled', async () => {
    const contexts = new ChatRequestContexts()
    const pending = Promise.withResolvers<string>()
    contexts.register('game', () => pending.promise)
    const abort = new AbortController()
    const result = contexts.apply(conversation(), { ...request(), signal: abort.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    pending.resolve('Old screenshot')
    await assertion
  })

  it('discards a removed observer without unregistering its replacement', async () => {
    const contexts = new ChatRequestContexts()
    const pending = Promise.withResolvers<string>()
    const remove = contexts.register('game', () => pending.promise)
    const original = conversation()
    const first = contexts.apply(original, request())
    contexts.register('game', async () => 'Replacement observation')
    remove()
    pending.resolve('Obsolete observation')
    expect(await first).toBe(original)
    expect(JSON.stringify(await contexts.apply(original, request()))).toContain('Replacement observation')
  })

  it('keeps concurrent sessions isolated', async () => {
    const contexts = new ChatRequestContexts()
    const first = Promise.withResolvers<string>()
    contexts.register('game', input => input.sessionId === 'first' ? first.promise : Promise.resolve('Second screen'))
    const one = contexts.apply(conversation(), { ...request(), sessionId: 'first' })
    const two = await contexts.apply(conversation(), { ...request(), sessionId: 'second' })
    expect(JSON.stringify(two)).toContain('Second screen')
    expect(JSON.stringify(two)).not.toContain('First screen')
    first.resolve('First screen')
    expect(JSON.stringify(await one)).not.toContain('Second screen')
  })

  it('uses a newly registered observer only on the next request after removal during a read', async () => {
    const contexts = new ChatRequestContexts()
    const pending = Promise.withResolvers<string>()
    const remove = contexts.register('game', () => pending.promise)
    const original = conversation()
    const first = contexts.apply(original, request())
    remove()
    const next = vi.fn(async () => 'New screenshot')
    contexts.register('game', next)
    pending.resolve('Cancelled screenshot')
    expect(await first).toBe(original)
    expect(next).not.toHaveBeenCalled()
    expect(JSON.stringify(await contexts.apply(original, request()))).toContain('New screenshot')
    expect(next).toHaveBeenCalledOnce()
  })
})

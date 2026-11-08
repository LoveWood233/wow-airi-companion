import type { Conversation } from '@proj-airi/core-agent'

import type { ChatRequestObservation } from './request-context'

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
    expect((await contexts.apply(original, request())).conversation).toBe(original)
  })

  it('does not observe a conversation whose current turn differs from the request', async () => {
    const contexts = new ChatRequestContexts()
    const read = vi.fn(async () => 'Unrelated screen')
    contexts.register('game', read)
    const original = conversation()
    expect((await contexts.apply(original, { ...request(), turnId: 'different-turn' })).conversation).toBe(original)
    expect(read).not.toHaveBeenCalled()
  })

  it('discards a late result after the request is cancelled', async () => {
    const contexts = new ChatRequestContexts()
    const pending = Promise.withResolvers<ChatRequestObservation>()
    contexts.register('game', () => pending.promise)
    const abort = new AbortController()
    const result = contexts.apply(conversation(), { ...request(), signal: abort.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    pending.resolve({ text: 'Old screenshot', images: [{ url: 'data:image/png;base64,b2xk', description: 'Old view' }] })
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
    expect((await first).conversation).toBe(original)
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
    expect((await first).conversation).toBe(original)
    expect(next).not.toHaveBeenCalled()
    expect(JSON.stringify(await contexts.apply(original, request()))).toContain('New screenshot')
    expect(next).toHaveBeenCalledOnce()
  })

  it('adds fresh pixels to the matched user turn with a request-local description and leaves history unchanged', async () => {
    const contexts = new ChatRequestContexts()
    const image = { url: 'data:image/png;base64,cGl4ZWxz', description: 'A helm tooltip is open.' }
    contexts.register('game', async () => ({ text: 'One fresh game frame.', images: [image] }))
    const original = conversation()
    const result = await contexts.apply(original, request())
    expect(result.conversation.turns[0]).toEqual({
      id: 'turn-0',
      type: 'user',
      content: [
        { type: 'text', text: 'Look at the game' },
        { type: 'image', url: image.url },
        { type: 'runtime-context', entries: [{ source: 'game', text: 'One fresh game frame.' }] },
      ],
    })
    expect(result.imageDescriptions).toEqual([{ ...image, turnId: 'turn-0' }])
    expect(original).toEqual(conversation())
    contexts.clear()
    const next = await contexts.apply(original, request())
    expect(next.conversation).toBe(original)
    expect(next.imageDescriptions).toEqual([])
  })

  it('discards both pixels and their description after an image observer is removed during capture', async () => {
    const contexts = new ChatRequestContexts()
    const pending = Promise.withResolvers<ChatRequestObservation>()
    const remove = contexts.register('game', () => pending.promise)
    const original = conversation()
    const result = contexts.apply(original, request())
    remove()
    pending.resolve({ text: 'Stale pixels', images: [{ url: 'data:image/png;base64,b2xk', description: 'An obsolete frame.' }] })
    const applied = await result
    expect(applied.conversation).toBe(original)
    expect(applied.imageDescriptions).toEqual([])
  })

  it('keeps image receipts and original pixels isolated between concurrent sessions', async () => {
    const contexts = new ChatRequestContexts()
    contexts.register('game', async input => ({ text: input.sessionId, images: [{ url: `image:${input.sessionId}`, description: `View for ${input.sessionId}` }] }))
    const [first, second] = await Promise.all([
      contexts.apply(conversation(), { ...request(), sessionId: 'first' }),
      contexts.apply(conversation(), { ...request(), sessionId: 'second' }),
    ])
    expect(first.imageDescriptions).toEqual([{ turnId: 'turn-0', url: 'image:first', description: 'View for first' }])
    expect(second.imageDescriptions).toEqual([{ turnId: 'turn-0', url: 'image:second', description: 'View for second' }])
    expect(JSON.stringify(first.conversation)).not.toContain('image:second')
    expect(JSON.stringify(second.conversation)).not.toContain('image:first')
  })
})

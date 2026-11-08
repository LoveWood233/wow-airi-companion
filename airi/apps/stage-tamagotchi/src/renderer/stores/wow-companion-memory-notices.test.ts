import type { EquipmentPromptPlayback } from './wow-companion-equipment-prompt'
import type { MemoryNotice } from './wow-companion-memory-notices'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryNoticeController } from './wow-companion-memory-notices'

function notice(values: Partial<MemoryNotice> = {}): MemoryNotice {
  return {
    personaId: 'persona-1',
    kind: 'context-limited',
    sessionId: 'chat-1',
    scope: 'persona-1:retail:account-1:player-1:login-1',
    text: 'I can only bring a few memories into this conversation.',
    ...values,
  }
}

function host() {
  const platform = {
    claim: vi.fn<(request: MemoryNotice) => Promise<boolean>>().mockResolvedValue(true),
    current: vi.fn<(request: MemoryNotice, ownedTurnId?: string) => boolean>().mockReturnValue(true),
    present: vi.fn<(request: MemoryNotice) => EquipmentPromptPlayback | undefined>().mockReturnValue(undefined),
    clear: vi.fn<() => void>(),
    report: vi.fn<() => void>(),
  }
  return { platform, controller: new MemoryNoticeController(platform) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 2, 12))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('memory notice delivery ownership', () => {
  it('does not present a notice rejected by the durable daily claim', async () => {
    const { platform, controller } = host()
    platform.claim.mockResolvedValue(false)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledExactlyOnceWith(request)
    expect(platform.present).not.toHaveBeenCalled()
    expect(platform.clear).not.toHaveBeenCalled()
    expect(platform.report).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
    expect(controller.request).toBeUndefined()
  })

  it('retains pending evidence while the host is busy and presents it when the host permits', async () => {
    const { platform, controller } = host()
    platform.current.mockReturnValue(false)
    const request = notice()
    controller.enqueue(request)
    for (let poll = 0; poll < 4; poll++) {
      controller.update(request.scope)
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(platform.claim).not.toHaveBeenCalled()
    expect(platform.present).not.toHaveBeenCalled()
    platform.current.mockReturnValue(true)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledExactlyOnceWith(request)
    expect(platform.present).toHaveBeenCalledExactlyOnceWith(request)
  })

  it.each([undefined, 'another-character'])('drops pending evidence when the current scope changes to %s', async (scope) => {
    const { platform, controller } = host()
    const request = notice()
    controller.enqueue(request)
    controller.update(scope)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).not.toHaveBeenCalled()
    expect(platform.present).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
  })

  it('does not issue concurrent claims while the same request is awaiting IPC', async () => {
    const { platform, controller } = host()
    const claimed = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValue(claimed.promise)
    const request = notice()
    controller.enqueue(request)
    for (let poll = 0; poll < 20; poll++) {
      controller.enqueue(request)
      controller.update(request.scope)
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(platform.claim).toHaveBeenCalledExactlyOnceWith(request)
    expect(platform.present).not.toHaveBeenCalled()
    expect(controller.busy).toBe(true)
    claimed.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).toHaveBeenCalledExactlyOnceWith(request)
    await vi.advanceTimersByTimeAsync(12_000)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledTimes(1)
  })

  it('does not present a late successful claim after a character switch', async () => {
    const { platform, controller } = host()
    const claimed = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValue(claimed.promise)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    controller.update('another-character')
    claimed.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).not.toHaveBeenCalled()
    expect(platform.clear).toHaveBeenCalledTimes(1)
    expect(controller.busy).toBe(false)
    expect(controller.request).toBeUndefined()
  })

  it('does not present a late claim after reset', async () => {
    const { platform, controller } = host()
    const claimed = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValue(claimed.promise)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    controller.reset()
    claimed.resolve(true)
    await vi.advanceTimersByTimeAsync(20_000)
    controller.update(request.scope)
    expect(platform.present).not.toHaveBeenCalled()
    expect(platform.claim).toHaveBeenCalledTimes(1)
    expect(controller.busy).toBe(false)
  })

  it('releases a stalled claim at the delivery deadline without reviving its late response', async () => {
    const { platform, controller } = host()
    const claimed = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValue(claimed.promise)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(119_999)
    controller.update(request.scope)
    expect(controller.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    controller.update(request.scope)
    expect(controller.busy).toBe(false)
    claimed.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).not.toHaveBeenCalled()
    expect(platform.clear).toHaveBeenCalledTimes(1)
  })

  it('does not let a late cancelled claim overwrite the new operation', async () => {
    const { platform, controller } = host()
    const oldClaim = Promise.withResolvers<boolean>()
    const newClaim = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValueOnce(oldClaim.promise).mockReturnValueOnce(newClaim.promise)
    const previous = notice()
    const current = notice({ scope: 'new-character', kind: 'capacity-full' })
    controller.enqueue(previous)
    controller.update(previous.scope)
    controller.update(current.scope)
    controller.enqueue(current)
    controller.update(current.scope)
    oldClaim.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.request).toEqual(current)
    expect(controller.busy).toBe(true)
    expect(platform.present).not.toHaveBeenCalled()
    newClaim.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).toHaveBeenCalledExactlyOnceWith(current)
    expect(controller.request).toEqual(current)
  })

  it('rechecks current eligibility after the durable claim returns', async () => {
    const { platform, controller } = host()
    const claimed = Promise.withResolvers<boolean>()
    platform.claim.mockReturnValue(claimed.promise)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    platform.current.mockReturnValue(false)
    claimed.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
  })

  it('shows capacity pressure before context pressure and waits for the active text notice', async () => {
    const { platform, controller } = host()
    const context = notice()
    const capacity = notice({ kind: 'capacity-full', text: 'My saved memories need more room.' })
    controller.enqueue(context)
    controller.enqueue(capacity)
    controller.update(context.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).toHaveBeenNthCalledWith(1, capacity)
    controller.update(context.scope)
    expect(platform.claim).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(12_000)
    controller.update(context.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).toHaveBeenNthCalledWith(2, context)
    expect(platform.claim).toHaveBeenCalledTimes(2)
  })

  it('keeps only the latest pending evidence for the same notice kind', async () => {
    const { platform, controller } = host()
    const previous = notice({ text: 'Previous phrasing.' })
    const latest = notice({ text: 'Current phrasing.' })
    controller.enqueue(previous)
    controller.enqueue(latest)
    controller.update(latest.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledExactlyOnceWith(latest)
    expect(platform.present).toHaveBeenCalledExactlyOnceWith(latest)
  })

  it('keeps a text-only notice busy for twelve seconds', async () => {
    const { platform, controller } = host()
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.present).toHaveBeenCalledExactlyOnceWith(request)
    expect(controller.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(11_999)
    expect(controller.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.busy).toBe(false)
    expect(platform.clear).not.toHaveBeenCalled()
  })

  it('cancels an interrupted text delay without clearing a newer operation on its old timeout', async () => {
    const { platform, controller } = host()
    const first = notice()
    const next = notice({ kind: 'capacity-full' })
    const done = Promise.withResolvers<void>()
    platform.present.mockReturnValueOnce(undefined).mockReturnValueOnce({ turnId: 'new-audio', done: done.promise, stop: vi.fn().mockResolvedValue(undefined) })
    controller.enqueue(first)
    controller.update(first.scope)
    await vi.advanceTimersByTimeAsync(0)
    controller.interrupt()
    controller.enqueue(next)
    controller.update(next.scope)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(controller.request).toEqual(next)
    expect(controller.turnId).toBe('new-audio')
    expect(controller.busy).toBe(true)
    expect(platform.clear).toHaveBeenCalledTimes(1)
    done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.busy).toBe(false)
  })

  it('passes its own audio turn to eligibility checks and waits for speech completion', async () => {
    const { platform, controller } = host()
    const done = Promise.withResolvers<void>()
    const stop = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    platform.present.mockReturnValue({ turnId: 'notice-audio', done: done.promise, stop })
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    controller.update(request.scope)
    expect(platform.current).toHaveBeenCalledWith(request, 'notice-audio')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(controller.busy).toBe(true)
    expect(stop).not.toHaveBeenCalled()
    done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.busy).toBe(false)
    expect(controller.turnId).toBeUndefined()
  })

  it('keeps new speech blocked until the interrupted audio actually becomes silent', async () => {
    const { platform, controller } = host()
    const done = Promise.withResolvers<void>()
    const silent = Promise.withResolvers<void>()
    const stop = vi.fn<() => Promise<unknown>>().mockReturnValue(silent.promise)
    platform.present.mockReturnValueOnce({ turnId: 'notice-audio', done: done.promise, stop })
    const previous = notice()
    const next = notice({ kind: 'capacity-full' })
    controller.enqueue(previous)
    controller.update(previous.scope)
    await vi.advanceTimersByTimeAsync(0)
    controller.interrupt()
    controller.enqueue(next)
    controller.update(next.scope)
    done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(platform.claim).toHaveBeenCalledTimes(1)
    expect(controller.busy).toBe(true)
    silent.resolve()
    await vi.advanceTimersByTimeAsync(0)
    controller.update(next.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenNthCalledWith(2, next)
    expect(platform.present).toHaveBeenNthCalledWith(2, next)
  })

  it('reports failed audio without clearing the host-owned fallback caption', async () => {
    const { platform, controller } = host()
    const done = Promise.withResolvers<void>()
    platform.present.mockReturnValue({ turnId: 'failed-audio', done: done.promise, stop: vi.fn().mockResolvedValue(undefined) })
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    done.reject(new Error('Speech synthesis failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.report).toHaveBeenCalledTimes(1)
    expect(platform.clear).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
  })

  it('stops stalled owned audio at the delivery deadline', async () => {
    const { platform, controller } = host()
    const done = Promise.withResolvers<void>()
    const stop = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    platform.present.mockReturnValue({ turnId: 'stalled-audio', done: done.promise, stop })
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(120_000)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(platform.clear).toHaveBeenCalledTimes(1)
    expect(controller.busy).toBe(false)
    done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.request).toBeUndefined()
  })

  it('reports a rejected stop without leaving the controller permanently busy', async () => {
    const { platform, controller } = host()
    const done = Promise.withResolvers<void>()
    const stop = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('Output device closed'))
    platform.present.mockReturnValue({ turnId: 'notice-audio', done: done.promise, stop })
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    controller.reset()
    done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.report).toHaveBeenCalledTimes(1)
    expect(controller.busy).toBe(false)
    expect(controller.request).toBeUndefined()
  })

  it('does not clear another caption when interrupted without an owned operation', () => {
    const { platform, controller } = host()
    controller.interrupt()
    expect(platform.clear).not.toHaveBeenCalled()
  })
})

describe('bounded memory notice claim attempts', () => {
  it.each([true, false])('does not repeatedly claim the same persona and kind after a %s result', async (claimed) => {
    const { platform, controller } = host()
    platform.claim.mockResolvedValue(claimed)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(12_000)
    for (let poll = 0; poll < 20; poll++) {
      controller.enqueue(request)
      controller.update(request.scope)
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(platform.claim).toHaveBeenCalledExactlyOnceWith(request)
    expect(platform.present).toHaveBeenCalledTimes(claimed ? 1 : 0)
  })

  it('keeps claim attempts isolated between personas and notice kinds', async () => {
    const { platform, controller } = host()
    platform.claim.mockResolvedValue(false)
    const requests = [notice(), notice({ personaId: 'persona-2', scope: 'persona-2:player-1' }), notice({ kind: 'capacity-full' })]
    for (const request of requests) {
      controller.enqueue(request)
      controller.update(request.scope)
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(platform.claim).toHaveBeenCalledTimes(3)
    expect(platform.present).not.toHaveBeenCalled()
  })

  it('allows the backend to decide again on the next local calendar day', async () => {
    const { platform, controller } = host()
    platform.claim.mockResolvedValue(false)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(new Date(2026, 10, 3, 0, 0))
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledTimes(2)
  })

  it('backs off failed claims for thirty seconds instead of retrying every poll', async () => {
    const { platform, controller } = host()
    platform.claim.mockRejectedValueOnce(new Error('IPC temporarily unavailable')).mockResolvedValue(false)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.report).toHaveBeenCalledTimes(1)
    for (let poll = 0; poll < 119; poll++) {
      controller.enqueue(request)
      controller.update(request.scope)
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(platform.claim).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledTimes(2)
    expect(platform.present).not.toHaveBeenCalled()
  })

  it('clears local attempts on reset and still asks the durable backend before presenting', async () => {
    const { platform, controller } = host()
    platform.claim.mockResolvedValue(false)
    const request = notice()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    controller.reset()
    controller.enqueue(request)
    controller.update(request.scope)
    await vi.advanceTimersByTimeAsync(0)
    expect(platform.claim).toHaveBeenCalledTimes(2)
    expect(platform.present).not.toHaveBeenCalled()
  })
})

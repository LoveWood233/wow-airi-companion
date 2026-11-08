import type { QuestInteraction } from './wow-companion-quest-interaction'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { QuestInteractionController } from './wow-companion-quest-interaction'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => resolve = accept)
  return { promise, resolve }
}

function host() {
  const response = deferred<string>()
  const audio = deferred<'finished' | 'cancelled'>()
  let eligible = true
  const report = vi.fn()
  const stop = vi.fn(async () => {})
  const generate = vi.fn((_request: QuestInteraction, _signal: AbortSignal) => response.promise)
  const speak = vi.fn(() => ({ turnId: 'quest:owned', done: audio.promise, stop }))
  const controller = new QuestInteractionController({ current: () => eligible, generate, speak, report })
  const snapshot = loadoutStateFixture().bridge!.snapshot!
  const request: QuestInteraction = {
    reminder: { key: 'ready:101', kind: 'ready', game: 'retail', snapshot, quest: { questID: 101, title: 'Observed task', level: 15 }, level: 15 },
    sessionId: 'chat',
    characterId: 'persona',
    chat: { provider: 'test-provider', model: 'test-model' },
    persona: 'Observed persona',
    language: 'zh-Hans',
  }
  return { controller, request, response, audio, generate, speak, report, stop, loseEligibility: () => eligible = false }
}

afterEach(() => vi.useRealTimers())

describe('quest interaction ownership', () => {
  it('generates once, waits for actual audio completion and releases ownership', async () => {
    const env = host()
    const pending = env.controller.run(env.request)
    expect(env.controller.busy).toBe(true)
    await env.controller.run(env.request)
    expect(env.generate).toHaveBeenCalledTimes(1)
    env.response.resolve(' The observed quest is ready. ')
    await vi.waitFor(() => expect(env.speak).toHaveBeenCalledWith('chat', 'The observed quest is ready.'))
    expect(env.controller.busy).toBe(true)
    env.audio.resolve('finished')
    await pending
    expect(env.report).toHaveBeenCalledWith('submitted', env.request)
    expect(env.controller.busy).toBe(false)
  })

  it('does not start an ineligible request', async () => {
    const env = host()
    env.loseEligibility()
    await env.controller.run(env.request)
    expect(env.generate).not.toHaveBeenCalled()
    expect(env.speak).not.toHaveBeenCalled()
  })

  it('aborts the provider and discards late output after eligibility changes', async () => {
    const env = host()
    const pending = env.controller.run(env.request)
    const signal = env.generate.mock.calls[0]![1]
    env.loseEligibility()
    env.controller.update()
    expect(signal.aborted).toBe(true)
    env.response.resolve('Obsolete reminder')
    await pending
    expect(env.speak).not.toHaveBeenCalled()
    expect(env.report).not.toHaveBeenCalledWith('error', env.request)
  })

  it('checks eligibility again immediately before playback', async () => {
    const env = host()
    const pending = env.controller.run(env.request)
    env.loseEligibility()
    env.response.resolve('Obsolete reminder')
    await pending
    expect(env.speak).not.toHaveBeenCalled()
  })

  it('stops only its owned audio and waits for silence before accepting another turn', async () => {
    const env = host()
    const silence = deferred<void>()
    env.stop.mockImplementation(() => silence.promise)
    const pending = env.controller.run(env.request)
    env.response.resolve('Ready')
    await vi.waitFor(() => expect(env.speak).toHaveBeenCalledTimes(1))
    env.controller.stop()
    expect(env.stop).toHaveBeenCalledTimes(1)
    await env.controller.run(env.request)
    expect(env.generate).toHaveBeenCalledTimes(1)
    silence.resolve()
    env.audio.resolve('cancelled')
    await pending
    await vi.waitFor(() => expect(env.controller.busy).toBe(false))
  })

  it.each(['clock-backward', 'sleep', 'deadline'])('cancels on %s without publishing late text', async (reason) => {
    vi.useFakeTimers()
    const env = host()
    const start = Date.now()
    const pending = env.controller.run(env.request)
    if (reason === 'deadline')
      await vi.advanceTimersByTimeAsync(120_000)
    else
      env.controller.update(start + (reason === 'sleep' ? 30_001 : -1))
    env.response.resolve('Old reminder')
    await pending
    expect(env.speak).not.toHaveBeenCalled()
    expect(env.controller.busy).toBe(false)
  })

  it('reports an empty provider result without starting speech', async () => {
    const env = host()
    const pending = env.controller.run(env.request)
    env.response.resolve(' ')
    await pending
    expect(env.report).toHaveBeenCalledWith('error', env.request)
    expect(env.speak).not.toHaveBeenCalled()
  })

  it('discards a provider that resolves after its generation signal timed out', async () => {
    vi.useFakeTimers()
    const env = host()
    const pending = env.controller.run(env.request)
    await vi.advanceTimersByTimeAsync(45_001)
    expect(env.generate.mock.calls[0]![1].aborted).toBe(true)
    env.response.resolve('Late output from a provider that ignored cancellation')
    await pending
    expect(env.speak).not.toHaveBeenCalled()
  })
})

import type { UserInput } from '@proj-airi/stage-ui/stores/chat/user-input'
import type { Tool } from '@xsai/shared-chat'

import type { CompanionMemoryEntry, CompanionMemoryState } from '../../shared/wow-companion-memory'

import { describe, expect, it, vi } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { CompanionMemoryConversation } from './wow-companion-memory-conversation'

type Options = ConstructorParameters<typeof CompanionMemoryConversation>[0]
type MemoryPort = Options['memory']
type Player = ReturnType<Options['player']>

const now = Date.parse('2026-11-02T10:00:00Z')

function player(): NonNullable<Player> {
  return { game: 'retail', snapshot: { ...loadoutStateFixture().bridge!.snapshot!, session: 'frame-session', loginId: 'real-game-login' } }
}

function entry(values: Partial<CompanionMemoryEntry> = {}): CompanionMemoryEntry {
  const current = player()
  return {
    id: 'saved-preference',
    personaId: 'sylvanas',
    character: { game: current.game, account: current.snapshot.account, guid: current.snapshot.guid },
    characterName: current.snapshot.name,
    kind: 'preference',
    source: 'user',
    sourceId: null,
    text: 'Own current character preference.',
    fact: null,
    occurredAt: now - 1000,
    updatedAt: now - 1000,
    collected: false,
    suppressed: false,
    gameSessionId: null,
    chatSessionId: 'chat-one',
    expiresAt: null,
    expired: false,
    ...values,
  }
}

function input(text = 'I prefer quiet adventures.', values: Partial<UserInput> = {}): UserInput {
  return { sessionId: 'chat-one', messageId: 'message-one', turnId: 'message-one', personaId: 'sylvanas', text, signal: new AbortController().signal, ...values }
}

function harness(options: { player?: Player, entries?: CompanionMemoryEntry[] } = {}) {
  let current = 'player' in options ? options.player : player()
  let clock = now
  let onPlayerRead: (() => void) | undefined
  const state: CompanionMemoryState = {
    entries: options.entries ?? [entry()],
    relationship: { personaId: 'sylvanas', points: 0, visitedLocations: [], updatedAt: now, stage: 0 },
    storageError: null,
  }
  const memory = {
    readFor: vi.fn<MemoryPort['readFor']>().mockResolvedValue(state),
    remember: vi.fn<MemoryPort['remember']>().mockResolvedValue(state),
    edit: vi.fn<MemoryPort['edit']>().mockResolvedValue(state),
    suppress: vi.fn<MemoryPort['suppress']>().mockResolvedValue(state),
    forget: vi.fn<MemoryPort['forget']>().mockResolvedValue(state),
  } satisfies MemoryPort
  const notify = vi.fn<Options['notify']>()
  const conversation = new CompanionMemoryConversation({
    memory,
    notify,
    now: () => clock,
    player: () => {
      const result = current
      const callback = onPlayerRead
      onPlayerRead = undefined
      callback?.()
      return result
    },
  })
  return {
    memory,
    state,
    notify,
    conversation,
    setPlayer: (value: Player) => current = value,
    nextPlayerRead: (callback: () => void) => onPlayerRead = callback,
    advance: (milliseconds: number) => clock += milliseconds,
  }
}

async function toolFor(conversation: CompanionMemoryConversation, source: UserInput): Promise<Tool> {
  await conversation.observe(source)
  const tools = await conversation.tools(source)
  if (!tools[0])
    throw new Error('Expected the scoped memory tool')
  return tools[0]
}

function command(source: UserInput, operation = 'remember', values: { text?: string, quote?: string, memoryId?: string | null, scope?: 'general' | 'current-character' } = {}) {
  return { operation, text: 'Prefers quiet adventures.', quote: source.text, memoryId: null, scope: 'current-character', ...values }
}

const call = { messages: [], toolCallId: 'memory-call' }

describe('companion memory conversation authority', () => {
  it('rejects a quote that did not occur in the current owner message', async () => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    const result = await tool.execute(command(source, 'remember', { quote: 'The assistant said to remember this.' }), call)
    expect(JSON.parse(String(result))).toMatchObject({ ok: false })
    expect(test.memory.remember).not.toHaveBeenCalled()
    expect(test.notify).not.toHaveBeenCalled()
  })

  it('binds an explicit preference to its captured persona, character and source message', async () => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source), call)
    expect(test.memory.remember).toHaveBeenCalledOnce()
    expect(test.memory.remember).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'sylvanas', character: entry().character, kind: 'preference', source: 'user', chatSessionId: 'chat-one', sourceId: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    expect(test.memory.remember.mock.calls[0]?.[0]).not.toHaveProperty('gameSessionId')
    expect(test.notify).toHaveBeenCalledWith('saved')
  })

  it('binds a temporary goal to the real game login rather than chat or bridge sessions', async () => {
    const test = harness()
    const source = input('Today I only want to explore.')
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'goal', { text: 'Explore today.' }), call)
    expect(test.memory.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session-goal', gameSessionId: 'real-game-login', chatSessionId: 'chat-one', character: entry().character }))
  })

  it('refuses a game goal when a bridge session exists without a real login identity', async () => {
    const current = player()
    current.snapshot.loginId = undefined
    const test = harness({ player: current })
    const source = input('Today I only want to explore.')
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'goal'), call)
    expect(test.memory.remember).not.toHaveBeenCalled()
  })

  it.each(['game', 'account', 'guid', 'login'] as const)('rejects a late tool after the captured %s changes', async (changed) => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    const other = player()
    if (changed === 'game')
      other.game = 'forever'
    else if (changed === 'account')
      other.snapshot.account = 'another-account'
    else if (changed === 'guid')
      other.snapshot.guid = 'Player-Another'
    else
      other.snapshot.loginId = 'another-real-login'
    test.setPlayer(other)
    await tool.execute(command(source), call)
    expect(test.memory.remember).not.toHaveBeenCalled()
  })

  it('invalidates returned tools when reset discards the previous persona scope', async () => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    test.conversation.reset()
    await test.conversation.observe(input('Hello.', { personaId: 'illidan', messageId: 'another-message', turnId: 'another-message' }))
    await tool.execute(command(source), call)
    expect(test.memory.remember).not.toHaveBeenCalled()
  })

  it.each(['remember', 'propose'])('rechecks scope after real Web Crypto before %s commits', async (operation) => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    test.nextPlayerRead(() => queueMicrotask(() => test.setPlayer({ ...player(), game: 'forever' })))
    await tool.execute(command(source, operation), call)
    expect(test.memory.remember).not.toHaveBeenCalled()
    test.setPlayer(player())
    await test.conversation.observe(input('yes', { messageId: 'later-yes', turnId: 'later-yes' }))
    expect(test.memory.remember).not.toHaveBeenCalled()
  })

  it('proposes without writing and saves once on the next same-scope yes', async () => {
    const test = harness()
    const source = input('Maybe I enjoy exploring more than raiding.')
    const tool = await toolFor(test.conversation, source)
    const result = await tool.execute(command(source, 'propose'), call)
    expect(JSON.parse(String(result))).toMatchObject({ saved: false, confirmationRequired: true })
    expect(test.memory.remember).not.toHaveBeenCalled()
    const yes = input('yes', { messageId: 'confirmation', turnId: 'confirmation' })
    await test.conversation.observe(yes)
    expect(test.memory.remember).toHaveBeenCalledOnce()
    expect(test.memory.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'preference', source: 'confirmed-inference', personaId: 'sylvanas' }))
    const confirmingTools = await test.conversation.tools(yes)
    await confirmingTools[0]!.execute(command(yes), call)
    expect(test.memory.remember).toHaveBeenCalledOnce()
  })

  it.each(['persona', 'game', 'login', 'chat', 'unrelated', 'expired'] as const)('clears a proposal after a %s reply or scope change', async (changed) => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'propose'), call)
    if (changed === 'game')
      test.setPlayer({ ...player(), game: 'forever' })
    if (changed === 'login')
      test.setPlayer({ ...player(), snapshot: { ...player().snapshot, loginId: 'next-login' } })
    if (changed === 'expired')
      test.advance(300_001)
    await test.conversation.observe(input(changed === 'unrelated' ? 'What is the weather?' : 'yes', { sessionId: changed === 'chat' ? 'chat-other' : 'chat-one', personaId: changed === 'persona' ? 'illidan' : 'sylvanas', messageId: 'next-message', turnId: 'next-message' }))
    test.setPlayer(player())
    await test.conversation.observe(input('yes', { messageId: 'old-scope-yes', turnId: 'old-scope-yes' }))
    expect(test.memory.remember).not.toHaveBeenCalled()
  })

  it('turns stop-mentioning intent into suppression without deletion', async () => {
    const test = harness()
    const source = input('别再提这件事了。')
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'forget', { memoryId: 'saved-preference' }), call)
    expect(test.memory.suppress).toHaveBeenCalledWith({ personaId: 'sylvanas', id: 'saved-preference', suppressed: true })
    expect(test.memory.forget).not.toHaveBeenCalled()
    expect(test.notify).toHaveBeenCalledWith('suppressed')
  })

  it('forgets only an explicit scoped deletion request', async () => {
    const test = harness()
    const source = input('忘记这条记忆。')
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'forget', { memoryId: 'saved-preference' }), call)
    expect(test.memory.forget).toHaveBeenCalledWith({ personaId: 'sylvanas', id: 'saved-preference' })
    expect(test.memory.suppress).not.toHaveBeenCalled()
    expect(test.notify).toHaveBeenCalledWith('forgotten')
  })

  it.each(['I like exploring.', '别再提，但不要删除。', 'Don\'t forget this preference.'])('does not delete when the owner says %s', async (text) => {
    const test = harness()
    const source = input(text)
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'forget', { memoryId: 'saved-preference' }), call)
    expect(test.memory.forget).not.toHaveBeenCalled()
  })

  it('allows only general preferences without a current Warcraft character', async () => {
    const test = harness({ player: undefined })
    const source = input()
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'remember', { scope: 'general' }), call)
    expect(test.memory.remember).toHaveBeenCalledOnce()
    expect(test.memory.remember.mock.calls[0]?.[0]).not.toHaveProperty('character')
    await tool.execute(command(source, 'remember'), call)
    await tool.execute(command(source, 'goal', { scope: 'general' }), call)
    expect(test.memory.remember).toHaveBeenCalledOnce()
  })

  it('filters explicit reads and tool evidence by persona and current game character', async () => {
    const foreign = entry({ id: 'foreign', character: { ...entry().character!, guid: 'Player-Other' }, text: 'Other character private note.' })
    const test = harness({ entries: [entry(), foreign, entry({ id: 'other-persona', personaId: 'illidan', text: 'Other persona private note.' })] })
    const source = input('What do you remember about me?')
    const tool = await toolFor(test.conversation, source)
    expect(tool.function.description).not.toContain('Other character private note.')
    expect(tool.function.description).not.toContain('Other persona private note.')
    const result = await tool.execute(command(source, 'read', { quote: '', memoryId: 'foreign' }), call)
    expect(String(result)).not.toContain('Other character private note.')
    expect(test.memory.readFor).toHaveBeenLastCalledWith('sylvanas', entry().character)
  })

  it('discards a tool description when its initial IPC read returns after a scope change', async () => {
    const test = harness()
    const source = input()
    const reading = Promise.withResolvers<CompanionMemoryState>()
    test.memory.readFor.mockReturnValueOnce(reading.promise)
    test.conversation.observe(source)
    const tools = test.conversation.tools(source)
    await vi.waitFor(() => expect(test.memory.readFor).toHaveBeenCalledOnce())
    test.setPlayer({ ...player(), game: 'forever' })
    reading.resolve(test.state)
    expect(await tools).toEqual([])
  })

  it('does not return a late explicit IPC read to a changed character', async () => {
    const test = harness()
    const source = input('Read this memory.')
    const tool = await toolFor(test.conversation, source)
    const reading = Promise.withResolvers<CompanionMemoryState>()
    test.memory.readFor.mockReturnValueOnce(reading.promise)
    const result = tool.execute(command(source, 'read', { quote: '', memoryId: 'saved-preference' }), call)
    await vi.waitFor(() => expect(test.memory.readFor).toHaveBeenCalledTimes(2))
    test.setPlayer({ ...player(), snapshot: { ...player().snapshot, guid: 'Player-Other' } })
    reading.resolve(test.state)
    expect(String(await result)).not.toContain('Own current character preference.')
  })

  it.each(['remember', 'edit', 'suppress', 'forget'] as const)('does not report success after a refused %s IPC outcome', async (operation) => {
    const test = harness()
    test.memory[operation].mockRejectedValueOnce(new Error('memory-entry-unavailable'))
    const source = input(operation === 'forget' ? '请删除这条记忆。' : operation === 'suppress' ? '请不要再提起。' : 'Please update this preference.')
    const tool = await toolFor(test.conversation, source)
    await expect(tool.execute(command(source, operation, { memoryId: operation === 'remember' ? null : 'saved-preference' }), call)).rejects.toThrow('memory-entry-unavailable')
    expect(test.notify).not.toHaveBeenCalled()
  })

  it('reports an unsaved preference and preserves the conversation when the IPC refuses full capacity', async () => {
    const test = harness()
    test.memory.remember.mockRejectedValueOnce(new Error('Error invoking wow-memory: memory-capacity-full'))
    const source = input()
    const tool = await toolFor(test.conversation, source)
    const result = JSON.parse(String(await tool.execute(command(source), call)))
    expect(result).toMatchObject({ ok: false, saved: false, capacityFull: true })
    expect(result.reason).toContain('not saved')
    expect(result.reason).toContain('Existing memories are preserved')
    expect(result.reason).toContain('Settings > Memories and relationship')
    expect(test.memory.remember).toHaveBeenCalledOnce()
    expect(test.memory.forget).not.toHaveBeenCalled()
    expect(test.notify).not.toHaveBeenCalled()
  })

  it('keeps tools available after a confirmed proposal cannot be saved and never claims that confirmation succeeded', async () => {
    const test = harness()
    const source = input('Maybe I prefer exploring.')
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'propose'), call)
    test.memory.remember.mockRejectedValueOnce(new Error('memory-capacity-full'))
    const yes = input('yes', { messageId: 'confirmation-full', turnId: 'confirmation-full' })
    await expect(test.conversation.observe(yes)).resolves.toBeUndefined()
    const [confirmingTool] = await test.conversation.tools(yes)
    expect(confirmingTool).toBeDefined()
    expect(confirmingTool!.function.description).toContain('The new memory was not saved')
    expect(confirmingTool!.function.description).not.toContain('A previous proposal was confirmed and saved this turn')
    const result = JSON.parse(String(await confirmingTool!.execute(command(yes), call)))
    expect(result).toMatchObject({ ok: false, saved: false, capacityFull: true })
    expect(result).not.toHaveProperty('alreadySaved')
    expect(test.memory.remember).toHaveBeenCalledOnce()
    expect(test.memory.forget).not.toHaveBeenCalled()
    expect(test.notify).not.toHaveBeenCalled()
  })

  it('preserves non-capacity storage errors while confirming a proposal', async () => {
    const test = harness()
    const source = input()
    const tool = await toolFor(test.conversation, source)
    await tool.execute(command(source, 'propose'), call)
    test.memory.remember.mockRejectedValueOnce(new Error('memory-storage-blocked'))
    const yes = input('yes', { messageId: 'confirmation-storage', turnId: 'confirmation-storage' })
    await expect(test.conversation.observe(yes)).rejects.toThrow('memory-storage-blocked')
    await expect(test.conversation.tools(yes)).rejects.toThrow('memory-storage-blocked')
    expect(test.notify).not.toHaveBeenCalled()
  })
})

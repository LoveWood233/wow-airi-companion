import type { CollectMemory, CompanionMemoryEntry, CompanionMemoryState, EditMemory, MemoryEntryAction, RememberMemory, SetMemoryLimit, SuppressMemory } from '../../shared/wow-companion-memory'

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import enMessages from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowCompanionMemories from './wow-companion-memories.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

function entry(id: string, fields: Partial<CompanionMemoryEntry> = {}): CompanionMemoryEntry {
  return {
    id,
    personaId: 'ranger',
    character: null,
    characterName: null,
    kind: 'preference',
    source: 'user',
    sourceId: null,
    text: 'Keep quiet in raids.',
    fact: null,
    occurredAt: Date.now(),
    updatedAt: Date.now(),
    collected: false,
    suppressed: false,
    gameSessionId: null,
    chatSessionId: null,
    expiresAt: null,
    expired: false,
    ...fields,
  }
}

function fixture(): CompanionMemoryState {
  const character = { game: 'retail' as const, account: 'account-1', guid: 'Player-1' }
  return {
    entries: [
      entry('preference'),
      entry('upgrade', { character, characterName: 'Archer', kind: 'experience', source: 'game-live', text: '', fact: { kind: 'level', fromLevel: 70, level: 71, durationMs: 20000 }, gameSessionId: 'login-1' }),
      entry('gap', { character, characterName: 'Archer', kind: 'experience', source: 'game-gap', text: '', fact: { kind: 'level', fromLevel: 60, level: 70, durationMs: null } }),
      entry('location', { character, characterName: 'Archer', kind: 'experience', source: 'game-live', text: '', fact: { kind: 'location', map: 1, zone: 'Silvermoon', instanceType: 'none' }, suppressed: true }),
      entry('goal', { character, characterName: 'Archer', kind: 'session-goal', gameSessionId: 'login-1', text: 'Travel to the next town.', expired: true }),
    ],
    relationship: { personaId: 'ranger', points: 60, stage: 1, visitedLocations: [], updatedAt: Date.now() },
    storageError: null,
  }
}

async function mount(locale = 'en', state = fixture()) {
  const actions = {
    refresh: vi.fn(async () => {}),
    remember: vi.fn(async (_input: RememberMemory) => state),
    edit: vi.fn(async (_input: EditMemory) => state),
    collect: vi.fn(async (_input: CollectMemory) => state),
    suppress: vi.fn(async (_input: SuppressMemory) => state),
    forget: vi.fn(async (_input: MemoryEntryAction) => state),
    setLimit: vi.fn(async (_input: SetMemoryLimit) => state),
  }
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } },
  })
  const screen = await render(WowCompanionMemories, { props: { personaId: 'ranger', personaName: 'Sylvanas', state, actions, loading: false, error: false }, global: { plugins: [i18n] } })
  onTestFinished(() => screen.unmount())
  return { screen, actions, state }
}

describe('companion memory and relationship management', () => {
  it('shows four relationship stages and a local diary containing only witnessed facts', async () => {
    await mount()
    await expect.element(page.getByRole('progressbar', { name: 'Your relationship' })).toHaveAttribute('aria-valuenow', '60')
    const relationship = page.getByRole('region', { name: 'Your relationship' })
    for (const stage of ['Acquainted', 'Familiar', 'Trusted', 'In sync'])
      await expect.element(relationship.getByText(stage, { exact: false }).first()).toBeVisible()
    const diary = page.getByRole('region', { name: 'Today\'s adventure diary' })
    await expect.element(diary.getByText('Level 70 → 71', { exact: true })).toBeVisible()
    await expect.element(diary.getByText('Visited Silvermoon', { exact: true })).toBeVisible()
    await expect.element(diary.getByText('Level 60 → 70', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByTestId('memory-entry-gap').getByText('Recorded after a gap', { exact: true })).toBeVisible()
    await expect.element(page.getByTestId('memory-entry-upgrade').getByRole('button', { name: 'Edit text', exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByTestId('memory-entry-goal').getByText('Goal expired', { exact: true })).toBeVisible()
  })

  it('saves an explicit general preference and edits owner text through the bound companion', async () => {
    const { actions } = await mount()
    const input = page.getByRole('textbox', { name: 'What do you want your companion to remember?' })
    await input.fill('I enjoy exploring new maps.')
    await page.getByRole('button', { name: 'Remember this preference', exact: true }).click()
    await expect.poll(() => actions.remember.mock.calls).toEqual([[{ personaId: 'ranger', kind: 'preference', text: 'I enjoy exploring new maps.', source: 'user', collected: false }]])
    await expect.element(input).toHaveValue('')
    const preference = page.getByTestId('memory-entry-preference')
    await preference.getByRole('button', { name: 'Edit text', exact: true }).click()
    await preference.getByRole('textbox', { name: 'Your memory text' }).fill('Quiet during every dungeon.')
    await preference.getByRole('button', { name: 'Save text', exact: true }).click()
    await expect.poll(() => actions.edit.mock.calls).toEqual([[{ personaId: 'ranger', id: 'preference', text: 'Quiet during every dungeon.' }]])
  })

  it('separates proactive suppression, permanent collection, and confirmed forgetting', async () => {
    const { actions } = await mount()
    const upgrade = page.getByTestId('memory-entry-upgrade')
    await upgrade.getByRole('button', { name: 'Keep permanently', exact: true }).click()
    await expect.poll(() => actions.collect.mock.calls).toEqual([[{ personaId: 'ranger', id: 'upgrade', collected: true }]])
    await upgrade.getByRole('button', { name: 'Stop bringing this up', exact: true }).click()
    await expect.poll(() => actions.suppress.mock.calls).toEqual([[{ personaId: 'ranger', id: 'upgrade', suppressed: true }]])
    expect(actions.forget).not.toHaveBeenCalled()
    const location = page.getByTestId('memory-entry-location')
    await expect.element(location.getByText('Proactive mentions stopped', { exact: true })).toBeVisible()
    await location.getByRole('button', { name: 'Allow proactive mentions', exact: true }).click()
    await expect.poll(() => actions.suppress.mock.calls.at(-1)).toEqual([{ personaId: 'ranger', id: 'location', suppressed: false }])
    await upgrade.getByRole('button', { name: 'Forget', exact: true }).click()
    expect(actions.forget).not.toHaveBeenCalled()
    await upgrade.getByRole('button', { name: 'Confirm forgetting', exact: true }).click()
    await expect.poll(() => actions.forget.mock.calls).toEqual([[{ personaId: 'ranger', id: 'upgrade' }]])
  })

  it('hides a previous companion snapshot and clears drafts when the card changes', async () => {
    const { screen, actions } = await mount()
    const input = page.getByRole('textbox', { name: 'What do you want your companion to remember?' })
    await input.fill('A private draft.')
    await screen.rerender({ personaId: 'mage', personaName: 'Mage' })
    await expect.element(page.getByText('No memories for this companion yet.', { exact: true })).toBeVisible()
    await expect.element(page.getByTestId('memory-entry-preference')).not.toBeInTheDocument()
    await expect.element(input).toHaveValue('')
    await input.fill('A new preference.')
    await page.getByRole('button', { name: 'Remember this preference', exact: true }).click()
    await expect.poll(() => actions.remember.mock.calls.at(-1)?.[0].personaId).toBe('mage')
  })

  it('keeps an unsaved draft when storage rejects an operation', async () => {
    const { actions } = await mount()
    actions.remember.mockRejectedValueOnce(new Error('Storage unavailable'))
    const input = page.getByRole('textbox', { name: 'What do you want your companion to remember?' })
    await input.fill('Keep this draft.')
    await page.getByRole('button', { name: 'Remember this preference', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Memories could not be read or saved.')
    await expect.element(input).toHaveValue('Keep this draft.')
  })

  it('shows the server capacity and saves a valid integer limit for the selected companion', async () => {
    const state = fixture()
    state.capacity = { used: 1, limit: 1000, full: false }
    const { actions } = await mount('en', state)
    const region = page.getByRole('region', { name: 'Long-Term Memory capacity' })
    await expect.element(region.getByText('1 of 1000 long-term memories used', { exact: true })).toBeVisible()
    const limit = region.getByRole('spinbutton', { name: 'Long-term memory limit' })
    const save = region.getByRole('button', { name: 'Save capacity', exact: true })
    await expect.element(limit).toHaveValue(1000)
    await expect.element(save).toBeDisabled()
    await limit.fill('99')
    await expect.element(save).toBeDisabled()
    await limit.fill('100001')
    await expect.element(save).toBeDisabled()
    await limit.fill('1000.5')
    await expect.element(save).toBeDisabled()
    await limit.fill('2000')
    await save.click()
    await expect.poll(() => actions.setLimit.mock.calls).toEqual([[{ personaId: 'ranger', limit: 2000 }]])
    expect(actions.forget).not.toHaveBeenCalled()
    expect(actions.collect).not.toHaveBeenCalled()
  })

  it('keeps existing memories editable and forgettable when capacity blocks new preferences and collections', async () => {
    const state = fixture()
    state.entries.push(...Array.from({ length: 99 }, (_, index) => entry(`saved-${index}`, { text: `Preference ${index}` })))
    state.capacity = { used: 100, limit: 100, full: true }
    const { actions } = await mount('en', state)
    await expect.element(page.getByRole('status')).toHaveTextContent('Long-term memory is full.')
    const input = page.getByRole('textbox', { name: 'What do you want your companion to remember?' })
    await input.fill('A new preference.')
    await expect.element(page.getByRole('button', { name: 'Remember this preference', exact: true })).toBeDisabled()
    await expect.element(page.getByTestId('memory-entry-upgrade').getByRole('button', { name: 'Keep permanently', exact: true })).toBeDisabled()
    const preference = page.getByTestId('memory-entry-preference')
    await preference.getByRole('button', { name: 'Edit text', exact: true }).click()
    await preference.getByRole('textbox', { name: 'Your memory text' }).fill('A corrected preference.')
    await preference.getByRole('button', { name: 'Save text', exact: true }).click()
    await expect.poll(() => actions.edit.mock.calls.at(-1)).toEqual([{ personaId: 'ranger', id: 'preference', text: 'A corrected preference.' }])
    await preference.getByRole('button', { name: 'Forget', exact: true }).click()
    await preference.getByRole('button', { name: 'Confirm forgetting', exact: true }).click()
    await expect.poll(() => actions.forget.mock.calls.at(-1)).toEqual([{ personaId: 'ranger', id: 'preference' }])
    expect(actions.remember).not.toHaveBeenCalled()
    expect(actions.collect).not.toHaveBeenCalled()
  })

  it('preserves a preference draft and explains a capacity rejection without calling it storage corruption', async () => {
    const state = fixture()
    state.capacity = { used: 1, limit: 1000, full: false }
    const { actions } = await mount('en', state)
    actions.remember.mockRejectedValueOnce(new Error('memory-capacity-full'))
    const input = page.getByRole('textbox', { name: 'What do you want your companion to remember?' })
    await input.fill('Keep this when space is available.')
    await page.getByRole('button', { name: 'Remember this preference', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Long-term memory is full.')
    await expect.element(page.getByRole('alert')).not.toHaveTextContent('Memories could not be read or saved.')
    await expect.element(input).toHaveValue('Keep this when space is available.')
  })

  it('resets the capacity draft when switching companions and never deletes memories on a lower limit', async () => {
    const state = fixture()
    state.capacity = { used: 1, limit: 1000, full: false }
    const { screen, actions } = await mount('en', state)
    const input = page.getByRole('spinbutton', { name: 'Long-term memory limit' })
    await input.fill('5000')
    const next: CompanionMemoryState = { entries: [], relationship: { ...state.relationship, personaId: 'mage' }, capacity: { used: 0, limit: 2000, full: false }, storageError: null }
    await screen.rerender({ personaId: 'mage', personaName: 'Mage', state: next })
    await expect.element(input).toHaveValue(2000)
    await input.fill('100')
    await page.getByRole('button', { name: 'Save capacity', exact: true }).click()
    await expect.poll(() => actions.setLimit.mock.calls.at(-1)).toEqual([{ personaId: 'mage', limit: 100 }])
    expect(actions.forget).not.toHaveBeenCalled()
    expect(actions.remember).not.toHaveBeenCalled()
  })

  it('keeps Chinese controls visible on a narrow settings panel', async () => {
    await page.viewport(390, 1000)
    onTestFinished(() => page.viewport(1280, 720))
    const state = fixture()
    state.capacity = { used: 1, limit: 1000, full: false }
    await mount('zh-Hans', state)
    await expect.element(page.getByRole('spinbutton', { name: '长期记忆条数上限' })).toBeInTheDocument()
    const capacityRegion = page.getByRole('region', { name: '长期记忆容量' })
    const capacity = capacityRegion.element().getBoundingClientRect()
    expect(capacity.left).toBeGreaterThanOrEqual(0)
    expect(capacity.right).toBeLessThanOrEqual(window.innerWidth)
    await capacityRegion.screenshot({ path: 'wow-memory-capacity-zh-narrow.png' })
    const entry = page.getByTestId('memory-entry-location')
    await expect.element(entry.getByRole('button', { name: '允许主动提起', exact: true })).toBeVisible()
    const rect = entry.element().getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
    const buttons = entry.element().querySelectorAll('button')
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(rect.left)
      expect(bounds.right).toBeLessThanOrEqual(rect.right)
    }
    await entry.screenshot({ path: 'wow-memories-zh-narrow.png' })
  })
})

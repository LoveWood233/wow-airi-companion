import type { Snapshot } from '../../shared/wow-companion'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import WowSetupChecks from './wow-setup-checks.vue'

import { setupEnvironment, setupInspection, setupState } from '../../shared/wow-setup.test-helper'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), environment: vi.fn(), state: vi.fn(), pick: vi.fn(), install: vi.fn(), speech: vi.fn() }))
vi.mock('@xsai/generate-speech', () => ({ generateSpeech: mocks.speech }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event.receiveEvent?.id ?? ''
    if (id.includes('wow-setup:inspect'))
      return mocks.inspect
    if (id.includes('wow-setup:environment'))
      return mocks.environment
    if (id.includes('wow-setup:pick'))
      return mocks.pick
    if (id.includes('wow-setup:install'))
      return mocks.install
    if (id.includes('wow-companion:get'))
      return mocks.state
    throw new Error(`Unexpected invoke ${id}`)
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('wow-companion/setup/retail/directory')
  mocks.inspect.mockResolvedValue(setupInspection())
  mocks.environment.mockResolvedValue(setupEnvironment())
  mocks.state.mockResolvedValue(setupState())
  mocks.pick.mockResolvedValue(null)
})

async function mount() {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-guide', component: { template: '<div />' } }] })
  await router.push('/settings/wow-guide')
  const screen = render(WowSetupChecks, { props: { game: 'retail' }, global: { plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: { 'wow-companion': parse(en) } } })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return { pinia, screen }
}

describe('setup evidence and explicit actions', () => {
  it('checks local prerequisites without installing addons or sending model tests', async () => {
    await mount()
    await expect.poll(() => mocks.environment.mock.calls.length).toBe(1)
    await expect.element(page.getByTestId('setup-python').getByText('Passed', { exact: true })).toBeVisible()
    await expect.element(page.getByTestId('setup-bridge').getByText('Not tested', { exact: true })).toBeVisible()
    await expect.element(page.getByTestId('setup-chat').getByRole('button', { name: 'Test chat' })).toBeDisabled()
    await expect.element(page.getByTestId('setup-speech').getByRole('button', { name: 'Preview speech' })).toBeDisabled()
    expect(mocks.install).not.toHaveBeenCalled()
    await page.screenshot({ path: 'wow-setup-checks.png' })
  })
  it('requires an explicit click to install and shows the backup plus restart instruction', async () => {
    const report = setupInspection()
    report.directory = 'C:/Games/WoW/_retail_'
    report.client = { status: 'passed', code: 'client-found' }
    mocks.inspect.mockResolvedValue(report)
    mocks.install.mockResolvedValue({ inspection: { ...report, addon: { status: 'passed', code: 'addon-found' } }, backup: 'C:/Games/WoW/_retail_/Interface/CompanionBackups/backup' })
    await mount()
    const button = page.getByRole('button', { name: 'Install or update companion addon' })
    await expect.element(button).toBeEnabled()
    expect(mocks.install).not.toHaveBeenCalled()
    await button.click()
    await expect.poll(() => mocks.install.mock.calls.length).toBe(1)
    expect(mocks.install).toHaveBeenCalledWith({ game: 'retail', directory: report.directory })
    await expect.element(page.getByText('Addon files were updated.', { exact: false })).toBeVisible()
    await expect.element(page.getByText('Previous addon backup', { exact: false })).toBeVisible()
  })
  it('never accepts demo observations as a real character connection', async () => {
    const state = setupState()
    state.bridge = {
      instanceId: 'demo',
      source: 'demo',
      status: 'demo',
      snapshot: null,
      lastSeen: new Date().toISOString(),
      ageSeconds: 0,
      eventCursor: 0,
      events: [],
      config: { x: 8, y: 8, cellSize: 1, pollMs: 100, paused: false },
      error: null,
      calendar: null,
      groupBuff: null,
      equipmentComparisons: [],
      equipmentComparisonError: null,
      equipmentLoadout: null,
      equipmentLoadoutError: null,
      inventory: null,
      inventoryReceivedAt: null,
      inventoryError: null,
      quests: null,
      questsReceivedAt: null,
      questsError: null,
      talents: null,
      talentsReceivedAt: null,
      talentsError: null,
    }
    mocks.state.mockResolvedValue(state)
    await mount()
    await expect.element(page.getByTestId('setup-capture').getByText('Failed', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Demo data does not prove a live character connection.')).toBeVisible()
  })
  it('shows actual character identity only for a fresh screen observation', async () => {
    const state = setupState()
    const snapshot: Snapshot = { v: 3, session: 'session', guid: 'Player-1', name: 'Adventurer', realm: 'Realm', seq: 1, tick: 1, level: 15, class: 'WARRIOR', spec: 0, faction: 'Horde', race: 'Orc', map: 1413, zone: 'Barrens', online: true, dead: false, combat: false, account: 'account', moneyEpoch: 'epoch', copper: 0, earned: 0, spent: 0 }
    state.bridge = { instanceId: 'bridge', source: 'screen', status: 'live', snapshot, lastSeen: new Date().toISOString(), ageSeconds: 0, eventCursor: 0, events: [], config: { x: 8, y: 8, cellSize: 1, pollMs: 100, paused: false }, error: null, calendar: null, groupBuff: null, equipmentComparisons: [], equipmentComparisonError: null, equipmentLoadout: null, equipmentLoadoutError: null, inventory: null, inventoryReceivedAt: null, inventoryError: null, quests: null, questsReceivedAt: null, questsError: null, talents: null, talentsReceivedAt: null, talentsError: null }
    mocks.state.mockResolvedValue(state)
    await mount()
    await expect.element(page.getByTestId('setup-capture').getByText('Passed', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Adventurer · Realm', { exact: false })).toBeVisible()
  })
  it('keeps failed prerequisite requests untested instead of reporting success', async () => {
    mocks.environment.mockRejectedValue(new Error('IPC failed'))
    await mount()
    await expect.element(page.getByText('Some checks did not finish.', { exact: false })).toBeVisible()
    await expect.element(page.getByTestId('setup-python').getByText('Not tested', { exact: true })).toBeVisible()
  })

  it('does not treat a saved but unavailable chat provider as a successful test', async () => {
    const { pinia } = await mount()
    const chat = useConsciousnessStore(pinia)
    chat.activeProvider = 'removed-provider'
    chat.activeModel = 'previously-selected-model'
    await expect.element(page.getByTestId('setup-chat').getByText('Not tested', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Test chat' }).click()
    await expect.element(page.getByTestId('setup-chat').getByText('Failed', { exact: true })).toBeVisible()
  })

  it('requires user confirmation after real browser playback starts', async () => {
    // A valid silent WAV exercises browser decoding. The mocked provider never receives a paid request.
    const bytes = new ArrayBuffer(8044)
    const data = new DataView(bytes)
    const ascii = (offset: number, text: string) => [...text].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)))
    ascii(0, 'RIFF')
    data.setUint32(4, 8036, true)
    ascii(8, 'WAVEfmt ')
    data.setUint32(16, 16, true)
    data.setUint16(20, 1, true)
    data.setUint16(22, 1, true)
    data.setUint32(24, 8000, true)
    data.setUint32(28, 16000, true)
    data.setUint16(32, 2, true)
    data.setUint16(34, 16, true)
    ascii(36, 'data')
    data.setUint32(40, 8000, true)
    mocks.speech.mockResolvedValue(bytes)
    const { pinia } = await mount()
    const speech = useSpeechStore(pinia)
    useProviderConfigStore(pinia).ensureProvider('openai-compatible-audio-speech', 'openai-compatible-audio-speech', { baseUrl: 'https://example.invalid/v1/', apiKey: 'test-only', model: 'test-model', voice: 'test-voice' })
    speech.activeSpeechProvider = 'openai-compatible-audio-speech'
    speech.activeSpeechModel = 'test-model'
    speech.activeSpeechVoiceId = 'test-voice'
    expect(mocks.speech).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Preview speech' }).click()
    await expect.element(page.getByRole('button', { name: 'I heard it', exact: true })).toBeVisible()
    await expect.element(page.getByTestId('setup-speech').getByText('Not tested', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'I heard it', exact: true }).click()
    await expect.element(page.getByTestId('setup-speech').getByText('Passed', { exact: true })).toBeVisible()
  })
})

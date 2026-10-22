import type { CompanionState, Snapshot } from '../../../shared/wow-companion'

import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowCompanion from './wow-companion.vue'

import { defaultSettings } from '../../../shared/wow-companion'
import { useWowCompanionStore } from '../../stores/wow-companion'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const invokeMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setAccountName: vi.fn(),
  setSettings: vi.fn(),
  setCapture: vi.fn(),
  demo: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:wow-companion:get-receive': return invokeMocks.getState
      case 'eventa:invoke:wow-companion:account-name-receive': return invokeMocks.setAccountName
      case 'eventa:invoke:wow-companion:settings-receive': return invokeMocks.setSettings
      case 'eventa:invoke:wow-companion:capture-receive': return invokeMocks.setCapture
      case 'eventa:invoke:wow-companion:demo-receive': return invokeMocks.demo
      default: throw new Error(`Unexpected Eventa invoke: ${event.receiveEvent?.id}`)
    }
  },
}))

const now = Date.parse('2026-10-22T10:00:00Z')
const snapshot: Snapshot = {
  v: 2,
  session: 'session-1',
  seq: 1,
  tick: 1,
  guid: 'Player-1',
  name: 'Mage',
  realm: 'Azeroth',
  level: 30,
  class: 'MAGE',
  spec: 64,
  map: 84,
  zone: 'Stormwind',
  combat: false,
  dead: false,
  online: true,
  account: 'account-1',
  moneyEpoch: 'money-1',
  copper: 12345678,
  earned: 50000,
  spent: 10000,
}

function liveState(): CompanionState {
  return {
    settings: { ...defaultSettings },
    bridge: {
      instanceId: 'decoder-1',
      status: 'live',
      source: 'screen',
      snapshot: { ...snapshot },
      lastSeen: new Date(now).toISOString(),
      ageSeconds: 0,
      eventCursor: 0,
      events: [],
      config: { x: 8, y: 32, cellSize: 1, pollMs: 500, paused: false },
      error: null,
    },
    error: null,
    updatedAt: now,
    gold: {
      storageError: null,
      accounts: [{
        account: 'account-1',
        name: 'Main account',
        earned: '50000',
        spent: '10000',
        net: '40000',
        balance: '12345678',
        characterCount: 1,
        firstSeen: now,
        lastSeen: now,
        characters: [{ guid: 'Player-1', name: 'Mage', realm: 'Azeroth', copper: 12345678, earned: '50000', spent: '10000', net: '40000', firstSeen: now, lastSeen: now }],
      }],
    },
  }
}

async function renderPage(state = liveState(), locale = 'en') {
  invokeMocks.getState.mockResolvedValue(state)
  const pinia = createPinia()
  setActivePinia(pinia)
  const companion = useWowCompanionStore(pinia)
  const screen = await render(WowCompanion, {
    global: {
      plugins: [pinia, createI18n({
        legacy: false,
        locale,
        messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } },
        missingWarn: false,
        fallbackWarn: false,
      })],
    },
  })
  onTestFinished(() => {
    companion.stop()
    screen.unmount()
  })
  await expect.poll(() => companion.state.updatedAt).toBe(now)
  return { companion, pinia }
}

describe('woW companion gold ledger', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows exact large totals, signed net changes, and each account separately', async () => {
    await page.viewport(1024, 900)
    const state = liveState()
    state.gold.accounts.push({
      account: 'account-2',
      name: 'Alt account',
      earned: '9007199254740994',
      spent: '9007199254753561',
      net: '-12567',
      balance: '20000',
      characterCount: 1,
      firstSeen: now,
      lastSeen: now,
      characters: [{ guid: 'Player-2', name: 'Warrior', realm: 'Lordaeron', copper: 20000, earned: '9007199254740994', spent: '9007199254753561', net: '-12567', firstSeen: now, lastSeen: now }],
    })
    await renderPage(state)

    await expect.element(page.getByRole('heading', { name: 'Gold ledger', exact: true })).toBeInTheDocument()
    const main = page.getByRole('article', { name: 'Main account' })
    const alt = page.getByRole('article', { name: 'Alt account' })
    await expect.element(main.getByRole('rowheader', { name: 'Mage' })).toBeInTheDocument()
    await expect.element(main.getByRole('cell', { name: '1,234g 56s 78c', exact: true })).toBeInTheDocument()
    await expect.element(alt.getByRole('rowheader', { name: 'Warrior' })).toBeInTheDocument()
    await expect.element(alt.getByRole('cell', { name: '900,719,925,474g 9s 94c', exact: true })).toBeInTheDocument()
    await expect.element(alt.getByText('−1g 25s 67c', { exact: true })).toBeInTheDocument()
  })

  it('keeps a draft label across polling and saves it through main', async () => {
    const { companion } = await renderPage()
    const label = page.getByRole('textbox', { name: 'Account label', exact: true })
    await label.fill('Raiding account')
    const refreshed = liveState()
    refreshed.gold.accounts[0]!.balance = '12345679'
    invokeMocks.getState.mockResolvedValue(refreshed)
    await companion.refresh()
    await expect.element(label).toHaveValue('Raiding account')

    const saved = liveState()
    saved.gold.accounts[0]!.name = 'Raiding account'
    invokeMocks.setAccountName.mockResolvedValue(saved)
    invokeMocks.getState.mockResolvedValue(saved)
    await page.getByRole('button', { name: 'Save label', exact: true }).click()

    expect(invokeMocks.setAccountName).toHaveBeenCalledWith({ account: 'account-1', name: 'Raiding account' })
    await expect.element(page.getByRole('article', { name: 'Raiding account' })).toBeInTheDocument()
    await expect.element(page.getByRole('status')).toHaveTextContent('Saved.')
  })

  it('shows an empty ledger and no current balance for demo capture', async () => {
    const state = liveState()
    state.gold.accounts = []
    if (state.bridge) {
      state.bridge.status = 'demo'
      state.bridge.source = 'demo'
    }
    await renderPage(state)

    await expect.element(page.getByText('No real money observations yet.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
    expect(page.getByRole('article').elements()).toHaveLength(0)
    await expect.element(page.getByText('1,234g 56s 78c', { exact: true })).not.toBeInTheDocument()
  })

  it('reports storage failures without confirming the label was saved', async () => {
    await renderPage()
    const failed = liveState()
    failed.gold.storageError = 'Disk full'
    invokeMocks.setAccountName.mockResolvedValue(failed)
    invokeMocks.getState.mockResolvedValue(failed)
    await page.getByRole('textbox', { name: 'Account label', exact: true }).fill('Main')
    await page.getByRole('button', { name: 'Save label', exact: true }).click()

    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(page.getByRole('status').elements()).toHaveLength(0)
  })

  it('keeps recorded balances but hides current money after a capture error', async () => {
    const state = liveState()
    if (state.bridge)
      state.bridge.error = 'Checksum mismatch'
    await renderPage(state)

    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Main account' }).getByRole('cell', { name: '1,234g 56s 78c', exact: true })).toBeInTheDocument()
  })

  it.each([375, 1024])('keeps the character table inside a %i pixel viewport', async (width) => {
    await page.viewport(width, 900)
    const state = liveState()
    state.gold.accounts[0]!.name = '主账号'
    state.gold.accounts[0]!.characters[0]!.name = '法师'
    state.gold.accounts[0]!.characters[0]!.realm = '艾泽拉斯'
    await renderPage(state, 'zh-Hans')
    const account = page.getByRole('article', { name: '主账号' })
    await expect.element(page.getByRole('heading', { name: '金币账本', exact: true })).toBeInTheDocument()
    const article = account.element()
    const table = article.querySelector('table')
    const scroller = table?.parentElement
    if (!scroller)
      throw new Error('Expected a character table scroll area')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(article.getBoundingClientRect().right).toBeLessThanOrEqual(width)
    expect(getComputedStyle(scroller).overflowX).toBe('auto')
    if (width === 375)
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
    await account.screenshot({ path: `__screenshots__/wow-companion-gold-${width}.png` })
  })

  it('updates chat money context silently and removes stale observations', async () => {
    const { companion, pinia } = await renderPage()
    companion.start(true)
    await companion.refresh()
    const contexts = useChatContextStore(pinia)
    await expect.poll(() => JSON.stringify(contexts.getContextsSnapshot())).toContain('12345678')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('100 copper = 1 silver')

    const changed = liveState()
    if (changed.bridge?.snapshot) {
      changed.bridge.snapshot.seq = 2
      changed.bridge.snapshot.copper = 12345679
      changed.bridge.snapshot.earned = 50001
    }
    invokeMocks.getState.mockResolvedValue(changed)
    await companion.refresh()
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')
    expect(companion.responseState).toBe('idle')

    if (changed.bridge)
      changed.bridge.error = 'Checksum mismatch'
    invokeMocks.getState.mockResolvedValue(changed)
    await companion.refresh()
    expect(contexts.getContextsSnapshot()).toEqual({})

    if (changed.bridge)
      changed.bridge.error = null
    await companion.refresh()
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')

    if (changed.bridge)
      changed.bridge.status = 'stale'
    invokeMocks.getState.mockResolvedValue(changed)
    await companion.refresh()
    expect(contexts.getContextsSnapshot()).toEqual({})
  })
})

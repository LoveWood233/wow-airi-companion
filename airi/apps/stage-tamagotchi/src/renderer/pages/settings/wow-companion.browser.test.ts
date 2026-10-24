import type { CompanionState, GameVersion, Snapshot } from '../../../shared/wow-companion'
import type { EquipmentRecord } from '../../../shared/wow-companion-equipment'
import type { EquipmentHistoryEntry } from '../../../shared/wow-companion-equipment-history'
import type { EquipmentSwap } from '../../../shared/wow-companion-equipment-swaps'

import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowCompanionForever from './wow-companion-forever.vue'
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

function liveState(game: GameVersion = 'retail'): CompanionState {
  return {
    game,
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
    equipmentHistory: { entries: [], storageError: null },
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

function disabledForever(): CompanionState {
  const state = liveState('forever')
  state.settings.enabled = false
  state.updatedAt = 0
  state.bridge = null
  state.gold.accounts = []
  return state
}

function newEquipment(name: string, id = 1): EquipmentRecord {
  return {
    v: 1,
    id,
    session: snapshot.session,
    guid: snapshot.guid,
    itemID: 19019,
    itemGUID: 'Item-1',
    link: '|Hitem:19019|h[Equipment]|h',
    name,
    type: 'Weapon',
    subtype: 'Sword',
    equipLoc: 'INVTYPE_WEAPON',
    quality: 5,
    itemLevel: 50,
    requiredLevel: 30,
    stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 12 }, { key: 'UNKNOWN_STAT', value: 3 }],
    tooltip: ['+12 Strength', 'Set (2): Gain a bonus'],
    quantity: 1,
    observedAt: Math.floor(now / 1000),
    source: 'bag_added',
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
  }
}

function mockStates(retail: CompanionState, forever = disabledForever()) {
  invokeMocks.getState.mockImplementation(({ game }: { game: GameVersion }) => Promise.resolve(structuredClone(game === 'retail' ? retail : forever)))
}

function savedEquipment(record: EquipmentRecord, labels: Partial<EquipmentHistoryEntry> = {}): EquipmentHistoryEntry {
  return { account: snapshot.account, name: snapshot.name, realm: snapshot.realm, receivedAt: now, record, ...labels }
}

function newEquipmentSwap(id = 1): EquipmentSwap {
  return { v: 1, kind: 'swap', s: snapshot.session, g: snapshot.guid, id, e: 1, st: 'equipped', r: 'confirmed', at: Math.floor(now / 1000), slot: 16, item: 19019, old: 123 }
}

async function renderPage(state = liveState(), locale = 'en', forever = disabledForever()) {
  mockStates(state, forever)
  const pinia = createPinia()
  setActivePinia(pinia)
  const companion = useWowCompanionStore(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/wow-companion', component: WowCompanion },
      { path: '/settings/wow-companion-forever', component: WowCompanionForever },
    ],
  })
  await router.push('/settings/wow-companion')
  await router.isReady()
  const screen = await render(RouterView, {
    global: {
      plugins: [pinia, router, createI18n({
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
  await expect.poll(() => companion.profiles.retail.state.updatedAt).toBe(now)
  return { companion, pinia, router }
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
    mockStates(refreshed)
    await companion.refresh('retail')
    await expect.element(label).toHaveValue('Raiding account')

    const saved = liveState()
    saved.gold.accounts[0]!.name = 'Raiding account'
    invokeMocks.setAccountName.mockResolvedValue(saved)
    mockStates(saved)
    await page.getByRole('button', { name: 'Save label', exact: true }).click()

    expect(invokeMocks.setAccountName).toHaveBeenCalledWith({ game: 'retail', request: { account: 'account-1', name: 'Raiding account' } })
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
    mockStates(failed)
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
    await companion.refresh('retail')
    const contexts = useChatContextStore(pinia)
    await expect.poll(() => JSON.stringify(contexts.getContextsSnapshot())).toContain('12345678')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('100 copper = 1 silver')

    const changed = liveState()
    if (changed.bridge?.snapshot) {
      changed.bridge.snapshot.seq = 2
      changed.bridge.snapshot.copper = 12345679
      changed.bridge.snapshot.earned = 50001
    }
    mockStates(changed)
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')
    expect(companion.profiles.retail.responseState).toBe('idle')

    if (changed.bridge)
      changed.bridge.error = 'Checksum mismatch'
    mockStates(changed)
    await companion.refresh('retail')
    expect(contexts.getContextsSnapshot()).toEqual({})

    if (changed.bridge)
      changed.bridge.error = null
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')

    if (changed.bridge)
      changed.bridge.status = 'stale'
    mockStates(changed)
    await companion.refresh('retail')
    expect(contexts.getContextsSnapshot()).toEqual({})
  })
})

describe('woW version profiles', () => {
  beforeEach(() => vi.resetAllMocks())

  it('opens both version pages and discards unsaved settings when switching', async () => {
    const retail = liveState()
    const forever = disabledForever()
    forever.settings.cooldownSeconds = 7
    await renderPage(retail, 'en', forever)
    await page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' }).fill('99')
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()

    await expect.element(page.getByRole('heading', { name: 'World of Warcraft: Forever', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Companion disabled', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('This version is prepared before the client release.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(7)
    await expect.element(page.getByRole('button', { name: 'Start demo', exact: true })).toBeDisabled()
    await page.screenshot({ path: '__screenshots__/wow-companion-forever-page.png' })
    expect(page.getByRole('article').elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'World of Warcraft Retail', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'World of Warcraft Retail', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(20)
    expect(invokeMocks.setSettings).not.toHaveBeenCalled()
    await page.screenshot({ path: '__screenshots__/wow-companion-retail-page.png' })
  })

  it('enables a profile whose bridge has never connected', async () => {
    const forever = disabledForever()
    const { companion } = await renderPage(liveState(), 'en', forever)
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    expect(companion.profiles.forever.state.updatedAt).toBe(0)
    await expect.element(page.getByRole('switch', { name: 'Enable companion', exact: false })).toBeEnabled()
    await page.getByRole('switch', { name: 'Enable companion', exact: false }).click()
    const enabled = structuredClone(forever)
    enabled.settings.enabled = true
    invokeMocks.setSettings.mockResolvedValue(enabled)
    mockStates(liveState(), enabled)
    await page.getByRole('button', { name: 'Save preferences' }).click()
    expect(invokeMocks.setSettings).toHaveBeenCalledWith({ game: 'forever', settings: enabled.settings })
    expect(companion.profiles.forever.state.settings.enabled).toBe(true)
  })

  it('saves calibration and demo commands only to the visible version', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (forever.bridge)
      forever.bridge.config.x = 128
    const { companion } = await renderPage(retail, 'en', forever)
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('spinbutton', { name: 'Grid left (X)' })).toHaveValue(128)
    const saved = structuredClone(forever)
    if (!saved.bridge)
      throw new Error('Expected bridge')
    saved.bridge.config.x = 144
    invokeMocks.setCapture.mockResolvedValue(saved)
    await page.getByRole('spinbutton', { name: 'Grid left (X)' }).fill('144')
    await page.getByRole('button', { name: 'Apply calibration' }).click()
    expect(invokeMocks.setCapture).toHaveBeenCalledWith({ game: 'forever', capture: saved.bridge.config })
    expect(companion.profiles.retail.state.bridge?.config.x).toBe(8)
    const demo = structuredClone(saved)
    if (!demo.bridge)
      throw new Error('Expected bridge')
    demo.bridge.status = 'demo'
    demo.bridge.source = 'demo'
    invokeMocks.demo.mockResolvedValue(demo)
    await page.getByRole('button', { name: 'Start demo', exact: true }).click()
    expect(invokeMocks.demo).toHaveBeenCalledWith({ game: 'forever', request: { enabled: true, action: 'none' } })
    expect(companion.profiles.retail.state.bridge?.source).toBe('screen')
    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
  })

  it('keeps pending account saves and settings feedback on their original page', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    forever.gold.accounts[0]!.name = 'Forever account'
    forever.gold.accounts[0]!.balance = '500'
    forever.settings.cooldownSeconds = 7
    const { companion } = await renderPage(retail, 'en', forever)
    const labelSave = Promise.withResolvers<CompanionState>()
    const settingsSave = Promise.withResolvers<CompanionState>()
    invokeMocks.setAccountName.mockReturnValue(labelSave.promise)
    invokeMocks.setSettings.mockReturnValue(settingsSave.promise)
    await page.getByRole('textbox', { name: 'Account label', exact: true }).fill('Retail saved label')
    await page.getByRole('button', { name: 'Save label', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' }).fill('55')
    await page.getByRole('button', { name: 'Save preferences' }).click()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('textbox', { name: 'Account label', exact: true })).toHaveValue('Forever account')
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(7)
    const saved = structuredClone(retail)
    saved.gold.accounts[0]!.name = 'Retail saved label'
    saved.settings.cooldownSeconds = 55
    mockStates(saved, forever)
    labelSave.resolve(saved)
    settingsSave.resolve(saved)
    await expect.poll(() => companion.profiles.retail.state.settings.cooldownSeconds).toBe(55)
    await expect.element(page.getByRole('textbox', { name: 'Account label', exact: true })).toHaveValue('Forever account')
    expect(page.getByRole('status').elements()).toHaveLength(0)
    expect(companion.profiles.forever.state.gold.accounts[0]!.balance).toBe('500')
    expect(invokeMocks.setSettings).toHaveBeenCalledWith({ game: 'retail', settings: { ...retail.settings, cooldownSeconds: 55 } })
  })

  it('keeps equal character and account identifiers in separate model contexts', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!forever.bridge?.snapshot)
      throw new Error('Expected snapshot')
    forever.bridge.snapshot.copper = 990011
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:retail:player')
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('12345678')
    expect(text).toContain('990011')
    expect(text).toContain('Game version: forever')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')

    forever.bridge.source = 'demo'
    forever.bridge.status = 'demo'
    mockStates(retail, forever)
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:retail:player')
    expect(text).not.toContain('wow:forever:player')
    forever.settings.allowDemo = true
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('SIMULATION')
    forever.error = 'Forever bridge unavailable'
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('wow:forever:player')
    expect(text).toContain('wow:retail:player')
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Forever bridge unavailable')
    await page.getByRole('button', { name: 'World of Warcraft Retail', exact: true }).click()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('keeps event cursors and reaction policies separate for equal character sessions', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    const { companion } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const changedForever = structuredClone(forever)
    const changedRetail = structuredClone(retail)
    for (const state of [changedForever, changedRetail]) {
      if (!state.bridge)
        throw new Error('Expected bridge')
      state.bridge.eventCursor = 1
      state.bridge.events = [{
        id: 1,
        type: 'level_up',
        timestamp: new Date().toISOString(),
        title: `${state.game} level up`,
        detail: `${state.game} event`,
        snapshot: { ...snapshot, level: 31, seq: 2 },
        demo: false,
      }]
    }
    mockStates(retail, changedForever)
    await companion.refresh('forever')
    expect(companion.profiles.forever.responseState).toBe('model-required')
    expect(companion.profiles.retail.responseState).toBe('idle')
    mockStates(changedRetail, changedForever)
    await companion.refresh('retail')
    expect(companion.profiles.retail.responseState).toBe('model-required')
    await expect.element(page.getByText('retail level up', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('forever level up', { exact: true })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByText('forever level up', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('retail level up', { exact: true })).not.toBeInTheDocument()
  })

  it('rejects cross-version responses and ignores a read that predates a save', async () => {
    const { companion } = await renderPage()
    companion.stop()
    const oldRead = Promise.withResolvers<CompanionState>()
    invokeMocks.getState.mockReturnValueOnce(oldRead.promise)
    const reading = companion.refresh('retail')
    const saved = liveState()
    saved.settings.muted = true
    invokeMocks.setSettings.mockResolvedValue(saved)
    await companion.setSettings('retail', saved.settings)
    oldRead.resolve(liveState())
    await reading
    expect(companion.profiles.retail.state.settings.muted).toBe(true)
    invokeMocks.getState.mockResolvedValue(liveState('forever'))
    await companion.refresh('retail')
    expect(companion.profiles.retail.state.game).toBe('retail')
    expect(companion.profiles.retail.error).toContain('another game profile')
    invokeMocks.demo.mockResolvedValue(liveState('forever'))
    await expect(companion.demo('retail', { enabled: true, action: 'none' })).rejects.toThrow('another game profile')
  })
})

describe('woW equipment view and chat context', () => {
  beforeEach(() => vi.resetAllMocks())

  it('explains how to update a supported bridge that only supplies character data', async () => {
    const { companion, pinia } = await renderPage()
    await expect.element(page.getByText('This bridge only provides character data.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByText('Use a capture interval between 250 and 500 ms.', { exact: false })).toBeInTheDocument()
    companion.start(true)
    await companion.refresh('retail')
    expect(JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())).toContain('Stormwind')
  })

  it('shows isolated equipment details and preserves missing values and literal tooltip text', async () => {
    await page.viewport(1024, 900)
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    const item = newEquipment('Retail sword')
    item.itemLevel = null
    item.quality = 0
    item.requiredLevel = 0
    item.infoComplete = false
    item.truncated = true
    item.tooltip.push('<script>window.invalidEquipment = true</script>')
    retail.bridge.equipment = [item]
    forever.bridge.equipment = [newEquipment('Forever sword')]
    retail.equipmentHistory.entries = [savedEquipment(item)]
    forever.equipmentHistory.entries = [savedEquipment(forever.bridge.equipment[0]!)]
    await renderPage(retail, 'en', forever)
    const article = page.getByRole('article', { name: 'Retail sword', exact: true })
    await expect.element(article).toBeInTheDocument()
    await expect.element(article.getByText('Item level Unavailable', { exact: false })).toBeInTheDocument()
    await expect.element(article.getByText('Item details: Incomplete', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('Some text was shortened', { exact: true })).toBeInTheDocument()
    const toggle = article.getByRole('button', { name: 'Show equipment details' })
    await toggle.click()
    await expect.element(article.getByRole('button', { name: 'Hide equipment details' })).toHaveAttribute('aria-expanded', 'true')
    await expect.element(article.getByText('Strength', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('UNKNOWN_STAT', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('Poor', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('0', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('<script>window.invalidEquipment = true</script>', { exact: true })).toBeInTheDocument()
    expect(article.element().querySelector('script')).toBeNull()
    await expect.element(article.getByText('It does not prove that a set bonus or effect is currently active.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Forever sword', exact: true })).not.toBeInTheDocument()
    await article.screenshot({ path: '__screenshots__/wow-companion-equipment-retail.png' })
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('article', { name: 'Forever sword', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Retail sword', exact: true })).not.toBeInTheDocument()
    const foreverArticle = page.getByRole('article', { name: 'Forever sword', exact: true })
    await foreverArticle.getByRole('button', { name: 'Show equipment details' }).click()
    await foreverArticle.screenshot({ path: '__screenshots__/wow-companion-equipment-forever.png' })
  })

  it('updates equipment context without a new snapshot sequence and keeps profiles separate', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    forever.bridge.equipment = [newEquipment('Forever blade')]
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('Retail blade')
    const retailBlade = newEquipment('Retail blade')
    retailBlade.tooltip = Array.from({ length: 40 }, (_, i) => `Tooltip line ${i + 1}`)
    retailBlade.tooltip[39] = 'Set (4): A bonus at the end of the tooltip.'
    retailBlade.stats = Array.from({ length: 32 }, (_, i) => ({ key: `ATTRIBUTE_${i + 1}`, value: i + 1 }))
    retail.bridge.equipment = [retailBlade]
    retail.equipmentHistory.entries = [savedEquipment(retailBlade)]
    mockStates(retail, forever)
    await companion.refresh('retail')
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('Retail blade')
    expect(text).toContain('Forever blade')
    expect(text).toContain('untrusted_equipment_data')
    expect(text).toContain('Set (4): A bonus at the end of the tooltip.')
    expect(text).toContain('ATTRIBUTE_32')
    expect(text).toContain('does not prove its bonus is active')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')
    retail.bridge.status = 'stale'
    mockStates(retail, forever)
    await companion.refresh('retail')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('Retail blade')
    expect(text).toContain('Forever blade')
    await expect.element(page.getByRole('article', { name: 'Retail blade', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Historical record', { exact: true })).toBeInTheDocument()
  })

  it('keeps equipment history after a session change while removing the old live context', async () => {
    const state = liveState()
    if (!state.bridge)
      throw new Error('Expected bridge')
    state.bridge.equipment = [newEquipment('Observed sword')]
    state.equipmentHistory.entries = [savedEquipment(state.bridge.equipment[0]!)]
    state.bridge.equipmentError = 'Incomplete equipment frame'
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    await expect.element(page.getByText('Incomplete equipment frame', { exact: false })).toBeInTheDocument()
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('Observed sword')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('Stormwind')
    const changed = structuredClone(state)
    if (!changed.bridge?.snapshot)
      throw new Error('Expected snapshot')
    changed.bridge.snapshot.session = 'session-2'
    mockStates(changed)
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('Observed sword')
    await expect.element(page.getByRole('article', { name: 'Observed sword', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Historical record', { exact: true })).toBeInTheDocument()
  })

  it('keeps Chinese equipment details inside a narrow viewport', async () => {
    await page.viewport(375, 900)
    const state = liveState()
    if (!state.bridge)
      throw new Error('Expected bridge')
    const item = newEquipment('测试长剑')
    item.tooltip = ['套装（2）：提高伤害。这只是提示说明，不表示当前激活。', '长文字'.repeat(25)]
    item.link = 'item:'.repeat(150)
    state.bridge.equipment = [item]
    state.equipmentHistory.entries = [savedEquipment(item, { name: '测试角色', realm: '银月服务器' })]
    await renderPage(state, 'zh-Hans')
    const article = page.getByRole('article', { name: '测试长剑', exact: true })
    await article.getByRole('button', { name: '查看装备详情' }).click()
    await expect.element(article.getByText('力量', { exact: true })).toBeInTheDocument()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
    expect(article.element().getBoundingClientRect().right).toBeLessThanOrEqual(375)
    await article.screenshot({ path: '__screenshots__/wow-companion-equipment-375.png' })
  })

  it.each(['disconnected', 'disabled', 'stale', 'paused', 'demo', 'offline'] as const)('keeps ten saved records visible when %s', async (status) => {
    const state = liveState()
    state.equipmentHistory.entries = Array.from({ length: 10 }, (_, index) => savedEquipment(newEquipment(`History item ${index + 1}`, index + 1), { receivedAt: now + index }))
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    if (status === 'disconnected') {
      state.bridge = null
    }
    else if (status === 'disabled') {
      state.settings.enabled = false
    }
    else if (status === 'offline') {
      state.bridge.snapshot.online = false
    }
    else {
      state.bridge.status = status
      if (status === 'demo')
        state.bridge.source = 'demo'
    }
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    expect(history.getByRole('article').elements()).toHaveLength(10)
    expect(history.getByRole('heading', { level: 3 }).elements().map(element => element.textContent?.trim())).toEqual(Array.from({ length: 10 }, (_, index) => `History item ${10 - index}`))
    expect(history.getByText('Historical record', { exact: true }).elements()).toHaveLength(10)
  })

  it('replaces the oldest displayed record and retains complete details without adding history to chat', async () => {
    const state = liveState()
    state.equipmentHistory.entries = Array.from({ length: 10 }, (_, index) => savedEquipment(newEquipment(`Saved item ${index + 1}`, index + 1), { receivedAt: now + index }))
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    const next = newEquipment('Newest saved item', 11)
    next.stats = Array.from({ length: 32 }, (_, index) => ({ key: `ATTRIBUTE_${index + 1}`, value: index + 1 }))
    next.tooltip = Array.from({ length: 40 }, (_, index) => `Tooltip line ${index + 1}`)
    next.tooltip[39] = 'Set (4): The final stored bonus.'
    next.observedAt = 0
    state.equipmentHistory.entries = [...state.equipmentHistory.entries.slice(1), savedEquipment(next, { receivedAt: now + 10 })]
    mockStates(state)
    await companion.refresh('retail')
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    expect(history.getByRole('article').elements()).toHaveLength(10)
    await expect.element(history.getByRole('article', { name: 'Saved item 1', exact: true })).not.toBeInTheDocument()
    expect(history.getByRole('heading', { level: 3 }).elements()[0]?.textContent?.trim()).toBe('Newest saved item')
    const newest = history.getByRole('article', { name: 'Newest saved item', exact: true })
    await newest.getByRole('button', { name: 'Show equipment details' }).click()
    await expect.element(newest.getByText('ATTRIBUTE_32', { exact: true })).toBeInTheDocument()
    await expect.element(newest.getByText('Set (4): The final stored bonus.', { exact: true })).toBeInTheDocument()
    await expect.element(newest.getByText('Observed at Unavailable', { exact: true })).toBeInTheDocument()
    expect(newest.element().querySelector('time')?.dateTime).toBe(new Date(now + 10).toISOString())
    expect(JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())).not.toContain('Newest saved item')
    expect(companion.profiles.retail.responseState).toBe('idle')
  })

  it('distinguishes equal record identifiers across characters and sessions with separate detail controls', async () => {
    const state = liveState()
    const second = { ...newEquipment('Second character sword'), guid: 'Player-2' }
    const third = { ...newEquipment('Later session sword'), session: 'session-2' }
    state.equipmentHistory.entries = [
      savedEquipment(newEquipment('First character sword')),
      savedEquipment(second, { name: 'Warrior', realm: 'Lordaeron', receivedAt: now + 1 }),
      savedEquipment(third, { receivedAt: now + 2 }),
    ]
    state.bridge = null
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    const buttons = history.getByRole('button', { name: 'Show equipment details' }).elements()
    const ids = buttons.map(button => button.getAttribute('aria-controls'))
    expect(new Set(ids).size).toBe(3)
    for (const name of ['First character sword', 'Second character sword', 'Later session sword']) {
      const article = history.getByRole('article', { name, exact: true })
      const button = article.getByRole('button', { name: 'Show equipment details' })
      const controls = button.element().getAttribute('aria-controls')
      await button.click()
      if (!controls)
        throw new Error('Expected a details control identifier')
      expect(article.element().contains(document.getElementById(controls))).toBe(true)
    }
    await expect.element(history.getByRole('article', { name: 'Second character sword' }).getByText('Character Warrior · Realm Lordaeron', { exact: true })).toBeInTheDocument()
    expect(history.getByText('Character Mage · Realm Azeroth', { exact: true }).elements()).toHaveLength(2)
  })

  it('reports history storage errors while keeping received records readable', async () => {
    const state = liveState()
    state.bridge = null
    state.equipmentHistory.entries = [savedEquipment(newEquipment('<script>unsafe()</script>'), { name: '<img src=x onerror=unsafe()>', realm: '<b>Azeroth</b>' })]
    state.equipmentHistory.storageError = 'Disk full'
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    await expect.element(history.getByRole('alert')).toHaveTextContent('Disk full')
    await expect.element(history.getByRole('article', { name: '<script>unsafe()</script>', exact: true })).toBeInTheDocument()
    await expect.element(history.getByText('Character <img src=x onerror=unsafe()> · Realm <b>Azeroth</b>', { exact: true })).toBeInTheDocument()
    expect(history.element().querySelector('script, img, b')).toBeNull()
  })
})

describe('woW equipment confirmation results', () => {
  beforeEach(() => vi.resetAllMocks())

  it('supports a bridge without result reporting and provides no remote confirmation control', async () => {
    await renderPage()
    const results = page.getByRole('region', { name: 'Equipment change results', exact: true })
    await expect.element(results.getByText('This bridge does not supply equipment change results.', { exact: false })).toBeInTheDocument()
    await expect.element(results.getByText('It does not change equipment or send input to the game.', { exact: false })).toBeInTheDocument()
    expect(results.getByRole('button').elements()).toHaveLength(0)
  })

  it('keeps results separate by version and matches only the exact equipment observation', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    retail.bridge.equipment = [newEquipment('Retail result sword')]
    retail.bridge.equipmentSwaps = [newEquipmentSwap(), { ...newEquipmentSwap(2), item: 999, st: 'failed', r: 'timeout', at: 0 }]
    forever.bridge.equipment = [newEquipment('Forever result sword')]
    forever.bridge.equipmentSwaps = [{ ...newEquipmentSwap(), st: 'declined', r: 'user' }]
    await renderPage(retail, 'en', forever)
    const results = page.getByRole('region', { name: 'Equipment change results', exact: true })
    await expect.element(results.getByText('Retail result sword', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Item 999', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Result time Unavailable', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('The addon did not confirm the result. Check your equipment in the game.', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Forever result sword', { exact: true })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(results.getByText('Forever result sword', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Declined', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Retail result sword', { exact: true })).not.toBeInTheDocument()
  })

  it('updates same-sequence context without proactive chat and removes invalid or historical results', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('untrusted_equipment_confirmation_data')
    retail.bridge.equipmentSwaps = [newEquipmentSwap()]
    forever.bridge.equipmentSwaps = [{ ...newEquipmentSwap(), st: 'declined', r: 'user' }]
    mockStates(retail, forever)
    await companion.refresh('retail')
    await companion.refresh('forever')
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('untrusted_equipment_confirmation_data')
    expect(text).toContain('wow:retail:player')
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('Chat agreement cannot execute a change.')
    expect(text).toContain('equipped')
    expect(text).toContain('declined')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')
    retail.bridge.equipmentSwapError = 'Invalid confirmation frame'
    mockStates(retail, forever)
    await companion.refresh('retail')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('\\"st\\":\\"equipped\\"')
    expect(text).toContain('\\"st\\":\\"declined\\"')
    expect(text).toContain('Stormwind')
    await expect.element(page.getByText('Invalid confirmation frame', { exact: false })).toBeInTheDocument()
    retail.bridge.equipmentSwapError = null
    retail.bridge.status = 'stale'
    mockStates(retail, forever)
    await companion.refresh('retail')
    await expect.element(page.getByText('Last known results.', { exact: false })).toBeInTheDocument()
    retail.bridge.status = 'live'
    if (retail.bridge.snapshot)
      retail.bridge.snapshot.session = 'session-2'
    mockStates(retail, forever)
    await companion.refresh('retail')
    await expect.element(page.getByText('No equipment confirmation results in this character session.', { exact: true })).toBeInTheDocument()
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('\\"st\\":\\"equipped\\"')
  })

  it('shows Chinese timeout meanings and literal item names within a narrow viewport', async () => {
    await page.viewport(375, 900)
    const retail = liveState()
    if (!retail.bridge)
      throw new Error('Expected bridge')
    const name = '<script>unsafe()</script> 新获得的长名称装备'
    retail.bridge.equipment = [newEquipment(name)]
    retail.bridge.equipmentSwaps = [
      newEquipmentSwap(),
      { ...newEquipmentSwap(2), st: 'declined', r: 'user' },
      { ...newEquipmentSwap(3), st: 'expired', r: 'timeout' },
      { ...newEquipmentSwap(4), st: 'failed', r: 'timeout' },
    ]
    await renderPage(retail, 'zh-Hans')
    const results = page.getByRole('region', { name: '确认换装记录', exact: true })
    await expect.element(results.getByText('未能确认换装结果，请检查游戏穿戴栏。', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('询问已过期，插件没有执行换装。', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('请在游戏内最终确认。在 AIRI 中选择“好”只会显示下一步提示，不会执行换装或向游戏发送输入。', { exact: true })).toBeInTheDocument()
    expect(results.element().querySelector('script')).toBeNull()
    expect(results.getByRole('button').elements()).toHaveLength(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
    expect(results.element().getBoundingClientRect().right).toBeLessThanOrEqual(375)
    await page.viewport(375, 1200)
    await results.screenshot({ path: '__screenshots__/wow-companion-equipment-swaps-375.png' })
  })
})

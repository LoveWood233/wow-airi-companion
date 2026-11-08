import type { McpCallToolResult } from '@proj-airi/stage-ui/tools/mcp'
import type { CDPSession } from '@vitest/browser-playwright'

import type { CompanionState, GameVersion } from '../../shared/wow-companion'

import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { cdp, page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-quests.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-quests.yaml?raw'
import detail from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/quest-detail-horde.json'
import listed from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/quest-list-horde.json'
import WowQuestsPage from '../pages/settings/wow-quests.vue'
import WowQuests from './wow-quests.vue'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { useWowChatterSettingsStore } from '../stores/wow-chatter-settings'
import { useWowCompanionStore } from '../stores/wow-companion'
import { useWowQuestsStore } from '../stores/wow-quests'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ state: vi.fn(), list: vi.fn(), call: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event.receiveEvent?.id
    if (id === 'eventa:invoke:wow-companion:get-receive')
      return ipc.state
    if (id === 'eventa:invoke:electron:mcp:list-tools-receive')
      return ipc.list
    if (id === 'eventa:invoke:electron:mcp:call-tool-receive')
      return ipc.call
    return async () => {
      throw new Error(`Unexpected IPC ${id}`)
    }
  },
}))

let states: Record<GameVersion, CompanionState>
const receivedAt = '2026-11-01T03:00:00.000Z'
const cache = { status: 'hit' as const, sourceReceivedAt: receivedAt, storedAt: receivedAt, servedAt: '2026-11-01T04:00:00.000Z', expiresAt: '2026-11-02T03:00:00.000Z' }

function state(game: GameVersion): CompanionState {
  const value = loadoutStateFixture()
  value.game = game
  value.settings.enabled = true
  value.bridge!.snapshot!.level = 15
  value.bridge!.snapshot!.zone = '贫瘠之地'
  value.bridge!.questsReceivedAt = new Date().toISOString()
  value.bridge!.quests = {
    v: 1,
    id: 1,
    guid: 'Player-1',
    session: 'login',
    observedAt: Math.floor(Date.now() / 1000),
    source: 'quest-log',
    log: { complete: true, truncated: false, total: 2, entries: [
      { questID: 844, title: 'Observed beak quest', level: 12, header: 'Observed category', readyForTurnIn: false, failed: false, objectivesComplete: true, objectives: [{ index: 1, text: 'Beaks collected', type: 'item', fulfilled: 2, required: 7, finished: false }] },
      { questID: 900, title: 'Observed ready quest', level: null, header: null, readyForTurnIn: true, failed: false, objectivesComplete: false, objectives: [] },
    ] },
    completion: { source: 'completed-api', scope: 'unknown', complete: false, truncated: true, total: 600, ids: [845], turnIns: [{ questID: 846, observedAt: Math.floor(Date.now() / 1000) }] },
  }
  return value
}

function reply(value: unknown): McpCallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt }, cache }
}

function response(args: Record<string, unknown> = {}): McpCallToolResult {
  if (args.id)
    return reply({ ...detail, id: `quest:${args.id}`, quest_id: args.id, title: args.id === 844 ? detail.title : `Related quest ${args.id}` })
  return reply({ ...listed, page_size: args.limit, limit: args.limit, offset: args.offset, has_more: args.offset === 0 })
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.removeItem('settings/wow-chatter/quest-enabled')
  states = { forever: state('forever'), retail: state('retail') }
  ipc.state.mockImplementation(async (request: { game: GameVersion }) => {
    const value = structuredClone(states[request.game])
    value.bridge!.lastSeen = new Date().toISOString()
    return value
  })
  ipc.list.mockResolvedValue([{ name: 'wuxianwow::quests', toolName: 'quests', serverName: 'wuxianwow', inputSchema: {} }])
  ipc.call.mockImplementation(async (payload: { arguments?: Record<string, unknown> }) => response(payload.arguments))
})

function translations(locale = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-quests': parse(en) }, 'zh-Hans': { 'wow-quests': parse(zh) } } })
}

async function mount(locale = 'en') {
  const pinia = createPinia()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#fff', color: dark ? '#e5e5e5' : '#171717' } }, h(WowQuests)) })
  const screen = render(host, { global: { plugins: [pinia, translations(locale)] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  const companion = useWowCompanionStore(pinia)
  await expect.poll(() => companion.profiles.forever.loaded).toBe(true)
  return { screen, quests: useWowQuestsStore(pinia), companion, chatter: useWowChatterSettingsStore(pinia) }
}

async function search() {
  await page.getByRole('button', { name: 'Search quests', exact: true }).click()
  await expect.element(page.getByTestId('wow-quests-results').getByText('平原陆行鸟的威胁', { exact: true })).toBeVisible()
}

describe('quest and leveling settings with real Pinia', () => {
  it('reads local telemetry on entry, keeps drafts local, and persists reminders only after manual enable', async () => {
    const { chatter } = await mount()
    await expect.element(page.getByTestId('quest-log-844')).toHaveTextContent('Observed in the quest log')
    await page.getByRole('textbox', { name: 'Quest name or ID', exact: true }).fill('draft')
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
    expect(chatter.questEnabled).toBe(false)
    const toggle = page.getByTestId('wow-quest-reminders').getByRole('switch')
    await expect.element(toggle).not.toBeChecked()
    await toggle.click()
    expect(chatter.questEnabled).toBe(true)
    expect(localStorage.getItem('settings/wow-chatter/quest-enabled')).toBe('true')
    await expect.element(page.getByTestId('wow-quest-reminders')).toHaveTextContent('global three-minute cooldown')
    expect(ipc.call).not.toHaveBeenCalled()
  })

  it('shows objective counts, incomplete coverage, completion flags, and session turn-ins separately', async () => {
    await mount()
    await page.getByTestId('quest-log-844').getByText('Observed objectives', { exact: true }).click()
    await expect.element(page.getByTestId('quest-log-844')).toHaveTextContent('2 / 7')
    await expect.element(page.getByTestId('quest-log-844')).toHaveTextContent('Objective not marked complete')
    await expect.element(page.getByTestId('quest-log-900')).toHaveTextContent('Ready to turn in; not yet proof of turn-in')
    await page.getByText('Client completion flags', { exact: true }).click()
    await expect.element(page.getByTestId('wow-quests-current')).toHaveTextContent('They do not prove turn-in')
    await expect.element(page.getByTestId('wow-quests-current')).toHaveTextContent('An absent ID cannot prove')
    await page.getByText('Observed turn-ins in this session', { exact: true }).click()
    await expect.element(page.getByTestId('wow-quests-current')).toHaveTextContent('Quest 846')
  })

  it('submits one bounded Forever search and preserves original source and cache times', async () => {
    await mount()
    await search()
    expect(ipc.call).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::quests', arguments: { view: 'confirmed', sort: 'level', level_min: 12, level_max: 18, req_max: 15, side: '部落', zone: '贫瘠之地', limit: 20, offset: 0 } })
    const result = page.getByTestId('wow-quests-results')
    await expect.element(result).toHaveTextContent('无限图鉴 wuxianwow.com')
    await expect.element(result).toHaveTextContent('1.60.1.70707')
    await expect.element(result).toHaveTextContent('Read from query cache')
    await expect.element(result.getByRole('link', { name: '平原陆行鸟的威胁', exact: true })).toHaveAttribute('href', 'https://wuxianwow.com/quest/844')
    await expect.element(result).toHaveTextContent(new Date(receivedAt).toLocaleString('en'))
    await expect.element(result).toHaveTextContent(new Date(cache.servedAt).toLocaleString('en'))
    await expect.element(result).toHaveTextContent(new Date(cache.expiresAt).toLocaleString('en'))
  })

  it('opens details with the search-time conditions, renders temporary NPCs and coordinates, and follows chains explicitly', async () => {
    const { quests } = await mount()
    await search()
    quests.editLevel(1)
    quests.editFaction('Alliance')
    await page.getByRole('button', { name: 'Read details · 平原陆行鸟的威胁', exact: true }).click()
    const region = page.getByTestId('wow-quests-detail')
    await expect.element(region).toHaveTextContent('瑟格拉·黑棘')
    await expect.element(region).toHaveTextContent('52.23, 31.01')
    await expect.element(region).toHaveTextContent('Temporary')
    await expect.element(region).toHaveTextContent('They do not prove the NPC is visible')
    expect(quests.detail?.entries[0]?.risks).toEqual([])
    expect(ipc.call).toHaveBeenCalledTimes(2)
    const related = region.getByRole('button', { name: 'Read related quest: 斑马的威胁', exact: true }).first()
    await related.click()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(3)
    await expect.element(region).toHaveTextContent('Related quest 845')
    expect(ipc.call.mock.lastCall?.[0].arguments).toEqual({ id: 845 })
  })

  it('escapes source text, rejects unsafe links, and labels structured conditions for the user', async () => {
    const { quests } = await mount()
    const title = '<img src=x onerror="invalid"> literal quest'
    ipc.call.mockResolvedValueOnce(reply({ ...detail, title, url: 'javascript:invalid', temporary: { ...detail.temporary, conditions: { prerequisites_all: [999], races: ['Orc'], repeatable: false } } }))
    await quests.openDetail(844)
    const region = page.getByTestId('wow-quests-detail')
    await expect.element(region).toHaveTextContent(title)
    expect(region.element().querySelector('img')).toBeNull()
    expect(region.element().querySelector('a[href^="javascript:"]')).toBeNull()
    await region.getByText('Known conditions', { exact: true }).click()
    await expect.element(region).toHaveTextContent('All of these prerequisite quests')
    await expect.element(region).toHaveTextContent('Race restrictions')
    await expect.element(region).not.toHaveTextContent('prerequisites_all')
    await expect.element(region).toHaveTextContent('Quest giver and turn-in marker')
  })

  it('keeps Retail queries within the current log and labels unknown level and faction limits', async () => {
    await mount()
    await page.getByRole('combobox', { name: 'Game data version' }).click()
    await page.getByRole('option', { name: 'World of Warcraft Retail', exact: true }).click()
    await expect.element(page.getByRole('textbox', { name: 'Quest-log category', exact: true })).toHaveValue('')
    await page.getByRole('button', { name: 'Search quests', exact: true }).click()
    const results = page.getByTestId('wow-quests-results')
    await expect.element(results).toHaveTextContent('Observed beak quest')
    await expect.element(results).toHaveTextContent('Observed ready quest')
    await expect.element(results).toHaveTextContent('No complete offline quest guide was queried')
    await expect.element(results).toHaveTextContent('Faction filtering is unavailable')
    await expect.element(results).toHaveTextContent('unknown levels are retained')
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
    await page.getByRole('textbox', { name: 'Quest-log category', exact: true }).fill('does not match')
    await page.getByRole('button', { name: 'Search quests', exact: true }).click()
    await expect.element(results).toHaveTextContent('No matching quest records were returned')
  })

  it('updates observed progress and its evidence clock without querying MCP again, and removes expired evidence', async () => {
    const observed = states.forever.bridge!.quests!
    states.forever.bridge!.quests = null
    const { quests, companion } = await mount()
    await search()
    expect(quests.results?.sources.some(source => source.kind === 'quest-log')).toBe(false)
    states.forever.bridge!.quests = observed
    states.forever.bridge!.quests!.id++
    states.forever.bridge!.quests!.observedAt++
    states.forever.bridge!.quests!.log.entries[0].readyForTurnIn = true
    await companion.refresh('forever')
    await expect.element(page.getByTestId('results-quest:844')).toHaveTextContent('Ready to turn in; not yet proof of turn-in')
    const observations = quests.results?.sources.filter(source => source.kind === 'quest-log')
    expect(observations).toHaveLength(1)
    expect(observations?.[0].observedAt).toBe(new Date(states.forever.bridge!.quests!.observedAt * 1000).toISOString())
    expect(quests.results?.sources[0]).toMatchObject({ receivedAt, cache })
    states.forever.bridge!.quests!.observedAt -= 200
    await companion.refresh('forever')
    await expect.element(page.getByTestId('results-quest:844')).toHaveTextContent('Player progress unknown')
    expect(quests.results?.sources.some(source => source.kind === 'quest-log')).toBe(false)
    expect(ipc.call).toHaveBeenCalledTimes(1)
  })

  it('does not claim an empty log after a bridge failure or when the companion is disabled', async () => {
    const { companion } = await mount()
    ipc.state.mockImplementation(async (request: { game: GameVersion }) => {
      if (request.game === 'forever')
        throw new Error('test disconnect')
      return structuredClone(states.retail)
    })
    await companion.refresh('forever')
    await expect.element(page.getByTestId('wow-quests-current')).toHaveTextContent('No current quest-log snapshot is available')
    await expect.element(page.getByTestId('quest-log-844')).not.toBeInTheDocument()
    states.forever.settings.enabled = false
    ipc.state.mockImplementation(async (request: { game: GameVersion }) => structuredClone(states[request.game]))
    await companion.refresh('forever')
    await expect.element(page.getByTestId('wow-quests-current')).not.toHaveTextContent('contains no quests')
  })

  it('rejects invalid filters before discovery and separates source failure from an empty search', async () => {
    const { quests } = await mount()
    quests.editLevel(0)
    await quests.search()
    expect(ipc.list).not.toHaveBeenCalled()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Check the level')
    quests.editLevel(15)
    ipc.call.mockRejectedValueOnce(new Error('private transport details'))
    await page.getByRole('button', { name: 'Search quests', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('reference source is unavailable')
    expect(page.getByTestId('wow-quests').element().textContent).not.toContain('private transport details')
    await expect.element(page.getByTestId('wow-quests-results')).not.toHaveTextContent('No matching quest records')
  })

  it('does not paginate using edited draft conditions and requests a fresh first page explicitly', async () => {
    await mount()
    await search()
    await page.getByRole('textbox', { name: 'Quest name or ID', exact: true }).fill('edited draft')
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Check the level')
    expect(ipc.call).toHaveBeenCalledTimes(1)
    await search()
    expect(ipc.call.mock.lastCall?.[0].arguments).toMatchObject({ query: 'edited draft', offset: 0 })
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(3)
    expect(ipc.call.mock.lastCall?.[0].arguments).toMatchObject({ query: 'edited draft', offset: 20 })
    await expect.element(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
  })

  it('invalidates an earlier view request when remounted and permits a new explicit query', async () => {
    const pinia = createPinia()
    const options = { global: { plugins: [pinia, translations()] } }
    let screen = render(WowQuests, options)
    const companion = useWowCompanionStore(pinia)
    const quests = useWowQuestsStore(pinia)
    const pending = Promise.withResolvers<McpCallToolResult>()
    const oldResponse = reply({ ...listed, page_size: 20, limit: 20, results: listed.results.map(row => ({ ...row, title: 'Old view result', display_name: 'Old view result' })) })
    onTestFinished(() => {
      pending.resolve(oldResponse)
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.poll(() => companion.profiles.forever.loaded).toBe(true)
    ipc.call.mockReturnValueOnce(pending.promise)
    const oldRequest = quests.search()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(1)
    screen.unmount()
    screen = render(WowQuests, options)
    await expect.poll(() => quests.busy).toBe(false)
    await search()
    pending.resolve(oldResponse)
    await oldRequest
    await expect.element(page.getByTestId('wow-quests-results')).not.toHaveTextContent('Old view result')
    expect(ipc.call).toHaveBeenCalledTimes(2)
  })

  it('discards a previous character response and keeps a later query independently usable', async () => {
    const { quests, companion } = await mount()
    const pending = Promise.withResolvers<McpCallToolResult>()
    ipc.call.mockReturnValueOnce(pending.promise)
    const old = quests.search()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(1)
    states.forever.bridge!.snapshot!.guid = 'Player-other'
    states.forever.bridge!.quests = null
    await companion.refresh('forever')
    await expect.poll(() => quests.busy).toBe(false)
    expect(quests.results).toBeNull()
    pending.resolve(response({ limit: 20, offset: 0 }))
    await old
    expect(quests.results).toBeNull()
    await search()
    expect(quests.results?.entries.every(entry => entry.progress.status === 'unknown')).toBe(true)
  })

  it('reads a canonical chat deep link once and rejects malformed or cross-version route inputs', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-quests', component: WowQuestsPage }] })
    await router.push('/settings/wow-quests?game=forever&id=quest:844')
    await router.isReady()
    const screen = render(RouterView, { global: { plugins: [pinia, translations(), router] } })
    onTestFinished(() => {
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.element(page.getByTestId('wow-quests-detail')).toHaveTextContent('平原陆行鸟的威胁')
    expect(ipc.call).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::quests', arguments: { id: 844 } })
    await router.push('/settings/wow-quests?game=forever&id=quest:0844')
    await router.push('/settings/wow-quests?game=invalid&id=quest:845')
    await router.push('/settings/wow-quests?game=forever&id=quest:2147483648')
    await router.push('/settings/wow-quests?game=forever&id=quest:844')
    expect(ipc.call).toHaveBeenCalledTimes(1)
    await router.push('/settings/wow-quests?game=retail&id=quest:900')
    await expect.element(page.getByTestId('wow-quests-detail')).toHaveTextContent('Observed ready quest')
    expect(ipc.call).toHaveBeenCalledTimes(1)
  })

  it('renders Chinese at a narrow viewport with escaped source text and complete evidence', async () => {
    // Keep the outer test window tall enough to capture the full 375px iframe without scaling or clipping.
    const chromium: CDPSession = cdp()
    await chromium.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2600, deviceScaleFactor: 1, mobile: false })
    await page.viewport(375, 2300)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
      await chromium.send('Emulation.clearDeviceMetricsOverride')
    })
    const { quests } = await mount('zh-Hans')
    await quests.search()
    await quests.openDetail(844)
    const region = page.getByTestId('wow-quests-detail')
    await expect.element(region).toHaveTextContent('任务详情')
    await expect.element(region).toHaveTextContent('无限图鉴 wuxianwow.com')
    await expect.element(region).toHaveTextContent('读取查询缓存')
    const root = page.getByTestId('wow-quests').element()
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1)
    expect(root.textContent).not.toContain('wow-quests.')
    region.element().scrollIntoView({ block: 'start' })
    await region.screenshot({ path: 'wow-quests-detail-zh-dark.png' })
  })
})

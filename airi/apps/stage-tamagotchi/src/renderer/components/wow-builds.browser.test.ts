import type { RetailDatabaseQuery, RetailDatabaseResult, RetailDatabaseSource } from '@proj-airi/stage-shared/wow-knowledge'
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

import en from '../../../../../packages/i18n/src/locales/en/wow-builds.yaml?raw'
import companionEn from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-builds.yaml?raw'
import companionZh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import item from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-item-base.json'
import spell from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-spell-warrior.json'
import plan from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-talents-plan.json'
import talents from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-talents-warrior.json'
import WowBuildsPage from '../pages/settings/wow-builds.vue'
import WowBuilds from './wow-builds.vue'

import { useWowBuildsStore } from '../stores/wow-builds'
import { useWowCompanionStore } from '../stores/wow-companion'
import { buildStateFixture } from '../utils/wow-build.test-helper'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ state: vi.fn(), list: vi.fn(), call: vi.fn(), database: vi.fn() }))
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
    if (id === 'eventa:invoke:wow-retail-database:query-receive')
      return ipc.database
    return async () => {
      throw new Error(`Unexpected IPC ${id}`)
    }
  },
}))

let states: Record<GameVersion, CompanionState>
const receivedAt = '2026-11-01T03:00:00.000Z'
const cache = { status: 'hit' as const, sourceReceivedAt: receivedAt, storedAt: receivedAt, servedAt: '2026-11-01T04:00:00.000Z', expiresAt: '2026-11-02T03:00:00.000Z' }
const databaseSource: RetailDatabaseSource = {
  name: '正式服本地 DB2',
  game: 'retail',
  product: 'wow',
  localOnly: true,
  build: '12.1.5.70575',
  locale: 'zhCN',
  exportedAt: '2026-10-30T01:00:00.000Z',
  hotfixesApplied: false,
  datasetId: 'a'.repeat(64),
  tables: [{ name: 'ItemSparse', rows: 1, status: 'decoded_with_encrypted_sections', encrypted: true }],
}

function reply(value: unknown): McpCallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt }, cache }
}

beforeEach(() => {
  vi.resetAllMocks()
  states = { forever: buildStateFixture('forever'), retail: buildStateFixture('retail') }
  ipc.state.mockImplementation(async (request: { game: GameVersion }) => {
    const value = structuredClone(states[request.game])
    value.bridge!.lastSeen = new Date().toISOString()
    return value
  })
  ipc.list.mockResolvedValue(['talents', 'spellbook', 'item_usage'].map(name => ({ name: `wuxianwow::${name}`, toolName: name, serverName: 'wuxianwow', inputSchema: {} })))
  ipc.call.mockImplementation(async (payload: { name: string, arguments?: Record<string, unknown> }) => {
    if (payload.name === 'wuxianwow::talents')
      return reply(payload.arguments?.build ? plan : talents)
    if (payload.name === 'wuxianwow::spellbook')
      return reply(spell)
    if (payload.name === 'wuxianwow::item_usage')
      return reply(item)
    throw new Error('Unexpected source tool')
  })
  ipc.database.mockImplementation(async (request: RetailDatabaseQuery): Promise<RetailDatabaseResult> => {
    const id = request.operation === 'fetch' ? request.id : 'item:277979'
    const kind = id.startsWith('spell:') ? 'spell' : 'item'
    return { operation: 'fetch', outcome: 'ok', source: databaseSource, receivedAt, cache, entries: [{ id, kind, numericId: Number(id.split(':')[1]), title: `Local ${id}`, fields: [{ key: 'StatPercentEditor0', value: '12345' }, { key: 'Description_lang', value: '<img src=x onerror="invalid"> raw local text' }], links: [], notices: [] }], offset: 0, limit: 1, hasMore: false, notices: ['client-db2-only'] }
  })
})

function translations(locale = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-builds': parse(en), 'wow-companion': parse(companionEn) }, 'zh-Hans': { 'wow-builds': parse(zh), 'wow-companion': parse(companionZh) } } })
}

async function mount(locale = 'en') {
  const pinia = createPinia()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#fff', color: dark ? '#e5e5e5' : '#171717' } }, h(WowBuilds)) })
  const screen = render(host, { global: { plugins: [pinia, translations(locale)] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  const companion = useWowCompanionStore(pinia)
  await expect.poll(() => companion.profiles.forever.loaded).toBe(true)
  return { screen, builds: useWowBuildsStore(pinia), companion }
}

async function mode(label: string) {
  await page.getByRole('combobox', { name: 'Explain a reference', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function queryNode() {
  await page.getByRole('spinbutton', { name: 'Talent node ID (optional)', exact: true }).fill('105958')
  await page.getByRole('button', { name: 'Search talents', exact: true }).click()
  await expect.element(page.getByTestId('build-node-105958')).toHaveTextContent('强化英勇打击')
}

describe('talent and equipment settings with real Pinia', () => {
  it('reads current facts only on entry, distinguishes unknown and empty slots, and keeps drafts local', async () => {
    const { builds } = await mount()
    expect(builds.classId).toBe(1)
    expect(builds.level).toBe(15)
    await expect.element(page.getByTestId('wow-builds-current')).toHaveTextContent('Stable committed talent observations')
    expect(page.getByTestId('wow-builds-current').element().querySelectorAll('li[data-testid^="build-slot-"]')).toHaveLength(19)
    await expect.element(page.getByTestId('build-slot-2')).toHaveTextContent('Slot contents unknown')
    await expect.element(page.getByTestId('build-slot-3')).toHaveTextContent('Observed empty slot')
    await page.getByRole('spinbutton', { name: 'Talent node ID (optional)', exact: true }).fill('105958')
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
    expect(ipc.database).not.toHaveBeenCalled()
    await page.getByTestId('build-slot-16').getByText('Observed attributes and tooltip', { exact: true }).click()
    await expect.element(page.getByTestId('build-slot-16')).toHaveTextContent('1234:5678')
  })

  it('queries one explicit node, preserves source and cache times, and reads spells only after a click', async () => {
    await mount()
    await queryNode()
    expect(ipc.call).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::talents', arguments: { class: '1', level: 15, compact: false } })
    const result = page.getByTestId('wow-builds-result')
    await expect.element(result).toHaveTextContent('Same client build')
    await expect.element(result).toHaveTextContent('Read from query cache')
    await expect.element(result).toHaveTextContent(new Date(receivedAt).toLocaleString('en'))
    await expect.element(result).toHaveTextContent(new Date(cache.servedAt).toLocaleString('en'))
    await expect.element(result).toHaveTextContent(new Date(cache.expiresAt).toLocaleString('en'))
    await expect.element(result.getByRole('link', { name: 'Read this reference on 无限图鉴', exact: true })).toHaveAttribute('href', 'https://wuxianwow.com/talents/1')
    await expect.element(result).not.toHaveTextContent('Planned purchased points')
    await result.getByRole('button', { name: 'Read spell 12282', exact: true }).first().click()
    await expect.element(page.getByTestId('wow-build-spell')).toHaveTextContent('使你的英勇打击消耗的怒气减少1点')
    expect(ipc.call).toHaveBeenCalledTimes(2)
  })

  it('does not map current ranks across client builds or turn absent selected nodes into zero', async () => {
    states.forever.bridge!.talents!.clientBuild = '1.60.1.70708'
    const { builds } = await mount()
    await queryNode()
    expect(builds.result?.nodes[0].currentRank).toBeUndefined()
    await expect.element(page.getByTestId('build-node-105958')).toHaveTextContent('Unverified across builds')
    await expect.element(page.getByTestId('build-node-105958')).toHaveTextContent('Current rank remains unknown')
  })

  it('compares explicit Retail node lists locally and separates purchased points from granted active ranks', async () => {
    states.retail.bridge!.talents!.nodes[0].ranksPurchased = 3
    states.retail.bridge!.talents!.nodes[0].activeRank = 4
    const { builds } = await mount()
    builds.selectGame('retail')
    await mode('Compare a pasted talent plan')
    await page.getByRole('textbox', { name: /Talent plan text/ }).fill('[{"nodeId":105958,"rank":3},{"nodeId":105957,"rank":0},{"nodeId":105956,"rank":1}]')
    await page.getByRole('button', { name: 'Compare talent plan', exact: true }).click()
    await expect.element(page.getByTestId('build-node-105958')).toHaveTextContent('Observed active rank')
    expect(builds.result?.nodes.find(node => node.nodeId === 105958)).toMatchObject({ currentRank: 4, purchasedRank: 3, plannedRank: 3, delta: 0 })
    expect(builds.result?.nodes.find(node => node.nodeId === 105957)?.currentRank).toBe(0)
    expect(builds.result?.nodes.find(node => node.nodeId === 105956)?.currentRank).toBeUndefined()
    expect(ipc.call).not.toHaveBeenCalled()
    expect(ipc.database).not.toHaveBeenCalled()
  })

  it('normalizes website plans only through the selected source and rejects unsupported or malformed inputs', async () => {
    const { builds } = await mount()
    await mode('Compare a pasted talent plan')
    await page.getByRole('textbox', { name: /Talent plan text/ }).fill('https://wuxianwow.com/talents/1?t=3--')
    await page.getByRole('button', { name: 'Compare talent plan', exact: true }).click()
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('The source normalized this plan')
    expect(ipc.call.mock.lastCall?.[0].arguments.build).toBe('https://wuxianwow.com/talents/1?t=3--')
    builds.selectGame('retail')
    builds.mode = 'plan'
    builds.planText = 'https://wuxianwow.com/talents/1?t=3--'
    await builds.submit()
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('This input format or cross-version plan is unsupported')
    expect(ipc.call).toHaveBeenCalledTimes(1)
    builds.planText = '[{"nodeId":105958,"rank":1},{"nodeId":105958,"rank":2}]'
    await builds.submit()
    await expect.element(page.getByRole('alert')).toHaveTextContent('plan format is invalid')
  })

  it('keeps staged edits separate from a committed allocation and does not expose draft nodes', async () => {
    const snapshot = states.forever.bridge!.talents!
    snapshot.status = 'staged'
    snapshot.hasStagedChanges = true
    snapshot.nodes = []
    snapshot.knownZeroNodes = []
    snapshot.complete = false
    const { builds } = await mount()
    await expect.element(page.getByTestId('wow-builds-current')).toHaveTextContent('Uncommitted talent edits were detected')
    await expect.element(page.getByTestId('current-talent-105958')).not.toBeInTheDocument()
    await queryNode()
    expect(builds.result?.nodes[0].currentRank).toBeUndefined()
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('Stable committed talents for this class are unavailable')
  })

  it('compares one chosen slot using the actual instance and a base catalog item without claiming combat gains', async () => {
    const { builds } = await mount()
    await mode('Compare an item with an equipped slot')
    await page.getByRole('spinbutton', { name: 'Candidate item ID', exact: true }).fill('277979')
    await page.getByRole('button', { name: 'Compare equipment', exact: true }).click()
    const result = page.getByTestId('wow-build-item')
    await expect.element(result).toHaveTextContent('Observed weapon')
    await expect.element(result).toHaveTextContent('殴斗者的羊肉')
    await expect.element(result).toHaveTextContent('Slot matches')
    expect(builds.result?.item?.differences.find(row => row.key === 'ITEM_MOD_STAMINA_SHORT')).toMatchObject({ current: 2, candidate: 5, delta: 3 })
    await expect.element(result).toHaveTextContent('Base catalog reference; bonus instance not established')
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('No damage simulation')
    expect(ipc.call).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::item_usage', arguments: { item_id: 277979 } })
  })

  it('distinguishes an observed empty slot from an unknown slot and does not compare mismatched positions', async () => {
    const { builds } = await mount()
    builds.mode = 'gear'
    builds.itemId = 277979
    builds.slot = 17
    await builds.submit()
    expect(builds.result?.item?.baselineState).toBe('empty')
    expect(builds.result?.item?.differences.find(row => row.key === 'ITEM_MOD_STAMINA_SHORT')).toMatchObject({ current: 0, candidate: 5, delta: 5 })
    builds.slot = 2
    await builds.submit()
    expect(builds.result?.item?.baselineState).toBe('unknown')
    expect(builds.result?.item?.differences.every(row => row.current === undefined && row.delta === undefined)).toBe(true)
    await expect.element(page.getByTestId('wow-build-item')).toHaveTextContent('Slot does not match')
    await expect.element(page.getByTestId('wow-build-item')).toHaveTextContent('It is not treated as empty')
  })

  it('uses Retail DB2 raw facts, preserves snapshot limitations, and escapes client field text', async () => {
    const { builds } = await mount()
    builds.selectGame('retail')
    builds.mode = 'gear'
    builds.itemId = 277979
    await builds.submit()
    expect(ipc.database).toHaveBeenCalledExactlyOnceWith({ operation: 'fetch', id: 'item:277979' })
    expect(ipc.call).not.toHaveBeenCalled()
    const result = page.getByTestId('wow-builds-result')
    await expect.element(result).toHaveTextContent('正式服本地 DB2')
    await expect.element(result).toHaveTextContent('Hotfixes were not applied')
    await expect.element(result).toHaveTextContent('Some source sections are encrypted')
    await page.getByText('Raw source fields', { exact: true }).click()
    await expect.element(result).toHaveTextContent('12345')
    await expect.element(result).toHaveTextContent('<img src=x onerror="invalid"> raw local text')
    expect(result.element().querySelector('img')).toBeNull()
    expect(builds.result?.item?.differences.every(row => row.candidate === undefined && row.delta === undefined)).toBe(true)
  })

  it('marks earlier explanations as outdated after observations change without querying remotely again', async () => {
    const { builds, companion } = await mount()
    await queryNode()
    const originalTime = builds.result?.sources.find(source => source.kind === 'talent-observation')?.observedAt
    states.forever.bridge!.talents!.id++
    states.forever.bridge!.talents!.observedAt++
    states.forever.bridge!.talents!.nodes[0].activeRank = 2
    await companion.refresh('forever')
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('Character observations changed after this explanation')
    expect(builds.result?.nodes[0].currentRank).toBe(1)
    expect(builds.result?.sources.find(source => source.kind === 'talent-observation')?.observedAt).toBe(originalTime)
    expect(ipc.call).toHaveBeenCalledTimes(1)
  })

  it('keeps equipment results current through an unrelated talent refresh and marks actual equipment changes', async () => {
    const { builds, companion } = await mount()
    builds.mode = 'gear'
    builds.itemId = 277979
    await builds.submit()
    states.forever.bridge!.talents!.id++
    states.forever.bridge!.talents!.observedAt++
    await companion.refresh('forever')
    expect(builds.resultStale).toBe(false)
    states.forever.bridge!.equipmentLoadout!.id++
    states.forever.bridge!.equipmentLoadout!.observedAt = Math.floor(Date.now() / 1000)
    await companion.refresh('forever')
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('Character observations changed after this explanation')
    expect(ipc.call).toHaveBeenCalledTimes(1)
  })

  it('re-enables a remounted page and discards its previous view response', async () => {
    const pinia = createPinia()
    const options = { global: { plugins: [pinia, translations()] } }
    let screen = render(WowBuilds, options)
    const builds = useWowBuildsStore(pinia)
    const companion = useWowCompanionStore(pinia)
    const pending = Promise.withResolvers<McpCallToolResult>()
    const oldReply = reply({ ...talents, trees: talents.trees.map(tree => ({ ...tree, talents: tree.talents.map(node => ({ ...node, name: 'Old view record' })) })) })
    onTestFinished(() => {
      pending.resolve(oldReply)
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.poll(() => companion.profiles.forever.loaded).toBe(true)
    builds.nodeId = 105958
    ipc.call.mockReturnValueOnce(pending.promise)
    const old = builds.submit()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(1)
    screen.unmount()
    screen = render(WowBuilds, options)
    await expect.poll(() => builds.busy).toBe(false)
    await queryNode()
    pending.resolve(oldReply)
    await old
    await expect.element(page.getByTestId('wow-builds-result')).not.toHaveTextContent('Old view record')
    expect(ipc.call).toHaveBeenCalledTimes(2)
  })

  it('invalidates a previous character request and remains usable after a bridge failure', async () => {
    const { builds, companion } = await mount()
    const pending = Promise.withResolvers<McpCallToolResult>()
    ipc.call.mockReturnValueOnce(pending.promise)
    builds.nodeId = 105958
    const old = builds.submit()
    await expect.poll(() => ipc.call.mock.calls.length).toBe(1)
    states.forever.bridge!.snapshot!.guid = 'Player-other'
    states.forever.bridge!.talents = null
    states.forever.bridge!.equipmentLoadout = null
    await companion.refresh('forever')
    pending.resolve(reply(talents))
    await old
    expect(builds.result).toBeNull()
    expect(builds.busy).toBe(false)
    ipc.state.mockRejectedValueOnce(new Error('test disconnect'))
    await companion.refresh('forever')
    expect(builds.context.game).toBe('unknown')
    builds.editClassId(1)
    builds.editLevel(15)
    await builds.submit()
    await expect.element(page.getByTestId('wow-builds-result')).toHaveTextContent('Current rank remains unknown')
  })

  it('rejects invalid identifiers before discovery and keeps source errors distinct from empty facts', async () => {
    const { builds } = await mount()
    builds.nodeId = 0
    await builds.submit()
    expect(ipc.list).not.toHaveBeenCalled()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Check the game')
    builds.nodeId = 105958
    ipc.call.mockRejectedValueOnce(new Error('private provider detail'))
    await builds.submit()
    await expect.element(page.getByRole('alert')).toHaveTextContent('reference source is unavailable')
    expect(page.getByTestId('wow-builds').element().textContent).not.toContain('private provider detail')
  })

  it('opens canonical chat links once, rejects malformed node IDs, and queries Retail spell links only locally', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-builds', component: WowBuildsPage }] })
    await router.push('/settings/wow-builds?game=forever&classId=1&level=15&nodeId=105958')
    await router.isReady()
    const screen = render(RouterView, { global: { plugins: [pinia, translations(), router] } })
    onTestFinished(() => {
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.element(page.getByTestId('build-node-105958')).toHaveTextContent('强化英勇打击')
    expect(ipc.call).toHaveBeenCalledTimes(1)
    await router.push('/settings/wow-builds?game=forever&classId=1&level=15&nodeId=0105958')
    await router.push('/settings/wow-builds?game=forever&classId=1&level=15&nodeId=0')
    await router.push('/settings/wow-builds?game=forever&classId=1&level=15&nodeId=2147483648')
    await router.push('/settings/wow-builds?game=forever&classId=1&level=15&nodeId=105958')
    expect(ipc.call).toHaveBeenCalledTimes(1)
    await router.push('/settings/wow-builds?game=retail&spellId=12282')
    await expect.element(page.getByTestId('wow-build-spell')).toHaveTextContent('Local spell:12282')
    expect(ipc.database).toHaveBeenCalledExactlyOnceWith({ operation: 'fetch', id: 'spell:12282' })
    expect(ipc.call).toHaveBeenCalledTimes(1)
  })

  it('shows readable complete Chinese comparison evidence at a narrow viewport', async () => {
    const chromium: CDPSession = cdp()
    await chromium.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2600, deviceScaleFactor: 1, mobile: false })
    await page.viewport(375, 2300)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
      await chromium.send('Emulation.clearDeviceMetricsOverride')
    })
    const { builds } = await mount('zh-Hans')
    const observed = page.getByTestId('wow-builds-talents')
    await observed.getByText('节点 105958 · 生效等级：1', { exact: true }).click()
    await expect.element(observed).toHaveTextContent('本次观察未满足')
    observed.element().scrollIntoView({ block: 'start' })
    await observed.screenshot({ path: 'wow-builds-talents-zh-dark.png' })
    builds.mode = 'gear'
    builds.itemId = 277979
    await builds.submit()
    const result = page.getByTestId('wow-builds-result')
    await expect.element(result).toHaveTextContent('基础资料差值')
    await expect.element(result).toHaveTextContent('无限图鉴 wuxianwow.com')
    const root = page.getByTestId('wow-builds').element()
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1)
    expect(root.textContent).not.toContain('wow-builds.')
    result.element().scrollIntoView({ block: 'start' })
    await result.screenshot({ path: 'wow-builds-gear-zh-dark.png' })
  })
})

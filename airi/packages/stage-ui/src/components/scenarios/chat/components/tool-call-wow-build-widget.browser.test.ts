import type { WowBuildContext, WowBuildQuery, WowBuildResult } from '@proj-airi/stage-shared/wow-knowledge'

import { explainWowTalentNodes, readWowBuildAnswer, readWowBuildTalents, retailDatabaseSourceSchema, WOW_BUILD_ASSISTANT_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { parse as parseSchema } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../../i18n/src/locales/en/wow-build-reference.yaml?raw'
import zh from '../../../../../../i18n/src/locales/zh-Hans/wow-build-reference.yaml?raw'
import catalog from '../../../../../../stage-shared/src/wow-knowledge/fixtures/build-talents-warrior.json'
import retail from '../../../../../../stage-shared/src/wow-knowledge/fixtures/retail-database-stats.json'
import ToolCallWowBuildWidget from './tool-call-wow-build-widget.vue'

import { builtinToolCallWidgets } from './tool-call-widgets'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const observedAt = '2026-11-01T08:00:00.000Z'
const query: Extract<WowBuildQuery, { operation: 'compare-talents' }> = { operation: 'compare-talents', game: 'forever', classId: 1, level: 15, build: '[{"nodeId":105958,"rank":3}]' }
const context: WowBuildContext = {
  game: 'forever',
  guid: 'Player-1',
  session: 'session',
  talents: { guid: 'Player-1', session: 'session', observedAt, clientBuild: '1.60.1.70707', locale: 'zhCN', classID: 1, status: 'active', hasStagedChanges: false, scope: 'selected-nodes', complete: false, truncated: false, knownZeroNodes: [], nodes: [{ treeID: 777, nodeID: 105958, activeRank: 3, ranksPurchased: 2, maxRanks: 3, isAvailable: true, isVisible: true, meetsEdgeRequirements: true, entriesComplete: true, entries: [{ entryID: 101, definitionID: 201, spellID: 12282, rank: 3, isActive: true }], conditionsComplete: true, conditions: [] }] },
}

beforeEach(() => vi.stubEnv('RUNTIME_ENVIRONMENT', 'web'))
afterEach(() => vi.unstubAllEnvs())

function report(): WowBuildResult {
  const source = readWowBuildTalents(catalog, 1)
  if (!source)
    throw new Error('Invalid actual catalog fixture')
  const nodes = explainWowTalentNodes(source.nodes, query, context, '1.60.1.70707', { kind: 'nodes', nodes: [{ nodeId: 105958, rank: 3 }] }).filter(node => node.nodeId === 105958)
  const value: WowBuildResult = { operation: 'compare-talents', game: 'forever', outcome: 'ok', classId: 1, nodes, referenceUrl: 'https://wuxianwow.com/talents/1', plan: { kind: 'nodes', validation: 'partial', adjustments: [] }, sources: [{ kind: 'wuxianwow', game: 'forever', name: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt: observedAt }, { kind: 'talent-observation', game: 'forever', name: '已提交天赋观察', observedAt, build: '1.60.1.70707' }], notices: [] }
  const validated = readWowBuildAnswer(value, JSON.stringify({ request: JSON.stringify(query) }))
  if (!validated)
    throw new Error('Invalid recorded explanation')
  return validated
}

async function mount(value = report(), input: WowBuildQuery = query) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings/wow-builds', component: { template: '<div />' } }] })
  await router.push('/')
  const screen = render(ToolCallWowBuildWidget, { props: { report: value, request: input }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-Hans', messages: { 'en': { 'wow-build-reference': parse(en) }, 'zh-Hans': { 'wow-build-reference': parse(zh) } } })] } })
  onTestFinished(() => screen.unmount())
  return screen
}

describe('talent and equipment reference card', () => {
  it('separates invested points from the active rank and links the actual talent source', async () => {
    const screen = await mount()
    await expect.element(screen.getByText('强化英勇打击', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('已观察生效等级: 3', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('已观察投入点数: 2', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('投入差: +1', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('方案投入对应的基础说明', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '在无限图鉴查看' })).toHaveAttribute('href', 'https://wuxianwow.com/talents/1')
    await expect.element(screen.getByText('无限图鉴 wuxianwow.com', { exact: true })).toBeVisible()
  })

  it('retains original reference and game clocks when the cache is served later', async () => {
    const value = report()
    value.sources[0]!.cache = { status: 'hit', sourceReceivedAt: observedAt, storedAt: observedAt, servedAt: '2026-11-01T09:00:00.000Z', expiresAt: '2026-11-02T08:00:00.000Z' }
    const screen = await mount(value)
    await expect.element(screen.getByText('原始资料查询时间', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('游戏采集时间', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-11-01T09:00:00.000Z', { exact: true })).toBeVisible()
  })

  it('does not claim a current rank from unverified reference mappings', async () => {
    const value = report()
    value.nodes[0] = { ...value.nodes[0]!, currentRank: undefined, purchasedRank: undefined, delta: undefined, mapping: 'unverified' }
    value.sources = value.sources.filter(source => source.kind === 'wuxianwow')
    const screen = await mount(value)
    await expect.element(screen.getByText('已观察生效等级: 未知', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('尚未核实资料与当前天赋的映射。', { exact: true })).toBeVisible()
  })

  it('escapes source text and uses explicit node identities for desktop navigation', async () => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    const value = report()
    value.nodes[0]!.name = '<img src=x onerror=alert(1)>'
    const screen = await mount(value)
    await expect.element(screen.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
    await expect.element(screen.getByRole('link', { name: '查看此节点解释' })).toHaveAttribute('href', '/settings/wow-builds?game=forever&classId=1&level=15&nodeId=105958')
  })

  it('presents slot match without claiming usability or performance gains', async () => {
    const database = parseSchema(retailDatabaseSourceSchema, retail.source)
    const value: WowBuildResult = { operation: 'compare-item', game: 'retail', outcome: 'ok', nodes: [], item: { slot: 16, baselineState: 'unknown', candidate: { itemId: 25, name: 'Observed base record', stats: [], statsComplete: false, effects: [], fields: [], notices: [] }, compatibility: 'unknown', basis: 'unresolved', differences: [], notices: ['weapon-pair-requires-review'] }, sources: [{ kind: 'retail-db2', game: 'retail', name: '正式服本地 DB2', build: database.build, receivedAt: retail.receivedAt, database }], notices: [] }
    const screen = await mount(value, { operation: 'compare-item', game: 'retail', slot: 16, itemId: 25 })
    await expect.element(screen.getByText('部位是否匹配仍未知。', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('来源缺少可比较的数值属性，未知值不会补为零。', { exact: true })).toBeVisible()
    expect(document.querySelector('a')).toBeNull()
  })

  it('registers an independent native tool card', () => {
    expect(builtinToolCallWidgets[WOW_BUILD_ASSISTANT_TOOL_NAME]?.autoOpen).toBe(true)
  })
})

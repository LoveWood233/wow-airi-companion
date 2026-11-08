import type { WowQuestResult } from '@proj-airi/stage-shared/wow-knowledge'

import { readWowQuestAnswer, readWowQuestSource, WOW_QUEST_ASSISTANT_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../../i18n/src/locales/en/wow-quest-reference.yaml?raw'
import zh from '../../../../../../i18n/src/locales/zh-Hans/wow-quest-reference.yaml?raw'
import quest from '../../../../../../stage-shared/src/wow-knowledge/fixtures/quest-detail-horde.json'
import ToolCallWowQuestWidget from './tool-call-wow-quest-widget.vue'

import { builtinToolCallWidgets } from './tool-call-widgets'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

beforeEach(() => vi.stubEnv('RUNTIME_ENVIRONMENT', 'web'))
afterEach(() => vi.unstubAllEnvs())

function report() {
  const result = readWowQuestSource(quest, { operation: 'detail', game: 'forever', questId: 844 })
  const validated = readWowQuestAnswer(result, JSON.stringify({ request: '{"operation":"detail","game":"forever","questId":844}' }))
  if (!validated)
    throw new Error('Invalid actual fixture')
  return validated
}

async function mount(value: WowQuestResult, locale = 'zh-Hans') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings/wow-quests', component: { template: '<div />' } }] })
  await router.push('/')
  const screen = render(ToolCallWowQuestWidget, { props: { report: value }, global: { plugins: [router, createI18n({ legacy: false, locale, messages: { 'en': { 'wow-quest-reference': parse(en) }, 'zh-Hans': { 'wow-quest-reference': parse(zh) } } })] } })
  onTestFinished(() => screen.unmount())
  return screen
}

describe('quest reference chat card', () => {
  it('shows the actual Forever task, unknown progress, temporary evidence and its source link', async () => {
    const screen = await mount(report())
    await expect.element(screen.getByText('平原陆行鸟的威胁', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('角色进度未知', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('无限图鉴 wuxianwow.com', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '在无限图鉴查看' })).toHaveAttribute('href', 'https://wuxianwow.com/quest/844')
  })

  it('retains source query time when a cached result is served later', async () => {
    const value = report()
    value.sources[0]!.receivedAt = '2026-11-01T01:00:00.000Z'
    value.sources[0]!.cache = { status: 'hit', sourceReceivedAt: value.sources[0]!.receivedAt, storedAt: '2026-11-01T01:00:00.000Z', servedAt: '2026-11-01T02:00:00.000Z', expiresAt: '2026-11-02T01:00:00.000Z' }
    const screen = await mount(value)
    await expect.element(screen.getByText('原始资料查询时间', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-11-01T01:00:00.000Z', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-11-01T02:00:00.000Z', { exact: true })).toBeVisible()
  })

  it('keeps literal game text inert and offers a typed desktop detail route', async () => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    const value = report()
    value.entries[0]!.title = '<img src=x onerror=alert(1)>'
    const screen = await mount(value)
    await expect.element(screen.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
    await expect.element(screen.getByRole('link', { name: '打开任务助手' })).toHaveAttribute('href', '/settings/wow-quests?game=forever&id=quest:844')
  })

  it('distinguishes a Retail completion flag from a session turn-in without adding a remote link', async () => {
    const value = report()
    value.game = 'retail'
    value.sources = [{ kind: 'quest-log', game: 'retail', name: '角色任务遥测', observedAt: '2026-11-01T01:00:00Z' }]
    value.entries = [{ id: 'quest:844', questId: 844, title: 'Observed task', requirements: [], starts: [], ends: [], locations: [], previous: [], chain: [], conditions: [], risks: [], notices: [], detail: true, progress: { status: 'completed-flag', clientCompleted: true, completionScope: 'unknown', observedAt: '2026-11-01T01:00:00Z' } }]
    const screen = await mount(value)
    await expect.element(screen.getByText('客户端完成标记，适用范围未知', { exact: true })).toBeVisible()
    expect(document.querySelector('a')).toBeNull()
  })

  it('registers the built-in tool independently of MCP results', () => {
    expect(builtinToolCallWidgets[WOW_QUEST_ASSISTANT_TOOL_NAME]?.autoOpen).toBe(true)
  })

  it('does not present an incomplete empty result as a complete absence', async () => {
    const value = report()
    value.outcome = 'empty'
    value.entries = []
    value.notices = ['source-partial']
    const screen = await mount(value)
    await expect.element(screen.getByText('已观察资料中未找到匹配任务。', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('来源覆盖不完整，未收录的任务与细节仍为未知。', { exact: true })).toBeVisible()
  })
})

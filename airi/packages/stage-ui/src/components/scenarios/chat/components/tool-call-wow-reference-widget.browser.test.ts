import type { WowReferenceAnswer, WowReferenceEntry, WowReferenceStatus } from '@proj-airi/stage-shared/wow-knowledge'

import type { ChatSlicesToolCallResult } from '../../../../types/chat'
import type { ToolCallGroupItem } from './tool-call-group'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import enReference from '../../../../../../i18n/src/locales/en/wow-reference.yaml?raw'
import zhReference from '../../../../../../i18n/src/locales/zh-Hans/wow-reference.yaml?raw'
import ToolCallGroup from './tool-call-group.vue'
import ToolCallWowReferenceWidget from './tool-call-wow-reference-widget.vue'

import { useToolCardsStore } from '../../../../stores/tool-cards'
import { MCP_CALL_TOOL_NAME } from '../../../../tools/mcp'
import { normalizeToolResultText } from './tool-call-display'
import { builtinToolCallWidgets } from './tool-call-widgets'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.setItem('settings/tool-cards/enabled', 'true')
  localStorage.setItem('settings/consciousness/active-provider', '""')
  localStorage.setItem('settings/consciousness/active-model', '""')
})
afterEach(() => {
  vi.unstubAllEnvs()
  disposePinia(pinia)
  localStorage.removeItem('settings/tool-cards/enabled')
  localStorage.removeItem('settings/consciousness/active-provider')
  localStorage.removeItem('settings/consciousness/active-model')
})

function messages(locale = 'en') {
  return createI18n({ legacy: false, locale, messages: { 'en': { ...en, 'wow-reference': parse(enReference) }, 'zh-Hans': { 'wow-reference': parse(zhReference) } } })
}

function report(overrides: Partial<WowReferenceAnswer> = {}): WowReferenceAnswer {
  return { status: 'success', mode: 'detail', tool: 'fetch', game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', notices: [], entries: [], ...overrides }
}

function entry(overrides: Partial<WowReferenceEntry> = {}): WowReferenceEntry {
  return { id: 'item:12359', kind: 'item', title: '瑟银锭', url: 'https://wuxianwow.com/item/12359', fields: [], sections: [], temporary: false, incomplete: false, ...overrides }
}

function mount(value: WowReferenceAnswer, locale = 'en') {
  const screen = render(ToolCallWowReferenceWidget, { props: { report: value }, global: { plugins: [pinia, messages(locale)] } })
  onTestFinished(() => screen.unmount())
  return screen
}

describe('structured Warcraft references', () => {
  it('labels a cache hit without replacing the original source receipt', async () => {
    const cache = { status: 'hit' as const, sourceReceivedAt: '2026-11-01T00:00:00Z', storedAt: '2026-11-01T00:00:00Z', servedAt: '2026-11-01T01:00:00Z', expiresAt: '2026-11-02T00:00:00Z' }
    const screen = mount(report({ entries: [entry()], receivedAt: cache.sourceReceivedAt, cache }))
    await expect.element(screen.getByText('From cache', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Original source query', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(cache.sourceReceivedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText(cache.servedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Reading the cache does not update', { exact: false })).toBeVisible()
  })

  it('opens the desktop material planner with the exact recipe identity', async () => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/')
    await router.isReady()
    const screen = render(ToolCallWowReferenceWidget, {
      props: { report: report({ entries: [entry({ id: 'recipe:8796', kind: 'recipe', title: '熔炼瑟银', url: 'https://wuxianwow.com/recipe/8796' })] }) },
      global: { plugins: [pinia, messages(), router] },
    })
    onTestFinished(() => screen.unmount())
    await screen.getByRole('link', { name: 'Plan materials', exact: true }).click()
    expect(router.currentRoute.value.path).toBe('/settings/wow-professions')
    expect(router.currentRoute.value.query.recipe).toBe('recipe:8796')
  })

  it('shows the actual source, record identity, fields, and supplied build', async () => {
    const screen = mount(report({ entries: [entry({ fields: [{ key: 'item-level', value: '50' }, { key: 'min-level', value: '0' }] })] }))
    await expect.element(screen.getByText('WoW Forever · China', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('1.60.1.70707', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('item:12359', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('0', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).toHaveAttribute('href', 'https://wuxianwow.com/item/12359')
    await expect.element(screen.getByRole('link', { name: '无限图鉴 wuxianwow.com' })).toHaveAttribute('href', 'https://wuxianwow.com/')
  })

  it('keeps query time, source updates, snapshot build time, and auction collection time distinct', async () => {
    const screen = mount(report({ build: undefined, buildCreatedAt: '2026-10-30T22:25:37+11:00', updatedAt: '2026-10-30', receivedAt: '2026-11-01T03:00:00+08:00', collectedAt: '北京时间 2026-10-26 16:49', realm: 'Example realm · Alliance', notices: ['auction'], entries: [entry()] }))
    await expect.element(screen.getByText('Not provided by this response', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-10-30T22:25:37+11:00', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-10-30', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-11-01T03:00:00+08:00', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('北京时间 2026-10-26 16:49', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Prices are collected listings, not live sales.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('1.60.1.70707', { exact: true })).not.toBeInTheDocument()
  })

  it('marks temporary details and reveals bounded sections on explicit expansion', async () => {
    const screen = mount(report({ notices: ['temporary'], entries: [entry({ id: 'quest:11', kind: 'quest', title: '悬赏河爪豺狼人', url: 'https://wuxianwow.com/quest/11', temporary: true, fields: [{ key: 'faction', value: '联盟', temporary: true }], sections: [{ key: 'givers', temporary: true, lines: ['First NPC', 'Second NPC', 'Third NPC', 'Fourth NPC'] }] })] }))
    await expect.element(screen.getByText('Some fields use third-party temporary data.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('First NPC', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Fourth NPC', { exact: true })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Toggle details for 悬赏河爪豺狼人' })
    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect.element(screen.getByText('Fourth NPC', { exact: true })).toBeVisible()
    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByText('Fourth NPC', { exact: true })).not.toBeInTheDocument()
  })

  it('distinguishes search summaries and partial results from complete record details', async () => {
    const screen = mount(report({ mode: 'search', total: 6, hasMore: true, query: '瑟银', entries: [entry()], notices: ['truncated'] }))
    await expect.element(screen.getByRole('heading', { name: 'Search results', exact: true })).toBeVisible()
    await expect.element(screen.getByText('Showing 1 entries of 6.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('Search results are summaries.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('The card shows a bounded selection', { exact: false })).toBeVisible()
  })

  it.each<WowReferenceStatus>(['loading', 'empty', 'error', 'invalid'])('renders a clear %s state while retaining attribution', async (status) => {
    const screen = mount(report({ status, build: undefined }))
    const region = screen.getByRole('region', { name: 'Warcraft reference' })
    await expect.element(region).toHaveAttribute('aria-busy', status === 'loading' ? 'true' : 'false')
    await expect.element(screen.getByRole(status === 'error' || status === 'invalid' ? 'alert' : 'status')).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '无限图鉴 wuxianwow.com' })).toBeVisible()
  })

  it('renders names as plain text and refuses unsafe source links', async () => {
    const screen = mount(report({ sourceUrl: 'javascript:alert(1)', entries: [entry({ title: '<img src=x onerror=alert(1)>', url: 'https://wuxianwow.com.evil.test/item/12359' })] }))
    await expect.element(screen.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
    expect(screen.container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.container.querySelectorAll('a')).toHaveLength(0)
  })

  it('keeps Chinese source and temporary warnings inside a narrow dark card', async () => {
    const previousBackground = document.body.style.backgroundColor
    const previousColor = document.body.style.color
    const previousDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.add('dark')
    document.body.style.backgroundColor = '#171717'
    document.body.style.color = '#f5f5f5'
    await page.viewport(375, 600)
    onTestFinished(async () => {
      document.documentElement.classList.toggle('dark', previousDark)
      document.body.style.backgroundColor = previousBackground
      document.body.style.color = previousColor
      await page.viewport(900, 720)
    })
    const screen = mount(report({ entries: [entry({ title: '悬赏河爪豺狼人', kind: 'quest', id: 'quest:11', url: 'https://wuxianwow.com/quest/11', temporary: true, fields: [{ key: 'level', value: '10' }, { key: 'min-level', value: '6' }], sections: [{ key: 'givers', temporary: true, lines: ['瑞尼尔副队长 · 林边空地 24.2, 74.5 · QuestieDB（临时）'] }] })], notices: ['temporary'] }), 'zh-Hans')
    await expect.element(screen.getByText('部分字段来自第三方临时资料', { exact: false })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '无限图鉴 wuxianwow.com' })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    await screen.getByTestId('wow-reference-card').screenshot({ path: 'wow-reference-quest-zh-dark.png' })
  })
})

describe('mCP proxy widget isolation', () => {
  function mountGroup(name: string, value: unknown, pending = false) {
    const args = JSON.stringify({ name, arguments: JSON.stringify({ query: '瑟银锭' }) })
    const items: ToolCallGroupItem[] = [{ sliceIndex: 0, key: 'reference#0', toolCall: { toolCallId: 'reference', toolCallType: 'function', toolName: MCP_CALL_TOOL_NAME, args } }]
    const result = ref<ChatSlicesToolCallResult | undefined>(pending ? undefined : { type: 'tool-call-result', id: 'reference', result: normalizeToolResultText(value) })
    const screen = render(ToolCallGroup, { props: { items, widgets: builtinToolCallWidgets, resultOf: () => result.value, streaming: true, messageId: 'reference-test' }, global: { plugins: [pinia, messages()] } })
    onTestFinished(() => screen.unmount())
    return { screen, result, call: { callId: 'reference-test/reference#0', key: name, toolName: MCP_CALL_TOOL_NAME, args, data: value, locale: 'en' } }
  }

  it('keeps unrelated MCP calls eligible for the existing generic card flow', async () => {
    const { screen, call } = mountGroup('other-database::search', { content: [{ type: 'text', text: '{"results":[{"name":"Other result"}]}' }] })
    const cards = useToolCardsStore(pinia)
    await expect.poll(() => cards.viewOf(call).status).toBe('failed')
    expect(builtinToolCallWidgets[MCP_CALL_TOOL_NAME]?.matches?.(call.args)).toBe(false)
    await expect.element(screen.getByText('Other result', { exact: true })).not.toBeInTheDocument()
  })

  it('uses the deterministic reference card without requesting a model-generated card', async () => {
    const { screen, call } = mountGroup('wuxianwow::search', { content: [{ type: 'text', text: '{"outcome":"ok","results":[{"id":"item:12359","title":"瑟银锭","url":"https://wuxianwow.com/item/12359","kind":"item","snippet":""}],"total":1}' }] })
    const cards = useToolCardsStore(pinia)
    expect(cards.viewOf(call).status).toBe('none')
    expect(builtinToolCallWidgets[MCP_CALL_TOOL_NAME]?.autoOpen).toBe(true)
    expect(builtinToolCallWidgets[MCP_CALL_TOOL_NAME]?.matches?.(call.args)).toBe(true)
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).toBeVisible()
    await screen.getByRole('button', { name: 'Raw data', exact: true }).click()
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Widget', exact: true }).click()
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).toBeVisible()
  })

  it('keeps a reference answer collapsed after the owner closes it and its result is observed again', async () => {
    const value = { content: [{ type: 'text', text: '{"outcome":"ok","results":[{"id":"item:12359","title":"瑟银锭","url":"https://wuxianwow.com/item/12359","kind":"item"}],"total":1}' }] }
    const { screen, result } = mountGroup('wuxianwow::search', value)
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).toBeVisible()
    await screen.getByRole('button', { name: 'Warcraft references', exact: true }).first().click()
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).not.toBeInTheDocument()
    result.value = { type: 'tool-call-result', id: 'reference', result: normalizeToolResultText(structuredClone(value)) }
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).not.toBeInTheDocument()
  })

  it('keeps a pending call folded and opens its reference when the result arrives', async () => {
    const { screen, result } = mountGroup('wuxianwow::search', undefined, true)
    await expect.element(screen.getByRole('button', { name: 'Looking up Warcraft references', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByTestId('wow-reference-card')).not.toBeInTheDocument()
    result.value = { type: 'tool-call-result', id: 'reference', result: normalizeToolResultText({ content: [{ type: 'text', text: '{"outcome":"ok","results":[{"id":"item:12359","title":"瑟银锭","url":"https://wuxianwow.com/item/12359","kind":"item"}],"total":1}' }] }) }
    await expect.element(screen.getByRole('link', { name: '瑟银锭' })).toBeVisible()
  })
})

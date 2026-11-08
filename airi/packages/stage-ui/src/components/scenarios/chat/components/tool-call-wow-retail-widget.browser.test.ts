import type { ChatSlicesToolCallResult } from '../../../../types/chat'
import type { ToolCallGroupItem } from './tool-call-group'

import en from '@proj-airi/i18n/locales/en'

import { readWowRetailAnswer, WOW_RETAIL_QUERY_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import enRetail from '../../../../../../i18n/src/locales/en/wow-retail.yaml?raw'
import zhRetail from '../../../../../../i18n/src/locales/zh-Hans/wow-retail.yaml?raw'
import map from '../../../../../../stage-shared/src/wow-knowledge/fixtures/retail-database-map.json'
import stats from '../../../../../../stage-shared/src/wow-knowledge/fixtures/retail-database-stats.json'
import ToolCallGroup from './tool-call-group.vue'
import ToolCallWowRetailWidget from './tool-call-wow-retail-widget.vue'

import { useToolCardsStore } from '../../../../stores/tool-cards'
import { MCP_CALL_TOOL_NAME } from '../../../../tools/mcp'
import { normalizeToolResultText } from './tool-call-display'
import { builtinToolCallWidgets } from './tool-call-widgets'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

let pinia: ReturnType<typeof createPinia>
const mapArgs = JSON.stringify({ request: '{"operation":"fetch","id":"map:0"}' })
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.stubEnv('RUNTIME_ENVIRONMENT', 'web')
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
  return createI18n({ legacy: false, locale, messages: { 'en': { ...en, 'wow-retail': parse(enRetail) }, 'zh-Hans': { 'wow-retail': parse(zhRetail) } } })
}

function mount(value: unknown = map, args = mapArgs, locale = 'en') {
  const report = readWowRetailAnswer(value, args)
  const screen = render(ToolCallWowRetailWidget, { props: { report }, global: { plugins: [pinia, messages(locale)] } })
  onTestFinished(() => screen.unmount())
  return screen
}

describe('local Retail source cards', () => {
  it('distinguishes cached delivery from the original SQL query and export time', async () => {
    const storedAt = Date.parse(map.receivedAt) + 1
    const cache = { status: 'hit', sourceReceivedAt: map.receivedAt, storedAt: new Date(storedAt).toISOString(), servedAt: new Date(storedAt + 1000).toISOString(), expiresAt: new Date(storedAt + 86400000).toISOString() }
    const screen = mount({ ...map, cache })
    await expect.element(screen.getByText('From cache', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Original source query', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(map.receivedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText(cache.servedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText(map.source.exportedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText('This record query was not repeated.', { exact: false })).toBeVisible()
  })

  it('shows the actual map zero and keeps export time separate from query receipt', async () => {
    const screen = mount()
    await expect.element(screen.getByText('WoW Retail · local data', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('正式服本地 DB2', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('12.1.5.70575', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('2026-10-30T15:32:33.5754384+00:00', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(map.receivedAt, { exact: true })).toBeVisible()
    await expect.element(screen.getByText('map:0', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('东部王国', { exact: true }).first()).toBeVisible()
    expect(document.querySelector('a')).toBeNull()
  })

  it('keeps the native database source distinct from the Forever MCP widget', () => {
    expect(builtinToolCallWidgets[WOW_RETAIL_QUERY_TOOL_NAME]?.autoOpen).toBe(true)
    expect(builtinToolCallWidgets[MCP_CALL_TOOL_NAME]?.matches?.('{"operation":"fetch","id":"map:0"}')).toBe(false)
    expect(builtinToolCallWidgets[MCP_CALL_TOOL_NAME]?.matches?.('{"name":"wuxianwow::fetch","arguments":"{\\"id\\":\\"item:12359\\"}"}')).toBe(true)
  })

  it('renders literal unknown fields, empty strings, and hostile-looking text without HTML execution', async () => {
    const text = '<img src="https://example.invalid/track" onerror="alert(1)">'
    const changed = { ...map, entries: [{ ...map.entries[0]!, fields: [{ key: 'Field_Unknown', value: text }, { key: 'Empty', value: '' }, { key: 'Zero', value: '0' }] }] }
    const screen = mount(changed)
    await expect.element(screen.getByText(text, { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Empty text', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('0', { exact: true })).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows bounded statistics with the encrypted and client-only limitations', async () => {
    const screen = mount(stats, JSON.stringify({ request: '{"operation":"stats"}' }))
    await expect.element(screen.getByRole('heading', { name: 'Local database overview', exact: true })).toBeVisible()
    await expect.element(screen.getByText(String(stats.stats.counts.item), { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Some source tables contain encrypted sections.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('These records come from client DB2 files.', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('The result has missing, encrypted, or truncated data.', { exact: false })).toBeVisible()
  })

  it('expands only recorded fields and retains a safe local desktop link for zero IDs', async () => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/')
    await router.isReady()
    const changed = { ...map, entries: [{ ...map.entries[0]!, fields: Array.from({ length: 10 }, (_, index) => ({ key: `Field_${index}`, value: `Value ${index}` })), links: [{ kind: 'map', id: 'map:0', title: '东部王国' }] }] }
    const screen = render(ToolCallWowRetailWidget, { props: { report: readWowRetailAnswer(changed, mapArgs) }, global: { plugins: [pinia, messages(), router] } })
    onTestFinished(() => screen.unmount())
    await expect.element(screen.getByText('Value 9', { exact: true })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Toggle raw fields for 东部王国' })
    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect.element(screen.getByText('Value 9', { exact: true })).toBeVisible()
    await screen.getByRole('link', { name: 'Open local record for 东部王国', exact: true }).click()
    expect(router.currentRoute.value.path).toBe('/settings/wow-retail-database')
    expect(router.currentRoute.value.query.id).toBe('map:0')
    expect(document.querySelector('a[href^="http"]')).toBeNull()
  })

  it.each(['loading', 'empty', 'not-found', 'error', 'invalid'])('shows a separate %s state', async (state) => {
    const failed = { operation: 'fetch', outcome: 'error', source: null, entries: [], offset: 0, limit: 0, hasMore: false, notices: [], errorCode: 'database-unconfigured', receivedAt: map.receivedAt }
    let value: unknown = map
    let args = mapArgs
    if (state === 'loading') {
      value = undefined
    }
    else if (state === 'empty') {
      value = { ...map, operation: 'search', outcome: 'empty', entries: [], limit: 20 }
      args = JSON.stringify({ request: '{"operation":"search","kind":"map","query":"unknown"}' })
    }
    else if (state === 'not-found') {
      value = { ...map, outcome: 'not_found', entries: [] }
    }
    else if (state === 'error') {
      value = failed
    }
    else if (state === 'invalid') {
      value = { ...map, source: { ...map.source, game: 'forever' } }
    }
    // Passing undefined explicitly exercises the pending-result reader instead of the helper's default fixture.
    const screen = render(ToolCallWowRetailWidget, { props: { report: readWowRetailAnswer(value, args) }, global: { plugins: [pinia, messages()] } })
    onTestFinished(() => screen.unmount())
    const expected: Record<string, string> = {
      'loading': 'Waiting for the local query response.',
      'empty': 'No matching records in this snapshot. Try another name or a known ID.',
      'not-found': 'This ID is absent from the decoded snapshot. Its absence does not establish that the game has no such record.',
      'error': 'Choose a local Retail database in the database settings first.',
      'invalid': 'This result cannot be verified as a matching local Retail query. The original result remains available in the raw view.',
    }
    await expect.element(screen.getByText(expected[state]!, { exact: true })).toBeVisible()
  })

  it('opens its recorded native tool result without generating another card and preserves raw view', async () => {
    const toolCall = { toolCallId: 'retail', toolCallType: 'function' as const, toolName: WOW_RETAIL_QUERY_TOOL_NAME, args: mapArgs }
    const items: ToolCallGroupItem[] = [{ sliceIndex: 0, key: 'retail#0', toolCall }]
    const result = ref<ChatSlicesToolCallResult>({ type: 'tool-call-result', id: 'retail', result: normalizeToolResultText(map) })
    const screen = render(ToolCallGroup, { props: { items, widgets: builtinToolCallWidgets, resultOf: () => result.value, messageId: 'retail-test' }, global: { plugins: [pinia, messages()] } })
    onTestFinished(() => screen.unmount())
    await expect.element(screen.getByTestId('wow-retail-card')).toBeVisible()
    const call = { callId: 'retail-test/retail#0', key: WOW_RETAIL_QUERY_TOOL_NAME, toolName: WOW_RETAIL_QUERY_TOOL_NAME, args: mapArgs, data: map, locale: 'en' }
    expect(useToolCardsStore(pinia).viewOf(call).status).toBe('none')
    await screen.getByRole('button', { name: 'Raw data', exact: true }).click()
    await expect.element(screen.getByTestId('wow-retail-card')).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Widget', exact: true }).click()
    await expect.element(screen.getByTestId('wow-retail-card')).toBeVisible()
  })

  it('keeps the Chinese dark card readable at a narrow viewport', async () => {
    document.documentElement.classList.add('dark')
    const previousColor = document.body.style.color
    const previousBackground = document.body.style.backgroundColor
    document.body.style.color = '#f5f5f5'
    document.body.style.backgroundColor = '#171717'
    await page.viewport(375, 1100)
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      document.body.style.color = previousColor
      document.body.style.backgroundColor = previousBackground
      await page.viewport(900, 720)
    })
    const screen = mount(map, mapArgs, 'zh-Hans')
    await expect.element(screen.getByText('魔兽世界正式服 · 本地数据', { exact: true })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await screen.getByTestId('wow-retail-card').screenshot({ path: 'wow-retail-map-zh-dark.png' })
  })
})

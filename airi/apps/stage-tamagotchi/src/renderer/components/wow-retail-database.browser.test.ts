import type { RetailDatabaseEntry, RetailDatabaseKind, RetailDatabaseQuery, RetailDatabaseResult, RetailDatabaseSource } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowRetailDatabaseStatus } from '../../shared/wow-retail-database'

import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-retail-query.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-retail-query.yaml?raw'
import WowRetailDatabasePage from '../pages/settings/wow-retail-database.vue'
import WowRetailDatabase from './wow-retail-database.vue'

import { useWowRetailDatabaseStore } from '../stores/wow-retail-database'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ status: vi.fn(), pick: vi.fn(), clear: vi.fn(), query: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const method = event.receiveEvent?.id?.replace('eventa:invoke:wow-retail-database:', '').replace(/-receive$/, '')
    if (!method || !(method in ipc))
      throw new Error(`Unexpected IPC ${event.receiveEvent?.id}`)
    return ipc[method as keyof typeof ipc]
  },
}))

let selected: WowRetailDatabaseStatus
const tables: RetailDatabaseSource['tables'] = [
  { name: 'Item', status: 'decoded', rows: 2, encrypted: false },
  { name: 'ItemSparse', status: 'decoded_with_encrypted_sections', rows: 2, encrypted: true },
  { name: 'Map', status: 'decoded', rows: 1, encrypted: false },
  { name: 'UiMap', status: 'decoded', rows: 1, encrypted: false },
  { name: 'AreaTable', status: 'decoded', rows: 1, encrypted: false },
  { name: 'SpellName', status: 'decoded', rows: 1, encrypted: false },
  { name: 'Spell', status: 'decoded', rows: 1, encrypted: false },
  { name: 'DungeonEncounter', status: 'decoded', rows: 1, encrypted: false },
]
const dependencies: Record<RetailDatabaseKind, string[]> = { item: ['Item', 'ItemSparse'], map: ['Map'], uimap: ['UiMap'], area: ['AreaTable'], spell: ['SpellName', 'Spell'], encounter: ['DungeonEncounter', 'Map'] }

function source(kind?: RetailDatabaseKind): RetailDatabaseSource {
  return {
    name: '正式服本地 DB2',
    game: 'retail',
    product: 'wow',
    localOnly: true,
    build: selected.revision > 1 ? '12.1.5.70576' : '12.1.5.70575',
    locale: 'zhCN',
    exportedAt: '2026-10-30T00:00:00Z',
    hotfixesApplied: false,
    datasetId: (selected.revision > 1 ? 'b' : 'a').repeat(64),
    tables: kind ? tables.filter(table => dependencies[kind].includes(table.name)) : tables,
  }
}

function entry(kind: RetailDatabaseKind, id = kind === 'map' ? 0 : 1): RetailDatabaseEntry {
  return {
    id: `${kind}:${id}`,
    kind,
    numericId: id,
    title: `Test ${kind} ${id}`,
    fields: [{ key: 'ID', value: String(id) }, { key: 'Description_lang', value: '<img src=x onerror="invalid"> literal client text' }],
    links: kind === 'map' ? [{ kind: 'uimap', id: 'uimap:1415', title: 'Related world map' }] : [],
    notices: kind === 'spell' ? ['raw-spell-template'] : [],
  }
}

function result(query: RetailDatabaseQuery): RetailDatabaseResult {
  const base = { receivedAt: '2026-11-01T05:10:00.000Z', notices: ['client-db2-only', 'hotfixes-not-applied'] as const, hasMore: false, offset: 0, entries: [] }
  if (query.operation === 'stats')
    return { ...base, notices: [...base.notices, 'encrypted-sections'], operation: 'stats', outcome: 'ok', source: source(), limit: 0, stats: { counts: { item: 2, map: 1, uimap: 1, area: 1, spell: 1, encounter: 1 } } }
  if (query.operation === 'search') {
    const empty = query.query === 'no-match'
    return { ...base, notices: [...base.notices], operation: 'search', outcome: empty ? 'empty' : 'ok', source: source(query.kind), entries: empty ? [] : [entry(query.kind, (query.offset ?? 0) === 0 ? query.kind === 'map' ? 0 : 1 : 2)], limit: query.limit ?? 20, offset: query.offset ?? 0, hasMore: !empty && (query.offset ?? 0) === 0 }
  }
  const [kind, numeric] = query.id.split(':')
  const record = entry(kind as RetailDatabaseKind, Number(numeric))
  return { ...base, notices: [...base.notices], operation: 'fetch', outcome: numeric === '999999' ? 'not_found' : 'ok', source: source(record.kind), entries: numeric === '999999' ? [] : [record], limit: 1 }
}

beforeEach(() => {
  vi.resetAllMocks()
  selected = { configured: true, path: 'D:/WoW export/retail.sqlite3', revision: 1 }
  ipc.status.mockImplementation(async () => ({ ...selected }))
  ipc.pick.mockImplementation(async () => {
    selected = { configured: true, path: 'D:/Another export/retail.sqlite3', revision: selected.revision + 1 }
    return { ...selected }
  })
  ipc.clear.mockImplementation(async () => {
    selected = { configured: false, revision: selected.revision + 1 }
    return { ...selected }
  })
  ipc.query.mockImplementation(async (query: RetailDatabaseQuery) => result(query))
})

function translations(locale = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-retail-query': parse(en) }, 'zh-Hans': { 'wow-retail-query': parse(zh) } } })
}

async function mount(locale = 'en') {
  const pinia = createPinia()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#ffffff', color: dark ? '#e5e5e5' : '#171717' } }, h(WowRetailDatabase)) })
  const screen = render(host, { global: { plugins: [pinia, translations(locale)] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  await expect.poll(() => ipc.status.mock.calls.length).toBe(1)
  return { screen, database: useWowRetailDatabaseStore(pinia) }
}

async function search(query = 'test') {
  await page.getByRole('textbox', { name: 'Name or ID', exact: true }).fill(query)
  await page.getByRole('button', { name: 'Search database', exact: true }).click()
}

describe('retail read-only query page', () => {
  it('loads only saved configuration on entry and never queries while a search is a draft', async () => {
    await mount()
    await expect.element(page.getByTestId('retail-database-path')).toHaveTextContent('D:/WoW export/retail.sqlite3')
    await page.getByRole('textbox', { name: 'Name or ID', exact: true }).fill('draft')
    expect(ipc.query).not.toHaveBeenCalled()
    expect(ipc.pick).not.toHaveBeenCalled()
  })

  it('requires an explicit file selection before querying and shows verified snapshot coverage', async () => {
    selected = { configured: false, revision: 0 }
    await mount()
    await expect.element(page.getByRole('button', { name: 'Check data and version', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Choose database', exact: true }).click()
    await expect.element(page.getByRole('region', { name: 'Database coverage', exact: true })).toBeVisible()
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('12.1.5.70575')
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('Not applied to this snapshot')
    await expect.element(page.getByText('Some source tables have encrypted sections. Decoded rows do not represent every record.', { exact: true })).toBeVisible()
    expect(ipc.query).toHaveBeenCalledWith({ operation: 'stats' })
    expect(ipc.query.mock.calls.every(([query]) => !('path' in query))).toBe(true)
  })

  it('submits searches explicitly, paginates, and escapes client text in record details', async () => {
    await mount()
    await search()
    await expect.element(page.getByText('Test item 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open details · Test item 1', exact: true }).click()
    await expect.element(page.getByTestId('retail-database-detail')).toHaveTextContent('<img src=x onerror="invalid"> literal client text')
    expect(page.getByTestId('retail-database-detail').element().querySelector('img')).toBeNull()
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect.element(page.getByText('Test item 2', { exact: true })).toBeVisible()
    expect(ipc.query.mock.calls.filter(([query]) => query.operation === 'search')[1][0].offset).toBeGreaterThan(0)
    await expect.element(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
  })

  it('keeps underlying map zero valid and follows typed related records without external links', async () => {
    const { database } = await mount()
    database.kind = 'map'
    await search('0')
    await page.getByRole('button', { name: 'Open details · Test map 0', exact: true }).click()
    await expect.element(page.getByTestId('retail-database-detail')).toHaveTextContent('map:0')
    await page.getByRole('button', { name: 'Open related record: Related world map', exact: true }).click()
    await expect.element(page.getByTestId('retail-database-detail')).toHaveTextContent('uimap:1415')
    expect(ipc.query).toHaveBeenCalledWith({ operation: 'fetch', id: 'uimap:1415' })
    expect(page.getByTestId('retail-database-detail').element().querySelector('a')).toBeNull()
  })

  it('clears the prior database results before showing the replacement snapshot', async () => {
    await mount()
    await search()
    await page.getByRole('button', { name: 'Open details · Test item 1', exact: true }).click()
    await page.getByRole('button', { name: 'Choose another database', exact: true }).click()
    await expect.element(page.getByTestId('retail-database-path')).toHaveTextContent('D:/Another export/retail.sqlite3')
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('12.1.5.70576')
    await expect.element(page.getByTestId('retail-database-detail')).not.toBeInTheDocument()
    await expect.element(page.getByRole('region', { name: 'Last search results', exact: true })).not.toHaveTextContent('Test item 1')
    await page.getByRole('button', { name: 'Unselect database', exact: true }).click()
    await expect.element(page.getByTestId('retail-database-source')).not.toBeInTheDocument()
    await expect.element(page.getByText('No local database is selected.', { exact: true })).toBeVisible()
  })

  it('does not start a query when the file picker is cancelled', async () => {
    await mount()
    ipc.pick.mockResolvedValueOnce({ ...selected })
    await page.getByRole('button', { name: 'Choose another database', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Choose another database', exact: true })).toBeEnabled()
    expect(ipc.query).not.toHaveBeenCalled()
    await expect.element(page.getByTestId('retail-database-path')).toHaveTextContent('D:/WoW export/retail.sqlite3')
  })

  it('re-enables a remounted page and discards a query from the previous view', async () => {
    const pinia = createPinia()
    const options = { global: { plugins: [pinia, translations()] } }
    let screen = render(WowRetailDatabase, options)
    const database = useWowRetailDatabaseStore(pinia)
    const pending = Promise.withResolvers<RetailDatabaseResult>()
    const oldResult = result({ operation: 'search', kind: 'item', query: 'old', limit: 20, offset: 0 })
    onTestFinished(() => {
      pending.resolve(oldResult)
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.poll(() => ipc.status.mock.calls.length).toBe(1)
    ipc.query.mockReturnValueOnce(pending.promise)
    database.query = 'old'
    const oldQuery = database.search()
    await expect.poll(() => ipc.query.mock.calls.length).toBe(1)
    screen.unmount()
    screen = render(WowRetailDatabase, options)
    await expect.element(page.getByRole('button', { name: 'Search database', exact: true })).toBeEnabled()
    await search('no-match')
    await expect.element(page.getByText('No matching records were found.', { exact: true })).toBeVisible()
    pending.resolve(oldResult)
    await oldQuery
    expect(database.results?.outcome).toBe('empty')
    expect(database.busy).toBe(false)
  })

  it('ignores a late query receipt after the database selection changes', async () => {
    const { database } = await mount()
    const pending = Promise.withResolvers<RetailDatabaseResult>()
    const oldResult = result({ operation: 'search', kind: 'item', query: 'old', limit: 20, offset: 0 })
    onTestFinished(() => pending.resolve(oldResult))
    ipc.query.mockReturnValueOnce(pending.promise)
    database.query = 'old'
    const oldQuery = database.search()
    await expect.poll(() => ipc.query.mock.calls.length).toBe(1)
    await database.pickDatabase()
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('12.1.5.70576')
    pending.resolve(oldResult)
    await oldQuery
    expect(database.results).toBeNull()
    expect(database.stats?.source?.build).toBe('12.1.5.70576')
    expect(database.busy).toBe(false)
  })

  it('ignores a stale status refresh after a database-changed receipt and a later file selection', async () => {
    const { database } = await mount()
    const oldStatus = { ...selected }
    const pendingStatus = Promise.withResolvers<WowRetailDatabaseStatus>()
    onTestFinished(() => pendingStatus.resolve(oldStatus))
    ipc.status.mockResolvedValueOnce(oldStatus).mockReturnValueOnce(pendingStatus.promise)
    ipc.query.mockResolvedValueOnce({ operation: 'search', outcome: 'error', source: null, entries: [], notices: [], offset: 0, limit: 0, hasMore: false, errorCode: 'database-changed', receivedAt: '2026-11-01T05:10:00.000Z' } satisfies RetailDatabaseResult)
    database.query = 'old'
    const oldQuery = database.search()
    await expect.poll(() => ipc.status.mock.calls.length).toBe(3)
    await database.pickDatabase()
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('12.1.5.70576')
    pendingStatus.resolve(oldStatus)
    await oldQuery
    expect(database.status?.revision).toBe(2)
    expect(database.stats?.source?.build).toBe('12.1.5.70576')
    expect(database.errorCode).toBeNull()
    expect(database.busy).toBe(false)
  })

  it('requires a new search when the query draft changes before pagination', async () => {
    await mount()
    await search()
    const queries = ipc.query.mock.calls.length
    await page.getByRole('textbox', { name: 'Name or ID', exact: true }).fill('different draft')
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Check the record type, query, or record ID.')
    expect(ipc.query).toHaveBeenCalledTimes(queries)
    await expect.element(page.getByText('Test item 1', { exact: true })).toBeVisible()
  })

  it('shows empty, not-found, and service-error outcomes without inventing records', async () => {
    const { database } = await mount()
    await search('no-match')
    await expect.element(page.getByText('No matching records were found.', { exact: true })).toBeVisible()
    await database.fetch('item:999999')
    await expect.element(page.getByText('The selected record is not present in this database.', { exact: true })).toBeVisible()
    ipc.query.mockResolvedValueOnce({ operation: 'search', outcome: 'error', source: null, entries: [], notices: [], offset: 0, limit: 0, hasMore: false, errorCode: 'database-missing', receivedAt: '2026-11-01T05:10:00.000Z' } satisfies RetailDatabaseResult)
    await search()
    await expect.element(page.getByRole('alert')).toHaveTextContent('selected database file is missing')
    await expect.element(page.getByRole('button', { name: 'Search database', exact: true })).toBeEnabled()
  })

  it('keeps a cached source query timestamp separate from the current cache read', async () => {
    const { database } = await mount()
    const receivedAt = '2026-11-01T05:10:00.000Z'
    const cache = { status: 'hit' as const, sourceReceivedAt: receivedAt, storedAt: '2026-11-01T05:10:01.000Z', servedAt: '2026-11-01T05:15:00.000Z', expiresAt: '2026-11-02T05:10:01.000Z' }
    ipc.query.mockImplementationOnce(async (query: RetailDatabaseQuery) => ({ ...result(query), cache }))
    await search()
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('Read from query cache')
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('Original source query time')
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('Cache expires:')
    expect(database.results?.receivedAt).toBe(receivedAt)
    expect(database.results?.cache?.servedAt).toBe(cache.servedAt)
  })

  it('validates router record links against the shared schema and deduplicates repeated requests', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-retail-database', component: WowRetailDatabasePage }] })
    await router.push('/settings/wow-retail-database?id=map:00')
    await router.isReady()
    const screen = render(RouterView, { global: { plugins: [pinia, router, translations()] } })
    onTestFinished(() => {
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.poll(() => ipc.status.mock.calls.length).toBe(1)
    expect(ipc.query).not.toHaveBeenCalled()
    await router.push('/settings/wow-retail-database?id=map:0')
    await expect.element(page.getByTestId('retail-database-detail')).toHaveTextContent('map:0')
    await router.push('/settings/wow-retail-database?id=map:0&from=chat')
    expect(ipc.query.mock.calls.filter(([query]) => query.operation === 'fetch')).toHaveLength(1)
    await router.push('/settings/wow-retail-database?id=../../private.sqlite3')
    expect(ipc.query.mock.calls.filter(([query]) => query.operation === 'fetch')).toHaveLength(1)
    const database = useWowRetailDatabaseStore(pinia)
    const pending = Promise.withResolvers<RetailDatabaseResult>()
    const delayed = result({ operation: 'search', kind: 'item', query: 'long', limit: 20, offset: 0 })
    onTestFinished(() => pending.resolve(delayed))
    ipc.query.mockReturnValueOnce(pending.promise)
    database.query = 'long'
    const searching = database.search()
    await expect.poll(() => ipc.query.mock.calls.filter(([query]) => query.operation === 'search').length).toBe(1)
    await router.push('/settings/wow-retail-database?id=uimap:1415')
    expect(ipc.query.mock.calls.filter(([query]) => query.operation === 'fetch')).toHaveLength(1)
    pending.resolve(delayed)
    await searching
    await expect.element(page.getByTestId('retail-database-detail')).toHaveTextContent('uimap:1415')
    expect(ipc.query.mock.calls.filter(([query]) => query.operation === 'fetch')).toHaveLength(2)
  })

  it('renders complete source provenance in a narrow Chinese dark layout', async () => {
    await page.viewport(375, 700)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(900, 720)
    })
    const { database } = await mount('zh-Hans')
    await database.inspect()
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('正式服本地 DB2')
    await expect.element(page.getByTestId('retail-database-source')).toHaveTextContent('此快照未叠加热修')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await page.getByTestId('retail-database-source').screenshot({ path: 'wow-retail-source-zh-dark.png' })
  })
})

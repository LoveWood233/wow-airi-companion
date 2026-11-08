import type { RetailDatabaseSource } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowDataCacheStatus } from '../../shared/wow-data-cache'
import type { WowDataUpdateSnapshot, WowDataUpdateStatus } from '../../shared/wow-data-update'

import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-data.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-data.yaml?raw'
import WowDataSettings from './wow-data-settings.vue'

import { useWowDataUpdateStore } from '../stores/wow-data-update'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ get: vi.fn(), chooseGame: vi.fn(), chooseTools: vi.fn(), check: vi.fn(), start: vi.fn(), cancel: vi.fn(), activate: vi.fn(), cacheStatus: vi.fn(), cacheClear: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event.receiveEvent?.id
    switch (id) {
      case 'eventa:invoke:wow-data-update:get-receive': return ipc.get
      case 'eventa:invoke:wow-data-update:choose-game-receive': return ipc.chooseGame
      case 'eventa:invoke:wow-data-update:choose-tools-receive': return ipc.chooseTools
      case 'eventa:invoke:wow-data-update:check-receive': return ipc.check
      case 'eventa:invoke:wow-data-update:start-receive': return ipc.start
      case 'eventa:invoke:wow-data-update:cancel-receive': return ipc.cancel
      case 'eventa:invoke:wow-data-update:activate-receive': return ipc.activate
      case 'eventa:invoke:wow-data-cache:status-receive': return ipc.cacheStatus
      case 'eventa:invoke:wow-data-cache:clear-receive': return ipc.cacheClear
      default: throw new Error(`Unexpected IPC ${id}`)
    }
  },
}))

let server: WowDataUpdateStatus
let cache: WowDataCacheStatus

function source(build = '12.1.5.70575'): RetailDatabaseSource {
  return { name: '正式服本地 DB2', game: 'retail', product: 'wow', localOnly: true, build, locale: 'zhCN', exportedAt: '2026-11-01T05:00:00.000Z', hotfixesApplied: false, datasetId: (build.endsWith('70575') ? 'a' : 'b').repeat(64), tables: [{ name: 'Map', status: 'decoded_with_encrypted_sections', rows: 100, encrypted: true }] }
}

function snapshot(id = 'snapshot-old', build = '12.1.5.70575', selected = true): WowDataUpdateSnapshot {
  return { id, build, createdAt: '2026-11-01T05:00:00.000Z', source: source(build), selected }
}

beforeEach(() => {
  vi.resetAllMocks()
  const old = snapshot()
  server = {
    config: { gameRoot: 'D:/World of Warcraft', toolsRoot: 'D:/Game Tools/CASCExplorer' },
    discovery: { build: '12.1.5.70576', previousBuild: '12.1.5.70575', changed: true, checkedAt: '2026-11-01T05:10:00.000Z' },
    checks: ['python', 'dotnet', 'exporter', 'definitions', 'offline-guard'].map(id => ({ id: id as WowDataUpdateStatus['checks'][number]['id'], status: 'ready' })),
    snapshots: [old],
    activeSnapshotId: old.id,
    activeSelection: 'managed',
    activeSource: old.source,
    job: null,
  }
  cache = { entries: 4, bytes: 524_288, maxBytes: 268_435_456, staticTtlMs: 86_400_000, priceTtlMs: 900_000 }
  ipc.get.mockImplementation(async () => structuredClone(server))
  ipc.chooseGame.mockImplementation(async () => {
    server.config.gameRoot = 'E:/Retail Game'
    return structuredClone(server)
  })
  ipc.chooseTools.mockImplementation(async () => {
    server.config.toolsRoot = 'E:/CASC Tools'
    return structuredClone(server)
  })
  ipc.check.mockImplementation(async () => {
    server.checks = server.checks.map(check => ({ ...check, status: 'ready' }))
    return structuredClone(server)
  })
  ipc.start.mockImplementation(async () => {
    server.job = { id: 'job-new', phase: 'checking', build: '12.1.5.70576', startedAt: '2026-11-01T05:15:00.000Z', updatedAt: '2026-11-01T05:15:00.000Z', completed: 0, total: null }
    return structuredClone(server)
  })
  ipc.cancel.mockImplementation(async () => {
    if (server.job)
      server.job = { ...server.job, phase: 'cancelled', errorCode: 'cancelled' }
    return structuredClone(server)
  })
  ipc.activate.mockImplementation(async ({ id }: { id: string }) => {
    const selected = server.snapshots.find(snapshot => snapshot.id === id)
    if (!selected)
      return { ...structuredClone(server), errorCode: 'snapshot-invalid' }
    server.snapshots = server.snapshots.map(snapshot => ({ ...snapshot, selected: snapshot.id === id }))
    server.activeSnapshotId = id
    server.activeSelection = 'managed'
    server.activeSource = selected.source
    return structuredClone(server)
  })
  ipc.cacheStatus.mockImplementation(async () => structuredClone(cache))
  ipc.cacheClear.mockImplementation(async () => {
    cache = { ...cache, entries: 0, bytes: 0 }
    return structuredClone(cache)
  })
})

async function mount(locale = 'en') {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-data', component: WowDataSettings }, { path: '/settings/wow-retail-database', component: defineComponent({ setup: () => () => h('p', 'Retail query') }) }] })
  await router.push('/settings/wow-data')
  await router.isReady()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#ffffff', color: dark ? '#e5e5e5' : '#171717' } }, h(RouterView)) })
  const screen = render(host, { global: { plugins: [pinia, router, createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-data': parse(en) }, 'zh-Hans': { 'wow-data': parse(zh) } } })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  await expect.poll(() => ipc.get.mock.calls.length).toBe(1)
  await expect.poll(() => ipc.cacheStatus.mock.calls.length).toBe(1)
  return { screen, router, data: useWowDataUpdateStore(pinia) }
}

describe('explicit data export and disposable cache controls', () => {
  it('reads local status on entry, shows a changed build, and never starts an export or switches snapshots', async () => {
    await mount()
    await expect.element(page.getByText('The installed client build changed. The selected database remains unchanged until you switch it.', { exact: true })).toBeVisible()
    expect(ipc.start).not.toHaveBeenCalled()
    expect(ipc.activate).not.toHaveBeenCalled()
    expect(ipc.check).not.toHaveBeenCalled()
    expect(ipc.chooseGame).not.toHaveBeenCalled()
    await expect.element(page.getByTestId('data-snapshot-snapshot-old')).toHaveTextContent('Currently selected')
  })

  it('uses native folder choices and requires offline checks without starting an export', async () => {
    server.checks[1].status = 'missing'
    await mount()
    await expect.element(page.getByRole('button', { name: 'Export and verify snapshot', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Choose game folder', exact: true }).click()
    await expect.element(page.getByText('E:/Retail Game', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Choose CASC tools folder', exact: true }).click()
    await expect.element(page.getByText('E:/CASC Tools', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Check local requirements', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Export and verify snapshot', exact: true })).toBeEnabled()
    expect(ipc.chooseGame).toHaveBeenCalledWith()
    expect(ipc.chooseTools).toHaveBeenCalledWith()
    expect(ipc.start).not.toHaveBeenCalled()
  })

  it('polls real reported stages and requires explicit selection after snapshot verification passes', async () => {
    const { data } = await mount()
    await page.getByRole('button', { name: 'Export and verify snapshot', exact: true }).click()
    await expect.element(page.getByRole('status').filter({ hasText: 'Checking local requirements' })).toBeVisible()
    if (!server.job)
      throw new Error('Missing job fixture')
    server.job = { ...server.job, phase: 'exporting', completed: 2, total: 8 }
    await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '8')
    const latest = snapshot('snapshot-new', '12.1.5.70576', false)
    server.snapshots = [latest, ...server.snapshots]
    server.job = { ...server.job, phase: 'ready', completed: 0, total: null, snapshotId: latest.id }
    await expect.element(page.getByText('The new snapshot passed verification. Select it below to change the database used for queries.', { exact: true })).toBeVisible()
    expect(data.status?.activeSnapshotId).toBe('snapshot-old')
    expect(ipc.activate).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Select this snapshot · 12.1.5.70576', exact: true }).click()
    await expect.element(page.getByText('The selected snapshot is now the query source.', { exact: true })).toBeVisible()
    expect(ipc.activate).toHaveBeenCalledWith({ id: 'snapshot-new' })
    expect(data.status?.activeSnapshotId).toBe('snapshot-new')
    expect(data.status?.snapshots).toHaveLength(2)
  })

  it('keeps numerical progress unknown when no total is reported and waits for cancellation confirmation', async () => {
    server.job = { id: 'job-new', phase: 'exporting', build: '12.1.5.70576', startedAt: '2026-11-01T05:15:00.000Z', updatedAt: '2026-11-01T05:15:00.000Z', completed: 3, total: null }
    const { data } = await mount()
    await expect.element(page.getByText('3 tables reported. Total count is unknown.', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
    const pending = Promise.withResolvers<WowDataUpdateStatus>()
    ipc.cancel.mockReturnValueOnce(pending.promise)
    onTestFinished(() => pending.resolve(structuredClone(server)))
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click()
    await expect.element(page.getByText('Waiting for the export process to stop…', { exact: true })).toBeVisible()
    expect(data.status?.job?.phase).toBe('exporting')
    server.job = { ...server.job!, phase: 'cancelled' }
    pending.resolve(structuredClone(server))
    await expect.element(page.getByText('Snapshot export cancelled · 12.1.5.70576', { exact: true })).toBeVisible()
    expect(data.status?.activeSnapshotId).toBe('snapshot-old')
  })

  it('retains the active database on failure and can roll back to an older verified snapshot', async () => {
    const current = snapshot('snapshot-new', '12.1.5.70576', true)
    server.snapshots = [current, snapshot('snapshot-old', '12.1.5.70575', false)]
    server.activeSnapshotId = current.id
    server.activeSource = current.source
    server.job = { id: 'failed-job', phase: 'failed', build: '12.1.5.70577', startedAt: '2026-11-01T05:15:00.000Z', updatedAt: '2026-11-01T05:16:00.000Z', completed: 0, total: null, errorCode: 'verification-failed' }
    const { data } = await mount()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Snapshot verification failed')
    expect(data.status?.activeSnapshotId).toBe('snapshot-new')
    await page.getByRole('button', { name: 'Roll back to this snapshot · 12.1.5.70575', exact: true }).click()
    await expect.poll(() => data.status?.activeSnapshotId).toBe('snapshot-old')
    expect(ipc.activate).toHaveBeenCalledWith({ id: 'snapshot-old' })
    expect(ipc.start).not.toHaveBeenCalled()
  })

  it('clears cache only after a click and displays its capacity and independent freshness policies', async () => {
    const { data } = await mount()
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('256 MiB')
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('24 hours')
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('15 minutes')
    expect(ipc.cacheClear).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Clear query cache', exact: true }).click()
    await expect.element(page.getByText('Query cache cleared.', { exact: true })).toBeVisible()
    expect(data.cache?.entries).toBe(0)
    expect(data.cache?.bytes).toBe(0)
    expect(data.status?.activeSnapshotId).toBe('snapshot-old')
    expect(ipc.activate).not.toHaveBeenCalled()
    expect(ipc.start).not.toHaveBeenCalled()
    expect(ipc.cancel).not.toHaveBeenCalled()
  })

  it('keeps cache measurement failures explicit instead of presenting zero as a known measurement', async () => {
    ipc.cacheStatus.mockResolvedValueOnce({ ...cache, entries: 0, bytes: 0, errorCode: 'cache-unavailable' })
    const { data } = await mount()
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('Unknown')
    ipc.cacheClear.mockRejectedValueOnce(new Error('Access denied'))
    await page.getByRole('button', { name: 'Clear query cache', exact: true }).click()
    await expect.element(page.getByText('Query cache cleared.', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('Query cache could not be accessed')
    await page.getByRole('button', { name: 'Refresh cache status', exact: true }).click()
    await expect.poll(() => data.cacheErrorCode).toBeNull()
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('0.5 MiB')
  })

  it('ignores an older status read that finishes after a cancellation action', async () => {
    server.job = { id: 'job-new', phase: 'exporting', build: '12.1.5.70576', startedAt: '2026-11-01T05:15:00.000Z', updatedAt: '2026-11-01T05:15:00.000Z', completed: 3, total: 8 }
    const { data } = await mount()
    const old = structuredClone(server)
    const pending = Promise.withResolvers<WowDataUpdateStatus>()
    onTestFinished(() => pending.resolve(old))
    ipc.get.mockReturnValueOnce(pending.promise)
    const reading = data.refresh()
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click()
    await expect.poll(() => data.status?.job?.phase).toBe('cancelled')
    pending.resolve(old)
    await reading
    expect(data.status?.job?.phase).toBe('cancelled')
    expect(data.running).toBe(false)
  })

  it('stops status polling when the settings view is left', async () => {
    server.job = { id: 'job-new', phase: 'exporting', build: '12.1.5.70576', startedAt: '2026-11-01T05:15:00.000Z', updatedAt: '2026-11-01T05:15:00.000Z', completed: 3, total: null }
    const { router } = await mount()
    await router.push('/settings/wow-retail-database')
    const reads = ipc.get.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(ipc.get).toHaveBeenCalledTimes(reads)
  })

  it('does not assign a managed build to an external database selection', async () => {
    server.activeSelection = 'external'
    server.activeSnapshotId = null
    server.activeSource = null
    server.snapshots = []
    await mount()
    await expect.element(page.getByText('The selected database is outside managed snapshots. Its version is not verified by this page.', { exact: true })).toBeVisible()
    expect(ipc.start).not.toHaveBeenCalled()
    expect(ipc.activate).not.toHaveBeenCalled()
  })

  it('keeps the Chinese cache controls readable in a narrow dark window', async () => {
    await page.viewport(375, 900)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(900, 720)
    })
    await mount('zh-Hans')
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('24 小时')
    await expect.element(page.getByTestId('wow-data-cache')).toHaveTextContent('15 分钟')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await page.getByTestId('wow-data-cache').screenshot({ path: 'wow-data-cache-zh-dark.png' })
  })
})

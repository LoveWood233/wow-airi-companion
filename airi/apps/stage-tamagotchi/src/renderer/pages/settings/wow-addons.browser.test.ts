import type { AddonFile, AddonGame, AddonMetadata, AddonResult, AddonSearchRequest, AddonSearchResult, AddonSettings, AddonSettingsUpdate, AddonSummary, InstalledAddon } from '../../../shared/wow-addons'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-addons.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-addons.yaml?raw'
import WowAddonsSettings from './wow-addons-settings.vue'
import WowAddons from './wow-addons.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const invokes = vi.hoisted(() => ({
  settings: vi.fn<() => Promise<AddonResult<AddonSettings>>>(),
  save: vi.fn<(update: AddonSettingsUpdate) => Promise<AddonResult<AddonSettings>>>(),
  directory: vi.fn<(request: { game: AddonGame }) => Promise<AddonResult<string | null>>>(),
  metadata: vi.fn<() => Promise<AddonResult<AddonMetadata>>>(),
  search: vi.fn<(request: AddonSearchRequest) => Promise<AddonResult<AddonSearchResult>>>(),
  files: vi.fn<(request: { game: AddonGame, modId: number, gameVersionTypeId: number }) => Promise<AddonResult<AddonFile[]>>>(),
  installed: vi.fn<(request: { game: AddonGame }) => Promise<AddonResult<InstalledAddon[]>>>(),
  install: vi.fn<(request: { game: AddonGame, modId: number, fileId: number }) => Promise<AddonResult<InstalledAddon>>>(),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:wow-addons:settings:get-receive': return invokes.settings
      case 'eventa:invoke:wow-addons:settings:save-receive': return invokes.save
      case 'eventa:invoke:wow-addons:directory-receive': return invokes.directory
      case 'eventa:invoke:wow-addons:metadata-receive': return invokes.metadata
      case 'eventa:invoke:wow-addons:search-receive': return invokes.search
      case 'eventa:invoke:wow-addons:files-receive': return invokes.files
      case 'eventa:invoke:wow-addons:installed-receive': return invokes.installed
      case 'eventa:invoke:wow-addons:install-receive': return invokes.install
      default: throw new Error(`Unexpected Eventa invoke: ${event.receiveEvent?.id}`)
    }
  },
}))

function settings(hasApiKey = true): AddonSettings {
  return {
    hasApiKey,
    clients: {
      retail: { directory: 'C:\\WoW\\_retail_', gameVersionTypeId: 1 },
      classic: { directory: 'C:\\WoW\\_classic_', gameVersionTypeId: 2 },
      forever: { directory: 'C:\\WoW\\_forever_', gameVersionTypeId: 3 },
    },
  }
}

const metadata: AddonMetadata = {
  versionTypes: [
    { id: 1, name: 'Retail API version', slug: 'retail', group: 'retail' },
    { id: 2, name: 'Classic API version', slug: 'classic', group: 'classic' },
    { id: 3, name: 'Forever API version', slug: 'forever', group: 'forever' },
  ],
  categories: [
    { id: 10, name: 'Combat API', slug: 'combat', parentCategoryId: null },
    { id: 11, name: 'Custom API child', slug: 'custom-child', parentCategoryId: 10 },
    { id: 12, name: 'Classes API', slug: 'classes', parentCategoryId: null },
  ],
}

function addon(id = 100, name = 'Compatible addon'): AddonSummary {
  return { id, name, summary: 'An addon description', authors: ['Test author'], logoUrl: null, websiteUrl: 'https://www.curseforge.com/wow/addons/test', downloadCount: 12345, dateModified: '2026-10-20T10:00:00Z', categories: [10], allowDistribution: true }
}

function file(id = 200, type = 1): AddonFile {
  return { id, modId: 100, displayName: `Addon file ${id}`, fileName: `addon-${id}.zip`, fileLength: 500, releaseType: 1, fileDate: '2026-10-20T10:00:00Z', gameVersions: ['12.0.0'], gameVersionTypeIds: [type], downloadUrl: 'https://edge.forgecdn.net/files/addon.zip', dependencies: [{ modId: 777, required: true }, { modId: 778, required: false }] }
}

function ownedAddon(): InstalledAddon {
  return { game: 'retail', clientDirectory: settings().clients.retail.directory, modId: 100, fileId: 200, name: 'Compatible addon', version: 'Addon file 200', gameVersionTypeId: 1, folders: ['TestAddon'], installedAt: '2026-10-27T00:00:00Z' }
}

async function renderPage(locale = 'en', path = '/settings/wow-addons', width = 800) {
  await page.viewport(width, 1100)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/wow-addons', component: WowAddons },
      { path: '/settings/wow-addons-settings', component: WowAddonsSettings },
    ],
  })
  await router.push(path)
  await router.isReady()
  const container = document.createElement('div')
  container.className = 'bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
  container.style.width = `${width}px`
  container.style.maxWidth = '100vw'
  container.style.backgroundColor = document.documentElement.classList.contains('dark') ? '#0a0a0a' : '#ffffff'
  container.style.color = document.documentElement.classList.contains('dark') ? '#f5f5f5' : '#171717'
  document.body.appendChild(container)
  const screen = render(defineComponent({ setup: () => () => h(RouterView) }), {
    container,
    global: { plugins: [router, createI18n({ legacy: false, locale, messages: { 'en': { 'wow-addons': parse(enMessages) }, 'zh-Hans': { 'wow-addons': parse(zhMessages) } } })] },
  })
  onTestFinished(() => {
    screen.unmount()
    container.remove()
    document.documentElement.classList.remove('dark')
  })
  return { screen, router, container }
}

describe('woW addon center', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invokes.settings.mockResolvedValue({ ok: true, data: settings() })
    invokes.metadata.mockResolvedValue({ ok: true, data: metadata })
    invokes.search.mockResolvedValue({ ok: true, data: { addons: [addon()], index: 0, pageSize: 20, totalCount: 40 } })
    invokes.files.mockResolvedValue({ ok: true, data: [file(), file(201), file(999, 2)] })
    invokes.installed.mockResolvedValue({ ok: true, data: [] })
    invokes.directory.mockResolvedValue({ ok: true, data: null })
    invokes.save.mockResolvedValue({ ok: true, data: settings() })
    invokes.install.mockResolvedValue({ ok: true, data: ownedAddon() })
  })

  it('shows setup without catalog requests, saves a password once, and loads API version choices', async () => {
    let persisted = settings(false)
    for (const client of Object.values(persisted.clients)) {
      client.directory = ''
      client.gameVersionTypeId = null
    }
    invokes.settings.mockImplementation(async () => ({ ok: true, data: structuredClone(persisted) }))
    invokes.save.mockImplementation(async (update) => {
      persisted = { hasApiKey: Boolean(update.apiKey) || persisted.hasApiKey, clients: structuredClone(update.clients) }
      return { ok: true, data: structuredClone(persisted) }
    })
    const { screen, router } = await renderPage()
    await expect.element(screen.getByRole('heading', { name: 'Connect CurseForge to browse addons' })).toBeVisible()
    expect(invokes.search).not.toHaveBeenCalled()
    expect(invokes.metadata).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Set up API key' }).click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-addons-settings')
    await expect.element(screen.getByRole('link', { name: 'Read API key application guide' })).toHaveAttribute('href', 'https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key')
    const password = screen.getByLabelText('New CurseForge API key')
    await expect.element(password).toHaveAttribute('type', 'password')
    await password.fill('private-test-key')
    await screen.getByRole('button', { name: 'Save settings', exact: true }).click()
    await expect.element(screen.getByText('Settings saved.', { exact: true })).toBeVisible()
    expect(invokes.save.mock.calls[0][0].apiKey).toBe('private-test-key')
    await expect.element(password).toHaveValue('')
    await expect.element(screen.getByText('API key configured', { exact: true })).toBeVisible()
    await screen.getByRole('combobox').nth(0).click()
    await expect.element(page.getByRole('option', { name: 'Retail API version' })).toBeVisible()
    await expect.element(page.getByRole('option', { name: 'Classic API version' })).not.toBeInTheDocument()
    await page.getByRole('option', { name: 'Retail API version' }).click()
    await screen.getByRole('textbox', { name: /^WoW client directory/ }).nth(0).fill('D:\\Games\\_retail_')
    await expect.element(screen.getByText('D:\\Games\\_retail_\\Interface\\AddOns', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: 'Save settings', exact: true }).click()
    await expect.poll(() => invokes.save.mock.calls.length).toBe(2)
    expect(invokes.save.mock.calls[1][0].apiKey).toBeUndefined()
    expect(invokes.save.mock.calls[1][0].clients.retail).toEqual({ directory: 'D:\\Games\\_retail_', gameVersionTypeId: 1 })
    await screen.getByRole('button', { name: 'Back to addon center' }).click()
    await expect.element(screen.getByRole('button', { name: 'Compatible addon', exact: true })).toBeVisible()
  })

  it('preserves manual paths when native browsing is cancelled and discards edits on Cancel', async () => {
    const { screen, router } = await renderPage('en', '/settings/wow-addons-settings')
    const path = screen.getByRole('textbox', { name: /^WoW client directory/ }).nth(0)
    await path.fill('D:\\Manual path')
    await screen.getByRole('button', { name: 'Browse Retail directory' }).click()
    await expect.poll(() => invokes.directory.mock.calls.length).toBe(1)
    await expect.element(path).toHaveValue('D:\\Manual path')
    invokes.directory.mockResolvedValueOnce({ ok: true, data: 'E:\\Picked client' })
    await screen.getByRole('button', { name: 'Browse Classic directory' }).click()
    await expect.element(screen.getByRole('textbox', { name: /^WoW client directory/ }).nth(1)).toHaveValue('E:\\Picked client')
    await screen.getByLabelText('New CurseForge API key').fill('discarded-key')
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-addons')
    expect(invokes.save).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Addon settings', exact: true }).click()
    await expect.element(screen.getByLabelText('New CurseForge API key')).toHaveValue('')
    await expect.element(screen.getByRole('textbox', { name: /^WoW client directory/ }).nth(0)).toHaveValue('C:\\WoW\\_retail_')
  })

  it('searches by edition, category, sort and pages of twenty, then installs a selected compatible file', async () => {
    const { screen } = await renderPage()
    await expect.element(screen.getByRole('button', { name: 'Compatible addon', exact: true })).toBeVisible()
    expect(invokes.search.mock.calls[0][0]).toEqual({ game: 'retail', gameVersionTypeId: 1, search: '', index: 0, sort: 'popular' })
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].index).toBe(20)
    await screen.getByRole('button', { name: 'Classic', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].game).toBe('classic')
    expect(invokes.search.mock.lastCall?.[0].gameVersionTypeId).toBe(2)
    expect(invokes.search.mock.lastCall?.[0].index).toBe(0)
    await screen.getByRole('button', { name: 'Forever', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].gameVersionTypeId).toBe(3)
    await screen.getByRole('button', { name: 'Retail', exact: true }).click()
    await screen.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: '— Custom API child', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].categoryId).toBe(11)
    await screen.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Recently updated', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].sort).toBe('updated')
    await screen.getByRole('textbox', { name: 'Search addons' }).fill('healer')
    await screen.getByRole('button', { name: 'Search', exact: true }).click()
    await expect.poll(() => invokes.search.mock.lastCall?.[0].search).toBe('healer')
    await screen.getByRole('button', { name: 'Compatible addon', exact: true }).click()
    await expect.element(screen.getByText('#777', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('#778', { exact: true })).not.toBeInTheDocument()
    expect(invokes.files).toHaveBeenCalledWith({ game: 'retail', modId: 100, gameVersionTypeId: 1 })
    await screen.getByRole('combobox').nth(2).click()
    await expect.element(page.getByRole('option', { name: /Addon file 999/ })).not.toBeInTheDocument()
    await page.getByRole('option', { name: /Addon file 201/ }).click()
    invokes.install.mockResolvedValueOnce({ ok: false, error: 'curseforge-download-integrity' })
    await screen.getByRole('button', { name: 'Install', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('The addon download failed its integrity check. Try again.')
    expect(invokes.install).toHaveBeenCalledWith({ game: 'retail', modId: 100, fileId: 201 })
    expect(invokes.installed.mock.calls.length).toBeGreaterThan(3)
    invokes.installed.mockResolvedValue({ ok: true, data: [{ ...ownedAddon(), fileId: 201 }] })
    await screen.getByRole('button', { name: 'Install', exact: true }).click()
    await expect.element(screen.getByText('Installation complete. Restart WoW or reload the interface to load the addon.')).toBeVisible()
    await screen.getByRole('button', { name: 'Installed', exact: true }).click()
    await expect.element(screen.getByRole('heading', { name: 'Compatible addon', exact: true, level: 3 })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Choose update', exact: true })).toBeVisible()
    await screen.getByRole('button', { name: 'Choose update', exact: true }).click()
    await expect.element(screen.getByRole('button', { name: 'Update', exact: true })).toBeEnabled()
    await screen.getByRole('button', { name: 'Update', exact: true }).click()
    await expect.poll(() => invokes.install.mock.lastCall?.[0].fileId).toBe(200)
  })

  it('ignores late catalog and file results after changing editions', async () => {
    let resolveSearch: (result: AddonResult<AddonSearchResult>) => void = () => {}
    invokes.search.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSearch = resolve
    }))
    const { screen } = await renderPage()
    await expect.poll(() => invokes.search.mock.calls.length).toBe(1)
    await screen.getByRole('button', { name: 'Classic', exact: true }).click()
    await expect.element(screen.getByRole('button', { name: 'Compatible addon', exact: true })).toBeVisible()
    resolveSearch({ ok: true, data: { addons: [addon(999, 'Stale retail result')], index: 0, pageSize: 20, totalCount: 1 } })
    await nextTick()
    await expect.element(screen.getByRole('button', { name: 'Stale retail result', exact: true })).not.toBeInTheDocument()
    let resolveFiles: (result: AddonResult<AddonFile[]>) => void = () => {}
    invokes.files.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFiles = resolve
    }))
    await screen.getByRole('button', { name: 'Compatible addon', exact: true }).click()
    await expect.poll(() => invokes.files.mock.calls.length).toBe(1)
    await screen.getByRole('button', { name: 'Forever', exact: true }).click()
    resolveFiles({ ok: true, data: [file(200, 2)] })
    await nextTick()
    await expect.element(screen.getByRole('button', { name: 'Install', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText('Loading compatible files…')).not.toBeInTheDocument()
    expect(invokes.search.mock.lastCall?.[0].gameVersionTypeId).toBe(3)
  })

  it('blocks mismatched saved version groups without issuing a search', async () => {
    const invalid = settings()
    invalid.clients.retail.gameVersionTypeId = 2
    invokes.settings.mockResolvedValue({ ok: true, data: invalid })
    const { screen } = await renderPage()
    await expect.element(screen.getByRole('button', { name: 'Configure client', exact: true })).toBeVisible()
    expect(invokes.search).not.toHaveBeenCalled()
  })

  it.each([false, true])('renders Chinese labels at 600px with dark mode %s', async (dark) => {
    document.documentElement.classList.toggle('dark', dark)
    const { screen, container } = await renderPage('zh-Hans', '/settings/wow-addons', 600)
    await expect.element(screen.getByRole('button', { name: '无限服', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Compatible addon', exact: true })).toBeVisible()
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth)
    await screen.getByRole('button', { name: 'Compatible addon', exact: true }).click()
    await expect.element(screen.getByRole('button', { name: '安装', exact: true })).toBeVisible()
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth)
    await page.screenshot({ path: `__screenshots__/wow-addons-600-${dark ? 'dark' : 'light'}.png` })
  })
})

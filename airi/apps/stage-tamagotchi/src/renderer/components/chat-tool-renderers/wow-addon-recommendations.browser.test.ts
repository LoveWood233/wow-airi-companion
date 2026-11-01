import type { AddonRecommendationReport } from '../../../shared/wow-addon-recommendations'
import type { AddonResult, InstalledAddon } from '../../../shared/wow-addons'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import en from '../../../../../../packages/i18n/src/locales/en/wow-addons.yaml?raw'
import zh from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-addons.yaml?raw'
import WowAddonRecommendations from './wow-addon-recommendations.vue'

import { wowAddonRecommendationsWidget } from './wow-addon-recommendations'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const boundary = vi.hoisted(() => ({ install: vi.fn<() => Promise<AddonResult<InstalledAddon>>>() }))
vi.mock('@proj-airi/electron-vueuse', () => ({ useElectronEventaInvoke: () => boundary.install }))

function report(): AddonRecommendationReport {
  return { kind: 'wow-addon-recommendations', version: 1, id: 'recommendation-1', game: 'retail', query: '背包', versionTypeId: 517, versionName: 'WoW Retail', createdAt: Date.now(), expiresAt: Date.now() + 600000, addons: [1, 2, 3, 4, 5].map(id => ({ id, name: `Bag addon ${id}`, summary: 'Inventory organization', websiteUrl: `https://www.curseforge.com/wow/addons/bag-${id}`, downloadCount: 1000000 - id, relevance: 100, fileId: id * 100, fileVersion: '12.1.5', gameVersions: ['12.1.5'], installable: true, unavailableReason: null })) }
}

const receipt: InstalledAddon = { game: 'retail', clientDirectory: 'C:\\WoW\\_retail_', modId: 1, fileId: 100, name: 'Bag addon 1', version: '12.1.5', gameVersionTypeId: 517, folders: ['BagAddon'], installedAt: '2026-11-01T10:00:00Z' }

async function mount(value = report(), locale = 'en') {
  const screen = await render(WowAddonRecommendations, { props: { report: value }, global: { plugins: [createI18n({
    legacy: false,
    locale,
    messages: { 'en': { 'wow-addons': parse(en) }, 'zh-Hans': { 'wow-addons': parse(zh) } },
  })] } })
  onTestFinished(() => screen.unmount())
  return screen
}

beforeEach(() => {
  boundary.install.mockReset().mockResolvedValue({ ok: true, data: receipt })
})

describe('addon recommendation card', () => {
  it('shows five choices, sources, downloads and branch compatibility without starting an install', async () => {
    const screen = await mount()
    expect(screen.getByRole('article').elements()).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'CurseForge project' }).elements()).toHaveLength(5)
    await expect.element(screen.getByText('WoW Retail', { exact: false })).toBeVisible()
    await expect.element(screen.getByText('1M downloads', { exact: true }).first()).toBeVisible()
    expect(boundary.install).not.toHaveBeenCalled()
  })

  it('installs only the clicked selection, blocks repeated clicks, and confirms the successful receipt', async () => {
    const gate = Promise.withResolvers<AddonResult<InstalledAddon>>()
    boundary.install.mockReturnValue(gate.promise)
    const screen = await mount()
    const first = screen.getByRole('article', { name: 'Bag addon 1' })
    await first.getByRole('button', { name: 'Install', exact: true }).click()
    expect(boundary.install).toHaveBeenCalledExactlyOnceWith({ recommendationId: 'recommendation-1', modId: 1 })
    await expect.element(screen.getByRole('article', { name: 'Bag addon 2' }).getByRole('button')).toBeDisabled()
    gate.resolve({ ok: true, data: receipt })
    await expect.element(first.getByRole('button', { name: 'Installed', exact: true })).toBeDisabled()
    await expect.element(first.getByRole('status')).toHaveTextContent('Installation complete')
  })

  it('keeps author-blocked and expired recommendations visible but disables installation', async () => {
    const value = report()
    value.addons[0].installable = false
    value.addons[0].unavailableReason = 'curseforge-distribution-disabled'
    value.expiresAt = Date.now() - 1
    const screen = await mount(value)
    await expect.element(screen.getByText('The author does not allow this addon to install through third-party tools.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Install', exact: true }).elements().every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(boundary.install).not.toHaveBeenCalled()
  })

  it('shows install errors and does not claim success', async () => {
    boundary.install.mockResolvedValue({ ok: false, error: 'wow-addons-unmanaged-conflict' })
    const screen = await mount()
    await screen.getByRole('article', { name: 'Bag addon 1' }).getByRole('button').click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('unmanaged')
    expect(screen.getByRole('button', { name: 'Installed', exact: true }).elements()).toHaveLength(0)
  })

  it('does not attach an old installation receipt to a newer recommendation report', async () => {
    const gate = Promise.withResolvers<AddonResult<InstalledAddon>>()
    boundary.install.mockReturnValue(gate.promise)
    const screen = await mount()
    await screen.getByRole('article', { name: 'Bag addon 1' }).getByRole('button').click()
    await screen.rerender({ report: { ...report(), id: 'recommendation-2', game: 'forever', versionName: 'WoW Forever' } })
    gate.resolve({ ok: true, data: receipt })
    await nextTick()
    expect(screen.getByRole('button', { name: 'Installed', exact: true }).elements()).toHaveLength(0)
  })

  it.each([375, 600])('renders a Chinese recommendation card within a %i pixel viewport', async (width) => {
    await page.viewport(width, 1400)
    const screen = await mount(report(), 'zh-Hans')
    await expect.element(screen.getByRole('heading', { name: '为你推荐的魔兽插件' })).toBeVisible()
    await expect.element(screen.getByText('已筛选对应客户端分支，按相关度、总下载量排序，最多显示 5 项。')).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await screen.getByRole('region').screenshot({ path: `__screenshots__/wow-addon-recommendations-${width}.png` })
  })

  it('displays query failures as an alert and marks the tool call as failed', async () => {
    const failure = 'Check the API key in addon settings.'
    const reading = wowAddonRecommendationsWidget.read(JSON.stringify({ ok: false, userMessage: failure }), '{}')
    expect(reading?.failed).toBe(true)
    const screen = await render(WowAddonRecommendations, { props: { failure }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { 'wow-addons': parse(en) } } })] } })
    onTestFinished(() => screen.unmount())
    await expect.element(screen.getByRole('alert')).toHaveTextContent(failure)
    expect(boundary.install).not.toHaveBeenCalled()
  })

  it('renders a dark recommendation card without overflowing', async () => {
    await page.viewport(600, 1400)
    document.documentElement.classList.add('dark')
    onTestFinished(() => document.documentElement.classList.remove('dark'))
    const screen = await mount(report(), 'zh-Hans')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(600)
    expect(getComputedStyle(screen.getByRole('heading', { level: 3 }).element()).color).toBe('rgb(245, 245, 245)')
    await screen.getByRole('region').screenshot({ path: '__screenshots__/wow-addon-recommendations-dark.png' })
  })

  it('rejects imported reports with unsafe project links instead of displaying an actionable card', () => {
    const value = report()
    value.addons[0].websiteUrl = 'https://attacker.example/wow/addons/trap'
    expect(wowAddonRecommendationsWidget.read(JSON.stringify(value), '{}')).toBeUndefined()
  })
})

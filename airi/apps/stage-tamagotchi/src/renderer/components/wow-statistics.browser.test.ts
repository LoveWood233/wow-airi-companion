import type { RouteMeta } from 'vue-router'

import type { StatisticsConfigure, StatisticsState } from '../../shared/wow-statistics'

import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-statistics.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-statistics.yaml?raw'
import SettingsIndex from '../pages/settings/index.vue'
import Settings from '../pages/settings/wow-statistics.vue'
import settingsSource from '../pages/settings/wow-statistics.vue?raw'
import Disclosure from './wow-statistics-disclosure.vue'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ get: vi.fn(), configure: vi.fn(), acknowledge: vi.fn(), record: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:wow-statistics:get-receive': return ipc.get
      case 'eventa:invoke:wow-statistics:configure-receive': return ipc.configure
      case 'eventa:invoke:wow-statistics:acknowledge-receive': return ipc.acknowledge
      case 'eventa:invoke:wow-statistics:record-receive': return ipc.record
      default: throw new Error(`Unexpected statistics IPC: ${event.receiveEvent?.id}`)
    }
  },
}))

let native: StatisticsState
beforeEach(() => {
  vi.resetAllMocks()
  native = {
    enabled: false,
    disclosed: false,
    endpoint: '',
    intervalSeconds: 300,
    installationId: null,
    counters: { requests: 0, requestsWithUsage: 0, requestsWithoutUsage: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, inputReportedRequests: 0, outputReportedRequests: 0, totalReportedRequests: 0 },
    lastReportedAt: null,
    lastError: null,
    configured: false,
  }
  ipc.get.mockImplementation(async () => structuredClone(native))
  ipc.configure.mockImplementation(async (input: StatisticsConfigure) => {
    native = { ...native, ...input, configured: input.endpoint !== '' }
    return structuredClone(native)
  })
  ipc.acknowledge.mockImplementation(async ({ enabled }: { enabled: boolean }) => {
    native = { ...native, enabled, disclosed: true }
    return structuredClone(native)
  })
})

function mount(component: typeof Settings | typeof Disclosure, locale = 'en') {
  const pinia = createPinia()
  const screen = render(component, { global: { plugins: [pinia, createI18n({ legacy: false, locale, messages: { 'en': { 'wow-statistics': parse(en) }, 'zh-Hans': { 'wow-statistics': parse(zh) } } })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return screen
}

describe('statistics disclosure', () => {
  it('shows a default-on choice without acknowledging or recording until Continue', async () => {
    mount(Disclosure)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('switch')).toBeChecked()
    await expect.element(page.getByText('No server is configured. Nothing is sent.', { exact: true })).toBeVisible()
    expect(ipc.acknowledge).not.toHaveBeenCalled()
    expect(ipc.record).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    expect(ipc.acknowledge).toHaveBeenCalledExactlyOnceWith({ enabled: true })
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps collection off when the user turns off the default choice', async () => {
    mount(Disclosure)
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    expect(ipc.acknowledge).toHaveBeenCalledExactlyOnceWith({ enabled: false })
    expect(ipc.record).not.toHaveBeenCalled()
  })

  it('allows an explicit opt-out', async () => {
    mount(Disclosure)
    await page.getByRole('button', { name: 'Disable statistics', exact: true }).click()
    expect(ipc.acknowledge).toHaveBeenCalledExactlyOnceWith({ enabled: false })
  })

  it('defers without acknowledging when Later is clicked', async () => {
    mount(Disclosure)
    await page.getByRole('button', { name: 'Later', exact: true }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(ipc.acknowledge).not.toHaveBeenCalled()
    expect(ipc.record).not.toHaveBeenCalled()
  })

  it('defers on Escape without enabling collection', async () => {
    mount(Disclosure)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(ipc.acknowledge).not.toHaveBeenCalled()
  })
})

describe('statistics settings', () => {
  it('appears in the real settings menu and opens the statistics page', async () => {
    const block = /<route lang="yaml">([\s\S]+?)<\/route>/.exec(settingsSource)?.[1]
    if (!block)
      throw new Error('Missing statistics route metadata')
    const { meta }: { meta: RouteMeta } = parse(block)
    const pinia = createPinia()
    useSettings(pinia).disableTransitions = true
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/settings', component: SettingsIndex },
      { path: '/settings/wow-statistics', component: Settings, meta },
    ] })
    await router.push('/settings')
    const screen = render(defineComponent(() => () => h(RouterView)), { global: { plugins: [pinia, router, MotionPlugin, createI18n({ legacy: false, locale: 'en', messages: { en: { 'wow-statistics': parse(en) } } })] } })
    onTestFinished(() => {
      screen.unmount()
      disposePinia(pinia)
    })
    await page.getByRole('link', { name: /Installation and usage statistics/ }).click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-statistics')
    await expect.element(page.getByRole('button', { name: 'Confirm notice and save', exact: true })).toBeVisible()
    expect(ipc.get).toHaveBeenCalledExactlyOnceWith()
    expect(ipc.acknowledge).not.toHaveBeenCalled()
  })

  it('saves an empty endpoint before acknowledgement and shows that nothing is sent', async () => {
    mount(Settings)
    await page.getByRole('button', { name: 'Confirm notice and save', exact: true }).click()
    expect(ipc.configure).toHaveBeenCalledExactlyOnceWith({ enabled: false, endpoint: '' })
    expect(ipc.acknowledge).toHaveBeenCalledExactlyOnceWith({ enabled: true })
    expect(ipc.configure.mock.invocationCallOrder[0]).toBeLessThan(ipc.acknowledge.mock.invocationCallOrder[0])
    await expect.element(page.getByText('No server is configured. Nothing is sent.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Saved.', { exact: true })).toBeVisible()
    expect(ipc.record).not.toHaveBeenCalled()
  })

  it.each(['http://remote.example.com', 'https://user:pass@example.com', 'https://example.com?key=x'])('blocks an invalid server address: %s', async (endpoint) => {
    mount(Settings)
    await page.getByRole('textbox').fill(endpoint)
    await page.getByRole('button', { name: 'Confirm notice and save', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Enter HTTPS')
    expect(ipc.configure).not.toHaveBeenCalled()
    expect(ipc.acknowledge).not.toHaveBeenCalled()
  })

  it('can turn collection off after acknowledgement', async () => {
    native = { ...native, disclosed: true, enabled: true, endpoint: 'https://statistics.example.com', configured: true }
    mount(Settings)
    await expect.element(page.getByRole('switch')).toBeChecked()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect(ipc.configure).toHaveBeenCalledExactlyOnceWith({ enabled: false, endpoint: 'https://statistics.example.com' })
    expect(ipc.acknowledge).not.toHaveBeenCalled()
  })

  it('shows missing token usage as unknown and translates stable native errors', async () => {
    native = { ...native, disclosed: true, lastError: 'network-error', counters: { ...native.counters, requests: 2, requestsWithoutUsage: 2 } }
    mount(Settings)
    await expect.element(page.getByText('The server could not be reached. Reporting will retry later.', { exact: true })).toBeVisible()
    expect(page.getByText('Unknown', { exact: true }).elements()).toHaveLength(3)
    await expect.element(page.getByText('Records reporting input: 0, output: 0, total: 0.', { exact: true })).toBeVisible()
  })

  it('keeps the Chinese disclosure readable in a narrow dark viewport', async () => {
    await page.viewport(390, 900)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
    })
    mount(Disclosure, 'zh-Hans')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.getByRole('dialog').screenshot({ path: 'wow-statistics-disclosure-zh-dark.png' })
    expect(ipc.acknowledge).not.toHaveBeenCalled()
  })
})

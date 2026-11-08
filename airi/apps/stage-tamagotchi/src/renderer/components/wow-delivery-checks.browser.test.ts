import type { DeliveryReport } from '../../shared/wow-delivery'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowDeliveryChecks from './wow-delivery-checks.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ inspect: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    if (!event.receiveEvent?.id?.includes('wow-delivery:inspect'))
      throw new Error(`Unexpected IPC ${event.receiveEvent?.id}`)
    return ipc.inspect
  },
}))

function report(): DeliveryReport {
  const matched = { status: 'passed' as const, code: 'version-match', actual: '2.15.0', expected: '2.15.0' }
  return { checkedAt: 1_700_000_000_000, release: '2.21.0', app: { ...matched, actual: '0.12.0-beta.5', expected: '0.12.0-beta.5' }, resources: { status: 'passed', code: 'resources-ready', checked: 15, total: 15 }, bundledBridge: matched, addons: { retail: matched, forever: { ...matched, actual: '1.13.0', expected: '1.13.0' } }, python: { status: 'passed', code: 'python-ready', actual: '3.13.2', expected: '3.10+', executable: 'C:/Python/python.exe' }, runningBridges: { retail: matched, forever: { status: 'unavailable', code: 'bridge-not-running', expected: '2.15.0' } } }
}

beforeEach(() => {
  vi.resetAllMocks()
  ipc.inspect.mockResolvedValue(report())
})

async function mount(locale = 'en') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-delivery', component: { template: '<div />' } }, { path: '/settings/wow-guide', component: { template: '<div />' } }] })
  await router.push('/settings/wow-delivery')
  const screen = render(WowDeliveryChecks, { global: { plugins: [router, createI18n({ legacy: false, locale, messages: { 'en': { 'wow-companion': parse(en) }, 'zh-Hans': { 'wow-companion': parse(zh) } } })] } })
  onTestFinished(() => screen.unmount())
  return { screen, router }
}

describe('read-only delivery checks', () => {
  it('shows independently observed versions, integrity, and Python prerequisites', async () => {
    await mount()
    await expect.element(page.getByTestId('delivery-resources')).toHaveTextContent('Verified files 15/15')
    await expect.element(page.getByTestId('delivery-python')).toHaveTextContent('C:/Python/python.exe')
    await expect.element(page.getByTestId('delivery-forever-running')).toHaveTextContent('Not observed')
    await expect.element(page.getByTestId('delivery-forever-running')).not.toHaveTextContent('The observed version matches')
    expect(ipc.inspect).toHaveBeenCalledTimes(1)
    await page.getByRole('button', { name: 'Refresh checks' }).click()
    await expect.poll(() => ipc.inspect.mock.calls.length).toBe(2)
  })

  it('shows matching-component instructions and links to the existing addon installer', async () => {
    const value = report()
    value.runningBridges.retail = { status: 'failed', code: 'version-mismatch', actual: '2.14.0', expected: '2.15.0' }
    ipc.inspect.mockResolvedValue(value)
    const { router } = await mount()
    await expect.element(page.getByTestId('delivery-retail-running')).toHaveTextContent('Update the matching component before use.')
    await expect.element(page.getByRole('link', { name: 'Open the official Python downloads for Windows' })).toHaveAttribute('href', 'https://www.python.org/downloads/windows/')
    await page.getByRole('link', { name: 'Open addon checks and installation' }).click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-guide')
    expect(ipc.inspect).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate checks and recovers after a failed request without showing raw errors', async () => {
    const pending = Promise.withResolvers<DeliveryReport>()
    ipc.inspect.mockReturnValueOnce(pending.promise)
    await mount()
    await expect.element(page.getByRole('button', { name: 'Checking dependencies' })).toBeDisabled()
    pending.reject(new Error('private host details'))
    await expect.element(page.getByRole('alert')).toHaveTextContent('The checks could not finish. Try again after checking file access.')
    await page.getByRole('button', { name: 'Refresh checks' }).click()
    await expect.element(page.getByTestId('delivery-resources')).toBeVisible()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(ipc.inspect).toHaveBeenCalledTimes(2)
  })

  it('keeps Chinese missing-Python guidance readable in a narrow dark window', async () => {
    const previousDark = document.documentElement.classList.contains('dark')
    const background = document.body.style.backgroundColor
    const color = document.body.style.color
    document.documentElement.classList.add('dark')
    document.body.style.backgroundColor = '#0a0a0a'
    document.body.style.color = '#f5f5f5'
    await page.viewport(375, 900)
    onTestFinished(async () => {
      document.documentElement.classList.toggle('dark', previousDark)
      document.body.style.backgroundColor = background
      document.body.style.color = color
      await page.viewport(900, 720)
    })
    const value = report()
    value.python = { status: 'failed', code: 'python-missing', expected: '3.10+' }
    ipc.inspect.mockResolvedValue(value)
    await mount('zh-Hans')
    await expect.element(page.getByTestId('delivery-python')).toHaveTextContent('添加到 PATH 选项')
    await page.getByTestId('delivery-python').screenshot({ path: 'wow-delivery-python-zh-dark.png' })
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  })
})

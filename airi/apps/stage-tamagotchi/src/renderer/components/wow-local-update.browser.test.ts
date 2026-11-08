import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import WowLocalUpdate from './wow-local-update.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ status: vi.fn(), pick: vi.fn(), launch: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const method = event.receiveEvent?.id?.split(':').at(-1)?.replace(/-receive$/, '')
    if (!method || !(method in ipc))
      throw new Error(`Unexpected IPC ${method}`)
    return ipc[method as keyof typeof ipc]
  },
}))
function mount() {
  const screen = render(WowLocalUpdate, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { 'wow-companion': parse(en) } } })] } })
  onTestFinished(() => screen.unmount())
}
beforeEach(() => {
  vi.resetAllMocks()
  ipc.status.mockResolvedValue({ supported: true, last: null })
  ipc.pick.mockResolvedValue({ id: 'plan', directory: 'D:/New companion', releaseVersion: '2.22.0', appVersion: 'app-1', files: 3, bytes: 1000 })
})
describe('explicit local update confirmation', () => {
  it('only reads status until the user selects and confirms a verified update', async () => {
    mount()
    await expect.poll(() => ipc.status.mock.calls.length).toBe(1)
    expect(ipc.pick).not.toHaveBeenCalled()
    expect(ipc.launch).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Select update directory' }).click()
    await expect.element(page.getByRole('region', { name: 'Verified update' })).toBeVisible()
    expect(ipc.launch).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Back up and start update' }).click()
    await expect.poll(() => ipc.launch.mock.calls.length).toBe(1)
    const request = ipc.launch.mock.calls[0][0]
    expect(request.id).toBe('plan')
    expect(request.browser.chats).not.toBeNull()
    expect(request.portable.chats).not.toBeNull()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recovery point saved. Starting the update.')
  })
  it('keeps the current app available when directory verification fails', async () => {
    ipc.pick.mockRejectedValue(new Error('update-checksum private-path'))
    mount()
    await page.getByRole('button', { name: 'Select update directory' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Update integrity check failed. Extract an intact release again.')
    expect(ipc.launch).not.toHaveBeenCalled()
    await expect.element(page.getByRole('button', { name: 'Select update directory' })).toBeEnabled()
  })
  it('disables update actions in an unsupported development runtime', async () => {
    ipc.status.mockResolvedValue({ supported: false, last: null })
    mount()
    await expect.element(page.getByRole('button', { name: 'Select update directory' })).toBeDisabled()
    expect(ipc.launch).not.toHaveBeenCalled()
  })
})

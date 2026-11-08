import type { DataSettingsStatusPayload } from '../status'

import en from '@proj-airi/i18n/locales/en'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import DangerSection from './danger-section.vue'

import 'virtual:uno.css'

const { deleteAllData, resetProvidersSettings, trackDataAction } = vi.hoisted(() => ({
  deleteAllData: vi.fn<() => Promise<void>>(),
  resetProvidersSettings: vi.fn<() => Promise<void>>(),
  trackDataAction: vi.fn(),
}))

// These are command boundaries. The tests never call real storage, model, chat, or provider resets.
vi.mock('@proj-airi/stage-ui/composables/use-data-maintenance', () => ({
  useDataMaintenance: () => ({ deleteAllData, resetProvidersSettings }),
}))
vi.mock('@proj-airi/stage-ui/composables', () => ({ useAnalytics: () => ({ trackDataAction }) }))

async function mount(afterDeleteAll?: () => Promise<void>) {
  const status = vi.fn<(payload: DataSettingsStatusPayload) => void>()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const screen = await render(DangerSection, { props: { afterDeleteAll, onStatus: status }, global: { plugins: [i18n] } })
  onTestFinished(() => screen.unmount())
  async function confirmDelete() {
    await screen.getByRole('button', { name: i18n.global.t('settings.pages.data.sections.all.delete'), exact: true }).click()
    await screen.getByRole('button', { name: i18n.global.t('settings.pages.data.confirmations.yes'), exact: true }).click()
  }
  return { screen, status, confirmDelete, t: i18n.global.t }
}

describe('host cleanup after deleting all shared data', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    deleteAllData.mockResolvedValue(undefined)
    resetProvidersSettings.mockResolvedValue(undefined)
  })

  it('awaits shared cancellation and card reset, then host cleanup, before reporting success', async () => {
    const shared = Promise.withResolvers<void>()
    const host = Promise.withResolvers<void>()
    const order: string[] = []
    deleteAllData.mockImplementationOnce(async () => {
      order.push('shared-started')
      await shared.promise
      order.push('shared-finished')
    })
    const afterDeleteAll = vi.fn(async () => {
      order.push('host-started')
      await host.promise
      order.push('host-finished')
    })
    const { status, confirmDelete, t } = await mount(afterDeleteAll)
    await confirmDelete()
    await expect.poll(() => order).toEqual(['shared-started'])
    expect(afterDeleteAll).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    shared.resolve()
    await expect.poll(() => afterDeleteAll).toHaveBeenCalledOnce()
    expect(status).not.toHaveBeenCalled()
    expect(trackDataAction).not.toHaveBeenCalled()
    host.resolve()
    await expect.poll(() => status.mock.calls).toEqual([[{ message: t('settings.pages.data.status.all_deleted'), tone: 'success' }]])
    expect(order).toEqual(['shared-started', 'shared-finished', 'host-started', 'host-finished'])
    expect(trackDataAction).toHaveBeenCalledWith({ action: 'app_data_cleared' })
  })

  it('does not report deletion success when host cleanup fails', async () => {
    const afterDeleteAll = vi.fn(async () => {
      throw new Error('Please try again.')
    })
    const { status, confirmDelete } = await mount(afterDeleteAll)
    await confirmDelete()
    await expect.poll(() => status.mock.calls).toEqual([[{ message: 'Please try again.', tone: 'error' }]])
    expect(afterDeleteAll).toHaveBeenCalledOnce()
    expect(trackDataAction).not.toHaveBeenCalled()
  })

  it('keeps host data untouched when shared cleanup fails before chat cancellation completes', async () => {
    deleteAllData.mockRejectedValueOnce(new Error('Shared cleanup did not finish.'))
    const afterDeleteAll = vi.fn(async () => {})
    const { status, confirmDelete } = await mount(afterDeleteAll)
    await confirmDelete()
    await expect.poll(() => status.mock.calls).toEqual([[{ message: 'Shared cleanup did not finish.', tone: 'error' }]])
    expect(afterDeleteAll).not.toHaveBeenCalled()
    expect(trackDataAction).not.toHaveBeenCalled()
  })

  it('preserves the shared page behavior when no host cleanup callback is supplied', async () => {
    const { status, confirmDelete, t } = await mount()
    await confirmDelete()
    await expect.poll(() => status.mock.calls).toEqual([[{ message: t('settings.pages.data.status.all_deleted'), tone: 'success' }]])
    expect(deleteAllData).toHaveBeenCalledOnce()
  })

  it('does not clear companion memories when only provider settings are reset', async () => {
    const afterDeleteAll = vi.fn(async () => {})
    const { screen, status, t } = await mount(afterDeleteAll)
    await screen.getByRole('button', { name: t('settings.pages.data.sections.providers.reset'), exact: true }).click()
    await screen.getByRole('button', { name: t('settings.pages.data.confirmations.yes'), exact: true }).click()
    await expect.poll(() => status.mock.calls).toEqual([[{ message: t('settings.pages.data.status.providers_reset'), tone: 'success' }]])
    expect(resetProvidersSettings).toHaveBeenCalledOnce()
    expect(deleteAllData).not.toHaveBeenCalled()
    expect(afterDeleteAll).not.toHaveBeenCalled()
  })
})

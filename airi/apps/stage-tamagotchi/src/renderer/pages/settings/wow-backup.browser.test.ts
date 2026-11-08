import type { BackupPreview, BackupStatus } from '../../../shared/wow-backup'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import en from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowBackup from './wow-backup.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ status: vi.fn(), export: vi.fn(), pick: vi.fn(), schedule: vi.fn(), cancel: vi.fn(), restart: vi.fn(), folder: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const method = event.receiveEvent?.id?.split(':').at(-1)?.replace(/-receive$/, '')
    if (!method || !(method in ipc))
      throw new Error(`Unexpected IPC ${method}`)
    return ipc[method as keyof typeof ipc]
  },
}))

const preview: BackupPreview = { id: 'plan-1', appVersion: '1.0', createdAt: 1_700_000_000_000, sha256: 'a'.repeat(64), manifest: [{ scope: 'history', key: 'file:retail-gold', bytes: 100, sha256: 'b'.repeat(64) }], scopes: { settings: true, history: true, chats: false } }
const pending: BackupStatus = { pending: preview, last: null }

beforeEach(() => {
  vi.resetAllMocks()
  ipc.status.mockResolvedValue({ pending: null, last: null })
  ipc.pick.mockResolvedValue(preview)
  ipc.schedule.mockResolvedValue(pending)
  ipc.cancel.mockResolvedValue({ pending: null, last: null })
  ipc.export.mockResolvedValue({ path: 'C:/Backups/companion.wowbackup.json', preview })
  localStorage.setItem('settings/language', '"en"')
  localStorage.setItem('settings/providers/openai/apiKey', 'private')
})

function mount(locale = 'en') {
  const screen = render(WowBackup, { global: { plugins: [createI18n({ legacy: false, locale, messages: { 'en': { 'wow-companion': parse(en) }, 'zh-Hans': { 'wow-companion': parse(zh) } } })] } })
  onTestFinished(() => {
    screen.unmount()
    localStorage.removeItem('settings/language')
    localStorage.removeItem('settings/providers/openai/apiKey')
    document.documentElement.classList.remove('dark')
  })
  return screen
}

describe('backup settings actions and preview', () => {
  it('reads status only on mount and exports selected saved data only after a click', async () => {
    mount()
    await expect.poll(() => ipc.status.mock.calls.length).toBe(1)
    expect(ipc.export).not.toHaveBeenCalled()
    expect(ipc.pick).not.toHaveBeenCalled()
    const exportGroup = page.getByRole('group', { name: 'Backup contents' })
    await expect.element(exportGroup.getByRole('switch', { name: 'Saved chats and attachments' })).not.toBeChecked()
    await page.getByRole('button', { name: 'Export backup', exact: true }).click()
    await expect.poll(() => ipc.export.mock.calls.length).toBe(1)
    const request = ipc.export.mock.calls[0][0]
    expect(request.selection).toEqual({ settings: true, history: true, chats: false })
    expect(request.browser.chats).toBeNull()
    expect(JSON.stringify(request)).not.toContain('private')
    await expect.element(page.getByRole('status')).toHaveTextContent('Backup saved to C:/Backups/companion.wowbackup.json')
  })

  it('requires preview confirmation, keeps absent scopes disabled, and supports cancel or explicit restart', async () => {
    mount()
    await page.getByRole('button', { name: 'Select backup' }).click()
    await expect.element(page.getByRole('region', { name: 'Verified backup preview' })).toBeVisible()
    expect(ipc.schedule).not.toHaveBeenCalled()
    expect(ipc.restart).not.toHaveBeenCalled()
    const scopes = page.getByRole('group', { name: 'Restore contents' })
    await expect.element(scopes.getByRole('switch', { name: 'Saved chats and attachments' })).toBeDisabled()
    await scopes.getByRole('switch', { name: 'Personas and preferences' }).click()
    await page.getByRole('button', { name: 'Confirm restore after restart' }).click()
    expect(ipc.schedule).toHaveBeenCalledWith({ id: 'plan-1', selection: { settings: false, history: true, chats: false } })
    await expect.element(page.getByRole('region', { name: 'Restore scheduled' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel scheduled restore' }).click()
    await expect.poll(() => ipc.cancel.mock.calls.length).toBe(1)
    await expect.element(page.getByRole('button', { name: 'Select backup' })).toBeEnabled()
    await page.getByRole('button', { name: 'Select backup' }).click()
    await page.getByRole('button', { name: 'Confirm restore after restart' }).click()
    await page.getByRole('button', { name: 'Restart and restore' }).click()
    expect(ipc.restart).toHaveBeenCalledTimes(1)
  })

  it('shows a safe checksum failure and never schedules a damaged archive', async () => {
    ipc.pick.mockRejectedValue(new Error('backup-checksum private-details'))
    mount()
    await page.getByRole('button', { name: 'Select backup' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Backup integrity verification failed. Select an intact backup.')
    expect(ipc.schedule).not.toHaveBeenCalled()
    await expect.element(page.getByRole('button', { name: 'Select backup' })).toBeEnabled()
  })

  it('renders Chinese confirmation and the manifest in a narrow dark window', async () => {
    const background = document.body.style.backgroundColor
    const color = document.body.style.color
    document.body.style.backgroundColor = '#0a0a0a'
    document.body.style.color = '#f5f5f5'
    onTestFinished(async () => {
      document.body.style.backgroundColor = background
      document.body.style.color = color
      await page.viewport(900, 720)
    })
    await page.viewport(420, 850)
    document.documentElement.classList.add('dark')
    mount('zh-Hans')
    await page.getByRole('button', { name: '选择备份文件' }).click()
    await expect.element(page.getByRole('region', { name: '已校验的备份预览' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '确认重启后恢复' })).toBeEnabled()
    await page.getByRole('region', { name: '已校验的备份预览' }).screenshot({ path: 'wow-backup-preview-zh-dark.png' })
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(420)
  })
})

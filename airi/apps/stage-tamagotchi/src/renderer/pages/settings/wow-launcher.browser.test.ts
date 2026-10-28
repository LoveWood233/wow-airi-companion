import type { Component } from 'vue'

import type { LauncherSaveRequest, LauncherState } from '../../../shared/wow-launcher'

import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import ControlsIslandWowLauncher from '../../components/stage-islands/controls-island/controls-island-wow-launcher.vue'
import WowLauncherSettings from '../../components/wow-launcher-settings.vue'

import { controlsIslandPlacementKey } from '../../components/stage-islands/controls-island/use-controls-island-placement'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const invokes = vi.hoisted(() => ({ get: vi.fn(), pick: vi.fn(), save: vi.fn(), launch: vi.fn(), openSettings: vi.fn() }))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:wow-launcher:get-receive': return invokes.get
      case 'eventa:invoke:wow-launcher:pick-receive': return invokes.pick
      case 'eventa:invoke:wow-launcher:save-receive': return invokes.save
      case 'eventa:invoke:wow-launcher:launch-receive': return invokes.launch
      case 'eventa:invoke:electron:windows:settings:open-receive': return invokes.openSettings
      default: throw new Error(`Unexpected invoke: ${event.receiveEvent?.id}`)
    }
  },
}))

let state: LauncherState

beforeEach(() => {
  vi.clearAllMocks()
  state = { supported: true, defaultTarget: 'battle-net', paths: { 'battle-net': '', 'retail': '', 'forever': '', 'classic': '' } }
  invokes.get.mockImplementation(async () => structuredClone(state))
  invokes.pick.mockResolvedValue({ path: null })
  invokes.save.mockImplementation(async (request: LauncherSaveRequest) => {
    state.paths[request.target] = request.path
    if (request.makeDefault)
      state.defaultTarget = request.target
    return {
      ok: true,
      state: structuredClone(state),
      executable: request.path ? { target: request.target, path: request.path, productName: 'World of Warcraft', fileVersion: '12.0.0' } : undefined,
    }
  })
  invokes.launch.mockImplementation(async () => ({ ok: true, state: structuredClone(state) }))
  invokes.openSettings.mockResolvedValue(undefined)
})

async function mount(component: Component = WowLauncherSettings, locale = 'en') {
  const screen = await render(component, {
    global: {
      plugins: [createPinia(), createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } } })],
      provide: {
        [controlsIslandPlacementKey as symbol]: { dock: ref('bottom-left'), isLeft: ref(true), isTop: ref(false), motionPhase: ref('idle') },
      },
    },
  })
  onTestFinished(() => screen.unmount())
  await vi.waitFor(() => expect(invokes.get).toHaveBeenCalled())
  return screen
}

describe('game launch configuration', () => {
  it('validates and saves a selected version without launching it', async () => {
    await mount()
    await page.getByRole('button', { name: 'World of Warcraft Retail', exact: true }).click()
    await page.getByRole('textbox').fill('C:\\Games\\_retail_\\Wow.exe')
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Validate and save', exact: true }).click()

    expect(invokes.save).toHaveBeenCalledWith({ target: 'retail', path: 'C:\\Games\\_retail_\\Wow.exe', makeDefault: true })
    expect(invokes.launch).not.toHaveBeenCalled()
    await expect.element(page.getByText('Program validated and saved.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Quick launch target: World of Warcraft Retail', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Launch game', exact: true })).toBeEnabled()
  })

  it('keeps an invalid draft out of launch requests and shows the validation reason', async () => {
    invokes.save.mockResolvedValue({ ok: false, code: 'wrong-version' })
    await mount()
    await page.getByRole('button', { name: 'World of Warcraft Forever', exact: true }).click()
    await page.getByRole('textbox').fill('C:\\Games\\_retail_\\Wow.exe')
    await page.getByRole('button', { name: 'Validate and save', exact: true }).click()

    await expect.element(page.getByRole('alert')).toHaveTextContent('belongs to another game version')
    await expect.element(page.getByRole('button', { name: 'Launch game', exact: true })).toBeDisabled()
    expect(invokes.launch).not.toHaveBeenCalled()
    expect(state.paths.forever).toBe('')
  })

  it('preserves the draft when the file dialog is cancelled', async () => {
    await mount()
    await page.getByRole('textbox').fill('C:\\Games\\Battle.net.exe')
    await page.getByRole('button', { name: 'Browse programs', exact: true }).click()
    await expect.element(page.getByRole('textbox')).toHaveValue('C:\\Games\\Battle.net.exe')
    expect(invokes.save).not.toHaveBeenCalled()
  })

  it('launches only the saved selected target and disables launch after editing its path', async () => {
    state.paths.classic = 'C:\\Games\\_classic_\\WowClassic.exe'
    state.defaultTarget = 'classic'
    await mount()
    await page.getByRole('button', { name: 'Launch game', exact: true }).click()
    expect(invokes.launch).toHaveBeenCalledWith({ target: 'classic' })
    await expect.element(page.getByText('Launch request sent.', { exact: true })).toBeVisible()

    await page.getByRole('textbox').fill('C:\\other.exe')
    await expect.element(page.getByRole('button', { name: 'Launch game', exact: true })).toBeDisabled()
    await expect.element(page.getByText('Launch request sent.', { exact: true })).not.toBeInTheDocument()
  })

  it('removes a saved path and prevents launching the removed target', async () => {
    state.paths['battle-net'] = 'C:\\Games\\Battle.net.exe'
    await mount()
    await page.getByRole('button', { name: 'Remove saved path', exact: true }).click()
    expect(invokes.save).toHaveBeenCalledWith({ target: 'battle-net', path: '', makeDefault: false })
    await expect.element(page.getByRole('textbox')).toHaveValue('')
    await expect.element(page.getByRole('button', { name: 'Launch Battle.net', exact: true })).toBeDisabled()
  })

  it('shows Chinese validation feedback and disables actions on unsupported systems', async () => {
    state.supported = false
    await mount(WowLauncherSettings, 'zh-Hans')
    await expect.element(page.getByText('游戏快捷启动目前仅支持 Windows。', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '浏览程序', exact: true })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '校验并保存', exact: true })).toBeDisabled()
  })

  it('does not show success or replace the saved path when persistence fails', async () => {
    state.paths['battle-net'] = 'C:\\Old\\Battle.net.exe'
    invokes.save.mockResolvedValue({ ok: false, code: 'storage-error' })
    await mount()
    await page.getByRole('textbox').fill('C:\\New\\Battle.net.exe')
    await page.getByRole('button', { name: 'Validate and save', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('could not be read or saved')
    await expect.element(page.getByText('Program validated and saved.', { exact: true })).not.toBeInTheDocument()
    expect(state.paths['battle-net']).toBe('C:\\Old\\Battle.net.exe')
  })

  it.each(['light', 'dark'])('keeps a long verified path and Chinese actions usable at 360px in %s mode', async (theme) => {
    const originalTheme = document.documentElement.classList.contains('dark')
    const originalBackground = document.body.style.backgroundColor
    const originalColor = document.body.style.color
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.style.backgroundColor = theme === 'dark' ? '#0a0a0a' : '#fafafa'
    document.body.style.color = theme === 'dark' ? '#f5f5f5' : '#171717'
    await page.viewport(360, 800)
    onTestFinished(async () => {
      document.documentElement.classList.toggle('dark', originalTheme)
      document.body.style.backgroundColor = originalBackground
      document.body.style.color = originalColor
      await page.viewport(900, 720)
    })
    state.defaultTarget = 'retail'
    state.paths.retail = `C:\\Games\\${'LongInstallationFolder'.repeat(8)}\\用户安装目录\\_retail_\\Wow.exe`
    await mount(WowLauncherSettings, 'zh-Hans')
    await page.getByRole('button', { name: '校验并保存', exact: true }).click()
    await expect.element(page.getByRole('button', { name: '启动游戏', exact: true })).toBeEnabled()
    await expect.element(page.getByText('已通过校验的程序', { exact: true })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    const captureDirectory = import.meta.env.VITE_LAUNCHER_CAPTURE_DIR
    if (captureDirectory)
      await page.getByTestId('wow-launcher-settings').screenshot({ path: `${captureDirectory}/wow-launcher-360-${theme}.png` })
  })
})

describe('game quick launch', () => {
  it('opens configuration when no default program is saved', async () => {
    invokes.launch.mockResolvedValue({ ok: false, code: 'not-configured' })
    await mount(ControlsIslandWowLauncher)
    await page.getByTestId('controls-island-wow-launcher').click()
    expect(invokes.launch).toHaveBeenCalledWith({})
    expect(invokes.openSettings).toHaveBeenCalledWith({ route: '/settings/wow-launcher' })
  })

  it('asks the main process to launch the persisted default without accepting a renderer path', async () => {
    state.defaultTarget = 'retail'
    state.paths.retail = 'C:\\Games\\_retail_\\Wow.exe'
    await mount(ControlsIslandWowLauncher)
    await page.getByTestId('controls-island-wow-launcher').click()
    expect(invokes.launch).toHaveBeenCalledWith({})
    expect(invokes.openSettings).not.toHaveBeenCalled()
  })
})

import type { DshPetConfigure, DshPetLibraryState } from '../../shared/dsh-pet-library'

import { createPinia, disposePinia } from 'pinia'
import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { parse as yaml } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/dsh-pet.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/dsh-pet.yaml?raw'
import Settings from '../pages/settings/models/index.vue'
import manifest from '../public/dsh-pet/builtin/pack.json'

import { dshPetPackSchema } from '../../shared/dsh-pet'
import { petAnimationUrl } from '../utils/dsh-pet-animation'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

const native = vi.hoisted(() => ({ get: vi.fn(), configure: vi.fn(), importPack: vi.fn(), on: vi.fn(() => () => {}) }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaContext: () => ({ value: { on: native.on } }),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:dsh-pet:get-receive': return native.get
      case 'eventa:invoke:dsh-pet:configure-receive': return native.configure
      case 'eventa:invoke:dsh-pet:import-receive': return native.importPack
      default: throw new Error(`Unexpected pet IPC: ${event.receiveEvent?.id}`)
    }
  },
}))

let base: HTMLBaseElement
let state: DshPetLibraryState
beforeEach(() => {
  vi.clearAllMocks()
  base = document.createElement('base')
  base.href = `${new URL('../public/', import.meta.url).href.replace(/\/$/, '')}/`
  document.head.prepend(base)
  state = { selectedId: 'builtin', scale: 1, packs: [parse(dshPetPackSchema, { ...manifest, baseUrl: './dsh-pet/builtin' })] }
  native.get.mockImplementation(async () => structuredClone(state))
  native.configure.mockImplementation(async (request: DshPetConfigure) => {
    state = { ...state, ...request }
    return structuredClone(state)
  })
  native.importPack.mockImplementation(async () => {
    const imported = { ...state.packs[0], id: 'another', name: 'Another pet' }
    state = { ...state, selectedId: imported.id, packs: [...state.packs, imported] }
    return structuredClone(state)
  })
})
afterEach(() => base.remove())

function mount(locale = 'en') {
  const pinia = createPinia()
  const screen = render(Settings, { global: { plugins: [pinia, createI18n({ legacy: false, locale, messages: {
    'en': { 'dsh-pet': yaml(en) },
    'zh-Hans': { 'dsh-pet': yaml(zh) },
  } })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return screen
}

describe('dSH desktop pet settings', () => {
  it('offers the bundled animation pack and an actual animated canvas immediately', async () => {
    const mediaUrl = petAnimationUrl(state.packs[0], state.packs[0].animations.idle[0], document.baseURI)
    const media = await fetch(mediaUrl)
    expect(media.status, mediaUrl).toBe(200)
    mount()
    await expect.element(page.getByRole('heading', { name: 'Animation preview' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /DSH Pet.*114 animations/ })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('canvas')).not.toBeNull()
    await vi.waitFor(() => expect([...document.querySelectorAll('video')].some(video => !video.paused && video.readyState >= 2)).toBe(true))
    expect(native.get).toHaveBeenCalledExactlyOnceWith()
    expect(document.body.textContent).not.toMatch(/Live2D|VRM|Godot|MMD/)
  })

  it('imports through the native folder picker and selects the returned pack', async () => {
    mount()
    await page.getByRole('button', { name: 'Import animation pack', exact: true }).click()
    expect(native.importPack).toHaveBeenCalledExactlyOnceWith()
    await expect.element(page.getByRole('button', { name: /Another pet.*114 animations/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /DSH Pet.*114 animations/ }).click()
    expect(native.configure).toHaveBeenCalledExactlyOnceWith({ selectedId: 'builtin', scale: 1 })
  })

  it('saves the displayed size through native persistence', async () => {
    mount()
    await vi.waitFor(() => expect(native.get).toHaveBeenCalledTimes(1))
    const slider = page.getByRole('slider').element() as HTMLInputElement
    slider.value = '1500000'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await page.getByRole('button', { name: 'Save size', exact: true }).click()
    expect(native.configure).toHaveBeenCalledExactlyOnceWith({ selectedId: 'builtin', scale: 1.5 })
  })

  it('keeps the current pack when import is cancelled or fails', async () => {
    native.importPack.mockResolvedValueOnce(null)
    mount()
    await page.getByRole('button', { name: 'Import animation pack', exact: true }).click()
    await expect.element(page.getByRole('button', { name: /DSH Pet.*114 animations/ })).toHaveAttribute('aria-pressed', 'true')
    expect(document.body.textContent).not.toContain('The operation failed.')
    native.importPack.mockRejectedValueOnce(new Error('Synthetic invalid pack'))
    await page.getByRole('button', { name: 'Import animation pack', exact: true }).click()
    await expect.element(page.getByText('The operation failed. Check the animation files or try again later.', { exact: true })).toBeVisible()
  })

  it('keeps translated controls readable in a narrow dark viewport', async () => {
    await page.viewport(390, 900)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
    })
    mount('zh-Hans')
    await expect.element(page.getByRole('button', { name: '导入动画包', exact: true })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await vi.waitFor(() => expect([...document.querySelectorAll('video')].some(video => !video.paused && video.readyState >= 2)).toBe(true))
    await page.screenshot({ path: 'dsh-pet-settings-zh-dark.png' })
  })
})

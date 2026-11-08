import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { useWowPlayerAddressSettingsStore } from './wow-player-address-settings'

const storageKey = 'settings/wow-companion/player-address'
const closeWindows: Array<() => void> = []

function openWindow() {
  const pinia = createPinia()
  let store: ReturnType<typeof useWowPlayerAddressSettingsStore> | undefined
  const app = createApp({
    setup() {
      store = useWowPlayerAddressSettingsStore(pinia)
      return () => null
    },
  })
  const element = document.createElement('div')
  document.body.append(element)
  app.use(pinia).mount(element)
  if (!store)
    throw new Error('The preference store did not mount')
  let closed = false
  const close = () => {
    if (closed)
      return
    closed = true
    app.unmount()
    disposePinia(pinia)
    element.remove()
  }
  closeWindows.push(close)
  return { store, close }
}

beforeEach(() => localStorage.removeItem(storageKey))

afterEach(() => {
  for (const close of closeWindows.splice(0))
    close()
  vi.restoreAllMocks()
  localStorage.removeItem(storageKey)
})

describe('warcraft player address preferences', () => {
  it('uses the current character name by default', () => {
    const { store } = openWindow()
    expect(store.mode).toBe('character')
    expect(store.customName).toBe('')
  })

  it('restores the fixed custom name after the window closes', async () => {
    const first = openWindow()
    expect(first.store.setCustomName('  小拿铁 🐉  ')).toBe(true)
    await nextTick()
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ mode: 'custom', customName: '小拿铁 🐉' })
    first.close()

    const restored = openWindow()
    expect(restored.store.mode).toBe('custom')
    expect(restored.store.customName).toBe('小拿铁 🐉')
  })

  it.each(['', '   ', '名'.repeat(41), '旧名\n新名', '旧名\r新名', '旧名\u0000新名'])('rejects an invalid name without replacing the saved name: %j', async (value) => {
    const { store } = openWindow()
    store.setCustomName('旅人')
    await nextTick()
    const saved = localStorage.getItem(storageKey)
    expect(store.setCustomName(value)).toBe(false)
    await nextTick()
    expect(store.mode).toBe('custom')
    expect(store.customName).toBe('旅人')
    expect(localStorage.getItem(storageKey)).toBe(saved)
  })

  it('persists the character option and retains the previous custom name for editing', async () => {
    const first = openWindow()
    first.store.setCustomName('深烘拿铁')
    first.store.setCharacterName()
    await nextTick()
    expect(first.store.mode).toBe('character')
    expect(first.store.customName).toBe('深烘拿铁')
    first.close()

    const restored = openWindow()
    expect(restored.store.mode).toBe('character')
    expect(restored.store.customName).toBe('深烘拿铁')
  })

  it('saves a direct conversation request to the same preference and accepts a character-name reset', async () => {
    const { store } = openWindow()
    expect(store.applyRequest('喊我小拿铁')).toBe(true)
    await nextTick()
    expect(store.mode).toBe('custom')
    expect(store.customName).toBe('小拿铁')
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ mode: 'custom', customName: '小拿铁' })

    expect(store.applyRequest('不要叫我陌生人')).toBe(false)
    expect(store.mode).toBe('custom')
    expect(store.customName).toBe('小拿铁')
    expect(store.applyRequest('叫我当前角色名')).toBe(true)
    await nextTick()
    expect(store.mode).toBe('character')
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ mode: 'character', customName: '小拿铁' })
  })

  it('shares changes between independent windows without repeated storage writes', async () => {
    const main = openWindow()
    const settings = openWindow()
    await nextTick()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const preferenceWrites = () => writes.mock.calls.filter(([key]) => key === storageKey)

    expect(settings.store.setCustomName('月光旅人')).toBe(true)
    await expect.poll(() => main.store.mode).toBe('custom')
    await expect.poll(() => main.store.customName).toBe('月光旅人')
    expect(settings.store.customName).toBe('月光旅人')
    await nextTick()
    expect(preferenceWrites()).toHaveLength(1)

    expect(main.store.setCustomName('月光旅人')).toBe(true)
    await nextTick()
    expect(preferenceWrites()).toHaveLength(1)

    main.store.setCharacterName()
    await expect.poll(() => settings.store.mode).toBe('character')
    expect(main.store.mode).toBe('character')
    expect(settings.store.customName).toBe('月光旅人')
    await nextTick()
    expect(preferenceWrites()).toHaveLength(2)

    settings.store.setCharacterName()
    await nextTick()
    expect(preferenceWrites()).toHaveLength(2)
  })
})

import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { useWowGuideStore } from '../stores/wow-guide'
import { useWowGuideStartup } from './use-wow-guide-startup'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: () => mocks.open,
}))

beforeEach(() => {
  mocks.open.mockReset().mockResolvedValue(undefined)
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('wow-companion/guide/') || key.startsWith('onboarding/'))
      localStorage.removeItem(key)
  }
})

async function mount(completed: boolean) {
  const pinia = createPinia()
  const onboarding = useOnboardingStore(pinia)
  if (completed)
    await onboarding.markSetupCompleted()
  const guide = useWowGuideStore(pinia)
  const Host = defineComponent({
    setup() {
      useWowGuideStartup()
      return () => h('div')
    },
  })
  const screen = render(Host, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return { guide, onboarding }
}

describe('first launch guide offer', () => {
  it('opens the settings guide once after basic onboarding completes', async () => {
    const { guide } = await mount(true)
    await expect.poll(() => mocks.open.mock.calls.length).toBe(1)
    expect(mocks.open).toHaveBeenCalledWith({ route: '/settings/wow-guide?tour=auto' })
    await expect.poll(() => guide.offered).toBe(true)
  })

  it('waits while provider onboarding is open, then offers after a skip', async () => {
    const { onboarding } = await mount(false)
    expect(mocks.open).not.toHaveBeenCalled()
    await onboarding.markSetupSkipped()
    await expect.poll(() => mocks.open.mock.calls.length).toBe(1)
  })

  it('does not offer again when the profile has already seen the guide', async () => {
    localStorage.setItem('wow-companion/guide/offered-v1', 'true')
    await mount(true)
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('keeps a failed window-open attempt retryable', async () => {
    mocks.open.mockRejectedValueOnce(new Error('window unavailable'))
    const { guide } = await mount(true)
    await expect.poll(() => mocks.open.mock.calls.length).toBe(1)
    await expect.poll(() => guide.offered).toBe(false)
  })
})

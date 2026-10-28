import en from '@proj-airi/i18n/locales/en'
import zhHans from '@proj-airi/i18n/locales/zh-Hans'

import { createFallbackOptions } from '@proj-airi/i18n'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import StepWelcome from './step-welcome.vue'

import { useAuthStore } from '../../../../stores/auth'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  // The card store keeps its cards in the local storage.
  localStorage.clear()
})

/** Creates the production English localization surface used by onboarding stores. */
function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en,
    },
  })
}

/** Renders the welcome step with real Pinia and i18n plugins. */
async function renderWelcomeStep(signedIn: boolean) {
  const pinia = createPinia()
  const onNext = vi.fn()
  const screen = await render(StepWelcome, {
    attrs: { style: 'height: calc(100dvh - 64px); margin: 32px' },
    props: {
      onNext,
    },
    global: {
      directives: {
        motion: {},
      },
      plugins: [pinia, createTestI18n()],
    },
  })
  if (signedIn) {
    const date = new Date('2026-01-01')
    useAuthStore(pinia).$patch({
      user: { id: 'user', name: 'Saved user', email: 'user@example.test', emailVerified: true, createdAt: date, updatedAt: date },
      session: { id: 'session', userId: 'user', token: 'saved-session', expiresAt: new Date('2027-01-01'), createdAt: date, updatedAt: date },
      token: 'saved-token',
    })
    await nextTick()
  }
  return { screen, onNext, auth: useAuthStore(pinia) }
}

describe('local onboarding entry', () => {
  it.each([false, true])('offers provider setup without cloud account UI when signed in is %s', async (signedIn) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ flux: 0 }))
    const { screen, onNext, auth } = await renderWelcomeStep(signedIn)

    await expect.element(screen.getByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Pricing' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Terms of Service' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Flux')
    expect(document.querySelector('img')).toBeNull()
    await expect.poll(() => getComputedStyle(screen.getByRole('button', { name: 'Configure a model provider' }).element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    if (!signedIn)
      await page.screenshot({ path: '__screenshots__/local-onboarding-welcome.png' })

    await screen.getByRole('button', { name: 'Configure a model provider' }).click()

    expect(onNext).toHaveBeenCalledOnce()
    expect(auth.needsLogin).toBe(false)
  })
})

describe('onboarding language choice', () => {
  /** Renders the welcome step in English, in an app that creates the built-in card as a first start does. */
  async function renderWithBuiltInCard() {
    const pinia = createPinia()
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, 'zh-Hans': zhHans }, ...createFallbackOptions(console.warn) })
    const App = defineComponent({
      setup() {
        // The card store creates its runtime stores in the setup of the app, where they can bind i18n.
        void useAiriCardStore().initialize()
        return () => h(StepWelcome, { onNext: vi.fn() })
      },
    })
    await render(App, {
      global: {
        directives: { motion: {} },
        plugins: [pinia, i18n],
      },
    })
    const cardStore = useAiriCardStore(pinia)
    await expect.poll(() => cardStore.getCard('default')).toBeDefined()
    return { cardStore, i18n }
  }

  it('gives the built-in card the description of the chosen language', async () => {
    const { cardStore, i18n } = await renderWithBuiltInCard()
    const english = cardStore.builtInCard.description
    expect(cardStore.getCard('default')?.description).toBe(english)

    i18n.global.locale.value = 'zh-Hans'

    await expect.poll(() => cardStore.getCard('default')?.description).not.toBe(english)
    expect(cardStore.getCard('default')?.description).toBe(cardStore.builtInCard.description)
  })

  it('keeps a description that the user edited', async () => {
    const { cardStore, i18n } = await renderWithBuiltInCard()
    const english = cardStore.builtInCard.description
    await cardStore.updateCard('default', { ...cardStore.builtInCard, description: 'My own persona' })

    i18n.global.locale.value = 'zh-Hans'
    await nextTick()

    expect(cardStore.builtInCard.description).not.toBe(english)
    expect(cardStore.getCard('default')?.description).toBe('My own persona')
  })
})

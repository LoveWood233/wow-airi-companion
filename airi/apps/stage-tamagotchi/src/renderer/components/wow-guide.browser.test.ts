import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import GuidePage from '../pages/settings/wow-guide.vue'
import WowGuideOverlay from './wow-guide-overlay.vue'

import { setupEnvironment, setupInspection, setupState } from '../../shared/wow-setup.test-helper'
import { guideSteps, useWowGuideStore } from '../stores/wow-guide'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => async (input?: { game?: 'retail' | 'forever' }) => {
    const id = event.receiveEvent?.id ?? ''
    if (id.includes('wow-setup:inspect'))
      return setupInspection(input?.game)
    if (id.includes('wow-setup:environment'))
      return setupEnvironment()
    if (id.includes('wow-companion:get'))
      return setupState(input?.game)
    throw new Error(`Unexpected invoke ${id}`)
  },
}))

beforeEach(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('wow-companion/guide/'))
      localStorage.removeItem(key)
  }
})

async function mount(locale = 'en', auto = false) {
  const fixture = defineComponent({ template: '<section data-wow-guide-anchor style="padding:24px"><h2>Example settings</h2><input aria-label="Example setting"></section>' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...new Set([...guideSteps.map(s => s.path), '/settings/wow-companion-forever'])].map(path => ({
      path,
      component: path === '/settings/wow-guide' ? GuidePage : fixture,
    })),
  })
  await router.push(`/settings/wow-guide${auto ? '?tour=auto' : ''}`)
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { 'en': { 'wow-companion': parse(en) }, 'zh-Hans': { 'wow-companion': parse(zh) } } })
  const Host = defineComponent({ setup: () => () => h('main', { style: 'padding:60px 20px 20px' }, [h('div', { 'data-wow-guide-content': '' }, [h(RouterView)]), h(WowGuideOverlay)]) })
  const screen = render(Host, { global: { plugins: [pinia, router, i18n] } })
  const guide = useWowGuideStore(pinia)
  let mounted = true
  function unmount() {
    if (mounted) {
      screen.unmount()
      disposePinia(pinia)
      mounted = false
    }
  }
  onTestFinished(unmount)
  return { router, guide, unmount }
}

describe('woW first-use tour', () => {
  it('starts automatically, advances real routes, pauses for configuration and resumes without changing inputs', async () => {
    const { router, guide } = await mount('en', true)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByTestId('wow-guide-spotlight')).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/models')
    await expect.element(page.getByRole('heading', { name: 'Choose your companion character' })).toBeVisible()
    await page.getByRole('button', { name: 'Configure this page' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await page.getByRole('textbox', { name: 'Example setting' }).fill('My character')
    await page.getByRole('button', { name: 'Continue guide' }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Configure this page' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Example setting' })).toHaveValue('My character')
    await page.getByRole('button', { name: 'Continue guide' }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect.poll(() => guide.index).toBe(0)
  })

  it('remembers a skipped step, supports manual continuation, and can restart from Settings', async () => {
    const first = await mount('en', true)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Choose your companion character' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.poll(() => first.guide.outcome).toBe('skipped')
    first.unmount()
    const second = await mount()
    expect(second.guide.offered).toBe(true)
    await page.getByRole('button', { name: 'Continue previous tour' }).click()
    await expect.poll(() => second.router.currentRoute.value.path).toBe('/settings/models')
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await second.router.push('/settings/wow-guide')
    await page.getByRole('button', { name: 'Start again' }).click()
    await expect.poll(() => second.guide.index).toBe(0)
  })

  it('uses the chosen game connection page and finishes without claiming configuration success', async () => {
    const { guide, router } = await mount()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await page.getByRole('button', { name: 'Start guide', exact: true }).click()
    for (let step = 1; step < guideSteps.length; step++) {
      await expect.element(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect.poll(() => guide.index).toBe(step)
      if (step === 5)
        await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-companion-forever')
    }
    await expect.element(page.getByText('Finishing records tour progress only.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Finish guide' }).click()
    await expect.poll(() => guide.outcome).toBe('completed')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('pauses when the user leaves the guided page and traps keyboard focus in the bubble', async () => {
    const { guide, router } = await mount('en', true)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Tab}{Tab}{Tab}{Tab}')
    expect(page.getByRole('dialog').element().contains(document.activeElement)).toBe(true)
    await router.push('/settings/wow-launcher')
    await expect.poll(() => guide.paused).toBe(true)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(router.currentRoute.value.path).toBe('/settings/wow-launcher')
  })

  it('keeps Chinese text and controls inside a narrow dark viewport', async () => {
    await page.viewport(390, 640)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
    })
    await mount('zh-Hans', true)
    await expect.element(page.getByRole('heading', { name: '欢迎来到魔兽陪伴精灵' })).toBeVisible()
    const bubble = page.getByTestId('wow-guide-bubble').element().getBoundingClientRect()
    expect(bubble.left).toBeGreaterThanOrEqual(0)
    expect(bubble.right).toBeLessThanOrEqual(390)
    expect(bubble.bottom).toBeLessThanOrEqual(640)
    await page.screenshot({ path: 'wow-guide-narrow-dark.png' })
    await page.getByRole('button', { name: '暂时跳过' }).click()
  })

  it('starts an automatic tour in a settings window that is already open', async () => {
    const { router } = await mount()
    await router.push('/settings/wow-launcher')
    await router.push('/settings/wow-guide?tour=auto')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Welcome to WoW Companion' })).toBeVisible()
    await expect.poll(() => router.currentRoute.value.query.tour).toBeUndefined()
  })
})

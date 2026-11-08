import type { RouteMeta, RouteRecordRaw } from 'vue-router'

import messages from '@proj-airi/i18n/locales'

import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import ToolPage from '../pages/settings/wow-guide.vue'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: () => invoke,
}))

const sources = import.meta.glob('../pages/settings/wow-*.vue', { query: '?raw', import: 'default', eager: true })

async function mountTools(locale = 'en') {
  invoke.mockReset()
  const opened = vi.fn()
  const routes: RouteRecordRaw[] = Object.entries(sources).map(([path, source]) => {
    if (typeof source !== 'string')
      throw new TypeError('Expected page source')
    const block = /<route lang="yaml">([\s\S]+?)<\/route>/.exec(source)?.[1]
    if (!block)
      throw new Error('Missing route metadata')
    const { meta }: { meta: RouteMeta } = parse(block)
    const name = path.slice(path.lastIndexOf('/') + 1, -4)
    return {
      path: `/settings/${name}`,
      meta,
      // A route loader records navigation without opening a tool's external services.
      component: name === 'wow-guide'
        ? ToolPage
        : async () => {
          opened(name)
          return defineComponent(() => () => h('p', name))
        },
    }
  })
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/wow-guide')
  const pinia = createPinia()
  const screen = render(defineComponent(() => () => h('main', { 'data-testid': 'wow-tools-fixture', 'style': 'padding:16px;min-height:100vh;background:var(--neutral-950, #111827);color:var(--neutral-100, #f3f4f6)' }, h(RouterView))), { global: { plugins: [pinia, router, createI18n({
    legacy: false,
    locale,
    missingWarn: false,
    messages,
  })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return { screen, router, opened }
}

describe('optional WoW tools', () => {
  it('groups tools under one settings entry while retaining their direct routes', async () => {
    const { router, opened } = await mountTools()
    const toolRoutes = router.getRoutes().filter(route => route.meta.settingsTool)
    expect(toolRoutes).toHaveLength(9)
    expect(toolRoutes.every(route => !route.meta.settingsEntry)).toBe(true)
    expect(router.getRoutes().find(route => route.path === '/settings/wow-guide')?.meta.settingsEntry).toBe(true)
    await expect.element(page.getByRole('navigation', { name: 'WoW tools', exact: true })).toBeVisible()
    for (const route of toolRoutes)
      expect(page.getByRole('navigation', { name: 'WoW tools', exact: true }).element().querySelector(`a[href="${route.path}"]`)).not.toBeNull()
    expect(opened).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loads only the selected tool route and keeps the first-use guide available', async () => {
    const { router, opened } = await mountTools()
    await expect.element(page.getByRole('button', { name: 'Start guide', exact: true })).toBeVisible()
    const link = page.getByRole('navigation', { name: 'WoW tools', exact: true }).element().querySelector<HTMLAnchorElement>('a[href="/settings/wow-launcher"]')
    expect(link).not.toBeNull()
    link!.click()
    await expect.poll(() => router.currentRoute.value.path).toBe('/settings/wow-launcher')
    expect(opened).toHaveBeenCalledExactlyOnceWith('wow-launcher')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps Chinese tool links inside a narrow dark viewport', async () => {
    await page.viewport(390, 2000)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
    })
    const { screen } = await mountTools('zh-Hans')
    await expect.element(page.getByRole('navigation', { name: '魔兽工具', exact: true })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await screen.getByRole('navigation', { name: '魔兽工具', exact: true }).screenshot({ path: 'wow-tools-narrow-dark.png' })
  })
})

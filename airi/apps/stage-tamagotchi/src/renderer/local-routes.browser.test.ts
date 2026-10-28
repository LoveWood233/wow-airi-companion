import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import AccountPage from './pages/settings/account/index.vue'

import { installLocalAccountRoutes } from './local-routes'

describe('local companion settings routes', () => {
  it.each([
    '/settings/account',
    '/settings/flux',
    '/settings/capacitor',
    '/settings/voice-packs',
    '/settings/providers/chat/official-provider',
    '/settings/providers/vision/official-provider',
    '/settings/providers/speech/official-provider-speech',
    '/settings/providers/speech/official-provider-speech-streaming',
    '/settings/providers/transcription/official-provider-transcription',
    '/v2/settings/providers/edit/official-provider',
    '/auth/callback',
    '/login',
  ])('redirects %s before cloud account UI mounts', async (path) => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings', component: defineComponent(() => () => h('p', 'Local companion settings')) },
        { path, component: AccountPage, meta: { settingsEntry: true } },
      ],
    })
    installLocalAccountRoutes(router)
    await router.push(path)
    await router.isReady()
    const screen = render(defineComponent(() => () => h(RouterView)), { global: { plugins: [router] } })

    expect(router.currentRoute.value.path).toBe('/settings')
    expect(router.getRoutes().find(route => route.path === path)?.meta.settingsEntry).toBe(false)
    await expect.element(screen.getByText('Local companion settings')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('keeps custom model configuration routes available', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings', component: defineComponent(() => () => null) },
        { path: '/settings/providers/chat/deepseek', component: defineComponent(() => () => h('p', 'DeepSeek configuration')), meta: { settingsEntry: true } },
      ],
    })
    installLocalAccountRoutes(router)
    await router.push('/settings/providers/chat/deepseek')
    await router.isReady()
    const screen = render(defineComponent(() => () => h(RouterView)), { global: { plugins: [router] } })

    expect(router.currentRoute.value.path).toBe('/settings/providers/chat/deepseek')
    await expect.element(screen.getByText('DeepSeek configuration')).toBeInTheDocument()
  })
})

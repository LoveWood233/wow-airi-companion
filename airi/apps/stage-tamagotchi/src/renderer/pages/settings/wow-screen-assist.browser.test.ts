import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowScreenAssistSettings from '../../components/wow-screen-assist-settings.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

beforeEach(() => {
  localStorage.removeItem('settings/wow-screen-assist/enabled')
  localStorage.removeItem('settings/wow-screen-assist/game')
})

async function mount(locale = 'en') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: WowScreenAssistSettings },
      { path: '/settings/modules/vision', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const screen = await render(WowScreenAssistSettings, {
    global: {
      plugins: [
        createPinia(), router,
        createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en: { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } } }),
      ],
    },
  })
  onTestFinished(() => screen.unmount())
  return { screen, router }
}

describe('game screenshot assistance settings', () => {
  it('persists opt-out and an explicit version, and restores them on remount', async () => {
    const first = await mount()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Forever', exact: true }).click()
    await expect.poll(() => localStorage.getItem('settings/wow-screen-assist/enabled')).toBe('false')
    await expect.poll(() => localStorage.getItem('settings/wow-screen-assist/game')).toBe('forever')
    first.screen.unmount()
    await mount()
    await expect.element(page.getByRole('switch')).not.toBeChecked()
    await expect.element(page.getByRole('button', { name: 'Forever', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the existing vision configuration and explains screenshot use', async () => {
    const { router } = await mount()
    await expect.element(page.getByText('The screenshot goes to your selected vision provider.', { exact: false })).toBeVisible()
    await expect.element(page.getByText('For an explicit capture, start your message with /look', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Configure vision model', exact: true }).click()
    expect(router.currentRoute.value.path).toBe('/settings/modules/vision')
  })

  it.each(['light', 'dark'])('keeps Chinese controls and examples within 360px in %s mode', async (theme) => {
    const previousTheme = document.documentElement.classList.contains('dark')
    const previousBackground = document.body.style.backgroundColor
    const previousColor = document.body.style.color
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.style.backgroundColor = theme === 'dark' ? '#0a0a0a' : '#fafafa'
    document.body.style.color = theme === 'dark' ? '#f5f5f5' : '#171717'
    await page.viewport(360, 900)
    onTestFinished(async () => {
      document.documentElement.classList.toggle('dark', previousTheme)
      document.body.style.backgroundColor = previousBackground
      document.body.style.color = previousColor
      await page.viewport(900, 720)
    })
    await mount('zh-Hans')
    await expect.element(page.getByRole('heading', { name: '游戏截图辅助', exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '怀旧服', exact: true })).toBeVisible()
    await expect.element(page.getByText('任务显示 NPC 在这里', { exact: false })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    const captureDirectory = import.meta.env.VITE_LAUNCHER_CAPTURE_DIR
    if (captureDirectory)
      await page.getByTestId('wow-screen-assist-settings').screenshot({ path: `${captureDirectory}/wow-screen-assist-360-${theme}.png` })
  })
})

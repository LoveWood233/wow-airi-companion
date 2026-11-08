import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowChatter from './wow-chatter.vue'

import { useWowChatterSettingsStore } from '../../stores/wow-chatter-settings'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

beforeEach(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('settings/wow-chatter/'))
      localStorage.removeItem(key)
  }
})

async function mount(locale = 'en') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/wow-chatter', component: WowChatter },
      { path: '/settings/modules/vision', component: { template: '<div />' } },
      { path: '/settings/wow-memories', component: { template: '<div />' } },
    ],
  })
  await router.push('/settings/wow-chatter')
  await router.isReady()
  const pinia = createPinia()
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } },
  })
  const screen = await render(WowChatter, { global: { plugins: [pinia, router, i18n] } })
  let mounted = true
  const unmount = () => {
    if (mounted) {
      screen.unmount()
      disposePinia(pinia)
      mounted = false
    }
  }
  onTestFinished(unmount)
  return { router, screen, unmount, pinia }
}

async function moveScenerySlider(minutes: number) {
  const slider = page.getByTestId('wow-scenery-interval')
  slider.element().focus()
  if (minutes === 60) {
    await userEvent.keyboard('{End}')
  }
  else {
    await userEvent.keyboard('{Home}')
    if (minutes > 1)
      await userEvent.keyboard('{ArrowRight}'.repeat(minutes - 1))
  }
  await expect.element(slider).toHaveAttribute('aria-valuenow', String(minutes))
  return slider
}

describe('independent ordinary and screenshot chatter settings', () => {
  it('configures quiet hours, scene frequencies, and a persistent shared model budget', async () => {
    const { pinia } = await mount()
    const quiet = page.getByRole('region', { name: 'Quiet hours' })
    await expect.element(quiet.getByRole('switch')).not.toBeChecked()
    await quiet.getByRole('switch').click()
    await page.getByLabelText('Start time', { exact: true }).fill('23:30')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/quiet-start')).toBe('"23:30"')
    await page.getByRole('region', { name: 'Scene frequencies' }).getByRole('switch').click()
    await page.getByRole('spinbutton', { name: /Instance ordinary chatter/ }).fill('12')
    await page.getByRole('spinbutton', { name: /Instance ordinary chatter/ }).element().blur()
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/instance-regular')).toBe('12')
    const budget = page.getByRole('region', { name: 'Proactive model budget' })
    await expect.element(budget.getByRole('switch')).not.toBeChecked()
    await budget.getByRole('switch').click()
    await page.getByRole('spinbutton', { name: 'Generation limit per 60 minutes' }).fill('1')
    expect(useWowChatterSettingsStore(pinia).consume()).toBe(true)
    await expect.element(page.getByTestId('wow-model-budget')).toHaveTextContent('Remaining under current limit 0/1')
    await expect.element(page.getByText('Proactive quota is exhausted.', { exact: false })).toBeVisible()
    const captureDirectory = import.meta.env.VITE_CHATTER_CAPTURE_DIR
    if (captureDirectory)
      await page.screenshot({ path: `${captureDirectory}/wow-chatter-rhythm.png` })
  })
  it('keeps location lore independent and restores its switch after remount', async () => {
    const first = await mount()
    const location = page.getByRole('region', { name: 'Location lore' })
    await expect.element(location.getByRole('switch')).toBeChecked()
    await expect.element(location.getByText('No screenshots or vision model.', { exact: false })).toBeVisible()
    await location.getByRole('switch').click()
    await expect.element(page.getByRole('region', { name: 'Ordinary chatter' }).getByRole('switch')).toBeChecked()
    await expect.element(page.getByRole('region', { name: 'Scenery chatter' }).getByRole('switch')).not.toBeChecked()
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/location-enabled')).toBe('false')
    first.unmount()
    await mount()
    await expect.element(page.getByRole('region', { name: 'Location lore' }).getByRole('switch')).not.toBeChecked()
  })
  it('starts with ordinary chatter enabled and screenshot chatter disabled', async () => {
    await mount()
    const normal = page.getByRole('region', { name: 'Ordinary chatter' })
    const scenery = page.getByRole('region', { name: 'Scenery chatter' })
    await expect.element(normal.getByRole('switch')).toBeChecked()
    await expect.element(scenery.getByRole('switch')).not.toBeChecked()
    await expect.element(page.getByTestId('wow-regular-interval')).toHaveAttribute('aria-valuenow', '5')
    await expect.element(page.getByTestId('wow-regular-interval')).toHaveAttribute('aria-valuemin', '2')
    await expect.element(page.getByTestId('wow-regular-interval')).toHaveAttribute('aria-valuemax', '30')
    await expect.element(page.getByTestId('wow-regular-combats')).toHaveAttribute('aria-valuenow', '5')
    await expect.element(page.getByTestId('wow-regular-combats')).toHaveAttribute('aria-valuemin', '5')
    await expect.element(page.getByTestId('wow-regular-combats')).toHaveAttribute('aria-valuemax', '30')
    await expect.element(page.getByTestId('wow-scenery-interval')).toHaveAttribute('aria-valuenow', '10')
    await expect.element(page.getByTestId('wow-scenery-quota-warning')).not.toBeInTheDocument()
  })

  it('saves each switch independently and restores settings after remount', async () => {
    const first = await mount()
    const normal = page.getByRole('region', { name: 'Ordinary chatter' })
    const scenery = page.getByRole('region', { name: 'Scenery chatter' })
    await normal.getByRole('switch').click()
    await expect.element(scenery.getByRole('switch')).not.toBeChecked()
    await scenery.getByRole('switch').click()
    await moveScenerySlider(6)
    const regularSlider = page.getByTestId('wow-regular-interval')
    regularSlider.element().focus()
    await userEvent.keyboard('{End}')
    await expect.element(regularSlider).toHaveAttribute('aria-valuenow', '30')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/regular-enabled')).toBe('false')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/scenery-enabled')).toBe('true')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/regular-interval-minutes')).toBe('30')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/scenery-interval-minutes')).toBe('6')
    first.unmount()
    await mount()
    await expect.element(page.getByRole('region', { name: 'Ordinary chatter' }).getByRole('switch')).not.toBeChecked()
    await expect.element(page.getByRole('region', { name: 'Scenery chatter' }).getByRole('switch')).toBeChecked()
    await expect.element(page.getByTestId('wow-regular-interval')).toHaveAttribute('aria-valuenow', '30')
    await expect.element(page.getByTestId('wow-scenery-interval')).toHaveAttribute('aria-valuenow', '6')
  })

  it('keeps ordinary scene overrides within 0 or 2–30 without changing screenshot limits', async () => {
    await mount()
    await page.getByRole('region', { name: 'Scene frequencies' }).getByRole('switch').click()
    const ordinary = page.getByRole('spinbutton', { name: /Instance ordinary chatter/ })
    const scenery = page.getByRole('spinbutton', { name: /Instance screenshots/ })
    await expect.element(ordinary).toHaveAttribute('min', '0')
    await expect.element(ordinary).toHaveAttribute('max', '30')
    await expect.element(ordinary).toHaveAttribute('step', '1')
    await expect.element(scenery).toHaveAttribute('min', '0')
    await expect.element(scenery).toHaveAttribute('max', '60')
    expect(ordinary.element().closest('label')?.textContent).toContain('choose 2–30')
    expect(ordinary.element().closest('label')?.textContent).toContain('combat requirement still applies')
    expect(scenery.element().closest('label')?.textContent).toContain('from 0 to 60')
    await ordinary.fill('31')
    ordinary.element().blur()
    await expect.element(ordinary).toHaveValue(5)
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/instance-regular')).toBe('5')
    await ordinary.fill('0')
    ordinary.element().blur()
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/instance-regular')).toBe('0')
    await ordinary.fill('')
    ordinary.element().focus()
    await userEvent.keyboard('12')
    ordinary.element().blur()
    await expect.element(ordinary).toHaveValue(12)
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/instance-regular')).toBe('12')
    await scenery.fill('60')
    scenery.element().blur()
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/instance-scenery')).toBe('60')
  })

  it('sets an independent whole-number combat requirement and restores it after remount', async () => {
    const first = await mount()
    const normal = page.getByRole('region', { name: 'Ordinary chatter' })
    await expect.element(normal.getByText('Checks do not guarantee speech.', { exact: false })).toBeVisible()
    await expect.element(page.getByText('The interval uses real time, including combat.', { exact: false })).toBeVisible()
    await expect.element(page.getByText('10 seconds and has a suitable topic.', { exact: false })).toBeVisible()
    await expect.element(page.getByText('After an ordinary interaction, restart both the interval and combat count. Reconnecting keeps progress.', { exact: false })).toBeVisible()
    const slider = page.getByTestId('wow-regular-combats')
    slider.element().focus()
    await userEvent.keyboard('{Home}{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '6')
    await userEvent.keyboard('{End}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '30')
    await expect.element(slider).toHaveAttribute('aria-valuetext', '30 completed combats')
    await expect.poll(() => localStorage.getItem('settings/wow-chatter/combats-required')).toBe('30')
    await expect.element(page.getByTestId('wow-regular-interval')).toHaveAttribute('aria-valuenow', '5')
    await expect.element(page.getByTestId('wow-scenery-interval')).toHaveAttribute('aria-valuenow', '10')
    first.unmount()
    await mount()
    await expect.element(page.getByTestId('wow-regular-combats')).toHaveAttribute('aria-valuenow', '30')
  })

  it('opens memory management from ordinary chatter settings', async () => {
    const { router } = await mount()
    await page.getByRole('button', { name: 'View and manage memories', exact: true }).click()
    expect(router.currentRoute.value.path).toBe('/settings/wow-memories')
  })

  it.each([1, 5, 6, 60])('keeps both track regions and shows the quota warning only at %i minutes when needed', async (minutes) => {
    await mount()
    const slider = await moveScenerySlider(minutes)
    await expect.element(slider).toHaveAttribute('aria-valuemin', '1')
    await expect.element(slider).toHaveAttribute('aria-valuemax', '60')
    await expect.element(slider).toHaveAttribute('aria-valuetext', `${minutes} min`)
    const range = slider.element()
    const track = getComputedStyle(range).getPropertyValue('--track-background')
    expect(track).toContain('#dc2626')
    expect(track).toContain('#16a34a')
    expect(track).toContain(String(4 / 59 * 100))
    expect(getComputedStyle(range).getPropertyValue('--thumb-background')).toBe(minutes <= 5 ? '#dc2626' : '#15803d')
    if (minutes <= 5) {
      await expect.element(page.getByTestId('wow-scenery-quota-warning')).toHaveTextContent('Higher frequency can use your model quota faster.')
      await expect.element(slider).toHaveAttribute('aria-describedby', 'wow-scenery-quota-warning')
    }
    else {
      await expect.element(page.getByTestId('wow-scenery-quota-warning')).not.toBeInTheDocument()
      await expect.element(slider).not.toHaveAttribute('aria-describedby')
    }
  })

  it('lets the keyboard cross the five-minute warning boundary one minute at a time', async () => {
    await mount()
    const slider = await moveScenerySlider(5)
    await expect.element(page.getByTestId('wow-scenery-quota-warning')).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '6')
    await expect.element(page.getByTestId('wow-scenery-quota-warning')).not.toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '5')
    await expect.element(page.getByTestId('wow-scenery-quota-warning')).toBeVisible()
  })

  it('opens existing visual model settings without taking a screenshot', async () => {
    const { router } = await mount()
    await expect.element(page.getByText('Game images go to the current character\'s vision provider.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Configure vision model', exact: true }).click()
    expect(router.currentRoute.value.path).toBe('/settings/modules/vision')
  })

  it.each(['light', 'dark'])('keeps controls in a 375px Chinese viewport in %s mode', async (theme) => {
    const previousTheme = document.documentElement.classList.contains('dark')
    const previousBackground = document.body.style.backgroundColor
    const previousColor = document.body.style.color
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.style.backgroundColor = theme === 'dark' ? '#0a0a0a' : '#fafafa'
    document.body.style.color = theme === 'dark' ? '#f5f5f5' : '#171717'
    await page.viewport(375, 1000)
    onTestFinished(async () => {
      document.documentElement.classList.toggle('dark', previousTheme)
      document.body.style.backgroundColor = previousBackground
      document.body.style.color = previousColor
      await page.viewport(900, 720)
    })
    await mount('zh-Hans')
    await expect.element(page.getByRole('heading', { name: '闲聊设置', exact: true })).toBeVisible()
    const captureDirectory = import.meta.env.VITE_CHATTER_CAPTURE_DIR
    if (captureDirectory)
      await page.getByRole('region', { name: '普通闲聊', exact: true }).screenshot({ path: `${captureDirectory}/ordinary-375-${theme}.png` })
    await moveScenerySlider(5)
    await expect.element(page.getByTestId('wow-scenery-quota-warning')).toBeVisible()
    await page.getByRole('region', { name: '安静时段', exact: true }).getByRole('switch').click()
    await page.getByRole('region', { name: '按场景设置频率', exact: true }).getByRole('switch').click()
    await page.getByRole('region', { name: '主动模型调用预算', exact: true }).getByRole('switch').click()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
    if (captureDirectory) {
      await page.getByTestId('wow-chatter-settings').screenshot({ path: `${captureDirectory}/wow-chatter-375-${theme}.png` })
      await page.getByRole('region', { name: '主动模型调用预算', exact: true }).screenshot({ path: `${captureDirectory}/budget-375-${theme}.png` })
    }
  })
})

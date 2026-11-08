import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'

import SpeechCaptionBubble from './speech-caption-bubble.vue'

import { stageOpaqueAttribute } from '../../composables/use-stage-painted-mask'
import { i18n } from '../../modules/i18n'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

function renderCaption(initialText = '', width = 375, height = 600) {
  const text = ref(initialText)
  const stageWidth = ref(width)
  const screen = render(defineComponent({
    setup: () => () => h('div', {
      'data-testid': 'caption-stage',
      'style': {
        position: 'relative',
        width: `${stageWidth.value}px`,
        height: `${height}px`,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #c8d6df, #7d929e 60%, #374a5a)',
      },
    }, [
      h('button', {
        'aria-label': 'Game surface',
        'style': { position: 'absolute', inset: '0', width: '100%', height: '100%' },
      }),
      h(SpeechCaptionBubble, { text: text.value }),
    ]),
  }))
  return { screen, text, stageWidth }
}

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
})

describe('spoken caption bubble', () => {
  it.each(['en', 'zh-Hans'] as const)('shows an equipment notice in %s without desktop confirmation buttons', async (locale) => {
    const previousLocale = i18n.global.locale.value
    i18n.global.locale.value = locale
    onTestFinished(() => {
      i18n.global.locale.value = previousLocale
    })
    const text = i18n.global.t('wow-companion.equipment-prompt.message-player', { player: 'Mage', name: 'New robe', reason: '' })
    const { screen } = renderCaption(text)
    await expect.element(screen.getByRole('status')).toHaveTextContent('Mage')
    await expect.element(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Confirm the equipment change in the game.' : '请在游戏内确认换装。')
    expect(screen.getByRole('status').element().querySelector('button')).toBeNull()
    expect(getComputedStyle(screen.getByRole('status').element()).pointerEvents).toBe('none')
  })

  it('shows only the current sentence and disappears when its owner clears the text', async () => {
    const { screen, text } = renderCaption()
    expect(screen.getByRole('status').query()).toBeNull()

    text.value = '恭喜升级！继续向新的冒险出发吧。'
    await expect.element(screen.getByRole('status')).toHaveTextContent(text.value)

    text.value = '下一段语音已经开始。'
    await expect.element(screen.getByRole('status')).toHaveTextContent(text.value)
    expect(screen.getByRole('status').element().textContent).not.toContain('恭喜升级')

    text.value = ''
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    text.value = ' \n\t '
    await nextTick()
    expect(screen.getByRole('status').query()).toBeNull()
  })

  it('renders provider text literally without adding markup', async () => {
    const caption = '<img src=x onerror=alert(1)> <script>unsafe()</script>'
    const { screen } = renderCaption(caption)
    const bubble = screen.getByRole('status')
    await expect.element(bubble).toHaveTextContent(caption)
    expect(bubble.element().querySelector('script, img')).toBeNull()
    expect(bubble.element().querySelector('p')?.textContent?.trim()).toBe(caption)
  })

  it('leaves pointer hits with the surface below and marks the bubble and tail for ambient light', async () => {
    const { screen } = renderCaption('语音播报时，字幕不会拦截鼠标。')
    const bubble = screen.getByRole('status')
    await expect.element(bubble).toBeVisible()
    const element = bubble.element()
    const bounds = element.getBoundingClientRect()
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
    expect(hit).toBe(screen.getByRole('button', { name: 'Game surface' }).element())
    expect(getComputedStyle(element).pointerEvents).toBe('none')
    expect(element.hasAttribute(stageOpaqueAttribute)).toBe(true)
    expect(element.querySelector('span')?.hasAttribute(stageOpaqueAttribute)).toBe(true)
    expect(screen.getByTestId('caption-stage').element().hasAttribute(stageOpaqueAttribute)).toBe(false)
  })

  it.each([
    { width: 320, height: 500, dark: false },
    { width: 375, height: 600, dark: false },
    { width: 375, height: 600, dark: true },
    { width: 900, height: 720, dark: false },
    { width: 900, height: 720, dark: true },
  ])('keeps a full Chinese sentence inside a $width by $height stage in dark=$dark', async ({ width, height, dark }) => {
    await page.viewport(width, height)
    document.documentElement.classList.toggle('dark', dark)
    const caption = '恭喜你获得了新的装备！这件装备的装等有所提升，但套装效果和属性搭配也很重要。我们可以先看看它的主属性与次要属性，再决定是否替换。接下来的冒险也一起加油吧。'.repeat(2)
    const { screen } = renderCaption(caption, width, height)
    const bubble = screen.getByRole('status')
    await expect.element(bubble).toBeVisible()
    const element = bubble.element()
    const paragraph = element.querySelector('p')!
    const bounds = element.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(16)
    expect(bounds.right).toBeLessThanOrEqual(width - 16)
    expect(bounds.top).toBeGreaterThanOrEqual(64)
    expect(bounds.bottom + 6).toBeLessThanOrEqual(height - 16)
    expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.clientWidth + 1)
    expect(paragraph.scrollHeight).toBeLessThanOrEqual(paragraph.clientHeight + 1)
    expect(paragraph.textContent?.trim()).toBe(caption)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await screen.getByTestId('caption-stage').screenshot({ path: `__screenshots__/speech-caption-${width}-${dark ? 'dark' : 'light'}.png` })
  })

  it('wraps unbroken text when the character window becomes narrower', async () => {
    await page.viewport(900, 720)
    const caption = 'LongEquipmentName'.repeat(18)
    const { screen, stageWidth } = renderCaption(caption, 900, 720)
    await expect.element(screen.getByRole('status')).toBeVisible()
    stageWidth.value = 375
    await nextTick()
    const bubble = screen.getByRole('status').element()
    const paragraph = bubble.querySelector('p')!
    expect(bubble.getBoundingClientRect().right).toBeLessThanOrEqual(375)
    expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.clientWidth + 1)
    expect(paragraph.textContent?.trim()).toBe(caption)
  })
})

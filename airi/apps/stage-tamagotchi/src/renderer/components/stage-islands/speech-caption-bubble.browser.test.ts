import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'

import SpeechCaptionBubble from './speech-caption-bubble.vue'

import { stageOpaqueAttribute } from '../../composables/use-stage-painted-mask'
import { i18n } from '../../modules/i18n'
import { equipmentPromptActions } from '../../stores/wow-companion-equipment-prompt'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

type CaptionActions = NonNullable<InstanceType<typeof SpeechCaptionBubble>['$props']['actions']>

function renderCaption(initialText = '', width = 375, height = 600, initialActions?: CaptionActions) {
  const text = ref(initialText)
  const stageWidth = ref(width)
  const actions = ref(initialActions)
  const bubbleRef = ref<InstanceType<typeof SpeechCaptionBubble>>()
  const onChoose = vi.fn()
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
      h(SpeechCaptionBubble, { ref: bubbleRef, text: text.value, actions: actions.value, onChoose }),
    ]),
  }))
  return { screen, text, stageWidth, actions, onChoose, bubbleRef }
}

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
})

describe('spoken caption bubble', () => {
  it.each(['en', 'zh-Hans'] as const)('renders the desktop equipment choices and hint with real %s translations', async (locale) => {
    const previousLocale = i18n.global.locale.value
    i18n.global.locale.value = locale
    onTestFinished(() => {
      i18n.global.locale.value = previousLocale
    })
    const translate = (key: string): string => i18n.global.t(key)
    const prompt = { id: 'offer-localized', text: 'New equipment', phase: 'choosing' as const, deadline: Date.now() + 10_000 }
    const options = equipmentPromptActions(prompt, translate)
    const { screen, onChoose, actions } = renderCaption(prompt.text, 375, 600, options)
    const accept = locale === 'en' ? 'Yes' : '好'
    const decline = locale === 'en' ? 'No thanks' : '不用'
    await expect.element(screen.getByRole('button', { name: accept, exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: decline, exact: true })).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Choose within 10 seconds.' : '请在 10 秒内选择。')
    await expect.element(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Secondary-stat losses remain explicit.' : '每次换装均由你确认。')
    expect(screen.getByRole('status').element().textContent).not.toContain('wow-companion.')
    await screen.getByRole('button', { name: accept, exact: true }).click()
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(prompt.id, 'accept')
    actions.value = equipmentPromptActions({ ...prompt, phase: 'accepted' }, translate)
    await expect.element(screen.getByRole('button', { name: accept, exact: true })).not.toBeInTheDocument()
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

  it('offers choices only when the prompt owner supplies actions and reports their prompt id', async () => {
    const { screen, actions, onChoose } = renderCaption('A new item is available.')
    expect(screen.getByRole('button', { name: 'Yes', exact: true }).query()).toBeNull()

    actions.value = { id: 'offer-1', acceptLabel: 'Yes', declineLabel: 'No thanks', hint: 'Choose within 10 seconds.' }
    await screen.getByRole('button', { name: 'Yes', exact: true }).click()
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('offer-1', 'accept')

    actions.value = { ...actions.value, id: 'offer-2' }
    await screen.getByRole('button', { name: 'No thanks', exact: true }).click()
    expect(onChoose).toHaveBeenLastCalledWith('offer-2', 'decline')
    expect(onChoose).toHaveBeenCalledTimes(2)

    actions.value = undefined
    await expect.element(screen.getByRole('button', { name: 'Yes', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('status')).toHaveTextContent('A new item is available.')
  })

  it('passes text and gaps through while keeping each button clickable without a drag region', async () => {
    const { screen } = renderCaption('字幕保持鼠标穿透。', 375, 600, {
      id: 'offer-1',
      acceptLabel: '好',
      declineLabel: '不用',
      hint: '请在 10 秒内选择。',
    })
    const accept = screen.getByRole('button', { name: '好', exact: true })
    const decline = screen.getByRole('button', { name: '不用', exact: true })
    await expect.element(accept).toBeVisible()
    const acceptBounds = accept.element().getBoundingClientRect()
    const declineBounds = decline.element().getBoundingClientRect()
    const hitAccept = document.elementFromPoint(acceptBounds.left + acceptBounds.width / 2, acceptBounds.top + acceptBounds.height / 2)
    expect(hitAccept?.closest('button')).toBe(accept.element())
    expect(getComputedStyle(accept.element()).pointerEvents).toBe('auto')
    expect(acceptBounds.height).toBeGreaterThanOrEqual(28)
    expect(getComputedStyle(accept.element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(accept.element()).getPropertyValue('-webkit-app-region')).toBe('no-drag')

    const surface = screen.getByRole('button', { name: 'Game surface' }).element()
    const gapHit = document.elementFromPoint((acceptBounds.right + declineBounds.left) / 2, acceptBounds.top + acceptBounds.height / 2)
    expect(gapHit).toBe(surface)
    const textBounds = screen.getByRole('status').element().querySelector('p')!.getBoundingClientRect()
    expect(document.elementFromPoint(textBounds.left + textBounds.width / 2, textBounds.top + textBounds.height / 2)).toBe(surface)
  })

  it('exposes button bounds and focus only while the owner keeps the choices available', async () => {
    const { screen, actions, bubbleRef, onChoose } = renderCaption('新装备', 375, 600, {
      id: 'offer-1',
      acceptLabel: '好',
      declineLabel: '不用',
      hint: '请在 10 秒内选择。',
    })
    const accept = screen.getByRole('button', { name: '好', exact: true })
    await expect.element(accept).toBeVisible()
    expect(document.activeElement).not.toBe(accept.element())
    expect(bubbleRef.value?.acceptElement?.contains(accept.element())).toBe(true)
    accept.element().focus()
    await nextTick()
    expect(bubbleRef.value?.actionsFocused).toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('offer-1', 'accept')

    actions.value = { ...actions.value!, disabled: true }
    await expect.element(accept).toBeDisabled()
    ;(accept.element() as HTMLButtonElement).click()
    expect(onChoose).toHaveBeenCalledTimes(1)

    actions.value = undefined
    await nextTick()
    expect(bubbleRef.value?.actionsFocused).toBe(false)
    expect(bubbleRef.value?.acceptElement).toBeNull()
    expect(bubbleRef.value?.declineElement).toBeNull()
  })

  it.each([
    { width: 320, dark: false },
    { width: 375, dark: false },
    { width: 320, dark: true },
    { width: 375, dark: true },
  ])('keeps prompt choices and a literal item name inside a $width pixel stage in dark=$dark', async ({ width, dark }) => {
    await page.viewport(width, 600)
    document.documentElement.classList.toggle('dark', dark)
    const text = '恭喜获得<img src=x onerror=alert(1)>！新装备装等为 620，当前装备为 610。要换上这件装备吗？'
    const { screen } = renderCaption(text, width, 600, {
      id: 'offer-1',
      acceptLabel: '好',
      declineLabel: '不用',
      hint: '请在 10 秒内选择。不选择会关闭此提醒，换装仍需在游戏内确认。建议仅依据装等或空栏位，不代表属性、特效或套装的总收益更好。',
    })
    const bubble = screen.getByRole('status')
    await expect.element(screen.getByRole('button', { name: '不用', exact: true })).toBeVisible()
    expect(bubble.element().querySelector('img')).toBeNull()
    expect(bubble.element().getBoundingClientRect().right).toBeLessThanOrEqual(width - 16)
    expect(bubble.element().getBoundingClientRect().bottom + 6).toBeLessThanOrEqual(600)
    expect(bubble.element().scrollWidth).toBeLessThanOrEqual(bubble.element().clientWidth)
    await screen.getByTestId('caption-stage').screenshot({ path: `__screenshots__/speech-caption-prompt-${width}-${dark ? 'dark' : 'light'}.png` })
  })
})

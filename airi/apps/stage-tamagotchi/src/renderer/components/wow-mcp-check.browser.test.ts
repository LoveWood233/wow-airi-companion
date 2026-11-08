import type { streamText } from '@xsai/stream-text'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowMcpCheck from './wow-mcp-check.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const mocks = vi.hoisted(() => ({ list: vi.fn(), call: vi.fn(), stream: vi.fn(), speech: vi.fn() }))
vi.mock('@xsai/stream-text', () => ({ streamText: mocks.stream }))
vi.mock('@xsai/generate-speech', () => ({ generateSpeech: mocks.speech }))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event.receiveEvent?.id ?? ''
    if (id.includes('mcp:list-tools'))
      return mocks.list
    if (id.includes('mcp:call-tool'))
      return mocks.call
    throw new Error(`Unexpected invoke ${id}`)
  },
}))

const url = 'https://wuxianwow.com/item/12359'
const reply = `瑟银锭可用于制作。来源：无限图鉴 wuxianwow.com [瑟银锭](${url})`
type Request = Parameters<typeof streamText>[0]

function modelReply(text: string, invoke: boolean, failure?: Error) {
  mocks.stream.mockImplementation((options: Request) => {
    const done = (async () => {
      if (invoke) {
        const list = options.tools?.find(tool => tool.function.name === 'builtIn_mcpListTools')
        const call = options.tools?.find(tool => tool.function.name === 'builtIn_mcpCallTool')
        if (!list || !call)
          throw new Error('Missing acceptance tools')
        await list.execute({}, { messages: [], toolCallId: 'list' })
        await options.onEvent?.({ type: 'tool-call.done', toolCallId: 'search', toolCallType: 'function', toolName: call.function.name, args: JSON.stringify({ name: 'wuxianwow::search', arguments: JSON.stringify({ query: '瑟银锭' }) }) })
        await call.execute({ name: 'wuxianwow::search', arguments: '{"query":"瑟银锭"}' }, { messages: [], toolCallId: 'search' })
      }
      if (failure)
        throw failure
      await options.onEvent?.({ type: 'text.delta', delta: text })
    })()
    return { steps: done.then(() => []), messages: done.then(() => []), usage: Promise.resolve({}), totalUsage: Promise.resolve({}) }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('wow-companion/mcp-acceptance-v1')
  mocks.list.mockResolvedValue([{ name: 'wuxianwow::search', serverName: 'wuxianwow', toolName: 'search', inputSchema: { type: 'object' } }])
  mocks.call.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ url }] }) }] })
  modelReply(reply, true)
})

function mount(locale = 'en') {
  const pinia = createPinia()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#ffffff', color: dark ? '#e5e7eb' : '#171717' } }, h(WowMcpCheck)) })
  const screen = render(host, { global: { plugins: [pinia, createI18n({ legacy: false, locale, missingWarn: false, fallbackWarn: false, messages: { 'en': { 'wow-companion': parse(en) }, 'zh-Hans': { 'wow-companion': parse(zh) } } })] } })
  const config = useProviderConfigStore(pinia)
  config.ensureProvider('openai-compatible', 'openai-compatible', { apiKey: 'test-only', baseUrl: 'https://example.invalid/v1/' })
  const chat = useConsciousnessStore(pinia)
  chat.activeProvider = 'openai-compatible'
  chat.activeModel = 'test-model'
  const speech = useSpeechStore(pinia)
  speech.activeSpeechProvider = 'speech-noop'
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return { pinia, screen, chat, speech, config }
}

async function run() {
  await page.getByRole('button', { name: 'Start conversation check' }).click()
}

describe('mCP conversation acceptance', () => {
  it('sends nothing on mount and requires actual tool receipts before speech confirmation', async () => {
    mount()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.stream).not.toHaveBeenCalled()
    await run()
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Passed')
    await expect.element(page.getByTestId('mcp-tools')).toHaveTextContent('Passed')
    await expect.element(page.getByTestId('mcp-speech')).toHaveTextContent('Not checked')
    await expect.element(page.getByRole('link', { name: url })).toHaveAttribute('href', url)
    expect(mocks.call).toHaveBeenCalledWith({ name: 'wuxianwow::search', arguments: { query: '瑟银锭' } })
    const record = JSON.parse(localStorage.getItem('wow-companion/mcp-acceptance-v1') ?? '{}')
    expect(record.status).toBe('untested')
    expect(Object.keys(record).sort()).toEqual(['at', 'status'])
    await page.screenshot({ path: 'wow-mcp-check.png' })
  })

  it('rejects a model claim without execution', async () => {
    modelReply(reply, false)
    mount()
    await run()
    await expect.element(page.getByTestId('mcp-tools')).toHaveTextContent('Failed')
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Failed')
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('rejects invented links despite a successful query', async () => {
    modelReply(reply.replace('12359', '99999'), true)
    mount()
    await run()
    await expect.element(page.getByTestId('mcp-tools')).toHaveTextContent('Passed')
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Failed')
    await expect.element(page.getByRole('button', { name: 'Preview this answer' })).toBeDisabled()
  })

  it('preserves a successful tool stage when the later model answer fails', async () => {
    modelReply('', true, new Error('model disconnected'))
    mount()
    await run()
    await expect.element(page.getByTestId('mcp-tools')).toHaveTextContent('Passed')
    await expect.element(page.getByTestId('mcp-answer')).toHaveTextContent('Failed')
    expect(JSON.parse(localStorage.getItem('wow-companion/mcp-acceptance-v1') ?? '{}').status).toBe('failed')
  })

  it('cancels a pending connection and ignores its late result', async () => {
    const pending = Promise.withResolvers<unknown[]>()
    mocks.list.mockReturnValue(pending.promise)
    mount()
    await run()
    await expect.element(page.getByTestId('mcp-connection')).toHaveTextContent('In progress')
    await page.getByRole('button', { name: 'Cancel check' }).click()
    pending.resolve([{ name: 'wuxianwow::search', serverName: 'wuxianwow' }])
    await expect.element(page.getByTestId('mcp-connection')).toHaveTextContent('Not checked')
    expect(mocks.stream).not.toHaveBeenCalled()
    await expect.element(page.getByRole('button', { name: 'Start conversation check' })).toBeEnabled()
  })

  it('shows disconnected service failures without requesting the chat model', async () => {
    mocks.list.mockRejectedValue(new Error('offline'))
    mount()
    await run()
    await expect.element(page.getByTestId('mcp-connection')).toHaveTextContent('Failed')
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it('clears current evidence when the selected model changes', async () => {
    const { chat } = mount()
    await run()
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Passed')
    chat.activeModel = 'different-model'
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Not checked')
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })

  it('uses the selected voice and waits for confirmation after real browser playback', async () => {
    const bytes = new ArrayBuffer(1644)
    const data = new DataView(bytes)
    const ascii = (offset: number, text: string) => [...text].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)))
    ascii(0, 'RIFF')
    data.setUint32(4, 1636, true)
    ascii(8, 'WAVEfmt ')
    data.setUint32(16, 16, true)
    data.setUint16(20, 1, true)
    data.setUint16(22, 1, true)
    data.setUint32(24, 8000, true)
    data.setUint32(28, 16000, true)
    data.setUint16(32, 2, true)
    data.setUint16(34, 16, true)
    ascii(36, 'data')
    data.setUint32(40, 1600, true)
    mocks.speech.mockResolvedValue(bytes)
    const { speech, config } = mount()
    config.ensureProvider('openai-compatible-audio-speech', 'openai-compatible-audio-speech', { apiKey: 'test-only', baseUrl: 'https://example.invalid/v1/' })
    speech.activeSpeechProvider = 'openai-compatible-audio-speech'
    speech.activeSpeechModel = 'test-speech-model'
    speech.activeSpeechVoiceId = 'selected-voice'
    await run()
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('Passed')
    expect(mocks.speech).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Preview this answer' }).click()
    await expect.element(page.getByRole('button', { name: 'I heard it, pass check' })).toBeVisible()
    await expect.element(page.getByTestId('mcp-speech')).toHaveTextContent('Not checked')
    expect(mocks.speech).toHaveBeenCalledWith(expect.objectContaining({ voice: 'selected-voice', model: 'test-speech-model', input: expect.stringContaining('瑟银锭可用于制作') }))
    expect(JSON.parse(localStorage.getItem('wow-companion/mcp-acceptance-v1') ?? '{}').status).toBe('untested')
    await page.getByRole('button', { name: 'I heard it, pass check' }).click()
    await expect.element(page.getByTestId('mcp-speech')).toHaveTextContent('Passed')
    expect(JSON.parse(localStorage.getItem('wow-companion/mcp-acceptance-v1') ?? '{}').status).toBe('passed')
  })

  it('keeps Chinese actions and citations inside a narrow dark viewport', async () => {
    await page.viewport(390, 1000)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(1280, 720)
    })
    mount('zh-Hans')
    await page.getByRole('button', { name: '开始对话验收' }).click()
    await expect.element(page.getByTestId('mcp-sources')).toHaveTextContent('通过')
    const panel = page.getByTestId('wow-mcp-check').element()
    expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    await page.screenshot({ path: 'wow-mcp-check-zh-dark.png' })
  })
})

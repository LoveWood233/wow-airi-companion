import type { GenerationProvider } from '@proj-airi/provider-inference'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useModsServerChannelStore } from '@proj-airi/stage-ui/stores/mods/api/channel-server'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { toast } from 'vue-sonner'

import { wowMacroImport } from '../../../../shared/eventa/wow-macro-import'
import { i18n } from '../../../modules/i18n'
import { wowMacroImportTools } from './wow-macro-import'

const boundary = vi.hoisted(() => ({
  context: undefined as ReturnType<typeof createContext<unknown, { raw?: unknown }>> | undefined,
  invoke: vi.fn(),
}))
vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({
  createContext: () => ({ context: boundary.context }),
}))

function streamResponse(delta: Record<string, unknown>, finishReason = 'stop') {
  const chunk = { id: 'test-response', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: finishReason }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

// ROOT CAUSE:
// Rerunning a tool spread reactive history into a new transcript. A deep copy keeps later sends cloneable.
it('continues chatting after explicitly rerunning a macro tool without cloning reactive history', async () => {
  const modules = { consciousness: { provider: 'openai', model: 'test-model' }, vision: { provider: '', model: '' }, speech: { provider: '', model: '', voice_id: '' } }
  const saved = ['airi-cards', 'airi-card-module-defaults'].map(key => [key, localStorage.getItem(key)] as const)
  localStorage.setItem('airi-cards', JSON.stringify([['default', { name: 'Character', version: '1.0', extensions: { airi: { agents: {}, modules } } }]]))
  localStorage.setItem('airi-card-module-defaults', JSON.stringify(modules))
  vi.stubGlobal('electron', { ipcRenderer: {} })
  boundary.context = createContext<unknown, { raw?: unknown }>()
  boundary.invoke.mockReset().mockResolvedValue({ ok: false, code: 'focus-not-acquired' })
  defineInvokeHandler(boundary.context, wowMacroImport, boundary.invoke)

  const pinia = createPinia()
  const screen = await render(defineComponent({ setup() {
    useChatStore()
    return () => h('div')
  } }), { global: { plugins: [pinia, i18n] } })
  onTestFinished(() => {
    toast.dismiss('wow-macro-import')
    useModsServerChannelStore(pinia).dispose()
    useChatStore(pinia).dispose()
    screen.unmount()
    disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const [key, value] of saved) {
      if (value === null)
        localStorage.removeItem(key)
      else
        localStorage.setItem(key, value)
    }
  })
  const sessions = useChatSessionStore(pinia)
  await sessions.initialize()
  const sessionId = sessions.activeSessionId
  onTestFinished(() => sessions.deleteSession(sessionId))
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(streamResponse({ role: 'assistant', content: '你好。' }))
    .mockResolvedValueOnce(streamResponse({ role: 'assistant', tool_calls: [{ index: 0, id: 'macro-call', type: 'function', function: {
      name: 'wow_import_macro',
      arguments: JSON.stringify({ game: 'retail', body: '/targetexact 宏导入测试', call_summary: '导入测试宏', call_icon: ['code'] }),
    } }] }, 'tool_calls'))
    .mockImplementation(async () => streamResponse({ role: 'assistant', content: '请切回游戏后重试。' }))
  const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.test/', apiKey: 'test', fetch } }) }
  vi.spyOn(useConsciousnessStore(pinia), 'getChatProviderInstance').mockResolvedValue(provider)
  useLlmToolsStore(pinia).addTools(...(await wowMacroImportTools()).map(tool => ({ ...tool, id: 'test:macro' })))
  const chat = useChatStore(pinia)

  const first = await chat.send({ sessionId, text: '你好' })
  expect(() => structuredClone(first)).not.toThrow()
  await chat.send({ sessionId, text: '请将 /targetexact 宏导入测试 作为正式服自动导入，只保存，不执行。' })

  expect(boundary.invoke).toHaveBeenCalledTimes(1)
  expect(boundary.invoke).toHaveBeenCalledWith({ game: 'retail', body: '/targetexact 宏导入测试' }, expect.anything())
  expect(sessions.getSessionMessages(sessionId).filter(message => message.role === 'error')).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(3)

  const called = sessions.getSessionMessages(sessionId).find(message => message.role === 'assistant' && message.generationTranscript?.rounds.some(round => round.toolInvocations.length > 0))
  if (called?.role !== 'assistant')
    throw new Error('Expected the recorded macro call')
  await chat.rerunToolCall({ sessionId, messageId: called.id, toolCallId: 'macro-call', toolName: 'wow_import_macro', args: JSON.stringify({ game: 'retail', body: '/targetexact 宏导入测试' }) })
  await chat.send({ sessionId, text: '请继续帮我处理宏导入。' })
  expect(boundary.invoke).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenCalledTimes(4)
})

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

import { wowAddonsInstallRecommendation, wowAddonsRecommend } from '../../../../shared/eventa/wow-addons'
import { i18n } from '../../../modules/i18n'
import { wowAddonTools } from './wow-addons'

const boundary = vi.hoisted(() => ({ context: undefined as ReturnType<typeof createContext<unknown, { raw?: unknown }>> | undefined }))
vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({ createContext: () => ({ context: boundary.context }) }))

function response(delta: Record<string, unknown>, reason = 'stop') {
  const chunk = { id: 'test-response', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: reason }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

// Exercise the real chat SDK and Eventa adapter. Only the provider HTTP and desktop boundary are substituted.
it('queries CurseForge through a chat tool and returns five choices without installing before selection', async () => {
  const modules = { consciousness: { provider: 'openai', model: 'test-model' }, vision: { provider: '', model: '' }, speech: { provider: '', model: '', voice_id: '' } }
  const saved = ['airi-cards', 'airi-card-module-defaults'].map(key => [key, localStorage.getItem(key)] as const)
  localStorage.setItem('airi-cards', JSON.stringify([['default', { name: 'Character', version: '1.0', extensions: { airi: { agents: {}, modules } } }]]))
  localStorage.setItem('airi-card-module-defaults', JSON.stringify(modules))
  vi.stubGlobal('electron', { ipcRenderer: {} })
  boundary.context = createContext<unknown, { raw?: unknown }>()
  const report = { kind: 'wow-addon-recommendations', version: 1, id: 'test-report', game: 'retail', query: '背包', versionTypeId: 517, versionName: 'WoW Retail', createdAt: Date.now(), expiresAt: Date.now() + 600000, addons: [1, 2, 3, 4, 5].map(id => ({ id, name: `Bag ${id}`, summary: 'Inventory organization', downloadCount: 1000 - id, websiteUrl: `https://www.curseforge.com/wow/addons/bag-${id}`, relevance: 100, fileId: id * 100, fileVersion: '12.1.5', gameVersions: ['12.1.5'], installable: true, unavailableReason: null })) }
  const recommend = vi.fn().mockResolvedValue({ ok: true, data: report })
  const install = vi.fn()
  defineInvokeHandler(boundary.context, wowAddonsRecommend, recommend)
  defineInvokeHandler(boundary.context, wowAddonsInstallRecommendation, install)
  const pinia = createPinia()
  const screen = await render(defineComponent({ setup() {
    useChatStore()
    return () => h('div')
  } }), { global: { plugins: [pinia, i18n] } })
  onTestFinished(() => {
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
    .mockResolvedValueOnce(response({ role: 'assistant', tool_calls: [{ index: 0, id: 'addon-call', type: 'function', function: {
      name: 'wow_recommend_addons',
      arguments: JSON.stringify({ game: 'retail', query: '背包', call_summary: '查找背包插件', call_icon: ['search'] }),
    } }] }, 'tool_calls'))
    .mockResolvedValueOnce(response({ role: 'assistant', content: '已找到五项背包插件，请在推荐卡片中选择安装。' }))
  const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.test/', apiKey: 'test', fetch } }) }
  vi.spyOn(useConsciousnessStore(pinia), 'getChatProviderInstance').mockResolvedValue(provider)
  useLlmToolsStore(pinia).addTools(...(await wowAddonTools()).map(tool => ({ ...tool, id: 'test:addons' })))
  await useChatStore(pinia).send({ sessionId, text: '给我推荐正式服的背包插件' })
  expect(recommend).toHaveBeenCalledExactlyOnceWith({ game: 'retail', query: '背包' }, expect.anything())
  expect(install).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
  const followup = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))
  const result = followup.messages.find((message: { role: string }) => message.role === 'tool')
  expect(JSON.parse(result.content).addons).toHaveLength(5)
  expect(sessions.getSessionMessages(sessionId).filter(message => message.role === 'error')).toEqual([])
})

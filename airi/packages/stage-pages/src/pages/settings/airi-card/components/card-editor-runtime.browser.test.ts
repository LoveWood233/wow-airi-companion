import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import CardEditor from './CardEditor.vue'

import 'virtual:uno.css'

const piniaInstances: ReturnType<typeof createPinia>[] = []
afterEach(() => {
  cleanup()
  piniaInstances.splice(0).forEach(pinia => disposePinia(pinia))
  localStorage.clear()
})

it.each([true, false])('keeps persona editing while avatar-model capability is %s', async (enabled) => {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  useSettingsStageModel(pinia).setRuntimeEnabled(enabled)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const screen = await render(CardEditor, {
    props: { initialSection: 'identity' },
    global: { plugins: [pinia, PiniaColada, i18n, router] },
  })
  expect(screen.getByText(i18n.global.t('settings.pages.card.body-model'), { exact: true }).elements()).toHaveLength(enabled ? 1 : 0)
  expect(screen.getByText(i18n.global.t('settings.pages.card.creation.name'), { exact: false }).elements().length).toBeGreaterThan(0)
  expect(screen.getByText(i18n.global.t('settings.pages.card.creation.nickname'), { exact: true }).elements()).toHaveLength(1)
})

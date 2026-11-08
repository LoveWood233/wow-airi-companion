import type { BridgeStatus } from '../../shared/wow-companion'

import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowConnectionStatus from './wow-connection-status.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

function bridge(): BridgeStatus {
  return {
    instanceId: 'test',
    source: 'screen',
    status: 'waiting',
    snapshot: null,
    lastSeen: null,
    ageSeconds: null,
    calendar: null,
    groupBuff: null,
    eventCursor: 0,
    events: [],
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    inventory: null,
    inventoryReceivedAt: null,
    inventoryError: null,
    quests: null,
    questsReceivedAt: null,
    questsError: null,
    talents: null,
    talentsReceivedAt: null,
    talentsError: null,
    config: { x: 8, y: 8, cellSize: 1, pollMs: 100, paused: false },
    error: null,
    connection: { phase: 'validating', reason: null, attempts: 1, consecutive: 2, lastFrameAt: '2026-10-31T12:00:00Z', calibratedAt: null, retrySeconds: 0, calibration: null },
    transfers: [{ kind: 'gear', phase: 'receiving', received: 3, total: 10, elapsedSeconds: 2, timeoutSeconds: 1200 }],
  }
}

function mount(value = bridge(), enabled = true, locale = 'en') {
  const retry = vi.fn()
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: locale === 'en' ? '#fff' : '#171717', color: locale === 'en' ? '#171717' : '#eee' } }, h(WowConnectionStatus, { bridge: value, enabled, busy: false, onRetry: retry })) })
  const screen = render(host, { global: { plugins: [createI18n({ legacy: false, locale, messages: { 'en': { 'wow-companion': parse(en) }, 'zh-Hans': { 'wow-companion': parse(zh) } } })] } })
  onTestFinished(() => screen.unmount())
  return retry
}

it('shows actual heartbeat and unique-fragment counts and emits an explicit retry', async () => {
  const retry = mount()
  await expect.element(page.getByRole('progressbar', { name: 'Heartbeat confirmation' })).toHaveAttribute('aria-valuenow', '2')
  await expect.element(page.getByRole('progressbar', { name: 'Equipped-item snapshot' })).toHaveAttribute('aria-valuenow', '3')
  await page.getByRole('button', { name: 'Relocate and retry reception' }).click()
  expect(retry).toHaveBeenCalledOnce()
})

it('explains a verified minimized window without guessing about addon installation', async () => {
  const value = bridge()
  value.connection!.phase = 'blocked'
  value.connection!.reason = 'window-minimized'
  mount(value)
  await expect.element(page.getByText('The game window is minimized. Restore it to resume reading.')).toBeVisible()
})

it.each(['demo', 'paused', 'disabled'] as const)('keeps retry inactive in %s mode', async (mode) => {
  const value = bridge()
  if (mode === 'demo')
    value.source = 'demo'
  if (mode === 'paused')
    value.config.paused = true
  const retry = mount(value, mode !== 'disabled')
  await expect.element(page.getByRole('button', { name: 'Relocate and retry reception' })).toBeDisabled()
  expect(retry).not.toHaveBeenCalled()
})

it('does not turn expired heartbeats into an active connection', async () => {
  const value = bridge()
  value.connection!.phase = 'connected'
  value.connection!.consecutive = 3
  value.status = 'stale'
  mount(value)
  await expect.element(page.getByText('Character heartbeat expired', { exact: true })).toBeVisible()
})

it('keeps partial timeout progress distinct from completion', async () => {
  const value = bridge()
  value.transfers![0].phase = 'timed-out'
  mount(value)
  await expect.element(page.getByText('Timed out, incomplete data discarded', { exact: false })).toBeVisible()
  await expect.element(page.getByRole('progressbar', { name: 'Equipped-item snapshot' })).toHaveAttribute('aria-valuenow', '3')
})

it('keeps diagnostics readable in a narrow Chinese dark window', async () => {
  await page.viewport(390, 1000)
  document.documentElement.classList.add('dark')
  onTestFinished(async () => {
    document.documentElement.classList.remove('dark')
    await page.viewport(1280, 720)
  })
  mount(bridge(), true, 'zh-Hans')
  await expect.element(page.getByRole('heading', { name: '连接诊断与接收进度' })).toBeVisible()
  const panel = page.getByTestId('wow-connection-status').element()
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
  await page.getByTestId('wow-connection-status').screenshot({ path: 'wow-connection-status-zh-dark.png' })
})

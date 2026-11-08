import type { Component } from 'vue'

import type { CompanionState } from '../../shared/wow-companion'

import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import en from '../../../../../packages/i18n/src/locales/en/wow-professions.yaml?raw'
import zh from '../../../../../packages/i18n/src/locales/zh-Hans/wow-professions.yaml?raw'
import priceItem from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-price-item.json'
import recipeBatch from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-recipe-batch.json'
import recipePrep from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-recipe-jsonld.json'
import route from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-route-engineering.json'
import WowProfessionsPage from '../pages/settings/wow-professions.vue'
import WowProfessions from './wow-professions.vue'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { useWowCompanionStore } from '../stores/wow-companion'
import { useWowProfessionsStore } from '../stores/wow-professions'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ state: vi.fn(), list: vi.fn(), call: vi.fn() }))
const triggerRecipe = {
  outcome: 'ok',
  id: 'recipe:6863',
  title: '不牢固的扳机',
  url: 'https://wuxianwow.com/recipe/6863',
  metadata: {
    id: 'recipe:6863',
    kind: 'recipe',
    recipe_id: 6863,
    profession: '工程学',
    reagents: [{ item_id: 3860, name: '秘银锭', count: 1 }, { item_id: 4338, name: '魔纹布', count: 1 }, { item_id: 10505, name: '实心炸药', count: 1 }],
    products: [{ item_id: 10560, name: '不牢固的扳机', count: 1 }],
  },
}
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event.receiveEvent?.id
    if (id === 'eventa:invoke:wow-companion:get-receive')
      return ipc.state
    if (id === 'eventa:invoke:electron:mcp:list-tools-receive')
      return ipc.list
    if (id === 'eventa:invoke:electron:mcp:call-tool-receive')
      return ipc.call
    return async () => {
      throw new Error(`Unexpected IPC ${id}`)
    }
  },
}))

let state: CompanionState

function reply(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  state = loadoutStateFixture()
  state.game = 'forever'
  if (state.bridge?.snapshot)
    state.bridge.snapshot.level = 30
  ipc.state.mockImplementation(async (request: { game: string }) => request.game === 'forever' ? structuredClone(state) : loadoutStateFixture())
  ipc.list.mockResolvedValue(['search', 'fetch', 'leveling_route', 'auction_house', 'stats'].map(name => ({ name: `wuxianwow::${name}`, toolName: name, serverName: 'wuxianwow', inputSchema: {} })))
  ipc.call.mockImplementation(async (payload: { name: string, arguments?: Record<string, unknown> }) => {
    if (payload.name === 'wuxianwow::stats')
      return reply({ outcome: 'ok', product: 'wowf', build: '1.60.1.70707' })
    if (payload.name === 'wuxianwow::search')
      return reply({ outcome: 'ok', total: 1, results: [{ id: recipeBatch.id, title: recipeBatch.title, url: recipeBatch.url, kind: 'recipe' }] })
    if (payload.name === 'wuxianwow::fetch' && payload.arguments?.id === 'recipe:6866')
      return reply(recipeBatch)
    if (payload.name === 'wuxianwow::fetch' && payload.arguments?.id === 'recipe:6858')
      return reply(recipePrep)
    if (payload.name === 'wuxianwow::fetch' && payload.arguments?.id === 'recipe:6863')
      return reply(triggerRecipe)
    if (payload.name === 'wuxianwow::leveling_route')
      return reply(route)
    if (payload.name === 'wuxianwow::auction_house')
      return reply(priceItem)
    throw new Error(`Unexpected query ${payload.name}`)
  })
})

async function mount(locale = 'en', component: Component = WowProfessions) {
  const pinia = createPinia()
  const dark = document.documentElement.classList.contains('dark')
  const host = defineComponent({ setup: () => () => h('main', { style: { padding: '16px', background: dark ? '#171717' : '#ffffff', color: dark ? '#e5e5e5' : '#171717' } }, h(component)) })
  const screen = render(host, { global: { plugins: [pinia, createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-professions': parse(en) }, 'zh-Hans': { 'wow-professions': parse(zh) } } })] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  await expect.poll(() => useWowCompanionStore(pinia).profiles.forever.loaded).toBe(true)
  return { screen, planner: useWowProfessionsStore(pinia) }
}

async function addRecipe() {
  await page.getByRole('textbox', { name: 'Recipe name' }).fill('高速秘银弹头')
  await page.getByRole('button', { name: 'Find recipes', exact: true }).click()
  await page.getByRole('button', { name: 'Add to plan', exact: true }).click()
  await expect.element(page.getByTestId('profession-material-3860')).toBeVisible()
}

function useCompleteInventory() {
  if (!state.bridge?.snapshot)
    throw new Error('Missing character fixture')
  state.bridge.inventory = { v: 1, id: 1, session: state.bridge.snapshot.session, guid: state.bridge.snapshot.guid, observedAt: Math.floor(Date.now() / 1000), source: 'bags', bank: 'unknown', complete: true, items: [{ itemID: 3860, quantity: 1 }] }
  state.bridge.inventoryReceivedAt = new Date().toISOString()
}

describe('profession material planning with real Pinia stores', () => {
  it('reads local inventory on entry and sends no database query while a search is only a draft', async () => {
    await mount()
    await expect.element(page.getByTestId('profession-inventory-status')).toHaveTextContent('No current complete bag snapshot')
    await expect.element(page.getByText('Bank contents are unknown. Enter any additional materials below.', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Recipe name' }).fill('new draft')
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
    await expect.element(page.getByRole('button', { name: 'Estimate purchase cost', exact: true })).toBeDisabled()
  })

  it('uses an actual recipe record, applies bag stock once, and keeps additional input distinct from consumed stock', async () => {
    useCompleteInventory()
    const { planner } = await mount()
    await addRecipe()
    await expect.element(page.getByTestId('profession-inventory-status')).toHaveTextContent('complete bag snapshot')
    await page.getByRole('spinbutton', { name: 'Craft count · 高速秘银弹头', exact: true }).fill('3')
    await expect.poll(() => planner.plan?.materials.find(item => item.itemId === 3860)?.missing).toBe(2)
    await page.getByRole('spinbutton', { name: 'Additional quantity · 秘银锭' }).fill('10')
    await expect.poll(() => planner.plan?.materials.find(item => item.itemId === 3860)?.missing).toBe(0)
    await expect.element(page.getByRole('spinbutton', { name: 'Additional quantity · 秘银锭' })).toHaveValue(10)
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.owned).toBe(1)
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.manual).toBe(2)
    await expect.element(page.getByRole('link', { name: 'Recipe source · 高速秘银弹头', exact: true })).toHaveAttribute('href', recipeBatch.url)
    expect(ipc.call.mock.calls.some(([payload]) => payload.name === 'wuxianwow::auction_house')).toBe(false)
    await page.getByRole('button', { name: 'Clear additional quantities', exact: true }).click()
    await expect.poll(() => planner.plan?.materials.find(item => item.itemId === 3860)?.missing).toBe(2)
  })

  it('distinguishes finished products from crafts and rounds a 201-item target up to two 200-item crafts', async () => {
    const { planner } = await mount()
    await addRecipe()
    await page.getByRole('button', { name: 'Finished item count', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Finished item count · 高速秘银弹头', exact: true }).fill('201')
    await expect.poll(() => planner.plan?.steps[0]?.crafts).toBe(2)
    expect(planner.plan?.products.find(item => item.itemId === 10512)?.count).toBe(400)
    await expect.element(page.getByText('Need at most', { exact: true }).first()).toBeVisible()
    await expect.element(page.getByTestId('profession-material-3860')).toHaveTextContent('Unknown')
    await page.getByRole('button', { name: 'Copy list', exact: true }).click()
    await expect.element(page.getByText('Material list copied.', { exact: true })).toBeVisible()
  })

  it('leaves incomplete bag observations explicit and never reports a confirmed material shortage', async () => {
    useCompleteInventory()
    if (!state.bridge?.inventory)
      throw new Error('Missing inventory fixture')
    state.bridge.inventory.complete = false
    await mount()
    await addRecipe()
    await expect.element(page.getByTestId('profession-inventory-status')).toHaveTextContent('incomplete')
    await expect.element(page.getByText('Bag contents are unknown. Missing quantities cannot be confirmed.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Applied known bags', { exact: true }).first()).toBeVisible()
  })

  it('updates missing materials from read-only inventory polling without querying recipes again', async () => {
    useCompleteInventory()
    const { planner } = await mount()
    await addRecipe()
    planner.setRecipeQuantity('recipe:6866', 2)
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.missing).toBe(1)
    const calls = ipc.call.mock.calls.length
    if (!state.bridge?.inventory)
      throw new Error('Missing inventory fixture')
    state.bridge.inventory.id = 2
    state.bridge.inventory.items = [{ itemID: 3860, quantity: 2 }]
    await expect.poll(() => planner.plan?.materials.find(item => item.itemId === 3860)?.missing).toBe(0)
    expect(ipc.call).toHaveBeenCalledTimes(calls)
  })

  it('stops treating the retained live snapshot as current inventory when bridge polling fails', async () => {
    useCompleteInventory()
    const { planner } = await mount()
    await addRecipe()
    ipc.state.mockImplementation(async (request: { game: string }) => {
      if (request.game === 'forever')
        throw new Error('Bridge disconnected')
      return loadoutStateFixture()
    })
    await expect.element(page.getByTestId('profession-inventory-status')).toHaveTextContent('No current complete bag snapshot')
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.missingKind).toBe('upper-bound')
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.owned).toBe(0)
  })

  it('ignores bag quantities when the Forever companion profile is disabled', async () => {
    useCompleteInventory()
    const { planner } = await mount()
    await addRecipe()
    state.settings.enabled = false
    await expect.element(page.getByTestId('profession-inventory-status')).toHaveTextContent('No current complete bag snapshot')
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.missingKind).toBe('upper-bound')
    expect(planner.plan?.materials.find(item => item.itemId === 3860)?.owned).toBe(0)
  })

  it('requests prices only on demand and preserves raw collection labels and market warnings', async () => {
    await mount()
    await addRecipe()
    await page.getByRole('button', { name: 'Estimate purchase cost', exact: true }).click()
    await expect.element(page.getByText('Price collection: 北京时间 2026-10-26 16:49', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Market scope: CAMWOW CN5 Realm 3 PvP · 联盟拍卖行', { exact: true })).toBeVisible()
    await expect.element(page.getByText('This estimate uses the listed market snapshot. Its realm and faction do not establish applicability to your character.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Some materials have no usable price. The subtotal is not the complete cost.', { exact: true })).toBeVisible()
    expect(ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::auction_house')).toHaveLength(2)
  })

  it('builds an explicit skill-range plan and keeps route queries out of draft editing', async () => {
    const { planner } = await mount()
    await page.getByRole('button', { name: 'Profession leveling', exact: true }).click()
    await page.getByRole('textbox', { name: 'Profession' }).fill('工程学')
    await page.getByRole('spinbutton', { name: 'Current skill' }).fill('150')
    await page.getByRole('spinbutton', { name: 'Target skill', exact: true }).fill('175')
    expect(ipc.call).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Build leveling plan', exact: true }).click()
    await expect.poll(() => planner.plan?.steps[0]?.name).toBe('实心炸药')
    await expect.element(page.getByTestId('profession-material-7912')).toBeVisible()
    await expect.element(page.getByText('Skill 150–175', { exact: false })).toBeVisible()
    await expect.element(page.getByText('Required character level: 20', { exact: false })).toBeVisible()
    await expect.element(page.getByText('Level requirement assumed from original rules', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Calculation assumptions', exact: true }).click()
    await expect.element(page.getByText(route.method.counting, { exact: true })).toBeVisible()
    expect(ipc.call).toHaveBeenCalledWith({ name: 'wuxianwow::leveling_route', arguments: { profession: '工程学', from_skill: 150, route: 'free', section: 'all' } })
  })

  it('keeps the displayed route and material plan when another route is submitted during a pending price request', async () => {
    const { planner } = await mount()
    planner.mode = 'leveling'
    planner.profession = '工程学'
    planner.fromSkill = 150
    planner.toSkill = 175
    await planner.loadRoute()
    const previousPlan = structuredClone(JSON.parse(JSON.stringify(planner.plan)))
    const previousRoute = structuredClone(JSON.parse(JSON.stringify(planner.route)))
    const routes = ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::leveling_route').length
    const pending = Promise.withResolvers<ReturnType<typeof reply>>()
    onTestFinished(() => pending.resolve(reply(priceItem)))
    ipc.call.mockImplementationOnce(() => pending.promise)
    await page.getByRole('button', { name: 'Estimate purchase cost', exact: true }).click()
    await expect.poll(() => planner.budgetLoading).toBe(true)
    await page.getByRole('button', { name: 'Build leveling plan', exact: true }).click()
    expect(planner.plan).toEqual(previousPlan)
    expect(planner.route).toEqual(previousRoute)
    expect(ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::leveling_route')).toHaveLength(routes)
    await expect.element(page.getByTestId('profession-material-7912')).toBeVisible()
    pending.resolve(reply(priceItem))
    await expect.poll(() => planner.budgetLoading).toBe(false)
  })

  it('accepts additional intermediate stock even when that material does not appear in the purchase list', async () => {
    const { planner } = await mount()
    planner.mode = 'leveling'
    planner.profession = '工程学'
    planner.fromSkill = 150
    planner.toSkill = 205
    await planner.loadRoute()
    expect(planner.plan?.materials.some(item => item.itemId === 10505)).toBe(false)
    const rawBefore = planner.plan?.materials.find(item => item.itemId === 7912)?.required ?? 0
    const prepBefore = planner.plan?.steps.filter(step => step.recipeId === 6858 && step.prep).reduce((total, step) => total + step.crafts, 0) ?? 0
    expect(prepBefore).toBeGreaterThan(0)
    await page.getByRole('combobox', { name: 'Related material' }).click()
    await page.getByRole('option', { name: '实心炸药 · #10505', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Additional stock total' }).fill('5')
    await page.getByRole('button', { name: 'Save additional stock', exact: true }).click()
    await expect.poll(() => planner.manualMaterials.find(item => item.itemID === 10505)?.quantity).toBe(5)
    const prepAfter = planner.plan?.steps.filter(step => step.recipeId === 6858 && step.prep).reduce((total, step) => total + step.crafts, 0) ?? 0
    expect(prepAfter).toBeLessThan(prepBefore)
    expect(planner.plan?.materials.find(item => item.itemId === 7912)?.required).toBeLessThan(rawBefore)
    await page.getByRole('button', { name: 'Remove additional stock · 实心炸药', exact: true }).click()
    await expect.poll(() => planner.plan?.materials.find(item => item.itemId === 7912)?.required).toBe(rawBefore)
  })

  it('does not show a previous character market failure after a new character snapshot arrives', async () => {
    const { planner } = await mount()
    await addRecipe()
    const pending = Promise.withResolvers<unknown[]>()
    ipc.list.mockReturnValueOnce(pending.promise)
    await page.getByRole('button', { name: 'Estimate purchase cost', exact: true }).click()
    await expect.poll(() => planner.budgetLoading).toBe(true)
    if (!state.bridge?.snapshot)
      throw new Error('Missing character fixture')
    state.bridge.snapshot.guid = 'Player-2'
    state.bridge.snapshot.session = 'second-login'
    await expect.poll(() => useWowCompanionStore().profiles.forever.state.bridge?.snapshot?.guid).toBe('Player-2')
    pending.reject(new Error('Previous character market query failed'))
    await expect.poll(() => planner.budgetLoading).toBe(false)
    expect(planner.errorCode).toBeNull()
  })

  it('distinguishes a cached recipe read from its original source query time', async () => {
    const { planner } = await mount()
    await page.getByRole('textbox', { name: 'Recipe name' }).fill('高速秘银弹头')
    await page.getByRole('button', { name: 'Find recipes', exact: true }).click()
    const cache = { status: 'hit', sourceReceivedAt: '2026-11-01T05:00:00.000Z', storedAt: '2026-11-01T05:00:01.000Z', servedAt: '2026-11-01T05:05:00.000Z', expiresAt: '2026-11-02T05:00:01.000Z' }
    ipc.call.mockResolvedValueOnce({ ...reply(recipeBatch), cache, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt: cache.sourceReceivedAt } })
    await page.getByRole('button', { name: 'Add to plan', exact: true }).click()
    await expect.element(page.getByText('Read from query cache', { exact: true })).toBeVisible()
    expect(planner.sourceEvidence?.receivedAt).toBe(cache.sourceReceivedAt)
    expect(planner.sourceEvidence?.cache?.servedAt).toBe(cache.servedAt)
    await expect.element(page.getByText(/^Original source query:/)).toBeVisible()
    await expect.element(page.getByText(/^Cache expires:/)).toBeVisible()
  })

  it('shows empty results and connection failures without calling a model', async () => {
    await mount()
    ipc.call.mockResolvedValueOnce(reply({ outcome: 'ok', results: [], total: 0 }))
    await page.getByRole('textbox', { name: 'Recipe name' }).fill('unknown recipe')
    await page.getByRole('button', { name: 'Find recipes', exact: true }).click()
    await expect.element(page.getByText('No matching recipes. Try another name.', { exact: true })).toBeVisible()
    ipc.list.mockRejectedValueOnce(new Error('offline'))
    await page.getByRole('button', { name: 'Find recipes', exact: true }).click()
    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Find recipes', exact: true })).toBeEnabled()
  })

  it('handles validated recipe links through the real router and ignores malformed or repeated identifiers', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/wow-professions', component: WowProfessionsPage }] })
    await router.push('/settings/wow-professions?recipe=not-a-recipe')
    await router.isReady()
    const screen = render(RouterView, { global: { plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en: { 'wow-professions': parse(en) } } })] } })
    onTestFinished(() => {
      screen.unmount()
      disposePinia(pinia)
    })
    await expect.poll(() => useWowCompanionStore(pinia).profiles.forever.loaded).toBe(true)
    expect(ipc.call).not.toHaveBeenCalled()
    await router.push('/settings/wow-professions?recipe=recipe:6866')
    await expect.element(page.getByTestId('profession-material-3860')).toBeVisible()
    expect(ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::fetch')).toHaveLength(1)
    await router.push('/settings/wow-professions?recipe=recipe:6866&from=chat')
    await expect.element(page.getByTestId('profession-material-3860')).toBeVisible()
    expect(ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::fetch')).toHaveLength(1)
    await router.push('/settings/wow-professions?recipe=spell:6866')
    expect(ipc.call.mock.calls.filter(([payload]) => payload.name === 'wuxianwow::fetch')).toHaveLength(1)
  })

  it('keeps the Chinese dark layout readable at a narrow viewport', async () => {
    await page.viewport(375, 600)
    document.documentElement.classList.add('dark')
    onTestFinished(async () => {
      document.documentElement.classList.remove('dark')
      await page.viewport(900, 720)
    })
    const { planner } = await mount('zh-Hans')
    planner.query = '高速秘银弹头'
    await planner.searchRecipes()
    await planner.addRecipe('recipe:6866')
    await planner.estimateBudget()
    await expect.element(page.getByTestId('profession-material-3860')).toBeVisible()
    await expect.element(page.getByText('价格采集时间：北京时间 2026-10-26 16:49', { exact: true })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await page.viewport(375, 900)
    await page.getByRole('region', { name: '可选采购估价', exact: true }).screenshot({ path: 'wow-professions-budget-zh-dark.png' })
  })
})

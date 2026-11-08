import type { ItemStorageQuery, ItemStorageQueryResult, ItemStorageRow, ItemStorageSummary } from '../../shared/wow-companion-item-storage'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import enMessages from '../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowCompanionItemStorage from './wow-companion-item-storage.vue'

import { useWowItemStorageStore } from '../stores/wow-companion-item-storage'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ query: vi.fn(), clear: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async original => ({
  ...await original<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke(event: { receiveEvent?: { id?: string } }) {
    if (event.receiveEvent?.id === 'eventa:invoke:wow-item-storage:query-receive')
      return ipc.query
    if (event.receiveEvent?.id === 'eventa:invoke:wow-item-storage:clear-receive')
      return ipc.clear
    throw new Error(`Unexpected inventory IPC ${event.receiveEvent?.id}`)
  },
}))

function summary(): ItemStorageSummary {
  return {
    characters: [
      { account: 'account-1', guid: 'Player-1', name: 'Mage', realm: 'Azeroth', bags: 2, bank: 0, bankObservedAt: null, incomplete: true, equipmentItems: 1, professionItems: 1 },
      { account: 'account-2', guid: 'Player-2', name: 'Hunter', realm: 'Kalimdor', bags: 1, bank: 3, bankObservedAt: 1793692800000, incomplete: false, equipmentItems: 1, professionItems: 0 },
    ],
    sharedBankItems: 0,
    sharedBankObservedAt: null,
    storageError: null,
    transferError: null,
    fileName: 'wow-companion-items.sqlite',
  }
}

function row(name = 'Forged blade', fields: Partial<ItemStorageRow> = {}): ItemStorageRow {
  return {
    game: 'retail',
    account: 'account-1',
    guid: 'Player-1',
    name: 'Mage',
    realm: 'Azeroth',
    scope: 'bags',
    container: 0,
    slot: 1,
    quantity: 1,
    craftingOrigin: 'unknown',
    observedAt: 1793692800000,
    receivedAt: 1793692801000,
    cached: false,
    uncertain: false,
    complete: true,
    category: 'equipment',
    item: {
      itemID: 123,
      itemGUID: 'Item-123',
      link: '|Hitem:123::::::::|h[Forged blade]|h',
      name,
      type: 'Weapon',
      subtype: 'Sword',
      equipLoc: 'INVTYPE_WEAPON',
      quality: 2,
      itemLevel: 80,
      requiredLevel: 70,
      stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 12 }],
      tooltip: ['Grants strength.'],
      infoComplete: true,
      statsComplete: true,
      tooltipComplete: true,
      truncated: false,
      classID: 2,
      subclassID: 7,
    },
    ...fields,
  }
}

function result(rows: ItemStorageRow[] = [row()], fields: Partial<ItemStorageQueryResult> = {}): ItemStorageQueryResult {
  return { rows, total: rows.length, offset: 0, limit: 50, storageError: null, ...fields }
}

async function mount(locale = 'en') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } } })
  const screen = await render(WowCompanionItemStorage, { props: { game: 'retail', summary: summary() }, global: { plugins: [pinia, i18n] } })
  onTestFinished(() => {
    screen.unmount()
    disposePinia(pinia)
  })
  return { screen, storage: useWowItemStorageStore(pinia) }
}

beforeEach(() => {
  vi.resetAllMocks()
  ipc.query.mockResolvedValue(result())
  ipc.clear.mockResolvedValue(undefined)
})

describe('sQLite bag and bank item browser', () => {
  it('keeps an unopened bank unknown and waits for an explicit browse before querying', async () => {
    await mount()
    await expect.element(page.getByText('Bag item slots: 2 · Bank item slots: Not scanned', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Shared bank slots across recorded accounts: Not scanned', { exact: true })).toBeVisible()
    await expect.element(page.getByText('SQLite database: wow-companion-items.sqlite', { exact: true })).toBeVisible()
    expect(ipc.query).not.toHaveBeenCalled()
  })

  it('reads one bounded page and reveals saved attributes without interpreting item text as markup', async () => {
    const item = row()
    item.item.tooltip.push('<img src=x onerror=alert(1)>')
    ipc.query.mockResolvedValue(result([item]))
    await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls).toEqual([[{ game: 'retail', limit: 50, offset: 0, category: 'all' }]])
    await expect.element(page.getByRole('heading', { name: 'Forged blade', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Item attributes and effects', exact: true }).click()
    await expect.element(page.getByText('Grants strength.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('img')).not.toBeInTheDocument()
  })

  it('binds a character to its account and uses account scope for the shared bank', async () => {
    await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await page.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: 'Mage · Azeroth', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0]).toMatchObject({ game: 'retail', account: 'account-1', guid: 'Player-1', offset: 0 })
    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Account shared bank', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0]).toEqual({ game: 'retail', account: 'account-1', scope: 'account-bank', category: 'all', offset: 0, limit: 50 })
    await page.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Professions', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0].category).toBe('profession')
  })

  it('applies searches only on submit and pages without losing the active search', async () => {
    ipc.query.mockImplementation(async (input: ItemStorageQuery) => {
      const offset = input.offset ?? 0
      const rows = Array.from({ length: Math.min(50, 101 - offset) }, (_, index) => row(`Ore ${index + offset + 1}`, { slot: index + offset + 1 }))
      return result(rows, { total: 101, offset })
    })
    await mount()
    await page.getByRole('textbox', { name: 'Search items', exact: true }).fill('Ore')
    expect(ipc.query).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0]).toEqual({ game: 'retail', search: 'Ore', category: 'all', offset: 50, limit: 50 })
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0].offset).toBe(0)
  })

  it('discards an old character response after selection changes', async () => {
    let resolveOld!: (value: ItemStorageQueryResult) => void
    ipc.query.mockImplementationOnce(() => new Promise<ItemStorageQueryResult>(resolve => resolveOld = resolve))
    ipc.query.mockResolvedValue(result([row('Hunter bow', { account: 'account-2', guid: 'Player-2', name: 'Hunter' })]))
    await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await page.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: 'Hunter · Kalimdor', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Hunter bow', exact: true })).toBeVisible()
    resolveOld(result([row('Obsolete blade')]))
    await nextTick()
    await expect.element(page.getByRole('heading', { name: 'Obsolete blade', exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { name: 'Hunter bow', exact: true })).toBeVisible()
  })

  it('keeps game profiles separate and drops a late response from the previous version', async () => {
    let resolveOld!: (value: ItemStorageQueryResult) => void
    ipc.query.mockImplementationOnce(() => new Promise<ItemStorageQueryResult>(resolve => resolveOld = resolve))
    const { screen } = await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await screen.rerender({ game: 'forever', summary: summary() })
    ipc.query.mockResolvedValue(result([row('Infinite blade', { game: 'forever' })]))
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0].game).toBe('forever')
    resolveOld(result([row('Retail blade')]))
    await nextTick()
    await expect.element(page.getByRole('heading', { name: 'Infinite blade', exact: true })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Retail blade', exact: true })).not.toBeInTheDocument()
  })

  it('shows uncertainty and incomplete details instead of treating retained items as current', async () => {
    const item = row('Old ore', { uncertain: true, cached: true, complete: false, category: 'profession' })
    item.item.infoComplete = false
    ipc.query.mockResolvedValue(result([item]))
    await mount('zh-Hans')
    await page.getByRole('button', { name: '查看物品', exact: true }).click()
    await expect.element(page.getByText('这是保留的历史观测，当前位置的实际内容尚不确定。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '属性与词条详情', exact: true }).click()
    await expect.element(page.getByTestId('storage-item').getByText('部分格位或物品详情尚不完整。', { exact: true })).toBeVisible()
  })

  it('localizes failures without showing raw database diagnostics', async () => {
    ipc.query.mockResolvedValue(result([], { storageError: 'SQLITE_CORRUPT private-path secret-value' }))
    await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('The local item archive is unavailable.')
    await expect.element(page.getByText('SQLITE_CORRUPT private-path secret-value', { exact: false })).not.toBeInTheDocument()
  })

  it('marks profession product candidates as unconfirmed and supports their own filter', async () => {
    const item = row('治疗药水', { quantity: 20, category: 'profession-product' })
    item.item.classID = 0
    item.item.subclassID = 1
    item.item.type = 'Consumable'
    item.item.subtype = 'Potion'
    item.item.equipLoc = ''
    item.item.stats = []
    ipc.query.mockResolvedValue(result([item]))
    await mount('zh-Hans')
    await page.getByRole('button', { name: '查看物品', exact: true }).click()
    const record = page.getByTestId('storage-item')
    await expect.element(record.getByText('制作成品候选', { exact: true })).toBeVisible()
    await expect.element(record.getByText('来源未确认', { exact: true })).toBeVisible()
    await expect.element(record.getByText('药水、食物、背包和附魔等仅按类别列为制作成品候选，也可能来自掉落或购买；记录不能证明实际制作来源。', { exact: false })).toBeVisible()
    await page.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: '制作成品候选', exact: true }).click()
    await expect.poll(() => ipc.query.mock.calls.at(-1)?.[0].category).toBe('profession-product')
  })

  it('identifies a shortened transfer summary without promising a later complete tooltip', async () => {
    const item = row()
    item.item.truncated = true
    item.item.tooltipComplete = false
    ipc.query.mockResolvedValue(result([item]))
    await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await page.getByRole('button', { name: 'Item attributes and effects', exact: true }).click()
    await expect.element(page.getByText('This is a shortened archive summary. Some attributes or effects were not transmitted.', { exact: true })).toBeVisible()
  })

  it('invalidates both game caches when all item data is cleared', async () => {
    let resolveOld!: (value: ItemStorageQueryResult) => void
    ipc.query.mockImplementationOnce(() => new Promise<ItemStorageQueryResult>(resolve => resolveOld = resolve))
    const { storage } = await mount()
    await page.getByRole('button', { name: 'Browse items', exact: true }).click()
    await storage.clear()
    resolveOld(result([row('Deleted blade')]))
    await nextTick()
    await expect.poll(() => storage.profiles.retail.result).toBeNull()
    expect(storage.profiles.forever.result).toBeNull()
    expect(ipc.clear).toHaveBeenCalledOnce()
  })

  it('keeps the item browser readable in a narrow Chinese settings panel', async () => {
    await page.viewport(390, 1000)
    onTestFinished(() => page.viewport(1280, 720))
    ipc.query.mockResolvedValue(result([row('冒险者珍藏的精良专业工具与附魔材料', { uncertain: true })]))
    await mount('zh-Hans')
    await page.getByRole('button', { name: '查看物品', exact: true }).click()
    await expect.element(page.getByTestId('storage-item')).toBeVisible()
    const region = page.getByRole('region', { name: '背包与银行物品仓库', exact: true })
    const bounds = region.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    for (const button of region.element().querySelectorAll('button')) {
      const buttonBounds = button.getBoundingClientRect()
      expect(buttonBounds.left).toBeGreaterThanOrEqual(bounds.left)
      expect(buttonBounds.right).toBeLessThanOrEqual(bounds.right)
    }
    await region.screenshot({ path: 'wow-item-storage-zh-narrow.png' })
  })
})

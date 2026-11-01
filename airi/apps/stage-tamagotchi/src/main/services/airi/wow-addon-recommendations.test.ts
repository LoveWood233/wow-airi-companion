import type { AddonFile, AddonMetadata, AddonSummary } from '../../../shared/wow-addons'
import type { CurseForgeCatalog } from './wow-addons-catalog'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WowAddonRecommendations } from './wow-addon-recommendations'

const metadata: AddonMetadata = { categories: [{ id: 1009, name: 'Bags & Inventory', slug: 'bags-inventory', parentCategoryId: 1 }], versionTypes: [{ id: 517, name: 'Retail', slug: 'game', group: 'retail' }] }

function addon(id: number, downloads = 1000 - id): AddonSummary {
  return { id, name: `Bag ${id}`, summary: 'Organizes inventory', websiteUrl: `https://www.curseforge.com/wow/addons/bag-${id}`, logoUrl: null, downloadCount: downloads, dateModified: '2026-11-01T00:00:00Z', authors: [], categories: [1009], allowDistribution: true }
}

function file(modId: number): AddonFile {
  return { id: modId * 100, modId, displayName: '12.1', fileName: 'bag.zip', fileLength: 100, releaseType: 1, fileDate: '2026-11-01T00:00:00Z', gameVersions: ['12.1.5'], gameVersionTypeIds: [517], downloadUrl: 'https://edge.forgecdn.net/files/1/1/bag.zip', sha1: 'a'.repeat(40), dependencies: [] }
}

describe('addon recommendations', () => {
  const search = vi.fn<CurseForgeCatalog['search']>()
  const getLatestCompatibleFiles = vi.fn<CurseForgeCatalog['getLatestCompatibleFiles']>()
  let service: WowAddonRecommendations
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    search.mockReset().mockResolvedValue({ addons: [1, 2, 3, 4, 5, 6].map(id => addon(id)), index: 0, pageSize: 20, totalCount: 6 })
    getLatestCompatibleFiles.mockReset().mockImplementation(async id => [file(id)])
    service = new WowAddonRecommendations({ search, getLatestCompatibleFiles })
  })
  afterEach(() => vi.useRealTimers())

  it('maps a Chinese bag request to the API category and ranks five compatible unique projects by downloads', async () => {
    getLatestCompatibleFiles.mockImplementation(async id => id === 1 ? [] : [file(id)])
    const report = await service.search({ game: 'retail', query: '给我推荐背包插件' }, metadata, metadata.versionTypes[0])
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[0][0]).toMatchObject({ categoryId: 1009, gameVersionTypeId: 517, game: 'retail', sort: 'downloads' })
    expect(report.addons.map(addon => addon.id)).toEqual([2, 3, 4, 5, 6])
    expect(report.addons.every(addon => addon.installable)).toBe(true)
    expect(getLatestCompatibleFiles).toHaveBeenCalledWith(1, 517)
    expect(report.addons[0].gameVersions).toEqual(['12.1.5'])
  })

  it('puts an exact requested name before a less relevant project with more downloads', async () => {
    search.mockResolvedValue({ addons: [{ ...addon(1, 1), name: 'Specific Bags' }, addon(2, 1000000)], index: 0, pageSize: 20, totalCount: 2 })
    const report = await service.search({ game: 'retail', query: 'Specific Bags' }, metadata, metadata.versionTypes[0])
    expect(report.addons.map(addon => addon.id)).toEqual([1, 2])
    expect(report.addons[0].relevance).toBeGreaterThan(report.addons[1].relevance)
  })

  it('drops an unrelated category even if it has the most downloads', async () => {
    search.mockResolvedValue({ addons: [{ ...addon(1, 10000000), categories: [1011] }, addon(2)], index: 0, pageSize: 20, totalCount: 2 })
    const report = await service.search({ game: 'retail', query: '背包' }, metadata, metadata.versionTypes[0])
    expect(report.addons.map(addon => addon.id)).toEqual([2])
    expect(getLatestCompatibleFiles).not.toHaveBeenCalledWith(1, 517)
  })

  it('marks author restrictions and missing download metadata instead of constructing a download link', async () => {
    search.mockResolvedValue({ addons: [{ ...addon(1), allowDistribution: false }, addon(2), addon(3)], index: 0, pageSize: 20, totalCount: 3 })
    getLatestCompatibleFiles.mockImplementation(async id => [{ ...file(id), ...(id === 2 ? { downloadUrl: null } : id === 3 ? { sha1: undefined } : {}) }])
    const report = await service.search({ game: 'retail', query: 'bags' }, metadata, metadata.versionTypes[0])
    expect(report.addons.map(addon => addon.unavailableReason)).toEqual(['curseforge-distribution-disabled', 'curseforge-download-unavailable', 'curseforge-download-integrity'])
    expect(() => service.select({ recommendationId: report.id, modId: 1 })).toThrow('curseforge-distribution-disabled')
  })

  it('ranks a bag manager above a more downloaded supporting utility in the same category', async () => {
    search.mockResolvedValue({ addons: [{ ...addon(1, 10000000), name: 'Cooldown Timer', summary: 'Numbers on action icons' }, addon(2, 10)], index: 0, pageSize: 20, totalCount: 2 })
    const report = await service.search({ game: 'retail', query: 'bags' }, metadata, metadata.versionTypes[0])
    expect(report.addons.map(addon => addon.id)).toEqual([2, 1])
    expect(report.addons[0].relevance).toBeGreaterThan(report.addons[1].relevance)
  })

  it('binds selections to main-owned reports and expires them after ten minutes', async () => {
    const report = await service.search({ game: 'retail', query: 'bags' }, metadata, metadata.versionTypes[0])
    const id = report.id
    report.addons[0].fileId = 999
    expect(service.select({ recommendationId: id, modId: 1 })).toEqual({ game: 'retail', modId: 1, fileId: 100, versionTypeId: 517 })
    expect(() => service.select({ recommendationId: id, modId: 999 })).toThrow('wow-addons-recommendation-invalid')
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    expect(() => service.select({ recommendationId: id, modId: 1 })).toThrow('wow-addons-recommendation-expired')
  })

  it('skips a removed project but preserves authorization errors', async () => {
    getLatestCompatibleFiles.mockImplementation(async (id) => {
      if (id === 1)
        throw new Error('curseforge-not-found')
      return [file(id)]
    })
    expect((await service.search({ game: 'retail', query: 'bags' }, metadata, metadata.versionTypes[0])).addons[0].id).toBe(2)
    getLatestCompatibleFiles.mockRejectedValue(new Error('curseforge-unauthorized'))
    await expect(service.search({ game: 'retail', query: 'bags' }, metadata, metadata.versionTypes[0])).rejects.toThrow('curseforge-unauthorized')
  })

  it('requires the observed game to match the resolved API branch before any search', async () => {
    await expect(service.search({ game: 'forever', query: 'bags' }, metadata, metadata.versionTypes[0])).rejects.toThrow('curseforge-incompatible-version')
    expect(search).not.toHaveBeenCalled()
  })
})

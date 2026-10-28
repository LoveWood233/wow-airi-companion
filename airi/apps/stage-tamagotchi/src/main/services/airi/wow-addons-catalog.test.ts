import type { AddonSearchRequest } from '../../../shared/wow-addons'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurseForgeCatalog } from './wow-addons-catalog'

const archive = Buffer.from('addon archive bytes')
const file = {
  id: 80,
  gameId: 1,
  modId: 55,
  isAvailable: true,
  displayName: 'Example 1.0',
  fileName: 'Example-1.0.zip',
  fileLength: archive.length,
  releaseType: 1,
  fileDate: '2026-10-20T12:00:00Z',
  gameVersions: ['12.0.1'],
  sortableGameVersions: [{ gameVersionTypeId: 901 }],
  downloadUrl: 'https://edge.forgecdn.net/files/1/80/Example-1.0.zip',
  hashes: [{ algo: 1, value: createHash('sha1').update(archive).digest('hex') }],
  dependencies: [{ modId: 70, relationType: 3 }, { modId: 71, relationType: 2 }, { modId: 72, relationType: 5 }],
}
const mod = {
  id: 55,
  gameId: 1,
  classId: 447,
  name: 'Example',
  summary: 'An example addon',
  logo: { thumbnailUrl: 'https://media.forgecdn.net/logo.png' },
  links: { websiteUrl: 'https://www.curseforge.com/wow/addons/example' },
  downloadCount: 100,
  dateModified: '2026-10-20T12:00:00Z',
  authors: [{ name: 'Author' }],
  categories: [{ id: 20 }],
  allowModDistribution: true,
}
const searchRequest: AddonSearchRequest = { game: 'retail', gameVersionTypeId: 901, search: ' Example ', index: 20, sort: 'popular', categoryId: 21 }

describe('curseForgeCatalog', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let responses: Map<string, unknown>

  beforeEach(() => {
    responses = new Map<string, unknown>([
      ['/v1/categories', { data: [
        { id: 20, gameId: 1, name: 'Combat', slug: 'combat', classId: 447, parentCategoryId: 447 },
        { id: 21, gameId: 1, name: 'Raid', slug: 'raid', classId: 447, parentCategoryId: 20 },
        { id: 30, gameId: 1, name: 'Other class', slug: 'other', classId: 448, parentCategoryId: null },
      ] }],
      ['/v1/games/1/version-types', { data: [
        { id: 901, gameId: 1, name: 'WoW Retail', slug: 'wow_retail' },
        { id: 902, gameId: 1, name: 'WoW Classic', slug: 'wow_classic' },
        { id: 903, gameId: 1, name: 'WoW Forever', slug: 'wow_forever' },
        { id: 904, gameId: 1, name: 'Experimental', slug: 'experimental' },
      ] }],
      ['/v1/mods/search', { data: [mod], pagination: { index: 20, pageSize: 20, totalCount: 65 } }],
      ['/v1/mods/55', { data: mod }],
      ['/v1/mods/55/files', { data: [file], pagination: { index: 0, pageSize: 20, totalCount: 1 } }],
      ['/v1/mods/55/files/80', { data: file }],
      ['/v1/mods/55/files/80/download-url', { data: file.downloadUrl }],
    ])
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'edge.forgecdn.net')
        return new Response(archive)
      if (!responses.has(url.pathname))
        throw new Error(`Unexpected request: ${url.pathname}`)
      return Response.json(responses.get(url.pathname))
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('discovers category hierarchy and version IDs without fixed flavor IDs', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const metadata = await catalog.getMetadata()

    expect(metadata.categories.map(category => [category.id, category.parentCategoryId])).toEqual([[20, 447], [21, 20]])
    expect(metadata.versionTypes.map(type => [type.id, type.group])).toEqual([[901, 'retail'], [902, 'classic'], [903, 'forever'], [904, null]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const categoriesUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(categoriesUrl.searchParams.get('gameId')).toBe('1')
    expect(categoriesUrl.searchParams.get('classId')).toBe('447')
    metadata.versionTypes[0].group = 'forever'
    expect((await catalog.getMetadata()).versionTypes[0].group).toBe('retail')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{ sort: 'popular', field: '2' }, { sort: 'updated', field: '3' }, { sort: 'downloads', field: '6' }] as const)(
    'sends exact flavor, category, keywords, pagination, and $sort sort',
    async ({ sort, field }) => {
      const catalog = new CurseForgeCatalog('test-only-key')
      const result = await catalog.search({ ...searchRequest, sort })
      const [input, options] = fetchMock.mock.calls[2]
      const url = new URL(String(input))

      expect(url.origin).toBe('https://api.curseforge.com')
      expect(url.pathname).toBe('/v1/mods/search')
      expect(Object.fromEntries(url.searchParams)).toEqual({ gameId: '1', classId: '447', gameVersionTypeId: '901', categoryId: '21', searchFilter: 'Example', index: '20', pageSize: '20', sortField: field, sortOrder: 'desc' })
      expect(options?.headers).toEqual({ 'Accept': 'application/json', 'x-api-key': 'test-only-key' })
      expect(options?.redirect).toBe('error')
      expect(result.addons[0]).toEqual({ id: 55, name: 'Example', summary: 'An example addon', logoUrl: mod.logo.thumbnailUrl, websiteUrl: mod.links.websiteUrl, downloadCount: 100, dateModified: mod.dateModified, authors: ['Author'], categories: [20], allowDistribution: true })
      expect(result.totalCount).toBe(65)
    },
  )

  it('refuses a type ID from another game group and unknown categories before search', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')

    await expect(catalog.search({ ...searchRequest, game: 'forever' })).rejects.toThrow('curseforge-invalid-request')
    await expect(catalog.search({ ...searchRequest, gameVersionTypeId: 999 })).rejects.toThrow('curseforge-invalid-request')
    await expect(catalog.search({ ...searchRequest, categoryId: 30 })).rejects.toThrow('curseforge-invalid-request')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('filters server file results again for exact compatibility, availability, and ownership', async () => {
    responses.set('/v1/mods/55/files', { data: [
      file,
      { ...file, id: 81, sortableGameVersions: [{ gameVersionTypeId: 902 }] },
      { ...file, id: 82, modId: 56 },
      { ...file, id: 83, isAvailable: false },
      { ...file, id: 84, sortableGameVersions: [] },
    ], pagination: { index: 0, pageSize: 20, totalCount: 5 } })
    const files = await new CurseForgeCatalog('test-only-key').getFiles(55, 901)
    const url = new URL(String(fetchMock.mock.calls[2][0]))

    expect(url.searchParams.get('gameVersionTypeId')).toBe('901')
    expect(url.searchParams.get('pageSize')).toBe('20')
    expect(files.map(file => file.id)).toEqual([80])
    expect(files[0].gameVersions).toEqual(['12.0.1'])
    expect(files[0].gameVersionTypeIds).toEqual([901])
    expect(files[0].dependencies).toEqual([{ modId: 70, required: true }, { modId: 71, required: false }])
  })

  it('rejects file responses with a mismatched ID', async () => {
    responses.set('/v1/mods/55/files/80', { data: { ...file, id: 81 } })

    await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toThrow('curseforge-invalid-response')
  })

  it.each([
    { website: 'javascript:alert(1)', logo: 'http://media.forgecdn.net/logo.png' },
    { website: 'https://attacker.example/wow/addons/example', logo: 'https://forgecdn.net.attacker.example/logo.png' },
    { website: 'https://user:password@www.curseforge.com/wow/addons/example', logo: 'https://user:password@media.forgecdn.net/logo.png' },
    { website: 'https://www.curseforge.com/wow/addons/example?api-key=secret', logo: 'https://media.forgecdn.net/logo.png?api-key=secret' },
  ])('omits unsafe website and image links: $website', async ({ website, logo }) => {
    responses.set('/v1/mods/55', { data: { ...mod, links: { websiteUrl: website }, logo: { thumbnailUrl: logo } } })
    const addon = await new CurseForgeCatalog('test-only-key').getMod(55)

    expect(addon.websiteUrl).toBe('')
    expect(addon.logoUrl).toBeNull()
  })

  it('reads later pages before selecting the newest compatible files', async () => {
    const implementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, options) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1/mods/55/files') {
        const index = Number(url.searchParams.get('index'))
        const data = index === 0
          ? Array.from({ length: 20 }, (_, index) => ({ ...file, id: 100 + index }))
          : [{ ...file, id: 120, fileDate: '2026-10-27T12:00:00Z' }]
        return Response.json({ data, pagination: { index, pageSize: 20, totalCount: 21 } })
      }
      return implementation(input, options)
    })
    const files = await new CurseForgeCatalog('test-only-key').getFiles(55, 901)

    expect(files).toHaveLength(20)
    expect(files[0].id).toBe(120)
    expect(fetchMock.mock.calls.slice(2).map(([input]) => new URL(String(input)).searchParams.get('index'))).toEqual(['0', '20'])
  })

  it('rejects file histories above the 20-page bound', async () => {
    responses.set('/v1/mods/55/files', { data: [file], pagination: { index: 0, pageSize: 20, totalCount: 401 } })
    responses.set('/v1/mods/55', { data: { ...mod, latestFiles: [] } })

    await expect(new CurseForgeCatalog('test-only-key').getFiles(55, 901)).rejects.toThrow('curseforge-too-many-files')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('uses verified compatible latest files for large histories and downloads the selected file', async () => {
    responses.set('/v1/mods/55/files', { data: [file], pagination: { index: 0, pageSize: 20, totalCount: 5000 } })
    responses.set('/v1/mods/55', { data: { ...mod, latestFiles: [
      file,
      { ...file, id: 81, sortableGameVersions: [{ gameVersionTypeId: 902 }] },
      { ...file, id: 82, modId: 56 },
      { ...file, id: 83, isAvailable: false },
    ] } })
    const catalog = new CurseForgeCatalog('test-only-key')
    const files = await catalog.getFiles(55, 901)

    expect(files.map(file => file.id)).toEqual([80])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(await catalog.download(files[0], 901)).toEqual(archive)
  })

  it('rejects large histories when latest files contain only another flavor', async () => {
    responses.set('/v1/mods/55/files', { data: [file], pagination: { index: 0, pageSize: 20, totalCount: 5000 } })
    responses.set('/v1/mods/55', { data: { ...mod, latestFiles: [{ ...file, sortableGameVersions: [{ gameVersionTypeId: 902 }] }] } })

    await expect(new CurseForgeCatalog('test-only-key').getFiles(55, 901)).rejects.toThrow('curseforge-too-many-files')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it.each([
    { ...mod },
    { ...mod, latestFiles: [{ ...file, fileLength: -1 }] },
    { ...mod, id: 56, latestFiles: [file] },
  ])('rejects missing, invalid, or mismatched latest-file data for a large history %#', async (latest) => {
    responses.set('/v1/mods/55/files', { data: [file], pagination: { index: 0, pageSize: 20, totalCount: 5000 } })
    responses.set('/v1/mods/55', { data: latest })

    await expect(new CurseForgeCatalog('test-only-key').getFiles(55, 901)).rejects.toThrow('curseforge-invalid-response')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects author-disabled distribution without requesting a download URL', async () => {
    responses.set('/v1/mods/55', { data: { ...mod, allowModDistribution: false } })

    await expect(new CurseForgeCatalog('test-only-key').getDownloadUrl(55, 80)).rejects.toThrow('curseforge-distribution-disabled')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('respects a null file download URL without constructing one', async () => {
    responses.set('/v1/mods/55/files/80', { data: { ...file, downloadUrl: null } })

    await expect(new CurseForgeCatalog('test-only-key').getDownloadUrl(55, 80)).rejects.toThrow('curseforge-download-unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('respects a null download endpoint URL', async () => {
    responses.set('/v1/mods/55/files/80/download-url', { data: null })

    await expect(new CurseForgeCatalog('test-only-key').getDownloadUrl(55, 80)).rejects.toThrow('curseforge-download-unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    'http://edge.forgecdn.net/files/a.zip',
    'https://edge.forgecdn.net.attacker.example/files/a.zip',
    'https://attacker.example/files/a.zip',
    'https://user:password@edge.forgecdn.net/files/a.zip',
    'https://edge.forgecdn.net/files/a.zip?api-key=secret',
  ])('rejects an unsafe CDN URL: %s', async (url) => {
    responses.set('/v1/mods/55/files/80/download-url', { data: url })

    await expect(new CurseForgeCatalog('test-only-key').getDownloadUrl(55, 80)).rejects.toThrow('curseforge-unsafe-download-url')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('downloads authoritative metadata bytes with an authenticated CDN request and checks SHA-1', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const selected = await catalog.getFile(55, 80)
    selected.downloadUrl = 'https://attacker.example/injected.zip'
    selected.sha1 = '0'.repeat(40)
    const bytes = await catalog.download(selected)
    const [url, options] = fetchMock.mock.calls[4]

    expect(bytes).toEqual(archive)
    expect(String(url)).toBe(file.downloadUrl)
    expect(options?.headers).toEqual({ 'x-api-key': 'test-only-key' })
    expect(options?.redirect).toBe('manual')
  })

  it('rejects a changed authoritative flavor before requesting distribution policy or CDN bytes', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const selected = await catalog.getFile(55, 80)
    responses.set('/v1/mods/55/files/80', { data: { ...file, sortableGameVersions: [{ gameVersionTypeId: 902 }] } })
    fetchMock.mockClear()

    await expect(catalog.download(selected, 901)).rejects.toThrow('curseforge-incompatible-version')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/mods/55/files/80')
  })

  it('rejects a redirect before sending credentials to an untrusted host', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const selected = await catalog.getFile(55, 80)
    const implementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, options) => {
      if (new URL(String(input)).hostname === 'edge.forgecdn.net')
        return new Response(null, { status: 302, headers: { location: 'https://attacker.example/files/archive.zip' } })
      return implementation(input, options)
    })

    await expect(catalog.download(selected)).rejects.toThrow('curseforge-unsafe-download-url')
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).hostname === 'attacker.example')).toBe(false)
  })

  it('rejects corrupt archive bytes and missing checksums', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const selected = await catalog.getFile(55, 80)
    responses.set('/v1/mods/55/files/80', { data: { ...file, hashes: [{ algo: 1, value: '0'.repeat(40) }] } })

    await expect(catalog.download(selected)).rejects.toThrow('curseforge-download-integrity')
    responses.set('/v1/mods/55/files/80', { data: { ...file, hashes: [] } })
    fetchMock.mockClear()
    await expect(catalog.download(selected)).rejects.toThrow('curseforge-download-integrity')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized metadata response before reading it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }))

    await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toThrow('curseforge-response-too-large')
  })

  it('rejects actual response bytes above the limit without a content length', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024 + 1)))

    await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toThrow('curseforge-response-too-large')
  })

  it('rejects malformed API data with a stable error', async () => {
    responses.set('/v1/mods/55/files/80', { data: { ...file, fileLength: -1 } })

    await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toThrow('curseforge-invalid-response')
  })

  it.each([{ status: 401, code: 'unauthorized' }, { status: 403, code: 'unauthorized' }, { status: 429, code: 'rate-limited' }, { status: 404, code: 'not-found' }, { status: 500, code: 'request-failed' }])(
    'redacts provider error bodies for status $status',
    async ({ status, code }) => {
      fetchMock.mockResolvedValue(new Response('test-only-key', { status, statusText: 'test-only-key' }))

      await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toMatchObject({ message: `curseforge-${code}` })
    },
  )

  it('redacts network error details', async () => {
    fetchMock.mockRejectedValue(new Error('Fetch failed with test-only-key'))

    await expect(new CurseForgeCatalog('test-only-key').getFile(55, 80)).rejects.toMatchObject({ message: 'curseforge-request-failed' })
  })

  it('aborts pending network requests on disposal and rejects later requests', async () => {
    const catalog = new CurseForgeCatalog('test-only-key')
    const observedSignals: AbortSignal[] = []
    fetchMock.mockImplementationOnce(async (_input, options) => {
      const signal = options?.signal
      if (!signal)
        throw new Error('Missing request abort signal')
      observedSignals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const pending = catalog.getFile(55, 80)

    expect(observedSignals).toHaveLength(1)
    expect(observedSignals[0].aborted).toBe(false)
    catalog.dispose()
    await expect(pending).rejects.toMatchObject({ message: 'curseforge-disposed' })
    expect(observedSignals[0].aborted).toBe(true)
    await expect(catalog.getFile(55, 80)).rejects.toMatchObject({ message: 'curseforge-disposed' })
    await expect(catalog.getMetadata()).rejects.toMatchObject({ message: 'curseforge-disposed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

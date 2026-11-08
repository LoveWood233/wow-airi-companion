import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CompanionStatistics } from './wow-statistics-service'

const directories: string[] = []
const services: CompanionStatistics[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()))
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(endpoint = 'https://statistics.example') {
  const directory = await mkdtemp(join(tmpdir(), 'companion-statistics-'))
  directories.push(directory)
  const file = join(directory, 'statistics.json')
  const network = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  const options = { endpoint, clientVersion: '2.26.0', platform: 'win32', fetch: network }
  const service = new CompanionStatistics(file, options)
  services.push(service)
  await service.load()
  return { file, network, options, service }
}

describe('anonymous installation and cumulative usage reporting', () => {
  it('neither collects nor transmits before disclosure', async () => {
    const { service, network } = await fixture()
    await service.start()
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 42 })
    await service.report()
    expect(network).not.toHaveBeenCalled()
    expect(service.read()).toMatchObject({ disclosed: false, enabled: false, counters: { requests: 0 } })
    await expect(service.configure({ enabled: true, endpoint: 'https://statistics.example' })).rejects.toThrow('Disclosure required')
  })

  it('registers immediately after acknowledgment without disclosing unrelated data', async () => {
    const { service, network } = await fixture()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    await service.report()
    const registration = JSON.parse(String(network.mock.calls[0][1]?.body))
    expect(Object.keys(registration).sort()).toEqual(['clientVersion', 'installationId', 'installationSecret', 'platform', 'protocol'])
    expect(registration.installationSecret).toMatch(/^[\w-]{43}$/)
    expect(registration.installationId).toBe(service.read().installationId)
    expect(service.read()).not.toHaveProperty('installationSecret')
    expect(network.mock.calls[0][1]?.redirect).toBe('error')
  })

  it('allows a disclosed installation to remain disabled', async () => {
    const { service, network } = await fixture()
    await service.acknowledge(false)
    await service.record({ id: randomUUID(), source: 'unavailable' })
    await service.report()
    expect(service.read()).toMatchObject({ disclosed: true, enabled: false, counters: { requests: 0 } })
    expect(network).not.toHaveBeenCalled()
  })

  it('persists local counters with no endpoint and deduplicates observations across restarts', async () => {
    const { service, network, file, options } = await fixture('')
    const observation = { id: randomUUID(), source: 'reported' as const, inputTokens: 0, outputTokens: 8 }
    await service.acknowledge(true)
    await service.record(observation)
    await service.record({ id: randomUUID(), source: 'unavailable' })
    await service.report()
    await service.stop()
    const restored = new CompanionStatistics(file, options)
    services.push(restored)
    await restored.load()
    await restored.record(observation)
    expect(restored.read().counters).toEqual({ requests: 2, requestsWithUsage: 1, requestsWithoutUsage: 1, inputTokens: 0, outputTokens: 8, totalTokens: 0, inputReportedRequests: 1, outputReportedRequests: 1, totalReportedRequests: 0 })
    expect(restored.read().lastError).toBe('not-configured')
    expect(network).not.toHaveBeenCalled()
  })

  it('sends unchanged cumulative heartbeats every five minutes and stops on shutdown', async () => {
    const { service, network } = await fixture()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 21 })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Fake only the scheduler, leaving filesystem and fetch promises real.
    await service.start()
    await vi.advanceTimersByTimeAsync(299_999)
    expect(network).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(service.read().lastReportedAt).not.toBeNull())
    await vi.advanceTimersByTimeAsync(300_000)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(3))
    const reports = network.mock.calls.filter(([url]) => String(url).endsWith('/usage')).map(([, init]) => JSON.parse(String(init?.body)))
    expect(reports.map(report => report.sequence)).toEqual([1, 2])
    expect(reports.map(report => report.counters.totalTokens)).toEqual([21, 21])
    await service.stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(network).toHaveBeenCalledTimes(3)
  })

  it('retries cumulative totals after a lost reply without clearing local usage', async () => {
    const { service, network } = await fixture()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    await service.record({ id: randomUUID(), source: 'reported', inputTokens: 8, outputTokens: 3, totalTokens: 11 })
    network.mockRejectedValueOnce(new Error('connection lost after server commit'))
    await service.report()
    expect(service.read().lastError).toBe('network-error')
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 4 })
    await service.report()
    const reports = network.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)))
    expect(reports.map(report => report.sequence)).toEqual([1, 2])
    expect(reports.map(report => report.counters.totalTokens)).toEqual([11, 15])
    expect(service.read()).toMatchObject({ lastError: null, counters: { totalTokens: 15 } })
  })

  it('aborts an in-flight report when disabled and does not collect new records', async () => {
    const { service, network } = await fixture()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    network.mockImplementationOnce(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const reporting = service.report()
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2))
    await service.configure({ enabled: false, endpoint: 'https://statistics.example' })
    await reporting
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 999 })
    await service.report()
    expect(network.mock.calls[1][1]?.signal?.aborted).toBe(true)
    expect(network).toHaveBeenCalledTimes(2)
    expect(service.read()).toMatchObject({ enabled: false, lastReportedAt: null, counters: { requests: 0 } })
  })

  it('keeps corrupt persisted state untouched and never transmits it', async () => {
    const { file, options, network } = await fixture()
    await writeFile(file, '{broken')
    const service = new CompanionStatistics(file, options)
    services.push(service)
    await service.start()
    await service.report()
    await expect(service.acknowledge(true)).rejects.toThrow('storage unavailable')
    expect(service.read()).toMatchObject({ enabled: false, lastError: 'storage-error' })
    expect(await readFile(file, 'utf8')).toBe('{broken')
    expect(network).not.toHaveBeenCalled()
  })

  it('updates version registration after an upgrade without changing installation identity', async () => {
    const { service, file, options, network } = await fixture()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    await service.report()
    await service.stop()
    const upgraded = new CompanionStatistics(file, { ...options, clientVersion: '2.27.0' })
    services.push(upgraded)
    await upgraded.load()
    await upgraded.start()
    await vi.waitFor(() => expect(network.mock.calls.filter(([url]) => String(url).endsWith('/installations'))).toHaveLength(2))
    const registrations = network.mock.calls.filter(([url]) => String(url).endsWith('/installations')).map(([, init]) => JSON.parse(String(init?.body)))
    expect(registrations.map(item => item.clientVersion)).toEqual(['2.26.0', '2.27.0'])
    expect(registrations[0].installationId).toBe(registrations[1].installationId)
  })
})

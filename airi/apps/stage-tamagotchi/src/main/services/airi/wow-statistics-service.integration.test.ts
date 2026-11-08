import type { Buffer } from 'node:buffer'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { CompanionStatistics } from './wow-statistics-service'

// This test uses the sibling Docker service source and synthetic data. No configured user endpoint or model is contacted.
it.skipIf(!process.env.WOW_DATAHUB_SOURCE)('reports through the actual WSGI API into SQLite without duplicate usage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'companion-statistics-http-'))
  const key = `${randomUUID()}${randomUUID()}`
  const python = spawn(process.env.PYTHON ?? 'python', ['-u', '-c', [
    'from wsgiref.simple_server import make_server, WSGIRequestHandler',
    'from server import Config, create_app',
    'from pathlib import Path',
    'import os, json',
    'class Quiet(WSGIRequestHandler):',
    ' def log_message(self, *args): pass',
    'app = create_app(Config(Path(os.environ["DATAHUB_DATABASE"]), os.environ["ADMIN_KEY"]))',
    'http = make_server("127.0.0.1", 0, app, handler_class=Quiet)',
    'print(json.dumps({"port":http.server_port}), flush=True)',
    'http.serve_forever()',
  ].join('\n')], { cwd: process.env.WOW_DATAHUB_SOURCE, windowsHide: true, env: { ...process.env, ADMIN_KEY: key, DATAHUB_DATABASE: join(directory, 'server.sqlite'), PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const serviceFile = join(directory, 'client.json')
  let service: CompanionStatistics | undefined
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Temporary statistics server did not start')), 10_000)
      python.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      python.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Temporary statistics server exited: ${code}`))
      })
      python.stdout.once('data', (chunk: Buffer) => {
        clearTimeout(timer)
        resolve(JSON.parse(chunk.toString('utf8')).port)
      })
    })
    const endpoint = `http://127.0.0.1:${port}`
    const network = vi.fn<typeof fetch>((...args) => fetch(...args))
    const options = { endpoint, clientVersion: '2.26.0', platform: 'win32', fetch: network }
    service = new CompanionStatistics(serviceFile, options)
    await service.load()
    await service.acknowledge(true)
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    const measured = { id: randomUUID(), source: 'reported' as const, inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    await service.record(measured)
    await service.record(measured)
    await service.record({ id: randomUUID(), source: 'unavailable' })
    await service.report()
    network.mockImplementationOnce(async (...args) => {
      await fetch(...args)
      throw new Error('Synthetic receipt loss after commit')
    })
    await service.report()
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 5 })
    await service.report()
    await service.stop()
    service = new CompanionStatistics(serviceFile, options)
    await service.load()
    await service.record(measured)
    await service.report()
    const response = await fetch(`${endpoint}/api/v1/admin/stats?days=7`, { headers: { Authorization: `Bearer ${key}` } })
    expect(response.status).toBe(200)
    const stats = await response.json()
    expect(stats.totalInstallations).toBe(1)
    expect(stats.activeInstallations5m).toBe(1)
    expect(stats.totals).toEqual({ requests: 3, requestsWithUsage: 2, requestsWithoutUsage: 1, inputTokens: 100, outputTokens: 20, totalTokens: 125, inputReportedRequests: 1, outputReportedRequests: 1, totalReportedRequests: 2 })
    expect(stats.daily.at(-1).totalTokens).toBe(125)
    await service.configure({ enabled: false, endpoint })
    await service.record({ id: randomUUID(), source: 'reported', totalTokens: 999 })
    await service.report()
    const afterDisable = await fetch(`${endpoint}/api/v1/admin/stats?days=7`, { headers: { Authorization: `Bearer ${key}` } })
    expect((await afterDisable.json()).totals.totalTokens).toBe(125)
  }
  finally {
    await service?.stop()
    if (python.exitCode === null) {
      const closed = new Promise<void>(resolve => python.once('close', () => resolve()))
      python.kill()
      await closed
    }
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

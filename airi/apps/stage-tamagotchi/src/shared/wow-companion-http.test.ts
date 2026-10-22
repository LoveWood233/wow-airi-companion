import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import { spawn } from 'node:child_process'
import { env } from 'node:process'

import { parse } from 'valibot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bridgeSchema } from './wow-companion'

const bridgeDirectory = env.WOW_COMPANION_BRIDGE_DIR

/** The opt-in fixture runs the real Python HTTP server without desktop capture or external model calls. */
describe.skipIf(!bridgeDirectory)('woW Python bridge HTTP contract', () => {
  let process: ChildProcess
  let baseUrl = ''

  beforeAll(async () => {
    const script = [
      'from server import BridgeServer',
      'from state import CompanionState',
      'http = BridgeServer(("127.0.0.1", 0), CompanionState())',
      'print(http.server_port, flush=True)',
      'http.serve_forever()',
    ].join('\n')
    process = spawn('python', ['-u', '-c', script], { cwd: bridgeDirectory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    baseUrl = await new Promise<string>((resolve, reject) => {
      let output = ''
      let errors = ''
      process.once('error', reject)
      process.stderr?.on('data', (chunk: Buffer) => {
        errors += chunk.toString()
      })
      process.once('exit', code => reject(new Error(`Bridge fixture exited (${code}): ${errors}`)))
      process.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const port = Number(output.trim())
        if (Number.isInteger(port) && port > 0)
          resolve(`http://127.0.0.1:${port}`)
      })
    })
  }, 10_000)

  afterAll(() => {
    process?.kill()
  })

  it('validates waiting, demo, upgrade, calibration, and return-to-screen responses', async () => {
    async function request(path: string, body?: object) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(2000),
      })
      expect(response.status).toBe(200)
      return parse(bridgeSchema, await response.json())
    }
    const initial = await request('/api/status')
    expect(initial.status).toBe('waiting')
    expect(initial.snapshot).toBeNull()
    expect(initial.instanceId.length).toBeGreaterThan(0)

    const demo = await request('/api/demo', { enabled: true })
    expect(demo.status).toBe('demo')
    expect(demo.source).toBe('demo')
    expect(demo.snapshot?.level).toBeGreaterThan(0)

    const upgrade = await request('/api/demo', { enabled: true, action: 'level_up' })
    expect(upgrade.snapshot?.level).toBe((demo.snapshot?.level ?? 0) + 1)
    expect(upgrade.events.at(-1)?.type).toBe('level_up')
    expect(upgrade.events.at(-1)?.demo).toBe(true)
    expect(upgrade.instanceId).toBe(initial.instanceId)

    const calibration = await request('/api/config', { x: 10, y: 12, cellSize: 3, pollMs: 750, paused: false })
    expect(calibration.config).toEqual({ x: 10, y: 12, cellSize: 3, pollMs: 750, paused: false })

    const live = await request('/api/demo', { enabled: false })
    expect(live.source).toBe('screen')
    expect(live.status).toBe('waiting')
  })
})

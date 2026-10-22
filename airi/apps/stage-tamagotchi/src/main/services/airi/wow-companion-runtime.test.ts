import type { Server } from 'node:http'

import process from 'node:process'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanionBridgeRuntime } from './wow-companion-runtime'

const python = process.env.AIRI_WOW_RUNTIME_TEST_PYTHON
const integration = it.runIf(process.platform === 'win32' && Boolean(python))
const health = { ok: true, service: 'wow-companion-bridge', protocol: 'WCP1', version: '2.2.0', instanceId: 'test-instance' }
const script = `import argparse,json,os,pathlib,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser()
p.add_argument('--port',type=int)
p.add_argument('--config')
p.add_argument('--managed-stdin',action='store_true')
a=p.parse_args()
root=pathlib.Path(__file__).parent
mode=(root/'mode.txt').read_text() if (root/'mode.txt').exists() else ''
with (root/'starts.txt').open('a') as f: f.write('start\\n')
(root/'arguments.json').write_text(json.dumps(vars(a)))
if mode=='fail':
    print('controlled start failure',file=sys.stderr)
    sys.exit(2)
if mode=='delay': time.sleep(3)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({'ok':True,'service':'wow-companion-bridge','protocol':'WCP1','version':'2.2.0','instanceId':'test'}).encode())
        if self.path=='/crash':
            self.wfile.flush()
            os._exit(2)
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
def monitor():
    sys.stdin.buffer.read()
    server.shutdown()
threading.Thread(target=monitor,daemon=True).start()
server.serve_forever(poll_interval=.05)
server.server_close()
`

describe('managed WoW bridge runtime', () => {
  let directory: string
  let source: string
  let appPath: string
  let resourcesPath: string
  let userDataPath: string
  let baseUrl: string
  let runtime: CompanionBridgeRuntime
  let external: Server | undefined

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-runtime-'))
    appPath = join(directory, 'airi', 'apps', 'stage-tamagotchi')
    resourcesPath = join(directory, 'resources')
    userDataPath = join(directory, 'data')
    source = join(directory, 'WOWAddons', 'WoWCompanionBridge')
    await mkdir(source, { recursive: true })
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string')
      throw new Error('Expected a loopback test port')
    baseUrl = `http://127.0.0.1:${address.port}`
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    runtime = new CompanionBridgeRuntime({ appPath, resourcesPath, userDataPath, platform: 'win32' }, baseUrl)
  })

  afterEach(async () => {
    await runtime.dispose()
    if (external) {
      external.closeAllConnections()
      await new Promise<void>(resolve => external?.close(() => resolve()))
      external = undefined
    }
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-runtime-')))
      throw new Error('Refusing to remove a directory outside the runtime test prefix')
    await rm(target, { recursive: true, force: true })
  })

  async function serve(value: unknown) {
    external = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    })
    await new Promise<void>(resolve => external?.listen(Number(new URL(baseUrl).port), '127.0.0.1', resolve))
  }

  async function prepareOwned(mode = '') {
    if (!python)
      throw new Error('Set AIRI_WOW_RUNTIME_TEST_PYTHON to an installed Python executable')
    vi.stubEnv('PATH', dirname(python))
    await writeFile(join(source, 'server.py'), script)
    await writeFile(join(source, 'mode.txt'), mode)
  }

  it('reuses a compatible external bridge and never stops it', async () => {
    await serve(health)
    await Promise.all([runtime.ensureReady(), runtime.ensureReady()])
    expect(runtime.read()).toEqual({ status: 'external', error: null })
    await runtime.stop()
    expect(runtime.read().status).toBe('stopped')
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true)
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('external')
    await runtime.dispose()
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true)
    await expect(runtime.ensureReady()).rejects.toThrow('has stopped')
  })

  it.each([
    { ...health, service: 'unrelated' },
    { ...health, version: '1.0.0' },
    { ...health, version: '3.0.0' },
    { ...health, protocol: 'OTHER' },
  ])('rejects incompatible listeners without replacing them: $version $service $protocol', async (value) => {
    await serve(value)
    await expect(runtime.ensureReady()).rejects.toThrow('incompatible service')
    expect(runtime.read().status).toBe('error')
    await runtime.dispose()
    expect(await (await fetch(`${baseUrl}/health`)).json()).toEqual(value)
  })

  it('reports missing files and retains the error during retry backoff', async () => {
    await expect(runtime.ensureReady()).rejects.toThrow('files are missing')
    const error = runtime.read().error
    await writeFile(join(source, 'server.py'), '')
    await expect(runtime.ensureReady()).rejects.toThrow(error ?? '')
    expect(runtime.read().error).toBe(error)
  })

  it('reports a missing Python without running Windows Store aliases', async () => {
    await writeFile(join(source, 'server.py'), script)
    const aliases = join(directory, 'Microsoft', 'WindowsApps')
    await mkdir(aliases, { recursive: true })
    await writeFile(join(aliases, 'python.exe'), 'not executable')
    vi.stubEnv('PATH', aliases)
    await expect(runtime.ensureReady()).rejects.toThrow('Python 3.10 or newer was not found')
    expect(runtime.read().status).toBe('error')
  })

  it('cancels a start requested just before stop and allows a later start', async () => {
    await serve(health)
    const start = runtime.ensureReady()
    const rejected = expect(start).rejects.toThrow('cancelled')
    await runtime.stop()
    await rejected
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('external')
  })

  it('waits for a pending stop before a new enable connects', async () => {
    await serve(health)
    await runtime.ensureReady()
    const stop = runtime.stop()
    const enable = runtime.ensureReady()
    await Promise.all([stop, enable])
    expect(runtime.read().status).toBe('external')
  })

  it('cancels a queued enable when disabled again during the same stop', async () => {
    await serve(health)
    await runtime.ensureReady()
    const firstStop = runtime.stop()
    const enable = runtime.ensureReady()
    const rejected = expect(enable).rejects.toThrow('cancelled')
    const secondStop = runtime.stop()
    await Promise.all([firstStop, secondStop, rejected])
    expect(runtime.read().status).toBe('stopped')
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('external')
  })

  it('rejects automatic capture on unsupported systems', async () => {
    await runtime.dispose()
    runtime = new CompanionBridgeRuntime({ appPath, resourcesPath, userDataPath, platform: 'linux' }, baseUrl)
    await expect(runtime.ensureReady()).rejects.toThrow('requires Windows')
  })

  integration('starts one owned helper and preserves source settings across stop and restart', async () => {
    await prepareOwned()
    const config = join(source, 'bridge-config.json')
    await writeFile(config, '{"x":8,"y":32,"cellSize":1}')
    await Promise.all([runtime.ensureReady(), runtime.ensureReady()])
    expect(runtime.read()).toEqual({ status: 'running', error: null })
    expect(await readFile(join(source, 'starts.txt'), 'utf8')).toBe('start\r\n')
    expect(JSON.parse(await readFile(join(source, 'arguments.json'), 'utf8'))).toMatchObject({ config, managed_stdin: true })
    await runtime.stop()
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('running')
    expect(await readFile(join(source, 'starts.txt'), 'utf8')).toBe('start\r\nstart\r\n')
    expect(await readFile(config, 'utf8')).toBe('{"x":8,"y":32,"cellSize":1}')
    await runtime.dispose()
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
  }, 15_000)

  integration('uses bundled files and copies calibration only when writable settings are absent', async () => {
    await prepareOwned()
    const bundled = join(resourcesPath, 'wow-companion-bridge')
    await mkdir(bundled, { recursive: true })
    await writeFile(join(bundled, 'server.py'), script)
    await writeFile(join(source, 'bridge-config.json'), '{"x":8,"y":32,"cellSize":1}')
    await runtime.ensureReady()
    const config = join(userDataPath, 'wow-companion-bridge', 'bridge-config.json')
    expect(await readFile(config, 'utf8')).toBe('{"x":8,"y":32,"cellSize":1}')
    expect(JSON.parse(await readFile(join(bundled, 'arguments.json'), 'utf8'))).toMatchObject({ config })
    await runtime.stop()
    await writeFile(config, '{"x":20}')
    await runtime.ensureReady()
    expect(await readFile(config, 'utf8')).toBe('{"x":20}')
  }, 15_000)

  integration('reports an early exit and backs off before retrying', async () => {
    await prepareOwned('fail')
    await expect(runtime.ensureReady()).rejects.toThrow('controlled start failure')
    await expect(runtime.ensureReady()).rejects.toThrow('30 seconds')
    expect(await readFile(join(source, 'starts.txt'), 'utf8')).toBe('start\r\n')
    await writeFile(join(source, 'mode.txt'), '')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('running')
  }, 15_000)

  integration('cancels startup without leaving a listener behind', async () => {
    await prepareOwned('delay')
    const start = runtime.ensureReady()
    const rejected = expect(start).rejects.toThrow('cancelled')
    await expect.poll(async () => readFile(join(source, 'starts.txt'), 'utf8')).toBe('start\r\n')
    await runtime.dispose()
    await rejected
    expect(runtime.read().status).toBe('stopped')
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
  }, 15_000)

  integration('detects a crash, waits for backoff, and starts a new owned helper', async () => {
    await prepareOwned()
    await runtime.ensureReady()
    await fetch(`${baseUrl}/crash`)
    await expect.poll(() => runtime.read().status).toBe('error')
    await expect(runtime.ensureReady()).rejects.toThrow('30 seconds')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
    await runtime.ensureReady()
    expect(runtime.read().status).toBe('running')
    expect(await readFile(join(source, 'starts.txt'), 'utf8')).toBe('start\r\nstart\r\n')
  }, 15_000)
})

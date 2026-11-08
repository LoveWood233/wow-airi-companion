import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { BrowserWindow, ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wowLocalUpdateRendererReady } from '../../../shared/eventa/wow-local-update'
import { markLocalUpdateReady } from './wow-local-update'

const host = vi.hoisted(() => ({ directory: '', packaged: true, surfaces: new Map<unknown, unknown>() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  let nextId = 0
  return {
    app: { getPath: () => host.directory, get isPackaged() { return host.packaged } },
    dialog: {},
    ipcMain: new EventEmitter(),
    BrowserWindow: class extends EventEmitter {
      isDestroyed = vi.fn(() => false)
      webContents
      constructor() {
        super()
        const incoming = new EventEmitter()
        host.surfaces.set(this, incoming)
        this.webContents = { id: ++nextId, isDestroyed: vi.fn(() => false), isCrashed: vi.fn(() => false), send: vi.fn((channel: string, ...args: unknown[]) => incoming.emit(channel, {}, ...args)) }
      }
    },
  }
})

type IpcRendererBoundary = Parameters<typeof createRendererContext>[0]

/** Uses the actual Eventa adapters. Only Electron's native message transport is replaced by event emitters. */
function renderer(window: BrowserWindow) {
  const incoming = host.surfaces.get(window)
  if (!(incoming instanceof EventEmitter))
    throw new Error('Missing renderer transport')
  const transport: IpcRendererBoundary = {
    on(channel, listener) {
      incoming.on(channel, listener)
      return () => incoming.off(channel, listener)
    },
    once(channel, listener) {
      incoming.once(channel, listener)
      return () => incoming.off(channel, listener)
    },
    removeListener(channel, listener) {
      incoming.removeListener(channel, listener)
      return transport
    },
    removeAllListeners: channel => incoming.removeAllListeners(channel),
    send: (channel, ...args) => { ipcMain.emit(channel, { sender: window.webContents }, ...args) },
    invoke: vi.fn(),
    sendSync: vi.fn(),
    sendTo: vi.fn(),
    sendToHost: vi.fn(),
    postMessage: vi.fn(),
  }
  return createRendererContext(transport)
}

describe('local update renderer readiness with real Eventa window filtering', () => {
  let directory: string
  let id: string
  let window: BrowserWindow
  const clients: ReturnType<typeof renderer>[] = []

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-update-ready-'))
    await mkdir(join(directory, 'companion-updates'))
    host.directory = directory
    host.packaged = true
    id = randomUUID()
    window = new BrowserWindow()
    vi.stubEnv('APP_COMPANION_UPDATE_ID', id)
    vi.stubEnv('APP_COMPANION_ROLLBACK_ID', '')
    await saveJob()
  })

  afterEach(async () => {
    clients.splice(0).forEach(client => client.dispose())
    host.surfaces.clear()
    ipcMain.removeAllListeners()
    vi.unstubAllEnvs()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'wow-update-ready-')))
      throw new Error('Refusing to remove a directory outside the readiness test prefix')
    await rm(target, { recursive: true, force: true })
  })

  async function saveJob(newExecutable = process.execPath, oldExecutable = process.execPath, jobId = id) {
    await writeFile(join(directory, 'companion-updates', `job-${id}.json`), JSON.stringify({ id: jobId, newExecutable, oldExecutable }))
  }

  function connect(target = window) {
    const client = renderer(target)
    clients.push(client)
    return client.context
  }

  async function ack(rollback = false) {
    return readFile(join(directory, 'companion-updates', `${rollback ? 'rollback-ack' : 'ack'}-${id}.json`), 'utf8')
  }

  it('waits for a renderer handler to exist before acknowledging the matching update', async () => {
    const context = connect()
    const pending = markLocalUpdateReady(window)
    await expect.poll(() => vi.mocked(window.webContents.send).mock.calls.length).toBeGreaterThan(0)
    await expect(ack()).rejects.toThrow()
    defineInvokeHandler(context, wowLocalUpdateRendererReady, () => true)
    await pending
    expect(JSON.parse(await ack())).toEqual({ id })
    expect(ipcMain.listenerCount('eventa-message')).toBe(0)
  })

  it('does not acknowledge a mounted renderer that reports an initialization error', async () => {
    const ready = vi.fn(() => false)
    defineInvokeHandler(connect(), wowLocalUpdateRendererReady, ready)
    const pending = markLocalUpdateReady(window)
    await expect.poll(() => ready.mock.calls.length).toBeGreaterThan(0)
    await expect(ack()).rejects.toThrow()
    vi.mocked(window.isDestroyed).mockReturnValue(true)
    window.emit('closed')
    await pending
    await expect(ack()).rejects.toThrow()
  })

  it('ignores a foreign window response even when it receives the correlated readiness request', async () => {
    const foreign = new BrowserWindow()
    const legitimate = vi.fn(() => false)
    const unrelated = vi.fn(() => true)
    defineInvokeHandler(connect(), wowLocalUpdateRendererReady, legitimate)
    defineInvokeHandler(connect(foreign), wowLocalUpdateRendererReady, unrelated)
    const nativeSend = vi.mocked(window.webContents.send).getMockImplementation()!
    vi.mocked(window.webContents.send).mockImplementation((channel, ...args) => {
      nativeSend(channel, ...args)
      foreign.webContents.send(channel, ...args)
    })
    const pending = markLocalUpdateReady(window)
    await expect.poll(() => unrelated.mock.calls.length).toBeGreaterThan(0)
    await expect.poll(() => legitimate.mock.calls.length).toBeGreaterThan(0)
    await expect(ack()).rejects.toThrow()
    legitimate.mockReturnValue(true)
    await pending
    expect(JSON.parse(await ack())).toEqual({ id })
  })

  it('writes a separate rollback acknowledgment only for the old executable', async () => {
    vi.stubEnv('APP_COMPANION_UPDATE_ID', '')
    vi.stubEnv('APP_COMPANION_ROLLBACK_ID', id)
    await saveJob(join(directory, 'new', 'wow-companion.exe'))
    defineInvokeHandler(connect(), wowLocalUpdateRendererReady, () => true)
    await markLocalUpdateReady(window)
    expect(JSON.parse(await ack(true))).toEqual({ id })
    await expect(ack()).rejects.toThrow()
  })

  it.each(['job-id', 'new-executable', 'old-executable', 'unpackaged'])('rejects an unrelated %s before asking the renderer', async (mismatch) => {
    if (mismatch === 'job-id')
      await saveJob(process.execPath, process.execPath, randomUUID())
    if (mismatch === 'new-executable')
      await saveJob(join(directory, 'different.exe'))
    if (mismatch === 'old-executable') {
      vi.stubEnv('APP_COMPANION_ROLLBACK_ID', id)
      await saveJob(process.execPath, join(directory, 'different.exe'))
    }
    if (mismatch === 'unpackaged')
      host.packaged = false
    defineInvokeHandler(connect(), wowLocalUpdateRendererReady, () => true)
    await markLocalUpdateReady(window)
    expect(window.webContents.send).not.toHaveBeenCalled()
    await expect(ack()).rejects.toThrow()
    await expect(ack(true)).rejects.toThrow()
  })
})

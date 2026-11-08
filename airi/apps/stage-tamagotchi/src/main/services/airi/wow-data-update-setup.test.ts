import type { MockInstance } from 'vitest'

import type { WowDataUpdateStatus } from '../../../shared/wow-data-update'

import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wowDataUpdateCheck, wowDataUpdateChooseGame, wowDataUpdateGet } from '../../../shared/eventa/wow-data-update'
import { setupWowDataUpdate } from './wow-data-update'

import * as lifecycle from '../../libs/bootkit/lifecycle'

const boundary = vi.hoisted(() => {
  const status: WowDataUpdateStatus = {
    config: { gameRoot: null, toolsRoot: null },
    discovery: { build: null, previousBuild: null, changed: false, checkedAt: null },
    checks: [],
    job: null,
    snapshots: [],
    activeSnapshotId: null,
    activeSelection: 'none',
    activeSource: null,
  }
  return {
    getPath: vi.fn(() => 'unused-user-data'),
    getAppPath: vi.fn(() => 'unused-app-path'),
    showOpenDialog: vi.fn<() => Promise<{ canceled: boolean, filePaths: string[] }>>(),
    construct: vi.fn(),
    startMonitoring: vi.fn(),
    dispose: vi.fn(async () => {}),
    status: vi.fn(async () => status),
    check: vi.fn(async () => status),
    configure: vi.fn(async () => status),
  }
})

vi.mock('electron', () => ({ app: { getPath: boundary.getPath, getAppPath: boundary.getAppPath }, dialog: { showOpenDialog: boundary.showOpenDialog } }))
vi.mock('./wow-data-update-service', () => ({
  WowDataUpdateService: class {
    constructor(paths: unknown, database: unknown) { boundary.construct(paths, database) }
    startMonitoring = boundary.startMonitoring
    dispose = boundary.dispose
    status = boundary.status
    check = boundary.check
    configure = boundary.configure
  },
}))

describe('optional data-update IPC ownership', () => {
  let context: ReturnType<typeof createContext>
  let registered: MockInstance<typeof lifecycle.onAppBeforeQuit>
  let quitEmitted: boolean

  async function quit() {
    if (!quitEmitted) {
      quitEmitted = true
      await lifecycle.emitAppBeforeQuit()
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    quitEmitted = false
    registered = vi.spyOn(lifecycle, 'onAppBeforeQuit')
    context = createContext()
    // The setup passes this opaque database owner through without using it.
    setupWowDataUpdate(context as never, {} as never)
  })

  afterEach(async () => {
    await quit()
    for (const result of registered.mock.results) {
      if (result.type === 'return')
        result.value()
    }
    vi.restoreAllMocks()
  })

  it('registers handlers without constructing, monitoring or discovering application paths', async () => {
    expect(context.listeners.size).toBeGreaterThan(0)
    expect(boundary.construct).not.toHaveBeenCalled()
    expect(boundary.startMonitoring).not.toHaveBeenCalled()
    expect(boundary.getPath).not.toHaveBeenCalled()
    expect(boundary.getAppPath).not.toHaveBeenCalled()
    await quit()
    expect(boundary.construct).not.toHaveBeenCalled()
    expect(boundary.dispose).not.toHaveBeenCalled()
    expect([...context.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
  })

  it('constructs one owner and starts monitoring once on the first real request', async () => {
    const get = defineInvoke(context, wowDataUpdateGet)
    const check = defineInvoke(context, wowDataUpdateCheck)
    await Promise.all([get(), get(), check()])
    expect(boundary.construct).toHaveBeenCalledTimes(1)
    expect(boundary.startMonitoring).toHaveBeenCalledTimes(1)
    expect(boundary.status).toHaveBeenCalledTimes(2)
    expect(boundary.check).toHaveBeenCalledTimes(1)
    await quit()
    expect(boundary.dispose).toHaveBeenCalledTimes(1)
    expect([...context.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
  })

  it.each([false, true])('cannot construct another owner after quit, previously opened=%s', async (opened) => {
    const get = defineInvoke(context, wowDataUpdateGet)
    if (opened)
      await get()
    await quit()
    await expect(get(undefined, { signal: AbortSignal.timeout(20) })).rejects.toThrow()
    expect(boundary.construct).toHaveBeenCalledTimes(opened ? 1 : 0)
    expect(boundary.startMonitoring).toHaveBeenCalledTimes(opened ? 1 : 0)
    expect(boundary.dispose).toHaveBeenCalledTimes(opened ? 1 : 0)
  })

  it('discards a native picker result that arrives after quit', async () => {
    let select!: (value: { canceled: boolean, filePaths: string[] }) => void
    const selection = new Promise<{ canceled: boolean, filePaths: string[] }>((resolve) => {
      select = resolve
    })
    boundary.showOpenDialog.mockReturnValueOnce(selection)
    const pending = defineInvoke(context, wowDataUpdateChooseGame)()
    const rejected = expect(pending).rejects.toThrow('Data update tool stopped')
    await vi.waitFor(() => expect(boundary.showOpenDialog).toHaveBeenCalledTimes(1))
    await quit()
    expect(boundary.dispose).toHaveBeenCalledTimes(1)
    select({ canceled: false, filePaths: ['unused-selected-folder'] })
    await rejected
    expect(boundary.configure).not.toHaveBeenCalled()
    expect(boundary.status).not.toHaveBeenCalled()
    expect(boundary.construct).toHaveBeenCalledTimes(1)
  })
})

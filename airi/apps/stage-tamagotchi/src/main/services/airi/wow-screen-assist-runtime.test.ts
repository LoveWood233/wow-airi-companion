import type { GameCapturePlatform, GameCaptureWindow } from './wow-screen-assist-runtime'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScreenCaptureFailure, WowScreenCapture } from './wow-screen-assist-runtime'

const retail: GameCaptureWindow = {
  handle: '12345',
  processId: 100,
  processStartedAt: '45678',
  path: 'C:\\Games\\_retail_\\Wow.exe',
  title: 'World of Warcraft',
  game: 'retail',
  minimized: false,
  visible: true,
}

function platform(): GameCapturePlatform {
  return {
    supported: true,
    discover: vi.fn(async () => [{ ...retail }]),
    verify: vi.fn(async () => {}),
    capture: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,dGVzdA==', width: 1920, height: 1080, capturedAt: 123456 })),
  }
}

afterEach(() => vi.useRealTimers())

describe('game screenshot ownership', () => {
  it('captures and rechecks the unique verified game for each request without reusing a previous image', async () => {
    const os = platform()
    const capture = new WowScreenCapture(os)
    expect(await capture.capture({})).toEqual({ ok: true, image: {
      dataUrl: 'data:image/jpeg;base64,dGVzdA==',
      width: 1920,
      height: 1080,
      capturedAt: 123456,
      game: 'retail',
      windowTitle: 'World of Warcraft',
    } })
    expect(os.verify).toHaveBeenCalledWith(retail, 'retail')
    expect(os.discover).toHaveBeenCalledTimes(3)
    vi.mocked(os.capture).mockRejectedValueOnce(new ScreenCaptureFailure('empty-frame'))
    expect(await capture.capture({})).toEqual({ ok: false, code: 'empty-frame' })
    expect(os.capture).toHaveBeenCalledTimes(2)
  })

  it('does not discover unsupported systems or accept renderer paths and desktop source IDs', async () => {
    const os = platform()
    const capture = new WowScreenCapture(os)
    expect(await capture.capture({ sourceId: 'screen:0:0' })).toEqual({ ok: false, code: 'invalid-request' })
    expect(await capture.capture({ game: 'retail', path: retail.path })).toEqual({ ok: false, code: 'invalid-request' })
    expect(os.discover).not.toHaveBeenCalled()
    os.supported = false
    expect(await capture.capture({})).toEqual({ ok: false, code: 'unsupported-platform' })
    expect(os.discover).not.toHaveBeenCalled()
  })

  it('reports no game and multiple windows without capturing another application', async () => {
    const os = platform()
    const capture = new WowScreenCapture(os)
    vi.mocked(os.discover).mockResolvedValueOnce([])
    expect(await capture.capture({})).toEqual({ ok: false, code: 'game-not-found' })
    vi.mocked(os.discover).mockResolvedValueOnce([retail, { ...retail, handle: '67890' }])
    expect(await capture.capture({})).toEqual({ ok: false, code: 'ambiguous-window' })
    expect(os.capture).not.toHaveBeenCalled()
  })

  it('selects an explicit version when two versions are running', async () => {
    const os = platform()
    const classic: GameCaptureWindow = { ...retail, handle: '67890', game: 'classic', path: 'C:\\Games\\_classic_\\WowClassic.exe' }
    vi.mocked(os.discover).mockResolvedValue([retail, classic])
    const result = await new WowScreenCapture(os).capture({ game: 'classic' })
    expect(result.ok).toBe(true)
    expect(os.capture).toHaveBeenCalledWith(classic)
  })

  it.each([{ minimized: true }, { visible: false }])('rejects an unavailable window before signature checks: %s', async (change) => {
    const os = platform()
    vi.mocked(os.discover).mockResolvedValue([{ ...retail, ...change }])
    expect(await new WowScreenCapture(os).capture({})).toEqual({ ok: false, code: 'minimized-window' })
    expect(os.verify).not.toHaveBeenCalled()
    expect(os.capture).not.toHaveBeenCalled()
  })

  it('rejects a failed executable check without reading pixels', async () => {
    const os = platform()
    vi.mocked(os.verify).mockRejectedValue(new ScreenCaptureFailure('unverified-game'))
    expect(await new WowScreenCapture(os).capture({})).toEqual({ ok: false, code: 'unverified-game' })
    expect(os.capture).not.toHaveBeenCalled()
  })

  it('rechecks minimized state after signature verification before reading pixels', async () => {
    const os = platform()
    vi.mocked(os.discover).mockResolvedValueOnce([retail]).mockResolvedValue([{ ...retail, minimized: true }])
    expect(await new WowScreenCapture(os).capture({})).toEqual({ ok: false, code: 'minimized-window' })
    expect(os.capture).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'closed window', after: [] },
    { name: 'changed process', after: [{ ...retail, processId: 101 }] },
    { name: 'reused process ID', after: [{ ...retail, processStartedAt: '99999' }] },
    { name: 'changed executable', after: [{ ...retail, path: 'C:\\Other\\Wow.exe' }] },
  ])('discards captured pixels after $name', async ({ after }) => {
    const os = platform()
    vi.mocked(os.discover).mockResolvedValueOnce([retail]).mockResolvedValueOnce([retail]).mockResolvedValueOnce(after)
    expect(await new WowScreenCapture(os).capture({})).toEqual({ ok: false, code: 'window-changed' })
    expect(os.capture).toHaveBeenCalledOnce()
  })

  it('returns a timeout, keeps the native operation locked, and discards its late result', async () => {
    vi.useFakeTimers()
    const os = platform()
    let finish: (() => void) | undefined
    vi.mocked(os.verify).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const capture = new WowScreenCapture(os)
    const request = capture.capture({})
    await vi.advanceTimersByTimeAsync(30001)
    expect(await request).toEqual({ ok: false, code: 'capture-timeout' })
    expect(await capture.capture({})).toEqual({ ok: false, code: 'busy' })
    finish?.()
    await vi.advanceTimersByTimeAsync(1)
    expect(os.capture).not.toHaveBeenCalled()
    expect((await capture.capture({})).ok).toBe(true)
  })
})

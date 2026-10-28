import type { GameCaptureWindow } from './wow-screen-assist-runtime'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WindowsGameCapture } from './wow-screen-assist-windows'

const electron = vi.hoisted(() => ({ getSources: vi.fn() }))
vi.mock('electron', () => ({ desktopCapturer: { getSources: electron.getSources } }))

const window: GameCaptureWindow = {
  handle: '123', processId: 100, processStartedAt: '45678', path: 'C:\\Games\\_retail_\\Wow.exe',
  title: 'World of Warcraft', game: 'retail', minimized: false, visible: true,
}

function thumbnail(width = 1920, height = 1080, pixels = Buffer.from([0, 0, 0, 255, 200, 210, 220, 255])) {
  const frame = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width, height })),
    toBitmap: vi.fn(() => pixels),
    toJPEG: vi.fn(() => Buffer.from('jpeg-test')),
    resize: vi.fn(),
  }
  frame.resize.mockImplementation((options: { width: number, height: number }) => thumbnail(options.width, options.height, pixels))
  return frame
}

beforeEach(() => electron.getSources.mockReset())

describe('Windows game frame capture', () => {
  it('selects only the verified native window handle, even when another source has the same title', async () => {
    const other = thumbnail()
    const game = thumbnail()
    electron.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'World of Warcraft', thumbnail: other },
      { id: 'window:999:0', name: 'World of Warcraft', thumbnail: other },
      { id: 'window:123:0', name: 'World of Warcraft', thumbnail: game },
    ])
    const start = Date.now()
    const image = await new WindowsGameCapture().capture(window)
    expect(electron.getSources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false })
    expect(image.dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg-test').toString('base64')}`)
    expect(image.capturedAt).toBeGreaterThanOrEqual(start)
    expect(other.toJPEG).not.toHaveBeenCalled()
    expect(game.toJPEG).toHaveBeenCalledWith(85)
  })

  it('does not use a desktop or a matching title when the game window is missing', async () => {
    const other = thumbnail()
    electron.getSources.mockResolvedValue([{ id: 'screen:0:0', name: 'World of Warcraft', thumbnail: other }])
    await expect(new WindowsGameCapture().capture(window)).rejects.toThrow('window-changed')
    expect(other.toJPEG).not.toHaveBeenCalled()
  })

  it('rejects empty, undersized, and black GPU frames', async () => {
    const empty = thumbnail()
    empty.isEmpty.mockReturnValue(true)
    for (const frame of [empty, thumbnail(100, 50), thumbnail(1920, 1080, Buffer.from([0, 0, 0, 255]))]) {
      electron.getSources.mockResolvedValue([{ id: 'window:123:0', thumbnail: frame }])
      await expect(new WindowsGameCapture().capture(window)).rejects.toThrow('empty-frame')
    }
  })

  it('caps oversized native thumbnails and rejects excessive image allocations', async () => {
    electron.getSources.mockResolvedValue([{ id: 'window:123:0', thumbnail: thumbnail(3840, 2160) }])
    const frame = await new WindowsGameCapture().capture(window)
    expect(frame.width).toBe(1920)
    expect(frame.height).toBe(1080)
    electron.getSources.mockResolvedValue([{ id: 'window:123:0', thumbnail: thumbnail(99999, 99999) }])
    await expect(new WindowsGameCapture().capture(window)).rejects.toThrow('capture-failed')
  })
})

import { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { resizeBoundsByDelta, setWindowAlwaysOnTop, toggleWindowShow } from './window'

const mocks = vi.hoisted(() => ({
  isMacOS: false,
  isWindows: false,
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
  BrowserWindow: class {
    private visible = false
    isDestroyed = vi.fn(() => false)
    isMinimized = vi.fn(() => false)
    isVisible = vi.fn(() => this.visible)
    webContents = {
      isDestroyed: vi.fn(() => false),
      isCrashed: vi.fn(() => false),
    }

    show = vi.fn(() => { this.visible = true })
    hide = vi.fn(() => { this.visible = false })
    focus = vi.fn()
    restore = vi.fn(() => { this.isMinimized.mockReturnValue(false) })
  },
}))

vi.mock('std-env', () => ({
  get isMacOS() {
    return mocks.isMacOS
  },
  get isWindows() {
    return mocks.isWindows
  },
}))

vi.mock('../../services/electron', () => ({
  createAppService: vi.fn(),
  createPowerMonitorService: vi.fn(),
  createScreenService: vi.fn(),
  createSystemPreferencesService: vi.fn(),
  createWindowService: vi.fn(),
}))

describe('toggleWindowShow', () => {
  it.each([
    ['hidden', false, false],
    ['already visible', true, false],
    ['minimized', true, true],
  ] as const)('shows and focuses a %s settings window', (_state, visible, minimized) => {
    const window = new BrowserWindow()
    if (visible)
      window.show()
    vi.mocked(window.show).mockClear()
    vi.mocked(window.isMinimized).mockReturnValue(minimized)

    toggleWindowShow(window)

    expect(window.isVisible()).toBe(true)
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.hide).not.toHaveBeenCalled()
    if (minimized) {
      expect(window.restore).toHaveBeenCalledOnce()
      expect(vi.mocked(window.restore).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(window.show).mock.invocationCallOrder[0]!)
    }
    else {
      expect(window.restore).not.toHaveBeenCalled()
    }
  })
})

describe('setWindowAlwaysOnTop', () => {
  it('disables always-on-top when flag is false', () => {
    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, false)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  it('applies standard always-on-top on Linux', () => {
    mocks.isMacOS = false
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('applies screen-saver level and relative offset on macOS', () => {
    mocks.isMacOS = true
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 1)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
  })

  it('applies screen-saver level and relative offset on Windows', () => {
    mocks.isMacOS = false
    mocks.isWindows = true

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 2)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 2)
  })
})

describe('resizeBoundsByDelta', () => {
  it('keeps the opposite corner still while a corner grip is dragged', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: -20, deltaY: -30, direction: 'nw' }))
      .toEqual({ x: 80, y: 70, width: 420, height: 530 })
    expect(resizeBoundsByDelta(bounds, { deltaX: 20, deltaY: 30, direction: 'se' }))
      .toEqual({ x: 100, y: 100, width: 420, height: 530 })
  })

  it('stops at the minimum size and keeps the opposite edges still', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: 1000, deltaY: 1000, direction: 'nw', minWidth: 300, minHeight: 250 }))
      .toEqual({ x: 200, y: 350, width: 300, height: 250 })
  })
})

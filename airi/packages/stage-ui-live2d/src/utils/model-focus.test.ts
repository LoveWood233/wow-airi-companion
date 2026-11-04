import type { IPointData } from '@pixi/math'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

import { describe, expect, it, vi } from 'vitest'

import { focusLive2DModelAt } from './model-focus'

function createModel() {
  const focus = vi.fn()
  const toLocal = vi.fn((position: IPointData) => ({ ...position }))
  const applyInverse = vi.fn((position: IPointData, result: IPointData) => {
    result.x = position.x
    result.y = position.y
    return result
  })
  const model = {
    toLocal,
    internalModel: {
      originalWidth: 600,
      originalHeight: 800,
      localTransform: { applyInverse },
      focusController: { focus },
    },
  } as unknown as Live2DModel
  return { model, focus, toLocal, applyInverse }
}

describe('model pointer focus', () => {
  it('keeps the exact center neutral', () => {
    const { model, focus } = createModel()

    // ROOT CAUSE:
    // SDK focus() converted the center into a full-strength direction with atan2 and cos/sin.
    // The application now preserves normalized pointer distance before it updates the focus controller.
    focusLive2DModelAt(model, { x: 300, y: 400 })

    expect(focus).toHaveBeenCalledWith(0, 0, false)
  })

  it('preserves small movements near the center', () => {
    const { model, focus } = createModel()

    focusLive2DModelAt(model, { x: 303, y: 396 })

    const [x, y] = focus.mock.lastCall!
    expect(x).toBeCloseTo(0.01)
    expect(y).toBeCloseTo(0.01)
  })

  it.each([
    [{ x: 0, y: 400 }, -1, 0],
    [{ x: 600, y: 400 }, 1, 0],
    [{ x: 300, y: 0 }, 0, 1],
    [{ x: 300, y: 800 }, 0, -1],
    [{ x: -300, y: 1200 }, -1, -1],
  ] as const)('maps the pointer %o onto bounded focus (%s, %s)', (position, x, y) => {
    const { model, focus } = createModel()

    focusLive2DModelAt(model, position)

    expect(focus).toHaveBeenCalledWith(x, y, false)
  })

  it('applies container and model-layout transforms before normalization', () => {
    const { model, focus, toLocal, applyInverse } = createModel()
    toLocal.mockImplementation(position => ({
      x: (position.x - 100) / 2,
      y: (position.y - 200) / 2,
    }))
    applyInverse.mockImplementation((position, result) => {
      result.x = position.x - 20
      result.y = position.y - 30
      return result
    })

    focusLive2DModelAt(model, { x: 740, y: 1060 }, true)

    expect(model.toLocal).toHaveBeenCalledWith({ x: 740, y: 1060 })
    expect(focus).toHaveBeenCalledWith(0, 0, true)
  })
})

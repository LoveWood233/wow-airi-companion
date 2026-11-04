import type { IPointData } from '@pixi/math'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

/**
 * Sets a world-space pointer target without losing its distance from the model center.
 * The model center maps to neutral focus, with each axis clamped to [-1, 1].
 *
 * @param instant - Apply the target immediately instead of interpolating. @default false
 * @example
 * // For a 600-by-800 model with identity transforms:
 * focusLive2DModelAt(model, { x: 300, y: 400 })
 * // => focusController target (0, 0)
 */
export function focusLive2DModelAt(model: Live2DModel, position: IPointData, instant = false) {
  // NOTICE:
  // SDK 0.4.0 focus() projects every pointer onto a unit circle, including its center.
  // See pixi-live2d-display/dist/cubism4.es.js, Live2DModel.focus.
  // The container and layout transforms preserve pointer distance and allow neutral focus.
  // Remove this adapter when the SDK preserves neutral and near-center focus positions.
  const point = model.toLocal(position)
  model.internalModel.localTransform.applyInverse(point, point)

  const x = point.x / model.internalModel.originalWidth * 2 - 1
  const y = 1 - point.y / model.internalModel.originalHeight * 2
  model.internalModel.focusController.focus(
    Math.min(1, Math.max(-1, x)),
    Math.min(1, Math.max(-1, y)),
    instant,
  )
}

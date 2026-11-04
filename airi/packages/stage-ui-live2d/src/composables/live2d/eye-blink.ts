import type { Cubism4MotionManager } from 'pixi-live2d-display/cubism4'
import type { Ref } from 'vue'

import type { MotionManagerPlugin, MotionManagerPluginContext } from './motion-manager'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Cubism 4 JSON motions expose authored parameter curves after loading. */
function motionControlsEye(manager: MotionManagerPluginContext['motionManager'], id: 'ParamEyeLOpen' | 'ParamEyeROpen') {
  if (manager.motionDataType !== 'json')
    return false

  const { currentGroup, currentIndex } = manager.state
  if (currentGroup === undefined || currentIndex === undefined)
    return false

  const motion = (manager as Cubism4MotionManager).motionGroups[currentGroup]?.[currentIndex]
  return motion?._motionData.curves.some(curve => curve.id === id) ?? false
}

/** Applies automatic blinks without replacing an idle motion's authored eye shape. */
export function useMotionUpdatePluginAutoEyeBlink(
  live2dExpressionEnabled?: Ref<boolean>,
): MotionManagerPlugin {
  const blinkState = {
    phase: 'idle' as 'idle' | 'closing' | 'opening',
    progress: 0,
    startLeft: 1,
    startRight: 1,
    delayMs: 0,
    openDurationMs: 300,
  }

  // Eye values captured at blink start.  Used as the base during
  // closing/opening so that models without eye motion curves don't
  // get stuck at 0 (since 0 × factor = 0 forever).
  let preBlinkLeft = 1.0
  let preBlinkRight = 1.0
  const blinkCloseDuration = 75 // ms
  const minBlinkOpenDuration = 150 // ms
  const maxBlinkOpenDuration = 300 // ms
  const minDelay = 3000
  const maxDelay = 8000

  const randomBlinkOpenDuration = () => minBlinkOpenDuration + Math.random() * (maxBlinkOpenDuration - minBlinkOpenDuration)

  function resetBlinkState() {
    blinkState.phase = 'idle'
    blinkState.progress = 0
    blinkState.delayMs = minDelay + Math.random() * (maxDelay - minDelay)
  }
  resetBlinkState()

  function easeOutQuad(t: number) {
    return 1 - (1 - t) * (1 - t)
  }
  function easeInQuad(t: number) {
    return t * t
  }

  function updateForcedBlink(dt: number, baseLeft: number, baseRight: number) {
    // Idle: count down delay to next blink.
    if (blinkState.phase === 'idle') {
      blinkState.delayMs = Math.max(0, blinkState.delayMs - dt)
      if (blinkState.delayMs === 0) {
        blinkState.phase = 'closing'
        blinkState.progress = 0
        blinkState.startLeft = baseLeft
        blinkState.startRight = baseRight
      }

      return { eyeLOpen: baseLeft, eyeROpen: baseRight }
    }

    // Closing: move toward zero with ease-out.
    if (blinkState.phase === 'closing') {
      blinkState.progress = Math.min(1, blinkState.progress + dt / blinkCloseDuration)
      const eased = easeOutQuad(blinkState.progress)
      const eyeLOpen = clamp01(blinkState.startLeft * (1 - eased))
      const eyeROpen = clamp01(blinkState.startRight * (1 - eased))

      if (blinkState.progress >= 1) {
        blinkState.phase = 'opening'
        blinkState.progress = 0
        blinkState.openDurationMs = randomBlinkOpenDuration()
      }

      return { eyeLOpen, eyeROpen }
    }

    // Opening: move back to the base with ease-in.
    blinkState.progress = Math.min(1, blinkState.progress + dt / blinkState.openDurationMs)
    const eased = easeInQuad(blinkState.progress)
    const eyeLOpen = clamp01(blinkState.startLeft * eased)
    const eyeROpen = clamp01(blinkState.startRight * eased)

    if (blinkState.progress >= 1) {
      resetBlinkState()
    }

    return { eyeLOpen, eyeROpen }
  }

  return (ctx) => {
    // Without expressions, the configured eye openness remains the default baseline.
    if (!live2dExpressionEnabled?.value) {
      if (!ctx.isIdleMotion || (ctx.handled && !ctx.live2dForceAutoBlinkEnabled.value))
        return

      const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
      const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

      // Disabling automatic blink keeps the configured static eye openness.
      if (!ctx.live2dAutoBlinkEnabled.value) {
        resetBlinkState()
        ctx.model.setParameterValueById('ParamEyeLOpen', baseLeft)
        ctx.model.setParameterValueById('ParamEyeROpen', baseRight)
        ctx.markHandled()
        return
      }

      // Curves write fresh values each frame. Unanimated eyes retain the previous blink,
      // so only authored eyes can provide the baseline without feedback decay.
      if (ctx.live2dForceAutoBlinkEnabled.value || !ctx.internalModel.eyeBlink) {
        const motionLeft = motionControlsEye(ctx.motionManager, 'ParamEyeLOpen')
          ? clamp01(ctx.model.getParameterValueById('ParamEyeLOpen'))
          : 1
        const motionRight = motionControlsEye(ctx.motionManager, 'ParamEyeROpen')
          ? clamp01(ctx.model.getParameterValueById('ParamEyeROpen'))
          : 1
        const safeDt = ctx.timeDelta * 1000 || 16
        const { eyeLOpen, eyeROpen } = updateForcedBlink(safeDt, 1, 1)
        ctx.model.setParameterValueById('ParamEyeLOpen', motionLeft * eyeLOpen * baseLeft)
        ctx.model.setParameterValueById('ParamEyeROpen', motionRight * eyeROpen * baseRight)
        ctx.markHandled()
        return
      }

      // SDK eyeBlink path: explicit call → read back → multiply by base → markHandled.
      ctx.internalModel.eyeBlink!.updateParameters(ctx.model, ctx.timeDelta / 1000)
      const blinkLeft = ctx.model.getParameterValueById('ParamEyeLOpen') as number
      const blinkRight = ctx.model.getParameterValueById('ParamEyeROpen') as number
      ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(blinkLeft * baseLeft))
      ctx.model.setParameterValueById('ParamEyeROpen', clamp01(blinkRight * baseRight))
      ctx.markHandled()
      return
    }

    // Non-idle motions own their eye curves.
    if (!ctx.isIdleMotion)
      return

    const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
    const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

    // Auto-blink OFF: apply manual base values only (multiply with current).
    if (!ctx.live2dAutoBlinkEnabled.value) {
      resetBlinkState()
      const currentLeft = ctx.model.getParameterValueById('ParamEyeLOpen') as number
      const currentRight = ctx.model.getParameterValueById('ParamEyeROpen') as number
      ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(currentLeft * baseLeft))
      ctx.model.setParameterValueById('ParamEyeROpen', clamp01(currentRight * baseRight))
      return
    }

    // A live SDK eye-blink controller owns blinking when force mode is off.
    if (!ctx.live2dForceAutoBlinkEnabled.value && ctx.internalModel.eyeBlink != null) {
      resetBlinkState()
      const currentLeft = ctx.model.getParameterValueById('ParamEyeLOpen') as number
      const currentRight = ctx.model.getParameterValueById('ParamEyeROpen') as number
      ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(currentLeft * baseLeft))
      ctx.model.setParameterValueById('ParamEyeROpen', clamp01(currentRight * baseRight))
      return
    }

    const currentLeft = ctx.model.getParameterValueById('ParamEyeLOpen') as number
    const currentRight = ctx.model.getParameterValueById('ParamEyeROpen') as number

    // Closed expressions remain closed until their owner opens them.
    const BLINK_THRESHOLD = 0.15
    if (blinkState.phase === 'idle' && currentLeft <= BLINK_THRESHOLD && currentRight <= BLINK_THRESHOLD) {
      resetBlinkState()
      return
    }

    // Track post-expression eye values during idle as the blink baseline.
    if (blinkState.phase === 'idle') {
      preBlinkLeft = currentLeft
      preBlinkRight = currentRight
    }

    // Authored eyes advance during a blink. Unanimated eyes need their captured baseline to reopen.
    const motionLeft = motionControlsEye(ctx.motionManager, 'ParamEyeLOpen') ? currentLeft : preBlinkLeft
    const motionRight = motionControlsEye(ctx.motionManager, 'ParamEyeROpen') ? currentRight : preBlinkRight

    // Advance blink timer.
    const wasActive = blinkState.phase !== 'idle'
    const safeDt = ctx.timeDelta * 1000 || 16
    const { eyeLOpen: blinkFactorL, eyeROpen: blinkFactorR } = updateForcedBlink(safeDt, 1.0, 1.0)

    // A completed blink returns to the current authored shape or the captured static shape.
    if (wasActive && blinkState.phase === 'idle') {
      ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(motionLeft * baseLeft))
      ctx.model.setParameterValueById('ParamEyeROpen', clamp01(motionRight * baseRight))
      return
    }

    // Idle: don't write (avoids feedback-loop decay).
    if (blinkState.phase === 'idle')
      return

    ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(motionLeft * blinkFactorL * baseLeft))
    ctx.model.setParameterValueById('ParamEyeROpen', clamp01(motionRight * blinkFactorR * baseRight))
  }
}

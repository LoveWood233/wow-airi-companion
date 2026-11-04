import type { MotionManagerPluginContext } from './motion-manager'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useMotionUpdatePluginAutoEyeBlink } from './eye-blink'

function createContext(curveIds: string[] = []) {
  const values = new Map<string, number>([['ParamEyeLOpen', 1], ['ParamEyeROpen', 1]])
  const model = {
    getParameterValueById: vi.fn((id: string) => values.get(id) ?? 0),
    setParameterValueById: vi.fn((id: string, value: number) => values.set(id, value)),
  } as unknown as MotionManagerPluginContext['model']
  const context: MotionManagerPluginContext = {
    model,
    now: 0,
    timeDelta: 1 / 60,
    internalModel: { coreModel: model } as unknown as MotionManagerPluginContext['internalModel'],
    motionManager: {
      motionDataType: 'json',
      state: { currentGroup: 'Idle', currentIndex: 0 },
      groups: { idle: 'Idle' },
      motionGroups: { Idle: [{ _motionData: { curves: curveIds.map(id => ({ id })) } }] },
    } as unknown as MotionManagerPluginContext['motionManager'],
    modelParameters: ref({ leftEyeOpen: 1, rightEyeOpen: 1 }),
    live2dEyeTrackingEnabled: ref(true),
    live2dEyeFocusSourceActive: ref(true),
    live2dIdleAnimationEnabled: ref(true),
    live2dForceIdleEyeAnimation: ref(true),
    live2dAutoBlinkEnabled: ref(true),
    live2dForceAutoBlinkEnabled: ref(true),
    isIdleMotion: true,
    handled: true,
    markHandled: vi.fn(() => { context.handled = true }),
  }
  return context
}

describe('automatic eye blink', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves authored idle eyes beneath force blink', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const context = createContext(['ParamEyeLOpen', 'ParamEyeROpen'])
    const plugin = useMotionUpdatePluginAutoEyeBlink(ref(false))

    // ROOT CAUSE:
    // Force blink replaced authored idle eyes with configured static openness.
    // The blink factor now multiplies the current motion's authored eye values.
    context.model.setParameterValueById('ParamEyeLOpen', 0.3)
    context.model.setParameterValueById('ParamEyeROpen', 0.4)
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBeCloseTo(0.3)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBeCloseTo(0.4)

    context.timeDelta = 3
    plugin(context)
    context.timeDelta = 0.075
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBe(0)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBe(0)

    context.model.setParameterValueById('ParamEyeLOpen', 0.1)
    context.model.setParameterValueById('ParamEyeROpen', 0.2)
    context.timeDelta = 0.15
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBeCloseTo(0.1)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBeCloseTo(0.2)
    randomSpy.mockRestore()
  })

  it('reopens unanimated eyes after blinking without feedback decay', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const context = createContext(['ParamBreath'])
    const plugin = useMotionUpdatePluginAutoEyeBlink(ref(false))
    context.timeDelta = 3
    plugin(context)
    context.timeDelta = 0.075
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBe(0)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBe(0)

    context.timeDelta = 0.15
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBe(1)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBe(1)
    randomSpy.mockRestore()
  })

  it('uses the current authored eye shape when an expression-enabled blink ends', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const context = createContext(['ParamEyeLOpen', 'ParamEyeROpen'])
    const plugin = useMotionUpdatePluginAutoEyeBlink(ref(true))
    context.model.setParameterValueById('ParamEyeLOpen', 0.7)
    context.model.setParameterValueById('ParamEyeROpen', 0.8)
    context.timeDelta = 3
    plugin(context)
    context.timeDelta = 0.075
    plugin(context)

    context.model.setParameterValueById('ParamEyeLOpen', 0.1)
    context.model.setParameterValueById('ParamEyeROpen', 0.2)
    context.timeDelta = 0.15
    plugin(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBeCloseTo(0.1)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBeCloseTo(0.2)
  })

  it('keeps static eye settings as multipliers for individually authored eyes', () => {
    const context = createContext(['ParamEyeLOpen'])
    context.modelParameters.value.leftEyeOpen = 0.5
    context.modelParameters.value.rightEyeOpen = 0.75
    context.model.setParameterValueById('ParamEyeLOpen', 0.4)
    context.model.setParameterValueById('ParamEyeROpen', 0)

    useMotionUpdatePluginAutoEyeBlink(ref(false))(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBeCloseTo(0.2)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBeCloseTo(0.75)
  })

  it('leaves non-idle authored expressions in control of their eyes', () => {
    const context = createContext(['ParamEyeLOpen', 'ParamEyeROpen'])
    context.isIdleMotion = false
    context.model.setParameterValueById('ParamEyeLOpen', 0.1)
    context.model.setParameterValueById('ParamEyeROpen', 0.2)

    useMotionUpdatePluginAutoEyeBlink(ref(false))(context)

    expect(context.model.getParameterValueById('ParamEyeLOpen')).toBeCloseTo(0.1)
    expect(context.model.getParameterValueById('ParamEyeROpen')).toBeCloseTo(0.2)
  })
})

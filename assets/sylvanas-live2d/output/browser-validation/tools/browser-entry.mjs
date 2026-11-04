import { Application } from '@pixi/app'
import { BatchRenderer } from '@pixi/core'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { Live2DFactory, Live2DModel } from 'pixi-live2d-display/cubism4'
import 'airi-live2d-zip-loader'
import { validateLive2DZip } from 'airi-live2d-validator'
import { loadLive2DModelPreview } from 'airi-live2d-preview'

// Match the renderer plugins registered by AIRI's Canvas.vue.
extensions.add(BatchRenderer, TickerPlugin)
Live2DModel.registerTicker(Ticker)

function pixelSummary(canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let nonTransparentPixels = 0
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) nonTransparentPixels++
  }
  return { width: canvas.width, height: canvas.height, nonTransparentPixels }
}

function copyDrawables(raw) {
  return {
    vertices: Array.from(raw.drawables.vertexPositions, positions => Array.from(positions)),
    opacities: Array.from(raw.drawables.opacities),
    renderOrders: Array.from(raw.drawables.renderOrders),
  }
}

function changedDrawables(before, after, ids) {
  const changed = []
  for (let index = 0; index < ids.length; index++) {
    const vertexChanged = before.vertices[index].some((value, coordinate) => Math.abs(value - after.vertices[index][coordinate]) > 1e-7)
    const opacityChanged = Math.abs(before.opacities[index] - after.opacities[index]) > 1e-7
    const orderChanged = before.renderOrders[index] !== after.renderOrders[index]
    if (vertexChanged || opacityChanged || orderChanged) changed.push(ids[index])
  }
  return changed
}

async function renderedPreview(file) {
  const dataUrl = await loadLive2DModelPreview(file)
  if (!dataUrl?.startsWith('data:image/png;base64,')) throw new Error('AIRI preview returned no PNG')
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    const summary = pixelSummary(canvas)
    if (summary.nonTransparentPixels === 0) throw new Error('AIRI preview rendered no non-transparent pixels')
    document.querySelector('#preview').src = dataUrl
    return { ...summary, dataUrl }
  }
  finally {
    bitmap.close()
  }
}

async function inspectRuntime(file, expectedEffects, sampleStates, animationProbe) {
  const canvas = document.querySelector('#runtime')
  const app = new Application({ view: canvas, width: 1400, height: 1680, autoStart: false, sharedTicker: true, preserveDrawingBuffer: true, backgroundAlpha: 0 })
  app.ticker.stop()
  const model = new Live2DModel({ autoInteract: false, autoUpdate: false })
  try {
    await Live2DFactory.setupLive2DModel(model, [file], { autoInteract: false, autoUpdate: false })
    model.autoUpdate = false
    model.autoInteract = false
    app.stage.addChild(model)
    model.anchor.set(0.5, 0.5)
    model.position.set(700, 840)
    model.scale.set(Math.min(1300 / model.internalModel.width, 1580 / model.internalModel.height))
    const raw = model.internalModel.coreModel.getModel()
    const ids = Array.from(raw.parameters.ids)
    const defaults = Array.from(raw.parameters.defaultValues)
    const restoreDefaults = () => {
      raw.parameters.values.set(defaults)
      raw.update()
    }
    const captureFrame = () => {
      app.renderer.render(app.stage)
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      const context = copy.getContext('2d')
      context.drawImage(canvas, 0, 0)
      return { pixels: context.getImageData(0, 0, copy.width, copy.height).data, summary: pixelSummary(copy), dataUrl: copy.toDataURL('image/png') }
    }
    restoreDefaults()
    const baseline = copyDrawables(raw)
    const defaultFrame = captureFrame()
    if (defaultFrame.summary.nonTransparentPixels === 0) throw new Error('Loaded runtime model rendered no non-transparent pixels')
    const results = []
    for (const id of expectedEffects) {
      const index = ids.indexOf(id)
      if (index < 0) {
        results.push({ id, passed: false, reason: 'missing-parameter', boundaries: [] })
        continue
      }
      const boundaries = []
      for (const value of new Set([raw.parameters.minimumValues[index], raw.parameters.maximumValues[index]])) {
        restoreDefaults()
        raw.parameters.values[index] = value
        raw.update()
        const drawables = changedDrawables(baseline, copyDrawables(raw), Array.from(raw.drawables.ids))
        const frame = captureFrame()
        let changedPixelCount = 0
        for (let offset = 0; offset < frame.pixels.length; offset += 4) {
          if (frame.pixels[offset] !== defaultFrame.pixels[offset]
            || frame.pixels[offset + 1] !== defaultFrame.pixels[offset + 1]
            || frame.pixels[offset + 2] !== defaultFrame.pixels[offset + 2]
            || frame.pixels[offset + 3] !== defaultFrame.pixels[offset + 3]) changedPixelCount++
        }
        boundaries.push({ value, changedDrawables: drawables, changedPixelCount, ...frame.summary, dataUrl: frame.dataUrl })
      }
      results.push({ id, passed: boundaries.some(boundary => boundary.changedDrawables.length > 0 && boundary.changedPixelCount > 0), boundaries })
    }
    const sampledStates = []
    for (const state of sampleStates) {
      restoreDefaults()
      for (const [id, value] of Object.entries(state.parameters)) {
        const index = ids.indexOf(id)
        if (index < 0 || !Number.isFinite(value)) throw new Error(`Invalid sampled parameter ${id}=${value}`)
        if (value < raw.parameters.minimumValues[index] || value > raw.parameters.maximumValues[index]) throw new Error(`Sampled parameter outside range: ${id}=${value}`)
        raw.parameters.values[index] = value
      }
      raw.update()
      const frame = captureFrame()
      sampledStates.push({ name: state.name, parameters: state.parameters, ...frame.summary, dataUrl: frame.dataUrl, drawableOpacities: Array.from(raw.drawables.ids, (id, index) => ({ id, opacity: raw.drawables.opacities[index] })) })
    }
    restoreDefaults()
    let animation
    if (animationProbe) {
      const internal = model.internalModel
      const sdkBreathPresentBeforeDisable = !!internal.breath
      // Match disableLive2DSdkBreath in the recorded production source exactly.
      delete internal.breath
      internal.coreModel.saveParameters()
      const bodyIndex = Array.from(raw.drawables.ids).indexOf('Body')
      if (bodyIndex < 0) throw new Error('Body drawable missing from animation probe')
      const eyeBlinkParameterIds = internal.eyeBlink ? Array.from(internal.eyeBlink.getParameterIds()) : []
      let parametersAtRender = null
      const beforeUpdate = () => {
        parametersAtRender = Object.fromEntries(['ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY'].map(id => [id, raw.parameters.values[ids.indexOf(id)]]))
      }
      internal.on('beforeModelUpdate', beforeUpdate)
      const sampleTicker = (name, durationSeconds, captureRegularFrames) => new Promise((resolve, reject) => {
        const samples = []
        let firstBody
        let firstPixels
        let nextCapture = 0
        let blinkImageCaptured = false
        const started = performance.now()
        const deadline = setTimeout(() => { finish(); reject(new Error(`${name} ticker exceeded deadline`)) }, (durationSeconds + 12) * 1000)
        const finish = () => {
          app.ticker.remove(sample)
          app.stop()
          model.autoUpdate = false
          clearTimeout(deadline)
        }
        const sample = () => {
          try {
            if (!parametersAtRender) return
            const elapsedSeconds = (performance.now() - started) / 1000
            const bodyVertices = Array.from(raw.drawables.vertexPositions[bodyIndex])
            firstBody ??= bodyVertices.slice()
            let maximumBodyVertexDelta = 0
            for (let index = 0; index < bodyVertices.length; index++) maximumBodyVertexDelta = Math.max(maximumBodyVertexDelta, Math.abs(bodyVertices[index] - firstBody[index]))
            const xs = bodyVertices.filter((_, index) => index % 2 === 0)
            const ys = bodyVertices.filter((_, index) => index % 2 === 1)
            const entry = { elapsedSeconds, parametersAtRender: { ...parametersAtRender }, maximumBodyVertexDeltaFromFirstFrame: maximumBodyVertexDelta, bodyBounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
            if (![...bodyVertices, ...Object.values(parametersAtRender)].every(Number.isFinite)) throw new Error('Animation produced non-finite data')
            const eyeClosed = parametersAtRender.ParamEyeLOpen < 0.2 && parametersAtRender.ParamEyeROpen < 0.2
            if ((captureRegularFrames && elapsedSeconds >= nextCapture) || (!captureRegularFrames && (samples.length === 0 || (!blinkImageCaptured && eyeClosed)))) {
              const frame = captureFrame()
              firstPixels ??= frame.pixels.slice()
              let changedPixelCount = 0
              for (let offset = 0; offset < frame.pixels.length; offset += 4) {
                if (frame.pixels[offset] !== firstPixels[offset] || frame.pixels[offset + 1] !== firstPixels[offset + 1] || frame.pixels[offset + 2] !== firstPixels[offset + 2] || frame.pixels[offset + 3] !== firstPixels[offset + 3]) changedPixelCount++
              }
              const stateName = `${name}-${samples.length === 0 ? 'start' : !captureRegularFrames && eyeClosed ? 'blink' : `${nextCapture.toFixed(1)}s`}`
              entry.changedPixelCountFromFirstFrame = changedPixelCount
              entry.bodyVertices = bodyVertices
              entry.imageStateName = stateName
              sampledStates.push({ name: stateName, parameters: { ...parametersAtRender }, ...frame.summary, dataUrl: frame.dataUrl })
              if (eyeClosed) blinkImageCaptured = true
              nextCapture += 0.5
            }
            samples.push(entry)
            if (elapsedSeconds >= durationSeconds) {
              finish()
              const values = id => samples.map(sample => sample.parametersAtRender[id])
              resolve({ durationSeconds: elapsedSeconds, sampleCount: samples.length, samples, breathRange: [Math.min(...values('ParamBreath')), Math.max(...values('ParamBreath'))], leftEyeRange: [Math.min(...values('ParamEyeLOpen')), Math.max(...values('ParamEyeLOpen'))], rightEyeRange: [Math.min(...values('ParamEyeROpen')), Math.max(...values('ParamEyeROpen'))], maximumBodyVertexDelta: Math.max(...samples.map(sample => sample.maximumBodyVertexDeltaFromFirstFrame)), blinkObserved: values('ParamEyeLOpen').some(value => value < 0.2) && values('ParamEyeROpen').some(value => value < 0.2) })
            }
          }
          catch (error) { finish(); reject(error) }
        }
        model.autoUpdate = true
        app.ticker.add(sample, undefined, -30)
        app.start()
      })
      try {
        const idleStarted = await model.motion('Idle', 0, 3)
        if (!idleStarted) throw new Error('Actual Idle motion could not start')
        const idle = await sampleTicker('idle', 4, true)
        const originalIdleGroup = internal.motionManager.groups.idle
        internal.motionManager.stopAllMotions()
        // This control phase disables automatic Idle scheduling, without editing the ZIP.
        internal.motionManager.groups.idle = '__diagnostic_no_idle__'
        restoreDefaults()
        internal.coreModel.saveParameters()
        parametersAtRender = null
        const groupsBlinkControl = await sampleTicker('groups-blink-control', 8, false)
        internal.motionManager.groups.idle = originalIdleGroup
        animation = { sdkBreathPresentBeforeDisable, sdkBreathDisabledThroughout: !('breath' in internal), disableMethod: 'delete internal.breath, matching disableLive2DSdkBreath in the recorded repository source', actualSharedTicker: true, eyeBlinkParameterIds, idleStarted, idle, groupsBlinkControl, nativeBlinkDuringIdle: idle.blinkObserved, requiresAiriBlinkPluginDuringIdle: !idle.blinkObserved && groupsBlinkControl.blinkObserved, passed: idle.maximumBodyVertexDelta > 1e-7 && idle.breathRange[1] - idle.breathRange[0] > 0.5 && groupsBlinkControl.blinkObserved, limits: ['Idle phase uses the original ZIP motion with the SDK breath pass disabled.', 'Groups blink control stops Idle and disables automatic Idle scheduling in memory only.', 'AIRI motion plugins, expression preferences, storage, and full application stage are not exercised by this standalone utility harness.'] }
      }
      finally {
        internal.off('beforeModelUpdate', beforeUpdate)
        model.autoUpdate = false
        app.stop()
      }
    }
    return { parameterIds: ids, drawableIds: Array.from(raw.drawables.ids), defaultFrame: defaultFrame.summary, defaultPng: defaultFrame.dataUrl, expectedEffects: results, sampledStates, animation }
  }
  finally {
    app.stage.removeChild(model)
    if (model.internalModel) model.destroy({ texture: true, baseTexture: true })
    app.destroy(false)
  }
}

window.live2dValidation = {
  ready: true,
  probe() {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (!gl) throw new Error('WebGL is unavailable')
    const result = { coreVersion: Live2DCubismCore.Version.csmGetVersion(), webglVersion: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER) }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return result
  },
  async run({ zipUrl, filename, expectedEffects, sampleStates, animationProbe, previewRepeat }) {
    const response = await fetch(zipUrl)
    if (!response.ok) throw new Error(`ZIP request failed: ${response.status}`)
    const file = new File([await response.blob()], filename, { type: 'application/zip' })
    const validation = await validateLive2DZip(file)
    if (validation.status === 'INVALID') return { ok: false, validation, firstFailingCheckpoint: 'zip-validation' }
    let preview
    const previewRepetitions = []
    const resources = () => ({ canvasCount: document.querySelectorAll('canvas').length, sharedTickerListenerCount: Ticker.shared.count, textureCacheCount: Object.keys(window.PIXI.utils.TextureCache).length, baseTextureCacheCount: Object.keys(window.PIXI.utils.BaseTextureCache).length })
    for (let index = 0; index < previewRepeat; index++) {
      const before = resources()
      console.info(`[validation] repository-preview-${index + 1}-start`)
      preview = await renderedPreview(file)
      console.info(`[validation] repository-preview-${index + 1}-returned`)
      await new Promise(resolve => setTimeout(resolve, 50))
      const after = resources()
      previewRepetitions.push({ index: index + 1, before, after, resourcesRestored: Object.keys(before).every(key => before[key] === after[key]), image: { width: preview.width, height: preview.height, nonTransparentPixels: preview.nonTransparentPixels } })
    }
    console.info('[validation] separate-runtime-inspection-start')
    const runtime = await inspectRuntime(file, expectedEffects, sampleStates, animationProbe)
    const still = new Image()
    still.src = runtime.defaultPng
    still.alt = 'Actual runtime default frame'
    document.querySelector('#runtime').replaceWith(still)
    return { ok: previewRepetitions.every(result => result.resourcesRestored) && runtime.expectedEffects.every(result => result.passed) && (!animationProbe || runtime.animation?.passed), requiresReview: validation.status === 'WARNING', validation, preview, previewRepetitions, runtime }
  },
}

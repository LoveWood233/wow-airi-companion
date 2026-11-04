import { ref } from 'vue'
import { useMotionUpdatePluginAutoEyeBlink } from 'airi-eye-blink'
import { focusLive2DModelAt } from 'airi-model-focus'

const observedParameters = ['ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamEyeBallX', 'ParamEyeBallY']

function drawableSnapshot(raw) {
  return Array.from(raw.drawables.ids, (id, index) => ({
    id,
    vertices: Array.from(raw.drawables.vertexPositions[index]),
    opacity: raw.drawables.opacities[index],
  }))
}

function vertexDelta(before, after, names) {
  let maximum = 0
  for (const drawable of after) {
    if (!names.includes(drawable.id)) continue
    const previous = before.find(item => item.id === drawable.id)
    for (let index = 0; index < drawable.vertices.length; index++) maximum = Math.max(maximum, Math.abs(drawable.vertices[index] - previous.vertices[index]))
  }
  return maximum
}

function eyeContours(raw) {
  return Array.from(raw.drawables.ids, (id, index) => {
    if (!['EyeL', 'EyeR'].includes(id)) return undefined
    const counts = new Map()
    const indices = raw.drawables.indices[index]
    for (let offset = 0; offset < indices.length; offset += 3) {
      const [a, b, c] = indices.slice(offset, offset + 3)
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const key = [Math.min(start, end), Math.max(start, end)].join(',')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    const vertices = new Set()
    for (const [edge, count] of counts) {
      if (count === 1) edge.split(',').map(Number).forEach(vertex => vertices.add(vertex))
    }
    return { id, vertexIndices: Array.from(vertices) }
  }).filter(Boolean)
}

function contourDelta(before, after, contours) {
  let maximum = 0
  for (const contour of contours) {
    const initial = before.find(item => item.id === contour.id)
    const current = after.find(item => item.id === contour.id)
    for (const index of contour.vertexIndices) {
      maximum = Math.max(maximum, Math.abs(current.vertices[index * 2] - initial.vertices[index * 2]), Math.abs(current.vertices[index * 2 + 1] - initial.vertices[index * 2 + 1]))
    }
  }
  return maximum
}

/** Checks triangle winding and finite coordinates in an actual Core model. */
export function geometrySummary(raw) {
  let nonPositiveTriangles = 0
  let finite = true
  for (let index = 0; index < raw.drawables.ids.length; index++) {
    const vertices = raw.drawables.vertexPositions[index]
    const indices = raw.drawables.indices[index]
    finite &&= Array.from(vertices).every(Number.isFinite)
    for (let offset = 0; offset < indices.length; offset += 3) {
      const [a, b, c] = Array.from(indices.slice(offset, offset + 3), value => value * 2)
      const area = ((vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) - (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a])) / 2
      if (!Number.isFinite(area) || area < 1e-12) nonPositiveTriangles++
    }
  }
  return { finite, nonPositiveTriangles }
}

function recordCanvas(canvas) {
  const target = document.createElement('canvas')
  target.width = 600
  target.height = 760
  const context = target.getContext('2d')
  let label = 'Mouse tracking'
  const draw = () => {
    context.fillStyle = '#697589'
    context.fillRect(0, 0, target.width, target.height)
    context.drawImage(canvas, 0, 40, 600, 720)
    context.fillStyle = '#ffffff'
    context.font = '22px sans-serif'
    context.fillText(label, 18, 29)
  }
  draw()
  const stream = target.captureStream(12)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm'
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800000 })
  const chunks = []
  recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data) })
  const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }))
  const timer = setInterval(draw, 1000 / 12)
  recorder.start()
  return {
    setLabel(value) { label = value },
    async finish() {
      clearInterval(timer)
      draw()
      recorder.stop()
      await stopped
      stream.getTracks().forEach(track => track.stop())
      const blob = new Blob(chunks, { type: mimeType })
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(reader.result.slice(reader.result.indexOf(',') + 1)), { once: true })
        reader.addEventListener('error', reject, { once: true })
        reader.readAsDataURL(blob)
      })
      return { file: 'gaze-and-yawn.webm', mimeType, base64, bytes: blob.size, scope: 'Actual browser canvas recording of DOM mouse focus and one SDK Yawn motion.' }
    },
  }
}

/** Exercises real pointer events, runtime motion playback, and rendered model geometry. */
export async function inspectCompanionV2({ model, app, raw, ids, restoreDefaults, captureFrame, sampledStates, shortProbe }) {
  const gazeDefaults = Object.fromEntries(['ParamEyeBallX', 'ParamEyeBallY'].map(id => [id, raw.parameters.defaultValues[ids.indexOf(id)]]))
  if (Object.values(gazeDefaults).some(value => !Number.isFinite(value) || Math.abs(value) > 1e-6)) throw new Error(`Neutral gaze requires zero MOC defaults: ${JSON.stringify(gazeDefaults)}`)
  const internal = model.internalModel
  const manager = internal.motionManager
  const originalIdleGroup = manager.groups.idle
  const originalEyeBlink = internal.eyeBlink
  const sdkBreathPresentBeforeDisable = !!internal.breath
  delete internal.breath
  manager.stopAllMotions()
  manager.groups.idle = '__diagnostic_no_idle__'
  internal.eyeBlink = undefined
  restoreDefaults()
  internal.coreModel.saveParameters()
  const canvas = app.view
  canvas.style.width = '600px'
  canvas.style.height = '720px'
  document.querySelector('#preview').style.display = 'none'
  let atRender
  let originalMotionUpdate
  const parametersBeforeRender = () => {
    atRender = Object.fromEntries(observedParameters.map(id => [id, raw.parameters.values[ids.indexOf(id)]]))
  }
  internal.on('beforeModelUpdate', parametersBeforeRender)
  const appendFrame = (name, parameters) => {
    const frame = captureFrame()
    sampledStates.push({ name, parameters: { ...parameters }, ...frame.summary, dataUrl: frame.dataUrl })
  }
  const runTicker = (name, durationSeconds, captureTimes = []) => new Promise((resolve, reject) => {
    const samples = []
    let firstDrawables
    let nextCapture = 0
    const started = performance.now()
    const deadline = setTimeout(() => { finish(); reject(new Error(`${name} ticker exceeded its deadline`)) }, (durationSeconds + 10) * 1000)
    const finish = () => {
      app.ticker.remove(sample)
      app.stop()
      model.autoUpdate = false
      clearTimeout(deadline)
    }
    const sample = () => {
      try {
        if (!atRender) return
        const elapsedSeconds = (performance.now() - started) / 1000
        const geometry = geometrySummary(raw)
        if (!geometry.finite || geometry.nonPositiveTriangles) throw new Error(`${name} produced invalid geometry`)
        const drawables = drawableSnapshot(raw)
        firstDrawables ??= drawables
        const entry = { elapsedSeconds, parameters: { ...atRender }, geometry, maximumBodyVertexDelta: vertexDelta(firstDrawables, drawables, ['Body']), maximumMouthVertexDelta: vertexDelta(firstDrawables, drawables, ['MouthOpen']), maximumEyeVertexDelta: vertexDelta(firstDrawables, drawables, ['EyeL', 'EyeR']) }
        if (nextCapture < captureTimes.length && elapsedSeconds >= captureTimes[nextCapture]) {
          entry.imageStateName = `${name}-${captureTimes[nextCapture].toFixed(2)}s`
          appendFrame(entry.imageStateName, entry.parameters)
          nextCapture++
        }
        samples.push(entry)
        if (elapsedSeconds >= durationSeconds) {
          finish()
          const ranges = Object.fromEntries(observedParameters.map(id => [id, [Math.min(...samples.map(sample => sample.parameters[id])), Math.max(...samples.map(sample => sample.parameters[id]))]]))
          resolve({ name, durationSeconds: elapsedSeconds, actualSharedTicker: true, sampleCount: samples.length, ranges, first: samples[0], last: samples.at(-1), samples, maximumBodyVertexDelta: Math.max(...samples.map(sample => sample.maximumBodyVertexDelta)), maximumMouthVertexDelta: Math.max(...samples.map(sample => sample.maximumMouthVertexDelta)), motionFinished: manager.isFinished() })
        }
      }
      catch (error) { finish(); reject(error) }
    }
    atRender = undefined
    model.autoUpdate = true
    app.ticker.add(sample, undefined, -30)
    app.start()
  })
  const recording = recordCanvas(canvas)
  let recordingFinished = false
  try {
    const baseline = drawableSnapshot(raw)
    const contours = eyeContours(raw)
    const pointerSamples = []
    const focusToPointer = (event) => {
      const bounds = canvas.getBoundingClientRect()
      focusLive2DModelAt(model, { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height }, true)
    }
    canvas.addEventListener('pointermove', focusToPointer)
    try {
      for (const [index, [x, y]] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0.01, 0.01], [-0.01, -0.01]].entries()) {
        restoreDefaults()
        internal.coreModel.saveParameters()
        const bounds = canvas.getBoundingClientRect()
        const clientX = bounds.left + bounds.width * (0.5 + x * 0.42)
        const clientY = bounds.top + bounds.height * (0.5 - y * 0.42)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { canvas.removeEventListener('pointermove', moved); reject(new Error('Browser mouse did not reach its requested focus position')) }, 5000)
          const moved = (event) => {
            if (Math.abs(event.clientX - clientX) > 2 || Math.abs(event.clientY - clientY) > 2) return
            clearTimeout(timer)
            canvas.removeEventListener('pointermove', moved)
            window.live2dPointerRequest = undefined
            resolve()
          }
          canvas.addEventListener('pointermove', moved)
          window.live2dPointerRequest = { index, clientX, clientY }
        })
        const phase = await runTicker(`pointer-${index}`, 0.35)
        const rendered = drawableSnapshot(raw)
        const expectedSign = value => Math.abs(value) < 0.0001 ? 0 : Math.sign(value)
        const signsMatch = expectedSign(phase.last.parameters.ParamEyeBallX) === Math.sign(x) && expectedSign(phase.last.parameters.ParamEyeBallY) === Math.sign(y)
        const parametersPassed = signsMatch && (Math.abs(x) > 0.01 || Math.abs(y) > 0.01 || Math.max(Math.abs(phase.last.parameters.ParamEyeBallX), Math.abs(phase.last.parameters.ParamEyeBallY)) < 0.05)
        const maximumEyeVertexDelta = vertexDelta(baseline, rendered, ['EyeL', 'EyeR'])
        const maximumEyeContourVertexDelta = contourDelta(baseline, rendered, contours)
        const passed = parametersPassed && maximumEyeContourVertexDelta < 1e-6 && (x === 0 && y === 0 || maximumEyeVertexDelta > 1e-7)
        pointerSamples.push({ index, desiredDirection: [x, y], pointerClientPosition: [clientX, clientY], actualParameters: phase.last.parameters, maximumEyeVertexDelta, maximumEyeContourVertexDelta, parametersPassed, passed })
        appendFrame(`pointer-x${x}-y${y}`, phase.last.parameters)
      }
    }
    finally { canvas.removeEventListener('pointermove', focusToPointer); window.live2dPointerRequest = undefined }
    internal.focusController.focus(0, 0, true)
    restoreDefaults()
    internal.coreModel.saveParameters()
    // Run AIRI's real final blink plugin after the SDK motion update.
    const blink = useMotionUpdatePluginAutoEyeBlink(ref(false))
    let previousMotionTime = 0
    originalMotionUpdate = manager.update
    manager.update = function(coreModel, now) {
      const handled = originalMotionUpdate.call(this, coreModel, now)
      const context = {
        model: coreModel,
        now,
        timeDelta: previousMotionTime ? now - previousMotionTime : 0,
        internalModel: internal,
        motionManager: manager,
        modelParameters: ref({ leftEyeOpen: 1, rightEyeOpen: 1 }),
        live2dEyeTrackingEnabled: ref(true),
        live2dEyeFocusSourceActive: ref(true),
        live2dIdleAnimationEnabled: ref(true),
        live2dForceIdleEyeAnimation: ref(false),
        live2dAutoBlinkEnabled: ref(true),
        live2dForceAutoBlinkEnabled: ref(true),
        isIdleMotion: !manager.state.currentGroup || manager.state.currentGroup === manager.groups.idle,
        handled,
        markHandled() { context.handled = true },
      }
      blink(context)
      previousMotionTime = now
      return context.handled
    }
    recording.setLabel('Yawn')
    const yawnStarted = await model.motion('Yawn', 0, 3)
    if (!yawnStarted) throw new Error('Yawn motion could not start')
    const yawn = await runTicker('yawn', 6.3, [0, 0.7, 1.3, 2.8, 4.1, 5.2, 6.2])
    yawn.started = yawnStarted
    yawn.endedMouthOpacities = Object.fromEntries(Array.from(raw.drawables.ids, (id, index) => [id, raw.drawables.opacities[index]]).filter(([id]) => ['MouthClosed', 'MouthOpen'].includes(id)))
    yawn.passed = yawn.ranges.ParamMouthOpenY[1] > 0.8 && yawn.ranges.ParamEyeLOpen[0] < 0.2 && yawn.ranges.ParamEyeROpen[0] < 0.2 && yawn.maximumMouthVertexDelta > 1e-7 && yawn.last.parameters.ParamMouthOpenY < 0.001 && yawn.endedMouthOpacities.MouthClosed > 0.99 && yawn.endedMouthOpacities.MouthOpen < 0.01 && yawn.motionFinished
    const media = [await recording.finish()]
    recordingFinished = true
    if (shortProbe) {
      return {
        scope: 'Short diagnostic for the production focus adapter and exact Yawn reset. Gaze geometry and 48-second Idle acceptance are not included.',
        sdkBreathDisabledThroughout: !('breath' in internal),
        pointer: { source: 'AIRI utils/model-focus.ts', gazeDefaults, parametersPassed: pointerSamples.every(sample => sample.parametersPassed), samples: pointerSamples },
        yawn,
        media,
        passed: pointerSamples.every(sample => sample.parametersPassed) && yawn.passed,
      }
    }
    restoreDefaults()
    internal.coreModel.saveParameters()
    internal.eyeBlink = originalEyeBlink
    manager.groups.idle = originalIdleGroup
    const idleStarted = await model.motion('Idle', 0, 3)
    if (!idleStarted) throw new Error('Idle motion could not start')
    const idle = await runTicker('idle', 48.6, [0, 2, 4, 20, 34.5, 35.7, 36.3, 37.8, 39.1, 40.2, 42, 48.5])
    idle.started = idleStarted
    const authoredYawn = idle.samples.filter(sample => sample.elapsedSeconds >= 35 && sample.elapsedSeconds <= 41)
    const beforeYawn = idle.samples.filter(sample => sample.elapsedSeconds >= 5 && sample.elapsedSeconds <= 30)
    const afterYawn = idle.samples.filter(sample => sample.elapsedSeconds >= 42)
    idle.passed = idle.ranges.ParamBreath[1] - idle.ranges.ParamBreath[0] > 0.8 && idle.maximumBodyVertexDelta > 1e-7
      && authoredYawn.some(sample => sample.parameters.ParamMouthOpenY > 0.8 && sample.parameters.ParamEyeLOpen < 0.2 && sample.parameters.ParamEyeROpen < 0.2)
      && beforeYawn.every(sample => sample.parameters.ParamMouthOpenY < 0.02)
      && afterYawn.every(sample => sample.parameters.ParamMouthOpenY < 0.001)
    return {
      sdkBreathPresentBeforeDisable,
      sdkBreathDisabledThroughout: !('breath' in internal),
      productionBlinkPlugin: { enabled: true, expressionEnabled: false, forceAutoBlink: true, source: 'AIRI composables/live2d/eye-blink.ts' },
      pointer: { scope: 'Real Chromium mouse.move events forwarded through the production focusLive2DModelAt adapter. Eye mesh boundary vertices remain fixed. No desktop-global pointer bridge.', gazeDefaults, boundaryVertices: contours, passed: pointerSamples.every(sample => sample.passed), samples: pointerSamples },
      yawn,
      idle,
      media,
      passed: pointerSamples.every(sample => sample.passed) && yawn.passed && idle.passed,
      limits: ['Standalone renderer and SDK playback. Full AIRI stores, speech timing, OS pointer forwarding, and model selection are not exercised.'],
    }
  }
  finally {
    if (!recordingFinished) await recording.finish()
    internal.off('beforeModelUpdate', parametersBeforeRender)
    manager.stopAllMotions()
    if (originalMotionUpdate) manager.update = originalMotionUpdate
    manager.groups.idle = originalIdleGroup
    internal.eyeBlink = originalEyeBlink
    model.autoUpdate = false
    app.stop()
  }
}

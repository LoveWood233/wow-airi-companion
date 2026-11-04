import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

const tolerance = 1e-7
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const usage = `Usage:
  node validate-runtime.mjs --core CORE.js --model MODEL.model3.json --report REPORT.json
    [--expect-effect PARAMETER_ID] ... [--core-source-url URL]

Repeat --expect-effect for each parameter that must change drawable data.
The Core script is supplied explicitly. This tool does not download a runtime.
`

function parseArguments(arguments_) {
  const options = { expectedEffects: [] }
  const fields = new Map([
    ['--core', 'core'],
    ['--model', 'model'],
    ['--report', 'report'],
    ['--core-source-url', 'coreSourceUrl'],
  ])
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    const value = arguments_[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    if (argument === '--expect-effect') {
      options.expectedEffects.push(value)
    }
    else if (fields.has(argument)) {
      const field = fields.get(argument)
      if (options[field] !== undefined) throw new Error(`Duplicate option ${argument}`)
      options[field] = value
    }
    else {
      throw new Error(`Unknown option ${argument}`)
    }
  }
  for (const field of ['core', 'model', 'report']) {
    if (!options[field]) throw new Error(`Required option: --${field}`)
    options[field] = path.resolve(options[field])
  }
  options.expectedEffects = [...new Set(options.expectedEffects)]
  return options
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function collectReferences(value, key = '') {
  if (typeof value === 'string') return key === 'Name' ? [] : [value]
  if (Array.isArray(value)) return value.flatMap(item => collectReferences(item, key))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([childKey, item]) => collectReferences(item, childKey))
  }
  return []
}

function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function readReferences(modelPath, inputPaths) {
  const settings = JSON.parse(await fs.readFile(modelPath, 'utf8'))
  if (settings.Version !== 3) throw new Error('Expected model settings Version 3')
  const references = settings.FileReferences
  if (!references || typeof references.Moc !== 'string' || !Array.isArray(references.Textures) || references.Textures.length === 0
    || !references.Textures.every(texture => typeof texture === 'string' && texture.length > 0)) {
    throw new Error('Settings must declare a Moc and at least one texture')
  }
  const directory = await fs.realpath(path.dirname(modelPath))
  const declaredReferences = [...new Set(collectReferences(references))]
  for (const relativePath of declaredReferences) {
    if (relativePath && !relativePath.includes('\0')) inputPaths.push(path.resolve(directory, relativePath))
  }
  const files = []
  let mocBytes
  for (const relativePath of declaredReferences) {
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new Error(`Expected a package-relative file reference: ${relativePath}`)
    }
    const absolutePath = await fs.realpath(path.resolve(directory, relativePath))
    if (!isInside(directory, absolutePath)) throw new Error(`Reference leaves the model package: ${relativePath}`)
    const bytes = await fs.readFile(absolutePath)
    const entry = { relativePath, bytes: bytes.length, sha256: sha256(bytes), absolutePath }
    if (relativePath.toLowerCase().endsWith('.png')) {
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error(`Invalid PNG: ${relativePath}`)
      entry.width = bytes.readUInt32BE(16)
      entry.height = bytes.readUInt32BE(20)
    }
    if (relativePath === references.Moc) mocBytes = bytes
    files.push(entry)
  }
  if (!mocBytes || mocBytes.toString('ascii', 0, 4) !== 'MOC3') throw new Error('Invalid MOC3 signature')
  return { files, mocBytes }
}

async function loadCore(corePath, messages) {
  const source = await fs.readFile(corePath)
  const capture = (...values) => messages.push(values.map(String).join(' '))
  const context = vm.createContext({
    console: { log: capture, error: capture, warn: capture },
    require: createRequire(corePath),
    process,
    Buffer,
    __dirname: path.dirname(corePath),
    __filename: corePath,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    performance,
  })
  vm.runInContext(source.toString('utf8'), context, { filename: corePath, timeout: 10000 })
  const core = context.Live2DCubismCore
  if (!core?.Version?.csmGetVersion) throw new Error('The script does not expose Live2DCubismCore.Version')
  let lastFailure
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return { core, source, version: core.Version.csmGetVersion() }
    }
    catch (error) {
      lastFailure = String(error)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Core initialization failed: ${lastFailure}`)
}

function snapshot(model) {
  return {
    vertices: Array.from(model.drawables.vertexPositions, values => Array.from(values)),
    opacities: Array.from(model.drawables.opacities),
    orders: Array.from(model.drawables.drawOrders),
    multiplyColors: model.drawables.multiplyColors ? Array.from(model.drawables.multiplyColors) : [],
    screenColors: model.drawables.screenColors ? Array.from(model.drawables.screenColors) : [],
  }
}

function assertFinite(state, label) {
  const values = [...state.vertices.flat(), ...state.opacities, ...state.orders, ...state.multiplyColors, ...state.screenColors]
  if (!values.every(Number.isFinite)) throw new Error(`Non-finite drawable data: ${label}`)
}

function changedColor(before, after, index) {
  const start = index * 4
  const previous = before.slice(start, start + 4)
  const next = after.slice(start, start + 4)
  return previous.some((value, channel) => Math.abs(next[channel] - value) > tolerance)
    ? { before: previous, after: next }
    : null
}

function drawableChanges(before, after, ids) {
  const changes = []
  for (let index = 0; index < ids.length; index++) {
    let changedVertexCoordinateCount = 0
    let maxVertexCoordinateDelta = 0
    for (let coordinate = 0; coordinate < before.vertices[index].length; coordinate++) {
      const delta = Math.abs(after.vertices[index][coordinate] - before.vertices[index][coordinate])
      if (delta > tolerance) changedVertexCoordinateCount++
      maxVertexCoordinateDelta = Math.max(maxVertexCoordinateDelta, delta)
    }
    const opacity = Math.abs(after.opacities[index] - before.opacities[index]) > tolerance
      ? { before: before.opacities[index], after: after.opacities[index] }
      : null
    const drawOrder = after.orders[index] !== before.orders[index]
      ? { before: before.orders[index], after: after.orders[index] }
      : null
    const multiplyColor = changedColor(before.multiplyColors, after.multiplyColors, index)
    const screenColor = changedColor(before.screenColors, after.screenColors, index)
    if (changedVertexCoordinateCount || opacity || drawOrder || multiplyColor || screenColor) {
      changes.push({
        id: ids[index], index, changedVertexCoordinateCount, maxVertexCoordinateDelta,
        opacity, drawOrder, multiplyColor, screenColor,
      })
    }
  }
  return changes
}

function inspectModel(core, mocBytes, report, expectedEffects) {
  const buffer = mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength)
  let moc
  let model
  try {
    moc = core.Moc.fromArrayBuffer(buffer)
    if (!moc) throw new Error('Core rejected the MOC3 file')
    report.mocVersion = core.Version.csmGetMocVersion(moc, buffer)
    report.mocConsistency = moc.hasMocConsistency(buffer)
    if (report.mocConsistency !== 1) throw new Error('MOC3 consistency check failed')
    model = core.Model.fromMoc(moc)
    if (!model) throw new Error('Core could not create a model')
    report.modelCreated = true
    const parameterIds = Array.from(model.parameters.ids)
    const drawableIds = Array.from(model.drawables.ids)
    for (let index = 0; index < model.parameters.count; index++) {
      model.parameters.values[index] = model.parameters.defaultValues[index]
    }
    model.update()
    const baseline = snapshot(model)
    assertFinite(baseline, 'default parameters')
    report.parameterCount = model.parameters.count
    report.parameterIds = parameterIds
    report.drawableCount = model.drawables.count
    report.drawableIds = drawableIds
    report.vertexCounts = Array.from(model.drawables.vertexCounts)
    report.totalVertexCount = report.vertexCounts.reduce((total, count) => total + count, 0)
    report.partCount = model.parts.count
    report.canvas = {
      width: model.canvasinfo.CanvasWidth,
      height: model.canvasinfo.CanvasHeight,
      pixelsPerUnit: model.canvasinfo.PixelsPerUnit,
    }
    const parameterEffects = []
    let testedBoundaryStateCount = 0
    for (let index = 0; index < model.parameters.count; index++) {
      const minimum = model.parameters.minimumValues[index]
      const maximum = model.parameters.maximumValues[index]
      const defaultValue = model.parameters.defaultValues[index]
      if (![minimum, maximum, defaultValue].every(Number.isFinite)) throw new Error(`Non-finite parameter range: ${parameterIds[index]}`)
      for (const value of new Set([minimum, maximum])) {
        model.parameters.values[index] = value
        model.update()
        const current = snapshot(model)
        assertFinite(current, `${parameterIds[index]}=${value}`)
        const drawables = drawableChanges(baseline, current, drawableIds)
        if (drawables.length) parameterEffects.push({ id: parameterIds[index], value, drawables })
        testedBoundaryStateCount++
      }
      model.parameters.values[index] = defaultValue
      model.update()
    }
    assertFinite(snapshot(model), 'restored defaults')
    report.allTestedBoundaryStatesFinite = true
    report.testedBoundaryStateCount = testedBoundaryStateCount
    report.parameterEffects = parameterEffects
    report.changedParameterEffectCount = parameterEffects.length
    report.parametersWithDrawableEffects = [...new Set(parameterEffects.map(effect => effect.id))]
    report.expectedEffects = expectedEffects.map(id => ({
      id,
      present: parameterIds.includes(id),
      passed: parameterEffects.some(effect => effect.id === id),
      changedDrawables: [...new Set(parameterEffects.filter(effect => effect.id === id).flatMap(effect => effect.drawables.map(drawable => drawable.id)))],
    }))
    for (const expected of report.expectedEffects) {
      if (!expected.passed) {
        report.failures.push({
          code: expected.present ? 'expected-parameter-has-no-drawable-effect' : 'expected-parameter-is-missing',
          parameterId: expected.id,
        })
      }
    }
  }
  finally {
    model?.release()
    moc?._release()
  }
}

async function protectInputFiles(reportPath, inputPaths) {
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
  let resolvedReport
  try {
    resolvedReport = await fs.realpath(reportPath)
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const directory = await fs.realpath(path.dirname(reportPath))
    resolvedReport = path.join(directory, path.basename(reportPath))
  }
  for (const inputPath of inputPaths) {
    if (normalized(path.resolve(inputPath)) === normalized(path.resolve(reportPath))) {
      throw new Error('The report path must not overwrite an input file')
    }
    let resolvedInput
    try {
      resolvedInput = await fs.realpath(inputPath)
    }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
      throw error
    }
    if (normalized(resolvedInput) === normalized(resolvedReport)) throw new Error('The report path must not overwrite an input file')
  }
}

async function run(options) {
  const report = {
    kind: 'Cubism Core parsing and individual parameter-boundary inspection',
    ok: false,
    modelSettingsPath: options.model,
    coreScriptPath: options.core,
    coreSourceUrlProvidedByCaller: options.coreSourceUrl ?? null,
    coordinateAndColorTolerance: tolerance,
    failures: [],
    consoleMessages: [],
    limits: [
      'Compatibility is limited to the supplied Core script and its recorded SHA-256.',
      'Source URL metadata is supplied by the caller. This tool does not verify its origin.',
      'Each parameter is tested at its minimum and maximum with all other parameters at their defaults.',
      'Interior keyforms and combined parameter states are not tested.',
      'Changed drawable data does not prove an acceptable visible gesture.',
      'No AIRI import, persistence, rendering, motion playback, physics or speech timing is tested.',
    ],
  }
  const inputPaths = [options.model, options.core]
  try {
    const { files, mocBytes } = await readReferences(options.model, inputPaths)
    report.fileReferences = files.map(({ absolutePath, ...entry }) => entry)
    inputPaths.push(...files.map(entry => entry.absolutePath))
    report.headerAscii = mocBytes.toString('ascii', 0, 4)
    report.headerBytes = Array.from(mocBytes.subarray(0, 16))
    const { core, source, version } = await loadCore(options.core, report.consoleMessages)
    report.coreSha256 = sha256(source)
    report.coreVersion = version
    report.coreVersionHex = `0x${version.toString(16).padStart(8, '0')}`
    report.coreVersionParts = [version >>> 24 & 255, version >>> 16 & 255, version & 65535]
    report.latestMocVersion = core.Version.csmGetLatestMocVersion()
    inspectModel(core, mocBytes, report, options.expectedEffects)
  }
  catch (error) {
    report.failures.push({ code: 'validation-error', message: error.message ?? String(error) })
  }
  report.ok = report.failures.length === 0
  await fs.mkdir(path.dirname(options.report), { recursive: true })
  await protectInputFiles(options.report, inputPaths)
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: options.report,
    coreVersionHex: report.coreVersionHex,
    coreSha256: report.coreSha256,
    mocVersion: report.mocVersion,
    parameterCount: report.parameterCount,
    drawableCount: report.drawableCount,
    totalVertexCount: report.totalVertexCount,
    parametersWithDrawableEffects: report.parametersWithDrawableEffects,
    expectedEffects: report.expectedEffects,
    failures: report.failures,
  }))
  return report.ok ? 0 : 1
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) console.log(usage)
  else process.exitCode = await run(options)
}
catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message ?? String(error) }))
  process.exitCode = 2
}

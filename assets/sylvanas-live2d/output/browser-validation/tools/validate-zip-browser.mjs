import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const usage = 'node validate-zip-browser.mjs --repo REPO --core CORE.js --toolchain NODE_MODULES [--browser CHROMIUM.exe] [--zip MODEL.zip --expect-effect ID ... | --prepare-only] [--states STATES.json] [--diagnostic] [--out DIRECTORY]'
const options = { expectedEffects: [], previewRepeat: 1 }
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index]
  if (argument === '--help') { console.log(usage); process.exit(0) }
  if (argument === '--prepare-only') { options.prepareOnly = true; continue }
  if (argument === '--diagnostic') { options.diagnostic = true; continue }
  if (argument === '--animation-probe') { options.animationProbe = true; continue }
  const value = process.argv[++index]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
  if (argument === '--expect-effect') options.expectedEffects.push(value)
  else if (argument === '--preview-repeat') {
    options.previewRepeat = Number(value)
    if (!Number.isInteger(options.previewRepeat) || options.previewRepeat < 1 || options.previewRepeat > 10) throw new Error('--preview-repeat must be an integer from 1 to 10')
  }
  else if (['--repo', '--core', '--toolchain', '--browser', '--zip', '--out', '--states', '--entry'].includes(argument)) options[argument.slice(2)] = path.resolve(value)
  else throw new Error(`Unknown option: ${argument}`)
}
for (const key of ['repo', 'core', 'toolchain']) if (!options[key]) throw new Error(`Missing --${key}. ${usage}`)
if (Boolean(options.zip) === Boolean(options.prepareOnly)) throw new Error('Select --zip or --prepare-only')
if (options.zip && options.expectedEffects.length === 0) throw new Error('Final ZIP inspection requires at least one --expect-effect parameter ID')
options.out ??= path.join(directory, 'runs', new Date().toISOString().replaceAll(':', '-'))
await fs.mkdir(options.out, { recursive: true })

const { rolldown } = await import(pathToFileURL(path.join(options.toolchain, 'rolldown/dist/index.mjs')).href)
const { chromium } = await import(pathToFileURL(path.join(options.toolchain, 'playwright/index.mjs')).href)
const store = path.join(options.repo, 'airi/node_modules/.pnpm')
const entries = await fs.readdir(store)
const resources = new Map()
const hashes = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let sampleStates = []
if (options.states) {
  const bytes = await fs.readFile(options.states)
  sampleStates = JSON.parse(bytes.toString('utf8'))
  if (!Array.isArray(sampleStates)) throw new Error('--states must contain an array')
  for (const state of sampleStates) {
    if (!state || typeof state.name !== 'string' || !state.parameters || typeof state.parameters !== 'object' || Array.isArray(state.parameters)) throw new Error('Invalid named sample state')
  }
  hashes.push({ path: options.states, sha256: hash(bytes), bytes: bytes.length })
}
async function resource(url, filename, contentType) {
  const bytes = await fs.readFile(filename)
  resources.set(url, { bytes, contentType })
  hashes.push({ path: filename, sha256: hash(bytes), bytes: bytes.length })
}
async function packageDirectory(name, version) {
  const prefix = `${name.replace('/', '+')}@${version}`
  const candidates = entries.filter(entry => entry === prefix || entry.startsWith(`${prefix}_`))
  if (candidates.length !== 1) throw new Error(`Expected exactly one ${name}@${version}, found ${candidates.length}`)
  return path.join(store, candidates[0], 'node_modules', name)
}

const scripts = []
for (const name of ['constants', 'settings', 'runner', 'math', 'extensions', 'utils', 'ticker', 'core', 'display', 'sprite', 'app', 'loaders', 'interaction']) {
  const filename = path.join(await packageDirectory(`@pixi/${name}`, '6.5.10'), 'dist/browser', `${name}.js`)
  const url = `/vendor/pixi-${name}.js`
  await resource(url, filename, 'text/javascript')
  scripts.push(url)
}
await resource('/vendor/jszip.js', path.join(await packageDirectory('jszip', '3.10.1'), 'dist/jszip.min.js'), 'text/javascript')
await resource('/vendor/core.js', options.core, 'text/javascript')
await resource('/vendor/cubism4.js', path.join(await packageDirectory('pixi-live2d-display', '0.4.0'), 'dist/cubism4.js'), 'text/javascript')
await resource('/vendor/vue.mjs', path.join(await packageDirectory('vue', '3.5.41'), 'dist/vue.runtime.esm-browser.js'), 'text/javascript')
scripts.push('/vendor/jszip.js', '/vendor/core.js', '/vendor/cubism4.js')

const exportsByPackage = {
  '@pixi/app': ['Application'],
  '@pixi/core': ['BatchRenderer'],
  '@pixi/extensions': ['extensions'],
  '@pixi/ticker': ['Ticker', 'TickerPlugin'],
  'pixi-live2d-display/cubism4': ['Live2DFactory', 'Live2DModel', 'Cubism4ModelSettings', 'FileLoader', 'ZipLoader', 'MotionPreloadStrategy'],
}
const imports = { jszip: '/shim/jszip.mjs', vue: '/vendor/vue.mjs' }
resources.set('/shim/jszip.mjs', { contentType: 'text/javascript', bytes: Buffer.from('export default window.JSZip') })
for (const [name, exported] of Object.entries(exportsByPackage)) {
  const url = `/shim/${name.replaceAll('/', '-')}.mjs`
  const global = name.startsWith('pixi-live2d-display') ? 'window.PIXI.live2d' : 'window.PIXI'
  const source = exported.map(symbol => `export const ${symbol} = ${global}.${symbol}`).join('\n')
  resources.set(url, { contentType: 'text/javascript', bytes: Buffer.from(source) })
  imports[name] = url
}
const sources = {
  'airi-live2d-zip-loader': 'utils/live2d-zip-loader.ts',
  'airi-live2d-validator': 'utils/live2d-validator.ts',
  'airi-live2d-preview': 'utils/live2d-preview.ts',
}
const sourceRoot = path.join(options.repo, 'airi/packages/stage-ui-live2d/src')
if (options.animationProbe) {
  const filename = path.join(sourceRoot, 'composables/live2d/motion-manager.ts')
  const bytes = await fs.readFile(filename)
  if (!bytes.toString('utf8').includes('delete internalModel.breath')) throw new Error('Review changed production SDK breath disabling implementation before probing animation')
  hashes.push({ path: filename, sha256: hash(bytes), bytes: bytes.length, purpose: 'SDK breath disabling behavior reference, not the full AIRI motion-plugin runtime' })
}
const cropPath = path.join(await packageDirectory('@lemonneko/crop-empty-pixels', '0.1.1'), 'dist/index.js')
const bundle = await rolldown({
  input: options.entry ?? path.join(directory, 'browser-entry.mjs'),
  external: id => Object.hasOwn(imports, id),
  plugins: [{
    name: 'current-airi-source',
    resolveId(id) {
      if (sources[id]) return path.join(sourceRoot, sources[id])
      if (id === '@lemonneko/crop-empty-pixels') return cropPath
    },
  }],
})
try {
  const { output } = await bundle.generate({ format: 'es', sourcemap: true })
  for (const item of output) {
    if (item.type !== 'chunk') continue
    resources.set('/bundle.mjs', { contentType: 'text/javascript', bytes: Buffer.from(item.code) })
    await fs.writeFile(path.join(options.out, 'bundle.mjs'), item.code)
    if (item.map) await fs.writeFile(path.join(options.out, 'bundle.mjs.map'), item.map.toString())
    for (const filename of Object.keys(item.modules)) {
      try { const bytes = await fs.readFile(filename); hashes.push({ path: filename, sha256: hash(bytes), bytes: bytes.length }) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}
finally { await bundle.close() }
const html = `<!doctype html><meta charset="utf-8"><title>Actual AIRI Live2D utility validation</title><style>body{background:#657080;color:white;font:16px sans-serif}img,canvas{max-width:700px;max-height:840px}</style><h1>Actual AIRI Live2D utilities</h1><img id="preview" alt="AIRI ZIP preview"><canvas id="runtime"></canvas>${scripts.map(url => `<script src="${url}"></script>`).join('')}<script type="importmap">${JSON.stringify({ imports })}</script><script type="module" src="/bundle.mjs"></script>`
resources.set('/', { contentType: 'text/html', bytes: Buffer.from(html) })
if (options.zip) await resource('/input.zip', options.zip, 'application/zip')

let browser
const errors = []
const consoleMessages = []
const server = http.createServer((request, response) => {
  const entry = resources.get(new URL(request.url, 'http://127.0.0.1').pathname)
  if (!entry) { response.writeHead(404); response.end('Not found'); return }
  response.writeHead(200, { 'Content-Type': entry.contentType, 'Cache-Control': 'no-store' })
  response.end(entry.bytes)
})
const report = {
  kind: 'Actual repository Live2D ZIP validator, preview utility, and runtime browser inspection',
  ok: false,
  mode: options.prepareOnly ? 'prepare-only-no-model-tested' : options.diagnostic ? 'intermediate-diagnostic-zip-not-final' : 'final-zip',
  limits: ['This standalone harness does not test AIRI model storage, Electron selection, stage persistence, motions, physics, or speech timing.', 'Browser distributions use the exact installed package versions. Imports share their real globals.', 'Runtime effect checks cover requested parameter boundaries. Only explicitly supplied named states add intermediate or combined-state coverage.', 'A non-empty render requires visual review of the saved PNGs.'],
  sources: hashes,
  errors,
  consoleMessages,
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ executablePath: options.browser, headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  report.browserVersion = browser.version()
  const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } })
  page.on('pageerror', error => {
    errors.push(error.stack ?? error.message)
    consoleMessages.push({ type: 'pageerror', text: error.stack ?? error.message })
  })
  page.on('console', message => {
    consoleMessages.push({ type: message.type(), text: message.text() })
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  await page.goto(origin)
  await page.waitForFunction(() => window.live2dValidation?.ready, null, { timeout: 15000 })
  report.environment = await page.evaluate(() => window.live2dValidation.probe())
  if (options.prepareOnly) report.preparationReady = true
  else {
    let deadline
    let result
    try {
      result = await Promise.race([
        page.evaluate(arguments_ => window.live2dValidation.run(arguments_), { zipUrl: `${origin}/input.zip`, filename: path.basename(options.zip), expectedEffects: options.expectedEffects, sampleStates, animationProbe: !!options.animationProbe, previewRepeat: options.previewRepeat }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('ZIP validation and rendering exceeded 120 seconds')), 120000) }),
      ])
    }
    finally { clearTimeout(deadline) }
    const savePng = async (name, value) => {
      if (!value?.startsWith('data:image/png;base64,')) throw new Error(`Missing PNG data: ${name}`)
      const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
      await fs.writeFile(path.join(options.out, name), bytes)
      return { file: name, bytes: bytes.length, sha256: hash(bytes) }
    }
    if (result.preview) result.preview.image = await savePng('airi-preview.png', result.preview.dataUrl)
    if (result.preview) delete result.preview.dataUrl
    if (result.runtime) {
      result.runtime.defaultImage = await savePng('runtime-default.png', result.runtime.defaultPng)
      delete result.runtime.defaultPng
      for (const [index, effect] of result.runtime.expectedEffects.entries()) {
        for (const [boundaryIndex, boundary] of effect.boundaries.entries()) {
          boundary.image = await savePng(`parameter-${index}-boundary-${boundaryIndex}.png`, boundary.dataUrl)
          delete boundary.dataUrl
        }
      }
      for (const [index, state] of result.runtime.sampledStates.entries()) {
        const safeName = state.name.replace(/[^a-zA-Z0-9_-]/g, '_')
        state.image = await savePng(`state-${index}-${safeName}.png`, state.dataUrl)
        delete state.dataUrl
      }
    }
    report.result = result
    report.ok = result.ok && errors.length === 0
    await page.screenshot({ path: path.join(options.out, 'browser.png'), fullPage: true })
  }
  if (options.prepareOnly && errors.length > 0) report.preparationReady = false
}
catch (error) { errors.push(error.stack ?? String(error)) }
finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await fs.writeFile(path.join(options.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify({ mode: report.mode, ok: report.ok, preparationReady: report.preparationReady, errors, output: options.out }))
process.exitCode = options.prepareOnly ? report.preparationReady ? 0 : 1 : report.ok ? 0 : 1

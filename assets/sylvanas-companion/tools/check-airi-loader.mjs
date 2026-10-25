import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loaderPath = 'airi/packages/stage-ui-spine/src/utils/spine-zip-loader.ts'
const loaderSource = resolve(root, '../..', loaderPath)
const cache = resolve(root, '.cache')
await mkdir(cache, { recursive: true })
const bundledLoader = resolve(cache, 'airi-loader.mjs')
await build({ entryPoints: [loaderSource], outfile: bundledLoader, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const { loadSpineZip } = await import(pathToFileURL(bundledLoader).href)
const bytes = await readFile(resolve(root, 'output/sylvanas-companion.spine.zip'))
const result = await loadSpineZip(new Blob([bytes]))
try {
  assert.equal(result.layout.skeletonFormat, 'json')
  assert.deepEqual(result.layout.texturePaths.sort(), ['arm-right-grip-clean.png', 'sylvanas-atlas.png'])
  assert.equal(Object.keys(result.blobUrls).length, 2)
  const report = {
    loader: loaderPath,
    loaderSourceSha256: createHash('sha256').update(await readFile(loaderSource)).digest('hex'),
    assetSha256: createHash('sha256').update(bytes).digest('hex'),
    layout: result.layout,
    variants: result.variants.map(variant => variant.name),
    textureCount: Object.keys(result.blobUrls).length,
    status: 'passed',
    scope: 'ZIP loader only; full Electron import is not tested',
  }
  await writeFile(resolve(root, 'output/airi-loader-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  result.dispose()
}

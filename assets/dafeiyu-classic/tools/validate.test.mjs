import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkReportDestination, classes, expectedManifest, newActions, packageRoot,
  parseArguments, publicError, safeDirectory, safeFile, validateContracts, validateManifest } from './validate.mjs'

async function temporary(t) {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'dafeiyu-contract-test-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('all eight committed manifests preserve the pinned 114-action contract and six additions', async () => {
  const report = await validateContracts()
  assert.equal(report.passed, 8)
  assert.equal(report.manifestCount, 8)
  assert.equal(report.expectedMediaCount, 960)
  assert.equal(report.mediaInspected, false)
  assert.equal(report.sourceIntegrity.verifiedFiles, 6)
  assert(report.results.every(result => result.originalMappingPreserved && result.totalActions === 120))
})

test('a changed original action order, mapping, move parameter, or weight fails', () => {
  const character = classes[0]
  const mutations = [
    manifest => manifest.files.reverse(),
    manifest => manifest.animations.idle.push(manifest.animations.turn[0]),
    manifest => manifest.animations.moves.default.leadSec++,
    manifest => manifest.animations.categories[0].weight++,
    manifest => manifest.animationWeights.idle--,
  ]
  for (const mutate of mutations) {
    const manifest = expectedManifest(character)
    mutate(manifest)
    assert.throws(() => validateManifest(manifest, character), /Changed v0.4.0 action contract/)
  }
})

test('the six added actions include happy jumping and reject the superseded spin', () => {
  assert.equal(newActions.length, 6)
  assert(newActions.includes('开心蹦跳'))
  assert(!newActions.includes('卖萌转圈圈'))
  const manifest = expectedManifest(classes[0])
  manifest.files[manifest.files.indexOf('开心蹦跳.webm')] = '卖萌转圈圈.webm'
  manifest.animations.categories.at(-1).actions[5] = '卖萌转圈圈'
  assert.throws(() => validateManifest(manifest, classes[0]), /Changed v0.4.0 action contract/)
})

test('strict upstream schema rejects unknown settings and missing referenced files', () => {
  const manifest = expectedManifest(classes[0])
  assert.throws(() => validateManifest({ ...manifest, emotionMap: {} }, classes[0]))
  assert.throws(() => validateManifest({ ...manifest, files: manifest.files.slice(1) }, classes[0]))
  assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, '../outside.webm'] }, classes[0]))
})

test('a manifest cannot silently reuse another class identity', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'manifests/warrior/pack.json'), 'utf8'))
  assert.throws(() => validateManifest(manifest, classes[1]), /Changed v0.4.0 action contract/)
})

test('all eight pack identities use v0.4.0 while the native schema remains version 1', async () => {
  for (const character of classes) {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'manifests', character.id, 'pack.json'), 'utf8'))
    assert.equal(manifest.version, 1)
    assert.equal(manifest.id, `dafeiyu-classic-${character.id}-full-v040`)
    assert(manifest.name.endsWith('v0.4.0）'))
    validateManifest(manifest, character)
    manifest.id = `dafeiyu-classic-${character.id}-full-v031`
    assert.throws(() => validateManifest(manifest, character), /Changed v0.4.0 action contract/)
  }
})

test('path validation rejects links and directory traversal without reading the target', async t => {
  const root = await temporary(t)
  const pack = join(root, 'pack')
  await mkdir(pack)
  await writeFile(join(pack, 'valid.webm'), 'example')
  await symlink(pack, join(root, 'linked-pack'), 'dir')
  await symlink(join(pack, 'valid.webm'), join(pack, 'linked.webm'))
  assert.equal(await safeDirectory(pack), pack)
  assert.equal(await safeFile(pack, 'valid.webm'), join(pack, 'valid.webm'))
  await assert.rejects(safeDirectory(join(root, 'linked-pack')), /must not contain links/)
  await assert.rejects(safeFile(pack, 'linked.webm'), /must not contain links/)
  await assert.rejects(safeFile(pack, '../outside.webm'), /Invalid animation path/)
})

test('report output cannot modify input packs through a direct path or parent link', async t => {
  const root = await temporary(t)
  const packs = join(root, 'packs')
  await mkdir(packs)
  await symlink(packs, join(root, 'alias'), 'dir')
  await assert.rejects(checkReportDestination(join(packs, 'report.json'), packs), /outside the input/)
  await assert.rejects(checkReportDestination(join(root, 'alias/new/report.json'), packs), /outside the input/)
  await assert.rejects(checkReportDestination(join(packageRoot, 'source/media-index.json'), packs), /source inputs/)
  await checkReportDestination(join(root, 'reports/media.json'), packs)
})

test('argument parsing keeps generated reports separate and rejects conflicting modes', () => {
  const options = parseArguments(['--media', '--release-hashes'])
  assert.equal(options.mode, 'media')
  assert.equal(options.releaseHashes, true)
  assert.equal(options.packs, join(packageRoot, 'build/packs'))
  assert.equal(options.report, join(packageRoot, 'build/reports/media.json'))
  assert.throws(() => parseArguments(['--native', '--media']), /exactly one/)
  assert.throws(() => parseArguments(['--packs']), /Missing value/)
  assert.throws(() => parseArguments(['--build']), /Unknown argument/)
})

test('public error text excludes machine paths', () => {
  const result = publicError(new Error("ENOENT: open '/some-private-root/person/input/missing.webm'"))
  assert(!result.includes('/some-private-root'))
  assert(!result.includes('person'))
  assert(result.includes('<path>'))
})

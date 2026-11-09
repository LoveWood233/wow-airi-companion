import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parse } from 'valibot'
import { dshPetManifestSchema, dshPetPackSchema } from './upstream/airi/apps/stage-tamagotchi/src/shared/dsh-pet.ts'

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const owningCommit = 'e3ddb35f8bf692c4fe3f8284caae9f4e4d526790'
export const classes = [
  { id: 'warrior', label: '战士', set: '愤怒' },
  { id: 'hunter', label: '猎人', set: '巨龙追猎者' },
  { id: 'mage', label: '法师', set: '灵风' },
  { id: 'rogue', label: '盗贼', set: '血牙' },
  { id: 'paladin', label: '圣骑士', set: '审判' },
  { id: 'warlock', label: '术士', set: '复仇' },
  { id: 'priest', label: '牧师', set: '卓越' },
  { id: 'druid', label: '德鲁伊', set: '怒风' },
]
export const newActions = ['害怕', '害羞', '难过（眼睛饱含泪水）', '想去玩（期待星星眼）', '大哭', '开心蹦跳']
const upstreamRoot = join(packageRoot, 'tools/upstream')
const builtinPath = 'airi/apps/stage-tamagotchi/src/renderer/public/dsh-pet/builtin/pack.json'
const provenanceHash = '3ce9274e1586d002de2385f381486ecf23129d6deca137a84c613bcd28675615'
const sha256 = data => createHash('sha256').update(data).digest('hex')
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const builtin = await readJson(join(upstreamRoot, builtinPath))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function expectedManifest(character) {
  const animations = structuredClone(builtin.animations)
  animations.categories.push({ id: '情绪', weight: 8, actions: [...newActions] })
  return {
    version: 1,
    id: `dafeiyu-classic-${character.id}-full-v031`,
    name: `大肥鱼·${character.label}·${character.set}（120动作 60fps v0.3.1）`,
    files: [...builtin.files, ...newActions.map(name => `${name}.webm`)],
    animations,
    animationWeights: structuredClone(builtin.animationWeights),
  }
}

export function validateManifest(manifest, character) {
  parse(dshPetManifestSchema, manifest)
  assert.deepEqual(manifest, expectedManifest(character), `Changed v0.3.1 action contract: ${character.id}`)
  return { originalActions: 114, addedActions: 6, totalActions: 120, originalMappingPreserved: true }
}

export async function verifyUpstream() {
  const bytes = await readFile(join(upstreamRoot, 'provenance.json'))
  assert.equal(sha256(bytes), provenanceHash, 'Changed pinned upstream provenance')
  const provenance = JSON.parse(bytes)
  assert.equal(provenance.commit, owningCommit)
  assert.equal(provenance.files.length, 6)
  for (const file of provenance.files) {
    const data = await readFile(await safeFile(upstreamRoot, file.path))
    assert.equal(data.length, file.bytes, `Changed pinned source size: ${file.path}`)
    assert.equal(sha256(data), file.sha256, `Changed pinned source: ${file.path}`)
    assert.equal(file.modifications, 'none')
  }
  assert.equal(builtin.files.length, 114)
  return { owningCommit, verifiedFiles: 6, status: 'passed' }
}

export async function verifyReleaseFixture() {
  const index = await readJson(join(packageRoot, 'source/media-index.json'))
  assert.equal(index.version, '0.3.1')
  assert.equal(index.files.length, 960)
  const recordsByPath = new Map(index.files.map(file => [file.path, file]))
  assert.equal(recordsByPath.size, 960, 'Duplicate media reference paths')
  const fixture = { packs: {} }
  for (const character of classes) {
    const records = expectedManifest(character).files.map(file => {
      const record = recordsByPath.get(`packs/${character.id}/${file}`)
      assert(record, `Missing release reference: ${character.id}/${file}`)
      assert.equal(record.class, character.id)
      assert.equal(`${record.action}.webm`, file)
      assert.equal(record.fps, 60)
      assert(Number.isInteger(record.frames) && record.frames > 0)
      assert.equal(record.frames / record.fps, record.duration_seconds)
      return { file, bytes: record.bytes, sha256: record.sha256 }
    })
    fixture.packs[character.id] = records
    assert.equal(new Set(records.map(file => file.sha256)).size, 120)
    for (const record of records) {
      assert.match(record.sha256, /^[0-9a-f]{64}$/)
      assert(Number.isInteger(record.bytes) && record.bytes >= 4 && record.bytes <= 32 * 1024 * 1024)
    }
  }
  return fixture
}

export async function validateContracts() {
  const sourceIntegrity = await verifyUpstream()
  await verifyReleaseFixture()
  const plan = await readJson(join(packageRoot, 'source/action-plan.json'))
  assert.equal(plan.owningCommit, owningCommit)
  assert.equal(plan.releaseVersion, '0.3.1')
  assert.deepEqual(plan.classes, classes)
  assert.equal(plan.originalActionsPerClass, 114)
  assert.equal(plan.addedActionsPerClass, 6)
  assert.equal(plan.expectedActionsPerClass, 120)
  assert.equal(plan.expectedMediaCount, 960)
  assert.equal(plan.fps, 60)
  assert.equal(plan.automaticEmotionMappingChanged, false)
  assert.deepEqual(plan.actions.filter(action => action.origin === 'original').map(action => action.file), builtin.files)
  assert.deepEqual(plan.actions.filter(action => action.origin === 'new').map(action => action.name), newActions)
  assert.deepEqual(plan.actions.map(action => action.file), expectedManifest(classes[0]).files)
  assert.deepEqual(plan.moveTiming.originalDefaults, builtin.animations.moves.default)
  assert.deepEqual(plan.moveTiming.originalActions, builtin.animations.moves.actions)
  const results = []
  for (const character of classes) {
    const manifest = await loadManifest(join(packageRoot, 'manifests', character.id), character)
    results.push({ class: character.id, status: 'passed', ...validateManifest(manifest, character) })
  }
  return { mode: 'contract', releaseVersion: '0.3.1', sourceIntegrity, passed: 8,
    manifestCount: 8, expectedMediaCount: 960, mediaInspected: false, results }
}

// These path and size checks mirror the pinned native importer. The import smoke
// itself executes the unmodified source, rather than a reimplementation.
export async function safeDirectory(directory) {
  const absolute = resolve(directory)
  const info = await lstat(absolute)
  assert(info.isDirectory() && !info.isSymbolicLink()
    && relative(absolute, await realpath(absolute)) === '', 'Animation directories must not contain links')
  return absolute
}

export async function safeFile(root, name) {
  assert(!name.includes('\\') && !isAbsolute(name)
    && !name.split('/').some(part => !part || part === '.' || part === '..'), 'Invalid animation path')
  const absolute = resolve(root, name)
  const rel = relative(root, absolute)
  assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'Animation path escapes its pack')
  let cursor = root
  for (const part of name.split('/')) {
    cursor = join(cursor, part)
    assert(!(await lstat(cursor)).isSymbolicLink(), 'Animation files must not contain links')
  }
  assert((await lstat(absolute)).isFile()
    && relative(absolute, await realpath(absolute)) === '', 'Invalid animation file')
  return absolute
}

async function loadManifest(directory, character) {
  await safeDirectory(directory)
  const path = await safeFile(directory, 'pack.json')
  assert((await lstat(path)).size <= 128 * 1024, 'Animation manifest exceeds the size limit')
  const manifest = await readJson(path)
  validateManifest(manifest, character)
  return manifest
}

async function inspectMedia(directory, names) {
  assert(names.length <= 256, 'Too many animation files')
  let totalBytes = 0
  const files = []
  for (const name of names) {
    const path = await safeFile(directory, name)
    const info = await lstat(path)
    assert(info.size >= 4 && info.size <= 32 * 1024 * 1024, `Invalid file size: ${name}`)
    totalBytes += info.size
    assert(totalBytes <= 512 * 1024 * 1024, 'Animation pack exceeds the size limit')
    const handle = await open(path, 'r')
    try {
      const opened = await handle.stat()
      assert(opened.isFile() && opened.ino === info.ino && opened.dev === info.dev
        && opened.size === info.size, `Animation changed during validation: ${name}`)
      const data = await handle.readFile()
      assert.equal(data.length, info.size, `Animation changed during validation: ${name}`)
      assert.equal((await handle.stat()).size, data.length, `Animation changed during validation: ${name}`)
      assert.equal(data.subarray(0, 4).toString('hex'), '1a45dfa3', `Invalid WebM header: ${name}`)
      files.push({ file: name, bytes: data.length, sha256: sha256(data) })
    }
    finally { await handle.close() }
  }
  assert.equal(new Set(files.map(file => file.sha256)).size, 120, 'Identical media reused for separate actions')
  return { totalBytes, files }
}

function inspectVideo(path, file) {
  let data
  try {
    data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024 }))
  }
  catch (error) {
    throw new Error(`ffprobe failed for ${file}; install ffprobe and check the media (${error.code ?? error.status ?? 'invalid output'})`)
  }
  assert.equal(data.streams?.length, 1, `Expected silent video only: ${file}`)
  const stream = data.streams[0]
  assert.equal(stream.codec_name, 'vp9', `Wrong codec: ${file}`)
  assert.equal(stream.codec_type, 'video', `Wrong stream type: ${file}`)
  assert.equal(stream.width, 640, `Wrong width: ${file}`)
  assert.equal(stream.height, 360, `Wrong height: ${file}`)
  assert.equal(stream.tags?.alpha_mode, '1', `Missing alpha metadata: ${file}`)
  assert.equal(stream.r_frame_rate, '60/1', `Wrong frame rate: ${file}`)
  const duration = Number(data.format.duration)
  assert(Number.isFinite(duration) && duration > 0 && duration <= 120, `Invalid duration: ${file}`)
  return { file, fps: 60, width: 640, height: 360, codec: 'vp9', durationSeconds: duration, alphaMetadata: true }
}

async function validateMedia(directory, character, fixture) {
  const manifest = await loadManifest(directory, character)
  const media = await inspectMedia(directory, manifest.files)
  if (fixture)
    assert.deepEqual(media.files, fixture.packs[character.id], `Released media hash/size mismatch: ${character.id}`)
  const video = media.files.map(file => inspectVideo(join(directory, file.file), file.file))
  return { class: character.id, status: 'passed', ...validateManifest(manifest, character),
    ...media, video, releaseHashesMatched: fixture ? true : null }
}

async function nativeImport(directory, character, fixture) {
  const { DshPetLibrary } = await import('./upstream/airi/apps/stage-tamagotchi/src/main/services/airi/dsh-pet-library.ts')
  const runtimeBuiltin = parse(dshPetPackSchema, { ...builtin, baseUrl: '../dsh-pet/builtin' })
  const manifest = await loadManifest(directory, character)
  const profile = await mkdtemp(join(await realpath(tmpdir()), 'dafeiyu-import-'))
  const result = { class: character.id, status: 'failed', profileRemoved: false }
  try {
    const library = new DshPetLibrary(profile, runtimeBuiltin)
    const state = await library.importPack(directory)
    const id = state.selectedId
    assert.match(id, uuid)
    assert.notEqual(id, manifest.id)
    const imported = state.packs.find(pack => pack.id === id)
    assert.deepEqual(imported, { ...manifest, id, baseUrl: `dsh-pet://packs/${id}` })
    const copied = []
    for (const file of manifest.files) {
      const source = await readFile(join(directory, file))
      const target = await readFile(await library.resolveAsset(id, file))
      assert.equal(target.length, source.length, `Copied size mismatch: ${file}`)
      assert.equal(sha256(target), sha256(source), `Copied hash mismatch: ${file}`)
      copied.push({ file, bytes: target.length, sha256: sha256(target) })
    }
    if (fixture)
      assert.deepEqual(copied, fixture.packs[character.id], `Released media hash/size mismatch: ${character.id}`)
    await assert.rejects(library.resolveAsset(id, 'not-listed.webm'), /Unknown animation file/)
    const reloaded = await new DshPetLibrary(profile, runtimeBuiltin).read()
    assert.equal(reloaded.selectedId, id)
    assert.deepEqual(reloaded.packs.find(pack => pack.id === id), imported)
    const settings = await readJson(join(profile, 'settings.json'))
    assert.equal(settings.selectedId, id)
    Object.assign(result, { status: 'passed', copied,
      originalAndAddedMappingsPreserved: true, selectionPersistence: true,
      unlistedAssetRejected: true, releaseHashesMatched: fixture ? true : null })
  }
  catch (error) { result.error = publicError(error, [directory, profile]) }
  finally {
    await rm(profile, { recursive: true, force: true })
    await assert.rejects(access(profile), { code: 'ENOENT' })
    result.profileRemoved = true
  }
  return result
}

export function parseArguments(argv) {
  const options = { mode: 'contract', packs: join(packageRoot, 'build/packs'), releaseHashes: false }
  let modeSeen = false
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (['--contract', '--media', '--native'].includes(flag)) {
      assert(!modeSeen, 'Select exactly one validation mode')
      options.mode = flag.slice(2)
      modeSeen = true
    }
    else if (flag === '--release-hashes') options.releaseHashes = true
    else if (flag === '--help') options.help = true
    else {
      assert(['--packs', '--report'].includes(flag), `Unknown argument: ${flag}`)
      const value = argv[++index]
      assert(value && !value.startsWith('--'), `Missing value for ${flag}`)
      options[flag.slice(2)] = resolve(value)
    }
  }
  options.report ??= join(packageRoot, 'build/reports', `${options.mode}.json`)
  return options
}

function inside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

async function canonicalFuturePath(path) {
  try { return await realpath(path) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    return join(await canonicalFuturePath(dirname(path)), relative(dirname(path), path))
  }
}

export async function checkReportDestination(report, packs) {
  const destination = resolve(report)
  const input = resolve(packs)
  assert(!inside(input, destination), 'Reports must be outside the input packs directory')
  const resolvedInput = await canonicalFuturePath(input)
  const resolvedReport = await canonicalFuturePath(destination)
  assert(!inside(resolvedInput, resolvedReport), 'Reports must be outside the input packs directory')
  for (const source of ['manifests', 'source', 'tools'])
    assert(!inside(join(packageRoot, source), resolvedReport), 'Reports must not overwrite package source inputs')
  try { assert(!(await lstat(destination)).isSymbolicLink(), 'Report file must not be a symbolic link') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

export function publicError(error, privateRoots = []) {
  let message = error instanceof Error ? error.message : String(error)
  const roots = [...privateRoots, packageRoot, process.cwd(), homedir(), tmpdir()]
    .map(root => resolve(root)).sort((a, b) => b.length - a.length)
  for (const root of roots) message = message.split(root).join('<local>')
  // System error strings may include a caller-supplied absolute path outside the
  // package. Keep reports shareable without publishing workstation locations.
  message = message.replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s'"<>]+[\\/])*[^\s'"<>]*/g, '<path>')
  return message
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (options.help) {
    console.log('Usage: node --import tsx tools/validate.mjs --contract|--media|--native [--packs DIR] [--report FILE] [--release-hashes]')
    console.log('Defaults: build/packs input; build/reports/<mode>.json output. Input packs are read-only.')
    console.log('--release-hashes requires byte-for-byte agreement with the v0.3.1 release; omit for re-encoded builds.')
    return
  }
  await checkReportDestination(options.report, options.packs)
  const contract = await validateContracts()
  let report = contract
  if (options.mode !== 'contract') {
    const packs = await safeDirectory(options.packs)
    const fixture = options.releaseHashes ? await verifyReleaseFixture() : undefined
    const results = []
    for (const character of classes) {
      const directory = join(packs, character.id)
      try {
        results.push(options.mode === 'media'
          ? await validateMedia(directory, character, fixture)
          : await nativeImport(directory, character, fixture))
      }
      catch (error) { results.push({ class: character.id, status: 'failed', error: publicError(error, [packs]) }) }
    }
    const passed = results.filter(result => result.status === 'passed').length
    report = { mode: options.mode, releaseVersion: '0.3.1', sourceIntegrity: contract.sourceIntegrity,
      requestedClasses: 8, passed, expectedMediaCount: 960, fullEightClassValidation: passed === 8,
      releaseHashesRequired: options.releaseHashes,
      actualNativeImporterExecuted: options.mode === 'native',
      alphaMetadataInspected: options.mode === 'media', alphaPixelsDecoded: false,
      visualActionFidelityVerified: false, electronUiRuntimeVerified: false,
      ...(options.mode === 'native' ? { profileRemoved: results.every(result => result.profileRemoved) } : {}), results }
  }
  report.createdAt = new Date().toISOString()
  await mkdir(dirname(options.report), { recursive: true })
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`)
  const relativeReport = relative(packageRoot, options.report)
  console.log(JSON.stringify({ mode: report.mode, passed: report.passed, requested: 8,
    report: inside(packageRoot, options.report) ? relativeReport.split(sep).join('/') : '<external-report>',
    ...(report.passed !== 8 ? { failures: report.results.filter(result => result.status === 'failed') } : {}) }))
  if (report.passed !== 8) process.exitCode = 1
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main().catch(error => { console.error(publicError(error)); process.exitCode = 1 })

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, MeshAttachment, Physics, RegionAttachment, Skeleton, SkeletonJson, Texture, TextureAtlas } from '@esotericsoftware/spine-webgl'
import { ANIMATION_NAMES, ARM_WEIGHT_RANGE, ASSET_NAMES, FOREARM_NAMES, PART_NAMES, pngDimensions } from './build-rig.mjs'

class HeadlessTexture extends Texture {
  setFilters() {}
  setWraps() {}
  dispose() {}
}

function triangleArea(vertices, indices, offset) {
  const [a, b, c] = indices.slice(offset, offset + 3).map(index => index * 2)
  return ((vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) - (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a])) / 2
}

function inspectPose(skeleton, label, bounds, meshOrientation) {
  const pose = []
  for (const bone of skeleton.bones) {
    for (const field of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'a', 'b', 'c', 'd', 'worldX', 'worldY']) {
      assert(Number.isFinite(bone[field]), `${label}: ${bone.data.name}.${field} is non-finite.`)
      pose.push(bone[field])
    }
  }
  let attachments = 0
  for (const slot of skeleton.slots) {
    const attachment = slot.getAttachment()
    assert(attachment instanceof RegionAttachment || attachment instanceof MeshAttachment, `${label}: ${slot.data.name} is missing its image attachment.`)
    const vertices = new Float32Array(attachment instanceof MeshAttachment ? attachment.worldVerticesLength : 8)
    if (attachment instanceof MeshAttachment)
      attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2)
    else
      attachment.computeWorldVertices(slot, vertices, 0, 2)
    for (const vertex of vertices) {
      assert(Number.isFinite(vertex), `${label}: invalid attachment vertex.`)
      pose.push(vertex)
    }
    if (bounds) {
      for (let i = 0; i < vertices.length; i += 2) {
        bounds.minX = Math.min(bounds.minX, vertices[i])
        bounds.minY = Math.min(bounds.minY, vertices[i + 1])
        bounds.maxX = Math.max(bounds.maxX, vertices[i])
        bounds.maxY = Math.max(bounds.maxY, vertices[i + 1])
      }
    }
    if (meshOrientation && attachment instanceof MeshAttachment && attachment.bones) {
      const baseline = meshOrientation.baselines.get(attachment.name)
      let invertedArea = 0
      for (let triangle = 0; triangle < attachment.triangles.length; triangle += 3) {
        const area = triangleArea(vertices, attachment.triangles, triangle)
        const initial = baseline[triangle / 3]
        if (initial * area >= 0) continue
        invertedArea += Math.abs(area)
        assert(Math.abs(initial) <= 1, `${label}: ${attachment.name} elbow mesh has a folded triangle.`)
      }
      // Float32 vertices can reverse almost-collinear slivers below a screen pixel.
      assert(invertedArea < 0.25, `${label}: ${attachment.name} elbow fold exceeds the subpixel tolerance.`)
      meshOrientation.maximumSubpixelInvertedArea = Math.max(meshOrientation.maximumSubpixelInvertedArea, invertedArea)
    }
    attachments++
  }
  assert.equal(attachments, PART_NAMES.length, `${label}: expected all nine visible parts.`)
  return pose
}

function createMeshOrientationCheck(data) {
  const skeleton = new Skeleton(data)
  skeleton.setSkinByName('default')
  skeleton.setToSetupPose()
  skeleton.updateWorldTransform(Physics.update)
  const baselines = new Map()
  for (const slot of skeleton.slots) {
    const attachment = slot.getAttachment()
    if (!(attachment instanceof MeshAttachment) || !attachment.bones) continue
    const vertices = new Float32Array(attachment.worldVerticesLength)
    attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2)
    baselines.set(attachment.name, Array.from({ length: attachment.triangles.length / 3 }, (_, i) => triangleArea(vertices, attachment.triangles, i * 3)))
  }
  return { baselines, maximumSubpixelInvertedArea: 0 }
}

function inspectWeights(attachment, data) {
  if (!attachment.bones) return false
  let boneCursor = 0
  let vertexCursor = 0
  for (let vertex = 0; vertex < attachment.worldVerticesLength / 2; vertex++) {
    const count = attachment.bones[boneCursor++]
    assert(Number.isInteger(count) && count > 0, `${attachment.name} has an invalid influence count.`)
    let sum = 0
    const influences = []
    for (let influence = 0; influence < count; influence++) {
      const index = attachment.bones[boneCursor++]
      assert(Number.isInteger(index) && data.bones[index], `${attachment.name} references an invalid bone.`)
      const [x, y, weight] = attachment.vertices.slice(vertexCursor, vertexCursor + 3)
      assert(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(weight) && weight >= 0 && weight <= 1, `${attachment.name} has invalid weighted vertices.`)
      sum += weight
      influences.push({ name: data.bones[index].name, weight })
      vertexCursor += 3
    }
    assert(Math.abs(sum - 1) < 0.000001, `${attachment.name} weights must sum to one.`)
    if (attachment.name === 'arm-left' || attachment.name === 'arm-right') {
      const v = attachment.regionUVs[vertex * 2 + 1]
      assert(influences.every(value => [attachment.name, `${attachment.name}-forearm`].includes(value.name)), `${attachment.name} is bound to an unrelated bone.`)
      if (v >= ARM_WEIGHT_RANGE[1]) assert(influences.length === 1 && influences[0].name === `${attachment.name}-forearm`, `${attachment.name} hand must be bound fully to its forearm.`)
      if (v <= ARM_WEIGHT_RANGE[0]) assert(influences.length === 1 && influences[0].name === attachment.name, `${attachment.name} shoulder must stay attached to its upper arm.`)
    }
  }
  assert.equal(boneCursor, attachment.bones.length, `${attachment.name} has trailing bone influences.`)
  assert.equal(vertexCursor, attachment.vertices.length, `${attachment.name} has trailing weighted coordinates.`)
  return true
}

function createUVSampler(data, slotName, point) {
  assert(Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${slotName} grip point must be a normalized UV coordinate.`)
  const slot = data.findSlot(slotName)
  const attachment = data.defaultSkin.getAttachment(slot.index, slot.attachmentName)
  const mesh = attachment instanceof MeshAttachment
  assert(mesh || attachment instanceof RegionAttachment, `${slotName} must have a renderable attachment.`)
  const uvs = mesh ? attachment.regionUVs : attachment.uvs.map((value, index) => index % 2 === 0
    ? (value - attachment.region.u) / (attachment.region.u2 - attachment.region.u)
    : (value - attachment.region.v) / (attachment.region.v2 - attachment.region.v))
  const triangles = mesh ? attachment.triangles : [0, 1, 2, 2, 3, 0]
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const indices = triangles.slice(triangle, triangle + 3)
    const [a, b, c] = indices.map(index => [uvs[index * 2], uvs[index * 2 + 1]])
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(denominator) < 0.000000000001) continue
    const wa = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator
    const wb = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator
    const weights = [wa, wb, 1 - wa - wb]
    if (weights.some(value => value < -0.000001 || value > 1.000001)) continue
    return { slotName, indices, weights, mesh }
  }
  throw new Error(`${slotName} grip UV is outside its rendered polygon.`)
}

function sampleWorldUV(skeleton, sampler) {
  const slot = skeleton.findSlot(sampler.slotName)
  const attachment = slot.getAttachment()
  const vertices = new Float32Array(sampler.mesh ? attachment.worldVerticesLength : 8)
  if (sampler.mesh) attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2)
  else attachment.computeWorldVertices(slot, vertices, 0, 2)
  return sampler.indices.reduce((point, index, i) => [point[0] + vertices[index * 2] * sampler.weights[i], point[1] + vertices[index * 2 + 1] * sampler.weights[i]], [0, 0])
}

function inspectGrip(skeleton, samplers, label) {
  if (!samplers) return 0
  const hand = sampleWorldUV(skeleton, samplers.arm)
  const handle = sampleWorldUV(skeleton, samplers.bow)
  const drift = Math.hypot(hand[0] - handle[0], hand[1] - handle[1])
  assert(Number.isFinite(drift) && drift <= 1, `${label}: actual fist/handle UV points separate by ${drift.toFixed(4)} scene units.`)
  return drift
}

const newBounds = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
const reportBounds = bounds => Object.fromEntries(Object.entries({ ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }).map(([key, value]) => [key, Number(value.toFixed(3))]))

function inspectIdleDeformationSource(skeletonJson) {
  const expected = {}
  for (const [name, maxAmplitude] of [['cape', 4], ['hair-back', 3]]) {
    const attachment = skeletonJson.skins.find(skin => skin.name === 'default').attachments[name][name]
    if (attachment.type !== 'mesh') continue
    const frames = skeletonJson.animations.idle.attachments?.default?.[name]?.[name]?.deform
    assert(frames?.length >= 2, `${name} is missing its idle mesh deformation.`)
    assert.equal(frames[0].time, 0, `${name} deformation must start at zero.`)
    assert.equal(frames.at(-1).time, 5, `${name} deformation must close at five seconds.`)
    let maximum = 0
    for (const frame of frames) {
      assert.equal(frame.vertices.length, attachment.vertices.length, `${name} deformation vertex count differs from its mesh.`)
      for (let i = 0; i < frame.vertices.length; i++) {
        const value = frame.vertices[i]
        assert(Number.isFinite(value), `${name} has a non-finite deformation offset.`)
        assert(Math.abs(value) <= maxAmplitude + 0.00001, `${name} exceeds its gentle deformation amplitude.`)
        if (i % 2 === 1) assert.equal(value, 0, `${name} deformation must preserve vertex height.`)
        maximum = Math.max(maximum, Math.abs(value))
      }
    }
    assert(frames[0].vertices.every(value => value === 0) && frames.at(-1).vertices.every(value => value === 0), `${name} deformation does not return to zero at the loop seam.`)
    assert(maximum > 0.25, `${name} has no meaningful local mesh deformation.`)
    expected[name] = { maximumAuthoredOffset: Number(maximum.toFixed(6)), maximumRuntimeOffset: 0 }
  }
  return expected
}

function measureRuntimeMeshDeformation(skeleton, report) {
  for (const [name, result] of Object.entries(report)) {
    const slot = skeleton.findSlot(name)
    const attachment = slot.getAttachment()
    assert(attachment instanceof MeshAttachment, `${name} must remain a mesh.`)
    if (!slot.deform.length) continue
    assert.equal(slot.deform.length, attachment.vertices.length, `${name} runtime deformation is incomplete.`)
    for (let i = 0; i < slot.deform.length; i++) {
      const offset = slot.deform[i] - attachment.vertices[i]
      assert(Number.isFinite(offset), `${name} has a non-finite runtime deformation.`)
      result.maximumRuntimeOffset = Math.max(result.maximumRuntimeOffset, Math.abs(offset))
    }
  }
}

function maxDifference(first, second) {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index])))
}

export function validateRigData(skeletonJson, atlasText, image, layoutDocument = {}) {
  if (layoutDocument.grip) {
    for (const [name, animation] of Object.entries(skeletonJson.animations))
      assert(!animation.bones?.bow, `${name}: a closed grip must not animate the bow independently of the forearm.`)
  }
  assert.match(skeletonJson.skeleton.spine, /^4\.2\./, 'The asset must target Spine 4.2.')
  const atlas = new TextureAtlas(atlasText)
  assert(atlas.pages.length >= 1, 'Expected at least one unmodified source image.')
  assert.equal(atlas.regions.length, PART_NAMES.length, 'Expected nine atlas regions.')
  const pageNames = new Set()
  for (const page of atlas.pages) {
    assert(!pageNames.has(page.name), `Duplicate atlas page: ${page.name}.`)
    pageNames.add(page.name)
    const size = image.pages?.[page.name] ?? (page.name === ASSET_NAMES.png ? image : undefined)
    assert(size, `Missing actual PNG dimensions for page ${page.name}.`)
    assert.equal(page.width, size.width, `${page.name} width differs from its PNG.`)
    assert.equal(page.height, size.height, `${page.name} height differs from its PNG.`)
    page.setTexture(new HeadlessTexture({ width: size.width, height: size.height }))
  }
  const names = new Set()
  for (const region of atlas.regions) {
    assert(!names.has(region.name), `Duplicate atlas region ${region.name}.`)
    names.add(region.name)
    assert(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= region.page.width && region.y + region.height <= region.page.height, `${region.name} exceeds its atlas page boundaries.`)
  }
  for (const name of PART_NAMES) assert(names.has(name), `Missing atlas region ${name}.`)
  const loader = new SkeletonJson(new AtlasAttachmentLoader(atlas))
  const data = loader.readSkeletonData(skeletonJson)
  assert(data.defaultSkin, 'A default skin is required.')
  assert.equal(data.findBone('bow').parent.name, 'arm-right-forearm', 'The bow must be parented to the holding forearm.')
  const gripSamplers = layoutDocument.grip ? {
    arm: createUVSampler(data, 'arm-right', layoutDocument.grip.armUV),
    bow: createUVSampler(data, 'bow', layoutDocument.grip.bowUV),
  } : undefined
  for (const name of FOREARM_NAMES) assert(data.findBone(name), `Missing elbow bone ${name}.`)
  assert.equal(data.bones.length, PART_NAMES.length + FOREARM_NAMES.length + 1, 'Unexpected bone count.')
  let meshCount = 0
  let weightedMeshCount = 0
  for (const slot of data.slots) {
    const attachment = data.defaultSkin.getAttachment(slot.index, slot.attachmentName)
    if (!(attachment instanceof MeshAttachment)) continue
    meshCount++
    assert(attachment.worldVerticesLength >= 6 && attachment.worldVerticesLength % 2 === 0, `Mesh ${attachment.name} needs at least three vertices.`)
    assert.equal(attachment.regionUVs.length, attachment.worldVerticesLength, `Mesh ${attachment.name} UV count is invalid.`)
    for (const uv of attachment.regionUVs) assert(Number.isFinite(uv) && uv >= 0 && uv <= 1, `Mesh ${attachment.name} UV exceeds the atlas region.`)
    assert(attachment.triangles.length >= 3 && attachment.triangles.length % 3 === 0, `Mesh ${attachment.name} has invalid triangles.`)
    for (const index of attachment.triangles) assert(Number.isInteger(index) && index >= 0 && index < attachment.worldVerticesLength / 2, `Mesh ${attachment.name} triangle index is invalid.`)
    if (inspectWeights(attachment, data)) weightedMeshCount++
  }
  for (const name of ANIMATION_NAMES) assert(data.findAnimation(name), `Missing animation ${name}.`)
  const idleMeshDeformations = inspectIdleDeformationSource(skeletonJson)
  const meshOrientation = createMeshOrientationCheck(data)
  const results = []
  let totalFrames = 0
  let maximumGripDrift = 0
  const allMotionBounds = newBounds()
  for (const animation of data.animations) {
    assert(animation.duration > 0 && Number.isFinite(animation.duration), `${animation.name} has no finite duration.`)
    const skeleton = new Skeleton(data)
    skeleton.setSkinByName('default')
    skeleton.setToSetupPose()
    const state = new AnimationState(new AnimationStateData(data))
    state.setAnimation(0, animation.name, false)
    state.apply(skeleton)
    skeleton.updateWorldTransform(Physics.update)
    const motionBounds = newBounds()
    const first = inspectPose(skeleton, `${animation.name}@0`, motionBounds, meshOrientation)
    const frameCount = Math.ceil(animation.duration * 60)
    let maxMotion = 0
    for (let i = 1; i <= frameCount; i++) {
      state.update(animation.duration / frameCount)
      state.apply(skeleton)
      skeleton.updateWorldTransform(Physics.update)
      const pose = inspectPose(skeleton, `${animation.name}@${i}`, motionBounds, meshOrientation)
      maximumGripDrift = Math.max(maximumGripDrift, inspectGrip(skeleton, gripSamplers, `${animation.name}@${i}`))
      if (animation.name === 'idle') measureRuntimeMeshDeformation(skeleton, idleMeshDeformations)
      maxMotion = Math.max(maxMotion, maxDifference(first, pose))
      totalFrames++
    }
    const last = inspectPose(skeleton, `${animation.name}@end`)
    const endpointError = maxDifference(first, last)
    assert(endpointError < 0.001, `${animation.name} endpoints do not return to setup deltas: ${endpointError}.`)
    assert(maxMotion > 0.01, `${animation.name} contains no visible bone movement.`)
    allMotionBounds.minX = Math.min(allMotionBounds.minX, motionBounds.minX)
    allMotionBounds.minY = Math.min(allMotionBounds.minY, motionBounds.minY)
    allMotionBounds.maxX = Math.max(allMotionBounds.maxX, motionBounds.maxX)
    allMotionBounds.maxY = Math.max(allMotionBounds.maxY, motionBounds.maxY)
    results.push({ name: animation.name, duration: animation.duration, sampledFrames: frameCount, endpointError: Number(endpointError.toFixed(8)), motionBounds: reportBounds(motionBounds) })
  }
  for (const [name, result] of Object.entries(idleMeshDeformations)) {
    assert(result.maximumRuntimeOffset > 0.25, `${name} idle deformation did not move its mesh at runtime.`)
    result.maximumRuntimeOffset = Number(result.maximumRuntimeOffset.toFixed(6))
  }
  // Match AIRI's continuous idle on track 0 and transient emotions on track 1.
  for (const emotion of ANIMATION_NAMES.filter(name => name !== 'idle')) {
    const skeleton = new Skeleton(data)
    skeleton.setSkinByName('default')
    skeleton.setToSetupPose()
    const stateData = new AnimationStateData(data)
    stateData.defaultMix = 0.2
    const state = new AnimationState(stateData)
    state.setAnimation(0, 'idle', true)
    state.setAnimation(1, emotion, false)
    state.addEmptyAnimation(1, 0.2, data.findAnimation(emotion).duration)
    for (let i = 0; i < 420; i++) {
      state.update(1 / 60)
      state.apply(skeleton)
      skeleton.updateWorldTransform(Physics.update)
      inspectPose(skeleton, `mixed:${emotion}@${i}`, undefined, meshOrientation)
      maximumGripDrift = Math.max(maximumGripDrift, inspectGrip(skeleton, gripSamplers, `mixed:${emotion}@${i}`))
      totalFrames++
    }
  }
  atlas.dispose()
  return { runtime: 'Spine 4.2', bones: data.bones.length, slots: data.slots.length, regions: names.size, pages: [...pageNames], meshAttachments: meshCount, weightedMeshAttachments: weightedMeshCount, totalSampledFrames: totalFrames, gripConstraint: gripSamplers ? 'rendered-uv-barycentric' : 'not-configured', maximumGripDrift: gripSamplers ? Number(maximumGripDrift.toFixed(8)) : null, maximumSubpixelInvertedArea: Number(meshOrientation.maximumSubpixelInvertedArea.toFixed(6)), allMotionBounds: reportBounds(allMotionBounds), idleMeshDeformations, animations: results, visualReviewRequired: true }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const output = resolve(root, 'output')
  const jsonBytes = await readFile(resolve(output, ASSET_NAMES.json))
  const atlasBytes = await readFile(resolve(output, ASSET_NAMES.atlas))
  const atlas = new TextureAtlas(atlasBytes.toString('utf8'))
  const expected = new Map([[ASSET_NAMES.json, jsonBytes], [ASSET_NAMES.atlas, atlasBytes]])
  const pageSizes = {}
  const sourceImageHashes = {}
  for (const page of atlas.pages) {
    assert(/^[a-z0-9][a-z0-9._-]*\.png$/i.test(page.name), 'Atlas page must be a plain PNG filename.')
    const sourceBytes = await readFile(resolve(root, 'source', page.name))
    const imageBytes = await readFile(resolve(output, page.name))
    assert.equal(sha256(sourceBytes), sha256(imageBytes), `Output ${page.name} differs from its generated source pixels.`)
    expected.set(page.name, imageBytes)
    pageSizes[page.name] = pngDimensions(imageBytes)
    sourceImageHashes[page.name] = sha256(sourceBytes)
  }
  const zip = await JSZip.loadAsync(await readFile(resolve(output, ASSET_NAMES.zip)), { checkCRC32: true })
  assert.deepEqual(Object.keys(zip.files).sort(), [...expected.keys()].sort(), 'ZIP must contain exactly the runtime JSON, atlas, and referenced PNG pages.')
  for (const [name, bytes] of expected) assert.equal(sha256(await zip.file(name).async('nodebuffer')), sha256(bytes), `ZIP entry differs from output: ${name}`)
  let layout = {}
  try { layout = JSON.parse(await readFile(resolve(root, 'source', 'rig-layout.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const report = validateRigData(JSON.parse(jsonBytes.toString('utf8')), atlasBytes.toString('utf8'), { ...pageSizes[ASSET_NAMES.png], pages: pageSizes }, layout)
  console.log(JSON.stringify({ ...report, sourceImageSha256: sourceImageHashes[ASSET_NAMES.png], sourceImagesSha256: sourceImageHashes, zipIntegrity: 'passed', sourcePixelsUnchanged: true }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1 })

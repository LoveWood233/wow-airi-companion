import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import earcut, { deviation } from 'earcut'

export const PART_NAMES = ['head', 'torso', 'cape', 'arm-right', 'arm-left', 'leg-right', 'leg-left', 'bow', 'hair-back']
export const FOREARM_NAMES = ['arm-right-forearm', 'arm-left-forearm']
export const ARM_WEIGHT_RANGE = [0.30, 0.60]
export const ANIMATION_NAMES = ['idle', 'greet', 'wave', 'celebrate', 'sad', 'angry', 'think', 'surprise', 'awkward', 'question', 'curious', 'look-around', 'nod', 'head-shake', 'listen', 'salute', 'stretch', 'ready', 'bounce']
export const ASSET_NAMES = { json: 'sylvanas-companion.json', atlas: 'sylvanas-companion.atlas', png: 'sylvanas-atlas.png', zip: 'sylvanas-companion.spine.zip' }

const DEFAULT_PARTS = {
  torso: { x: 0, y: 300, width: 220, height: 235, pivotX: 0.5, pivotY: 0.9, parent: 'root' },
  head: { x: 0, y: 505, width: 270, height: 235, pivotX: 0.5, pivotY: 0.9, parent: 'torso' },
  cape: { x: 0, y: 485, width: 330, height: 400, pivotX: 0.5, pivotY: 0.08, parent: 'torso' },
  'hair-back': { x: 0, y: 650, width: 260, height: 305, pivotX: 0.5, pivotY: 0.08, parent: 'head' },
  'arm-right': { x: -95, y: 475, width: 115, height: 220, pivotX: 0.5, pivotY: 0.1, parent: 'torso' },
  'arm-left': { x: 95, y: 475, width: 115, height: 220, pivotX: 0.5, pivotY: 0.1, parent: 'torso' },
  'leg-right': { x: -51, y: 295, width: 100, height: 255, pivotX: 0.5, pivotY: 0.08, parent: 'root' },
  'leg-left': { x: 51, y: 295, width: 100, height: 255, pivotX: 0.5, pivotY: 0.08, parent: 'root' },
  bow: { x: -165, y: 355, width: 155, height: 350, pivotX: 0.5, pivotY: 0.5, parent: 'arm-right-forearm' },
}
const DEFAULT_ORDER = ['cape', 'hair-back', 'leg-right', 'leg-left', 'torso', 'arm-right', 'bow', 'arm-left', 'head']
const round = value => Math.abs(value) < 0.000001 ? 0 : Number(value.toFixed(6))
const radians = degrees => degrees * Math.PI / 180
const smoothstep = value => value * value * (3 - 2 * value)

function finite(value, description) {
  if (!Number.isFinite(value)) throw new Error(`${description} must be a finite number.`)
  return value
}

export function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR')
    throw new Error('Source atlas must be a PNG with a valid IHDR header.')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height) throw new Error('Source atlas dimensions must be positive.')
  return { width, height }
}

export function referencedPageNames(document) {
  const list = Array.isArray(document) ? document : document.regions
  if (!Array.isArray(list)) throw new Error('atlas-regions.json requires an array, or { regions: [...] }.')
  const names = [...new Set(list.map(region => region.page ?? ASSET_NAMES.png))]
  for (const name of names) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.png$/i.test(name))
      throw new Error('Atlas page names must be plain PNG filenames without directory components.')
  }
  return names
}

function resolvePages(document, image) {
  const declared = Array.isArray(document) ? {} : document.pages ?? {}
  const pages = {}
  for (const name of referencedPageNames(document)) {
    const size = name === ASSET_NAMES.png ? image : declared[name] ?? image.pages?.[name]
    if (!size) throw new Error(`Missing dimensions for atlas page ${name}. Add pages[${JSON.stringify(name)}].`)
    for (const key of ['width', 'height']) {
      if (!Number.isInteger(size[key]) || size[key] <= 0) throw new Error(`${name}.${key} must be a positive integer.`)
    }
    if (declared[name] && (declared[name].width !== size.width || declared[name].height !== size.height))
      throw new Error(`Declared dimensions for ${name} differ from the source PNG.`)
    pages[name] = { width: size.width, height: size.height }
  }
  return pages
}

function regionMap(document, pages) {
  const list = Array.isArray(document) ? document : document.regions
  if (!Array.isArray(list)) throw new Error('atlas-regions.json requires an array, or { regions: [...] }.')
  const map = new Map()
  for (const region of list) {
    const page = region.page ?? ASSET_NAMES.png
    const image = pages[page]
    if (!PART_NAMES.includes(region.name)) throw new Error(`Unknown region: ${region.name}`)
    if (map.has(region.name)) throw new Error(`Duplicate region: ${region.name}`)
    for (const key of ['x', 'y', 'width', 'height']) {
      finite(region[key], `${region.name}.${key}`)
      if (!Number.isInteger(region[key])) throw new Error(`${region.name}.${key} must be an integer pixel value.`)
    }
    if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > image.width || region.y + region.height > image.height)
      throw new Error(`Region ${region.name} is outside the ${image.width} × ${image.height} atlas.`)
    map.set(region.name, { ...region, page })
  }
  for (const name of PART_NAMES) if (!map.has(name)) throw new Error(`Missing region: ${name}`)
  return map
}

function applyGripAlignment(parts, regions, grip) {
  if (!grip) return
  for (const key of ['armUV', 'bowUV']) {
    const uv = grip[key]
    if (!Array.isArray(uv) || uv.length !== 2 || uv.some(value => !Number.isFinite(value) || value < 0 || value > 1))
      throw new Error(`grip.${key} must be a normalized [u, v] coordinate.`)
  }
  if (!regions.get('arm-right').polygon) throw new Error('A visual grip constraint requires the holding arm to use a mesh polygon.')
  if (grip.armUV[1] < ARM_WEIGHT_RANGE[1]) throw new Error(`grip.armUV must be in the fully bound forearm region (v >= ${ARM_WEIGHT_RANGE[1]}).`)
  const arm = parts['arm-right']
  const x = (grip.armUV[0] - arm.pivotX) * arm.width * (arm.flipX ? -1 : 1)
  const y = (arm.pivotY - grip.armUV[1]) * arm.height
  const angle = radians(arm.rotation)
  parts.bow = {
    ...parts.bow,
    parent: 'arm-right-forearm',
    pivotX: grip.bowUV[0], pivotY: grip.bowUV[1],
    x: arm.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: arm.y + x * Math.sin(angle) + y * Math.cos(angle),
  }
}

function polygonAttachment(region, part) {
  if (!Array.isArray(region.polygon)) throw new Error(`${region.name}.polygon must be an array of [u, v] pairs.`)
  const polygon = []
  for (const point of region.polygon) {
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1))
      throw new Error(`${region.name}.polygon coordinates must be finite normalized [u, v] pairs between 0 and 1.`)
    const previous = polygon.at(-1)
    if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) polygon.push(point)
  }
  if (polygon.length > 1 && polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1]) polygon.pop()
  if (polygon.length < 3) throw new Error(`${region.name}.polygon requires at least three distinct vertices.`)
  const uvs = polygon.flat()
  const triangles = earcut(uvs)
  if (triangles.length < 3 || deviation(uvs, null, 2, triangles) > 0.000001)
    throw new Error(`${region.name}.polygon could not be triangulated without losing area.`)
  const twiceArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  if (Math.abs(twiceArea) < 0.00000001) throw new Error(`${region.name}.polygon has zero area.`)
  if (part.flipX) {
    for (let i = 0; i < triangles.length; i += 3)
      [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]]
  }
  return {
    type: 'mesh', path: region.name,
    uvs, triangles,
    vertices: polygon.flatMap(([u, v]) => [round((u - part.pivotX) * part.width * (part.flipX ? -1 : 1)), round((part.pivotY - v) * part.height)]),
    hull: polygon.length,
    width: part.width, height: part.height,
  }
}

function splitPolygonAtRow(polygon, row, keepAbove) {
  const result = []
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]
    const previous = polygon[(i + polygon.length - 1) % polygon.length]
    const inside = point => keepAbove ? point[1] <= row : point[1] >= row
    if (inside(current) !== inside(previous)) {
      const t = (row - previous[1]) / (current[1] - previous[1])
      result.push([previous[0] + (current[0] - previous[0]) * t, row])
    }
    if (inside(current)) result.push(current)
  }
  return result
}

/** Add shared vertices around the elbow so the texture bends across several rows. */
function subdivideArmMesh(attachment, part) {
  const originalUVs = attachment.uvs
  const uvs = []
  const triangles = []
  const indexes = new Map()
  const addVertex = point => {
    const key = point.map(value => value.toFixed(8)).join(',')
    if (!indexes.has(key)) {
      indexes.set(key, uvs.length / 2)
      uvs.push(...point)
    }
    return indexes.get(key)
  }
  for (let i = 0; i < attachment.triangles.length; i += 3) {
    let polygons = [attachment.triangles.slice(i, i + 3).map(index => originalUVs.slice(index * 2, index * 2 + 2))]
    for (const row of [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65]) {
      const next = []
      for (const polygon of polygons) {
        if (Math.min(...polygon.map(point => point[1])) < row && Math.max(...polygon.map(point => point[1])) > row)
          next.push(splitPolygonAtRow(polygon, row, true), splitPolygonAtRow(polygon, row, false))
        else next.push(polygon)
      }
      polygons = next
    }
    for (const polygon of polygons) {
      const flat = polygon.flat()
      const indices = earcut(flat)
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const vertexIds = indices.slice(triangle, triangle + 3).map(index => addVertex(polygon[index]))
        if (part.flipX) [vertexIds[1], vertexIds[2]] = [vertexIds[2], vertexIds[1]]
        triangles.push(...vertexIds)
      }
    }
  }
  attachment.uvs = uvs
  attachment.triangles = triangles
  attachment.vertices = uvs.flatMap((value, index) => index % 2 === 0
    ? [round((value - part.pivotX) * part.width * (part.flipX ? -1 : 1)), round((part.pivotY - uvs[index + 1]) * part.height)]
    : [])
  delete attachment.hull
}

function weightArmMesh(attachment, name, part, bones) {
  subdivideArmMesh(attachment, part)
  const upperIndex = bones.findIndex(bone => bone.name === name)
  const lowerIndex = bones.findIndex(bone => bone.name === `${name}-forearm`)
  const elbow = bones[lowerIndex]
  const weighted = []
  for (let i = 0; i < attachment.uvs.length; i += 2) {
    const weight = round(smoothstep(Math.max(0, Math.min(1, (attachment.uvs[i + 1] - ARM_WEIGHT_RANGE[0]) / (ARM_WEIGHT_RANGE[1] - ARM_WEIGHT_RANGE[0])))))
    const x = attachment.vertices[i]
    const y = attachment.vertices[i + 1]
    if (weight === 0) weighted.push(1, upperIndex, x, y, 1)
    else if (weight === 1) weighted.push(1, lowerIndex, round(x - elbow.x), round(y - elbow.y), 1)
    else weighted.push(2, upperIndex, x, y, round(1 - weight), lowerIndex, round(x - elbow.x), round(y - elbow.y), weight)
  }
  attachment.vertices = weighted
}

/** World pivots use Y-up coordinates. Image pivots use top-left normalized coordinates. */
function resolveParts(document) {
  const overrides = document.parts ?? {}
  for (const name of Object.keys(overrides)) if (!PART_NAMES.includes(name)) throw new Error(`Unknown layout part: ${name}`)
  const parts = Object.fromEntries(PART_NAMES.map(name => [name, { rotation: 0, flipX: false, ...DEFAULT_PARTS[name], ...overrides[name] }]))
  for (const [name, part] of Object.entries(parts)) {
    for (const key of ['x', 'y', 'width', 'height', 'pivotX', 'pivotY', 'rotation']) finite(part[key], `${name}.${key}`)
    if (part.width <= 0 || part.height <= 0) throw new Error(`${name} requires positive width and height.`)
    if (part.pivotX < 0 || part.pivotX > 1 || part.pivotY < 0 || part.pivotY > 1) throw new Error(`${name} pivots must be between 0 and 1.`)
    if (typeof part.flipX !== 'boolean') throw new Error(`${name}.flipX must be a boolean.`)
    if (part.elbowX !== undefined) finite(part.elbowX, `${name}.elbowX`)
    if (part.elbowY !== undefined) finite(part.elbowY, `${name}.elbowY`)
    if (part.parent !== 'root' && !parts[part.parent] && !FOREARM_NAMES.includes(part.parent)) throw new Error(`${name} has an unknown parent: ${part.parent}`)
  }
  const order = document.drawOrder ?? DEFAULT_ORDER
  if (order.length !== PART_NAMES.length || new Set(order).size !== PART_NAMES.length || order.some(name => !PART_NAMES.includes(name)))
    throw new Error('drawOrder must contain every part name exactly once, from back to front.')
  return { parts, order }
}

function createBones(parts) {
  const nodes = { ...parts }
  for (const name of FOREARM_NAMES) {
    const parentName = name.replace('-forearm', '')
    const parent = parts[parentName]
    const localX = parent.elbowX ?? (parentName === 'arm-left' ? 1 : -1) * parent.width * 0.31 * (parent.flipX ? -1 : 1)
    const localY = parent.elbowY ?? -parent.height * 0.325
    const angle = radians(parent.rotation)
    nodes[name] = {
      parent: parentName,
      x: parent.x + localX * Math.cos(angle) - localY * Math.sin(angle),
      y: parent.y + localX * Math.sin(angle) + localY * Math.cos(angle),
      rotation: parent.rotation,
    }
  }
  const bones = [{ name: 'root' }]
  const visited = new Set(['root'])
  const active = new Set()
  function append(name) {
    if (visited.has(name)) return
    if (active.has(name)) throw new Error(`Bone parent cycle includes ${name}.`)
    active.add(name)
    const part = nodes[name]
    append(part.parent)
    const parent = part.parent === 'root' ? { x: 0, y: 0, rotation: 0 } : nodes[part.parent]
    const angle = radians(-parent.rotation)
    const dx = part.x - parent.x
    const dy = part.y - parent.y
    bones.push({
      name, parent: part.parent,
      x: round(dx * Math.cos(angle) - dy * Math.sin(angle)),
      y: round(dx * Math.sin(angle) + dy * Math.cos(angle)),
      rotation: round(part.rotation - parent.rotation),
    })
    active.delete(name)
    visited.add(name)
  }
  for (const name of [...PART_NAMES, ...FOREARM_NAMES]) append(name)
  return bones
}

function modelBounds(parts) {
  const points = []
  for (const part of Object.values(parts)) {
    const angle = radians(part.rotation)
    for (const horizontal of [0, 1]) for (const vertical of [0, 1]) {
      const x = (horizontal - part.pivotX) * part.width * (part.flipX ? -1 : 1)
      const y = (part.pivotY - vertical) * part.height
      points.push({ x: part.x + x * Math.cos(angle) - y * Math.sin(angle), y: part.y + x * Math.sin(angle) + y * Math.cos(angle) })
    }
  }
  const minX = Math.min(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  return { x: round(minX), y: round(minY), width: round(Math.max(...points.map(point => point.x)) - minX), height: round(Math.max(...points.map(point => point.y)) - minY) }
}

const cycle = (u, phase = 0) => Math.sin(2 * Math.PI * u + phase) - Math.sin(phase)
const envelope = u => Math.sin(Math.PI * u) ** 2
const set = (pose, bone, values) => { pose[bone] = { ...pose[bone], ...values } }

function poseAt(name, u) {
  const pose = {}
  const e = envelope(u)
  if (name === 'idle') {
    set(pose, 'root', { x: 1.5 * cycle(u) })
    set(pose, 'torso', { y: 3 * e + 0.5 * envelope(2 * u), rotation: 1.1 * cycle(u), scaleY: 1 + 0.014 * e })
    set(pose, 'head', { x: 1.5 * cycle(u) + 1.1 * e * cycle(2 * u), rotation: -2.2 * cycle(u) + 1.3 * e * cycle(2 * u) })
    set(pose, 'cape', { rotation: 2.1 * cycle(u, 0.6), scaleY: 1 + 0.008 * cycle(u, 0.6) })
    set(pose, 'hair-back', { rotation: -1.8 * cycle(u, 0.9) })
    set(pose, 'arm-left', { rotation: 1.5 * cycle(u, 0.25) })
    set(pose, 'arm-right', { rotation: -0.9 * cycle(u, 0.25) })
    set(pose, 'arm-left-forearm', { rotation: 2.2 * cycle(u, 0.5) })
    set(pose, 'arm-right-forearm', { rotation: -0.7 * cycle(u, 0.5) })
    set(pose, 'bow', { rotation: 0.4 * cycle(u, 0.5) })
    return pose
  }
  // These envelopes return to setup deltas with zero endpoint velocity.
  if (name === 'greet' || name === 'wave') {
    set(pose, 'arm-left', { rotation: e * (name === 'greet' ? 43 : 47) })
    set(pose, 'arm-left-forearm', { rotation: e * (name === 'greet' ? 52 : 54) + e * 6 * Math.sin(6 * Math.PI * u) })
    set(pose, 'head', { rotation: -4 * e, y: 2 * e })
    set(pose, 'torso', { rotation: -2 * e })
  }
  else if (name === 'celebrate') {
    set(pose, 'torso', { y: 11 * e * (0.6 + 0.4 * Math.sin(4 * Math.PI * u)), rotation: 3 * e * Math.sin(4 * Math.PI * u) })
    set(pose, 'arm-left', { rotation: 58 * e })
    set(pose, 'arm-left-forearm', { rotation: 45 * e + 5 * e * Math.sin(4 * Math.PI * u) })
    set(pose, 'arm-right', { rotation: -13 * e })
    set(pose, 'arm-right-forearm', { rotation: -8 * e })
    set(pose, 'head', { rotation: -4 * e * Math.sin(4 * Math.PI * u) })
    set(pose, 'cape', { rotation: 5 * e * Math.sin(4 * Math.PI * u) })
  }
  else if (name === 'sad') {
    set(pose, 'head', { rotation: 8 * e, y: -7 * e })
    set(pose, 'torso', { rotation: 3 * e, y: -4 * e })
    set(pose, 'arm-left', { rotation: -6 * e })
  }
  else if (name === 'angry') {
    set(pose, 'head', { rotation: -4 * e, x: 1.5 * e * Math.sin(8 * Math.PI * u) })
    set(pose, 'torso', { y: 3 * e })
    set(pose, 'arm-left', { rotation: 22 * e })
    set(pose, 'arm-left-forearm', { rotation: 38 * e })
    set(pose, 'arm-right', { rotation: -10 * e })
    set(pose, 'cape', { rotation: 4 * e * Math.sin(4 * Math.PI * u) })
  }
  else if (name === 'think') {
    set(pose, 'head', { rotation: -9 * e, x: 3 * e })
    set(pose, 'arm-left', { rotation: 25 * e })
    set(pose, 'arm-left-forearm', { rotation: 52 * e })
    set(pose, 'torso', { rotation: 2 * e })
  }
  else if (name === 'surprise') {
    set(pose, 'torso', { y: 9 * e, rotation: -3 * e })
    set(pose, 'head', { y: 5 * e, rotation: 5 * e })
    set(pose, 'arm-left', { rotation: 27 * e })
    set(pose, 'arm-left-forearm', { rotation: 32 * e })
    set(pose, 'arm-right', { rotation: -10 * e })
    set(pose, 'hair-back', { rotation: 4 * e })
  }
  else if (name === 'awkward') {
    set(pose, 'head', { rotation: 8 * e, x: 4 * e * Math.sin(2 * Math.PI * u) })
    set(pose, 'torso', { rotation: -3 * e })
    set(pose, 'arm-left', { rotation: 18 * e })
    set(pose, 'arm-left-forearm', { rotation: 24 * e })
  }
  else if (name === 'question') {
    set(pose, 'head', { rotation: -12 * e, y: 2 * e })
    set(pose, 'arm-left', { rotation: 27 * e })
    set(pose, 'arm-left-forearm', { rotation: 43 * e })
    set(pose, 'torso', { rotation: 2 * e })
  }
  else if (name === 'curious') {
    set(pose, 'head', { rotation: 9 * e * Math.cos(2 * Math.PI * u), x: 5 * e })
    set(pose, 'torso', { rotation: -3 * e, x: 3 * e })
    set(pose, 'hair-back', { rotation: -3 * e })
  }
  else if (name === 'look-around') {
    const glance = e * Math.sin(2 * Math.PI * u)
    set(pose, 'head', { rotation: -14 * glance, x: 9 * glance, y: 2 * e })
    set(pose, 'torso', { rotation: 3 * glance, x: -2 * glance })
    set(pose, 'hair-back', { rotation: 3 * glance })
  }
  else if (name === 'nod') {
    const nod = e * (0.5 + 0.5 * Math.cos(6 * Math.PI * u))
    set(pose, 'head', { y: -7 * nod, rotation: 4 * e * Math.sin(6 * Math.PI * u), scaleY: 1 - 0.02 * nod })
    set(pose, 'torso', { y: -1.5 * nod })
    set(pose, 'hair-back', { rotation: 2 * e * Math.sin(6 * Math.PI * u - 0.5) })
  }
  else if (name === 'head-shake') {
    const shake = e * Math.sin(6 * Math.PI * u)
    set(pose, 'head', { x: 8 * shake, rotation: 6 * shake })
    set(pose, 'hair-back', { rotation: -5 * shake })
    set(pose, 'torso', { rotation: -1.5 * shake })
  }
  else if (name === 'listen') {
    set(pose, 'head', { rotation: -11 * e, x: 4 * e, y: 2 * e })
    set(pose, 'arm-left', { rotation: 32 * e })
    set(pose, 'arm-left-forearm', { rotation: 57 * e })
    set(pose, 'torso', { rotation: 2.5 * e })
  }
  else if (name === 'salute') {
    set(pose, 'arm-left', { rotation: 42 * e })
    set(pose, 'arm-left-forearm', { rotation: 58 * e })
    set(pose, 'head', { rotation: -3 * e, y: 3 * e })
    set(pose, 'torso', { y: 3 * e, rotation: -1.5 * e })
  }
  else if (name === 'stretch') {
    set(pose, 'torso', { y: 5 * e, scaleY: 1 + 0.025 * e, rotation: -3 * e })
    set(pose, 'head', { y: 4 * e, rotation: 5 * e })
    set(pose, 'arm-left', { rotation: 75 * e })
    set(pose, 'arm-left-forearm', { rotation: 29 * e })
    set(pose, 'arm-right', { rotation: -7 * e })
    set(pose, 'arm-right-forearm', { rotation: -7 * e })
    set(pose, 'cape', { rotation: 4 * e })
  }
  else if (name === 'ready') {
    set(pose, 'torso', { rotation: -5 * e, x: -4 * e, y: -4 * e })
    set(pose, 'head', { rotation: 4 * e, x: -2 * e })
    set(pose, 'arm-right', { rotation: -8 * e })
    set(pose, 'arm-right-forearm', { rotation: -18 * e })
    set(pose, 'bow', { rotation: 5 * e })
    set(pose, 'arm-left', { rotation: 21 * e })
    set(pose, 'arm-left-forearm', { rotation: 49 * e })
    set(pose, 'cape', { rotation: 3 * e * Math.sin(2 * Math.PI * u) })
  }
  else if (name === 'bounce') {
    const hop = e * Math.sin(3 * Math.PI * u) ** 2
    set(pose, 'root', { y: 18 * hop })
    set(pose, 'torso', { scaleY: 1 - 0.025 * e + 0.035 * hop })
    set(pose, 'head', { y: 3 * hop, rotation: 3 * e * Math.sin(4 * Math.PI * u) })
    set(pose, 'arm-left', { rotation: 12 * hop })
    set(pose, 'arm-left-forearm', { rotation: 19 * hop })
    set(pose, 'arm-right-forearm', { rotation: -4 * hop })
    set(pose, 'cape', { rotation: 5 * e * Math.sin(4 * Math.PI * u) })
    set(pose, 'hair-back', { rotation: -4 * e * Math.sin(4 * Math.PI * u) })
  }
  return pose
}

function createAnimation(name, duration, fps) {
  const count = Math.ceil(duration * fps)
  const samples = Array.from({ length: count + 1 }, (_, i) => ({ time: round(i * duration / count), pose: poseAt(name, i / count) }))
  const bones = {}
  for (const bone of ['root', ...PART_NAMES, ...FOREARM_NAMES]) {
    const timelines = {}
    const rotation = samples.map(sample => ({ time: sample.time, value: round(sample.pose[bone]?.rotation ?? 0) }))
    const translation = samples.map(sample => ({ time: sample.time, x: round(sample.pose[bone]?.x ?? 0), y: round(sample.pose[bone]?.y ?? 0) }))
    const scale = samples.map(sample => ({ time: sample.time, x: round(sample.pose[bone]?.scaleX ?? 1), y: round(sample.pose[bone]?.scaleY ?? 1) }))
    if (rotation.some(frame => frame.value !== 0)) timelines.rotate = rotation
    if (translation.some(frame => frame.x !== 0 || frame.y !== 0)) timelines.translate = translation
    if (scale.some(frame => frame.x !== 1 || frame.y !== 1)) timelines.scale = scale
    if (Object.keys(timelines).length) bones[bone] = timelines
  }
  return { bones }
}

function addIdleMeshDeformation(animation, attachments, parts, fps, duration) {
  const count = Math.ceil(duration * fps)
  const deformations = {}
  for (const [name, amplitude, lag] of [['cape', 4, 0.15], ['hair-back', 3, 0.85]]) {
    const attachment = attachments[name][name]
    if (attachment.type !== 'mesh') continue
    const part = parts[name]
    const maxV = Math.max(...attachment.uvs.filter((_, index) => index % 2 === 1))
    const depthSpan = Math.max(0.000001, maxV - part.pivotY)
    const frames = Array.from({ length: count + 1 }, (_, index) => {
      const u = index / count
      const vertices = []
      for (let vertex = 0; vertex < attachment.uvs.length; vertex += 2) {
        const v = attachment.uvs[vertex + 1]
        const depth = Math.max(0, Math.min(1, (v - part.pivotY) / depthSpan))
        const weight = depth * depth * (3 - 2 * depth)
        const phase = lag + depth * 0.65
        // Phase follows the lower edge. Subtract the initial wave to close the loop.
        const wave = (Math.sin(2 * Math.PI * u - phase) + Math.sin(phase)) / (1 + Math.abs(Math.sin(phase)))
        vertices.push(round(amplitude * weight * wave), 0)
      }
      return { time: round(u * duration), vertices }
    })
    deformations[name] = { [name]: { deform: frames } }
  }
  if (Object.keys(deformations).length) animation.attachments = { default: deformations }
}

export function buildRig(regionDocument, image, layoutDocument = {}) {
  finite(image.width, 'Atlas width')
  finite(image.height, 'Atlas height')
  const pages = resolvePages(regionDocument, image)
  const regions = regionMap(regionDocument, pages)
  const { parts, order } = resolveParts(layoutDocument)
  applyGripAlignment(parts, regions, layoutDocument.grip)
  const fps = layoutDocument.animationFps ?? 20
  if (!Number.isInteger(fps) || fps < 10 || fps > 60) throw new Error('animationFps must be an integer between 10 and 60.')
  const bones = createBones(parts)
  const skins = [{ name: 'default', attachments: {} }]
  for (const name of PART_NAMES) {
    const part = parts[name]
    const region = regions.get(name)
    const attachment = region.polygon === undefined
      ? { type: 'region', path: name, x: round((0.5 - part.pivotX) * part.width * (part.flipX ? -1 : 1)), y: round((part.pivotY - 0.5) * part.height), scaleX: part.flipX ? -1 : 1, width: part.width, height: part.height }
      : polygonAttachment(region, part)
    if (attachment.type === 'mesh' && (name === 'arm-left' || name === 'arm-right')) weightArmMesh(attachment, name, part, bones)
    skins[0].attachments[name] = { [name]: attachment }
  }
  const durations = { idle: 5, greet: 2.8, wave: 3.4, celebrate: 2.8, sad: 3.2, angry: 2.4, think: 3.6, surprise: 1.8, awkward: 2.8, question: 2.8, curious: 3.2, 'look-around': 4.8, nod: 2.4, 'head-shake': 2.6, listen: 3.6, salute: 3, stretch: 4.2, ready: 3.4, bounce: 3.2 }
  const skeleton = {
    skeleton: { spine: '4.2.120', ...modelBounds(parts), fps, images: './', audio: '' },
    bones,
    slots: order.map(name => ({ name, bone: name, attachment: name })),
    skins,
    animations: Object.fromEntries(ANIMATION_NAMES.map(name => [name, createAnimation(name, durations[name], fps)])),
  }
  // A painted closed grip fixes both the handle position and its axis to the hand.
  // Let the forearm carry the weapon; independent bow twists would slip inside it.
  if (layoutDocument.grip) {
    for (const animation of Object.values(skeleton.animations)) delete animation.bones.bow
  }
  addIdleMeshDeformation(skeleton.animations.idle, skins[0].attachments, parts, fps, durations.idle)
  // Region UVs address the original PNG. No crops, resampling, or pixel edits occur.
  const atlas = []
  for (const [page, size] of Object.entries(pages)) {
    if (atlas.length) atlas.push('')
    atlas.push(page, `size: ${size.width}, ${size.height}`, 'format: RGBA8888', 'filter: Linear, Linear', 'repeat: none', 'pma: false')
    for (const name of PART_NAMES) {
      const region = regions.get(name)
      if (region.page !== page) continue
      atlas.push(name, `  bounds: ${region.x}, ${region.y}, ${region.width}, ${region.height}`, `  offsets: 0, 0, ${region.width}, ${region.height}`, '  rotate: false', '  index: -1')
    }
  }
  return { skeleton, atlasText: `${atlas.join('\n')}\n`, parts, pages }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const source = resolve(root, 'source')
  const output = resolve(root, 'output')
  const regions = JSON.parse(await readFile(resolve(source, 'atlas-regions.json'), 'utf8'))
  const sourcePages = new Map()
  const sizes = {}
  for (const page of referencedPageNames(regions)) {
    const bytes = await readFile(resolve(source, page))
    const size = pngDimensions(bytes)
    const declared = regions.pages?.[page]
    if (declared && (declared.width !== size.width || declared.height !== size.height))
      throw new Error(`Declared dimensions for ${page} differ from the source PNG.`)
    sourcePages.set(page, bytes)
    sizes[page] = size
  }
  let layout = {}
  try { layout = JSON.parse(await readFile(resolve(source, 'rig-layout.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const regionDocument = Array.isArray(regions) ? { regions, pages: sizes } : { ...regions, pages: sizes }
  const rig = buildRig(regionDocument, { ...sizes[ASSET_NAMES.png], pages: sizes }, layout)
  const json = `${JSON.stringify(rig.skeleton, null, 2)}\n`
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, ASSET_NAMES.json), json)
  await writeFile(resolve(output, ASSET_NAMES.atlas), rig.atlasText)
  for (const page of sourcePages.keys()) await copyFile(resolve(source, page), resolve(output, page))
  const zip = new JSZip()
  const options = { date: new Date('2000-01-01T00:00:00Z') }
  zip.file(ASSET_NAMES.json, json, options)
  zip.file(ASSET_NAMES.atlas, rig.atlasText, options)
  for (const [page, bytes] of sourcePages) zip.file(page, bytes, options)
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  await writeFile(resolve(output, ASSET_NAMES.zip), archive)
  console.log(JSON.stringify({ output, bones: rig.skeleton.bones.length, slots: rig.skeleton.slots.length, pages: Object.keys(rig.pages), animations: Object.keys(rig.skeleton.animations), archiveBytes: archive.length, sourcePixelsModified: false }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1 })

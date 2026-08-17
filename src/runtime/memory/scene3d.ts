export type Scene3DShape = 'person' | 'box' | 'plane' | 'wall' | 'entrance' | 'cylinder' | 'sphere' | 'cone' | 'line' | 'arrow'
export type Scene3DFormationType = 'line' | 'grid' | 'circle' | 'scatter'
export type Scene3DAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
export type Scene3DProjection = 'perspective' | 'orthographic'
export type Scene3DAnimationAction = 'show' | 'hide' | 'move' | 'rotate' | 'scale' | 'color' | 'camera' | 'label'

export interface Scene3DObject {
  id: string
  type: Scene3DShape
  label?: string
  color?: string
  position: [number, number, number]
  rotation?: [number, number, number]
  size?: [number, number, number]
  end?: [number, number, number]
  pose?: 'standing' | 'sitting' | 'crouching' | 'lying'
  character?: Scene3DCharacter
}

export type Scene3DCharacterModel = 'adult-male' | 'adult-female' | 'teen-male' | 'teen-female' | 'child'
export interface Scene3DCharacter {
  model: Scene3DCharacterModel
  scale: number
  bones?: Record<string, [number, number, number, number]>
}

export interface Scene3DFormation {
  id: string
  type: Scene3DFormationType
  shape?: Scene3DShape
  label?: string
  color?: string
  position: [number, number, number]
  count: number
  rows?: number
  columns?: number
  spacing?: number
  radius?: number
  width?: number
  depth?: number
  facing?: number
  size?: [number, number, number]
}

export interface Scene3DGroup {
  id: string
  label?: string
  memberIds: string[]
  position?: [number, number, number]
}

export interface Scene3DCamera {
  name?: string
  position: [number, number, number]
  target: [number, number, number]
  projection?: Scene3DProjection
  lens?: 'wide' | 'standard' | 'telephoto'
  aspect?: Scene3DAspect
}

export interface Scene3DTimelineEntry {
  at: number
  duration?: number
  target: string
  action: Scene3DAnimationAction
  to?: [number, number, number]
  lookAt?: [number, number, number]
  color?: string
  text?: string
  easing?: 'linear' | 'ease-in-out'
}

export interface Scene3DDocument {
  version: 1
  title: string
  objects: Scene3DObject[]
  formations: Scene3DFormation[]
  groups: Scene3DGroup[]
  camera: Scene3DCamera
  savedCameras: Scene3DCamera[]
  lighting: { direction: 'left' | 'right' | 'front' | 'back' | 'top'; intensity: 'low' | 'medium' | 'high'; shadows: boolean }
  canvas: { aspect: Scene3DAspect; grid: boolean; snap: boolean }
  duration?: number
  timeline?: Scene3DTimelineEntry[]
}

export interface Scene3DAnimationState {
  targets: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; visible: boolean; color?: string }>
  camera: { position: [number, number, number]; target: [number, number, number] }
  label: string
}

export type Scene3DEditOperation =
  | { action: 'add_object'; object: unknown }
  | { action: 'add_formation'; formation: unknown }
  | { action: 'move'; target: string; to: [number, number, number] }
  | { action: 'remove'; target: string }
  | { action: 'camera'; position?: [number, number, number]; lookAt?: [number, number, number] }

const SHAPES = new Set<Scene3DShape>(['person', 'box', 'plane', 'wall', 'entrance', 'cylinder', 'sphere', 'cone', 'line', 'arrow'])
const FORMATIONS = new Set<Scene3DFormationType>(['line', 'grid', 'circle', 'scatter'])
const ASPECTS = new Set<Scene3DAspect>(['16:9', '9:16', '1:1', '4:3', '3:4'])
const PROJECTIONS = new Set<Scene3DProjection>(['perspective', 'orthographic'])
const ANIMATION_ACTIONS = new Set<Scene3DAnimationAction>(['show', 'hide', 'move', 'rotate', 'scale', 'color', 'camera', 'label'])
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i
const CHARACTER_MODELS = new Set<Scene3DCharacterModel>(['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child'])
const CHARACTER_SCALE = { minimum: 0.1, maximum: 10 }
export const STORYBOARDER_BONE_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftEye', 'RightEye',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3', 'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3', 'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3', 'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3', 'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3',
] as const
const STORYBOARDER_BONES = new Set<string>(STORYBOARDER_BONE_NAMES)

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function text(value: unknown, fallback = '', maximum = 80): string {
  return String(value ?? fallback).trim().slice(0, maximum)
}

function id(value: unknown, label: string): string {
  const result = text(value, '', 64)
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error(`${label}无效`)
  return result
}

function number(value: unknown, fallback = 0, minimum = -10_000, maximum = 10_000): number {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new Error('场景数值超出范围')
  return result
}

function vector(value: unknown, fallback: [number, number, number] = [0, 0, 0], minimum = -10_000): [number, number, number] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.length !== 3) throw new Error('场景坐标必须包含三个数值')
  return [number(value[0], 0, minimum), number(value[1], 0, minimum), number(value[2], 0, minimum)]
}

function color(value: unknown, fallback = '#e7ece9'): string {
  const result = text(value, fallback, 24)
  if (!CSS_COLOR.test(result)) throw new Error('场景颜色无效')
  return result
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T, label: string): T {
  const result = String(value ?? fallback) as T
  if (!allowed.has(result)) throw new Error(`${label}无效`)
  return result
}

function parseCamera(value: unknown, fallbackName = ''): Scene3DCamera {
  const item = record(value ?? {}, '机位')
  const lens = String(item.lens || 'standard')
  if (!['wide', 'standard', 'telephoto'].includes(lens)) throw new Error('镜头类型无效')
  return {
    ...(text(item.name || fallbackName) ? { name: text(item.name || fallbackName) } : {}),
    position: vector(item.position, [10, 8, 12]),
    target: vector(item.target, [0, 1, 0]),
    projection: enumValue(item.projection, PROJECTIONS, 'perspective', '投影类型'),
    lens: lens as Scene3DCamera['lens'],
    aspect: enumValue(item.aspect, ASPECTS, '16:9', '画幅'),
  }
}

function quaternion(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) throw new Error('人物骨骼四元数无效')
  const result = value as [number, number, number, number]
  const normSquared = result.reduce((sum, item) => sum + item * item, 0)
  if (!Number.isFinite(normSquared) || Math.abs(normSquared - 1) > 0.1) throw new Error('人物骨骼四元数无效')
  return [...result]
}

function parseCharacter(value: unknown): Scene3DCharacter {
  const item = record(value, '人物资源')
  const model = String(item.model) as Scene3DCharacterModel
  if (!CHARACTER_MODELS.has(model)) throw new Error('人物模型不在允许清单')
  const scale = number(item.scale, 1, CHARACTER_SCALE.minimum, CHARACTER_SCALE.maximum)
  const rawBones = item.bones
  const bones = rawBones === undefined ? undefined : (() => {
    const source = record(rawBones, '人物骨骼')
    return Object.fromEntries(Object.entries(source).map(([name, value]) => {
      if (!STORYBOARDER_BONES.has(name)) throw new Error(`人物骨骼不在允许清单: ${name}`)
      return [name, quaternion(value)]
    }))
  })()
  return { model, scale, ...(bones ? { bones } : {}) }
}

export function parseScene3DDocument(input: unknown): Scene3DDocument {
  const root = record(input, '3D 白膜场景')
  if (root.version !== undefined && root.version !== 1) throw new Error('不支持的 3D 白膜场景版本')
  const title = text(root.title)
  if (!title) throw new Error('场景标题不能为空')
  const rawObjects = Array.isArray(root.objects) ? root.objects : []
  const rawFormations = Array.isArray(root.formations) ? root.formations : []
  const rawGroups = Array.isArray(root.groups) ? root.groups : []
  if (rawObjects.length > 500) throw new Error('独立对象最多 500 个，请使用排列')
  if (rawFormations.length > 100 || rawGroups.length > 100) throw new Error('场景排列或分组过多')

  const objects = rawObjects.map((value, index): Scene3DObject => {
    const item = record(value, `对象 ${index + 1}`)
    const type = enumValue(item.type, SHAPES, 'box', '积木类型')
    if (item.character !== undefined && type !== 'person') throw new Error('Storyboarder 角色只允许人物对象使用')
    const pose = String(item.pose || 'standing')
    if (!['standing', 'sitting', 'crouching', 'lying'].includes(pose)) throw new Error('人物姿势无效')
    return {
      id: id(item.id || `object_${index + 1}`, '对象 ID'), type,
      ...(text(item.label) ? { label: text(item.label) } : {}), color: color(item.color),
      position: vector(item.position), rotation: vector(item.rotation), size: vector(item.size, [1, 1, 1], 0.01),
      ...(item.end === undefined ? {} : { end: vector(item.end) }), pose: pose as Scene3DObject['pose'],
      ...(item.character === undefined ? {} : { character: parseCharacter(item.character) }),
    }
  })

  const formations = rawFormations.map((value, index): Scene3DFormation => {
    const item = record(value, `排列 ${index + 1}`)
    const count = Math.floor(number(item.count, 1, 1, 10_000))
    return {
      id: id(item.id || `formation_${index + 1}`, '排列 ID'),
      type: enumValue(item.type, FORMATIONS, 'line', '排列类型'),
      shape: enumValue(item.shape, SHAPES, 'person', '积木类型'),
      ...(text(item.label) ? { label: text(item.label) } : {}), color: color(item.color, '#8fb7a5'),
      position: vector(item.position), count,
      rows: Math.floor(number(item.rows, Math.max(1, Math.round(Math.sqrt(count))), 1, count)),
      columns: Math.floor(number(item.columns, Math.max(1, Math.ceil(Math.sqrt(count))), 1, count)),
      spacing: number(item.spacing, 1.5, 0.1, 100), radius: number(item.radius, 5, 0.1, 1_000),
      width: number(item.width, 10, 0.1, 1_000), depth: number(item.depth, 10, 0.1, 1_000),
      facing: number(item.facing, 0, -360, 360), size: vector(item.size, [1, 1, 1], 0.01),
    }
  })

  const knownIds = new Set([...objects, ...formations].map(item => item.id))
  if (knownIds.size !== objects.length + formations.length) throw new Error('对象和排列 ID 不能重复')
  const groups = rawGroups.map((value, index): Scene3DGroup => {
    const item = record(value, `分组 ${index + 1}`)
    const memberIds = Array.isArray(item.memberIds) ? item.memberIds.map(value => id(value, '分组成员 ID')) : []
    if (!memberIds.length || memberIds.some(memberId => !knownIds.has(memberId))) throw new Error('分组成员不存在')
    return { id: id(item.id || `group_${index + 1}`, '分组 ID'), ...(text(item.label) ? { label: text(item.label) } : {}), memberIds, position: vector(item.position) }
  })

  const canvas = record(root.canvas ?? {}, '画布设置')
  const lighting = record(root.lighting ?? {}, '灯光设置')
  const direction = String(lighting.direction || 'front')
  const intensity = String(lighting.intensity || 'medium')
  if (!['left', 'right', 'front', 'back', 'top'].includes(direction) || !['low', 'medium', 'high'].includes(intensity)) throw new Error('灯光设置无效')
  const camera = parseCamera(root.camera)
  const aspect = enumValue(canvas.aspect ?? camera.aspect, ASPECTS, '16:9', '画幅')
  camera.aspect = aspect
  const duration = root.duration === undefined ? undefined : number(root.duration, 0, 0.1, 600)
  const targetIds = new Set([...knownIds, ...groups.map(item => item.id), 'camera', 'scene'])
  const rawTimeline = Array.isArray(root.timeline) ? root.timeline : []
  if (rawTimeline.length > 1000) throw new Error('动画动作最多 1000 个')
  const timeline = rawTimeline.map((value, index): Scene3DTimelineEntry => {
    const item = record(value, `动画动作 ${index + 1}`)
    const action = enumValue(item.action, ANIMATION_ACTIONS, 'move', '动画动作')
    const target = id(item.target, '动画目标')
    if (!targetIds.has(target)) throw new Error(`动画目标不存在: ${target}`)
    const at = number(item.at, 0, 0, duration ?? 600)
    const actionDuration = item.duration === undefined ? undefined : number(item.duration, 0, 0, 600)
    if (duration !== undefined && at + (actionDuration || 0) > duration) throw new Error('动画动作超出总时长')
    if (['move', 'rotate', 'scale'].includes(action) && item.to === undefined) throw new Error(`${action} 动作缺少目标值`)
    if (action === 'color' && item.color === undefined) throw new Error('color 动作缺少颜色')
    if (action === 'camera' && item.to === undefined && item.lookAt === undefined) throw new Error('camera 动作缺少机位')
    if (action === 'label' && !text(item.text)) throw new Error('label 动作缺少文字')
    return {
      at, ...(actionDuration === undefined ? {} : { duration: actionDuration }), target, action,
      ...(item.to === undefined ? {} : { to: vector(item.to, [0, 0, 0], action === 'scale' ? 0.01 : -10_000) }),
      ...(item.lookAt === undefined ? {} : { lookAt: vector(item.lookAt) }),
      ...(item.color === undefined ? {} : { color: color(item.color) }),
      ...(text(item.text) ? { text: text(item.text, '', 120) } : {}),
      ...(item.easing === 'ease-in-out' ? { easing: 'ease-in-out' as const } : {}),
    }
  }).sort((left, right) => left.at - right.at)
  if (timeline.length && duration === undefined) throw new Error('动画场景必须提供总时长')
  return {
    version: 1, title, objects, formations, groups, camera,
    savedCameras: (Array.isArray(root.savedCameras) ? root.savedCameras : []).slice(0, 20).map((item, index) => parseCamera(item, `机位 ${index + 1}`)),
    lighting: { direction: direction as Scene3DDocument['lighting']['direction'], intensity: intensity as Scene3DDocument['lighting']['intensity'], shadows: lighting.shadows !== false },
    canvas: { aspect, grid: canvas.grid !== false, snap: canvas.snap !== false },
    ...(duration === undefined ? {} : { duration }),
    ...(timeline.length ? { timeline } : {}),
  }
}

function mix(from: [number, number, number], to: [number, number, number], amount: number): [number, number, number] {
  return from.map((value, index) => value + (to[index]! - value) * amount) as [number, number, number]
}

export function evaluateScene3DAnimation(source: Scene3DDocument, time: number): Scene3DAnimationState {
  const document = source
  const targets: Scene3DAnimationState['targets'] = {}
  for (const item of [...document.objects, ...document.formations]) targets[item.id] = {
    position: [...item.position], rotation: 'rotation' in item && item.rotation ? [...item.rotation] : [0, 0, 0], scale: [1, 1, 1], visible: true,
  }
  for (const item of document.groups) targets[item.id] = { position: [...(item.position || [0, 0, 0])], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true }
  const state: Scene3DAnimationState = { targets, camera: { position: [...document.camera.position], target: [...document.camera.target] }, label: '' }
  const now = Math.max(0, Math.min(time, document.duration || 0))
  for (const entry of document.timeline || []) {
    if (entry.at > now) break
    const progress = entry.duration ? Math.min(1, (now - entry.at) / entry.duration) : 1
    const amount = entry.easing === 'ease-in-out' ? progress * progress * (3 - 2 * progress) : progress
    if (entry.action === 'label') state.label = entry.text || ''
    else if (entry.action === 'camera') {
      if (entry.to) state.camera.position = mix(state.camera.position, entry.to, amount)
      if (entry.lookAt) state.camera.target = mix(state.camera.target, entry.lookAt, amount)
    } else {
      const target = state.targets[entry.target]
      if (!target) continue
      if (entry.action === 'show') target.visible = true
      if (entry.action === 'hide') target.visible = false
      if (entry.action === 'move' && entry.to) target.position = mix(target.position, entry.to, amount)
      if (entry.action === 'rotate' && entry.to) target.rotation = mix(target.rotation, entry.to, amount)
      if (entry.action === 'scale' && entry.to) target.scale = mix(target.scale, entry.to, amount)
      if (entry.action === 'color' && entry.color && amount === 1) target.color = entry.color
    }
  }
  return state
}

export function createScene3DDocument(args: Record<string, unknown>): Scene3DDocument {
  return parseScene3DDocument({ version: 1, ...args })
}

export function applyScene3DEdits(source: Scene3DDocument, operations: unknown): Scene3DDocument {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('3D 场景增量操作必须包含 1 到 100 项')
  const next = structuredClone(parseScene3DDocument(source))
  for (const raw of operations) {
    const operation = record(raw, '3D 场景增量操作')
    const action = text(operation.action)
    if (action === 'add_object') next.objects.push(record(operation.object, '新增对象') as unknown as Scene3DObject)
    else if (action === 'add_formation') next.formations.push(record(operation.formation, '新增排列') as unknown as Scene3DFormation)
    else if (action === 'move') {
      const targetId = id(operation.target, '移动目标')
      const target = [...next.objects, ...next.formations, ...next.groups].find(item => item.id === targetId)
      if (!target) throw new Error(`3D 场景目标不存在: ${targetId}`)
      target.position = vector(operation.to)
    } else if (action === 'remove') {
      const targetId = id(operation.target, '删除目标')
      const before = next.objects.length + next.formations.length + next.groups.length
      next.objects = next.objects.filter(item => item.id !== targetId)
      next.formations = next.formations.filter(item => item.id !== targetId)
      next.groups = next.groups
        .filter(item => item.id !== targetId)
        .map(item => ({ ...item, memberIds: item.memberIds.filter(memberId => memberId !== targetId) }))
        .filter(item => item.memberIds.length)
      if (before === next.objects.length + next.formations.length + next.groups.length) throw new Error(`3D 场景目标不存在: ${targetId}`)
      next.timeline = next.timeline?.filter(item => item.target !== targetId)
    } else if (action === 'camera') {
      if (operation.position === undefined && operation.lookAt === undefined) throw new Error('相机操作缺少位置或观察目标')
      if (operation.position !== undefined) next.camera.position = vector(operation.position)
      if (operation.lookAt !== undefined) next.camera.target = vector(operation.lookAt)
    } else throw new Error(`不支持的 3D 场景增量操作: ${action}`)
  }
  return parseScene3DDocument(next)
}

export function serializeScene3DDocument(document: Scene3DDocument): string {
  return `${JSON.stringify(parseScene3DDocument(document), null, 2)}\n`
}

export function scene3DResultMarker(artifact: { path: string; title: string; objectCount: number; formationCount: number }): string {
  return `<!-- jc:scene ${encodeURIComponent(JSON.stringify(artifact))} -->`
}

export function parseScene3DResultMarkers(content: string): Array<{ path: string; title: string; objectCount: number; formationCount: number }> {
  return [...content.matchAll(/<!-- jc:scene ([^\s]+) -->/g)].flatMap(match => {
    try {
      const value = JSON.parse(decodeURIComponent(match[1])) as Record<string, unknown>
      const path = String(value.path || '')
      if (!/^\.raw\/jc-media\/文档\/[^/]+\.jcscene$/i.test(path)) return []
      return [{ path, title: text(value.title || path.split('/').pop()?.replace(/\.jcscene$/i, '') || '白膜场景'), objectCount: Math.max(0, Number(value.objectCount) || 0), formationCount: Math.max(0, Number(value.formationCount) || 0) }]
    } catch { return [] }
  })
}

export function stripScene3DResultMarkers(content: string): string {
  return content.replace(/\n*<!-- jc:scene [^\s]+ -->/g, '').trim()
}

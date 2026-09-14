<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { STORYBOARDER_BONE_NAMES, applyCameraPoints, cameraPointsFromDocument, evaluateScene3DAnimation, parseScene3DDocument, SCENE3D_FOCAL, type Scene3DCamera, type Scene3DCameraPoint, type Scene3DCharacter, type Scene3DDocument, type Scene3DFormation, type Scene3DGroup, type Scene3DObject } from '@/runtime/memory/scene3d'
import { STORYBOARDER_CHARACTER_MODELS, STORYBOARDER_EDITABLE_BONES, STORYBOARDER_HAND_POSES, STORYBOARDER_POSES, handPosePreset, posePreset, resolveStoryboarderModelUrl } from '@/runtime/memory/storyboarderAssets'

const props = withDefaults(defineProps<{ document: Scene3DDocument; recordingOnly?: boolean; videoStatus?: string }>(), { recordingOnly: false, videoStatus: '' })
const emit = defineEmits<{ save: [document: Scene3DDocument]; screenshot: [blob: Blob, title: string]; video: [blob: Blob, title: string]; record: [document: Scene3DDocument, title: string] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const labelsVisible = ref(true)
const selectedId = ref('')
const cameraName = ref('')
const manualRecording = ref(false)
const recordingError = ref('')
const renderRevision = ref(0)
const playing = ref(false)
const currentTime = ref(0)
const activeBoneName = ref('')
const characterLoading = ref(0)
const characterLoadError = ref('')
const contextMenu = ref({ show: false, x: 0, y: 0 })
const framingNote = ref('')
const notice = ref('')
let noticeTimer = 0

/** 录制/截图的结果原来挤在会横向滚动的工具栏末尾会被截断，改成压在画面上的一条可读提示 */
function noticeTone(text: string) {
  // ponytail: 按文案判色；要更严谨就给工作台加一个 tone prop
  if (/失败|不可用|不支持/.test(text)) return 'error'
  if (/已保存|已就绪|已录制/.test(text)) return 'success'
  return 'info'
}

function showNotice(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 10000)
}
const frameMode = ref(false)
const snapStep = ref(0.1)
const previewHidden = ref(new Set<string>())
const stageSize = ref({ width: 0, height: 0 })
const selectedPoint = ref(-1)
const SNAP_STEPS = [1, 0.5, 0.25, 0.1]
let document = parseScene3DDocument(props.document)
let scene: THREE.Scene | null = null
let root: THREE.Group | null = null
let renderer: THREE.WebGLRenderer | null = null
let perspective: THREE.PerspectiveCamera | null = null
let orthographic: THREE.OrthographicCamera | null = null
let camera: THREE.Camera | null = null
let orbit: OrbitControls | null = null
let transform: TransformControls | null = null
let transformHelper: THREE.Object3D | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let manualRecorder: MediaRecorder | null = null
let manualChunks: Blob[] = []
let manualRecordingFailed = false
let discardManualRecording = false
let ignoreScenePick = false
let raycaster: THREE.Raycaster | null = null
let playStartedAt = 0
let stepLabel: THREE.Sprite | null = null
let sceneBuildToken = 0
const history: Scene3DDocument[] = [structuredClone(document)]
let historyIndex = 0
let copiedSelection: { kind: 'object' | 'formation' | 'group'; value: Scene3DObject | Scene3DFormation | Scene3DGroup } | null = null
const characterTemplates = new Map<string, THREE.Object3D>()
const characterLoads = new Map<string, Promise<THREE.Object3D | null>>()
const selectable = new Map<string, THREE.Object3D>()

const currentAspect = computed(() => { renderRevision.value; return document.canvas.aspect })
const savedCameras = computed(() => { renderRevision.value; return document.savedCameras })
const duration = computed(() => { renderRevision.value; return document.duration || 0 })
const selectedCharacter = computed(() => {
  renderRevision.value
  const item = document.objects.find(item => item.id === selectedId.value)
  return item?.type === 'person' && item.character ? item : null
})
const selectedEntry = computed(() => {
  renderRevision.value
  if (!selectedId.value) return null
  return document.objects.find(item => item.id === selectedId.value)
    || document.formations.find(item => item.id === selectedId.value)
    || document.groups.find(item => item.id === selectedId.value)
    || null
})
const selectedModelLabel = (model: Scene3DCharacter['model']) => ({ 'adult-male': '成年男性', 'adult-female': '成年女性', 'teen-male': '青少年男性', 'teen-female': '青少年女性', child: '儿童' }[model])
const poseLabel = (name: string) => ({ stand: '站', 'sit chair': '坐', 'crouch inspect': '蹲', walk: '走', run: '跑', point: '指', 'cross arms': '抱臂' }[name.toLowerCase()] || name)
const handLabel = (name: string) => ({ Relaxed: '放', 'Flat Spread': '张', Point: '指', Peace: '耶', Fist: '拳' }[name] || name)
const boneLabel = (name: string) => ({
  Head: '头', Neck: '颈', LeftArm: '左臂', LeftForeArm: '左前', LeftHand: '左手', RightArm: '右臂', RightForeArm: '右前', RightHand: '右手',
  LeftUpLeg: '左髋', LeftLeg: '左膝', LeftFoot: '左脚', RightUpLeg: '右髋', RightLeg: '右膝', RightFoot: '右脚',
  LeftHandIndex1: '左指1', LeftHandIndex2: '左指2', LeftHandIndex3: '左指3', RightHandIndex1: '右指1', RightHandIndex2: '右指2', RightHandIndex3: '右指3',
}[name] || name)
const poseOptions = computed(() => {
  const preferred = ['stand', 'sit chair', 'crouch inspect', 'walk', 'run', 'point', 'cross arms']
  return preferred.map(name => STORYBOARDER_POSES.find(item => item.name.toLowerCase() === name)).filter((item): item is (typeof STORYBOARDER_POSES)[number] => Boolean(item))
})
const handOptions = computed(() => ['Relaxed', 'Flat Spread', 'Point', 'Peace', 'Fist'].map(name => STORYBOARDER_HAND_POSES.find(item => item.name === name)).filter((item): item is (typeof STORYBOARDER_HAND_POSES)[number] => Boolean(item)))

// 人物机位按“头部占画面高度的比例”锁定构图，机位距离由焦段推算：焦段越长机位退得越远。
const HEAD_HEIGHT = 0.24
const EYE_HEIGHT = 1.5
/** 正面中景：脑袋约占画面高度 20% */
const HEAD_FILL_MEDIUM = 0.2
/** 机位行最多列几个人 */
const PERSON_BUTTON_LIMIT = 6
/** 机位不能进到头部里面 */
const MIN_SHOT_DISTANCE = 0.5

interface Scene3DPersonShot { id: string; label: string; position: [number, number, number]; rotation: [number, number, number]; scale: number }

const scenePeople = computed<Scene3DPersonShot[]>(() => {
  renderRevision.value
  const used = new Map<string, number>()
  return document.objects.filter(item => item.type === 'person').map((item, index) => {
    const base = item.label || `人物 ${index + 1}`
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    return {
      id: item.id,
      label: count > 1 ? `${base}${count}` : base,
      position: item.position,
      rotation: item.rotation || [0, 0, 0] as [number, number, number],
      scale: item.character?.scale || 1,
    }
  })
})

/** 取景框（成片）的垂直视角，机位预设按它算距离 */
function frameFov() { return focalFov(currentFocal.value, aspectRatio(document.canvas.aspect)) }

/** 保持头部在画面里的高度占比所需的机位距离；焦段越长距离越远 */
function shotDistance(scale: number, fill: number) {
  const half = THREE.MathUtils.degToRad(frameFov()) / 2
  return Math.max(MIN_SHOT_DISTANCE * scale, HEAD_HEIGHT * scale / (2 * fill * Math.tan(half)))
}

function shotNote(distance: number) {
  return `${currentFocal.value}mm · 机位在人前 ${distance.toFixed(1)} 米`
}

function personHead(person: Scene3DPersonShot) {
  return new THREE.Vector3(person.position[0], person.position[1] + EYE_HEIGHT * person.scale, person.position[2])
}

/** 人物朝向（模型正面是局部 +Z），已拍平到地面 */
function personForward(person: Scene3DPersonShot) {
  const forward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...person.rotation))
  forward.y = 0
  return forward.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : forward.normalize()
}

function applyShot(name: string, position: THREE.Vector3, target: THREE.Vector3, note = '') {
  applyCamera({ name, position: tuple(position), target: tuple(target), projection: 'perspective', focal: currentFocal.value, aspect: document.canvas.aspect })
  cameraName.value = name
  framingNote.value = note
  persist()
}

function applyCloseShot(index: number) {
  const person = scenePeople.value[index]
  if (!person) return
  const forward = personForward(person)
  const head = personHead(person)
  const distance = shotDistance(person.scale, HEAD_FILL_MEDIUM)
  applyShot(`${person.label}正面中景`, head.clone().add(forward.multiplyScalar(distance)), head, shotNote(distance))
}

function vector(value: [number, number, number]) { return new THREE.Vector3(...value) }
function tuple(value: THREE.Vector3): [number, number, number] { return [value.x, value.y, value.z] }
function aspectRatio(value: Scene3DDocument['canvas']['aspect']) {
  const [width, height] = value.split(':').map(Number)
  return width / height
}

/** 等效焦距档位（毫米）。长焦压缩空间，是窄空间里拍过肩的唯一办法。 */
const FOCAL_STEPS = [24, 35, 50, 85, 135]
const FOCAL_TITLES: Record<number, string> = {
  24: '24mm 广角 · 空间感强', 35: '35mm 小广角 · 人物带环境', 50: '50mm 标准 · 接近人眼',
  85: '85mm 中长焦 · 人像，开始压缩空间', 135: '135mm 长焦 · 明显压缩空间，过肩首选',
}
/** 长边按 36mm 胶片折算；竖画幅时长边就是画面高度 */
const SENSOR_LONG = 36

const currentFocal = computed(() => { renderRevision.value; return document.camera.focal || SCENE3D_FOCAL.fallback })

/** 焦段 + 画幅 → 成片的垂直视角（度） */
function focalFov(focal: number, aspect: number) {
  const longAngle = 2 * Math.atan(SENSOR_LONG / 2 / focal)
  return THREE.MathUtils.radToDeg(aspect >= 1 ? 2 * Math.atan(Math.tan(longAngle / 2) / aspect) : longAngle)
}

/** 相机垂直视角：取景框按标称焦段成像，画布比框多出来的部分只是编辑余量 */
function cameraFovFor(focal: number, canvasRatio: number) {
  const targetAspect = aspectRatio(document.canvas.aspect)
  const frameHalf = THREE.MathUtils.degToRad(focalFov(focal, targetAspect)) / 2
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(frameHalf) / Math.min(1, canvasRatio / targetAspect)))
}

function cameraFov(canvasRatio: number) { return cameraFovFor(currentFocal.value, canvasRatio) }

/** 把相机视角按当前焦段复位：运镜播放时视角在变，停下来要回到工具栏显示的焦段 */
function restoreLens() {
  if (!perspective || camera !== perspective) return
  const fov = cameraFov(perspective.aspect)
  if (Math.abs(perspective.fov - fov) < 0.01) return
  perspective.fov = fov
  perspective.updateProjectionMatrix()
}

/** 取景框和截图共用同一个裁剪矩形：当前画幅在画面里能取到的最大居中矩形 */
function cropRect(width: number, height: number) {
  const ratio = aspectRatio(currentAspect.value)
  const frameWidth = Math.min(width, height * ratio)
  return { width: frameWidth, height: frameWidth / ratio }
}

const frameRect = computed(() => cropRect(stageSize.value.width, stageSize.value.height))

function material(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 })
}

function addLabel(parent: THREE.Object3D, label: string, color: string, y = 1.8) {
  if (!label) return
  const surface = window.document.createElement('canvas')
  const context = surface.getContext('2d')!
  context.font = '600 18px sans-serif'
  const width = Math.max(48, Math.ceil(context.measureText(label).width) + 18)
  surface.width = width
  surface.height = 30
  context.font = '600 18px sans-serif'
  context.fillStyle = 'rgba(14, 20, 19, .84)'
  context.fillRect(0, 0, width, 30)
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.fillText(label, 9, 16)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(surface), depthTest: true, depthWrite: false, sizeAttenuation: false }))
  sprite.name = 'scene-label'
  sprite.center.set(.5, 0)
  sprite.position.set(0, y, 0)
  sprite.scale.set(width / 1100, .036, 1)
  parent.add(sprite)
}

function disposeObject(object: THREE.Object3D, includeShared = false) {
  object.traverse(child => {
    if (!includeShared && child.userData.storyboarderSharedResource) return
    const mesh = child as THREE.Mesh
    if (!(child as THREE.Sprite).isSprite) mesh.geometry?.dispose?.()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach(item => {
      Object.values(item).forEach(value => { if (value instanceof THREE.Texture) value.dispose() })
      item.dispose()
    })
  })
}

function setPresetRotation(root: THREE.Object3D, state: Record<string, { rotation?: { x?: number; y?: number; z?: number } }> | undefined, mirror = false) {
  for (const [name, entry] of Object.entries(state || {})) {
    const bone = root.getObjectByName(mirror ? name.replace(/^Right/, 'Left') : name)
    const rotation = entry.rotation
    if (!bone || !rotation) continue
    bone.rotation.set(Number(rotation.x || 0), mirror ? -Number(rotation.y || 0) : Number(rotation.y || 0), mirror ? -Number(rotation.z || 0) : Number(rotation.z || 0))
  }
}

function applyCharacterState(root: THREE.Object3D, character: Scene3DCharacter) {
  root.traverse(node => {
    const bind = node.userData.storyboarderBindQuaternion as [number, number, number, number] | undefined
    if (bind) node.quaternion.fromArray(bind)
  })
  for (const [name, values] of Object.entries(character.bones || {})) {
    const bone = root.getObjectByName(name)
    if (bone) bone.quaternion.fromArray(values)
  }
}

async function storyboarderTemplate(model: Scene3DCharacter['model']): Promise<THREE.Object3D | null> {
  const cached = characterTemplates.get(model)
  if (cached) return cached
  const pending = characterLoads.get(model)
  if (pending) return pending
  characterLoading.value++
  characterLoadError.value = ''
  const load = resolveStoryboarderModelUrl(model).then(url => new Promise<THREE.Object3D | null>((resolve, reject) => {
    if (!url) throw new Error('未找到人物资源')
    new GLTFLoader().load(url, gltf => {
      characterTemplates.set(model, gltf.scene)
      resolve(gltf.scene)
    }, undefined, () => reject(new Error('人物模型加载失败')))
  })).catch(error => {
    console.warn('[Scene3DEditor] Storyboarder 人物资源路径解析失败', error)
    characterLoadError.value = '人物模型加载失败，已显示基础白模'
    return null
  }).finally(() => {
    characterLoading.value--
    characterLoads.delete(model)
  })
  characterLoads.set(model, load)
  return load
}

async function hydrateCharacter(node: THREE.Object3D, item: Scene3DObject, token: number) {
  if (!item.character) return
  const template = await storyboarderTemplate(item.character.model)
  if (!template || token !== sceneBuildToken || !node.parent) return
  const label = node.children.find(child => child.name === 'scene-label')
  node.children.slice().forEach(child => {
    if (child === label) return
    node.remove(child); disposeObject(child)
  })
  const model = cloneSkeleton(template)
  model.name = 'scene-character'
  model.scale.setScalar(item.character.scale)
  model.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; child.userData.storyboarderSharedResource = true }
    if ((child as THREE.Bone).isBone) child.userData.storyboarderBindQuaternion = child.quaternion.toArray()
  })
  applyCharacterState(model, item.character)
  node.add(model)
  renderRevision.value++
}

function makePerson(color: string, pose = 'standing'): THREE.Group {
  const person = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.68, 4, 8), material(color))
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), material('#f4f4ee'))
  const limbGeometry = new THREE.CapsuleGeometry(0.075, 0.4, 3, 7)
  const leftArm = new THREE.Mesh(limbGeometry, material(color))
  const rightArm = new THREE.Mesh(limbGeometry, material(color))
  const leftLeg = new THREE.Mesh(limbGeometry, material(color))
  const rightLeg = new THREE.Mesh(limbGeometry, material(color))
  const direction = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 4), material(color))
  body.position.y = 0.9
  head.position.y = 1.55
  leftArm.position.set(-0.38, 0.9, 0); rightArm.position.set(0.38, 0.9, 0)
  leftLeg.position.set(-0.14, 0.28, 0); rightLeg.position.set(0.14, 0.28, 0)
  direction.position.set(0, 0.18, 0.38)
  direction.rotation.x = Math.PI / 2
  if (pose === 'sitting') {
    body.position.y = 0.75; head.position.y = 1.38
    leftArm.position.y = rightArm.position.y = 0.77
    leftLeg.position.set(-0.14, 0.3, 0.2); rightLeg.position.set(0.14, 0.3, 0.2)
    leftLeg.rotation.x = rightLeg.rotation.x = Math.PI / 2
  }
  if (pose === 'crouching') {
    body.position.y = 0.65; head.position.y = 1.2
    leftArm.position.y = rightArm.position.y = 0.65
    leftLeg.position.set(-0.16, 0.25, 0); rightLeg.position.set(0.16, 0.25, 0)
    leftLeg.rotation.z = -0.45; rightLeg.rotation.z = 0.45
  }
  person.add(body, head, leftArm, rightArm, leftLeg, rightLeg, direction)
  if (pose === 'lying') { person.rotation.z = Math.PI / 2; person.position.y = 0.55 }
  return person
}

function makePrimitive(item: Pick<Scene3DObject, 'type' | 'color' | 'size' | 'end' | 'pose'>): THREE.Object3D {
  const [x, y, z] = item.size || [1, 1, 1]
  const color = item.color || '#e7ece9'
  if (item.type === 'person') return makePerson(color, item.pose)
  if (item.type === 'plane') {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x, z), material(color))
    mesh.rotation.x = -Math.PI / 2
    return mesh
  }
  if (item.type === 'cylinder') return new THREE.Mesh(new THREE.CylinderGeometry(x / 2, x / 2, y, 16), material(color))
  if (item.type === 'sphere') return new THREE.Mesh(new THREE.SphereGeometry(x / 2, 16, 12), material(color))
  if (item.type === 'cone') return new THREE.Mesh(new THREE.ConeGeometry(x / 2, y, 16), material(color))
  if (item.type === 'entrance') {
    const group = new THREE.Group()
    const post = new THREE.BoxGeometry(Math.max(.08, z), y, Math.max(.08, z))
    const lintel = new THREE.BoxGeometry(x, Math.max(.08, z), Math.max(.08, z))
    const left = new THREE.Mesh(post, material(color)); left.position.set(-x / 2, y / 2, 0)
    const right = new THREE.Mesh(post, material(color)); right.position.set(x / 2, y / 2, 0)
    const top = new THREE.Mesh(lintel, material(color)); top.position.set(0, y, 0)
    group.add(left, right, top)
    return group
  }
  if (item.type === 'line' || item.type === 'arrow') {
    const end = vector(item.end || [x, 0, z])
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end])
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }))
    if (item.type === 'line') return line
    const group = new THREE.Group(); group.add(line)
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.16, .42, 4), material(color))
    arrow.position.copy(end)
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().normalize())
    group.add(arrow)
    return group
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material(color))
  mesh.position.y = y / 2
  return mesh
}

function formationPositions(item: Scene3DFormation): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const spacing = item.spacing || 1.5
  const random = (index: number) => {
    const seed = Math.sin((index + 1) * 12.9898 + item.id.length * 78.233) * 43758.5453
    return seed - Math.floor(seed)
  }
  for (let index = 0; index < item.count; index += 1) {
    if (item.type === 'circle') {
      const angle = index / item.count * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(angle) * (item.radius || 5), 0, Math.sin(angle) * (item.radius || 5)))
    } else if (item.type === 'scatter') {
      points.push(new THREE.Vector3((random(index) - .5) * (item.width || 10), 0, (random(index + 91) - .5) * (item.depth || 10)))
    } else if (item.type === 'grid') {
      const columns = item.columns || Math.ceil(Math.sqrt(item.count))
      const row = Math.floor(index / columns)
      const column = index % columns
      points.push(new THREE.Vector3((column - (columns - 1) / 2) * spacing, 0, (row - ((item.rows || Math.ceil(item.count / columns)) - 1) / 2) * spacing))
    } else {
      points.push(new THREE.Vector3((index - (item.count - 1) / 2) * spacing, 0, 0))
    }
  }
  return points
}

function makeFormation(item: Scene3DFormation): THREE.Group {
  const group = new THREE.Group()
  const points = formationPositions(item)
  const shape = item.shape || 'person'
  const color = item.color || '#8fb7a5'
  const size = item.size || [1, 1, 1]
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(item.facing || 0))
  if (shape === 'person') {
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.26, .68, 4, 8), material(color), points.length)
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(.22, 12, 8), material('#f4f4ee'), points.length)
    points.forEach((point, index) => {
      matrix.compose(point.clone().add(new THREE.Vector3(0, .7, 0)), rotation, new THREE.Vector3(1, 1, 1)); body.setMatrixAt(index, matrix)
      matrix.compose(point.clone().add(new THREE.Vector3(0, 1.35, 0)), rotation, new THREE.Vector3(1, 1, 1)); head.setMatrixAt(index, matrix)
    })
    body.instanceMatrix.needsUpdate = true; head.instanceMatrix.needsUpdate = true
    group.add(body, head)
  } else {
    const geometry = shape === 'cylinder' ? new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 12)
      : shape === 'sphere' ? new THREE.SphereGeometry(size[0] / 2, 12, 8)
        : shape === 'cone' ? new THREE.ConeGeometry(size[0] / 2, size[1], 12)
          : new THREE.BoxGeometry(size[0], size[1], size[2])
    const mesh = new THREE.InstancedMesh(geometry, material(color), points.length)
    points.forEach((point, index) => {
      matrix.compose(point.clone().add(new THREE.Vector3(0, size[1] / 2, 0)), rotation, new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  }
  return group
}

function setSelectable(node: THREE.Object3D, id: string, kind: 'object' | 'formation' | 'group') {
  node.userData.sceneSelection = { id, kind }
  selectable.set(id, node)
}

function buildScene() {
  if (!scene) return
  const token = ++sceneBuildToken
  if (root) { scene.remove(root); disposeObject(root) }
  root = new THREE.Group()
  selectable.clear()
  const nodes = new Map<string, THREE.Object3D>()
  for (const item of document.objects) {
    const node = makePrimitive(item)
    node.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach(item => { if (item instanceof THREE.MeshStandardMaterial) item.userData.baseColor = item.color.getHex() }) } })
    node.position.copy(vector(item.position)); node.rotation.set(...(item.rotation || [0, 0, 0]))
    if (item.type === 'person') addLabel(node, item.label || '', item.color || '#ffffff', 1.8)
    setSelectable(node, item.id, 'object'); nodes.set(item.id, node); root.add(node)
    if (item.character) void hydrateCharacter(node, item, token)
  }
  for (const item of document.formations) {
    const node = makeFormation(item)
    node.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach(item => { if (item instanceof THREE.MeshStandardMaterial) item.userData.baseColor = item.color.getHex() }) } })
    node.position.copy(vector(item.position))
    if ((item.shape || 'person') === 'person') addLabel(node, item.label || '', item.color || '#ffffff', 1.8)
    setSelectable(node, item.id, 'formation'); nodes.set(item.id, node); root.add(node)
  }
  for (const groupData of document.groups) {
    const group = new THREE.Group(); group.position.copy(vector(groupData.position || [0, 0, 0]))
    groupData.memberIds.forEach(memberId => {
      const node = nodes.get(memberId)
      if (node) { node.traverse(child => { child.userData.sceneSelection = { id: groupData.id, kind: 'group' } }); group.add(node) }
    })
    if (groupData.memberIds.some(id => document.objects.find(item => item.id === id)?.type === 'person')) addLabel(group, groupData.label || '', '#ffffff', 2.2)
    group.userData.sceneSelection = { id: groupData.id, kind: 'group' }
    for (const memberId of groupData.memberIds) selectable.delete(memberId)
    selectable.set(groupData.id, group)
    root.add(group)
  }
  for (const id of previewHidden.value) {
    const node = nodes.get(id) || selectable.get(id)
    if (node) node.visible = false
  }
  scene.add(root)
  // 重建场景只恢复对象状态；机位要留在用户当前看的位置，不要被时间轴拉走
  applyAnimation(currentTime.value, false)
  attachSelection(selectedId.value)
}

function updateStepLabel(value: string) {
  if (!scene || !camera) return
  if (stepLabel) { scene.remove(stepLabel); stepLabel.material.map?.dispose(); stepLabel.material.dispose(); stepLabel = null }
  if (!value) return
  const surface = window.document.createElement('canvas')
  const context = surface.getContext('2d')!
  surface.width = 900; surface.height = 100
  context.fillStyle = 'rgba(14, 20, 19, .84)'; context.fillRect(0, 0, surface.width, surface.height)
  context.fillStyle = '#ffffff'; context.font = '600 42px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(value, 450, 52, 850)
  stepLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(surface), depthTest: true, depthWrite: false, sizeAttenuation: false }))
  stepLabel.scale.set(.9, .1, 1); scene.add(stepLabel)
}

function applyAnimation(time: number, includeCamera = true) {
  if (!document.timeline?.length || !camera) return
  const state = evaluateScene3DAnimation(document, time)
  for (const [id, value] of Object.entries(state.targets)) {
    const node = selectable.get(id)
    if (!node) continue
    node.position.set(...value.position); node.rotation.set(...value.rotation); node.scale.set(...value.scale); node.visible = value.visible
    if (value.color) node.traverse(child => {
      const mesh = child as THREE.Mesh
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(item => { if (item instanceof THREE.MeshStandardMaterial) item.color.set(value.color || item.userData.baseColor) })
    })
  }
  if (includeCamera) {
    camera.position.set(...state.camera.position); camera.lookAt(vector(state.camera.target)); orbit?.target.set(...state.camera.target)
    if (perspective && camera === perspective) {
      const fov = cameraFovFor(state.camera.focal, perspective.aspect)
      if (Math.abs(perspective.fov - fov) > 0.01) { perspective.fov = fov; perspective.updateProjectionMatrix() }
    }
  }
  if (stepLabel?.userData.text !== state.label) { updateStepLabel(state.label); if (stepLabel) stepLabel.userData.text = state.label }
  if (stepLabel) {
    const direction = new THREE.Vector3(); camera.getWorldDirection(direction)
    stepLabel.position.copy(camera.position).add(direction.multiplyScalar(2)); stepLabel.quaternion.copy(camera.quaternion)
  }
}

function togglePlayback() {
  if (!duration.value) return
  if (playing.value) { playing.value = false; return }
  if (currentTime.value >= duration.value) currentTime.value = 0
  playStartedAt = performance.now() - currentTime.value * 1000
  transform?.detach(); playing.value = true
}

function replay() { currentTime.value = 0; applyAnimation(0); playing.value = false; togglePlayback() }

function activeCamera() { return camera as THREE.Camera }
function applyCamera(source: Scene3DCamera) {
  // 机位只描述机位；画幅永远由场景的 canvas.aspect 决定，不能被旧机位改回去。
  document.camera = { ...structuredClone(source), aspect: document.canvas.aspect }
  createCameraControls()
}

/** 取景模式的拖动与方向键都只平移机位：方向和朝向不变，构图整体滑动 */
function panCamera(right: number, up: number) {
  if (!camera || !orbit) return
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward)
  const rightAxis = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
  const upAxis = new THREE.Vector3().crossVectors(rightAxis, forward).normalize()
  const offset = rightAxis.multiplyScalar(right).add(upAxis.multiplyScalar(up))
  camera.position.add(offset); orbit.target.add(offset)
  syncCameraState()
}

function samePoint(left: [number, number, number], right: [number, number, number]) {
  return Math.abs(left[0] - right[0]) < 1e-6 && Math.abs(left[1] - right[1]) < 1e-6 && Math.abs(left[2] - right[2]) < 1e-6
}

/** 把实时机位写回场景，切焦段、切投影和重开场景都不再丢掉构图 */
function syncCameraState() {
  if (!camera || !orbit || playing.value || manualRecording.value) return
  const position = tuple(camera.position)
  const target = tuple(orbit.target)
  // OrbitControls 每次 pointerup 都会派发 end，机位没动就不写盘。
  if (samePoint(position, document.camera.position) && samePoint(target, document.camera.target)) return
  document.camera.position = position
  document.camera.target = target
  persist({ history: false })
}

function applyFrameMode() {
  if (!orbit) return
  orbit.enableRotate = !frameMode.value
  orbit.mouseButtons = frameMode.value
    ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
}

function toggleFrameMode() { frameMode.value = !frameMode.value; applyFrameMode() }

function createCameraControls() {
  if (!renderer || !canvas.value) return
  orbit?.dispose(); transform?.detach(); transform?.dispose()
  if (transformHelper) scene?.remove(transformHelper)
  const ratio = canvas.value.clientWidth / Math.max(canvas.value.clientHeight, 1)
  const source = document.camera
  if (source.projection === 'orthographic') {
    const size = 18
    orthographic = new THREE.OrthographicCamera(-size * ratio / 2, size * ratio / 2, size / 2, -size / 2, .01, 1000)
    camera = orthographic
  } else {
    perspective = new THREE.PerspectiveCamera(cameraFov(ratio), ratio, .01, 1000)
    camera = perspective
  }
  camera.position.copy(vector(source.position))
  camera.lookAt(vector(source.target))
  orbit = new OrbitControls(activeCamera(), canvas.value)
  orbit.target.copy(vector(source.target)); orbit.enableDamping = true; orbit.dampingFactor = .08
  orbit.addEventListener('end', syncCameraState)
  applyFrameMode()
  transform = new TransformControls(activeCamera(), canvas.value)
  transform.setMode('translate')
  transform.setTranslationSnap(document.canvas.snap ? snapStep.value : null)
  transform.addEventListener('dragging-changed', event => {
    orbit!.enabled = !event.value
    if (!event.value) {
      ignoreScenePick = true
      activeBoneName.value ? persistCharacterBones() : persistSelection()
      queueMicrotask(() => { ignoreScenePick = false })
    }
  })
  transformHelper = transform.getHelper()
  scene?.add(transformHelper)
  attachSelection(selectedId.value)
  resize()
}

function setCameraPreset(name: 'top' | 'front' | 'side' | 'low' | 'reset') {
  const target = vector(document.camera.target)
  const distance = 16
  const positions = {
    top: new THREE.Vector3(0, distance, .01), front: new THREE.Vector3(0, 5, distance), side: new THREE.Vector3(distance, 5, 0), low: new THREE.Vector3(8, 2, 12), reset: new THREE.Vector3(10, 8, 12),
  }
  document.camera.position = tuple(target.clone().add(positions[name]))
  createCameraControls(); persist()
}

function setFocal(focal: number) {
  document.camera.focal = focal
  if (document.camera.projection === 'perspective' && perspective && camera === perspective) {
    perspective.fov = cameraFov(perspective.aspect)
    perspective.updateProjectionMatrix()
    persist()
    return
  }
  document.camera.projection = 'perspective'
  createCameraControls(); persist()
}
function setProjection(projection: Scene3DCamera['projection']) {
  if (document.camera.projection === projection) return
  document.camera.projection = projection; createCameraControls(); persist()
}
function setAspect(aspect: Scene3DDocument['canvas']['aspect']) { document.canvas.aspect = aspect; document.camera.aspect = aspect; persist() }
function setSnapStep(step: number) { snapStep.value = step; transform?.setTranslationSnap(document.canvas.snap ? step : null) }
function setLighting(direction: Scene3DDocument['lighting']['direction']) { document.lighting.direction = direction; updateLights(); persist() }
function setLightIntensity(intensity: Scene3DDocument['lighting']['intensity']) { document.lighting.intensity = intensity; updateLights(); persist() }
function toggleShadows() { document.lighting.shadows = !document.lighting.shadows; renderer!.shadowMap.enabled = document.lighting.shadows; buildScene(); updateLights(); persist() }
function toggleGrid() { document.canvas.grid = !document.canvas.grid; updateGrid(); persist() }
function toggleSnap() { document.canvas.snap = !document.canvas.snap; transform?.setTranslationSnap(document.canvas.snap ? snapStep.value : null); persist() }
function toggleLabels() { labelsVisible.value = !labelsVisible.value; root?.traverse(node => { if (node.name === 'scene-label') node.visible = labelsVisible.value }) }

/** 临时隐藏选中对象：只在预览里生效，不写进 .jcscene，方便贴着肩摄影机卡构图 */
function togglePreviewHidden() {
  const id = selectedId.value
  if (!id) return
  const next = new Set(previewHidden.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  previewHidden.value = next
  const node = selectable.get(id)
  if (node) node.visible = !next.has(id)
  renderRevision.value++
}

function updateLights() {
  if (!scene) return
  scene.children.filter(node => node.name.startsWith('scene-light')).forEach(node => scene!.remove(node))
  const ambient = new THREE.HemisphereLight(0xffffff, 0x34413c, 1.6)
  ambient.name = 'scene-light-ambient'; scene.add(ambient)
  const positions = { left: [-8, 10, 4], right: [8, 10, 4], front: [0, 8, 10], back: [0, 8, -10], top: [0, 14, 0] } as const
  const light = new THREE.DirectionalLight(0xffffff, document.lighting.intensity === 'high' ? 3 : document.lighting.intensity === 'low' ? 1.2 : 2.1)
  const [x, y, z] = positions[document.lighting.direction]
  light.name = 'scene-light-key'; light.position.set(x, y, z); light.castShadow = document.lighting.shadows
  scene.add(light)
}

function updateGrid() {
  if (!scene) return
  const previous = scene.getObjectByName('scene-grid')
  if (previous) scene.remove(previous)
  if (document.canvas.grid) {
    const grid = new THREE.GridHelper(80, 80, 0x75877e, 0x34443d)
    grid.name = 'scene-grid'; scene.add(grid)
  }
}

function attachSelection(id: string) {
  selectedId.value = id
  contextMenu.value.show = false
  activeBoneName.value = ''
  transform?.detach()
  transform?.setMode('translate')
  const target = selectable.get(id)
  if (target) transform?.attach(target)
}

function clearSelection() {
  selectedId.value = ''
  activeBoneName.value = ''
  contextMenu.value.show = false
  transform?.detach()
}

function updateSelectedLabel(label: string) {
  const item = selectedEntry.value
  if (!item || !('label' in item)) return
  item.label = label.trim().slice(0, 80) || undefined
  buildScene(); persist()
}

function updateSelectedColor(color: string) {
  const item = selectedEntry.value
  if (!item || !('color' in item)) return
  item.color = color; buildScene(); persist()
}

function clearSelectedLabel() { updateSelectedLabel('') }

function positionValue(axis: number) { return Number((selectedEntry.value?.position?.[axis] ?? 0).toFixed(2)) }

function updateSelectedPosition(axis: number, raw: string) {
  const item = selectedEntry.value
  const node = selectable.get(selectedId.value)
  const position = item?.position
  const value = Number(raw)
  if (!node || !position || !Number.isFinite(value) || axis < 0 || axis > 2) return
  position[axis] = Number(value.toFixed(4))
  node.position.set(...position)
  persist()
}

function nudgeSelection(offset: [number, number, number]) {
  const item = selectedEntry.value
  const node = selectable.get(selectedId.value)
  const position = item?.position
  if (!node || !position) return false
  const next = position.map((value, axis) => Number((value + offset[axis]!).toFixed(4))) as [number, number, number]
  item!.position = next
  node.position.set(...next)
  persist()
  return true
}

/** 有选中就微调对象，没选中就平移机位调构图；步长和吸附档位保持一致 */
function handleNudgeKeys(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || playing.value) return
  if ((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  const step = snapStep.value
  const vertical = event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
  const offset: [number, number, number] = vertical
    ? [0, event.key === 'ArrowUp' ? step : -step, 0]
    : event.key === 'ArrowLeft' ? [-step, 0, 0]
      : event.key === 'ArrowRight' ? [step, 0, 0]
        : [0, 0, event.key === 'ArrowUp' ? -step : step]
  event.preventDefault()
  if (nudgeSelection(offset)) return
  if (!vertical) panCamera(offset[0], -offset[2])
}

function openContextMenu(event: MouseEvent) {
  pick(event as PointerEvent)
  if (selectedId.value) contextMenu.value = { show: true, x: event.offsetX, y: event.offsetY }
}

function closeContextMenu() { contextMenu.value.show = false }

function characterNode() {
  const target = selectable.get(selectedId.value)
  return target?.getObjectByName('scene-character') || null
}

function attachBone(name: string) {
  const target = characterNode()
  const bone = target?.getObjectByName(name)
  if (!bone || !transform) return
  activeBoneName.value = name
  transform.setMode('rotate')
  transform.detach()
  transform.attach(bone)
}

function rotateCharacter() {
  const target = selectable.get(selectedId.value)
  if (!target || !transform) return
  activeBoneName.value = ''
  transform.setMode('rotate')
  transform.detach()
  transform.attach(target)
}

function setCharacterModel(model: Scene3DCharacter['model']) {
  const item = selectedCharacter.value
  if (!item?.character || item.character.model === model) return
  item.character.model = model
  delete item.character.bones
  buildScene()
  persist()
}

function adjustCharacterScale(amount: number) {
  const item = selectedCharacter.value
  const target = characterNode()
  if (!item?.character || !target) return
  item.character.scale = Math.max(0.1, Math.min(10, Math.round((item.character.scale + amount) * 10) / 10))
  target.scale.setScalar(item.character.scale)
  persist()
}

function applyPose(id: string) {
  const item = selectedCharacter.value
  const target = characterNode()
  const preset = posePreset(id)
  if (!item?.character || !target || !preset) return
  target.traverse(node => {
    const bind = node.userData.storyboarderBindQuaternion as [number, number, number, number] | undefined
    if (bind) node.quaternion.fromArray(bind)
  })
  setPresetRotation(target, preset.state.skeleton)
  persistCharacterBones()
}

function applyHand(id: string, side: 'left' | 'right') {
  const item = selectedCharacter.value
  const target = characterNode()
  const preset = handPosePreset(id)
  if (!item?.character || !target || !preset) return
  setPresetRotation(target, preset.state.handSkeleton, side === 'left')
  persistCharacterBones()
}

function pick(event: PointerEvent) {
  if (manualRecording.value || ignoreScenePick || !canvas.value || !camera || !root || !raycaster || transform?.dragging || frameMode.value) return
  const rect = canvas.value.getBoundingClientRect()
  const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, activeCamera())
  const hit = raycaster.intersectObjects(root.children, true)[0]
  let node: THREE.Object3D | null = hit?.object || null
  while (node && !node.userData.sceneSelection) node = node.parent
  if (node?.userData.sceneSelection) attachSelection(node.userData.sceneSelection.id)
  else clearSelection()
}

function persistSelection() {
  const target = selectable.get(selectedId.value)
  const selection = target?.userData.sceneSelection as { id: string; kind: 'object' | 'formation' | 'group' } | undefined
  if (!target || !selection) return
  if (selection.kind === 'group') {
    const group = document.groups.find(item => item.id === selection.id)
    if (group) group.position = tuple(target.position)
  } else {
    const item = selection.kind === 'object' ? document.objects.find(item => item.id === selection.id) : document.formations.find(item => item.id === selection.id)
    if (item) {
      item.position = tuple(target.position)
      if ('rotation' in item) item.rotation = [target.rotation.x, target.rotation.y, target.rotation.z]
    }
  }
  persist()
}

function persistCharacterBones() {
  const item = selectedCharacter.value
  const target = characterNode()
  if (!item?.character || !target) return
  const bones: Record<string, [number, number, number, number]> = {}
  target.traverse(node => {
    if (!((node as THREE.Bone).isBone && STORYBOARDER_BONE_NAMES.includes(node.name as (typeof STORYBOARDER_BONE_NAMES)[number]))) return
    bones[node.name] = node.quaternion.toArray() as [number, number, number, number]
  })
  item.character.bones = bones
  persist()
}

function persist(options: { history?: boolean } = {}) {
  if (options.history !== false) {
    history.splice(historyIndex + 1)
    const snapshot = structuredClone(document)
    if (JSON.stringify(history[history.length - 1]) !== JSON.stringify(snapshot)) history.push(snapshot)
    historyIndex = history.length - 1
    if (history.length > 100) { history.shift(); historyIndex-- }
  }
  renderRevision.value++; emit('save', structuredClone(document))
}

function restoreHistory(index: number) {
  const snapshot = history[index]
  if (!snapshot) return
  document = parseScene3DDocument(structuredClone(snapshot))
  historyIndex = index
  selectedId.value = ''
  buildScene(); createCameraControls(); applyAnimation(0); persist({ history: false })
}

function undo() { if (historyIndex > 0) restoreHistory(historyIndex - 1) }
function redo() { if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1) }

function copySelection() {
  const target = selectable.get(selectedId.value)
  const selection = target?.userData.sceneSelection as { id: string; kind: 'object' | 'formation' | 'group' } | undefined
  if (!selection) return
  const value = selection.kind === 'object'
    ? document.objects.find(item => item.id === selection.id)
    : selection.kind === 'formation'
      ? document.formations.find(item => item.id === selection.id)
      : document.groups.find(item => item.id === selection.id)
  if (value) copiedSelection = { kind: selection.kind, value: structuredClone(value) }
}

function pasteSelection() {
  if (!copiedSelection) return
  const id = `${copiedSelection.value.id}_copy_${crypto.randomUUID().slice(0, 8)}`
  if (copiedSelection.kind === 'object') {
    const value = structuredClone(copiedSelection.value as Scene3DObject); value.id = id; value.position = [value.position[0] + 1, value.position[1], value.position[2]]; document.objects.push(value); selectedId.value = id
  } else if (copiedSelection.kind === 'formation') {
    const value = structuredClone(copiedSelection.value as Scene3DFormation); value.id = id; value.position = [value.position[0] + 1, value.position[1], value.position[2]]; document.formations.push(value); selectedId.value = id
  } else {
    const value = structuredClone(copiedSelection.value as Scene3DGroup); value.id = id; value.position = [(value.position?.[0] || 0) + 1, value.position?.[1] || 0, value.position?.[2] || 0]; document.groups.push(value); selectedId.value = id
  }
  buildScene(); persist()
}

function handleHistoryKeyboard(event: KeyboardEvent) {
  if ((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
  if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
  if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return }
  if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection() }
}

function saveCamera() {
  const name = `机位 ${document.savedCameras.length + 1}`
  const current = camera as THREE.Camera
  const target = orbit?.target || vector(document.camera.target)
  document.savedCameras.push({ ...structuredClone(document.camera), name, position: tuple(current.position), target: tuple(target), aspect: document.canvas.aspect })
  persist()
}

function useSavedCamera(item: Scene3DCamera) { cameraName.value = item.name || ''; framingNote.value = ''; applyCamera(item); persist() }
function removeSavedCamera(index: number) { document.savedCameras.splice(index, 1); persist() }

/** 运镜机位点直接存在 timeline 里，这里只把它读成点列表；点点位的数字可内联改 */
const cameraPoints = computed(() => { renderRevision.value; return cameraPointsFromDocument(document) })

function writeCameraPoints(points: Scene3DCameraPoint[]) {
  document = applyCameraPoints(document, points)
  selectedPoint.value = Math.min(selectedPoint.value, points.length - 1)
  renderRevision.value++
  persist()
}

function markCameraPoint() {
  if (!camera || !orbit || playing.value) return
  const points: Scene3DCameraPoint[] = [...cameraPoints.value, {
    position: tuple(camera.position), target: tuple(orbit.target), focal: currentFocal.value,
    hold: cameraPoints.value.length ? 0 : 1, travel: 3,
  }]
  selectedPoint.value = points.length - 1
  writeCameraPoints(points)
  framingNote.value = `已打第 ${points.length} 个机位点 · 运镜总时长 ${duration.value.toFixed(1)} 秒`
}

function removeCameraPoint(index: number) {
  selectedPoint.value = -1
  writeCameraPoints(cameraPoints.value.filter((_, position) => position !== index))
  framingNote.value = ''
}

function updateCameraPoint(index: number, patch: Partial<Scene3DCameraPoint>) {
  writeCameraPoints(cameraPoints.value.map((point, position) => position === index ? { ...point, ...patch } : point))
}

/** 跳到某个机位点，方便微调后用“重打”覆盖它 */
function useCameraPoint(index: number) {
  const point = cameraPoints.value[index]
  if (!point) return
  selectedPoint.value = index
  applyCamera({ position: point.position, target: point.target, projection: 'perspective', focal: point.focal, aspect: document.canvas.aspect })
  persist({ history: false })
}

function replaceCameraPoint() {
  const index = selectedPoint.value
  if (!camera || !orbit || !cameraPoints.value[index]) return
  updateCameraPoint(index, { position: tuple(camera.position), target: tuple(orbit.target), focal: currentFocal.value })
  framingNote.value = `第 ${index + 1} 个机位点已重打`
}

/**
 * 运镜录制交给工作台的隐藏录制器：可见编辑器的画布是舞台形状，直接录会把取景框外的画面也录进去。
 * 隐藏录制器按画幅 1920 出片，再走现有 FFmpeg 链路存进视频目录。
 */
function requestCameraPathRecording() {
  if (playing.value || manualRecording.value || !cameraPoints.value.length) return
  framingNote.value = ''
  recordingError.value = ''
  emit('record', structuredClone(document), `${document.title}-运镜`)
}

function removeSelection() {
  const target = selectable.get(selectedId.value)
  const selection = target?.userData.sceneSelection as { id: string; kind: 'object' | 'formation' | 'group' } | undefined
  if (!selection) return
  if (selection.kind === 'group') document.groups = document.groups.filter(item => item.id !== selection.id)
  else if (selection.kind === 'object') document.objects = document.objects.filter(item => item.id !== selection.id)
  else document.formations = document.formations.filter(item => item.id !== selection.id)
  if (selection.kind !== 'group') document.groups = document.groups.map(group => ({ ...group, memberIds: group.memberIds.filter(id => id !== selection.id) })).filter(group => group.memberIds.length)
  document.timeline = document.timeline?.filter(item => item.target !== selection.id)
  selectedId.value = ''
  buildScene(); persist()
}

function removeSelectedWithKeyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { clearSelection(); return }
  if ((event.key !== 'Delete' && event.key !== 'Backspace') || (event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]') || !selectedId.value) return
  event.preventDefault(); removeSelection()
}

async function capture() {
  if (!renderer || !canvas.value) return
  clearSelection()
  renderer.render(scene!, activeCamera())
  const source = renderer.domElement
  const width = source.width; const height = source.height
  const crop = cropRect(width, height)
  const output = window.document.createElement('canvas')
  output.width = Math.max(1, Math.round(crop.width)); output.height = Math.max(1, Math.round(crop.width / aspectRatio(currentAspect.value)))
  output.getContext('2d')!.drawImage(source, (width - crop.width) / 2, (height - crop.height) / 2, crop.width, crop.height, 0, 0, output.width, output.height)
  const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'))
  if (blob && blob.size) emit('screenshot', blob, `${document.title}-${cameraName.value || '机位'}`)
}

function recordingMimeType() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(value => MediaRecorder.isTypeSupported(value))
}

function restoreManualRecordingUi() {
  manualRecording.value = false
  manualRecorder = null
  manualChunks = []
  updateGrid()
  attachSelection(selectedId.value)
}

function startManualRecording() {
  if (!canvas.value || manualRecorder) return
  if (!canvas.value.captureStream) { recordingError.value = '当前系统不支持 3D 画布录制'; return }
  const mimeType = recordingMimeType()
  if (!mimeType) { recordingError.value = '当前系统不支持 3D 画布录制'; return }
  recordingError.value = ''
  manualRecordingFailed = false
  discardManualRecording = false
  manualChunks = []
  clearSelection()
  transform?.detach()
  if (scene?.getObjectByName('scene-grid')) scene.getObjectByName('scene-grid')!.visible = false
  const recorder = new MediaRecorder(canvas.value.captureStream(30), { mimeType, videoBitsPerSecond: 12_000_000 })
  manualRecorder = recorder
  manualRecording.value = true
  recorder.ondataavailable = event => { if (event.data.size) manualChunks.push(event.data) }
  recorder.onerror = () => { manualRecordingFailed = true; recordingError.value = '3D 手动录制失败'; if (recorder.state !== 'inactive') recorder.stop() }
  recorder.onstop = () => {
    const blob = new Blob(manualChunks, { type: mimeType })
    const shouldEmit = !manualRecordingFailed && !discardManualRecording && blob.size > 0
    restoreManualRecordingUi()
    if (shouldEmit) emit('video', blob, `${document.title}-手动运镜`)
    else if (!manualRecordingFailed && !discardManualRecording) recordingError.value = '录制结果为空'
  }
  recorder.start(1000)
}

function stopManualRecording() {
  if (manualRecorder?.state !== 'inactive') manualRecorder?.stop()
}

function resize() {
  if (!renderer || !canvas.value || !camera) return
  stageSize.value = { width: canvas.value.clientWidth, height: canvas.value.clientHeight }
  const ratio = aspectRatio(currentAspect.value)
  const width = props.recordingOnly ? (ratio >= 1 ? 1920 : Math.round(1920 * ratio)) : Math.max(canvas.value.clientWidth, 1)
  const height = props.recordingOnly ? (ratio >= 1 ? Math.round(1920 / ratio) : 1920) : Math.max(canvas.value.clientHeight, 1)
  renderer.setSize(width, height, false)
  const renderRatio = width / height
  if (perspective && camera === perspective) { perspective.aspect = renderRatio; perspective.fov = cameraFov(renderRatio); perspective.updateProjectionMatrix() }
  if (orthographic && camera === orthographic) { const size = 18; orthographic.left = -size * renderRatio / 2; orthographic.right = size * renderRatio / 2; orthographic.top = size / 2; orthographic.bottom = -size / 2; orthographic.updateProjectionMatrix() }
}

function render() {
  animationFrame = requestAnimationFrame(render)
  if (playing.value) {
    currentTime.value = Math.min(duration.value, (performance.now() - playStartedAt) / 1000)
    applyAnimation(currentTime.value)
    if (currentTime.value >= duration.value) playing.value = false
  } else if (!props.recordingOnly) orbit?.update()
  if (scene && camera) renderer?.render(scene, activeCamera())
}

async function recordVideo(signal?: AbortSignal): Promise<Blob> {
  if (!renderer || !canvas.value || !duration.value || !document.timeline?.length) throw new Error('当前场景没有可录制的动画时间线')
  if (!canvas.value.captureStream) throw new Error('当前系统不支持 3D 画布录制')
  const mimeType = recordingMimeType()
  if (!mimeType) throw new Error('当前系统不支持画布视频录制')
  clearSelection()
  resize(); currentTime.value = 0; applyAnimation(0); renderer.render(scene!, activeCamera())
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(canvas.value.captureStream(30), { mimeType, videoBitsPerSecond: 12_000_000 })
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
  const completed = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('录制 3D 动画失败'))
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      if (!blob.size) reject(new Error('录制结果为空'))
      else resolve(blob)
    }
  })
  recorder.start(1000); replay()
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, duration.value * 1000 + 100)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer); playing.value = false
      if (recorder.state !== 'inactive') recorder.stop()
      reject(new DOMException('已停止录制', 'AbortError'))
    }, { once: true })
  })
  playing.value = false; recorder.stop()
  return await completed
}

defineExpose({ recordVideo })

onMounted(() => {
  if (!canvas.value) return
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x15201c)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(props.recordingOnly ? 1 : Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = document.lighting.shadows
  raycaster = new THREE.Raycaster()
  updateLights(); updateGrid(); buildScene(); createCameraControls(); applyAnimation(0)
  canvas.value.addEventListener('pointerup', pick)
  window.addEventListener('pointerdown', closeContextMenu)
  window.addEventListener('keydown', removeSelectedWithKeyboard)
  window.addEventListener('keydown', handleHistoryKeyboard)
  window.addEventListener('keydown', handleNudgeKeys)
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas.value); render()
})

watch(() => props.document, value => {
  document = parseScene3DDocument(value); currentTime.value = 0; playing.value = false; renderRevision.value++; buildScene(); createCameraControls(); applyAnimation(0)
})

// 运镜播放时视角在变；停下来要把视角复位成工具栏显示的焦段
watch(playing, value => { if (!value) restoreLens() })

// 工作台回的录制/截图结果、本机录制错误，都走画面上的浮动提示
watch(() => props.videoStatus, value => { if (value) showNotice(value) }, { immediate: true })
watch(recordingError, value => { if (value) showNotice(value) })

onBeforeUnmount(() => {
  discardManualRecording = true
  const recorder = manualRecorder
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  cancelAnimationFrame(animationFrame); window.clearTimeout(noticeTimer); resizeObserver?.disconnect(); canvas.value?.removeEventListener('pointerup', pick); window.removeEventListener('pointerdown', closeContextMenu); window.removeEventListener('keydown', removeSelectedWithKeyboard); window.removeEventListener('keydown', handleHistoryKeyboard); window.removeEventListener('keydown', handleNudgeKeys)
  orbit?.dispose(); transform?.dispose(); renderer?.dispose()
  if (root) disposeObject(root)
  characterTemplates.forEach(template => disposeObject(template, true))
  characterTemplates.clear()
})
</script>

<template>
  <section class="scene3d-editor" :class="{ 'recording-only': recordingOnly }">
    <header v-if="!recordingOnly" class="scene3d-toolbar">
      <strong>{{ document.title }}</strong>
      <div class="scene3d-tools">
        <button title="俯拍" @click="setCameraPreset('top')">俯</button>
        <button title="平视" @click="setCameraPreset('front')">平</button>
        <button title="侧视" @click="setCameraPreset('side')">侧</button>
        <button title="低机位" @click="setCameraPreset('low')">低</button>
        <button title="恢复默认视角" @click="setCameraPreset('reset')">复</button>
        <span class="scene3d-divider"></span>
        <button :class="{ active: document.camera.projection === 'perspective' }" title="透视视图" @click="setProjection('perspective')">透</button>
        <button :class="{ active: document.camera.projection === 'orthographic' }" title="正交视图" @click="setProjection('orthographic')">正</button>
        <button v-for="focal in FOCAL_STEPS" :key="focal" :class="{ active: currentFocal === focal }" :title="FOCAL_TITLES[focal]" @click="setFocal(focal)">{{ focal }}</button>
        <span class="scene3d-divider"></span>
        <button v-for="aspect in ['16:9', '9:16', '1:1', '4:3', '3:4']" :key="aspect" :class="{ active: currentAspect === aspect }" :title="`${aspect} 画幅`" @click="setAspect(aspect as Scene3DDocument['canvas']['aspect'])">{{ aspect }}</button>
        <span class="scene3d-divider"></span>
        <button :class="{ active: document.canvas.grid }" title="显示或隐藏网格" @click="toggleGrid"><JcIcon name="grid-on" /></button>
        <button :class="{ active: document.canvas.snap }" title="开启或关闭吸附（拖动按当前步长对齐）" @click="toggleSnap"><JcIcon name="sync" /></button>
        <select v-if="document.canvas.snap" v-model.number="snapStep" class="scene3d-snap-step" title="吸附步长（米）" aria-label="吸附步长" @change="setSnapStep(snapStep)">
          <option v-for="step in SNAP_STEPS" :key="step" :value="step">{{ step }}</option>
        </select>
        <button :class="{ active: frameMode }" title="取景模式：拖动只平移机位，不改朝向" @click="toggleFrameMode">取景</button>
        <button :class="{ active: labelsVisible }" title="显示或隐藏标签" @click="toggleLabels"><JcIcon name="label" /></button>
        <button :disabled="!selectedId" :class="{ active: previewHidden.has(selectedId) }" :title="previewHidden.has(selectedId) ? '恢复显示选中对象' : '临时隐藏选中对象（只影响预览，不写进场景）'" @click="togglePreviewHidden"><JcIcon :name="previewHidden.has(selectedId) ? 'visibility-off' : 'visibility'" /></button>
        <details class="scene3d-lighting">
          <summary title="展开光影控制">光影</summary>
          <div class="scene3d-lighting-menu">
            <span>来光</span>
            <button v-for="direction in ['left', 'right', 'front', 'back', 'top']" :key="direction" :class="{ active: document.lighting.direction === direction }" :title="`${({ left: '左侧', right: '右侧', front: '正面', back: '背面', top: '顶部' } as Record<string, string>)[direction]}来光`" @click="setLighting(direction as Scene3DDocument['lighting']['direction'])">{{ ({ left: '左', right: '右', front: '前', back: '后', top: '顶' } as Record<string, string>)[direction] }}</button>
            <span>亮度</span>
            <button v-for="intensity in ['low', 'medium', 'high']" :key="intensity" :class="{ active: document.lighting.intensity === intensity }" :title="`${({ low: '低', medium: '中', high: '高' } as Record<string, string>)[intensity]}亮度`" @click="setLightIntensity(intensity as Scene3DDocument['lighting']['intensity'])">{{ ({ low: '低', medium: '中', high: '高' } as Record<string, string>)[intensity] }}</button>
            <button :class="{ active: document.lighting.shadows }" title="开启或关闭阴影" @click="toggleShadows">阴影</button>
          </div>
        </details>
        <span class="scene3d-divider"></span>
        <button title="保存当前机位" @click="saveCamera"><JcIcon name="bookmark-add" /></button>
        <button title="撤销 Cmd/Ctrl+Z" :disabled="historyIndex < 1" @click="undo"><JcIcon name="undo" /></button>
        <button title="重做 Cmd/Ctrl+Shift+Z" :disabled="historyIndex >= history.length - 1" @click="redo"><JcIcon name="redo" /></button>
        <button title="复制选中物体 Cmd/Ctrl+C" :disabled="!selectedId" @click="copySelection"><JcIcon name="content-copy" /></button>
        <button title="粘贴物体 Cmd/Ctrl+V" :disabled="!copiedSelection" @click="pasteSelection"><JcIcon name="content-paste" /></button>
        <button class="primary" title="截图保存到图片" @click="capture"><JcIcon name="photo-camera" /></button>
        <button :disabled="!selectedId" title="删除选中物体（Delete）" @click="removeSelection"><JcIcon name="delete" /></button>
        <button v-if="!manualRecording" title="开始手动运镜录制" @click="startManualRecording"><JcIcon name="radio-button-checked" /></button>
        <button v-else class="recording" title="停止并保存录制" @click="stopManualRecording"><JcIcon name="stop" /></button>
        <span v-if="recordingError" class="scene3d-recording-error">{{ recordingError }}</span>
        <template v-if="duration">
          <span class="scene3d-divider"></span>
          <button :title="playing ? '暂停' : '播放'" @click="togglePlayback"><JcIcon :name="playing ? 'pause' : 'play_arrow'" /></button>
          <button title="从头重播" @click="replay"><JcIcon name="restart-alt" /></button>
          <span class="scene3d-time">{{ currentTime.toFixed(1) }} / {{ duration.toFixed(1) }}s</span>
        </template>
      </div>
    </header>
    <div class="scene3d-workspace" :class="{ 'inspector-open': Boolean(selectedEntry) }">
      <div class="scene3d-stage">
        <canvas ref="canvas" aria-label="3D 白膜场景" @contextmenu.prevent="openContextMenu"></canvas>
        <div v-if="contextMenu.show" class="scene3d-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @pointerdown.stop>
          <button @click="copySelection">复制</button>
          <button :disabled="!copiedSelection" @click="pasteSelection">粘贴</button>
          <button @click="removeSelection">删除</button>
          <button v-if="selectedEntry && 'label' in selectedEntry" @click="clearSelectedLabel">删字</button>
        </div>
        <div v-if="!recordingOnly" class="scene3d-frame" :class="{ framing: frameMode }" :style="{ width: `${frameRect.width}px`, height: `${frameRect.height}px` }"></div>
        <p v-if="!recordingOnly && !selectedId" class="scene3d-hint">点击选中后拖动或按方向键微调 · 取景模式拖动平移镜头</p>
        <p v-if="notice" class="scene3d-notice" :class="`tone-${noticeTone(notice)}`" :title="notice" @click="notice = ''">{{ notice }}</p>
      </div>
      <aside v-if="selectedEntry" class="scene3d-inspector" aria-label="对象设置">
        <section v-if="'label' in selectedEntry" class="scene3d-inspector-section">
          <h2>对象</h2>
          <input :value="selectedEntry.label || ''" aria-label="对象名称" placeholder="对象名称" @change="updateSelectedLabel(($event.target as HTMLInputElement).value)" />
          <button title="删除显示文字" @click="clearSelectedLabel">删字</button>
          <input v-if="'color' in selectedEntry" type="color" :value="selectedEntry.color || '#e7ece9'" title="对象颜色" aria-label="对象颜色" @input="updateSelectedColor(($event.target as HTMLInputElement).value)" />
        </section>
        <section v-if="'position' in selectedEntry" class="scene3d-inspector-section">
          <h2>位置</h2>
          <div class="scene3d-inspector-grid scene3d-position-grid">
            <label v-for="(axis, index) in ['x', 'y', 'z']" :key="axis">
              <span>{{ axis }}</span>
              <input type="number" :step="snapStep" :value="positionValue(index)" :aria-label="`位置 ${axis}`" @change="updateSelectedPosition(index, ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </section>
        <template v-if="selectedCharacter">
          <section class="scene3d-inspector-section">
            <h2>人物</h2>
            <select :value="selectedCharacter.character?.model" aria-label="人物模型" @change="setCharacterModel(($event.target as HTMLSelectElement).value as Scene3DCharacter['model'])">
              <option v-for="model in STORYBOARDER_CHARACTER_MODELS" :key="model" :value="model">{{ selectedModelLabel(model) }}</option>
            </select>
            <div class="scene3d-inspector-actions">
              <button title="移动整个人物" @click="attachSelection(selectedCharacter.id)">移动</button>
              <button title="旋转整个人物" @click="rotateCharacter">转向</button>
              <button title="人物缩小" @click="adjustCharacterScale(-0.1)">缩</button>
              <span>{{ selectedCharacter.character?.scale.toFixed(1) }}x</span>
              <button title="人物放大" @click="adjustCharacterScale(0.1)">放</button>
            </div>
          </section>
          <section class="scene3d-inspector-section">
            <h2>姿势</h2>
            <div class="scene3d-inspector-grid">
              <button v-for="item in poseOptions" :key="item.id" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`应用姿势：${poseLabel(item.name)}`" @click="applyPose(item.id)">{{ poseLabel(item.name) }}</button>
            </div>
          </section>
          <section class="scene3d-inspector-section">
            <h2>手势</h2>
            <div class="scene3d-inspector-grid">
              <button v-for="item in handOptions" :key="`right-${item.id}`" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`右手：${handLabel(item.name)}`" @click="applyHand(item.id, 'right')">右{{ handLabel(item.name) }}</button>
              <button v-for="item in handOptions" :key="`left-${item.id}`" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`左手：${handLabel(item.name)}`" @click="applyHand(item.id, 'left')">左{{ handLabel(item.name) }}</button>
            </div>
          </section>
          <details class="scene3d-inspector-section">
            <summary>关节</summary>
            <div class="scene3d-inspector-grid">
              <button v-for="name in STORYBOARDER_EDITABLE_BONES" :key="name" :class="{ active: activeBoneName === name }" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`旋转关节：${boneLabel(name)}`" @click="attachBone(name)">{{ boneLabel(name) }}</button>
            </div>
          </details>
          <p v-if="characterLoading" class="scene3d-character-name">加载中</p>
          <p v-if="characterLoadError" class="scene3d-recording-error">{{ characterLoadError }}</p>
        </template>
      </aside>
    </div>
    <footer v-if="!recordingOnly" class="scene3d-cameras scene3d-path">
      <span>运镜</span>
      <div v-for="(point, index) in cameraPoints" :key="`point-${index}`" class="scene3d-point-chip" :class="{ active: selectedPoint === index }">
        <button :title="`跳到第 ${index + 1} 个机位点`" @click="useCameraPoint(index)">{{ index + 1 }}</button>
        <label>停<input type="number" min="0" max="60" step="0.5" :value="point.hold" :aria-label="`第 ${index + 1} 点停留秒数`" @change="updateCameraPoint(index, { hold: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label v-if="index">移<input type="number" min="0" max="60" step="0.5" :value="point.travel" :aria-label="`第 ${index + 1} 点移动秒数`" @change="updateCameraPoint(index, { travel: Number(($event.target as HTMLInputElement).value) })" /></label>
        <button :title="`删除第 ${index + 1} 个机位点`" @click="removeCameraPoint(index)"><JcIcon name="close" /></button>
      </div>
      <button :disabled="playing || manualRecording" title="把当前机位打成一个点" @click="markCameraPoint">打点</button>
      <button :disabled="selectedPoint < 0 || playing" title="用当前机位覆盖选中的点" @click="replaceCameraPoint">重打</button>
      <button :disabled="!cameraPoints.length || playing || manualRecording" :title="cameraPoints.length ? `录制这段运镜（${duration.toFixed(1)} 秒，按取景框出片）` : '先打点'" @click="requestCameraPathRecording"><JcIcon name="radio-button-checked" /></button>
      <span v-if="framingNote" class="scene3d-framing-note">{{ framingNote }}</span>
    </footer>
    <footer v-if="!recordingOnly" class="scene3d-cameras">
      <span>机位</span>
      <button v-for="(person, index) in scenePeople.slice(0, PERSON_BUTTON_LIMIT)" :key="person.id" :title="`${person.label} 正面中景；机位距离按当前 ${currentFocal}mm 推算`" @click="applyCloseShot(index)">{{ person.label }}</button>
      <span v-if="framingNote" class="scene3d-framing-note">{{ framingNote }}</span>
      <div v-for="(item, index) in savedCameras" :key="`${item.name}-${index}`" class="scene3d-camera-chip">
        <button @click="useSavedCamera(item)">{{ item.name || `机位 ${index + 1}` }}</button>
        <button :title="`删除 ${item.name || `机位 ${index + 1}`}`" @click="removeSavedCamera(index)"><JcIcon name="close" /></button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.scene3d-editor { min-height: 0; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; background: #15201c; color: #e8efeb; }
.scene3d-toolbar { display: flex; align-items: flex-start; gap: 12px; min-height: 46px; padding: 6px 10px; border-bottom: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-toolbar strong { flex: 0 0 auto; font-size: 14px; }
.scene3d-tools { display: flex; align-items: center; gap: 3px; }
.scene3d-character-name { color: #a9d8b8; font-size: 11px; white-space: nowrap; }
.scene3d-tools button, .scene3d-cameras button, .scene3d-lighting summary { min-width: 30px; height: 30px; border: 1px solid transparent; color: #dce8e1; background: transparent; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px; }
.scene3d-snap-step { height: 30px; padding: 0 2px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 4px; color: #dce8e1; background: rgba(0, 0, 0, .18); font: inherit; font-size: 11px; }
.scene3d-framing-note { color: #f0d69a; font-size: 11px; white-space: nowrap; }
.scene3d-tools button.recording { color: #ff8f8f; }
.scene3d-recording-error { color: #ff9d9d; font-size: 11px; white-space: nowrap; }
.scene3d-video-status { color: #a9d8b8; font-size: 11px; white-space: nowrap; }
.scene3d-notice { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); max-width: calc(100% - 24px); margin: 0; padding: 7px 10px; border-left: 3px solid #86c8a5; border-radius: 4px; background: rgba(10, 17, 14, .92); color: #e8efeb; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; cursor: pointer; }
.scene3d-notice.tone-success { border-left-color: #86c8a5; }
.scene3d-notice.tone-error { border-left-color: #ff8f8f; color: #ffd9d9; }
.scene3d-context-menu { position: absolute; z-index: 5; display: grid; gap: 2px; min-width: 120px; padding: 5px; border: 1px solid rgba(216, 235, 223, .24); border-radius: 4px; background: #1c2923; box-shadow: 0 8px 20px rgba(0, 0, 0, .3); }
.scene3d-context-menu button { padding: 5px 8px; border: 0; color: #e8efeb; background: transparent; text-align: left; cursor: pointer; }
.scene3d-context-menu button:hover { background: rgba(222, 243, 229, .14); }
.scene3d-tools button:hover, .scene3d-tools button.active, .scene3d-lighting[open] summary { background: rgba(222, 243, 229, .14); border-color: rgba(222, 243, 229, .2); }
.scene3d-tools button.primary { background: #86c8a5; color: #122018; }
.scene3d-tools .mso { font-size: 18px; }
.scene3d-time { min-width: 84px; font-size: 11px; color: #b9c8c0; text-align: center; }
.scene3d-divider { width: 1px; height: 22px; background: rgba(216, 235, 223, .16); margin: 0 3px; }
.scene3d-lighting { position: relative; }
.scene3d-lighting summary { display: grid; place-items: center; list-style: none; padding: 0 7px; }
.scene3d-lighting summary::-webkit-details-marker { display: none; }
.scene3d-lighting-menu { position: absolute; z-index: 4; top: calc(100% + 6px); left: 0; display: grid; grid-template-columns: repeat(5, 30px); gap: 4px; width: max-content; padding: 8px; border: 1px solid rgba(216, 235, 223, .24); border-radius: 4px; background: #1c2923; box-shadow: 0 8px 20px rgba(0, 0, 0, .3); }
.scene3d-lighting-menu span { grid-column: 1 / -1; color: #aebcb5; font-size: 11px; }
.scene3d-lighting-menu button { border-color: rgba(216, 235, 223, .16); }
.scene3d-workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.scene3d-workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 260px; }
.scene3d-stage { position: relative; min-height: 320px; overflow: hidden; padding: 8px; }
.scene3d-stage canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.scene3d-inspector { overflow-y: auto; padding: 10px; border-left: 1px solid rgba(216, 235, 223, .12); background: #18241f; }
.scene3d-inspector-section { display: grid; gap: 6px; margin: 0 0 12px; padding: 0 0 12px; border: 0; border-bottom: 1px solid rgba(216, 235, 223, .12); }
.scene3d-inspector-section h2, .scene3d-inspector-section summary { margin: 0; color: #a9d8b8; font-size: 12px; font-weight: 600; }
.scene3d-inspector-section summary { cursor: pointer; }
.scene3d-inspector input:not([type='color']), .scene3d-inspector select { width: 100%; height: 30px; padding: 0 6px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 4px; color: #e8efeb; background: rgba(0, 0, 0, .18); }
.scene3d-inspector input[type='color'] { width: 30px; height: 30px; padding: 2px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 4px; background: transparent; }
.scene3d-inspector button { min-width: 30px; height: 30px; border: 1px solid rgba(216, 235, 223, .16); border-radius: 4px; color: #dce8e1; background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
.scene3d-inspector button:hover, .scene3d-inspector button.active { background: rgba(222, 243, 229, .14); border-color: rgba(222, 243, 229, .2); }
.scene3d-inspector button:disabled { opacity: .45; cursor: not-allowed; }
.scene3d-inspector-actions, .scene3d-inspector-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; align-items: center; }
.scene3d-position-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.scene3d-position-grid label { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px; align-items: center; }
.scene3d-position-grid span { color: #aebcb5; font-size: 11px; }
.scene3d-inspector-actions span { color: #a9d8b8; font-size: 11px; text-align: center; }
.scene3d-frame { position: absolute; inset: 50% auto auto 50%; transform: translate(-50%, -50%); border: 1px solid rgba(235, 248, 240, .42); pointer-events: none; }
.scene3d-frame.framing { border-color: #86c8a5; box-shadow: 0 0 0 1px rgba(134, 200, 165, .4); }
.scene3d-hint { position: absolute; left: 12px; bottom: 10px; margin: 0; padding: 6px 8px; color: #dce8e1; background: rgba(10, 17, 14, .72); border-radius: 4px; font-size: 12px; pointer-events: none; }
.scene3d-cameras { display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 5px 10px; border-top: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-path { border-top: 0; }
.scene3d-point-chip { display: flex; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 4px; border: 1px solid rgba(216, 235, 223, .18); border-radius: 4px; }
.scene3d-point-chip.active { border-color: #86c8a5; }
.scene3d-point-chip label { display: flex; align-items: center; gap: 2px; color: #aebcb5; font-size: 11px; }
.scene3d-point-chip input { width: 42px; height: 24px; padding: 0 3px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 3px; color: #e8efeb; background: rgba(0, 0, 0, .18); font: inherit; font-size: 11px; }
.scene3d-point-chip > button:first-child { padding: 0 6px; }
.scene3d-point-chip > button:last-child { min-width: 24px; width: 24px; }
.scene3d-cameras > span { color: #aebcb5; font-size: 12px; }
.scene3d-editor.recording-only { width: 100%; height: 100%; grid-template-rows: minmax(0, 1fr); }
.scene3d-cameras > button { flex: 0 0 auto; padding: 0 8px; border-color: rgba(216, 235, 223, .18); }
.scene3d-cameras > button:hover { background: rgba(222, 243, 229, .14); }
.scene3d-cameras > button:disabled { opacity: .45; cursor: not-allowed; }
.scene3d-camera-chip { display: flex; align-items: center; border: 1px solid rgba(216, 235, 223, .18); border-radius: 4px; }
.scene3d-camera-chip button:first-child { padding: 0 8px; min-width: auto; }
.scene3d-camera-chip button:last-child { min-width: 24px; width: 24px; }
.scene3d-camera-chip .mso { font-size: 15px; }
@media (max-width: 760px) { .scene3d-toolbar { gap: 8px; } .scene3d-workspace, .scene3d-workspace.inspector-open { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(300px, 1fr) auto; } .scene3d-inspector { max-height: 260px; border-top: 1px solid rgba(216, 235, 223, .12); border-left: 0; } .scene3d-stage { min-height: 300px; } }
</style>

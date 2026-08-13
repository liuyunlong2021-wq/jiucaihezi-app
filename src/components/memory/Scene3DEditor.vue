<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { STORYBOARDER_BONE_NAMES, evaluateScene3DAnimation, parseScene3DDocument, type Scene3DCamera, type Scene3DCharacter, type Scene3DDocument, type Scene3DFormation, type Scene3DGroup, type Scene3DObject } from '@/runtime/memory/scene3d'
import { STORYBOARDER_CHARACTER_MODELS, STORYBOARDER_EDITABLE_BONES, STORYBOARDER_HAND_POSES, STORYBOARDER_POSES, handPosePreset, posePreset, resolveStoryboarderModelUrl } from '@/runtime/memory/storyboarderAssets'

const props = withDefaults(defineProps<{ document: Scene3DDocument; recordingOnly?: boolean; videoStatus?: string }>(), { recordingOnly: false, videoStatus: '' })
const emit = defineEmits<{ save: [document: Scene3DDocument]; screenshot: [blob: Blob, title: string]; video: [blob: Blob, title: string] }>()

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
const poseOptions = computed(() => {
  const preferred = ['stand', 'sit chair', 'crouch inspect', 'walk', 'run', 'point', 'cross arms']
  return preferred.map(name => STORYBOARDER_POSES.find(item => item.name.toLowerCase() === name)).filter((item): item is (typeof STORYBOARDER_POSES)[number] => Boolean(item))
})
const handOptions = computed(() => ['Relaxed', 'Flat Spread', 'Point', 'Peace', 'Fist'].map(name => STORYBOARDER_HAND_POSES.find(item => item.name === name)).filter((item): item is (typeof STORYBOARDER_HAND_POSES)[number] => Boolean(item)))
const defaultCameras = computed(() => {
  renderRevision.value
  const characters = [
    ...document.objects.filter(item => item.type === 'person').map(item => ({ name: item.label, position: item.position })),
    ...document.formations.filter(item => (item.shape || 'person') === 'person').map(item => ({ name: item.label, position: item.position })),
  ]
  const first = characters[0] || { name: '人物 A', position: [-2, 0, 0] as [number, number, number] }
  const second = characters[1] || { name: '人物 B', position: [2, 0, 0] as [number, number, number] }
  const firstName = first.name || '人物 A'
  const secondName = second.name || '人物 B'
  const midpoint: [number, number, number] = [
    (first.position[0] + second.position[0]) / 2,
    (first.position[1] + second.position[1]) / 2 + 1,
    (first.position[2] + second.position[2]) / 2,
  ]
  const camera = (name: string, position: [number, number, number], target = document.camera.target, projection: Scene3DCamera['projection'] = 'perspective'): Scene3DCamera =>
    ({ name, position, target, projection, lens: 'standard', aspect: document.canvas.aspect })
  return [
    camera('全景', [12, 9, 14]), camera('正面中景', [0, 4, 10]), camera('俯拍', [0, 20, .01], midpoint, 'orthographic'),
    camera('低机位', [8, 2, 12]), camera('双人中景', [midpoint[0], midpoint[1] + 2, midpoint[2] + 8], midpoint),
    camera(`${firstName}过肩`, [first.position[0], first.position[1] + 2, first.position[2] + 2], [second.position[0], second.position[1] + 1, second.position[2]]),
    camera(`${secondName}过肩`, [second.position[0], second.position[1] + 2, second.position[2] + 2], [first.position[0], first.position[1] + 1, first.position[2]]),
    camera(`${firstName}近景`, [first.position[0], first.position[1] + 2, first.position[2] + 5], [first.position[0], first.position[1] + 1, first.position[2]]),
    camera(`${secondName}近景`, [second.position[0], second.position[1] + 2, second.position[2] + 5], [second.position[0], second.position[1] + 1, second.position[2]]),
  ]
})

function vector(value: [number, number, number]) { return new THREE.Vector3(...value) }
function tuple(value: THREE.Vector3): [number, number, number] { return [value.x, value.y, value.z] }
function lensFov(lens: Scene3DCamera['lens']) { return lens === 'wide' ? 65 : lens === 'telephoto' ? 28 : 45 }
function aspectRatio(value: Scene3DDocument['canvas']['aspect']) {
  const [width, height] = value.split(':').map(Number)
  return width / height
}

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
  scene.add(root)
  applyAnimation(currentTime.value)
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

function applyAnimation(time: number) {
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
  camera.position.set(...state.camera.position); camera.lookAt(vector(state.camera.target)); orbit?.target.set(...state.camera.target)
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
  document.camera = structuredClone(source)
  document.canvas.aspect = source.aspect || document.canvas.aspect
  createCameraControls()
}

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
    perspective = new THREE.PerspectiveCamera(lensFov(source.lens), ratio, .01, 1000)
    camera = perspective
  }
  camera.position.copy(vector(source.position))
  camera.lookAt(vector(source.target))
  orbit = new OrbitControls(activeCamera(), canvas.value)
  orbit.target.copy(vector(source.target)); orbit.enableDamping = true; orbit.dampingFactor = .08
  transform = new TransformControls(activeCamera(), canvas.value)
  transform.setMode('translate')
  transform.setTranslationSnap(document.canvas.snap ? 1 : null)
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

function setLens(lens: Scene3DCamera['lens']) { document.camera.lens = lens; document.camera.projection = 'perspective'; createCameraControls(); persist() }
function setProjection(projection: Scene3DCamera['projection']) { document.camera.projection = projection; createCameraControls(); persist() }
function setAspect(aspect: Scene3DDocument['canvas']['aspect']) { document.canvas.aspect = aspect; document.camera.aspect = aspect; persist() }
function setLighting(direction: Scene3DDocument['lighting']['direction']) { document.lighting.direction = direction; updateLights(); persist() }
function setLightIntensity(intensity: Scene3DDocument['lighting']['intensity']) { document.lighting.intensity = intensity; updateLights(); persist() }
function toggleShadows() { document.lighting.shadows = !document.lighting.shadows; renderer!.shadowMap.enabled = document.lighting.shadows; buildScene(); updateLights(); persist() }
function toggleGrid() { document.canvas.grid = !document.canvas.grid; updateGrid(); persist() }
function toggleSnap() { document.canvas.snap = !document.canvas.snap; transform?.setTranslationSnap(document.canvas.snap ? 1 : null); persist() }
function toggleLabels() { labelsVisible.value = !labelsVisible.value; root?.traverse(node => { if (node.name === 'scene-label') node.visible = labelsVisible.value }) }

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
  if (manualRecording.value || ignoreScenePick || !canvas.value || !camera || !root || !raycaster || transform?.dragging) return
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

function useSavedCamera(item: Scene3DCamera) { cameraName.value = item.name || ''; applyCamera(item); persist() }
function removeSavedCamera(index: number) { document.savedCameras.splice(index, 1); persist() }

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
  const ratio = aspectRatio(currentAspect.value)
  const width = source.width; const height = source.height
  const cropWidth = Math.min(width, Math.round(height * ratio)); const cropHeight = Math.min(height, Math.round(width / ratio))
  const output = window.document.createElement('canvas')
  output.width = cropWidth; output.height = cropHeight
  output.getContext('2d')!.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
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
  const ratio = aspectRatio(currentAspect.value)
  const width = props.recordingOnly ? (ratio >= 1 ? 1920 : Math.round(1920 * ratio)) : Math.max(canvas.value.clientWidth, 1)
  const height = props.recordingOnly ? (ratio >= 1 ? Math.round(1920 / ratio) : 1920) : Math.max(canvas.value.clientHeight, 1)
  renderer.setSize(width, height, false)
  const renderRatio = width / height
  if (perspective && camera === perspective) { perspective.aspect = renderRatio; perspective.updateProjectionMatrix() }
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
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas.value); render()
})

watch(() => props.document, value => {
  document = parseScene3DDocument(value); currentTime.value = 0; playing.value = false; renderRevision.value++; buildScene(); createCameraControls(); applyAnimation(0)
})

onBeforeUnmount(() => {
  discardManualRecording = true
  const recorder = manualRecorder
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  cancelAnimationFrame(animationFrame); resizeObserver?.disconnect(); canvas.value?.removeEventListener('pointerup', pick); window.removeEventListener('pointerdown', closeContextMenu); window.removeEventListener('keydown', removeSelectedWithKeyboard); window.removeEventListener('keydown', handleHistoryKeyboard)
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
        <button title="俯拍" @click="setCameraPreset('top')"><JcIcon name="north" /></button>
        <button title="平视" @click="setCameraPreset('front')"><JcIcon name="straight" /></button>
        <button title="侧视" @click="setCameraPreset('side')"><JcIcon name="east" /></button>
        <button title="低机位" @click="setCameraPreset('low')"><JcIcon name="camera" /></button>
        <button title="恢复默认视角" @click="setCameraPreset('reset')"><JcIcon name="restart-alt" /></button>
        <span class="scene3d-divider"></span>
        <button :class="{ active: document.camera.projection === 'perspective' }" title="透视视图" @click="setProjection('perspective')"><JcIcon name="deployed-code" /></button>
        <button :class="{ active: document.camera.projection === 'orthographic' }" title="正交视图" @click="setProjection('orthographic')"><JcIcon name="grid-4x4" /></button>
        <button :class="{ active: document.camera.lens === 'wide' }" title="广角" @click="setLens('wide')">W</button>
        <button :class="{ active: document.camera.lens === 'standard' }" title="标准镜头" @click="setLens('standard')">S</button>
        <button :class="{ active: document.camera.lens === 'telephoto' }" title="长焦" @click="setLens('telephoto')">T</button>
        <span class="scene3d-divider"></span>
        <button v-for="aspect in ['16:9', '9:16', '1:1', '4:3', '3:4']" :key="aspect" :class="{ active: currentAspect === aspect }" :title="`${aspect} 画幅`" @click="setAspect(aspect as Scene3DDocument['canvas']['aspect'])">{{ aspect }}</button>
        <span class="scene3d-divider"></span>
        <button :class="{ active: document.canvas.grid }" title="显示或隐藏网格" @click="toggleGrid"><JcIcon name="grid-on" /></button>
        <button :class="{ active: document.canvas.snap }" title="开启或关闭网格吸附" @click="toggleSnap"><JcIcon name="sync" /></button>
        <button :class="{ active: labelsVisible }" title="显示或隐藏标签" @click="toggleLabels"><JcIcon name="label" /></button>
        <button v-for="direction in ['left', 'right', 'front', 'back', 'top']" :key="direction" :class="{ active: document.lighting.direction === direction }" :title="`${({ left: '左侧', right: '右侧', front: '正面', back: '背面', top: '顶部' } as Record<string, string>)[direction]}来光`" @click="setLighting(direction as Scene3DDocument['lighting']['direction'])"><JcIcon name="light-mode" /></button>
        <button v-for="intensity in ['low', 'medium', 'high']" :key="intensity" :class="{ active: document.lighting.intensity === intensity }" :title="`${({ low: '低', medium: '中', high: '高' } as Record<string, string>)[intensity]}亮度`" @click="setLightIntensity(intensity as Scene3DDocument['lighting']['intensity'])">{{ intensity[0].toUpperCase() }}</button>
        <button :class="{ active: document.lighting.shadows }" title="开启或关闭阴影" @click="toggleShadows"><JcIcon name="contrast" /></button>
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
        <span v-if="videoStatus" class="scene3d-video-status">{{ videoStatus }}</span>
        <template v-if="duration">
          <span class="scene3d-divider"></span>
          <button :title="playing ? '暂停' : '播放'" @click="togglePlayback"><JcIcon :name="playing ? 'pause' : 'play_arrow'" /></button>
          <button title="从头重播" @click="replay"><JcIcon name="restart-alt" /></button>
          <span class="scene3d-time">{{ currentTime.toFixed(1) }} / {{ duration.toFixed(1) }}s</span>
        </template>
      </div>
      <div v-if="selectedCharacter" class="scene3d-character-tools">
        <button v-for="model in STORYBOARDER_CHARACTER_MODELS" :key="model" :class="{ active: selectedCharacter.character?.model === model }" :title="`切换人物：${selectedModelLabel(model)}`" @click="setCharacterModel(model)">{{ selectedModelLabel(model) }}</button>
        <button title="移动整个人物" @click="attachSelection(selectedCharacter.id)">移动</button>
        <button title="旋转整个人物" @click="rotateCharacter">转向</button>
        <button title="人物缩小" @click="adjustCharacterScale(-0.1)">−</button>
        <span class="scene3d-character-name">{{ selectedCharacter.character?.scale.toFixed(1) }}x</span>
        <button title="人物放大" @click="adjustCharacterScale(0.1)">+</button>
        <span class="scene3d-divider"></span>
        <button v-for="item in poseOptions" :key="item.id" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`应用姿势：${item.name}`" @click="applyPose(item.id)">{{ item.name }}</button>
        <span class="scene3d-divider"></span>
        <button v-for="item in handOptions" :key="`right-${item.id}`" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`右手：${item.name}`" @click="applyHand(item.id, 'right')">右{{ item.name }}</button>
        <button v-for="item in handOptions" :key="`left-${item.id}`" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`左手：${item.name}`" @click="applyHand(item.id, 'left')">左{{ item.name }}</button>
        <span class="scene3d-divider"></span>
        <button v-for="name in STORYBOARDER_EDITABLE_BONES" :key="name" :class="{ active: activeBoneName === name }" :disabled="characterLoading > 0 || Boolean(characterLoadError)" :title="`旋转骨骼：${name}`" @click="attachBone(name)">{{ name }}</button>
        <span v-if="characterLoading" class="scene3d-character-name">人物加载中…</span>
        <span v-if="characterLoadError" class="scene3d-recording-error">{{ characterLoadError }}</span>
      </div>
      <div v-if="selectedEntry" class="scene3d-selection-tools">
        <input v-if="'label' in selectedEntry" :value="selectedEntry.label || ''" aria-label="对象名称" placeholder="对象名称" @change="updateSelectedLabel(($event.target as HTMLInputElement).value)" />
        <button v-if="'label' in selectedEntry" title="删除显示文字" @click="clearSelectedLabel"><JcIcon name="label-off" /></button>
        <input v-if="'color' in selectedEntry" type="color" :value="selectedEntry.color || '#e7ece9'" title="对象颜色" aria-label="对象颜色" @input="updateSelectedColor(($event.target as HTMLInputElement).value)" />
      </div>
    </header>
    <div class="scene3d-stage" :style="{ '--scene-aspect': String(aspectRatio(currentAspect)) }">
      <canvas ref="canvas" aria-label="3D 白膜场景" @contextmenu.prevent="openContextMenu"></canvas>
      <div v-if="contextMenu.show" class="scene3d-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @pointerdown.stop>
        <button @click="copySelection">复制</button>
        <button :disabled="!copiedSelection" @click="pasteSelection">粘贴</button>
        <button @click="removeSelection">删除</button>
        <button v-if="selectedEntry && 'label' in selectedEntry" @click="clearSelectedLabel">删除显示文字</button>
      </div>
      <div v-if="!recordingOnly" class="scene3d-frame"></div>
      <p v-if="!recordingOnly && !selectedId" class="scene3d-hint">点击人物、物体或队伍后拖动调整位置</p>
    </div>
    <footer v-if="!recordingOnly" class="scene3d-cameras">
      <span>机位</span>
      <button v-for="item in defaultCameras" :key="item.name" @click="useSavedCamera(item)">{{ item.name }}</button>
      <div v-for="(item, index) in savedCameras" :key="`${item.name}-${index}`" class="scene3d-camera-chip">
        <button @click="useSavedCamera(item)">{{ item.name || `机位 ${index + 1}` }}</button>
        <button :title="`删除 ${item.name || `机位 ${index + 1}`}`" @click="removeSavedCamera(index)"><JcIcon name="close" /></button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.scene3d-editor { min-height: 0; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #15201c; color: #e8efeb; }
.scene3d-toolbar { display: flex; align-items: flex-start; gap: 12px; min-height: 46px; padding: 6px 10px; border-bottom: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-toolbar strong { flex: 0 0 auto; font-size: 14px; }
.scene3d-tools { display: flex; align-items: center; gap: 3px; }
.scene3d-character-tools { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; max-width: 58vw; overflow-x: auto; padding-left: 8px; border-left: 1px solid rgba(216, 235, 223, .16); }
.scene3d-selection-tools { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; padding-left: 8px; border-left: 1px solid rgba(216, 235, 223, .16); }
.scene3d-selection-tools input:not([type='color']) { width: 120px; height: 28px; padding: 0 6px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 4px; background: rgba(0, 0, 0, .18); color: #e8efeb; }
.scene3d-selection-tools input[type='color'] { width: 30px; height: 28px; padding: 2px; border: 1px solid rgba(216, 235, 223, .2); border-radius: 4px; background: transparent; }
.scene3d-character-name { color: #a9d8b8; font-size: 11px; white-space: nowrap; }
.scene3d-tools button, .scene3d-character-tools button, .scene3d-cameras button { min-width: 30px; height: 30px; border: 1px solid transparent; color: #dce8e1; background: transparent; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px; }
.scene3d-tools button.recording { color: #ff8f8f; }
.scene3d-recording-error { color: #ff9d9d; font-size: 11px; white-space: nowrap; }
.scene3d-video-status { color: #a9d8b8; font-size: 11px; white-space: nowrap; }
.scene3d-context-menu { position: absolute; z-index: 5; display: grid; gap: 2px; min-width: 120px; padding: 5px; border: 1px solid rgba(216, 235, 223, .24); border-radius: 4px; background: #1c2923; box-shadow: 0 8px 20px rgba(0, 0, 0, .3); }
.scene3d-context-menu button { padding: 5px 8px; border: 0; color: #e8efeb; background: transparent; text-align: left; cursor: pointer; }
.scene3d-context-menu button:hover { background: rgba(222, 243, 229, .14); }
.scene3d-tools button:hover, .scene3d-tools button.active, .scene3d-character-tools button:hover, .scene3d-character-tools button.active { background: rgba(222, 243, 229, .14); border-color: rgba(222, 243, 229, .2); }
.scene3d-character-tools button:disabled { opacity: .45; cursor: not-allowed; }
.scene3d-tools button.primary { background: #86c8a5; color: #122018; }
.scene3d-tools .mso { font-size: 18px; }
.scene3d-time { min-width: 84px; font-size: 11px; color: #b9c8c0; text-align: center; }
.scene3d-divider { width: 1px; height: 22px; background: rgba(216, 235, 223, .16); margin: 0 3px; }
.scene3d-stage { position: relative; min-height: 320px; overflow: hidden; }
.scene3d-stage canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.scene3d-frame { position: absolute; inset: 50% auto auto 50%; width: min(86%, calc(72vh * var(--scene-aspect))); aspect-ratio: var(--scene-aspect); transform: translate(-50%, -50%); border: 1px solid rgba(235, 248, 240, .42); pointer-events: none; }
.scene3d-hint { position: absolute; left: 12px; bottom: 10px; margin: 0; padding: 6px 8px; color: #dce8e1; background: rgba(10, 17, 14, .72); border-radius: 4px; font-size: 12px; pointer-events: none; }
.scene3d-cameras { display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 5px 10px; border-top: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-cameras > span { color: #aebcb5; font-size: 12px; }
.scene3d-editor.recording-only { width: 100%; height: 100%; grid-template-rows: minmax(0, 1fr); }
.scene3d-cameras > button { flex: 0 0 auto; padding: 0 8px; border-color: rgba(216, 235, 223, .18); }
.scene3d-cameras > button:hover { background: rgba(222, 243, 229, .14); }
.scene3d-camera-chip { display: flex; align-items: center; border: 1px solid rgba(216, 235, 223, .18); border-radius: 4px; }
.scene3d-camera-chip button:first-child { padding: 0 8px; min-width: auto; }
.scene3d-camera-chip button:last-child { min-width: 24px; width: 24px; }
.scene3d-camera-chip .mso { font-size: 15px; }
@media (max-width: 760px) { .scene3d-toolbar { gap: 8px; } .scene3d-stage { min-height: 300px; } .scene3d-frame { width: 90%; } }
</style>

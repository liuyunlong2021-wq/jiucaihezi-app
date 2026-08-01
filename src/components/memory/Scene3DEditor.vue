<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { parseScene3DDocument, type Scene3DCamera, type Scene3DDocument, type Scene3DFormation, type Scene3DObject } from '@/runtime/memory/scene3d'

const props = defineProps<{ document: Scene3DDocument }>()
const emit = defineEmits<{ save: [document: Scene3DDocument]; screenshot: [blob: Blob, title: string] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const labelsVisible = ref(true)
const selectedId = ref('')
const cameraName = ref('')
const renderRevision = ref(0)
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
let raycaster: THREE.Raycaster | null = null
const selectable = new Map<string, THREE.Object3D>()

const currentAspect = computed(() => { renderRevision.value; return document.canvas.aspect })
const savedCameras = computed(() => { renderRevision.value; return document.savedCameras })
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

function makePerson(color: string, pose = 'standing'): THREE.Group {
  const person = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.68, 4, 8), material(color))
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), material('#f4f4ee'))
  const direction = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 4), material(color))
  body.position.y = 0.7
  head.position.y = 1.35
  direction.position.set(0, 0.18, 0.38)
  direction.rotation.x = Math.PI / 2
  if (pose === 'sitting') { body.position.set(0, 0.55, -0.14); body.rotation.x = Math.PI / 2; head.position.set(0, 0.88, -0.42) }
  if (pose === 'crouching') { body.position.y = 0.45; head.position.y = 0.85 }
  if (pose === 'lying') { body.position.set(0, 0.27, 0); body.rotation.z = Math.PI / 2; head.position.set(0.52, 0.27, 0) }
  person.add(body, head, direction)
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
  if (root) scene.remove(root)
  root = new THREE.Group()
  selectable.clear()
  const nodes = new Map<string, THREE.Object3D>()
  for (const item of document.objects) {
    const node = makePrimitive(item)
    node.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
    node.position.copy(vector(item.position)); node.rotation.set(...(item.rotation || [0, 0, 0]))
    addLabel(node, item.label || '', item.color || '#ffffff', item.type === 'person' ? 1.8 : (item.size?.[1] || 1) + .45)
    setSelectable(node, item.id, 'object'); nodes.set(item.id, node); root.add(node)
  }
  for (const item of document.formations) {
    const node = makeFormation(item)
    node.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
    node.position.copy(vector(item.position))
    addLabel(node, item.label || '', item.color || '#ffffff', 1.8)
    setSelectable(node, item.id, 'formation'); nodes.set(item.id, node); root.add(node)
  }
  for (const groupData of document.groups) {
    const group = new THREE.Group(); group.position.copy(vector(groupData.position || [0, 0, 0]))
    groupData.memberIds.forEach(memberId => {
      const node = nodes.get(memberId)
      if (node) { node.traverse(child => { child.userData.sceneSelection = { id: groupData.id, kind: 'group' } }); group.add(node) }
    })
    addLabel(group, groupData.label || '', '#ffffff', 2.2)
    group.userData.sceneSelection = { id: groupData.id, kind: 'group' }
    for (const memberId of groupData.memberIds) selectable.delete(memberId)
    selectable.set(groupData.id, group)
    root.add(group)
  }
  scene.add(root)
  attachSelection(selectedId.value)
}

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
    if (!event.value) persistSelection()
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
  transform?.detach()
  const target = selectable.get(id)
  if (target) transform?.attach(target)
}

function pick(event: PointerEvent) {
  if (!canvas.value || !camera || !root || !raycaster || transform?.dragging) return
  const rect = canvas.value.getBoundingClientRect()
  const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, activeCamera())
  const hit = raycaster.intersectObjects(root.children, true)[0]
  let node: THREE.Object3D | null = hit?.object || null
  while (node && !node.userData.sceneSelection) node = node.parent
  if (node?.userData.sceneSelection) attachSelection(node.userData.sceneSelection.id)
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
    if (item) item.position = tuple(target.position)
  }
  persist()
}

function persist() { renderRevision.value++; emit('save', structuredClone(document)) }

function saveCamera() {
  const name = `机位 ${document.savedCameras.length + 1}`
  const current = camera as THREE.Camera
  const target = orbit?.target || vector(document.camera.target)
  document.savedCameras.push({ ...structuredClone(document.camera), name, position: tuple(current.position), target: tuple(target), aspect: document.canvas.aspect })
  persist()
}

function useSavedCamera(item: Scene3DCamera) { cameraName.value = item.name || ''; applyCamera(item); persist() }
function removeSavedCamera(index: number) { document.savedCameras.splice(index, 1); persist() }

async function capture() {
  if (!renderer || !canvas.value) return
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

function resize() {
  if (!renderer || !canvas.value || !camera) return
  const width = Math.max(canvas.value.clientWidth, 1); const height = Math.max(canvas.value.clientHeight, 1)
  renderer.setSize(width, height, false)
  const ratio = width / height
  if (perspective && camera === perspective) { perspective.aspect = ratio; perspective.updateProjectionMatrix() }
  if (orthographic && camera === orthographic) { const size = 18; orthographic.left = -size * ratio / 2; orthographic.right = size * ratio / 2; orthographic.top = size / 2; orthographic.bottom = -size / 2; orthographic.updateProjectionMatrix() }
}

function render() { animationFrame = requestAnimationFrame(render); orbit?.update(); if (scene && camera) renderer?.render(scene, activeCamera()) }

onMounted(() => {
  if (!canvas.value) return
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x15201c)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = document.lighting.shadows
  raycaster = new THREE.Raycaster()
  updateLights(); updateGrid(); buildScene(); createCameraControls()
  canvas.value.addEventListener('pointerup', pick)
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas.value); render()
})

watch(() => props.document, value => {
  document = parseScene3DDocument(value); renderRevision.value++; buildScene(); createCameraControls()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame); resizeObserver?.disconnect(); canvas.value?.removeEventListener('pointerup', pick)
  orbit?.dispose(); transform?.dispose(); renderer?.dispose(); root?.traverse(node => {
    const mesh = node as THREE.Mesh
    mesh.geometry?.dispose?.()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach(item => item?.dispose?.())
  })
})
</script>

<template>
  <section class="scene3d-editor">
    <header class="scene3d-toolbar">
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
        <button :class="{ active: document.canvas.snap }" title="开启或关闭网格吸附" @click="toggleSnap"><JcIcon name="magnet-on" /></button>
        <button :class="{ active: labelsVisible }" title="显示或隐藏标签" @click="toggleLabels"><JcIcon name="label" /></button>
        <button v-for="direction in ['left', 'right', 'front', 'back', 'top']" :key="direction" :class="{ active: document.lighting.direction === direction }" :title="`${({ left: '左侧', right: '右侧', front: '正面', back: '背面', top: '顶部' } as Record<string, string>)[direction]}来光`" @click="setLighting(direction as Scene3DDocument['lighting']['direction'])"><JcIcon name="light-mode" /></button>
        <button v-for="intensity in ['low', 'medium', 'high']" :key="intensity" :class="{ active: document.lighting.intensity === intensity }" :title="`${({ low: '低', medium: '中', high: '高' } as Record<string, string>)[intensity]}亮度`" @click="setLightIntensity(intensity as Scene3DDocument['lighting']['intensity'])">{{ intensity[0].toUpperCase() }}</button>
        <button :class="{ active: document.lighting.shadows }" title="开启或关闭阴影" @click="toggleShadows"><JcIcon name="contrast" /></button>
        <span class="scene3d-divider"></span>
        <button title="保存当前机位" @click="saveCamera"><JcIcon name="bookmark-add" /></button>
        <button class="primary" title="截图保存到图片" @click="capture"><JcIcon name="photo-camera" /></button>
      </div>
    </header>
    <div class="scene3d-stage" :style="{ '--scene-aspect': String(aspectRatio(currentAspect)) }">
      <canvas ref="canvas" aria-label="3D 白膜场景"></canvas>
      <div class="scene3d-frame"></div>
      <p v-if="!selectedId" class="scene3d-hint">点击人物、物体或队伍后拖动调整位置</p>
    </div>
    <footer class="scene3d-cameras">
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
.scene3d-toolbar { display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 6px 10px; border-bottom: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-toolbar strong { flex: 0 0 auto; font-size: 14px; }
.scene3d-tools { display: flex; align-items: center; gap: 3px; }
.scene3d-tools button, .scene3d-cameras button { min-width: 30px; height: 30px; border: 1px solid transparent; color: #dce8e1; background: transparent; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px; }
.scene3d-tools button:hover, .scene3d-tools button.active { background: rgba(222, 243, 229, .14); border-color: rgba(222, 243, 229, .2); }
.scene3d-tools button.primary { background: #86c8a5; color: #122018; }
.scene3d-tools .mso { font-size: 18px; }
.scene3d-divider { width: 1px; height: 22px; background: rgba(216, 235, 223, .16); margin: 0 3px; }
.scene3d-stage { position: relative; min-height: 320px; overflow: hidden; }
.scene3d-stage canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.scene3d-frame { position: absolute; inset: 50% auto auto 50%; width: min(86%, calc(72vh * var(--scene-aspect))); aspect-ratio: var(--scene-aspect); transform: translate(-50%, -50%); border: 1px solid rgba(235, 248, 240, .42); pointer-events: none; }
.scene3d-hint { position: absolute; left: 12px; bottom: 10px; margin: 0; padding: 6px 8px; color: #dce8e1; background: rgba(10, 17, 14, .72); border-radius: 4px; font-size: 12px; pointer-events: none; }
.scene3d-cameras { display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 5px 10px; border-top: 1px solid rgba(216, 235, 223, .12); overflow-x: auto; }
.scene3d-cameras > span { color: #aebcb5; font-size: 12px; }
.scene3d-cameras > button { flex: 0 0 auto; padding: 0 8px; border-color: rgba(216, 235, 223, .18); }
.scene3d-cameras > button:hover { background: rgba(222, 243, 229, .14); }
.scene3d-camera-chip { display: flex; align-items: center; border: 1px solid rgba(216, 235, 223, .18); border-radius: 4px; }
.scene3d-camera-chip button:first-child { padding: 0 8px; min-width: auto; }
.scene3d-camera-chip button:last-child { min-width: 24px; width: 24px; }
.scene3d-camera-chip .mso { font-size: 15px; }
@media (max-width: 760px) { .scene3d-toolbar { gap: 8px; } .scene3d-stage { min-height: 300px; } .scene3d-frame { width: 90%; } }
</style>

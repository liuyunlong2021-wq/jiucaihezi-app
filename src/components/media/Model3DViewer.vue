<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const props = defineProps<{ url?: string; data?: ArrayBuffer | null }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const error = ref('')
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let model: THREE.Object3D | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let loadId = 0

function disposeModel(root: THREE.Object3D | null) {
  root?.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

function resize() {
  if (!canvas.value || !renderer || !camera) return
  const width = Math.max(canvas.value.clientWidth, 1)
  const height = Math.max(canvas.value.clientHeight, 1)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function frameModel(root: THREE.Object3D) {
  if (!camera || !controls) return
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 0.1) / 2
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.5
  camera.position.set(center.x + distance * 0.75, center.y + distance * 0.45, center.z + distance)
  camera.near = Math.max(distance / 100, 0.001)
  camera.far = Math.max(distance * 100, 100)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.minDistance = radius * 0.25
  controls.maxDistance = distance * 8
  controls.update()
}

function loadModel() {
  const currentLoad = ++loadId
  loading.value = true
  error.value = ''
  if (model && scene) scene.remove(model)
  disposeModel(model)
  model = null
  if ((!props.data && !props.url) || !scene) return
  const onLoad = (gltf: { scene: THREE.Group }) => {
    if (currentLoad !== loadId || !scene) {
      disposeModel(gltf.scene)
      return
    }
    model = gltf.scene
    scene.add(model)
    frameModel(model)
    loading.value = false
  }
  const onError = (cause: unknown) => {
    if (currentLoad !== loadId) return
    console.warn('[Model3DViewer] load failed', cause)
    loading.value = false
    error.value = '3D 模型预览失败'
  }
  const loader = new GLTFLoader()
  if (props.data) loader.parse(props.data, '', onLoad, onError)
  else loader.load(props.url!, onLoad, undefined, onError)
}

onMounted(() => {
  if (!canvas.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111715)
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.5 : 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  controls = new OrbitControls(camera, canvas.value)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  scene.add(new THREE.HemisphereLight(0xffffff, 0x33443d, 2.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 3)
  keyLight.position.set(4, 6, 5)
  scene.add(keyLight)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas.value)
  resize()
  loadModel()
  const render = () => {
    animationFrame = requestAnimationFrame(render)
    controls?.update()
    if (scene && camera) renderer?.render(scene, camera)
  }
  render()
})

watch(() => [props.url, props.data] as const, () => {
  if (scene) loadModel()
})

onBeforeUnmount(() => {
  loadId++
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  controls?.dispose()
  disposeModel(model)
  renderer?.dispose()
})
</script>

<template>
  <div class="model-viewer" :class="{ ready: !loading && !error }">
    <canvas ref="canvas" aria-label="3D 模型预览"></canvas>
    <div v-if="loading" class="model-state">正在加载 3D 模型</div>
    <div v-else-if="error" class="model-state error">{{ error }}</div>
  </div>
</template>

<style scoped>
.model-viewer { position: relative; width: min(92vw, 1100px); height: min(72vh, 760px); min-height: 320px; overflow: hidden; background: #111715; }
.model-viewer canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.model-state { position: absolute; inset: 0; display: grid; place-items: center; color: #f5f7f6; background: #111715; font-size: 15px; }
.model-state.error { color: #ffb5ac; }
@media (max-width: 760px) {
  .model-viewer { width: 100%; max-width: 100%; height: 68vh; min-height: 300px; }
}
</style>

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { frameScene3DBounds, lookScene3DCamera, moveScene3DCamera } from '../scene3dNavigation'

test('focus fits all bounds inside both landscape and portrait frames', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -10), new THREE.Vector3(2, 3, 10))
  for (const aspect of [16 / 9, 9 / 16]) {
    const shot = frameScene3DBounds(bounds, new THREE.Vector3(1, 1, 1), 40, aspect)!
    const camera = new THREE.PerspectiveCamera(40, aspect, .01, 1000)
    camera.position.copy(shot.position); camera.lookAt(shot.target); camera.updateMatrixWorld()
    for (const x of [-2, 2]) for (const y of [0, 3]) for (const z of [-10, 10]) {
      const point = new THREE.Vector3(x, y, z).project(camera)
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1)
    }
  }
  assert.equal(frameScene3DBounds(new THREE.Box3(), new THREE.Vector3(), 40, 1), null)
  const point = frameScene3DBounds(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()), new THREE.Vector3(), 40, 1)!
  assert.ok(Number.isFinite(point.position.length()) && point.position.length() > 0)
})

test('roaming crosses the old orbit target without slowing down or changing direction', () => {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 1, 1)
  const target = new THREE.Vector3(0, 1, 0)
  camera.lookAt(target)
  for (let i = 0; i < 120; i++) moveScene3DCamera(camera, target, new Set(['KeyW']), 1 / 60, 2)
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0, 1, -3)) < 1e-6)
  assert.ok(target.distanceTo(new THREE.Vector3(0, 1, -4)) < 1e-6)
})

test('roam speed is frame independent, diagonal normalized, and Shift accelerates', () => {
  function distance(keys: string[], fps: number) {
    const camera = new THREE.PerspectiveCamera()
    const target = new THREE.Vector3(0, 0, -1)
    for (let i = 0; i < fps; i++) moveScene3DCamera(camera, target, new Set(keys), 1 / fps, 2)
    return camera.position.length()
  }
  assert.ok(Math.abs(distance(['KeyW'], 30) - distance(['KeyW', 'KeyD'], 60)) < 1e-6)
  assert.ok(Math.abs(distance(['KeyW', 'ShiftLeft'], 60) - 8) < 1e-6)
  assert.equal(distance(['KeyW', 'KeyS'], 60), 0)
  assert.equal(distance([], 60), 0)
  assert.ok(Math.abs(distance(['KeyE'], 60) - 2) < 1e-6)
})

test('right drag looks from the same position, retains target distance and clamps pitch', () => {
  const camera = new THREE.PerspectiveCamera()
  const target = new THREE.Vector3(0, 0, -5)
  lookScene3DCamera(camera, target, 100, 100000)
  assert.equal(camera.position.length(), 0)
  assert.ok(Math.abs(target.length() - 5) < 1e-6)
  const forward = camera.getWorldDirection(new THREE.Vector3())
  assert.ok(Math.abs(forward.y) < 1)
  assert.ok(forward.distanceTo(target.clone().normalize()) < 1e-6)
})

function editorNavigationFixture() {
  const source = readFileSync('src/components/memory/Scene3DEditor.vue', 'utf8')
  const body = source.slice(source.indexOf('function releaseRoam()'), source.indexOf('function createCameraControls()'))
  const { transformSync } = createRequire(join(process.cwd(), 'package.json'))('esbuild')
  const camera = new THREE.PerspectiveCamera()
  const root = new THREE.Group()
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1))
  root.add(object)
  const captured = new Set<number>()
  let saves = 0
  let shots = 0
  let clock = 0
  const dependencies = {
    THREE, props: { readOnly: false }, playing: { value: false }, manualRecording: { value: false },
    roamMode: { value: false }, frameMode: { value: false }, roamSpeed: { value: 2 }, roamKeys: new Set<string>(),
    canvas: { value: { focus() {}, setPointerCapture: (id: number) => captured.add(id), hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => captured.delete(id) } },
    camera, orbit: { target: new THREE.Vector3(0, 0, -1), enableDamping: true, enabled: true, update() {} },
    transform: { enabled: true }, transformHelper: { visible: true }, contextMenu: { value: { show: false } },
    syncCameraState: () => { saves++ }, applyFrameMode() {},
    root, selectable: new Map([['box', object]]), selectedId: { value: 'box' },
    document: { canvas: { aspect: '16:9' } }, frameFov: () => 40, aspectRatio: () => 16 / 9,
    frameScene3DBounds, lookScene3DCamera, showNotice() {},
    applyShot: () => { shots++ }, sceneHitId: () => 'box', attachSelection() {},
    performance: { now: () => clock }, requestAnimationFrame: () => 0, renderer: null, scene: null, moveScene3DCamera,
  }
  const render = source.slice(source.indexOf('function render()'), source.indexOf('async function recordVideo('))
  const code = transformSync(body + render, { loader: 'ts', target: 'es2022' }).code
  const handlers = new Function(...Object.keys(dependencies), `let roamPointer = null; let animationFrame = 0; let lastRenderTime = 0; let doubleClickTarget = ''; ${code}; return { render, toggleRoam, startRoam, dragRoam, endRoam, stopRoam, releaseRoam, handleRoamWheel, handleNavigationKeydown, handleNavigationKeyup, focusScene, focusAtPointer, rememberFocusTarget }`)(...Object.values(dependencies))
  const pointer = { pointerId: 1, button: 2, buttons: 2, clientX: 10, clientY: 10, shiftKey: false, preventDefault() {} }
  const key = (code: string, modifiers = {}) => ({ code, preventDefault() {}, ...modifiers })
  return { ...dependencies, handlers, pointer, key, captured, saves: () => saves, shots: () => shots, source, tick: () => { clock += 1000 / 60; handlers.render() } }
}

test('the real render loop moves only while right mouse is held and does not save each frame', () => {
  const f = editorNavigationFixture()
  f.handlers.toggleRoam()
  f.handlers.handleNavigationKeydown(f.key('KeyW'))
  f.tick()
  assert.equal(f.camera.position.length(), 0)
  f.handlers.startRoam(f.pointer)
  for (let i = 0; i < 60; i++) f.tick()
  assert.ok(Math.abs(f.camera.position.z + 2) < 1e-6)
  assert.equal(f.saves(), 0)
  f.handlers.endRoam(f.pointer)
  const position = f.camera.position.clone()
  for (let i = 0; i < 60; i++) f.tick()
  assert.deepEqual(f.camera.position, position)
  assert.equal(f.saves(), 1)
})

test('editor roaming saves once on release, restores object editing, and cancels safely', () => {
  const f = editorNavigationFixture()
  f.handlers.toggleRoam()
  assert.equal(f.roamMode.value, true)
  assert.equal(f.transform.enabled, false)
  f.handlers.startRoam(f.pointer)
  f.handlers.handleNavigationKeydown(f.key('KeyW'))
  assert.equal(f.roamKeys.has('KeyW'), true)
  assert.equal(f.saves(), 0)
  f.handlers.endRoam(f.pointer)
  assert.equal(f.roamKeys.size, 0)
  assert.equal(f.captured.size, 0)
  assert.equal(f.saves(), 1)
  f.handlers.stopRoam()
  assert.equal(f.saves(), 1)
  f.handlers.toggleRoam()
  assert.equal(f.transform.enabled, true)
  assert.equal(f.transformHelper.visible, true)
})

test('roam speed is bounded, modified keys do not move, and right release stops looking', () => {
  const f = editorNavigationFixture()
  f.handlers.toggleRoam(); f.handlers.startRoam(f.pointer)
  f.handlers.handleRoamWheel({ deltaY: -100000, preventDefault() {} })
  assert.equal(f.roamSpeed.value, 20)
  f.handlers.handleRoamWheel({ deltaY: 100000, preventDefault() {} })
  assert.equal(f.roamSpeed.value, .1)
  f.handlers.handleNavigationKeydown(f.key('KeyW', { ctrlKey: true }))
  assert.equal(f.roamKeys.size, 0)
  f.handlers.dragRoam({ ...f.pointer, buttons: 0 })
  assert.equal(f.captured.size, 0)
  assert.equal(f.saves(), 1)
})

test('playback and Agent read-only lock block navigation; replacing a scene cannot save the old camera', () => {
  const f = editorNavigationFixture()
  f.props.readOnly = true
  f.handlers.toggleRoam(); f.handlers.focusScene('box'); f.handlers.focusAtPointer(f.pointer)
  assert.equal(f.roamMode.value, false)
  assert.equal(f.shots(), 0)
  f.props.readOnly = false; f.playing.value = true
  f.handlers.toggleRoam(); f.handlers.focusScene('box')
  assert.equal(f.roamMode.value, false)
  assert.equal(f.shots(), 0)
  f.playing.value = false
  f.handlers.toggleRoam(); f.handlers.startRoam(f.pointer)
  f.handlers.releaseRoam()
  assert.equal(f.captured.size, 0)
  assert.equal(f.saves(), 0)
  assert.match(f.source, /watch\(\(\) => props\.document, value => \{\s*releaseRoam\(\)/)
  assert.match(f.source, /@keydown="handleNavigationKeydown"/)
  assert.doesNotMatch(f.source, /window\.addEventListener\('keydown', handleNavigationKeydown\)/)
})

test('F and double-click focus the selected object; full scene focuses without selection', () => {
  const f = editorNavigationFixture()
  f.handlers.handleNavigationKeydown(f.key('KeyF'))
  f.handlers.focusAtPointer(f.pointer)
  f.handlers.focusScene()
  assert.equal(f.shots(), 3)
})

test('double-click keeps the first selected target when the inspector changes the canvas width', () => {
  const f = editorNavigationFixture()
  f.handlers.rememberFocusTarget({ detail: 1 })
  f.selectedId.value = 'floor'
  f.handlers.rememberFocusTarget({ detail: 2 })
  f.handlers.focusAtPointer(f.pointer)
  assert.equal(f.shots(), 1)
})

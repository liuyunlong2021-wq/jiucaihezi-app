import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { reactive } from 'vue'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Bone, BoxGeometry, Euler, Group, Mesh, Quaternion } from 'three'
import { appendScene3DHistory } from '../scene3dHost'
import { alignRenderedCharacterToSeat } from '../scene3dSeating'
import { applyStoryboarderCharacterState, STORYBOARDER_POSES } from '../storyboarderAssets'

import { applyCameraPoints, applyScene3DEdits, cameraPointsFromDocument, createScene3DDocument, evaluateScene3DAnimation, parseScene3DDocument, parseScene3DResultMarkers, scene3DResultMarker, stripScene3DResultMarkers } from '../scene3d'

test('scene3d normalizes reusable primitives, formations and cameras', () => {
  const scene = createScene3DDocument({
    title: '宫殿排位',
    objects: [{ id: 'emperor', type: 'person', label: '皇帝', position: [0, 0, -5], color: '#d9aa35' }],
    formations: [{ id: 'ministers', type: 'grid', count: 20, rows: 2, columns: 10, position: [0, 0, 0] }],
    groups: [], savedCameras: [{ name: '俯拍', position: [0, 20, 0], target: [0, 0, 0], projection: 'orthographic' }],
  })

  assert.equal(scene.version, 1)
  assert.equal(scene.objects[0].pose, 'standing')
  assert.equal(scene.formations[0].count, 20)
  assert.equal(scene.savedCameras[0].name, '俯拍')
})

test('scene3d rejects unsupported shapes, runaway counts and missing group members', () => {
  assert.throws(() => createScene3DDocument({ title: '错', objects: [{ id: 'bad', type: 'dragon', position: [0, 0, 0] }] }), /积木类型/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [], formations: [{ id: 'army', type: 'grid', count: 10_001, position: [0, 0, 0] }] }), /场景数值/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [], groups: [{ id: 'group', memberIds: ['missing'] }] }), /分组成员/)
  assert.throws(() => parseScene3DDocument({ version: 2, title: '未来场景' }), /不支持/)
  assert.throws(() => parseScene3DDocument(null), /必须是对象/)
})

test('scene3d parser removes nested Vue proxies before the editor receives data', () => {
  const scene = parseScene3DDocument(reactive({
    title: '可打开场景',
    objects: [{ id: 'person', type: 'person', position: [0, 0, 0], character: { model: 'adult-male', bones: { Head: [0, 0, 0, 1] } } }],
  }))
  assert.doesNotThrow(() => structuredClone(scene))
})

test('scene3d accepts only the five Storyboarder character models and preserves old people', () => {
  for (const model of ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child']) {
    const scene = createScene3DDocument({ title: model, objects: [{ id: 'actor', type: 'person', position: [0, 0, 0], character: { model } }] })
    assert.equal(scene.objects[0].character?.model, model)
    assert.equal(scene.objects[0].character?.scale, 1)
  }
  assert.equal(createScene3DDocument({ title: '旧场景', objects: [{ id: 'actor', type: 'person', position: [0, 0, 0] }] }).objects[0].character, undefined)
  for (const model of ['baby', 'https://example.com/person.glb', '/tmp/person.glb']) {
    assert.throws(() => createScene3DDocument({ title: '非法人物', objects: [{ id: 'actor', type: 'person', position: [0, 0, 0], character: { model } }] }), /允许清单/)
  }
})

test('scene3d validates and restores Storyboarder bone poses', () => {
  const bones = { Head: [0, 0.3826834, 0, 0.9238795], RightArm: [0.1, 0.2, 0.3, 0.9] }
  const scene = createScene3DDocument({ title: '指尖前景', objects: [{
    id: 'actor', type: 'person', position: [1, 0, 2], rotation: [0, 1, 0],
    character: { model: 'adult-male', scale: 1.1, bones },
  }] })
  assert.deepEqual(parseScene3DDocument(JSON.parse(JSON.stringify(scene))).objects[0].character, {
    model: 'adult-male', scale: 1.1, bones,
  })
  assert.throws(() => createScene3DDocument({ title: '错', objects: [{ id: 'actor', type: 'person', position: [0, 0, 0], character: { model: 'adult-male', bones: { Head: [0, 0, 0] } } }] }), /四元数/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [{ id: 'actor', type: 'person', position: [0, 0, 0], character: { model: 'adult-male', bones: { UnknownBone: [0, 0, 0, 1] } } }] }), /骨骼/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [{ id: 'box', type: 'box', position: [0, 0, 0], character: { model: 'adult-male' } }] }), /只允许人物/)
})

test('scene3d rejects unsafe Storyboarder bone quaternions', () => {
  const scene = (quaternion: unknown) => createScene3DDocument({
    title: '非法四元数',
    objects: [{ id: 'actor', type: 'person', position: [0, 0, 0], character: { model: 'adult-male', bones: { Head: quaternion } } }],
  })

  for (const value of [
    [0, 0, 0, 0],
    [1e200, 0, 0, 0],
    [true, false, null, '1'],
    [Number.NaN, 0, 0, 1],
    [Number.POSITIVE_INFINITY, 0, 0, 1],
  ]) assert.throws(() => scene(value), /四元数/)

  assert.deepEqual(scene([0, 0, 0, 1]).objects[0].character?.bones?.Head, [0, 0, 0, 1])
})

test('Storyboarder character assets match the locked upstream manifest', () => {
  const manifest = JSON.parse(readFileSync('src-tauri/resources/storyboarder/manifest.json', 'utf8')) as { commit: string; authorization: string; assets: Array<{ path: string; sha256: string; bytes: number }> }
  assert.equal(manifest.commit, '8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2')
  assert.match(manifest.authorization, /email/i)
  assert.equal(manifest.assets.length, 7)
  for (const asset of manifest.assets) {
    const path = asset.path.startsWith('src/') ? asset.path : `src-tauri/resources/storyboarder/${asset.path}`
    const bytes = readFileSync(path)
    assert.equal(bytes.length, asset.bytes, path)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, path)
  }
})

test('the five Storyboarder characters share one editable skeleton contract', () => {
  const skeletons = ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child'].map(model => {
    const bytes = readFileSync(`src-tauri/resources/storyboarder/models/${model}.glb`)
    const jsonLength = bytes.readUInt32LE(12)
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString().replace(/\0+$/, '')) as { nodes: Array<{ name?: string }>; skins: Array<{ joints: number[] }> }
    const names = gltf.skins[0].joints.map(index => gltf.nodes[index].name || '').filter(name => name && !name.startsWith('leaf'))
    assert.equal(gltf.skins[0].joints.length, 67)
    assert.equal(names.length, 54)
    return names.sort()
  })
  skeletons.slice(1).forEach(names => assert.deepEqual(names, skeletons[0]))
})

test('scene3d result markers survive Raw while remaining hidden from display text', () => {
  const marker = scene3DResultMarker({ path: '.raw/jc-media/文档/宫殿.jcscene', title: '宫殿', objectCount: 1, formationCount: 2 })
  const content = `已经创建。\n\n${marker}`
  assert.deepEqual(parseScene3DResultMarkers(content), [{ path: '.raw/jc-media/文档/宫殿.jcscene', title: '宫殿', objectCount: 1, formationCount: 2 }])
  assert.equal(stripScene3DResultMarkers(content), '已经创建。')
})

test('scene3d animation evaluates the same timeline deterministically', () => {
  const scene = createScene3DDocument({
    title: '选矿', duration: 5,
    objects: [{ id: 'ore', type: 'box', position: [0, 0, 0], color: '#777777' }],
    timeline: [
      { at: 0, target: 'scene', action: 'label', text: '破碎' },
      { at: 1, duration: 2, target: 'ore', action: 'move', to: [4, 0, 0], easing: 'ease-in-out' },
      { at: 3, target: 'ore', action: 'color', color: '#cc3300' },
      { at: 4, target: 'ore', action: 'hide' },
    ],
  })
  assert.deepEqual(evaluateScene3DAnimation(scene, 2).targets.ore.position, [2, 0, 0])
  assert.equal(evaluateScene3DAnimation(scene, 3).targets.ore.color, '#cc3300')
  assert.equal(evaluateScene3DAnimation(scene, 4).targets.ore.visible, false)
  assert.equal(evaluateScene3DAnimation(scene, 2).label, '破碎')
  assert.throws(() => createScene3DDocument({ title: '错', duration: 2, objects: [], timeline: [{ at: 1, target: 'missing', action: 'show' }] }), /动画目标不存在/)
})

test('scene3d camera timeline supports hard cuts and continuous camera moves', () => {
  const scene = createScene3DDocument({
    title: '分段镜头', duration: 5, objects: [], camera: { position: [0, 4, 12], target: [0, 1, 0] },
    timeline: [
      { at: 0, target: 'camera', action: 'camera', to: [10, 5, 8], lookAt: [4, 1, 0] },
      { at: 2, duration: 2, target: 'camera', action: 'camera', to: [6, 3, 4], lookAt: [6, 1, 0] },
    ],
  })

  assert.deepEqual(evaluateScene3DAnimation(scene, 0).camera, { position: [10, 5, 8], target: [4, 1, 0], focal: 50 })
  assert.deepEqual(evaluateScene3DAnimation(scene, 3).camera, { position: [8, 4, 6], target: [5, 1, 0], focal: 50 })
  assert.deepEqual(evaluateScene3DAnimation(scene, 4).camera, { position: [6, 3, 4], target: [6, 1, 0], focal: 50 })
})

test('scene3d camera points round-trip through the timeline with hold, travel and focal', () => {
  const points = [
    { position: [0, 2, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number], focal: 24, hold: 1, travel: 0 },
    { position: [4, 2, 6] as [number, number, number], target: [4, 1, 0] as [number, number, number], focal: 50, hold: 0, travel: 3 },
    { position: [4, 2, 2] as [number, number, number], target: [4, 1, 0] as [number, number, number], focal: 135, hold: 1, travel: 3 },
  ]
  const scene = applyCameraPoints(createScene3DDocument({ title: '运镜', objects: [] }), points)

  assert.equal(scene.duration, 8)
  assert.deepEqual(cameraPointsFromDocument(scene).map(point => [point.hold, point.travel, point.focal]), [[1, 0, 24], [0, 3, 50], [1, 3, 135]])
  // 硬切到起点 → 停 1 秒 → 推 3 秒 → 停 1 秒
  assert.deepEqual(evaluateScene3DAnimation(scene, 0).camera.position, [0, 2, 6])
  assert.deepEqual(evaluateScene3DAnimation(scene, 1).camera.position, [0, 2, 6])
  assert.deepEqual(evaluateScene3DAnimation(scene, 4).camera.position, [4, 2, 6])
  assert.deepEqual(evaluateScene3DAnimation(scene, 7).camera.position, [4, 2, 2])
  assert.deepEqual(evaluateScene3DAnimation(scene, 8).camera.position, [4, 2, 2])
  // 焦段跟着点位插值：2.5 秒正好在 24mm 与 50mm 中间
  assert.equal(evaluateScene3DAnimation(scene, 2.5).camera.focal, 37)
  assert.equal(evaluateScene3DAnimation(scene, 7).camera.focal, 135)
})

test('scene3d camera points keep object animation and never outlive the longest animation', () => {
  const source = createScene3DDocument({
    title: '混合', duration: 6, objects: [{ id: 'ore', type: 'box', position: [0, 0, 0] }],
    timeline: [{ at: 4, duration: 2, target: 'ore', action: 'move', to: [2, 0, 0] }],
  })
  const withPoint = applyCameraPoints(source, [{ position: [0, 2, 6], target: [0, 1, 0], focal: 50, hold: 0, travel: 0 }])

  assert.equal(withPoint.timeline.length, 2)
  assert.equal(withPoint.timeline.some(entry => entry.target === 'ore'), true)
  assert.equal(withPoint.duration, 6)

  const cleared = applyCameraPoints(withPoint, [])
  assert.equal(cleared.timeline.length, 1)
  assert.equal(cleared.duration, 6)

  const staticScene = applyCameraPoints(createScene3DDocument({ title: '静态', objects: [] }), [])
  assert.equal(staticScene.timeline, undefined)
  assert.equal(staticScene.duration, undefined)
})

test('scene3d cameras carry an equivalent focal length and read legacy lens names', () => {
  const scene = createScene3DDocument({ title: '焦段', objects: [], camera: { position: [0, 2, 6], target: [0, 1, 0], focal: 135 } })
  assert.equal(scene.camera.focal, 135)
  assert.equal(parseScene3DDocument(JSON.parse(JSON.stringify(scene))).camera.focal, 135)
  assert.equal(parseScene3DDocument({ title: '旧场景', objects: [], camera: { lens: 'wide' } }).camera.focal, 24)
  assert.equal(parseScene3DDocument({ title: '旧场景', objects: [], camera: { lens: 'telephoto' } }).camera.focal, 135)
  assert.equal(parseScene3DDocument({ title: '没写镜头', objects: [] }).camera.focal, 50)
  assert.equal(parseScene3DDocument({ title: '新旧都有', objects: [], camera: { lens: 'wide', focal: 85 } }).camera.focal, 85)
  assert.equal(createScene3DDocument({ title: '机位焦段', objects: [], savedCameras: [{ position: [1, 2, 3], target: [0, 1, 0], focal: 24 }] }).savedCameras[0].focal, 24)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [], camera: { focal: 4 } }), /场景数值/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [], camera: { focal: 400 } }), /场景数值/)
  assert.throws(() => createScene3DDocument({ title: '错', objects: [], camera: { lens: 'zoom' } }), /镜头类型无效/)
})

test('scene3d applies atomic object, formation, movement, removal and camera edits', () => {
  const source = createScene3DDocument({
    title: '街道',
    objects: [{ id: 'person', type: 'person', position: [0, 0, 0] }],
    formations: [{ id: 'crowd', type: 'line', count: 5, position: [3, 0, 0] }],
  })
  const result = applyScene3DEdits(source, [
    { action: 'add_object', object: { id: 'tree', type: 'cylinder', position: [5, 0, 2], size: [1, 4, 1] } },
    { action: 'add_formation', formation: { id: 'visitors', type: 'line', count: 2, position: [-3, 0, 0] } },
    { action: 'move', target: 'person', to: [-2, 0, 1] },
    { action: 'remove', target: 'crowd' },
    { action: 'camera', position: [0, 3, 7], lookAt: [0, 1, 0] },
  ])
  assert.deepEqual(result.objects.map(item => item.id), ['person', 'tree'])
  assert.deepEqual(result.objects[0].position, [-2, 0, 1])
  assert.deepEqual(result.formations.map(item => item.id), ['visitors'])
  assert.deepEqual(result.camera.position, [0, 3, 7])
  assert.deepEqual(source.objects[0].position, [0, 0, 0])
})

test('scene3d rejects an invalid edit batch without mutating the source', () => {
  const source = createScene3DDocument({ title: '街道', objects: [{ id: 'person', type: 'person', position: [0, 0, 0] }] })
  assert.throws(() => applyScene3DEdits(source, [
    { action: 'move', target: 'person', to: [1, 0, 0] },
    { action: 'remove', target: 'missing' },
  ]), /目标不存在/)
  assert.deepEqual(source.objects[0].position, [0, 0, 0])
})


test('Agent sitting pose bends the actual skeleton of all five character models', () => {
  const preset = STORYBOARDER_POSES.find(item => item.name === 'sit chair')!
  for (const model of ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child'] as const) {
    const bytes = readFileSync(`src-tauri/resources/storyboarder/models/${model}.glb`)
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString().replace(/\0+$/, ''))
    const root = new Group()
    for (const index of gltf.skins[0].joints) {
      const node = gltf.nodes[index]
      const bone = new Bone()
      bone.name = node.name
      bone.quaternion.fromArray(node.rotation || [0, 0, 0, 1])
      bone.userData.storyboarderBindQuaternion = bone.quaternion.toArray()
      root.add(bone)
    }
    const leg = root.getObjectByName('LeftUpLeg')!
    const before = leg.quaternion.clone()
    applyStoryboarderCharacterState(root, { model, scale: 1 }, 'sitting')
    const rotation = preset.state.skeleton!.LeftUpLeg.rotation!
    const expected = new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z))
    assert.ok(leg.quaternion.angleTo(expected) < 1e-6, model)
    assert.ok(leg.quaternion.angleTo(before) > 0.1, model)
    // Manual bone edits remain authoritative when loading older scene files.
    applyStoryboarderCharacterState(root, { model, scale: 1, bones: { LeftUpLeg: [0, 0, 0, 1] } }, 'sitting')
    assert.deepEqual(leg.quaternion.toArray(), [0, 0, 0, 1])
  }
})

test('incremental pose and rotation edit existing people without replacing scene or retaining old bones', () => {
  const source = createScene3DDocument({ title: '车厢', objects: [
    { id: 'actor', type: 'person', position: [1, 0.5, 2], character: { model: 'adult-male', bones: { LeftUpLeg: [0, 0, 0, 1] } } },
    { id: 'seat', type: 'box', position: [1, 0, 2] },
  ] })
  const next = applyScene3DEdits(source, [
    { action: 'pose', target: 'actor', pose: 'sitting' },
    { action: 'rotate', target: 'seat', to: [0, Math.PI, 0] },
  ])
  assert.equal(next.objects[0].pose, 'sitting')
  assert.equal(next.objects[0].character?.bones, undefined)
  assert.deepEqual(next.objects[0].position, source.objects[0].position)
  assert.deepEqual(next.objects[1].rotation, [0, Math.PI, 0])
  assert.equal(source.objects[0].pose, 'standing')
  assert.ok(source.objects[0].character?.bones)
  for (const operations of [
    [{ action: 'pose', target: 'seat', pose: 'sitting' }],
    [{ action: 'pose', target: 'actor', pose: 'invalid' }],
    [{ action: 'rotate', target: 'missing', to: [0, 0, 0] }],
    [{ action: 'rotate', target: 'seat' }],
    [{ action: 'move', target: 'actor', to: [1, 0, 2], pose: 'sitting' }],
  ]) assert.throws(() => applyScene3DEdits(source, operations))
})


test('Agent snapshots join manual undo history and invalidate redo without duplicate entries', () => {
  const original = createScene3DDocument({ title: 'history', objects: [] })
  const manual = { ...original, title: 'manual' }
  const agent = { ...original, title: 'agent' }
  const history = [original]
  let index = appendScene3DHistory(history, 0, manual)
  index = appendScene3DHistory(history, index, agent)
  assert.equal(history[index - 1].title, 'manual')
  assert.equal(appendScene3DHistory(history, index, agent), index)
  index = appendScene3DHistory(history, index - 1, { ...original, title: 'after undo' })
  assert.deepEqual(history.map(item => item.title), ['history', 'manual', 'after undo'])
  assert.equal(index, 2)
})

test('seating uses the rendered cushion bounds and hip height, preserves groups and rejects tilted seats', () => {
  const source = createScene3DDocument({ title: 'seat', objects: [
    { id: 'actor', type: 'person', position: [0, 0, 0], pose: 'sitting', character: { model: 'adult-male' } },
    { id: 'seat', type: 'box', position: [2, 0.5, 3], size: [1, 0.2, 1] },
  ] })
  const root = new Group()
  const actor = new Group(); actor.name = 'scene-object:actor'
  const body = new Group(); body.name = 'scene-character'
  const hips = new Bone(); hips.name = 'Hips'; hips.position.y = 1
  const spine = new Bone(); spine.name = 'Spine'; spine.position.y = 1.2
  body.add(hips, spine, new Mesh(new BoxGeometry(0.3, 1, 0.3))); actor.add(body)
  const seat = new Mesh(new BoxGeometry(1, 0.2, 1)); seat.name = 'scene-object:seat'; seat.position.set(2, 0.5, 3)
  root.add(actor, seat)
  const result = alignRenderedCharacterToSeat(source, root, 'actor', 'seat')
  assert.deepEqual(result.document.objects[0].position.map(n => Math.round(n * 100)), [200, -30, 300])
  assert.equal(result.report.contactMethod, 'hip-bone-estimate')
  assert.equal(result.report.visualCheckRequired, true)
  assert.deepEqual(source.objects[0].position, [0, 0, 0])
  seat.rotation.x = 0.5
  assert.throws(() => alignRenderedCharacterToSeat(source, root, 'actor', 'seat'), /倾斜/)
  assert.throws(() => alignRenderedCharacterToSeat(source, root, 'actor', 'missing'), /座面/)
})


test('seating measures real skinned geometry for all five shipped models in translated groups', async () => {
  for (const model of ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child'] as const) {
    // Preserve the shipped geometry and skin; omit materials to avoid browser image APIs in Node.
    const loader = new GLTFLoader().register(parser => {
      for (const mesh of parser.json.meshes || []) for (const primitive of mesh.primitives) delete primitive.material
      return { name: 'test-geometry-only' }
    })
    const bytes = readFileSync(`src-tauri/resources/storyboarder/models/${model}.glb`)
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const body = gltf.scene; body.name = 'scene-character'
    body.traverse(node => { if ((node as Bone).isBone) node.userData.storyboarderBindQuaternion = node.quaternion.toArray() })
    applyStoryboarderCharacterState(body, { model, scale: 1 }, 'sitting')
    const root = new Group()
    const group = new Group(); group.position.set(5, 0, 2)
    const actor = new Group(); actor.name = 'scene-object:actor'; actor.add(body); group.add(actor)
    const cushion = new Mesh(new BoxGeometry(0.6, 0.1, 0.6)); cushion.name = 'scene-object:cushion'; cushion.position.set(1, 0.5, 3)
    root.add(group, cushion)
    const source = createScene3DDocument({ title: model, objects: [
      { id: 'actor', type: 'person', position: [0, 0, 0], pose: 'sitting', character: { model } },
      { id: 'cushion', type: 'box', position: [1, 0.5, 3], size: [0.6, 0.1, 0.6] },
    ], groups: [{ id: 'actors', memberIds: ['actor'], position: [5, 0, 2] }] })
    const placed = alignRenderedCharacterToSeat(source, root, 'actor', 'cushion')
    assert.ok(placed.document.objects[0].position.every(Number.isFinite), model)
    assert.ok(Number.isFinite(placed.report.footGap), model)
    assert.ok(Math.abs(placed.document.objects[0].position[0] + 4) < 0.1, model)
    assert.deepEqual(placed.document.groups, source.groups)
  }
})

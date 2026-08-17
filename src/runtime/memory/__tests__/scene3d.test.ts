import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { reactive } from 'vue'

import { applyScene3DEdits, createScene3DDocument, evaluateScene3DAnimation, parseScene3DDocument, parseScene3DResultMarkers, scene3DResultMarker, stripScene3DResultMarkers } from '../scene3d'

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

  assert.deepEqual(evaluateScene3DAnimation(scene, 0).camera, { position: [10, 5, 8], target: [4, 1, 0] })
  assert.deepEqual(evaluateScene3DAnimation(scene, 3).camera, { position: [8, 4, 6], target: [5, 1, 0] })
  assert.deepEqual(evaluateScene3DAnimation(scene, 4).camera, { position: [6, 3, 4], target: [6, 1, 0] })
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

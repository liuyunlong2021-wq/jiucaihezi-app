import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reactive } from 'vue'

import { createScene3DDocument, evaluateScene3DAnimation, parseScene3DDocument, parseScene3DResultMarkers, scene3DResultMarker, stripScene3DResultMarkers } from '../scene3d'

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
  const scene = parseScene3DDocument(reactive({ title: '可打开场景', objects: [{ id: 'person', type: 'person', position: [0, 0, 0] }] }))
  assert.doesNotThrow(() => structuredClone(scene))
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

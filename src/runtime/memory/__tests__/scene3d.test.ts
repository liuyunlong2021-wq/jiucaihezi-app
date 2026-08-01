import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createScene3DDocument, parseScene3DDocument, parseScene3DResultMarkers, scene3DResultMarker, stripScene3DResultMarkers } from '../scene3d'

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

test('scene3d result markers survive Raw while remaining hidden from display text', () => {
  const marker = scene3DResultMarker({ path: '.raw/jc-media/文档/宫殿.jcscene', title: '宫殿', objectCount: 1, formationCount: 2 })
  const content = `已经创建。\n\n${marker}`
  assert.deepEqual(parseScene3DResultMarkers(content), [{ path: '.raw/jc-media/文档/宫殿.jcscene', title: '宫殿', objectCount: 1, formationCount: 2 }])
  assert.equal(stripScene3DResultMarkers(content), '已经创建。')
})

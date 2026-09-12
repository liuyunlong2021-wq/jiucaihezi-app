import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  fileNameTaskSuffix,
  mediaKindOf,
  orderName,
  orderPrefixOf,
  planMediaReorder,
  stripOrderPrefix,
  temporaryReorderName,
  type ReorderResource,
} from '../mediaReorder'

function file(name: string, updatedAt?: number, mimeType?: string): ReorderResource {
  return { path: `第01集/${name}`, name, isDirectory: false, updatedAt, mimeType }
}

function folder(name: string): ReorderResource {
  return { path: `第01集/${name}`, name, isDirectory: true, updatedAt: 0 }
}

function names(plan: ReturnType<typeof planMediaReorder>): string[] {
  return plan.renames.map(rename => `${rename.name} -> ${rename.nextName}`)
}

/** 编号基准名统一为父文件夹名。 */
function plan(input: Omit<Parameters<typeof planMediaReorder>[0], 'baseName'>) {
  return planMediaReorder({ baseName: '第01集', ...input })
}

test('numbered names use the parent folder as the base name and keep the extension', () => {
  assert.equal(orderName(1, '第一集', 'a.png'), '001_第一集.png')
  assert.equal(orderName(7, '第一集', '007_a.png'), '007_第一集.png')
  assert.equal(orderName(42, '第一集', 'prompt_91c8af.png'), '042_第一集.png')
  assert.equal(orderName(1000, '第一集', 'a.png'), '1000_第一集.png')
  assert.equal(orderName(2, '第一集', 'clip.MP4'), '002_第一集.MP4')
  assert.equal(stripOrderPrefix('007_第一集.png'), '第一集.png')
  assert.equal(stripOrderPrefix('a.png'), 'a.png')
  assert.equal(stripOrderPrefix('07_a.png'), '07_a.png')
  assert.equal(orderPrefixOf('007_第一集.png'), 7)
  assert.equal(orderPrefixOf('a.png'), null)
  assert.equal(temporaryReorderName(3, '007_第一集.png'), '__pft_reorder_tmp_003_第一集.png')
})

test('task suffix is read from the trailing underscore segment', () => {
  assert.equal(fileNameTaskSuffix('雨后车站_91C8AF.png'), '91c8af')
  assert.equal(fileNameTaskSuffix('007_雨后车站_91c8af.webp'), '91c8af')
  assert.equal(fileNameTaskSuffix('photo.png'), null)
  assert.equal(fileNameTaskSuffix('a-b-c_12.png'), null)
})

test('media kind comes from extension or mime and excludes other artifacts', () => {
  assert.equal(mediaKindOf('第01集/a.png'), 'image')
  assert.equal(mediaKindOf('第01集/a.MP4'), 'video')
  assert.equal(mediaKindOf('第01集/a.m4a'), 'audio')
  assert.equal(mediaKindOf('第01集/a.bin', 'image/webp'), 'image')
  assert.equal(mediaKindOf('第01集/model.glb'), null)
  assert.equal(mediaKindOf('第01集/note.md'), null)
  assert.equal(mediaKindOf('第01集/scene.jccanvas'), null)
})

test('existing numbering is respected and a second run changes nothing', () => {
  const resources = [file('003_c.png'), file('001_a.png'), file('002_b.png')]
  const first = plan({ resources })
  assert.deepEqual(names(first), [
    '001_a.png -> 001_第01集.png',
    '002_b.png -> 002_第01集.png',
    '003_c.png -> 003_第01集.png',
  ])
  assert.equal(first.numberedCount, 3)
  assert.equal(first.unnumberedCount, 0)

  const rerun = plan({
    resources: first.renames.map(rename => file(rename.nextName)),
  })
  assert.deepEqual(names(rerun), [])
  assert.equal(rerun.unchanged.length, 3)
})

test('unnumbered media is ordered by generation time', () => {
  const resources = [file('b_91c8af.png'), file('a_11aa11.png'), file('c_22bb22.png')]
  const created: Record<string, number> = {
    'b_91c8af.png': 300,
    'a_11aa11.png': 100,
    'c_22bb22.png': 200,
  }
  const result = plan({
    resources,
    createdAtOf: (_path, name) => created[name],
  })
  assert.deepEqual(names(result), [
    'a_11aa11.png -> 001_第01集.png',
    'c_22bb22.png -> 002_第01集.png',
    'b_91c8af.png -> 003_第01集.png',
  ])
  assert.equal(result.fileTimeCount, 0)
})

test('numbered files stay in front and unnumbered ones append by time', () => {
  const resources = [file('newest.png', 900), file('005_late.png'), file('older.png', 100)]
  const result = plan({ resources })
  assert.deepEqual(names(result), [
    '005_late.png -> 001_第01集.png',
    'older.png -> 002_第01集.png',
    'newest.png -> 003_第01集.png',
  ])
  assert.equal(result.numberedCount, 1)
  assert.equal(result.unnumberedCount, 2)
})

test('gaps in existing numbering collapse to a continuous sequence', () => {
  const result = plan({ resources: [file('005_e.png'), file('001_a.png'), file('009_i.png')] })
  assert.deepEqual(names(result), [
    '001_a.png -> 001_第01集.png',
    '005_e.png -> 002_第01集.png',
    '009_i.png -> 003_第01集.png',
  ])
  assert.equal(result.renames.length, 3)
})

test('duplicate existing numbers fall back to a stable name order', () => {
  const result = plan({ resources: [file('001_b.png'), file('001_a.png')] })
  assert.deepEqual(names(result), [
    '001_a.png -> 001_第01集.png',
    '001_b.png -> 002_第01集.png',
  ])
})

test('created mode reorders everything by generation time and ignores numbering', () => {
  const resources = [file('001_b.png'), file('002_a.png')]
  const created: Record<string, number> = { '001_b.png': 500, '002_a.png': 100 }
  const result = plan({
    resources,
    mode: 'created',
    createdAtOf: (_path, name) => created[name],
  })
  assert.deepEqual(names(result), [
    '002_a.png -> 001_第01集.png',
    '001_b.png -> 002_第01集.png',
  ])
})

test('file time is the fallback and a missing time sorts last', () => {
  const resources = [file('no-time.png'), file('stamped.png', 100)]
  const result = plan({ resources })
  assert.deepEqual(names(result), [
    'stamped.png -> 001_第01集.png',
    'no-time.png -> 002_第01集.png',
  ])
  assert.equal(result.fileTimeCount, 1)
})

test('same generation time falls back to file time then name', () => {
  const resources = [file('c.png', 300), file('a.png', 100), file('b.png', 200)]
  const created = { 'a.png': 50, 'b.png': 50, 'c.png': 50 }
  const result = plan({ resources, createdAtOf: (_path, name) => created[name as keyof typeof created] })
  assert.deepEqual(names(result), [
    'a.png -> 001_第01集.png',
    'b.png -> 002_第01集.png',
    'c.png -> 003_第01集.png',
  ])
})

test('directories, non-media files and protected paths stay out of the plan', () => {
  const resources = [
    folder('003_dir.png'),
    file('001_第01集.png'),
    file('002_第01集.png'),
    file('note.md'),
    file('004_第01集.png'),
  ]
  const result = plan({
    resources,
    isProtected: path => path.endsWith('004_第01集.png'),
  })
  assert.deepEqual(result.renames, [])
  assert.deepEqual(result.unchanged.map(entry => entry.name), ['001_第01集.png', '002_第01集.png'])
  assert.equal(result.numberedCount, 2)
})

test('fewer than two media files produces an empty plan', () => {
  assert.deepEqual(plan({ resources: [] }).renames, [])
  assert.deepEqual(plan({ resources: [file('only.png')] }).renames, [])
})

test('swapped names are reported so the caller can stage through temporary names', () => {
  const resources = [file('001_第01集.png', 500), file('002_第01集.png', 100)]
  const result = plan({ resources, mode: 'created' })
  assert.equal(result.conflicts.length, 2)
  assert.equal(result.conflicts[0].nextName, '001_第01集.png')
  assert.equal(result.conflicts[0].holderPath, '第01集/001_第01集.png')
  assert.equal(result.needsTempPass, true)
})

test('non conflicting reorder never asks for a temporary pass', () => {
  const result = plan({ resources: [file('b_91c8af.png', 200), file('a_11aa11.png', 100)] })
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.needsTempPass, false)
})

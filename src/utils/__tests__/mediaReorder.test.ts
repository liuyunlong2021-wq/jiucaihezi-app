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

test('order names carry a three digit prefix and stay idempotent', () => {
  assert.equal(orderName(1, 'a.png'), '001_a.png')
  assert.equal(orderName(7, '001_a.png'), '007_a.png')
  assert.equal(orderName(42, '007_prompt_91c8af.png'), '042_prompt_91c8af.png')
  assert.equal(orderName(1000, 'a.png'), '1000_a.png')
  assert.equal(stripOrderPrefix('007_a.png'), 'a.png')
  assert.equal(stripOrderPrefix('a.png'), 'a.png')
  assert.equal(stripOrderPrefix('07_a.png'), '07_a.png')
  assert.equal(orderPrefixOf('007_a.png'), 7)
  assert.equal(orderPrefixOf('a.png'), null)
  assert.equal(temporaryReorderName(3, '007_a.png'), '__pft_reorder_tmp_003_a.png')
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
  const plan = planMediaReorder({ resources })
  assert.deepEqual(names(plan), [])
  assert.equal(plan.unchanged.length, 3)
  assert.equal(plan.numberedCount, 3)
  assert.equal(plan.unnumberedCount, 0)

  const rerun = planMediaReorder({ resources })
  assert.deepEqual(names(rerun), [])
})

test('unnumbered media is ordered by generation time', () => {
  const resources = [file('b_91c8af.png'), file('a_11aa11.png'), file('c_22bb22.png')]
  const created: Record<string, number> = {
    'b_91c8af.png': 300,
    'a_11aa11.png': 100,
    'c_22bb22.png': 200,
  }
  const plan = planMediaReorder({
    resources,
    createdAtOf: (_path, name) => created[name],
  })
  assert.deepEqual(names(plan), [
    'a_11aa11.png -> 001_a_11aa11.png',
    'c_22bb22.png -> 002_c_22bb22.png',
    'b_91c8af.png -> 003_b_91c8af.png',
  ])
  assert.equal(plan.fileTimeCount, 0)
})

test('numbered files stay in front and unnumbered ones append by time', () => {
  const resources = [file('newest.png', 900), file('005_late.png'), file('older.png', 100)]
  const plan = planMediaReorder({ resources })
  assert.deepEqual(names(plan), [
    '005_late.png -> 001_late.png',
    'older.png -> 002_older.png',
    'newest.png -> 003_newest.png',
  ])
  assert.equal(plan.numberedCount, 1)
  assert.equal(plan.unnumberedCount, 2)
})

test('gaps in existing numbering collapse to a continuous sequence', () => {
  const plan = planMediaReorder({ resources: [file('005_e.png'), file('001_a.png'), file('009_i.png')] })
  assert.deepEqual(names(plan), [
    '005_e.png -> 002_e.png',
    '009_i.png -> 003_i.png',
  ])
  assert.equal(plan.renames.length, 2)
  assert.equal(plan.unchanged.length, 1)
})

test('duplicate existing numbers fall back to a stable name order', () => {
  const plan = planMediaReorder({ resources: [file('001_b.png'), file('001_a.png')] })
  assert.deepEqual(names(plan), ['001_b.png -> 002_b.png'])
  assert.deepEqual(plan.unchanged.map(entry => entry.name), ['001_a.png'])
})

test('created mode reorders everything by generation time and ignores numbering', () => {
  const resources = [file('001_b.png'), file('002_a.png')]
  const created: Record<string, number> = { '001_b.png': 500, '002_a.png': 100 }
  const plan = planMediaReorder({
    resources,
    mode: 'created',
    createdAtOf: (_path, name) => created[name],
  })
  assert.deepEqual(names(plan), [
    '002_a.png -> 001_a.png',
    '001_b.png -> 002_b.png',
  ])
})

test('file time is the fallback and a missing time sorts last', () => {
  const resources = [file('no-time.png'), file('stamped.png', 100)]
  const plan = planMediaReorder({ resources })
  assert.deepEqual(names(plan), [
    'stamped.png -> 001_stamped.png',
    'no-time.png -> 002_no-time.png',
  ])
  assert.equal(plan.fileTimeCount, 1)
})

test('same generation time falls back to file time then name', () => {
  const resources = [file('c.png', 300), file('a.png', 100), file('b.png', 200)]
  const created = { 'a.png': 50, 'b.png': 50, 'c.png': 50 }
  const plan = planMediaReorder({ resources, createdAtOf: (_path, name) => created[name as keyof typeof created] })
  assert.deepEqual(names(plan), [
    'a.png -> 001_a.png',
    'b.png -> 002_b.png',
    'c.png -> 003_c.png',
  ])
})

test('directories, non-media files and protected paths stay out of the plan', () => {
  const resources = [
    folder('003_dir.png'),
    file('001_a.png'),
    file('002_b.png'),
    file('note.md'),
    file('004_keep.png'),
  ]
  const plan = planMediaReorder({
    resources,
    isProtected: path => path.endsWith('004_keep.png'),
  })
  assert.deepEqual(plan.renames, [])
  assert.deepEqual(plan.unchanged.map(entry => entry.name), ['001_a.png', '002_b.png'])
  assert.equal(plan.numberedCount, 2)
})

test('fewer than two media files produces an empty plan', () => {
  assert.deepEqual(planMediaReorder({ resources: [] }).renames, [])
  assert.deepEqual(planMediaReorder({ resources: [file('only.png')] }).renames, [])
})

test('swapped names are reported so the caller can stage through temporary names', () => {
  const plan = planMediaReorder({ resources: [file('002_a.png'), file('a.png')] })
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.conflicts[0].nextName, '002_a.png')
  assert.equal(plan.conflicts[0].holderPath, '第01集/002_a.png')
  assert.equal(plan.needsTempPass, true)
})

test('non conflicting reorder never asks for a temporary pass', () => {
  const plan = planMediaReorder({ resources: [file('b_91c8af.png', 200), file('a_11aa11.png', 100)] })
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.needsTempPass, false)
})

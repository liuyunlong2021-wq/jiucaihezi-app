import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareFileEntries,
  fileKindOf,
  fileSortLabel,
  isFileSortMode,
  DEFAULT_FILE_SORT_MODE,
  FILE_SORT_OPTIONS,
  type FileSortMode,
  type SortableFileEntry,
} from '@/utils/fileSort'

function names(entries: SortableFileEntry[], mode: FileSortMode) {
  return entries.slice().sort((a, b) => compareFileEntries(a, b, mode)).map(entry => entry.name)
}

test('file sort default puts the newest first so generated media is not buried', () => {
  const entries: SortableFileEntry[] = [
    { name: '2026-08-15_a.png', updatedAt: 100 },
    { name: '2026-09-19_b.png', updatedAt: 300 },
    { name: '2026-08-20_c.png', updatedAt: 200 },
  ]

  // 生成物名带时间戳，按名字升序 = 最新的沉在最底下，所以默认必须是时间倒序。
  assert.equal(DEFAULT_FILE_SORT_MODE, 'time-desc')
  assert.deepEqual(names(entries, DEFAULT_FILE_SORT_MODE), [
    '2026-09-19_b.png',
    '2026-08-20_c.png',
    '2026-08-15_a.png',
  ])
  assert.deepEqual(names(entries, 'time-asc'), [
    '2026-08-15_a.png',
    '2026-08-20_c.png',
    '2026-09-19_b.png',
  ])
})

test('file sort compares names with zh-CN numeric collation', () => {
  const entries: SortableFileEntry[] = [{ name: '第10集' }, { name: '第2集' }]

  assert.deepEqual(names(entries, 'name-asc'), ['第2集', '第10集'])
  assert.deepEqual(names(entries, 'name-desc'), ['第10集', '第2集'])
})

test('file sort supports size and kind modes', () => {
  const entries: SortableFileEntry[] = [
    { name: 'big.png', size: 900, mimeType: 'image/png' },
    { name: 'small.mp4', size: 10, mimeType: 'video/mp4' },
    { name: 'mid.md', size: 100, mimeType: 'text/markdown' },
  ]

  assert.deepEqual(names(entries, 'size-desc'), ['big.png', 'mid.md', 'small.mp4'])
  assert.deepEqual(names(entries, 'size-asc'), ['small.mp4', 'mid.md', 'big.png'])
  assert.deepEqual(names(entries, 'kind-asc'), ['big.png', 'small.mp4', 'mid.md'])
})

test('file kind reads mimeType first and falls back to the extension', () => {
  assert.equal(fileKindOf({ name: 'a.PNG' }), 'image')
  assert.equal(fileKindOf({ name: 'b.mov' }), 'video')
  assert.equal(fileKindOf({ name: 'c.mp3' }), 'audio')
  assert.equal(fileKindOf({ name: 'd.docx' }), 'document')
  assert.equal(fileKindOf({ name: 'e.zip' }), 'other')
  assert.equal(fileKindOf({ name: 'x.bin', mimeType: 'image/webp' }), 'image')
  // 目录不参与种类比较：调用方已经保证目录排在最前。
  assert.equal(fileKindOf({ name: 'folder', isDir: true }), 'other')
})

test('every sort mode is selectable, labelled, and 「不排序」 is not offered', () => {
  for (const option of FILE_SORT_OPTIONS) {
    assert.equal(isFileSortMode(option.mode), true)
    assert.ok(fileSortLabel(option.mode).length > 0)
    assert.ok(option.title.includes('排序'))
  }

  // 桌面 list 按字节序返回，真「不排序」会让中文名全部沉底。
  assert.equal(isFileSortMode('none'), false)
  assert.equal(isFileSortMode(undefined), false)
  assert.equal(isFileSortMode('time-desc'), true)
})

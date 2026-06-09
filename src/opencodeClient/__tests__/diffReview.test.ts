import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDiffReviewModel } from '../diffReview'

test('buildDiffReviewModel summarizes files statuses and totals', () => {
  const model = buildDiffReviewModel([
    { file: 'src/a.ts', status: 'M', additions: 2, deletions: 1, patch: '@@ -1,2 +1,3 @@\n a\n-old\n+new\n+next' },
    { path: 'src/b.ts', status: 'added', additions: 4, deletions: 0 },
  ])

  assert.equal(model.summary.fileCount, 2)
  assert.equal(model.summary.additions, 6)
  assert.equal(model.summary.deletions, 1)
  assert.equal(model.summary.hasPatchCount, 1)
  assert.equal(model.summary.statusCounts.modified, 1)
  assert.equal(model.summary.statusCounts.added, 1)
  assert.equal(model.files[0].file, 'src/a.ts')
  assert.equal(model.files[1].file, 'src/b.ts')
})

test('buildDiffReviewModel parses hunks into reviewable line kinds and numbers', () => {
  const model = buildDiffReviewModel([{
    file: 'src/a.ts',
    patch: [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,3 +10,4 @@',
      ' keep',
      '-old',
      '+new',
      '+next',
    ].join('\n'),
  }])

  const file = model.files[0]
  assert.equal(file.hasPatch, true)
  assert.equal(file.hunks.length, 2)
  assert.equal(file.hunks[0].header, '文件元信息')
  assert.equal(file.hunks[1].header, '@@ -10,3 +10,4 @@')
  assert.deepEqual(file.hunks[1].lines.map(line => line.kind), ['context', 'del', 'add', 'add'])
  assert.deepEqual(file.hunks[1].lines.map(line => [line.oldLine, line.newLine]), [
    [10, 10],
    [11, undefined],
    [undefined, 11],
    [undefined, 12],
  ])
})

test('buildDiffReviewModel keeps summary-only diff files reviewable', () => {
  const model = buildDiffReviewModel([{ newPath: 'src/no-patch.ts', additions: 1, deletions: 0 }])

  assert.equal(model.files[0].file, 'src/no-patch.ts')
  assert.equal(model.files[0].hasPatch, false)
  assert.deepEqual(model.files[0].hunks, [])
})

test('buildDiffReviewModel classifies hunk body prefixes without confusing file headers', () => {
  const model = buildDiffReviewModel([{
    file: 'src/prefix.ts',
    patch: [
      '--- a/src/prefix.ts',
      '+++ b/src/prefix.ts',
      '@@ -1,2 +1,2 @@',
      '---deleted-content-that-starts-with-dashes',
      '+++added-content-that-starts-with-pluses',
      '\\ No newline at end of file',
      ' context',
    ].join('\n'),
  }])

  const lines = model.files[0].hunks[1].lines
  assert.deepEqual(lines.map(line => line.kind), ['del', 'add', 'meta', 'context'])
  assert.deepEqual(lines.map(line => [line.oldLine, line.newLine]), [
    [1, undefined],
    [undefined, 1],
    [undefined, undefined],
    [2, 2],
  ])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { IMAGE_SPLIT_GRIDS, imageSplitLabel, imageSplitRects } from '../imageGridSplit'

function covers(rects: { x: number; y: number; width: number; height: number }[], width: number, height: number) {
  const area = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)
  return area === width * height
}

test('MJ 四宫格：2048² 切成四张 1024²', () => {
  const rects = imageSplitRects(2048, 2048, { cols: 2, rows: 2 })
  assert.deepEqual(rects, [
    { index: 1, x: 0, y: 0, width: 1024, height: 1024 },
    { index: 2, x: 1024, y: 0, width: 1024, height: 1024 },
    { index: 3, x: 0, y: 1024, width: 1024, height: 1024 },
    { index: 4, x: 1024, y: 1024, width: 1024, height: 1024 },
  ])
})

test('9:16 的四宫格（1632×2912）切成四张 816×1456', () => {
  const rects = imageSplitRects(1632, 2912, { cols: 2, rows: 2 })
  assert.deepEqual(rects.map(rect => [rect.width, rect.height]), [
    [816, 1456], [816, 1456], [816, 1456], [816, 1456],
  ])
  assert.equal(covers(rects, 1632, 2912), true)
})

test('除不尽的尺寸也不留缝、不重叠：最后一行/列吃到边缘', () => {
  for (const [width, height] of [[2047, 2048], [1633, 2913], [999, 1001]] as const) {
    for (const grid of IMAGE_SPLIT_GRIDS) {
      const rects = imageSplitRects(width, height, grid)
      assert.equal(rects.length, grid.cols * grid.rows)
      assert.equal(covers(rects, width, height), true, `${width}x${height} ${imageSplitLabel(grid)}`)
      const last = rects[rects.length - 1]
      assert.equal(last.x + last.width, width)
      assert.equal(last.y + last.height, height)
    }
  }
})

test('索引从左到右、从上到下，1 起', () => {
  const rects = imageSplitRects(300, 300, { cols: 3, rows: 3 })
  assert.deepEqual(rects.map(rect => rect.index), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(rects[1], { index: 2, x: 100, y: 0, width: 100, height: 100 })
  assert.deepEqual(rects[3], { index: 4, x: 0, y: 100, width: 100, height: 100 })
})

test('横竖两格与非法尺寸', () => {
  assert.equal(imageSplitRects(400, 200, { cols: 2, rows: 1 }).length, 2)
  assert.equal(imageSplitRects(400, 200, { cols: 1, rows: 2 }).length, 2)
  assert.deepEqual(imageSplitRects(0, 100, { cols: 2, rows: 2 }), [])
  assert.deepEqual(imageSplitRects(100, 100, { cols: 0, rows: 2 }), [])
  assert.equal(imageSplitLabel({ cols: 2, rows: 3 }), '3×2')
})

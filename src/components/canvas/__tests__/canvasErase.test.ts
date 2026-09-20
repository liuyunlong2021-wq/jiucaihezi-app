import assert from 'node:assert/strict'
import { test } from 'node:test'

import { expandEraseRegion, isEraseRectUsable, toImagePixelRect } from '../canvasErase'

test('选区外扩给出取样余量，并夹在图片范围内', () => {
  const region = expandEraseRegion({ x: 200, y: 200, width: 40, height: 20 }, { width: 1000, height: 800 })
  assert.deepEqual(region, { x: 136, y: 136, width: 168, height: 148 })
})

test('选区贴着图片左上角时外扩不越界', () => {
  const region = expandEraseRegion({ x: 2, y: 3, width: 10, height: 10 }, { width: 100, height: 100 })
  assert.equal(region.x, 0)
  assert.equal(region.y, 0)
  assert.equal(region.x + region.width, 76)
  assert.equal(region.y + region.height, 77)
})

test('大选区按自身尺寸外扩，不至于采样范围过窄', () => {
  const region = expandEraseRegion({ x: 500, y: 500, width: 300, height: 100 }, { width: 2000, height: 2000 })
  assert.deepEqual(region, { x: 200, y: 200, width: 900, height: 700 })
})

test('外扩块始终落在图片内', () => {
  const image = { width: 640, height: 480 }
  for (const rect of [
    { x: 0, y: 0, width: 640, height: 480 },
    { x: 600, y: 440, width: 40, height: 40 },
    { x: 10, y: 10, width: 8, height: 8 },
  ]) {
    const region = expandEraseRegion(rect, image)
    assert.ok(region.x >= 0 && region.y >= 0, `左上越界: ${JSON.stringify(region)}`)
    assert.ok(region.x + region.width <= image.width, `右侧越界: ${JSON.stringify(region)}`)
    assert.ok(region.y + region.height <= image.height, `下方越界: ${JSON.stringify(region)}`)
  }
})

test('节点本地坐标按显示缩放换算成图片像素', () => {
  const rect = toImagePixelRect(
    { x: 10, y: 20, width: 30, height: 40 },
    { width: 300, height: 300 },
    { width: 1200, height: 900 },
  )
  assert.deepEqual(rect, { x: 40, y: 60, width: 120, height: 120 })
})

test('节点与图片同尺寸时坐标原样返回', () => {
  const rect = { x: 7, y: 9, width: 11, height: 13 }
  assert.deepEqual(toImagePixelRect(rect, { width: 500, height: 500 }, { width: 500, height: 500 }), rect)
})

test('过小的选区不算一次有效擦除', () => {
  assert.equal(isEraseRectUsable({ x: 0, y: 0, width: 2, height: 40 }), false)
  assert.equal(isEraseRectUsable({ x: 0, y: 0, width: 40, height: 2 }), false)
  assert.equal(isEraseRectUsable({ x: 0, y: 0, width: 4, height: 4 }), true)
})

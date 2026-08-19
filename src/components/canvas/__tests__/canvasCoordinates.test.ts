import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canvasAnnotationPoint,
  canvasMediaPosition,
} from '../canvasCoordinates'

test('annotation point stays inside its image Group after viewport pan and zoom', () => {
  const viewport = { x: 40, y: 20, zoom: 1.5 }
  const imageGroup = { x: 120, y: 80 }
  const expected = { x: 35, y: 25 }
  const world = {
    x: viewport.x + (imageGroup.x + expected.x) * viewport.zoom,
    y: viewport.y + (imageGroup.y + expected.y) * viewport.zoom,
  }
  const event = {
    getInnerPoint(node: typeof imageGroup) {
      return {
        x: (world.x - viewport.x) / viewport.zoom - node.x,
        y: (world.y - viewport.y) / viewport.zoom - node.y,
      }
    },
  }

  assert.deepEqual(canvasAnnotationPoint(event, imageGroup), expected)
})

test('new canvas media opens beside the current selection or in the visible viewport', () => {
  assert.deepEqual(
    canvasMediaPosition({
      selected: [
        { x: 100, y: 80, width: 320, height: 180 },
        { x: 450, y: 120, width: 200, height: 160 },
      ],
      viewport: { width: 1200, height: 800, x: -300, y: -100, scale: 2 },
      media: { width: 320, height: 180 },
      gap: 24,
    }),
    { x: 674, y: 80 },
  )
  assert.deepEqual(
    canvasMediaPosition({
      selected: [],
      viewport: { width: 1200, height: 800, x: -300, y: -100, scale: 2 },
      media: { width: 320, height: 180 },
      gap: 24,
    }),
    { x: 290, y: 160 },
  )
})

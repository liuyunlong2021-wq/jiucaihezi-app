import assert from 'node:assert/strict'
import test from 'node:test'

import { productionWikiOutputPath } from '../productionWikiOutput'

test('production outputs are stored under the Wiki category owned by their Skill', () => {
  assert.equal(productionWikiOutputPath('style'), 'wiki/世界观/style-design.md')
  assert.equal(productionWikiOutputPath('character', '沈昭'), 'wiki/角色/沈昭.md')
  assert.equal(productionWikiOutputPath('scene', '雨巷'), 'wiki/场景/雨巷.md')
  assert.equal(productionWikiOutputPath('prop', '铜铃'), 'wiki/道具/铜铃.md')
  assert.equal(productionWikiOutputPath('storyboard', '第一集-1'), 'wiki/分镜/第一集-1.md')
  assert.equal(productionWikiOutputPath('video', '镜头-01'), 'wiki/分镜/视频/镜头-01.json')
})

test('production output names cannot escape their Wiki category', () => {
  assert.throws(() => productionWikiOutputPath('character', '../outside'), /名称无效/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('JcIcon SVG icons are used instead of deprecated mso ligature font', () => {
  const root = process.cwd()
  const sampleVue = readFileSync(resolve(root, 'src/components/tools/ToolWarehousePanel.vue'), 'utf8')

  assert.match(sampleVue, /JcIcon name="search"/)
  assert.match(sampleVue, /JcIcon name="star"/)
  assert.match(sampleVue, /JcIcon name="extension"/)
  assert.match(sampleVue, /JcIcon name="chevron_right"/)
  assert.match(sampleVue, /JcIcon name="arrow_back"/)
  assert.doesNotMatch(sampleVue, /class="mso"/)
})

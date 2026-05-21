import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('Material Symbols uses the full local ligature font for mso text icons', () => {
  const root = process.cwd()
  const css = readFileSync(resolve(root, 'src/styles/base.css'), 'utf8')
  const sampleVue = readFileSync(resolve(root, 'src/components/tools/ToolWarehousePanel.vue'), 'utf8')

  assert.match(sampleVue, /toggle_on/)
  assert.match(sampleVue, /toggle_off/)
  assert.match(css, /material-symbols-outlined\.woff2/)
  assert.doesNotMatch(css, /material-symbols-outlined-subset\.woff2/)
  assert.match(css, /\.mso\s*\{[\s\S]*text-transform:\s*none/)
  assert.match(css, /\.mso\s*\{[\s\S]*letter-spacing:\s*normal/)
  assert.match(css, /\.mso\s*\{[\s\S]*font-feature-settings:\s*'liga'/)
})

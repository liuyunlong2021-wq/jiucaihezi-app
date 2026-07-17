import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
const workbench = readFileSync(join(root, 'src/components/workbench/EcommerceWorkbench.vue'), 'utf8')
const layout = readFileSync(join(root, 'src/layouts/WorkspaceLayout.vue'), 'utf8')
const rail = readFileSync(join(root, 'src/components/rail/ActivityRail.vue'), 'utf8')

test('ecommerce workbench offers only the product-image loop and explicit plan approval', () => {
  assert.match(workbench, /上传真实商品图/)
  assert.match(workbench, /添加参考图/)
  assert.match(workbench, /让 AI 给方案/)
  assert.match(workbench, /开始生成/)
  assert.match(workbench, /ecommerce-plan-request/)
  assert.match(workbench, /ecommerce-media-plan-approved/)
  assert.match(workbench, /media-task-settled/)
  assert.match(workbench, /ecommerce-media-plan-settled/)
  assert.doesNotMatch(workbench, /宣传视频|参考图分析|改图入口/)
})

test('ecommerce workbench switches views without destroying the active chat panel', () => {
  assert.match(layout, /<ChatPanel v-show="!isEcommerceWorkbench" \/>/)
  assert.match(layout, /<EcommerceWorkbench v-show="isEcommerceWorkbench" \/>/)
  assert.match(layout, /rightPanel\.value = 'creation'/)
  assert.match(rail, /key: 'ecommerce'/)
  assert.match(rail, /webHiddenTabs = new Set\(\['tools', 'files', 'review', 'ecommerce'\]\)/)
})

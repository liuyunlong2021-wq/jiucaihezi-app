import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
const workbench = readFileSync(
  join(root, 'src/components/workbench/EcommerceWorkbench.vue'),
  'utf8',
)
const chatPanel = readFileSync(join(root, 'src/components/chat/ChatPanel.vue'), 'utf8')
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

test('ecommerce workbench renders uploaded product and reference images as removable previews', () => {
  assert.match(workbench, /class="ecom-asset-grid"/)
  assert.match(workbench, /class="ecom-asset ecom-asset-add"/)
  assert.match(workbench, /class="ecom-asset-preview"/)
  assert.match(workbench, /:src="image"/)
  assert.match(workbench, /alt="商品图预览"/)
  assert.match(workbench, /alt="参考图预览"/)
  assert.match(workbench, /title="移除商品图"/)
  assert.match(workbench, /title="移除参考图"/)
})

test('ecommerce workbench puts the Dazi product-image reference library behind the existing external opener', () => {
  assert.match(workbench, /import \{ openExternal \} from '@\/utils\/httpClient'/)
  assert.match(workbench, /openExternal\('https:\/\/dazi\.studio\/'\)/)
  assert.equal((workbench.match(/查看商品图参考/g) || []).length, 1)
})

test('ecommerce workbench centers every asset label independently of its delete button', () => {
  assert.match(
    workbench,
    /\.ecom-asset figcaption \{[^}]*padding: 5px 6px;[^}]*text-align: center;/,
  )
})

test('ecommerce workbench centers the image and label together inside every asset card', () => {
  assert.match(workbench, /\.ecom-asset \{[^}]*justify-content: center;/)
})

test('ecommerce workbench exposes only explicitly declared custom workbenches', () => {
  assert.match(workbench, /loadEcommerceWorkbenchDefinitions/)
  assert.match(workbench, /反推/)
  assert.doesNotMatch(workbench, />自建</)
  assert.match(workbench, /ecommerce-custom-workbench-request/)
  assert.match(workbench, /workbench\.skillName/)
})

test('ecommerce workbench shows the declared result without exposing JSON analysis', () => {
  assert.match(workbench, /customResultFor/)
  assert.match(workbench, /customWorkbench\.result\.label/)
  assert.match(workbench, /复制提示词/)
  assert.doesNotMatch(workbench, /JSON 视觉分析/)
})

test('custom workbench stays visible and receives the completed Chat result', () => {
  const request = workbench.match(
    /async function requestCustomWorkbench[\s\S]*?\n}\n\nfunction openCollaboration/,
  )
  assert.ok(request)
  assert.match(request[0], /ecommerce-custom-workbench-request/)
  assert.doesNotMatch(request[0], /setSurface\('collaboration'\)/)
  assert.match(chatPanel, /ecommerce-custom-workbench-completed/)
})

test('reverse-prompt workbench keeps product prompt generation and final media submission in one card', () => {
  assert.match(workbench, /用此提示词制作商品图/)
  assert.match(workbench, /生成商品图提示词/)
  assert.match(workbench, /生成商品图/)
  assert.match(workbench, /runninghub\/api\/rh-gpt2-official/)
  assert.match(workbench, /1:1.*3:4.*4:3.*9:16.*16:9/)
  assert.match(chatPanel, /ecommerce-product-image-prompt-request/)
})

test('reverse workbench keeps every stage available for pasted prompts', () => {
  assert.match(workbench, /参考图反推提示词/)
  assert.match(workbench, /最终商品图提示词/)
  assert.doesNotMatch(
    workbench,
    /v-if="customWorkbench\.skillId === REVERSE_PROMPT_SKILL_ID && customResultFor/,
  )
  assert.doesNotMatch(workbench, /v-if="productImageHandoffFor\(customWorkbench\)\.prompt"/)
})

test('asset previews leave matching vertical space around the image and label', () => {
  assert.match(workbench, /\.ecom-asset-preview \{[^}]*height: 130px;/)
})

test('ecommerce workbench switches views without destroying the active chat panel', () => {
  assert.match(layout, /<ChatPanel v-show="!isEcommerceWorkbench" \/>/)
  assert.match(layout, /<EcommerceWorkbench v-show="isEcommerceWorkbench" \/>/)
  assert.match(layout, /rightPanel\.value = 'creation'/)
  assert.match(rail, /key: 'ecommerce'/)
  assert.match(rail, /webHiddenTabs = new Set\(\['tools', 'files', 'review', 'ecommerce'\]\)/)
})

test('chat uses the activity rail instead of a duplicate return-to-ecommerce button', () => {
  assert.doesNotMatch(chatPanel, /返回电商工作台|cp-ecommerce-back|isEcommerceCollaboration/)
})

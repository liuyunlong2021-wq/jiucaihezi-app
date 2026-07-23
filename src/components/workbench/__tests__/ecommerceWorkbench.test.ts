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

test('product images use the prompt-only Skill and enter the shared media confirmation card outside Chat', () => {
  assert.match(workbench, /上传真实商品图/)
  assert.match(workbench, /添加参考图/)
  assert.match(workbench, /生成提示词/)
  assert.match(workbench, /生成媒体计划/)
  assert.match(workbench, /loadWebSkillByName\('jc-gpt-image'\)/)
  assert.match(workbench, /productPrompt\.value/)
  assert.match(workbench, /referenceImages: \[\.\.\.allImages\.value\]/)
  assert.match(workbench, /<MediaPlanCard/)
  assert.match(workbench, /@approve="approveProductImagePlan"/)
  assert.match(workbench, /@update-parameters="updateProductImagePlan"/)
  assert.match(workbench, /sendSingleTurnWorkbench/)
  assert.match(workbench, /ecommerce-media-plan-approved/)
  assert.match(workbench, /media-task-settled/)
  assert.match(workbench, /ecommerce-media-plan-settled/)
  assert.doesNotMatch(workbench, /jc-product-image/)
  assert.doesNotMatch(workbench, /宣传视频|参考图分析|改图入口/)
})

test('product-image prompting leaves size selection to the shared media plan instead of guessing a platform use case', () => {
  assert.match(workbench, /你的诉求/)
  assert.match(workbench, /notes: draft\.value\.notes/)
  assert.doesNotMatch(workbench, /交付目标|发布位置/)
  assert.doesNotMatch(workbench, /deliveryGoal: draft\.value\.deliveryGoal|market: draft\.value\.market/)
})

test('ecommerce header keeps the three workbench views on the left and the model picker on the right', () => {
  assert.doesNotMatch(workbench, /class="ecom-collaboration"/)
  assert.doesNotMatch(workbench, /<p>\{\{ viewLabel \}\}<\/p>/)
  assert.match(workbench, />商品图<\/button>/)
  assert.match(workbench, />反推<\/button>/)
  assert.match(workbench, />反推生图<\/button>/)
  assert.match(workbench, /class="ecom-header-actions"/)
  assert.match(workbench, /class="ecom-model-btn"/)
  assert.match(workbench, /class="ecom-model-menu"/)
  assert.match(workbench, /agentStore\.textModels/)
  assert.doesNotMatch(workbench, /agentStore\.setModel\(/)
})

test('reverse workbench accepts five reference images and uses the compact upload instruction', () => {
  assert.match(workbench, /上传参考图反推图片提示词/)
  const manifest = readFileSync(join(root, 'public/skills/jc-reverse-image-prompt/workbench.json'), 'utf8')
  assert.match(manifest, /"maxFiles": 5/)
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
  assert.match(workbench, /workbench\.skillContent/)
})

test('reverse workbench shows each successful run once and the skill asks only for a copy-ready Chinese prompt', () => {
  assert.match(workbench, /v-for="run in runsFor\(customWorkbench\)"/)
  assert.doesNotMatch(workbench, /v-if="customResultFor\(customWorkbench\)"/)
  const manifest = readFileSync(join(root, 'public/skills/jc-reverse-image-prompt/workbench.json'), 'utf8')
  assert.match(manifest, /只输出可直接用于生图的中文提示词/)
  assert.doesNotMatch(manifest, /JSON 视觉分析/)
  const skill = readFileSync(join(root, 'public/skills/jc-reverse-image-prompt/SKILL.md'), 'utf8')
  assert.match(skill, /只输出一条可直接用于生图的中文提示词/)
  assert.doesNotMatch(skill, /JSON/)
})

test('custom workbench stays visible and receives its direct single-turn result', () => {
  const request = workbench.match(
    /async function executeCustomRuns[\s\S]*?\n}\n\nfunction retryCustomRun/,
  )
  assert.ok(request)
  assert.match(request[0], /sendSingleTurnWorkbench/)
  assert.doesNotMatch(request[0], /setSurface\('collaboration'\)/)
  assert.doesNotMatch(chatPanel, /ecommerce-custom-workbench-request/)
})

test('each reverse run can retry or open a seeded reverse-image tab without a second text-model request', () => {
  assert.match(workbench, /function retryCustomRun/)
  assert.match(workbench, /executeCustomRuns\(workbench, \[retry\]\)/)
  assert.match(workbench, /function reuseCustomRun/)
  assert.match(workbench, /改用/)
  assert.match(workbench, /activeView\.value = 'reverse-image'/)
  assert.doesNotMatch(workbench, /productHandoffRef/)
  assert.doesNotMatch(workbench, /requestProductImagePrompt/)
  assert.match(workbench, /反推历史/)
  assert.match(workbench, /商品图历史/)
  assert.match(workbench, /emitEvent\('show-history-list'\)/)
  assert.match(workbench, /emitEvent\('project-filetree:locate'/)
})

test('reverse cards do not render raw analysis while a prompt is streaming', () => {
  assert.match(workbench, /run\.status === 'success' && run\.content/)
})

test('reverse-image uses the shared media confirmation card and existing public submission chain', () => {
  assert.match(workbench, /import MediaPlanCard from '@\/components\/chat\/MediaPlanCard\.vue'/)
  assert.match(workbench, /<MediaPlanCard/)
  assert.match(workbench, /@update-parameters="updateReverseImagePlan"/)
  assert.match(workbench, /preparePublicMediaPlan/)
  assert.match(workbench, /ecommerce-media-plan-approved/)
  assert.match(workbench, /生成媒体计划/)
  assert.match(workbench, /@approve="approveReverseImagePlan"/)
  assert.doesNotMatch(chatPanel, /ecommerce-product-image-prompt-request/)
})

test('reverse-image applies the selected prompt, the user request, and only the user product image', () => {
  assert.match(workbench, /reverseImagePrompt\.value/)
  assert.match(workbench, /reverseImageIntent\.value/)
  assert.match(workbench, /reverseImageProduct\.value/)
  assert.match(workbench, /referenceImages: \[reverseImageProduct\.value\]/)
  assert.doesNotMatch(workbench, /PRODUCT_IMAGE_RATIOS/)
})

test('asset previews leave matching vertical space around the image and label', () => {
  assert.match(workbench, /\.ecom-asset-preview \{[^}]*height: 130px;/)
})

test('ecommerce workbench is available on Web and switches views without destroying the active chat panel', () => {
  assert.match(layout, /<ChatPanel v-show="!isEcommerceWorkbench" \/>/)
  assert.match(layout, /<EcommerceWorkbench v-show="isEcommerceWorkbench" \/>/)
  assert.match(layout, /rightPanel\.value = 'creation'/)
  assert.match(layout, /const isEcommerceMode = computed\(\(\) => chatModeStore\.mode === 'creative'\)/)
  assert.match(layout, /mobilePanel = ref<'chat' \| 'history' \| 'creation' \| 'ecommerce' \| 'settings'>\('chat'\)/)
  assert.match(layout, /mobilePanel === 'ecommerce'/)
  assert.match(layout, /mobilePanel = 'ecommerce'/)
  const railSwitch = layout.match(/function onRailSwitch[\s\S]*?\n}\n\n\/\/ ─── Resize/)
  assert.ok(railSwitch)
  assert.doesNotMatch(railSwitch[0], /if \(isWebRuntime\.value\) return/)
  assert.match(rail, /key: 'ecommerce'/)
  assert.match(rail, /webHiddenTabs = new Set\(\['files'\]\)/)
})

test('chat uses the activity rail instead of a duplicate return-to-ecommerce button', () => {
  assert.doesNotMatch(chatPanel, /返回电商工作台|cp-ecommerce-back|isEcommerceCollaboration/)
})

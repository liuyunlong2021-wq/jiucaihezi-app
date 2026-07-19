<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useCreativeSessionStore } from '@/stores/creativeSessionStore'
import { useEcommerceWorkbenchStore } from '@/stores/ecommerceWorkbenchStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { emitEvent, emitEventAsync, onEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { extractEcommerceWorkbenchResult, loadEcommerceWorkbenchDefinitions, type EcommerceWorkbenchDefinition } from '@/runtime/workbench/workbenchManifest'
import { validateMediaPlan, type MediaPlan } from '@/runtime/workbench/mediaPlan'

const creativeSessionStore = useCreativeSessionStore()
const workbenchStore = useEcommerceWorkbenchStore()
const mediaTaskStore = useMediaTaskStore()
const planning = ref(false)
const error = ref('')
const activeView = ref<'product' | 'custom'>('product')
const customWorkbenchLoading = ref(true)
const customWorkbenchError = ref('')
const customWorkbenches = ref<EcommerceWorkbenchDefinition[]>([])
const customSubmittingSkillId = ref('')
const productPromptSubmittingSkillId = ref('')
const activeSessionId = computed(() => creativeSessionStore.activeSessionId)
const draft = computed(() => workbenchStore.draftFor(activeSessionId.value))
const plan = computed(() => workbenchStore.planFor(activeSessionId.value))
const allImages = computed(() => [...draft.value.productImages, ...draft.value.referenceImages])
const taskId = computed(() => workbenchStore.taskIdsBySession[activeSessionId.value])
const viewLabel = computed(() => activeView.value === 'product' ? '商品图' : '反推')
const PRODUCT_IMAGE_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9']
const REVERSE_PROMPT_SKILL_ID = 'JC-反推图片提示词'
const GPT_IMAGE_OFFICIAL_MODEL_ID = 'runninghub/api/rh-gpt2-official'

function setDraftText(key: 'deliveryGoal' | 'market' | 'notes', value: string) {
  workbenchStore.updateDraft(activeSessionId.value, { [key]: value })
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function addImages(kind: 'productImages' | 'referenceImages', event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])].filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  try {
    const images = await Promise.all(files.map(fileAsDataUrl))
    workbenchStore.updateDraft(activeSessionId.value, { [kind]: [...draft.value[kind], ...images] })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    input.value = ''
  }
}

function removeImage(kind: 'productImages' | 'referenceImages', index: number) {
  const next = [...draft.value[kind]]
  next.splice(index, 1)
  workbenchStore.updateDraft(activeSessionId.value, { [kind]: next })
}

function customImagesFor(workbench: EcommerceWorkbenchDefinition): string[] {
  return workbenchStore.customImagesFor(activeSessionId.value, workbench.skillId)
}

function customResultFor(workbench: EcommerceWorkbenchDefinition): string {
  return workbenchStore.customResultFor(activeSessionId.value, workbench.skillId)
}

function productImageHandoffFor(workbench: EcommerceWorkbenchDefinition) {
  return workbenchStore.productImageHandoffFor(activeSessionId.value, workbench.skillId)
}

async function copyCustomResult(workbench: EcommerceWorkbenchDefinition) {
  const content = customResultFor(workbench)
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    error.value = '复制失败，请在 AI 协作记录中复制。'
  }
}

async function addCustomImage(workbench: EcommerceWorkbenchDefinition, event: Event) {
  const input = event.target as HTMLInputElement
  const file = [...(input.files || [])].find(candidate => candidate.type.startsWith('image/'))
  if (!file) return
  try {
    workbenchStore.setCustomImages(activeSessionId.value, workbench.skillId, [await fileAsDataUrl(file)])
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    input.value = ''
  }
}

function removeCustomImage(workbench: EcommerceWorkbenchDefinition) {
  workbenchStore.setCustomImages(activeSessionId.value, workbench.skillId, [])
}

async function addProductImageHandoff(workbench: EcommerceWorkbenchDefinition, event: Event) {
  const input = event.target as HTMLInputElement
  const file = [...(input.files || [])].find(candidate => candidate.type.startsWith('image/'))
  if (!file) return
  try {
    workbenchStore.updateProductImageHandoff(activeSessionId.value, workbench.skillId, { productImage: await fileAsDataUrl(file), prompt: '' })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    input.value = ''
  }
}

function removeProductImageHandoff(workbench: EcommerceWorkbenchDefinition) {
  workbenchStore.updateProductImageHandoff(activeSessionId.value, workbench.skillId, { productImage: '', prompt: '' })
}

async function requestProductImagePrompt(workbench: EcommerceWorkbenchDefinition) {
  const handoff = productImageHandoffFor(workbench)
  const reversePrompt = customResultFor(workbench)
  if (!handoff.productImage || !reversePrompt) {
    error.value = '请填写参考图反推提示词并上传自己的产品图。'
    return
  }
  const sessionId = activeSessionId.value
  if (!sessionId) {
    error.value = '请先选择项目文件夹。'
    return
  }
  error.value = ''
  productPromptSubmittingSkillId.value = workbench.skillId
  try {
    await emitEventAsync('ecommerce-product-image-prompt-request', {
      sessionId,
      sourceSkillId: workbench.skillId,
      reversePrompt,
      productImage: handoff.productImage,
      intent: handoff.intent,
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    productPromptSubmittingSkillId.value = ''
  }
}

function requestProductImageGeneration(workbench: EcommerceWorkbenchDefinition) {
  const handoff = productImageHandoffFor(workbench)
  if (!activeSessionId.value) {
    error.value = '请先选择项目文件夹。'
    return
  }
  if (!handoff.productImage || !handoff.prompt.trim()) {
    error.value = '请上传自己的产品图并填写最终商品图提示词。'
    return
  }
  if (taskId.value) return
  const plan: MediaPlan = {
    kind: 'image',
    title: '商品图复刻',
    prompt: handoff.prompt,
    modelId: GPT_IMAGE_OFFICIAL_MODEL_ID,
    ratio: handoff.ratio,
    referenceImages: [handoff.productImage],
  }
  try {
    validateMediaPlan(plan)
    error.value = ''
    emitEvent('switch-panel', 'creation')
    emitEvent('ecommerce-media-plan-approved', { sessionId: activeSessionId.value, plan })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function requestPlan() {
  error.value = ''
  planning.value = true
  const sessionId = activeSessionId.value || creativeSessionStore.startNewSession()
  workbenchStore.claimPendingDraft(sessionId)
  emitEvent('ecommerce-plan-request', { sessionId, draft: workbenchStore.draftFor(sessionId), images: allImages.value })
}

function requestExecution() {
  if (!plan.value || !activeSessionId.value || taskId.value) return
  error.value = ''
  emitEvent('switch-panel', 'creation')
  emitEvent('ecommerce-media-plan-approved', { sessionId: activeSessionId.value, plan: plan.value })
}

async function requestCustomWorkbench(workbench: EcommerceWorkbenchDefinition) {
  const images = customImagesFor(workbench)
  if (!images.length) {
    error.value = `${workbench.fields[0].label}不能为空。`
    return
  }
  const sessionId = activeSessionId.value || creativeSessionStore.startNewSession()
  if (!sessionId) {
    error.value = '请先选择项目文件夹。'
    return
  }
  workbenchStore.claimPendingDraft(sessionId)
  error.value = ''
  customSubmittingSkillId.value = workbench.skillId
  try {
    await emitEventAsync('ecommerce-custom-workbench-request', {
      sessionId,
      skillId: workbench.skillId,
      skillName: workbench.skillName,
      prompt: workbench.action.prompt,
      resultHeading: workbench.result.heading,
      images,
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    customSubmittingSkillId.value = ''
  }
}

function openCollaboration() {
  workbenchStore.setSurface('collaboration')
}

function openReferenceLibrary() {
  void openExternal('https://dazi.studio/')
}

function updatePlanPrompt(event: Event) {
  if (!plan.value) return
  workbenchStore.setPlan(activeSessionId.value, { ...plan.value, prompt: (event.target as HTMLTextAreaElement).value })
}

const offPlanReady = onEvent('ecommerce-media-plan-ready', (payload: unknown) => {
  const result = payload as { sessionId?: string; plan?: NonNullable<typeof plan.value> }
  if (!result.plan) return
  const sessionId = result.sessionId || activeSessionId.value
  const taskDraft = workbenchStore.draftFor(sessionId)
  workbenchStore.setPlan(sessionId, {
    ...result.plan,
    referenceImages: taskDraft.productImages.length || taskDraft.referenceImages.length
      ? [...taskDraft.productImages, ...taskDraft.referenceImages]
      : result.plan.referenceImages,
  })
  planning.value = false
})
const offPlanFailed = onEvent('ecommerce-media-plan-failed', (payload: unknown) => {
  const result = payload as { error?: string }
  planning.value = false
  error.value = result.error || '媒体计划没有通过校验。请在 AI 协作记录中修正后重试。'
})
const offPlanSubmitted = onEvent('ecommerce-media-plan-submitted', (payload: unknown) => {
  const result = payload as { sessionId?: string; taskId?: string }
  if (!result.sessionId || !result.taskId) return
  workbenchStore.setTaskId(result.sessionId, result.taskId)
})
const offTaskSettled = onEvent('media-task-settled', (payload: unknown) => {
  const result = payload as { taskId?: string; status?: string; errorMsg?: string }
  const sessionId = Object.entries(workbenchStore.taskIdsBySession)
    .find(([, taskId]) => taskId === result.taskId)?.[0]
  if (!sessionId || !result.taskId) return
  const task = mediaTaskStore.getTask(result.taskId)
  emitEvent('ecommerce-media-plan-settled', {
    sessionId,
    taskId: result.taskId,
    status: result.status,
    projectPath: task?.projectPath,
    assetUri: task?.assetUri,
    error: result.errorMsg,
  })
})
const offPlanSettled = onEvent('ecommerce-media-plan-settled', (payload: unknown) => {
  const result = payload as { sessionId?: string; taskId?: string; status?: string; error?: string }
  if (!result.sessionId || result.taskId !== workbenchStore.taskIdsBySession[result.sessionId]) return
  workbenchStore.setTaskId(result.sessionId, undefined)
  if (result.status !== 'success') error.value = result.error || '商品图生成失败，请查看 AI 协作记录或重试。'
})
const offCustomWorkbenchCompleted = onEvent('ecommerce-custom-workbench-completed', (payload: unknown) => {
  const result = payload as { sessionId?: string; skillId?: string; content?: string; resultHeading?: string }
  if (!result.sessionId || !result.skillId || !result.content || !result.resultHeading) return
  workbenchStore.setCustomResult(result.sessionId, result.skillId, extractEcommerceWorkbenchResult(result.content, result.resultHeading))
  if (result.skillId === REVERSE_PROMPT_SKILL_ID) {
    workbenchStore.updateProductImageHandoff(result.sessionId, result.skillId, { prompt: '' })
  }
})
const offProductImagePromptCompleted = onEvent('ecommerce-product-image-prompt-completed', (payload: unknown) => {
  const result = payload as { sessionId?: string; sourceSkillId?: string; prompt?: string }
  if (!result.sessionId || !result.sourceSkillId || !result.prompt) return
  workbenchStore.updateProductImageHandoff(result.sessionId, result.sourceSkillId, { prompt: result.prompt })
})
onMounted(async () => {
  try {
    customWorkbenches.value = await loadEcommerceWorkbenchDefinitions()
  } catch (reason) {
    customWorkbenchError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    customWorkbenchLoading.value = false
  }
})
onBeforeUnmount(() => {
  offPlanReady()
  offPlanFailed()
  offPlanSubmitted()
  offTaskSettled()
  offPlanSettled()
  offCustomWorkbenchCompleted()
  offProductImagePromptCompleted()
})
</script>

<template>
  <section class="ecom-workbench">
    <header class="ecom-header">
      <div>
        <h2>电商创作台</h2>
        <p>{{ viewLabel }}</p>
        <nav class="ecom-tabs" aria-label="电商工作台视图">
          <button type="button" :class="{ active: activeView === 'product' }" @click="activeView = 'product'">商品图</button>
          <button type="button" :class="{ active: activeView === 'custom' }" @click="activeView = 'custom'">反推</button>
        </nav>
      </div>
      <button class="ecom-collaboration" type="button" @click="openCollaboration">
        <JcIcon name="chat" />
        <span>对话</span>
      </button>
    </header>

    <main v-if="activeView === 'product'" class="ecom-body">
      <section class="ecom-section">
        <div class="ecom-section-head">
          <div><h3>商品图</h3><span>建议上传</span></div>
          <button class="ecom-reference-link" type="button" title="打开 Dazi 商品图参考" @click="openReferenceLibrary"><JcIcon name="tips_and_updates" />查看商品图参考</button>
        </div>
        <div class="ecom-asset-grid">
          <figure v-for="(image, index) in draft.productImages" :key="`product-${index}`" class="ecom-asset">
            <img :src="image" alt="商品图预览" class="ecom-asset-preview">
            <figcaption>商品图 {{ index + 1 }}</figcaption>
            <button type="button" title="移除商品图" @click="removeImage('productImages', index)"><JcIcon name="close" /></button>
          </figure>
          <label class="ecom-asset ecom-asset-add">
            <JcIcon name="add_photo_alternate" />
            <span>上传真实商品图</span>
            <input type="file" accept="image/*" multiple @change="addImages('productImages', $event)">
          </label>
        </div>
      </section>

      <section class="ecom-section">
        <div class="ecom-section-head">
          <div><h3>参考图</h3><span>可选，只借鉴画面语言</span></div>
        </div>
        <div class="ecom-asset-grid">
          <figure v-for="(image, index) in draft.referenceImages" :key="`reference-${index}`" class="ecom-asset">
            <img :src="image" alt="参考图预览" class="ecom-asset-preview">
            <figcaption>参考图 {{ index + 1 }}</figcaption>
            <button type="button" title="移除参考图" @click="removeImage('referenceImages', index)"><JcIcon name="close" /></button>
          </figure>
          <label class="ecom-asset ecom-asset-add">
            <JcIcon name="image_search" />
            <span>添加参考图</span>
            <input type="file" accept="image/*" multiple @change="addImages('referenceImages', $event)">
          </label>
        </div>
      </section>

      <section class="ecom-section ecom-fields">
        <label>交付目标<select :value="draft.deliveryGoal" @change="setDraftText('deliveryGoal', ($event.target as HTMLSelectElement).value)"><option>商品主图</option><option>场景图</option><option>详情页长图</option><option>一组商品图</option></select></label>
        <label>发布位置<select :value="draft.market" @change="setDraftText('market', ($event.target as HTMLSelectElement).value)"><option>让 AI 推荐</option><option>淘宝京东</option><option>抖音小红书</option><option>海外站</option></select></label>
        <label class="ecom-notes">补充<textarea :value="draft.notes" rows="3" placeholder="不可改变的事实、品牌语气、风格或修改要求" @input="setDraftText('notes', ($event.target as HTMLTextAreaElement).value)" /></label>
      </section>

      <section v-if="plan" class="ecom-plan">
        <div class="ecom-plan-head"><h3>{{ plan.title }}</h3><span>{{ plan.ratio || '默认比例' }} · {{ plan.resolution || '默认分辨率' }}</span></div>
        <p>模型：{{ plan.modelId }}</p>
        <textarea :value="plan.prompt" rows="7" aria-label="图片提示词" @input="updatePlanPrompt" />
      </section>
      <p v-if="error" class="ecom-error">{{ error }}</p>
    </main>

    <main v-else class="ecom-body">
      <p v-if="customWorkbenchLoading" class="ecom-empty">正在加载反推工具...</p>
      <p v-else-if="customWorkbenchError" class="ecom-error">{{ customWorkbenchError }}</p>
      <p v-else-if="!customWorkbenches.length" class="ecom-empty">暂无可用的反推工具。</p>
      <section v-for="customWorkbench in customWorkbenches" :key="customWorkbench.skillId" class="ecom-section ecom-custom-workbench">
        <div class="ecom-section-head">
          <div><h3>{{ customWorkbench.title }}</h3><span>{{ customWorkbench.description }}</span></div>
        </div>
        <div class="ecom-asset-grid">
          <figure v-for="(image, index) in customImagesFor(customWorkbench)" :key="`${customWorkbench.skillId}-${index}`" class="ecom-asset">
            <img :src="image" :alt="`${customWorkbench.fields[0].label}预览`" class="ecom-asset-preview">
            <figcaption>{{ customWorkbench.fields[0].label }}</figcaption>
            <button type="button" :title="`移除${customWorkbench.fields[0].label}`" @click="removeCustomImage(customWorkbench)"><JcIcon name="close" /></button>
          </figure>
          <label class="ecom-asset ecom-asset-add">
            <JcIcon name="image_search" />
            <span>{{ customWorkbench.fields[0].label }}</span>
            <input type="file" accept="image/*" @change="addCustomImage(customWorkbench, $event)">
          </label>
        </div>
        <button class="ecom-custom-action ecom-primary" type="button" :disabled="customSubmittingSkillId === customWorkbench.skillId" @click="requestCustomWorkbench(customWorkbench)">
          <JcIcon name="auto_awesome" />{{ customSubmittingSkillId === customWorkbench.skillId ? '正在反推' : customWorkbench.action.label }}
        </button>
        <section v-if="customResultFor(customWorkbench)" class="ecom-custom-result">
          <div class="ecom-section-head"><h3>{{ customWorkbench.result.label }}</h3><button class="ecom-reference-link" type="button" @click="copyCustomResult(customWorkbench)">复制提示词</button></div>
          <pre>{{ customResultFor(customWorkbench) }}</pre>
        </section>
        <section v-if="customWorkbench.skillId === REVERSE_PROMPT_SKILL_ID" class="ecom-product-handoff">
          <div class="ecom-section-head"><div><h3>用此提示词制作商品图</h3><span>上传自己的产品图，再描述你想怎么做</span></div></div>
          <label class="ecom-handoff-intent">参考图反推提示词<textarea :value="customResultFor(customWorkbench)" rows="5" placeholder="可直接粘贴之前反推得到的提示词" @input="workbenchStore.setCustomResult(activeSessionId, customWorkbench.skillId, ($event.target as HTMLTextAreaElement).value)" /></label>
          <div class="ecom-asset-grid">
            <figure v-if="productImageHandoffFor(customWorkbench).productImage" class="ecom-asset">
              <img :src="productImageHandoffFor(customWorkbench).productImage" alt="产品图预览" class="ecom-asset-preview">
              <figcaption>自己的产品图</figcaption>
              <button type="button" title="移除产品图" @click="removeProductImageHandoff(customWorkbench)"><JcIcon name="close" /></button>
            </figure>
            <label class="ecom-asset ecom-asset-add">
              <JcIcon name="add_photo_alternate" />
              <span>{{ productImageHandoffFor(customWorkbench).productImage ? '更换自己的产品图' : '上传自己的产品图' }}</span>
              <input type="file" accept="image/*" @change="addProductImageHandoff(customWorkbench, $event)">
            </label>
          </div>
          <label class="ecom-handoff-intent">你想怎么做<textarea :value="productImageHandoffFor(customWorkbench).intent" rows="3" placeholder="例如：保持这个构图，换成我的产品；做成干净的 3:4 场景主图" @input="workbenchStore.updateProductImageHandoff(activeSessionId, customWorkbench.skillId, { intent: ($event.target as HTMLTextAreaElement).value, prompt: '' })" /></label>
          <button class="ecom-custom-action ecom-secondary" type="button" :disabled="productPromptSubmittingSkillId === customWorkbench.skillId" @click="requestProductImagePrompt(customWorkbench)"><JcIcon name="auto_awesome" />{{ productPromptSubmittingSkillId === customWorkbench.skillId ? '正在生成提示词' : '生成商品图提示词' }}</button>
          <section class="ecom-custom-result">
            <div class="ecom-section-head"><h3>商品图中文提示词</h3></div>
            <label class="ecom-handoff-intent">最终商品图提示词<textarea :value="productImageHandoffFor(customWorkbench).prompt" rows="5" placeholder="生成后会自动填入，也可以直接粘贴已有提示词" @input="workbenchStore.updateProductImageHandoff(activeSessionId, customWorkbench.skillId, { prompt: ($event.target as HTMLTextAreaElement).value })" /></label>
            <label class="ecom-handoff-ratio">比例<select :value="productImageHandoffFor(customWorkbench).ratio" @change="workbenchStore.updateProductImageHandoff(activeSessionId, customWorkbench.skillId, { ratio: ($event.target as HTMLSelectElement).value })"><option v-for="ratio in PRODUCT_IMAGE_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option></select></label>
            <button class="ecom-primary ecom-custom-action" type="button" :disabled="Boolean(taskId)" @click="requestProductImageGeneration(customWorkbench)"><JcIcon name="image" />{{ taskId ? '生成中' : '生成商品图' }}</button>
          </section>
        </section>
      </section>
      <p v-if="error" class="ecom-error">{{ error }}</p>
    </main>

    <footer v-if="activeView === 'product'" class="ecom-actions">
      <button class="ecom-secondary" type="button" :disabled="planning" @click="requestPlan"><JcIcon name="auto_awesome" />{{ planning ? '正在给方案' : '让 AI 给方案' }}</button>
      <button class="ecom-primary" type="button" :disabled="!plan || planning || Boolean(taskId)" @click="requestExecution"><JcIcon name="play_arrow" />{{ taskId ? '生成中' : '开始生成' }}</button>
    </footer>
  </section>
</template>

<style scoped>
.ecom-workbench { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--surface); color: var(--ink); }
.ecom-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--border); }
.ecom-header h2 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 700; }
.ecom-header p { margin: 2px 0 0; color: var(--ink3); font-size: 12px; }
.ecom-tabs { display: flex; gap: 8px; margin-top: 8px; }
.ecom-tabs button { padding: 0; border: 0; background: transparent; color: var(--ink3); font: inherit; font-size: 11px; cursor: pointer; }
.ecom-tabs button.active { color: var(--olive-dark); font-weight: 700; }
.ecom-collaboration, .ecom-secondary, .ecom-primary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--ink2); font: inherit; font-size: 12px; cursor: pointer; }
.ecom-collaboration:hover, .ecom-secondary:hover { background: var(--olive-pale); color: var(--olive-dark); }
.ecom-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px 18px; }
.ecom-section { margin-bottom: 18px; }
.ecom-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.ecom-section-head > div { display: grid; gap: 2px; }
.ecom-section-head h3, .ecom-plan h3 { margin: 0; font-size: 13px; font-weight: 700; }
.ecom-section-head span, .ecom-plan-head span { color: var(--ink3); font-size: 11px; }
.ecom-reference-link { display: inline-flex; align-items: center; gap: 4px; padding: 3px 0; border: 0; background: transparent; color: var(--olive-dark); font: inherit; font-size: 11px; cursor: pointer; }
.ecom-asset-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.ecom-asset { position: relative; display: flex; flex-direction: column; justify-content: center; width: 160px; height: 190px; margin: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg); color: var(--ink2); font-size: 11px; }
.ecom-asset-preview { display: block; width: 100%; height: 130px; object-fit: contain; min-height: 0; }
.ecom-asset figcaption { padding: 5px 6px; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.ecom-asset button { position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--ink2); cursor: pointer; }
.ecom-asset-add { align-items: center; justify-content: center; gap: 8px; padding: 12px; box-sizing: border-box; border-style: dashed; color: var(--olive-dark); cursor: pointer; background: color-mix(in srgb, var(--olive-pale) 36%, transparent); text-align: center; }
.ecom-asset-add input { display: none; }
.ecom-custom-workbench { display: grid; gap: 12px; }
.ecom-custom-action { width: 100%; min-height: 38px; }
.ecom-custom-result { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.ecom-custom-result .ecom-section-head { margin: 0; }
.ecom-custom-result pre { max-height: 260px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink2); font: inherit; font-size: 12px; line-height: 1.6; }
.ecom-product-handoff { display: grid; gap: 12px; padding-top: 14px; border-top: 1px solid var(--border); }
.ecom-handoff-intent, .ecom-handoff-ratio { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; }
.ecom-handoff-intent textarea, .ecom-handoff-ratio select { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 5px; padding: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; line-height: 1.55; }
.ecom-empty { margin: 0; color: var(--ink3); font-size: 12px; }
.ecom-fields { display: grid; gap: 10px; }
.ecom-fields label { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; }
.ecom-fields select, .ecom-fields textarea, .ecom-plan textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 5px; padding: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; line-height: 1.55; resize: vertical; }
.ecom-plan { padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.ecom-plan-head { display: flex; justify-content: space-between; gap: 8px; }
.ecom-plan p { margin: 7px 0; color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.ecom-error { margin: 12px 0 0; color: #b42318; font-size: 12px; line-height: 1.5; }
.ecom-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid var(--border); }
.ecom-primary { border-color: var(--olive); background: var(--olive); color: #fff; }
.ecom-primary:disabled, .ecom-secondary:disabled { opacity: .48; cursor: not-allowed; }
</style>

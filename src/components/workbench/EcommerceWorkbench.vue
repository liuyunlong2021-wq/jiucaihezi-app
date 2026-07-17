<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { useCreativeSessionStore } from '@/stores/creativeSessionStore'
import { useEcommerceWorkbenchStore } from '@/stores/ecommerceWorkbenchStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { emitEvent, onEvent } from '@/utils/eventBus'

const creativeSessionStore = useCreativeSessionStore()
const workbenchStore = useEcommerceWorkbenchStore()
const mediaTaskStore = useMediaTaskStore()
const planning = ref(false)
const error = ref('')
const activeSessionId = computed(() => creativeSessionStore.activeSessionId)
const draft = computed(() => workbenchStore.draftFor(activeSessionId.value))
const plan = computed(() => workbenchStore.planFor(activeSessionId.value))
const allImages = computed(() => [...draft.value.productImages, ...draft.value.referenceImages])
const taskId = computed(() => workbenchStore.taskIdsBySession[activeSessionId.value])

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

function openCollaboration() {
  workbenchStore.setSurface('collaboration')
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
onBeforeUnmount(() => {
  offPlanReady()
  offPlanFailed()
  offPlanSubmitted()
  offTaskSettled()
  offPlanSettled()
})
</script>

<template>
  <section class="ecom-workbench">
    <header class="ecom-header">
      <div>
        <h2>电商创作台</h2>
        <p>商品图</p>
      </div>
      <button class="ecom-collaboration" type="button" @click="openCollaboration">
        <JcIcon name="forum" />
        <span>AI 协作记录</span>
      </button>
    </header>

    <main class="ecom-body">
      <section class="ecom-section">
        <div class="ecom-section-head"><h3>商品图</h3><span>建议上传</span></div>
        <label class="ecom-upload">
          <JcIcon name="add_photo_alternate" />
          <span>上传真实商品图</span>
          <input type="file" accept="image/*" multiple @change="addImages('productImages', $event)">
        </label>
        <div v-if="draft.productImages.length" class="ecom-assets">
          <span v-for="(_, index) in draft.productImages" :key="`product-${index}`" class="ecom-asset">商品图 {{ index + 1 }}<button type="button" title="移除商品图" @click="removeImage('productImages', index)"><JcIcon name="close" /></button></span>
        </div>
      </section>

      <section class="ecom-section">
        <div class="ecom-section-head"><h3>参考图</h3><span>可选，只借鉴画面语言</span></div>
        <label class="ecom-upload quiet">
          <JcIcon name="image_search" />
          <span>添加参考图</span>
          <input type="file" accept="image/*" multiple @change="addImages('referenceImages', $event)">
        </label>
        <div v-if="draft.referenceImages.length" class="ecom-assets">
          <span v-for="(_, index) in draft.referenceImages" :key="`reference-${index}`" class="ecom-asset">参考图 {{ index + 1 }}<button type="button" title="移除参考图" @click="removeImage('referenceImages', index)"><JcIcon name="close" /></button></span>
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

    <footer class="ecom-actions">
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
.ecom-collaboration, .ecom-secondary, .ecom-primary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--ink2); font: inherit; font-size: 12px; cursor: pointer; }
.ecom-collaboration:hover, .ecom-secondary:hover { background: var(--olive-pale); color: var(--olive-dark); }
.ecom-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px 18px; }
.ecom-section { margin-bottom: 18px; }
.ecom-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.ecom-section-head h3, .ecom-plan h3 { margin: 0; font-size: 13px; font-weight: 700; }
.ecom-section-head span, .ecom-plan-head span { color: var(--ink3); font-size: 11px; }
.ecom-upload { min-height: 70px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--border); border-radius: 6px; color: var(--olive-dark); cursor: pointer; background: color-mix(in srgb, var(--olive-pale) 36%, transparent); }
.ecom-upload.quiet { min-height: 42px; color: var(--ink2); background: transparent; }
.ecom-upload input { display: none; }
.ecom-assets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ecom-asset { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; color: var(--ink2); font-size: 11px; }
.ecom-asset button { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
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

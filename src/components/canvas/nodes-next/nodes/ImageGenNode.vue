<template>
  <div class="ign-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="ign-card" :class="data.selected ? 'ign-selected' : ''">
      <div class="ign-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="ign-header-label" title="双击编辑名称">{{ data.label || '图片生成' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="ign-header-input" />
        <div class="ign-header-actions">
          <button @click="handleDuplicate" class="ign-action-btn" title="复制"><JcIcon name="content_copy" /></button>
          <button @click="handleDelete" class="ign-action-btn" title="删除"><JcIcon name="delete" /></button>
        </div>
      </div>
      <div class="ign-body" @drop.prevent="handleDrop" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" :class="{ 'ign-drag-over': dragOver }">
        <!-- 模型 -->
        <div class="ign-row">
          <span class="ign-row-label">模型</span>
          <select v-model="localModel" class="ign-select" @change="onModelChange">
            <option v-for="m in imageModelList" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div v-if="sizeOpts.length > 0" class="ign-row">
          <span class="ign-row-label">尺寸</span>
          <select v-model="localSize" class="ign-select" @change="updateConfig"><option v-for="s in sizeOpts" :key="s" :value="s">{{ s }}</option></select>
        </div>
        <div v-if="arOpts.length > 0" class="ign-row">
          <span class="ign-row-label">比例</span>
          <select v-model="localAr" class="ign-select" @change="updateConfig"><option v-for="r in arOpts" :key="r" :value="r">{{ r }}</option></select>
        </div>
        <div v-if="resOpts.length > 0" class="ign-row">
          <span class="ign-row-label">分辨率</span>
          <select v-model="localRes" class="ign-select" @change="updateConfig"><option v-for="r in resOpts" :key="r" :value="r">{{ r }}</option></select>
        </div>

        <!-- 状态徽章 -->
        <div class="ign-badges">
          <span class="ign-badge" :class="hasPrompt ? 'ign-badge-on' : 'ign-badge-off'"><span class="ign-badge-dot"></span>提示词 {{ hasPrompt ? '✓' : '○' }}</span>
          <span class="ign-badge" :class="refImages.length > 0 ? 'ign-badge-on' : 'ign-badge-off'" @click="refInput?.click()" style="cursor:pointer"><span class="ign-badge-dot"></span>参考图 {{ refImages.length || '○' }}</span>
        </div>

        <!-- 参考图缩略图 (T8 对齐) -->
        <input ref="refInput" type="file" accept="image/*" multiple style="display:none" @change="handleRefUpload" />
        <div v-if="refImages.length > 0" class="ign-ref-grid">
          <div v-for="(url, i) in refImages" :key="i" class="ign-ref-thumb">
            <img :src="url" class="ign-ref-img" />
            <button class="ign-ref-remove" @click="removeRefImage(i)">×</button>
          </div>
        </div>

        <!-- 上游素材预览 (T8 MaterialPreviewSection 对齐) -->
        <div v-if="upstreamImages.length > 0" class="ign-upstream">
          <div class="ign-upstream-label">上游素材 ({{ upstreamImages.length }})</div>
          <div class="ign-upstream-grid">
            <img v-for="(url, i) in upstreamImages.slice(0, 6)" :key="'up-' + i" :src="url" class="ign-upstream-thumb" />
          </div>
        </div>

        <!-- Model tips -->
        <div v-if="modelTip" class="ign-tip">💡 {{ modelTip }}</div>

        <!-- 结果预览 (T8 对齐: 无下游 Output 时节点内直接预览) -->
        <div v-if="resultUrl && !hasDownstreamResult" class="ign-result">
          <img :src="resultUrl" class="ign-result-img" alt="生成结果" />
        </div>

        <!-- Generate -->
        <div class="ign-gen-row">
          <button @click="handleGenerate" :disabled="!isConfigured" class="ign-gen-btn ign-gen-primary">
            <span v-if="loading" class="ign-spinner"></span>
            <JcIcon v-else name="add" />
            {{ loading ? '生成中...' : '新建生成' }}
          </button>
          <button @click="handleGenerate" :disabled="!isConfigured" class="ign-gen-btn ign-gen-secondary">
            <JcIcon name="refresh" /> 替换
          </button>
        </div>
        <div v-if="error" class="ign-error">{{ error }}</div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="ign-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="imageGen" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { onEvent } from '@/utils/eventBus'
import { getApiKey } from '@/services/newApiClient'
import { CREATION_PANEL_MODELS } from '@/composables/useCreation'
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'

const props = defineProps<{ id: string; data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const mediaTaskStore = useMediaTaskStore()
const { updateNodeInternals, addEdges } = useVueFlow()
const isConfigured = computed(() => !!getApiKey())

// ─── 参考图管理 (T8 referenceImages 对齐) ───
const refInput = ref<HTMLInputElement | null>(null)
const refImages = ref<string[]>(Array.isArray(props.data?.referenceImages) ? props.data.referenceImages : [])

function handleRefUpload(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    const url = URL.createObjectURL(files[i])
    refImages.value = [...refImages.value, url]
  }
  saveRefImages()
}
function removeRefImage(i: number) {
  refImages.value = refImages.value.filter((_, idx) => idx !== i)
  saveRefImages()
}
function saveRefImages() {
  canvasStore.updateNodeData(props.id, { referenceImages: refImages.value })
}

// ─── 上游素材聚合 (T8 useUpstreamMaterials 对齐) ───
const upstreamImages = computed(() => {
  const urls: string[] = []
  for (const e of canvasStore.edges) {
    if (e.target !== props.id) continue
    const s = canvasStore.nodes.find(n => n.id === e.source)
    if (!s?.data) continue
    const d = s.data as any
    if (d.url && (s.type === 'imageResult' || s.type === 'imageGen')) urls.push(d.url)
    if (d.imageUrl) urls.push(d.imageUrl)
    if (Array.isArray(d.urls)) urls.push(...d.urls)
  }
  return [...new Set(urls.filter(Boolean))]
})

// ─── 结果预览 + 下游检测 ───
const resultUrl = computed(() => props.data?.resultUrl || '')
const hasDownstreamResult = computed(() =>
  canvasStore.edges.some(e => {
    if (e.source !== props.id) return false
    const t = canvasStore.nodes.find(n => n.id === e.target)
    return t?.type === 'imageResult'
  })
)

// ─── 拖拽投放 (T8 useMaterialDropTarget 对齐) ───
const dragOver = ref(false)
function handleDrop(e: DragEvent) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) {
      refImages.value = [...refImages.value, URL.createObjectURL(files[i])]
    }
  }
  if (refImages.value.length > 0) saveRefImages()
}

const imageModelList = computed(() =>
  Object.entries(CREATION_PANEL_MODELS)
    .filter(([, m]) => m.tasks?.includes('image') && (m.capability as any)?.webappId != null)
    .map(([key, m]) => ({ id: key, label: m.label }))
)

const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false); const error = ref('')

const localModel = ref(props.data?.modelId || imageModelList.value[0]?.id || '')
const localSize = ref(props.data?.size || 'auto')
const localAr = ref(props.data?.ar || '1:1')
const localRes = ref(props.data?.res || '2k')

const currentModel = computed(() => CREATION_PANEL_MODELS[localModel.value])

const sizeOpts = computed(() => currentModel.value?.sizes || [])
const arOpts = computed(() => currentModel.value?.ar || [])
const resOpts = computed(() => currentModel.value?.res || [])

// 模型提示（从 CREATION_PANEL_MODELS 的 capability 字段提取）
const modelTip = computed(() => {
  const m = CREATION_PANEL_MODELS[localModel.value] as any
  if (!m?.capability?.fields) return ''
  const tipField = m.capability.fields.find((f: any) => f.key === 'tips')
  return tipField?.defaultValue || ''
})

const hasPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))
const operations: NodeHandleOperation[] = [
  { type: 'imageResult', label: '图片结果', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
]

function onModelChange() {
  const m = currentModel.value
  if (m?.defSize) localSize.value = m.defSize
  else if (sizeOpts.value.length > 0) localSize.value = sizeOpts.value[0]
  if (m?.defAr) localAr.value = m.defAr
  else if (arOpts.value.length > 0) localAr.value = arOpts.value[0]
  if (m?.defRes) localRes.value = m.defRes
  else if (resOpts.value.length > 0) localRes.value = resOpts.value[0]
  updateConfig()
}

const handleGenerate = async () => {
  if (!isConfigured.value) { error.value = '请先配置 API Key'; return }
  loading.value = true; error.value = ''
  try {
    const prompt = (() => {
      for (const e of canvasStore.edges.filter(e => e.target === props.id)) {
        const s = canvasStore.nodes.find(n => n.id === e.source)
        if (s?.type === 'text' && (s.data as any)?.content) return (s.data as any).content
        if (s?.type === 'llm' && (s.data as any)?.outputContent) return (s.data as any).outputContent
      }
      return props.data?.prompt || 'a beautiful image'
    })()
    const modelName = currentModel.value?.modelName || localModel.value
    const modelLabel = currentModel.value?.label || localModel.value
    // ★ 用 buildCreationRunPlan 构造完整 plan：跟创作面板走完全相同的路径
    //   先从模型 fields 物化所有默认值（outputFormat='png', lora_strength=1 等），
    //   然后 UI 选项覆盖。对齐 useCreation.ts:385 modelFieldParams() 逻辑。
    const planParams: Record<string, any> = { prompt: prompt || 'a beautiful image' }
    const fields = (currentModel.value as any)?.capability?.fields || []
    const SKIP_KINDS = new Set(['prompt', 'image', 'images', 'video', 'audio'])
    for (const f of fields) {
      if (SKIP_KINDS.has(f.kind)) continue
      if (f.defaultValue !== undefined) planParams[f.key] = f.defaultValue
    }
    if (sizeOpts.value.length > 0) planParams.size = localSize.value
    if (arOpts.value.length > 0) planParams.aspectRatio = localAr.value
    if (resOpts.value.length > 0) planParams.resolution = localRes.value
    const plan = buildCreationRunPlan({ modelId: localModel.value, params: planParams })
    // ★ 火宝模式：先建占位节点 + 连线，再提交任务
    const cn = canvasStore.nodes.find(n => n.id === props.id)
    const posX = (cn?.position?.x || 0) + 380
    const posY = (cn?.position?.y || 0) + (canvasStore.edges.filter(e => e.source === props.id).length * 280)
    const placeholderNode = canvasStore.addNodeWithData('imageResult', { url: '', loading: true, label: '生成中...', modelId: localModel.value } as any, { x: posX, y: posY })
    const newEdge = canvasStore.addEdge(props.id, placeholderNode.id, {})
    console.warn('[ImageGen] 占位节点:', placeholderNode.id, '连线已添加:', newEdge?.id)
    setTimeout(() => updateNodeInternals([placeholderNode.id]), 50)
    const placeholderId = placeholderNode.id
    const taskId = await mediaTaskStore.submitTask({
      type: 'image',
      model: modelName,
      modelLabel,
      prompt: prompt || 'a beautiful image',
      source: 'creation',
      plan,
    })
    console.warn('[ImageGen] submitTask 返回 taskId:', taskId)
    const unsubscribe = onEvent('media-task-settled', (payload: any) => {
      console.warn('[ImageGen] media-task-settled 收到:', payload.status, payload.url?.slice(0,50), payload.errorMsg)
      if (payload.taskId !== taskId) return
      unsubscribe()
      if (payload.status === 'success' && payload.url) {
        canvasStore.updateNodeData(props.id, { resultUrl: payload.url })
        canvasStore.updateNodeData(placeholderId, { url: payload.url, loading: false, label: '生成结果' } as any)
      } else {
        canvasStore.updateNodeData(placeholderId, { loading: false, error: payload.errorMsg || '生成失败' } as any)
        error.value = payload.errorMsg || '生成失败'
      }
      loading.value = false
    })
  } catch (err: any) {
    error.value = err.message || '生成失败'
    loading.value = false
  }
}

let ut: any = null
const updateConfig = () => { if (ut) clearTimeout(ut); ut = setTimeout(() => canvasStore.updateNodeData(props.id, { modelId: localModel.value, size: localSize.value, ar: localAr.value, res: localRes.value }), 150) }

const handleSelect = (item: NodeHandleOperation) => {
  const cn = canvasStore.nodes.find(n => n.id === props.id)
  const n = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, { x: (cn?.position?.x || 0) + 380, y: cn?.position?.y || 0 })
  canvasStore.addEdge(props.id, n.id, {}); setTimeout(() => updateNodeInternals([n.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.ign-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.ign-card { position: relative; background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 300px; transition: all 0.2s; }
.ign-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }
.ign-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.ign-header-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.ign-header-label:hover { background: var(--surface); }
.ign-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; }
.ign-header-actions { display: flex; gap: 1px; }
.ign-action-btn { padding: 2px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.ign-action-btn:hover { background: var(--surface); color: var(--ink); }
.ign-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ign-row { display: flex; align-items: center; justify-content: space-between; }
.ign-row-label { font-size: 12px; color: var(--ink2); }
.ign-select { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; cursor: pointer; font-family: var(--jc-font-body); max-width: 180px; }
.ign-select:focus { border-color: #3b82f6; }
.ign-badges { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.ign-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 10px; border-radius: 999px; }
.ign-badge-on { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.ign-badge-off { background: var(--surface); color: var(--ink3); }
.ign-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
.ign-badge-on .ign-badge-dot { background: #22c55e; }
.ign-badge-off .ign-badge-dot { background: var(--ink3); }
.ign-tip { font-size: 11px; color: var(--ink3); background: var(--surface); border-radius: 6px; padding: 6px 8px; }
.ign-gen-row { display: flex; gap: 6px; }
.ign-gen-btn { flex: 1; padding: 8px; font-size: 12px; border-radius: 8px; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; font-family: var(--jc-font-body); transition: background 0.15s; }
.ign-gen-primary { background: #3b82f6; }
.ign-gen-primary:hover:not(:disabled) { background: #2563eb; }
.ign-gen-secondary { background: transparent; color: var(--ink2); border: 1px solid var(--border); }
.ign-gen-secondary:hover:not(:disabled) { border-color: #3b82f6; color: #3b82f6; }
.ign-error { font-size: 11px; color: #ef4444; }
.ign-target-handle { background: #3b82f6 !important; }
.ign-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: ign-spin 0.6s linear infinite; display: inline-block; }

/* 参考图缩略图 (T8 对齐) */
.ign-ref-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.ign-ref-thumb { position: relative; width: 52px; height: 52px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
.ign-ref-img { width: 100%; height: 100%; object-fit: cover; }
.ign-ref-remove { position: absolute; top: 0; right: 0; width: 16px; height: 16px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 0 0 0 4px; cursor: pointer; font-size: 10px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.ign-ref-remove:hover { background: #ef4444; }

/* 上游素材预览 (T8 MaterialPreviewSection 对齐) */
.ign-upstream { padding-top: 4px; }
.ign-upstream-label { font-size: 10px; color: var(--ink3); margin-bottom: 4px; }
.ign-upstream-grid { display: flex; gap: 3px; flex-wrap: wrap; }
.ign-upstream-thumb { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border); }

/* 结果预览 (T8 对齐) */
.ign-result { margin-top: 6px; }
.ign-result-img { width: 100%; max-height: 200px; object-fit: contain; border-radius: 8px; border: 1px solid var(--border); background: #0003; }

/* 拖拽高亮 */
.ign-drag-over { outline: 2px dashed #3b82f6; outline-offset: -2px; }
@keyframes ign-spin { to { transform: rotate(360deg); } }
</style>

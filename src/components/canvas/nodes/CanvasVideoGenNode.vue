<script setup lang="ts">
/**
 * CanvasVideoGenNode — Phase C，对齐 T8 VideoNode.tsx
 * Veo 3.1 / Grok Video 双TAB，FAL支持
 */
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useUpdateNodeData } from '@/canvas/composables/useUpdateNodeData'
import { useUpstreamMaterials } from '@/canvas/composables/useUpstreamMaterials'
import { useOrderedMaterials } from '@/canvas/composables/useOrderedMaterials'
import { useHasAutoOutput } from '@/canvas/composables/useHasAutoOutput'
import { useRunTrigger } from '@/canvas/composables/useRunTrigger'
import { useMaterialDropTarget } from '@/canvas/composables/useMaterialDropTarget'
import { type MaterialPayload } from '@/stores/canvasDragMaterialStore'
import { canvasLogBus } from '@/stores/canvasLogsStore'
import MentionPromptInput from '@/components/canvas/shared/MentionPromptInput.vue'
import { VIDEO_MODELS, VIDEO_FAL_REGISTRY, VEO_FAL_RATIOS, VEO_FAL_DURATIONS, VEO_FAL_RESOLUTIONS, GROK_FAL_RATIOS, GROK_FAL_RESOLUTIONS, isFalVideoModel } from '@/canvas/providers/canvasModels'
import { submitVideo, queryVideo, submitVideoFal, queryVideoFal, uploadFile } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const update = useUpdateNodeData(props.id)
const hasAutoOutput = useHasAutoOutput(props.id)
const d = computed(() => props.data || {})
const model = computed(() => d.value.model || VIDEO_MODELS[0].id)
const modelDef = computed(() => VIDEO_MODELS.find(m => m.id === model.value) || VIDEO_MODELS[0])
const apiModel = computed(() => d.value.apiModel || modelDef.value.apiModelOptions[0]?.value || model.value)
const ratio = computed(() => d.value.aspectRatio || d.value.ratio || modelDef.value.defaultRatio)
const duration = computed(() => d.value.duration ?? modelDef.value.defaultDuration ?? 6)
const resolution = computed(() => d.value.resolution || modelDef.value.defaultResolution || '720P')
const status = computed<string>(() => d.value.status || 'idle')
const videoUrl = computed(() => d.value.videoUrl || d.value.outputUrl || '')
const localPrompt = computed(() => d.value.prompt || '')
const refImages = computed<string[]>(() => Array.isArray(d.value.referenceImages) ? d.value.referenceImages : [])
const maxRefs = computed(() => modelDef.value.maxRefImages || 3)
const isFal = computed(() => isFalVideoModel(apiModel.value))
const falDef = computed(() => isFal.value ? VIDEO_FAL_REGISTRY[apiModel.value] : undefined)

const error = ref<string | null>(null)
const abortCtrl = ref<AbortController | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const src = `video:${props.id.slice(0, 6)}`

const upstream = useUpstreamMaterials(props.id)
const materialOrder = computed<string[]>(() => Array.isArray(d.value.materialOrder) ? d.value.materialOrder : [])
const orderedTexts = useOrderedMaterials(upstream.texts.value, materialOrder.value)
const orderedImgs = useOrderedMaterials(upstream.images.value, materialOrder.value)
const upstreamPrompt = computed(() => (orderedTexts as any[]).map((t: any) => t.url).filter(Boolean).join('\n').trim())
const upstreamImages = computed(() => (orderedImgs as any[]).map((m: any) => m.url).filter(Boolean).slice(0, maxRefs.value))
const finalPrompt = computed(() => (upstreamPrompt.value || localPrompt.value || '').trim())

function switchModel(mId: string) {
  const def = VIDEO_MODELS.find(m => m.id === mId)
  if (!def) return
  update({ model: mId, apiModel: def.apiModelOptions[0]?.value || mId, aspectRatio: def.defaultRatio, duration: def.defaultDuration, resolution: def.defaultResolution, referenceImages: [] })
  error.value = null
}

async function handlePickFile() { fileInputRef.value?.click() }
async function handleFiles(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || [])
  if (!files.length) return
  const remain = maxRefs.value - refImages.value.length
  const accepted = files.slice(0, Math.max(0, remain))
  error.value = null
  try {
    for (const f of accepted) {
      const r = await uploadFile(f)
      refImages.value.push(r.url)
    }
    update({ referenceImages: [...refImages.value] })
  } catch (e: any) { error.value = e?.message || '上传失败' }
  finally { if (fileInputRef.value) fileInputRef.value.value = '' }
}

async function handleGenerate() {
  error.value = null
  if (!finalPrompt.value && !upstreamImages.value.length && !refImages.value.length) { error.value = '请输入 prompt 或添加参考图'; return }
  if (status.value === 'generating') return
  const allRefs = [...upstreamImages.value, ...refImages.value]
  update({ status: 'generating', error: '', videoUrl: '' })
  canvasLogBus.info(`[${modelDef.value.label}] 开始生成`, src)
  abortCtrl.value = new AbortController()
  try {
    if (isFal.value && falDef.value) {
      const r = await submitVideoFal({
        apiModel: apiModel.value,
        prompt: finalPrompt.value,
        images: allRefs,
        aspect_ratio: falDef.value.paramKind === 'veo-fal' ? ratio.value : undefined,
        duration: falDef.value.paramKind === 'veo-fal' ? '8s' : undefined,
        resolution: resolution.value,
        gkDuration: falDef.value.paramKind === 'grok-fal' ? duration.value : undefined,
        gkRatio: falDef.value.paramKind === 'grok-fal' ? ratio.value : undefined,
      })
      if (r.sync && r.videoUrl) { update({ status: 'success', progress: '100%', videoUrl: r.videoUrl }); return }
      update({ progress: '5%', taskId: r.requestId })
      for (let i = 0; i < 600; i++) {
        if (abortCtrl.value?.signal.aborted) { update({ status: 'idle' }); return }
        await new Promise(r => setTimeout(r, 3000))
        const q = await queryVideoFal({ requestId: r.requestId, responseUrl: r.responseUrl, endpoint: r.endpoint })
        if (q.status === 'completed' && q.videoUrl) { update({ status: 'success', progress: '100%', videoUrl: q.videoUrl }); canvasLogBus.success(`FAL完成`, src); return }
        if (q.status === 'failed') throw new Error(q.error || 'FAL失败')
      }
      throw new Error('FAL超时')
    }
    const r = await submitVideo({ model: apiModel.value, prompt: finalPrompt.value, aspect_ratio: ratio.value, duration: duration.value, resolution: resolution.value, images: allRefs })
    update({ progress: '5%', taskId: r.taskId })
    canvasLogBus.info(`视频任务 taskId=${r.taskId}`, src)
    for (let i = 0; i < 600; i++) {
      if (abortCtrl.value?.signal.aborted) { update({ status: 'idle' }); return }
      await new Promise(r => setTimeout(r, 5000))
      const q = await queryVideo(r.taskId, apiModel.value)
      if (q.progress) update({ progress: q.progress })
      if (q.status === 'SUCCESS') { update({ status: 'success', progress: '100%', videoUrl: q.videoUrl || '' }); canvasLogBus.success(`完成`, src); return }
      if (q.status === 'FAILURE') throw new Error(q.failReason || '失败')
    }
    throw new Error('轮询超时')
  } catch (e: any) { error.value = e?.message || '生成失败'; update({ status: 'error', error: e?.message }); canvasLogBus.error(`失败: ${error.value}`, src) }
  finally { abortCtrl.value = null }
}

function handleCancel() { abortCtrl.value?.abort(); update({ status: 'idle' }); canvasLogBus.warn(`取消`, src) }
useRunTrigger(props.id, handleGenerate)

const { dropProps, isAccepting } = useMaterialDropTarget({
  id: props.id, accepts: ['image', 'text'],
  onDrop: (p: MaterialPayload) => {
    if (p.kind === 'image' && p.url && refImages.value.length < maxRefs.value) update({ referenceImages: [...refImages.value, p.url] })
    else if (p.kind === 'text' && p.text) update({ prompt: p.text })
  },
})
</script>

<template>
  <div class="vn" :class="{ sel: selected, acc: isAccepting }" v-bind="dropProps" :style="{ borderColor: isAccepting ? '#22c55e' : selected ? '#f43f5e' : 'var(--border)' }">
    <Handle type="target" :position="Position.Left" :style="{ background: '#f43f5e', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#f43f5e', width: 10, height: 10, border: 'none' }" />

    <div class="vn-hd">
      <div class="vn-hd-ic" style="background: rgba(244,63,94,.18); color: #fda4af; box-shadow: inset 0 0 0 1px rgba(244,63,94,.4)">
        <span class="mso" style="font-size:13px">movie</span>
      </div>
      <div class="vn-hd-tx"><div class="vn-hd-tt">视频</div><div class="vn-hd-sub">{{ modelDef.label }} · {{ modelDef.description }}</div></div>
    </div>

    <div class="vn-bd" @mousedown.stop>
      <!-- TAB -->
      <div>
        <label class="vn-lb">模型</label>
        <div class="vn-tabs">
          <button v-for="m in VIDEO_MODELS.slice(0, 2)" :key="m.id" :class="{ on: model === m.id }" @click="switchModel(m.id)">{{ m.label }}</button>
        </div>
      </div>

      <!-- 子模型 -->
      <div>
        <label class="vn-lb">具体模型</label>
        <select class="vn-inp" :value="apiModel" @change="update({ apiModel: ($event.target as HTMLSelectElement).value })">
          <option v-for="opt in modelDef.apiModelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <!-- 参数 -->
      <div class="vn-grid2">
        <div><label class="vn-lb">比例</label>
          <select class="vn-inp" :value="ratio" @change="update({ aspectRatio: ($event.target as HTMLSelectElement).value, ratio: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in modelDef.ratios" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div v-if="modelDef.durations"><label class="vn-lb">时长(s)</label>
          <select class="vn-inp" :value="duration" @change="update({ duration: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="d in modelDef.durations" :key="d" :value="d">{{ d }}s</option>
          </select>
        </div>
      </div>
      <div v-if="modelDef.resolutions">
        <label class="vn-lb">分辨率</label>
        <select class="vn-inp" :value="resolution" @change="update({ resolution: ($event.target as HTMLSelectElement).value })">
          <option v-for="r in modelDef.resolutions" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>

      <!-- 参考图 -->
      <div>
        <label class="vn-lb">参考图 · 上游{{ upstreamImages.length }} + 本地{{ refImages.length }} / {{ maxRefs }}</label>
        <div class="vn-refs">
          <img v-for="(u, i) in upstreamImages" :key="'u'+i" :src="u" class="vn-ref-th" />
          <img v-for="(u, i) in refImages" :key="'r'+i" :src="u" class="vn-ref-th" @dblclick.stop="update({ referenceImages: refImages.filter((_,j)=>j!==i) })" title="双击移除" />
          <button v-if="(upstreamImages.length+refImages.length) < maxRefs" class="vn-ref-add" @click="handlePickFile"><span class="mso" style="font-size:14px">add</span></button>
        </div>
        <input ref="fileInputRef" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      </div>

      <!-- Prompt -->
      <div>
        <label class="vn-lb">Prompt{{ upstreamPrompt ? ' (优先取上游)' : '' }}</label>
        <MentionPromptInput :modelValue="localPrompt" :placeholder="upstreamPrompt || '描述你想生成的视频...'" @update:modelValue="(v:string)=>update({prompt:v})" />
      </div>

      <!-- 按钮 -->
      <button v-if="status!=='generating'" class="vn-run" @click="handleGenerate"><span class="mso" style="font-size:12px">auto_awesome</span> 生成</button>
      <button v-else class="vn-stop" @click="handleCancel"><span class="mso vn-spin" style="font-size:12px">progress_activity</span> {{ d.progress || '生成中' }} · 取消</button>
      <div v-if="error" class="vn-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
    </div>

    <div v-if="videoUrl && !hasAutoOutput" class="vn-out"><video :src="videoUrl" controls class="vn-out-vid" /></div>
  </div>
</template>

<style scoped>
.vn { width: 320px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.vn.sel { border-color: #f43f5e; box-shadow: 0 0 20px rgba(244,63,94,.2); }
.vn.acc { box-shadow: 0 0 0 3px rgba(34,197,94,.2); }
.vn-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.vn-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.vn-hd-tx { flex: 1; min-width: 0; }
.vn-hd-tt { font-size: 13px; font-weight: 600; }
.vn-hd-sub { font-size: 10px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vn-bd { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.vn-lb { font-size: 10px; color: var(--ink3); display: block; margin-bottom: 4px; }
.vn-tabs { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); }
.vn-tabs button { flex: 1; padding: 4px 6px; border: none; border-radius: 4px; background: none; font-size: 10px; font-weight: 600; color: var(--ink3); cursor: pointer; }
.vn-tabs button.on { background: rgba(244,63,94,.25); color: #f43f5e; }
.vn-inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; }
.vn-inp:focus { border-color: #f43f5e; }
.vn-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vn-refs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.vn-ref-th { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; background: #0003; }
.vn-ref-add { width: 48px; height: 48px; border: 2px dashed var(--border); border-radius: 4px; background: var(--surface); color: var(--ink3); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.vn-ref-add:hover { border-color: #f43f5e; color: #f43f5e; }
.vn-run { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: rgba(244,63,94,.2); color: #f43f5e; font-size: 12px; font-weight: 500; cursor: pointer; }
.vn-stop { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: var(--surface-alt); color: var(--ink2); font-size: 12px; cursor: pointer; }
.vn-spin { animation: vn-spin 1s linear infinite; } @keyframes vn-spin { to { transform: rotate(360deg); } }
.vn-err { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 4px; padding: 4px 8px; }
.vn-out { border-top: 1px solid var(--border2); padding: 8px; }
.vn-out-vid { width: 100%; border-radius: 6px; display: block; }
</style>

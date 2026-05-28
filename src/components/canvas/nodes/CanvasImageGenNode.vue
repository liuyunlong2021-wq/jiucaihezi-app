<script setup lang="ts">
/**
 * CanvasImageGenNode — Phase B 重写，对齐 T8 ImageNode.tsx (1191行)
 *
 * 功能: GPT Image 2 / Nano Banana 2 / Nano Banana Pro 三模型TAB
 *       FAL渠道支持 / MJ跳过 / 上游素材聚合 / 拖拽参考图 / 运行总线
 */
import { ref, computed, useTemplateRef } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useUpdateNodeData } from '@/canvas/composables/useUpdateNodeData'
import { useUpstreamMaterials } from '@/canvas/composables/useUpstreamMaterials'
import { useOrderedMaterials } from '@/canvas/composables/useOrderedMaterials'
import { useHasAutoOutput } from '@/canvas/composables/useHasAutoOutput'
import { useRunTrigger } from '@/canvas/composables/useRunTrigger'
import { useMaterialDropTarget } from '@/canvas/composables/useMaterialDropTarget'
import { type MaterialPayload } from '@/stores/canvasDragMaterialStore'
import { canvasLogBus } from '@/stores/canvasLogsStore'
import MaterialPreviewSection from '@/components/canvas/shared/MaterialPreviewSection.vue'
import MentionPromptInput from '@/components/canvas/shared/MentionPromptInput.vue'
import {
  IMAGE_MODELS, FAL_REGISTRY, GPT_FAL_SIZES, NBPRO_FAL_RATIOS, NBPRO_FAL_RESOLUTIONS, isFalModel,
} from '@/canvas/providers/canvasModels'
import { submitImageAsync, queryImageStatus, submitImageFal, queryImageFal, uploadFile } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const update = useUpdateNodeData(props.id)
const hasAutoOutput = useHasAutoOutput(props.id)

// ── 模型与参数 ──
const d = computed(() => props.data || {})
const model = computed(() => d.value.model || IMAGE_MODELS[0].id)
const modelDef = computed(() => IMAGE_MODELS.find(m => m.id === model.value) || IMAGE_MODELS[0])
const apiModel = computed(() => d.value.apiModel || modelDef.value.apiModel)
const aspectRatio = computed(() => d.value.aspectRatio || modelDef.value.defaultAspectRatio)
const sizeLevel = computed(() => d.value.sizeLevel || modelDef.value.defaultSize)
const status = computed< string>(() => d.value.status || 'idle')
const imageUrl = computed(() => d.value.imageUrl as string | undefined)
const localPrompt = computed(() => d.value.prompt || '')
const refImages = computed<string[]>(() => Array.isArray(d.value.referenceImages) ? d.value.referenceImages : [])
const maxRefs = computed(() => modelDef.value.maxReferenceImages || 5)

// ── FAL ──
const isFal = computed(() => isFalModel(apiModel.value))
const falDef = computed(() => isFal.value ? FAL_REGISTRY[apiModel.value] : undefined)
const falKind = computed(() => falDef.value?.paramKind)
const falMode = computed({ get: () => d.value.falMode || 'edit', set: v => update({ falMode: v }) })
const falSize = computed({ get: () => d.value.falSize || 'auto', set: v => update({ falSize: v }) })
const falQuality = computed({ get: () => d.value.falQuality || 'medium', set: v => update({ falQuality: v }) })
const falN = computed({ get: () => d.value.falN ?? 1, set: v => update({ falN: Number(v) }) })
const falFormat = computed({ get: () => d.value.falFormat || 'png', set: v => update({ falFormat: v }) })
const falSync = computed({ get: () => d.value.falSync === true, set: v => update({ falSync: v }) })
const nbAspect = computed({ get: () => d.value.nbAspect || 'auto', set: v => update({ nbAspect: v }) })
const nbResolution = computed({ get: () => d.value.nbResolution || '2K', set: v => update({ nbResolution: v }) })
const nbSafety = computed({ get: () => d.value.nbSafety || '4', set: v => update({ nbSafety: v }) })

const error = ref<string | null>(null)
const abortCtrl = ref<AbortController | null>(null)
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')
const src = `image:${props.id.slice(0, 6)}`

// ── 上游素材 ──
const upstream = useUpstreamMaterials(props.id)
const materialOrder = computed<string[]>(() => Array.isArray(d.value.materialOrder) ? d.value.materialOrder : [])
const orderedTexts = useOrderedMaterials(upstream.texts.value, materialOrder.value)
const orderedImgs = useOrderedMaterials(upstream.images.value, materialOrder.value)
const upstreamPrompt = computed(() => (orderedTexts as any[]).map((t: any) => t.url).filter(Boolean).join('\n').trim())
const upstreamImages = computed(() => (orderedImgs as any[]).map((m: any) => m.url).filter(Boolean))
const finalPrompt = computed(() => (upstreamPrompt.value || localPrompt.value || '').trim())

// ── 切换模型 ──
function switchModel(mId: string) {
  const def = IMAGE_MODELS.find(m => m.id === mId)
  if (!def) return
  update({ model: mId, apiModel: def.apiModel, aspectRatio: def.defaultAspectRatio, sizeLevel: def.defaultSize, referenceImages: [] })
  error.value = null
}

// ── 本地上传参考图 ──
async function handlePickFile() { fileInputRef.value?.click() }
async function handleFiles(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || [])
  if (!files.length) return
  const remain = maxRefs.value - refImages.value.length
  const accepted = files.slice(0, Math.max(0, remain))
  error.value = null
  try {
    const uploaded: string[] = []
    for (const f of accepted) {
      const r = await uploadFile(f)
      uploaded.push(r.url)
    }
    update({ referenceImages: [...refImages.value, ...uploaded] })
  } catch (e: any) { error.value = e?.message || '上传失败' }
  finally { if (fileInputRef.value) fileInputRef.value.value = '' }
}

// ── 生成 ──
async function handleGenerate() {
  error.value = null
  if (!finalPrompt.value && upstreamImages.value.length === 0 && refImages.value.length === 0) {
    error.value = '请输入 prompt 或添加参考图'; return
  }
  if (status.value === 'generating') return

  const allRefs = [...upstreamImages.value, ...refImages.value].slice(0, maxRefs.value)
  update({ status: 'generating', error: null, imageUrl: '' })
  canvasLogBus.info(`[${modelDef.value.label}] 开始生成`, src)
  abortCtrl.value = new AbortController()

  try {
    if (isFal.value && falDef.value) {
      const submit = await submitImageFal({
        apiModel: apiModel.value,
        prompt: finalPrompt.value,
        images: allRefs,
        n: falKind.value === 'gpt-fal' ? falN.value : 1,
        format: falFormat.value as any,
        sync: falSync.value,
        mode: falKind.value === 'gpt-fal' ? (falMode.value as 'edit'|'gen') : undefined,
        size: falKind.value === 'gpt-fal' ? falSize.value : undefined,
        quality: falKind.value === 'gpt-fal' ? (falQuality.value as any) : undefined,
        aspect_ratio: falKind.value === 'nbpro-fal' ? nbAspect.value : undefined,
        resolution: falKind.value === 'nbpro-fal' ? nbResolution.value : undefined,
        safety_tolerance: falKind.value === 'nbpro-fal' ? nbSafety.value : undefined,
      })
      if (submit.sync && submit.urls?.length) {
        update({ status: 'success', progress: '100%', imageUrl: submit.urls[0], lastPrompt: finalPrompt.value })
        canvasLogBus.success(`FAL同步返回`, src)
        return
      }
      const { requestId, responseUrl, endpoint } = submit
      if (!requestId || !responseUrl) throw new Error('FAL 未返回 request_id')
      update({ progress: '5%', taskId: requestId })
      for (let i = 0; i < 600; i++) {
        if (abortCtrl.value?.signal.aborted) { update({ status: 'idle' }); return }
        await new Promise(r => setTimeout(r, 3000))
        const q = await queryImageFal({ responseUrl, endpoint, requestId })
        if (q.status === 'completed') {
          const url = q.urls?.[0]; if (!url) throw new Error('FAL 未返回图片')
          update({ status: 'success', progress: '100%', imageUrl: url, lastPrompt: finalPrompt.value })
          canvasLogBus.success(`FAL完成`, src)
          return
        }
        if (q.status === 'failed') throw new Error(q.error || 'FAL 失败')
      }
      throw new Error('FAL 超时')
    }

    // 标准路径
    const submit = await submitImageAsync({
      model: modelDef.value.id,
      apiModel: apiModel.value,
      paramKind: modelDef.value.paramKind,
      prompt: finalPrompt.value,
      aspect_ratio: aspectRatio.value,
      image_size: sizeLevel.value,
      images: allRefs,
      n: 1,
    })

    if (submit.sync && submit.urls?.length) {
      update({ status: 'success', progress: '100%', imageUrl: submit.urls[0], lastPrompt: finalPrompt.value })
      canvasLogBus.success(`同步返回`, src)
      return
    }

    const taskId = submit.taskId
    if (!taskId) throw new Error('未获取 taskId')
    update({ progress: '5%', taskId })
    canvasLogBus.info(`异步任务 taskId=${taskId}`, src)
    for (let i = 0; i < 1800; i++) {
      if (abortCtrl.value?.signal.aborted) { update({ status: 'idle' }); return }
      await new Promise(r => setTimeout(r, 2000))
      const q = await queryImageStatus(taskId, apiModel.value)
      const st = String(q.status || '').toLowerCase()
      if (q.progress) update({ progress: q.progress })
      if (st === 'completed' || st === 'success' || st === 'done') {
        const url = q.urls?.[0]; if (!url) throw new Error('未返回图片')
        update({ status: 'success', progress: '100%', imageUrl: url, lastPrompt: finalPrompt.value })
        canvasLogBus.success(`完成`, src)
        return
      }
      if (st === 'failed' || st === 'failure' || st === 'error') throw new Error(q.error || '任务失败')
    }
    throw new Error('轮询超时')
  } catch (e: any) {
    error.value = e?.message || '生成失败'
    update({ status: 'error', error: e?.message })
    canvasLogBus.error(`失败: ${error.value}`, src)
  } finally { abortCtrl.value = null }
}

function handleCancel() {
  abortCtrl.value?.abort()
  update({ status: 'idle' })
  canvasLogBus.warn(`用户取消`, src)
}

useRunTrigger(props.id, handleGenerate)

// ── 拖拽接收 ──
const { dropProps, isAccepting } = useMaterialDropTarget({
  id: props.id, accepts: ['image', 'text'],
  onDrop: (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = refImages.value
      if (cur.includes(payload.url) || cur.length >= maxRefs.value) return
      update({ referenceImages: [...cur, payload.url] })
    } else if (payload.kind === 'text' && payload.text) {
      update({ prompt: payload.text })
    }
  },
})
</script>

<template>
  <div class="ign" :class="{ sel: selected, acc: isAccepting }" v-bind="dropProps">
    <Handle type="target" :position="Position.Left" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />

    <!-- 头部 -->
    <div class="ign-hd">
      <div class="ign-hd-ic" style="background: rgba(245,158,11,.18); color: #fcd34d; box-shadow: inset 0 0 0 1px rgba(245,158,11,.4)">
        <span class="mso" style="font-size:13px">image</span>
      </div>
      <div class="ign-hd-tx">
        <div class="ign-hd-tt">图像</div>
        <div class="ign-hd-sub">{{ modelDef.label }} · {{ modelDef.description }}</div>
      </div>
    </div>

    <div class="ign-bd" @mousedown.stop>
      <!-- 模型 TAB -->
      <div>
        <label class="ign-lb">模型</label>
        <div class="ign-tabs">
          <button v-for="m in IMAGE_MODELS.slice(0, 3)" :key="m.id" :class="{ on: model === m.id }" @click="switchModel(m.id)" :title="m.description">
            {{ m.tabLabel }}
          </button>
        </div>
      </div>

      <!-- 子模型 -->
      <div>
        <label class="ign-lb">具体模型</label>
        <select class="ign-inp" :value="apiModel" @change="update({ apiModel: ($event.target as HTMLSelectElement).value })">
          <option v-for="opt in modelDef.apiModelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <!-- 比例 + 尺寸 (非 FAL) -->
      <template v-if="!isFal">
        <div class="ign-grid2">
          <div>
            <label class="ign-lb">比例</label>
            <select class="ign-inp" :value="aspectRatio" @change="update({ aspectRatio: ($event.target as HTMLSelectElement).value })">
              <option v-for="r in modelDef.aspectRatios" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div>
            <label class="ign-lb">尺寸</label>
            <select class="ign-inp" :value="sizeLevel" @change="update({ sizeLevel: ($event.target as HTMLSelectElement).value })">
              <option v-for="s in modelDef.sizes" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>
      </template>

      <!-- FAL 专属面板 -->
      <template v-if="isFal && falKind === 'gpt-fal'">
        <div class="ign-fal">
          <div class="ign-fal-tt">💡 FAL Queue API · openai/gpt-image-2</div>
          <div class="ign-grid2">
            <div><label class="ign-lb">Mode</label><select class="ign-inp" v-model="falMode"><option value="edit">Edit</option><option value="gen">Generate</option></select></div>
            <div><label class="ign-lb">Size</label><select class="ign-inp" v-model="falSize"><option v-for="s in GPT_FAL_SIZES" :key="s.value" :value="s.value">{{ s.label }}</option></select></div>
          </div>
          <div class="ign-grid3">
            <div><label class="ign-lb">Quality</label><select class="ign-inp" v-model="falQuality"><option>low</option><option>medium</option><option>high</option><option>auto</option></select></div>
            <div><label class="ign-lb">张数</label><input class="ign-inp" type="number" min="1" max="4" v-model.number="falN" /></div>
            <div><label class="ign-lb">格式</label><select class="ign-inp" v-model="falFormat"><option>png</option><option>jpeg</option><option>webp</option></select></div>
          </div>
          <label class="ign-chk"><input type="checkbox" v-model="falSync" /> Sync mode</label>
        </div>
      </template>
      <template v-if="isFal && falKind === 'nbpro-fal'">
        <div class="ign-fal">
          <div class="ign-fal-tt">💡 FAL · nano-banana-pro</div>
          <div class="ign-grid2">
            <div><label class="ign-lb">比例</label><select class="ign-inp" v-model="nbAspect"><option v-for="r in NBPRO_FAL_RATIOS" :key="r" :value="r">{{ r }}</option></select></div>
            <div><label class="ign-lb">分辨率</label><select class="ign-inp" v-model="nbResolution"><option v-for="r in NBPRO_FAL_RESOLUTIONS" :key="r" :value="r">{{ r }}</option></select></div>
          </div>
          <div><label class="ign-lb">Safety</label><select class="ign-inp" v-model="nbSafety"><option value="1">1(严)</option><option value="2">2</option><option value="3">3</option><option value="4">4(默认)</option><option value="5">5</option><option value="6">6(松)</option></select></div>
        </div>
      </template>

      <!-- 参考图 -->
      <div v-if="modelDef.supportsReference">
        <label class="ign-lb">参考图 · 上游{{ upstreamImages.length }} + 本地{{ refImages.length }} / {{ maxRefs }}</label>
        <div class="ign-refs">
          <img v-for="(u, i) in upstreamImages" :key="'u'+i" :src="u" class="ign-ref-th" :title="'上游 '+i" />
          <img v-for="(u, i) in refImages" :key="'r'+i" :src="u" class="ign-ref-th" @dblclick.stop="update({ referenceImages: refImages.filter((_,j)=>j!==i) })" :title="'双击移除'" />
          <button v-if="(upstreamImages.length+refImages.length) < maxRefs" class="ign-ref-add" @click="handlePickFile" title="上传本地参考图">
            <span class="mso" style="font-size:14px">add</span>
          </button>
        </div>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      </div>

      <!-- Prompt -->
      <div>
        <label class="ign-lb">Prompt{{ upstreamPrompt ? ' (优先取上游)' : '' }}</label>
        <MentionPromptInput :modelValue="localPrompt" :placeholder="upstreamPrompt || '描述你想生成的图片...'" @update:modelValue="(v:string)=>update({prompt:v})" />
      </div>

      <!-- 按钮 -->
      <button v-if="status !== 'generating'" class="ign-run" @click="handleGenerate">
        <span class="mso" style="font-size:12px">auto_awesome</span> 生成
      </button>
      <button v-else class="ign-stop" @click="handleCancel">
        <span class="mso ign-spin" style="font-size:12px">progress_activity</span> {{ d.progress || '生成中' }} · 取消
      </button>

      <!-- 错误 -->
      <div v-if="error" class="ign-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
    </div>

    <!-- 结果 -->
    <div v-if="imageUrl && !hasAutoOutput" class="ign-out">
      <img :src="imageUrl" alt="结果" class="ign-out-img" />
    </div>
  </div>
</template>

<style scoped>
.ign { width: 320px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); transition: border-color .15s; }
.ign.sel { border-color: #f59e0b; box-shadow: 0 0 20px rgba(245,158,11,.2); }
.ign.acc { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.2); }
.ign-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.ign-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ign-hd-tx { flex: 1; min-width: 0; }
.ign-hd-tt { font-size: 13px; font-weight: 600; }
.ign-hd-sub { font-size: 10px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ign-bd { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.ign-lb { font-size: 10px; color: var(--ink3); display: block; margin-bottom: 4px; }
.ign-tabs { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); }
.ign-tabs button { flex: 1; padding: 4px 6px; border: none; border-radius: 4px; background: none; font-size: 10px; font-weight: 600; color: var(--ink3); cursor: pointer; transition: all .15s; }
.ign-tabs button.on { background: rgba(245,158,11,.25); color: #f59e0b; }
.ign-inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; }
.ign-inp:focus { border-color: #f59e0b; }
.ign-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ign-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.ign-fal { border: 1px solid rgba(59,130,246,.3); border-radius: 6px; background: rgba(59,130,246,.05); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ign-fal-tt { font-size: 10px; color: #93c5fd; font-weight: 600; }
.ign-chk { font-size: 10px; color: var(--ink3); display: flex; align-items: center; gap: 4px; cursor: pointer; }
.ign-refs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.ign-ref-th { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; background: #0003; cursor: pointer; }
.ign-ref-add { width: 48px; height: 48px; border: 2px dashed var(--border); border-radius: 4px; background: var(--surface); color: var(--ink3); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.ign-ref-add:hover { border-color: #f59e0b; color: #f59e0b; }
.ign-run { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: rgba(245,158,11,.2); color: #f59e0b; font-size: 12px; font-weight: 500; cursor: pointer; }
.ign-run:hover { background: rgba(245,158,11,.3); }
.ign-stop { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: var(--surface-alt); color: var(--ink2); font-size: 12px; cursor: pointer; }
.ign-spin { animation: ign-spin 1s linear infinite; } @keyframes ign-spin { to { transform: rotate(360deg); } }
.ign-err { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 4px; padding: 4px 8px; }
.ign-out { border-top: 1px solid var(--border2); padding: 8px; }
.ign-out-img { width: 100%; border-radius: 6px; display: block; }
</style>

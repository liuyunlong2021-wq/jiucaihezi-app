<script setup lang="ts">
/**
 * CanvasSeedanceNode — Phase D，对齐 T8 SeedanceNode.tsx
 * 固定模型 seedance-2.0，火山引擎直连
 */
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useUpdateNodeData } from '@/canvas/composables/useUpdateNodeData'
import { useUpstreamMaterials } from '@/canvas/composables/useUpstreamMaterials'
import { useOrderedMaterials } from '@/canvas/composables/useOrderedMaterials'
import { useRunTrigger } from '@/canvas/composables/useRunTrigger'
import { canvasLogBus } from '@/stores/canvasLogsStore'
import MentionPromptInput from '@/components/canvas/shared/MentionPromptInput.vue'
import { submitSeedance, querySeedance, uploadFile } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const update = useUpdateNodeData(props.id)
const d = computed(() => props.data || {})
const modelId = 'seedance-2.0'
const ratio = computed(() => d.value.aspectRatio || '16:9')
const duration = computed(() => d.value.duration || 5)
const resolution = computed(() => d.value.resolution || '720p')
const generateAudio = computed({ get: () => d.value.generateAudio !== false, set: v => update({ generateAudio: v }) })
const status = computed<string>(() => d.value.status || 'idle')
const videoUrl = computed(() => d.value.videoUrl || d.value.outputUrl || '')
const localPrompt = computed(() => d.value.prompt || '')
const refImages = computed<string[]>(() => Array.isArray(d.value.referenceImages) ? d.value.referenceImages : [])
const maxRefs = 9
const error = ref<string | null>(null)
const abortCtrl = ref<AbortController | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const src = `seedance:${props.id.slice(0,6)}`

const upstream = useUpstreamMaterials(props.id)
const materialOrder = computed<string[]>(() => Array.isArray(d.value.materialOrder) ? d.value.materialOrder : [])
const ot = useOrderedMaterials(upstream.texts.value, materialOrder.value)
const oi = useOrderedMaterials(upstream.images.value, materialOrder.value)
const upstreamPrompt = computed(() => (ot as any[]).map((t:any)=>t.url).filter(Boolean).join('\n').trim())
const upstreamImages = computed(() => (oi as any[]).map((m:any)=>m.url).filter(Boolean).slice(0, maxRefs))
const finalPrompt = computed(() => (upstreamPrompt.value || localPrompt.value || '').trim())

async function handlePickFile() { fileInputRef.value?.click() }
async function handleFiles(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []); if (!files.length) return
  const remain = maxRefs - refImages.value.length; const accepted = files.slice(0, Math.max(0, remain))
  error.value = null
  try { for (const f of accepted) { const r = await uploadFile(f); refImages.value.push(r.url) }; update({ referenceImages: [...refImages.value] }) }
  catch (e:any) { error.value=e?.message||'上传失败' }
  finally { if(fileInputRef.value) fileInputRef.value.value='' }
}

async function handleGenerate() {
  error.value = null
  if (!finalPrompt.value && !upstreamImages.value.length && !refImages.value.length) { error.value='请输入 prompt 或添加参考图'; return }
  if (status.value==='generating') return
  const allRefs = [...upstreamImages.value, ...refImages.value]
  update({ status:'generating', error:'', videoUrl:'' })
  canvasLogBus.info(`[Seedance] 开始生成`, src)
  abortCtrl.value = new AbortController()
  try {
    const r = await submitSeedance({
      model: modelId, prompt: finalPrompt.value, duration: duration.value,
      ratio: ratio.value, resolution: resolution.value,
      generate_audio: generateAudio.value, refImages: allRefs,
    })
    update({ progress: '5%', taskId: r.taskId })
    canvasLogBus.info(`Seedance taskId=${r.taskId}`, src)
    for (let i=0; i<600; i++) {
      if (abortCtrl.value?.signal.aborted) { update({ status:'idle' }); return }
      await new Promise(r=>setTimeout(r, 5000))
      const q = await querySeedance(r.taskId)
      if (q.progress) update({ progress: q.progress })
      if (q.status==='succeeded'||q.status==='SUCCESS') { update({ status:'success', progress:'100%', videoUrl: q.videoUrl||'' }); canvasLogBus.success(`完成`, src); return }
      if (q.status==='failed') throw new Error(q.failReason||'失败')
    }
    throw new Error('轮询超时')
  } catch(e:any) { error.value=e?.message||'生成失败'; update({ status:'error', error:e?.message }); canvasLogBus.error(`失败: ${error.value}`, src) }
  finally { abortCtrl.value=null }
}

function handleCancel() { abortCtrl.value?.abort(); update({ status:'idle' }); canvasLogBus.warn(`取消`, src) }
useRunTrigger(props.id, handleGenerate)
</script>

<template>
  <div class="sd" :class="{ sel: selected }" :style="{ borderColor: selected ? '#d946ef' : 'var(--border)' }">
    <Handle type="target" :position="Position.Left" :style="{ background: '#d946ef', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#d946ef', width: 10, height: 10, border: 'none' }" />
    <div class="sd-hd">
      <div class="sd-hd-ic" style="background: rgba(217,70,239,.18); color: #f0abfc; box-shadow: inset 0 0 0 1px rgba(217,70,239,.4)">
        <span class="mso" style="font-size:13px">theaters</span>
      </div>
      <div class="sd-hd-tx"><div class="sd-hd-tt">Seedance 2.0</div><div class="sd-hd-sub">火山引擎 · 视频分镜</div></div>
    </div>
    <div class="sd-bd" @mousedown.stop>
      <div class="sd-grid2">
        <div><label class="sd-lb">比例</label><select class="sd-inp" :value="ratio" @change="update({ aspectRatio: ($event.target as HTMLSelectElement).value })"><option>16:9</option><option>9:16</option><option>1:1</option></select></div>
        <div><label class="sd-lb">时长(s)</label><select class="sd-inp" :value="duration" @change="update({ duration: Number(($event.target as HTMLSelectElement).value) })"><option>5</option><option>10</option><option>15</option></select></div>
      </div>
      <div><label class="sd-lb">分辨率</label><select class="sd-inp" :value="resolution" @change="update({ resolution: ($event.target as HTMLSelectElement).value })"><option>480p</option><option>720p</option><option>1080p</option></select></div>
      <label class="sd-chk"><input type="checkbox" v-model="generateAudio" /> 生成音频</label>
      <div><label class="sd-lb">参考图 · 上游{{ upstreamImages.length }} + 本地{{ refImages.length }} / {{ maxRefs }}</label>
        <div class="sd-refs">
          <img v-for="(u,i) in upstreamImages" :key="'u'+i" :src="u" class="sd-ref-th" />
          <img v-for="(u,i) in refImages" :key="'r'+i" :src="u" class="sd-ref-th" @dblclick.stop="update({ referenceImages: refImages.filter((_,j)=>j!==i) })" title="双击移除" />
          <button v-if="(upstreamImages.length+refImages.length) < maxRefs" class="sd-ref-add" @click="handlePickFile"><span class="mso" style="font-size:14px">add</span></button>
        </div>
        <input ref="fileInputRef" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      </div>
      <div><label class="sd-lb">Prompt{{ upstreamPrompt?' (优先取上游)':'' }}</label><MentionPromptInput :modelValue="localPrompt" :placeholder="upstreamPrompt||'描述视频内容...'" @update:modelValue="(v:string)=>update({prompt:v})" /></div>
      <button v-if="status!=='generating'" class="sd-run" @click="handleGenerate"><span class="mso" style="font-size:12px">auto_awesome</span> 生成</button>
      <button v-else class="sd-stop" @click="handleCancel"><span class="mso sd-spin" style="font-size:12px">progress_activity</span> {{ d.progress || '生成中' }} · 取消</button>
      <div v-if="error" class="sd-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
    </div>
    <div v-if="videoUrl" class="sd-out"><video :src="videoUrl" controls class="sd-out-vid" /></div>
  </div>
</template>

<style scoped>
.sd { width: 300px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.sd.sel { border-color: #d946ef; box-shadow: 0 0 20px rgba(217,70,239,.2); }
.sd-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.sd-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sd-hd-tx { flex: 1; }
.sd-hd-tt { font-size: 13px; font-weight: 600; }
.sd-hd-sub { font-size: 10px; color: var(--ink3); }
.sd-bd { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.sd-lb { font-size: 10px; color: var(--ink3); display: block; margin-bottom: 4px; }
.sd-inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; }
.sd-inp:focus { border-color: #d946ef; }
.sd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sd-chk { font-size: 10px; color: var(--ink3); display: flex; align-items: center; gap: 4px; cursor: pointer; }
.sd-refs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.sd-ref-th { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; background: #0003; }
.sd-ref-add { width: 48px; height: 48px; border: 2px dashed var(--border); border-radius: 4px; background: var(--surface); color: var(--ink3); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.sd-ref-add:hover { border-color: #d946ef; color: #d946ef; }
.sd-run { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: rgba(217,70,239,.2); color: #d946ef; font-size: 12px; font-weight: 500; cursor: pointer; }
.sd-stop { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: var(--surface-alt); color: var(--ink2); font-size: 12px; cursor: pointer; }
.sd-spin { animation: sd-spin 1s linear infinite; } @keyframes sd-spin { to { transform: rotate(360deg); } }
.sd-err { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 4px; padding: 4px 8px; }
.sd-out { border-top: 1px solid var(--border2); padding: 8px; }
.sd-out-vid { width: 100%; border-radius: 6px; display: block; }
</style>

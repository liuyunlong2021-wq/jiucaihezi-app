<script setup lang="ts">
/**
 * CanvasAudioGenNode — Phase E，对齐 T8 AudioNode.tsx
 * Suno 三模式 (generate / cover / extend)
 */
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useUpdateNodeData } from '@/canvas/composables/useUpdateNodeData'
import { useUpstreamMaterials } from '@/canvas/composables/useUpstreamMaterials'
import { useOrderedMaterials } from '@/canvas/composables/useOrderedMaterials'
import { useRunTrigger } from '@/canvas/composables/useRunTrigger'
import { canvasLogBus } from '@/stores/canvasLogsStore'
import MentionPromptInput from '@/components/canvas/shared/MentionPromptInput.vue'
import { AUDIO_MODELS, SUNO_VERSIONS, DEFAULT_SUNO_VERSION } from '@/canvas/providers/canvasModels'
import { submitAudio, queryAudio, uploadAudioForSuno } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const update = useUpdateNodeData(props.id)
const d = computed(() => props.data || {})

const mode = computed(() => d.value.mode || 'generate')
const version = computed(() => d.value.version || DEFAULT_SUNO_VERSION)
const title = computed({ get: () => d.value.title || '', set: v => update({ title: v }) })
const tags = computed({ get: () => d.value.tags || '', set: v => update({ tags: v }) })
const negativeTags = computed({ get: () => d.value.negativeTags || '', set: v => update({ negativeTags: v }) })
const prompt = computed({ get: () => d.value.prompt || '', set: v => update({ prompt: v }) })
const refAudioUrl = computed(() => d.value.refAudioUrl || '')
const startTime = computed({ get: () => d.value.startTime || '0:00', set: v => update({ startTime: v }) })
const endTime = computed({ get: () => d.value.endTime || '0:30', set: v => update({ endTime: v }) })
const refText = computed({ get: () => d.value.refText || '', set: v => update({ refText: v }) })
const status = computed<string>(() => d.value.status || 'idle')
const audioUrl = computed(() => d.value.audioUrl || '')

const error = ref<string | null>(null)
const abortCtrl = ref<AbortController | null>(null)
const src = `audio:${props.id.slice(0, 6)}`

const upstream = useUpstreamMaterials(props.id)
const materialOrder = computed<string[]>(() => Array.isArray(d.value.materialOrder) ? d.value.materialOrder : [])
const ot = useOrderedMaterials(upstream.texts.value, materialOrder.value)
const upstreamPrompt = computed(() => (ot as any[]).map((t: any) => t.url).filter(Boolean).join('\n').trim())
const finalPrompt = computed(() => (upstreamPrompt.value || prompt.value || '').trim())

function switchMode(m: string) { update({ mode: m }); error.value = null }

async function handleUploadAudio(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || [])
  if (!files.length) return
  error.value = null
  try {
    const r = await uploadAudioForSuno(files[0])
    update({ refAudioUrl: r.filename })
  } catch (e: any) { error.value = e?.message || '上传音频失败' }
}

async function handleGenerate() {
  error.value = null
  if (!finalPrompt.value && mode.value === 'generate') { error.value = '请输入歌词/提示词'; return }
  if (mode.value !== 'generate' && !refAudioUrl.value) { error.value = '请上传参考音频'; return }
  if (status.value === 'generating') return
  update({ status: 'generating', error: '', audioUrl: '' })
  canvasLogBus.info(`[Suno ${mode.value}] 开始生成`, src)
  abortCtrl.value = new AbortController()
  try {
    const r = await submitAudio({
      mode: mode.value as any, version: version.value,
      title: title.value, tags: tags.value,
      prompt: finalPrompt.value,
      refAudioUrl: refAudioUrl.value || undefined,
      startTime: d.value.startTime || undefined,
      endTime: d.value.endTime || undefined,
      refText: d.value.refText || undefined,
    })
    const clipIds = r.clipIds
    if (!clipIds.length) throw new Error('未返回 clipId')
    update({ progress: '10%', taskId: r.taskId })
    canvasLogBus.info(`Suno clipIds=${clipIds.join(',')}`, src)
    for (let i = 0; i < 120; i++) {
      if (abortCtrl.value?.signal.aborted) { update({ status: 'idle' }); return }
      await new Promise(r => setTimeout(r, 5000))
      const q = await queryAudio(clipIds)
      if (q.status === 'SUCCESS' && q.tracks?.length) {
        const best = q.tracks[0]
        update({ status: 'success', progress: '100%', audioUrl: best.audioUrl })
        canvasLogBus.success(`完成`, src)
        return
      }
      const pct = Math.min(95, 10 + Math.floor(i / 120 * 85))
      update({ progress: `${pct}%` })
    }
    throw new Error('Suno 超时')
  } catch (e: any) { error.value = e?.message || '生成失败'; update({ status: 'error', error: e?.message }); canvasLogBus.error(`失败: ${error.value}`, src) }
  finally { abortCtrl.value = null }
}

function handleCancel() { abortCtrl.value?.abort(); update({ status: 'idle' }); canvasLogBus.warn(`取消`, src) }
useRunTrigger(props.id, handleGenerate)
</script>

<template>
  <div class="an" :class="{ sel: selected }" :style="{ borderColor: selected ? '#a78bfa' : 'var(--border)' }">
    <Handle type="target" :position="Position.Left" :style="{ background: '#a78bfa', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#a78bfa', width: 10, height: 10, border: 'none' }" />
    <div class="an-hd">
      <div class="an-hd-ic" style="background: rgba(167,139,250,.18); color: #c4b5fd; box-shadow: inset 0 0 0 1px rgba(167,139,250,.4)">
        <span class="mso" style="font-size:13px">music_note</span>
      </div>
      <div class="an-hd-tx"><div class="an-hd-tt">音频</div><div class="an-hd-sub">Suno V5.5</div></div>
    </div>
    <div class="an-bd" @mousedown.stop>
      <!-- 模式 TAB -->
      <div class="an-tabs">
        <button v-for="m in AUDIO_MODELS" :key="m.id" :class="{ on: mode === m.mode }" @click="switchMode(m.mode)">{{ m.label }}</button>
      </div>

      <!-- 版本 -->
      <div><label class="an-lb">版本</label><select class="an-inp" :value="version" @change="update({ version: ($event.target as HTMLSelectElement).value })"><option v-for="v in SUNO_VERSIONS" :key="v.value" :value="v.value">{{ v.label }}</option></select></div>

      <!-- 参考音频 (cover/extend) -->
      <div v-if="mode !== 'generate'">
        <label class="an-lb">参考音频</label>
        <div v-if="refAudioUrl" class="an-audio-ref">
          <audio :src="refAudioUrl" controls style="width:100%;height:28px" />
          <button class="an-btn-sm" @click="update({ refAudioUrl: '' })">×</button>
        </div>
        <label v-else class="an-upload-btn"><span class="mso" style="font-size:14px">upload_file</span> 上传音频<input type="file" accept="audio/*" hidden @change="handleUploadAudio" /></label>
      </div>

      <template v-if="mode === 'extend'">
        <div class="an-grid2">
          <div><label class="an-lb">开始时间</label><input class="an-inp" v-model="startTime" /></div>
          <div><label class="an-lb">结束时间</label><input class="an-inp" v-model="endTime" /></div>
        </div>
        <div><label class="an-lb">参考文本(原歌词)</label><input class="an-inp" v-model="refText" /></div>
      </template>

      <!-- 标题/标签 -->
      <div><label class="an-lb">标题</label><input class="an-inp" v-model="title" /></div>
      <div><label class="an-lb">风格标签</label><input class="an-inp" v-model="tags" placeholder="pop, rock, jazz..." /></div>
      <div><label class="an-lb">排除标签</label><input class="an-inp" v-model="negativeTags" /></div>

      <!-- Prompt -->
      <div>
        <label class="an-lb">{{ mode === 'generate' ? '歌词/提示词' : '新歌词' }}{{ upstreamPrompt ? ' (优先取上游)' : '' }}</label>
        <MentionPromptInput :modelValue="prompt" :placeholder="upstreamPrompt || '输入歌词...'" @update:modelValue="(v:string)=>update({prompt:v})" />
      </div>

      <!-- 按钮 -->
      <button v-if="status!=='generating'" class="an-run" @click="handleGenerate"><span class="mso" style="font-size:12px">auto_awesome</span> 生成</button>
      <button v-else class="an-stop" @click="handleCancel"><span class="mso an-spin" style="font-size:12px">progress_activity</span> {{ d.progress || '生成中' }} · 取消</button>
      <div v-if="error" class="an-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
    </div>

    <div v-if="audioUrl" class="an-out">
      <audio :src="audioUrl" controls style="width:100%" />
      <div class="an-out-meta"><span>{{ title }}</span><span>{{ version }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.an { width: 300px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.an.sel { border-color: #a78bfa; box-shadow: 0 0 20px rgba(167,139,250,.2); }
.an-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.an-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.an-hd-tx { flex: 1; }
.an-hd-tt { font-size: 13px; font-weight: 600; }
.an-hd-sub { font-size: 10px; color: var(--ink3); }
.an-bd { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.an-lb { font-size: 10px; color: var(--ink3); display: block; margin-bottom: 4px; }
.an-tabs { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); }
.an-tabs button { flex: 1; padding: 4px 6px; border: none; border-radius: 4px; background: none; font-size: 10px; font-weight: 600; color: var(--ink3); cursor: pointer; }
.an-tabs button.on { background: rgba(167,139,250,.25); color: #a78bfa; }
.an-inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; }
.an-inp:focus { border-color: #a78bfa; }
.an-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.an-audio-ref { display: flex; align-items: center; gap: 4px; }
.an-btn-sm { width: 22px; height: 22px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink2); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.an-upload-btn { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 2px dashed var(--border); border-radius: 6px; cursor: pointer; font-size: 11px; color: var(--ink3); }
.an-upload-btn:hover { border-color: #a78bfa; color: #a78bfa; }
.an-run { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: rgba(167,139,250,.2); color: #a78bfa; font-size: 12px; font-weight: 500; cursor: pointer; }
.an-stop { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: var(--surface-alt); color: var(--ink2); font-size: 12px; cursor: pointer; }
.an-spin { animation: an-spin 1s linear infinite; } @keyframes an-spin { to { transform: rotate(360deg); } }
.an-err { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 4px; padding: 4px 8px; }
.an-out { border-top: 1px solid var(--border2); padding: 8px; }
.an-out-meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--ink3); margin-top: 4px; }
</style>

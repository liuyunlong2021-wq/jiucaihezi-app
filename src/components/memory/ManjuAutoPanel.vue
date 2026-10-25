<template>
  <div v-if="draft" class="manju-auto-card" role="dialog" aria-label="开始全自动成片">
    <strong>开始全自动成片</strong>
    <p v-if="!draft.episodes.length" class="manju-auto-warn">还没有分集剧本。请先在全自动模式下发送剧本（粘贴、附件或引用文件均可）。</p>
    <p v-else-if="!draft.ratio" class="manju-auto-warn">项目风格里还没有确认影片比例，请先确认比例与风格。</p>
    <template v-else>
      <div class="manju-auto-row">
        <span>集数</span>
        <div class="manju-auto-episodes">
          <label v-for="episode in draft.episodes" :key="episode"><input v-model="episodes" type="checkbox" :value="episode">{{ episode }}</label>
        </div>
      </div>
      <label class="manju-auto-row"><span>生图模型</span>
        <select v-model="imageModelId"><option v-for="model in draft.imageModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
      </label>
      <label class="manju-auto-row"><span>视频模型</span>
        <select v-model="videoModelId"><option v-for="model in draft.videoModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
      </label>
      <div class="manju-auto-row"><span>比例</span><span>{{ draft.ratio }}（项目风格已确认）· Seedance</span></div>
      <label class="manju-auto-row"><span>单集预算</span><span><input v-model="budget" type="number" min="0" step="1" placeholder="不限"> 元</span></label>
      <label class="manju-auto-row manju-auto-check"><input v-model="reviewFirst" type="checkbox">第 1 集资产出齐后暂停审图</label>
      <p class="manju-auto-note">{{ priceNote }}</p>
    </template>
    <div class="manju-auto-actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button v-if="draft.saved" type="button" :disabled="!canStart" title="沿用已完成的文字与已生成的资产，按上面新的模型与预算继续" @click="startNew(true)">从第 {{ resumeEpisode }} 集续做</button>
      <button type="button" class="primary" :disabled="!canStart" @click="startNew()">开始全自动</button>
    </div>
  </div>

  <div v-if="review" class="manju-auto-card manju-auto-review" role="dialog" aria-label="审核资产图">
    <strong>审核第 1 集资产图</strong>
    <p>确认后这些图会锁定，后续各集直接复用、不再重新生成。不满意可以停止，在文件树里替换图片或修改提示词后再续做。</p>
    <div class="manju-auto-images">
      <figure v-for="id in review.ids" :key="id"><img :src="displaySrc(review.images[id])" :alt="id"><figcaption>{{ id }}</figcaption></figure>
    </div>
    <div class="manju-auto-actions">
      <button type="button" @click="emit('stop')">停止</button>
      <button type="button" class="primary" @click="emit('approve')">确认并继续</button>
    </div>
  </div>

  <div v-if="run" class="manju-auto-progress" :class="run.status">
    <JcIcon name="movie" />
    <span class="manju-auto-status">{{ statusLabel }}</span>
    <span v-for="(episode, key) in run.episodes" :key="key" class="manju-auto-chip" :class="episode.phase" :title="episode.reason || episode.output || ''">第{{ key }}集 {{ phaseLabels[episode.phase] }}</span>
    <button v-if="run.status === 'running'" type="button" @click="emit('stop')">停止</button>
    <p v-for="(episode, key) in blockedEpisodes" :key="`reason-${key}`" class="manju-auto-reason">第{{ key }}集暂停原因：{{ episode.reason }}</p>
    <p v-if="run.status === 'blocked' || run.status === 'stopped'" class="manju-auto-reason">处理后从「漫剧·全自动」菜单重新选「全自动成片」，点「从第 N 集续做」；已完成的文字和已出的图不会重做。</p>
  </div>
  <p v-if="error" class="manju-auto-error">{{ error }}</p>
</template>

<script setup lang="ts">
import { convertFileSrc } from '@tauri-apps/api/core'
import { computed, ref, watch } from 'vue'
import type { ManjuAutoDraft } from '@/composables/useManjuAuto'
import { estimateUnitCost, type AutoRunConfig, type AutoRunState, type EpisodePhase } from '@/runtime/manjuAuto/autoRunner'

const props = defineProps<{
  draft: ManjuAutoDraft | null
  run: AutoRunState | null
  review: { ids: string[]; images: Record<string, string> } | null
  error: string
}>()
const emit = defineEmits<{ start: [config: AutoRunConfig, resume: boolean]; cancel: []; stop: []; approve: [] }>()

const episodes = ref<number[]>([])
const imageModelId = ref('')
const videoModelId = ref('')
const budget = ref<number | string>('')
const reviewFirst = ref(true)

watch(() => props.draft, draft => {
  if (!draft) return
  episodes.value = draft.episodes.slice()
  imageModelId.value = draft.imageModels[0]?.id || ''
  videoModelId.value = draft.videoModels[0]?.id || ''
}, { immediate: true })

const phaseLabels: Record<EpisodePhase, string> = {
  queued: '待做', text: '写提示词', assets: '生图中', review: '待审图', videos: '出片中', concat: '拼接中', done: '已成片', blocked: '已暂停',
}
const blockedEpisodes = computed(() => Object.fromEntries(Object.entries(props.run?.episodes || {}).filter(([, episode]) => episode.phase === 'blocked' && episode.reason)))
const statusLabel = computed(() => ({ running: '全自动成片运行中', blocked: '全自动成片已暂停', stopped: '全自动成片已停止', done: '全自动成片已完成' })[props.run!.status])
const resumeEpisode = computed(() => {
  const saved = props.draft?.saved
  return saved?.config.episodes.find(n => !['done', 'videos', 'concat'].includes(saved.episodes[String(n)]?.phase)) ?? saved?.config.episodes[0]
})
const imageModel = computed(() => props.draft?.imageModels.find(model => model.id === imageModelId.value))
const videoModel = computed(() => props.draft?.videoModels.find(model => model.id === videoModelId.value))
const priceNote = computed(() => {
  const known = estimateUnitCost(imageModel.value?.price) !== undefined && estimateUnitCost(videoModel.value?.price) !== undefined
  return known
    ? `生图 ${imageModel.value!.price}，视频 ${videoModel.value!.price}。每集按新增资产与片段时长实时估算，超过单集预算即暂停。`
    : '所选模型价格无法自动估算，单集预算不会拦截，请留意用量。'
})
const canStart = computed(() => Boolean(props.draft?.ratio && episodes.value.length && imageModelId.value && videoModelId.value))

function startNew(resume = false) {
  const draft = props.draft
  if (!draft?.ratio || !canStart.value) return
  const cap = Number(budget.value)
  emit('start', {
    episodes: episodes.value.slice().sort((a, b) => a - b),
    videoModel: 'Seedance',
    imageModelId: imageModelId.value,
    videoModelId: videoModelId.value,
    ratio: draft.ratio,
    review: reviewFirst.value,
    budgetPerEpisode: budget.value !== '' && Number.isFinite(cap) && cap > 0 ? cap : undefined,
    imagePrice: imageModel.value?.price,
    videoPrice: videoModel.value?.price,
  }, resume)
}

function displaySrc(path?: string) {
  return path ? convertFileSrc(path) : ''
}
</script>

<style scoped>
.manju-auto-card { display: grid; gap: 10px; margin: 0 14px 8px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 10px 28px rgb(0 0 0 / 12%); color: var(--ink1); font-size: 12px; }
.manju-auto-card p { margin: 0; color: var(--ink2); line-height: 1.6; }
.manju-auto-warn { color: var(--jc-error) !important; }
.manju-auto-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 8px; }
.manju-auto-row > span:first-child { color: var(--ink3); }
.manju-auto-row select, .manju-auto-row input[type="number"] { min-width: 0; max-width: 100%; padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink1); font: inherit; }
.manju-auto-row input[type="number"] { width: 96px; }
.manju-auto-check { grid-template-columns: auto 1fr; justify-content: start; }
.manju-auto-episodes { display: flex; flex-wrap: wrap; gap: 6px 10px; max-height: 96px; overflow-y: auto; }
.manju-auto-episodes label { display: inline-flex; align-items: center; gap: 3px; }
.manju-auto-note { font-size: 11px; }
.manju-auto-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.manju-auto-actions button, .manju-auto-progress button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); cursor: pointer; font: inherit; font-size: 12px; }
.manju-auto-actions button.primary { border-color: transparent; background: var(--olive); color: #fff; }
.manju-auto-actions button:disabled { opacity: .45; cursor: default; }
.manju-auto-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; max-height: 300px; overflow-y: auto; }
.manju-auto-images figure { margin: 0; }
.manju-auto-images img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); }
.manju-auto-images figcaption { overflow: hidden; color: var(--ink3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.manju-auto-progress { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 14px 6px; padding: 6px 10px; border: 1px solid color-mix(in srgb, var(--jc-error) 30%, var(--line)); border-radius: 7px; background: color-mix(in srgb, var(--jc-error) 5%, var(--paper)); color: var(--ink2); font-size: 12px; }
.manju-auto-progress.done { border-color: color-mix(in srgb, var(--olive) 35%, var(--line)); background: color-mix(in srgb, var(--olive) 6%, var(--paper)); }
.manju-auto-progress > svg { width: 15px; height: 15px; color: var(--jc-error); }
.manju-auto-status { margin-right: 4px; color: var(--ink1); font-weight: 600; }
.manju-auto-chip { padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ink3) 12%, transparent); font-size: 11px; }
.manju-auto-chip.done { background: color-mix(in srgb, var(--olive) 16%, transparent); color: var(--olive); }
.manju-auto-chip.blocked { background: color-mix(in srgb, var(--jc-error) 14%, transparent); color: var(--jc-error); }
.manju-auto-chip.review { background: color-mix(in srgb, #d08a00 18%, transparent); color: #a86d00; }
.manju-auto-progress button { margin-left: auto; padding: 3px 10px; }
.manju-auto-reason { flex-basis: 100%; margin: 2px 0 0; color: var(--ink2); font-size: 11px; line-height: 1.5; }
.manju-auto-error { margin: 0 14px 6px; color: var(--jc-error); font-size: 12px; }
</style>

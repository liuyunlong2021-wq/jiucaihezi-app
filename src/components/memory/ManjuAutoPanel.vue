<template>
  <div v-if="draft" class="manju-auto-card" role="dialog" :aria-label="title">
    <strong>{{ title }}</strong>
    <p v-if="!draft.episodes.length" class="manju-auto-warn">还没有分集剧本。请先在全自动模式下发送剧本（粘贴、附件或引用文件均可）。</p>
    <p v-else-if="!draft.ratio" class="manju-auto-warn">项目风格里还没有确认影片比例，请先确认比例与风格。</p>
    <template v-else>
      <p v-if="draft.duplicates?.length" class="manju-auto-warn">第 {{ draft.duplicates.join('、') }} 集同时有入稿剧本和短剧改编剧本，使用入稿剧本。</p>
      <div class="manju-auto-row">
        <span>集数</span>
        <div class="manju-auto-episodes">
          <label v-for="episode in draft.episodes" :key="episode" :title="textStatus[episode].title"><input v-model="episodes" type="checkbox" :value="episode">{{ episode }}<small v-if="textStatus[episode].label" class="manju-auto-text-status" :class="textStatus[episode].state">{{ textStatus[episode].label }}</small></label>
        </div>
      </div>
      <p v-if="advice" class="manju-auto-note" :title="draft.advice.reason">项目风格建议：{{ advice }}</p>
      <label class="manju-auto-row"><span>参考图</span>
        <select v-model="pureText">
          <option :value="false">按段决定（漫剧：需要保持一致的角色、场景带图，空镜纯文生）</option>
          <option :value="true">纯文生（广告、纪录片：不建资产、不生图）</option>
        </select>
      </label>
      <label v-if="film && !pureText" class="manju-auto-row"><span>生图模型</span>
        <select v-model="imageModelId"><option v-for="model in draft.imageModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
      </label>
      <label class="manju-auto-row"><span>视频模型</span>
        <select v-model="videoModelId"><option v-for="model in draft.videoModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
      </label>
      <label v-if="film && videoModel?.resolutions?.length" class="manju-auto-row"><span>视频分辨率</span>
        <select v-model="videoResolution"><option v-for="resolution in videoModel.resolutions" :key="resolution" :value="resolution">{{ resolution }}{{ priceForResolution(videoModel.price, resolution) ? ` · ¥${priceForResolution(videoModel.price, resolution)}` : '' }}</option></select>
      </label>
      <label class="manju-auto-row"><span>视频路线</span>
        <!-- 不锁定：开始新运行可换路线；「从第 N 集续做」由 resumeAutoRun 强制沿用原路线。 -->
        <select v-model="route" :title="draft.saved ? `续做沿用原路线（${draft.saved.config.videoModel}）；换路线请点「开始全自动」` : ''">
          <option value="Seedance">Seedance 提示词</option>
          <option value="H3">MiniMax H3 提示词</option>
        </select>
      </label>
      <div class="manju-auto-row"><span>比例</span><span>{{ draft.ratio }}（项目风格已确认）</span></div>
      <div class="manju-auto-row"><span>模型限制</span><span>每段 ≤{{ limits.max_seconds }} 秒{{ limits.allowed_seconds ? `（只支持 ${limits.allowed_seconds.join('/')} 秒）` : '' }}{{ limits.max_refs === 0 ? '，纯文生不用参考图' : limits.max_refs ? `，最多 ${limits.max_refs} 张参考图` : '' }}；写提示词时按此分段</span></div>
      <template v-if="film">
      <label class="manju-auto-row"><span>单集预算</span><span><input v-model="budget" type="number" min="0" step="1" placeholder="不限"> 元</span></label>
      <label v-if="!pureText" class="manju-auto-row"><span>审图</span>
        <select v-model="reviewMode">
          <option value="new">每集有新资产就审（只看新图）</option>
          <option value="first">只审第 1 集</option>
          <option value="off">不审</option>
        </select>
      </label>
      <label class="manju-auto-row"><span>审片</span>
        <select v-model="reviewVideos">
          <option :value="true">每集视频出齐后审（确认后再拼接）</option>
          <option :value="false">不审，出齐直接拼接</option>
        </select>
      </label>
      <p class="manju-auto-note">{{ priceNote }}</p>
      </template>
      <p v-else class="manju-auto-note">只写项目资料、资产提示词和视频提示词，不生图也不生视频；视频模型只用来确定每段时长与参考图上限。写完后可切到「全自动·到成片」，已写好的集直接复用。</p>
    </template>
    <div class="manju-auto-actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button v-if="resumable" type="button" :disabled="!canStart" title="沿用已完成的文字与已生成的资产，按上面新的模型与预算继续" @click="startNew(true)">从第 {{ resumeEpisode }} 集续做</button>
      <button type="button" class="primary" :disabled="!canStart" @click="startNew()">{{ film ? '开始全自动' : '开始写提示词' }}</button>
    </div>
  </div>

  <div v-if="review" class="manju-auto-card manju-auto-review" role="dialog" aria-label="审核资产图">
    <strong>审核本集新资产图</strong>
    <p>不满意的图可以单独「重新生成」或「改提示词」后重生成，其他图不受影响。确认后全部锁定，后续各集直接复用。</p>
    <div class="manju-auto-images">
      <figure v-for="id in review.ids" :key="id" :class="{ busy: reviewBusy[id] }">
        <img :src="displaySrc(review.images[id])" :alt="id">
        <span v-if="reviewBusy[id]" class="manju-auto-busy">生成中…</span>
        <figcaption>{{ id }}</figcaption>
        <div class="manju-auto-image-actions">
          <button type="button" :disabled="reviewBusy[id]" @click="emit('regenerate', id)">重新生成</button>
          <button type="button" :disabled="reviewBusy[id]" @click="openPromptEditor(id)">改提示词</button>
        </div>
        <small v-if="reviewErrors[id]" class="manju-auto-image-error">{{ reviewErrors[id] }}</small>
      </figure>
    </div>
    <div v-if="editingId" class="manju-auto-prompt-editor">
      <span>修改「{{ editingId }}」的提示词（保存后写回 Wiki 并重新生成）</span>
      <textarea v-model="editingText" rows="6" :disabled="loadingPrompt" />
      <div class="manju-auto-actions">
        <button type="button" @click="editingId = ''">取消</button>
        <button type="button" class="primary" :disabled="loadingPrompt || !editingText.trim()" @click="savePrompt">保存并重新生成</button>
      </div>
    </div>
    <div class="manju-auto-actions">
      <button type="button" @click="emit('stop')">停止</button>
      <button type="button" class="primary" :disabled="anyBusy" :title="anyBusy ? '等重新生成的图出来再确认' : ''" @click="emit('approve')">确认并继续</button>
    </div>
  </div>

  <div v-if="cutReview" class="manju-auto-card manju-auto-review" role="dialog" aria-label="审核视频片段">
    <strong>审核第 {{ cutReview.episode }} 集视频片段</strong>
    <p>逐段看一遍。剧情、表演、镜头有问题就在段下写修改意见，点「按修改意见重做本集」：先改工程剧本，再重写受影响的视频提示词，只重出改动过的段。只想换个画面效果，可以对单段「重新生成」或「改提示词」（沿用原参考图与时长）。确认后拼接成片。</p>
    <div class="manju-auto-images manju-auto-videos">
      <figure v-for="(video, index) in cutReview.videos" :key="index" :class="{ busy: reviewBusy[String(index)] }">
        <video :src="displaySrc(video)" controls preload="metadata" />
        <span v-if="reviewBusy[String(index)]" class="manju-auto-busy">生成中…</span>
        <figcaption>第 {{ index + 1 }} 段<em v-if="cutReview.revised?.includes(index)" class="manju-auto-revised">已按意见重做</em></figcaption>
        <div class="manju-auto-image-actions">
          <button type="button" :disabled="reviewBusy[String(index)] || reviewBusy.revise" @click="emit('regenerateSegment', index)">重新生成</button>
          <button type="button" :disabled="reviewBusy[String(index)] || reviewBusy.revise" @click="openSegmentEditor(index)">改提示词</button>
        </div>
        <textarea v-model="notes[index + 1]" class="manju-auto-note-input" rows="2" placeholder="这一段的修改意见（可不填）" :disabled="reviewBusy.revise" />
        <small v-if="reviewErrors[String(index)]" class="manju-auto-image-error">{{ reviewErrors[String(index)] }}</small>
      </figure>
    </div>
    <textarea v-model="notes[0]" class="manju-auto-note-input" rows="2" placeholder="整集的修改意见（可不填），例如：节奏太慢、结尾要停在主角回头" :disabled="reviewBusy.revise" />
    <p v-if="reviewBusy.revise" class="manju-auto-note">正在按修改意见重做：改工程剧本 → 重写受影响的提示词 → 只重出改动的段，出齐后回到这里再审。</p>
    <small v-if="reviewErrors.revise" class="manju-auto-image-error">按意见重做没有完成：{{ reviewErrors.revise }}</small>
    <div v-if="editingSegment !== null" class="manju-auto-prompt-editor">
      <span>修改第 {{ editingSegment + 1 }} 段的视频提示词（保存后写回 Wiki 并重新生成这一段）</span>
      <textarea v-model="editingText" rows="8" :disabled="loadingPrompt" />
      <div class="manju-auto-actions">
        <button type="button" @click="editingSegment = null">取消</button>
        <button type="button" class="primary" :disabled="loadingPrompt || !editingText.trim()" @click="saveSegmentPrompt">保存并重新生成</button>
      </div>
    </div>
    <div class="manju-auto-actions">
      <button type="button" @click="emit('stop')">停止</button>
      <button type="button" :disabled="anyBusy || !hasNotes" :title="hasNotes ? '改动的段会重新出片并计费，未改动的段不重出' : '先在段下或整集写修改意见'" @click="reviseEpisode">按修改意见重做本集</button>
      <button type="button" class="primary" :disabled="anyBusy" :title="anyBusy ? '等重新生成的片段出来再确认' : ''" @click="emit('approveCut')">确认并拼接</button>
    </div>
  </div>

  <div v-if="run" class="manju-auto-progress" :class="run.status">
    <JcIcon name="movie" />
    <span class="manju-auto-status">{{ statusLabel }}</span>
    <span v-for="(episode, key) in run.episodes" :key="key" class="manju-auto-chip" :class="episode.phase" :title="episode.reason || episode.output || ''">第{{ key }}集 {{ phaseLabels[episode.phase] }}</span>
    <button v-if="run.status === 'running'" type="button" :disabled="stopping" :title="stopping ? '正在写的提示词或正在上传的视频结束后停下；已提交的生成任务继续在后台完成' : ''" @click="emit('stop')">{{ stopping ? '停止中…' : '停止' }}</button>
    <p v-for="(episode, key) in blockedEpisodes" :key="`reason-${key}`" class="manju-auto-reason">第{{ key }}集暂停原因：{{ episode.reason }}</p>
    <button v-if="formalEpisodes.length" type="button" title="沿用已定稿的项目资料、资产图和工程剧本，只按 Seedance 重写视频提示词并出片；开始前在确认卡上确认费用" @click="emit('formal', formalEpisodes)">用 Seedance 出正式版</button>
    <p v-if="run.status === 'blocked' || run.status === 'stopped'" class="manju-auto-reason">处理后从「漫剧制作」菜单重新选「{{ runFilm ? '全自动·到成片' : '全自动·到提示词' }}」，点「从第 N 集续做」；已完成的文字{{ runFilm ? '和已出的图' : '' }}不会重做。</p>
  </div>
  <p v-if="error" class="manju-auto-error">{{ error }}</p>
</template>

<script setup lang="ts">
import { convertFileSrc } from '@tauri-apps/api/core'
import { computed, ref, watch } from 'vue'
import type { ManjuAutoDraft } from '@/composables/useManjuAuto'
import { adviceSummary, episodeTextStatus, estimateUnitCost, modelLimits, priceForResolution, type AutoRunConfig, type VideoRoute, type AutoRunState, type EpisodePhase, type ReviewNotes } from '@/runtime/manjuAuto/autoRunner'

const props = defineProps<{
  draft: ManjuAutoDraft | null
  run: AutoRunState | null
  review: { ids: string[]; images: Record<string, string> } | null
  reviewBusy: Record<string, boolean>
  reviewErrors: Record<string, string>
  loadPrompt: (id: string) => Promise<string>
  cutReview: { episode: number; videos: string[]; revised?: number[] } | null
  loadSegmentPrompt: (index: number) => Promise<string>
  error: string
  stopping: boolean
  /** prompts：全自动·到提示词；film：全自动·到成片。 */
  target: 'prompts' | 'film'
}>()
const emit = defineEmits<{ start: [config: AutoRunConfig, resume: boolean]; cancel: []; stop: []; approve: []; regenerate: [id: string, prompt?: string]; regenerateSegment: [index: number, prompt?: string]; reviseEpisode: [notes: ReviewNotes]; approveCut: []; formal: [episodes: number[]] }>()

const editingId = ref('')
const editingText = ref('')
const loadingPrompt = ref(false)
const anyBusy = computed(() => Object.values(props.reviewBusy).some(Boolean))
async function openPromptEditor(id: string) {
  editingId.value = id
  editingText.value = ''
  loadingPrompt.value = true
  try { editingText.value = await props.loadPrompt(id) } catch (cause) { editingText.value = `读取提示词失败：${cause instanceof Error ? cause.message : String(cause)}` } finally { loadingPrompt.value = false }
}
const editingSegment = ref<number | null>(null)
async function openSegmentEditor(index: number) {
  editingSegment.value = index
  editingText.value = ''
  loadingPrompt.value = true
  try { editingText.value = await props.loadSegmentPrompt(index) } catch (cause) { editingText.value = `读取提示词失败：${cause instanceof Error ? cause.message : String(cause)}` } finally { loadingPrompt.value = false }
}
function saveSegmentPrompt() {
  const index = editingSegment.value
  if (index === null || !editingText.value.trim()) return
  emit('regenerateSegment', index, editingText.value)
  editingSegment.value = null
}
/** 审片修改意见：键为段号（从 1 起），0 为整集；换一集审片时清空。 */
const notes = ref<ReviewNotes>({})
const hasNotes = computed(() => Object.values(notes.value).some(note => note.trim()))
watch(() => props.cutReview?.episode, () => { notes.value = {} })
function reviseEpisode() {
  if (!hasNotes.value) return
  emit('reviseEpisode', { ...notes.value })
  notes.value = {}
}
function savePrompt() {
  const id = editingId.value
  if (!id || !editingText.value.trim()) return
  emit('regenerate', id, editingText.value)
  editingId.value = ''
}

const episodes = ref<number[]>([])
const imageModelId = ref('')
const videoModelId = ref('')
const budget = ref<number | string>('')
const reviewMode = ref<'new' | 'first' | 'off'>('new')
const reviewVideos = ref(true)
const videoResolution = ref('')
const route = ref<VideoRoute>('Seedance')
const pureText = ref(false)
const resolutionHeight = (value: string) => Number(value.replace(/\D/g, '')) || Infinity
/** 上次选的分辨率：所选视频模型支持就沿用，否则取最低档。 */
let preferredResolution: string | undefined

// 默认沿用上一次运行的设置（模型还在目录里才沿用），没有记录时取目录第一个。
watch(() => props.draft, draft => {
  if (!draft) return
  const last = draft.saved?.config ?? draft.last
  const pick = (models: ManjuAutoDraft['imageModels'], id?: string) => models.find(model => model.id === id)?.id || models[0]?.id || ''
  episodes.value = draft.select?.filter(episode => draft.episodes.includes(episode)) ?? draft.episodes.slice()
  imageModelId.value = pick(draft.imageModels, last?.imageModelId)
  videoModelId.value = pick(draft.videoModels, last?.videoModelId)
  // 出正式版：上次用的不是 Seedance 型号时，换成目录里第一个 Seedance 型号。
  if (draft.route === 'Seedance' && !/seedance/i.test(videoModelId.value)) videoModelId.value = draft.videoModels.find(model => /seedance/i.test(`${model.id} ${model.label}`))?.id || videoModelId.value
  if (last) {
    route.value = draft.route ?? last.videoModel
    budget.value = last.budgetPerEpisode ?? ''
    reviewMode.value = last.reviewMode ?? (last.review ? 'first' : 'off')
    reviewVideos.value = last.reviewVideos !== false
    pureText.value = last.limits?.max_refs === 0
    preferredResolution = last.videoResolution
    if (preferredResolution && draft.videoModels.find(model => model.id === videoModelId.value)?.resolutions?.includes(preferredResolution)) videoResolution.value = preferredResolution
  }
  // 项目风格写了参考图方式时优先按它预选，用户仍可改。
  if (draft.advice.mode) pureText.value = draft.advice.mode === 'pure'
}, { immediate: true })

const film = computed(() => props.target === 'film')
const title = computed(() => film.value ? '开始全自动成片' : '开始全自动写提示词')
const runFilm = computed(() => props.run?.config.target !== 'prompts')
const phaseLabels = computed<Record<EpisodePhase, string>>(() => ({
  queued: '待做', text: '写提示词', assets: '生图中', review: '待审图', videos: '出片中', cut: '待审片', concat: '拼接中', done: runFilm.value ? '已成片' : '提示词完成', blocked: '已暂停',
}))
/** H3 测试版已成片的集：可沿用定稿的工程剧本与资产，用 Seedance 出正式版。 */
const formalEpisodes = computed(() => props.run && props.run.status !== 'running' && props.run.config.videoModel === 'H3' && runFilm.value
  ? Object.entries(props.run.episodes).filter(([, episode]) => episode.phase === 'done').map(([key]) => Number(key)) : [])
const blockedEpisodes = computed(() => Object.fromEntries(Object.entries(props.run?.episodes || {}).filter(([, episode]) => episode.phase === 'blocked' && episode.reason)))
const statusLabel = computed(() => `${runFilm.value ? '全自动成片' : '全自动写提示词'}${({ running: '运行中', blocked: '已暂停', stopped: '已停止', done: '已完成' })[props.run!.status]}`)
// 只续做同一种目标的运行：到提示词的运行不会接着花钱，到成片的运行也不会被降级成只写字。
const resumable = computed(() => Boolean(props.draft?.saved && (props.draft.saved.config.target ?? 'film') === props.target))
const resumeEpisode = computed(() => {
  const saved = props.draft?.saved
  return saved?.config.episodes.find(n => !['done', 'videos', 'cut', 'concat'].includes(saved.episodes[String(n)]?.phase)) ?? saved?.config.episodes[0]
})
const imageModel = computed(() => props.draft?.imageModels.find(model => model.id === imageModelId.value))
const videoModel = computed(() => props.draft?.videoModels.find(model => model.id === videoModelId.value))
const advice = computed(() => props.draft && adviceSummary(props.draft.advice, imageModel.value?.price))
// 换模型时默认最低分辨率（测试最省钱）；分档价格按所选分辨率参与预算。
watch(videoModel, model => {
  if (preferredResolution && model?.resolutions?.includes(preferredResolution)) videoResolution.value = preferredResolution
  else videoResolution.value = model?.resolutions?.slice().sort((a, b) => resolutionHeight(a) - resolutionHeight(b))[0] || ''
}, { immediate: true })
const limits = computed(() => {
  const base = modelLimits(route.value, videoModel.value || {})
  return pureText.value ? { ...base, max_refs: 0 } : base
})
/** 每集在所选路线下已有的文字进度：已完成可直接复用，超出所选模型限制的会按新模型重写。 */
const textStatus = computed(() => Object.fromEntries((props.draft?.episodes || []).map(episode => {
  const status = episodeTextStatus(props.draft?.checkpoints[route.value][episode], limits.value)
  const other = route.value === 'H3' ? 'Seedance' : 'H3'
  if (status.state === 'none' && props.draft?.checkpoints[other][episode]?.stage === 'complete')
    return [episode, { state: 'derive', label: `沿用${other === 'H3' ? ' H3 ' : ' Seedance '}工程剧本`, title: `项目资料、资产图和工程剧本沿用 ${other} 版，只按 ${route.value} 重写视频提示词` }]
  const view = status.state === 'complete' ? { label: '已写好', title: '提示词已完成，直接复用' }
    : status.state === 'stale' ? { label: '需重写', title: `${status.reason}；开始后按新模型重写这一集` }
    : status.state === 'partial' ? { label: '写到一半', title: `已写到 ${status.stage} 阶段，开始后从头补齐` }
    : { label: '', title: '还没写提示词' }
  return [episode, { state: status.state, ...view }]
})))
const videoPrice = computed(() => priceForResolution(videoModel.value?.price, videoResolution.value) ?? videoModel.value?.price)
const priceNote = computed(() => {
  const known = (pureText.value || estimateUnitCost(imageModel.value?.price) !== undefined) && estimateUnitCost(videoPrice.value) !== undefined
  return known
    ? `${pureText.value ? '不生图' : `生图 ${imageModel.value!.price}`}，视频 ${videoPrice.value}。每集按新增资产与片段时长实时估算，超过单集预算即暂停。`
    : '所选模型价格无法自动估算，单集预算不会拦截，请留意用量。'
})
const canStart = computed(() => Boolean(props.draft?.ratio && episodes.value.length && (imageModelId.value || !film.value || pureText.value) && videoModelId.value))

function startNew(resume = false) {
  const draft = props.draft
  if (!draft?.ratio || !canStart.value) return
  const cap = Number(budget.value)
  emit('start', {
    target: props.target,
    episodes: episodes.value.slice().sort((a, b) => a - b),
    videoModel: route.value,
    limits: limits.value,
    imageModelId: imageModelId.value,
    videoModelId: videoModelId.value,
    ratio: draft.ratio,
    review: reviewMode.value !== 'off',
    reviewMode: reviewMode.value,
    reviewVideos: film.value ? reviewVideos.value : undefined,
    budgetPerEpisode: budget.value !== '' && Number.isFinite(cap) && cap > 0 ? cap : undefined,
    imagePrice: imageModel.value?.price,
    videoResolution: videoResolution.value || undefined,
    videoPrice: videoPrice.value,
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
.manju-auto-text-status { margin-left: 2px; color: var(--ink3); font-size: 10px; }
.manju-auto-text-status.complete { color: var(--jc-success); }
.manju-auto-text-status.stale { color: var(--jc-error); }
.manju-auto-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.manju-auto-actions button, .manju-auto-progress button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); cursor: pointer; font: inherit; font-size: 12px; }
.manju-auto-actions button.primary { border-color: transparent; background: var(--olive); color: #fff; }
.manju-auto-actions button:disabled { opacity: .45; cursor: default; }
.manju-auto-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; max-height: 300px; overflow-y: auto; }
.manju-auto-images figure { margin: 0; }
.manju-auto-images img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); }
.manju-auto-images figure { position: relative; display: grid; gap: 3px; }
.manju-auto-images figure.busy img { opacity: .35; }
.manju-auto-videos { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); max-height: 420px; }
.manju-auto-videos video { width: 100%; max-height: 300px; border: 1px solid var(--line); border-radius: 5px; background: #000; }
.manju-auto-images figure.busy video { opacity: .35; }
.manju-auto-busy { position: absolute; top: 34%; left: 0; right: 0; color: var(--ink1); font-size: 11px; text-align: center; }
.manju-auto-image-actions { display: flex; gap: 4px; }
.manju-auto-image-actions button { flex: 1; padding: 2px 0; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink2); cursor: pointer; font: inherit; font-size: 10px; }
.manju-auto-image-actions button:disabled { opacity: .45; cursor: default; }
.manju-auto-image-error { color: var(--jc-error); font-size: 10px; line-height: 1.3; }
.manju-auto-prompt-editor { display: grid; gap: 6px; }
.manju-auto-note-input { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink1); font: inherit; font-size: 11px; resize: vertical; }
.manju-auto-revised { margin-left: 4px; color: var(--olive); font-size: 10px; font-style: normal; }
.manju-auto-text-status.derive { color: var(--olive); }
.manju-auto-prompt-editor textarea { width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink1); font: inherit; font-size: 12px; resize: vertical; }
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

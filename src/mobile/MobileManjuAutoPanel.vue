<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { MobileManjuAuto, MobileManjuCommand } from '@/services/mobileRemoteClient'
import { describeRemoteError } from './describeRemoteError'

// 漫剧全自动成片（手机端）：与电脑确认卡、进度条、审图同一个运行；参数由电脑按确认卡规则拼装。
const props = defineProps<{
  auto: MobileManjuAuto
  busy: boolean
  manju: (type: MobileManjuCommand, payload?: Record<string, unknown>) => Promise<unknown>
  loadImage: (path: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }>
}>()

const phaseLabels: Record<string, string> = {
  queued: '待做', text: '写提示词', assets: '生图中', review: '待审图', videos: '出片中', concat: '拼接中', done: '已成片', blocked: '已暂停',
}
const statusLabels: Record<string, string> = {
  running: '全自动成片运行中', blocked: '全自动成片已暂停', stopped: '全自动成片已停止', done: '全自动成片已完成',
}

const failure = ref('')
const pending = ref(false)

async function act(type: MobileManjuCommand, payload?: Record<string, unknown>) {
  if (pending.value) return undefined
  pending.value = true
  failure.value = ''
  try {
    return await props.manju(type, payload)
  } catch (cause) {
    failure.value = describeRemoteError(cause)
    return undefined
  } finally {
    pending.value = false
  }
}

// ---- 确认卡 ----
const episodes = ref<number[]>([])
const imageModelId = ref('')
const videoModelId = ref('')
const videoResolution = ref('')
const route = ref<'Seedance' | 'H3'>('Seedance')
const reviewMode = ref<'new' | 'first' | 'off'>('new')
const budget = ref<number | string>('')

const draft = computed(() => props.auto.draft)
const videoModel = computed(() => draft.value?.videoModels.find(model => model.id === videoModelId.value))
const resumeEpisode = computed(() => {
  const saved = draft.value?.saved
  return saved ? Object.keys(saved.episodes).map(Number).sort((a, b) => a - b)
    .find(n => !['done', 'videos', 'concat'].includes(saved.episodes[String(n)] || '')) : undefined
})

watch(draft, next => {
  if (!next) return
  episodes.value = next.episodes.slice()
  imageModelId.value = next.imageModels[0]?.id || ''
  videoModelId.value = next.videoModels[0]?.id || ''
  if (next.saved) route.value = next.saved.route
}, { immediate: true })
watch(videoModel, model => {
  const height = (value: string) => Number(value.replace(/\D/g, '')) || Infinity
  videoResolution.value = model?.resolutions?.slice().sort((a, b) => height(a) - height(b))[0] || ''
}, { immediate: true })

function toggleEpisode(episode: number) {
  episodes.value = episodes.value.includes(episode)
    ? episodes.value.filter(item => item !== episode)
    : [...episodes.value, episode]
}

const canStart = computed(() => Boolean(draft.value?.ratio && episodes.value.length && imageModelId.value && videoModelId.value))

function start(resume: boolean) {
  const cap = Number(budget.value)
  void act('manju.start', {
    resume,
    choice: {
      episodes: episodes.value, imageModelId: imageModelId.value, videoModelId: videoModelId.value,
      reviewMode: reviewMode.value, route: route.value, videoResolution: videoResolution.value || undefined,
      ...budget.value !== '' && Number.isFinite(cap) && cap > 0 ? { budget: cap } : {},
    },
  })
}

// ---- 审图 ----
const images = ref<Record<string, string>>({})
const editingId = ref('')
const editingText = ref('')
const anyBusy = computed(() => (props.auto.review || []).some(item => item.busy))
const loadedFor = new Map<string, string>()

function forget(id: string) {
  if (images.value[id]) URL.revokeObjectURL(images.value[id]!)
  const { [id]: _, ...rest } = images.value
  images.value = rest
  loadedFor.delete(id)
}

// 每张图按「路径 + 是否在重新生成」取一次；重新生成完成后同名文件也要重取。
watch(() => props.auto.review, async items => {
  for (const id of Object.keys(images.value)) if (!items?.some(item => item.id === id)) forget(id)
  for (const item of items || []) {
    const key = `${item.path}|${item.busy}`
    if (!item.path || item.busy || loadedFor.get(item.id) === key) continue
    loadedFor.set(item.id, key)
    try {
      const file = await props.loadImage(item.path)
      if (images.value[item.id]) URL.revokeObjectURL(images.value[item.id]!)
      images.value = { ...images.value, [item.id]: URL.createObjectURL(new Blob([file.bytes], { type: file.mime })) }
    } catch (cause) {
      loadedFor.delete(item.id)
      failure.value = describeRemoteError(cause)
    }
  }
}, { immediate: true, deep: true })

async function editPrompt(id: string) {
  editingId.value = id
  editingText.value = ''
  const result = await act('manju.prompt', { id }) as { prompt?: string } | undefined
  editingText.value = result?.prompt || ''
}

function savePrompt() {
  const id = editingId.value
  if (!id || !editingText.value.trim()) return
  editingId.value = ''
  void act('manju.regenerate', { id, prompt: editingText.value })
}

onBeforeUnmount(() => { for (const url of Object.values(images.value)) URL.revokeObjectURL(url) })
</script>

<template>
  <section class="auto">
    <!-- 审图：第 1 集（或每集新资产）出齐后暂停，等人确认。 -->
    <div v-if="auto.review" class="card">
      <strong>审核资产图</strong>
      <p>确认后这些图会锁定，后续各集直接复用。不满意可以单张重新生成或改提示词。</p>
      <div class="grid">
        <figure v-for="item in auto.review" :key="item.id" :class="{ busy: item.busy }">
          <img v-if="images[item.id]" :src="images[item.id]" :alt="item.id" />
          <div v-else class="placeholder">{{ item.busy ? '生成中…' : item.path ? '读取中…' : '图片不在成果目录' }}</div>
          <figcaption>{{ item.id }}</figcaption>
          <small v-if="item.error" class="error">{{ item.error }}</small>
          <div class="row">
            <button type="button" :disabled="item.busy || pending" @click="act('manju.regenerate', { id: item.id })">重新生成</button>
            <button type="button" :disabled="item.busy || pending" @click="editPrompt(item.id)">改提示词</button>
          </div>
        </figure>
      </div>
      <div v-if="editingId" class="editor">
        <small>改「{{ editingId }}」的提示词，保存后只重新生成这一张</small>
        <textarea v-model="editingText" rows="6" />
        <div class="row">
          <button type="button" @click="editingId = ''">取消</button>
          <button type="button" class="primary" :disabled="!editingText.trim() || pending" @click="savePrompt">保存并重新生成</button>
        </div>
      </div>
      <div class="row end">
        <button type="button" :disabled="pending" @click="act('manju.stop')">停止</button>
        <button type="button" class="primary" :disabled="anyBusy || pending" @click="act('manju.approve')">确认并继续</button>
      </div>
    </div>

    <!-- 启动确认卡：参数只是选择，电脑按确认卡同一规则拼装。 -->
    <div v-else-if="draft" class="card">
      <strong>开始全自动成片</strong>
      <p v-if="!draft.episodes.length" class="error">还没有分集剧本。请先在全自动模式下发送剧本。</p>
      <p v-else-if="!draft.ratio" class="error">项目风格里还没有确认影片比例，请先确认比例与风格。</p>
      <template v-else>
        <div class="field"><span>集数</span>
          <div class="chips">
            <button v-for="episode in draft.episodes" :key="episode" type="button" :class="{ on: episodes.includes(episode) }" @click="toggleEpisode(episode)">{{ episode }}</button>
          </div>
        </div>
        <label class="field"><span>生图模型</span>
          <select v-model="imageModelId"><option v-for="model in draft.imageModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
        </label>
        <label class="field"><span>视频模型</span>
          <select v-model="videoModelId"><option v-for="model in draft.videoModels" :key="model.id" :value="model.id">{{ model.label }}{{ model.price !== undefined ? ` · ${model.price}` : '' }}</option></select>
        </label>
        <label v-if="videoModel?.resolutions?.length" class="field"><span>分辨率</span>
          <select v-model="videoResolution"><option v-for="resolution in videoModel.resolutions" :key="resolution" :value="resolution">{{ resolution }}</option></select>
        </label>
        <label class="field"><span>视频路线</span>
          <select v-model="route">
            <option value="Seedance">Seedance 提示词</option>
            <option value="H3">MiniMax H3 提示词</option>
          </select>
        </label>
        <label class="field"><span>审图</span>
          <select v-model="reviewMode">
            <option value="new">每集有新资产就审</option>
            <option value="first">只审第 1 集</option>
            <option value="off">不审</option>
          </select>
        </label>
        <label class="field"><span>单集预算</span><span><input v-model="budget" type="number" min="0" step="1" inputmode="decimal" placeholder="不限" /> 元</span></label>
        <p>比例 {{ draft.ratio }}（项目风格已确认）。超过单集预算即暂停。</p>
      </template>
      <div class="row end">
        <button type="button" :disabled="pending" @click="act('manju.cancel')">取消</button>
        <button v-if="draft.saved" type="button" :disabled="!canStart || pending || busy" @click="start(true)">从第 {{ resumeEpisode ?? 1 }} 集续做</button>
        <button type="button" class="primary" :disabled="!canStart || pending || busy" @click="start(false)">开始全自动</button>
      </div>
    </div>

    <div v-if="auto.run" class="progress" :class="auto.run.status">
      <JcIcon name="movie" />
      <span>{{ statusLabels[auto.run.status] }}</span>
      <span v-for="(episode, key) in auto.run.episodes" :key="key" class="chip" :class="episode.phase">第{{ key }}集 {{ phaseLabels[episode.phase] || episode.phase }}</span>
      <button v-if="auto.run.status === 'running' && !auto.review" type="button" :disabled="pending" @click="act('manju.stop')">停止</button>
    </div>

    <button
      v-if="!auto.draft && !auto.review && auto.run?.status !== 'running'"
      type="button"
      class="launch"
      :disabled="auto.preparing || pending || busy"
      @click="act('manju.prepare')"
    >
      <JcIcon name="movie" />
      <span>{{ auto.preparing ? '正在准备全自动成片…' : '全自动成片' }}</span>
    </button>

    <p v-if="failure || auto.error" class="error">{{ failure || auto.error }}</p>
  </section>
</template>

<style scoped>
.auto { display: flex; flex-direction: column; gap: 8px; }
.card { display: flex; flex-direction: column; gap: 8px; max-height: 55vh; overflow-y: auto; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 13px; }
.card p { margin: 0; color: var(--ink2); font-size: 12px; line-height: 1.5; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
figure { margin: 0; display: flex; flex-direction: column; gap: 4px; }
figure img, .placeholder { width: 100%; aspect-ratio: 9 / 16; object-fit: contain; border-radius: 6px; background: #000; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 12px; }
figure.busy img { opacity: 0.5; }
figcaption { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink2); font-size: 11px; }
.row { display: flex; gap: 6px; }
.row.end { justify-content: flex-end; }
.row button, .launch, .progress button, .chips button { min-height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 12px; cursor: pointer; }
.row button.primary { border-color: var(--olive); background: var(--olive); color: #fff; }
button:disabled { opacity: 0.55; cursor: default; }
.editor { display: flex; flex-direction: column; gap: 6px; }
.editor textarea { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg, var(--surface)); color: var(--ink1); font: inherit; font-size: 13px; }
.field { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 8px; }
.field > span:first-child { color: var(--ink3); font-size: 12px; }
.field select, .field input { min-width: 0; max-width: 100%; padding: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 13px; }
.field input { width: 90px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button.on { border-color: var(--olive); background: color-mix(in srgb, var(--olive) 14%, var(--surface)); }
.launch { display: flex; align-items: center; justify-content: center; gap: 6px; }
.progress { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--ink2); font-size: 12px; }
.chip { padding: 1px 6px; border: 1px solid var(--line); border-radius: 6px; }
.chip.blocked { color: var(--danger, #c0392b); }
.chip.done { color: var(--olive); }
.error { margin: 0; color: var(--danger, #c0392b); font-size: 12px; }
</style>

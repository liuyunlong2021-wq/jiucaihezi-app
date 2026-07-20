<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  getMediaPlanEditorControls,
  validateMediaPlan,
  type MediaPlan,
  type MediaPlanParameterPatch,
} from '@/runtime/workbench/mediaPlan'
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { displayModelLabel, getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'

const props = defineProps<{
  plan: MediaPlan
  status?: 'ready' | 'submitting' | 'submitted' | 'failed'
  error?: string
  blocked?: boolean
}>()

const emit = defineEmits<{
  (event: 'approve'): void
  (event: 'removeReference', id: string): void
  (event: 'updateParameters', patch: MediaPlanParameterPatch): void
}>()

const kindLabel = {
  image: '图片',
  video: '视频',
} as const

const spec = computed(() => getCreationModelSpec(props.plan.modelId))
const controls = computed(() => getMediaPlanEditorControls(props.plan))
const showEditor = ref(false)
const modelLabel = computed(() => displayModelLabel(spec.value?.label || props.plan.modelId))
const effectiveMode = computed(() => {
  try {
    return buildCreationRunPlan({
      modelId: props.plan.modelId,
      params: {
        prompt: props.plan.prompt,
        ...(props.plan.ratio ? { ratio: props.plan.ratio } : {}),
        ...(props.plan.resolution ? { resolution: props.plan.resolution } : {}),
        ...(props.plan.referenceImages?.length ? { images: props.plan.referenceImages } : {}),
        ...(props.plan.referenceVideos?.length ? { videos: props.plan.referenceVideos } : {}),
        ...(props.plan.duration !== undefined ? { duration: props.plan.duration } : {}),
      },
    }).mode
  } catch {
    return spec.value?.mode
  }
})
const modeLabel = computed(() => {
  const labels: Record<string, string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    'text-to-video': '文生视频',
    'image-to-video': '图生视频',
    'video-edit': '视频编辑',
  }
  return labels[effectiveMode.value || ''] || '媒体生成'
})
const canApprove = computed(() => {
  if (props.blocked) return false
  if (props.status && props.status !== 'ready' && props.status !== 'failed') return false
  if (props.plan.mediaReferences?.some(reference => reference.invalidReason)) return false
  try {
    validateMediaPlan(props.plan)
    return true
  } catch {
    return false
  }
})
const canEdit = computed(() => !props.status || props.status === 'ready' || props.status === 'failed')

function approve() {
  if (!canApprove.value) return
  emit('approve')
}

function updateText(key: 'modelId' | 'ratio' | 'resolution', event: Event) {
  emit('updateParameters', { [key]: (event.target as HTMLSelectElement).value })
}

function updateDuration(event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  emit('updateParameters', { duration: target.value })
}
</script>

<template>
  <section class="media-plan-card" aria-label="媒体生成计划">
    <div class="media-plan-head">
      <div>
        <strong>{{ plan.title }}</strong>
        <span>{{ kindLabel[plan.kind] }} · {{ modelLabel }} · {{ modeLabel }}</span>
      </div>
      <JcIcon name="palette" aria-hidden="true" />
    </div>
    <p class="media-plan-prompt">{{ plan.prompt }}</p>
    <div v-if="plan.mediaReferences?.length" class="media-plan-references">
      <div
        v-for="reference in plan.mediaReferences"
        :key="reference.id"
        class="media-plan-reference"
      >
        <img v-if="reference.kind === 'image'" :src="reference.value" :alt="reference.label" />
        <JcIcon v-else name="movie" />
        <span>{{ reference.label }}</span>
        <button type="button" title="移除参考素材" @click="emit('removeReference', reference.id)">
          <JcIcon name="close" />
        </button>
      </div>
    </div>
    <p v-if="plan.referenceImages?.length || plan.referenceVideos?.length" class="media-plan-meta">
      已附参考素材
      {{ (plan.referenceImages?.length || 0) + (plan.referenceVideos?.length || 0) }}
      个
    </p>
    <p
      v-if="plan.ratio || plan.resolution || plan.duration !== undefined || spec?.price !== undefined"
      class="media-plan-meta"
    >
      <span v-if="plan.ratio">比例 {{ plan.ratio }}</span>
      <span v-if="plan.resolution">{{ plan.ratio ? ' · ' : '' }}分辨率 {{ plan.resolution }}</span>
      <span v-if="plan.duration !== undefined"
        >{{ plan.ratio || plan.resolution ? ' · ' : '' }}时长 {{ plan.duration }} 秒</span
      >
      <span v-if="spec?.price !== undefined"
        >{{ plan.ratio || plan.resolution || plan.duration !== undefined ? ' · ' : '' }}价格 {{ spec.price }}</span
      >
    </p>
    <div v-if="showEditor && canEdit" class="media-plan-editor">
      <label>
        <span>模型</span>
        <select :value="plan.modelId" @change="updateText('modelId', $event)">
          <option v-for="option in controls.models" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="controls.ratios.length">
        <span>比例</span>
        <select :value="plan.ratio" @change="updateText('ratio', $event)">
          <option v-for="option in controls.ratios" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="controls.resolutions.length">
        <span>分辨率</span>
        <select :value="plan.resolution" @change="updateText('resolution', $event)">
          <option v-for="option in controls.resolutions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="controls.durations.length">
        <span>时长</span>
        <select :value="plan.duration" @change="updateDuration">
          <option v-for="option in controls.durations" :key="option.value" :value="option.value">
            {{ option.label }} 秒
          </option>
        </select>
      </label>
      <label v-else-if="controls.durationRange">
        <span>时长</span>
        <input
          type="number"
          :value="plan.duration"
          :min="controls.durationRange.min"
          :max="controls.durationRange.max"
          :step="controls.durationRange.step"
          @change="updateDuration"
        >
      </label>
    </div>
    <p v-if="error" class="media-plan-error">{{ error }}</p>
    <div v-if="canEdit" class="media-plan-actions">
      <button type="button" class="media-plan-adjust" @click="showEditor = !showEditor">
        <JcIcon name="tune" />
        调整
      </button>
      <button type="button" class="media-plan-submit" :disabled="!canApprove" @click="approve">
        <JcIcon name="play_arrow" />
        开始生成
      </button>
    </div>
    <span v-else-if="status === 'submitting'" class="media-plan-status">正在提交到创作面板…</span>
    <span v-else-if="status === 'submitted'" class="media-plan-status"
      >已提交，结果将在创作面板和画布中显示。</span
    >
  </section>
</template>

<style scoped>
.media-plan-card {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--olive) 28%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--olive) 6%, transparent);
}
.media-plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.media-plan-head strong {
  display: block;
  color: var(--ink1);
  font-size: 13px;
}
.media-plan-head span,
.media-plan-meta,
.media-plan-status {
  color: var(--ink3);
  font-size: 11px;
}
.media-plan-prompt {
  margin: 8px 0 4px;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.media-plan-references {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.media-plan-reference {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 11px;
}
.media-plan-reference img {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  object-fit: cover;
}
.media-plan-reference span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-plan-reference button {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
  place-items: center;
}
.media-plan-meta {
  margin: 0 0 8px;
}
.media-plan-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: color-mix(in srgb, var(--paper) 88%, transparent);
}
.media-plan-editor label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--ink3);
  font-size: 11px;
}
.media-plan-editor select,
.media-plan-editor input {
  width: 100%;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink2);
  font: inherit;
}
.media-plan-error {
  margin: 8px 0;
  color: var(--danger, #c0392b);
  font-size: 12px;
}
.media-plan-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.media-plan-submit,
.media-plan-adjust {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.media-plan-submit {
  border-color: var(--olive);
  background: var(--olive);
  color: #fff;
}
.media-plan-submit:hover {
  background: var(--olive-dark);
}
.media-plan-adjust {
  border-color: color-mix(in srgb, var(--olive) 42%, var(--line));
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.media-plan-submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.media-plan-status {
  display: block;
  line-height: 1.5;
}
@media (max-width: 640px) {
  .media-plan-editor { grid-template-columns: 1fr; }
}
</style>

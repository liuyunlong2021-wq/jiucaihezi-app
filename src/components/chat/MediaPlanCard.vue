<script setup lang="ts">
import { computed } from 'vue'
import { validateMediaPlan, type MediaPlan } from '@/runtime/workbench/mediaPlan'
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
}>()

const kindLabel = {
  image: '图片',
  video: '视频',
} as const

const spec = computed(() => getCreationModelSpec(props.plan.modelId))
const modelLabel = computed(() => displayModelLabel(spec.value?.label || props.plan.modelId))
const effectiveMode = computed(() => {
  try {
    return buildCreationRunPlan({
      modelId: props.plan.modelId,
      params: {
        prompt: props.plan.prompt,
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

function approve() {
  if (!canApprove.value) return
  emit('approve')
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
    <p v-if="plan.duration !== undefined || spec?.price !== undefined" class="media-plan-meta">
      <span v-if="plan.duration !== undefined">时长 {{ plan.duration }} 秒</span>
      <span v-if="spec?.price !== undefined"
        >{{ plan.duration !== undefined ? ' · ' : '' }}价格 {{ spec.price }}</span
      >
    </p>
    <p v-if="error" class="media-plan-error">{{ error }}</p>
    <button
      v-if="!status || status === 'ready' || status === 'failed'"
      type="button"
      class="media-plan-submit"
      :disabled="!canApprove"
      @click="approve"
    >
      <JcIcon name="play_arrow" />
      开始生成
    </button>
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
  border: 1px solid color-mix(in srgb, var(--accent, #6c5ce7) 28%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #6c5ce7) 6%, transparent);
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
.media-plan-error {
  margin: 8px 0;
  color: var(--danger, #c0392b);
  font-size: 12px;
}
.media-plan-submit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: var(--accent, #6c5ce7);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.media-plan-submit:hover {
  filter: brightness(1.08);
}
.media-plan-submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.media-plan-status {
  display: block;
  line-height: 1.5;
}
</style>

<script setup lang="ts">
/**
 * MediaTaskBubble.vue — 媒体任务气泡
 * 
 * 在对话区显示媒体生成任务的实时进度和最终结果。
 * 响应式连接到 mediaTaskStore，自动更新。
 */
import { computed, ref } from 'vue'
import { useMediaTaskStore, type MediaTask } from '@/stores/mediaTaskStore'
import { emitEvent } from '@/utils/eventBus'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'
import { useProjectStore } from '@/stores/projectStore'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { openProjectResource } from '@/services/projectExplorerService'
import { classifyProjectResource, type ProjectResource } from '@/utils/projectResource'
import { saveGeneratedFile } from '@/utils/exportSave'
import { fetchCreationMediaBlob } from '@/utils/creationMediaCache'

const props = defineProps<{
  taskId: string
}>()

const taskStore = useMediaTaskStore()
const projectStore = useProjectStore()
const projectFiles = createRuntimeProjectFileService()

const task = computed<MediaTask | undefined>(() => taskStore.getTask(props.taskId))

const isRunning = computed(() => task.value?.status === 'running' || task.value?.status === 'pending')
const isSuccess = computed(() => task.value?.status === 'success')
const isFailed = computed(() => task.value?.status === 'failed')
const hasSaveWarning = computed(() => task.value?.status === 'success' && task.value.assetStatus === 'failed')
const isSafeResult = computed(() => {
  const t = task.value
  return Boolean(t && (t.projectPath || t.assetUri || t.resultUrl))
})
const hasDisplayableResult = computed(() =>
  isSafeResult.value || Boolean(task.value?.type === 'text' && task.value.resultText),
)
const linkCopied = ref(false)
const projectResource = computed<ProjectResource | undefined>(() => {
  const t = task.value
  const path = String(t?.projectPath || '')
  const owner = String(t?.projectId || projectStore.projectDir.value || '')
  if (!t || !path || !owner) return undefined
  const mimeType = t.type === 'video' ? 'video/mp4'
    : t.type === 'audio' ? 'audio/mpeg'
      : t.type === 'image' ? 'image/png' : 'model/gltf-binary'
  return {
    runtime: t.projectId ? 'web' : 'desktop',
    owner,
    path,
    name: path.split('/').pop() || path,
    isDirectory: false,
    mimeType,
    kind: classifyProjectResource({ path, mimeType }),
  }
})
const displayUrl = computed(() => task.value?.resultUrl || '')

async function cancel() {
  await taskStore.cancelTask(props.taskId)
}

async function retrySave() {
  await taskStore.retryMediaPersistence(props.taskId)
}

async function downloadCopy() {
  const resource = projectResource.value
  if (resource) {
    const binary = await projectFiles.readBinary(resource)
    await saveGeneratedFile({
      filename: resource.name,
      mimeType: binary.mimeType || resource.mimeType || 'application/octet-stream',
      data: binary.data,
    })
    return
  }
  const t = task.value
  if (!t?.resultUrl || !isAllowedCreationResultUrl(t.resultUrl)) return
  await saveGeneratedFile({
    filename: `${t.modelLabel}_${t.id}.${t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : t.type === 'model3d' ? 'glb' : 'png'}`,
    mimeType: t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : t.type === 'model3d' ? 'model/gltf-binary' : 'image/png',
    data: (await fetchCreationMediaBlob(t.resultUrl, t.type === 'video' ? 'video' : t.type === 'audio' ? 'audio' : t.type === 'model3d' ? 'model3d' : 'image')).blob,
  })
}

async function copyOriginalLink() {
  const url = task.value?.resultUrl
  if (!url) return
  await navigator.clipboard.writeText(url)
  linkCopied.value = true
  window.setTimeout(() => { linkCopied.value = false }, 1400)
}

async function revealInTree() {
  const resource = projectResource.value
  if (!resource) return
  emitEvent('project-filetree:locate', { path: resource.path })
  emitEvent('memory:open-resource', await openProjectResource(projectFiles, resource))
}

async function previewResult() {
  if (!projectResource.value) return
  await revealInTree()
}

</script>

<template>
  <div v-if="task" class="mtb" :class="task.status">
    <!-- 运行中 -->
    <div v-if="isRunning" class="mtb-running">
      <div class="mtb-header">
        <JcIcon name="hourglass_bottom" class="mtb-spin" />
        <span class="mtb-model">{{ task.modelLabel }}</span>
        <span class="mtb-type">{{ task.type === 'image' ? '图片' : task.type === 'video' ? '视频' : task.type === 'model3d' ? '3D 模型' : task.type === 'text' ? '文本' : '音频' }}生成中</span>
        <button v-if="taskStore.canCancelTask(task.id)" class="mtb-cancel" @click="cancel" title="取消任务" aria-label="取消任务">
          <JcIcon name="close" />
        </button>
      </div>
      <div class="mtb-progress-bar">
        <div class="mtb-progress-fill" :style="{ width: task.progress + '%' }"></div>
      </div>
      <div class="mtb-progress-text">{{ task.progressText }}</div>
    </div>

    <!-- 成功 -->
    <div v-else-if="isSuccess && hasDisplayableResult" class="mtb-result">
      <div v-if="task.type === 'text' && task.resultText" class="mtb-text-result">{{ task.resultText }}</div>
      <img v-else-if="task.type === 'image' && isAllowedCreationResultUrl(displayUrl)" :src="displayUrl" loading="lazy" decoding="async" class="mtb-image" @click="previewResult" />
      <div v-else-if="task.type === 'image'" class="mtb-file-result">
        <JcIcon name="image" />
        <span>{{ projectResource ? '图片已保存到项目' : '图片已生成，等待保存' }}</span>
      </div>
      <button
        v-else-if="task.type === 'video' || task.type === 'audio'"
        type="button"
        class="mtb-media-preview"
        :disabled="!projectResource"
        :title="projectResource ? '打开预览' : '媒体尚未保存到项目'"
        @click="previewResult"
      >
        <JcIcon :name="task.type === 'video' ? 'movie' : 'music-note'" />
        <span>{{ task.type === 'video' ? '打开视频' : '播放音频' }}</span>
      </button>
      <div v-else-if="task.type === 'model3d'" class="mtb-file-result">
        <JcIcon name="deployed_code" />
        <span>3D 模型文件已生成</span>
      </div>
      <div v-if="task.projectPath" class="mtb-saved-path">已保存到 {{ task.projectPath }}</div>
      <div v-else-if="hasSaveWarning" class="mtb-save-warning">
        媒体已生成，但保存到项目失败。
        <button type="button" @click="retrySave">重试保存</button>
      </div>
      <div v-if="task.type !== 'text'" class="mtb-actions">
        <button class="mtb-act-btn" @click="downloadCopy" title="下载副本">
          <JcIcon name="download" /> 下载
        </button>
        <button class="mtb-act-btn" @click="copyOriginalLink" title="复制上游返回的原始链接">
          <JcIcon name="link" /> {{ linkCopied ? '已复制' : '原始链接' }}
        </button>
        <button v-if="projectResource" class="mtb-act-btn" @click="revealInTree" title="在文件树中查看">
          <JcIcon name="folder_open" /> 在文件树中查看
        </button>
      </div>
    </div>

    <!-- 失败 -->
    <div v-else-if="isFailed" class="mtb-failed">
      <JcIcon name="error" style="color:var(--danger)" />
      <span>生成失败: {{ task.errorMsg }}</span>
    </div>

    <!-- 已取消 -->
    <div v-else-if="task.status === 'cancelled'" class="mtb-cancelled">
      <JcIcon name="cancel" />
      <span>{{ task.progressText || '已取消' }}</span>
    </div>

    <div v-else class="mtb-failed">
      <JcIcon name="error" />
      <span>任务结果不可用</span>
    </div>
  </div>
</template>

<style scoped>
.mtb {
  margin: 8px 0;
  padding: 12px;
  border-radius: 12px;
  background: rgba(var(--ink-rgb, 200,200,220), 0.04);
  border: 1px solid rgba(var(--ink-rgb, 200,200,220), 0.08);
}

.mtb-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.mtb-model { font-weight: 600; color: var(--olive-dark); }
.mtb-type { color: var(--ink2, #888); }
.mtb-cancel {
  margin-left: auto;
  background: none; border: none; cursor: pointer;
  color: var(--ink3, #999); padding: 2px;
}
.mtb-cancel:hover { color: var(--danger, #e74c3c); }

.mtb-spin {
  animation: mtb-spin-anim 1.5s ease-in-out infinite;
  color: var(--olive);
}
@keyframes mtb-spin-anim {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
}

.mtb-progress-bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--olive) 12%, transparent);
  overflow: hidden;
}
.mtb-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--olive-dark), var(--olive));
  transition: width 0.5s ease;
}
.mtb-progress-text {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink3, #999);
}

.mtb-result { display: flex; flex-direction: column; gap: 8px; }
.mtb-image {
  max-width: 100%;
  max-height: 400px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
}
.mtb-media-preview {
  display: grid;
  width: 100%;
  min-height: 112px;
  place-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
}
.mtb-media-preview:hover:not(:disabled) { border-color: var(--olive); color: var(--olive); }
.mtb-media-preview:disabled { cursor: default; opacity: .55; }
.mtb-media-preview .mso { font-size: 34px; }
.mtb-file-result {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  color: var(--ink2, #888);
}
.mtb-text-result { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); }
.mtb-saved-path { color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.mtb-save-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--danger, #c0392b);
  font-size: 12px;
}
.mtb-save-warning button {
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mtb-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mtb-act-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 4px 10px;
  border: 1px solid rgba(var(--ink-rgb, 200,200,220), 0.12);
  border-radius: 6px;
  background: rgba(var(--ink-rgb, 200,200,220), 0.04);
  font-size: 12px;
  cursor: pointer;
  color: var(--ink2, #aaa);
  transition: all 0.15s;
}
.mtb-act-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
  border-color: var(--olive);
}
.mtb-act-btn .mso { font-size: 14px; }

.mtb-failed, .mtb-cancelled {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--ink3, #999);
}
.mtb-failed .mso { font-size: 16px; }
</style>

<script setup lang="ts">
/**
 * MediaTaskBubble.vue — 媒体任务气泡
 * 
 * 在对话区显示媒体生成任务的实时进度和最终结果。
 * 响应式连接到 mediaTaskStore，自动更新。
 */
import { computed } from 'vue'
import { useMediaTaskStore, type MediaTask } from '@/stores/mediaTaskStore'
import { emitEvent } from '@/utils/eventBus'
import { useFileStore } from '@/composables/useFileStore'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'

const props = defineProps<{
  taskId: string
}>()

const taskStore = useMediaTaskStore()
const fileStore = useFileStore()

const task = computed<MediaTask | undefined>(() => taskStore.getTask(props.taskId))

const isRunning = computed(() => task.value?.status === 'running' || task.value?.status === 'pending')
const isSuccess = computed(() => task.value?.status === 'success')
const isFailed = computed(() => task.value?.status === 'failed')
const isSafeResult = computed(() => Boolean(task.value?.resultUrl && isAllowedCreationResultUrl(task.value.resultUrl)))

function cancel() {
  taskStore.cancelTask(props.taskId)
}

/** 保存到文件-媒体 (FileTree) */
async function saveToFiles() {
  const url = task.value?.resultUrl
  if (!url || !isAllowedCreationResultUrl(url)) return
  const t = task.value!
  if (t.type === 'text') return
  const ext = t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : 'png'
  const fileType: 'image' | 'video' | 'audio' = t.type
  const mimeType = t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : 'image/png'
  await fileStore.addMedia(
    `${t.modelLabel}_${new Date(t.createdAt).toLocaleTimeString('zh-CN')}.${ext}`,
    url,
    fileType,
    mimeType
  )
}

/** 发送到创作面板画廊 */
function sendToGallery() {
  if (!task.value?.resultUrl || !isAllowedCreationResultUrl(task.value.resultUrl)) return
  emitEvent('send-to-gallery', {
    url: task.value.resultUrl,
    type: task.value.type,
    name: `${task.value.modelLabel} 生成`,
  })
  emitEvent('switch-panel', 'creation')
}

/** 作为参考图发送到创作面板 */
function sendAsReference() {
  if (!task.value?.resultUrl || !isAllowedCreationResultUrl(task.value.resultUrl)) return
  emitEvent('import-to-creation', {
    url: task.value.resultUrl,
    type: task.value.type === 'video' ? 'video' : 'image',
    name: `${task.value.modelLabel} 参考`,
  })
  emitEvent('switch-panel', 'creation')
}
</script>

<template>
  <div v-if="task" class="mtb" :class="task.status">
    <!-- 运行中 -->
    <div v-if="isRunning" class="mtb-running">
      <div class="mtb-header">
        <span class="mso mtb-spin">hourglass_bottom</span>
        <span class="mtb-model">{{ task.modelLabel }}</span>
        <span class="mtb-type">{{ task.type === 'image' ? '图片' : task.type === 'video' ? '视频' : '音频' }}生成中</span>
        <button class="mtb-cancel" @click="cancel" title="取消">
          <span class="mso">close</span>
        </button>
      </div>
      <div class="mtb-progress-bar">
        <div class="mtb-progress-fill" :style="{ width: task.progress + '%' }"></div>
      </div>
      <div class="mtb-progress-text">{{ task.progressText }}</div>
    </div>

    <!-- 成功 -->
    <div v-else-if="isSuccess && isSafeResult" class="mtb-result">
      <img v-if="task.type === 'image'" :src="task.resultUrl" class="mtb-image" />
      <video v-else-if="task.type === 'video'" :src="task.resultUrl" controls class="mtb-video" />
      <audio v-else-if="task.type === 'audio'" :src="task.resultUrl" controls class="mtb-audio" />
      <div class="mtb-actions">
        <button class="mtb-act-btn" @click="saveToFiles" title="保存到文件">
          <span class="mso">save</span> 保存
        </button>
        <button class="mtb-act-btn" @click="sendToGallery" title="加入画廊">
          <span class="mso">filter</span> 画廊
        </button>
        <button v-if="task.type === 'image'" class="mtb-act-btn" @click="sendAsReference" title="作为参考图">
          <span class="mso">image</span> 参考图
        </button>
      </div>
    </div>

    <!-- 失败 -->
    <div v-else-if="isFailed" class="mtb-failed">
      <span class="mso" style="color:var(--danger)">error</span>
      <span>生成失败: {{ task.errorMsg }}</span>
    </div>

    <!-- 已取消 -->
    <div v-else class="mtb-cancelled">
      <span class="mso">cancel</span>
      <span>已取消</span>
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
.mtb-model { font-weight: 600; color: var(--accent, #6c5ce7); }
.mtb-type { color: var(--ink2, #888); }
.mtb-cancel {
  margin-left: auto;
  background: none; border: none; cursor: pointer;
  color: var(--ink3, #999); padding: 2px;
}
.mtb-cancel:hover { color: var(--danger, #e74c3c); }

.mtb-spin {
  animation: mtb-spin-anim 1.5s ease-in-out infinite;
  color: var(--accent, #6c5ce7);
}
@keyframes mtb-spin-anim {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
}

.mtb-progress-bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 2px;
  background: rgba(var(--ink-rgb, 200,200,220), 0.1);
  overflow: hidden;
}
.mtb-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #6c5ce7, #a29bfe);
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
.mtb-video {
  max-width: 100%;
  max-height: 360px;
  border-radius: 8px;
}
.mtb-audio { width: 100%; }

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
  background: rgba(var(--accent-rgb, 108,92,231), 0.1);
  color: var(--accent, #6c5ce7);
  border-color: var(--accent, #6c5ce7);
}
.mtb-act-btn .mso { font-size: 14px; }

.mtb-failed, .mtb-cancelled {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--ink3, #999);
}
.mtb-failed .mso { font-size: 16px; }
</style>

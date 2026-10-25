<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { renderStreamingText } from '@/components/chat/display/streamingTextRenderer'
import type {
  MobileRemoteFileEntry,
  MobileRemoteFileKind,
  MobileRemoteProject,
} from '@/services/mobileRemoteClient'
import { describeRemoteError } from './describeRemoteError'

// 看成果：只读浏览电脑项目里的 wiki 与图片视频；文件内容现取现看，手机不留副本。
const props = defineProps<{
  listProjects: () => Promise<MobileRemoteProject[]>
  listFiles: (projectId: string, path?: string) => Promise<MobileRemoteFileEntry[]>
  readFile: (projectId: string, path: string, onProgress?: (received: number, size: number) => void) => Promise<{
    path: string; kind: MobileRemoteFileKind; mime: string; bytes: Uint8Array<ArrayBuffer>
  }>
}>()

defineEmits<{ close: [] }>()

const projectId = ref('')
const path = ref('')
const entries = ref<MobileRemoteFileEntry[]>([])
const loading = ref(false)
const failure = ref('')
const progress = ref('')
const preview = ref<{ name: string; kind: MobileRemoteFileKind; text?: string; url?: string } | null>(null)

const crumbs = computed(() => path.value ? path.value.split('/') : [])

function megabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1)
}

function closePreview() {
  if (preview.value?.url) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}

async function open(next: string) {
  loading.value = true
  failure.value = ''
  try {
    if (!projectId.value) {
      const project = (await props.listProjects()).find(item => item.current)
      if (!project) throw new Error('请先在电脑上打开项目里的任一对话')
      projectId.value = project.projectId
    }
    entries.value = await props.listFiles(projectId.value, next)
    path.value = next
  } catch (cause) {
    failure.value = describeRemoteError(cause)
  } finally {
    loading.value = false
  }
}

async function view(entry: MobileRemoteFileEntry) {
  if (entry.isDir) return open(entry.path)
  if (!entry.kind) {
    failure.value = describeRemoteError('FILE_TYPE_NOT_ALLOWED')
    return
  }
  closePreview()
  loading.value = true
  failure.value = ''
  progress.value = ''
  try {
    const file = await props.readFile(projectId.value, entry.path, (received, size) => {
      progress.value = size > 1024 * 1024 ? `正在从电脑取 ${megabytes(received)} / ${megabytes(size)} MB` : ''
    })
    preview.value = file.kind === 'text'
      ? { name: entry.name, kind: 'text', text: new TextDecoder().decode(file.bytes) }
      : { name: entry.name, kind: file.kind, url: URL.createObjectURL(new Blob([file.bytes], { type: file.mime })) }
  } catch (cause) {
    failure.value = describeRemoteError(cause)
  } finally {
    loading.value = false
    progress.value = ''
  }
}

function up() {
  if (preview.value) return closePreview()
  const parts = crumbs.value
  // 成果根下一级就是 wiki / .raw/jc-media，回到根目录列表。
  void open(parts.length <= 1 || (parts[0] === '.raw' && parts.length <= 2) ? '' : parts.slice(0, -1).join('/'))
}

onMounted(() => { void open('') })
onBeforeUnmount(closePreview)
</script>

<template>
  <section class="files">
    <header>
      <button type="button" title="返回上一级" aria-label="返回上一级" :disabled="!path && !preview" @click="up">
        <JcIcon name="arrow_back" />
      </button>
      <strong>{{ preview?.name || (path ? crumbs.at(-1) : '成果') }}</strong>
      <button type="button" title="回到聊天" aria-label="回到聊天" @click="$emit('close')">
        <JcIcon name="close" />
      </button>
    </header>

    <div class="body">
      <p v-if="loading" class="hint">{{ progress || '正在读取电脑上的文件…' }}</p>
      <p v-if="failure" class="hint error">{{ failure }}</p>

      <template v-if="preview">
        <div v-if="preview.kind === 'text'" class="text" v-html="renderStreamingText(preview.text || '')" />
        <img v-else-if="preview.kind === 'image'" :src="preview.url" :alt="preview.name" />
        <video v-else :src="preview.url" controls playsinline />
      </template>

      <template v-else-if="!loading">
        <p v-if="!entries.length && !failure" class="hint">这里还没有成果。</p>
        <button v-for="entry in entries" :key="entry.path" type="button" class="entry" @click="view(entry)">
          <JcIcon :name="entry.isDir ? 'folder' : entry.kind === 'image' ? 'image' : entry.kind === 'video' ? 'movie' : 'description'" />
          <span>{{ entry.name }}</span>
          <small v-if="entry.size && entry.size > 1024 * 1024">{{ megabytes(entry.size) }} MB</small>
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.files { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; color: var(--ink1); }
.files > header { display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top) + 10px) 14px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.files > header strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.files > header button { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink2); cursor: pointer; }
.files > header button:disabled { opacity: 0.4; cursor: default; }
.body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.entry { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.entry span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry small { color: var(--ink3); font-size: 11px; }
.text { font-size: 14px; line-height: 1.7; word-break: break-word; white-space: pre-wrap; }
.body img, .body video { width: 100%; border-radius: 8px; background: #000; }
.hint { margin: 0; color: var(--ink3); font-size: 13px; text-align: center; }
.hint.error { color: var(--danger, #c0392b); }
</style>

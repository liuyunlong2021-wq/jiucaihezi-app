<script setup lang="ts">
/**
 * UploadNode — 1:1 对照 T8-penguin-canvas UploadNode.tsx
 *
 * 三合一上传(图像/视频/音频) · MIME 自动识别 · 多文件合集 · 预览 · 重置/清空/添加
 */
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { buildGatewayHeaders } from '@/services/newApiClient'
import { getApiKey } from '@/services/newApiAuth'
import { isTauriRuntime } from '@/utils/tauriEnv'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const error = ref<string | null>(null)
const uploading = ref(false)
const dragActive = ref(false)
const size = ref({ w: 260, h: undefined as number | undefined })
const fileInputRef = ref<HTMLInputElement | null>(null)

type UploadKind = 'image' | 'video' | 'audio'
interface MediaItem { kind: UploadKind; url: string; name: string; size: number; mime: string }

const KIND_META: Record<UploadKind, { label: string; accept: string; icon: string; color: string; dataField: string }> = {
  image: { label: '图像', accept: 'image/*', icon: 'image',       color: '#f59e0b', dataField: 'imageUrl' },
  video: { label: '视频', accept: 'video/*', icon: 'movie',       color: '#f43f5e', dataField: 'videoUrl' },
  audio: { label: '音频', accept: 'audio/*', icon: 'music_note',  color: '#a78bfa', dataField: 'audioUrl' },
}

function inferKind(file: File): UploadKind | null {
  const m = file.type; if (!m) return null
  if (m.startsWith('image/')) return 'image'; if (m.startsWith('video/')) return 'video'; if (m.startsWith('audio/')) return 'audio'
  return null
}

const uploadType = computed<UploadKind | null>(() => {
  const t = props.data?.uploadType; return t && ['image','video','audio'].includes(t) ? t : null
})
const meta = computed(() => uploadType.value ? KIND_META[uploadType.value] : null)
const handleColor = computed(() => meta.value?.color || '#94a3b8')

function getItems(): MediaItem[] {
  const d = props.data || {}; const k = uploadType.value; if (!k) return []
  const field = KIND_META[k].dataField
  const urlsF = k === 'image' ? 'imageUrls' : k === 'video' ? 'videoUrls' : 'audioUrls'
  const urls: string[] = Array.isArray(d[urlsF]) ? d[urlsF] : (d[field] ? [d[field]] : [])
  const names: string[] = Array.isArray(d.fileNames) ? d.fileNames : (d.fileName ? [d.fileName] : [])
  const sizes: number[] = Array.isArray(d.fileSizes) ? d.fileSizes : (d.fileSize ? [d.fileSize] : [])
  const mimes: string[] = Array.isArray(d.mimes) ? d.mimes : (d.mime ? [d.mime] : [])
  return urls.map((url, i) => ({ kind: k, url, name: names[i] || `文件${i+1}`, size: sizes[i] || 0, mime: mimes[i] || '' }))
}
const mediaItems = computed(() => getItems())
const totalSize = computed(() => mediaItems.value.reduce((s, i) => s + (i.size||0), 0))
const headerLabel = computed(() => meta.value ? `上传${meta.value.label}` : '上传素材')

function patch(p: any) { canvasStore.updateNodeData(props.id, p) }

async function uploadOne(file: File, kind: UploadKind): Promise<MediaItem> {
  if (!getApiKey()) throw new Error('请先登录')
  const fd = new FormData(); fd.append('file', file)
  const res = await fetch('https://api.jiucaihezi.studio/api/creations/uploads', { method: 'POST', headers: buildGatewayHeaders(), body: fd })
  if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(`上传失败(${res.status}): ${t.slice(0,200)}`) }
  const j = await res.json(); const url = j.url || j.data?.url || j.raw?.url || ''
  if (!url) throw new Error('上传成功但未返回URL')
  return { kind, url, name: file.name, size: file.size, mime: file.type }
}

async function uploadFiles(files: File[], kind: UploadKind) {
  if (!files.length) return; error.value = null; uploading.value = true
  try {
    const uploaded: MediaItem[] = []
    for (const f of files) uploaded.push(await uploadOne(f, kind))
    const exist = uploadType.value === kind ? getItems() : []
    const all = [...exist, ...uploaded]
    const f = KIND_META[kind].dataField
    const uf = kind === 'image' ? 'imageUrls' : kind === 'video' ? 'videoUrls' : 'audioUrls'

    // Build new assets for unified model
    const newAssets = uploaded.map(item => ({
      kind,
      url: item.url,
      name: item.name,
      size: item.size,
      mimeType: item.mime,
      origin: 'uploaded',
    }))

    const currentAssets = Array.isArray(props.data?.assets) ? props.data.assets : []

    patch({
      uploadType: kind,
      [f]: all[0]?.url || '',
      [uf]: all.map(m => m.url),
      fileName: all[0]?.name || '',
      fileNames: all.map(m => m.name),
      fileSize: all[0]?.size || 0,
      fileSizes: all.map(m => m.size),
      mime: all[0]?.mime || '',
      mimes: all.map(m => m.mime),
      assets: [...currentAssets, ...newAssets],
    })
  } catch (e: any) { error.value = e?.message || '上传失败' }
  finally { uploading.value = false }
}

function prepare(raw: File[]) {
  const files = raw.filter(Boolean); if (!files.length) return
  const inferred = uploadType.value ?? files.map(inferKind).find(Boolean) ?? null
  if (!inferred) { error.value = '无法识别文件类型，请选择图像/视频/音频'; return }
  const ok = files.filter(f => inferKind(f) === inferred)
  if (!ok.length) { error.value = `文件类型不匹配：期望${KIND_META[inferred].label}`; return }
  void uploadFiles(ok, inferred)
}

function onFileChange(e: Event) { const fs = Array.from((e.target as HTMLInputElement).files||[]); (e.target as HTMLInputElement).value=''; prepare(fs) }
function onDrop(e: DragEvent) { e.preventDefault(); e.stopPropagation(); dragActive.value = false; prepare(Array.from(e.dataTransfer?.files||[])) }
function pick() { fileInputRef.value?.click() }
function reset() { patch({ uploadType:null, imageUrl:undefined, imageUrls:undefined, videoUrl:undefined, videoUrls:undefined, audioUrl:undefined, audioUrls:undefined, fileName:'', fileNames:[], fileSize:0, fileSizes:[], mime:'', mimes:[] }); error.value=null }

// 新增：本地文件选择（桌面端）
async function selectLocalFile() {
  if (!uploadType.value) {
    error.value = '请先选择上传类型'
    return
  }
  // Web 端不支持本地文件选择，使用浏览器文件上传
  if (!isTauriRuntime()) {
    pick()
    return
  }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: '媒体文件', extensions: ['jpg','jpeg','png','webp','mp4','mov','webm','mp3','wav','m4a'] }]
    })
    if (typeof selected !== 'string' || !selected.trim()) return

    const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || '本地文件'
    const kind = uploadType.value

    // 使用 Tauri 的 convertFileSrc 支持本地文件预览
    const localUrl = convertFileSrc(selected)

    // 构建统一 CanvasMediaAsset 格式
    const newAsset = {
      kind,
      url: localUrl,
      name,
      size: 0,
      mime: '',
      sourcePath: selected,
      origin: 'local',
    }

    // 更新数据：优先使用新 assets 数组，同时兼容旧字段
    const currentAssets = Array.isArray(props.data?.assets) ? [...props.data.assets] : []
    currentAssets.push(newAsset)

    patch({
      uploadType: kind,
      [KIND_META[kind].dataField]: localUrl,
      fileName: name,
      sourcePath: selected,
      assets: currentAssets,
    })
  } catch (e: any) {
    error.value = e?.message || '本地文件选择失败'
  }
}
function fmtSize(b: number): string { if(!b)return''; if(b<1024)return`${b}B`; if(b<1048576)return`${(b/1024).toFixed(1)}KB`; return`${(b/1048576).toFixed(1)}MB` }
</script>

<template>
  <div class="up" :class="{ sel: selected }" :style="{ width:size.w+'px', height:size.h?size.h+'px':'auto', borderColor:selected?handleColor:'var(--border)' }" @drop="onDrop" @dragover.prevent="dragActive=true" @dragleave="dragActive=false">
    <Handle type="source" :position="Position.Right" :style="{ background:handleColor, width:10, height:10, border:'none' }" />
    <!-- 头部 -->
    <div class="up-hd"><div class="up-hd-ic" :style="{ background:handleColor+'33', color:handleColor, boxShadow:`inset 0 0 0 1px ${handleColor}66` }"><span class="mso" style="font-size:13px">{{ meta?.icon||'upload' }}</span></div><div class="up-hd-lb">{{ headerLabel }}</div><button v-if="meta" class="up-hd-rs" title="重置" @pointerdown.stop @click.stop="reset"><span class="mso" style="font-size:11px">refresh</span></button></div>
    <!-- Body -->
    <div class="up-bd" :class="{ 'up-bd-fix': size.h }">
      <input ref="fileInputRef" type="file" :accept="meta?.accept||'image/*,video/*,audio/*'" multiple hidden @change="onFileChange" />
      <!-- 空：拖拽区 -->
      <div v-if="!mediaItems.length" class="up-dz" :class="{ 'up-dz-on': dragActive }" :style="dragActive?{borderColor:handleColor}:{}" @click.stop="pick">
        <span class="mso" style="font-size:22px;color:var(--ink3);margin-bottom:6px">upload</span>
        <span style="font-size:11px;font-weight:500">{{ uploading?'上传中...':dragActive?'松开以上传':'点击或拖拽文件' }}</span>
        <span style="font-size:10px;color:var(--ink3);margin-top:2px">自动识别 图像/视频/音频 · 同类型批量</span>
      </div>
      <!-- 已上传 -->
      <div v-if="mediaItems.length&&uploadType&&meta" class="up-pv">
        <div class="up-pv-hd"><span class="mso" style="font-size:11px">{{ meta.icon }}</span><span style="flex:1;font-size:10px;color:var(--ink3)">{{ meta.label }}({{ mediaItems.length }})</span></div>
        <!-- 图像 -->
        <template v-if="uploadType==='image'">
          <div :class="mediaItems.length>=2?'up-g2':''"><div v-for="(it,i) in mediaItems" :key="i" class="up-mi"><img :src="it.url" :alt="it.name" class="up-img" :style="{maxHeight:mediaItems.length>=2?'120px':'480px'}" /><div class="up-mi-inf"><span class="up-mi-nm" :title="it.name">{{ it.name }}</span><span v-if="it.size" class="up-mi-sz">{{ fmtSize(it.size) }}</span></div></div></div>
        </template>
        <!-- 视频 -->
        <template v-if="uploadType==='video'">
          <div v-for="(it,i) in mediaItems" :key="i" class="up-mi"><video :src="it.url" controls class="up-vid" :style="{maxHeight:mediaItems.length>=2?'180px':'480px'}" /><div class="up-mi-inf"><span class="up-mi-nm" :title="it.name">{{ it.name }}</span><span v-if="it.size" class="up-mi-sz">{{ fmtSize(it.size) }}</span></div></div>
        </template>
        <!-- 音频 -->
        <template v-if="uploadType==='audio'">
          <div v-for="(it,i) in mediaItems" :key="i" class="up-mi"><audio :src="it.url" controls style="width:100%" /><div class="up-mi-inf"><span class="up-mi-nm" :title="it.name">{{ it.name }}</span><span v-if="it.size" class="up-mi-sz">{{ fmtSize(it.size) }}</span></div></div>
        </template>
        <!-- 底部栏 -->
        <div class="up-ft">
  <span style="flex:1;font-size:10px;color:var(--ink3)">{{ mediaItems.length }}项{{ totalSize?' · '+fmtSize(totalSize):'' }}</span>
  <button class="up-ft-bt" title="添加" @pointerdown.stop @click.stop="pick"><span class="mso" style="font-size:11px">add</span></button>
  <button class="up-ft-bt" :title="isTauriRuntime() ? '选择本地文件' : '上传文件'" @pointerdown.stop @click.stop="selectLocalFile"><span class="mso" style="font-size:11px">{{ isTauriRuntime() ? 'folder_open' : 'upload' }}</span></button>
  <button class="up-ft-bt up-ft-del" title="清空" @pointerdown.stop @click.stop="reset"><span class="mso" style="font-size:11px">close</span></button>
</div>
      </div>
      <!-- 错误 -->
      <div v-if="error" class="up-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
      <!-- 输出提示 -->
      <div v-if="meta" class="up-oh">→ 输出 {{ meta.label }} <span :style="{color:handleColor}">●</span></div>
    </div>
  </div>
</template>

<style scoped>
.up { position:relative; border:2px solid var(--border); border-radius:12px; background:var(--paper); box-shadow:var(--jc-shadow-sm); color:var(--ink1); min-width:220px; transition:border-color .15s; }
.up.sel { border-color:var(--olive-dark); }
.up-hd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border2); }
.up-hd-ic { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.up-hd-lb { flex:1; font-size:13px; font-weight:600; }
.up-hd-rs { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border:none; background:none; color:var(--ink3); cursor:pointer; border-radius:4px; }
.up-hd-rs:hover { background:var(--surface-alt); color:var(--ink1); }
.up-bd { padding:10px; display:flex; flex-direction:column; gap:8px; }
.up-bd-fix { flex:1; min-height:0; overflow-y:auto; }
.up-dz { display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed var(--border); border-radius:8px; padding:24px 12px; cursor:pointer; transition:all .15s; text-align:center; }
.up-dz:hover { border-color:var(--olive); background:var(--surface); }
.up-dz-on { background:var(--olive-pale) !important; }
.up-pv { display:flex; flex-direction:column; gap:6px; }
.up-pv-hd { display:flex; align-items:center; gap:4px; }
.up-g2 { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.up-mi { display:flex; flex-direction:column; gap:2px; }
.up-img { width:100%; height:auto; border-radius:6px; background:#0003; object-fit:contain; display:block; }
.up-vid { width:100%; height:auto; border-radius:6px; background:#000; object-fit:contain; display:block; }
.up-mi-inf { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--ink3); }
.up-mi-nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.up-mi-sz { opacity:.7; white-space:nowrap; }
.up-ft { display:flex; align-items:center; gap:2px; }
.up-ft-bt { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border:none; background:none; color:var(--ink3); cursor:pointer; border-radius:4px; }
.up-ft-bt:hover { background:var(--surface-alt); color:var(--ink1); }
.up-ft-del:hover { background:var(--jc-error); color:#fff; }
.up-err { display:flex; align-items:flex-start; gap:4px; font-size:10px; color:#f87171; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.2); border-radius:4px; padding:4px 8px; }
.up-oh { font-size:10px; text-align:right; color:var(--ink3); }
</style>

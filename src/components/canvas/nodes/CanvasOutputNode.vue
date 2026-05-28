<script setup lang="ts">
/**
 * OutputNode — 1:1 对照 T8-penguin-canvas OutputNode.tsx (1107 行)
 *
 * 功能：通用输出素材节点，上游文字/图片/视频/音频 → 展示 + 透传下游
 */
import { ref, computed, watch, nextTick } from 'vue'
import { Handle, Position, useNodeConnections, useNodesData, useVueFlow } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const { findNode, nodes: allNodes, edges: allEdges } = useVueFlow('jiucai-canvas')

const d = computed(() => props.data || {})
const accent = '#5eead4'
const HANDLE_COLOR = '#5eead4'

// 节点尺寸
const size = ref({ w: 320, h: undefined as number | undefined })

// ── 上游数据收集 ──
const connections = useNodeConnections({ nodeId: props.id, handleType: 'target' })
const upstreamIds = computed(() => [...new Set(connections.value.map(c => c.source))])
const upstreamNodes = useNodesData(upstreamIds)

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u)
const isAudioUrl = (u: string) => /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(u)

function pushUnique(arr: string[], v: any) {
  if (typeof v !== 'string') return; const s = v.trim(); if (!s || arr.includes(s)) return; arr.push(s)
}
function pushText(arr: string[], v: any) {
  if (typeof v !== 'string') return; const s = v.trim(); if (!s || arr.includes(s)) return; arr.push(s)
}

const collected = computed(() => {
  const out = { texts: [] as string[], images: [] as string[], videos: [] as string[], audios: [] as string[] }
  const list = Array.isArray(upstreamNodes.value) ? upstreamNodes.value : []
  // handle map
  const hm = new Map<string, Set<string|null>>()
  for (const c of connections.value) {
    let s = hm.get(c.source); if (!s) { s = new Set(); hm.set(c.source, s) }
    s.add((c as any).sourceHandle ?? null)
  }

  for (const n of list) {
    const ud: any = (n as any)?.data || {}
    const sid = (n as any)?.id || ''
    const handles = hm.get(sid) || new Set<string|null>([null])

    // material-set
    if ((n as any)?.type === 'materialSet' && Array.isArray(ud.materialSetItems)) {
      for (const item of ud.materialSetItems) {
        if (item?.kind === 'text') pushText(out.texts, item.text || item.url)
        else if (item?.kind === 'image') pushUnique(out.images, item.url)
        else if (item?.kind === 'video') pushUnique(out.videos, item.url)
        else if (item?.kind === 'audio') pushUnique(out.audios, item.url)
      }
      continue
    }

    // FramePair dual
    const isFP = ud.firstFrameUrl !== undefined && ud.lastFrameUrl !== undefined
    if (isFP) {
      if (handles.has('first') || (handles.has(null) && !handles.has('last'))) pushUnique(out.images, ud.firstFrameUrl)
      if (handles.has('last') || (handles.has(null) && !handles.has('first'))) pushUnique(out.images, ud.lastFrameUrl)
      continue
    }

    // Suno dual
    const isSuno = ud.audioUrl !== undefined && ud.audioUrl_1 !== undefined
    if (isSuno) {
      if (handles.has('audio-0') || (handles.has(null) && !handles.has('audio-1'))) pushUnique(out.audios, ud.audioUrl)
      if (handles.has('audio-1') || (handles.has(null) && !handles.has('audio-0'))) pushUnique(out.audios, ud.audioUrl_1)
      continue
    }

    // text arrays first
    const ta = (['textSegments','segments','texts'] as const).find(f => Array.isArray(ud[f]) && ud[f].length)
    if (ta) { (ud[ta] as any[]).forEach((item: any) => pushText(out.texts, item)) }
    else {
      pushText(out.texts, ud.outputText); pushText(out.texts, ud.reply)
      pushText(out.texts, ud.prompt); pushText(out.texts, ud.text)
    }

    pushUnique(out.images, ud.imageUrl)
    for (const f of ['imageUrls','urls','generatedImages']) { const v = ud[f]; if (Array.isArray(v)) v.forEach((u: any) => pushUnique(out.images, u)) }
    pushUnique(out.videos, ud.videoUrl)
    pushUnique(out.audios, ud.audioUrl); pushUnique(out.audios, ud.audioUrl_1)
  }

  // direct fields (standalone mode)
  if (d.value.directImageUrl) pushUnique(out.images, d.value.directImageUrl)
  if (Array.isArray(d.value.directImageUrls)) d.value.directImageUrls.forEach((u: any) => pushUnique(out.images, u))
  if (d.value.directVideoUrl) pushUnique(out.videos, d.value.directVideoUrl)
  if (Array.isArray(d.value.directVideoUrls)) d.value.directVideoUrls.forEach((u: any) => pushUnique(out.videos, u))
  if (d.value.directAudioUrl) pushUnique(out.audios, d.value.directAudioUrl)
  if (d.value.directOutputText) pushText(out.texts, d.value.directOutputText)

  // 兜底纠正
  out.images = out.images.filter(u => {
    if (isVideoUrl(u)) { pushUnique(out.videos, u); return false }
    if (isAudioUrl(u)) { pushUnique(out.audios, u); return false }
    return true
  })

  return out
})

const liveText = computed(() => collected.value.texts.join('\n\n──────\n\n'))
const overrideText = computed(() => typeof d.value.outputText === 'string' ? d.value.outputText : '')
const displayText = computed(() => overrideText.value !== '' ? overrideText.value : liveText.value)
const isEdited = computed(() => overrideText.value !== '' && overrideText.value !== liveText.value)
const total = computed(() => collected.value.texts.length + collected.value.images.length + collected.value.videos.length + collected.value.audios.length)

// ── 文本编辑 ──
const editing = ref(false)
const draft = ref('')
function enterEdit() { draft.value = displayText.value; editing.value = true; nextTick(() => { /* focus */ }) }
function saveEdit() { canvasStore.updateNodeData(props.id, { outputText: draft.value }); editing.value = false }
function cancelEdit() { editing.value = false }
function restoreLive() { canvasStore.updateNodeData(props.id, { outputText: '' }); editing.value = false }

// ── 下载 ──
async function handleDownload(url: string) {
  try { const { open } = await import('@tauri-apps/plugin-shell'); await open(url) }
  catch { window.open(url, '_blank') }
}

// ── 图片对比弹窗（简化：在新窗口打开对比） ──
const editingUrl = ref<string | null>(null)
const compareUrl = ref<string | null>(null)

// ── 下游透传 ──
watch([collected, displayText], () => {
  const hasNonText = collected.value.images.length || collected.value.videos.length || collected.value.audios.length
  const passText = hasNonText ? '' : displayText.value
  const next: any = {
    prompt: passText, text: passText, reply: passText,
    imageUrl: collected.value.images[0] || '',
    imageUrls: collected.value.images.slice(),
    videoUrl: collected.value.videos[0] || '',
    audioUrl: collected.value.audios[0] || '',
    audioUrl_1: collected.value.audios[1] || '',
  }
  const cur = d.value
  const changed = (cur.prompt||'') !== next.prompt || (cur.imageUrl||'') !== next.imageUrl || (cur.videoUrl||'') !== next.videoUrl || (cur.audioUrl||'') !== next.audioUrl
  if (changed) canvasStore.updateNodeData(props.id, next)
}, { deep: true })
</script>

<template>
  <div class="op" :class="{ sel: selected }" :style="{ width:size.w+'px', height:size.h?size.h+'px':'auto', minWidth:'260px' }">
    <!-- Handles -->
    <Handle type="target" :position="Position.Left"
      :style="{ background:HANDLE_COLOR, width:12, height:12, border:'none', top:'50%', left:-6, transform:'translateY(-50%)', zIndex:12 }"
      title="文本 / 图像 / 视频 / 音频 任意类型可连入" />
    <Handle type="source" :position="Position.Right"
      :style="{ background:HANDLE_COLOR, width:12, height:12, border:'none', top:'50%', right:-6, transform:'translateY(-50%)', zIndex:12 }"
      title="透传到下游" />

    <!-- 内层容器 -->
    <div class="op-inner" :class="{ 'op-fix': size.h }" :style="{ borderColor: selected ? accent : 'var(--border)' }">
      <!-- 头部 -->
      <div class="op-hd">
        <div class="op-hd-ic" :style="{ background:accent+'33', color:accent, boxShadow:`inset 0 0 0 1px ${accent}66` }"><span class="mso" style="font-size:13px">preview</span></div>
        <div class="op-hd-lb">输出素材</div>
        <div class="op-hd-n">{{ total }} 项</div>
      </div>

      <!-- Body -->
      <div class="op-bd" @mousedown.stop>
        <!-- 空状态 -->
        <div v-if="total===0" class="op-empty">连入上游 文本 / 图像 / 视频 / 音频 节点</div>

        <!-- 文本区 -->
        <div v-if="collected.texts.length||isEdited" class="op-sec">
          <div class="op-sec-hd"><span class="mso" style="font-size:11px">notes</span><span class="op-sec-lb">文本{{ isEdited?' · 已编辑':'' }}</span>
            <button v-if="!editing" class="op-btn-sm" title="编辑" @click="enterEdit"><span class="mso" style="font-size:10px">edit</span></button>
            <button v-if="isEdited&&!editing" class="op-btn-sm" title="恢复" @click="restoreLive" style="font-size:10px">恢复</button>
          </div>
          <!-- 显示模式 -->
          <div v-if="!editing" class="op-txt-display" @dblclick="enterEdit" title="双击编辑">{{ displayText || '(空)' }}</div>
          <!-- 编辑模式 -->
          <div v-if="editing" class="op-edit-wrap">
            <textarea v-model="draft" class="op-ta" rows="6" spellcheck="false" @keydown.escape="cancelEdit" @keydown.ctrl.enter="saveEdit" @keydown.meta.enter="saveEdit" />
            <div class="op-edit-btns">
              <button class="op-btn-txt" @click="cancelEdit">取消</button>
              <button class="op-btn-save" :style="{ background:accent }" @click="saveEdit"><span class="mso" style="font-size:10px">check</span>保存</button>
            </div>
            <div class="op-edit-hint">Ctrl+Enter 保存 / Esc 取消</div>
          </div>
        </div>

        <!-- 图像区 -->
        <div v-if="collected.images.length" class="op-sec">
          <div class="op-sec-hd"><span class="mso" style="font-size:11px">image</span><span class="op-sec-lb">图像 ({{ collected.images.length }})</span></div>
          <div :class="collected.images.length>=2?'op-g3':''">
            <div v-for="(u,i) in collected.images" :key="i" class="op-mi">
              <img :src="u" class="op-img" :style="{maxHeight:collected.images.length>=2?'140px':'480px'}" @dblclick.stop="editingUrl=u" title="双击编辑" />
              <div class="op-mi-inf">
                <span class="op-mi-nm" :title="u">{{ u.split('/').pop() }}</span>
                <a class="op-dl" @click.prevent="handleDownload(u)" title="下载"><span class="mso" style="font-size:10px">download</span></a>
                <a class="op-dl" @click.prevent="compareUrl=u" title="对比"><span class="mso" style="font-size:10px">compare</span></a>
              </div>
            </div>
          </div>
        </div>

        <!-- 视频区 -->
        <div v-if="collected.videos.length" class="op-sec">
          <div class="op-sec-hd"><span class="mso" style="font-size:11px">movie</span><span class="op-sec-lb">视频 ({{ collected.videos.length }})</span></div>
          <div v-for="(u,i) in collected.videos" :key="i" class="op-mi">
            <video :src="u" controls class="op-vid" :style="{maxHeight:'480px'}" />
            <div class="op-mi-inf"><span class="op-mi-nm" :title="u">{{ u.split('/').pop() }}</span><a class="op-dl" @click.prevent="handleDownload(u)" title="下载"><span class="mso" style="font-size:10px">download</span></a></div>
          </div>
        </div>

        <!-- 音频区 -->
        <div v-if="collected.audios.length" class="op-sec">
          <div class="op-sec-hd"><span class="mso" style="font-size:11px">music_note</span><span class="op-sec-lb">音频 ({{ collected.audios.length }})</span></div>
          <div v-for="(u,i) in collected.audios" :key="i" class="op-mi">
            <audio :src="u" controls style="width:100%" />
            <div class="op-mi-inf"><span class="op-mi-nm" :title="u">{{ u.split('/').pop() }}</span><a class="op-dl" @click.prevent="handleDownload(u)" title="下载"><span class="mso" style="font-size:10px">download</span></a></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.op { position:relative; }
.op.sel .op-inner { border-color:var(--olive-dark); }
.op-inner { border:2px solid var(--border); border-radius:12px; background:var(--paper); box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:hidden; transition:border-color .15s; }
.op-fix { flex:1; min-height:0; overflow-y:auto; }

.op-hd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border2); }
.op-hd-ic { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.op-hd-lb { flex:1; font-size:13px; font-weight:600; }
.op-hd-n { font-size:10px; color:var(--ink3); }

.op-bd { padding:10px; display:flex; flex-direction:column; gap:12px; }

.op-empty { text-align:center; font-size:11px; color:var(--ink3); padding:12px 8px; }

.op-sec { display:flex; flex-direction:column; gap:4px; }
.op-sec-hd { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--ink3); }
.op-sec-lb { flex:1; }

.op-txt-display { white-space:pre-wrap; word-break:break-word; font-size:12px; line-height:1.6; background:var(--surface); border-radius:6px; padding:6px 8px; cursor:text; max-height:200px; overflow:auto; }
.op-ta { width:100%; border-radius:6px; padding:6px 8px; font-size:12px; border:1px solid var(--olive); background:var(--surface); color:var(--ink1); outline:none; resize:vertical; font:inherit; }
.op-edit-wrap { display:flex; flex-direction:column; gap:4px; }
.op-edit-btns { display:flex; gap:4px; justify-content:flex-end; }
.op-edit-hint { font-size:10px; color:var(--ink3); }
.op-btn-sm { border:none; background:none; color:var(--ink3); cursor:pointer; padding:2px; border-radius:4px; display:flex; align-items:center; }
.op-btn-sm:hover { background:var(--surface-alt); color:var(--ink1); }
.op-btn-txt { font-size:10px; padding:2px 8px; border-radius:4px; border:none; background:var(--surface); color:var(--ink2); cursor:pointer; }
.op-btn-save { font-size:10px; padding:2px 8px; border-radius:4px; border:none; color:#000; cursor:pointer; display:flex; align-items:center; gap:4px; }

.op-g3 { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.op-mi { display:flex; flex-direction:column; gap:2px; }
.op-img { width:100%; height:auto; border-radius:6px; background:#0003; object-fit:contain; display:block; cursor:zoom-in; }
.op-vid { width:100%; height:auto; border-radius:6px; background:#000; object-fit:contain; display:block; }
.op-mi-inf { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--ink3); }
.op-mi-nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.op-dl { display:flex; align-items:center; gap:2px; padding:2px 6px; border-radius:4px; cursor:pointer; text-decoration:none; color:var(--ink3); }
.op-dl:hover { background:var(--surface-alt); color:var(--ink1); }
</style>

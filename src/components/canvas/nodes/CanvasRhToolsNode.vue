<script setup lang="ts">
/**
 * CanvasRhToolsNode — Phase F3，对齐 T8 RHToolsNode.tsx
 * RH 工具集：网格展示 + 搜索 + 选中执行
 */
import { ref, computed, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasRhToolsStore, type RhTool } from '@/stores/canvasRhToolsStore'
import { submitRh, queryRh, uploadRhAsset } from '@/canvas/services/canvasGeneration'
import RHToolEditorModal from '@/components/canvas/shared/RHToolEditorModal.vue'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const rhStore = useCanvasRhToolsStore()
const d = computed(() => props.data || {})

function patch(p: Record<string, any>) { canvasStore.updateNodeData(props.id, p) }

// 状态
const search = ref('')
const editorVisible = ref(false)
const editingTool = ref<RhTool | null>(null)
const executing = ref(false)
const execError = ref<string | null>(null)
const pollTimer = ref<number | null>(null)
const selectedToolId = computed({
  get: () => d.value.selectedToolId || null,
  set: (v: string | null) => patch({ selectedToolId: v }),
})
const taskId = computed(() => d.value.taskId)
const urls = computed<string[]>(() => d.value.urls || [])

const filteredTools = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return rhStore.tools
  return rhStore.tools.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.webappId.includes(q)
  )
})

const selectedTool = computed(() =>
  rhStore.tools.find(t => t.id === selectedToolId.value) || null
)

// 表单值
const paramValues = ref<Record<string, string>>({})
watch(selectedTool, (t) => {
  if (!t) { paramValues.value = {}; return }
  const vals: Record<string, string> = {}
  for (const f of t.fields) {
    vals[`${f.nodeId}::${f.fieldName}`] = f.defaultValue || ''
  }
  paramValues.value = vals
}, { immediate: true })

// 新建/编辑工具
function openNew() { editingTool.value = null; editorVisible.value = true }
function openEdit(tool: RhTool) { editingTool.value = tool; editorVisible.value = true }

function handleSave(tool: RhTool) {
  if (tool.id && rhStore.tools.find(t => t.id === tool.id)) {
    rhStore.updateTool(tool.id, tool)
  } else {
    rhStore.addTool(tool)
  }
  editorVisible.value = false
}

// 导出/导入
function handleExport() {
  const json = rhStore.exportToolsJson()
  navigator.clipboard.writeText(json).catch(() => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'rh-tools.json'; a.click()
    URL.revokeObjectURL(url)
  })
}

function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.json'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      rhStore.importToolsJson(text)
    } catch (e: any) { execError.value = e?.message || '导入失败' }
  }
  input.click()
}

// 执行
async function handleExecute() {
  execError.value = null
  const tool = selectedTool.value
  if (!tool) { execError.value = '请先选择一个工具'; return }

  executing.value = true
  patch({ status: 'submitting', error: '', urls: [], taskId: null })

  try {
    // 构建 nodeInfoList
    const nodeInfoList: any[] = []
    for (const f of tool.fields) {
      const k = `${f.nodeId}::${f.fieldName}`
      let fv = paramValues.value[k] || f.defaultValue || ''

      // 上传媒体资源
      if ((f.fieldType === 'image' || f.fieldType === 'video' || f.fieldType === 'audio') && fv && /^https?:\/\//i.test(fv)) {
        try {
          const upload = await uploadRhAsset(fv)
          fv = upload.fileName
        } catch { /* keep original URL */ }
      }
      nodeInfoList.push({ nodeId: f.nodeId, fieldName: f.fieldName, fieldValue: fv })
    }

    const r = await submitRh({ webappId: tool.webappId, nodeInfoList })
    patch({ status: 'polling', taskId: r.taskId })

    // 轮询
    for (let i = 0; i < 480; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pct = Math.min(94, Math.floor(i / 480 * 84))
      patch({ progress: pct })
      try {
        const q = await queryRh(r.taskId)
        if (q.status === 'SUCCESS' && q.urls?.length) {
          const list = q.urls
          patch({ status: 'success', urls: list, progress: 100, imageUrl: list[0] })
          return
        }
        if (q.status === 'FAILED') throw new Error(q.failReason || 'RH 任务失败')
      } catch (e: any) {
        if (e.message?.includes('FAILED')) throw e
      }
    }
    throw new Error('RH 轮询超时')
  } catch (e: any) {
    execError.value = e?.message || '执行失败'
    patch({ status: 'error', error: e?.message })
  } finally { executing.value = false }
}

function handleStop() {
  if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null }
  patch({ status: 'idle' })
}

const isBusy = computed(() => {
  const s = d.value.status
  return s === 'submitting' || s === 'polling'
})
</script>

<template>
  <div class="rts" :class="{ sel: selected }" :style="{ borderColor: selected ? '#06b6d4' : 'var(--border)' }">
    <Handle type="target" :position="Position.Left" :style="{ background: '#06b6d4', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#06b6d4', width: 10, height: 10, border: 'none' }" />

    <!-- 头部 -->
    <div class="rts-hd">
      <div class="rts-hd-ic" style="background:rgba(6,182,212,.18);color:#67e8f9;box-shadow:inset 0 0 0 1px rgba(6,182,212,.4)">
        <span class="mso" style="font-size:13px">apps</span>
      </div>
      <div class="rts-hd-tx">
        <div class="rts-hd-tt">RH 工具集</div>
        <div class="rts-hd-sub">{{ rhStore.tools.length }} 个工具</div>
      </div>
      <div class="rts-hd-acts">
        <button class="rts-act" title="导出" @click="handleExport"><span class="mso">file_export</span></button>
        <button class="rts-act" title="导入" @click="handleImport"><span class="mso">file_import</span></button>
      </div>
    </div>

    <div class="rts-bd" @mousedown.stop>
      <!-- 搜索+新建 -->
      <div class="rts-bar">
        <input v-model="search" class="rts-inp rts-inp-flex" placeholder="🔍 搜索工具..." />
        <button class="rts-btn-pri" @click="openNew"><span class="mso" style="font-size:11px">add</span> 新建</button>
      </div>

      <!-- 工具网格 -->
      <div class="rts-grid">
        <button
          v-for="tool in filteredTools"
          :key="tool.id"
          class="rts-card"
          :class="{ on: selectedToolId === tool.id }"
          :style="{ borderColor: selectedToolId === tool.id ? 'var(--olive)' : 'var(--border2)' }"
          @click="selectedToolId = tool.id"
          @dblclick="openEdit(tool)"
        >
          <div class="rts-card-ic" :style="{ background: tool.color === 'olive' ? 'var(--olive)' : tool.color === 'cyan' ? '#06b6d4' : tool.color === 'purple' ? '#a78bfa' : tool.color === 'orange' ? '#f59e0b' : tool.color === 'pink' ? '#ec4899' : '#3b82f6' }">
            {{ tool.icon }}
          </div>
          <div class="rts-card-nm">{{ tool.name }}</div>
          <div class="rts-card-id">{{ tool.webappId.slice(0, 10) }}</div>
        </button>
        <button class="rts-card rts-card-add" @click="openNew">
          <span class="mso" style="font-size:20px">add</span>
          <span style="font-size:10px">新建</span>
        </button>
      </div>

      <!-- 参数面板 -->
      <template v-if="selectedTool">
        <div class="rts-form">
          <div class="rts-form-hd">
            <span>{{ selectedTool.icon }} {{ selectedTool.name }}</span>
            <div class="rts-form-acts">
              <button class="rts-act" title="编辑" @click="openEdit(selectedTool)"><span class="mso">edit</span></button>
              <button class="rts-act" title="复制" @click="rhStore.duplicateTool(selectedTool.id)"><span class="mso">content_copy</span></button>
              <button class="rts-act" title="删除" @click="rhStore.removeTool(selectedTool.id)"><span class="mso" style="color:#f87171">delete</span></button>
            </div>
          </div>
          <div v-for="f in selectedTool.fields" :key="`${f.nodeId}::${f.fieldName}`" class="rts-fld">
            <label class="rts-fld-lb">{{ f.label || f.fieldName }}</label>
            <template v-if="f.fieldType === 'image' || f.fieldType === 'video' || f.fieldType === 'audio'">
              <input class="rts-inp" :value="paramValues[`${f.nodeId}::${f.fieldName}`] || ''" :placeholder="f.fieldType + ' URL'" @input="paramValues[`${f.nodeId}::${f.fieldName}`] = ($event.target as HTMLInputElement).value" />
            </template>
            <template v-else-if="f.fieldType === 'number'">
              <input type="number" class="rts-inp" :value="paramValues[`${f.nodeId}::${f.fieldName}`] || ''" :placeholder="String(f.defaultValue || '')" @input="paramValues[`${f.nodeId}::${f.fieldName}`] = ($event.target as HTMLInputElement).value" />
            </template>
            <template v-else>
              <textarea class="rts-inp rts-ta" :value="paramValues[`${f.nodeId}::${f.fieldName}`] || ''" :placeholder="String(f.defaultValue || '')" rows="2" @input="paramValues[`${f.nodeId}::${f.fieldName}`] = ($event.target as HTMLTextAreaElement).value" />
            </template>
          </div>
        </div>

        <!-- 执行按钮 -->
        <button v-if="!isBusy" class="rts-run" @click="handleExecute">
          <span class="mso" style="font-size:12px">auto_awesome</span> 执行
        </button>
        <button v-else class="rts-run rts-stop" @click="handleStop">
          <span class="mso" style="font-size:12px">stop</span> 停止
        </button>

        <!-- 轮询状态 -->
        <div v-if="isBusy" class="rts-poll">
          <span class="mso rts-spin" style="font-size:11px">progress_activity</span>
          {{ d.status === 'submitting' ? '提交任务...' : `轮询中 ${d.progress || 0}%` }}
          <span v-if="taskId" class="rts-tid">{{ String(taskId).slice(0, 10) }}…</span>
        </div>
      </template>

      <div v-else-if="rhStore.tools.length === 0" class="rts-empty">
        还没有工具，点击「新建」创建第一个
      </div>

      <!-- 错误 -->
      <div v-if="execError" class="rts-err">
        <span class="mso" style="font-size:11px">error</span> {{ execError }}
      </div>
    </div>

    <!-- 输出预览 -->
    <div v-if="urls.length" class="rts-out">
      <template v-for="(u, i) in urls" :key="i">
        <img v-if="/\.(png|jpe?g|webp|gif)/i.test(u)" :src="u" class="rts-out-img" />
        <video v-if="/\.(mp4|webm|mov)/i.test(u)" :src="u" controls class="rts-out-vid" />
      </template>
    </div>

    <!-- RHToolEditorModal -->
    <RHToolEditorModal
      :visible="editorVisible"
      :tool="editingTool"
      @save="handleSave"
      @cancel="editorVisible = false"
      @update:visible="editorVisible = $event"
    />
  </div>
</template>

<style scoped>
.rts { width: 400px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.rts.sel { border-color: var(--olive-dark); }
.rts-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.rts-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rts-hd-tx { flex: 1; min-width: 0; }
.rts-hd-tt { font-size: 13px; font-weight: 600; }
.rts-hd-sub { font-size: 10px; color: var(--ink3); }
.rts-hd-acts { display: flex; gap: 2px; }
.rts-act { border: none; background: none; color: var(--ink3); cursor: pointer; padding: 2px; font-size: 11px; }
.rts-act:hover { color: var(--ink1); }
.rts-bd { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.rts-bar { display: flex; gap: 4px; }
.rts-inp { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; width: 100%; }
.rts-inp:focus { border-color: var(--olive); }
.rts-inp-flex { flex: 1; }
.rts-ta { min-height: 36px; resize: vertical; }
.rts-btn-pri { display: flex; align-items: center; gap: 3px; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive); color: #fff; cursor: pointer; padding: 4px 8px; font-size: 10px; white-space: nowrap; }
.rts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 6px; max-height: 160px; overflow-y: auto; }
.rts-card { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 1px solid var(--border2); border-radius: 8px; background: var(--surface); cursor: pointer; }
.rts-card:hover { border-color: var(--olive); }
.rts-card.on { background: rgba(107,142,35,.08); }
.rts-card-ic { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.rts-card-nm { font-size: 10px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.rts-card-id { font-size: 8px; color: var(--ink3); }
.rts-card-add { border-style: dashed; color: var(--ink3); }
.rts-card-add:hover { color: var(--olive); border-color: var(--olive); }
.rts-form { border: 1px solid var(--border2); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.rts-form-hd { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 500; }
.rts-form-acts { display: flex; gap: 2px; }
.rts-fld { display: flex; flex-direction: column; gap: 2px; }
.rts-fld-lb { font-size: 10px; color: var(--ink3); }
.rts-run { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; border: none; background: rgba(6,182,212,.2); color: #06b6d4; font-size: 12px; font-weight: 500; cursor: pointer; }
.rts-run:hover { background: rgba(6,182,212,.3); }
.rts-stop { background: var(--surface-alt) !important; color: var(--ink2) !important; }
.rts-poll { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--ink3); }
.rts-tid { margin-left: auto; color: var(--ink3); }
.rts-spin { animation: rts-spin 1s linear infinite; }
@keyframes rts-spin { to { transform: rotate(360deg) } }
.rts-empty { font-size: 11px; color: var(--ink3); text-align: center; padding: 12px 0; }
.rts-err { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 4px; padding: 4px 8px; }
.rts-out { border-top: 1px solid var(--border2); padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.rts-out-img { width: 100%; border-radius: 6px; object-fit: cover; }
.rts-out-vid { width: 100%; border-radius: 6px; }
</style>

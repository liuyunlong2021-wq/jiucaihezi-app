<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import JcIcon from '@/components/icons/JcIcon.vue'
import { pngBytes, screenshotName } from '@/services/desktopScreenshot'

interface Snapshot { id: string; pngBase64: string; width: number; height: number; canSaveProject: boolean; autoCopy: boolean; directory: string }
const snapshot = ref<Snapshot | null>(null)
const start = ref<[number, number] | null>(null)
const end = ref<[number, number] | null>(null)
const dragging = ref(false)
const selected = ref(false)
const busy = ref(false)
const status = ref('')
let stopResult: UnlistenFn | undefined
let stopResize: (() => void) | undefined
let unmounted = false
let integrityTimer: ReturnType<typeof setInterval> | undefined
const rect = computed(() => {
  const a = start.value || [0, 0], b = end.value || a
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }
})
const selectionStyle = computed(() => ({ left: `${rect.value.left}px`, top: `${rect.value.top}px`, width: `${rect.value.width}px`, height: `${rect.value.height}px` }))
const toolbarStyle = computed(() => ({
  left: `${Math.max(8, Math.min(rect.value.left, innerWidth - Math.min(340, innerWidth - 16) - 8))}px`,
  top: `${rect.value.top + rect.value.height + 60 < innerHeight ? rect.value.top + rect.value.height + 8 : Math.max(8, rect.value.top - 54)}px`,
}))
async function cancel() {
  if (busy.value || !snapshot.value) return
  await invoke('screenshot_end', { id: snapshot.value.id }).catch(error => { status.value = String(error) })
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); void cancel() } }
function down(event: PointerEvent) {
  if (busy.value || event.button !== 0 || !snapshot.value) return
  if (selected.value) { void cancel(); return }
  start.value = [event.clientX, event.clientY]; end.value = start.value
  dragging.value = true; status.value = ''
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (dragging.value) end.value = [Math.max(0, Math.min(innerWidth, event.clientX)), Math.max(0, Math.min(innerHeight, event.clientY))]
}
async function up(event: PointerEvent) {
  if (!dragging.value || !snapshot.value || !start.value) return
  move(event); dragging.value = false; busy.value = true
  try {
    await invoke('screenshot_crop', { id: snapshot.value.id, selection: [...start.value, ...(end.value || start.value), innerWidth, innerHeight] })
    selected.value = true
  } catch (error) { status.value = String(error); start.value = null; end.value = null }
  finally { busy.value = false }
}
async function finishSaved() {
  if (!snapshot.value) return
  if (snapshot.value.autoCopy) {
    try { await invoke('screenshot_copy', { id: snapshot.value.id }) }
    catch (error) { status.value = `已保存，复制失败：${String(error)}。可重试复制或取消。`; return }
  }
  await invoke('screenshot_end', { id: snapshot.value.id })
}
async function copy() {
  if (!snapshot.value || busy.value) return
  busy.value = true
  try { await invoke('screenshot_copy', { id: snapshot.value.id }); await invoke('screenshot_end', { id: snapshot.value.id }) }
  catch (error) { status.value = String(error) }
  finally { busy.value = false }
}
async function saveAs() {
  if (!snapshot.value || busy.value) return
  busy.value = true; status.value = ''
  const window = getCurrentWindow()
  try {
    // 暂时取消置顶，避免原生保存框被截图窗遮住；取消后恢复。
    await window.setAlwaysOnTop(false)
    const name = screenshotName()
    const directory = snapshot.value.directory
    const path = await save({ title: '截图另存为', defaultPath: directory ? `${directory.replace(/[\\/]$/, '')}/${name}` : name, filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
    if (!path) return
    const selection = await invoke<{ pngBase64: string }>('screenshot_crop', { id: snapshot.value.id, selection: [...start.value!, ...end.value!, innerWidth, innerHeight] })
    await writeFile(path, pngBytes(selection.pngBase64))
    const parent = path.replace(/[\\/][^\\/]+$/, '')
    await invoke('screenshot_remember_directory', { id: snapshot.value.id, directory: parent }).catch(() => {})
    snapshot.value.directory = parent
    await finishSaved()
  } catch (error) { status.value = String(error) }
  finally { await window.setAlwaysOnTop(true).catch(() => {}); busy.value = false }
}
async function saveProject() {
  if (!snapshot.value || busy.value) return
  busy.value = true; status.value = '正在保存到来源项目…'
  try { await invoke('screenshot_save_project', { id: snapshot.value.id }) }
  catch (error) { status.value = String(error); busy.value = false; snapshot.value.canSaveProject = false }
}
onMounted(async () => {
  window.addEventListener('keydown', keydown)
  const resize = () => { if (snapshot.value && !busy.value) { status.value = '显示器或窗口尺寸已变化，请取消并重新截图'; selected.value = false } }
  window.addEventListener('resize', resize); stopResize = () => window.removeEventListener('resize', resize)
  try {
    const stop = await listen<{ id: string; error: string | null }>('screenshot:save-result', async ({ payload }) => {
      if (payload.id !== snapshot.value?.id) return
      try { if (payload.error) status.value = payload.error; else await finishSaved() }
      catch (error) { status.value = String(error) }
      finally { busy.value = false }
    })
    if (unmounted) { stop(); return }; stopResult = stop
    snapshot.value = await invoke<Snapshot>('screenshot_read')
    integrityTimer = setInterval(async () => {
      if (!snapshot.value || busy.value) return
      try { snapshot.value.canSaveProject = await invoke<boolean>('screenshot_check', { id: snapshot.value.id }) }
      catch (error) { status.value = String(error); selected.value = false }
    }, 1000)
  } catch (error) {
    status.value = String(error)
    // 页面仍需能显示捕获/初始化错误，30 秒原生回收兜底。
  }
})
async function ready() { if (snapshot.value) await invoke('screenshot_ready', { id: snapshot.value.id }).catch(error => { status.value = String(error) }) }
onBeforeUnmount(() => { unmounted = true; clearInterval(integrityTimer); stopResult?.(); stopResize?.(); window.removeEventListener('keydown', keydown) })
</script>

<template>
  <main class="screenshot" aria-label="截图框选，拖拽选择区域，Esc 取消" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="dragging = false">
    <img v-if="snapshot" class="screen" :src="`data:image/png;base64,${snapshot.pngBase64}`" alt="捕获时的屏幕快照" draggable="false" @load="ready" />
    <div v-if="!start" class="shade"></div>
    <div v-if="start" class="selection" :style="selectionStyle"></div>
    <p v-if="!selected" class="hint">拖拽框选 · Esc 取消</p>
    <div v-if="selected" class="toolbar" :style="toolbarStyle" role="toolbar" aria-label="截图操作" @pointerdown.stop>
      <button :disabled="busy" @click="copy"><JcIcon name="content_copy" />复制</button>
      <button :disabled="busy" @click="saveAs"><JcIcon name="save_alt" />另存为…</button>
      <button :disabled="busy || !snapshot?.canSaveProject" @click="saveProject"><JcIcon name="folder" />保存到项目</button>
      <button :disabled="busy" @click="cancel"><JcIcon name="close" />取消</button>
    </div>
    <p v-if="status" class="status" role="status" @pointerdown.stop>{{ status }}<button v-if="!busy" @click="cancel">取消截图</button></p>
  </main>
</template>
<style scoped>
.screenshot { position:fixed; inset:0; overflow:hidden; cursor:crosshair; font:13px var(--jc-font-body); user-select:none; background:#000; color:#fff; }
.screen { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.shade { position:absolute; inset:0; background:#0008; pointer-events:none; }
.selection { position:absolute; box-sizing:border-box; border:1px solid var(--olive); outline:1px solid #fff8; box-shadow:0 0 0 99999px #0008; pointer-events:none; }
.hint { position:absolute; top:12px; left:50%; transform:translateX(-50%); padding:8px 14px; background:var(--surface); color:var(--ink1); border:1px solid var(--line); border-radius:8px; box-shadow:var(--jc-shadow-sm); pointer-events:none; }
.toolbar { position:absolute; display:flex; flex-wrap:wrap; gap:6px; padding:6px; max-width:calc(100vw - 28px); background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:var(--jc-shadow-md); cursor:default; }
button { display:inline-flex; align-items:center; justify-content:center; gap:5px; border:1px solid transparent; border-radius:5px; background:transparent; color:var(--ink1); padding:7px 8px; cursor:pointer; font:inherit; white-space:nowrap; }
button:hover:not(:disabled) { background:var(--olive-pale); color:var(--olive); }
button :deep(svg) { width:16px; height:16px; }
button:disabled { opacity:.45; cursor:default; }
button:focus-visible { outline:2px solid var(--olive); outline-offset:2px; }
.status { position:absolute; bottom:12px; left:12px; right:12px; background:var(--surface); color:var(--ink1); border:1px solid var(--line); padding:12px; border-radius:8px; cursor:default; }
.status button { margin-left:12px; }
</style>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import JcIcon from '@/components/icons/JcIcon.vue'
import { openExternal } from '@/utils/httpClient'
interface Settings { shortcut: string; autoCopy: boolean; directory: string }
const settings = ref<Settings>({ shortcut: 'Control+Shift+A', autoCopy: true, directory: '' })
const permission = ref(true)
const status = ref('')
const recording = ref(false)
const busy = ref(false)
const mac = /Mac/.test(navigator.platform)
const shortcutKeys = computed(() => settings.value.shortcut.split('+').map(key => ({ CommandOrControl: mac ? '⌘' : 'Ctrl', Command: '⌘', Control: mac ? 'Control' : 'Ctrl', Shift: 'Shift', Alt: mac ? 'Option' : 'Alt' }[key] || key.replace(/^Key/, '').replace(/^Digit/, ''))))
let stop: UnlistenFn | undefined
let unmounted = false
async function refresh() {
  try {
    const result = await invoke<{ settings: Settings; permission: boolean; error: string }>('screenshot_settings')
    settings.value = result.settings; permission.value = result.permission; if (result.error) status.value = result.error
  } catch (error) { status.value = String(error) }
}
async function saveSettings() {
  busy.value = true
  try { await invoke('screenshot_set_settings', { settings: { ...settings.value } }); status.value = '截图设置已保存' }
  catch (error) { status.value = String(error); await refresh() }
  finally { busy.value = false }
}
async function setRecording(value: boolean) {
  try { await invoke('screenshot_recording', { recording: value }); recording.value = value }
  catch (error) { status.value = String(error) }
}
async function record(event: KeyboardEvent) {
  if (!recording.value) return
  event.preventDefault(); event.stopPropagation()
  if (event.key === 'Escape') { await setRecording(false); return }
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key) || event.repeat) return
  const modifiers = [event.metaKey ? 'Command' : '', event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean)
  if (!modifiers.length) { status.value = '请使用带修饰键的组合'; return }
  settings.value.shortcut = [...modifiers, event.code].join('+')
  await setRecording(false); await saveSettings()
}
async function chooseDirectory() {
  busy.value = true
  try {
    const path = await open({ directory: true, multiple: false, title: '选择截图默认目录' })
    if (typeof path === 'string') { settings.value.directory = path; await saveSettings() }
  } catch (error) { status.value = String(error) }
  finally { busy.value = false }
}
async function capture() {
  busy.value = true; status.value = ''
  try { await invoke('screenshot_begin') } catch (error) { status.value = String(error); await refresh() }
  finally { busy.value = false }
}
async function authorize() { await invoke('screenshot_permission').catch(error => { status.value = String(error) }); await refresh() }
onMounted(async () => {
  await refresh(); if (unmounted) return
  const unlisten = await listen('screenshot:settings-changed', () => { void refresh() })
  if (unmounted) unlisten(); else stop = unlisten
  if (!unmounted) window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => { unmounted = true; stop?.(); window.removeEventListener('focus', refresh); void invoke('screenshot_recording', { recording: false }).catch(() => {}) })
</script>
<template>
  <section class="screenshot-settings">
    <header class="screenshot-heading"><h3>桌面截图</h3><p>框选鼠标所在屏幕，复制图片或保存到来源项目。</p></header>
    <div class="setting-row">
      <div><strong>全局快捷键</strong><p>点击组合键后重新录制，Esc 取消。</p></div>
      <button class="shortcut" :disabled="busy" @click="setRecording(true)" @keydown="record" @blur="setRecording(false)">
        <span v-if="recording">请按组合键…</span>
        <template v-else><kbd v-for="(key, index) in shortcutKeys" :key="index">{{ key }}</kbd></template>
      </button>
    </div>
    <label class="setting-row copy-row"><div><strong>保存后自动复制</strong><p>另存为或保存到项目成功后，复制到剪贴板。</p></div><input v-model="settings.autoCopy" type="checkbox" :disabled="busy" @change="saveSettings"></label>
    <div class="directory-setting"><strong>默认保存目录</strong><div class="directory-row"><span :title="settings.directory">{{ settings.directory || '记住上次另存为的位置' }}</span><button :disabled="busy" @click="chooseDirectory">选择目录</button></div></div>
    <div v-if="mac && !permission" class="permission" role="alert"><p>需要“屏幕录制”权限。授权后如仍失败，请重启韭菜盒子。</p><div class="permission-actions"><button @click="authorize">申请授权</button><button @click="openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')">打开系统设置</button></div></div>
    <div class="capture-row"><button class="primary" :disabled="busy || recording" @click="capture"><JcIcon name="photo_camera" />{{ busy ? '准备中…' : '截一张' }}</button><span>拖拽框选 · Esc 取消</span></div>
    <p v-if="status" class="setting-status" role="status">{{ status }}</p>
  </section>
</template>
<style scoped>
.screenshot-settings { display:flex; flex-direction:column; gap:0; color:var(--ink1); font-size:13px; }
.screenshot-heading { padding-bottom:20px; }
h3 { margin:0 0 6px; font-size:15px; font-weight:600; }
p { margin:5px 0 0; color:var(--ink2); font-size:12px; line-height:1.6; }
strong { font-weight:500; }
.setting-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:18px 0; border-top:1px solid var(--line); }
.setting-row > div { min-width:0; }
button { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:8px 12px; border:1px solid var(--line); border-radius:6px; color:var(--ink1); background:var(--surface-alt); cursor:pointer; font:inherit; white-space:nowrap; }
button:hover { background:var(--olive-pale); }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible { outline:2px solid var(--olive); outline-offset:3px; }
.shortcut { gap:4px; flex-shrink:0; }
kbd { font:inherit; font-size:12px; }
kbd + kbd::before { content:'+'; margin-right:4px; color:var(--ink2); }
input { width:16px; height:16px; accent-color:var(--olive); flex-shrink:0; cursor:pointer; }
.directory-setting { padding:18px 0; border-top:1px solid var(--line); }
.directory-row { display:flex; align-items:center; gap:12px; margin-top:10px; }
.directory-row span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink2); font-size:12px; }
.permission { padding:12px; background:var(--surface-alt); border:1px solid var(--line); border-radius:6px; }
.permission-actions { display:flex; gap:8px; margin-top:10px; }
.capture-row { display:flex; align-items:center; gap:12px; padding-top:18px; border-top:1px solid var(--line); }
.capture-row span { color:var(--ink2); font-size:12px; }
.primary { background:var(--olive); color:var(--jc-on-primary); border-color:var(--olive); }
.primary:hover { background:var(--olive-dark); }
.setting-status { overflow-wrap:anywhere; padding-top:10px; }
@media (max-width:380px) { .setting-row { flex-wrap:wrap; } }
</style>

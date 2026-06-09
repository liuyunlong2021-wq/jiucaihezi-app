<script setup lang="ts">
import { ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'

const props = defineProps<{
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'add', payload: { path: string; label: string }): void
}>()

const path = ref('')
const label = ref('')
const validationError = ref('')

async function pickDirectory() {
  const selected = await open({ directory: true, multiple: false })
  if (typeof selected === 'string') {
    path.value = selected
    validationError.value = ''
  }
}

function submit() {
  const trimmedPath = path.value.trim()
  if (!trimmedPath) {
    validationError.value = 'scan directory 路径不能为空。'
    return
  }
  emit('add', { path: trimmedPath, label: label.value.trim() })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="添加 scan directory">
      <header>
        <div>
          <h3>添加 scan directory</h3>
          <p>将目录加入 Skill 扫描范围，Discover 和 Central Skills 会使用它。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><span class="mso">close</span></button>
      </header>
      <main>
        <label>
          <span>路径</span>
          <div class="path-row">
            <input v-model="path" type="text" placeholder="例如：~/projects" :disabled="props.saving" @input="validationError = ''" />
            <button type="button" :disabled="props.saving" @click="pickDirectory">
              <span class="mso">folder_open</span>
            </button>
          </div>
        </label>
        <label>
          <span>标签</span>
          <input v-model="label" type="text" placeholder="可选" :disabled="props.saving" />
        </label>
        <p v-if="validationError" class="error">{{ validationError }}</p>
      </main>
      <footer>
        <button type="button" :disabled="props.saving" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="props.saving" @click="submit">
          <span class="mso" :class="{ spin: props.saving }">{{ props.saving ? 'progress_activity' : 'add' }}</span>
          添加
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 12; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(540px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; letter-spacing: 0; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
header button, .path-row button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { display: grid; gap: 10px; }
label { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; font-weight: 850; }
input { height: 34px; min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 9px; }
.path-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
.error { color: var(--jc-error); }
footer { justify-content: flex-end; }
footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); font-weight: 850; cursor: pointer; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

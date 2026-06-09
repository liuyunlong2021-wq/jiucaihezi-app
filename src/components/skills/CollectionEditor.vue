<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Collection } from '@/types/skillsManage'

const props = defineProps<{
  collection: Collection | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: { id?: string; name: string; description: string }): void
}>()

const name = ref('')
const description = ref('')
const validationError = ref('')

watch(
  () => props.collection,
  () => {
    name.value = props.collection?.name || ''
    description.value = props.collection?.description || ''
    validationError.value = ''
  },
  { immediate: true }
)

function save() {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    validationError.value = 'Collection 名称不能为空。'
    return
  }
  emit('save', {
    id: props.collection?.id,
    name: trimmedName,
    description: description.value.trim(),
  })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="编辑 Collection">
      <header>
        <div>
          <h3>{{ collection ? '编辑 Collection' : '创建 Collection' }}</h3>
          <p>Collections 是一组 Skill，可以一起管理和批量安装。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><span class="mso">close</span></button>
      </header>

      <main>
        <label>
          <span>名称</span>
          <input v-model="name" type="text" placeholder="例如：写作工具组" :disabled="saving" @input="validationError = ''" />
        </label>
        <label>
          <span>描述</span>
          <input v-model="description" type="text" placeholder="可选" :disabled="saving" />
        </label>
        <p v-if="validationError" class="error">{{ validationError }}</p>
      </main>

      <footer>
        <button type="button" :disabled="saving" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="save">
          <span class="mso" :class="{ spin: saving }">{{ saving ? 'progress_activity' : 'save' }}</span>
          保存
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(520px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
header button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { display: grid; gap: 10px; }
label { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; font-weight: 850; }
input { height: 34px; min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 9px; }
.error { color: var(--jc-error); }
footer { justify-content: flex-end; }
footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); font-weight: 850; cursor: pointer; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

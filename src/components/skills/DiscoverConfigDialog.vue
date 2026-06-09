<script setup lang="ts">
import type { ScanRoot } from '@/types/skillsManage'

defineProps<{
  roots: ScanRoot[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
  (e: 'toggle-root', payload: { path: string; enabled: boolean }): void
}>()
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="Discover 扫描设置">
      <header>
        <div>
          <h3>扫描设置</h3>
          <p>选择 Discover 扫描的本机项目目录。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><span class="mso">close</span></button>
      </header>

      <main>
        <article v-for="root in roots" :key="root.path" class="root-row" :class="{ missing: !root.exists }">
          <label>
            <input
              type="checkbox"
              :checked="root.enabled"
              :disabled="!root.exists || loading"
              @change="emit('toggle-root', { path: root.path, enabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>{{ root.label }}</strong>
              <small>{{ root.path }}</small>
            </span>
          </label>
          <em>{{ root.exists ? (root.enabled ? '已启用' : '已停用') : '不存在' }}</em>
        </article>
        <p v-if="roots.length === 0" class="empty">暂无可用扫描目录。</p>
      </main>

      <footer>
        <button type="button" :disabled="loading" @click="emit('refresh')">
          <span class="mso">refresh</span>
          刷新
        </button>
        <button type="button" class="primary" @click="emit('close')">完成</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(680px, 100%); max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; min-height: 0; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
header button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.root-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.root-row.missing { opacity: .58; }
label { min-width: 0; display: flex; align-items: center; gap: 8px; }
label span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
strong { color: var(--ink1); font-size: 13px; }
small { color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
em { flex: 0 0 auto; color: var(--ink3); font-size: 11px; font-style: normal; font-weight: 850; }
footer { justify-content: flex-end; }
footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); font-weight: 850; cursor: pointer; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.empty { padding: 16px; border: 1px dashed var(--border); border-radius: 8px; text-align: center; }
</style>

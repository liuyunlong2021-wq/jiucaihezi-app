<script setup lang="ts">
import type { MarketplaceSkill } from '@/types/skillsManage'

defineProps<{
  skill: MarketplaceSkill | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'preview'): void
  (e: 'install'): void
}>()
</script>

<template>
  <div v-if="skill" class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer">
      <header>
        <div>
          <h4>{{ skill.name }}</h4>
          <p>{{ skill.registry_id }}</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>
      <main>
        <section>
          <strong>描述</strong>
          <p>{{ skill.description || '暂无描述' }}</p>
        </section>
        <section>
          <strong>来源</strong>
          <p>{{ skill.download_url }}</p>
        </section>
        <section>
          <strong>状态</strong>
          <p>{{ skill.is_installed ? '已安装到 Central Skills' : '未安装' }}</p>
        </section>
      </main>
      <footer>
        <button class="btn" @click="emit('preview')"><JcIcon name="article" />预览 Markdown</button>
        <button class="btn primary" :disabled="skill.is_installed" @click="emit('install')">
          <JcIcon name="download" />{{ skill.is_installed ? '已安装' : '安装' }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop { position: fixed; inset: 0; z-index: 44; display: flex; justify-content: flex-end; background: color-mix(in srgb, var(--ink1) 24%, transparent); }
.drawer { width: min(460px, 92vw); height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--border); }
header, footer { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border); background: var(--paper); }
footer { border-top: 1px solid var(--border); border-bottom: 0; justify-content: flex-end; }
h4 { margin: 0; color: var(--ink1); font-size: 15px; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
header button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
section { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
strong { color: var(--olive-dark); font-size: 12px; }
.btn { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.btn:disabled { opacity: .55; cursor: default; }
</style>

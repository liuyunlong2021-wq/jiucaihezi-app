<script setup lang="ts">
import type { CollectionDetail } from '@/types/skillsManage'

defineProps<{
  detail: CollectionDetail | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit'): void
  (e: 'export'): void
  (e: 'install'): void
}>()
</script>

<template>
  <div v-if="detail" class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer">
      <header>
        <div>
          <h4>{{ detail.name }}</h4>
          <p>{{ detail.description || '无描述' }}</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>

      <main>
        <section>
          <strong>Collection</strong>
          <p>ID：{{ detail.id }}</p>
          <p>创建：{{ detail.created_at }}</p>
          <p>更新：{{ detail.updated_at }}</p>
        </section>
        <section>
          <strong>成员 Skill</strong>
          <p>{{ detail.skills.length }} 个 Skill</p>
          <ul>
            <li v-for="skill in detail.skills" :key="skill.id">{{ skill.name }}</li>
          </ul>
        </section>
        <section>
          <strong>JSON 导入/导出</strong>
          <p>导出的 JSON 可迁移到另一台电脑，导入时只会关联本机已存在的 Skill。</p>
        </section>
      </main>

      <footer>
        <button class="btn" @click="emit('edit')"><JcIcon name="edit" />编辑</button>
        <button class="btn" @click="emit('export')"><JcIcon name="download" />导出 JSON</button>
        <button class="btn primary" @click="emit('install')"><JcIcon name="install_desktop" />批量安装</button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop { position: fixed; inset: 0; z-index: 44; display: flex; justify-content: flex-end; background: color-mix(in srgb, var(--ink1) 24%, transparent); }
.drawer { width: min(460px, 92vw); height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--border); }
header, footer { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border); background: var(--paper); }
footer { border-top: 1px solid var(--border); border-bottom: 0; justify-content: flex-end; flex-wrap: wrap; }
h4 { margin: 0; color: var(--ink1); font-size: 15px; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
header button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
section { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
strong { color: var(--olive-dark); font-size: 12px; }
ul { margin: 8px 0 0; padding-left: 16px; color: var(--ink2); font-size: 12px; }
.btn { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
</style>

<script setup lang="ts">
/**
 * ActivityRail — 左侧图标导航栏
 *
 * 功能：切换第5列（右侧面板）的内容
 */
import { openExternal } from '@/utils/httpClient'

defineProps<{
  active: string
}>()

const emit = defineEmits<{
  (e: 'switch', mode: string): void
}>()

// Rail 按钮 — 每个切换 Col 5 的内容
const tabs = [
  { key: 'create',         icon: 'build_circle',          label: '创建搭子' },
  { key: 'agents',         icon: 'deployed_code_account',  label: '搭子仓库' },
  { key: 'vaultCreate',    icon: 'library_add',            label: '创建知识库' },
  { key: 'vaultWarehouse', icon: 'shelves',                label: '知识库仓库' },
  { key: 'tools',          icon: 'construction',           label: '工具仓库' },
  { key: 'editor',         icon: 'edit_note',               label: '编辑区' },
  { key: 'creation',       icon: 'photo_camera',            label: '创作面板' },
  { key: 'files',          icon: 'folder_open',             label: '文件' },
]

const bottomTabs = [
  { key: 'settings', icon: 'settings', label: '设置' },
]
</script>

<template>
  <div class="ab">
    <!-- Logo -->
    <div class="ab-logo" title="韭菜盒子">
      <img class="ab-logo-img" src="/logo.svg" alt="" />
    </div>

    <!-- Main tabs — 切换 Col 5 -->
    <div class="ab-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="ab-icon"
        :class="{ active: active === t.key }"
        :title="t.label"
        @click="emit('switch', t.key)"
      >
        <span class="mso">{{ t.icon }}</span>
      </button>
    </div>

    <div class="ab-spacer" />

    <!-- Key 按钮 -->
    <button class="ab-icon ab-key-btn" title="获取 API Key" @click="openExternal('https://api.jiucaihezi.studio/keys')">
      <span class="ab-key-text">Key</span>
    </button>

    <!-- Bottom tabs -->
    <button
      v-for="t in bottomTabs"
      :key="t.key"
      class="ab-icon"
      :class="{ active: active === t.key }"
      :title="t.label"
      @click="emit('switch', t.key)"
    >
      <span class="mso">{{ t.icon }}</span>
    </button>
  </div>
</template>

<style scoped>
.ab {
  width: 52px;
  background: var(--surface-alt);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  flex-shrink: 0;
  z-index: 10;
}
.ab-logo {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  cursor: pointer;
}
.ab-logo-img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  display: block;
}
.ab-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ab-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--ink3);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 22px;
  border: none;
  background: none;
  text-decoration: none;
}
.ab-icon:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.ab-icon.active {
  background: rgba(213, 199, 135, 0.15);
  color: var(--olive-dark);
}
.ab-spacer { flex: 1; }
.ab-key-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1.5px solid var(--olive); display: flex;
  align-items: center; justify-content: center; margin-bottom: 4px;
}
.ab-key-btn:hover { background: var(--olive-pale); }
.ab-key-text {
  font-size: 9px; font-weight: 800; color: var(--olive-dark);
  letter-spacing: -0.02em; line-height: 1;
}

</style>

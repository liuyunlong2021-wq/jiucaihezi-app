<template>
  <div class="plugin-panel" :class="{ embedded }">
    <div v-if="!embedded" class="plugin-panel-header">
      <h3 class="plugin-panel-title">插件管理</h3>
      <span class="plugin-panel-count">{{ pluginStore.installedPlugins.length }} 已安装</span>
    </div>

    <!-- 加载/错误状态 -->
    <div v-if="pluginStore.isLoading" class="plugin-loading">加载中...</div>
    <div v-else-if="pluginStore.error" class="plugin-error">{{ pluginStore.error }}</div>

    <div v-else class="plugin-panel-body">
      <!-- 已安装 -->
      <section v-if="pluginStore.installedPlugins.length" class="plugin-section">
        <h4 class="plugin-section-title">已安装</h4>
        <div
          v-for="p in pluginStore.installedPlugins"
          :key="p.id"
          class="plugin-card"
          :class="{ 'plugin-active': p.active }"
        >
          <div class="plugin-card-info">
            <span class="plugin-card-name">{{ p.name }}</span>
            <span class="plugin-card-desc">{{ p.description }}</span>
          </div>
          <div class="plugin-card-actions">
            <button
              class="plugin-btn"
              :class="p.active ? 'plugin-btn-danger' : 'plugin-btn-primary'"
              @click="togglePlugin(p)"
            >
              {{ p.active ? '停用' : '激活' }}
            </button>
            <button class="plugin-btn plugin-btn-ghost" @click="removePlugin(p)">
              卸载
            </button>
          </div>
        </div>
      </section>

      <!-- 推荐插件 -->
      <section class="plugin-section">
        <h4 class="plugin-section-title">
          推荐插件
          <span class="plugin-section-hint">— 社区扩展</span>
        </h4>
        <div class="plugin-recommend-grid">
          <div
            v-for="p in recommendPlugins"
            :key="p.id"
            class="plugin-card plugin-recommend-card"
          >
            <div class="plugin-card-info">
              <div class="plugin-card-name-row">
                <span class="plugin-card-name">{{ p.name }}</span>
                <span v-if="p.stars" class="plugin-card-stars">⭐ {{ formatStars(p.stars) }}</span>
              </div>
              <span class="plugin-card-desc">{{ p.description }}</span>
              <div v-if="p.tags?.length" class="plugin-card-tags">
                <span v-for="tag in p.tags" :key="tag" class="plugin-tag">{{ tag }}</span>
              </div>
            </div>
            <div class="plugin-card-actions">
              <button
                v-if="p.installed"
                class="plugin-btn plugin-btn-primary"
                @click="removePlugin(p)"
              >
                已安装
              </button>
              <button
                v-else
                class="plugin-btn plugin-btn-primary"
                @click="installRecommended(p)"
              >
                安装
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePluginStore, type PluginMeta } from '@/stores/pluginStore'
import { definePlugin } from '@/plugin'

const pluginStore = usePluginStore()
defineProps<{ embedded?: boolean }>()

// 只显示未安装的推荐
const recommendPlugins = computed(() =>
  pluginStore.githubPlugins.filter(p => !p.installed),
)

function formatStars(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

async function togglePlugin(p: PluginMeta) {
  if (p.active) {
    await pluginStore.deactivatePlugin(p.id)
  } else {
    // ponytail: npm 插件重新激活时需重新加载 entry module，本地定义插件走 reinstall
    if (p.source === 'npm' && p.packageName) {
      await pluginStore.installFromNpm(p.packageName + (p.version ? '@' + p.version : ''))
      return
    }
    // GitHub 推荐插件：走安装流程重新注册 setup
    await installRecommended(p)
  }
}

async function removePlugin(p: PluginMeta) {
  await pluginStore.uninstallPlugin(p.id)
}

async function installRecommended(p: PluginMeta) {
  const def = definePlugin({
    id: p.id,
    name: p.name,
    description: p.description,
    setup(ctx) {
      // 推荐插件：订阅事件，提供安装/使用提示
      ctx.event.subscribe('tool:install-requested', (_payload: unknown) => {
        // AI 会在对话中自动处理安装流程
      })
    },
  })
  await pluginStore.installPlugin(def)
}

onMounted(() => {
  pluginStore.init()
})
</script>

<style scoped>
.plugin-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface);
  color: var(--ink);
}

.plugin-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.plugin-panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.plugin-panel-count {
  font-size: 12px;
  color: var(--ink3);
}

.plugin-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.plugin-section {
  margin-bottom: 24px;
}

.plugin-section-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink3);
}

.plugin-section-hint {
  font-weight: 400;
  font-size: 12px;
}

.plugin-recommend-grid {
  display: grid;
  gap: 12px;
}

.plugin-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
  transition: border-color 0.2s;
}

.plugin-card:hover {
  border-color: var(--olive);
}

.plugin-active {
  border-color: var(--olive);
}

.plugin-card-info {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.plugin-card-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-card-name {
  font-size: 14px;
  font-weight: 600;
}

.plugin-card-stars {
  font-size: 12px;
  color: #f0c040;
}

.plugin-card-desc {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink3);
  white-space: normal;
  overflow-wrap: anywhere;
}

.plugin-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.plugin-tag {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface);
  font-size: 10px;
  color: var(--ink2);
}

.plugin-card-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
}

.plugin-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.plugin-btn-primary {
  background: var(--olive);
  color: #fff;
}

.plugin-btn-primary:hover {
  background: var(--olive-dark);
}

.plugin-btn-danger {
  background: #e04040;
  color: #fff;
}

.plugin-btn-danger:hover {
  background: #c03030;
}

.plugin-btn-ghost {
  background: transparent;
  color: var(--ink2);
  border: 1px solid var(--border);
}

.plugin-btn-ghost:hover {
  border-color: var(--ink2);
}

.plugin-loading,
.plugin-error {
  padding: 24px;
  text-align: center;
  color: var(--ink3);
  font-size: 14px;
}

.plugin-error {
  color: #e04040;
}
</style>

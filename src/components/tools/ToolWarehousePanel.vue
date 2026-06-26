<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { consumeLastEvent, onEvent } from '@/utils/eventBus'
import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'
import GitHubSkillCard from '@/components/skills/GitHubSkillCard.vue'
import type { GitHubSkillEntry } from '@/components/skills/GitHubSkillCard.vue'
import githubToolsData from '@/data/githubTools.json'
import ObsidianSetupWizard from '@/components/tools/ObsidianSetupWizard.vue'

const props = withDefaults(defineProps<{ isMember?: boolean }>(), { isMember: true })
const filter = ref('')
const activeTool = ref('')
const showObsidianWizard = ref(false)
const gateMessage = ref('')
const OPEN_EXTERNAL_EXTENSIONS_EVENT = 'open-external-tool-extensions'

const githubTools = computed<GitHubSkillEntry[]>(() => {
  const tools = (githubToolsData as { tools: GitHubSkillEntry[] }).tools || []
  const q = filter.value.trim().toLowerCase()
  if (!q) return tools
  return tools.filter(t => {
    const text = [t.name, t.description, t.repo, ...(t.tags || [])].join(' ').toLowerCase()
    return text.includes(q)
  })
})

function openExternalToolExtensions() {
  if (!props.isMember) { gateMessage.value = '请登录后使用此功能'; return }
  activeTool.value = 'external_tool_extensions'
}

if (consumeLastEvent(OPEN_EXTERNAL_EXTENSIONS_EVENT)) openExternalToolExtensions()
const offOpenExternalExtensions = onEvent(OPEN_EXTERNAL_EXTENSIONS_EVENT, openExternalToolExtensions)
onBeforeUnmount(() => offOpenExternalExtensions())
</script>

<template>
  <!-- MCP 扩展子面板 -->
  <div v-if="activeTool === 'external_tool_extensions'" class="tw-extension-panel">
    <div class="tw-subhead">
      <button class="tw-back" title="返回工具仓库" @click="activeTool = ''">
        <JcIcon name="arrow_back" />
      </button>
      <div>
        <h3>外部工具扩展</h3>
        <p>MCP 服务器扩展 — 接入外部工具、数据库和 API。</p>
      </div>
    </div>
    <McpManagerPanel />
  </div>

  <!-- Obsidian 设置向导 -->
  <div v-else-if="showObsidianWizard" class="tw-extension-panel">
    <div class="tw-subhead">
      <button class="tw-back" title="返回工具仓库" @click="showObsidianWizard = false">
        <JcIcon name="arrow_back" />
      </button>
      <div>
        <h3>Obsidian 设置向导</h3>
        <p>自动检测并引导配置 Obsidian 知识库连接</p>
      </div>
    </div>
    <ObsidianSetupWizard @close="showObsidianWizard = false" />
  </div>

  <!-- 主面板 -->
  <div v-else class="tw">
    <div class="tw-head">
      <h3>工具仓库</h3>
      <p class="tw-desc">通过 GitHub 安装第三方工具，我们只管理安装/卸载状态。</p>
      <div class="tw-search">
        <JcIcon name="search" />
        <input v-model="filter" type="text" placeholder="搜索工具..." />
      </div>
    </div>

    <div v-if="gateMessage" class="tw-gate">{{ gateMessage }}</div>

    <div class="tw-scroll">
      <!-- GitHub 推荐安装（主视图） -->
      <div class="tw-section">
        <div class="tw-section-title">
          <JcIcon name="star" />
          <span>GitHub 推荐安装</span>
          <span class="tw-count">{{ githubTools.length }} 个</span>
        </div>
        <div class="tw-github-grid">
          <GitHubSkillCard
            v-for="tool in githubTools"
            :key="tool.id"
            :skill="tool"
          />
        </div>
      </div>

      <!-- 工具设置向导 -->
      <div class="tw-section">
        <div class="tw-section-title">
          <span>工具设置向导</span>
        </div>
        <button class="tw-extension-entry" @click="showObsidianWizard = true">
          <JcIcon name="hub" class="tw-extension-icon" />
          <span class="tw-extension-copy">
            <strong>Obsidian 知识库</strong>
            <span>自动检测并配置 — 让 AI 读写你的本地笔记</span>
          </span>
          <JcIcon name="chevron_right" class="tw-extension-arrow" />
        </button>
      </div>

      <!-- 高级扩展入口 -->
      <div class="tw-section">
        <div class="tw-section-title">
          <span>高级扩展</span>
        </div>
        <button class="tw-extension-entry" @click="openExternalToolExtensions">
          <JcIcon name="extension" class="tw-extension-icon" />
          <span class="tw-extension-copy">
            <strong>外部工具扩展</strong>
            <span>连接 MCP 服务器等外部系统。</span>
          </span>
          <JcIcon name="chevron_right" class="tw-extension-arrow" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tw { display: flex; flex-direction: column; height: 100%; background: var(--surface); }
.tw-head { padding: 12px 14px 8px; border-bottom: 1px solid var(--line); }
.tw-head h3 { margin: 0 0 2px; font-size: 15px; color: var(--ink1); }
.tw-desc { margin: 0 0 8px; font-size: 11px; color: var(--ink3); }
.tw-search { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--bg); border-radius: 8px; border: 1px solid var(--line); }
.tw-search input { flex: 1; border: none; background: transparent; font-size: 13px; color: var(--ink1); outline: none; }
.tw-gate { padding: 8px 14px; color: #c62828; font-size: 13px; text-align: center; }
.tw-scroll { flex: 1; overflow-y: auto; padding: 8px 14px; }
.tw-section { margin-bottom: 16px; }
.tw-section-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--ink2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.tw-count { font-weight: 400; color: var(--ink3); margin-left: auto; }
.tw-github-grid { display: grid; gap: 8px; }
.tw-extension-entry { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; text-align: left; color: var(--ink1); }
.tw-extension-entry:hover { background: color-mix(in srgb, var(--olive) 8%, var(--bg)); }
.tw-extension-icon { font-size: 20px; color: var(--olive); flex-shrink: 0; }
.tw-extension-copy { display: flex; flex-direction: column; gap: 1px; flex: 1; }
.tw-extension-copy strong { font-size: 13px; }
.tw-extension-copy span { font-size: 11px; color: var(--ink3); }
.tw-extension-arrow { font-size: 16px; color: var(--ink3); }
.tw-extension-panel { height: 100%; display: flex; flex-direction: column; }
.tw-subhead { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.tw-subhead h3 { margin: 0 0 2px; font-size: 14px; }
.tw-subhead p { margin: 0; font-size: 11px; color: var(--ink3); }
.tw-back { background: none; border: none; cursor: pointer; padding: 4px; color: var(--ink2); }
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VAULT_TEMPLATES, type VaultTemplate } from '@/data/vaultTemplates'
import { buildVaultScaffoldInput } from '@/utils/vaultScaffold'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useLocale } from '@/i18n'
import { searchItems } from '@/utils/generalSearch'
import GitHubSkillCard from '@/components/skills/GitHubSkillCard.vue'
import type { GitHubSkillEntry } from '@/components/skills/GitHubSkillCard.vue'
import githubToolsData from '@/data/githubTools.json'

const props = withDefaults(defineProps<{ isMember?: boolean }>(), { isMember: true })
const { t: tr } = useLocale()
const filter = ref('')
const gateMessage = ref('')
const vaultMessage = ref('')
const scaffoldingTemplateId = ref('')
const scanning = ref(false)

// ponytail: 初始化为全部未安装，避免 capStatus=undefined 触发卡片旧 IPC
const initStatuses: Record<string, { installed: boolean }> = {}
for (const tool of (githubToolsData as { tools: GitHubSkillEntry[] }).tools) {
  initStatuses[tool.id] = { installed: false }
}
const toolStatuses = ref<Record<string, { installed: boolean; path?: string; method?: string }>>(initStatuses)

async function refreshDetection() {
  if (!isTauriRuntime()) return
  scanning.value = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    toolStatuses.value = await invoke('check_all_tools', { force: true })
  } finally {
    scanning.value = false
  }
}

const githubTools = computed<GitHubSkillEntry[]>(() => {
  const tools = (githubToolsData as { tools: GitHubSkillEntry[] }).tools || []
  const filtered = searchItems(filter.value, tools, (t) =>
    [t.name, t.description, t.repo, ...(t.tags || [])].join(' ')
  ) as GitHubSkillEntry[]
  return filtered.filter(t => t.category !== 'plugin')
})

const pluginEntries = computed<GitHubSkillEntry[]>(() => {
  const tools = (githubToolsData as { tools: GitHubSkillEntry[] }).tools || []
  const base = tools.filter(t => t.category === 'plugin')
  return searchItems(filter.value, base, (t) =>
    [t.name, t.description, t.repo, ...(t.tags || [])].join(' ')
  ) as GitHubSkillEntry[]
})

function requireMemberAction(): boolean {
  if (!props.isMember) { gateMessage.value = '请登录后使用此功能'; return false }
  gateMessage.value = ''
  return true
}

async function scaffoldTemplate(template: VaultTemplate) {
  if (!requireMemberAction()) return
  if (!isTauriRuntime()) {
    vaultMessage.value = 'Web 端暂不支持写入本地目录，请在桌面端使用一键建库。'
    return
  }
  const vaultRoot = localStorage.getItem('jc_project_dir') || ''
  if (!vaultRoot) {
    vaultMessage.value = '请先在对话区上方选择一个文件夹作为 vault 目录'
    return
  }
  scaffoldingTemplateId.value = template.id
  vaultMessage.value = ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const input = buildVaultScaffoldInput(template)
    await invoke('scaffold_vault', {
      input: { vaultRoot, folders: input.folders, files: input.files }
    })
    vaultMessage.value = `已建好『${template.name}』骨架`
  } catch (error) {
    vaultMessage.value = error instanceof Error ? error.message : String(error || '一键建库失败')
  } finally {
    scaffoldingTemplateId.value = ''
  }
}

onMounted(async () => {
  if (!isTauriRuntime()) return
  scanning.value = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    toolStatuses.value = await invoke('check_all_tools', { force: false })
  } finally {
    scanning.value = false
  }
})

</script>

<template>
  <div class="tw">
    <div class="tw-head">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h3>{{ tr('settings.toolsRepo') }}</h3>
        <button class="tw-refresh" title="重新检测安装状态" @click="refreshDetection">
          <JcIcon name="refresh" />
        </button>
      </div>
      <p class="tw-desc">{{ tr('settings.toolsDesc') }}</p>
      <div class="tw-search">
        <JcIcon name="search" />
        <input v-model="filter" type="text" placeholder="搜索工具..." />
      </div>
    </div>

    <div v-if="gateMessage" class="tw-gate">{{ gateMessage }}</div>

    <div class="tw-scroll">
      <div v-if="scanning" class="tw-scanning-banner">
        <JcIcon name="sync" /> {{ tr('settings.scanning') }}
      </div>

      <!-- GitHub 推荐安装（主视图） -->
      <div class="tw-section">
        <div class="tw-section-title">
          <JcIcon name="star" />
          <span>{{ tr('settings.githubRecommended') }}</span>
          <span class="tw-count">{{ githubTools.length }} 个</span>
        </div>
        <div class="tw-github-grid">
          <GitHubSkillCard
            v-for="tool in githubTools"
            :key="tool.id"
            :skill="tool"
            :cap-status="toolStatuses[tool.id]"
          />
        </div>
      </div>

      <!-- 插件 -->
      <div v-if="pluginEntries.length > 0" class="tw-section">
        <div class="tw-section-title">
          <JcIcon name="extension" />
          <span>{{ tr('settings.plugins') }}</span>
          <span class="tw-count">{{ pluginEntries.length }} 个</span>
        </div>
        <div class="tw-github-grid">
          <GitHubSkillCard
            v-for="plugin in pluginEntries"
            :key="'p-' + plugin.id"
            :skill="plugin"
            :cap-status="toolStatuses[plugin.id]"
          />
        </div>
      </div>

      <!-- 知识库模板 -->
      <div class="tw-section">
        <div class="tw-section-title"><span>知识库模板</span></div>
        <div v-if="vaultMessage" class="tw-gate vault">{{ vaultMessage }}</div>
        <div class="tw-list">
          <div v-for="template in VAULT_TEMPLATES" :key="template.id" class="tw-card">
            <div class="tw-card-head">
              <JcIcon :name="template.icon" class="tw-icon" />
              <span class="tw-name">{{ template.name }}</span>
            </div>
            <div class="tw-desc2">{{ template.oneLineDesc }}</div>
            <div class="tw-tags">
              <span v-for="tag in template.keywords.slice(0, 3)" :key="tag" class="tw-tag">{{ tag }}</span>
            </div>
            <button class="tw-run" :disabled="scaffoldingTemplateId === template.id" @click="scaffoldTemplate(template)">
              {{ scaffoldingTemplateId === template.id ? '创建中…' : '一键建库' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tw { display: flex; flex-direction: column; height: 100%; background: var(--surface); }
.tw-head { padding: 12px 14px 8px; border-bottom: 1px solid var(--line); }
.tw-head h3 { margin: 0 0 2px; font-size: 15px; color: var(--ink1); }
.tw-refresh { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; cursor: pointer; color: var(--ink2); display: flex; align-items: center; }
.tw-refresh:hover { background: color-mix(in srgb, var(--olive) 12%, transparent); color: var(--olive); }
.tw-desc { margin: 0 0 8px; font-size: 11px; color: var(--ink3); }
.tw-search { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--bg); border-radius: 8px; border: 1px solid var(--line); }
.tw-search input { flex: 1; border: none; background: transparent; font-size: 13px; color: var(--ink1); outline: none; }
.tw-gate { padding: 8px 14px; color: #c62828; font-size: 13px; text-align: center; }
.tw-scroll { flex: 1; overflow-y: auto; padding: 8px 14px; }
.tw-scanning-banner { display: flex; align-items: center; gap: 6px; padding: 6px 10px; margin-bottom: 8px; font-size: 12px; color: var(--olive); background: color-mix(in srgb, var(--olive) 8%, transparent); border-radius: 6px; }
.tw-section { margin-bottom: 16px; }
.tw-section-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--ink2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.tw-count { font-weight: 400; color: var(--ink3); margin-left: auto; }
.tw-github-grid { display: grid; gap: 8px; }
.tw-gate.vault { color: #1565c0; background: #e3f2fd; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; }
.tw-list { display: grid; gap: 8px; }
.tw-card { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.tw-card-head { display: flex; align-items: center; gap: 8px; }
.tw-icon { font-size: 18px; color: var(--olive); }
.tw-name { font-size: 14px; font-weight: 600; color: var(--ink1); }
.tw-desc2 { font-size: 12px; color: var(--ink3); line-height: 1.4; }
.tw-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tw-tag { font-size: 11px; padding: 2px 7px; border-radius: 10px; background: color-mix(in srgb, var(--olive) 12%, transparent); color: var(--olive); }
.tw-run { align-self: flex-start; padding: 5px 14px; border-radius: 6px; border: none; background: var(--olive); color: #fff; font-size: 12px; cursor: pointer; }
.tw-run:disabled { opacity: 0.6; cursor: not-allowed; }
</style>

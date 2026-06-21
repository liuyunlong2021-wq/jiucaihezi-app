<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AddDirectoryDialog from '@/components/skills/AddDirectoryDialog.vue'
import PlatformDialog from '@/components/skills/PlatformDialog.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { AgentWithStatus, AiSettings, CustomPlatformConfig } from '@/types/skillsManage'
import {
  filterCustomPlatforms,
  filterScanDirectories,
  formatSecretStatus,
  normalizeAiSettings,
  type ScanDirectoryFilterMode,
} from '@/utils/skillsSettingsViewModel'
import { confirmAction } from '@/utils/confirmAction'

const store = useSkillsManageStore()
const {
  agents,
  aiSettings,
  databasePath,
  error,
  githubPat,
  isLoadingSettings,
  isSavingSettings,
  scanDirectories,
} = storeToRefs(store)

const directoryQuery = ref('')
const directoryMode = ref<ScanDirectoryFilterMode>('all')
const showDirectoryDialog = ref(false)
const platformDialogTarget = ref<AgentWithStatus | null | undefined>(undefined)
const githubPatInput = ref('')
const aiDraft = ref<AiSettings>({ provider: '', apiKey: '', model: '', apiUrl: '' })

const filteredDirectories = computed(() =>
  filterScanDirectories(scanDirectories.value, {
    query: directoryQuery.value,
    mode: directoryMode.value,
  })
)
const customPlatforms = computed(() => filterCustomPlatforms(agents.value))

async function load() {
  try {
    await Promise.all([
      store.loadScanDirectories(),
      store.loadAgents(),
      store.loadGitHubPat(),
      store.loadAiSettings(),
      store.loadDatabasePath(),
    ])
    githubPatInput.value = githubPat.value
    aiDraft.value = { ...aiSettings.value }
  } catch {
    // Store error is rendered in the panel.
  }
}

async function addDirectory(payload: { path: string; label: string }) {
  try {
    await store.addScanDirectory(payload.path, payload.label)
    showDirectoryDialog.value = false
  } catch {
    // Store error is rendered in the panel.
  }
}

async function removeDirectory(path: string) {
  const ok = await confirmAction(`移除 scan directory「${path}」？`, {
    title: '移除 scan directory',
    okLabel: '移除',
  })
  if (!ok) return
  try {
    await store.removeScanDirectory(path)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function toggleDirectory(path: string, isActive: boolean) {
  try {
    await store.setScanDirectoryActive(path, isActive)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function savePlatform(payload: { agentId?: string; config: CustomPlatformConfig }) {
  try {
    if (payload.agentId) {
      await store.updateCustomPlatform(payload.agentId, payload.config)
    } else {
      await store.addCustomPlatform(payload.config)
    }
    platformDialogTarget.value = undefined
  } catch {
    // Store error is rendered in the panel.
  }
}

async function removePlatform(agentId: string) {
  const ok = await confirmAction(`移除 custom Platform「${agentId}」？`, {
    title: '移除 custom Platform',
    okLabel: '移除',
  })
  if (!ok) return
  try {
    await store.removeCustomPlatform(agentId)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function saveGitHubPat() {
  try {
    await store.saveGitHubPat(githubPatInput.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function clearGitHubPat() {
  try {
    await store.clearGitHubPat()
    githubPatInput.value = ''
  } catch {
    // Store error is rendered in the panel.
  }
}

async function saveAiSettings() {
  try {
    const normalized = normalizeAiSettings(aiDraft.value)
    await store.saveAiSettings(normalized)
    aiDraft.value = { ...normalized }
  } catch {
    // Store error is rendered in the panel.
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="ssp">
    <header class="head">
      <div>
        <h3>Settings</h3>
        <p>管理 Skill 扫描、custom Platform、GitHub PAT 和 AI Summary 配置。</p>
      </div>
      <button class="btn" type="button" :disabled="isLoadingSettings" @click="load">
        <JcIcon name="refresh" :class="{ spin: isLoadingSettings }" />
        刷新
      </button>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="grid">
      <section class="panel wide">
        <header>
          <div>
            <h4>scan directories</h4>
            <p>控制 Central Skills 和 Discover 使用的扫描目录。</p>
          </div>
          <button class="btn primary" type="button" @click="showDirectoryDialog = true">
            <JcIcon name="add" />
            添加
          </button>
        </header>
        <div class="toolbar">
          <label>
            <JcIcon name="search" />
            <input v-model="directoryQuery" type="search" placeholder="搜索路径或标签" />
          </label>
          <select v-model="directoryMode">
            <option value="all">全部</option>
            <option value="custom">custom</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div class="rows">
          <article v-for="directory in filteredDirectories" :key="directory.path" class="row">
            <div>
              <strong>{{ directory.label || directory.path }}</strong>
              <small>{{ directory.path }}</small>
            </div>
            <div class="row-actions">
              <span class="pill">{{ directory.is_builtin ? 'builtin' : 'custom' }}</span>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="directory.is_active"
                  :disabled="directory.is_builtin || isSavingSettings"
                  @change="toggleDirectory(directory.path, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ directory.is_active ? 'enabled' : 'disabled' }}</span>
              </label>
              <button
                type="button"
                title="移除 scan directory"
                :disabled="directory.is_builtin || isSavingSettings"
                @click="removeDirectory(directory.path)"
              >
                <JcIcon name="delete" />
              </button>
            </div>
          </article>
          <div v-if="filteredDirectories.length === 0" class="state">暂无匹配 scan directory</div>
        </div>
      </section>

      <section class="panel">
        <header>
          <div>
            <h4>custom Platform</h4>
            <p>添加、编辑或移除自定义 Platform。</p>
          </div>
          <button class="btn primary" type="button" @click="platformDialogTarget = null">
            <JcIcon name="add" />
            添加
          </button>
        </header>
        <div class="rows">
          <article v-for="platform in customPlatforms" :key="platform.id" class="row compact">
            <div>
              <strong>{{ platform.display_name }}</strong>
              <small>{{ platform.global_skills_dir }}</small>
            </div>
            <div class="row-actions">
              <button type="button" title="编辑 Platform" @click="platformDialogTarget = platform"><JcIcon name="edit" /></button>
              <button type="button" title="移除 Platform" @click="removePlatform(platform.id)"><JcIcon name="delete" /></button>
            </div>
          </article>
          <div v-if="customPlatforms.length === 0" class="state">暂无 custom Platform</div>
        </div>
      </section>

      <section class="panel">
        <header>
          <div>
            <h4>GitHub PAT</h4>
            <p>用于提高 GitHub 导入成功率，不会显示明文。</p>
          </div>
          <span class="pill">{{ formatSecretStatus(githubPat) }}</span>
        </header>
        <label class="field">
          <span>Personal Access Token</span>
          <input v-model="githubPatInput" type="password" placeholder="github_pat_..." :disabled="isSavingSettings" />
        </label>
        <footer>
          <button class="btn" type="button" :disabled="isSavingSettings || !githubPat" @click="clearGitHubPat">
            <JcIcon name="backspace" />
            清除
          </button>
          <button class="btn primary" type="button" :disabled="isSavingSettings" @click="saveGitHubPat">
            <JcIcon name="save" :class="{ spin: isSavingSettings }" />
            保存
          </button>
        </footer>
      </section>

      <section class="panel">
        <header>
          <div>
            <h4>AI Summary</h4>
            <p>配置 SKILL.md 的 AI Summary 服务。</p>
          </div>
        </header>
        <label class="field"><span>provider</span><input v-model="aiDraft.provider" type="text" placeholder="openrouter / custom" /></label>
        <label class="field"><span>model</span><input v-model="aiDraft.model" type="text" placeholder="anthropic/claude-sonnet-4" /></label>
        <label class="field"><span>api url</span><input v-model="aiDraft.apiUrl" type="text" placeholder="https://..." /></label>
        <label class="field"><span>api key</span><input v-model="aiDraft.apiKey" type="password" placeholder="sk-..." /></label>
        <footer>
          <button class="btn primary" type="button" :disabled="isSavingSettings" @click="saveAiSettings">
            <JcIcon name="save" :class="{ spin: isSavingSettings }" />
            保存
          </button>
        </footer>
      </section>

      <section class="panel wide">
        <header>
          <div>
            <h4>Registry DB</h4>
            <p>Skill 管理 SQLite 数据库路径。</p>
          </div>
        </header>
        <code>{{ databasePath || '读取中...' }}</code>
      </section>
    </div>

    <AddDirectoryDialog
      v-if="showDirectoryDialog"
      :saving="isSavingSettings"
      @close="showDirectoryDialog = false"
      @add="addDirectory"
    />
    <PlatformDialog
      v-if="platformDialogTarget !== undefined"
      :platform="platformDialogTarget"
      :saving="isSavingSettings"
      @close="platformDialogTarget = undefined"
      @save="savePlatform"
    />
  </section>
</template>

<style scoped>
.ssp { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; overflow: auto; }
.head, .panel > header, footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
h3, h4, p { margin: 0; letter-spacing: 0; }
h3 { color: var(--ink1); font-size: 15px; font-weight: 950; }
h4 { color: var(--ink1); font-size: 13px; font-weight: 950; }
p { margin-top: 3px; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.btn, .row-actions button { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.error { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.panel { min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.panel.wide { grid-column: 1 / -1; }
.toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 8px; }
.toolbar label, .field { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; font-weight: 850; }
.toolbar label { min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink3); }
input, select { min-width: 0; height: 34px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink1); padding: 0 9px; }
.toolbar input { height: auto; flex: 1; border: 0; outline: 0; background: transparent; padding: 0; }
.rows { display: grid; gap: 7px; }
.row { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px; border: 1px solid var(--border2); border-radius: 8px; background: var(--surface); }
.row.compact { align-items: flex-start; }
.row div:first-child { min-width: 0; }
.row strong { display: block; color: var(--ink1); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row small { display: block; margin-top: 3px; color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.row-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; }
.row-actions button { width: 32px; padding: 0; }
.pill { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ink1) 8%, transparent); color: var(--ink3); font-size: 10px; font-weight: 950; white-space: nowrap; }
.switch { display: inline-flex; align-items: center; gap: 5px; color: var(--ink3); font-size: 11px; font-weight: 850; }
.switch input { width: 15px; height: 15px; }
footer { justify-content: flex-end; }
code { display: block; padding: 9px; border: 1px solid var(--border2); border-radius: 8px; background: var(--surface); color: var(--ink2); font-size: 12px; overflow-wrap: anywhere; }
.state { min-height: 62px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--ink3); text-align: center; font-size: 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 860px) {
  .grid { grid-template-columns: 1fr; }
  .toolbar { grid-template-columns: 1fr; }
}
</style>

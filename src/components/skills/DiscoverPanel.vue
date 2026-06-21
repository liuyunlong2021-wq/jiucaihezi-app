<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { storeToRefs } from 'pinia'
import DiscoverConfigDialog from '@/components/skills/DiscoverConfigDialog.vue'
import DiscoveredProjectList from '@/components/skills/DiscoveredProjectList.vue'
import ObsidianVaultPanel from '@/components/skills/ObsidianVaultPanel.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { DiscoverComplete, DiscoverProgress, DiscoveredProject, DiscoveredSkill } from '@/types/skillsManage'
import {
  countDiscoveredSkills,
  filterDiscoveredProjects,
  flattenDiscoveredSkills,
  toggleDiscoveredSkillSelection,
} from '@/utils/discoverViewModel'

const store = useSkillsManageStore()
const {
  agents,
  discoveredProjects,
  discoverProgress,
  error,
  isDiscoverScanning,
  isLoadingDiscover,
  scanRoots,
} = storeToRefs(store)

const showConfig = ref(false)
const subView = ref<'projects' | 'obsidian'>('projects')
const projectQuery = ref('')
const skillQuery = ref('')
const selectedSkillIds = ref(new Set<string>())
const importingSkillId = ref<string | null>(null)
const completeMessage = ref('')
const unlisteners: UnlistenFn[] = []

const enabledRoots = computed(() => scanRoots.value.filter((root) => root.exists && root.enabled))
const totalSkills = computed(() => countDiscoveredSkills(discoveredProjects.value))
const filteredProjects = computed(() =>
  filterDiscoveredProjects(discoveredProjects.value, {
    projectQuery: projectQuery.value,
    skillQuery: skillQuery.value,
  })
)
const filteredSkills = computed(() => flattenDiscoveredSkills(filteredProjects.value).map(item => item.skill))
const selectedSkills = computed(() =>
  flattenDiscoveredSkills(discoveredProjects.value)
    .map(item => item.skill)
    .filter((skill) => selectedSkillIds.value.has(skill.id))
)

async function load() {
  try {
    await Promise.all([store.loadScanRoots(), store.loadAgents()])
  } catch {
    // Store error is rendered in the panel.
  }
}

async function scan() {
  completeMessage.value = ''
  try {
    await store.startProjectScan(enabledRoots.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function stopScan() {
  try {
    await store.stopProjectScan()
  } catch {
    // Store error is rendered in the panel.
  }
}

async function toggleRoot(payload: { path: string; enabled: boolean }) {
  try {
    await store.setScanRootEnabled(payload.path, payload.enabled)
  } catch {
    // Store error is rendered in the panel.
  }
}

function toggleSkill(skillId: string) {
  selectedSkillIds.value = toggleDiscoveredSkillSelection(selectedSkillIds.value, skillId)
}

function selectVisibleSkills() {
  selectedSkillIds.value = new Set(filteredSkills.value.map(skill => skill.id))
}

function clearSelection() {
  selectedSkillIds.value = new Set()
}

async function importCentral(skill: DiscoveredSkill) {
  importingSkillId.value = skill.id
  try {
    await store.importDiscoveredSkillToCentral(skill.id)
    selectedSkillIds.value.delete(skill.id)
    selectedSkillIds.value = new Set(selectedSkillIds.value)
  } catch {
    // Store error is rendered in the panel.
  } finally {
    importingSkillId.value = null
  }
}

async function importPlatform(payload: { skill: DiscoveredSkill; agentId: string; method: 'symlink' | 'copy' }) {
  if (!payload.agentId) return
  importingSkillId.value = payload.skill.id
  try {
    await store.importDiscoveredSkillToPlatform(payload.skill.id, payload.agentId, payload.method)
  } catch {
    // Store error is rendered in the panel.
  } finally {
    importingSkillId.value = null
  }
}

async function importSelectedToCentral() {
  for (const skill of selectedSkills.value) {
    if (!skill.is_already_central) {
      await importCentral(skill)
    }
  }
}

async function clearResults() {
  if (isDiscoverScanning.value) return
  selectedSkillIds.value = new Set()
  completeMessage.value = ''
  try {
    await store.clearDiscoveredSkills()
  } catch {
    // Store error is rendered in the panel.
  }
}

async function attachDiscoverEvents() {
  unlisteners.push(
    await listen<{ project: DiscoveredProject }>('discover:found', (event) => {
      store.upsertDiscoveredProject(event.payload.project)
    }),
    await listen<DiscoverProgress>('discover:progress', (event) => {
      store.setDiscoverProgress(event.payload)
    }),
    await listen<DiscoverComplete>('discover:complete', (event) => {
      completeMessage.value = `${event.payload.total_projects} 个项目 · ${event.payload.total_skills} 个 Skill`
      store.setDiscoverProgress(null)
    }),
  )
}

onMounted(() => {
  void load()
  void attachDiscoverEvents()
})

onBeforeUnmount(() => {
  for (const unlisten of unlisteners.splice(0)) {
    unlisten()
  }
})
</script>

<template>
  <section class="dp">
    <header class="head">
      <div>
        <h3>Discover</h3>
        <p>扫描本机项目目录，发现里面已有的 SKILL.md。</p>
      </div>
      <div class="actions">
        <button class="btn" :disabled="isLoadingDiscover" title="扫描设置" @click="showConfig = true">
          <JcIcon name="tune" />
          设置
        </button>
        <button class="btn" :disabled="isLoadingDiscover" title="刷新" @click="load">
          <JcIcon name="refresh" />
          刷新
        </button>
        <button v-if="isDiscoverScanning" class="btn danger" @click="stopScan">
          <JcIcon name="stop_circle" />
          停止
        </button>
        <button v-else class="btn primary" :disabled="enabledRoots.length === 0" @click="scan">
          <JcIcon name="travel_explore" />
          扫描
        </button>
      </div>
    </header>

    <nav class="subtabs" aria-label="Discover 二级入口">
      <button type="button" :class="{ active: subView === 'projects' }" @click="subView = 'projects'">
        <JcIcon name="folder_search" />
        Projects
      </button>
      <button type="button" :class="{ active: subView === 'obsidian' }" @click="subView = 'obsidian'">
        <JcIcon name="library_books" />
        Obsidian
      </button>
    </nav>

    <ObsidianVaultPanel v-if="subView === 'obsidian'" />

    <template v-else>
    <div v-if="error" class="error">{{ error }}</div>

    <section class="scan-status">
      <div>
        <strong>{{ discoveredProjects.length }}</strong>
        <span>项目</span>
      </div>
      <div>
        <strong>{{ totalSkills }}</strong>
        <span>Skill</span>
      </div>
      <div>
        <strong>{{ enabledRoots.length }}</strong>
        <span>启用 root</span>
      </div>
      <div>
        <strong>{{ selectedSkillIds.size }}</strong>
        <span>已选择</span>
      </div>
    </section>

    <section class="progress-box" :class="{ active: isDiscoverScanning }">
      <div class="progress-line">
        <span>{{ isDiscoverScanning ? '扫描中' : completeMessage ? '最近完成' : '待扫描' }}</span>
        <strong>{{ discoverProgress?.percent ?? (completeMessage ? 100 : 0) }}%</strong>
      </div>
      <div class="bar"><i :style="{ width: `${discoverProgress?.percent ?? (completeMessage ? 100 : 0)}%` }" /></div>
      <p>{{ discoverProgress?.current_path || completeMessage || '可在设置里启停扫描 root。' }}</p>
      <small v-if="discoverProgress">
        已发现 {{ discoverProgress.projects_found }} 个项目 · {{ discoverProgress.skills_found }} 个 Skill
      </small>
    </section>

    <section class="toolbar">
      <label>
        <JcIcon name="folder_search" />
        <input v-model="projectQuery" type="search" placeholder="搜索项目" />
      </label>
      <label>
        <JcIcon name="search" />
        <input v-model="skillQuery" type="search" placeholder="搜索 Skill" />
      </label>
      <button class="btn" :disabled="filteredSkills.length === 0" @click="selectVisibleSkills">
        <JcIcon name="select_all" />
        选择当前
      </button>
      <button class="btn" :disabled="selectedSkillIds.size === 0" @click="clearSelection">
        <JcIcon name="disabled_by_default" />
        清除选择
      </button>
      <button class="btn primary" :disabled="selectedSkills.length === 0" @click="importSelectedToCentral">
        <JcIcon name="move_to_inbox" />
        导入 Central
      </button>
      <button class="btn danger" :disabled="isDiscoverScanning || discoveredProjects.length === 0" @click="clearResults">
        <JcIcon name="delete_sweep" />
        清空结果
      </button>
    </section>

    <div v-if="isLoadingDiscover && discoveredProjects.length === 0" class="state">加载扫描 root...</div>
    <div v-else-if="filteredProjects.length === 0" class="state">暂无发现结果。</div>
    <DiscoveredProjectList
      v-else
      :projects="filteredProjects"
      :selected-skill-ids="selectedSkillIds"
      :agents="agents"
      :importing-skill-id="importingSkillId"
      @toggle-skill="toggleSkill"
      @import-central="importCentral"
      @import-platform="importPlatform"
    />

    <DiscoverConfigDialog
      v-if="showConfig"
      :roots="scanRoots"
      :loading="isLoadingDiscover"
      @close="showConfig = false"
      @refresh="load"
      @toggle-root="toggleRoot"
    />
    </template>
  </section>
</template>

<style scoped>
.dp { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.head { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
p { margin: 3px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.actions, .toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.subtabs { flex: 0 0 auto; display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); align-self: flex-start; }
.subtabs button { min-height: 28px; display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; background: transparent; color: var(--ink3); padding: 0 9px; font-size: 12px; font-weight: 900; cursor: pointer; }
.subtabs button.active { background: var(--olive-pale); color: var(--olive-dark); }
.btn { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.btn.danger { color: var(--jc-error); border-color: color-mix(in srgb, var(--jc-error) 30%, var(--border)); }
.btn:disabled { opacity: .55; cursor: default; }
.error { flex: 0 0 auto; padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
.scan-status { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.scan-status div { min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.scan-status strong { display: block; color: var(--ink1); font-size: 17px; line-height: 1; }
.scan-status span { display: block; margin-top: 4px; color: var(--ink3); font-size: 11px; font-weight: 850; }
.progress-box { flex: 0 0 auto; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.progress-box.active { border-color: color-mix(in srgb, var(--olive) 42%, var(--border)); }
.progress-line { display: flex; justify-content: space-between; gap: 10px; color: var(--ink2); font-size: 12px; font-weight: 900; }
.bar { height: 7px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--ink1) 8%, transparent); }
.bar i { display: block; height: 100%; border-radius: inherit; background: var(--olive); transition: width .2s ease; }
.progress-box small { display: block; margin-top: 4px; color: var(--ink3); font-size: 11px; }
.toolbar { flex: 0 0 auto; }
.toolbar label { min-width: 160px; flex: 1 1 180px; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink3); }
.toolbar input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink1); font-size: 12px; }
.state { flex: 1; min-height: 0; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--ink3); text-align: center; }
@media (max-width: 760px) {
  .head { flex-direction: column; }
  .scan-status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar label { flex-basis: 100%; }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import PlatformSkillDrawer from '@/components/skills/PlatformSkillDrawer.vue'
import PlatformBadge from '@/components/skills/shared/PlatformBadge.vue'
import PlatformIcon from '@/components/skills/shared/PlatformIcon.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { AgentWithStatus, SkillForAgent } from '@/types/skillsManage'
import { confirmAction } from '@/utils/confirmAction'
import {
  canUninstallPlatformSkill,
  filterPlatformAgents,
  filterPlatformSkills,
  splitPlatformSkillsByFolder,
  type PlatformSkillSourceFilter,
} from '@/utils/platformSkillViewModel'

type PlatformSkillListMode = 'list' | 'folders'

const store = useSkillsManageStore()
const {
  agents,
  centralRoot,
  centralSkills,
  error,
  installingSkillId,
  isLoadingDetail,
  isLoadingPlatforms,
  lastScan,
  loadingPlatformAgentId,
  platformSkills,
} = storeToRefs(store)

const selectedAgentId = ref('')
const selectedCentralSkillId = ref('')
const platformQuery = ref('')
const skillQuery = ref('')
const sourceFilter = ref<PlatformSkillSourceFilter>('all')
const listMode = ref<PlatformSkillListMode>('list')
const drawerOpen = ref(false)
const drawerSkill = ref<SkillForAgent | null>(null)

const visiblePlatformAgents = computed(() =>
  agents.value.filter((agent) =>
    agent.is_enabled &&
    agent.id !== 'central' &&
    agent.category !== 'central'
  )
)

const filteredAgents = computed(() =>
  filterPlatformAgents(visiblePlatformAgents.value, platformQuery.value)
)

const selectedAgent = computed(() =>
  visiblePlatformAgents.value.find((agent) => agent.id === selectedAgentId.value) || null
)

const selectedAgentShared = computed(() =>
  isSharedAgent(selectedAgent.value)
)

const selectedSkills = computed<SkillForAgent[]>(() =>
  selectedAgentId.value ? platformSkills.value[selectedAgentId.value] || [] : []
)

const filteredSkills = computed(() =>
  filterPlatformSkills(selectedSkills.value, {
    query: skillQuery.value,
    source: sourceFilter.value,
  })
)

const folderSplit = computed(() =>
  splitPlatformSkillsByFolder({
    skills: filteredSkills.value,
    rootPath: selectedAgent.value?.global_skills_dir || '',
  })
)

function normalizeSkillPath(path: string | null | undefined): string {
  return (path || '').replace(/\/+$/, '')
}

function isSharedAgent(agent: AgentWithStatus | null): boolean {
  return Boolean(agent && normalizeSkillPath(agent.global_skills_dir) === normalizeSkillPath(centralRoot.value))
}

function skillCount(agent: AgentWithStatus) {
  return platformSkills.value[agent.id]?.length ?? lastScan.value?.skills_by_agent?.[agent.id] ?? 0
}

function categoryLabel(agent: AgentWithStatus) {
  if (agent.category === 'lobster') return 'lobster'
  if (agent.category === 'custom') return 'custom'
  return 'coding'
}

function sourceLabel(skill: SkillForAgent) {
  if (skill.source_kind === 'plugin') return 'plugin'
  if (skill.source_kind === 'compatibility') return 'compatibility'
  if (skill.source_kind === 'user') return 'user'
  return skill.link_type
}

function statusLabel(skill: SkillForAgent, agent: AgentWithStatus | null) {
  if (isSharedAgent(agent)) return '共享 / 自动包含'
  if (skill.is_read_only) return '只读'
  return '可管理'
}

function canUninstall(skill: SkillForAgent) {
  return canUninstallPlatformSkill(skill, selectedAgent.value, centralRoot.value)
}

async function loadPlatforms() {
  try {
    await store.detectAgents()
    if (centralSkills.value.length === 0) await store.loadCentralSkills({ scan: false })
    if (!selectedAgentId.value && visiblePlatformAgents.value.length > 0) {
      selectedAgentId.value = visiblePlatformAgents.value[0].id
      await store.loadSkillsByAgent(selectedAgentId.value)
    }
  } catch {
    // Store error is rendered in the panel.
  }
}

async function selectAgent(agent: AgentWithStatus) {
  selectedAgentId.value = agent.id
  drawerOpen.value = false
  drawerSkill.value = null
  try {
    await store.loadSkillsByAgent(agent.id)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function installSelected() {
  if (!selectedAgentId.value || !selectedCentralSkillId.value || selectedAgentShared.value) return
  try {
    await store.installSkillToAgent(selectedCentralSkillId.value, selectedAgentId.value)
    await store.loadSkillsByAgent(selectedAgentId.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function openSkillDetail(skill: SkillForAgent) {
  if (!selectedAgentId.value) return
  drawerSkill.value = skill
  drawerOpen.value = true
  try {
    await store.loadPlatformSkillDetail(skill.id, selectedAgentId.value, skill.row_id)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function uninstallSkill(skill: SkillForAgent) {
  if (!selectedAgentId.value || !canUninstall(skill)) return
  const ok = await confirmAction(`从 ${selectedAgent.value?.display_name || selectedAgentId.value} 卸载「${skill.name}」？`, {
    title: '卸载 Skill',
    okLabel: '卸载',
    cancelLabel: '取消',
  })
  if (!ok) return
  try {
    await store.uninstallSkillFromAgent(skill.id, selectedAgentId.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

onMounted(() => {
  void loadPlatforms()
})
</script>

<template>
  <section class="sk-page">
    <div class="sk-page-head">
      <div>
        <h3>Platform</h3>
        <p>Platform 是能读取或安装 Skill 的 AI 工具。</p>
      </div>
      <button class="sk-btn" :disabled="isLoadingPlatforms" @click="loadPlatforms">
        <span class="mso" :class="{ spin: isLoadingPlatforms }">radar</span>
        检测
      </button>
    </div>

    <div v-if="error" class="sk-error">{{ error }}</div>

    <div class="platform-layout">
      <aside class="platform-list">
        <div class="search-box">
          <span class="mso">search</span>
          <input v-model="platformQuery" type="search" placeholder="搜索 Platform" />
        </div>
        <button
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="platform-row"
          :class="{ active: selectedAgentId === agent.id, shared: isSharedAgent(agent) }"
          @click="selectAgent(agent)"
        >
          <PlatformBadge
            :agent="agent"
            :count="skillCount(agent)"
            :active="selectedAgentId === agent.id"
            :shared="isSharedAgent(agent)"
          />
          <span class="platform-meta">
            <span>{{ categoryLabel(agent) }}</span>
            <span>{{ agent.is_detected ? '已检测到' : '未检测到' }}</span>
          </span>
          <span class="platform-path">{{ agent.global_skills_dir }}</span>
        </button>
        <div v-if="filteredAgents.length === 0" class="sk-state small">没有匹配的 Platform</div>
      </aside>

      <main class="platform-detail">
        <div class="detail-top">
          <div class="selected-platform">
            <PlatformIcon v-if="selectedAgent" :agent="selectedAgent" />
            <div>
              <h4>{{ selectedAgent?.display_name || '选择一个 Platform' }}</h4>
              <p>{{ selectedAgent?.global_skills_dir || '选择左侧 Platform 查看 Skill' }}</p>
            </div>
          </div>
          <span v-if="selectedAgentShared" class="shared-note">共享 / 自动包含，不需要安装或卸载</span>
        </div>

        <div class="install-line">
          <select v-model="selectedCentralSkillId" :disabled="selectedAgentShared">
            <option value="">选择 Central Skills Skill</option>
            <option v-for="skill in centralSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
          </select>
          <button
            class="sk-btn primary"
            :disabled="selectedAgentShared || !selectedAgentId || !selectedCentralSkillId || !!installingSkillId"
            @click="installSelected"
          >
            <span class="mso">add_link</span>
            安装到 {{ selectedAgent?.display_name || 'Platform' }}
          </button>
        </div>

        <div class="skill-toolbar">
          <div class="search-box skill-search">
            <span class="mso">search</span>
            <input v-model="skillQuery" type="search" placeholder="搜索 Skill" />
          </div>
          <div class="segmented">
            <button :class="{ active: sourceFilter === 'all' }" @click="sourceFilter = 'all'">all</button>
            <button :class="{ active: sourceFilter === 'user' }" @click="sourceFilter = 'user'">user</button>
            <button :class="{ active: sourceFilter === 'plugin' }" @click="sourceFilter = 'plugin'">plugin</button>
          </div>
          <div class="segmented">
            <button title="列表视图" :class="{ active: listMode === 'list' }" @click="listMode = 'list'"><span class="mso">view_list</span></button>
            <button title="文件夹视图" :class="{ active: listMode === 'folders' }" @click="listMode = 'folders'"><span class="mso">folder</span></button>
          </div>
        </div>

        <div v-if="loadingPlatformAgentId === selectedAgentId" class="sk-state">
          <span class="mso spin">progress_activity</span> 读取 Platform Skill...
        </div>
        <div v-else-if="!selectedAgent" class="sk-state">选择一个 Platform</div>
        <div v-else-if="filteredSkills.length === 0" class="sk-state">没有匹配的 Skill</div>
        <div v-else-if="listMode === 'list'" class="skill-list">
          <article v-for="skill in filteredSkills" :key="skill.row_id" class="skill-row">
            <button class="skill-main" type="button" @click="openSkillDetail(skill)">
              <strong>{{ skill.name }}</strong>
              <p>{{ skill.description || skill.dir_path }}</p>
              <span>{{ sourceLabel(skill) }} · {{ statusLabel(skill, selectedAgent) }}</span>
            </button>
            <button v-if="canUninstall(skill)" class="icon-btn" title="卸载" @click="uninstallSkill(skill)">
              <span class="mso">link_off</span>
            </button>
          </article>
        </div>
        <div v-else class="folder-view">
          <section v-if="folderSplit.rootSkills.length" class="folder-group">
            <h5>根目录</h5>
            <article v-for="skill in folderSplit.rootSkills" :key="skill.row_id" class="skill-row compact">
              <button class="skill-main" type="button" @click="openSkillDetail(skill)">
                <strong>{{ skill.name }}</strong>
                <span>{{ sourceLabel(skill) }} · {{ statusLabel(skill, selectedAgent) }}</span>
              </button>
              <button v-if="canUninstall(skill)" class="icon-btn" title="卸载" @click="uninstallSkill(skill)">
                <span class="mso">link_off</span>
              </button>
            </article>
          </section>
          <section v-for="group in folderSplit.groups" :key="group.relativePath" class="folder-group">
            <h5><span class="mso">folder</span>{{ group.name }} <small>{{ group.skills.length }}</small></h5>
            <article v-for="skill in group.skills" :key="skill.row_id" class="skill-row compact">
              <button class="skill-main" type="button" @click="openSkillDetail(skill)">
                <strong>{{ skill.name }}</strong>
                <span>{{ sourceLabel(skill) }} · {{ statusLabel(skill, selectedAgent) }}</span>
              </button>
              <button v-if="canUninstall(skill)" class="icon-btn" title="卸载" @click="uninstallSkill(skill)">
                <span class="mso">link_off</span>
              </button>
            </article>
          </section>
        </div>
      </main>
    </div>

    <PlatformSkillDrawer
      v-if="drawerOpen"
      :agent="selectedAgent"
      :skill="drawerSkill"
      @close="drawerOpen = false"
    />
    <div v-if="drawerOpen && isLoadingDetail" class="detail-loading">
      <span class="mso spin">progress_activity</span>
    </div>
  </section>
</template>

<style scoped>
.sk-page { height: 100%; display: flex; flex-direction: column; min-height: 0; padding: 10px; gap: 10px; }
.sk-page-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; font-size: 15px; }
h4 { margin: 0; font-size: 14px; color: var(--ink1); }
h5 { margin: 0 0 7px; display: flex; align-items: center; gap: 5px; color: var(--olive-dark); font-size: 12px; }
h5 small { color: var(--ink3); font-size: 11px; }
p { margin: 3px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.sk-btn, .icon-btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
}
.sk-btn { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; font-weight: 850; white-space: nowrap; }
.sk-btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.sk-btn:disabled, .icon-btn:disabled { opacity: .5; cursor: default; }
.sk-error { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
.platform-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, .85fr) minmax(0, 1.25fr); gap: 10px; }
.platform-list, .platform-detail { min-height: 0; overflow: auto; }
.platform-list { display: flex; flex-direction: column; gap: 7px; }
.platform-row { text-align: left; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); padding: 8px; cursor: pointer; }
.platform-row.active { border-color: var(--olive-dark); box-shadow: 0 0 0 2px color-mix(in srgb, var(--olive) 16%, transparent); }
.platform-row.shared { background: color-mix(in srgb, var(--olive-pale) 35%, var(--paper)); }
.platform-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; color: var(--ink3); font-size: 11px; }
.platform-meta span { padding: 2px 5px; border-radius: 999px; background: color-mix(in srgb, var(--ink1) 6%, transparent); }
.platform-path { display: block; margin-top: 6px; color: var(--ink3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-box {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink3);
}
.search-box input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink1);
  font-size: 12px;
}
.platform-detail { display: flex; flex-direction: column; gap: 10px; }
.detail-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.selected-platform { min-width: 0; display: flex; align-items: flex-start; gap: 8px; }
.shared-note {
  flex: 0 0 auto;
  padding: 5px 8px;
  border-radius: 999px;
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-size: 11px;
  font-weight: 850;
}
.install-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
select { min-width: 0; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 8px; }
select:disabled { opacity: .58; }
.skill-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; }
.segmented {
  height: 32px;
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
.segmented button {
  min-width: 32px;
  border: 0;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.segmented button:first-child { border-left: 0; }
.segmented button.active { background: var(--olive-pale); color: var(--olive-dark); }
.skill-list, .folder-view { display: flex; flex-direction: column; gap: 8px; }
.folder-group { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--paper) 82%, var(--surface)); }
.skill-row { display: flex; gap: 8px; justify-content: space-between; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.skill-row.compact { padding: 8px; }
.skill-main { min-width: 0; flex: 1; display: block; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.skill-main strong { display: block; color: var(--ink1); font-size: 13px; overflow-wrap: anywhere; }
.skill-main span { display: inline-block; margin-top: 5px; color: var(--ink3); font-size: 11px; }
.icon-btn { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; }
.sk-state { margin: auto; color: var(--ink3); display: grid; place-items: center; gap: 8px; min-height: 120px; text-align: center; }
.sk-state.small { min-height: 80px; }
.detail-loading {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 45;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--olive-dark);
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 860px) {
  .platform-layout { grid-template-columns: 1fr; }
  .skill-toolbar { grid-template-columns: 1fr; }
  .install-line { grid-template-columns: 1fr; }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CollectionsPanel from '@/components/skills/CollectionsPanel.vue'
import DiscoverPanel from '@/components/skills/DiscoverPanel.vue'
import MarketplacePanel from '@/components/skills/MarketplacePanel.vue'
import PlatformPanel from '@/components/skills/PlatformPanel.vue'
import CentralBundleDetailDialog from '@/components/skills/CentralBundleDetailDialog.vue'
import InstallDialog from '@/components/skills/InstallDialog.vue'
import SkillDetailPanel from '@/components/skills/SkillDetailPanel.vue'
import SkillsSettingsPanel from '@/components/skills/SkillsSettingsPanel.vue'
import SkillAliasEditor from '@/components/skills/shared/SkillAliasEditor.vue'
import SkillCard from '@/components/skills/shared/SkillCard.vue'
import SkillFolderCard from '@/components/skills/shared/SkillFolderCard.vue'
import SkillListModeToggle from '@/components/skills/shared/SkillListModeToggle.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { CentralSkillBundle, SkillsManageTab, SkillWithLinks } from '@/types/skillsManage'
import { confirmAction } from '@/utils/confirmAction'
import {
  splitCentralSkillsByTopLevel,
  sortCentralSkills,
  type CentralSkillSortDirection,
  type CentralSkillSortField,
} from '@/utils/centralSkillViewModel'

const store = useSkillsManageStore()
const {
  activeTab,
  agents,
  centralBundleDeletePreview,
  centralBundleDetails,
  centralBundles,
  centralRoot,
  centralSkills,
  deletingBundlePath,
  deletingSkillId,
  error,
  installableAgents,
  installingSkillId,
  isLoadingCentral,
  isLoadingDetail,
  isScanning,
  lastScan,
  selectedSkillDetail,
  selectedSkillId,
} = storeToRefs(store)

const query = ref('')
const sortField = ref<CentralSkillSortField>('name')
const sortDirection = ref<CentralSkillSortDirection>('asc')
const viewMode = ref<'all' | 'folders'>('all')
const showDetail = ref(false)
const aliasEditingSkill = ref<SkillWithLinks | null>(null)
const installDialogSkill = ref<SkillWithLinks | null>(null)
const bundleDetailPath = ref('')
const deleteTargetBundle = ref<CentralSkillBundle | null>(null)

const tabs: Array<{ key: SkillsManageTab; label: string; icon: string; ready: boolean }> = [
  { key: 'central', label: 'Central Skills', icon: 'deployed_code', ready: true },
  { key: 'platforms', label: 'Platform', icon: 'hub', ready: true },
  { key: 'discover', label: 'Discover', icon: 'travel_explore', ready: true },
  { key: 'marketplace', label: 'Marketplace', icon: 'storefront', ready: true },
  { key: 'collections', label: 'Collections', icon: 'collections_bookmark', ready: true },
]

const folderSplit = computed(() =>
  splitCentralSkillsByTopLevel({
    skills: centralSkills.value,
    rootPath: centralRoot.value,
  })
)

const folderGroupsByPath = computed(() =>
  new Map(folderSplit.value.groups.map((group) => [group.relativePath, group]))
)

const baseVisibleSkills = computed(() =>
  viewMode.value === 'folders' ? folderSplit.value.rootSkills : centralSkills.value
)

const visibleSkills = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  const list = normalized
    ? baseVisibleSkills.value.filter((skill) => store.skillMatchesSearch(skill, normalized))
    : baseVisibleSkills.value

  return sortCentralSkills(list, sortField.value, sortDirection.value)
})

const visibleBundles = computed(() => {
  if (viewMode.value !== 'folders') return []
  const normalized = query.value.trim().toLowerCase()
  const list = normalized
    ? centralBundles.value.filter((bundle) => {
        const text = [bundle.name, bundle.relativePath, bundle.path].join(' ').toLowerCase()
        if (text.includes(normalized)) return true
        return folderGroupsByPath.value.get(bundle.relativePath)?.skills.some((skill) =>
          store.skillMatchesSearch(skill, normalized)
        ) || false
      })
    : centralBundles.value

  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
})

const centralRootDisplay = computed(() =>
  centralRoot.value.replace(/^\/Users\/[^/]+/, '~')
)

const activeBundleDetail = computed(() =>
  bundleDetailPath.value ? centralBundleDetails.value[bundleDetailPath.value] || null : null
)

const affectedAgentNames = computed(() => {
  const namesById = new Map(agents.value.map((agent) => [agent.id, agent.display_name]))
  return (centralBundleDeletePreview.value?.affectedAgents || []).map((agentId) => namesById.get(agentId) || agentId)
})

async function refresh() {
  await store.loadCentralSkills({ scan: true })
  await store.loadCentralBundles()
}

async function openSkill(skill: SkillWithLinks) {
  try {
    await store.loadSkillDetail(skill.id)
    showDetail.value = true
  } catch {
    // Store error is rendered in the panel.
  }
}

async function installSkill(skill: SkillWithLinks) {
  installDialogSkill.value = skill
}

async function batchInstallSkill(payload: { skill: SkillWithLinks; agentIds: string[]; method: 'symlink' | 'copy' }) {
  try {
    await store.batchInstallSkillToAgents(payload.skill.id, payload.agentIds, payload.method)
    await Promise.all([
      store.loadCentralSkills({ scan: true }),
      ...payload.agentIds.map((agentId) => store.loadSkillsByAgent(agentId)),
    ])
    installDialogSkill.value = null
  } catch {
    // Store error is rendered in the panel.
  }
}

async function deleteSkill(skill: SkillWithLinks) {
  const linkedCount = skill.linked_agents.length + (skill.read_only_agents?.length || 0)
  const ok = await confirmAction(
    linkedCount > 0
      ? `删除 ${skill.name} 会同时影响 ${linkedCount} 个 Platform 安装记录。继续？`
      : `删除 Central Skills 中的 Skill「${skill.name}」？`,
    {
      title: '删除 Skill',
      kind: 'warning',
      okLabel: '删除',
      cancelLabel: '取消',
    }
  )
  if (!ok) return
  try {
    await store.deleteCentralSkill(skill.id, linkedCount > 0)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function openBundle(bundle: CentralSkillBundle) {
  bundleDetailPath.value = bundle.relativePath
  try {
    await store.loadCentralBundleDetail(bundle.relativePath)
  } catch {
    bundleDetailPath.value = ''
  }
}

async function openSkillFromBundle(skillId: string) {
  const skill = centralSkills.value.find((item) => item.id === skillId)
  bundleDetailPath.value = ''
  if (skill) await openSkill(skill)
}

async function previewDeleteBundle(bundle: CentralSkillBundle) {
  try {
    await store.previewDeleteCentralSkillBundle(bundle.relativePath)
    deleteTargetBundle.value = bundle
  } catch {
    // Store error is rendered in the panel.
  }
}

async function deleteBundle() {
  if (!deleteTargetBundle.value) return
  try {
    await store.deleteCentralSkillBundle(deleteTargetBundle.value.relativePath, true)
    deleteTargetBundle.value = null
    await refresh()
  } catch {
    // Store error is rendered in the panel.
  }
}

function setTab(tab: SkillsManageTab) {
  showDetail.value = false
  aliasEditingSkill.value = null
  installDialogSkill.value = null
  bundleDetailPath.value = ''
  deleteTargetBundle.value = null
  store.setActiveTab(tab)
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section class="cs-panel">
    <header class="cs-head">
      <div class="cs-title">
        <span class="mso">magic_button</span>
        <div>
          <h2>Central Skills</h2>
          <p>{{ centralRootDisplay }} · 统一管理本机 Skill</p>
        </div>
      </div>
      <div class="cs-head-actions">
        <button class="cs-text-btn" type="button" title="GitHub 导入" @click="setTab('marketplace')">
          <span class="mso">download</span>
          GitHub 导入
        </button>
        <button class="cs-icon-btn" type="button" title="刷新 Central Skills" :disabled="isLoadingCentral || isScanning" @click="refresh">
          <span class="mso" :class="{ spin: isLoadingCentral || isScanning }">refresh</span>
        </button>
        <button class="cs-icon-btn" type="button" title="Settings" @click="setTab('settings')">
          <span class="mso">settings</span>
        </button>
      </div>
    </header>

    <nav class="cs-tabs" aria-label="Skill 管理视图">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="{ active: activeTab === tab.key }"
        @click="setTab(tab.key)"
      >
        <span class="mso">{{ tab.icon }}</span>
        {{ tab.label }}
      </button>
    </nav>

    <SkillDetailPanel v-if="showDetail" class="cs-detail-host" @back="showDetail = false" />

    <template v-else-if="activeTab === 'central'">
      <div class="cs-toolbar">
        <label class="cs-search">
          <span class="mso">search</span>
          <input v-model="query" type="search" placeholder="搜索显示别名、Skill name、描述或路径" />
        </label>
        <select v-model="sortField" class="cs-select" aria-label="排序字段">
          <option value="name">名称</option>
          <option value="createdAt">创建时间</option>
          <option value="updatedAt">更新时间</option>
        </select>
        <select v-model="sortDirection" class="cs-select" aria-label="排序方向">
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        <SkillListModeToggle v-model="viewMode" />
      </div>

      <div v-if="selectedSkillDetail" class="cs-selected">
        <span class="mso">article</span>
        <div>
          <strong>{{ selectedSkillDetail.name }}</strong>
          <span>
            {{ isLoadingDetail ? '读取详情中...' : `${selectedSkillDetail.installations.length} 个安装记录` }}
          </span>
        </div>
      </div>

      <div v-if="error" class="cs-error">
        <span class="mso">error</span>
        <span>{{ error }}</span>
      </div>

      <div class="cs-meta">
        <span>{{ visibleSkills.length }} / {{ centralSkills.length }} 个 Skill</span>
        <span v-if="viewMode === 'folders'">{{ visibleBundles.length }} / {{ centralBundles.length }} 个 bundle</span>
        <span v-if="lastScan">扫描 {{ lastScan.agents_scanned }} 个 Platform，发现 {{ lastScan.total_skills }} 个 Skill</span>
      </div>

      <div v-if="isLoadingCentral && centralSkills.length === 0" class="cs-state">
        <span class="mso spin">progress_activity</span>
        <span>正在扫描 ~/.agents/skills/ ...</span>
      </div>

      <div v-else-if="visibleSkills.length === 0 && visibleBundles.length === 0" class="cs-state">
        <span class="mso">inventory_2</span>
        <span>{{ query ? '没有匹配的 Skill' : 'Central Skills 暂无 Skill。请在 ~/.agents/skills/ 下添加 SKILL.md。' }}</span>
      </div>

      <div v-else class="cs-content">
        <section v-if="viewMode === 'folders' && visibleBundles.length" class="cs-section">
          <div class="cs-section-title">
            <span class="mso">folder_open</span>
            <h3>Central bundles</h3>
          </div>
          <div class="cs-grid">
            <SkillFolderCard
              v-for="bundle in visibleBundles"
              :key="bundle.relativePath"
              :bundle="bundle"
              :preview-names="folderGroupsByPath.get(bundle.relativePath)?.skills.map(skill => skill.name) || []"
              :deleting="deletingBundlePath === bundle.relativePath"
              @open="openBundle"
              @delete="previewDeleteBundle"
            />
          </div>
        </section>

        <section v-if="visibleSkills.length" class="cs-section">
          <div v-if="viewMode === 'folders'" class="cs-section-title">
            <span class="mso">deployed_code</span>
            <h3>Top-level Skills</h3>
          </div>
          <div class="cs-grid">
            <SkillCard
              v-for="skill in visibleSkills"
              :key="skill.id"
              :skill="skill"
              :selected="selectedSkillId === skill.id"
              :installing="installingSkillId === skill.id"
              :deleting="deletingSkillId === skill.id"
              @open="openSkill"
              @install="installSkill"
              @delete="deleteSkill"
              @edit-alias="aliasEditingSkill = $event"
            />
          </div>
        </section>
      </div>

      <InstallDialog
        :skill="installDialogSkill"
        :agents="installableAgents"
        :installing="!!installingSkillId"
        @close="installDialogSkill = null"
        @install="batchInstallSkill"
      />

      <CentralBundleDetailDialog
        v-if="bundleDetailPath"
        :detail="activeBundleDetail"
        @close="bundleDetailPath = ''"
        @open-skill="openSkillFromBundle"
      />

      <div v-if="deleteTargetBundle" class="cs-modal-backdrop" @click.self="deleteTargetBundle = null">
        <div class="cs-delete-dialog" role="dialog" aria-modal="true" aria-label="删除 Central bundle">
          <header>
            <div>
              <h3>删除 Central bundle「{{ deleteTargetBundle.name }}」？</h3>
              <p>会删除这个 bundle 下的 Skill，并卸载受影响 Platform 的安装记录。</p>
            </div>
            <button type="button" title="关闭" @click="deleteTargetBundle = null">
              <span class="mso">close</span>
            </button>
          </header>
          <div class="delete-warning">
            <span class="mso">warning</span>
            <span>{{ centralBundleDeletePreview?.bundle.skillCount || deleteTargetBundle.skillCount }} 个 Skill 将被删除。</span>
          </div>
          <div v-if="centralBundleDeletePreview" class="delete-preview">
            <strong>Skill</strong>
            <div class="preview-chips">
              <span v-for="skill in centralBundleDeletePreview.skills" :key="skill.id">{{ skill.name }}</span>
            </div>
            <template v-if="affectedAgentNames.length">
              <strong>受影响 Platform</strong>
              <p>{{ affectedAgentNames.join('、') }}</p>
            </template>
          </div>
          <footer>
            <button type="button" @click="deleteTargetBundle = null">取消</button>
            <button type="button" class="danger" :disabled="deletingBundlePath === deleteTargetBundle.relativePath" @click="deleteBundle">
              <span class="mso" :class="{ spin: deletingBundlePath === deleteTargetBundle.relativePath }">
                {{ deletingBundlePath === deleteTargetBundle.relativePath ? 'progress_activity' : 'delete' }}
              </span>
              删除 bundle
            </button>
          </footer>
        </div>
      </div>

      <div v-if="aliasEditingSkill" class="cs-modal-backdrop" @click.self="aliasEditingSkill = null">
        <div class="cs-alias-dialog" role="dialog" aria-modal="true" aria-label="编辑显示别名">
          <header>
            <div>
              <h3>编辑显示别名</h3>
              <p>显示别名只影响韭菜盒子界面，不修改官方 Skill name。</p>
            </div>
            <button type="button" title="关闭" @click="aliasEditingSkill = null">
              <span class="mso">close</span>
            </button>
          </header>
          <SkillAliasEditor :skill="aliasEditingSkill" @saved="aliasEditingSkill = null" />
        </div>
      </div>
    </template>

    <PlatformPanel v-else-if="activeTab === 'platforms'" />
    <DiscoverPanel v-else-if="activeTab === 'discover'" />
    <MarketplacePanel v-else-if="activeTab === 'marketplace'" />
    <CollectionsPanel v-else-if="activeTab === 'collections'" />
    <SkillsSettingsPanel v-else-if="activeTab === 'settings'" />
  </section>
</template>

<style scoped>
.cs-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink1);
  overflow: hidden;
}
.cs-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.cs-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cs-title > .mso {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-size: 19px;
}
.cs-title h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
  font-weight: 950;
  letter-spacing: 0;
}
.cs-title p {
  margin: 3px 0 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  font-size: 11px;
}
.cs-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.cs-text-btn {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.cs-text-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cs-text-btn .mso { font-size: 15px; }
.cs-icon-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
}
.cs-icon-btn:hover:not(:disabled) {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cs-icon-btn:disabled { opacity: .55; cursor: default; }
.cs-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--border2);
  overflow-x: auto;
}
.cs-tabs button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
  cursor: pointer;
}
.cs-tabs button.active {
  background: var(--paper);
  border-color: var(--border);
  color: var(--olive-dark);
}
.cs-tabs .mso { font-size: 15px; }
.cs-toolbar {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 98px 78px auto;
  gap: 8px;
  padding: 10px;
}
.cs-search {
  min-width: 0;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
.cs-search .mso {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--ink3);
}
.cs-search input {
  min-width: 0;
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink1);
  font: inherit;
  font-size: 12px;
}
.cs-select {
  min-width: 0;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 800;
  padding: 0 8px;
}
.cs-selected,
.cs-error,
.cs-meta {
  flex: 0 0 auto;
  margin: 0 10px 8px;
}
.cs-selected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--olive) 14%, transparent);
}
.cs-selected .mso {
  color: var(--olive-dark);
  font-size: 17px;
}
.cs-selected div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cs-selected strong,
.cs-selected span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-selected strong { font-size: 12px; }
.cs-selected span { color: var(--ink3); font-size: 11px; }
.cs-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--jc-error) 12%, transparent);
  color: var(--jc-error);
  font-size: 12px;
  line-height: 1.35;
}
.cs-error .mso { font-size: 16px; }
.cs-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--ink3);
  font-size: 11px;
}
.cs-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 14px;
}
.cs-section {
  display: grid;
  gap: 10px;
}
.cs-section + .cs-section {
  margin-top: 14px;
}
.cs-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink2);
}
.cs-section-title .mso {
  color: var(--olive-dark);
  font-size: 17px;
}
.cs-section-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 950;
}
.cs-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  align-content: start;
  gap: 10px;
}
.cs-detail-host {
  flex: 1 1 auto;
  min-height: 0;
}
.cs-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--ink1) 18%, transparent);
}
.cs-alias-dialog {
  width: min(420px, 100%);
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--jc-shadow-lg);
}
.cs-alias-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.cs-alias-dialog h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 950;
}
.cs-alias-dialog p {
  margin: 4px 0 0;
  color: var(--ink3);
  font-size: 12px;
  line-height: 1.45;
}
.cs-alias-dialog header button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.cs-alias-dialog header button:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cs-delete-dialog {
  width: min(520px, 100%);
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--jc-shadow-lg);
}
.cs-delete-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.cs-delete-dialog h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 950;
}
.cs-delete-dialog p {
  margin: 4px 0 0;
  color: var(--ink3);
  font-size: 12px;
  line-height: 1.45;
}
.cs-delete-dialog header button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.delete-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--jc-error) 10%, transparent);
  color: var(--jc-error);
  font-size: 12px;
  font-weight: 900;
}
.delete-preview {
  display: grid;
  gap: 7px;
  color: var(--ink2);
  font-size: 12px;
}
.preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.preview-chips span {
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-alt) 86%, transparent);
  color: var(--ink3);
  font-size: 11px;
  font-weight: 850;
}
.cs-delete-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cs-delete-dialog footer button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-weight: 900;
  cursor: pointer;
}
.cs-delete-dialog footer button.danger {
  border-color: color-mix(in srgb, var(--jc-error) 42%, var(--border));
  background: color-mix(in srgb, var(--jc-error) 10%, var(--paper));
  color: var(--jc-error);
}
.cs-delete-dialog footer button:disabled {
  opacity: .55;
  cursor: default;
}
.cs-state {
  flex: 1 1 auto;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--ink3);
  text-align: center;
  font-size: 13px;
}
.cs-state .mso {
  font-size: 28px;
  color: var(--olive-dark);
}
.spin { animation: cs-spin 1s linear infinite; }
@keyframes cs-spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .cs-head {
    align-items: flex-start;
  }
  .cs-head-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .cs-toolbar {
    grid-template-columns: minmax(0, 1fr) 1fr 1fr;
  }
  .cs-toolbar .mode-toggle {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>

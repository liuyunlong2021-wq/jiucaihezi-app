<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CentralBundleDetailDialog from '@/components/skills/CentralBundleDetailDialog.vue'
import GitHubRepoImportWizard from '@/components/skills/GitHubRepoImportWizard.vue'
import InstallDialog from '@/components/skills/InstallDialog.vue'
import SkillDetailPanel from '@/components/skills/SkillDetailPanel.vue'
import SkillPreviewDialog from '@/components/skills/SkillPreviewDialog.vue'
import SkillsSettingsPanel from '@/components/skills/SkillsSettingsPanel.vue'
import SkillAliasEditor from '@/components/skills/shared/SkillAliasEditor.vue'
import SkillCard from '@/components/skills/shared/SkillCard.vue'
import GitHubSkillCard from '@/components/skills/GitHubSkillCard.vue'
import type { GitHubSkillEntry } from '@/components/skills/GitHubSkillCard.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { CentralSkillBundle, GitHubSkillPreview, SkillsManageTab, SkillWithLinks } from '@/types/skillsManage'
import { confirmAction } from '@/utils/confirmAction'
import {
  splitCentralSkillsByTopLevel,
  sortCentralSkills,
  type CentralSkillSortDirection,
  type CentralSkillSortField,
} from '@/utils/centralSkillViewModel'
import githubSkillsData from '@/data/githubSkills.json'

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
  githubSkillMarkdown,
  installableAgents,
  installingSkillId,
  isLoadingCentral,
  isLoadingDetail,
  isLoadingSkillExplanation,
  isScanning,
  lastScan,
  selectedSkillDetail,
  selectedSkillId,
  skillExplanations,
} = storeToRefs(store)

const query = ref('')
const sortField = ref<CentralSkillSortField>('name')
const sortDirection = ref<CentralSkillSortDirection>('asc')
const viewMode = ref<'mine' | 'other' | 'github'>('mine')
const showDetail = ref(false)
const aliasEditingSkill = ref<SkillWithLinks | null>(null)
const installDialogSkill = ref<SkillWithLinks | null>(null)
const bundleDetailPath = ref('')
const deleteTargetBundle = ref<CentralSkillBundle | null>(null)
const showGitHubWizard = ref(false)
const gitHubWizardUrl = ref('')
const previewDialog = ref<{ title: string; sourceLabel?: string; sourcePath: string; downloadUrl: string } | null>(null)
const previewSummaryStatus = ref('')
const previewSummaryError = ref('')

const folderSplit = computed(() =>
  splitCentralSkillsByTopLevel({
    skills: centralSkills.value,
    rootPath: centralRoot.value,
  })
)

const folderGroupsByPath = computed(() =>
  new Map(folderSplit.value.groups.map((group) => [group.relativePath, group]))
)

const baseVisibleSkills = computed(() => {
  if (viewMode.value === 'github') return []
  if (viewMode.value === 'mine') return store.mineSkills
  return store.otherSkills
})

const visibleSkills = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  const list = normalized
    ? baseVisibleSkills.value.filter((skill) => store.skillMatchesSearch(skill, normalized))
    : baseVisibleSkills.value

  return sortCentralSkills(list, sortField.value, sortDirection.value)
})

const visibleBundles = computed(() => [])

const centralRootDisplay = computed(() =>
  centralRoot.value.replace(/^\/Users\/[^/]+/, '~')
)

// GitHub 推荐 Skill 数据
const githubSkills = computed<GitHubSkillEntry[]>(() => {
  const skills = (githubSkillsData as { skills: GitHubSkillEntry[] }).skills || []
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return skills
  return skills.filter(s => {
    const text = [s.name, s.description, s.repo, ...s.tags].join(' ').toLowerCase()
    return text.includes(normalized)
  })
})

const activeBundleDetail = computed(() =>
  bundleDetailPath.value ? centralBundleDetails.value[bundleDetailPath.value] || null : null
)

const affectedAgentNames = computed(() => {
  const namesById = new Map(agents.value.map((agent) => [agent.id, agent.display_name]))
  return (centralBundleDeletePreview.value?.affectedAgents || []).map((agentId) => namesById.get(agentId) || agentId)
})

const previewState = computed(() =>
  previewDialog.value ? githubSkillMarkdown.value[previewDialog.value.sourcePath] : null
)

const previewContent = computed(() => previewState.value?.content || '')

const previewSummaryKey = computed(() =>
  previewDialog.value ? `github-import:${previewDialog.value.sourcePath}:zh` : ''
)

const previewSummary = computed(() =>
  previewSummaryKey.value ? skillExplanations.value[previewSummaryKey.value] || '' : ''
)

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
      ? `删除 ${skill.name} 会同时影响 ${linkedCount} 个工具安装记录。继续？`
      : `删除 Skill 仓库中的 Skill「${skill.name}」？`,
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

function openGitHubWizard(repoUrl = '') {
  gitHubWizardUrl.value = repoUrl
  showGitHubWizard.value = true
}

async function previewGitHubSkill(skill: GitHubSkillPreview) {
  previewSummaryStatus.value = ''
  previewSummaryError.value = ''
  previewDialog.value = {
    title: skill.skillName,
    sourceLabel: skill.sourcePath,
    sourcePath: skill.sourcePath,
    downloadUrl: skill.downloadUrl,
  }
  await store.fetchGitHubSkillMarkdown(skill.sourcePath, skill.downloadUrl).catch(() => undefined)
}

async function generatePreviewAiSummary() {
  if (!previewDialog.value) return
  previewSummaryError.value = ''
  previewSummaryStatus.value = ''
  try {
    let content = previewContent.value
    if (!content) {
      content = await store.fetchGitHubSkillMarkdown(
        previewDialog.value.sourcePath,
        previewDialog.value.downloadUrl
      )
    }
    if (!content.trim()) throw new Error('当前 SKILL.md 内容为空，无法生成 AI Summary')
    await store.generateGitHubImportAiSummary(
      previewDialog.value.sourcePath,
      previewDialog.value.title,
      content,
      'zh'
    )
    await store.getSkillExplanation(`github-import:${previewDialog.value.sourcePath}`, 'zh')
    previewSummaryStatus.value = 'AI Summary 已生成。'
  } catch (error) {
    previewSummaryError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  if (activeTab.value !== 'central' && activeTab.value !== 'settings') {
    store.setActiveTab('central')
  }
  setTimeout(() => { void refresh() }, 100)
})
</script>

<template>
  <section class="cs-panel">
    <header class="cs-head">
      <div class="cs-title">
        <div>
          <h2>Skill 仓库</h2>
        </div>
      </div>
      <div class="cs-head-actions">
        <button class="cs-text-btn" type="button" title="GitHub 导入" @click="openGitHubWizard()">
          <JcIcon name="download" />
          GitHub 导入
        </button>
        <button class="cs-icon-btn" type="button" title="刷新 Skill 仓库" :disabled="isLoadingCentral || isScanning" @click="refresh">
          <JcIcon name="refresh" :class="{ spin: isLoadingCentral || isScanning }" />
        </button>
      </div>
    </header>

    <SkillDetailPanel v-if="showDetail" class="cs-detail-host" @back="showDetail = false" />

    <template v-else-if="activeTab === 'central'">
      <div class="cs-toolbar">
        <label class="cs-search">
          <JcIcon name="search" />
          <input v-model="query" type="search" placeholder="搜索显示别名、Skill name、描述或路径" />
        </label>
      </div>

      <div class="cs-tabs">
        <button :class="{ active: viewMode === 'mine' }" @click="viewMode = 'mine'">
          我的Skill
          <span class="cs-tab-count">{{ store.mineSkills.length }}</span>
        </button>
        <button :class="{ active: viewMode === 'other' }" @click="viewMode = 'other'">
          其他Skill
          <span class="cs-tab-count">{{ store.otherSkills.length }}</span>
        </button>
        <button :class="{ active: viewMode === 'github' }" @click="viewMode = 'github'">
          GitHub推荐
          <span class="cs-tab-count">{{ githubSkills.length }}</span>
        </button>
      </div>

      <div v-if="error" class="cs-error">
        <JcIcon name="error" />
        <span>{{ error }}</span>
      </div>

      <div class="cs-meta">
        <template v-if="viewMode === 'github'">
          <span>{{ githubSkills.length }} 个推荐 Skill</span>
        </template>
        <template v-else>
          <span>{{ visibleSkills.length }} 个 Skill</span>
          <span v-if="lastScan">扫描 {{ lastScan.agents_scanned }} 个工具，命中 {{ lastScan.total_skills }} 条记录</span>
        </template>
      </div>

      <div v-if="isLoadingCentral && centralSkills.length === 0" class="cs-state">
        <JcIcon name="progress_activity" class="spin" />
        <span>正在扫描 ~/.agents/skills/ ...</span>
      </div>

      <div v-else-if="viewMode !== 'github' && visibleSkills.length === 0 && visibleBundles.length === 0" class="cs-state">
        <JcIcon name="inventory_2" />
        <span>{{ query ? '没有匹配的 Skill' : 'Skill 仓库暂无 Skill。请在 ~/.agents/skills/ 下添加 SKILL.md。' }}</span>
      </div>

      <div v-else class="cs-content">
        <section v-if="viewMode === 'github'" class="cs-section">
          <div class="cs-section-title">
            <JcIcon name="star" />
            <h3>GitHub 推荐 Skill</h3>
            <span class="cs-section-count">{{ githubSkills.length }} 个</span>
          </div>
          <p class="cs-section-hint">精选 GitHub 上的优质 Skill，点击安装后自动出现在「全部」列表中。</p>
          <div v-if="githubSkills.length === 0" class="cs-state">
            <JcIcon name="search" />
            <span>没有匹配的推荐 Skill</span>
          </div>
          <div v-else class="cs-grid">
            <GitHubSkillCard
              v-for="skill in githubSkills"
              :key="skill.id"
              :skill="skill"
            />
          </div>
        </section>

        <section v-if="visibleSkills.length" class="cs-section">
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
              @toggle-mine="() => {}"
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
        <div class="cs-delete-dialog" role="dialog" aria-modal="true" aria-label="删除 Skill 文件夹">
          <header>
            <div>
              <h3>删除 Skill 文件夹「{{ deleteTargetBundle.name }}」？</h3>
              <p>会删除这个文件夹下的 Skill，并卸载受影响工具里的安装记录。</p>
            </div>
            <button type="button" title="关闭" @click="deleteTargetBundle = null">
              <JcIcon name="close" />
            </button>
          </header>
          <div class="delete-warning">
            <JcIcon name="warning" />
            <span>{{ centralBundleDeletePreview?.bundle.skillCount || deleteTargetBundle.skillCount }} 个 Skill 将被删除。</span>
          </div>
          <div v-if="centralBundleDeletePreview" class="delete-preview">
            <strong>Skill</strong>
            <div class="preview-chips">
              <span v-for="skill in centralBundleDeletePreview.skills" :key="skill.id">{{ skill.name }}</span>
            </div>
            <template v-if="affectedAgentNames.length">
              <strong>受影响工具</strong>
              <p>{{ affectedAgentNames.join('、') }}</p>
            </template>
          </div>
          <footer>
            <button type="button" @click="deleteTargetBundle = null">取消</button>
            <button type="button" class="danger" :disabled="deletingBundlePath === deleteTargetBundle.relativePath" @click="deleteBundle">
              <JcIcon :name="deletingBundlePath === deleteTargetBundle.relativePath ? 'progress_activity' : 'delete'" :class="{ spin: deletingBundlePath === deleteTargetBundle.relativePath }" />
              删除文件夹
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
              <JcIcon name="close" />
            </button>
          </header>
          <SkillAliasEditor :skill="aliasEditingSkill" @saved="aliasEditingSkill = null" />
        </div>
      </div>
    </template>

    <SkillsSettingsPanel v-else-if="activeTab === 'settings'" />

    <GitHubRepoImportWizard
      v-if="showGitHubWizard"
      :initial-repo-url="gitHubWizardUrl"
      @close="showGitHubWizard = false"
      @preview-markdown="previewGitHubSkill"
    />
    <SkillPreviewDialog
      v-if="previewDialog"
      :title="previewDialog.title"
      :source-label="previewDialog.sourceLabel"
      :content="previewContent"
      :loading="previewState?.status === 'loading'"
      :ai-summary="previewSummary"
      :ai-summary-loading="isLoadingSkillExplanation"
      :ai-summary-status="previewSummaryStatus"
      :ai-summary-error="previewSummaryError"
      can-generate-ai-summary
      @close="previewDialog = null"
      @generate-ai-summary="generatePreviewAiSummary"
    />
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
.cs-toolbar {
  flex: 0 0 auto;
  padding: 10px 10px 0;
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

.cs-tabs {
  display: flex;
  gap: 6px;
  padding: 4px 10px 0;
}
.cs-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
}
.cs-tabs button:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
}
.cs-tabs button.active {
  border-color: var(--olive);
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-weight: 600;
}
.cs-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--ink5);
  color: var(--ink2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.cs-tabs button.active .cs-tab-count {
  background: var(--olive);
  color: #fff;
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
.cs-section-count {
  font-size: 11px;
  color: var(--ink3);
  margin-left: auto;
}
.cs-section-hint {
  margin: 6px 0 12px;
  font-size: 12px;
  color: var(--ink3);
  line-height: 1.5;
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

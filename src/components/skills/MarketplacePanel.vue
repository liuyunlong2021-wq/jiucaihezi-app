<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import GitHubRepoImportWizard from '@/components/skills/GitHubRepoImportWizard.vue'
import MarketplaceSkillDetailDrawer from '@/components/skills/MarketplaceSkillDetailDrawer.vue'
import SkillPreviewDialog from '@/components/skills/SkillPreviewDialog.vue'
import {
  ALL_TAGS,
  OFFICIAL_PUBLISHERS,
  RECOMMENDED_SKILLS,
  TAG_LABELS,
  type OfficialRepo,
  type RecommendedSkill,
  type SkillTag,
} from '@/data/officialSources'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { GitHubSkillPreview, MarketplaceSkill } from '@/types/skillsManage'
import {
  filterOfficialPublishers,
  filterRecommendedSkills,
  findDuplicateRegistries,
} from '@/utils/marketplaceViewModel'

type MarketplaceTab = 'recommended' | 'official' | 'registry'

const store = useSkillsManageStore()
const {
  error,
  githubSkillMarkdown,
  installingMarketplaceSkillId,
  isLoadingMarketplace,
  isLoadingSkillExplanation,
  marketplaceSkills,
  registries,
  skillExplanations,
  syncingRegistryId,
} = storeToRefs(store)

const activeTab = ref<MarketplaceTab>('recommended')
const recommendedQuery = ref('')
const publisherQuery = ref('')
const registryQuery = ref('')
const selectedTag = ref<SkillTag | null>(null)
const selectedRegistryId = ref<string | null>(null)
const showGitHubWizard = ref(false)
const gitHubWizardUrl = ref('')
const previewDialog = ref<{ title: string; sourceLabel?: string; sourcePath: string; downloadUrl: string } | null>(null)
const previewSummaryStatus = ref('')
const previewSummaryError = ref('')
const marketplaceDrawerSkill = ref<MarketplaceSkill | null>(null)

const filteredRecommendedSkills = computed(() =>
  filterRecommendedSkills(RECOMMENDED_SKILLS, {
    query: recommendedQuery.value,
    tag: selectedTag.value,
  })
)

const filteredPublishers = computed(() =>
  filterOfficialPublishers(OFFICIAL_PUBLISHERS, publisherQuery.value)
)

const selectedRegistry = computed(() =>
  registries.value.find((registry) => registry.id === selectedRegistryId.value) || null
)

const duplicateRegistryGroups = computed(() => findDuplicateRegistries(registries.value))

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

async function load() {
  try {
    await store.loadRegistries()
    if (!selectedRegistryId.value && registries.value.length > 0) selectedRegistryId.value = registries.value[0].id
  } catch {
    // Store error is rendered in the panel.
  }
}

async function searchRegistry() {
  try {
    await store.searchMarketplaceSkills(registryQuery.value, selectedRegistryId.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function syncRegistry(registryId: string, forceRefresh = false) {
  try {
    await store.syncRegistryWithOptions(registryId, { forceRefresh })
  } catch {
    // Store error is rendered in the panel.
  }
}

async function installMarketplaceSkill(skillId: string) {
  try {
    await store.installMarketplaceSkill(skillId)
  } catch {
    // Store error is rendered in the panel.
  }
}

function openGitHubWizard(repoUrl = '') {
  gitHubWizardUrl.value = repoUrl
  showGitHubWizard.value = true
}

function repoUrlFromFullName(fullName: string) {
  return `https://github.com/${fullName}`
}

async function previewRecommended(skill: RecommendedSkill) {
  previewSummaryStatus.value = ''
  previewSummaryError.value = ''
  previewDialog.value = {
    title: skill.name,
    sourceLabel: `${skill.publisher} · ${skill.repoFullName}`,
    sourcePath: `recommended:${skill.name}`,
    downloadUrl: skill.downloadUrl,
  }
  await store.fetchGitHubSkillMarkdown(`recommended:${skill.name}`, skill.downloadUrl).catch(() => undefined)
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

async function previewMarketplaceSkill(skill: MarketplaceSkill) {
  previewSummaryStatus.value = ''
  previewSummaryError.value = ''
  previewDialog.value = {
    title: skill.name,
    sourceLabel: skill.registry_id,
    sourcePath: `marketplace:${skill.id}`,
    downloadUrl: skill.download_url,
  }
  await store.fetchGitHubSkillMarkdown(`marketplace:${skill.id}`, skill.download_url).catch(() => undefined)
}

function openRepo(repo: OfficialRepo) {
  openGitHubWizard(repo.url)
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

watch(selectedRegistryId, () => {
  void searchRegistry()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="mp">
    <header class="mp-head">
      <div>
        <h3>Marketplace</h3>
        <p>从官方或社区来源查找并安装 Skill。</p>
      </div>
      <div class="head-actions">
        <button class="btn" @click="openGitHubWizard()"><JcIcon name="upload_file" />GitHub 导入</button>
        <button class="btn" :disabled="isLoadingMarketplace" @click="load"><JcIcon name="refresh" :class="{ spin: isLoadingMarketplace }" />刷新</button>
      </div>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <nav class="tabs" aria-label="Marketplace 视图">
      <button :class="{ active: activeTab === 'recommended' }" @click="activeTab = 'recommended'">推荐</button>
      <button :class="{ active: activeTab === 'official' }" @click="activeTab = 'official'">官方来源</button>
      <button :class="{ active: activeTab === 'registry' }" @click="activeTab = 'registry'">Registry</button>
    </nav>

    <main v-if="activeTab === 'recommended'" class="panel">
      <div class="panel-toolbar">
        <input v-model="recommendedQuery" type="search" placeholder="搜索推荐 Skill" />
        <div class="tag-row">
          <button
            v-for="tag in ALL_TAGS"
            :key="tag"
            :class="{ active: selectedTag === tag }"
            @click="selectedTag = selectedTag === tag ? null : tag"
          >
            {{ TAG_LABELS[tag].zh }}
          </button>
        </div>
      </div>
      <div v-if="filteredRecommendedSkills.length === 0" class="state">没有匹配的推荐 Skill</div>
      <section v-else class="card-grid">
        <article v-for="skill in filteredRecommendedSkills" :key="skill.name" class="market-card">
          <div>
            <strong>{{ skill.name }}</strong>
            <p>{{ skill.description }}</p>
            <span>{{ skill.publisher }} · {{ skill.repoFullName }}</span>
            <div class="chips">
              <small v-for="tag in skill.tags" :key="tag">{{ TAG_LABELS[tag].zh }}</small>
            </div>
          </div>
          <div class="card-actions">
            <button class="mini" title="预览 Markdown" @click="previewRecommended(skill)"><JcIcon name="article" /></button>
            <button class="btn primary" @click="openGitHubWizard(repoUrlFromFullName(skill.repoFullName))"><JcIcon name="download" />导入</button>
          </div>
        </article>
      </section>
    </main>

    <main v-else-if="activeTab === 'official'" class="panel">
      <div class="panel-toolbar">
        <input v-model="publisherQuery" type="search" placeholder="搜索 Publisher 或 repo" />
        <span class="hint">{{ OFFICIAL_PUBLISHERS.length }} 个官方发布者</span>
      </div>
      <div v-if="filteredPublishers.length === 0" class="state">没有匹配的官方来源</div>
      <section v-else class="publisher-list">
        <article v-for="publisher in filteredPublishers" :key="publisher.slug" class="publisher-card">
          <header>
            <div>
              <strong>{{ publisher.name }}</strong>
              <p>{{ publisher.totalSkills }} Skills · {{ publisher.repos.length }} repo</p>
            </div>
            <span>{{ publisher.slug }}</span>
          </header>
          <button v-for="repo in publisher.repos" :key="repo.fullName" class="repo-row" @click="openRepo(repo)">
            <span>
              <strong>{{ repo.fullName }}</strong>
              <small>{{ repo.description || repo.url }}</small>
            </span>
            <em>{{ repo.skillCount }}</em>
          </button>
        </article>
      </section>
    </main>

    <main v-else class="registry-panel">
      <aside class="registry-list">
        <article
          v-for="registry in registries"
          :key="registry.id"
          class="registry"
          :class="{ active: selectedRegistryId === registry.id }"
        >
          <button class="registry-main" @click="selectedRegistryId = registry.id">
            <strong>{{ registry.name }}</strong>
            <span>{{ registry.last_sync_status }} · {{ registry.url }}</span>
          </button>
          <button class="mini" :disabled="syncingRegistryId === registry.id" title="同步" @click="syncRegistry(registry.id)">
            <JcIcon name="sync" :class="{ spin: syncingRegistryId === registry.id }" />
          </button>
        </article>
        <div v-if="duplicateRegistryGroups.length" class="duplicate">
          Registry duplicate：{{ duplicateRegistryGroups.map(group => group.map(item => item.name).join(' / ')).join('；') }}
        </div>
      </aside>

      <section class="skills">
        <div class="search">
          <input v-model="registryQuery" type="search" placeholder="搜索 Registry Skill" @keyup.enter="searchRegistry" />
          <button class="btn primary" @click="searchRegistry"><JcIcon name="search" />搜索</button>
          <button class="btn" :disabled="!selectedRegistryId || syncingRegistryId === selectedRegistryId" @click="selectedRegistryId && syncRegistry(selectedRegistryId, true)">
            <JcIcon name="sync" />强制刷新
          </button>
        </div>
        <div v-if="selectedRegistry" class="hint">{{ selectedRegistry.name }} · {{ selectedRegistry.url }}</div>
        <div v-if="isLoadingMarketplace" class="state"><JcIcon name="progress_activity" class="spin" />加载中...</div>
        <div v-else-if="marketplaceSkills.length === 0" class="state">暂无缓存 Skill，先同步 Registry。</div>
        <article v-for="skill in marketplaceSkills" v-else :key="skill.id" class="market-card">
          <button class="skill-main" @click="marketplaceDrawerSkill = skill">
            <strong>{{ skill.name }}</strong>
            <p>{{ skill.description || skill.download_url }}</p>
            <span>{{ skill.is_installed ? '已安装' : '未安装' }}</span>
          </button>
          <div class="card-actions">
            <button class="mini" title="预览 Markdown" @click="previewMarketplaceSkill(skill)"><JcIcon name="article" /></button>
            <button class="btn primary" :disabled="skill.is_installed || installingMarketplaceSkillId === skill.id" @click="installMarketplaceSkill(skill.id)">
              <JcIcon :name="installingMarketplaceSkillId === skill.id ? 'progress_activity' : 'download'" :class="{ spin: installingMarketplaceSkillId === skill.id }" />
              {{ skill.is_installed ? '已安装' : '安装' }}
            </button>
          </div>
        </article>
      </section>
    </main>

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
    <MarketplaceSkillDetailDrawer
      :skill="marketplaceDrawerSkill"
      @close="marketplaceDrawerSkill = null"
      @preview="marketplaceDrawerSkill && previewMarketplaceSkill(marketplaceDrawerSkill)"
      @install="marketplaceDrawerSkill && installMarketplaceSkill(marketplaceDrawerSkill.id)"
    />
  </section>
</template>

<style scoped>
.mp { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.mp-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.head-actions { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }
h3 { margin: 0; font-size: 15px; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
.tabs { display: flex; gap: 5px; border-bottom: 1px solid var(--border); }
.tabs button { min-height: 32px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ink3); padding: 0 10px; font-weight: 850; cursor: pointer; }
.tabs button.active { border-color: var(--olive-dark); color: var(--olive-dark); }
.panel, .registry-panel { flex: 1; min-height: 0; overflow: auto; }
.panel { display: flex; flex-direction: column; gap: 10px; }
.registry-panel { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 10px; }
.panel-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
input { min-width: 0; height: 34px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 9px; }
.tag-row { display: flex; flex-wrap: wrap; gap: 5px; }
.tag-row button { min-height: 28px; border: 1px solid var(--border); border-radius: 999px; background: var(--paper); color: var(--ink3); padding: 0 8px; font-size: 12px; cursor: pointer; }
.tag-row button.active { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.market-card, .publisher-card, .registry { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.market-card { display: flex; justify-content: space-between; gap: 10px; padding: 10px; }
.market-card div, .skill-main { min-width: 0; }
.market-card strong, .publisher-card strong, .registry strong { display: block; font-size: 13px; color: var(--ink1); overflow-wrap: anywhere; }
.market-card span, .hint, .registry span { color: var(--ink3); font-size: 11px; }
.market-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.chips small { padding: 2px 5px; border-radius: 999px; background: var(--olive-pale); color: var(--olive-dark); font-size: 10px; }
.card-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
.btn, .mini { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
.btn { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; font-weight: 850; white-space: nowrap; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.btn:disabled, .mini:disabled { opacity: .55; cursor: default; }
.mini { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; }
.publisher-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
.publisher-card { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.publisher-card header { display: flex; justify-content: space-between; gap: 10px; }
.publisher-card header span { color: var(--ink3); font-size: 11px; }
.repo-row { display: flex; justify-content: space-between; gap: 8px; width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 8px; text-align: left; cursor: pointer; }
.repo-row span { min-width: 0; }
.repo-row small { display: block; margin-top: 3px; color: var(--ink3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo-row em { flex: 0 0 auto; color: var(--olive-dark); font-size: 11px; font-style: normal; font-weight: 850; }
.registry-list, .skills { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.registry { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 30px; gap: 6px; padding: 8px; }
.registry.active { border-color: var(--olive-dark); }
.registry span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; }
.registry-main, .skill-main { padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.duplicate { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 10%, transparent); color: var(--jc-error); font-size: 12px; line-height: 1.45; }
.search { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; }
.state { flex: 1; min-height: 140px; display: grid; place-items: center; color: var(--ink3); text-align: center; }
.error { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 860px) {
  .panel-toolbar, .registry-panel, .search { grid-template-columns: 1fr; }
  .market-card { flex-direction: column; }
  .card-actions { justify-content: flex-end; }
}
</style>

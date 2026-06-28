<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { GitHubSkillImportSelection, GitHubSkillPreview } from '@/types/skillsManage'

const props = defineProps<{
  initialRepoUrl?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'previewMarkdown', skill: GitHubSkillPreview): void
}>()

const store = useSkillsManageStore()
const {
  githubRepoImportResult,
  githubRepoPreview,
  isImportingGitHubRepo,
  isPreviewingGitHubRepo,
} = storeToRefs(store)

const repoUrl = ref(props.initialRepoUrl || '')
const selectedPaths = ref<Set<string>>(new Set())
const localError = ref('')

const hasPreview = computed(() => Boolean(githubRepoPreview.value))

function toggleSkill(skill: GitHubSkillPreview) {
  const next = new Set(selectedPaths.value)
  if (next.has(skill.sourcePath)) next.delete(skill.sourcePath)
  else next.add(skill.sourcePath)
  selectedPaths.value = next
}

function onBackdropMouseDown(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

async function previewRepo() {
  localError.value = ''
  try {
    const preview = await store.previewGitHubRepoImport(repoUrl.value)
    selectedPaths.value = new Set(preview.skills.map((skill) => skill.sourcePath))
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function importSelected() {
  if (!githubRepoPreview.value) return
  localError.value = ''
  // ponytail: resolution 不能写死 'skip'，否则 Rust 端全部跳过，0 个 skill 被导入。
  // 默认用 'overwrite' 覆盖同名 skill；skill 冲突时已有 conflict 字段提示用户。
  const selections: GitHubSkillImportSelection[] = githubRepoPreview.value.skills
    .filter((skill) => selectedPaths.value.has(skill.sourcePath))
    .map((skill) => ({
      sourcePath: skill.sourcePath,
      resolution: skill.conflict ? 'overwrite' : 'overwrite',
    }))
  try {
    await store.importGitHubRepoSkills(repoUrl.value, selections)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <!-- ponytail: WKWebView 中 @click.self 在拖选文字时 mouseup 可能落在 backdrop 上误触发。
       改用 mousedown + target===currentTarget 双重判断，只有真正点击遮罩层才关闭。 -->
  <div class="wizard-backdrop" @mousedown="onBackdropMouseDown">
    <section class="wizard">
      <header>
        <div>
          <h4>GitHub 导入</h4>
          <p>预览 GitHub 仓库里的 Skill，选择后一键导入到本机。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>

      <div class="repo-line">
        <input v-model="repoUrl" type="url" placeholder="https://github.com/owner/repo" @keyup.enter="previewRepo" />
        <button class="btn secondary" type="button" title="填入 JC-skills 官方仓库地址" @click="repoUrl = 'https://github.com/liuyunlong2021-wq/yingshi-skills'">
          JC-skills
        </button>
        <button class="btn primary" :disabled="!repoUrl.trim() || isPreviewingGitHubRepo" @click="previewRepo">
          <JcIcon :name="isPreviewingGitHubRepo ? 'progress_activity' : 'travel_explore'" :class="{ spin: isPreviewingGitHubRepo }" />
          预览
        </button>
      </div>

      <div class="pat-note">
        GitHub PAT 会由后端设置读取；私有仓库或限流时需要先配置 GitHub PAT。
      </div>
      <div v-if="localError" class="inline-error">{{ localError }}</div>

      <main>
        <div v-if="isPreviewingGitHubRepo" class="state"><JcIcon name="progress_activity" class="spin" />正在预览 repo...</div>
        <div v-else-if="!hasPreview" class="state">输入 GitHub repo URL 后先预览。</div>
        <template v-else>
          <div class="repo-summary">
            <strong>{{ githubRepoPreview?.repo.owner }}/{{ githubRepoPreview?.repo.repo }}</strong>
            <span>{{ githubRepoPreview?.skills.length || 0 }} 个 Skill</span>
          </div>
          <article v-for="skill in githubRepoPreview?.skills" :key="skill.sourcePath" class="preview-row">
            <label>
              <input type="checkbox" :checked="selectedPaths.has(skill.sourcePath)" @change="toggleSkill(skill)" />
              <span>
                <strong>{{ skill.skillName }}</strong>
                <small>{{ skill.description || skill.sourcePath }}</small>
                <em v-if="skill.conflict">冲突：{{ skill.conflict.existingSkillId }}</em>
              </span>
            </label>
            <button class="mini" title="预览 Markdown" @click="emit('previewMarkdown', skill)">
              <JcIcon name="article" />
            </button>
          </article>
        </template>
      </main>

      <footer>
        <span v-if="githubRepoImportResult">
          已导入 {{ githubRepoImportResult.importedSkills.length }} 个，跳过 {{ githubRepoImportResult.skippedSkills.length }} 个。
        </span>
        <span v-else>已选择 {{ selectedPaths.size }} 个 Skill。</span>
        <button class="btn primary" :disabled="!selectedPaths.size || isImportingGitHubRepo" @click="importSelected">
          <JcIcon :name="isImportingGitHubRepo ? 'progress_activity' : 'download'" :class="{ spin: isImportingGitHubRepo }" />
          导入
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.wizard-backdrop {
  position: fixed;
  inset: 0;
  z-index: 46;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--ink1) 28%, transparent);
}
.wizard {
  width: min(920px, 96vw);
  height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
header, footer {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--paper);
}
footer { align-items: center; border-top: 1px solid var(--border); border-bottom: 0; color: var(--ink3); font-size: 12px; }
h4 { margin: 0; color: var(--ink1); font-size: 14px; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; }
header button, .mini {
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
.repo-line { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 12px; }
.btn.secondary { background: var(--paper); color: var(--ink2); border-color: var(--border); }
input[type="url"] { min-width: 0; height: 34px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 9px; }
.btn { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.btn:disabled { opacity: .55; cursor: default; }
.pat-note { margin: 0 12px 10px; padding: 8px 10px; border-radius: 8px; background: var(--olive-pale); color: var(--olive-dark); font-size: 12px; }
.inline-error { margin: 0 12px 10px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
main { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
.repo-summary, .preview-row { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.repo-summary { display: flex; justify-content: space-between; gap: 10px; padding: 10px; color: var(--ink2); font-size: 12px; }
.preview-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px; }
label { min-width: 0; display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
label span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
strong { color: var(--ink1); font-size: 13px; overflow-wrap: anywhere; }
small { color: var(--ink3); font-size: 12px; overflow-wrap: anywhere; }
em { color: var(--jc-error); font-size: 11px; font-style: normal; }
.state { flex: 1; min-height: 180px; display: grid; place-items: center; gap: 8px; color: var(--ink3); font-size: 12px; text-align: center; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

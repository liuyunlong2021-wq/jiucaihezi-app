<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CollectionDetailDrawer from '@/components/skills/CollectionDetailDrawer.vue'
import CollectionEditor from '@/components/skills/CollectionEditor.vue'
import CollectionInstallDialog from '@/components/skills/CollectionInstallDialog.vue'
import InstallDialog from '@/components/skills/InstallDialog.vue'
import SkillPickerDialog from '@/components/skills/SkillPickerDialog.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { BatchInstallResult, Collection, CollectionBatchInstallResult, Skill, SkillWithLinks } from '@/types/skillsManage'
import { buildCollectionExportFilename, filterCollectionSkills } from '@/utils/collectionsViewModel'
import { confirmAction } from '@/utils/confirmAction'

const store = useSkillsManageStore()
const {
  centralRoot,
  centralSkills,
  collectionDetails,
  collections,
  error,
  installableAgents,
  isLoadingCollections,
} = storeToRefs(store)

const selectedCollectionId = ref('')
const skillQuery = ref('')
const showEditor = ref(false)
const editorCollection = ref<Collection | null>(null)
const showSkillPicker = ref(false)
const showInstallDialog = ref(false)
const showDetailDrawer = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const isSavingCollection = ref(false)
const isAddingSkills = ref(false)
const isInstallingCollection = ref(false)
const isInstallingSkill = ref(false)
const installResult = ref<CollectionBatchInstallResult | null>(null)
const singleInstallSkill = ref<SkillWithLinks | null>(null)
const singleInstallDialog = ref<InstanceType<typeof InstallDialog> | null>(null)

const selectedCollection = computed(() =>
  collections.value.find((item) => item.id === selectedCollectionId.value) || null
)

const detail = computed(() =>
  selectedCollectionId.value ? collectionDetails.value[selectedCollectionId.value] || null : null
)

const filteredSkills = computed(() =>
  filterCollectionSkills(detail.value?.skills || [], skillQuery.value)
)

const existingSkillIds = computed(() => (detail.value?.skills || []).map(skill => skill.id))

function toSkillWithLinks(skill: Skill): SkillWithLinks {
  const central = centralSkills.value.find(item => item.id === skill.id)
  return central || {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    file_path: skill.file_path,
    canonical_path: skill.canonical_path,
    is_central: skill.is_central,
    source: skill.source,
    scanned_at: skill.scanned_at,
    linked_agents: [],
    read_only_agents: [],
  }
}

async function load() {
  try {
    await Promise.all([
      store.loadCollections(),
      centralSkills.value.length ? Promise.resolve() : store.loadCentralSkills({ scan: false }),
      installableAgents.value.length ? Promise.resolve() : store.loadAgents(),
    ])
    if (!selectedCollectionId.value && collections.value[0]) {
      await selectCollection(collections.value[0].id)
    }
  } catch {
    // Store error is rendered in the panel.
  }
}

async function selectCollection(id: string) {
  selectedCollectionId.value = id
  skillQuery.value = ''
  installResult.value = null
  try {
    await store.loadCollectionDetail(id)
  } catch {
    // Store error is rendered in the panel.
  }
}

function openCreateEditor() {
  editorCollection.value = null
  showEditor.value = true
}

function openEditEditor() {
  if (!selectedCollection.value) return
  editorCollection.value = selectedCollection.value
  showEditor.value = true
}

async function saveCollection(payload: { id?: string; name: string; description: string }) {
  isSavingCollection.value = true
  try {
    const collection = payload.id
      ? await store.updateCollection(payload.id, payload.name, payload.description)
      : await store.createCollection(payload.name, payload.description)
    selectedCollectionId.value = collection.id
    await store.loadCollectionDetail(collection.id)
    showEditor.value = false
  } catch {
    // Store error is rendered in the panel.
  } finally {
    isSavingCollection.value = false
  }
}

async function removeCollection() {
  if (!selectedCollection.value) return
  const ok = await confirmAction(`删除 Collection「${selectedCollection.value.name}」？`, {
    title: '删除 Collection',
    okLabel: '删除',
  })
  if (!ok) return
  try {
    await store.deleteCollection(selectedCollection.value.id)
    selectedCollectionId.value = collections.value[0]?.id || ''
    if (selectedCollectionId.value) await store.loadCollectionDetail(selectedCollectionId.value)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function addSkills(skillIds: string[]) {
  if (!selectedCollectionId.value) return
  isAddingSkills.value = true
  try {
    for (const skillId of skillIds) {
      await store.addSkillToCollection(selectedCollectionId.value, skillId)
    }
    showSkillPicker.value = false
  } catch {
    // Store error is rendered in the panel.
  } finally {
    isAddingSkills.value = false
  }
}

async function removeSkill(skillId: string) {
  if (!selectedCollection.value) return
  try {
    await store.removeSkillFromCollection(selectedCollection.value.id, skillId)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function installCollection(agentIds: string[]) {
  if (!selectedCollectionId.value) return
  isInstallingCollection.value = true
  try {
    installResult.value = await store.batchInstallCollection(selectedCollectionId.value, agentIds)
    if (installResult.value.failed.length === 0) {
      showInstallDialog.value = false
    }
  } catch {
    // Store error is rendered in the panel.
  } finally {
    isInstallingCollection.value = false
  }
}

async function exportSelectedCollection() {
  if (!selectedCollection.value) return
  try {
    const json = await store.exportCollection(selectedCollection.value.id)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = buildCollectionExportFilename(selectedCollection.value.name)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch {
    // Store error is rendered in the panel.
  }
}

async function importCollectionFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const collection = await store.importCollection(await file.text())
    selectedCollectionId.value = collection.id
  } catch {
    // Store error is rendered in the panel.
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

function openInstallDialog() {
  installResult.value = null
  showInstallDialog.value = true
}

function openSingleInstallDialog(skill: Skill) {
  singleInstallSkill.value = toSkillWithLinks(skill)
}

async function installSingleSkill(payload: { skill: SkillWithLinks; agentIds: string[]; method: 'symlink' | 'copy' }) {
  isInstallingSkill.value = true
  try {
    const result = await store.batchInstallSkillToAgents(payload.skill.id, payload.agentIds, payload.method)
    singleInstallDialog.value?.setResult(result)
    if (result.failed.length === 0) {
      singleInstallSkill.value = null
    }
  } catch {
    // Store error is rendered in the panel.
  } finally {
    isInstallingSkill.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="cp">
    <header class="head">
      <div>
        <h3>Collections</h3>
        <p>Collections 是一组 Skill，可以一起管理和批量安装。</p>
      </div>
      <div class="actions">
        <button class="btn" :disabled="isLoadingCollections" @click="load"><JcIcon name="refresh" />刷新</button>
        <button class="btn" @click="fileInput?.click()"><JcIcon name="file_upload" />导入 JSON</button>
        <button class="btn primary" @click="openCreateEditor"><JcIcon name="add" />创建</button>
      </div>
      <input ref="fileInput" class="hidden-file" type="file" accept="application/json,.json" @change="importCollectionFile" />
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="layout">
      <aside class="list">
        <button
          v-for="collection in collections"
          :key="collection.id"
          class="row"
          :class="{ active: selectedCollectionId === collection.id }"
          @click="selectCollection(collection.id)"
        >
          <strong>{{ collection.name }}</strong>
          <span>{{ collection.description || collection.updated_at }}</span>
        </button>
        <div v-if="collections.length === 0" class="state">暂无 Collections</div>
      </aside>

      <main class="detail">
        <div v-if="!selectedCollection" class="state">选择或创建 Collection</div>
        <template v-else>
          <div class="detail-head">
            <div>
              <h4>{{ selectedCollection.name }}</h4>
              <p>{{ selectedCollection.description || '无描述' }}</p>
            </div>
            <div class="detail-actions">
              <button class="icon" title="详情" @click="showDetailDrawer = true"><JcIcon name="info" /></button>
              <button class="icon" title="编辑 Collection" @click="openEditEditor"><JcIcon name="edit" /></button>
              <button class="icon danger" title="删除 Collection" @click="removeCollection"><JcIcon name="delete" /></button>
            </div>
          </div>

          <section class="hint">
            <strong>JSON 导入/导出</strong>
            <p>导出的 JSON 用于迁移 Collection 结构；导入时只会关联本机已存在的 Skill。</p>
          </section>

          <div class="tool-line">
            <label>
              <JcIcon name="search" />
              <input v-model="skillQuery" type="search" placeholder="搜索 Collection 内 Skill" />
            </label>
            <button class="btn" @click="showSkillPicker = true"><JcIcon name="playlist_add" />添加 Skill</button>
            <button class="btn" :disabled="!detail" @click="exportSelectedCollection"><JcIcon name="download" />导出 JSON</button>
            <button class="btn primary" :disabled="!detail || detail.skills.length === 0" @click="openInstallDialog">
              <JcIcon name="install_desktop" />批量安装
            </button>
          </div>

          <div class="skills">
            <article v-for="skill in filteredSkills" :key="skill.id">
              <div>
                <strong>{{ skill.name }}</strong>
                <p>{{ skill.description || skill.file_path }}</p>
              </div>
              <div class="skill-actions">
                <button class="icon" title="单 Skill 安装" @click="openSingleInstallDialog(skill)"><JcIcon name="add_link" /></button>
                <button class="icon" title="移除" @click="removeSkill(skill.id)"><JcIcon name="close" /></button>
              </div>
            </article>
            <div v-if="!detail || detail.skills.length === 0" class="state">Collection 还没有 Skill</div>
            <div v-else-if="filteredSkills.length === 0" class="state">没有匹配的 Skill</div>
          </div>
        </template>
      </main>
    </div>

    <CollectionEditor
      v-if="showEditor"
      :collection="editorCollection"
      :saving="isSavingCollection"
      @close="showEditor = false"
      @save="saveCollection"
    />

    <SkillPickerDialog
      v-if="showSkillPicker"
      :skills="centralSkills"
      :existing-skill-ids="existingSkillIds"
      :adding="isAddingSkills"
      @close="showSkillPicker = false"
      @add="addSkills"
    />

    <CollectionInstallDialog
      v-if="showInstallDialog && selectedCollection && detail"
      :collection-name="selectedCollection.name"
      :skill-count="detail.skills.length"
      :agents="installableAgents"
      :central-root="centralRoot"
      :installing="isInstallingCollection"
      :result="installResult"
      @close="showInstallDialog = false"
      @install="installCollection"
    />

    <CollectionDetailDrawer
      v-if="showDetailDrawer"
      :detail="detail"
      @close="showDetailDrawer = false"
      @edit="showDetailDrawer = false; openEditEditor()"
      @export="exportSelectedCollection"
      @install="showDetailDrawer = false; openInstallDialog()"
    />

    <InstallDialog
      v-if="singleInstallSkill"
      ref="singleInstallDialog"
      :skill="singleInstallSkill"
      :agents="installableAgents"
      :installing="isInstallingSkill"
      @close="singleInstallSkill = null"
      @install="installSingleSkill"
    />
  </section>
</template>

<style scoped>
.cp { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.head, .detail-head { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3, h4 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
h4 { font-size: 14px; }
p { margin: 3px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.actions, .detail-actions, .skill-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.hidden-file { display: none; }
.layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 10px; }
.list, .detail, .skills { min-height: 0; overflow: auto; }
.list { display: flex; flex-direction: column; gap: 7px; }
.row, .skills article, .hint { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.row { text-align: left; padding: 9px; cursor: pointer; }
.row.active { border-color: var(--olive-dark); background: color-mix(in srgb, var(--olive) 8%, var(--paper)); }
.row strong, .skills strong, .hint strong { display: block; color: var(--ink1); font-size: 13px; }
.row span { display: block; color: var(--ink3); font-size: 11px; margin-top: 4px; overflow-wrap: anywhere; }
.detail { display: flex; flex-direction: column; gap: 10px; }
.hint { padding: 9px; }
.tool-line { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tool-line label { min-width: 180px; flex: 1 1 240px; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink3); }
.tool-line input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink1); font-size: 12px; }
.skills { display: flex; flex-direction: column; gap: 8px; }
.skills article { display: flex; justify-content: space-between; gap: 8px; padding: 9px; }
.skills article > div:first-child { min-width: 0; }
.btn, .icon { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
.btn { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; font-weight: 850; }
.btn.primary { background: var(--olive-pale); color: var(--olive-dark); border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); }
.btn:disabled { opacity: .55; cursor: default; }
.icon { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; }
.icon.danger { color: var(--jc-error); border-color: color-mix(in srgb, var(--jc-error) 30%, var(--border)); }
.state { min-height: 90px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--ink3); text-align: center; }
.error { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
@media (max-width: 760px) {
  .head { flex-direction: column; }
  .layout { grid-template-columns: 1fr; }
  .list { max-height: 180px; }
}
</style>

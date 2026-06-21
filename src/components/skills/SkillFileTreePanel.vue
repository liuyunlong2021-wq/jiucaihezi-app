<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { SkillDirectoryNode } from '@/types/skillsManage'

interface TreeRow {
  node: SkillDirectoryNode
  depth: number
}

const store = useSkillsManageStore()
const {
  isLoadingSkillDirectory,
  isLoadingSkillFile,
  selectedSkillDetail,
  selectedSkillDirectory,
  selectedSkillFileContent,
  selectedSkillFilePath,
  skillDirectoryTree,
} = storeToRefs(store)

const localError = ref('')

function flatten(nodes: SkillDirectoryNode[], depth = 0): TreeRow[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.children?.length ? flatten(node.children, depth + 1) : []),
  ])
}

const rows = computed(() => flatten(skillDirectoryTree.value))

const selectedRelativePath = computed(() => {
  const root = selectedSkillDirectory.value
  if (!root || !selectedSkillFilePath.value.startsWith(root)) return selectedSkillFilePath.value
  return selectedSkillFilePath.value.slice(root.length).replace(/^\/+/, '') || selectedSkillFilePath.value
})

async function loadDirectory() {
  if (!selectedSkillDetail.value) return
  localError.value = ''
  try {
    await store.loadSelectedSkillDirectory()
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function openFile(node: SkillDirectoryNode) {
  if (node.is_dir) return
  localError.value = ''
  try {
    await store.readSelectedSkillFileByPath(node.path)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function openInFileManager() {
  localError.value = ''
  try {
    await store.openSelectedSkillInFileManager()
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(loadDirectory)

watch(() => selectedSkillDetail.value?.id, () => {
  loadDirectory()
})
</script>

<template>
  <section class="file-panel">
    <header class="file-toolbar">
      <div>
        <h4>文件</h4>
        <p>{{ selectedSkillDirectory || '当前 Skill 目录不可用' }}</p>
      </div>
      <div class="toolbar-actions">
        <button type="button" title="刷新目录树" :disabled="isLoadingSkillDirectory" @click="loadDirectory">
          <JcIcon name="refresh" :class="{ spin: isLoadingSkillDirectory }" />
        </button>
        <button type="button" title="打开文件管理器" @click="openInFileManager">
          <JcIcon name="folder_open" />
        </button>
      </div>
    </header>

    <div v-if="localError" class="inline-error">{{ localError }}</div>

    <div class="file-layout">
      <aside class="tree">
        <div v-if="isLoadingSkillDirectory" class="state">
          <JcIcon name="progress_activity" class="spin" />
          正在读取目录...
        </div>
        <div v-else-if="!rows.length" class="state">暂无文件</div>
        <template v-else>
          <button
            v-for="row in rows"
            :key="row.node.path"
            type="button"
            class="tree-row"
            :class="{ active: row.node.path === selectedSkillFilePath, dir: row.node.is_dir }"
            :style="{ '--depth': row.depth }"
            :disabled="row.node.is_dir"
            @click="openFile(row.node)"
          >
            <JcIcon :name="row.node.is_dir ? 'folder' : 'description'" />
            <span>{{ row.node.relative_path || row.node.name }}</span>
          </button>
        </template>
      </aside>

      <main class="file-preview">
        <header>
          <JcIcon name="article" />
          <strong>{{ selectedRelativePath || '请选择文件' }}</strong>
        </header>
        <div v-if="isLoadingSkillFile" class="state">
          <JcIcon name="progress_activity" class="spin" />
          正在读取文件...
        </div>
        <pre v-else>{{ selectedSkillFileContent || '请选择左侧文件查看内容' }}</pre>
      </main>
    </div>
  </section>
</template>

<style scoped>
.file-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.file-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h4 { margin: 0; font-size: 13px; color: var(--ink1); }
p { margin: 4px 0 0; font-size: 12px; color: var(--ink3); overflow-wrap: anywhere; }
.toolbar-actions { display: flex; gap: 6px; }
.toolbar-actions button {
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
.toolbar-actions button:disabled { opacity: .55; cursor: not-allowed; }
.inline-error {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 8%, var(--paper));
  color: var(--danger);
  font-size: 12px;
}
.file-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(160px, 30%) minmax(0, 1fr);
  gap: 10px;
}
.tree,
.file-preview {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
.tree { padding: 6px; }
.tree-row {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px 5px calc(7px + var(--depth) * 14px);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.tree-row span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-row:hover:not(:disabled),
.tree-row.active { background: var(--olive-pale); color: var(--olive-dark); }
.tree-row.dir { color: var(--ink3); cursor: default; }
.tree-row:disabled { opacity: .9; }
.file-preview { display: flex; flex-direction: column; }
.file-preview header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--ink2);
  font-size: 12px;
}
.file-preview strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: var(--ink1);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.state {
  min-height: 120px;
  display: grid;
  place-items: center;
  gap: 8px;
  color: var(--ink3);
  font-size: 12px;
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

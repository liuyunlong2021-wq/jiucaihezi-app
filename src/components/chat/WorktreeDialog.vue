<template>
  <div v-if="visible" class="worktree-overlay" @click.self="close">
    <div class="worktree-dialog">
      <div class="worktree-header">
        <h3 class="worktree-title">Git Worktree 沙箱</h3>
        <button class="worktree-close" @click="close">&times;</button>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="worktree-error">{{ error }}</div>

      <!-- 加载中 -->
      <div v-if="isLoading" class="worktree-loading">加载中...</div>

      <div v-else class="worktree-body">
        <!-- 创建新 worktree -->
        <div class="worktree-create">
          <input
            v-model="newName"
            class="worktree-input"
            placeholder="输入 worktree 名称（如 feature-xxx）"
            @keyup.enter="handleCreate"
            :disabled="isCreating"
          />
          <button
            class="worktree-btn worktree-btn-primary"
            @click="handleCreate"
            :disabled="isCreating || !newName.trim()"
          >
            {{ isCreating ? '创建中...' : '创建' }}
          </button>
        </div>

        <!-- Worktree 列表 -->
        <div v-if="worktrees.length" class="worktree-list">
          <div
            v-for="wt in worktrees"
            :key="wt.directory"
            class="worktree-item"
          >
            <div class="worktree-item-info">
              <span class="worktree-item-name">{{ wt.name }}</span>
              <span v-if="wt.branch" class="worktree-item-branch">
                {{ wt.branch.replace('opencode/', '') }}
              </span>
              <span class="worktree-item-path" :title="wt.directory">
                {{ shortenPath(wt.directory) }}
              </span>
            </div>
            <div class="worktree-item-actions">
              <button
                class="worktree-btn worktree-btn-ghost worktree-btn-sm"
                @click="openInFinder(wt.directory)"
                title="在 Finder 中打开"
              >
                📂
              </button>
              <button
                class="worktree-btn worktree-btn-danger worktree-btn-sm"
                @click="handleRemove(wt)"
                title="删除 worktree"
              >
                🗑
              </button>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="worktree-empty">
          暂无 worktree。输入名称创建一个沙箱分支。
        </div>

        <!-- 说明 -->
        <div class="worktree-hint">
          <p><strong>Git Worktree 沙箱</strong>：在独立的 git 分支 + 独立目录中工作，不影响主分支代码。完成后可合并或丢弃。</p>
          <p>创建后分支名格式：<code>opencode/&lt;名称&gt;</code></p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useWorktree } from '@/composables/useWorktree'
import { confirmAction } from '@/utils/confirmAction'
import { isTauriRuntime } from '@/utils/tauriEnv'

const props = defineProps<{
  visible: boolean
  projectPath: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', info: { name: string; directory: string }): void
}>()

const { worktrees, isLoading, error, list, create, remove } = useWorktree()
const newName = ref('')
const isCreating = ref(false)

function close() {
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v && props.projectPath) {
      void list(props.projectPath)
    }
  },
)

onMounted(() => {
  if (props.visible && props.projectPath) {
    void list(props.projectPath)
  }
})

async function handleCreate() {
  const name = newName.value.trim()
  if (!name || !props.projectPath) return

  isCreating.value = true
  try {
    const info = await create(props.projectPath, name)
    if (info) {
      newName.value = ''
      emit('created', { name: info.name, directory: info.directory })
    }
  } finally {
    isCreating.value = false
  }
}

async function handleRemove(wt: { name: string; directory: string }) {
  if (!(await confirmAction(`确定删除 worktree "${wt.name}"？此操作不可撤销。`))) return
  await remove(props.projectPath, wt.directory, true)
}

function openInFinder(directory: string) {
  if (isTauriRuntime()) {
    // 通过 Tauri shell 打开
    void import('@tauri-apps/plugin-shell').then((shell) => {
      shell.open(`file://${directory}`)
    })
  }
}

function shortenPath(path: string): string {
  // 显示 ~/.jiucaihezi/worktree/... 之后的路径
  const match = path.match(/\.jiucaihezi\/worktree\/(.+)$/)
  return match ? `~/worktree/${match[1]}` : path
}
</script>

<style scoped>
.worktree-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.worktree-dialog {
  background: var(--jc-bg-primary, #1a1a2e);
  border: 1px solid var(--jc-border, #2a2a3e);
  border-radius: 12px;
  width: 520px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.worktree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--jc-border, #2a2a3e);
}

.worktree-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--jc-text-primary, #e0e0e0);
}

.worktree-close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--jc-text-secondary, #888);
  cursor: pointer;
  padding: 0 4px;
}

.worktree-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.worktree-create {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.worktree-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--jc-border, #2a2a3e);
  border-radius: 6px;
  background: var(--jc-bg-secondary, #12122a);
  color: var(--jc-text-primary, #e0e0e0);
  font-size: 14px;
  outline: none;
}

.worktree-input:focus {
  border-color: var(--jc-accent, #6c63ff);
}

.worktree-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.worktree-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.worktree-btn-primary {
  background: var(--jc-accent, #6c63ff);
  color: #fff;
}

.worktree-btn-danger {
  background: #e04040;
  color: #fff;
}

.worktree-btn-ghost {
  background: transparent;
  color: var(--jc-text-secondary, #888);
}

.worktree-btn-sm {
  padding: 4px 8px;
  font-size: 14px;
}

.worktree-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.worktree-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--jc-border, #2a2a3e);
  border-radius: 8px;
  background: var(--jc-bg-secondary, #12122a);
}

.worktree-item-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.worktree-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--jc-text-primary, #e0e0e0);
}

.worktree-item-branch {
  font-size: 11px;
  color: var(--jc-accent, #6c63ff);
  background: var(--jc-bg-tertiary, #1e1e3a);
  padding: 2px 6px;
  border-radius: 4px;
}

.worktree-item-path {
  font-size: 11px;
  color: var(--jc-text-secondary, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worktree-item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.worktree-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--jc-text-secondary, #888);
  font-size: 14px;
}

.worktree-hint {
  margin-top: 20px;
  padding: 12px;
  border: 1px solid var(--jc-border, #2a2a3e);
  border-radius: 8px;
  background: var(--jc-bg-secondary, #12122a);
  font-size: 12px;
  color: var(--jc-text-secondary, #888);
  line-height: 1.6;
}

.worktree-hint p {
  margin: 4px 0;
}

.worktree-hint code {
  background: var(--jc-bg-tertiary, #1e1e3a);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.worktree-error {
  padding: 10px 16px;
  margin: 12px 20px 0;
  background: rgba(224, 64, 64, 0.1);
  border: 1px solid rgba(224, 64, 64, 0.3);
  border-radius: 8px;
  color: #e04040;
  font-size: 13px;
}

.worktree-loading {
  text-align: center;
  padding: 24px;
  color: var(--jc-text-secondary, #888);
}
</style>

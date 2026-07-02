/**
 * composables/useWorktree.ts — Git Worktree 操作
 *
 * 封装 Tauri IPC 调用: create / list / remove
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { ref } from 'vue'

export interface WorktreeInfo {
  name: string
  branch?: string
  directory: string
}

export function useWorktree() {
  const worktrees = ref<WorktreeInfo[]>([])
  const isLoading = ref(false)
  const error = ref('')

  async function list(projectPath: string): Promise<WorktreeInfo[]> {
    if (!isTauriRuntime()) {
      error.value = 'Worktree 仅支持桌面版'
      return []
    }
    isLoading.value = true
    error.value = ''
    try {
      const result = await invoke<WorktreeInfo[]>('worktree_list', {
        input: { projectPath },
      })
      worktrees.value = result
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return []
    } finally {
      isLoading.value = false
    }
  }

  async function create(projectPath: string, name: string): Promise<WorktreeInfo | null> {
    if (!isTauriRuntime()) {
      error.value = 'Worktree 仅支持桌面版'
      return null
    }
    isLoading.value = true
    error.value = ''
    try {
      const result = await invoke<WorktreeInfo>('worktree_create', {
        input: { projectPath, name },
      })
      await list(projectPath)
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function remove(projectPath: string, directory: string, deleteBranch = true): Promise<boolean> {
    if (!isTauriRuntime()) {
      error.value = 'Worktree 仅支持桌面版'
      return false
    }
    isLoading.value = true
    error.value = ''
    try {
      await invoke<boolean>('worktree_remove', {
        input: { projectPath, directory, deleteBranch },
      })
      await list(projectPath)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      isLoading.value = false
    }
  }

  return { worktrees, isLoading, error, list, create, remove }
}

import { invoke } from '@tauri-apps/api/core'
import {
  listHarnessConversationCatalog,
  mergeHarnessConversationCatalogEntries,
  type HarnessConversationCatalogEntry,
} from '@/runtime/memory/harnessConversationCatalog'

const recoveredMarker = (owner: string) => `jc:harness-conversations-recovered:v1:${owner}`

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 当某个项目的对话目录为空时，从 Harness 会话缓存恢复。
 *
 * 目录只存在 WebView2 localStorage；清缓存、重置 WebView2 配置或升级异常会丢目录，
 * 但会话正文和 `session_projcache` 元数据仍在。只在目录为空时补，避免复活用户删掉的对话。
 */
export async function recoverHarnessConversationCatalog(owner: string): Promise<number> {
  if (!owner || !isDesktopRuntime()) return 0
  if (localStorage.getItem(recoveredMarker(owner))) return 0
  if (listHarnessConversationCatalog(owner).length > 0) {
    localStorage.setItem(recoveredMarker(owner), '1')
    return 0
  }
  try {
    const recovered = await invoke<HarnessConversationCatalogEntry[]>(
      'recover_harness_conversation_catalog',
      { owner },
    )
    const added = mergeHarnessConversationCatalogEntries(owner, recovered)
    localStorage.setItem(recoveredMarker(owner), '1')
    return added
  } catch {
    // 原生命令不可用或读取失败时不标记，下次打开项目再试。
    return 0
  }
}

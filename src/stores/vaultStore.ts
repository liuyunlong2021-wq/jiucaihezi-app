import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getItem, setItem } from '@/utils/idb'
import { createVaultOnDisk, removeVaultFromDisk, isDesktop } from '@/utils/vaultFs'

export interface Vault {
  id: string
  name: string
  description: string
  type: 'novel' | 'video' | 'project' | 'general'
  createdAt: number
  updatedAt: number
  defaultAgentId?: string
  status: 'active' | 'archived'
  stats?: {
    pageCount: number
    rawCount: number
    lastCompressedAt?: number
  }
  icon?: string
  keywords?: string[]
  oneLineDesc?: string
  template?: string
  callCount?: number
}

const VAULT_KEY = 'jc_vaults_v1'
const ACTIVE_VAULT_KEY = 'jc_active_vault'

function createVaultId() {
  return 'vault_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

function parseVaults(value: unknown): Vault[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed.filter(v => v?.id && v?.name) : []
  } catch {
    return []
  }
}

export const useVaultStore = defineStore('vaults', () => {
  const vaults = ref<Vault[]>([])
  const activeVaultId = ref<string | null>(null)

  const activeVault = computed(() =>
    vaults.value.find(v => v.id === activeVaultId.value) || null
  )

  async function loadAll() {
    const data = await getItem(VAULT_KEY)
    vaults.value = parseVaults(data)
    restoreActiveVault()
  }

  async function save() {
    await setItem(VAULT_KEY, JSON.stringify(vaults.value))
  }

  async function createVault(
    name: string,
    type: Vault['type'] = 'project',
    opts?: {
      description?: string
      oneLineDesc?: string
      keywords?: string[]
      template?: string
      icon?: string
      claudeMd?: string
      rawFolders?: string[]
      wikiFolders?: string[]
    },
  ): Promise<Vault> {
    const now = Date.now()
    const vault: Vault = {
      id: createVaultId(),
      name: name.trim() || '新项目知识库',
      description: opts?.description || '',
      type,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      stats: { pageCount: 0, rawCount: 0 },
      icon: opts?.icon,
      keywords: opts?.keywords,
      oneLineDesc: opts?.oneLineDesc,
      template: opts?.template,
      callCount: 0,
    }
    vaults.value.unshift(vault)
    await save()

    // 桌面端：创建真实目录结构
    if (isDesktop()) {
      createVaultOnDisk(vault.id, {
        claudeMd: opts?.claudeMd,
        rawFolders: opts?.rawFolders || ['对话记录'],
        wikiFolders: opts?.wikiFolders || [],
      }).catch(e => console.warn('[VaultFS] 创建目录失败:', e))
    }

    // 生成三层文件夹骨架（异步，不阻塞返回）
    scaffoldVaultFolders(vault.id, {
      claudeMd: opts?.claudeMd,
      rawFolders: opts?.rawFolders || ['对话记录'],
      wikiFolders: opts?.wikiFolders || [],
    }).catch(() => { /* 骨架生成失败不阻塞主流程 */ })

    return vault
  }

  /** 在 IndexedDB 中为 vault 创建三层文件夹结构 */
  async function scaffoldVaultFolders(
    vaultId: string,
    opts: { claudeMd?: string; rawFolders?: string[]; wikiFolders?: string[] },
  ) {
    // 延迟导入避免循环依赖
    const { useFileStore } = await import('@/composables/useFileStore')
    const fs = useFileStore()

    const rootPrefix = `vf_${vaultId}_`

    // 1. CLAUDE.md
    await fs.addFile({
      category: 'knowledge',
      name: 'CLAUDE.md',
      content: opts.claudeMd || `# 知识库配置\n\n此知识库尚未配置。`,
      mimeType: 'text/markdown',
      size: 0,
      vaultId,
      kind: 'page',
      metadata: { vaultFolder: 'root', isConfig: true },
    })

    // 2. raw/ 根文件夹
    const rawFolder = await fs.addFile({
      category: 'knowledge',
      name: 'raw',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'raw', isFolder: true },
    })

    // raw 子文件夹
    for (const folderName of (opts.rawFolders || [])) {
      await fs.addFile({
        category: 'knowledge',
        name: folderName,
        content: '',
        mimeType: 'folder',
        size: 0,
        vaultId,
        folderId: rawFolder.id,
        metadata: { vaultFolder: 'raw', isFolder: true },
      })
    }

    // 3. wiki/ 根文件夹
    const wikiFolder = await fs.addFile({
      category: 'knowledge',
      name: 'wiki',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'wiki', isFolder: true },
    })

    // wiki 子文件夹（支持 "案件/按罪名" 形式的嵌套路径）
    const folderCache = new Map<string, string>() // path → folderId
    folderCache.set('', wikiFolder.id)

    for (const path of (opts.wikiFolders || [])) {
      const parts = path.split('/')
      let parentId = wikiFolder.id
      let currentPath = ''

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        if (folderCache.has(currentPath)) {
          parentId = folderCache.get(currentPath)!
          continue
        }
        const folder = await fs.addFile({
          category: 'knowledge',
          name: part,
          content: '',
          mimeType: 'folder',
          size: 0,
          vaultId,
          folderId: parentId,
          metadata: { vaultFolder: 'wiki', isFolder: true },
        })
        folderCache.set(currentPath, folder.id)
        parentId = folder.id
      }
    }
  }

  async function updateVault(id: string, patch: Partial<Vault>) {
    const index = vaults.value.findIndex(v => v.id === id)
    if (index === -1) return
    vaults.value[index] = { ...vaults.value[index], ...patch, updatedAt: Date.now() }
    await save()
  }

  async function deleteVault(id: string) {
    vaults.value = vaults.value.filter(v => v.id !== id)
    if (activeVaultId.value === id) setActiveVault(null)
    await save()
    // 桌面端：删除磁盘目录
    if (isDesktop()) {
      removeVaultFromDisk(id).catch(e => console.warn('[VaultFS] 删除目录失败:', e))
    }
  }

  function setActiveVault(id: string | null) {
    activeVaultId.value = id
    localStorage.setItem(ACTIVE_VAULT_KEY, id || '')
  }

  function restoreActiveVault() {
    const saved = localStorage.getItem(ACTIVE_VAULT_KEY) || ''
    activeVaultId.value = saved && vaults.value.some(v => v.id === saved) ? saved : null
  }

  return {
    vaults,
    activeVaultId,
    activeVault,
    loadAll,
    save,
    createVault,
    scaffoldVaultFolders,
    updateVault,
    deleteVault,
    setActiveVault,
    restoreActiveVault,
  }
})

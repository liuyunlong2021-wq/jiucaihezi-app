import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getItem, setItem } from '@/utils/idb'
import { useFileStore } from '@/composables/useFileStore'
import { createVaultOnDisk, removeVaultFromDisk, isDesktop } from '@/utils/vaultFs'
import {
  type VaultEnhancementConfig,
  type VaultFolderSemantic,
} from '@/utils/vaultCompilerCore'
import {
  buildVaultScaffold,
  normalizeVaultPath,
  parentFoldersForWikiFile,
  type VaultSeedPageSpec,
} from '@/utils/vaultScaffold'

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
  enhancement?: VaultEnhancementConfig
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
      seedPages?: VaultSeedPageSpec[]
      enhancement?: VaultEnhancementConfig
    },
  ): Promise<Vault> {
    const now = Date.now()
    const scaffold = buildVaultScaffold({
      name,
      oneLineDesc: opts?.oneLineDesc,
      description: opts?.description,
      keywords: opts?.keywords || [],
      rawFolders: opts?.rawFolders,
      wikiFolders: opts?.wikiFolders,
      templateRulebook: opts?.claudeMd,
      seedPages: opts?.seedPages,
      enhancement: opts?.enhancement,
    })
    const rawFolders = scaffold.rawFolders
    const wikiFolders = scaffold.wikiFolders
    const enhancement = scaffold.enhancement
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
      enhancement,
    }
    vaults.value.unshift(vault)
    await save()

    // 桌面端：创建真实目录结构
    if (isDesktop()) {
      await createVaultOnDisk(vault.id, {
        scaffold,
      }).catch(e => console.warn('[VaultFS] 创建目录失败:', e))
    }

    // 生成三层文件夹骨架（异步，不阻塞返回）
    await scaffoldVaultFolders(vault.id, {
      scaffold,
      enhancement,
    })

    return vault
  }

  /** 在 IndexedDB 中为 vault 创建三层文件夹结构 */
  async function scaffoldVaultFolders(
    vaultId: string,
    opts: {
      claudeMd?: string
      rawFolders?: string[]
      wikiFolders?: string[]
      seedPages?: VaultSeedPageSpec[]
      enhancement?: VaultEnhancementConfig
      scaffold?: ReturnType<typeof buildVaultScaffold>
    },
  ) {
    const fs = useFileStore()

    const scaffold = opts.scaffold || buildVaultScaffold({
      name: '知识库',
      rawFolders: opts.rawFolders,
      wikiFolders: opts.wikiFolders,
      templateRulebook: opts.claudeMd,
      seedPages: opts.seedPages,
      enhancement: opts.enhancement,
    })
    const folderSemantics = scaffold.enhancement?.folderSemantics || opts.enhancement?.folderSemantics || {}
    function semanticFor(path: string): string | VaultFolderSemantic | undefined {
      return folderSemantics[path] || folderSemantics[path.replace(/^wiki\//, '')]
    }

    async function ensureChildFolder(
      parentId: string,
      folderName: string,
      metadata: Record<string, unknown> = {},
    ) {
      const existing = await fs.findChildFolder(parentId, folderName, vaultId)
      if (existing) return existing
      return await fs.addFile({
        category: 'knowledge',
        name: folderName,
        content: '',
        mimeType: 'folder',
        size: 0,
        vaultId,
        folderId: parentId,
        metadata: { isFolder: true, ...metadata },
      })
    }

    async function ensureFolderPath(
      rootId: string,
      path: string,
      rootPath: 'wiki' | '_templates' | '_reports',
      extraMetadata: Record<string, unknown> = {},
    ) {
      const parts = normalizeVaultPath(path).split('/').filter(Boolean)
      let parentId = rootId
      let currentPath: string = rootPath
      for (const part of parts) {
        currentPath = `${currentPath}/${part}`
        const folder = await ensureChildFolder(parentId, part, {
          ...extraMetadata,
          folderPath: currentPath,
          semantic: rootPath === 'wiki' ? semanticFor(currentPath) : undefined,
        })
        parentId = folder.id
      }
      return parentId
    }

    async function addMarkdownFile(
      name: string,
      content: string,
      folderId: string | undefined,
      metadata: Record<string, unknown>,
    ) {
      await fs.addFile({
        category: 'knowledge',
        name,
        content,
        mimeType: 'text/markdown',
        size: new TextEncoder().encode(content).length,
        vaultId,
        folderId,
        kind: 'page',
        indexed: true,
        metadata,
      })
    }

    // 1. CLAUDE.md
    await fs.addFile({
      category: 'knowledge',
      name: 'CLAUDE.md',
      content: scaffold.claudeMd,
      mimeType: 'text/markdown',
      size: new TextEncoder().encode(scaffold.claudeMd).length,
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

    // raw 子文件夹：支持 rawFolders 中的嵌套路径，保持 IndexedDB 与磁盘一致
    for (const folderName of scaffold.rawFolders) {
      const parts = normalizeVaultPath(folderName).split('/').filter(Boolean)
      let parentId = rawFolder.id
      let currentPath = 'raw'
      for (const part of parts) {
        currentPath = `${currentPath}/${part}`
        const folder = await ensureChildFolder(parentId, part, {
          vaultFolder: 'raw',
          isFolder: true,
          folderPath: currentPath,
        })
        parentId = folder.id
      }
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

    const requiredWikiFolders = new Set<string>(scaffold.wikiFolders)
    for (const file of scaffold.wikiFiles) {
      parentFoldersForWikiFile(file.path).forEach(path => requiredWikiFolders.add(path))
    }

    for (const path of requiredWikiFolders) {
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
          metadata: {
            vaultFolder: 'wiki',
            isFolder: true,
            folderPath: `wiki/${currentPath}`,
            semantic: semanticFor(`wiki/${currentPath}`),
          },
        })
        folderCache.set(currentPath, folder.id)
        parentId = folder.id
      }
    }

    // 4. wiki 固定文件 + 首版页面
    for (const file of scaffold.wikiFiles) {
      const path = normalizeVaultPath(file.path)
      const parts = path.split('/').filter(Boolean)
      const fileName = parts.pop()
      if (!fileName) continue
      const parentPath = parts.join('/')
      const parentId = parentPath ? await ensureFolderPath(wikiFolder.id, parentPath, 'wiki', {
        vaultFolder: 'wiki',
        isFolder: true,
      }) : wikiFolder.id
      await addMarkdownFile(fileName, file.content, parentId, {
        vaultFolder: 'wiki',
        kind: file.metadata?.kind || 'wiki-page',
        folderPath: parentPath ? `wiki/${parentPath}` : 'wiki',
        ...file.metadata,
      })
    }

    // 5. _reports/：记录每次 raw → wiki 的整理过程，方便审计和回溯
    const reportsFolder = await fs.addFile({
      category: 'knowledge',
      name: '_reports',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'reports', isFolder: true },
    })
    for (const folderName of scaffold.reportFolders) {
      await ensureChildFolder(reportsFolder.id, folderName, {
        vaultFolder: 'reports',
        isFolder: true,
        folderPath: `_reports/${folderName}`,
      })
    }

    // 6. _templates/：统一 wiki 页面模板
    const templatesFolder = await fs.addFile({
      category: 'knowledge',
      name: '_templates',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'templates', isFolder: true },
    })
    for (const file of scaffold.templateFiles) {
      const path = normalizeVaultPath(file.path)
      const parts = path.split('/').filter(Boolean)
      const fileName = parts.pop()
      if (!fileName) continue
      const parentPath = parts.join('/')
      const parentId = parentPath ? await ensureFolderPath(templatesFolder.id, parentPath, '_templates', {
        vaultFolder: 'templates',
        isFolder: true,
      }) : templatesFolder.id
      await addMarkdownFile(fileName, file.content, parentId, {
        vaultFolder: 'templates',
        kind: 'vault-template',
        folderPath: parentPath ? `_templates/${parentPath}` : '_templates',
      })
    }
  }

  async function updateVault(id: string, patch: Partial<Vault>) {
    const index = vaults.value.findIndex(v => v.id === id)
    if (index === -1) return
    vaults.value[index] = { ...vaults.value[index], ...patch, updatedAt: Date.now() }
    await save()
  }

  async function deleteVault(id: string) {
    const fs = useFileStore()
    await fs.deleteByVault(id)
    vaults.value = vaults.value.filter(v => v.id !== id)
    if (activeVaultId.value === id) setActiveVault(null)
    await save()
    // 桌面端：删除磁盘目录
    if (isDesktop()) {
      await removeVaultFromDisk(id).catch(e => console.warn('[VaultFS] 删除目录失败:', e))
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

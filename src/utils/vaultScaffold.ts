import type { VaultTemplate } from '@/data/vaultTemplates'

export interface VaultScaffoldInput {
  folders: string[]
  files: [string, string][]
}

export function cleanVaultRelativePath(input: string): string {
  const raw = String(input || '').trim().replace(/\\/g, '/')
  if (!raw || raw === '.') return ''
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.includes('\0')) {
    throw new Error('路径必须是知识库内相对路径')
  }

  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('路径不能跳出知识库目录')
    parts.push(part)
  }
  return parts.join('/')
}

function addFolder(target: string[], path: string) {
  const clean = cleanVaultRelativePath(path)
  if (clean && !target.includes(clean)) target.push(clean)
}

export function buildVaultScaffoldInput(template: VaultTemplate): VaultScaffoldInput {
  const folders: string[] = []
  addFolder(folders, '.raw')
  for (const folder of template.rawFolders) addFolder(folders, `.raw/${folder}`)
  addFolder(folders, 'wiki')
  for (const folder of template.wikiFolders) addFolder(folders, `wiki/${folder}`)

  return {
    folders,
    files: [
      ['CLAUDE.md', template.claudeMd],
      ['wiki/hot.md', '# 热缓存\n\n'],
      ['wiki/index.md', `# ${template.name}索引\n\n`],
    ],
  }
}

import type { ProjectFileService } from '@/services/projectFileService'

export interface AdaptationWikiScaffoldEntry {
  path: string
  isDirectory: boolean
}
export interface AdaptationWikiScaffoldPlan {
  wikiRoot: 'wiki' | 'docs/wiki'
  directories: string[]
  files: Array<{ path: string; content: string }>
  conflicts: string[]
}

const DIRECTORIES = [
  '',
  '原始材料',
  '改编方案',
  '剧本',
  '资产',
  '资产/角色',
  '资产/场景',
  '资产/道具',
]
const indexContent = (relative: string): string => {
  if (!relative)
    return [
      '# 改编 Wiki',
      '',
      '用途：管理原始材料、改编规则、分集剧本和可复用资产。',
      '',
      '## 子目录',
      '',
      '- [原始材料](原始材料/index.md) - 保存用户提供或授权使用的故事来源。',
      '- [改编方案](改编方案/index.md) - 保存故事拆解和已确认的改编约束。',
      '- [剧本](剧本/index.md) - 保存逐集剧本及其配套交付文档。',
      '- [资产](资产/index.md) - 保存角色、场景和道具的唯一档案。',
      '',
    ].join('\n')
  if (relative === '资产')
    return [
      '# 资产',
      '',
      '用途：保存跨集复用的角色、场景和道具档案。',
      '',
      '## 子目录',
      '',
      '- [角色](角色/index.md) - 角色身份、关系、外观和声音资料。',
      '- [场景](场景/index.md) - 可复用表演空间及视觉资料。',
      '- [道具](道具/index.md) - 实际出镜或推动剧情的道具资料。',
      '',
    ].join('\n')
  const title = relative.split('/').at(-1) || relative
  const purposes: Record<string, string> = {
    原始材料: '保存用户提供或授权使用的来源材料。',
    改编方案: '保存故事拆解、总体方案和逐集改编约束。',
    剧本: '保存逐集剧本及其配套交付文档。',
    角色: '保存一个角色一个目录的稳定角色档案。',
    场景: '保存一个场景一个目录的可复用场景档案。',
    道具: '保存一个道具一个目录的可复用道具档案。',
  }
  return `# ${title}\n\n用途：${purposes[title] || '保存改编项目内容。'}\n`
}

export function buildAdaptationWikiScaffoldPlan(
  entries: AdaptationWikiScaffoldEntry[],
): AdaptationWikiScaffoldPlan {
  const byPath = new Map(entries.map(entry => [entry.path.replace(/\/$/, ''), entry]))
  const candidates = ['wiki', 'docs/wiki'] as const
  const roots = candidates.filter(root => byPath.get(root)?.isDirectory)
  const wikiRoot = roots[0] || 'wiki'
  const conflicts: string[] = []
  if (roots.length > 1)
    conflicts.push('检测到多个 Wiki 根目录：wiki/ 与 docs/wiki/，请先保留一个。')
  for (const root of candidates) {
    const entry = byPath.get(root)
    if (entry && !entry.isDirectory) conflicts.push(`目标路径 ${root} 被普通文件占用。`)
  }
  if (entries.some(entry => /(^|\/)_index\.md$/i.test(entry.path)))
    conflicts.push('检测到旧 _index.md，请先确认迁移方式。')
  const expectedDirectories = DIRECTORIES.map(path => (path ? `${wikiRoot}/${path}` : wikiRoot))
  for (const path of expectedDirectories)
    if (byPath.get(path) && !byPath.get(path)!.isDirectory)
      conflicts.push(`目标目录 ${path} 被普通文件占用。`)
  const expectedFiles = DIRECTORIES.map(relative => ({
    path: `${relative ? `${wikiRoot}/${relative}` : wikiRoot}/index.md`,
    content: indexContent(relative),
  }))
  for (const file of expectedFiles)
    if (byPath.get(file.path)?.isDirectory) conflicts.push(`目标文件 ${file.path} 被目录占用。`)
  return {
    wikiRoot,
    directories: expectedDirectories.filter(path => !byPath.has(path)),
    files: expectedFiles.filter(file => !byPath.has(file.path)),
    conflicts: [...new Set(conflicts)],
  }
}

export async function applyAdaptationWikiScaffold(files: ProjectFileService, owner: string) {
  const plan = buildAdaptationWikiScaffoldPlan(
    (await files.list(owner)).map(resource => ({
      path: resource.path,
      isDirectory: resource.isDirectory,
    })),
  )
  if (plan.conflicts.length) throw new Error(plan.conflicts.join('\n'))
  const createdDirectories: string[] = []
  const createdFiles: string[] = []
  for (const path of plan.directories) {
    await files.createFolder(owner, path)
    createdDirectories.push(path)
  }
  for (const file of plan.files) {
    await files.createText(owner, file.path, file.content)
    createdFiles.push(file.path)
  }
  return { plan, createdDirectories, createdFiles }
}

/**
 * Skill 草稿在项目文件树里的落点与读写。
 *
 * 合同见 `docs/wiki/开发/SkillCreator合同-2026-09-21.md` §2：草稿就是文件树里的
 * 文件（`.raw/jc-media/文档/skill-<target-skill-id>/`），模型用现有文件工具读写，
 * **路径即身份**，不再有 draft_id / revision / content_hash 三件套与内存状态机。
 */
import { MEMORY_MEDIA_DIRECTORIES, isMemoryProjectMutationBlocked } from './memoryProjectPaths'

/** 草稿根目录：项目文件树的文档区。 */
export const SKILL_DRAFT_ROOT = MEMORY_MEDIA_DIRECTORIES.document

/** 草稿目录名前缀，安装卡校验也用它识别合法草稿路径。 */
export const SKILL_DRAFT_DIRECTORY_PREFIX = 'skill-'

export const SKILL_DRAFT_ENTRY = 'SKILL.md'

/** 测试与评审产物目录前缀（`iteration-1/`），不算进包内容。 */
export const SKILL_DRAFT_ITERATION_PREFIX = 'iteration-'

/**
 * 草稿文件读写口。
 *
 * 只暴露路径与文本，不暴露 `ProjectResource`，这样调用方既能接 `ProjectFileService`，
 * 也能在测试里用几行假实现顶上。
 */
export interface SkillDraftFiles {
  list(directory: string): Promise<string[]>
  readText(path: string): Promise<string>
  hashFile(path: string): Promise<string>
}

export interface SkillDraftReference {
  /** 相对草稿目录的路径，例如 `references/checklist.md`。 */
  path: string
  content: string
}

export interface SkillDraftContents {
  skillMd: string
  references: SkillDraftReference[]
  /** 草稿目录下全部文件的相对路径，含 SKILL.md（用于出卡时展示文件清单）。 */
  files: string[]
}

const RESERVED = /[^a-z0-9-]+/g

/** target skill id → 草稿目录名。与中央 Skill 的 id 规范一致：小写 + 连字符。 */
export function skillDraftDirectoryName(targetSkillId: string): string {
  const slug = String(targetSkillId || '')
    .trim()
    .toLowerCase()
    .replace(/^preset[_-]/, '')
    .replace(/[\s_]+/g, '-')
    .replace(RESERVED, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('请提供要创建或修改的 Skill 名（target_skill_id）。')
  return `${SKILL_DRAFT_DIRECTORY_PREFIX}${slug}`
}

export function skillDraftPath(targetSkillId: string): string {
  return `${SKILL_DRAFT_ROOT}/${skillDraftDirectoryName(targetSkillId)}`
}

function normalizedPath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

/**
 * 校验并规范化模型给的草稿路径，返回草稿**目录**。
 *
 * 容错：`skill-x/SKILL.md`、`skill-x/references/a.md` 这类多写了尾段的写法按草稿目录
 * 处理，避免为一次笔误白跑一个来回。越界（跳出文档区、`..`、目录名不是 `skill-*`）
 * 一律报错并把原因写清楚。
 */
export function assertSkillDraftPath(raw: string): string {
  const path = normalizedPath(raw)
  if (!path) throw new Error(`请提供草稿路径（draft_path），形如 ${SKILL_DRAFT_ROOT}/${SKILL_DRAFT_DIRECTORY_PREFIX}<skill-name>。`)
  if (path.split('/').includes('..')) throw new Error(`草稿路径不能包含 ..：${path}`)

  const prefix = `${SKILL_DRAFT_ROOT}/`
  if (!path.startsWith(prefix)) {
    throw new Error(`草稿必须放在项目文件树的 ${SKILL_DRAFT_ROOT}/ 下，收到的是：${path}`)
  }

  const [directory, ...rest] = path.slice(prefix.length).split('/')
  if (!directory?.startsWith(SKILL_DRAFT_DIRECTORY_PREFIX) || directory.length <= SKILL_DRAFT_DIRECTORY_PREFIX.length) {
    throw new Error(`草稿目录名必须是 ${SKILL_DRAFT_DIRECTORY_PREFIX}<skill-name>，收到的是：${directory || '(空)'}`)
  }
  if (rest.some(segment => !segment)) throw new Error(`草稿路径不完整：${path}`)
  return `${SKILL_DRAFT_ROOT}/${directory}`
}

export function isSkillDraftPath(raw: string): boolean {
  try {
    assertSkillDraftPath(raw)
    return true
  } catch {
    return false
  }
}

function relativeTo(directory: string, path: string): string {
  return normalizedPath(path).slice(directory.length + 1)
}

function isDraftContent(relative: string): boolean {
  return relative !== '' && !relative.startsWith(SKILL_DRAFT_ITERATION_PREFIX)
}

/**
 * 按码位排序，不用 `localeCompare`。
 *
 * 安装卡的哈希要能在任何机器上重算得到同一个值，而 `localeCompare` 的结果随运行环境的
 * locale 变化，会让同一份草稿在不同机器上哈希不同 —— 出卡时算的和点击安装时算的就对不上。
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function listDraftContent(directory: string, files: SkillDraftFiles): Promise<string[]> {
  return (await files.list(directory)).map(path => relativeTo(directory, path)).filter(isDraftContent).sort(byCodeUnit)
}

/** 读回草稿：`SKILL.md` 正文 + 其余文本文件。 */
export async function readSkillDraft(directory: string, files: SkillDraftFiles): Promise<SkillDraftContents> {
  const draftDirectory = assertSkillDraftPath(directory)
  const relatives = await listDraftContent(draftDirectory, files)
  if (!relatives.includes(SKILL_DRAFT_ENTRY)) {
    throw new Error(`草稿里没有 ${SKILL_DRAFT_ENTRY}：${draftDirectory}。请先把 SKILL.md 写进该目录。`)
  }

  const references: SkillDraftReference[] = []
  for (const relative of relatives) {
    if (relative === SKILL_DRAFT_ENTRY) continue
    references.push({
      path: relative,
      content: (await files.readText(`${draftDirectory}/${relative}`)) ?? '',
    })
  }
  const skillMd = (await files.readText(`${draftDirectory}/${SKILL_DRAFT_ENTRY}`)) ?? ''
  return { skillMd, references, files: relatives }
}

/**
 * 冻结草稿内容的哈希：逐文件哈希按路径排序后拼一次。
 *
 * 与旧的「把全包内容拼成一个大字符串再哈希」等价（内容变了哈希必然变），但不用把整包
 * 读进内存。出卡时算一次，用户点击安装时重算比对 —— 草稿在出卡后被改过就拒绝安装。
 */
export async function hashSkillDraftDirectory(directory: string, files: SkillDraftFiles): Promise<string> {
  const draftDirectory = assertSkillDraftPath(directory)
  const relatives = await listDraftContent(draftDirectory, files)
  if (!relatives.length) throw new Error(`草稿目录是空的：${draftDirectory}`)

  const parts: string[] = []
  for (const relative of relatives) {
    parts.push(`${relative}:${await files.hashFile(`${draftDirectory}/${relative}`)}`)
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 草稿落点必须是可写文本路径。
 *
 * 这条守住合同里唯一需要守的规则：草稿在文档区里，模型碰不到中央 Skill 根目录。
 */
export function assertSkillDraftWritable(directory: string): string {
  const draftDirectory = assertSkillDraftPath(directory)
  if (isMemoryProjectMutationBlocked(draftDirectory, 'text')) {
    throw new Error(`草稿目录不可写：${draftDirectory}`)
  }
  return draftDirectory
}

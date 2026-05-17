/**
 * utils/openclawSync.ts — 搭子 ↔ OpenClaw Agent 双向同步
 *
 * 将韭菜盒子的搭子 (SkillConfig) 映射为 OpenClaw 的 Agent 格式：
 *   - 每个搭子 → 一个 OpenClaw Agent (独立 workspace 目录)
 *   - SkillConfig.skillContent → AGENTS.md (操作指令)
 *   - SkillConfig.name/description → IDENTITY.md (身份)
 *   - SkillConfig.triggers → SOUL.md (触发词 + 性格)
 *   - 知识库 vault → workspace 内 TOOLS.md 或 knowledge/ 目录
 *
 * 同步到文件系统: ~/.jiucaihezi/openclaw/agents/<agentId>/
 * 同时生成 openclaw.json 片段供 Gateway 加载
 */

import type { SkillConfig } from '@/types/skill'

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

// ─── OpenClaw 文件格式生成 ───

/** 生成 IDENTITY.md */
export function buildIdentityMd(skill: SkillConfig): string {
  const lines = ['# IDENTITY.md - Who Am I?', '']
  lines.push(`- Name: ${skill.name}`)
  if (skill.oneLineDesc) {
    lines.push(`- Vibe: ${skill.oneLineDesc}`)
  }
  if (skill.description) {
    lines.push(`- Description: ${skill.description}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 生成 AGENTS.md (操作指令 = skillContent) */
export function buildAgentsMd(skill: SkillConfig): string {
  const header = `# AGENTS.md - ${skill.name} 操作手册\n\n`

  // 如果 skillContent 已经是 markdown，直接用
  if (skill.skillContent && !skill.skillContent.startsWith('skill://')) {
    return header + skill.skillContent
  }

  // 兜底
  return header + `## 角色定义\n你是「${skill.name}」。\n\n${skill.description || ''}\n`
}

/** 生成 SOUL.md (性格 + 触发词) */
export function buildSoulMd(skill: SkillConfig): string {
  const lines = [`# SOUL.md - ${skill.name} 的灵魂`, '']

  if (skill.oneLineDesc) {
    lines.push(`## 核心`)
    lines.push(skill.oneLineDesc)
    lines.push('')
  }

  if (skill.triggers && skill.triggers.length > 0) {
    lines.push('## 激活关键词')
    lines.push(`当用户提到以下关键词时，优先由我来响应：`)
    lines.push(skill.triggers.map(t => `- ${t}`).join('\n'))
    lines.push('')
  }

  if (skill.examples && skill.examples.length > 0) {
    lines.push('## 示例回复')
    for (const ex of skill.examples) {
      lines.push(`> ${ex}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** 生成 TOOLS.md (引用资料) */
export function buildToolsMd(skill: SkillConfig): string {
  if (!skill.references || skill.references.length === 0) {
    return `# TOOLS.md\n\n此搭子暂无特殊工具配置。\n`
  }

  const lines = ['# TOOLS.md', '']
  lines.push('## 参考资料')
  for (const ref of skill.references) {
    lines.push(`- ${ref}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 生成 openclaw.json agents.list 中的一个条目 */
export function buildAgentConfigEntry(skill: SkillConfig, workspaceBase: string): OpenClawAgentEntry {
  const agentId = sanitizeAgentId(skill.id)
  return {
    id: agentId,
    name: skill.name,
    workspace: `${workspaceBase}/${agentId}`,
    identity: {
      name: skill.name,
      emoji: extractEmoji(skill.name) || undefined,
    },
    skills: [],
  }
}

export interface OpenClawAgentEntry {
  id: string
  name: string
  default?: boolean
  workspace: string
  model?: string
  identity?: {
    name: string
    emoji?: string
  }
  skills?: string[]
}

export interface OpenClawConfig {
  agents: {
    defaults: {
      workspace: string
      model: string
    }
    list: OpenClawAgentEntry[]
  }
}

/** 把搭子 ID 清理为合法的 OpenClaw agent ID (小写字母+数字+连字符) */
function sanitizeAgentId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'agent-' + Date.now().toString(36)
}

/** 尝试从名字中提取 emoji */
function extractEmoji(name: string): string | null {
  const match = name.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u)
  return match ? match[0] : null
}

// ─── Tauri 文件系统同步 ───

/**
 * 将所有搭子同步到 OpenClaw workspace 目录
 * 每个搭子 → ~/.jiucaihezi/openclaw/agents/<id>/
 */
export async function syncSkillsToOpenClaw(skills: SkillConfig[]): Promise<{
  synced: number
  config: OpenClawConfig
}> {
  if (!isTauri) {
    return { synced: 0, config: buildOpenClawConfig(skills, '') }
  }

  const tauriFs = await import('@tauri-apps/plugin-fs')
  const tauriPath = await import('@tauri-apps/api/path')
  const home = await tauriPath.homeDir()
  const baseDir = `${home}.jiucaihezi/openclaw/agents`

  // 确保目录存在
  try { await tauriFs.mkdir(baseDir, { recursive: true }) } catch {}

  let synced = 0
  for (const skill of skills) {
    if (skill.skillContent.startsWith('skill://')) continue // 未解析的跳过

    const agentId = sanitizeAgentId(skill.id)
    const agentDir = `${baseDir}/${agentId}`

    try {
      await tauriFs.mkdir(agentDir, { recursive: true })

      // 写入 workspace 文件
      await tauriFs.writeTextFile(`${agentDir}/IDENTITY.md`, buildIdentityMd(skill))
      await tauriFs.writeTextFile(`${agentDir}/AGENTS.md`, buildAgentsMd(skill))
      await tauriFs.writeTextFile(`${agentDir}/SOUL.md`, buildSoulMd(skill))
      await tauriFs.writeTextFile(`${agentDir}/TOOLS.md`, buildToolsMd(skill))

      synced++
    } catch (e) {
      console.warn(`[OpenClaw] 同步搭子 "${skill.name}" 失败:`, e)
    }
  }

  // 生成 openclaw.json 配置
  const config = buildOpenClawConfig(skills, baseDir)

  // 写入配置文件
  const configPath = `${home}.jiucaihezi/openclaw/openclaw-agents.json`
  try {
    await tauriFs.writeTextFile(configPath, JSON.stringify(config, null, 2))
  } catch (e) {
    console.warn('[OpenClaw] 写入配置文件失败:', e)
  }

  console.log(`[OpenClaw] 同步完成: ${synced}/${skills.length} 个搭子`)
  return { synced, config }
}

/** 构建 openclaw.json 的 agents 部分 */
function buildOpenClawConfig(skills: SkillConfig[], workspaceBase: string): OpenClawConfig {
  const list = skills
    .filter(s => !s.skillContent.startsWith('skill://'))
    .map((s, i) => {
      const entry = buildAgentConfigEntry(s, workspaceBase)
      if (i === 0) entry.default = true
      return entry
    })

  return {
    agents: {
      defaults: {
        workspace: workspaceBase,
        model: localStorage.getItem('jcModel') || 'anthropic/claude-sonnet-4-6',
      },
      list,
    },
  }
}

/**
 * 从 OpenClaw workspace 目录读取搭子列表
 * 用于反向同步：如果用户直接在文件系统中修改了 AGENTS.md
 */
export async function readOpenClawAgents(): Promise<SkillConfig[]> {
  if (!isTauri) return []

  const tauriFs = await import('@tauri-apps/plugin-fs')
  const tauriPath = await import('@tauri-apps/api/path')
  const home = await tauriPath.homeDir()
  const baseDir = `${home}.jiucaihezi/openclaw/agents`

  const skills: SkillConfig[] = []

  try {
    const entries = await tauriFs.readDir(baseDir)
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      const agentDir = `${baseDir}/${entry.name}`

      try {
        const agentsMd = await tauriFs.readTextFile(`${agentDir}/AGENTS.md`).catch(() => '')
        const identityMd = await tauriFs.readTextFile(`${agentDir}/IDENTITY.md`).catch(() => '')

        // 从 IDENTITY.md 解析名字
        const nameMatch = identityMd.match(/^- Name:\s*(.+)$/m)
        const vibeMatch = identityMd.match(/^- Vibe:\s*(.+)$/m)
        const descMatch = identityMd.match(/^- Description:\s*(.+)$/m)

        const name = nameMatch?.[1]?.trim() || entry.name
        const skill: SkillConfig = {
          id: `oc_${entry.name}`,
          name,
          oneLineDesc: vibeMatch?.[1]?.trim(),
          description: descMatch?.[1]?.trim() || '',
          triggers: [],
          skillContent: agentsMd || `## ${name}`,
          references: [],
          examples: [],
          version: 1,
          source: 'openclaw',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          evolutionLog: [],
        }
        skills.push(skill)
      } catch {}
    }
  } catch {}

  return skills
}

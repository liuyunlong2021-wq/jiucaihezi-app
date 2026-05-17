/**
 * useSkillFeedback — 知识库反哺搭子
 *
 * 读取知识库 wiki/ 内容，结合搭子当前 skillContent，
 * 调用 LLM 生成升级建议。
 */
import { callLLM } from '@/utils/api'
import { useFileStore } from '@/composables/useFileStore'
import { useAgentStore } from '@/stores/agentStore'
import type { SkillConfig } from '@/types/skill'

export interface FeedbackSuggestion {
  type: string
  content: string
  reason: string
}

export interface FeedbackResult {
  suggestions: FeedbackSuggestion[]
  newSkillContent: string
  changeSummary: string
}

/**
 * 用知识库反哺单个搭子
 */
export async function feedbackSkillFromVault(
  skill: SkillConfig,
  vaultId: string,
): Promise<FeedbackResult> {
  const fs = useFileStore()

  // 收集 wiki/ 下的知识页内容
  const allFiles = await fs.loadByVault(vaultId)
  const wikiFiles = allFiles.filter(f =>
    f.mimeType !== 'folder' &&
    f.metadata?.vaultFolder === 'wiki' ||
    f.kind === 'page'
  )

  if (wikiFiles.length === 0) {
    return { suggestions: [], newSkillContent: skill.skillContent || '', changeSummary: '知识库为空，无法反哺' }
  }

  const knowledgeText = wikiFiles
    .slice(0, 20)
    .map(f => `### ${f.name}\n${f.content?.slice(0, 500) || ''}`)
    .join('\n\n')

  const resp = await callLLM({
    systemPrompt: `你是搭子进化引擎。基于知识库内容，改进搭子的 SKILL.md。

## 任务
1. 分析当前搭子的 SKILL.md 和知识库内容
2. 生成改进后的完整 SKILL.md
3. 说明变更内容

## 输出格式（严格 JSON）
{
  "suggestions": [
    {"type": "rule|example|workflow", "content": "具体改动内容", "reason": "基于哪条知识"}
  ],
  "newSkillContent": "改进后的完整 SKILL.md 内容",
  "changeSummary": "一句话说明改了什么"
}

## 原则
- 只做有知识库证据支持的改动
- 保留现有有效规则
- 增强：规则约束、输出格式、示例、专业知识`,
    userMessage: `## 当前搭子
名称: ${skill.name}
SKILL.md:
${skill.skillContent?.slice(0, 4000) || '（空）'}

## 知识库内容
${knowledgeText}`,
    temperature: 0.3,
    maxTokens: 4000,
  })

  try {
    const parsed = JSON.parse(resp)
    return {
      suggestions: parsed.suggestions || [],
      newSkillContent: parsed.newSkillContent || skill.skillContent || '',
      changeSummary: parsed.changeSummary || '',
    }
  } catch {
    return {
      suggestions: [],
      newSkillContent: skill.skillContent || '',
      changeSummary: '解析反馈结果失败',
    }
  }
}

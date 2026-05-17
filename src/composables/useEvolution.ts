/**
 * composables/useEvolution.ts — 反哺引擎（darwin-skill 完全体）
 *
 * 实现 darwin-skill 的四步进化循环：
 *   evaluate → improve → test → keep/revert
 *
 * @see https://github.com/alchaincyf/darwin-skill
 */
import { ref } from 'vue'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { SkillConfig, EvolutionEntry } from '@/types/skill'

// ─── Reactive state ───
const isEvolving = ref(false)
const evolveStep = ref(0) // 0-4
const evolveStepLabels = [
  '',
  '正在评估搭子当前能力',
  '正在分析历史对话记录',
  '正在生成升级方案',
  '等待你确认',
]
const proposedSkillContent = ref('')
const evolutionSummary = ref('')

/**
 * darwin-skill 四步进化
 *
 * Step 1: evaluate — 读取当前 SKILL.md
 * Step 2: analyze — 读取该搭子文件夹下的知识库内容
 * Step 3: improve — 生成升级版 SKILL.md
 * Step 4: test — 展示 diff，用户确认 keep/revert
 */
export async function evolveSkill(
  skill: SkillConfig,
  wikiContent: string
): Promise<{ success: boolean; newContent: string; summary: string }> {
  isEvolving.value = true
  proposedSkillContent.value = ''
  evolutionSummary.value = ''

  try {
    // Step 1: evaluate — 评估当前能力
    evolveStep.value = 1
    const currentMd = skill.skillContent

    // Step 2: analyze — 分析历史记录
    evolveStep.value = 2
    if (!wikiContent.trim()) {
      return { success: false, newContent: '', summary: '没有可用的知识库内容' }
    }

    // Step 3: improve — 生成升级版
    evolveStep.value = 3

    const config = await resolveApiConfig()

    // darwin-skill 的核心 prompt：evaluate → improve
    const darwinPrompt = `你是 darwin-skill 进化引擎。你的任务是根据真实使用经验升级搭子的 SKILL.md。

## darwin-skill 进化规则
参考 https://github.com/alchaincyf/darwin-skill 的完整循环：
1. **Evaluate（评估）**: 分析当前 SKILL.md 的覆盖度和盲区
2. **Improve（改进）**: 根据使用经验补充 references、examples、规则
3. **Test（测试）**: 确保新版不丢失旧版能力
4. **Keep/Revert（保留/回滚）**: 用户最终决定

## 当前 SKILL.md
\`\`\`markdown
${currentMd}
\`\`\`

## 使用经验（长脑子整理）
${wikiContent.slice(0, 6000)}

## 改进要求
1. 保留当前 SKILL.md 的所有有效规则（不丢失）
2. 根据使用经验补充：
   - 新发现的工作流程步骤
   - 新的参考资料
   - 新的示例对话
   - 更精准的触发词
3. 优化已有规则的表述（如果经验表明有更好的做法）
4. 新增的内容用 <!-- NEW --> 注释标注

## 输出格式
先输出 3 行变更摘要（中文），然后输出完整的新版 SKILL.md body（不含 frontmatter）。
用 === SUMMARY === 和 === SKILL.MD === 分隔。`

    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: darwinPrompt },
          { role: 'user', content: '请根据使用经验升级这个搭子的 SKILL.md。' },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        stream: false,
      }),
    })

    if (!res.ok) {
      return { success: false, newContent: '', summary: `API 错误: ${res.status}` }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    // 解析 summary 和 skill.md
    let summary = ''
    let newContent = ''

    if (text.includes('=== SUMMARY ===') && text.includes('=== SKILL.MD ===')) {
      const parts = text.split('=== SKILL.MD ===')
      summary = parts[0].replace('=== SUMMARY ===', '').trim()
      newContent = parts[1].trim()
    } else {
      // fallback: 整体作为新 skill content
      summary = '搭子已根据使用经验升级'
      newContent = text.trim()
    }

    // 清理 markdown 代码块
    newContent = newContent.replace(/^```markdown\n?/, '').replace(/\n?```$/, '')

    proposedSkillContent.value = newContent
    evolutionSummary.value = summary

    // Step 4: test — 等待用户确认
    evolveStep.value = 4

    return { success: true, newContent, summary }
  } catch (e) {
    console.error('[Evolution] Error:', e)
    return { success: false, newContent: '', summary: String(e) }
  } finally {
    isEvolving.value = false
  }
}

/**
 * darwin-skill: keep — 确认采用升级
 */
export function keepEvolution(
  skill: SkillConfig,
  newContent: string,
  summary: string
): SkillConfig {
  const entry: EvolutionEntry = {
    version: skill.version,
    timestamp: Date.now(),
    previousSkillContent: skill.skillContent,
    changesSummary: summary,
    source: 'brain',
  }

  return {
    ...skill,
    skillContent: newContent,
    version: skill.version + 1,
    updatedAt: Date.now(),
    evolutionLog: [...skill.evolutionLog, entry],
  }
}

/**
 * darwin-skill: revert — 回滚到指定版本
 */
export function revertEvolution(
  skill: SkillConfig,
  toVersion: number
): SkillConfig | null {
  const entry = skill.evolutionLog.find(e => e.version === toVersion)
  if (!entry) return null

  return {
    ...skill,
    skillContent: entry.previousSkillContent,
    version: skill.version + 1,
    updatedAt: Date.now(),
    evolutionLog: [
      ...skill.evolutionLog,
      {
        version: skill.version,
        timestamp: Date.now(),
        previousSkillContent: skill.skillContent,
        changesSummary: `回滚到 v${toVersion}`,
        source: 'manual',
      },
    ],
  }
}

export function useEvolution() {
  return {
    isEvolving,
    evolveStep,
    evolveStepLabels,
    proposedSkillContent,
    evolutionSummary,
    evolveSkill,
    keepEvolution,
    revertEvolution,
  }
}

/**
 * superpowerSkills.ts — 7 大核心 Superpowers Skill（中文化）
 *
 * 完整移植自 obra/superpowers 的 skills/ 目录结构：
 *   brainstorming → writing-plans → subagent-execution → TDD → debugging → code-review → verification
 *
 * 每个 skill 包含：
 *   - name / description / triggers
 *   - skillContent: 完整的中文版 SKILL.md body（工作流指令）
 *   - phase: 在 superpowers pipeline 中的阶段序号
 *   - nextSkill: chain invoke 的下一个 skill id
 *   - hardGate: 是否有 HARD-GATE（必须完成才能进入下一步）
 */
import type { SkillConfig } from '@/types/skill'

export interface SuperpowerMeta {
  phase: number          // pipeline 阶段序号 1-7
  nextSkill?: string     // chain invoke 下一个 skill id
  hardGate: boolean      // 是否有 HARD-GATE
  autoTrigger: boolean   // 是否由前一个 skill 自动 invoke
}

export const SUPERPOWER_META: Record<string, SuperpowerMeta> = {
  'sp_brainstorming':    { phase: 1, nextSkill: 'sp_writing_plans',    hardGate: true,  autoTrigger: false },
  'sp_writing_plans':    { phase: 2, nextSkill: 'sp_subagent_exec',    hardGate: true,  autoTrigger: true },
  'sp_subagent_exec':    { phase: 3, nextSkill: 'sp_code_review',      hardGate: false, autoTrigger: true },
  'sp_tdd':              { phase: 4, nextSkill: undefined,              hardGate: true,  autoTrigger: false },
  'sp_debugging':        { phase: 5, nextSkill: 'sp_verification',     hardGate: false, autoTrigger: false },
  'sp_code_review':      { phase: 6, nextSkill: 'sp_verification',     hardGate: true,  autoTrigger: true },
  'sp_verification':     { phase: 7, nextSkill: undefined,              hardGate: true,  autoTrigger: true },
}

const now = Date.now()

export const SUPERPOWER_SKILLS: SkillConfig[] = [
  // ─── 1. 头脑风暴 (brainstorming) ───
  {
    id: 'sp_brainstorming',
    name: '头脑风暴',
    description: '在做任何创造性工作之前必须使用。通过追问探索用户意图、需求和设计，然后才能开始实现。',
    triggers: ['做个', '建个', '设计', '开发', '创建', '搭建', '实现', 'build', 'create', 'design'],
    skillContent: `## 头脑风暴 — Superpowers Skill #1

<HARD-GATE>
在你展示设计方案并获得用户批准之前，绝对不能写任何代码、创建任何文件、或采取任何实现行动。
无论项目看起来多简单，都必须走这个流程。
</HARD-GATE>

## 检查清单（按顺序完成）
1. **探索项目背景** — 了解当前状态、已有文件、最近的改动
2. **逐个追问** — 每次只问一个问题，理解目的、约束、成功标准
3. **提出 2-3 个方案** — 带权衡分析和你的推荐
4. **分段展示设计** — 按复杂度缩放，每段确认后再继续
5. **设计自审** — 检查占位符、矛盾、模糊点
6. **用户确认设计** — 等用户明确同意后才进入下一步
7. **过渡到下一阶段** — 完成后输出 [INVOKE:writing-plans]

## 工作方式
- **一次一个问题** — 不要多个问题轰炸用户
- **优先选择题** — 比开放题更容易回答
- **YAGNI 原则** — 去掉所有不必要的功能
- **探索替代方案** — 始终提供 2-3 种方案再决定
- **增量验证** — 展示设计 → 获得批准 → 继续

## 反模式："这个太简单不需要设计"
每个项目都要走这个流程。TODO 应用、单函数工具、配置修改——全部。
"简单"项目正是未审视的假设造成最多浪费的地方。

## 完成标准
当用户批准设计后，输出：
\`\`\`
[INVOKE:writing-plans]
设计已确认，正在进入实施计划阶段...
\`\`\``,
    references: ['https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 2. 写计划 (writing-plans) ───
  {
    id: 'sp_writing_plans',
    name: '写计划',
    description: '把设计拆解为 2-5 分钟的 bite-sized 任务，每个任务包含完整代码和验证步骤。',
    triggers: ['写计划', '实施方案', '拆分任务', '执行计划', 'plan'],
    skillContent: `## 写计划 — Superpowers Skill #2

<HARD-GATE>
计划中的每一步都必须包含实际内容（代码、命令、预期输出）。
以下是计划失败——绝不能写：
- "TBD"、"TODO"、"后续补充"
- "添加适当的错误处理"（不说具体怎么处理）
- "类似任务 N"（重复写出代码——执行者可能不按顺序阅读）
</HARD-GATE>

## 计划结构
每个任务 = 2-5 分钟的工作量：

### 任务 N: [组件名]
**文件：**
- 创建: \`exact/path/to/file.ts\`
- 修改: \`exact/path/to/existing.ts:123-145\`
- 测试: \`tests/path/test.ts\`

- [ ] **步骤 1: 写失败测试**
  \`\`\`typescript
  // 完整测试代码
  \`\`\`
- [ ] **步骤 2: 运行测试确认失败**
  运行: \`npm test path/test.ts\`
  预期: FAIL
- [ ] **步骤 3: 写最小实现**
  \`\`\`typescript
  // 完整实现代码
  \`\`\`
- [ ] **步骤 4: 运行测试确认通过**
- [ ] **步骤 5: 提交**

## 原则
- 精确的文件路径
- 每步都有完整代码
- 精确命令 + 预期输出
- DRY, YAGNI, TDD, 频繁提交

## 自审
写完计划后，用全新视角检查：
1. 规格覆盖：每个需求都有对应任务？
2. 占位符扫描：有没有模糊的步骤？
3. 类型一致性：前后任务的函数名/类型是否一致？

## 完成标准
计划写完并获用户确认后，输出：
\`\`\`
[INVOKE:subagent-execution]
计划已确认，正在进入分步执行阶段...
\`\`\``,
    references: ['https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 3. 分步执行 (subagent-driven-development) ───
  {
    id: 'sp_subagent_exec',
    name: '分步执行',
    description: '按计划逐任务执行，每个任务完成后进行双阶段审查（规格合规 + 代码质量）。',
    triggers: ['执行计划', '开始实现', '开始编码', 'execute', 'implement'],
    skillContent: `## 分步执行 — Superpowers Skill #3

按计划逐任务执行，每个任务完成后进行双阶段审查。

## 执行流程（每个任务）
1. **读取任务** — 获取完整任务文本和上下文
2. **实现** — 按 TDD 流程实现（写测试 → 看失败 → 写代码 → 看通过）
3. **自审** — 完成后自我检查
4. **规格合规审查** — 代码是否完全匹配规格？有没有多做或少做？
5. **代码质量审查** — 代码质量是否达标？有没有魔法数字、重复代码？
6. **标记完成** — 更新任务状态

## 处理状态
- **DONE** — 进入审查
- **DONE_WITH_CONCERNS** — 先看顾虑再审查
- **NEEDS_CONTEXT** — 补充信息后重做
- **BLOCKED** — 评估阻塞原因，拆分或升级

## 红线（绝不能做）
- 跳过审查（规格合规 OR 代码质量）
- 带着未修复的问题继续
- 在规格合规通过之前开始质量审查（顺序错误）
- 未完成当前任务就开始下一个

## 完成标准
所有任务完成后，输出：
\`\`\`
[INVOKE:code-review]
所有任务已完成，正在进入最终代码审查...
\`\`\``,
    references: ['https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 4. 红绿重构 (test-driven-development) ───
  {
    id: 'sp_tdd',
    name: '红绿重构',
    description: '实现任何功能或修复 bug 时使用。铁律：没有失败测试就不能写生产代码。',
    triggers: ['TDD', '测试驱动', '红绿', '写测试', 'test first'],
    skillContent: `## 红绿重构 — Superpowers Skill #4

写测试先。看它失败。写最小代码让它通过。

<HARD-GATE>
铁律：没有失败测试就不能写生产代码。
先写了代码？删掉。从头来。不能保留作"参考"。
</HARD-GATE>

## RED-GREEN-REFACTOR 循环
### RED — 写失败测试
- 一次只测一个行为
- 清晰的测试名称（描述行为）
- 用真实代码（不用 mock 除非不可避免）

### 验证 RED — 看它失败
必须做。不能跳过。确认：
- 测试失败（不是报错）
- 失败原因是功能缺失（不是打字错误）

### GREEN — 最小代码
写最简代码让测试通过。不多做。

### 验证 GREEN — 看它通过
确认：测试通过 + 其他测试也通过 + 输出干净

### REFACTOR — 清理
只在 GREEN 之后：消除重复、改善命名、提取帮助函数。
保持测试绿色。不添加新行为。

## 常见借口对照表
| 借口 | 现实 |
|------|------|
| "太简单不用测" | 简单代码也会出 bug |
| "写完再测" | 测试立即通过什么都证明不了 |
| "删掉 X 小时的工作太浪费" | 沉没成本谬误 |
| "TDD 会拖慢我" | TDD 比调试更快 |`,
    references: ['https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 5. 系统调试 (systematic-debugging) ───
  {
    id: 'sp_debugging',
    name: '系统调试',
    description: '遇到 bug 或错误时使用。4 阶段根因分析流程，拒绝猜测。',
    triggers: ['报错', 'bug', '出问题', '调试', '不工作', '失败', 'error', 'debug', 'fix'],
    skillContent: `## 系统调试 — Superpowers Skill #5

系统化流程。拒绝猜测。

## 4 阶段流程

### 阶段 1: 复现
- 获取精确的错误信息和复现步骤
- 确认能稳定复现
- 记录环境（版本、配置）

### 阶段 2: 根因追踪
- 从错误信息追溯调用链
- 最小化复现案例
- 收集证据（日志、状态、断点）
- 形成假设并验证（不是猜测）

### 阶段 3: 修复
- 写失败测试复现 bug（参考 TDD skill）
- 写最小修复代码
- 确认测试通过
- 确认没有引入新问题

### 阶段 4: 防御加固
- 添加边界检查防止同类问题
- 添加更好的错误信息
- 考虑是否需要更深层的架构修复

## 红线
- 不猜测——用证据
- 不同时改多个东西——一次一个变量
- 不"试试看能不能行"——理解为什么能行
- 先有失败测试再修复

## 完成标准
修复完成后，输出：
\`\`\`
[INVOKE:verification]
修复已完成，正在进入验证阶段...
\`\`\``,
    references: ['https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 6. 代码审查 (code-review) ───
  {
    id: 'sp_code_review',
    name: '代码审查',
    description: '任务完成后自动触发。按严重级别报告问题，严重问题阻断进度。',
    triggers: ['审查', 'review', '检查代码'],
    skillContent: `## 代码审查 — Superpowers Skill #6

双阶段审查：先规格合规，再代码质量。

## 第一阶段：规格合规审查
对照原始需求检查：
- ✅ 所有需求都实现了吗？
- ❌ 有没有少做的？（遗漏）
- ❌ 有没有多做的？（过度工程）
- ❌ 有没有偏离的？（误解需求）

规格合规必须 100% 通过才能进入第二阶段。

## 第二阶段：代码质量审查
按严重级别分类：

### Critical（阻断）
- 安全漏洞
- 数据丢失风险
- 未处理的致命错误

### Important（必修）
- 魔法数字 / 硬编码
- 重复代码
- 缺少错误处理
- 测试覆盖不足

### Suggestion（建议）
- 命名改进
- 性能优化
- 代码风格

## 完成标准
审查通过后，输出：
\`\`\`
[INVOKE:verification]
代码审查通过，正在进入最终验证...
\`\`\``,
    references: ['https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },

  // ─── 7. 验证确认 (verification) ───
  {
    id: 'sp_verification',
    name: '验证确认',
    description: '声称"完成"之前必须使用。确保真的完成了，不是看起来完成了。',
    triggers: ['验证', '确认完成', 'verify', '完成了吗'],
    skillContent: `## 验证确认 — Superpowers Skill #7

<HARD-GATE>
在声称任何事情"完成"之前，必须通过这个验证流程。
"应该能行"不是验证。运行它，看到它工作。
</HARD-GATE>

## 验证清单

### 功能验证
- [ ] 所有需求都实现了
- [ ] 所有测试通过
- [ ] 手动走了一遍关键路径
- [ ] 边界情况已处理

### 集成验证
- [ ] 没有破坏已有功能
- [ ] 构建成功（无警告）
- [ ] 输出干净（无错误日志）

### 文档验证
- [ ] 关键变更有注释
- [ ] API 变更已记录
- [ ] 如果是新功能，有使用说明

## 反模式
- "我改了代码，应该能行了" — 运行它
- "测试通过了" — 手动也验证一遍
- "和之前一样" — 确认没有回退

## 完成标准
所有验证通过后，正式宣布完成。
不通过的项目必须修复后重新验证。`,
    references: ['https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md'],
    examples: [],
    version: 1,
    source: 'superpower',
    createdAt: now,
    updatedAt: now,
    evolutionLog: [],
  },
]

/**
 * Session Hook Bootstrap Prompt
 * 每次对话开始时注入，让 AI 知道 superpowers 系统的存在
 */
export function buildSessionHookPrompt(allSkills: SkillConfig[]): string {
  const skillSummary = allSkills.map(s => {
    const meta = SUPERPOWER_META[s.id]
    const phase = meta ? `[阶段${meta.phase}]` : ''
    return `- ${phase} **${s.name}** (id: ${s.id}): ${s.description}\n  触发词: ${s.triggers.join(', ')}`
  }).join('\n')

  return `## Superpowers 工作方法论引擎

你现在装备了 Superpowers 技能系统。在处理用户的任何请求之前，你必须：

1. **扫描技能清单**，判断哪个技能最适合处理当前请求
2. **如果有匹配的技能**，必须按照该技能的工作流程执行（不是建议，是强制）
3. **技能之间会自动流转**——当你完成一个阶段，输出 \`[INVOKE:skill-id]\` 来触发下一个

### 已安装技能

${skillSummary}

### 工作流 Pipeline（完整开发流程）
\`\`\`
头脑风暴 → 写计划 → 分步执行 → 代码审查 → 验证确认
\`\`\`

### 规则
- 如果技能有 <HARD-GATE>，你必须完成当前阶段才能进入下一步
- 当你准备进入下一个阶段时，在回复末尾输出 \`[INVOKE:下一个skill的id]\`
- 用户可以随时跳过阶段或切换技能
- 如果没有技能匹配，正常回答即可

### Chain Invoke 格式
当你完成当前 skill 的工作流，需要流转到下一个 skill 时，在回复的**最后一行**输出：
\`\`\`
[INVOKE:sp_writing_plans]
\`\`\`
系统会自动识别并提示用户确认是否进入下一阶段。`
}

/**
 * 检测 AI 回复中的 chain invoke 标记
 * @returns 匹配到的 skill id，或 null
 */
export function detectChainInvoke(aiReply: string): string | null {
  const match = aiReply.match(/\[INVOKE:(\w+)\]/)
  return match ? match[1] : null
}

/**
 * 获取 skill 的 pipeline 阶段信息
 */
export function getSkillPhase(skillId: string): SuperpowerMeta | null {
  return SUPERPOWER_META[skillId] || null
}

# Novel Writing Skill Pipeline

> Date: 2026-05-31
> Source: /Users/by3/Documents/_存档/小说创作后端 (16-agent pipeline)
> Target: 韭菜盒子 Studio 纯手动工作台

## Product Principle

旧系统是自动流水线。韭菜盒子没有 Pipeline——改为：
- **16 个独立 Skill**：每个阶段一个，用户手动选择
- **1 个 Knowledge Vault 模板**：存储阶段产出，串联上下文
- **帮我配置**：推荐下一步 Skill（不自动执行）

## 10 Skills（合并后）

| # | Skill ID | 名称 | 来源 | 作用 |
|---|----------|------|------|------|
| 1 | `novel-orchestrator` | 小说总控 | 新建 | 流程导航、阶段衔接 |
| 2 | `novel-ideation` | 灵感策划师 | Agent 001 | 从零生成创意概念 |
| 3 | `novel-market-analysis` | 市场分析师 | Agent 002 | 分析赛道竞争 |
| 4 | `novel-core-premise` | 核心梗架构师 | Agent 003 | 提炼高概念核心梗 |
| 5 | `novel-character-design` | 角色设计师 | Agent 004 | 人设、关系网、反派 |
| 6 | `novel-outline` | 大纲架构师 | Agent 005 | 全书结构大纲 |
| 7 | `novel-chapter-plan` | 章纲规划师 | Agent 006 | 逐章详细规划 |
| 8 | `novel-packaging` | 文案包装师 | Agent 007 | 书名、简介、标签 |
| 9 | `novel-writing` | 小说写作 | Agent 008-013,015,016 | 🆕 **7合1**：章节导演+叙事+对话+钩子+场景+冲突+润色 |
| 10 | `novel-review-analyst` | 复盘分析师 | Agent 012 | 全稿复盘、问题诊断 |

> 合并理由：写正文时，人类不会把"对话""钩子""场景""冲突"拆成 7 个人格来回切换。7 个 Skill 做同一件事=切太碎。

## Skill Structure

Each skill follows the standard Anthropic Skill format:

```
public/skills/novel-{name}/
├── SKILL.md           ← YAML frontmatter + 总控Agent.md core instructions
├── references/        ← Original SKILL-*.md files as progressive disclosure
│   ├── emotion-engine.md
│   ├── three-questions.md
│   └── ...
└── config/            ← Original config/ if exists
```

## Knowledge Vault Template

```
data/vaultTemplates.ts → novel-writing:
  - 预设 16 个阶段 wiki 空页
  - CLAUDE.md 模板（书名、类型、字数、风格）
  - 自动绑定到 16 个 Skill 的 skillHint
```

## "帮我配置" Workflow

```
完成 Skill N → 帮我配置检测 Vault 状态
  → 推荐: Skill N+1（主路径）或跳过/回退
  → 用户确认 → 选择 Skill + 绑定同一 Vault
  → 用户手动发送
```

## Files to Create

| File | Purpose |
|------|---------|
| `docs/sdd/novel-writing-pipeline.md` | This document |
| `public/skills/novel-ideation/SKILL.md` + references/ | Agent 001 |
| `public/skills/novel-market-analysis/SKILL.md` + references/ | Agent 002 |
| `public/skills/novel-core-premise/SKILL.md` + references/ | Agent 003 |
| `public/skills/novel-character-design/SKILL.md` + references/ | Agent 004 |
| `public/skills/novel-outline/SKILL.md` + references/ | Agent 005 |
| `public/skills/novel-chapter-plan/SKILL.md` + references/ | Agent 006 |
| `public/skills/novel-packaging/SKILL.md` + references/ | Agent 007 |
| `public/skills/novel-chapter-director/SKILL.md` + references/ | Agent 008 |
| `public/skills/novel-narrative-master/SKILL.md` + references/ | Agent 009 |
| `public/skills/novel-dialogue-expert/SKILL.md` + references/ | Agent 010 |
| `public/skills/novel-hook-designer/SKILL.md` + references/ | Agent 011 |
| `public/skills/novel-review-analyst/SKILL.md` + references/ | Agent 012 |
| `public/skills/novel-polish/SKILL.md` + references/ | Agent 013 |
| `public/skills/novel-scene-builder/SKILL.md` + references/ | Agent 015 |
| `public/skills/novel-conflict-builder/SKILL.md` + references/ | Agent 016 |
| `public/skills/novel-orchestrator/SKILL.md` | 新建总控 |
| `src/data/vaultTemplates.ts` | MODIFY: 添加 novel-writing 模板 |
| `src/stores/agentStore.ts` | MODIFY: 注册 16 个 preset_novel-* |

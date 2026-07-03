# 知识库内循环 v3 — 交接文档

> **写给下一个 AI 工具**：本方案已经过三轮迭代，确认后请按此执行。
> **最后更新**: 2026-07-01
> **⚠️ 2026-07-01 Claude 接手更新**：本文档所述"已完成/待完成"与实际不符（详见下），已按 v3.1 全部做实。
> **现行设计以 v3.1 为准**：`docs/sdd/knowledge-base-inner-loop-v3.1.md`（Claude 裁决版，回到 Karpathy 源头校准）。v3 原件 `docs/sdd/knowledge-base-inner-loop-v3.md` 保留作对照。

---

## 创始人的核心主张

1. **wiki 是给 LLM 用的**，不是给 Obsidian 用的。Obsidian 能打开是附带便利
2. **不需要一键建库**，目录由创作 skill 按需创建
3. **一个项目一个创作主力**，两个创作 skill 不共存
4. **yizhixing + jiyiyasuo 是标配**——巡检保一致性，压缩防失忆
5. **.raw/ 保留**，原料仓库，`.` 前缀让 Obsidian 不显示
6. **CLAUDE.md 三段式**，每个 skill 写自己区块
7. **参考 nashsu/llm_wiki** 的架构思路

---

## 当前进展（2026-07-01 Claude 复核后的真实状态）

> 原表所述与实际不符：JC-manjuxiezuo 声称"已重写"但仍用旧目录；JC-duanju-shijiemoxing 声称已完成但**运行时根本没安装**（跑的还是旧 manhua-script-agent）。以下为做实后的状态。

### ✅ v3.1 已完成（全部对齐 wiki/ + 补 log.md + 同步运行时）

| 项目 | 状态 |
|------|:--:|
| v3.1 设计文档（回 Karpathy 源头，补 log.md，裁决一键建库） | ✅ `docs/sdd/knowledge-base-inner-loop-v3.1.md` |
| JC-duanju-shijiemoxing | ✅ 已对齐 + 补 log.md + **补装进运行时**（原缺失） |
| JC-manjuxiezuo | ✅ 旧目录（角色档案/世界设定/剧情管理）→ `wiki/` + CLAUDE.md 区块 + log.md |
| JC-linmoxiaoshuo | ✅ `换皮工程/` → `wiki/映射表.md` `wiki/改写稿/` + log.md |
| JC-linmoduanju | ✅ `换皮工程/` `剧本正文/` → `wiki/` + log.md |
| novel-writing | ✅ 含糊的 Vault → 明确 `wiki/` 架构 + log.md |
| JC-yizhixing | ✅ 补第五步（存报告 + log.md + CLAUDE.md 区块） |
| JC-jiyiyasuo | ✅ 补 log.md + index.md 维护 + CLAUDE.md 区块 |
| kbCommandPresets.ts | ✅ 去掉临摹指令的"前置先一键建库"，改为 skill 自建目录 |
| 全部同步到 `~/.agents/skills/` 运行时 | ✅ 7 个 skill diff 一致 |

### 裁决记录（对 DeepSeek v3 的修正，详见 v3.1 文档第 2 节）

1. **加回 `log.md`**：v3 漏了 Karpathy 原版的时间线文件。固定前缀可 `grep` 秒查近况，是最便宜的防失忆手段。
2. **一键建库"保留但收窄"**：v3 要全砍太激进。创作 skill 自建目录，但律师案件库等结构化模板的一键建库保留。
3. **病根是"说了没做"**：设计没大问题，问题在落地。v3.1 主要工作就是把落地做实。

### ⏳ 可选后续（非阻塞）

| 项目 | 说明 |
|------|------|
| 旧 `manhua-script-agent` | 运行时仍在，已被 JC-duanju-shijiemoxing 取代，可择机移除 |
| vault-architect SKILL.md | 若仍导向"一键建库"，可按 v3.1 改为"按需指导创作 skill 建目录" |
| 工具仓库「一键建库」按钮 | 保留给结构化项目模板；创作类不再强制 |

---

## 目标

**打造一个不会丢失上下文、方便大模型检索的持久化创作系统，服务于四个创作 skill。**

四个创作 skill 是大模型续写长篇内容的发动机——但大模型有上下文窗口限制，写着写着就忘了前面。wiki 三层架构（`.raw/` 原料 + `wiki/` 检索 + `CLAUDE.md` 锚点）就是解决这个问题的：每次创作后把关键信息压缩进结构化检索空间，下次续写时精准加载，而不是全量塞进 prompt。

```
四个创作 skill（发动机）
  ├── JC-duanju-shijiemoxing  短剧世界模型
  ├── JC-linmoduanju         短剧临摹换皮
  ├── JC-linmoxiaoshuo       小说临摹换皮
  └── novel-writing          从零写小说
       │
       ▼ 产出内容
  wiki/ 结构化检索空间（防失忆）
       │
       ├── JC-yizhixing  巡检 → 保一致性
       └── JC-jiyiyasuo  压缩 → 提炼归档 × 刷新索引
```

一切设计——wiki 目录、CLAUDE.md 三段式、.raw/ 原料仓库、yizhixing 巡检、jiyiyasuo 压缩——都是为了让这四个创作 skill 能持久创作，不会因为上下文窗口限制而失忆。

---

## 参考

- `docs/sdd/knowledge-base-inner-loop-v3.md` — 完整 v3 设计文档
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — LLM 友好型 wiki 架构
- `public/skills/JC-duanju-shijiemoxing/SKILL.md` — 已完成改造的参考范例
- `public/skills/JC-yizhixing/SKILL.md` — 巡检官（在 `~/.agents/skills/` 下）
- `public/skills/JC-jiyiyasuo/SKILL.md` — 压缩官（在 `~/.agents/skills/` 下）

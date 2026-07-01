# 知识库内循环 v3 — 交接文档

> **写给下一个 AI 工具**：本方案已经过三轮迭代，确认后请按此执行。
> **最后更新**: 2026-07-01
> **相关文件**: `docs/sdd/knowledge-base-inner-loop-v3.md`（完整设计） / `public/skills/JC-duanju-shijiemoxing/SKILL.md`（已重写）

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

## 当前进展

### ✅ 已完成

| 项目 | 状态 |
|------|:--:|
| v3 设计文档 | ✅ `docs/sdd/knowledge-base-inner-loop-v3.md` |
| JC-duanju-shijiemoxing SKILL.md | ✅ 已按 v3 重写（`wiki/作品/` `wiki/角色/` `wiki/世界观/` `wiki/悬疑管理/`） |
| SKILL.md 改名 | ✅ manhua-script-agent → JC-duanju-shijiemoxing |
| skillCommands.json 同步 | ✅ 指令已更新 |
| index.json 同步 | ✅ 注册信息已更新 |
| llm_wiki 加入工具仓库 | ✅ `src/data/githubTools.json` |

### ❌ 待完成

| 项目 | 说明 |
|------|------|
| JC-linmoduanju SKILL.md | 按 v3 改造：产出 `wiki/改写稿/` + `wiki/映射表.md`，更新 CLAUDE.md |
| JC-linmoxiaoshuo SKILL.md | 同上 |
| JC-yizhixing SKILL.md | 按 v3 改造：巡检全库 → `wiki/巡检报告/`，更新 CLAUDE.md |
| JC-jiyiyasuo SKILL.md | 按 v3 改造：`.raw/` → `wiki/` 归档，补双链，刷新 `hot.md` `index.md`，更新 CLAUDE.md |
| vault-architect SKILL.md | 按 v3 更新：去掉「一键建库」导向，改为「按需指导创作 skill 创建目录」 |
| kbCommandPresets.ts | 指令模板同步更新（去掉建库相关，改为"从0写短剧"等） |
| 工具仓库「一键建库」按钮 | 考虑移除或改为"从0创建项目" |
| vaultTemplates.ts | 可选：简化模板，不再预建完整目录 |

---

## 目标

用户选择一个空文件夹作为项目目录 → 发送指令（如"从0写短剧"）→ 创作 skill 自动创建 `.raw/` + `wiki/作品/` 等目录 → 开始创作 → 写完几集后 yizhixing 巡检 → 不定期 jiyiyasuo 整理压缩。

整个流程用户不需要手动建目录，不需要点"一键建库"按钮。skill 按需创建，Obsidian 只是可选的可视化工具。

---

## 参考

- `docs/sdd/knowledge-base-inner-loop-v3.md` — 完整 v3 设计文档
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — LLM 友好型 wiki 架构
- `public/skills/JC-duanju-shijiemoxing/SKILL.md` — 已完成改造的参考范例
- `public/skills/JC-yizhixing/SKILL.md` — 巡检官（在 `~/.agents/skills/` 下）
- `public/skills/JC-jiyiyasuo/SKILL.md` — 压缩官（在 `~/.agents/skills/` 下）

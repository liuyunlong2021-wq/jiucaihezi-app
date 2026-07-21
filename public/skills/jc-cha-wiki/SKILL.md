---
name: jc-cha-wiki
description: Use when a user asks to find, explain, inspect, summarize, or visualize knowledge already stored in a project Wiki. Trigger on 查询Wiki, 查角色, 查设定, 查看状态, 知识库状态, 关系图, or 项目现在怎么样.
triggers:
  - 查询Wiki
  - 查询知识库
  - 查角色
  - 查设定
  - 查看状态
  - 知识库状态
  - 关系图
  - 项目现在怎么样
---

# JC Cha Wiki

## 作用

从已有 Wiki 找到并解释事实、当前状态或关系。它读取源文件，不改项目事实；仅在图形确实提升理解时生成 Canvas 等衍生产物。

## 判断标准

- 用户只表达目标，模型自主判断是检索事实、汇总状态、追溯来源，还是生成关系图；不要求用户选择模式。
- 先定位已有 `docs/wiki/`，其次 `wiki/`；只接管现有 Wiki，不新建平行库。
- 查询使用 Wiki 作为结论入口。用户要求完整过程或证据时，再按 `来源索引.md` 指向读取真实 Raw、原始文件、SDD、代码、Git 或测试证据。
- 默认只查现行知识：`hot.md`、`CLAUDE.md`、`架构/`、`开发/`、`运维/`、`排障/`、`学习/` 和 `巡检报告/`；只有用户明确追溯历史时才把 `归档/` 纳入结果。

## 执行流程

1. **定位**：确认项目已有的 `docs/wiki/` 或 `wiki/`，读取 `index.md`、`hot.md`、`CLAUDE.md` 和相关页面。
2. **判断**：选择最少的检索、状态统计、来源追溯或关系图能力；没有稳定关系时不生成图。
3. **输出**：按“结论、证据、风险、下一步”四段直接回答；没有风险或下一步时写“无”，不拿文件列表代替答案。关系图只写为衍生产物，不修改事实页。
4. **验证**：核对所引用页面和链接目标存在，说明实际读取范围与未验证项。

## 安全标准

- 查询不追加 `log.md`，不修改角色、剧情、架构、正文或其他业务事实。
- 不复制、不移动、不删除 Raw；不把完整会话或原文写进 Wiki。
- Canvas、状态报告等衍生产物必须可以从源页面重新生成，且不能成为唯一事实源。
- 发现事实冲突时如实列出来源，不自行裁决；需修正时交给 `jc-xiu-wiki`，需要填充结论时交给 `jc-raw-wiki`。

## Reference 索引

| 能力       | Reference                             |
| ---------- | ------------------------------------- |
| 检索与回答 | `references/能力标准/查询规范.md`     |
| 状态查询   | `references/能力标准/状态查询规范.md` |
| 关系图     | `references/能力标准/关系图规范.md`   |

## 脚本出口

- 默认现行检索：`python scripts/wiki_query.py search <项目根> <关键词>`。
- 追溯历史：追加 `--scope all`；结果过多时用 `--limit N`。
- 状态查询：`python scripts/wiki_query.py status <项目根>`，兼容当前 `架构/开发/运维` 目录。

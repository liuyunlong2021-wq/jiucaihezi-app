---
name: jc-xiu-wiki
description: Use when a user asks to correct a confirmed Wiki error, apply a Wiki inspection report, repair a deterministic link or name, or extend an existing Wiki structure. Trigger on 修正Wiki, 执行巡检修正, 修复断链, 改错, 新建分类, or Wiki架构扩展.
triggers:
  - 修正Wiki
  - 执行巡检修正
  - 修复断链
  - 改错
  - 新建分类
  - Wiki架构扩展
---

# JC Xiu Wiki

## 作用

修正已有 Wiki 的确定性错误，或搭建已确认的新结构。它不负责把 Raw 或散落内容提炼进 Wiki；那是 `jc-raw-wiki` 的职责。

## 判断标准

- 用户只表达目标，模型自主判断是执行已有巡检结论、修复确定性问题，还是扩展结构；不要求用户选择模式。
- 先定位已有 `docs/wiki/` 或 `wiki/`，读取对应项目语境、巡检报告和相关源页。项目语境统一读取 `jc-everything-wiki/references/项目语境/`，不维护重复副本。
- 报告或用户已给出唯一答案的机械修正可直接执行并验证；事实冲突、语义矛盾、正式稿判断、删除、移动或合并必须先征得用户确认。

## 执行流程

1. **盘点**：定位 Wiki、问题来源、受影响文件和现有项目结构。
2. **判断**：区分机械修正、需确认的语义修正与仅建骨架的结构扩展。
3. **预览**：先给出问题、依据和精确 diff；机械脚本必须传入 `--reason`、`--basis`，没有唯一依据时停止。
4. **修正**：仅修改能由来源确定的内容；结构扩展只创建目录、入口和索引，不迁移语义内容。
5. **回执**：输出受影响文件、修前/修后指纹和复查结果；再更新相应巡检记录与 `log.md`。预览不等于已修复。

## 安全标准

- Raw 不复制、不移动、不删除；不创建对话记录、会话摘要或聊天转录页。
- 不编造事实，不用“修正”名义填充正文或迁移内容；需要语义提炼、正式内容落位或大规模迁移时转交 `jc-raw-wiki`。
- 巡检报告不提供唯一答案时只报告差异并询问用户，不自行选择哪一方为真。
- 每次实际写入都需明确变更文件、依据和验证结果；预览不等于已修复。
- `apply_fix.py` 的 replace、link、scaffold 均默认 dry-run；实际执行后必须出现 `[修复回执]`，否则不能对用户声称完成。

## Reference 索引

| 能力         | Reference                             |
| ------------ | ------------------------------------- |
| 巡检问题修复 | `references/能力标准/巡检修正规范.md` |
| 架构扩展     | `references/能力标准/架构扩展规范.md` |

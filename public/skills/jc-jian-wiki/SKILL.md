---
name: jc-jian-wiki
description: Use when a user asks to inspect a project Wiki for consistency, broken links, missing relationships, contradictions, stale structure, or a health report. Trigger on 巡检Wiki, 一致性检查, 知识库体检, 查断链, 查矛盾, or 查有没有漏改.
triggers:
  - 巡检Wiki
  - 一致性检查
  - 知识库体检
  - 查断链
  - 查矛盾
  - 查有没有漏改
---

# JC Jian Wiki

## 作用

检查 Wiki 的结构、链接和跨页面一致性，产出可执行的巡检报告。它只查不改；报告中的修复交给 `jc-xiu-wiki`，内容填充交给 `jc-raw-wiki`。

## 判断标准

- 用户只表达目标，模型自主判断扫描范围、项目类型和需要启用的检查项；不要求用户选择检查模式。
- 先定位已有 `docs/wiki/`，其次 `wiki/`，再读取 `jc-everything-wiki/references/项目语境/` 中对应项目标准，按实际结构选择检查项。
- 机械检查由脚本辅助；语义矛盾由模型对比相关页面和已确认正文判断。任何矛盾只报告来源和差异，不替用户裁决。

## 执行流程

1. **盘点**：定位 Wiki，读取项目语境、`hot.md`、`来源索引.md` 与相关事实页；确认扫描范围。
2. **巡检**：运行必要的机械检查，并阅读涉及跨页面、跨章节或跨模块的关键事实。
3. **报告**：按严重度输出问题、证据位置、可确定的建议和未验证项；报告写到项目结构已有的巡检位置，未定义位置时只向用户输出，不擅自新建平行目录。
4. **交接**：确定性修复交给 `jc-xiu-wiki`；需要理解 Raw 或填充新结论时交给 `jc-raw-wiki`。

## 安全标准

- **只查不改**：不修复断链、不补索引、不改正文、不更新业务 `log.md`、`hot.md` 或 `CLAUDE.md`。
- Raw 不复制、不移动、不删除；不创建会话副本、摘要页或聊天转录页。
- 巡检报告是派生检查结果，不替代项目事实；事实冲突必须保留双方来源和不确定性。
- 不把某一种创作项目的检查项强加给开发、广告或通用资料；只检查对应项目语境确实存在的结构。

## Reference 索引

| 能力             | Reference                         |
| ---------------- | --------------------------------- |
| 检查项与报告标准 | `references/能力标准/巡检清单.md` |

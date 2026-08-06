---
name: jc-xiu-wiki
description: Use when a user asks to precisely repair an already confirmed Wiki error in one existing Markdown file, such as a typo, name, value, or wrong Wiki target. Trigger on 修正Wiki, 执行已确认修正, 修复确定性断链, or 改错. Do not use for querying, inspection, new facts, structure planning, or page lifecycle changes.
---

# JC Xiu Wiki

只执行已经确认答案的机械精确修正，不替用户判断哪个事实正确。

## 输入合同

每项修正必须同时有：

- 一个明确 Markdown 文件路径（必须位于现有 Wiki 内）
- 唯一旧值和唯一新值
- `reason`（为什么错）和 `basis`（依据：用户决定或可靠证据）

缺少任一项，或需要重写/创作自然语言，停止并转交：结构规划给 `jc-everything-wiki`，新事实给 `jc-raw-wiki`，问题发现和复检给 `jc-jian-wiki`。

## 执行合同

1. 用 App 原生 `wiki` 工具的 `replace`，先 `apply: false` 预览目标文件、行号、命中数、旧值和新值。
2. 目标必须是当前 Wiki 内的 Markdown 文件；禁止省略路径、跨 Wiki 或修改 Canvas/Bases/日志等衍生产物。
3. 单文件多处命中默认停止；只有用户明确确认全部命中都要改时才传 `replaceAll: true`。
4. 用户批准预览后才传 `apply: true`，一次只写一个文件。
5. 写后重新读取同一文件，确认新值存在、旧值按合同消失，并回报修前/修后指纹和验证结果。

不复制 Raw，不扫描 Raw、不填充新事实、不规划目录、不移动、不重命名、不删除、不合并页面，也不要默认修改 `hot.md`、`log.md`、巡检报告或来源索引。

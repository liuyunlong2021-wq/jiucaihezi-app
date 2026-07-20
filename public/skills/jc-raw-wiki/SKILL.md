---
name: jc-raw-wiki
description: Use when a user asks to fill, update, maintain, or refresh a project Wiki from recent writing, development work, conversations, Raw material, documents, or verified evidence. Trigger on 填充Wiki, 整理记忆体, 更新知识库, 刷新热缓存, 开发收尾, 续写前整理, or 我刚写完/做完一段内容.
triggers:
  - 填充Wiki
  - 整理记忆体
  - 更新知识库
  - 刷新热缓存
  - 开发收尾
  - 续写前整理
  - 我刚写完
  - 我刚开发完
---

# JC Raw Wiki

## 作用

将项目新产生的事实、内容和证据沉淀进 Wiki。Raw 保存完整过程；Wiki 保存可复用结论、结构和导航。

## 判断标准

- 用户只表达目标；模型自主判断内容、项目和既有 Wiki 对应的语境与能力。
- 模型可组合内容填充、来源索引、双链、热缓存、Canvas、Bases、资料摄入、催化提取和开发收尾；不把能力选择交给用户。
- 没有 Wiki 时调用 `jc-everything-wiki` 建立骨架；已有 Wiki 时接管现有结构。

## 类型 -> Reference

叙事和广告项目必须读取 `jc-everything-wiki/references/项目语境/` 中的同名 Reference；不使用通用故事语境替代具体项目标准。

| 类型            | 必读 Reference  |
| --------------- | --------------- |
| `dev_project`   | `开发项目.md`   |
| `novel`         | `小说项目.md`   |
| `manju`         | `漫剧项目.md`   |
| `short_story`   | `短故事项目.md` |
| `film`          | `电影项目.md`   |
| `tv_series`     | `电视剧项目.md` |
| `advertisement` | `广告项目.md`   |
| `generic`       | `通用资料.md`   |

`novel` 写入前还必须读取 `jc-everything-wiki/references/项目语境/小说项目.md` 的“Raw 填充标准”；它规定事实落位、双链、来源范围和不复制会话的边界。

`manju` 写入前还必须读取 `jc-everything-wiki/references/项目语境/漫剧项目.md` 的“Raw 填充标准”；它规定事实落位、双链、来源范围和不复制会话的边界。

`short_story` 写入前必须读取 `jc-everything-wiki/references/项目语境/短故事项目.md` 的“Raw 填充标准”。

`film` 写入前必须读取 `jc-everything-wiki/references/项目语境/电影项目.md` 的“Raw 填充标准”。

`tv_series` 写入前必须读取 `jc-everything-wiki/references/项目语境/电视剧项目.md` 的“Raw 填充标准”。

`advertisement` 写入前必须读取 `jc-everything-wiki/references/项目语境/广告项目.md` 的“Raw 填充标准”。

`generic` 写入前必须读取 `jc-everything-wiki/references/项目语境/通用资料.md` 的“Raw 填充标准”。

`dev_project` 写入前还必须读取 `jc-everything-wiki/references/项目语境/开发项目.md` 的“Raw 填充标准”；它规定开发事实落位、证据范围和不复制原始材料的边界。

## 执行流程

1. **盘点**：读取本轮内容、现有 Wiki、Raw 和可用证据；必要时运行 `digest_raw.py inspect`。
2. **判断**：识别项目类型，先读取类型 -> Reference 中对应的项目标准，再选择必要的能力标准与目标页面。
3. **写入**：按命中的标准更新 Wiki、来源索引及必要的派生内容；项目标准要求双链/回链时必须创建。
4. **验证**：核对实际文件与来源；必要时运行 `digest_raw.py validate`，报告更新、证据和未验证项。

## 输出标准

- 写入有来源的结论，重要结论可从 `来源索引.md` 回到 Raw、原始文件、SDD、代码、Git 或测试证据。
- 产物符合命中的项目语境和能力标准；项目标准要求的双链/回链必须生成，Canvas、Bases 等其它派生内容仅在确实提升检索或理解时生成。
- `hot.md` 只保留当前必要事实；`log.md` 只追加事实；`CLAUDE.md` 只保留稳定入口和长期结构。
- 完成后如实报告实际更新、证据和未验证项。

## 安全标准

- Raw 不复制、不移动、不删除。
- 不整篇覆盖用户正文，不编造事实，不创建平行 Wiki。
- 事实冲突、不可逆操作、正式稿判定或权限不足时才询问用户。

## Reference 索引

| 层级     | Reference                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目语境 | `jc-everything-wiki/references/项目语境/开发项目.md`、`jc-everything-wiki/references/项目语境/小说项目.md`、`jc-everything-wiki/references/项目语境/漫剧项目.md`、`jc-everything-wiki/references/项目语境/短故事项目.md`、`jc-everything-wiki/references/项目语境/电影项目.md`、`jc-everything-wiki/references/项目语境/电视剧项目.md`、`jc-everything-wiki/references/项目语境/广告项目.md`、`jc-everything-wiki/references/项目语境/通用资料.md` |
| 能力标准 | `能力标准/Raw与来源索引.md`、`内容填充.md`、`双链与Obsidian.md`、`热缓存.md`、`Canvas关系图.md`、`Bases统计表.md`、`资料摄入.md`、`催化提取.md`、`开发阶段收尾.md`                                                                                                                                                                                                                                                                                 |

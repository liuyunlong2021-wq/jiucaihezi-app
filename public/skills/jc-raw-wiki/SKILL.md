---
name: jc-raw-wiki
description: Use when a Jiucaihezi user explicitly asks to write confirmed information from specified files, pages, URLs, or the current conversation into an existing project Wiki. Trigger on 填充Wiki, 更新Wiki, 写入Wiki, 沉淀到Wiki, 把本轮结论写进Wiki, or 用这些文件更新知识库.
---

# JC Raw Wiki

把用户指定范围内新增的、已确认且后续会复用的信息，增量沉淀进已有 Wiki。

1. 确定来源：使用用户指定的文件、页面、URL 或对话范围；用户明确说“本轮”时只使用当前对话。范围会改变结果时先问一个问题，不得默认扫描全部 Raw、项目文件或历史对话。
2. 定位现有 Wiki 根目录，沿用实际目录结构；读取指定来源、相关目标页、直接父目录 `_index.md` 和 `来源索引.md`，不读取固定必读页。
3. 将候选信息分为新增、更新、重复、冲突和过程信息；只写新增或用户已确认的更新。
4. 优先增量更新已有页面，不整篇覆盖。分类明确但页面缺失时可创建最小页面并更新直接父目录 `_index.md`；缺少合适分类时先交给 `jc-everything-wiki` 规划。
5. 每个重要结论定位到真实 Wiki 章节，并登记来源角色、真实来源、已处理范围、写入时指纹和记录时间。项目内来源先用 App 原生 `wiki evidence` 按原始字节取得完整 SHA-256；无法计算时写 `未计算（原因）`。原件和 Markdown 可读副本分行登记，模型生成文本不能冒充事实来源。
6. 正文写入成功后，才向 `来源索引.md` 增量增加对应行；重复映射不重复写。当前状态确实变化时才更新 `hot.md`，发生实际写入时才向 `log.md` 追加事实，不修改 CLAUDE。
7. 写后重新读取受影响文件和来源索引，报告实际写入、来源、冲突和未处理项。

- Raw 不复制、不移动、不删除；不复制完整会话、原文或附件内容。
- 不编造事实，不把参考资料写成项目已确认事实，不创建平行 Wiki。
- 事实冲突、正式稿无法判断或需要移动、合并、删除时，停止并请用户决定。

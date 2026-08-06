---
name: jc-cha-wiki
description: Use when a Jiucaihezi user asks to answer questions from an existing project Wiki about project facts, company rules, current status, history, counts, comparisons, or an explicit relationship graph. Trigger on 查询Wiki, 查角色, 查设定, 项目现在怎么样, 统计Wiki, or 关系图. Do not use for general web search or general knowledge outside the Wiki.
---

# JC Cha Wiki

从已有 Wiki 找到可信答案；默认只读。

1. 定位当前项目唯一的 Wiki；同时存在 `wiki/` 与 `docs/wiki/` 时请用户确认，不读取固定必读页。
2. 从问题提取实体、事项、属性和时间，先选 1-3 个辨识度高的短词分别检索；不足时再补同义词、旧称、文件名或路径词。
3. 搜索结果只是候选。读取原页面中支持答案的段落；只有引用页或反向引用会改变答案时，才继续读取一层相关页面。
4. 查到足够证据就停止。用户要求全面盘点时才扩大范围，并说明实际读取边界。
5. 直接回答问题并标出真实 Wiki 页面，重要结论精确到 Wiki 章节。公司或项目专属的重要结论还要查询 `来源索引.md` 的相关行：有映射时附原始来源和已处理范围；没有时标明“原始来源未登记或登记不完整”。来源记录不等于权威结论。
6. 当前与历史按页面语义判断；多页冲突时并列证据，不自行裁决；没有依据时明确说 Wiki 未记录。
7. 公司或项目专属问题不得用训练知识补成项目事实；通用知识有帮助时，与 Wiki 记录分开说明。

- 默认只读：不扫描 Raw、附件、项目全部文件、历史会话或互联网，不更新 `hot.md`，不追加 `log.md`，不补链或修改事实页。
- 不为回答补写来源索引；默认简洁引用，用户追问时再展开来源范围和指纹。
- 统计依据实际页面内容和明确口径；只有用户明确要求保存时才写 Markdown 派生报告。
- 只有用户明确要求关系图且存在稳定关系时才生成局部 `.canvas`；使用真实文件节点和内部链接，不生成全库图，不静默覆盖已有布局。
- 当前不生成 `.base`；需要沉淀、规划、巡检或修正时，分别交给对应 Wiki Skill。

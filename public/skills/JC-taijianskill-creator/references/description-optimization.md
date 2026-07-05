# Description 优化指南

description 是 SKILL.md frontmatter 中的核心字段——它决定了模型是否触发该 Skill。本文档描述如何在对话中优化 description。

## 触发机制

模型看到的是 `available_skills` 列表，每条包含 name + description。模型根据 description 判断是否需要查阅该 Skill。

**关键洞察**：模型只对"自己难以独立完成"的任务查阅 Skill。简单的单步查询（如"读取这个 PDF"）即使 description 完全匹配也可能不触发，因为模型能直接用基础工具处理。复杂、多步骤、专业化的查询才会可靠触发。

## 优化流程（对话模拟版）

### 第1步：生成触发测试查询

创建 20 个测试查询，混合 should-trigger 和 should-not-trigger：

```json
[
  {"query": "用户 prompt", "should_trigger": true},
  {"query": "另一个 prompt", "should_trigger": false}
]
```

**should-trigger 查询（8-10个）**：
- 覆盖不同的表达方式（正式/口语化/缩写/错别字）
- 包含不明确提 Skill 名但明显需要它的情况
- 加入不太常见的使用场景
- 加入该 Skill 可能与其他 Skill 竞争但应胜出的场景

**should-not-trigger 查询（8-10个）**：
- **最有价值的是边界案例**：共享关键词或概念但实际需要不同能力的查询
- 相邻领域、模糊表达、看似相关实则无关的场景
- **避免明显无关的查询**：如对一个 PDF Skill 的负面测试写"写斐波那契函数"——太简单，没有测试价值

**好的测试查询**应该有具体细节：文件名、列名、公司名、个人信息、一点背景故事。以小写为主，可以有缩写、拼写错误、口语化表达。不同长度混合。例如：

❌ 差：`"格式化这些数据"`
✅ 好：`"ok 老板刚给我发了这个 xlsx（在下载文件夹里，叫 Q4销售终稿 FINAL v2.xlsx），让我加一列显示利润率百分比。收入在 C 列成本在 D 列吧好像"`

### 第2步：与用户一起审查

展示测试集给用户确认。这是关键步骤——糟糕的测试查询导致糟糕的 description。

### 第3步：对话中运行优化

由于无法执行脚本，优化在对话中进行：

1. **模拟触发测试**：对每个查询，让 LLM 判断"如果 description 是 X，这个 Skill 会被触发吗？"
2. **统计分数**：计算准确率（should-trigger 触发率 + should-not-trigger 未触发率）
3. **分析失败案例**：对每个失败的查询，分析原因
4. **改进 description**：根据失败案例重写 description
5. **重新测试**：用新 description 再跑一轮
6. **迭代 3-5 轮**：直到分数稳定或用户满意

### 第4步：应用结果

取最佳 description，更新 SKILL.md frontmatter。展示 before/after 对比和分数变化。

## 优化原则

1. **要"推"一点**：模型倾向于不触发 Skill，所以 description 应该覆盖更多触发场景
2. **包含触发词**：在 description 中列举用户会说的关键词和场景
3. **不要太宽泛**：否则会误触发，干扰其他 Skill
4. **用实际查询验证**：不要靠直觉，用测试数据说话
5. **60/40 分割**：60% 查询用于优化（train），40% 用于验证（test），避免过拟合

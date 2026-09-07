# 事后分析代理

分析盲测比较结果，理解获胜方胜出的原因，并生成改进建议。

## 角色

盲测比较器确定获胜方后，事后分析器通过检查 Skill 与转录记录来“解除盲测”。目标是提取可执行的洞见：获胜方为何更好，以及如何改进落败方。

## 输入

你会在提示词中收到以下参数：

- **winner**："A" 或 "B"（来自盲测比较）
- **winner_skill_path**：生成获胜输出的 Skill 路径
- **winner_transcript_path**：获胜方的执行转录记录路径
- **loser_skill_path**：生成落败输出的 Skill 路径
- **loser_transcript_path**：落败方的执行转录记录路径
- **comparison_result_path**：盲测比较器输出 JSON 的路径
- **output_path**：保存分析结果的位置

## 流程

### 第 1 步：读取比较结果

1. 读取 comparison_result_path 中盲测比较器的输出
2. 记录获胜方（A 或 B）、判断理由和分数
3. 理解比较器看重获胜输出的哪些方面

### 第 2 步：读取两个 Skill

1. 读取获胜 Skill 的 SKILL.md 及关键引用文件
2. 读取落败 Skill 的 SKILL.md 及关键引用文件
3. 识别结构性差异：
  - 指令的清晰度和具体程度
  - 脚本/工具的使用方式
  - 示例覆盖范围
  - 边界情况处理

### 第 3 步：读取两份转录记录

1. 读取获胜方的转录记录
2. 读取落败方的转录记录
3. 对比执行模式：
  - 各自遵循 Skill 指令的程度如何？
  - 使用了哪些不同工具？
  - 落败方在哪些地方偏离了更优行为？
  - 任一方是否遇到错误或尝试恢复？

### 第 4 步：分析指令遵循情况

对每份转录记录评估：
- 代理是否遵循了 Skill 的明确指令？
- 代理是否使用了 Skill 提供的工具/脚本？
- 是否错过了利用 Skill 内容的机会？
- 代理是否增加了 Skill 中没有的无必要步骤？

为指令遵循情况打 1-10 分，并记录具体问题。

### 第 5 步：识别获胜方优势

判断获胜方为何更好：
- 更清晰的指令是否带来了更好的行为？
- 更好的脚本/工具是否带来了更好的输出？
- 更全面的示例是否指导了边界情况？
- 错误处理指引是否更好？

请具体说明。相关时引用 Skill 或转录记录内容。

### 第 6 步：识别落败方弱点

判断是什么阻碍了落败方：
- 模糊指令是否导致次优选择？
- 缺少工具/脚本是否迫使其绕行？
- 边界情况覆盖是否存在缺口？
- 不佳的错误处理是否造成失败？

### 第 7 步：生成改进建议

根据分析，为改进落败 Skill 提出可执行建议：
- 应进行的具体指令修改
- 要添加或修改的工具/脚本
- 应包含的示例
- 应处理的边界情况

按影响力排序，聚焦那些本可改变比较结果的改动。

### 第 8 步：写入分析结果

将结构化分析保存到 `{output_path}`。

## 输出格式

按以下结构写入 JSON 文件：

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors",
    "Explicit guidance on fallback behavior when OCR fails"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process the document appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise and made errors",
    "No guidance on OCR failure, agent gave up instead of trying alternatives"
  ],
  "instruction_following": {
    "winner": {
      "score": 9,
      "issues": [
        "Minor: skipped optional logging step"
      ]
    },
    "loser": {
      "score": 6,
      "issues": [
        "Did not use the skill's formatting template",
        "Invented own approach instead of following step 3",
        "Missed the 'always validate output' instruction"
      ]
    }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process the document appropriately' with explicit steps: 1) Extract text, 2) Identify sections, 3) Format per template",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    },
    {
      "priority": "high",
      "category": "tools",
      "suggestion": "Add validate_output.py script similar to winner skill's validation approach",
      "expected_impact": "Would catch formatting errors before final output"
    },
    {
      "priority": "medium",
      "category": "error_handling",
      "suggestion": "Add fallback instructions: 'If OCR fails, try: 1) different resolution, 2) image preprocessing, 3) manual extraction'",
      "expected_impact": "Would prevent early failure on difficult documents"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script -> Fixed 2 issues -> Produced output",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods -> No validation -> Output had errors"
  }
}
```

## 指南

- **具体说明**：引用 Skill 和转录记录，不要只说“指令不清晰”。
- **可执行**：建议应是具体改动，而非笼统意见。
- **聚焦 Skill 改进**：目标是改进落败 Skill，不是批评代理。
- **按影响力排序**：哪些改动最可能改变结果？
- **考虑因果关系**：Skill 的弱点是否确实导致更差输出，还是偶然因素？
- **保持客观**：分析实际发生的事，不作主观评论。
- **考虑泛化**：该改进是否也有助于其他 eval？

## 建议分类

使用以下分类组织改进建议：

| 分类 | 说明 |
|----------|-------------|
| `instructions` | 对 Skill 文字指令的修改 |
| `tools` | 要添加或修改的脚本、模板或工具 |
| `examples` | 要加入的输入/输出示例 |
| `error_handling` | 处理失败的指引 |
| `structure` | 对 Skill 内容的重组 |
| `references` | 要添加的外部文档或资源 |

## 优先级

- **high**：很可能改变本次比较结果
- **medium**：会提升质量，但未必改变胜负
- **low**：锦上添花，影响有限

---

# 分析基准测试结果

分析基准测试结果时，分析器的目标是**呈现模式和异常**，而不是提出 Skill 改进建议。

## 角色

审阅所有基准运行结果，生成帮助用户理解 Skill 性能的自由格式备注。聚焦汇总指标本身无法看出的模式。

## 输入

你会在提示词中收到以下参数：

- **benchmark_data_path**：包含全部运行结果的进行中 benchmark.json 路径
- **skill_path**：正在进行基准测试的 Skill 路径
- **output_path**：保存备注的位置（字符串组成的 JSON 数组）

## 流程

### 第 1 步：读取基准数据

1. 读取包含所有运行结果的 benchmark.json
2. 记录被测试的配置（with_skill、without_skill）
3. 理解已经计算好的 run_summary 汇总结果

### 第 2 步：分析逐断言模式

对所有运行中的每项期望：
- 是否在两种配置下都**始终通过**？（可能无法体现 Skill 的价值）
- 是否在两种配置下都**始终失败**？（可能有问题或超出能力范围）
- 是否**使用 Skill 时始终通过、未使用时失败**？（Skill 在此处明确带来价值）
- 是否**使用 Skill 时始终失败、未使用时通过**？（Skill 可能有负面影响）
- 是否**波动很大**？（期望不稳定或行为非确定）

### 第 3 步：分析跨 Eval 模式

寻找跨 eval 的模式：
- 某些 eval 类型是否始终更难/更容易？
- 是否有些 eval 方差很高而其他稳定？
- 是否存在与预期相悖的结果？

### 第 4 步：分析指标模式

查看 time_seconds、tokens、tool_calls：
- Skill 是否显著增加执行时间？
- 资源使用是否存在高方差？
- 是否有离群运行扭曲了汇总结果？

### 第 5 步：生成备注

将自由格式观察写成字符串列表。每条备注应：
- 陈述一个具体观察
- 基于数据而非猜测
- 帮助用户理解汇总指标未呈现的信息

示例：
- “断言‘输出为 PDF 文件’在两种配置下均 100% 通过，可能无法区分 Skill 价值”
- “Eval 3 的方差很高（50% ± 40%），第 2 次运行出现了可能不稳定的异常失败”
- “未使用 Skill 的运行始终未通过表格提取期望（通过率 0%）”
- “Skill 平均增加 13 秒执行时间，但通过率提升 50%”
- “使用 Skill 时 Token 用量高出 80%，主要来自脚本输出解析”
- “Eval 1 的 3 次未使用 Skill 运行均产生空输出”

### 第 6 步：写入备注

将备注以字符串组成的 JSON 数组保存到 `{output_path}`：

```json
[
  "Assertion 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
  "Eval 3 shows high variance (50% ± 40%) - run 2 had an unusual failure",
  "Without-skill runs consistently fail on table extraction expectations",
  "Skill adds 13s average execution time but improves pass rate by 50%"
]
```

## 指南

**应当：**
- 报告数据中实际观察到的内容
- 明确指出涉及哪些 eval、期望或运行
- 标记汇总指标会掩盖的模式
- 提供有助于解释数字的上下文

**不得：**
- 提出改进 Skill 的建议（这是改进步骤的职责，不是基准分析）
- 作出主观质量判断（如“输出好/坏”）
- 在没有证据时推测原因
- 重复 run_summary 汇总中已有的信息

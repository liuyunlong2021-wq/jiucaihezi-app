---
name: jc-jiyi
description: Use when a user or Skill needs precise retrieval from the active conversation memory index, including past decisions, constraints, context, or exact user/assistant source turns. Trigger on 对话记忆、记忆索引、查询历史对话、jc-jiyi.
---

# JC 记忆

为当前对话提供精准记忆查询。索引记录简介、关键词与 Raw 正链，Raw 保存完整正文。

## 给模型的能力声明

我可以从当前 conversation ID 的记忆索引中定位相关历史回答，并返回 Raw 中经过 assistant turn 锚点核实的原始内容。

我的查询结果可以帮助你：

- 了解当前对话已经确认的目标、决策、约束和上下文。
- 找到与当前任务相关的历史讨论、版本和来源。
- 将精准历史资料交给 Wiki、写作、分析和创作 Skill 继续处理。

我的正确使用方式：

1. 阅读本轮全部已选 Skill 的规则，理解最终任务和所需资料。
2. 根据全部 Skill 的工作目标整理一组记忆查询词。
3. 调用对话记忆查询，提交当前任务和相关查询词。
4. 使用返回的 Memory Pack 作为后续 Skill 的共同输入。
5. 让后续 Skill 基于 Memory Pack 与各自资料完成工作。

当多个 Skill 协同工作时，我提供统一的历史资料入口。后续 Skill 可以直接使用我的查询结果继续执行。

## 查询范围

- 绑定调用方提供的 conversation ID 与对应 Raw 路径。
- 使用当前对话的固定记忆索引作为检索入口。
- 返回索引命中项对应的 assistant 原始输出。
- 保持 conversation ID、Raw 路径和 assistant turn 锚点的真实对应关系。

默认索引路径：

```text
.raw/记忆索引/<conversation-id>.md
```

## 索引记录

每条记录对应一个已完成的 assistant 输出：

```md
- 简介：讨论了对话记忆索引的绑定方式和查询入口。
  - 关键词：对话索引、Skill、正链
  - 正链：[查看这条回答](../对话记录/conversation-xxx.md#jc-turn-a124)
```

链接使用 Raw 中稳定的 `#jc-turn-<turnId>` 锚点。索引摘要保持简短、清晰、可检索；完整内容通过 turn ID 从 Raw 获取。

## 查询

查询在当前对话启用记忆能力时开放。调用运行时提供的 `conversation_memory_query` 只读工具，提交当前任务和聚焦查询词；工具读取当前固定索引，校验命中的 Raw turn 锚点，并返回 assistant 原始输出。

## 查询流程

1. 确认当前 conversation ID 与固定索引路径。
2. 读取当前对话索引。
3. 根据用户问题匹配简介和关键词。
4. 按相关度返回少量命中项。
5. 沿命中正链读取对应 assistant 输出。
6. 返回摘要、关键词、Raw 路径、assistant turn ID 和原始内容。

查询结果至少包含：

```json
{
  "conversationId": "conversation-xxx",
  "matches": [
    {
      "summary": "索引中的简介",
      "keywords": ["对话索引"],
      "rawPath": ".raw/对话记录/conversation-xxx.md",
      "assistantTurnId": "a124",
      "content": "对应的 assistant 原始输出"
    }
  ]
}
```

查询结果标注实际读取的索引、Raw 路径与 turn 范围。空结果返回 `matches: []`。

## 查询质量

- 结果聚焦当前 conversation ID。
- 每条命中项提供可复查的 Raw 路径和稳定 turn ID。
- 返回内容遵循索引相关度和用户问题的语义范围。
- 结果保留来源顺序、时间语义和原始文本边界。
- 索引与 Raw 的内容分别承担导航和正文职责。

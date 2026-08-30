# 通用记忆工作台 Agent Loop 定向增强与清理 TDD-SA4

> 日期：2026-08-30  
> 分支：`codex/0830-skill-first-agent`  
> 前置：SA1、SA2、SA3  
> 状态：SA4-T1 已实施，SA4-T2 待执行

## 目标

只借鉴 OpenClaw Agent Loop 已验证的循环边界，不复制 Runtime，不新建 Agent 或
第二套执行器。现有 `runDirectChatCompletion` 继续作为唯一循环主体。

## 循环合同

1. **取消收口**：收到 `AbortSignal` 后不再发起新的模型请求或工具执行；已经产生
   `tool_calls` 的助手消息必须为每个调用保留对应的 `tool` 结果消息。
2. **Observation 配对**：每个已接收的工具调用都生成一个成功、失败或取消结果；
   结果顺序与模型调用顺序一致。
3. **重复调用保护**：同一失败工具调用不得原样连续重试；模型必须换参数、换工具
   或直接回答。
4. **请求与工具上限**：模型请求数和工具轮次有明确上限；达到上限后只允许一次
   无工具最终回答，不能继续扩张工具权限。
5. **并发顺序**：互不依赖的只读调用可以并发，但写入、审批和依赖读取的调用仍是
   串行屏障；返回结果保持调用顺序。

## SA4-T1：取消与 Observation 配对

### RED

- 并发只读批次中途取消时，助手 `tool_calls` 数量必须等于后续 `tool` 结果数量。
- 取消后的未启动调用生成取消 Observation，不执行副作用。
- 取消后不再发起下一轮模型请求。

### GREEN

- 复用 `buildToolResultMessages` 的现有消息构造和事件回调。
- 取消只改变当前调用结果为 `cancelled`，由外层循环在下一检查点收口。
- 不新增全局状态、队列或执行器。

## SA4-T2：统一 Wiki 路由

在 SA4-T1 回归通过后，`runMemoryChat` 统一进入 Skill-first 循环；保留 Wiki 入口
预读和现有工具白名单，确认回归后再删除 `runWikiTwoPhase`、`wikiPlans` 及文件
Agent 用户模式。底层文件工具继续保留。

## SA4-T1 实施记录（2026-08-30）

- `buildToolResultMessages` 在取消后为当前及剩余调用保留配对 `tool` 结果。
- 已取消的尾部调用不进入执行器、不触发工具启动事件；外层循环下一检查点收口。
- 定向回归：`directTools` 与 `directEngine` 共 `51/51` 通过；`vue-tsc -b` 通过。
- 未提前删除 `runWikiTwoPhase`、`wikiPlans` 或文件工具，等待 SA4-T2 统一路由回归。

## 验收门禁

- `directTools`、`directEngine`、`memoryToolRouting` 定向回归通过。
- SA1 四种能力组合、本地/云端模型和 Desktop/Web/Mobile 矩阵通过。
- 删除兼容路径前必须先确认 Wiki-only 渐进读取和写入回执不回退。

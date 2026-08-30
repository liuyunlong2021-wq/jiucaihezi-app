# 通用记忆工作台统一工具白名单与 Tool Search TDD-SA3

> 日期：2026-08-30  
> 分支：`codex/0830-skill-first-agent`  
> 前置：SA2 `8fc32d4c`  
> 状态：T1/T2 已实施；T3 待执行

## 目标

在现有白名单、MCP 桥接和 `runDirectChatCompletion` 循环之上，增加最小的工具目录搜索与精确描述能力。搜索结果只能来自当前请求已经授权的工具定义；工具执行仍由现有白名单和执行器决定。

## 合同

1. 工具目录只接受当前运行实例的已授权定义，不读取全局缓存，不接受模型伪造的工具 ID。
2. 搜索按工具名和描述匹配，返回稳定顺序、有限数量的 `{name, description}` 摘要。
3. 精确描述只返回目录中存在且已授权的完整 schema；未知名称返回空结果，不执行调用。
4. `tool_search` 和 `tool_describe` 本身不产生项目副作用，不绕过 `beforeToolCall`、审批和参数校验。
5. MCP 仍按已连接服务器和当前暴露工具授权；搜索不能扩大 MCP 权限。

## TDD 顺序

### SA3-T1：目录搜索与描述

- 查询工具名、描述和大小写变体能命中；空查询返回稳定的前 N 项。
- 结果只来自传入工具定义，重复名称去重。
- 描述未知工具返回 `null`，不返回其他同名或近似工具。

验证：`toolSearch` 定向测试、`git diff --check`。

实施记录（2026-08-30）：新增 `searchToolDefinitions` 与 `describeToolDefinition`，只在传入的当前工具定义中搜索，按名称去重并对未知名称返回 `null`。聚焦回归 `1222/1222` 通过。

### SA3-T2：Agent Loop 接入

- 首轮只暴露核心工具与 `tool_search`/`tool_describe`；搜索后仅把精确描述的工具加入后续请求。
- 后续调用必须经过当前白名单、审批和现有执行器；跨会话或伪造名称被拒绝并返回 Observation。

验证：`directEngine` 与 `memoryToolRouting` 回归，四种 SA1 组合保持通过。

实施记录（2026-08-30）：显式能力任务首轮只开放 `wiki_context`（若已授权）以及 `tool_search`、`tool_describe`；模型通过精确描述后，该工具 schema 才进入下一轮。所有执行继续经过现有白名单、审批和执行器。聚焦回归 `1224/1224`、`vue-tsc -b`、`git diff --check` 均通过。

### SA3-T3：MCP 与三端矩阵

- MCP 搜索结果只包含当前连接且已选择的服务器工具。
- Web、Desktop、Mobile 不广告不可用工具；执行失败、未连接和未授权结果可见。

验证：MCP bridge、Web/Desktop 工具定义测试和真实模型矩阵。

## 完成标准

- T1/T2/T3 全部通过后，才进入 SA4 Agent Loop 定向增强。
- 不复制 OpenClaw Runtime，不新增第二个 Agent 或第二套执行器。

# 创模式 MCP 工具接入 SDD

> 日期：2026-07-18
> 状态：已实现；真实 GitHub MCP 与 Web SSE 人工验收待补
> 范围：只升级创模式的工具来源；文模式、武模式、OpenCode、MCP 连接层本身不改。

## 1. 背景

创模式（[[开发/创作模式双端统一SDD]]）现在的工具清单固定写死在 `src/runtime/direct/creativeToolContract.ts` 的 `CREATIVE_PROJECT_TOOL_DEFINITIONS` 里：`skill`、`read`、`glob`、`grep`、`write`、`edit`、`terminal`，一共 7 个。想加一个新能力（比如让模型能查 GitHub issue、建 PR），只能改这份代码、重新发版。

文/武模式（OpenCode 引擎）已经有一套成熟的 MCP 桥接：`src/stores/mcpStore.ts` 管理已连接的 MCP server 和它们暴露的工具，`src/runtime/tools/mcpBridge.ts` 把这些工具转成 chat completion 的 `tools` 定义并负责路由执行，`src/runtime/connection/toolConnectionAdapter.ts` 在组装文/武工具清单时把 `getMcpBridgeToolDefinitions(...)` 的结果并入。用户在设置里配置一个 MCP server（比如 `github-mcp-server`），文/武模式立刻能用，不用改一行 App 代码。

这次要解决的问题只有一个：**创模式的硬编码工具清单，改成能复用文/武模式已经跑通的 MCP 桥接**，不引入新的工具体系,也不去动 MCP 连接层本身。

## 2. 现状代码事实（已读代码确认，不是猜测）

### 2.1 创模式工具执行链路

```text
creativeChat.ts (Desktop) / chatCloud.ts (Web)
  -> CREATIVE_PROJECT_TOOL_DEFINITIONS（creativeToolContract.ts，固定 7 个工具的 schema）
  -> runDirectChatCompletion（directEngine.ts，工具循环）
  -> executeTool -> projectTools(call)（desktopProjectTools.ts / webProjectTools.ts）
       -> if (name === 'skill' | 'read' | 'glob' | ...) { ... } else throw new Error('Unsupported tool')
```

`desktopProjectTools.ts` 和 `webProjectTools.ts` 的执行器都是一串 `if (name === 'xxx')` 分支，最后 `throw new Error('Unsupported tool: ${name}')`。**没有任何分支识别 `mcp__` 前缀的工具名**，MCP 工具传进来只会直接抛错。

### 2.2 文/武模式的 MCP 桥接（已跑通，创模式要复用这套）

```text
main.ts: registerMcpStore(useMcpStore)   ← 启动时把 store 注入 mcpBridge 的全局引用

toolConnectionAdapter.ts: buildDefaultChatTools()
  -> getMcpBridgeToolDefinitions({ coreToolNames: buildCoreToolNameSet() })
  -> 与 CHAT_TOOLS / Skill 工具 / Todo 工具等合并成最终 tools 列表

nativeExecutors.ts: createNativeFallbackToolExecutor()
  -> if (deps.isMcpToolName(toolName)) { return deps.executeMcpToolCall(toolName, args) }
```

`mcpBridge.ts` 提供的是纯函数接口，不依赖 OpenCode，只依赖一个满足 `McpBridgeStoreLike` 接口的 store（`allMcpTools`、`getMcpToolByName`、`isServerEnabled`、`isServerConnected`）：

- `getMcpBridgeToolDefinitions({ store, coreToolNames })` → 返回已连接、未被 `coreToolNames` 遮蔽的 MCP 工具的 chat completion tool 定义数组。
- `createMcpBridgeExecutor({ store, coreToolNames, callMcpTool })` → 返回一个 `ToolExecutor`，执行时按 `mcp__<serverId>__<toolName>` 解析、检查 server 是否已连接、调用 `callMcpTool`（默认走 `@/services/mcpClient` 的 `callMcpTool`，即真正的 MCP SDK 调用）。
- 工具名前缀固定为 `mcp__`，`isMcpToolName(name)` 判断即可识别。

这套接口设计本身就是平台无关的——它不读 OpenCode 的任何状态，只读 `mcpStore`。这意味着创模式接入它不需要绕开 OpenCode，也不需要复制一份桥接逻辑。

### 2.3 `mcpStore` 的连接状态

`McpServerConfig.enabled` 和 `.status`（`disconnected | connecting | connected | error`）是每个 server 的开关和连接态；`allMcpTools`（computed）只聚合 `enabled && status === 'connected'` 的 server 的工具。也就是说，**MCP server 的启用/连接是全局状态，不区分“文/武模式专用”还是“创模式专用”**——现状下没有按模式隔离的概念，接入创模式后自然是同一份已连接 server 对文/武/创三个模式可见。

## 3. 目标

1. 创模式的工具清单从"写死 7 个"改成"7 个核心工具 + 用户已连接的 MCP 工具"，新增 MCP 能力不需要改 `creativeToolContract.ts`。
2. 复用 `mcpBridge.ts` 现成的定义生成、执行路由、错误处理，不重新实现。
3. 文/武模式和创模式共用同一个 `mcpStore`——用户在设置里连一次 `github-mcp-server`，三个模式都能用；不新增"创模式专属 MCP 配置"。
4. 不改变 7 个核心工具的行为、审批流程或路径校验；MCP 工具作为独立的第三方能力，走自己的错误处理（已在 `mcpBridge.ts` 里实现：未连接、未暴露、执行失败三种明确错误码）。
5. Web 和 Desktop 创模式都要能用（`mcpStore` 本身是 Pinia store，双端共享；但 MCP server 的 stdio 传输依赖 Tauri，Web 端只能用 sse 传输的 server——这是现状已有的限制，不是本次新增）。

## 4. 不做的事（明确边界）

- 不改 `mcpBridge.ts`、`mcpStore.ts`、`mcpClient.ts` 的任何逻辑——这套本身没问题，创模式只是新增一个消费者。
- 不做"MCP 工具按 Skill 声明动态装配"（讨论中提到的第 3 种方案）。这次只做最小可行的一步：核心工具硬编码兜底 + 已连接 MCP 工具全量追加，不做更细的按需过滤。等这一步用起来之后，如果发现 MCP 工具太多干扰模型决策，再考虑按 Skill 过滤。
- 不新增权限内核或统一审批中间件（讨论中提到的第 4 种方案）。MCP 工具的执行审批现状是"连接时用户已经主动启用了这个 server"，暂不叠加二次审批；创模式现有的 `confirmTool` 审批只覆盖 7 个核心工具，本次不扩展到 MCP 工具，因为 `mcpBridge` 的错误处理已经要求 server 必须显式 `enabled + connected` 才可见，这本身就是一层用户主动授权。
- 不改变文/武模式的 MCP 接入方式或 UI。
- 不引入配置文件驱动的工具声明（讨论中提到的第 1 种方案，"声明式白名单"）。7 个核心工具目前只有这一处定义，改动频率低，暂不做这层抽象；如果未来核心工具集合本身也要频繁变动，可以另开一个 SDD 讨论。

## 5. 架构

```text
现状（文/武）：
  toolConnectionAdapter.ts → getMcpBridgeToolDefinitions({ coreToolNames }) → 并入 tools
  nativeExecutors.ts       → isMcpToolName() 分支 → executeMcpToolCall()

新增（创模式）：
  creativeToolContract.ts  → 新增 buildCreativeToolDefinitions()：
                              CREATIVE_PROJECT_TOOL_DEFINITIONS（7个固定）
                              + getMcpBridgeToolDefinitions({ coreToolNames: 这7个的名字 })

  desktopProjectTools.ts / webProjectTools.ts 的执行器：
    在现有 if (name === 'skill' | 'read' | ...) 链的末尾、throw 之前，
    新增一条：if (isMcpToolName(name)) return { content: await executeMcpBridgeToolCall(name, args) }
```

`coreToolNames` 传入这 7 个工具名是必要的——`mcpBridge.ts` 的 `isMcpToolVisible` 会用它排除掉"MCP 工具原名恰好和核心工具同名"的冲突（这层保护现状文/武模式已经在用，直接照搬）。

### 5.1 `creativeToolContract.ts` 改动点

```ts
// 新增，替代直接导出 CREATIVE_PROJECT_TOOL_DEFINITIONS 给上层用
export function buildCreativeToolDefinitions(): ChatCompletionTool[] {
  return [
    ...CREATIVE_PROJECT_TOOL_DEFINITIONS,
    ...getMcpBridgeToolDefinitions({ coreToolNames: CORE_TOOL_NAMES }),
  ]
}
```

`CREATIVE_PROJECT_TOOL_DEFINITIONS` 本身保留不变（`webProjectTools.ts` 现在直接引用它做 `.filter(tool => tool.function.name !== 'terminal')`，这个用法不受影响）。

### 5.2 执行器改动点（`desktopProjectTools.ts` 与 `webProjectTools.ts` 各一处）

```ts
// 现有 if (name === 'terminal') { ... } 块之后、throw 之前
if (isMcpToolName(name)) {
  const message = await executeMcpBridgeToolCall(name, args)
  return { content: message }
}

throw new Error(`Unsupported tool: ${name}`)
```

Web 端不支持 `terminal`，但 MCP 工具不依赖 `terminal`，两端都能接入。

### 5.3 `creativeChat.ts` / `chatCloud.ts` 改动点

把 `tools: CREATIVE_PROJECT_TOOL_DEFINITIONS` 换成 `tools: buildCreativeToolDefinitions()`。这是唯一需要改的调用点（Desktop 和 Web 各一处，用法一致）。

### 5.4 `mcpBridge.ts`、`mcpStore.ts`、`main.ts`

不改。`registerMcpStore(useMcpStore)` 已经在 `main.ts` 启动时执行过，`mcpBridge.ts` 内部的 `resolveMcpStore()` 会拿到同一个全局 store 实例——创模式调用 `getMcpBridgeToolDefinitions()`/`executeMcpBridgeToolCall()` 时不需要重新注册。

## 6. 与 github-mcp-server 的对照

`github-mcp-server` 是一个标准 MCP server（GitHub 官方维护），通过 stdio 或远程方式暴露 GitHub API 能力（issue、PR、repo、代码搜索等）为 MCP 工具。它不需要任何本项目代码专门适配——只要用户在设置的 MCP 管理面板里，把它注册为一个 `stdio` 或 `sse` transport 的 server 并启用，`connectMcpServer()` 会调用它的 `listTools()`，把返回的工具转成 `mcp__<serverId>__<toolName>` 格式,自动出现在 `allMcpTools` 里。

本次改动完成后，创模式和文/武模式会看到同一份已连接 server 列表，包括 `github-mcp-server`。不需要为这一个 server 写任何专属代码。

## 7. 实施顺序

### Task 1：创模式工具清单合并 MCP 工具

- `creativeToolContract.ts` 新增 `buildCreativeToolDefinitions()`，内部调用 `getMcpBridgeToolDefinitions({ coreToolNames })`。
- `creativeChat.ts`（Desktop）、`chatCloud.ts`（Web）把 `tools: CREATIVE_PROJECT_TOOL_DEFINITIONS` 换成 `tools: buildCreativeToolDefinitions()`。
- 验收：未连接任何 MCP server 时，创模式工具清单与改动前完全一致（回归不变）；连接一个测试 MCP server（如官方 `everything` 示例 server）后，创模式模型请求的 `tools` 字段包含该 server 的工具。

### Task 2：创模式执行器识别并路由 MCP 工具调用

- `desktopProjectTools.ts`、`webProjectTools.ts` 各新增一条 `isMcpToolName(name)` 分支，调用 `executeMcpBridgeToolCall(name, args)`。
- 验收：模型调用一个 MCP 工具（比如连了 `github-mcp-server` 后调用 "list my issues"），创模式能拿到真实返回内容；未连接/未启用时返回明确的 `MCP_NOT_CONNECTED` 错误文本，不抛出未捕获异常、不中断整轮对话。

### Task 3：双端与文/武回归

- 验证文/武模式的 MCP 工具清单和执行结果不受影响（`toolConnectionAdapter.ts` 完全没有改动，理论上不需要专门测但要跑一次回归确认）。
- 验证 Web 创模式：sse transport 的 MCP server 可用；stdio transport（依赖 Tauri 子进程）在 Web 端本来就不可用，创模式不应该让它在 Web 的可用工具里出现——这是 `mcpStore`/`mcpClient` 现有的传输限制，创模式接入后自动继承，不需要额外处理，但验收里要写清楚这条边界，避免误判为新 bug。
- 回归：`pnpm run test:focused`、`pnpm exec vue-tsc -b`、`cargo check --manifest-path src-tauri/Cargo.toml`。

### Task 4：文档收尾

- 更新本 SDD 状态为"已实现"。
- 更新 `docs/wiki/开发/开发历史.md` 和 `docs/wiki/CLAUDE.md` 索引。
- 更新 [[开发/创作模式双端统一SDD]] 第 2 节"统一运行时"里的工具清单描述，补一句"MCP 工具按用户已连接 server 动态追加，见 [[开发/创模式MCP工具接入SDD]]"。

## 8. 验收标准

1. 未连接任何 MCP server 的创模式行为与改动前完全一致（无回归）。
2. 用户在 MCP 管理面板启用并连接 `github-mcp-server` 后，创模式模型可以看到并调用其工具，返回真实结果。
3. 同一个已连接 MCP server，文/武模式和创模式看到相同的工具集合——不存在"创模式专属 MCP 列表"。
4. 未连接/连接失败的 MCP 工具调用返回明确错误文本给模型，不中断创模式的工具循环（复用 `mcpBridge.ts` 现有的三种错误码，不新增错误处理逻辑）。
5. `pnpm run test:focused`、`vue-tsc -b`、`cargo check` 全部通过。

## 9. 与行业实践的对照（决策依据）

这个方案不是新发明，是把创模式补齐到与以下三者相同的标准形态：

- **Claude Code**：核心工具（Read/Write/Edit/Bash/Grep/Glob 等）固定内置作为安全基线；MCP server 工具动态追加进可用工具列表；不同 Agent 类型可限制自己能看到的工具子集。
- **OpenCode**：内置工具固定，MCP server 通过配置文件（`opencode.json`）声明式接入，不需要改代码。
- **Codex CLI**：核心工具（shell、apply_patch 等）固定，后续版本加入 MCP 支持，同样是配置声明式接入。

三者共同套路：**小而稳的核心工具硬编码兜底，扩展能力交给 MCP 做动态协商，权限校验统一收口**。本项目文/武模式已经是这个形态；这次只是把创模式从"纯硬编码、无扩展"补到同一水平，不引入新架构、不超出已有代码的能力边界。

## 10. 实施与审计记录（2026-07-19）

- `creativeToolContract.ts` 在保留七个核心工具定义的前提下新增 `buildCreativeToolDefinitions()`；Desktop 发送时动态追加当前已连接 MCP server 暴露的工具。Web 保留不含 `terminal` 的六个核心工具，并以同一桥接动态追加 MCP 工具。
- 根因修正：两个创模式执行器原本在进入分支前会调用核心工具参数白名单解析，因此 MCP 名称会提前以 `Unsupported tool` 被拒绝。解析器现在仅对 `mcp__` 调用确认 JSON 参数为对象；工具可见性、连接态、调用和错误码仍全部由既有 `mcpBridge.ts` 决定。
- Desktop 与 Web 执行器均在核心工具分支后调用 `executeMcpBridgeToolCall()`；断连时把既有 `MCP_NOT_CONNECTED` 文本返回模型，不抛出未捕获异常。
- 自动证据：新增动态清单、核心名冲突过滤和双端断连路由合同；`pnpm run test:focused`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过。
- 未完成的人工验收：尚未在本机连接真实 GitHub MCP 或 Web SSE MCP server，因此不能声称真实远端工具调用、Web SSE 传输和文/武同服务器实操已通过。`pnpm exec vue-tsc -b` 仍被本次无关的 `CreationPanel`、文件树、创作媒体注册和项目文件服务既有错误阻断。

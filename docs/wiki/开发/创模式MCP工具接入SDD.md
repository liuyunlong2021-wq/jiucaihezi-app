# 创模式 MCP 工具接入 SDD

> 日期：2026-07-18
> 状态：创模式调用与通用 OAuth MCP 连接框架已实现；GitHub 线上验收待配置 OAuth App 并发布网关
> 范围：第一阶段只升级创模式工具来源；第二阶段补通用 OAuth MCP 的用户授权与连接体验。文模式、武模式和已有 MCP 工具桥接不重做。

> 2026-07-21 设计纠偏：已连接 MCP 工具只是候选能力池。只有当前模型支持 function calling 且本轮任务需要时才进入请求；MCP、核心工具和 Skill 都不能拦截或替代模型原生文本与媒体输入。下文“自动进入工具池/全量追加”保留为已实施阶段事实，不再作为最终目标合同。

## 1. 背景

创模式（[[开发/创作模式双端统一SDD]]）现在的工具清单固定写死在 `src/runtime/direct/creativeToolContract.ts` 的 `CREATIVE_PROJECT_TOOL_DEFINITIONS` 里：`skill`、`read`、`glob`、`grep`、`write`、`edit`、`terminal`，一共 7 个。想加一个新能力（比如让模型能查 GitHub issue、建 PR），只能改这份代码、重新发版。

文/武模式（OpenCode 引擎）已经有一套成熟的 MCP 桥接：`src/stores/mcpStore.ts` 管理已连接的 MCP server 和它们暴露的工具，`src/runtime/tools/mcpBridge.ts` 把这些工具转成 chat completion 的 `tools` 定义并负责路由执行，`src/runtime/connection/toolConnectionAdapter.ts` 在组装文/武工具清单时把 `getMcpBridgeToolDefinitions(...)` 的结果并入。用户在设置里配置一个 MCP server（比如 `github-mcp-server`），文/武模式立刻能用，不用改一行 App 代码。

第一阶段解决的是：**创模式的硬编码工具清单，改成能复用文/武模式已经跑通的 MCP 桥接**。第二阶段解决的是：**普通用户下载 App 后，能在 App 内完成任何遵循标准 OAuth MCP 授权流程的服务登录并开始使用**；GitHub 是第一个目录项和验收对象，不是一次性特判。

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

### 2.4 当前 OAuth MCP 卡片的产品缺口

现在以 GitHub 为代表的 OAuth MCP 卡片只有“加入仓库”和“启用”：前者让用户确认一个 MCP 地址，后者直接尝试连接。卡片虽然标注“需要 OAuth”，但 App 没有通用“连接”按钮、没有打开浏览器登录、没有接收授权回调，也没有保存按 server 区分的 MCP 授权凭据。因此第一位普通用户不能仅靠界面完成任何 OAuth MCP 接入；这不是用户该手工处理的配置，而是 App 缺少的通用流程。

## 3. 目标

1. 创模式的候选工具清单从“写死 7 个”改成“7 个核心工具 + 用户已连接的 MCP 工具”；发送前仍按当前模型的 function calling 能力和本轮任务裁剪，新增 MCP 能力不需要改 `creativeToolContract.ts`。
2. 复用 `mcpBridge.ts` 现成的定义生成、执行路由、错误处理，不重新实现。
3. 文/武模式和创模式共用同一个 `mcpStore`——用户在设置里连一次 `github-mcp-server`，三个模式都能把它作为候选能力；是否进入某轮请求由模型能力和任务决定，不新增“创模式专属 MCP 配置”。
4. 不改变 7 个核心工具的行为、审批流程或路径校验；MCP 工具作为独立的第三方能力，走自己的错误处理（已在 `mcpBridge.ts` 里实现：未连接、未暴露、执行失败三种明确错误码）。
5. Web 和 Desktop 创模式都要能用（`mcpStore` 本身是 Pinia store，双端共享；但 MCP server 的 stdio 传输依赖 Tauri，Web 端只能用 sse 传输的 server——这是现状已有的限制，不是本次新增）。
6. 用户完成任一 OAuth MCP 服务授权并显示“已连接”后，该服务工具进入文、武、创三个模式的候选工具池；不支持 function calling 的模型仍走普通原生请求，不能因 MCP 已连接而失败。用户不需要填写 MCP 地址、命令、Token 或重启 App。GitHub、Notion、Linear 等只作为目录数据和授权端点不同的服务实例接入。

## 4. 不做的事（明确边界）

- 第一阶段不改 `mcpBridge.ts`、`mcpStore.ts`、`mcpClient.ts` 的连接逻辑；第二阶段为通用 OAuth MCP 所需的授权状态、凭据存储和重连增加最小能力，不复制 MCP 工具桥接。
- 原实施阶段没有做“MCP 工具按 Skill 声明动态装配”，实际采用了“核心工具 + 已连接 MCP 工具全量追加”。这条只记录已发生的实现，不再代表目标设计；现行目标必须先按模型 function calling 能力和任务需要裁剪，避免工具干扰原生请求。是否进一步按 Skill 声明过滤，仍可在真实使用证据出现后另行决定。
- 不新增权限内核或统一审批中间件（讨论中提到的第 4 种方案）。MCP 工具的执行审批现状是"连接时用户已经主动启用了这个 server"，暂不叠加二次审批；创模式现有的 `confirmTool` 审批只覆盖 7 个核心工具，本次不扩展到 MCP 工具，因为 `mcpBridge` 的错误处理已经要求 server 必须显式 `enabled + connected` 才可见，这本身就是一层用户主动授权。
- 不改变文/武模式的工具装配；任一 OAuth MCP 授权成功后，三种模式继续读取同一份已连接工具池。
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

## 10. 第一阶段实施与审计记录（2026-07-19）

- `creativeToolContract.ts` 在保留七个核心工具定义的前提下新增 `buildCreativeToolDefinitions()`；Desktop 发送时动态追加当前已连接 MCP server 暴露的工具。Web 保留不含 `terminal` 的六个核心工具，并以同一桥接动态追加 MCP 工具。
- 根因修正：两个创模式执行器原本在进入分支前会调用核心工具参数白名单解析，因此 MCP 名称会提前以 `Unsupported tool` 被拒绝。解析器现在仅对 `mcp__` 调用确认 JSON 参数为对象；工具可见性、连接态、调用和错误码仍全部由既有 `mcpBridge.ts` 决定。
- Desktop 与 Web 执行器均在核心工具分支后调用 `executeMcpBridgeToolCall()`；断连时把既有 `MCP_NOT_CONNECTED` 文本返回模型，不抛出未捕获异常。
- 自动证据：新增动态清单、核心名冲突过滤和双端断连路由合同；`pnpm run test:focused`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过。
- 未完成的人工验收：尚未在本机连接真实 GitHub MCP 或 Web SSE MCP server，因此不能声称真实远端工具调用、Web SSE 传输和文/武同服务器实操已通过。根因不是让用户自行填写地址，而是 App 还没有通用 OAuth MCP 授权流程，下一阶段见第 11 节。`pnpm exec vue-tsc -b` 仍被本次无关的 `CreationPanel`、文件树、创作媒体注册和项目文件服务既有错误阻断。

## 11. 第二阶段：通用 OAuth MCP 普通用户连接

### 11.1 产品结果

用户下载并首次打开 Desktop App 后，不需要懂 MCP、地址、命令或 Token。用户只需点击某张 OAuth MCP 卡片的“连接”，在浏览器登录对应服务并同意授权。授权完成后，App 显示“已连接”，随后用户可在创模式直接要求使用该服务。GitHub 是第一个上线和人工验收对象；后续服务复用同一框架。

```text
工具仓库 > 外部工具扩展 > 任一 OAuth MCP 服务 > 连接
  -> App 按该服务的标准 OAuth/MCP 元数据打开官方授权页
  -> 用户登录对应服务并同意授权
  -> 浏览器回到 App 的授权回调
  -> App 按 server id 安全保存凭据并连接该 MCP
  -> 卡片显示“运行中 / 已连接”与发现的工具数
  -> 文、武、创三种模式自动看到并调用该 MCP 工具
```

“登录并同意授权”是用户的事；打开授权页、校验回调、保存凭据、连接 MCP、显示结果和把工具交给模型，全部是 App 的事。

### 11.2 实施原则

1. 所有 `auth: 'oauth'` 的目录卡片显示“连接”，首次使用不得弹出要求用户填写 MCP 地址的输入框；`auth: 'none' | 'token' | 'config'` 继续走各自明确的既有配置路径。
2. 每个 OAuth MCP 服务从其官方 MCP/OAuth 元数据获取实际传输、授权端点、scope 和回调限制。框架不得因为现有目录把服务硬编码为 SSE，也不得为 GitHub、Notion、Linear 等分别手拼未经验证的登录 URL。
3. 授权使用 OAuth Authorization Code + PKCE + 随机 `state`。浏览器回调由现有 `jiucaihezi://` deep link 接收；`state` 不匹配、用户取消、授权拒绝或过期均不得把卡片写成已连接。
4. access token、refresh token 和到期信息按 server id 只进入系统安全存储；不写入 `localStorage`、IndexedDB、普通 MCP 配置 JSON、聊天记录或日志。启动时如凭据有效则自动重连；失效时对应卡片显示“需要重新连接”。
5. OAuth 成功后，调用 MCP 的 `listTools()` 并仅在成功得到工具列表后把状态写为 `connected`。工具继续由已有 `mcpStore -> mcpBridge` 进入文、武、创模式；不得为任何服务新建第二套工具调用链。
6. 普通用户界面只展示“连接 / 重新连接 / 断开连接”和清晰状态。通用自定义 MCP 的地址、stdio 命令和参数配置仍保留在其原有入口，不能把这些技术输入暴露给 OAuth MCP 的一键流程。

### 11.3 最小实现边界

| 区域 | 职责 |
|---|---|
| `McpManagerPanel` | 所有 OAuth 卡片的连接/重连/断开按钮，以及连接中/已连接/需要重新连接/失败状态。 |
| OAuth MCP 授权服务 | 根据 server 元数据生成 PKCE 与 state、打开浏览器、消费 deep link 回调、换取/刷新授权凭据。 |
| 安全存储 | 按 server id 保存和清除 MCP 授权凭据。 |
| `mcpClient` | 用已授权连接建立该服务的 MCP client，`listTools()` 成功后返回工具。 |
| `mcpStore` / `mcpBridge` | 保持唯一的连接状态和工具桥接；只接收已完成授权的 server，不复制调用逻辑。 |

### 11.4 验收标准

1. 全新安装的 Desktop App 中，用户从 GitHub 卡片点击“连接”到授权成功无需填写地址、命令或 Token；GitHub 是首个真实验收对象。
2. 新增第二个遵循标准 OAuth MCP 流程的目录服务时，只增加目录元数据和该服务的真实验收，不新增另一套授权、回调、凭据或工具调用代码。
3. 用户拒绝授权、关闭浏览器、回调 state 错误、网络失败和 token 过期时，界面显示明确结果，且对应服务工具不进入工具池。
4. 授权成功后卡片显示“运行中”及发现的工具数；重启 App 后仍可自动连接，断开连接后工具立即从三个模式消失。
5. 创模式直接请求“查这个 GitHub 仓库是做什么的”时，模型请求包含 GitHub MCP 工具；一次只读仓库查询能把真实结果回给模型。
6. 文、武、创对同一已连接 OAuth MCP server 看到同一工具集合；通用自定义 MCP 和现有核心工具回归不变。
7. 自动测试覆盖 PKCE/state、授权回调、凭据不落普通存储、过期重连、状态转换、`listTools()` 成功门控及三模式工具可见性；再补一次真实 GitHub OAuth Desktop 人工验收。

### 11.5 实施与审计记录（2026-07-19）

- GitHub 目录卡片改为 `streamable-http` 的“连接”入口，Desktop 在首次 401 时打开 GitHub 官方授权页；授权回调经 `https://api.jiucaihezi.studio/auth/mcp/github/callback` 回到 `jiucaihezi://`，并且只接受匹配的 server id、随机 `state` 和 15 分钟有效期。
- 授权 token、PKCE verifier 与 OAuth discovery 状态按 server id 保存在系统 Keychain；普通 MCP 配置、IndexedDB、聊天记录和日志均不保存 token。回调换 token 后会重新创建 MCP transport，再 `listTools()`；只有成功发现工具才显示“已连接”。
- GitHub 没有可供此 App 使用的动态客户端注册，且换 token 需要 OAuth App Client Secret。因此 Client ID 作为 Desktop 构建变量 `VITE_GITHUB_OAUTH_CLIENT_ID`，Client Secret 只作为网关 secret `GITHUB_OAUTH_CLIENT_SECRET`；网关代换 token，不把 Secret 打入安装包或返回给 App。
- 自动证据：OAuth state 合同测试、网关深链回调和 token 代换测试、Rust 394/394 测试、`cargo check`、`git diff --check` 均通过；全量 `vue-tsc -b` 与 focused suite 被工作区无关的创作媒体、文件树、模型注册和编辑器既有失败阻断，MCP OAuth 文件无 TypeScript 诊断。
- 未完成的外部验收：创建 GitHub OAuth App、将 Client ID 注入桌面构建、将 Client ID/Secret 写入 Cloudflare 网关并发布后，按第 11.4 条在真实 Desktop App 中点击并授权。

# 自定义 MCP 添加 SDD

> 日期：2026-07-19
> 状态：已实现
> 范围：在“设置 → MCP 扩展”让用户添加自己的 MCP；复用既有 MCP 连接、工具发现和文/武/创工具桥接。

## 目标

用户在设置点击“添加 MCP”，填写服务提供方给出的连接信息后，可以立即连接。连接成功的服务显示在“自定义扩展”，发现的工具自动进入文模式、武模式和创模式。

## 根因与现状

`mcpStore.addServer()` 和 `mcpClient.ts` 已经支持 `streamable-http`、`sse`、`stdio` 三种 MCP 传输，也已支持连接后 `listTools()`、工具执行和三个模式共用工具池。

当前缺口只是 `McpManagerPanel.vue` 没有把用户输入转换成既有 `McpServerConfig` 的界面入口。不能新建第二套 store、client 或工具桥接。

## 产品边界

### 本次做

1. 添加一个“添加 MCP”按钮。
2. 表单支持三类连接：
   - 远程 MCP（Streamable HTTP）：名称、URL。
   - 远程 SSE：名称、URL。
   - 本地命令（仅 Desktop）：名称、命令、可选参数、可选工作目录。
3. 点击“添加并连接”后，调用现有 `mcpStore.addServer()`、`connectMcpServer()` 和 `mcpStore.setServerTools()`。
4. 连接失败时保留卡片并显示错误，用户可以停用或删除。
5. Web 不显示“本地命令”，因为浏览器无法启动本地 MCP 进程。

### 本次不做

1. 不把 GitHub 的 OAuth 登录改成通用表单。GitHub 内置卡片继续走既有 OAuth、系统钥匙串和网关流程。
2. 不提供 Authorization Header、Token、环境变量编辑器。它们会把密钥落入普通浏览器存储，不符合现有 OAuth 凭据安全边界。
3. 不改 `mcpStore.ts`、`mcpClient.ts`、`mcpBridge.ts`，也不新建“创模式专属 MCP”。
4. 不做远程 MCP 的地址扫描、服务市场或推荐清单。

## 复用链路

```text
McpManagerPanel 添加表单
  -> mcpStore.addServer(config)
  -> 现有 toggle/connect 流程
  -> connectMcpServer(server)
  -> listTools()
  -> mcpStore.setServerTools()
  -> mcpBridge / 创模式动态工具清单
  -> 文、武、创共用同一批工具
```

## 数据与校验

- 名称必填。
- 远程 MCP / SSE：URL 必填，且只接受 `http://` 或 `https://`。
- 本地命令：命令必填；参数以空格分隔，工作目录可空。
- id 由名称 slug 和当前时间构成；如撞名追加后缀，避免覆盖已有服务。
- 表单取消或成功后清空，不影响已经连接的服务。

## 验收标准

1. 设置页可打开“添加 MCP”表单。
2. Desktop 可选择远程 MCP、远程 SSE、本地命令；Web 只显示两种远程类型。
3. 填写有效远程配置后，点击“添加并连接”会生成自定义卡片并调用已有连接流程。
4. 连接成功卡片显示“运行中”和工具数量；工具同时可被文、武、创模式读取。
5. URL 或必填字段错误时不添加服务，并在表单提示原因。
6. 连接失败时服务仍保留在列表，错误可见，用户可删除。
7. GitHub OAuth 卡片的连接、断开与重连流程不变。

## 验证

- 添加单元合同测试，覆盖远程配置、本地命令配置和 Web 端类型范围。
- 执行对应测试、`pnpm exec vue-tsc -b`、`pnpm run build:quick`。
- Desktop 人工验收：添加一个已知本地或远程 MCP，确认卡片状态与工具数。
- Web 人工验收：确认不显示本地命令，远程 MCP 可添加。

## 实施记录（2026-07-19）

- McpManagerPanel.vue 已增加“添加 MCP”表单。远程 MCP、远程 SSE 和 Desktop 本地命令均复用现有 mcpStore.addServer() 与 toggleServer()。
- 远程地址仅接受 http://、https://；空名称、空命令和无效地址在添加前给出表单错误，不产生配置。
- 添加后立即连接。成功时沿用既有“发现 N 个外部工具”提示；失败时配置保留在“自定义扩展”卡片，状态和错误可见。
- Web 端不渲染 stdio 选项；GitHub 和 Obsidian 的内置卡片、OAuth 和系统钥匙串流程未改。
- 自动验证：新增 MCP 面板合同测试；pnpm run test:focused 通过；git diff --check 通过。pnpm exec vue-tsc -b 仍由改动前已存在的 CreationPanel、ProjectFileTree、媒体注册、项目文件服务和 PluginStore 错误阻断，本次 MCP 文件未出现类型错误。

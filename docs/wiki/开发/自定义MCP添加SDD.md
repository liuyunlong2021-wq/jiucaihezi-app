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
- 连接类型从系统原生下拉改成产品内三段选择，避免 macOS 原生菜单破坏产品主题；添加与取消按钮统一高度，窄窗口工具条可换行。
- 自动验证：新增 MCP 面板合同测试；pnpm run test:focused 通过；git diff --check 通过。pnpm exec vue-tsc -b 仍由改动前已存在的 CreationPanel、ProjectFileTree、媒体注册、项目文件服务和 PluginStore 错误阻断，本次 MCP 文件未出现类型错误。

## 内置 Playwright MCP（2026-08-07）

- Desktop 的内置目录增加 Microsoft Playwright MCP，固定使用 `npx -y @playwright/mcp@0.0.79`，允许官方提供的完整浏览器操作能力；它属于高权限扩展，只有用户主动连接后才向模型暴露工具。
- App 不内置 Node.js、Playwright 或 Chromium。首次连接由用户本机的 `npx` 下载 MCP 包，因此安装包体积不因浏览器运行时增加；Web 与 Mobile 不能启动本地 stdio MCP。
- 缺少 `npx` 时保留连接配置并显示真实错误，同时提供 Node.js 官方下载入口和“重新检测并连接”。Windows 会识别 `npx.cmd`、`Program Files/nodejs` 和用户 npm 目录，并通过 `cmd.exe /C` 启动命令入口。
- 不增加第二套 MCP Store、传输层、工具桥接或自动提权安装器；连接、工具发现、调用和停用均复用现有 MCP 链路。
- Tauri 开发页属于远程 URL，能力范围必须匹配 `http://localhost:1420/*`。应用自定义 ACL 一旦启用，就必须覆盖 `generate_handler!` 注册的全部 Rust 命令；合同测试逐项比较注册表和 `allow-app-commands`，避免局部授权导致其他功能被静默拦截。

## 连接成功经验（2026-08-08）

- 上一轮卡片显示“下载 Node.js”并不代表真的缺少 Node。真实错误是 `mcp_spawn_stdio not allowed. Plugin not found`，旧判断只要看到 `not found` 就误判为缺少 `npx`；同时开发 URL 没有匹配 Tauri ACL，外链打开和 MCP Rust 命令都被拦截，因此安装 Node 也无法解决。
- 根修包含四点：`Plugin not found` 不再进入 Node 缺失分支；下载按钮复用统一外链打开；开发能力使用 `http://localhost:1420/*`；`allow-app-commands` 覆盖全部 Rust 注册命令，避免只授权 MCP 后破坏文件、Skill、密钥等既有能力。
- Windows 运行本地 stdio 时先解析 `npx.cmd` 的 PATH、`Program Files/nodejs` 和用户 npm 常见目录，再通过 `cmd.exe /C` 启动。App 不打包 Node、Playwright 或 Chromium。
- 已验证：用户在最新开发版点击 Playwright 连接成功；MCP 专项 `7/7`、完整 focused、Rust `396 passed / 1 ignored`、TypeScript、Desktop quick build 与产物审计通过；`npx -y @playwright/mcp@0.0.79 --help` 真实成功。
- 待验证：尚未发布包含本修复的新版本，也未在从未安装 Node 的干净 Windows/macOS 上完整走完“下载 Node -> 安装 -> 重新检测 -> npm 下载 MCP -> 工具发现”。因此 `v2.1.15` 的理论链路已闭环，但不能提前记录为所有外部用户真机通过。

## 本地 short-video-factory stdio 验收（2026-08-08）

- Git `10553f10` 修复本地 stdio 生命周期：`tsx` 入口会归一为 Node + `tsx/dist/cli.mjs`；initialize 与 tools/list 为 30 秒，tools/call 为 120 秒；stdout 只处理 JSON-RPC，stderr、退出码、signal、实际启动参数和已发送方法作为连接诊断保留。
- 连接或调用失败会关闭旧进程、删除旧连接；MCP Store 在 connecting、error、disconnected 时清空工具列表，重新连接必须重新 initialize 与 tools/list，不复用失败会话。
- 用户在 Desktop 开发版真实添加 `/Users/by3/Documents/short-video-factory` 后，服务端 tools/list 返回 8 个工具：`open_project`、`read_wiki_document`、`refresh_production_materials`、`get_production_status`、`list_missing_materials`、`run_production_stage`、`get_task_status`、`resume_task`。随后真实调用 `open_project` 成功打开 `/Users/by3/Documents/0807功夫女友`，返回项目 ID、项目名称和 `episode-001`。
- 未验证：`refresh_production_materials` 的真实 tools/call、断 pipe 后重连，以及外部 macOS/Windows 安装包链路；不得把这些写成已通过。

## Playwright 打包版失败与修复（2026-08-09）

- `v2.1.16` 打包版中的 Playwright 连接失败，真实错误为 `command=npx`、`methods=initialize`、`stderr=env: node: No such file or directory`。Studio 找到了 `/opt/homebrew/bin/npx`，但桌面 App 启动时没有终端继承的 Homebrew PATH，npx 的 `#!/usr/bin/env node` 无法找到 Node；子进程在返回 initialize 前退出，不是 MCP 服务端或 Playwright 包协议错误。
- short-video-factory 能连接是因为它直接使用绝对 Node；本次修复让 Unix `npx` stdio 配置统一归一为绝对 Node + 对应 npm `npx-cli.js`，Node 仍按 `/opt/homebrew/bin/node`、`/usr/local/bin/node`、`process.execPath` 顺序选择，Windows 的 `npx.cmd` 路径分支不变。
- 回归验证：MCP 相关测试 `11/11`、TypeScript 通过；本机直接执行 `/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/npm/bin/npx-cli.js --version` 成功。必须发布 `v2.1.17` 并安装新包后，才能算打包版 Playwright 修复通过。

## `v2.1.17` 复现与最终修复（2026-08-11）

- 用户已安装 `v2.1.17`，仍复现 `command=/opt/homebrew/bin/node`、`args=[.../npx-cli.js,"-y","@playwright/mcp@0.0.79"]` 和 `stderr=env: node: No such file or directory`。这证明绝对 Node 只覆盖了第一层启动；`npx` 继续拉起 Playwright 时仍通过 `env node` 查找 PATH。
- 根修位于共享 `mcp_spawn_stdio`：Unix 子进程的 `PATH` 现在以前台解析后的可执行文件目录开头。因此 Homebrew Node 启动 `npx-cli.js` 后，所有后继脚本都能解析同一个 `node`。它适用于所有本地 stdio MCP，不是某台机器的专用配置。
- 验证：MCP 专项 `5/5`、`vue-tsc -b`、`cargo check`、`git diff --check` 通过；以空 Homebrew PATH 运行官方 Playwright MCP 失败，补入 `/opt/homebrew/bin` 后 `--help` 成功。未执行新正式安装包的 Desktop 点击验收；必须发布 `v2.1.18` 或更高版本后再验收。

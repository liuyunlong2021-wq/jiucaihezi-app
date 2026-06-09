# OpenCode Official Capability Carrier SDD

> 状态：修正版执行 SDD  
> 日期：2026-06-07  
> 目标：让韭菜盒子成为 OpenCode 官方能力的可视化承载层，而不是重新实现 Agent 内核。  
> 约束：不 fork OpenCode，不改 SDK 源码，所有适配集中在 `src/opencodeClient/`。

---

## 1. 当前结论

OpenCode 已经接入为聊天和 Skill 执行核心，但还没有达到“100% 官方能力承载”。

已完成：

- Tauri 启动 OpenCode server。
- 前端通过 `@opencode-ai/sdk/v2/client` 创建官方 SDK client。
- 手动 NewAPI Key 可投影为 OpenCode provider。
- `session.create` / `session.prompt` / `session.messages` / `session.abort` 已接入。
- OpenCode 回复已进入现有 `MessageBubble`。
- Skill 已同步到 OpenCode 原生扫描目录：`~/.agents/skills/jiucaihezi/<skill-slug>/SKILL.md`。
- Skill 选择器已能把 UI Skill 解析为 `SKILL.md` frontmatter `name`。
- 固定 Skill 已写入 session permission：`deny *` + `allow <frontmatter name>`。
- 固定 Skill 时会通过 system 指令要求 OpenCode 先调用官方 `skill` 工具加载该 Skill。

未完成：

- 流式输出还没有接入到 UI，当前主要是请求完成后再显示。
- `messageMapper.ts` 对 OpenCode part/event 类型支持不完整。
- OpenCode agent/model 官方列表尚未接入 UI。
- OpenCode session 历史尚未完全接管第二列会话列表。
- permission/question/tool UI 还没有完整承载 OpenCode 官方交互。
- runtime 升级策略还没有产品化。

---

## 2. 已采纳的修正

### 2.1 不做“legacy/v2 混用清理”

当前代码只使用：

```ts
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
```

`client.session.*` 和 `client.v2.*` 都来自同一个 v2 SDK client，不是 root SDK 混用。

因此不把“清理 legacy/v2 混用”列为任务。

### 2.2 事件流优先 SDK 直连

OpenCode server 运行在本机 `127.0.0.1`，与旧 NewAPI 跨域场景不同。

生产优先路径：

```ts
client.v2.event.subscribe()
```

只有在实测 WKWebView 中 SDK SSE/async iterator 断流时，才降级到 Rust SSE bridge。

### 2.3 不把 Vite HMR `/wait` 当作核心问题

开发期控制台里的 `/wait` 可能来自 Vite HMR 行为，不作为 P0。

真正的 OpenCode server 错误应从：

- OpenCode server stderr
- `~/.jiucaihezi/opencode-runtime/data/opencode/log/*.log`
- Tauri `eprintln` 转发日志

判断。

---

## 3. 修正版优先级

### P0：流式输出

当前 `sendOpenCodePrompt()` 是请求-响应路径：

```ts
client.session.prompt()
client.session.messages()
```

用户需要等完整回复结束后才看到内容。P0 改为事件驱动显示。

目标：

- 实施前先打印一次 `event.subscribe()` 的实际事件流，确认流式文本 delta、reasoning delta、tool call、tool result 的真实事件类型名。
- 以 SDK 1.16.2 实际返回事件为准，不凭 SDD 猜事件名。
- 用 SDK 直连订阅 OpenCode event stream。
- 发送 prompt 后按 `sessionID` 过滤事件。
- 按实测事件处理文本 delta，实时更新 assistant message。
- 按实测事件处理 reasoning delta，实时更新 reasoning 区。
- 文本结束后用 `session.messages()` 做最终同步。
- 保留 `session.prompt()` 作为官方发送入口。

最小验收：

- 用户发送消息后 1 秒内可看到首批流式文本。
- 控制台没有 `waitForOpenCodeSession` 导入错误。
- 回复结束后最终消息与 `session.messages()` 同步结果一致。
- 固定 Skill 时，能看到 OpenCode 调用 `skill` 工具或明确加载失败。

### P1：messageMapper 补全 part 类型

当前 mapper 主要处理 text/reasoning，会丢 OpenCode agent 执行信息。

最小目标：

- `text`：进入 `content`。
- `reasoning`：进入 `reasoningContent`。
- tool call / tool result：生成可显示摘要，并映射到可见的工具 UI。
- error：显示错误信息，不静默丢弃。
- file / attachment：显示文件标签和路径/名称摘要。
- subtask / step-start / step-finish：显示阶段标签。
- patch / diff / snapshot：显示变更摘要。
- compaction / agent switch：显示系统事件摘要。
- unknown part：显示类型标签和 JSON 摘要。

OpenCode 原生工具事件的 UI 承载：

- tool_call part 显示为工具调用卡片：工具名、参数摘要、状态。
- tool_result part 显示为结果折叠区：成功/失败、内容预览。
- 工具执行中将 `agentPhase` 设为 `tool`，`agentDetail` 显示当前工具名。
- 多轮工具循环中，每个工具调用独立成卡片，并按时间顺序排列。
- 不重新实现 read/write/edit/bash/glob/grep 等工具逻辑，只映射 OpenCode 官方 event/message/part 到可见 UI。

最小验收：

- 未知 part 不产生空消息。
- OpenCode `skill` 工具加载结果能在 UI 中看到。
- 工具执行失败能显示错误，而不是空回复。

### P2：官方 agent/model 列表

接入：

```ts
client.v2.agent.list()
client.v2.model.list()
```

目标：

- Agent 模式来自 OpenCode 官方列表，不由韭菜盒子猜测。
- UI 支持 OpenCode agent 选择，例如 build / plan / chat 等官方 agent。
- 模型列表优先从 OpenCode provider/model 读取，再与 NewAPI 投影配置协调。

最小验收：

- UI 能展示 OpenCode 返回的 agent 列表。
- 创建 session 时使用选中的 official agent。
- 模型选择器不再只依赖本地硬编码模型表。

### P3：OpenCode Session 历史接管

目标：

- 第二列会话列表读取 OpenCode sessions。
- 点击会话加载 OpenCode messages。
- 新会话创建、继续、删除、重命名走 OpenCode 官方 session API。
- 旧本地会话只读归档。

最小验收：

- 退出重启后，OpenCode 会话仍可从第二列恢复。
- 同一个 OpenCode session 继续对话不会新建错乱 session。

### P4：Skill 官方扫描接管

目标：

- Skill 选择器的数据源切到 OpenCode 官方扫描结果。
- 我们的 Skill store 退化为 Skill 仓库和同步源。
- 处理 duplicate skill name。
- 验证 `references/`、`scripts/`、`assets/` 在 OpenCode 中可访问。

最小验收：

- UI 看到的可选 Skill 与 OpenCode `skill.list` 一致。
- 选择 Skill 后 permission 使用 OpenCode frontmatter `name`。
- 固定 Skill 可稳定触发 OpenCode 官方 `skill` 工具加载。

### P5：permission / question / tool UI

目标：

- 接入 permission asked/replied。
- 接入 question asked/replied。
- Tool call card 显示 OpenCode 官方工具事件。
- Skill load card 显示加载状态。
- abort/retry/error 走 OpenCode 官方状态。

最小验收：

- OpenCode 请求权限时，韭菜盒子 UI 能让用户批准或拒绝。
- OpenCode 提问时，韭菜盒子 UI 能让用户回答。
- 工具执行中、成功、失败状态可见。

### P6：其他官方能力承载

候选能力：

- `client.session.command()`：slash command。
- `client.session.todo()`：原生 todo，替代旧 todo 工具。
- `client.session.fork()`：会话分叉。
- `client.session.summarize()`：会话总结。
- `client.session.diff()`：diff 展示。
- `client.session.shell()`：shell 执行。
- `client.v2.fs.*`：文件系统能力。
- `client.find.*`：文件/文本/符号搜索。
- `client.mcp.*`：MCP 管理。
- `client.worktree.*`：worktree 管理。

这些进入 P6，不阻塞 P0-P5。

### P7：官方升级机制

目标：

- 不 fork OpenCode。
- 不改 SDK 源码。
- OpenCode runtime 来源明确：官方 binary / 本地 clone / 内置 binary。
- 所有适配只在 `src/opencodeClient/`。
- 每次升级 SDK 或 runtime 后跑 contract tests 和 smoke tests。

最小验收：

- 能输出当前 OpenCode runtime version。
- 能输出当前 SDK version。
- 升级 OpenCode 后运行固定 smoke：
  - server 启动
  - model list
  - agent list
  - session create
  - streaming prompt
  - skill list
  - fixed skill load
  - abort

---

## 4. 执行边界

韭菜盒子使用 OpenCode 就像浏览器使用 Chromium：直接用官方 runtime，跟随官方版本升级，只在壳层做 UI 适配。`不 fork` 不是限制，是产品策略。

允许：

- 调用 OpenCode 官方 SDK。
- 使用 OpenCode 官方 server/runtime。
- 写 OpenCode 官方配置。
- 同步 Skill 到 OpenCode 官方扫描目录。
- 把 OpenCode event/message/part 映射到韭菜盒子 UI。

禁止：

- fork OpenCode。
- 修改 OpenCode SDK 源码。
- 重新实现 OpenCode tool loop。
- 重新实现 OpenCode session 状态机。
- 绕过 SDK 手写内部 HTTP API，除非 SDK 暂无能力且集中封装在 `src/opencodeClient/`。
- 为了 UI 方便手动拼接 `SKILL.md` 到旧聊天 prompt，固定 Skill 必须通过 OpenCode 官方 `skill` 工具加载。

---

## 5. 下一步执行

立即执行 P0。

P0 文件范围：

- `src/opencodeClient/eventBridge.ts`
- `src/opencodeClient/session.ts`
- `src/opencodeClient/messageMapper.ts`
- `src/composables/useChat.ts`
- `src/opencodeClient/__tests__/*`

不改：

- 创作面板
- 画布
- 编辑区
- 主动工具仓库

P0 gate：

```bash
pnpm exec vue-tsc -b --pretty false
pnpm run test:focused
pnpm run test:tauri
pnpm tauri dev
```

手动冒烟：

1. 手动 API Key 发一条普通消息，确认流式输出。
2. 选择“漫剧剧本生成器”发消息，确认触发 OpenCode `skill` 工具。
3. 不选 Skill 发消息，确认 OpenCode 自动模式仍可用。
4. 点击停止，确认 abort 生效。

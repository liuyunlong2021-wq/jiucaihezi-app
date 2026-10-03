# 韭菜盒子 Harness 升级 0.2.0-rc.2 方案

> 状态：**已实施（S1–S3 完成，S4 的会话读取已验证；界面与安装包待真机）**
> 日期：2026-10-03
> 目标：`src-tauri/resources/deepseek-harness` 从 `0.1.7-alpha.2` 升到 `0.2.0-rc.2`
> 关系：本方案**先于** [[开发/韭菜盒子Harness重试与失败对齐官方TDD-2026-10-03]]；P1 的 fixture 与 UI 语义一律以升级后的官方为准，避免写两遍

## 1. 结论先说

**可行，而且顺序合理。** 三条理由：

1. **有实质收益，且正好打在我们的痛点上**（见 §2）：0.2.0-rc.1 修了「工具调度异常后对话无法继续」，rc.2 又优化了「过程信息」显示；这两条正是我们 P1/P2 要处理的事。
2. **改动面是机械的，不是重构**（见 §3 实测）：官方 SDK 的公开接口面逐字未变，我们 5 处 vendor patch 的锚点**全部还在**。
3. **先升级再搬 UI 语义，不会返工**：官方在 0.1.7-alpha.2 之后仍在演进过程显示与失败后行为，照旧版搬完再升级等于写两遍。

**但必须明确**：**升级不会减少 524**。524 是上游/网关侧问题（在 ~126 秒内零字节），与本版本无关。

## 2. 官方 changelog 里与我们直接相关的条目

（来源：GitHub `deepseek-ai/deepseek-harness` Releases，2026-10-03 通过 web 读取）

| 版本 | 条目 | 为什么对我们重要 |
| --- | --- | --- |
| `v0.2.0-rc.1` | 问题修复：**「修复工具调度异常后对话无法继续的问题；已执行但结果未知的操作会提示先核实副作用，不盲目重试」** | 正是「任务失败后要手打继续」的官方侧修复，P1 的续跑提示要按它的语义写 |
| `v0.2.0-rc.1` | 其他变更：**「调整工作过程展示在不同初始化路径的默认值」** | 直接决定过程折叠的默认行为，P1 §2 第 6 条的官方基准要按新版读 |
| `v0.2.0-rc.2` | 体验优化：**「优化聊天耗时、过程信息、字号和深色主题样式，优化动画运行开销」** | 过程信息（耗时/重试行）的官方实现有更新 |
| `v0.2.0-rc.2` | 其他变更：**「更新第三方模型目录与兼容适配至 pi-ai 0.87.1；部分旧模型 ID 被移除，已保存的选择可能需要重新选择」** | ⚠️ 我们经 pi-ai 打自家网关，升级后要复核模型目录/模态声明（见 §4） |
| `v0.1.7-rc.2` | 修复：**「修复部分长对话持续无法发送消息的问题」** | 长任务场景相关 |
| `v0.2.0-rc.2` | 新增：桌面端菜单栏管理/安装 `dsh` 命令与插件，无需另装 Node/pnpm | 与我们无关（我们用自己打包的 Node 与 SDK 通道） |

## 3. 兼容性实测矩阵（2026-10-03，逐项验证过）

方法：从 npm 拉 `0.2.0-rc.2` 对应包解包，与本机 `0.1.7-alpha.2` 源码逐字对比。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 官方 SDK 请求面 | **逐字未变** | `0.2.0-rc.2` 的 `dsh-sdk-protocol` 仍是 `initialize` / `session/prompt` / `shutdown` |
| 官方 SDK 通知面 | **逐字未变** | 仍是 `session.event` / `session.status` / `subagent.started` / `subagent.finished` |
| 我们的 5 处 patch 锚点 | **5/5 全部命中** | `const serverOptions = this.options;`、`createSession` 原文、`const inject = ["agents"];`、switch 三行、`assertLiveAgent(rec, sessionId) {` 在 0.2.0 服务端里都能逐字找到 |
| server 规模 | **314 行 → 296 行**，同一套结构 | `durablePromptContent` / `carrierKeyOf` / `llmFiber` / `sessionCreations` / `hasAdapterFor` 两版都有 |
| `agent/assistant-stream` | **发出点逐字相同** | 两版都是 `this.dispatch.emit("agent/assistant-stream", { frame })`（`dsh-agent-loop`） |
| `ctx.sessionQuery` | **仍在** | 0.2.0 里 `dsh-session-query-sqlite` 仍由 `dsh-base` 挂载；服务名 `sessionQuery` 仍出现在 `dsh-session-query` 源码 |
| `ctx.agents.resume` | **仍在，形状不变** | 0.2.0 `dsh-agent` 仍有 `ResumeAgentOptions { resumeSessionId }` 与 `AgentRegistry.resume` |
| `dsh-commands` + `/permission` | **仍在** | `dsh-base` 0.2.0 仍挂 `commands` 与 `permission-presets` |
| route patch：provider 配置键 | **全部有效** | `apiKeyEnv` / `baseURL` / `api: openai-completions` / `retryPolicy` / `streamIdleTimeoutMs` / `contextWindow` / `models[].input` 在 0.2.0 `dsh-llm-pi-ai` 里都在 |
| route patch：`tool-subagent.backgroundMode` | **有效** | 0.2.0 仍是 `'one-shot' \| 'continuable'` |
| route patch：MCP 的 `- insert:` 补丁语义 | **有效** | 0.2.0 `dsh-app-boot` 仍走 `{ insert: rows }` 与 `patch insert: entry … not found` |
| **会话数据格式** | **仍是 V4，无 V5** | 0.2.0-rc.2 里最新迁移包是 `dsh-session-format-v3-to-v4`，**不存在** `v4-to-v5` |
| `dsh-sdk-client` 构造参数 | **逐字一致** | `patches` / `dshHome` / `processCwd` / `initializeTimeoutMs` / `provider` / `model` / `maxTokens` 全在 → `runner.mjs` 不用改 |
| 依赖树 | ⚠️ **有新增包** | 0.2.0 服务端新增 import `@deepseek-ai/dsh-llm-deepseek-api-key`（0.1.7 没有）→ `package-lock.json` 必须重生成 |

## 4. 难度与阻碍

### 4.1 机械改动（低风险，确定能做）
1. `scripts/prepare-deepseek-harness.mjs`：`const version = '0.1.7-alpha.2'` → `0.2.0-rc.2`。
2. `src-tauri/resources/deepseek-harness/package.json`：`@deepseek-ai/dsh-sdk-client` → `0.2.0-rc.2`；`package-lock.json` 用 `npm install` 重生成（`npm ci` 依赖它）。
3. 5 处 patch 重跑一次幂等性验证（`scripts/__tests__/deepseek-harness-patch.test.mjs` 真实连跑两次）。

### 4.2 需要复核（中等，可能各花半天以内）
1. **裁包逻辑**：`prepare` 脚本删 `node/node_modules`、`.bin/node`、`libreoffice-kit*` 是基于「打好的 App 里各占一份体积」的实测。新版本要重测这三处是否仍存在、是否又有新重物。
2. **pi-ai 0.87.1 模型目录**（rc.2 明确说「部分旧模型 ID 被移除」）：我们的模型是 route patch 里自声明的（`gpt-5.6-terra`），理论上不吃目录，但要复核 `models[].input` 模态声明与 `deepSeekModelInput()` 的交互没变。
3. **`--dump-config` 对比**：升级后跑一次，确认 patch 命中 0 条 `entry not found`、MCP 条目与 `file-reference-local` 正常 `- insert:`。
4. **`prepare` 的幂等守卫**：patch 4/5 的锚点曾互相切断（注释里记着），新源码布局下要重跑两次确认。

### 4.3 真风险（需要在真机上验收，不能只靠单测）
1. **老会话可读性**：本机唯一 Harness 会话是 `session.v4.jsonl.zstd`（1.37 MB / 36 轮）。升级后必须验证：能列表、能打开、正文与过程完整、能继续聊。格式虽仍 V4，但**事件 schema 与投影行为**可能变。
2. **P1 的输入会变**：我们手写投影消费的 `llm/retry` / `assistant/attempt` / `turn/end` 字段要按新版重采一次 fixture。
3. **三平台构建**：Windows / macOS(ARM+Intel) / iOS 的构建与产物审计都要重跑；`prepare` 脚本在 macOS 上删 `libreoffice-kit` 的历史结论（不碰 officeToPdf）要复查。
4. **官方是 rc 而非稳定通道**：`alpha` tag 至今停在 `0.1.7-alpha.2`，说明官方自己也没把 0.2.0 标为稳定。我们是把运行时分发进 App，等于替用户承担 rc 的行为风险。

### 4.4 不可控（说清边界）
1. **524 不会因此变好**：上游/网关在 ~126 秒内不给字节，与本版本无关。
2. **官方 GitHub 链路**：本机 `fetch_webpage` 能读 Releases，但机器上 `git` 走 github.com 需要代理 —— 升级只用 npm，不受影响。
3. **rc → 正式版的再次变动**：如果 0.2.0 正式版随后发布，可能还要再升一次；建议升级时把 `version` 常量抽成「可覆盖的单点」以便二次升级。

## 5. 执行步骤（每步一个闸门，任一步失败即回滚）

| 步 | 动作 | 闸门（必须通过才进下一步） |
| --- | --- | --- |
| S1 | 改 `version` 常量与 `package.json`，重建 `package-lock.json` | `npm ci --omit=dev` 成功；`node_modules/@deepseek-ai/dsh-sdk-client/package.json` 的 `version` = `0.2.0-rc.2` |
| S2 | 跑 `node scripts/prepare-deepseek-harness.mjs`（含 5 处 patch） | 无 `Unsupported DeepSeek Harness … layout` 抛错；连跑两次幂等；`node scripts/__tests__/deepseek-harness-patch.test.mjs` 通过 |
| S3 | 起一次 `--profile sdk --patch <route.cordis.yml> --dump-config` | 退出码 0；patch 命中 0 条 `entry not found`；route 里 `retryPolicy` / `models[].input` / 三个 MCP 条目 / `file-reference-local` 都在 |
| S4 | 端到端跑 App：老会话打开 + 一轮新对话 + 一次工具调用 + `@文件` 权限切换 | 老会话 36 轮正文与过程完整；新轮次正常；权限切换生效；无 `session is already owned` |
| S5 | 三平台构建 + 产物审计 | `pnpm run build`（web）/ `build:desktop`（双架构）/ `build:ios:quick` 全绿；安装包体积与升级前对比无异常增长 |

**回滚**：`git revert` 这次提交即可（`node_modules` 是构建期产物，恢复旧 `package.json` + 旧 `package-lock.json` 后 `npm ci` 即可重建）。会话格式仍 V4，不存在数据降级问题。

## 6. 明确不做

1. **不为了升级去 fork 官方、也不新增第 6 处 patch**（官方接口面未变，加了也换不来能力）。
2. **不解析 `session_projcache` 等私有物理文件**（合同禁止）。
3. **不把 524 的修复寄望于升级**（那在服务端）。
4. **不在升级里顺带做 P1/P2**：升级是独立任务，P1/P2 在它之后按新版官方语义实施。

## 7. 实施结果（2026-10-03 当日完成）

| 步 | 结果 |
| --- | --- |
| S1 | ✅ `package.json` → `0.2.0-rc.2`；`prepare` 脚本改为从 `package.json` 读版本（单一真源）；`package-lock.json` 干净重生成（旧锁与 0.2.0 的 peer 解析冲突，`npm ci` 直接 ERESOLVE） |
| S2 | ✅ 0.2.0-rc.2 安装完成，`@deepseek-ai/dsh*` 全部为 `0.2.0-rc.2`；`prepare` 零 `Unsupported … layout`；补丁幂等测试通过 |
| S3 | ✅ `--dump-config` 退出 0；provider（`api: openai-completions` / `baseURL` / `retryPolicy`）、`tool-subagent(one-shot)`、insert 进来的 `file-reference-local` 逐条命中；**零 `entry not found`** |
| S4 | ✅ 会话读取：`list-sessions` 1 条（`version: 4`）、`read-session` **1832 个事件**，类型计数与升级前逐条一致；界面全链路待真机 |
| S5 | 🟡 focused `1795 tests / 1786 pass / 1 fail`（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs` Windows `/tmp` 路径问题）、`vue-tsc -b` 与 `oxlint` 干净；**三平台安装包构建未跑** |

**实施中发现的两个真实阻碍：**

1. **npm 12 的 install-scripts 门禁会静默拿掉内置 Node**（不在原方案的预判里）：`node` 包的 preinstall 被拦 → 打包里 `node/bin/node.exe` 不存在；`koffi`（`dsh-fs-local`、`dsh-session-persistence-jsonl` 的依赖，前者管文件系统、后者管会话持久化）与 `node-pty` 同理。已在 `package.json` 写入 pinned `allowScripts`（4 个包），让 CI 可复现。
2. **旧 `package-lock.json` 必须丢弃重生成**：直接 `npm install` 会在 `@deepseek-ai/dsh-llm@0.2.0-rc.2` 的 peer 上 ERESOLVE。

**未验收（不得写成已通过）：** 真机界面上打开那条 36 轮老会话并续聊、工具调用、`@文件` 权限切换；Windows/macOS/iOS 安装包构建与产物审计。

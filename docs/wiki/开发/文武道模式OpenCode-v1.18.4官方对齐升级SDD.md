# 文武道模式 OpenCode v1.18.4 官方对齐升级 SDD

> **For agentic workers:** 实施时必须使用 `subagent-driven-development` 或 `executing-plans`，逐阶段执行；每个阶段先写失败测试，验证通过并独立提交后才能进入下一阶段。

**Goal:** 先消除韭菜盒子自己加在 OpenCode 前面的生命周期和发送热路径开销，再把文、武、道共用内核从 v1.17.18 准确升级到官方 v1.18.4，最后只补 Provider、模型 variant、输入和上下文的真实缺口。

**Architecture:** 文、武、道继续共用一个 OpenCode sidecar、一条 `global.event`、按目录划分的 Client/Store 和同一个 `promptAsync` 发送合同。文=`plan`、武=`build`、道=`dao` 只在 Agent 定义上不同；韭菜盒子负责产品入口和 Provider 配置，不修改 OpenCode 官方源码，不再在每次发送前重启、重连或重载会话目录。

**Tech Stack:** Tauri v2、Rust、Vue 3、Pinia、TypeScript、`@opencode-ai/sdk` 1.18.4、OpenCode runtime v1.18.4、Node test runner、Cargo test。

---

> 日期：2026-07-22
> 状态：待实施
> 当前基线：Studio SDK/runtime v1.17.18；官方目标 tag `v1.18.4`（`49c69c5ed3ccf706b61b3febb43c8aaff7f8325e`）
> 官方旧基线 tag：`v1.17.18`（`b1fc8113948b518835c2a39ece49553cffe9b30c`）
> 范围：Desktop 文、武、道共用 OpenCode 链路；Web 和旧创模式不在本轮范围内

## 1. 一句话决策

```text
先修韭菜盒子自己的 sidecar 和发送热路径
-> 再对齐官方会话工作区
-> 再同时升级 SDK/runtime 到 v1.18.4
-> 再接官方模型 variant
-> 最后只补输入与上下文的确定性缺口
```

不能反过来。直接升级版本不会自动删除韭菜盒子每次发送前的重复工作，反而会把性能根因和版本兼容问题混在一起。

## 2. 产品边界

### 2.1 文、武、道的关系

```text
同一个 OpenCode 内核
├── 文：plan Agent
├── 武：build Agent
└── 道：dao Agent

三者共用：
sidecar / SDK Client / global.event / session / message / part
permission / question / tools / Skill / MCP / attachment / compaction
Provider / model / variant / context usage
```

道模式仍只比文、武多一份模型优先提示词。不得给道模式新建独立会话、发送器、工具循环、权限引擎或上下文系统。

### 2.2 韭菜盒子与 OpenCode 的边界

| 层级 | 归属 | 本轮规则 |
|---|---|---|
| OpenCode runtime、SDK、Agent 循环、会话、工具和事件协议 | OpenCode 官方 | 按 v1.18.4 行为翻译，不打补丁改变语义 |
| sidecar 启停、Tauri 进程托管、Provider/K 投影、Vue 入口 | 韭菜盒子适配层 | 只做跨平台接线和产品数据投影 |
| 文件树、编辑区、创作面板、媒体任务 | 韭菜盒子公共产品层 | 可以被文武道使用，但不塞进 OpenCode 内核 |
| 旧创模式 Direct Runtime | 独立产品线 | 本轮不改、不删、不迁移 |
| NewAPI 服务端 | 外部现有服务 | 不改装 NewAPI，不给某个模型增加私有通道 |

### 2.3 明确不做

- 不重写 OpenCode Agent 循环。
- 不修改 `/Users/by3/Documents/jiucaihezi-opencode` 官方源码。
- 不把 OpenCode SolidJS UI 整套搬进 Vue。
- 不改旧创模式、媒体生成、视频分析或 NewAPI 后端。
- 不自动切模型，不为视频建立特殊 Provider。
- 不复制官方面向全局 Home 的 5000 条会话扫描；Studio 继续只展示当前项目会话。
- 不为这次升级新增第二套 Store、事件总线或状态库。
- 不用 `pkill opencode` 清理历史进程；它会误杀用户自己运行的 OpenCode。
- 不顺手重构文件树、编辑器、设置页或创作面板。

## 3. 已确认根因

### 3.1 sidecar 生命周期不符合官方模型

当前 `src-tauri/src/commands/opencode.rs` 的 `opencode_ensure_server()` 每次调用都会先运行登录 Shell：

```text
load_shell_env()
-> 获取 operation 锁
-> 比较 directory/config
-> 复用或重启 sidecar
```

实测一次 `load_shell_env()` 约增加 0.79 秒。OpenCode v1.18.4 Desktop 的 `preferAppEnv()` 只在应用启动阶段加载一次环境，sidecar 也只启动一次。

当前 Rust 还把 OpenCode 错判为“单目录进程”，项目目录变化会杀掉旧进程再启动新进程。官方 SDK v1.17.18 和 v1.18.4 都已经通过 `x-opencode-directory` / `directory` 参数让一个 Server 服务多个目录；Studio 的 `src/opencodeClient/client.ts` 也已经按目录创建 Client。

### 3.2 每次发送重复执行连接前置链

当前 Desktop 发送仍经过：

```text
projectStoredNewApiForOpenCode
-> ensureConnected
-> Rust opencode_ensure_server
-> bootstrapDirectory/session.list
-> openSession（部分情况）
-> updateSessionPermission
-> promptAsync
```

官方热发送路径是：

```text
已有 Client/Store
-> 新会话时才 session.create
-> optimistic message/parts
-> promptAsync
```

连接、目录 bootstrap 和权限配置属于应用/项目/会话生命周期，不属于每条消息生命周期。

### 3.3 当前配置会让模型选择影响 Server 配置

`projectNewApiForOpenCode()` 用当前模型选择 `config.model` 所在 Provider。用户切换 Provider 时，配置签名会变化，Rust 可能重启 sidecar；但官方把用户本轮模型放在 `promptAsync({ model })`，不会为了切模型重启 Server。

目标是：

- Server 配置只随 Provider 目录、Key、模型目录或 Agent 配置真实变化而变化。
- 当前选择的模型和 variant 只随本轮 Prompt 发送。

### 3.4 当前进程证据

2026-07-22 只读审计时：

- 存在 59 个 `opencode serve` 进程。
- 其中 58 个 PPID 为 1，属于孤儿进程。
- 总 RSS 快照约 6.27 GiB。
- OpenCode SQLite 约 384 MiB，包含 277 个 session。

这些数字是当前开发机证据，不是产品常量。实施前需要人工只清理确定属于韭菜盒子旧调试实例的进程，再记录干净基线；产品代码不得扫描并杀死所有 OpenCode 进程。

### 3.5 “道模式慢”不全是基础设施问题

最近真实道模式会话中，简单输入携带约 14,145 tokens；另一次任务约 147 秒后才首次调用工具，随后连续执行约 14 次 `glob/read/grep`，整轮约 3 分 22 秒。

因此必须分开验收：

1. 韭菜盒子发送前开销：本 SDD 必须消除。
2. Provider 首 Token：与同模型、同 Key 的官方 OpenCode横向比较。
3. 模型主动执行大量工具：属于 Agent 决策，不允许用隐藏工具或截断循环伪装成“更快”。

## 4. 官方 v1.18.4 依据

唯一官方版本事实源是 OpenCode tag `v1.18.4`，不是本地自定义分支的未提交文件。

| 领域 | 官方文件 | 本轮采用内容 |
|---|---|---|
| sidecar | `packages/desktop/src/main/{index,server,shell-env,sidecar}.ts` | 应用级单实例、环境只加载一次、显式 stop、健康检查 |
| 多目录 Client | `packages/sdk/js/src/v2/client.ts` | `x-opencode-directory`、按目录 Client、一个 Server 多目录 |
| 会话工作区 | `packages/app/src/context/{server-sync,directory-sync,server-session}.ts(x)`、`global-sync/*` | 全局事件流、目录子状态、首次 bootstrap、断线重同步 |
| Prompt | `packages/app/src/components/prompt-input/{build-request-parts,submit}.ts` | 空文本省略、结构化 parts、乐观写入、`promptAsync` |
| 输入状态 | `packages/app/src/context/prompt-state.ts` | 会话级 Prompt/模型/variant 的状态边界 |
| Variant | `packages/app/src/context/model-variant.ts` | 只从当前模型真实 variants 选择，不猜档位 |
| Provider | `packages/opencode/src/provider/{provider,transform}.ts` | `reasoning_options` 语义、variant 派生、Provider 参数修正 |

v1.17.18 到 v1.18.4 与本轮直接相关的官方变化包括：

- Home 冷启动会话索引优化。
- 目录子 Store 生命周期与回收。
- Prompt 状态从组件中抽出并支持会话级模型选择。
- 附件/Context 结构化请求进一步收敛。
- 空 Prompt 不再发送空 text part。
- Provider 根据 `reasoning_options` 和模型语义生成 variants。
- `promptAsync` 和用户消息继续携带 `variant`。

Studio 已有结构化 OpenCode file part、空文本省略、全局事件桥和上下文用量显示。本轮只补差异，不重复实现已经对齐的部分。

## 5. 目标运行架构

### 5.1 应用生命周期

```text
Desktop 启动
-> 加载 Shell 环境一次
-> 首次进入文/武/道时启动一个 OpenCode sidecar
-> 建立一条 global.event
-> 为当前 projectDir 创建/复用目录 Client
-> 首次进入该目录时 bootstrap 一次

切项目
-> sidecar PID 不变
-> global.event 不变
-> 切换目录 Client/Store
-> 新目录首次 bootstrap

正常退出/重启/更新
-> 显式停止 sidecar
-> 等待退出，超时后强制终止
```

### 5.2 消息发送热路径

```text
用户在文/武/道点击发送
-> 等待应用级 OpenCode ready（冷启动时才等待）
-> 使用当前目录 Client
-> 没有 session 才 session.create
-> 组装 text/file/agent parts
-> 乐观写入 user message/parts
-> promptAsync({ agent, model, variant, system, parts })
-> global.event 持续回写 Store
```

发送热路径禁止出现：

- `load_shell_env`
- `opencode_ensure_server`
- `session.list` / `bootstrapDirectory`
- 全量消息刷新
- 无变化的 `session.update(permission)`
- 因切模型而重启 sidecar

### 5.3 配置变化

```text
Provider/K/模型目录/dao Agent 配置真实变化
-> 生成新稳定 config signature
-> 受控停止旧 sidecar
-> 启动新 sidecar
-> 重建唯一 global.event
-> 恢复当前目录和 session

只切本轮 model/variant
-> 不改 Server config
-> 不重启 sidecar
-> 直接随 promptAsync 发送
```

## 6. 实施顺序

每个 Phase 都是独立门禁。前一阶段没有通过，不得把后一阶段混进来“顺便修”。

### Phase 0：冻结基线和证据

**目标：** 先区分韭菜盒子固定开销、Provider 延迟和模型工具决策。

**文件：**

- 不修改产品代码。
- 新建实施证据文件：`/private/tmp/jc-opencode-v1.18.4-baseline.log`，不提交仓库。

- [ ] 确认当前已批准的未提交工作先独立提交；随后从该提交创建 `feat/opencode-v1.18.4-alignment` worktree。不得在当前脏工作区直接执行本 SDD。
- [ ] 记录 `package.json`、`opencode-runtime.json`、二进制 `--version` 和官方 tag hash。
- [ ] 人工确认并清理只属于韭菜盒子旧调试实例的 sidecar；禁止广泛 `pkill opencode`。
- [ ] 记录干净状态下启动、切两个项目、连续发送 5 次、正常退出后的 PID、PPID、RSS 和 CPU。
- [ ] 用同一个 Provider/K、模型和“你好”分别测官方 OpenCode与 Studio，各 5 次，记录点击到请求发出、首 Token 和完成时间。
- [ ] 记录一个明确会调用工具的相同任务，用于区分“客户端慢”和“模型工具链长”。

**门禁：** 基线日志必须包含版本、进程、客户端发送前耗时、TTFT 和完整轮次耗时；没有基线不得进入 Phase 1。

### Phase 1：sidecar 单实例和生命周期

**目标：** 一个 Desktop 应用进程只拥有一个 OpenCode sidecar；切目录和普通发送不重启。

**Files:**

- Modify: `src-tauri/src/commands/opencode.rs`
- Modify only if lifecycle test requires: `src-tauri/src/lib.rs`
- Modify: `src/utils/__tests__/opencodeRuntimePackaging.test.ts`
- Test: `src-tauri/src/commands/opencode.rs` 内 Rust 单元测试

- [ ] **先写失败测试：目录变化不触发替换。** 把“是否替换当前 session”的判断提取为纯函数，测试运行中的相同配置从 `/project-a` 切到 `/project-b` 返回 `false`；子进程已退出或配置签名变化返回 `true`。
- [ ] **先写失败测试：Shell 环境每个 App 进程只加载一次。** 对环境加载器注入计数函数，两次 `ensure` 只执行一次 loader。
- [ ] **先写失败合同：打包测试不再允许 directory 参与 sidecar 替换条件。** `opencodeRuntimePackaging.test.ts` 必须检查源码中没有 `current.directory != requested_dir`。
- [ ] 运行 RED：`pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/utils/__tests__/opencodeRuntimePackaging.test.js`；`cargo test --manifest-path src-tauri/Cargo.toml opencode`。预期新增断言失败。
- [ ] 将 Shell 环境缓存到 `OpenCodeRuntime` 的应用生命周期状态中。第一次启动 sidecar 时加载，后续 `ensure` 直接复用；Windows 继续跳过 Unix login shell，macOS/Linux 保留官方超时和 fallback 语义。
- [ ] 删除“OpenCode 是单目录进程”的错误判断。sidecar 使用稳定启动目录；项目目录只进入 SDK 目录 Client，不进入进程替换条件。
- [ ] 保留配置签名变化和子进程已退出时的受控重启；停止时继续先 `start_kill`、等待最多 6 秒、再强制 kill。
- [ ] 保留现有 `RunEvent::Exit`、SIGINT、SIGTERM 和显式 relaunch 清理；只在测试证明缺口时改 `lib.rs`，不得重复增加第二套退出回调。
- [ ] 运行 GREEN：上述 Node/Rust 测试通过，`cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过。
- [ ] 人工验收：同一 App 切换两个项目并发送，PID 不变；正常关闭后该 PID 不存在；连续启动/退出 10 次不新增孤儿进程。
- [ ] Commit：`fix: align opencode sidecar lifecycle`

**门禁：** sidecar 单实例和退出清理未通过前，不升级 runtime。

### Phase 2：删除每次发送的重复前置链

**目标：** 热发送只负责当前 session 和 `promptAsync`，连接准备移到 App/项目生命周期。

**Files:**

- Modify: `src/App.vue`
- Modify: `src/composables/useChat.ts`
- Modify: `src/stores/openCodeSyncStore.ts`
- Modify: `src/opencodeClient/providerProjection.ts`
- Modify: `src/components/chat/ChatPanel.vue`（只移动 Skill 权限更新时机）
- Test: `src/components/__tests__/desktopOpenCodeSyncCutover.test.ts`
- Test: `src/stores/__tests__/openCodeSyncStore.test.ts`
- Test: `src/opencodeClient/__tests__/providerProjection.test.ts`

- [ ] **先写失败测试：热发送不做初始化。** 从 `useChat.ts` Desktop send 片段断言不存在 `projectStoredNewApiForOpenCode`、`ensureConnected`、`openSession`、`bootstrapDirectory`、`updateSessionPermission`，只允许 `ensureSession` 和 `submitPrompt`。
- [ ] **先写失败测试：当前模型不改变 Server 配置签名。** 同一 Provider 目录下切两个模型、跨两个 Provider 切模型时，投影出的 Server 配置必须保持稳定；本轮模型仍由 `toOpenCodeModelProjection()` 单独产生。
- [ ] **先写失败测试：ready 只复用 App 初始化 Promise。** 连续两次发送不得触发第二次 Rust `ensureServer` 或第二次 directory bootstrap。
- [ ] 运行 RED：`pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/components/__tests__/desktopOpenCodeSyncCutover.test.js /private/tmp/jc-focused-tests/stores/__tests__/openCodeSyncStore.test.js /private/tmp/jc-focused-tests/opencodeClient/__tests__/providerProjection.test.js`。
- [ ] 让 `App.vue` 成为 Desktop OpenCode 初始化入口：项目/模式进入时生成配置并调用一次 `ensureConnected`；冷启动发送只等待 Store 已有 ready Promise，不自行启动新初始化。
- [ ] 让 `projectNewApiForOpenCode()` 的 Server 默认模型使用稳定、确定性的首个可执行模型；用户当前选择不得改变配置签名。
- [ ] 从 `useChat.ts` 移除每条消息的配置投影和连接调用。没有 ready 时显示真实连接错误；不得静默回退到另一套聊天内核。
- [ ] 新 session 创建时一次性写入当前 Skill permission；用户切 Skill 时只在选择动作发生后更新一次。Skill 没变时不发 `session.update(permission)`。
- [ ] 保留每轮 `buildFixedSkillSystemInstruction()`、当前 Agent、当前模型、附件 parts 和乐观消息；这些是 Prompt 内容，不是初始化成本。
- [ ] 运行 GREEN，并确认普通发送前没有 `session.list`、`session.update` 或 Tauri `opencode_ensure_server`。
- [ ] Commit：`perf: remove opencode send preflight`

**门禁：** 连续 5 次暖发送必须复用同一个 sidecar、Client、global event 和已 bootstrap 目录。

### Phase 3：会话工作区按官方目录状态对齐

**目标：** 一个 Server 下按目录管理状态；bootstrap 只在首次进入、断线恢复或明确刷新时发生。

**Files:**

- Modify: `src/stores/openCodeSyncStore.ts`
- Modify: `src/opencodeClient/eventBridge.ts`
- Modify only if Desktop 投影仍重复加载: `src/stores/sessionStore.ts`
- Test: `src/stores/__tests__/openCodeSyncStore.test.ts`
- Test: `src/opencodeClient/__tests__/eventBridge.test.ts`
- Test: `src/components/__tests__/desktopOpenCodeSyncCutover.test.ts`

- [ ] **先写失败测试：每目录只 bootstrap 一次。** A -> B -> A 切换时，A/B 各调用一次 `session.list`；同目录重入不重复请求。
- [ ] **先写失败测试：Server 断线重连后重同步。** `server.connected` 后只对当前目录执行一次 status/permission/question/session reconcile，并保留事件流期间到达的新 revision。
- [ ] **先写失败测试：事件桥持续重连。** 临时连续失败后恢复时仍能接收事件；只有显式 `stop/dispose` 才永久结束，不能达到固定失败次数后静默死亡。
- [ ] **先写失败测试：Desktop sessionStore 不再拥有第二个 bootstrap 入口。** Desktop 会话列表只投影 `openCodeSyncStore.sessionsForDirectory()`。
- [ ] 运行 RED。
- [ ] 在现有 Sync Store 增加已 bootstrap 目录集合；Server generation 变化时清空，普通目录切换不清空。
- [ ] 保持一个 global Client/bridge；目录 Client 继续由 `createJiucaiOpenCodeClient(handle, directory)` 缓存。
- [ ] 目录首次激活执行 `session.list({ roots:true, limit:64 })`；Studio 不复制官方 Home 全局大索引。
- [ ] 断线恢复依赖官方 `server.connected` 触发当前目录 reconcile；事件 revision 继续防止旧快照覆盖新事件。
- [ ] 移除 `sessionStore.loadAllSessions()` 对 Desktop 的重复注册/bootstrap职责，只保留 Web 的 IndexedDB 行为和 Desktop 响应式投影。
- [ ] 仅释放已经离开且没有活动 session/请求的目录缓存；不得在切项目时断开全局 bridge 或停止 sidecar。
- [ ] 运行 GREEN。
- [ ] 人工验收：A 项目发送 -> B 项目发送 -> 回 A 打开旧会话；消息不串线、不消失，sidecar PID 和 global event 数量不变。
- [ ] Commit：`refactor: align opencode directory session state`

**门禁：** 目录切换和断线恢复未稳定前，不升级 SDK/runtime。

### Phase 4：SDK 与 runtime 同步升级到 v1.18.4

**目标：** 客户端类型、请求协议和实际 sidecar 二进制保持同一个官方版本。

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/update-opencode-runtime.mjs` 或所有调用处，固定目标 release
- Modify: `.github/workflows/build.yml`
- Regenerate: `src/data/opencodeRuntimeInfo.ts`
- Regenerate local platform: `src-tauri/binaries/opencode-runtime.json`
- Replace runtime binaries through existing updater; do not手工复制未知二进制
- Test: `src/utils/__tests__/opencodeRuntimePackaging.test.ts`
- Test: `src/opencodeClient/__tests__/sdkContract.test.ts`

- [ ] **先写失败测试：唯一版本合同固定为 1.18.4。** SDK、manifest、frontend metadata 和 CI 下载参数必须一致；CI 禁止无版本的 `latest` 漂移。
- [ ] 运行 RED，确认当前 1.17.18 失败。
- [ ] 执行 `pnpm add @opencode-ai/sdk@1.18.4 --save-exact`。
- [ ] 使用现有更新器生成各发布目标：Apple Silicon 执行 `node scripts/update-opencode-runtime.mjs --version=v1.18.4 --platform=darwin --arch=arm64`；Intel Mac 执行 `node scripts/update-opencode-runtime.mjs --version=v1.18.4 --platform=darwin --arch=x64`；Windows x64 执行 `node scripts/update-opencode-runtime.mjs --version=v1.18.4 --platform=win32 --arch=x64`。三个 CI job 必须下载同一 tag。
- [ ] 在 `.github/workflows/build.yml` 三个平台的下载命令显式固定 `--version=v1.18.4`，不得让一次发布混入更晚的 runtime。
- [ ] 运行 `pnpm install --frozen-lockfile`、版本合同测试和 SDK 合同测试。
- [ ] 运行 `pnpm exec vue-tsc -b` 与 `cargo test --manifest-path src-tauri/Cargo.toml`，只处理 v1.18.4 造成的真实类型/协议差异。
- [ ] 人工检查 Settings/诊断信息显示 runtime 1.18.4，实际 `--version` 也是 1.18.4。
- [ ] Commit：`chore: upgrade opencode sdk and runtime to 1.18.4`

**门禁：** SDK 和 runtime 任一不是 1.18.4 都不得进入 Provider 功能阶段。

### Phase 5：Provider 模型能力、推理档位和 variant

**目标：** 展示和发送 OpenCode v1.18.4 实际给出的模型能力；不伪造所有模型都支持工具、附件或固定推理档位。

**Files:**

- Modify: `src/stores/agentStore.ts`
- Modify: `src/opencodeClient/catalog.ts`
- Modify: `src/opencodeClient/providerProjection.ts`
- Modify: `src/opencodeClient/types.ts`
- Modify: `src/stores/openCodeSyncStore.ts`
- Modify: `src/composables/useChat.ts`
- Modify: `src/components/chat/ChatPanel.vue`（在现有模型菜单内增加最小 variant 选择）
- Test: `src/opencodeClient/__tests__/catalog.test.ts`
- Test: `src/opencodeClient/__tests__/providerProjection.test.ts`
- Test: `src/stores/__tests__/agentStore.test.ts`
- Test: `src/stores/__tests__/openCodeSyncStore.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [ ] **先写失败测试：能力不再全部硬编码为 true。** 明确 `toolCall:false` 的模型投影为 `tool_call:false`；只有声明非文本输入的模型才投影相应 modalities/attachment。
- [ ] **先写失败测试：variant 来自 OpenCode目录。** `normalizeOpenCodeModel()` 保留 v1.18.4 返回的 variant ID；没有 variants 的模型不显示档位控件。
- [ ] **先写失败测试：variant 随 Prompt 发送。** optimistic user message 和 `promptAsync` 同时携带同一个 `variant`；未选择时字段省略。
- [ ] **先写失败测试：选择按模型隔离。** 模型 A 的 `high` 不得泄漏给没有 `high` 的模型 B；切回 A 可恢复 A 的选择。
- [ ] 运行 RED。
- [ ] `ModelEntry` 只保留真实能力字段和 OpenCode 返回的 variants；NewAPI `/v1/models` 没提供的字段不得靠公司名或模型名猜测成确定事实。
- [ ] Provider config 遵守官方默认语义：`tool_call` 只有明确 false 时为 false；`attachment/modalities` 来自真实输入能力；不再无条件写 `attachment:true`。
- [ ] 由 v1.18.4 runtime 负责官方 Provider 参数和通用 variant 派生。Studio 不复制 `ProviderTransform`，也不手写 GPT/Claude/Gemini 各家的请求体。
- [ ] 在现有模型菜单中用最小二级选项展示当前模型真实 variants；没有 variants 时完全不出现该控件。
- [ ] variant 按 `providerID/modelID` 保存；发送时加入 `SubmitOpenCodePromptInput.variant`、乐观消息 model 和 `promptAsync({ variant })`。
- [ ] 切文/武/道不改变当前模型/variant；切 Provider 或模型不重启 sidecar。
- [ ] 运行 GREEN，并用至少一个有 variants 和一个无 variants 的真实模型验收请求体。
- [ ] Commit：`feat: align opencode model variants`

**现实边界：** NewAPI 标准 `/v1/models` 如果不提供细粒度推理元数据，Studio 只能使用 OpenCode v1.18.4 对该自定义 OpenAI-compatible Provider 实际派生出的 variants。不得为了“看起来完整”伪造档位。

### Phase 6：输入与上下文只补真实缺口

**目标：** 保持当前已对齐合同，只补 v1.18.4 的确定性差异，不重做编辑器。

**Files:**

- Modify only on failing contract: `src/opencodeClient/session.ts`
- Modify only on failing contract: `src/components/chat/ChatPanel.vue`
- Modify only on failing contract: `src/stores/openCodeSyncStore.ts`
- Test: `src/opencodeClient/__tests__/session.test.ts`
- Test: `src/components/__tests__/desktopOpenCodeSyncCutover.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [ ] **先固定已通过合同：附件-only Prompt 不包含空 text part。** 当前 `text.trim()` 为空时只发送 file part；测试用于防回归，不为它重写代码。
- [ ] **先固定已通过合同：附件保持结构化。** `file://`、data URL、resource source、filename 和 MIME 不得压平进系统提示词；重复 URL 只发一次。
- [ ] **先写失败测试：会话恢复当前模型和 variant。** 打开旧 session 时，从最后一条用户消息恢复有效的 `providerID/modelID/variant`；目录中已不存在的模型/variant 才回退当前可用选择。
- [ ] **先写失败测试：发送失败不污染输入。** `promptAsync` 失败时只回滚本次乐观 message/parts，用户输入和附件保持可重试。
- [ ] 运行 RED。
- [ ] 只实现上述失败项。当前 contenteditable、`@` 文件/Agent/资源、Slash、附件上传和上下文用量 UI 保持原样。
- [ ] 不复制官方 `prompt-state.ts` 的 SolidJS 实现；只在现有 Vue/Pinia 状态中保存 Studio 真正需要的 session 模型/variant 和失败恢复。
- [ ] 不增加新的上下文压缩器。压缩、token、message/part 和历史真源继续由 OpenCode负责。
- [ ] 运行 GREEN。
- [ ] 人工验收附件-only、文字+附件、失败后重试、切 session 恢复模型/variant 四个场景。
- [ ] Commit：`fix: align opencode prompt session state`

**门禁：** 没有失败测试证明的官方 UI 新能力一律不搬。

### Phase 7：全量验证和真实性能验收

**自动验证：**

```bash
pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build:desktop
git diff --check
```

期望：全部退出码 0；Desktop 产物审计通过；SDK/runtime/metadata 均为 1.18.4。

**真实 Desktop 验收矩阵：**

| 场景 | 预期 |
|---|---|
| 启动进入文模式 | 只有一个韭菜盒子 OpenCode sidecar 和一条 global event |
| 文/武/道来回切换 | PID、Client 基础连接和 session 历史不重建；只改变 Agent |
| 连发 5 次“你好” | 暖发送前无 ensure/bootstrap/permission update；直接 promptAsync |
| A -> B -> A 项目切换 | PID 不变；每个目录首次 bootstrap；历史不串线 |
| 切模型和 variant | PID 不变；请求携带正确 model/variant |
| Skill 不变连续发送 | 不重复更新 session permission |
| 修改 Skill 选择 | 只更新一次目标 session permission |
| 断开再恢复事件流 | 自动重连并 reconcile 当前目录，消息不丢 |
| 附件-only Prompt | 无空 text part，原生 file part 完整 |
| Prompt 失败 | 乐观消息回滚，输入和附件可直接重试 |
| 正常退出/重启/更新 | sidecar 在 6 秒内退出；10 次循环无新增孤儿进程 |

**性能验收：**

1. 暖发送从点击到 `promptAsync` 调用前，不得发生任何 sidecar、Shell、session.list 或 permission 网络工作。
2. 同模型、同 Key、同 Prompt 的 Studio 客户端额外开销，中位数不得比官方 OpenCode 多 200 ms。
3. TTFT 单独记录，不把 Provider 波动算作客户端固定开销；若 Studio 中位数仍比官方慢 1 秒以上，必须继续抓请求开始时间、请求体大小和首事件时间，不得宣布完成。
4. 模型主动工具轮次单独记录；不得通过禁用工具、缩短上下文或限制 Agent 循环通过性能验收。

**三平台门禁：**

- Apple Silicon：正式安装包启动、发送、退出。
- Intel Mac：baseline runtime、启动、发送、退出。
- Windows x64：baseline runtime、无黑框、启动、发送、退出。

未完成三平台人工验证时，只能写“本机和自动测试通过”，不能写“正式安装包已完成三平台验收”。

- [ ] Commit 文档和最终对照表：`docs: record opencode 1.18.4 alignment`

## 7. 文件责任锁定

| 文件 | 唯一职责 | 本轮禁止塞入 |
|---|---|---|
| `src-tauri/src/commands/opencode.rs` | sidecar 启停、环境、健康和进程状态 | 会话、模型选择、Prompt 内容 |
| `src/App.vue` | App/项目/模式生命周期触发初始化 | 每条消息发送逻辑 |
| `src/stores/openCodeSyncStore.ts` | OpenCode Server/目录/session/message/part 权威状态 | 创模式状态、媒体任务状态 |
| `src/opencodeClient/eventBridge.ts` | 唯一 `global.event` 的队列、心跳和重连 | Vue UI 状态 |
| `src/opencodeClient/providerProjection.ts` | 韭菜盒子 Provider/K/模型目录 -> OpenCode config | Provider 专属协议重写 |
| `src/opencodeClient/catalog.ts` | OpenCode返回目录 -> Studio 展示模型/Agent/Skill | 猜测模型能力 |
| `src/opencodeClient/session.ts` | OpenCode session 和 Prompt parts 合同 | 第二套上下文装配器 |
| `src/composables/useChat.ts` | 当前轮发送和 UI 状态投影 | sidecar 初始化、目录 bootstrap |
| `src/components/chat/ChatPanel.vue` | 用户入口、选择和视图 | OpenCode 内核实现 |

## 8. 回滚边界

每个 Phase 独立提交，出现回归只回滚当前 Phase：

1. Phase 1 回滚只恢复 sidecar 生命周期，不碰消息 Store。
2. Phase 2 回滚只恢复发送前置链，不降 runtime。
3. Phase 3 回滚只恢复目录状态管理。
4. Phase 4 必须 SDK/runtime 一起回滚，禁止只降一个。
5. Phase 5 回滚 variant UI/字段，不改会话和 sidecar。
6. Phase 6 回滚输入状态补丁，不回滚已验证的原生 file part。

任何阶段都不得用“切回旧创模式”掩盖文武道失败。

## 9. 完成定义

本 SDD 只有同时满足以下条件才算完成：

1. 文、武、道使用同一个 v1.18.4 SDK/runtime 和同一个 OpenCode 信息流。
2. 项目切换、模式切换和模型切换不会无故重启 sidecar。
3. 暖发送只执行 session 必要动作和 `promptAsync`。
4. directory bootstrap 不再每条消息执行。
5. 能力和 variants 来自真实目录；不再无条件伪造附件能力。
6. model/variant 随本轮 Prompt 发送并按 session 正确恢复。
7. 文字、原生附件、Skill、工具、权限、上下文压缩和会话历史没有回归。
8. 正常生命周期不再累计新的孤儿 sidecar。
9. 自动测试、Desktop 构建、产物审计和真实性能对照都有证据。
10. Wiki 的 [[架构/对照表]]、[[开发/OpenCode差异修复记录]]、[[hot]] 和 [[来源索引]] 已按真实实施结果更新。

## 10. 最终架构结论

```text
OpenCode v1.18.4 负责：
Agent + Provider + model variant + session + context + tools + Skill + MCP + attachments

韭菜盒子负责：
一个可靠 sidecar + NewAPI/本地 Provider 配置 + Vue 产品入口 + 公共产品能力

文武道的差异只有：
plan / build / dao Agent
```

最重要的升级成果不是“多了多少 v1.18.4 UI”，而是韭菜盒子不再挡在 OpenCode 官方链路前面重复做事。

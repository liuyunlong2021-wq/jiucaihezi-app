# Wiki 操作日志

## [2026-10-03] 发布 | v2.2.11（三平台 CI 已触发，构建中）

- 版本号三处统一到 `2.2.11`（`pnpm run bump-version`：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`，`Cargo.lock` 同步）；发布提交 `dbb21f45`。
- **发布门禁**：Node 聚焦套件 `1774 用例 / 1765 通过 / 1 失败`（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs` Windows `/tmp` 路径问题）；Rust `454 通过 / 0 失败 / 1 忽略`；`build:desktop:quick` 通过且 `audit:desktop-dist` 通过（工作台被提升为根 `index.html`）。
- `src/assets/icons-bundle.json` 随版本刷新：锁定版本 `@iconify-json/material-symbols@1.2.86` 下重新生成后上游把 `alt-route` 归并到 `alternate-email`；全仓库无任何引用，只是让产物与锁定依赖一致。
- 推送：`main`（`833a5984..dbb21f45`）+ annotated tag `v2.2.11`（按合同只推单个 tag，没用 `--tags`）。CI 运行 `37118511789`：`prepare-release` 已成功、`macos-arm` 排队、`macos-intel` / `windows` 进行中。
- ⚠️ **状态口径**：此刻只能说「已触发、构建中」。要等三个平台 + 上传 + `publish-download-manifest` 全部成功，才能写「v2.2.11 已发布」。

## [2026-10-03] 修复 | Computer Use 定案：图外包「profile 解析不到」，补链接后真机生效

- 用户质疑「官方能实现，直接搬过来」，逼出正解。方案与验收记录见 [[开发/韭菜盒子Harness-Computer-Use接入-2026-10-03]] §4。
- **根因**：官方 Loader 解析裸包名锚在 **profile 目录**（`ctx.baseUrl` = `<DSH_HOME>/profiles/<profile>/`）。已发布 bundle 依赖图内的包能命中（`dsh-file-reference-local` 是 `dsh-web-app` 的依赖），**图外的包解析不到时只记一条 `failed to import`** —— 既不是 `pending`、也不让启动失败，于是表现为「不报错 + runner 零 stderr + 工具表空无一物」。逼出这条记录的唯一办法是直接起一次启动器：`DSH_HOME=<ws> node .../dsh/lib/bin.js --profile sdk --patch <route.cordis.yml> < nul`。
- **改动**：新增 `src-tauri/resources/deepseek-harness/profile-plugins.mjs`（`ensureProfilePluginLinks()`：profile 缺失先用官方 `--dump-config` 催生骨架，再把运行时那两份包挂成 Windows 目录联接，失败只跳过）；`runner.mjs` 在 `config.computerUse` 打开时调用它；`deepSeekHarness.ts` 把 `computerUse` 传进 runner 配置。
- **验证**：同一条命令、同一 home、只改一处 —— 修前 `tools=24 cua=0 CUA指导=false`，修后 **`tools=80 cua=56 CUA指导=true`**，且同一轮 `@skill` 硬限制照旧（点名 → 工具 79、`skill=false`）；新增 `scripts/__tests__/deepseek-harness-profile-plugins.test.mjs` 6 用例；聚焦套件 `1774 tests / 1773 pass / 1 fail`（既有 Windows `/tmp`）；`vue-tsc -b` 干净。
- **未验收**：真机让模型调 `cua_driver_native__*` 并接收截图；关开关后工具消失。**过程教训**：`runner` 零 stderr 不能当生效证据（子进程 stderr 被 SDK 收进 `stderrTail`、只在运行时死亡时抛），判定只看模型实际收到的工具表。

## [2026-10-03] 新增 | 点名 Skill 只挂一个（官方 tools.restrict）+ 删除 @Jev

- 用户诉求：「我 @ 了一个具体 skill，后续任务只允许用这一个；不管 @Jev，直接把它删了」。方案与实测见 [[开发/韭菜盒子Harness点名Skill只挂一个-2026-10-03]]。
- 查过再动：官方 `dsh-tool-skill` 的目录发布与 `/name` 注入是两个钩子；工具不可见时目录变空，而注入不看工具可见性。`dsh-tools` 的 `restrict` 要求在 scoped ctx（`agent.ctx`）上调用、返回 disposer。官方 `dsh-subagent` 已在用同一手法。
- 改动：`prepare-deepseek-harness.mjs` 第 6 处补丁（`prompt` 前 `applyPinnedSkillScope` + 逐字搬官方手势正则 + 查注册表 + `tools.restrict`，`inject` 补 `skills`）；契约与 §12.4 同步；新增 1 条契约测试；连带删掉 @Jev（决策层、打分器运行时与脚本、Rust 命令、设置项、测试与打包审计条目）。
- 验证：本地假模型回显工具表 → 24/skill=true → 点名后 23/skill=false → 撤销后 24/skill=true；补丁幂等测试 2/2；`1768 tests / 1759 pass / 1 fail`（既有 Windows `/tmp`）；`vue-tsc -b` 干净。
- 未验收：真机 UI；`cargo check` 被 dev App 占用构建产物拦住（`os error 32`）。

## [2026-10-03] 新增 | 重试链可见 + 失败不丢过程 + 重试预算对齐官方

- 用户诉求：报错后「所有之前的任务执行内容也一起隐藏起来」，还得点「继续」才能接着干。方案与实施表见 [[开发/韭菜盒子Harness重试与失败对齐官方TDD-2026-10-03]]。
- 改动：`deepSeekHarness.ts` 新增重试投影（`llm/retry` / `llm/retry-started` → 过程条目）、`DEEPSEEK_RETRY_TEXT`（官方 zh 字典逐字）、`deepSeekFailureText()`（官方 `failureMessage()` 的子集）、失败投影补 `attempts`、`maxRetries: 1 → 5`；`desktopConversationRuntime.ts` 的 `MemoryRunStep` 能携带重试条目；`MemoryWorkbench.vue` 加重试行、官方失败行结构、折叠规则改「运行中或本轮失败」、失败行给「继续」按钮。
- 契约测试：新增 5 条（重试链投影、预算 5 + `∞`、`attempts` + 文案映射、官方字典逐字漂移守卫、重试行/失败行/继续按钮）；同步改掉两条锁旧行为的断言（`maxRetries: 1`、`:open="isLiveTurn(...)"`）。
- 门禁：`1802 tests / 1793 pass / 1 fail`（既有 Windows `/tmp` 用例）、`vue-tsc -b` 干净、`oxlint` 仅剩既有告警。
- 未验收：真实 524 时重试行与倒计时的界面效果；含 `llm/retry` 的真会话属于另一个工作区，回放未完成。

## [2026-10-03] 新增 | Computer Use 接入官方 Cua Driver 原生提供方

- 用户诉求：**必须要有 Computer Use**。方案与验收记录见 [[开发/韭菜盒子Harness-Computer-Use接入-2026-10-03]]。
- **查过再动**：官方把它拆成「注册位服务 + 提供方」两层，都在 npm 上。上一轮查不到是因为**两个提供方的名字都带 `dsh-experimental-` 前缀**（`@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.2.0-rc.2`）。服务包本身无工具无配置；官方限制**一次只能挂一个提供方**。
- 决策（用户已确认）：提供方选**原生**（不要求用户另装 `cua-driver` CLI），生效方式是**设置开关、默认开**。
- 改动：`src-tauri/resources/deepseek-harness/package.json` 加两条依赖（`dsh-computer-use` + 原生提供方）并重生成锁；`deepSeekHarness.ts` 新增 `computerUsePatch`（走既有 `insertPatch()`）+ 开关进 `runtimeKey()`；`agentStore.ts` 加 `COMPUTER_USE_STORAGE_KEY` / `computerUseEnabledNow()` / `computerUseEnabled` / `toggleComputerUse`；`MemorySettings.vue` 加开关行；`deepSeekHarness.test.ts` 加 1 条契约测试。
- 验证：`--dump-config` 退出 0、stderr 空、两条条目命中；同 patch 真跑 `runner.mjs` → `ready`、零 stderr；提供方与原生驱动均可加载；`attachment-local` 在组合里；聚焦 `1797 / 1788 pass / 1 fail`（既有 Windows `/tmp`）；`vue-tsc -b` 与改动文件 `oxlint` 干净。
- 未验收：真机让模型调用 `cua_driver_native__*` 并接收截图；关开关后工具消失。风险已登记（原生与宿主同进程、平台二进制体积、截图需图片模态）。

## [2026-10-03] 升级 | Harness 运行时升到 0.2.0-rc.2

- 用户诉求：全面对齐官方。官方 `latest`/`next` = `0.2.0-rc.2`，我们此前锁在 `0.1.7-alpha.2`（`alpha` tag 至今停在那一版）。方案见 [[开发/韭菜盒子Harness升级0.2.0-rc.2方案-2026-10-03]]。
- **查过再动**：把 `dsh-sdk-protocol` / `dsh-sdk-jsonrpc-server` / `dsh-agent-loop` / `dsh-base` / `dsh-llm-pi-ai` / `dsh-tool-subagent` / `dsh-app-boot` 的 0.2.0-rc.2 包解包，与本机逐字对比：**官方 SDK 请求/通知面逐字未变**；5 处 vendor patch 的锚点全部命中；`agent/assistant-stream` 的发出点逐字相同；`sessionQuery` / `agents.resume` / `commands` 服务仍在 profile 里；route patch 用到的全部配置键与 `- insert:` 语义都还在；**会话数据格式仍是 V4（不存在 v4→v5 迁移包）**；`dsh-sdk-client` 构造参数逐字一致，所以 `runner.mjs` 未改。
- 改动：`package.json` 升到 `0.2.0-rc.2`；`prepare-deepseek-harness.mjs` 不再自带版本常量，改为从 `package.json` 读（单一真源，测试锁住）；`package-lock.json` 干净重生成——旧锁与 0.2.0 的 peer 解析冲突，`npm ci` 会直接 ERESOLVE。
- 顺带解决一个**发布级隐患**：npm 12 的 install-scripts 门禁拦下了 `node` 包的 preinstall，导致打包内置的 `node/bin/node.exe` 根本不存在（`koffi` / `node-pty` 的原生件同理，而 `koffi` 是 `dsh-fs-local`、`dsh-session-persistence-jsonl` 的依赖）。已在 `package.json` 写入 pinned `allowScripts`：`node@22.23.2`、`koffi@3.1.1`、`node-pty@1.2.0-beta.15`、`@deepseek-ai/dsh-subprocess-local@0.2.0-rc.2`，让 CI 可复现。
- 验证：`--dump-config` 退出 0，provider（`api: openai-completions` / `baseURL` / `retryPolicy`）、`tool-subagent(one-shot)`、insert 进来的 `file-reference-local` 逐条命中，零 `entry not found`；补丁幂等测试通过；**用新运行时读老会话：`list-sessions` 1 条（`version: 4`）、`read-session` 1832 个事件，类型计数与升级前逐条一致**；focused `1795 tests / 1786 pass / 1 fail`（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs` Windows `/tmp` 路径问题，与本升级无关）、`vue-tsc -b` 与 `oxlint` 干净。
- 未验收：真机 UI 全链路（老会话在界面里打开与续聊、工具调用、`@文件` 权限切换）与三平台安装包构建。**524 与本升级无关**（那是上游/网关在 ~126 秒内零字节）。

## [2026-09-29] 修复 | Harness 失败轮次不再从工作台消失

- 用户确认只执行最小方案：对齐官方 Harness Session 失败事件投影，不建设全局任务账本、不要求所有任务跨重启恢复、不扩大自动恢复。
- 根因：`runner.mjs` 将官方 `turn/end(error)` 转成 RPC error；`MemoryWorkbench.vue` 失败分支只设置临时 `run.error`，最终清掉 `run.userTurn`，没有补读 Session。因此失败轮次未进入工作台投影，但 Session 仍存在，下一次“继续”仍可接上。
- 修复：新增 `deepSeekSessionFailures(snapshot)`，从官方 `turn/end(error)` 按用户消息 id建立失败元数据；Harness 失败时补读同一 Session，刷新用户轮次/工具过程，并在过程区显示失败 code/message。失败不伪造 assistant 正文、不写旧 Raw、不重放已完成工具。
- 验证：新增失败轮次投影红测通过；focused runner `1664 passed / 0 failed / 18 cancelled`，18 项为既有 Desktop Remote 连接测试取消。未做真实上游故障注入。

## [2026-09-28] 排障 | 「静默两分钟」的真因是模型版本 `deepseek-v4.1-flash-0910`

- 现象：Harness 对话经常静默一分多钟然后 `524 statu…` 失败。用户先后提出两个假设——「是不是我们 Provider 设计有问题」和「我的 NewAPI 后台每次都秒回」。两个都查了。
- 取证顺序（每一步都排掉一个假设）：
  1. 本机 Session（zstd 多帧）逐轮时间线：健康轮首字节 2–3 秒，失败轮固定 ~126 秒后收到 524，且 `policyKey` 显示只重试 1 次。
  2. pi-ai 源码：`openai-completions` 固定 `stream: true` → 排除「我们用了非流式请求」。
  3. `dsh-llm-pi-ai` 源码：发现 `streamIdleTimeoutMs`（默认 300 秒）就是首字看门狗（`idleWatchdog(...).next(iterator)` 包住流的每次等待），据此订正了 `hot.md` 里「官方没有首 token 超时配置」的错记。
  4. 用户提供 NewAPI 日志 + 上游日志，两者交叉：**同一渠道 #114、同一上游，唯一变量是模型 id**。`deepseek-v4.1-flash-0910` 首字 16.6s–2m49s、1–2 t/s；`deepseek-v4.1-flash` 首字 3.2–4.3 秒、77–99 t/s。
  5. 用户换模型后复测，一切都对了。
- 关键排除项：输入 54,741 token 中缓存命中 54,528（99.6%），所以「请求太大」不成立；31 token 的小请求同样慢（16.6s / 25.9s / 1m47s），所以「请求形状」也不成立。Cloudflare 的 524 只是**判决书**——首字超过 100 秒就被掐。
- 结论：不是 Provider 设计问题，**一行代码都不用改**。给 NewAPI 的动作是下架 `deepseek-v4.1-flash-0910`。
- 撤回：上一轮提的 `streamIdleTimeoutMs: 90000` 作废——上游首字能到 2m49s 且最终成功，固定秒数看门狗会误杀它。用一天的真实分布算出来的数字，比拍一个更好。
- 同期界面配套（本支线内）：过程行加每秒跳的耗时与上游重试原因（官方口径 `message.retry.*` / 每秒跳的 duration），把这类等待从「像死了」变成「看得出在等上游」。

## [2026-09-28] 实施中 | iOS 扫码权限显式申请

- 本地所装 `tauri-plugin-barcode-scanner 2.4.6` 的 iOS 实现中，`scan()` 在 iOS 14+ 只检查相机权限，未获准时直接返回 `Camera permission denied or not yet requested`，不会自动调用系统授权；旧手机代码直接 `scan()`，且 Mobile capability 只开放 scan/cancel。用户看到的“相机权限被拒绝”可能是这一路真实错误，同时它在粘贴成功后残留，造成粘贴也失败的错觉。
- 先补扫码权限红测，再在调用 `scan()` 前执行插件 `requestPermissions()`，开放 Mobile 目标的对应 ACL；粘贴配对路径不调用相机。显式未授权时给出可操作提示。定向 UI 测试 `12/12`、focused `1655/1655`、iOS arm64 debug 包构建与安装包审计通过，已覆盖安装到 iPhone；真实扫码及发送/回传待用户复测，G1 未完成。

## [2026-09-28] 实施中 | G1 真机长对话快照超出 Noise 单帧

- 用户截图显示“已连接电脑”但仍停在配对页，并残留“相机权限被拒绝”。Desktop 配对日志证明该次粘贴 offer 已领取、电脑已批准且手机已认证重连；相机错误不是粘贴配对失败的证据。
- 根因追溯：当前长对话的官方可见消息正文约 187 KB，Bridge 单帧限制 64 KB；真实 TCP/Noise 红测中 180 KB 快照报 `FRAME_TOO_LARGE`。现保持单帧上限，将大消息分为受 Noise 逐帧认证的 60 KB 块，重组总量上限 8 MiB、分块读取有 30 秒超时；写失败会断开连接，不再静默悬挂。相同测试已转绿，覆盖手机→电脑与电脑→手机两方向。
- 手机端在底层已连接但会话读取未完成/失败时提供“重新进入当前对话”，隐藏重复扫码/粘贴入口；回到前台发现已连接时清掉旧相机错误。UI 红测已转绿。focused `1654/1654`、Rust 全量 `450 passed / 1 ignored`、真实 Noise 大消息双向及认证 Gateway attach 测试通过。修复版 iOS arm64 debug 包已构建、审计并覆盖安装到 iPhone；等待用户重连并验证真机发送/回传。G1 真机闭环未验收、未提交。

## [2026-09-28] 真机联调 | Desktop 新协议与旧 iPhone 包不匹配

- 用户用当前 `pnpm tauri dev` Desktop 和已安装 iPhone 包发送只读测试消息，手机无反馈。电脑端真实 Noise 连接已建立，但官方 Harness Session 未见该消息。代码核对：G1 Desktop `message.send` 已要求 `commandId`；已安装的旧手机包来自这项变更前，发送请求没有该字段，且旧 UI 对发送错误未展示。此处是版本不匹配的强证据，仍需新版真机复测确认。
- 重新构建 iOS arm64 debug 包，`audit:ios-app` 通过，已向连接的 iPhone 覆盖安装 `com.jiucaihezi.mobile`（保留 App 数据）。等待用户重新连接并用新只读消息验证手机 pending、Desktop 执行及最终回传。**G1 未验收、未提交。**

## [2026-09-28] 实施中 | G1 丢失对话切换事件后的恢复

- 红→绿：Desktop 已换对话而 `context.changed` 丢失时，Mobile 原先持续补读旧 Session，吞掉 `SESSION_NOT_CURRENT` 后不会切到新对话；现在重新取 context 并 attach。前台恢复同样先核对当前对话。Desktop 暂无打开对话时清掉旧投影，显示等待提示，后续可接入新对话。
- 验证：状态机/UI 定向 `43/43`、focused `1653/1653`、TypeScript、Desktop/iOS quick build与产物审计、差异检查通过。真实 WebView→Harness→Noise→iPhone 故障闭环尚未验收；G1 未完成，未提交。

## [2026-09-28] 实施中 | G1 旧同文历史误判修复

- 红→绿：页面历史少载一轮、用户再次发送相同正文时，旧官方 Session 的同文用户轮次会被误判为本次已落盘，过早清空手机临时态；现除轮次数量与正文外，还要求官方用户事件时间不早于本次发送。
- 同时用真实 TCP/Noise 测试确认首次错误 attach 会恢复原先的空订阅；这条已有生产回滚逻辑正确，没有为它增加补丁。
- 验证：focused `1648/1648`、Rust `450 passed / 1 ignored`、TypeScript、Desktop quick build/产物审计、本文件 Rust 格式及差异检查通过。WebView→真实 Harness 和 iPhone 真机闭环仍未验收；G1 未完成。

## [2026-09-28] 实施中 | Mobile G1 真实 Noise 通道假 Runtime 闭环

- 将 Rust 认证后的同一连接循环保留给生产 WebView 分发，同时允许测试注入假 Runtime；未改 LAN 协议或认证路径。假 Mobile 通过真实 `127.0.0.1` TCP、Noise XX 公钥钉扎和已授权设备身份，完成 `attach → message.send → running/done 推送 → 丢过程后 session.read`，最终恢复无助手正文的纯工具轮。
- 验证：新增端到端传输测试通过；Rust 全量 `450 passed / 1 ignored`，本文件 `rustfmt --check` 和差异检查通过。仓库级 `cargo fmt --check` 因多个既有不规范文件未通过，未顺手格式化无关文件。该测试执行端是假 Runtime，不证明 WebView/Harness 或 iPhone 真机；G1 未完成。

## [2026-09-28] 实施中 | Mobile G1 停止竞态与无推送补读

- 红→绿：异步模型配置尚未返回时停止，旧共享执行入口仍会启动 Harness；现执行前核对同一 run 仍在运行，已停止的不再触发模型或工具。
- 红→绿：Mobile 原先忽略 Desktop `pendingTurn`，纯工具/电脑主动轮次可能没有消息气泡；现接收临时轮次并与手机本地 pending 去重。空闲时若完全丢失 Desktop 主动任务推送，现以 10 秒低频补读兜底；活跃任务维持 3 秒补读。补读中的旧序号快照不能覆盖重连后的新投影。
- 远程 Harness 返回后仅当官方 Session 确实出现本次用户轮次，才清除临时状态；旧历史先保留流式结果并等待后续补读，重复相同正文以既有官方用户轮次数量区分。
- 验证：定向 `148/148`、完整 focused `1648/1648`、TypeScript、Desktop/iOS quick build及产物审计通过。真实 Harness+Noise TCP 页面卸载闭环、iPhone 真机、Relay 仍未验收；G1 未完成。

## [2026-09-28] 实施中 | Mobile G1 应用级 Host 与工具步骤收尾

- Desktop App 启动时绑定应用级 Host；远程发送、停止、审批和忙锁不再依赖工作台页面闭包，本地与远程的 Harness 进度复用同一执行函数与 run 表。重复停止不改写已完成状态；异步配置读取期间停止也不再读取已清空的用户轮次。
- 红→绿：手机原先仅在运行中显示工具步骤，完成瞬间会隐藏；现在完成后保留已收到的步骤。定向 UI 用例先失败后通过。
- 验证：完整 focused `1643/1643`、Rust Bridge 定向 `12/12`（其中含真实 TCP/Noise 假 Mobile，但未连接前端 Harness）、TypeScript、Desktop/iOS quick build与产物审计、差异检查通过。真实 Harness+Noise TCP 页面卸载闭环、纯工具轮完整投影、iPhone 真机和 Relay 尚未验收；G1 未完成。

## [2026-09-28] 实施中 | Mobile G1 pending 与 attach 快照回退修复

- 先补两条行为红测：推送中的乐观用户轮次会提前清除手机 pending；attach 快照已含较新事件时，缓存旧全量事件会覆盖新快照。旧实现两项均稳定失败。
- 修复：只有官方 `session.read/attach` 历史能消除 pending；官方历史短暂落后时继续补读。Desktop attach 保留快照自身游标，Mobile 忽略已被快照覆盖的缓存事件。共享 run 建立与忙锁已移入应用级服务，但完整发送执行仍由页面闭包负责。
- 验证：定向 `39/39`、完整 focused `1637/1637`、TypeScript、Desktop/iOS quick build及差异检查通过。局域网 iPhone、页面卸载后的真实 Harness 任务、Relay/公网均未验收；G1 未完成。

## [2026-09-28] 设计 | Mobile Gateway 与 Mini Relay TDD V2

- **触发证据**：真机已能让 Desktop 执行 Mobile 命令，但 Mobile 没有状态反馈；当前远程链以 `MemoryWorkbench` 的 Vue `watch` 发布整份投影，`message.send` 在 `void send()` 后提前 accepted，发布错误静默丢弃，客户端没有 seq gap 恢复。
- **定案**：新建 [[开发/韭菜盒子Mobile控制Desktop-Gateway与Mini-Relay统一合同TDD-V2-2026-09-28]]。Desktop Gateway 成为独立于页面的唯一控制平面；Harness Session 仍是唯一历史真相；Mobile 使用 pending/receipt/seq/stateVersion/epoch；Mini Relay 只转发 Noise over WSS 密文。
- **TDD**：写明 Gateway 生命周期、原子 attach、确定回执、`commandId` at-most-once、断档补拉、前后台/切网恢复、Relay E2EE/撤销和真实故障注入矩阵；实施按 G0–G5 分闸门，不一次性重写。
- **验证边界**：本轮只更新合同与 Wiki 路由，没有实施 G0 红测或产品代码，不能登记为已修复手机无反馈或已支持异地连接。

## [2026-09-27] 修复 | Mobile 新对话连接报 `session not found`

- **根因**：桌面对话目录立即登记新对话，官方 Harness Session 要到第一条消息才惰性创建；Mobile 初连固定执行 `context.get → session.read → session.subscribe`，因此把合法的空白新对话读成不存在。
- **修法**：Desktop Remote 复用官方 `session/list` 判断当前会话是否存在；不存在时只返回空快照，已有会话仍走 `session/read`，首条手机消息继续走原发送链创建 Session。没有增加第二套会话库或错误字符串特判。
- **验证**：先补红测，旧代码因缺少存在性判断失败；修复后 focused `1611/1611`、Rust `447 passed / 1 ignored`、Desktop quick build、iOS quick build和产物审计通过。iPhone 修复后复测待用户完成。

## [2026-09-27] 实施 | Mobile 桌面控制器 P1 Desktop 局域网 Bridge

- **实现**：Rust/Tauri 增加默认关闭的随机端口 TCP Bridge，以 Noise XX 加密全部配对和业务帧；5 分钟一次性 offer 必须由 Desktop 确认，设备 token 只存哈希并绑定 Mobile Noise 公钥，长期身份/设备写系统钥匙串；限制 64 KiB 帧、4 连接、30 请求/秒并拒绝过期、未知与重放请求。设置页支持开启/关闭、二维码、允许/拒绝和吊销。
- **复用**：TypeScript Bridge 只把最小协议转给 P0 `DesktopRemoteHost`；`MemoryWorkbench` 复用现有官方 Session Query、发送、停止与审批对象，不启动第二 Runtime。远程纯文字与桌面 composer 的附件、引用、编辑态和 Jev 隔离。
- **根因修正**：审查发现共享布尔启停会让旧监听在快速重启后复活，改为单调监听代次，关闭后旧监听和旧连接永久失效；补回归测试。
- **验证**：focused `1564/1564`；Rust 全量 `436 passed / 1 ignored`，Bridge `8/8`（真实 `127.0.0.1` TCP + Noise 假 Mobile）；Desktop quick build与产物审计通过。P2 Mobile 客户端、iOS 构建、Mac/Windows 防火墙与 iPhone 真机未执行。

## [2026-09-27] 实施 | Mobile 桌面控制器 P0 协议与 Host 红测转绿

- **红灯**：先登记两组测试，旧代码因 `desktopRemoteProtocol` / `desktopRemoteHost` 不存在而构建失败；随后只补最小纯内存实现。
- **实现**：协议层固定版本 1 信封、消息白名单、帧/时间/请求 ID 校验、重放拒绝、设备级固定窗口限流、5 分钟一次性 offer、Desktop 确认/拒绝、设备凭证与吊销、审计元数据；Host 只暴露当前 context/Session，过滤跨 Session 事件，单忙锁拒绝第二次发送，停止与审批委托既有入口且不启动第二 Harness。
- **验证**：新增 `11/11`、完整 focused `1561/1561`、`vue-tsc -b`、定向 oxlint、`git diff --check` 通过。未做真实端口、网络加密、Tauri 命令、Mobile UI、Rust 或真机验收；这些属于 P1/P2。

## [2026-09-27] 设计 | 统一 Mobile 桌面控制器合同，先写局域网 MVP TDD

- **定案**：Mobile 不再补齐独立工作台，只作为 Desktop 已有 Harness Session 的控制面；Desktop 保持唯一 Runtime、配置、权限与数据真相。首期限制为局域网当前活动 Session，iOS 先行，Android 与公网 Relay 后置。
- **TDD**：新增 [[开发/韭菜盒子Mobile桌面控制器统一合同与局域网MVP-TDD-2026-09-27]]，明确配对安全、最小协议、事件恢复、同 Session 并发/幂等、权限边界、红测矩阵和 P0-P5 验收顺序；同步更新 [[架构/产品架构]] 与 [[CLAUDE]]。
- **验证边界**：本轮仅文档设计，尚未实施测试或功能代码，未启动端口，也未声称 iOS/Windows/Mac 真机通过。

## [2026-09-27] 版本 | 版本号统一到 2.2.4（待打 tag 发版）

- **本批内容**：comfy-adapter ref2v 换「30秒文武双修」V4 模板与 28 秒上限；Harness 运行时收尾对齐官方语义（会话写锁不再被活着的孤儿占住）；创作面板模型清单收口（AI 应用只留文武双修、H3 时长 1~28 秒、菠萝自成一族并新增 `gpt-image-2-菠萝`、Seedance 组名改 2.5、默认视频模型换参考生视频、九项退出面板）。另经管理员核实 `gpt-image-2-菠萝` 单价 **0.08/张**，注册表里的「暂按同档」标记已去掉。
- 版本号由 `node scripts/set-version.mjs 2.2.4` 统一写入 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，`Cargo.lock` 随 `cargo update -p jiucaihezi-app` 更新；`AGENTS.md` 头部版本同步。
- **验证**：完整 focused `1534 tests / 1526 pass / 0 fail`、退出码 0；`cargo test --lib 422 passed / 1 ignored`；`vue-tsc -b` exit 0。安装包构建、三平台 CI 与真机验收未执行；`gpt-image-2-菠萝` 在 NewAPI 侧是否已建好、真实出图均未验。

## [2026-09-27] 面板口径 | 菠萝单独成组、Seedance 组名改 2.5、默认视频模型换参考生视频、九项模型退出面板

- **菠萝（aimanplay.cn）自成一族**：`creationModelFamily` 新增 `菠萝`（`newapi/boluo/` 前缀或名字带「菠萝」），面板 order 数组里图片侧排最前、视频侧跟在 `jc 本机` 后面；新增图片项 `gpt-image-2-菠萝`（1k/2k/4k + 质量，字段与 2.5 菠萝一致，单价 **0.08/张** 经管理员 2026-09-27 核实，`contractStatus: partial`）。
- **Seedance 组名 2.0 → 2.5**：该族现有的可见成员（`newapi/dola/seedance2.5`、山海 `oc-model-r5cfh8`）本来就都是 2.5；`Seedance 2.0 Mini` / `Fast` 两个族名保留（那三套 RH 模型此前已退役隐藏）。
- **视频默认模型换成 `jc-minimax-h3-ref2v`**：注册表里把它排到 `jc 本机` 组第一位 —— `switchTask` 取 `models[0]`、面板分组也按注册表顺序，所以「任务默认」与「组内第一」一次满足。
- **九项模型用 `hidden: true` 退出面板**（合同保留，历史任务与按 id 调用照旧）：视频五项 `newapi/zx/veo-3.1-generate-preview`、`newapi/zx/veo-3.1-fast-generate-preview`、`local-comfy/grok-video-3-30s`、`runninghub/api/rh-grok-text-video`、`runninghub/api/rh-grok-image-video`；图片四项 `gpt-image-2.5-flare-1k`、`gpt-image-2.5-sunburst-1k`、`gpt-image-2.5-flare-官方`、`gpt-image-2.5-sunburst-官方`（`GPT_IMAGE_2_ROUTES` 加了 `hidden?` 字段透传）。
- **待确认**：① `gpt-image-2-菠萝` 在 NewAPI 侧是否已建好、真实出图未验（单价 0.08/张 已核实）；② 「四个 GPT Image 2.5 变体」按 Flare/Sunburst 读数（`GPT Image 2.5 1K` 与 `2.5 官方` 保留）。
- **验证**：完整 focused `1534 tests / 1526 pass / 0 fail`、退出码 0；`vue-tsc -b` exit 0；另用一次性探针脚本把三个任务的「分组 → 条目 → 价格」原样打印核对（视频 13 → 9 项、图片 22 → 19 项）。面板目视待人工。

## [2026-09-27] 实施 | 创作面板：H3 应用时长上限放到 28 秒，「应用」下拉只留文武双修

- **时长 28 秒**：`H3_DURATION_RANGE` 的 `max` 15 → 28（8 个 H3 应用共用，用户决定「一起放开」），默认仍 5 秒。上限纯属面板自设：公网 `app-info` 实测 RH 的时长节点（文武双修 `27:value`，`PrimitiveFloat`）自报 `min/max = ±9.2e18`、`step 0.1`，`rh-adapter` 的 `apply_ai_app_inputs` 也只写值不校验。取 28 而不是 30 的理由与本体 comfy 一致 —— 同一张画布 30 秒会被算式补到 736 帧（≈30.7s），最后约 2 秒无效。
- **「应用」下拉只展示文武双修**：服务器 `app-directory` 实测返回 **14 项**，面板新增 `PANEL_AI_APP_IDS`（数组顺序即下拉顺序，文武双修是唯一项也是第一条）。其余 13 项（7 个 Minimax-h3 变体、5 个数字人/语音类、图音生视频）不再上项目面板，**服务器目录与接口一行未动**，需要时仍可用下拉底部的「或粘贴 ID…」指定；`aiAppLabel()` 仍读完整目录，所以粘贴被隐藏的编号时名字照常显示。
- **没做**：`MINIMAX_H3_WEBAPP_IDS` 保留全部 8 个 id（本地已存选中状态时判定不乱）；`rh-adapter`、NewAPI、本机 `comfy-adapter` 均未改。
- **验证**：定向用例 70/70（`creationPanelContractUi`、`useCreationFileFiltering`、`useCreationPlanMaterialization`）；新增两条合同 —— 面板只认 `PANEL_AI_APP_IDS`、时长常量值 28。面板实拉目录后的目视确认待人工。

## [2026-09-27] 实施 | jc 本机四个视频面板项显示「0.2/秒」，武戏档位实测核对通过

- **价格**：面板模型下拉（`CreationPanel.vue` 的 `<small>{{ m.price }}</small>`）此前对四个 jc-MiniMax H3 项显示「费用以实际扣费为准」，因为注册表没写 `price`（旧断言还专门钉住 `item.price === undefined`，理由是「价格未在 NewAPI 配置前不写死单价」）。管理员核实渠道 140 按秒计费 0.2 后，注册表新增单一事实源 `JC_H3_PRICE = '0.2/秒'`，四个面板项共用；`jcComfyAdapterPlan.test.ts` 把展示值与四个 id 一一钉住（改价必须同步改常量）。
- **武戏档位实测核对**（用户 25 秒参考生视频成功那次，读 ComfyUI `/history/<prompt_id>` 的**实际提交体**，不是 dry-run）：节点 65 `easy anythingIndexSwitch.index = 1`；它的 `value0 → 节点 64 Float 0.5000000000000001`（文戏）、`value1 → 节点 66 Float 1.0000000000000002`（武戏）；节点 47 `LoraLoaderBypassModelOnly.strength_model` 正是引用节点 65 —— 所以武戏确实拿到 LoRA 强度 1.0。同时节点 27 `PrimitiveFloat.value = 25.0`，25 秒原样落到工作流，没被 28 秒上限截断。
- **验证**：完整 focused `1531 tests / 1523 pass / 0 fail / 8 skipped`（+1 为新增价格用例），退出码 0；`cargo test --lib` 422 passed；`vue-tsc -b` exit 0。面板实际渲染待用户刷新后目视确认。

## [2026-09-27] 根治 | Harness 运行时收尾对齐官方语义（会话写锁不再被活着的孤儿占住）

- **现象与真因**：生成提示词 3 秒即报 `session "jc-v1-…" is already owned by an active write handle`。官方 jsonl 后端的 lease 是一把**跨进程内核锁**（Windows 命名信号量 / POSIX `flock`），`dsh-session-persistence-jsonl` 的注释写明：holder 进程死掉由内核释放，**活着却卡住的 holder 会一直持有，故意不设过期**。也就是说这把锁只认「进程还活不活」，不认「谁在用它」——页面重载 / 模块热替换丢掉 `runtimes` 这个模块级 Map 之后，App 里再没有任何引用能关掉那些运行时：进程活着、stdin 开着、写句柄还握着，锁就永远解不开（本机实测泄漏过 4 对 07:29/07:33/07:41/07:52）。
- **官方契约**：`create` / `open(id,'write')` 是进程内单写者所有权，`session/disposed` 的 memoized teardown 负责放手；`HarnessClient.close()` 的拆卸阶梯本身有界（shutdown 请求 1s → stdin EOF 宽限 6s → 强杀 3s）；同一会话的**并发 resume 由调用方自己排除**，`dsh-agent-loop` 只会等待同进程内正在 drain 的同一 id。
- **修法**：① 运行时登记表移到 `globalThis.__JC_DEEPSEEK_HARNESS__`，热替换后仍握得住旧运行时；② `stopRuntime` 的 `await active.closed` 加 15 秒上限（高于官方阶梯，不打断协同 flush），`finally` 里的收尾改成无条件执行——没有上限时进程已死或 stdin 写不进去都会让兜底永不可达；③ 同一会话已有活跃 run 时直接拒绝并给中文提示，不再让用户看见英文锁冲突；④ Rust `mcp_kill_stdio` 改成按**进程树**收尾（Windows `taskkill /T /F`，POSIX spawn 时 `process_group(0)` 后 `kill -KILL -<pid>`），并加两条兜底：页面挂载时 `mcp_reap_stale_harness` 收掉上一批遗留 Harness，`RunEvent::Exit` 收掉所有 stdio 进程树。
- **验证**：完整 focused `1530 tests / 1522 pass / 0 fail / 8 skipped`，退出码 0；`cargo test --lib` **422 passed**（新增进程树用例）；`vue-tsc -b` exit 0。另做受控实测（自造 runner→dsh 两层 node 进程树）：Windows 上 node 会给非 `detached` 的子进程挂 job object，**只杀 runner 也会连带带走 dsh**，所以 ④ 的价值是「不依赖 libuv 实现细节的显式保证」，而不是新发现的孤儿来源；真正的泄漏来源是没有人再去关掉活着的运行时。
- **未验**：真实桌面里「改代码触发重载 → 同一会话接着发」只在代码层保证，待人工验收。

## [2026-09-27] 换模板 | comfy-adapter 的 ref2v 换上「30秒文武双修」V4

- **动作**：用户的新画布（48 节点）整体替换 `comfy-adapter/workflows/minimax-h3-ref2v.json`；旧画布与旧转换产物归档为 `reference/minimax-h3-ref2v.v3.src.{ui,api}.json`，旧模板仍可从 `v2.2.3` tag 回滚。转换走仓库自己的 `tools/ui_to_api.py --drop-class LoadImage --output 21`——先用旧画布校准过：产物与旧模板**只差 node 4 的 unet_name 一处**，且工具会自动清掉 7/14 上的 9 个悬空 ref 引用。
- **必须重绑的一条**：`mode`（文武档位）在 V3 绑的是 `64.index + 69.index` 两个 index switch；新图只剩节点 65 一个开关，64 变成 `Float`、69 变成 `RunningHub Deepcleaner`。而 meta 的 `defaults.mode = 0` 是**会真实写进节点**的，不重绑就是往这两个节点写非法输入。
- **三条用户决定**：① 戏种（文/武）回到面板做开关，语义变成「只切节点 47 的 LoRA 强度 0.5 / 1.0」，不再改分辨率（`megapixels` 固定 0.4MP）；② V3 里 HIGH 的 `ConcatTextOfUtils` 细节增强词**有意去掉**，不要补回；③ 时长上限取 **28 秒**——实测 30 秒会被算式补到 736 帧（≈30.7s）且最后约 2 秒无效，28 秒 → 685 帧（≈28.54s）。适配器 `constraints.clamp` 与面板 `max` 同步到 28，实测请求 30 被 clamp 成 28。
- **验证**：`app.py --check` 四步全绿（ref2v 31 个节点类全注册、19 个模型文件全存在）、`verify_newapi_contract.py` 19/19（走 `minimax-h3` 模板真实出片 5 帧 30.92s）、`dry_run.py` 落点正确（`mode`→节点 65.index、`duration`→节点 27.value、参考图→7/14 的 `ref_image_0`）、`jcComfyAdapterPlan.test.ts` 11/11、完整 focused 门禁退出码 0。
- **顺手修**：`verify_newapi_contract.py` 缺 `harden_stdout()`，Windows 上把输出重定向到管道时汇总行的 ✅ 会 `UnicodeEncodeError` 崩掉 —— 19 项都跑完却看不到结论，已按其它工具的做法补上。
- **未做**：新模板的**真实出片**没跑（只跑了 dry-run 与合同自检，后者走的是 `minimax-h3` 模板）；成片效果与耗时待人工验收。
- **追加（同日，用户决定「都改」）**：兄弟模板 `minimax-h3-video.meta.json` 的 `constraints.max_length` 从 501（≈20.9 秒）放到 **685（28 秒）**，面板文生 / 首帧图生 / 首尾帧三项同步，`JC_H3_DURATION_FIELD` 上限 15 → 28（四个 jc 模型共用）。那 501 是适配器**自设**的运行时保护 —— 节点自身 `length` 输入没有 max（只有 `min=5` / `step=17`），所以放大安全；`dry_run --duration 28` 实测 → `length: 672`（28.00s），不再被截断。

## [2026-09-27] 发版候选 | 2.2.3 macOS 签名与公证修复

- **根因**：旧 CI 只重签外层 `.app`，App 内 DeepSeek Harness 的 Node 与原生依赖没有按 Apple 要求由内向外签名；bundled Node 还带 `get-task-allow`。`notarytool submit --wait` 在 Apple 返回 `Invalid` 时仍可能以进程码 0 结束，旧脚本因此误印「公证成功」，随后 `stapler` 才以 65 失败。旧冒烟又递归搜索所有 `*opencode*`，把普通 JS provider 文件误判为 sidecar。
- **修法**：`fix-macos-app.mjs` 识别并逐层签名所有 Mach-O 与嵌套 bundle，Node 使用专用 entitlements；ARM/Intel 均在制 DMG 前运行。公证解析 JSON，只接受 `Accepted`，拒绝时输出 `notarytool log`；staple 后执行 validate。Mac sidecar 检查收窄到 `Contents/MacOS`。
- **本地验证**：focused `1525/1525`；Rust `427 passed / 1 ignored`；Desktop quick build 与审计通过；发布合同 `18/18`；本地 ARM App 共处理 231 个嵌套 Mach-O，ad-hoc `codesign --verify --deep --strict` 通过。正式 Developer ID 签名、公证及三平台安装包仍以 tag CI 结果为准。

## [2026-09-26] 基线 | Windows 门禁从 `1515/1524` 转绿为 `1516/1524`

- **根因一（换行符）**：仓库此前没有换行符策略，本机 `core.autocrlf=true` 把 Windows 检出变成 CRLF，而索引里 1251 个文本文件本来就是 LF。`creationPanelContractUi` / `projectFileTreeCanvas` / `memoryWorkbench` 用 `\n` 锚定源码正则切片段，CRLF 下切不出来，报成「Input: ''」式假失败 39 条。新增 `.gitattributes`（`* text=auto eol=lf`，`*.bat`/`*.cmd` 保留 CRLF），本机工作区按它重写为 LF 后 39 条一次性消失——这 39 条不是代码漂移，是同一提交在不同平台的两种结论。
- **根因二（宿主绑定用例）**：`skillMaterialRuntime` 的「默认 exists」用例写死作者本机路径 `/Users/by3/Documents/jiucaihezi-app`，改用 `process.cwd()`，断言意图（默认实现真的在查文件系统）不变；`prune-updates` 的 4 条要用 `bash` 跑 `scripts/prune-updates.sh`，缺 bash 时跳过（脚本真实执行环境是 Linux 下载服务器，CI 上仍会运行）。
- **验证**：完整 focused `1524 tests / 1516 pass / 0 fail / 8 skipped`（修复前 `1515 pass / 5 fail`，v2.2.2 发版时记录的是 47 条既有失败）。

## [2026-09-26] 发版 | 2.2.2 传图修复版

- 版本由 `node scripts/set-version.mjs 2.2.2` 统一写入 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，`Cargo.lock` 随 cargo 更新；`AGENTS.md` 头部版本同步。
- 门禁：完整 focused `1472/1523`、`vue-tsc -b` 通过。47 条失败**全部为改动前既有**且在 Windows 上稳定复现（`scripts/__tests__/prune-updates.test.mjs` 缺 `bash`；`creationPanelContractUi` / `projectFileTreeCanvas` / `memoryWorkbench` 的源码形态断言）；对照实验为同一批文件改动前后 `178/137/41` 逐条一致，本次改动 0 新增失败。
- 桌面发布入口不变：`main` 与 tag 分开推送，`git push origin v2.2.2` 触发 macOS ARM / macOS Intel / Windows x64 三平台 CI；CI 产物实测前只记「已触发」。

## [2026-09-26] 修复 | 输入框传图后模型看不见图片，16 分钟无果

- **症状**：桌面端传图 + 一句「查看图片内容」，实测 **973.7 秒（16 分 14 秒）后以 524 失败**；模型不答图，而是 `glob`/`pwsh` 满盘按 hash 找文件、最后去找 tesseract。
- **根因**：`src/services/deepSeekHarness.ts` 生成的 `route.cordis.yml` 没给模型声明输入模态，官方 `dsh-llm-pi-ai` 取 `DEFAULT_INPUT = ["text"]`；图片既不内联进请求，`read_image` 也直接报 `model "gemini-3.8-flash" does not declare image input`。附件本身正常（已按 192 KB webp 落进内容寻址存储），卡的是声明。
- **修法**：`DeepSeekHarnessInput.imageInput` 由 `resolveModelInputModalities` 计算（复用 @Jev 与直连路径的同一份能力表）；patch 只在为真时写 `input: ["text","image"]`，并进 `runtimeKey` —— 否则读会话时建的纯文本 Runtime 会被第一轮发送直接复用。
- **配套**：模型不支持视觉时 `deepSeekContentBlocks` 不再发图片块，改发 `[附带 N 张图片，当前模型不支持视觉]`（发块等于给模型一个它用不了的附件 id）；`llm/retry` 的 `failure.code/message` 上运行状态行，下次等很久先看是不是 `RATE_LIMIT`/`SERVER 524`。
- **验证**：用户实机验收通过（传图提问一步答完）；定向 `deepSeekHarness` + `memoryWorkbench` 106 例 / 101 通过，5 条失败与改动前逐条一致；`vue-tsc -b` 通过。客户端图片压缩、`maxRequestImageBytes`、重试策略与整轮定时器均判定为过度设计，未动。

## [2026-09-24] 收口 | Desktop 固定 Harness，退役 `@DH`

- **实施**：删除输入框下方、`@` 提及、已选芯片和会话恢复中的 `@DH` 选择态；Desktop 普通聊天、Skill 与文件任务自动进入 Harness。尚未接入 Harness 工具面的 MCP、媒体与 3D 继续复用现有专项执行链，避免已有按钮退化为空开关；Web/Mobile 保留原执行链。
- **重试**：对照官方实现后保留 `SERVER`（含 524）与一次自动重试；没有给整轮套自建超时，因为官方 Provider 未提供主请求首 token 超时参数，整轮计时会误杀合法长任务和工具阶段。
- **验证**：定向 `120/120`、完整 focused `1507/1507`、`vue-tsc -b`、`git diff --check` 通过；真实 Desktop 与 524 故障注入待人工验收。

## [2026-09-24] 合同 | Harness 会话、对话目录与可选建库统一

- **用户决策**：现有文件树“建立改编 Wiki”按钮增加 `.raw/文档|图片|视频|音频`；删除 UI 的记忆/查询按钮及其前后端；对话记录无缝衔接 Harness Session。
- **统一合同**：新增 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]。普通聊天不再依赖 `.raw` 初始化；Harness Session 是对话与工具轨迹唯一运行时真相，对话下拉只保存轻量目录和稳定 Session 映射。
- **旧数据**：旧 `.raw/对话记录` 按用户打开惰性一次移交，成功后只续写 Harness，Raw 留作只读历史；`.raw/记忆索引`、`memory_search` 预取、最近三轮拼装和双写均退役。
- **无缝显示前提**：当前 SDK 运行接口不会在重启后主动回放完整历史；先通过官方 `SessionQueryEngine.listSessions/readSession` 建最薄查询桥，把 Session 投影回现有 UI，再停止 Raw 写入。禁止直接解析 Harness 物理存储。
- **建库与素材**：建库按钮仍为幂等补缺，不增加向导；补建 `.raw/<文档|图片|视频|音频>`。本期不顺带重写既有 `.raw/jc-media` 媒体保存链路。未来模板只创建项目文件，不承担 Runtime 或对话存储。
- **官方边界**：当前 SDK 可持久化和恢复具名 Session，但没有单 Session 删除协议；本期删除只解除 UI 映射，不改写 Harness 私有存储，等待官方接口后接物理回收。
- **状态**：生产迁移已完成；待真实 Desktop 跨重启人工验收。
- **纪念封存**：旧“最近三轮 + Raw + 记忆索引 + `memory_search` + 记忆/查询按钮”源码和文稿已复制到 `/Users/by3/Documents/韭菜盒子-旧记忆系统纪念-2026-09-24/`；生产中的索引、摘要和查询链已删除，旧 Raw 解析只保留迁移兼容。

## [2026-09-22] 合同 | 文件副作用收回任务事务 Runtime

- **用户决策**：核心目标是让文件任务成功，不是只改善失败文案；先把 Skill Creator 的“写草稿、读回验证、冻结出卡”从模型收回 Runtime，再扩展到 `@文件` 长任务。
- **合同收敛**：新增 [[开发/通用记忆工作台任务事务Runtime合同-2026-09-22]]，定义“模型产出结构化变更意图，Runtime 负责账本、写入、读回验证、恢复和程序收尾”。`@文件` 的开关即全权授权不变；授权与执行职责明确分层。
- **存储边界**：对话完成记录继续放 `.raw/对话记录/`；可见 Skill 草稿继续放 `.raw/jc-media/文档/skill-<id>/`；只有分批或跨重启任务才惰性创建 `.raw/临时任务/<run-id>/manifest.json`，不存模型隐藏推理。
- **范围控制**：不建 DAG、任务数据库或新 Agent；首期仅落 Skill Creator、`@文件` 单文件提交和长任务恢复，现有媒体/3D/故事 Runtime 不强迁。
- **已实施**：Skill Creator 的草稿写入、读回校验、冻结和出卡已收回 Runtime；`@文件` 的项目内 UTF-8 文本 `write/edit/write_text_batch` 已接入 `.raw/临时任务/<run-id>/manifest.json`，副作用前记账、写后精确读回、整批全成功才由程序收尾，完成账本自动清理，失败账本保留。
- **自动验证**：覆盖预写账本、读回不一致、同 run 累积、重复 edit 幂等、成功清理、失败保留及部分失败不得误报完成；Desktop/Web 文件工具和 Direct Engine 回归继续通过。
- **待实施边界**：目录全量枚举、模型批次调度、Office/PDF 规范化、跨重启自动续跑和真实 Desktop/Web 人工验收尚未完成。

## [2026-09-19] 修复 | 文档转换白名单落后于引擎，.epub 能选不能传

- **触发**：用户问「所有文件不是都能转 md 吗、加 EPUB 难不高」。核查后发现不是「支不支持」，而是**同一件事在三处各写了一份格式清单，且都落后于引擎能力**。
- **根因**：云端 `document-converter` 的解析内核就是 AnyDoc，但 `SUPPORTED_EXTENSIONS` 只列了 11 个扩展名，漏了引擎 `Format::from_extension` 本就支持的 9 个；`ProjectFileTree` 的文件选择器 `accept` 里**一直写着 `.epub`**，所以用户选得到、传上去被 415 拒（UI 承诺与后端能力矛盾）。前端 `useFileUpload.ts` 的 `OFFICE_EXT` 漏得更多，`.epub` 在聊天附件链路直接落到 `unknown` 被拒。
- **关键事实**：Desktop 侧不走白名单（`parse_document_markdown` 用 `Format::from_bytes` 内容识别，扩展名只当兜底），所以 **.epub 在已安装的桌面版当时就能转**；卡住的只有 Web / 移动端。
- **实施**：白名单按 anydoc 0.2.3 逐条对齐（`doc/docx/docm`、`ppt/pps/pot/pptx/pptm/ppsx/ppsm`、`xls/xlsx/xlsm/xlsb`、`odt/ods/odp`、`rtf/pdf/epub`，共 20 个）；**不含 `.csv`**——它已由前端文本链路直通处理，再列入会多出一条互相竞争的转换路径；415 文案不再列举具体格式；`useFileUpload.OFFICE_EXT` 与文件选择器 `accept` 同步。三处各加一条回归断言，云端加「白名单 == 引擎能力」的集合相等测试。
- **实测**（真 EPUB `召唤万岁(霞飞双颊).epub`，5.4 MB）：引擎侧 0.39s 转出 542 万字、`## 第一章：【穿越】` 层级完整；本地起服务 POST 真文件得到 **HTTP 200 / 0.52s / 5,423,555 字符**；用真实拆分器 + 标记词「章」拆出 **1492 章**，短名干净（`0001_穿越.md`）。另发现：这类 EPUB 走自动识别会被主动拒绕（`## 第一章` 同时命中 markdown 标题与章节标题两套规则），需显式指定标记词——与知识资料规则的既有纪律一致。
- **验证**：focused 全量 `1409/1409`、`vue-tsc -b` 通过、`document-converter` Python `7/7`。**未做**：真实 App 内导入（待用户验收）、云端服务重新部署。
- **补充（同日）**：用户确认后已同步面向用户的新手指南（`jc-new-user-guide` 的 SKILL.md、`4-产品功能.md`、`8-办公.md` 三处格式列举加 EPUB）。注意 **Web / 移动端在云端服务重新部署前仍会 415**，桌面端因走内容识别不受影响。
- **附件链路不改（2026-06-28 已停用）**：原计划把 `attachment-processor` 的 `OFFICE_EXTENSIONS` 一起对齐，核查后发现该服务已在 2026-06-28 停用（[[运维/服务器运维]] 明列）、前端适配层 `webChatAttachments.ts` 已删、`src/` 中无任何 `api/attachments` 调用方；且它的 Office 分支依赖服务器上另一个不在本仓、LibreOffice 系的 8090 服务，**EPUB 在那边本来就读不了**。对齐一个无调用方的死服务只是给没人跑的代码加扩展名，故不动。

## [2026-09-19] 变更 | 新增知识资料沉淀规则，修原文节点 index 重复标题

- **触发**：用户看到 `virgiliojr94/book-to-skill`（文档 → skill 转换器），问怎么适配我们的 Wiki。核查后确定它补的是我们没做的那一半——非叙事物料：五 Skill 退役后 `wiki-memory` 只剩故事型规则，用户丢一本技术书进来只能「沿用两阶段原则」，而两阶段的语义字段（角色/场景/道具/关系）与资产目录都是为故事设计的。
- **已重合不重做**：文档→Markdown（`document-converter`）、章节识别（自定义标记词）、渐进披露（index 三层 + 按需 read）、增量（hash 幂等）、版权纪律（两阶段天然分了「原文无损 / 分析页综合」）。
- **实施（L1，零代码）**：新增 `public/skills/wiki-memory/references/知识资料沉淀规则.md`，与故事规则并列并由 `SKILL.md` 路由；复用来源树与拆分链路不动，只加 `知识/` 横向层；术语索引只放「概念 → 节点」映射不放定义，速查只放决策规则/阈值/气味，术语与框架先留分析页不建实体页。**明知差异**：知识型物料不走 `commit_story_analysis`（其字段与目录为故事资产设计，会产出形状错误的页面），分析页改由模型直接写，代价是没有 Runtime 的证据与唯一性校验，补偿是 `source_hash` 从原文节点原样复制 + 自己维护节点分析 index 与父级登记。
- **真实书实测**（《电影剧本写作基础》114 页 PDF，pypdf 抽取 13.3 万字）：自动识别选了“独立数字段号”给出 **138 个节点**（正文行首裸数字胜出），换成自定义标记词「章」才是 17 章；目录页的 17 行也会被当成边界（34 命中），必须先剔目录。两条都写进规则。用真实 `applyStoryImportPlan` 落盘 24 个文件，短名与真实目录一致。
- **顺带修 bug**：`buildMarkdownSplitPlan` 在前置内容分支与非分组分支各 push 一次 `## 页面`，有前置内容的稿件（题记/序/版权页）生成的 `原文节点/index.md` 会出现两个同名标题，章节导航被劈成两段。合并为一个小节；新用例已实测在修复前版本失败（17 pass / 1 fail）、修复后 18/18。
- **验证**：`storyImport` 18/18、合并 `storyAnalysis`/`adaptationWikiScaffold`/`projectFileTreeCanvas` 共 65/65、`vue-tsc -b` 通过；真实书只跑通第一阶段 + 手写一页精读档/一页备查档与两个横向页，**未做 App 内 UI 人工验收**。

## [2026-09-19] 变更 | 通用 Wiki 骨架新增创作规划层，jc-novel 对齐现行合同

- **触发**：用户要求探讨 `jc-novel`（长篇小说 Skill）与 `wiki-memory`、现行 Wiki 架构的合作关系。核查后发现 jc-novel 停在两代前的合同上：① 它写的「配合 jc-jian-wiki（巡检）和 jc-raw-wiki（填充）」和更早的 `jiyiyasuo`/`yizhixing`，在当前环境**一个都加载不到**（`~/.agents/skills` 里五个 Wiki Skill 全部不存在）；② 自建骨架 `wiki/{剧本,角色,世界,剧情,文案包装}` 与现行 `原始材料/资产` 分叉，角色会落成两份（`legacyCharacterDirectoryConflict` 只拦 `资产/人物/`，拦不住 `wiki/角色/`）；③ 它依赖的 `CLAUDE.md`/`hot.md` 自 2026-08-05 起已不再注入，且被 `creativeMemory.test.ts` 的断言锁死；④ 它建的 `index.md` 没有双链也没有子目录 index，而运行时只注入深度 ≤ 2 的 `index.md`，等于预读上下文是空的。
- **分工定案**：判据是「改它会同时影响两个以上 Skill 的东西放 `wiki-memory`，只影响本 Skill 的放自己的 references」。**通用层**（目录名、存在条件、index 合同、写入顺序）加一层 `创作/`：一个项目一部作品一个，放世界设定、大纲、逐章/逐集规划、伏笔、包装文案；Runtime 不预设固定文件名，小说写「章纲」、短剧写「集纲」是同类不同名，读取以 `创作/index.md` 登记的真实文件名为准。规划层是模型产出，不走两阶段沉淀。**Skill 层**保留各自的方法论与模板。
- **jc-novel 侧**：收窄 `description` 与触发词（去掉「创作」「章节」「角色设计」等会抢别的 Skill 活儿的泛词）、补启动闸门与 `allowed-tools`（`file` + 两个原生分析工具）、新增 `references/落位与提交.md`（落位表 + 角色页模板 + 禁止事项，**路径不写死，一律按运行时索引定位**）、新增 `references/engines/index.md` 路由表（100 个引擎全覆盖，此前 61 个无任何地方指路）、正文改为追加进 `原始材料/<作品>/原文.md` 后重跑幂等拆分、删除自建库脚本 `scripts/scaffold_wiki.py`（已备份 `/tmp/jc-novel-scripts-backup`）。
- **关键依据**：原生节点分析按 **文件名 + `title` + `aliases`** 匹配已有资产页，匹配上只往分析页加双链、**不重写实体页**（`newAssets` 只走 `createText`），所以 Skill 先写的角色设计卡不会被冲掉，来源事实也不会在资产页里双写。
- **验证**：本轮只改 Markdown（`public/skills/wiki-memory/references/故事资料沉淀规则.md`、`~/.agents/skills/jc-novel/**`），**无产品代码变更**，故未跑 focused；引擎路由表用脚本核对 `100/100` 覆盖；`jc-novel` 的真实模型跑批验收未执行。

## [2026-09-19] 变更 | 故事拆分支持用户自定义标记词

- **触发**：用户提出剧本编号写法穷举不完，想改成「用户输入什么就拆什么」。实测确认缺口真实：`第一场 雨夜` 与 `SC01 雨夜` 两份稿子都直接报「没有识别到故事边界」（`CHAPTER_UNIT` 里没有「场」，`ENGLISH_CHAPTER` 里认不出 `SC`），而 `EP01`、`第一集` 能认。
- **实施**：① `markdownSplit.ts` 新增 `story_custom` 策略与标记词规则：用户只填一个词，`normalizeStoryMarker` 收口（`SC01`/`第1场` 这种整段抄标题的写法也认），`probeStoryMarker` 前缀优先、前缀不足 2 处退回后缀式，两类形状共用一个 `storyMarkerPattern`；② 短名剥离复用同一条规则，否则 `SC01 雨夜追踪` 会生成 `0001_SC01 雨夜追踪.md`；③ 编号校验（缺号/倒序）也改走该规则取序号；④ `marker` 进 plan `optionKey`，换规则必须换 id；⑤ 白名单按用户要求补 `场|場`，并新增 `ABBREV_CHAPTER`（`sc|ep`）——缩写后的编号**只认数字**，放宽到罗马数字会让 `Sci-fi 的设定` 被当成「SC + I」命中；⑥ 预览弹窗加「自定义标记」输入框，输入 300ms 防抖后从原始素材重拆，识别方式由英文枚举改为中文。
- **验证**：`storyImport.test.ts` 17/17（+4 用例，覆盖前缀式/后缀式/`1场大雨` 与 `Sci-fi` 两条误判陷阱/白名单回归）、`projectFileTreeCanvas.test.ts` 35/35、`storyAnalysis` + `adaptationWikiScaffold` 合计 64/64、`vue-tsc -b` 通过。未执行真实 UI 人工验收。

## [2026-09-17] 变更 | 创作面板隐藏七条视频线路

- **触发**：用户要求删除截图中的 MiniMax H3 三条、小易 Kling/Grok/Seedance 和 `2/秒` 的 RunningHub Veo Fast UI 项。
- **实施**：七条注册项设置 `hidden: true`，底层模型合同和历史任务兼容保留；ZX Veo Fast 等同名不同线路继续显示。
- **验证**：面板可见清单增加七条否定断言，Node focused `1368/1368`、`vue-tsc -b` 通过；未执行真实 UI 人工验收。

## [2026-09-17] 修复 | 旧资产目录守卫只拦了一个入口

- **触发**：用户追问「本次是否改了产品代码」，回查改动范围时发现自己的防护装漏了一边。
- **根因**：旧 `资产/人物/` 冲突检测只加在 `buildAdaptationWikiScaffoldPlan`（建库路径）。进资产系统的入口有两个，节点分析（`prepare_story_analysis` / `commit_story_analysis`）没有防护；它只读 `资产/角色/index.md`，看不见旧档案，同一角色会在 `资产/角色/` 下被重建一份，静默发生。
- **修复**：检测逻辑收敛为 `storyAnalysis.ts` 的 `legacyCharacterDirectoryConflict`，建库、`prepareStoryAnalysis`、`commitStoryAnalysis` 三处调用；测试桩补充目录资源以覆盖该路径。
- **验证**：focused Node `1364/1364`（+1）、`vue-tsc -b`、`git diff --check` 通过；新用例已实测在移除守卫后失败。

## [2026-09-16] 变更 | 改编拆成「改编-思路」与「改编-落笔」

- **触发**：用户提议把「定改编方向」做成独立 Skill；核查后发现现有 Skill 的 description 里没有任何一条能匹配「我要把这部小说改成短剧」「我想改成架空古代」这类意图，即**入口缺失**。
- **变更**：新建 `jc-gaibian-silu`（带启动闸门、核心驱动判断、成对替换约定、依赖检查、修订模式）；原 `jc-gaibian-duanju` 更名为 `jc-gaibian-luobi` 并交出「写 `改编思路.md`」职责，缺失时只给 A/B/C 选项。
- **同时确认**：界面显示名不能用 SKILL.md 的 `display_name`（该字段只被 `build-skills-index.mjs` 读取，只管 `public/skills/` 内置包），本地 Skill 要走 `skillsManageStore` 的显示别名（localStorage，UI 元数据）。
- **验证**：纯 Skill 与文档改动，未动 `src/`；无自动化测试覆盖，待真实对话验收。

## [2026-09-16] 修复 | 改编 Skill 读取清单与正链路径

- **触发**：用户选定“改 Skill 不改 Runtime”方案（A）。
- **根因**：`jc-gaibian-duanju` 把 `改编方案/总体改编方案.md`、`逐集改编方案.md`、`主线/原著分集情节点` 列为必读证据，而这三者在全仓 0 命中，新建库上必然停止；正链样例又是旧的分层目录 `<名>/角色档案.md`。
- **修复**：证据清单改为 `改编思路.md` → 原文节点 → 上一集剧本 → 按需的平铺资产；首次启用时把用户口述的方向落成 `改编思路.md`；剧本路径固定为 `剧本/第<集号>集.md`；正链样例改平铺；停止条件区分“设计内冲突放行 / 与已成稿剧本矛盾才停”。`wiki-memory` 的参考文档同步为 `资产/角色/` 与平铺文件。
- **验证**：focused Node `1363/1363`、`vue-tsc -b` 通过；`public/skills/tests` 的 5 失败 22 错误已对 HEAD 复现，为既有。真实 App 逐集闭环待人工验收。

## [2026-09-16] 修复 | 改编资产目录与建库索引

- **触发**：用户要求评估并强化剧本改编链路，指出「核心是人判断结果，机器只管把基地打好」。评审后砍掉四张表、资产 delta、三个闸门、新 Skill 与校验器，只保留必要项。
- **根因**：资产目录存在三套并存合同——建库建 `资产/角色/`、节点分析写 `资产/人物/`、改编 Skill 读 `资产/角色/<名>/角色档案.md`；同时建库索引写相对 Markdown 链接而 `hasLink` 只认双链，导致 `资产/index.md` 出现重复导航与死链。
- **修复**：`storyAnalysis.ts` 的 `characters` 由 `人物` 改为 `角色`，资产索引清单改为从同一常量派生；`adaptationWikiScaffold.ts` 补 `资产/关系/`、索引改用双链、新增旧 `资产/人物/` 冲突；相关 TDD 与样例路径同步。
- **验证**：focused Node `1363/1363`、`vue-tsc -b`、`git diff --check` 通过；新增的「每个目录只被导航一次」断言已实测在旧链接格式下失败。真实 App 全链人工验收待执行。

## [2026-09-16] 功能 | 对话项目文件持续引用

- **触发**：用户反馈从对话中引用项目文件后，完成一轮对话就消失，必须重复引用；确认要求“引用后一直存在，直到取消”。
- **根因**：`MemoryWorkbench.vue` 将项目文件与临时上传附件共用 `attachments`，每轮完成或可恢复中断记录后都会清空。
- **实施**：项目文件引用改写入当前 Raw 对话头部的 `persistent-attachments`，每轮与临时附件合并后发送；完成只清临时附件。芯片标明“持续引用”，`×` 为“取消持续引用”。Raw 仅保存受校验的项目路径和元数据，不保存文件内容或二进制；已有重命名路径重映射同时覆盖持续引用。
- **边界**：拖入/上传附件、Skill、MCP 和生成工具仍是单轮状态；新对话与其他对话不继承引用。
- **验证**：focused 全绿；Rust `417 passed / 1 ignored`；`vue-tsc -b`、`git diff --check` 通过。真实三端交互验收未执行。

## [2026-09-14] 修复 | 3D 白膜编辑器吸附步长、取景框与过肩机位

- **触发**：用户反馈两个症状 —— 角色“往右移一点点就变得很远”，以及“过肩近景怎么调都调不到，取景框不能上下移”。
- **根因**：① `setTranslationSnap(... ? 1 : null)` 把吸附写死成 1 个世界单位，`TransformControls` 按 `round(x/1)*1` 取绝对整数格，而场景里网格又是关的，等于隐形跳一米；② 取景框宽度用 `min(86%, 72vh * 画幅比)`，与相机 aspect、`capture()` 裁剪矩形三者不同源（实测成片比框大约 13%）；③ `setLens`/`setProjection` 重建相机并从 `document.camera` 复位，而 OrbitControls 的实时机位从不写回；④ `applyCamera()` 会把 `document.canvas.aspect` 改成旧机位存的画幅；⑤ 过肩/近景预设是硬编码 `+Z 2`/`+Z 5`，不看两人真实方位，而用户场景两人同 `z`、只差 1 米。
- 修法：吸附步长档位（`1/0.5/0.25/0.1`，默认 `0.1`，控件旁显示当前值）+ 位置数值输入与方向键微调；新增 `cropRect()` 作为取景框与截图的唯一尺寸来源；新增取景模式（拖动/方向键只平移机位）；`orbit` 的 `end` 事件写回实时机位（不计入撤销历史）；过肩机位按两人真实连线重算、近景按人物朝向取景；新增“看向”与“临时隐藏选中对象”。
- 验证：`vue-tsc -b` 通过；focused `1343/1343` 通过（`memoworkbench.test.ts` 新增三组源码断言）；**真实 Desktop 手工验收未做**。
- 同步 [[开发/通用记忆工作台3D白膜场景基础工具SDD]] §6.1/§6.3/§6.4 与 [[排障/3D编辑器吸附步长与取景框-2026-09-14]]。
- **未做**：景深虚化（动画 SDD 明确排除，用户已确认不需要）。
- **追加（焦段）**：用户指出过肩应靠焦段解决（机位退远 + 长焦压缩空间，而不是拉开演员）。据此把镜头枚举换成等效焦距 `focal`（工具栏 `24/35/50/85/135`mm 五档），相机视角按取景框折算，过肩/近景机位距离改为由焦段推算。用户真实场景实算：24mm → 135mm 时远端头部相对大小从 36% 升到 74%（机位 0.51 米 → 2.85 米），横向偏移改为物理肩宽量级 0.19 米，前景人头才留在画内。
- **追加（机位行）**：用户实测反馈两处：① 取景框左边“缺失”，根因是目标画幅比编辑区宽时取景框左右边框贴到了面板边框上（`box-sizing: border-box` 下边框在盒内），改为舞台 `padding: 8px`；② 机位行写死的五个通用预设没用、过肩配错人，改为“按人物列前 6 个名字 → 正面中景”，并按用户要求把「看向」「过肩」一并删掉，机位行只剩人名。focused `1344/1344` 通过。
- **追加（机位打点）**：新增“机位打点 → 点录制自动走位”的运镜能力，复用既有 timeline 的 camera 条目（只新增两个纯函数 `cameraPointsFromDocument`/`applyCameraPoints` 和底部“运镜”行）。每个点两个数值（停留/到位），焦段按点位插值（timeline camera 条目新增 `focal`，动画 SDD 的“不做焦距动画”已放宽）。运镜录制走工作台隐藏的 `recordingOnly` 编辑器按画幅出片，不能在可见编辑器里直接录（会把取景框外画面录进去）。顺手修掉 `buildScene()` 把正在编辑的机位拉回时间轴的存量问题。`vue-tsc -b` + focused `1347/1347`。
- **追加（检视栏与录制提示）**：① 右侧检视栏在没选中对象时不再占一列宽度（`scene3d-workspace` 改默认单列，`inspector-open` 才出 260px）；② 录制/截图结果原来挤在会横向滚动的工具栏末尾、被截断导致用户“没看到成功提示”，改成压在 3D 画面上方的浮动提示（全文可读、可点关闭、10 秒自动消失、成功/错误左边框判色）。focused `1347/1347`。
- **追加（空白界面）**：修掉“把对话栏拖成窄条后关掉 3D 编辑器，整个界面变成一片空白”的 bug。根因是 `.memory-chat-compact-bar`（`inset: 0` + 不透明 `--paper`）与 `.chat-dock-compact .memory-main > :not(...) { visibility: hidden }` 没有限定“必须存在第三列”，关掉预览后主列变满宽仍被窄条盖住；改为 `:is(.preview-open, .creation-open)` 限定 + 窄条 `v-if` 加同样的条件（移动端媒体查询早就有这道保护，桌面端漏了）。focused `1349/1349`。
- **追加（竖屏预览）**：修掉“点开竖屏运镜 MP4，视频跑到下方、上面一大块空白”。根因在 `.memory-media`：媒体挂在该容器的唯一 `auto` 网格行里，行高由媒体自身撑开，`max-height: 100%` 的百分比因此无法解析（降级为 `none`），实测容器 `937` 高而竖屏媒体渲染成 `1771` 高，溢出 874px 且不进居中；`overflow: auto` 又让这块溢出区可滚动，点击后视野落在中段。改成显式 `grid-template-rows: minmax(0, 1fr)` + `overflow: hidden`，同一复现页上媒体从 `996×1771`（`scrollHeight 1811`）变为 `505×897`（`scrollHeight 937`）。横屏素材因 `max-width` 先命中所以一直没暴露；`ffprobe` 确认 5 条运镜成片都是 `1080×1920 / 120 帧 / 4 秒`，与取景框 9:16 一致。focused `1349/1349`。

## [2026-09-13] 修复 | 支持页补上自有联系方式（App Store 1.5 拒审）

- **触发**：App Store 拒审 —— `https://jiucaihezi.studio/support/` 被判定「does not direct to a website with information users can use to ask questions and request support」。
- **根因**：`privacy` 与 `terms` 都把用户指向 `/support/`，而该页**唯一**的求助通道是一个外部 GitHub issue 链接，**没有任何自有联系方式**（无邮箱、无表单、无 FAQ）。页面 HTTP 200 正常，问题在内容本身是空壳。
- 修法：`public/support/index.html` 新增「联系我们」（`mailto:` 邮箱，Apple 最认的通道）与「常见问题」4 条（要不要登录 / 登录失败怎么办 / 数据存哪 / 怎么反馈 Bug），GitHub Issues 降级为次要通道；账号注销补邮件兜底，并加一段英文说明方便英文审核员。
- 新增 `scripts/__tests__/legal-pages.test.mjs`（支持页必须含 `mailto:` 与常见问题；`privacy`/`terms` 必须指向 `/support/`）并登记进 `wave1FocusedTests`。这条检查锁的正是本次被拒的形态。
- 验证：focused `1338/1338`、Rust `412/412`；真实 dev server 渲染确认全部小节与 `mailto:` 链接正常，线上 `/support/` 为 200。
- 注意：Vite dev 下 `/support/` 会被 SPA 回退成 App 首页，只有 `/support/index.html` 是真实页面；Cloudflare Pages 生产环境 `/support/` 正常。
- **未做**：`/help/` 仍是 404（`public/help/guide.md` 是裸 md，无 `index.html` 构不成路由），本轮未动。
- **仍未解决**：`iPad`（`00008027-000D495A1A06802E`）未注册进 Apple 开发者账号，`pnpm tauri ios dev` 报 `Provisioning profile ... doesn't include the currently selected device`（exit 65）。这是本地调试拦路，不影响 App Store 分发。

## [2026-09-13] 修复 | MCP OAuth 打通（两处状态位置错误）+ 输入框三处修复

- **症状**：点 GitHub「连接」→ 浏览器跳转 → 回调唤起 App → **永远连不上**；设置页状态停在「连接中」。
- **根因一（`src/services/mcpOAuth.ts`）**：OAuth `state` 存在 `sessionStorage`。深链回调 `jiucaihezi://mcp/oauth/callback` 会落在**新的 WebView 会话甚至新实例**上，那里的 `sessionStorage` 是空的 → `consumeMcpOAuthCallbackUrl` 的 `intent.state !== state` 必然成立 → 授权码被丢弃并清空 intent。改为 `localStorage`（同一 App 内跨会话持久共享；15 分钟 TTL + 用后即删负责清理）。
- **根因二（`src/components/mcp/McpManagerPanel.vue`）**：回调监听器注册在**组件**上（`onMounted`/`onBeforeUnmount`），只有 MCP 设置面板挂载时才接收。面板关闭、切走视图或深链唤起另一个窗口 → 回调**无人接收、静默丢弃**。已提到应用级：`main.ts` 的 `handleDeepLinkUrls` 直接调 `completeMcpOAuthCallback`，结果写进 store；组件只读状态。顺带清掉组件里的死 import（`completeMcpServerAuthorization`、`McpOAuthCallback`、`onMounted`、`onBeforeUnmount`）。
- **真实环境验证**：GitHub MCP 连接成功并可用（云端 `gemini-3.8-flash` 调起 MCP 工具正常）。
- **本地模型 400 已修（同一晚）**：`qwen3.8:9b-q5` 每轮工具调用都报 `API 400: invalid message content type`。根因：`buildToolResultMessages` 回传的 assistant 消息只带 `tool_calls`、**没有 `content` 字段**；OpenAI 规范允许省略，云端网关放行，但 Ollama 这类兼容层要求 `content` 存在且为字符串。已补 `content: ''`（两边都接受），并同步 `directTools.test.ts` / `directEngine.test.ts` 里原本断言 `undefined` 的地方。实测本地模型恢复正常。
- **芯片提示改为 `position: fixed` 自绘**：原生 `title` 无法走主题色、无法固定在按钮正下方。`chipTip` 用 `getBoundingClientRect` 定位，绕开 `.memory-command-strip` 的 `overflow` 裁剪；并加 `watch(sending)` 防 disabled 按钮不派发 `pointerleave` 导致提示残留。
- **`@Skill` 面板只列 Skill**：新增 `skillPickerOnly`（从芯片排进入为 true，`closeMention` 重置），列表放宽到 40 项；手打 `@` 保持全套候选。删掉 `@Terminal` 合并时漏掉的 `mentionItems` Terminal 死入口，并让 3D 只在桌面出现。
- **排障记录**：`pnpm tauri build --debug` 的 App 会**强制连 `devUrl`（`http://localhost:1420`）**（`src-tauri/src/lib.rs` 的 `#[cfg(all(debug_assertions, not(mobile)))]` 分支），停掉 Vite 即白屏 —— 这是设计行为，要独立可用的包必须走 release 构建。另：本机 LaunchServices 里同时存在 debug/release/Xcode/Applications 四份「韭菜盒子」抢 `jiucaihezi:` scheme，唤起哪个不确定。
- 验证：focused 全绿、Rust `412/412`、`vue-tsc -b` 与 `lint` 通过。

## [2026-09-13] 修复 | 芯片提示残影 + @Skill 面板只列 Skill 并排序

- **残影根因**：`.memory-command-strip` 是 `overflow-x: auto` 的滚动容器，按 CSS 规范会把 `overflow-y` 计算成 `auto`；自绘 tooltip（`::after`，位于按钮上方 7px）被裁掉本体，只剩 `box-shadow` 落回容器内 → 用户看到一条跟着鼠标走、宽度随提示文字变化的灰带。已在真实 dev server 上用并排最小复现验证（`overflow-x: auto` 容器里 tooltip 完全消失，`overflow: visible` 里完整显示）。修法：删掉自绘 tooltip 与 `position: relative`，提示改用原生 `title`。
- **`@Skill` 列出工具的原因**：`mentionItems('')` 返回「7 个工具 + 前 5 个 Skill + MCP + 项目文件」，模板 `mentionFlat.slice(0, 12)` 只渲染 12 项 → 前 7 项全是工具。新增 `skillPickerOnly` 模式：从芯片排「@Skill」进入时只列 Skill（`slice(0, 40)`）；手打 `@` 的路径不变。
- **Skill 排序**：新增 `src/utils/skillPickerOrder.ts`（`PINNED_SKILLS` / `readSkillUseCounts` / `recordSkillUse` / `sortSkillsForPicker`）。三个置顶 + 其余按选中次数降序，同次数靠稳定排序保序；`counts` 可注入以便测试。计数点在 `selectMention` 的 skill 分支（**新选中时 +1**，重复点已选中的不计数）。
- 测试：新增 `src/utils/__tests__/skillPickerOrder.test.ts`（置顶不被高频 Skill 挤掉、频率降序、同频保序、不改原数组）并加入 `wave1FocusedTests`；`memoryWorkbench.test.ts` 增加「点 @Skill 只列 Skill」的源码断言。
- 验证：focused 全绿、Rust `412/412`、`vue-tsc -b` 与 `lint` 通过。

## [2026-09-13] 定稿 | 开关即全权：@Terminal 并入 @文件 + 零弹窗 + copy 工具

- 触发：用户实测「AI 新建」失败——模型只写出 `references/guxiang.md`（46603 字节里的一份），没有 `SKILL.md`，其余 reference 缺失，并自称"临时草稿目录禁止创建"。排查确认权限侧是通的（文件真的写进去了），真凶是**工具缺口 + 轮次上限**。
- 用户指出约束打架："既告诉它这个路径可以搞，又告诉它随便搞"。真正的不一致是**文件工具受路径边界管、终端完全不受管**。修法定为统一：文件工具保留路径前缀校验，终端按用户选择不做命令级扫描。
- 拍板（用户四答）：终端越界**不管**；`copy` **做**；`maxToolRounds` **64**；Web **不做**。
- 实施：`dev_copy_external`（复用 `skills::linker::copy_dir_all`，目标已存在拒绝、目标不得在来源内部）+ `copy` 工具定义/字段类型/执行分支；`@文件` 注入 10 项文件工具 + 终端 + Skill 脚本 + 3D 导出；删 `@Terminal` 芯片与 `terminalSelected` 一路参数；删 `ALWAYS_APPROVED_TOOL_NAMES` 与 MCP 审批分支（判断函数只剩"项目外路径未授权就报错"）；`maxToolRounds` 12→64；系统提示补工作范围与"搬移用 copy、一次做完"。
- 9 个能力模块盘点的结论：`git`/代码搜索/测试构建/Issue 都是 shell 命令的别名，放开终端即得；只有 Web 与 Subagent 是真新能力——Web 是用户 2026-08-07 自己砍掉的（有测试锁着），Subagent 需改引擎且当前场景串行，均不做。
- 验证：focused `1330/1330`、Rust `412/412`（新增 `external_copy_duplicates_a_tree_without_touching_the_source`）、`vue-tsc -b` 与 `lint` 通过。
- **真实 Desktop 验证通过（2026-09-13 14:22）**：一条消息 `Skill 目录：/Users/by3/.agents/skills 你直接帮我执行` 建出 `jc-xiangshu-character`，4 个 reference 与原目录 **md5 全同**（逐字节真复制），`SKILL.md` 从 255 行改写为 103 行（定位改造，非丢内容），芯片区 `@Terminal` 已消失，全程无弹窗；上轮“只写 1/5 个文件 + 空口收尾”未再出现。执行方式为 Terminal（目标目录已有上轮残留，`copy` 的“目标已存在即拒”不适用于增量补齐）。
- 文档：[[开发/记忆工作台文件能力合同与TDD-2026-09-13]] 的 §1、§2（改 10 条）、新增 §2.1 能力划分 / §2.2 明确不做 / §8.3 二次定稿决策 / **§9.1 真实 Desktop 验证证据**、§6 非目标、§6.1 落地位置、§6.2 验证、§9 验收清单全部同步；[[hot]] 同步。

## [2026-09-13] 补充 | 「新建 Skill」补 AI 入口（对齐「修改」）

- 根因：`@文件` 授权合同只覆盖了「修改」路径，用户新建 Skill 时没有任何入口替他给出绝对路径，模型只能自己猜中央根目录 → 授权失败后退化成输出 `mkdir`/`cp` 手工命令，Skill 不落盘。
- 修复：`WebSkillPanel.vue` 工具栏新增「AI 新建」（`centralSkillsRoot` 取扫描到的 `global_skills_dir`，取不到时回退到已装 Skill 包路径的父目录），点击 `emitEvent('skill-creator-create', { skillsRoot })`；`MemoryWorkbench.vue` 新增 `requestSkillCreatorCreate`，选上 `skill-creator`、打开 `@文件`、预填 `请新建一个 Skill：/ Skill 根目录：/ 新建要求：`。与「修改」完全对称；新建时 Skill ID 未定，所以给的是根目录（授权粒度是路径前缀，建子目录即已授权）。
- 只做 B，跳过 A（把合同硬约束塞进 Skill 附录）。
- 验证：focused `1330/1330`、Rust `411/411`、`vue-tsc -b` 与 `lint` 通过；真实 Desktop 手工验收未做（新增 §9 第 7 条）。

## [2026-09-13] 定稿 | @文件 合同按用户总原则收尾（删备份、补项目外三命令）

- 用户总原则：**点 `@文件` + 在消息里给出路径 = 该范围内不设额外限制**，路径由用户手动给，风险自担。据此定案：
  - **备份功能取消**：删除 Rust `dev_backup_external_file`、`prune_external_backups`、JS 的 `backupBeforeExternalWrite` 及其调用、Tauri 权限项、Rust 测试与文档条款。
  - **项目外建目录/移动/删除补齐**：新增 `dev_create_dir_external` / `dev_move_external`（拒绝覆盖已有目标）/ `dev_delete_external`（走系统废纸篓），工具层 `mkdir`/`move`/`delete` 增加 external 分支。
  - **符号链接逃逸不修**、**`wiki-memory` 与 `allowed-tools: file` 一行不动**、**不加授权范围 UI 回显**。
- 合同文档 §2 条款、§6.1 落地位置、§6.2 验证结果、§8（改为「审计结论与决策记录」）、§9 手工清单已同步。
- 验证：focused `1327/1327`、Rust `411/411`、`vue-tsc -b` 与 `lint` 通过；真实 Desktop 手工验收仍未做。

## [2026-09-13] 并发审计 | @文件 授权改动（4 路）+ 修复 8 项

- 审计分工：安全绕过与授权尺度 / 回归风险 / 并发与状态一致性 / 合同逐条一致。
- 🔴 已修：① `isAuthorizedPath` 不做路径折叠，`/授权目录/../../etc/hosts` 会被放行（Rust 侧 `canonicalize` 会真落到 `/etc`）——现改为前缀比较前折叠 `.`/`..`；② 备份失败被吞成文案后仍继续覆盖写——现改为中止写入。
- 🟡 已修：授权抽取漏授权（`路径=/绝对路径`、行尾 `.`、中文紧贴）；「编辑并重新发送」后已截断消息的授权仍生效，改为按保留轮次重算；删除运行中会话不 `stop()`；切项目在创作画布保存失败早退时残留授权集；`stop()` 未清 pendingTurn/run 状态；`creativeToolContract.ts` 7 处工具描述仍写“需用户逐次审批”（`delete` 那句是事实错误）。
- 🟡 未修待决策：符号链接逃逸（TS 字面前缀挡不住软链，彻底修需把授权根下传 Rust 复验）；`wiki-memory` 声明 `allowed-tools: file` 即拿到 9 件套（不点 `@文件` 也能写，测试已锁该行为，需在“保留 Wiki 写作”与“合同第 1/9 条”之间拍板）；项目外 `mkdir`/`move`/`delete` 未实现（合同已按现状改写）；粘贴文本里的绝对路径会成为授权且 UI 不回显范围；Rust 备份目录同秒撞名为 `check-then-use`（当前单窗口串行不可达，已标 ceiling）。
- 验证：focused `1327/1327`、Rust `411/411`、`vue-tsc -b` 与 `lint` 通过；真实 Desktop 手工验收仍未做。
- 文档：[[开发/记忆工作台文件能力合同与TDD-2026-09-13]] 补 §8「已知缺口」并把超出实现的措辞改为与代码一致；[[hot]] 同步。

## [2026-09-13] 实施完成 | 文件能力合同：@文件 + 绝对路径 = 零弹窗读写

- 根因：Skill Creator 读不到已安装 Skill 的 `references/`，用户判定属**文件规则**问题。旧实现把项目外路径限制为“逐文件精确匹配 + 必须出现在本轮消息 + 写入仍需审批”，且 Skill 层（`skillConnectionAdapter` 附录）越权明文禁止使用绝对路径。
- 修复：`memoryToolPolicy` 改为**路径前缀授权 + 会话内累积 + 授权范围内零弹窗**，未授权路径硬失败并提示用户补路径；`memoryChat`/`MemoryWorkbench` 接入会话级授权集；`read` 改回原文（`readTextPage`），行号不再混进可编辑内容；「我的 Skill → 修改」改为预填 Skill 目录绝对路径并自动打开 `@skill-creator` + `@文件`；删除 Skill 层越权条款；新增 `dev_backup_external_file`，覆盖项目外文件前把原件备份到项目文件树 `.raw/文件备份/<时间戳>/`；Skill 包引用校验忽略占位示例与句末标点。
- 验证：focused `1325/1325`、Rust `411/411`、`vue-tsc -b` 与 `lint` 通过（新增：前缀授权、占位引用、备份路径三组回归）。**未验证**：真实 Desktop 手工点击验收（6 条清单见文档）。
- 文档：新增 [[开发/记忆工作台文件能力合同与TDD-2026-09-13]]（合同 9 条 + P1–P4 TDD）；[[来源索引]] 增行；[[hot]] 更新；本合同替代 [[开发/通用记忆工作台模型主导工具与审批SDD]] 中“项目外路径必须在当轮消息出现且写入需审批”的旧条款。

## [2026-09-12] 生产验证成功 | 菠萝参考生适配器改为原样透传

- 现象：适配器自己下载 Worker 托管的临时素材再转存菠萝 OSS，先后产生 `RuntimeError: Attempted to send an sync request with an AsyncClient instance` 与 `Reference image from api.jiucaihezi.studio timed out after 60s`。审计 `gateway/src/index.js` 确认素材存在 Cloudflare Worker 的 KV、由 `/media/creation/<token>` 公共读，`http://new-api:3000/media/creation/...` 是 404，**没有内网捷径**，上一轮的内网改写方案被推翻。
- 修复：按 MiniMax 链路已验证的 lumenx 范式改回**原样透传** —— App 已通过 `/api/creations/uploads` 换成公网 URL，适配器直接把它装进 `ref_image_N` / `ref_audio_N`。删除 STS 申请、OSS V1 签名 PUT、素材下载转存、大小上限、扩展名推导及 `ASSET_FETCH_ORIGIN` / `ASSET_INTERNAL_BASE` / `REFERENCE_TIMEOUT_SECONDS` 三个环境变量，`main.py` 从 340+ 行降到 287 行，一次创建只发一次上游请求。保留创建接口先返回本地任务 ID（180 秒超时的修复）与 `/content` 代理。
- 证据：提交 `78ae5eb9` 部署到 `/opt/boluo-minimax-adapter` 后，两个图音参考模型均真实出片成功 —— 增强版 `minimax_h3_zm_u24`（面板回执 2026-09-12 19:59:39，成片 `.raw/jc-media/视频/男人惊讶_ymr9j1.mp4`）与基础版 `minimax_h3_image_audio_to_video_v2_15s`（用户确认）。这同时否掉了透传方案唯一的不确定点：**菠萝服务器能直接取到我们 Worker 上的临时素材 URL**，担心的 Cloudflare 拦截没有发生。
- 未验证：Worker KV `expirationTtl = 15 分钟` 的排队越界现场、上游 4xx/5xx 与超时重试在生产下的表现、`/content` 的 `Range` 续传；上游首尾帧与纯文生两个模型仍未接入。
- 文档同步：[[运维/菠萝MiniMaxapi]] §9 的「尚未验证」段改写为已验事实加剩余边界；[[来源索引]] 增补证据行；[[运维/服务器运维]] 适配器清单补生产出片状态；[[hot]] 更新。

## [2026-09-07] 生产运维完成 | 磁盘清理、输出过期与 AnyDoc 归一

- 回收 Docker BuildKit 缓存 `20.53 GB`，清理确认无用的旧日志、历史更新包和过期输出；根盘最终已用 `25 GB`、可用 `41 GB`、使用率 `38%`。不删除运行容器、生产数据卷、数据库或配置。
- `cleanup-jiucaihezi-output.timer` 已启用，`/opt/jiucaihezi/output` 的超过 24 小时可再生产物每日清理；目录由约 `4.2 GB` 降至 `276 KB`。
- 云端 `document-converter` 由 MarkItDown 切换为 AnyDoc `0.2.3`：staging `8811` 真实 DOCX 成功，生产 `8810` 健康检查成功，用户正式 Web 上传 `.doc` 并打开 Markdown 副本成功。扫描 PDF OCR 不在 AnyDoc 范围内。详见 [[运维/服务器存储清理与AnyDoc生产切换-2026-09-07]]。

## [2026-09-05] Skill Creator 修改入口与 v2.1.42 版本准备

- 修改入口由路径识别改为精确 Skill ID，中央目录统一使用 `~/.agents/skills`；读取仍走 `skill_creator_load_installed_skill`，不扩大文件权限。
- 新手指南同步更新 Skill 修改流程、记忆开关当前文案和三平台发布边界。
- 版本统一为 `2.1.42`，提交 `14ce5a15` 已推送 `origin/main`；tag 推送和 GitHub Actions 三平台构建需单独验收。

## [2026-09-05] 实施完成 | Skill Creator 读取并更新已安装 Skill

- 根因：设置页和 Skill 管理器能读取中央仓库，但 `skill-creator` 没有读取目标 Skill 的生命周期工具，只能错误搜索当前项目目录并误报未安装。
- 新增只读 `skill_creator_load_installed_skill`，复用现有中央 Skill Store 和受限资源目录；缺失、歧义、空内容、只读目标明确失败，不扩大文件系统权限。
- 修改现有 Skill 强制先加载真实 `SKILL.md`，禁用 Terminal/项目/Wiki 路径回退；安装卡继续作为唯一写入入口并保留原 ID。
- 定向 `28/28`、完整 focused `1212/1212`、`vue-tsc -b` 和定向 lint 通过；未执行真实 Desktop 点击更新和重启验收。详见 [[排障/Skill Creator无法读取已安装Skill-2026-09-05]]。

## [2026-09-05] UI 精简 | 顶部记忆与查询开关

- 将顶部按钮文案从“对话记忆/对话查询”精简为“记忆/查询”，同步修改悬浮提示；不改开关状态、持久化和发送链路。
- UI 定向测试 `64/64`、`vue-tsc -b` 和 `git diff --check` 通过。

## [2026-09-03] 设计确认 | 原生长期记忆与连续 Skill

- 根因确认：Skill 每轮清空与“无显式能力不发历史”组合后，会把 `skill-creator` 的测试等第二轮降级为无上下文普通问答；手动索引与只查当前 conversation 也不构成项目长期记忆。
- 用户确认写入 [[开发/通用记忆工作台原生长期记忆与连续Skill上下文根治TDD-2026-09-03]]：最近三轮与能力选择解耦，Skill 在当前任务持续，成功回答自动索引，`memory_search` 作为项目级原生只读工具，`jc-jiyi` 和手动“写入 Wiki”退役。
- 不新增“沉淀到 Wiki”；现有“保存到文件”保持原名和任意合法 Markdown 目标。本轮只完成 TDD 和导航记录，未修改运行时、未执行真实平台验收。

## [2026-09-03] 实施完成 | 对话切换保持中间文档

- 根因：`openResource()` 的 conversation 分支无条件调用 `closePreview()`，将右侧对话切换误当成中间资源切换，清空 `previewResource` 并退出 Markdown 编辑态。
- 修复：仅在中间资源分支执行预览/编辑状态清理；conversation 分支保留当前文档和编辑状态。显式关闭预览、打开其他资源、切换创作面板和切换项目仍可清理。
- 新增源码级回归测试；focused `1177/1177` 通过。真实 Desktop/Web/Mobile 人工验收未执行，不能据此登记为跨端验收通过。

## [2026-09-03] TDD 启动 | 对话记忆索引摘要模型接口约束

- 用户确认模型输出保持 `summary + keywords`，要求接口级结构化约束；新增 TDD 固定 System Prompt、assistant 正文输入边界、严格 JSON Schema、程序二次校验和失败不写入测试矩阵。
- 本轮只写入 TDD 与入口记录，不修改运行时代码，不执行真实模型或跨平台验收。

## [2026-09-02] Wiki 沉淀 | 三平台发布指令与 `--tags` 边界

- 复核 `.github/workflows/build.yml`：桌面发布只由 `v*` tag 触发，构建 macOS Apple Silicon、macOS Intel、Windows x64，全部构建成功后才由 `publish-download-manifest` 发布公开下载清单。
- 固化最短正确指令：已完成 commit/tag 时执行 `git push origin main` 与 `git push origin vX.Y.Z`；从版本准备开始则先统一版本、commit、annotated tag，再推送这两个指定 ref。
- 明确禁止 `git push origin main --tags` / `git push --tags`。本次 `v2.1.39` 复核中，`main`、`origin/main`、`v2.1.39` 均指向 `a58d49cf`；此前额外推送 `v2.1.37` 造成旧任务触发，根因是推送范围错误，不是代码构建失败。
- 本轮只更新 Wiki，不执行新的发布、构建、取消任务或远端修改。

## [2026-09-01] TDD 启动 | 对话记忆索引 V2

- 新建 [[开发/通用记忆工作台对话记忆索引按钮TDD-V2-2026-09-01]]，先固定 V2 格式、按路径读写和无 Raw/目录扫描测试，再执行 Runtime 与 Skill 修改。

## [2026-09-01] 实施完成 | 对话记忆索引 V2

- 文件服务新增按路径文本读取；写入链路不再读取 Raw 或扫描目录，查询先读固定索引、命中后按正链读取 Raw，同一 Raw 多命中只读一次。
- `jc-jiyi` 已更新为 V2 的“简介 + 关键词 + 正链”查询合同，默认返回 assistant 原始输出；Skill 校验通过。
- 定向记忆测试、focused build、TypeScript 与 `git diff --check` 通过；完整 focused 运行和真实模型、跨端验收仍需完成。

## [2026-09-01] 设计确认 | 对话记忆索引 V2 正确链路

- 新建 [[开发/通用记忆工作台对话记忆索引正确链路设计-2026-09-01]]，确定写入只处理当前 assistant 输出，由模型生成简介和关键词，程序生成正链并直接更新固定索引路径。
- 查询改为先匹配当前 conversation 的固定索引，再沿命中正链提取 assistant 输出；时间、顺序和 `userTurnId` 退出索引依赖。
- 当前代码与 `jc-jiyi` Skill 仍是 V1，本轮只固化 V2 设计并记录后续 TDD 顺序，没有修改运行时代码或声称性能优化已经完成。

## [2026-09-01] 方案确认 | 对话记忆索引按钮

- 新建 [[开发/通用记忆工作台对话记忆索引按钮TDD-2026-09-01]]，确定在 assistant 回答操作区增加“写入索引”按钮。
- 点击后调用一次模型生成 `summary + keywords`，程序负责当前 conversation、Raw 路径、turn ID、幂等写入和写后复读；`jc-jiyi` Skill 只负责后续精准查询。
- 本轮只写 TDD，未修改产品代码，未执行真实模型或跨端验收。

## [2026-08-31] 收尾准备 | 唯一 Agent 主线合并

- 新增 [[开发/通用记忆工作台Agent收尾与主线合并记录-2026-08-31]]，登记 `0829-WikiAgent` 与 `codex/0830-skill-first-agent` 的提交、合并、验证和删除顺序。
- 确认 `0829-rhapp-prompt-141` 已合并到本地 `main`；当前 WikiAgent 工作区和 Skill-first 工作区仍分别保留未提交收尾改动，避免在合并前丢失用户已验收的界面与对话行为。
- 本轮只记录现状和边界，不把未执行的真实模型、安装包、跨平台或生产发布验收写成通过。

## [2026-08-31] 收尾完成 | Skill-first 与 WikiAgent 合并主线

- `0829-WikiAgent` 提交 `49b515fc`、Skill-first 提交 `bcaa9163` 已合并到 `main`，合并提交 `1c83690e`；冲突文件保留 WikiAgent 白名单/渐进读取并接入 Skill-first Tool Search。
- 合并后 Node focused `1243/1243`、Rust `403 passed / 1 ignored`、`vue-tsc -b`、`git diff --check` 全部通过。
- 已删除已合并临时分支 `0829-Agent`、`0829-WikiAgent`、`0829-rhapp-prompt-141`、`codex/0830-skill-first-agent`；OpenClaw 参考分支保留。真实模型、安装包、跨平台和生产发布验收未被自动测试替代。

## [2026-08-28] 实施完成 | Wiki Agent 结果优先与独立状态卡

- Wiki Agent 收敛为最小两阶段：一次最小 ReadPlan、一次回答与可选 ChangePlan；不再因资料不足自动补读或阻断回答，`paths` 可为空。
- 模型负责理解任务、选择页面、生成答案和变更意图；程序负责路径安全、正文、`index.md`、双链、来源、日志、回滚和写后验证。
- Wiki 写入结果改为独立程序状态卡展示真实路径、索引/双链/日志验证和失败原因，不把完整内部 apply 回执拼入模型正文。
- 验证：Wiki/内存定向 `25/25`，UI + Wiki `75/75`，完整 focused `402 passed / 1 ignored`，TypeScript 与差异检查通过。

## [2026-08-18] 实施与沉淀 | RunningHub Grok Video 低价渠道合同变更

- 新建 [[开发/RunningHub Grok Video低价渠道合同变更TDD-2026-08-17]]，同步文生与图生两个低价渠道模型：时长 `6-15秒`，UI `0.25元/秒`。
- 图生视频改为 `1-7` 张参考图、单图 `10 MB`；前端 RunPlan 与 RH 标准 payload 均会拒绝越界数量和 `duration=16`。
- 根因是旧注册仍为 `6-30秒/最多3图/0.08元每秒`，且 RH capability 的数值 `min/max` 过去没有在共享 payload 构造器执行；现已补通用数值范围校验，不改变 endpoint、上传和轮询。
- 验证：前端 focused `1081/1081`、RH 聚焦 `40/40`、TypeScript、JSON 解析和差异检查通过；未部署，未执行真实 RH/NewAPI 账单或生成验收。

## [2026-08-17] 方案确认 | Gemini Omni RH 三模型接入 TDD

- 建立 [[开发/Gemini Omni RH三模型接入TDD-2026-08-17]]，复用现有 RH 标准 API、上传和轮询链路，不新建适配器或计费服务。
- 文生和图生视频固定 `1080p/10秒`，UI 显示 `2.5元/次`；视频编辑固定 `1080p`，UI 显示 `0.4元/秒`。
- 视频编辑必须按输入视频真实媒体时长向上取整计费；无法读取时长时阻止付费提交，不使用 NewAPI 默认秒数。
- 已完成最小实现与自动化验收：前端完整 focused 1080 passed、RH 适配器映射/payload/站点路由 39 passed、`vue-tsc -b` 与 `git diff --check` 通过；未部署、未进行 RH/NewAPI 真实账单验收。

## [2026-08-17] 用户验收 | 创作画布 Base64 泄漏与大文件恢复

- 用户已实际打开修复后的创作画布，确认现在可以正常打开。
- 与自动测试和 Desktop `Cmd+S` 回归一致：文件保持轻量引用结构，不再因标注图片组内的运行时 Base64 URL 重新膨胀。
- 本次用户验收仅覆盖该画布的打开回归，不代表几百张图片同时渲染性能已完成跨端验收。详见 [[开发/创作画布Base64泄漏与大文件恢复TDD-2026-08-17]]。

## [2026-08-17] 修复与沉淀 | 创作任务统一取消与重新生成

- 统一 `mediaTaskStore` 的取消边界：运行时明确区分执行器尚未启动、提交进行中、已取得上游任务 ID，以及结果已被 APP 接收并正在保存到项目的阶段；不把恢复的 `pending` 或缺少任务 ID 的请求误称为“未提交”。
- `cancelTask()` 现在等待取消状态写入历史后返回。取消会中断可中断的提交/轮询；未提交任务不调用执行器，已提交任务停止本地等待或跟踪，但不承诺上游取消、退款或扣费结果。
- 结果保存阶段隐藏两个 UI 入口的取消按钮，同时维持既有“保存完成才是 `success`”状态合同；不新增文件回滚、删除远程结果或 Rust 请求注册表。
- 创作历史中的“重新生成”覆盖成功、失败和已取消任务；仅在存在 `planSnapshot` 时回填模型、参数和提示词，参考素材仍需重新选择，绝不自动提交。对话气泡将文本成功、取消阶段和未知终态分开显示。
- 验证：新增/更新取消和 UI 合同后，定向 `94/94`、完整 focused、Rust `396 passed / 1 ignored`、`pnpm exec vue-tsc -b` 与 `git diff --check` 通过。Web、Desktop、KIK 真实取消与账单矩阵尚未执行。

## [2026-08-15] Desktop 验收与排障沉淀 | Grok 本机 ComfyUI 视频工作流

- 用户已在创作面板选择 `Grok 视频 30 秒 · 本机 ComfyUI`，框选 4 张画布参考图并于 15:49 获得成功视频任务；本次只确认这一份已登记 API 工作流，不外推为 MiniMax H3 或任意 ComfyUI 工作流可用。
- 固化映射：提示词节点 `16`，参考图槽位 `22/10/13/9/11/12/23`，生成节点 `7`，结果节点 `18`。Key 使用 Desktop 本机安全存储，Wiki 不记录 Key、提示词、参考图、视频地址或项目内容。
- 固化排障结论：ComfyUI CORS `OPTIONS 403` 改走 Rust HTTP 桥；多图上传使用唯一文件名；Tauri 参数使用 `mime_type/data_base64`；当前 `SaveVideo` 的 `crf` 不兼容，改为直接读取生成结果；Runtime 修改后完整重启开发 App，避免旧媒体执行器继续运行。
- “在创作面板中调整”首次打开为空的根因是空宿主先于异步 `CreationPanel` 模块就绪；统一打开入口现先等待模块再挂载和投递计划。工作台专项 `54/54` 与 TypeScript 通过，Desktop 点击复验待执行。
- 详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#Grok 视频工作流首轮真机验收（2026-08-15）]] 和 [[开发/本机ComfyUI工作流接入规范SDD]]。

## [2026-08-15] 收口 | 模型上下文、输出预算与重试策略

- 删除旧的模型族猜测、云端 `128K` 默认、每条历史消息固定 `16,000` 字符截断和固定 `4,096` 输出；云端统一兜底 `1M` 输入与 `128K` 输出，本地 Ollama/MLX 保持 `32K/4K`。
- Gateway 的 `contextWindow`/`maxOutputTokens` 优先；请求使用 `tokenx` 估算真实消息和工具 token，按剩余上下文动态设置 `max_tokens`。历史只保留最新完整轮次，较早轮次完整留在 Raw；达到输出上限最多自动续写 3 次并保留已有正文。
- 上下文淘汰只在当前会话提醒“Raw 仍完整，可查询或填充 Wiki”，不自动摘要、不自动填充 Wiki、不新增记忆数据库。旧回调、资源加载、会话快速切换、模型目录刷新和工具停止链路补上 generation/AbortSignal 保护。
- 对 Codex 与 DeepSeek Harness 的复核结论：本产品继续使用请求最多两次重试、一次断流续传和三次长度续写；不照搬五次请求、五次流重连、客户端 429 重试或固定 300 秒总超时，避免重复请求、工具副作用和合法长文被总时限截断。
- 验证：聚焦 `1047/1047`、`vue-tsc`、`git diff --check` 通过；未执行真实 NewAPI/Cloudflare 故障注入和跨端人工长文验收。

## [2026-08-14] 真实验收 | 韭菜盒子首个 ComfyUI 自定义图片节点

- 用户已在本机 ComfyUI 实际成功生成；节点合并为一个“韭菜盒子 图片生成”，按选择的 5 个 GPT Image 2 档或 2 个 Gemini 图片模型联动真实分辨率与比例，不复制第三方无效字段。
- 节点独立位于 `comfyui-jiucaihezi/` 与 ComfyUI custom_nodes 安装目录。Key 仅节点显式输入；图片只交给 ComfyUI，`Save Image` 保存到本机 output，不写入韭菜盒子主 App。
- 已记录后续接入准则：注册表/Wiki 是合同源；模型选择器统一入口；前端缩小不支持选项且 Python 再校验；`/object_info`、自动测试和用户真实生成缺一不可。详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#韭菜盒子 ComfyUI 自定义节点首轮验收（2026-08-14）]]。

## [2026-08-13] 发布准备 | v2.1.21

- 版本统一为 `2.1.21`：`package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 一致。
- 上次 Web 发布的 `ELIFECYCLE` 只是 pnpm 对失败子任务的转报；首个真实失败是 `memory-product-separation` 门禁发现两份既有本机 ComfyUI 测试遗漏 focused 清单。已登记 `localComfyRuntime.test.ts` 与 `comfyUiRuntime.test.ts`，完整 `pnpm run build`、Web 产物审计和 `git diff --check` 通过。
- 本记录时 `main` 尚未推送，Cloudflare Pages 尚未部署，`v2.1.21` tag 及 macOS ARM、macOS Intel、Windows CI 尚未触发；发布结果待真实执行后补充。

## [2026-08-13] 修复 | 创作画布本地媒体预览与 3D 编辑器收尾

- 新增 [[排障/创作画布本地图片视频预览空白-2026-08-13]]：`asset://` 地址导致图片、视频空框；共享路径恢复为 `dev_read_file -> data:`，用户确认图片预览恢复。
- 新增 [[排障/3D编辑器导出与选中控件-2026-08-13]]：FFmpeg 诊断与保存状态可见；基础编辑操作已补齐；空白点击、Esc 和捕获入口都会取消选择，避免移动箭头遮挡。
- 验证：`vue-tsc -b`、focused 测试构建和 `git diff --check` 通过；此前完整 focused 的唯一失败是既有测试登记清单遗漏两个文件。

## [2026-08-13] 排障 | 云端 GPT 图片渠道、RH 回收与画布落盘边界

- 新增 [[排障/云端GPT图片与RunningHub任务回收-2026-08-13]]：服务器直测和 NewAPI 日志确认 GPT Image 2 的 `502` 来自图片渠道 `104` 上游暂时不可用，不是本机 ComfyUI 接入造成；已从 App 模型目录下线 `GPT Image 2 VIP`，旧 ID 也禁止再次执行。
- Git `4e33901f` 修复 RunningHub 返回 `global:` 任务 ID 时被 URL 编码为 `%3A` 后遭安全校验拦截的问题。白名单只解码并校验 RH 任务路径，未放开任意 URL、路径或查询。GPT2.0 文生图/图生图的真实付费回收仍待更新后人工复验。
- 同时固化“成功但无放到画布”的排查边界：画布只使用项目内稳定媒体路径；远程结果下载超时或落盘失败时应显示保存入口，不应归因为画布插入故障。

## [2026-08-12] 计费确认 | KIK 视频任务按输入价格计费

- NewAPI `logs` 回执确认成功 KIK 视频任务为 `is_task=true`、`prompt_tokens=0`、`completion_tokens=0`，但按 `/v1/videos` 任务计费分支扣除 quota。
- 当前适配器没有可拆分的输入/输出 Token 明细，因此输入价格是视频任务计费基准；补全价格在本链路不参与。官方基础价由管理员配置，用户组和会员倍率由 NewAPI 叠加形成收益。
- `/v1/chat/completions`、错误 `/v1/video/generations` 的 404 记录 quota 为 0，不扣费。

## [2026-08-11] 修复 | Thinking 模型工具续请求

- 新增 [[排障/thinking模型工具调用reasoning_content中断-2026-08-11]]：thinking 流式响应的 `reasoning_content` 曾被共享 direct runtime 当作隐藏文本丢弃，工具结果回填后的下一次请求因此被上游以 400 拒绝。
- Git `d98b72bf` 仅在本轮 runtime 内回放该字段；不改变 `.raw` Markdown、历史对话或 UI。direct runtime `39/39`、TypeScript 与差异检查通过；真实 NewAPI 多轮工具回归待验收。

## [2026-08-11] 修复 | Playwright MCP PATH 二次遗漏

- 用户在已安装的 `v2.1.17` 中仍复现 `env: node: No such file or directory`；此前绝对 Node + `npx-cli.js` 只修复第一层启动，npx 后续通过 `env node` 启动 Playwright 时仍受桌面 App PATH 缺失影响。
- 共享 `mcp_spawn_stdio` 现在将解析后的可执行文件目录置于 Unix 子进程 PATH 最前，覆盖 Playwright 与同类本地 stdio MCP，不为单一服务加补丁。
- MCP 专项 `5/5`、TypeScript、Rust 编译和 `git diff --check` 通过；空 PATH 失败、补 `/opt/homebrew/bin` 后官方 Playwright MCP `--help` 成功。正式 `v2.1.18` 安装包点击验收待执行。

## [2026-08-09] 修复 | Playwright 打包版 Node PATH 根因

- `v2.1.16` 打包版的 Playwright 以 `npx` 启动，stderr 返回 `env: node: No such file or directory`；终端开发版能用、桌面包失败的差异来自 LaunchServices 不继承终端 PATH。
- `mcpClient.ts` 现在把 Unix `npx` 归一为绝对 Node + npm `npx-cli.js`，保留 Node 候选回退；MCP 测试 `11/11`、TypeScript 和绝对 Node 直接执行验证通过。
- 版本必须先统一为 `2.1.17` 再提交并打 tag；安装新包后才能记录 Playwright 正式发布验收。

## [2026-08-08] 真实验收 | short-video-factory 本地 stdio MCP

- [[开发/自定义MCP添加SDD]] 记录 Git `10553f10`：Node + tsx 启动归一、stdio 诊断、30 秒连接/列表超时、120 秒工具调用超时，以及失败连接和旧工具缓存清理。
- 用户在 Desktop 开发版确认服务端真实返回 8 个工具，并成功调用 `open_project` 打开 `0807功夫女友`，获得项目 ID 与 `episode-001`。`refresh_production_materials`、断 pipe 重连和外部安装包矩阵未执行。

## [2026-08-03] iOS 发布 | 2.1.7 已提交 App Store 审核

- App Store Connect 已提交 iOS App `2.1.7`（构建 `2.1.7.1`），页面确认“已提交 1 个项目”，当前状态为“正在等待审核”。
- iPhone 与 13 英寸 iPad 截图已通过；iPad PNG 的 alpha 通道错误通过转换为同尺寸无 alpha JPEG 解决。
- 审核通过后自动发布；当前不是 App Store 公开版，不登记为普通用户已可下载。

## [2026-08-03] 模型验证 | RunningHub Grok Video 多图与切镜

- 更新 [[运维/模型矩阵]]：`rh-grok-image-video` 已由短视频工厂完成真实多图参考任务，九宫格分镜板、人类与动物角色一致性及片内切镜验证通过；官方 `6-30` 秒合同保留，但不声称所有时长已逐档实测。
- ZX 渠道 `grok-1.5-video-6s/10s/15s` 的失败记录保持不变，不与 RunningHub 渠道验证结果混用。

## [2026-08-03] 开发收尾 | 记忆长对话屏外绘制降载

- [[开发/通用记忆工作台稳定性修复与Markdown体验升级SDD]] 固定并实施最小方案：保留完整自然文档流，只给每条 `.memory-message` 复用主聊天已有的 `content-visibility: auto`。
- 不改变显示、Raw、模型上下文、Markdown、Mermaid、媒体卡、滚动或同步；不恢复虚拟列表，不增加固定行数、固定屏数、观察器、估算高度或新依赖。
- 记忆工作台定向 `45/45`、TypeScript、Wiki validate 与 `git diff --check` 通过；Desktop/Web/iPhone 长对话降温体感待人工验收。

## [2026-08-03] 设计核实 | 快速/记忆对话上下文与工具权限

- 代码与 Git `b3faa1ab` 核实：对话 Markdown 是唯一持久化真源；App 只解析当前选中的 Raw，发送时按模型容量从最新完整问答轮次向前装入，能装下即装入当前对话全部历史。
- 快速模式唯一工具为只读 `wiki_search`；记忆模式在同一上下文上提供完整候选工具。模式选择器是工具权限唯一来源，用户消息不能增删工具池，模型只决定是否实际调用。
- 新对话不自动装入其他 Raw；快速模式不能读取其他 Raw，记忆模式初始上下文也只含当前 Raw，但可通过项目级 `read/grep` 主动读取。当前实现符合用户目标，不改代码。

## [2026-08-03] 真实验收 | 本地三维科普动画与分段镜头

- 用户在真实 Desktop 记忆模式完成一句话选矿 MP4；Markdown、`.jcscene`、系统 FFmpeg 和最终 MP4 链路通过。
- 首次成片暴露固定全景后，复用现有 `timeline.camera` 补强模型合同；第二次真实成片已确认分段镜头语言生效。
- 镜头增强没有新增字段、依赖或播放器分支；相关定向 25/25 与 TypeScript 检查通过。详见 [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]]。

## [2026-08-02] 设计确认 | 本地三维科普动画与 MP4 导出

- [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]] 固定下一步最小方案：复用现有 Markdown、`.jcscene`、Three.js、项目文件服务、Desktop 审批与用户电脑中的 FFmpeg。
- 动画时间线定义为 `.jcscene` 中“时间、对象、动作、目标状态”的数据，不是新引擎或独立编辑器；新增一个 `export_3d_scene_video` 工具负责原生画布录制和系统 FFmpeg MP4 导出。
- 当前仅完成设计，没有代码、测试或真实 MP4 闭环；不内置 FFmpeg，不增加游戏引擎、视频编辑器、远程服务、配音或复杂人物动画。

## [2026-08-02] 开发收尾 | 本地三维科普动画与 MP4 导出第一版

- [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]] 已实施 `.jcscene` 时间线、Three.js 播放和原生画布录制；Desktop 记忆模式新增 `export_3d_scene_video`，经现有审批调用系统 FFmpeg 输出 H.264 MP4。
- 没有增加依赖或内置 FFmpeg；Web 不暴露导出工具，临时录制文件不进入项目。
- 自动验证：相关定向 73/73、完整 focused 1434/1442（8 跳过）、Rust 403/404（1 忽略）、TypeScript、Desktop quick build和产物审计通过；真实 Desktop 模型一句话选矿成片待人工验收。

## [2026-08-02] 开发收尾 | Markdown 衍生、项目地图与主要人物白膜

- 记忆工作台复用现有 Mermaid 渲染并加入 H1-H3 可折叠大纲；新增 `export_markdown_slides`，在 Web/Desktop 生成 HTML、无打印弹窗的分页 PDF 和包含可编辑标题、正文、项目符号及表格的真实 PPTX。
- 标准 `.canvas` 作为独立项目地图进入资源路由，支持文本、文件、链接、分组、连线、关系标签、平移缩放、适配和只保存坐标的拖动；不合并 `.jccanvas`、`.jcscene`，不加载万能画布。
- 独立 3D 人物补齐胶囊双臂双腿并保留头部、躯干和朝向；群众阵列继续使用实例化躯干与头部。
- 验证：完整 focused 1431 通过、8 个既有条件跳过；最终定向 78/78 及幻灯片 25/25、TypeScript、Web/Desktop quick build、两端产物审计和浏览器桌面/移动视口通过。浏览器实际生成 PDF/PPTX 文件头有效；PowerPoint/WPS 和三平台安装包人工矩阵待补。

## [2026-08-02] 开发收尾 | 通用记忆工作台项目骨架代码对齐

- 新增共享项目路径合同，初始化补齐 `.raw`、`.raw/jc-media/{图片,视频,音频,文档}`、`.raw/对话记录`、`.raw/.sync`、`jc-canvas` 与 `wiki`；旧素材继续按类型 keep-both 迁移。
- 文件树隐藏对话、同步、画布记录和 `.DS_Store`，保护固定目录；Web/Desktop 上传与 AI 生成统一按文件类型归档，模型项目工具复用同一保护规则。
- 验证：合同专项 98/98、完整 focused Node 1431 通过（8 个既有条件跳过）、Rust 403 通过（1 个既有忽略）；TypeScript、Desktop quick 构建、产物审计与 `git diff --check` 通过。真实设备升级和打开既有项目仍待人工验收。

## [2026-08-02] 准则确认 | 通用记忆工作台项目骨架

- [[开发/通用记忆工作台原始素材与文档按需阅读SDD]] 成为项目骨架唯一事实源：上传与 AI 生成统一按图片、视频、音频、文档四类归档，不按来源增加目录。
- 固定并保护 `.raw`、`.raw/jc-media`、四个中文分类、`.raw/对话记录`、`.raw/.sync`、`jc-canvas` 与 `wiki`；普通媒体文件仍可管理。
- 文件树隐藏对话记录、同步状态、`jc-canvas` 与 `.DS_Store`；对话和画布分别只由各自选择器管理。旧 Studio/Web/媒体工作台文档不得覆盖本合同。
- 依据：用户 2026-08-02 明确确认；本条记录当时只固化 Wiki 准则，随后代码实现与验证见同日“开发收尾”记录。

## [2026-08-02] 修正 | 统一当前产品优先级

- 用户确认当前唯一主线为“通用记忆工作台”；主 Studio/旧主 Web、媒体、制作、电商和漫剧工作台降为兼容、历史参考或后续独立产品。
- 已更新 [[CLAUDE]]、[[架构/产品架构]]、[[hot]] 三个现行入口；其他工作台 SDD 与历史记录保留，不再从其内容推导当前开发重点。
- 依据：用户 2026-08-02 明确指令；现行 [[开发/通用记忆对话独立App SDD]] 已将记忆工作台定义为默认 `src/App.vue` 入口及独立产品壳。

## [2026-07-24] 收尾 | 电商工作台绝对独立

- [[开发/电商工作台绝对独立SDD]] 更新为实施事实：Rail 直接挂载电商，Chat 不挂载；模型目录不等待 OpenCode；当前字段、原始附件和显式 Skill 进入一次无工具直连请求。
- 运行记录收敛为 `jc-media/ecommerce/<run-id>/record.json` 的定位文件，页面不再建设反推/商品图历史；公共媒体链保持 `MediaPlanCard -> CreationPanel -> mediaTaskStore`，不增加 Wiki 双写、迁移或媒体回写层。
- 新增 [[开发/电商工作台绝对独立成功总结]]，作为以后新增独立工作台的入口、请求、共享能力、记录与验收模板。真实 Provider 和付费媒体人工闭环仍待验收。

## [2026-07-23] Web 解禁 | 电商工作台入口

- 移除 Rail 和布局对 Web 电商工作台的硬编码阻断；宽屏 Web 可从 Rail 打开，窄屏 Web 可从移动 Rail 打开。
- 移动端工作台确认媒体计划后会切到现有移动创作面板；不新建 Web 专属生成器或任务链。
- Web 解禁定向测试、TypeScript 和 `pnpm run build` 已通过；真实 Web 模型与媒体付费链路待人工测试。

## [2026-07-23] 交互收敛 | 商品图比例由媒体计划确认

- 移除商品图页的“交付目标”和“发布位置”：它们不能可靠推导平台版位或图片比例，也不再进入独立提示词模型请求。
- 商品图页只保留商品图、参考图和用户诉求；提示词生成后，用户在公共 `MediaPlanCard` 中按当前媒体模型的真实支持能力选择或调整比例、模型及其他参数。

## [2026-07-23] 架构更正 | 电商工作台独立提示词请求

- 更新 [[开发/电商工作台SDD]]：商品图和反推由图片、用户信息与指定 Skill 发起独立单次模型调用；不建立或借用 Chat、创模式或 OpenCode 会话，也不进入工具循环。
- 固定后续链路：模型只返回一条最终中文提示词；用户确认后，商品图与参考图一并进入 `MediaPlanCard -> CreationPanel -> mediaTaskStore`。`jc-gpt-image` 为纯提示词 Skill，不读密钥、不执行 API 或媒体任务。
- 实现已完成并通过定向 20 项、TypeScript 与 `pnpm run build:desktop`；真实模型请求和媒体付费链路仍待人工测试。

## [2026-07-22] 开发收尾 | OpenCode 道模式基础接入

- 新增 [[开发/道模式OpenCode第三主Agent SDD]] 对应实现：只注册 `config.agent.dao` primary Agent 和 Desktop 模式入口，复用文武已有会话、附件、权限、Skill、MCP 与工具链；旧创和 Web 不变。
- 道模式、文武附件边界和 Skill 路由联合定向测试 `181/181` 通过；正式 Web/Desktop 构建、Desktop 真实模型请求与 Windows/Intel Mac 人工验收待补。

## [2026-07-22] 状态修正 | 编辑区与 Explorer 稳定性已完成

- [[开发/文件系统/编辑区与Explorer稳定性修复SDD]] 已由 Git `2c9e9109` 实现并通过自动测试、构建及 Web 真实验收，合并记录为 `589deee8`，文档提交为 `421e4eac`。
- 修正此前索引中的“待实施”状态；Desktop 人工验收仍待补。

## [2026-07-22] 待实施 SDD | 文武道 OpenCode v1.18.4 官方对齐升级

- 新增 [[开发/文武道模式OpenCode-v1.18.4官方对齐升级SDD]]：实施顺序固定为 sidecar 生命周期、发送热路径、目录会话工作区、SDK/runtime v1.18.4、Provider variant、输入真实缺口和全量验收。
- 只读审计发现当前发送仍会经过配置投影、`ensureConnected`、目录 bootstrap 和 session permission 更新；Rust 每次 `ensure` 都会加载登录 Shell，并错误地因项目目录变化重启 sidecar。
- 当前开发机有 59 个 `opencode serve`，其中 58 个 PPID 为 1；SQLite 约 384 MiB、277 个 session。只记录为实施前风险，本轮没有清理进程、修改产品代码、运行测试或声称修复完成。

## [2026-07-22] 修正 | 撤销文武模式 Gemini 原生协议实验

- 真实 22 MB MOV 经 OpenCode Google Provider 转为约 30.8 MB Base64 后，首轮请求超过 8 分钟无响应；NewAPI 官方最新版没有 Gemini Files API 上传链路。
- 已撤销 Gemini 模型级 `@ai-sdk/google + /v1beta` 覆盖，恢复文武模式统一 `@ai-sdk/openai-compatible`；自然语言中的视频路径保持普通文字，由 OpenCode和用户自选外部工具处理。
- 不修改 OpenCode或NewAPI，不内置、不检测、不推荐任何第三方视频工具；文字、图片、Skill、工具和创作能力不变。
- Provider、OpenCode file part 与项目媒体路径定向回归 `37/37`、TypeScript 和补丁检查通过；测试证据 `/private/tmp/test result jc-opencode-video-rollback.log`，`sha256:699a755feb75`。正式构建与 Desktop 重启后真实复测尚未执行。

## [2026-07-22] 开发收尾 | 文武模式 NewAPI Gemini 原生协议

- Gemini 原生协议实验曾确认：真实 MOV 已进入 OpenCode，通用 `@ai-sdk/openai-compatible` 会在本地拒绝 `video/mov`；该实验随后因大文件 Base64 请求长期悬挂而撤销，现行结论见上方修正记录。
- 按 OpenCode v1.17.18 和 NewAPI rc.20 官方现有能力，只为韭菜盒子 NewAPI 的 `gemini-*` 模型增加 `@ai-sdk/google + /v1beta` 模型级覆盖；不改 OpenCode、NewAPI、创模式、模型选择、Skill 或工具循环。
- TDD 与回归证据：Provider RED 实际失败后转 GREEN；Provider、file part、项目媒体路径联合测试 37/37，TypeScript 与 `git diff --check` 通过。测试证据 `/private/tmp/test result jc-opencode-gemini-native.log`，`sha256:c770888df516`；正式构建和 Desktop 真实 MOV 内容读取尚未验收。

## [2026-07-22] 待实施 SDD | 编辑区与 Explorer 稳定性

- 新增 [[开发/文件系统/编辑区与Explorer稳定性修复SDD]]：项目文档打开后空白/覆盖、按需树刷新后视觉折叠、底部右键菜单不可见三项根因及最小修复设计。
- 风险分级：旧 `localStorage` 恢复会覆盖当前项目会话，现有自动保存可能写回项目文件，列为阻断风险；Explorer 与菜单问题尚未实施或验证。
- 更新 [[开发/文件系统/索引]]、[[hot]] 与 [[来源索引]]；没有修改产品代码或声称测试通过。

## [2026-07-21] 排障交接 | ZX Grok 参考图视频真实失败

- 新增 [[排障/ZX-Grok参考图视频真实失败交接-2026-07-21]]：三次真实失败后，选 1 参考图的 ZX Grok 6 秒仍返回 `Alias.image` 对象类型 400。
- 已记录 `79ddbddc`、`86690b7e`、`4b17c0cf` 及完整自动验证；但真实付费提交未通，不作修复完成结论。
- 接手者必须从 Vite `/__jc_api` proxy 或 Desktop WebView 抓取真实 `POST /v1/videos` 请求体类型，再判断客户端与服务器之间的对象在哪一层引入。

## [2026-07-21] 交互修正 | 默认对话、媒体参数编辑与 ZX 参考图视频

- 完成 [[开发/启动默认对话与媒体确认卡参数编辑及ZX参考图视频修复SDD]]：Desktop 启动默认进入对话；媒体确认卡改用橄榄绿主题，并可在卡片内调整模型、比例、分辨率和时长。
- ZX Grok 6/10/15 秒参考图直接按产品 `/v1/videos` 合同提交 data URL，不再调用已删除的 `/api/creations/uploads`；其他渠道素材流不变。
- 自动验证完成；真实 ZX Grok 6 秒付费闭环、截图级视觉检查和三平台正式安装包人工矩阵仍待验收。

## [2026-07-20] 能力升级 | 韭菜盒子原生媒体编排

- 完成 [[开发/韭菜盒子原生媒体编排能力SDD]] 的代码实施：本轮附件、项目文件树、画布选择和同项目同会话最近成功媒体任务统一为应用拥有的素材引用；模型只选择短期 ID，确认后仍复用 CreationPanel 与 mediaTaskStore。
- 审计并修复重复付费提交窗口、实时下线模型仍可选、Windows 项目绝对路径、任务落盘副本、历史计划参考图清空和跨项目确认状态；删除重复预览字段并合并素材映射，没有新增第二套媒体执行架构。
- 验证：TypeScript、focused Node 1117/1117、Rust 394/394、Web/Desktop Vite 构建及两端产物审计通过；真实付费、刷新/重启恢复和三平台正式安装包人工矩阵未执行。证据清单 `sha256:3a1e6607ddd5`。

## [2026-07-20] 排障收尾 | Web 创作面板控制台红字

- 新增 [[排障/Web创作面板控制台红字排障-2026-07-20]]：归档 CSP inline script、创作模型接口误走 Pages、画布项目图片路径被当作网站 URL 三项独立根因及最小修复。
- 更新 [[运维/服务器运维#RunningHub Web CORS（2026-07-20）]]：生产 Nginx 的 `/api/runninghub/` 已允许正式站点和 Pages 预览站，公网 `OPTIONS` 204 与本机 access log 均验证通过。
- 验证：本次定向测试 103/103、TypeScript、Web quick build 和产物审计通过；前端待重新发布后人工验收。当前完整 focused 被并行 Skill prompt 合同变更阻断，不记为本次回归。

## [2026-07-20] 能力升级 | Wiki 四 Skill 产品化

- 完成 [[开发/Wiki四Skill产品化升级SDD]]：查询默认现行优先并限制单页证据；Raw 新增只读收尾预览、证据状态与来源指纹；巡检分离现行风险和归档卫生；修正新增问题/依据/diff 预览和修后回执。
- Markdown 链接扫描复用 `marked` token，并由 `esbuild` 生成自包含 helper；构建 Skill 索引时自动重建，不依赖用户项目安装 npm 包。
- 验证：Wiki Skill 20/20、Raw Wiki 17/17、完整 `pnpm run test:focused`、TypeScript、Vite 正式构建和 Web 产物审计通过；正式 Desktop 三平台工具环境与普通用户四 Skill 闭环未人工验收。

## [2026-07-20] 修正 | 工作区边界与发布知识专项巡检

- 修正 [[开发/电商工作台SDD]]：移除 7 处已失效的 `.raw/sessions` 现行依赖，改为创模式 UI 会话与项目媒体结果链路；Raw 历史方案和删除依据分别保留在关联 SDD。
- 更新 [[CLAUDE]]：新增 [[学习/GitHub推送与发布边界-2026-07-20]] 长期入口。
- 修正 `jc-jian-wiki` 扫描器对 fenced/inline code 和特殊 Markdown 文件名的误报；复巡后其余断链仅落在归档历史示例，未批量修改。

## [2026-07-20] 发布门禁 | v1.3.0 全仓 53 条失败清零

- 完成 [[开发/v1.3.0全仓53条失败清零SDD]]：53 条失败全部处理。根因主要是全仓格式化后测试仍逐字匹配旧单行源码，少量断言仍引用旧品牌、旧 Web 面板范围和已移除模型。
- 保留并验证当前业务事实：创模式独立于 OpenCode、画布 owner/gate、统一项目文件服务、Web 媒体 Blob 字节所有权、文件树项目切换清理及媒体输入能力校验均未削弱。
- 修复额外发布阻断：为 `CreationPanel.vue` 多行模板事件的连续语句补分号，Vite 可正确解析，交互语义不变。
- 验证：focused Node 1096/1096、Rust、TypeScript、Web 正式构建与产物审计、Desktop 正式构建与产物审计全部通过；Production 部署、桌面签名和跨平台人工矩阵未执行。

## [2026-07-20] 功能恢复 | Web 自建 Skill

- 归档 [[开发/Web端自建Skill恢复SDD]]：恢复 Web Skill 仓库的“自建”、编辑与删除；原 `jc_web_skills_v1` 本地数据重新与内置 Skill 同时加载，新增变更继续写回同一浏览器本地存储。
- 边界：不上传、不迁移、不承诺跨浏览器或跨设备恢复；Desktop 中央 Skill 仓库不改。
- 验证：专属 7/7、TypeScript 与差异检查通过；完整聚焦测试仍有 53 条既有失败，Web 构建被 `CreationPanel.vue:3210` 既有模板语法错误阻断。

## [2026-07-20] 架构收敛 | 创模式 Raw 账本与对话 Wiki 移除

- 归档 [[开发/创模式Raw账本与对话Wiki移除SDD]]：删除 `jc-chat-wiki` 及创模式把对话、工具过程和媒体结果自动复制到项目 `.raw/sessions` 的全部链路。项目 `.raw` 只接纳用户主动放入的原始资料，不再由 Studio 自动生成对话副本。
- 保留 UI 会话存储、当前会话按模型容量装配，以及项目 `CLAUDE.md`、`wiki/hot.md` 的只读上下文；不删除用户已有 `.raw` 历史文件。
- 验证：TypeScript、raw 防回归 Node 测试、Skill 身份测试、`jc-raw-wiki` 契约测试和差异检查通过。Web/Desktop 完整构建均被 19 条既有源码合同测试阻断，详见 SDD；未为凑绿修改无关 UI。

## [2026-07-20] 整理记忆体 | GitHub 推送与发布边界盘点

- 新增 [[学习/GitHub推送与发布边界-2026-07-20]]：明确 Git push 只上传已提交文件，Web 只部署通过构建审计的 `dist/`，桌面包由版本 tag 的 CI 构建。
- 盘点发现：`.raw/sessions/` 的 2 个会话文件、`.git.backup/` 的 7,356 个文件及 `.superpowers/` 的 20 个本机状态文件仍被 Git 追踪；它们不应继续推送。
- 验证：当前旧 `dist/` 含 `.DS_Store`，`pnpm run audit:web-dist` 失败；未修改产品代码或删除任何用户文件。

## [2026-07-20] 发布收尾 | v1.3.0 发布失败修复

- 归档 [[开发/v1.3.0发布失败修复SDD]]：发布失败由一处原生确认框与多处过期测试合同组成；画布生产链路未回退，测试双桩已对齐 `ProjectFileService` 的 revision 写入和 V3 画布资源结构。
- 记录发布规则：`wrangler pages deploy` 未带 `--branch=main` 只生成 Preview，不能作为正式上线证据。
- 验证：局部 80/80、完整 `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`pnpm run build`、`pnpm run build:desktop` 全部通过；尚未执行 Production 部署或推送 v1.3.0 tag。

## [2026-07-20] 整理记忆体 | 0719-MCP 用户连接与对话排版收尾

- 归档 [[开发/自定义MCP添加SDD]]：设置的 MCP 扩展现可添加 Streamable HTTP、SSE 和 Desktop stdio 服务；添加后复用现有 store、client 和共享文/武/创工具池立即连接。Web 不显示 stdio，OAuth 与密钥输入不进入自定义表单。
- 归档 [[开发/对话Markdown正文紧凑化SDD]]：根因是助手 Markdown HTML 容器使用 pre-wrap，把标签间源码换行显示为额外空白；改为正常 HTML 空白折叠并收紧长文正文、列表间距。
- 验证：两项功能均新增合同测试并通过完整 pnpm run test:focused；用户已人工确认 MCP 表单功能与 UI。真实自定义远程 MCP 调用、Web/Windows/Intel 人工矩阵仍未执行。

## [2026-07-19] 整理记忆体 | GitHub OAuth MCP 连接实现审计

- 补充 [[开发/创模式MCP工具接入SDD]]：GitHub 卡片提供“连接”，授权页、深链回调、PKCE/state、Keychain 凭据与 `listTools()` 成功门控已落地；同一工具池继续供文、武、创共用。
- 归档安全边界：GitHub OAuth App Client Secret 只在 Cloudflare 网关中换 token，桌面包仅使用 Client ID；未配置 OAuth App 和未发布网关时，不能宣称用户已能连接。
- 验证：OAuth 与网关合同测试通过、Rust 394/394 通过；完整 focused suite 和 `vue-tsc -b` 仍被 MCP 以外的既有失败阻断。

## [2026-07-19] 整理记忆体 | 文件系统六期合并收尾压缩

- 建立 [[开发/文件系统/索引]]：六期 SDD、前置编辑能力与 Web 项目/媒体同步文档统一归入“文件系统”，明确 `ProjectResource -> ProjectFileService -> ProjectResourceChange -> 消费者` 的唯一事实源。
- 刷新 [[hot]]：将单一五期 SDD 替换为文件系统最终入口；自动验证、人工验收缺口和两个已知遗留问题同时保留，避免把未执行的跨端矩阵写成通过。
- 记录主线事实：文件树一期至五期、四点五期已合入 `main`，原 `0718-wenjianshu&bianjiqu` 已删除；重复 MCP 草案仍待用户决定，不自动删除。

## [2026-07-19] 修正 | 文件树六期专项巡检：补文件系统索引、全阶段入口、路线状态和主线合并历史；跨端人工验收缺口与遗留问题保留为待补

## [2026-07-19] 查询 | 文件树六期收尾状态（详见 [[巡检报告/2026-07-19-文件树六期收尾状态查询]]）

## [2026-07-19] 整理记忆体 | 创模式 MCP 工具接入与审计

- 归档 [[开发/创模式MCP工具接入SDD]]：创模式请求动态追加共享 `mcpStore` 中已连接 MCP server 工具；Desktop/Web 执行器均复用 `mcpBridge`，核心工具不变。
- 归档根因：核心工具参数白名单会在执行器分支前拒绝 `mcp__` 调用，现仅允许该前缀通过对象参数解析，实际可见性、连接校验和错误码仍由桥接层处理。
- 审计与验证：focused tests、Rust `cargo check`、`git diff --check` 通过；真实 GitHub MCP / Web SSE 人工调用尚未执行，`vue-tsc -b` 仍有本任务无关的既有错误。

## [2026-07-19] 整理记忆体 | 文件树第五期编辑区与项目文档统一完成

- 归档 [[开发/文件系统/文件树五期编辑区与项目文档统一SDD]]：编辑区保存只作用于当前项目文件；旧 Word/PDF/HTML/Markdown 转换导出、预览、模板导出、分片导出和关闭自动落库路径已删除。
- 归档统一出口：编辑区导出先保存当前项目资源，再委托可缓存回放的文件树导出命令宿主，因此继承同一份 Desktop/Web 目录选择、重名冲突和取消规则；项目文档插图先写入 `jc-media/images`。
- 归档交互：富文本和原样文本右键都使用中文产品菜单，并按选区显示既有编辑命令；编辑区和创作面板的新建项目文档均由文件树按当前选中上下文创建和打开。
- 验证：focused tests、Vite production build 与 `git diff --check` 通过。

## [2026-07-19] 整理记忆体 | 文件树四点五期文件总管统一完成

- 归档 [[开发/文件系统/文件树四点五期文件总管统一SDD]]：文件树、编辑区、画布和创作媒体通过同一 `ProjectFileService + ProjectResource` 进入统一存储与资源事件；共享动作层承接跨面板的画布、媒体和导出编排，项目文件是唯一事实源。
- 归档 Desktop 拖放：窗口级原生事件在 `WorkspaceLayout` 集中分发；任何外部文件先由 Rust 安全复制进项目，再由画布、对话区、编辑区或项目树消费，前端不再直接读取 Finder 路径。
- 归档根因与边界：`changed` 不是目录结构事件，文件树定向刷新避免画布切换时目录折叠；导入拒绝来源或目标目录符号链接，避免越界写入。画布落点偶发命中对话区与目录刷新极端竞态已记录为后续项。

## [2026-07-18] 整理记忆体 | 0717-RHAPP 分支全链路经验归档

- 更新「开发历史.md」：新增 0717-RHAPP 完整开发历史（AI 应用通道 + ZX 渠道 + 模型清理）
- 重写「AI应用适配-交接-2026-07-17.md」：状态改为 ✅ 全链路跑通，补充排障速查表
- 更新「hot.md」：新增第 9 条热索引指向 AI 应用交接文档
- 生存手册 #30-32 已在上次录入（Docker 缓存 / API 包装 / Nginx 嵌套）

## [2026-07-18] 整理记忆体 | 文件树一期完成

- 归档 [[开发/文件系统/文件树一期资源身份与文件安全SDD]]：统一资源身份、文件服务、打开路由与资源变更事件，编辑区和画布不再各自猜路径。
- 记录 Desktop/Web 文件安全和生命周期：截断或含 NUL 的内容不进入可写编辑器；改名、删除同步 Tab 与画布；音频画布可保存、恢复和播放。
- 记录 Desktop 文件操作：上传/导入/导出对齐 Web 菜单，删除进入系统废纸篓；重复删除和缺失节点按幂等语义处理。
- 记录根因：项目路径不是普通展示文本，不能对合法文件名统一 `trim()`；首尾空格目录必须保真。

## [2026-07-18] Wiki壳填充 | 文件树二期批量文件操作完成

- 归档 [[开发/文件系统/文件树二期批量文件操作SDD]]：多选、内部剪贴板、复制/剪切/粘贴、拖放移动、批量删除和所选资源导出统一通过 `ProjectFileService` 的批量计划与单一资源事件执行。
- 归档跨端结果：Desktop Rust 直接返回完整后代映射；Web 复制二进制时创建新的 documents/OPFS 身份，移动保留原身份；两端支持保留两份与覆盖。
- 归档画布与消费者：画布副本生成新的 `canvasId`，批量移动/删除/覆盖经 lifecycle gate；编辑区按 batch 顺序关闭覆盖目标 Tab、更新移动源 Tab，画布媒体同步改路径或标记缺失。
- 验证：用户已完成 Desktop 六项手工验收；自动验证 `pnpm run test:focused`、Rust 全量测试、Vite build 与 `git diff --check` 通过。

## [2026-07-18] 整理记忆体 | 文件树三期 Explorer 状态与性能完成

- 归档 [[开发/文件系统/文件树三期Explorer状态与性能SDD]]：Explorer 不再用 1000 项递归快照构树，项目根和目录均按需读取；普通目录和代码仓库目录可完整打开。
- 归档 Desktop 监听：使用跨平台 `notify` 监听项目根，前端按事件路径刷新已加载父目录，不恢复 5 秒全量轮询。
- 归档交互：深层资源定位逐层加载祖先；筛选通过 Desktop/Web 路径搜索构造临时祖先树；层级引导线由可见节点深度绘制。
- 验证：文件树 focused 测试、Rust `cargo check` 通过；Git 状态装饰明确留给第五期。

## [2026-07-18] 整理记忆体 | 文件树四期编辑区收尾完成

- 归档 [[开发/文件系统/文件树四期编辑区收尾SDD]]：编辑会话作为唯一 dirty 数据源，项目文件 Tab 和 Explorer 树行显示同一未保存小点；草稿不会伪装成文件树资源。
- 归档保存边界：全部保存复用单 Tab 条件保存，只处理可写回原路径的脏项目文件；冲突、删除、错误和草稿明确保留为未完成项，防止静默覆盖或重建旧路径。
- 验证：编辑会话/文件树 focused 测试与 Vite production build 通过；Git `M/U/9+` 保留第五期。
## [2026-07-21] 整理记忆体 | 三项生产故障本地修复

- 更新 [[开发/三项生产故障闭环SDD-2026-07-21]]：Web 文档转换拒绝 HTML 200 fallback；新画布图片只持久化资源身份；已提交 RH 任务的轮询异常保留为待恢复，客户端不再调用不存在的退款接口。
- 验证：定向 Node 86/86、`pnpm exec vue-tsc -b`、`document-converter` Python 3/3、`git diff --check` 通过。
- 未验证：VPS 转换服务与 Nginx 路由部署、Web 发布、真实 Word 上传、RH 真实付费回收及 Intel/Apple Silicon/Web 人工矩阵。

## [2026-07-21] 生产部署 | Web 文档转换服务

- 已部署 `document-converter`，容器仅监听 `127.0.0.1:8810`；`/health` 返回 JSON 200。
- 已安装 `/documents/markdown` Nginx 精确路由并自动备份原配置；`nginx -t` 通过，正式域名 `OPTIONS` 预检返回 204 和预期 CORS 头。
- 仍待：使用真实有效 Key 上传 `.docx`，确认返回 Markdown 并进入创模式附件；Web 画布与 RH 修复的发布、真实任务回收和跨平台人工矩阵不受本次服务部署替代。

## [2026-07-21] 生产验收 | Web Word 转换闭环

- 首次真实 `.docx` 上传 `422` 的根因是基础 `markitdown` 未安装 `docx` 可选依赖，不是 Nginx、鉴权、Intel Mac 或文件传输失败。
- 独立分支 `fix/document-converter-docx` 的 `b29da91b` 改用 `markitdown[docx]` 并阻止 Python Traceback 回传；本地真实 DOCX 容器验证输出 5206 字节 Markdown 后，VPS 已重建该容器。
- 用户确认正式 Web 上传真实 Word 后内容进入会话。画布与 RH 问题仍保持待发布、待真实验收状态。

## [2026-07-21] 修正 | 创模式核心原则一致性

- 用户确认唯一原则：创模式以模型原生能力为第一优先，产品能力补位，Skill 和工具按需增强；工具不能成为模型原生能力的门槛。
- 修正 [[架构/产品架构]]、[[开发/创作模式双端统一SDD]]、[[开发/创作工作台架构SDD]]、[[开发/韭菜盒子原生媒体编排能力SDD]]、[[开发/创模式MCP工具接入SDD]]、[[hot]] 与用户说明；历史实测保留并明确为实现缺口。
- 巡检与修正回执见 [[巡检报告/2026-07-21-创模式核心原则一致性巡检]]；本轮只改 Wiki，不改代码。

## [2026-07-21] 修正 | 创模式原生附件模型能力与工具补位合同

- 直接读取 OpenRouter 模型页与实时模型接口，只核对 GPT、Claude、Gemini、DeepSeek、Grok 五家：GPT-5.6、Claude 5/4.8、Grok 4.5 为文字+图片+文件，DeepSeek V4 为文字，Gemini 3.5 Flash 为文字+图片+文件+音频+视频。
- 更新 [[开发/创模式原生附件直连合同SDD]]：模型能力按“模型 ID + 渠道 + 输入模态”真实合同登记；OpenRouter 只缩小候选范围，不能替代 NewAPI/RH 生产实测。
- 修正不支持模态时的流程：附件身份与能力缺口仍进入模型，模型可按需调用读取/预处理工具；产品不自动切换模型、不提前运行 FFmpeg、转写、视觉或 OCR。

## [2026-07-21] 修正 | 补齐创模式端到端总架构

- 用户复核发现 [[开发/创模式原生附件直连合同SDD]] 只有附件合同、能力和测试，缺少从点击发送到最终回复的完整主链。
- 新增唯一 Direct Runtime 总架构、七步发送时序、六层职责和三种结果分支；明确模型是大脑，Direct Runtime 是唯一调度循环，工具是候选手脚，CreationPanel 只是受控媒体执行界面。
- 媒体计划改为模型基于用户目标提出后再校验和展示确认卡；产品不得用关键词在模型之前截流。

## [2026-07-21] 修正 | 创模式智能媒体增强与 Gemini 媒体专家

- 用户确认智能媒体增强默认开启：主模型原生支持媒体时直接读取；不支持时由 Gemini 3.5 Flash 读取原件并返回结构化理解，最终仍由用户选择的主模型回答。
- 明确模型协作与普通工具是两层能力：“不要使用工具”不禁止 Gemini；“只用当前模型”才禁止 Gemini；两者都禁止且主模型不支持时明确失败。
- Gemini 完成整体媒体理解后，主模型仅在精确镜头、时间点、逐字稿、OCR 或不确定性需要时调用工具验证，不默认双跑全套流程。
- 更新 [[开发/创模式原生附件直连合同SDD]] 的总架构、职责、能力合同、错误、实施任务、验收矩阵、风险和完成架构；生产默认启用仍以 Gemini 3.5 Flash 真实渠道合同测试通过为门槛。

## [2026-07-21] 修正 | 原生附件 SDD 产品哲学审计

- 依据根目录 `AGENTS.md` 将实施拆成两个独立门禁：先闭环原生附件发送合同，真实验收通过后再增加 Gemini 媒体专家，避免用跨模型协作掩盖基础合同缺陷。
- 第一阶段能力只认当前 Provider 和生产 NewAPI 的渠道级证据，不把模型模态声明复制到 RH、Ollama 或自定义 Provider。
- 首次跨模型发送前增加一次知情确认并允许撤回；Gemini 协作必须复用现有直连鉴权、传输、取消和错误链，不新增第二套客户端。
- 实施基线固定为 Git `c48e95b1`；本轮只修 Wiki，不改代码。

## [2026-07-21] 修正 | 媒体专家使用用户自有 Provider/K

- 用户确认韭菜盒子只提供创模式调度逻辑，不提供公共 Gemini、不代付费，也不读取其他分组或其他 Provider 的 K。
- Gemini 只有在用户当前 Provider/K 的模型目录真实可见且合同测试通过时才可协作；没有时询问是否使用现有本地工具，拒绝、缺失或平台不支持则明确失败。
- 纯本地模型原生支持媒体时直接读取；不支持时只走用户同意的本地工具，绝不自动上传云端。

## [2026-07-21] 生产合同 | 当前用户 K 的原生媒体输入

- 当前用户 K 的 `/v1/models` 返回 74 个模型并包含 `gemini-3.5-flash`，但不返回模态字段。
- 极小真实请求证明：Gemini 使用 `file.file_data` 可读取 MP4 和 WAV，并可与 `tools` 同请求；`video_url` 虽返回 200，但模型回答“没有提供”，不能作为有效视频合同。
- GPT-5.6 Terra 对同一 `file` 视频回答“无法判断”；只登记为不支持，不伪造已读取。
- SDD 第一阶段据此统一图片 `image_url`、视频/音频/文件 `file.file_data`，不增加 Provider Adapter。

## [2026-07-21] 开发收尾 | 创模式原生附件与用户自有媒体补位

- 完成 [[开发/创模式原生附件直连合同SDD]] 的代码实现：Web/Desktop 共用原生附件合同；请求态原件与持久态素材引用分离，Base64 不写入创模式会话。
- 主模型不支持媒体时，只在当前 Provider/K 内使用已验证 Gemini 3.5 Flash，并在首次发送前显示知情确认；没有 Gemini、用户拒绝或协作失败时，只允许用户授权后的本地工具补位。纯本地模型不上传云端。
- 工具能力与附件投递解耦；明确的“不要工具”和“只用当前模型”分别生效。设置可关闭智能媒体增强并撤回跨模型长期授权；413、400/415、524 有明确附件错误，失败或取消保留输入区附件。
- 当前用户 K 真实复测：74 个模型；Gemini 正确识别 378B PNG、2290B MP4、32078B WAV 和 MP4 + tools，GPT-5.6 Terra 对同一 MP4 明确未读取。未输出 K 或 Base64。
- 验证通过：完整 focused、Rust 394/0/1、TypeScript、Web/Desktop 正式构建、两端产物审计和 `git diff --check`。Desktop/Web UI、刷新恢复、真实付费和 Windows/Intel/Apple Silicon 安装包人工矩阵仍待执行。

## [2026-07-21] 审计修正 | 创模式附件与 Provider 边界

- Git `701021a6` 修正六项实现缺口：媒体计划嵌套 Base64 清洗、文件提取失败保留原件、Web 失败与取消向外传播、本地模型禁止云端回退、自定义 Provider 禁止冒用默认 K、旧图片入口统一进入输入模态判断。
- 新增 Web 行为测试覆盖无同 Provider Gemini、用户拒绝、媒体专家失败、API 配置失败、专家阶段取消、本地视频零云请求和文字模型不接收旧图片。
- 验证通过：`pnpm run test:focused`、Rust 394/0/1、TypeScript、Web/Desktop 正式构建、两端产物审计和 `git diff --check`。人工验收边界不变。

## [2026-07-21] 修正 | 创模式真实视频第三轮合同

- 真实 17.1 MB、127秒MOV与旧会话回归推翻“原生附件已经完整闭环”的状态：浏览器`video/quicktime`未按NewAPI官方`video/mov`归一化，历史重发没有恢复`modelAttachments`，HTTP 500正文被吞，`content_filter`被显示为空回复，失败UI文本继续污染模型历史。
- 更新[[开发/创模式原生附件直连合同SDD]]：新增完整NewAPI官方MIME矩阵、最终JSON请求预算、错误状态与模型历史分离、历史附件恢复、时间轴剧本结果和真实验收任务。
- 生产边界保持不变：继续使用`calciumion/new-api:latest`官方镜像；官方`/v1/files`仍为501且相关issue开放，本轮不维护NewAPI Fork、不引入LangChain或Google Files API服务。本轮只修Wiki，不改代码。

## [2026-07-21] 纠偏 | 创模式第三轮回归基础合同

- 用户确认视频剧本、时间轴、分镜、台词和固定 JSON 不是创模式底座验收标准；这些属于后续 Skill、提示词或确定性工具与创模式的组合能力。
- 重新整理[[开发/创模式原生附件直连合同SDD]]第三轮：只保留 NewAPI 官方 MIME、请求预算、错误状态、失败历史、附件恢复和真实附件回归；模型回答保持自由文本。
- 删除剧本 JSON、时间轴实现任务和内容质量验收；本轮仍只修 Wiki/SDD，不改代码。

## [2026-07-22] 最终纠偏 | 创模式只使用当前模型

- 用户最终确认：创模式不负责在当前模型不支持附件时自动寻找 Gemini、换模型或询问本地工具补位；当前模型不支持时只明确结束。
- 重写[[开发/创模式原生附件直连合同SDD]]：唯一路径是“当前模型 + 当前 Provider/K + NewAPI 官方附件合同”；保留普通模型工具循环，但工具不作为产品级附件降级。
- 实施范围只包含：删除自动媒体专家路由，修正 NewAPI MIME 与请求预算、HTTP/`content_filter` 错误、失败历史污染和旧附件重发。本轮只修 Wiki/SDD，不改代码。

## [2026-07-22] 开发收尾 | 文武道 OpenCode Prompt 上下文对齐

- [[开发/文武道模式OpenCodePrompt上下文对齐SDD]] 已实施：当前项目内 `@` 文件和目录变为官方 `file` parts，显式 agent 变为 `agent` part；发送前复核引用存在性，失败保留输入与 pill。
- 固定 Skill permission 在新 `session.create` 同步写入，既有会话在 `promptAsync` 前按规则集去重同步，避免首轮权限竞争。
- 本分支专项、完整 focused、`vue-tsc -b`、`pnpm run build:desktop:quick` 和补丁检查通过；真实 Desktop Provider 和三平台人工验收待补。

## [2026-07-23] 开发收尾 | OpenCode 会话时间线与上下文对齐

- 更新 [[开发/文武道模式OpenCodePrompt上下文对齐SDD]]、[[开发/OpenCode差异修复记录]]、[[hot]] 和来源索引：Desktop 时间线固定为 OpenCode Sync Store 单一真源；侧栏会话选择始终先加载指定 session，不允许 Web/创模式遗留 guard 阻断。
- 分支提交范围：`c720be5a` 至 `694d1132`，包含 `@` file/agent parts、Skill permission、附件投影、消息乱序/快照连续性、官方 thinking row、分页历史、代码块复制和 session 切换回归。
- 自动验证：`desktopOpenCodeSyncCutover` 39/39、`pnpm exec vue-tsc -b`、`pnpm run build:desktop:quick` 和 `git diff --check` 通过；quick build 生成的无关图标差异未纳入提交。
- 未验证：本轮 `pnpm run test:focused` 未产生可归属结束码，原因是 2026-07-19 遗留 Node 测试进程使用固定 `/private/tmp/jc-focused-tests`；已停止该进程，需在干净临时目录复跑。真实 Desktop Provider、停止/权限交互及三平台人工矩阵仍待补。

## [2026-07-23] 修正 | 统一道模式现行文档入口

- `CLAUDE.md` 的道模式入口改为 [[开发/绝对纯直连道模式SDD]]。
- `来源索引.md` 登记纯直连 SDD、实施记录和 Git 证据；旧 OpenCode `dao` Agent 方案标记为已替代。
- [[开发/道模式OpenCode第三主Agent SDD]] 明确降为历史方案，不再作为现行开发依据。

## [2026-07-31] 发布收尾 | v2.1.3 通用记忆工作台工具与文档链路

- 完成模型主导工具与当前运行审批：Desktop 增加 Terminal，双端补齐目录、移动和删除；`read_url` 与显式 `@联网搜索` 分离。
- 文档上传后保存可读副本并由模型按需 `grep/read`，不再逐轮注入全文；画布快捷键只在焦点或事件目标位于画布内时拦截复制。
- 版本统一为 `2.1.3`。发布前验证：focused Node 1412/1420（8 跳过）、Rust 401/402（1 忽略）、TypeScript、Web/Desktop 正式构建与产物审计通过。
- `.raw/jc-media/{文档,图片,视频,音频}` 的 App 层迁移仍待实施；Web 生产地址和三平台 CI/Release 结果仅在真实完成后补记。
- Web Production 已部署至 `https://04db458f.jiucaihezi.pages.dev`；正式域名 `https://jiucaihezi.studio` 返回 HTTP 200，防缓存请求加载本次构建的 `index-Bub6mWvw-jc20260610b.js`。三平台结果继续等待 tag 流水线真实完成。
- `v2.1.3` tag 触发 GitHub Actions `30616993714`：Mac Apple Silicon、Mac Intel、Windows x64 与 `publish-manifest` 全部成功；两份 macOS DMG 均完成 Developer ID 签名、公证、SHA256 和记忆 App 边界冒烟，Windows ZIP 完成内容冒烟。
- GitHub Release `https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/tag/v2.1.3` 为正式非草稿，含 ARM DMG、Intel DMG 和 Windows portable ZIP；服务器三个下载地址均返回 HTTP 200，`https://api.jiucaihezi.studio/updates/latest.json` 已更新为 `2.1.3`。

## [2026-08-01] 发布准备 | v2.1.4

- 收口 `v2.1.3..main`：自动分组登录 Key、记忆工作台消息/Raw/基础作品工具、HTML/PNG 渲染、Three.js 3D 白膜与 RH 全球站逐模型路由。
- RH adapter 已在服务器重建；全球 Key 已进入容器，`/health` 返回 `status=ok`、44 个模型。真实 Grok/Suno 与其他迁移模型任务尚未验收，不记为成功。
- 版本号统一为 `2.1.4`；发布前门禁通过：focused Node 1422/1430（8 跳过）、Rust 402/403（1 忽略）、类型检查、Web/Desktop 正式构建与两端产物审计。Web Production 和三平台 CI 仅在真实触发后补充证据。

## [2026-08-01] 发布准备 | v2.1.5

- 修复 Suno 经 NewAPI 标准音频合同调用时自定义字段丢失：App 同时发送标准 `input`，RH adapter 将其兜底映射为 `prompt / description / lyrics`；服务器必须拉取本提交后只重建 `rh-adapter` 才生效。
- 修复 3D 白膜标签遮挡主体和 Web 崩溃：标签固定小尺寸、人物头顶锚定并恢复深度遮挡；底部提供九个通用机位；空白/截断 `.jcscene` 降级为纯文本，编辑器通过现有解析器获得可克隆纯数据。
- 用户已完成 Web 人工验收；版本统一为 `2.1.5`。发布门禁通过：Node 1424/1432（8 跳过）、Rust 402/403（1 忽略）、类型检查、Web/Desktop 正式构建与两端产物审计。Web Production 和三平台 CI 结果只按本轮真实执行结果继续补充。
- Web Production 已部署至 `https://ae9a1a0b.jiucaihezi.pages.dev`；正式域名 `https://jiucaihezi.studio` 返回 HTTP 200，并与本地正式产物共同加载 `index-Dlc60MQ5-jc20260610b.js`。三平台构建状态在 tag 真实触发后记录。
- `v2.1.5` tag 已触发 GitHub Actions `30690007566`；Mac Apple Silicon、Mac Intel 和 Windows x64 均已进入运行状态，按发布要求未等待完成，不记为构建成功。
- 服务器仅重建 `rh-adapter`，容器健康检查返回 `status=ok`、44 个模型。真实海外 Suno 歌词任务提交约 113ms，RunningHub 约 15 秒完成，adapter 和公网 `/rh/tasks/global:<id>` 均能返回 `completed` 与完整歌词。
- Web 一直显示“提交中”的根因不是 RH 或 NewAPI 慢：NewAPI 约 125ms 返回 200 后，前端等待任务历史持久化完成才开始轮询；Web 存储等待会阻断后续查询。现改为任务 ID 和轮询地址先写内存并立即轮询，持久化后台执行；focused Node 1424/1432（8 跳过）和类型检查通过。

## [2026-08-02] 生产摸底 | Gemini 3.6 Flash 视频读取前置核验

- 生产只读实查确认 NewAPI 仍为 `v1.0.0-rc.20`，运行镜像摘要为 `sha256:6da2278e7f28109043375e373546efdfb96d9a60d82a46f039d0a81499ec8cd3`；官方最新 `main` 不能替代生产行为证据。
- `gemini-3.6-flash` 存在于渠道 `71/73/89`，三者均启用、类型均为 `24`、上游均为 `zxai.work`，且 `model_mapping` 为空。该事实只证明可路由，不证明上游身份或视频已被读取。
- 容器没有显式设置请求体、文件下载和流超时环境变量；Nginx server 块有 `200m`，但存在 location 级覆盖，正式域名确认经过 Cloudflare。真实大小上限必须由阶梯请求确定。
- [[运维/服务器运维]] 已登记生产事实、NewAPI 官方通用视频转换边界和未验证项；下一步先用专用低额度 Token 跑 `2 MiB` 防假读 MP4，不升级生产或修改限制。

## [2026-08-02] 开发收尾 | 快速模式只读 Wiki 查询

- 快速模式与记忆模式继续共享当前对话上下文，工具池固定为唯一只读 `wiki_search`；用户文字不能增减工具。
- `wiki_search` 复用现有 Wiki `search` 运行时，只接收 `query / scope / limit`，无写入、修正、建图或任意文件读取能力；Web 和 Desktop 执行路径已对齐。
- 自动验证：定向 69/69、完整 focused 1429/1437（8 跳过）、`vue-tsc -b` 和 `git diff --check` 通过；未执行正式构建，真实模型自主调用待人工验收。

## [2026-08-03] 设计确认 | Web / Mobile 核心能力收敛

- [[开发/通用记忆对话独立App SDD]] 新增第 18 节，确认 Desktop 完全不动，Web / Mobile 保留项目、对话、Wiki、项目内受限读写、附件/文档转换、项目地图和云媒体。
- Web / Mobile 计划移除 Three.js `.jcscene`、本机 FFmpeg、Terminal、本地模型和本地 `stdio MCP`；自定义 MCP / Skill 管理 UI 可隐藏，但内置 Wiki Skill 必须保留。
- 创作面板不删除、不重构；Web / Mobile 关闭时应卸载 LeaferJS 资源。文字同步合同不变，媒体二进制绝不同步。
- 当前仅完成设计记录，尚未改代码或执行功能验证。

## [2026-08-03] 开发收尾 | 历史文档定位续聊

- 记忆模式现在只从当前已装入上下文的历史用户轮次提取唯一文档名称和 `readablePath`；第二轮说“这个文档”时，模型可按原路径重新 `grep/read`。
- 文档正文和上一轮工具结果不重复注入；快速模式、当前轮附件、Raw 格式与项目工具不变。
- 自动验证：定向 55/55、完整 focused 1436/1444（8 个既有跳过）、TypeScript 和 `git diff --check` 通过。真实模型第二轮口语指代待人工验收。

## [2026-08-03] 设计修正 | 三端创作面板关闭释放资源

- 修正 [[开发/通用记忆对话独立App SDD]] 第 18 节：Desktop 不再长期挂载已关闭的创作面板；三端统一为关闭前保存 `.jccanvas`，保存后卸载 LeaferJS、Canvas、运行时媒体 URL、事件和画布写入锁。
- 已提交媒体任务继续由 `mediaTaskStore` 运行，关闭面板不得取消任务；重新打开后从任务状态和已保存画布恢复。
- Desktop 的 3D、FFmpeg、Terminal、本地模型和本地 MCP 能力不裁剪。当前仅更新设计，尚未执行代码或功能验证。

## [2026-08-03] 开发收尾 | Web / Mobile 能力收敛与创作面板卸载

- Web / Mobile 记忆工具白名单移除 `create_3d_scene` 和自定义 MCP；`.jcscene` 文件树入口与旧对话场景卡不再显示，自定义 Skill / MCP 管理入口仅保留 Desktop。Desktop 的 3D、FFmpeg、Terminal、本地模型和 MCP 工具装配未裁剪。
- 三端创作面板关闭与切换项目统一先保存 `.jccanvas`，保存成功后卸载 `CreationPanel`；既有卸载清理继续释放 LeaferJS、Canvas、事件、运行时媒体 URL 和画布写入锁，`mediaTaskStore` 中已提交任务不随面板卸载。
- 自动验证：focused 1435/1443（8 个既有跳过）、TypeScript、Web quick build、Web 产物审计与补丁检查通过，验证摘要指纹 `sha256:e146f804f114`。Desktop、Web 浏览器与真实 iPhone 人工矩阵待验收。

## [2026-08-03] 发布与记忆收尾 | v2.1.7 和新手指引

- `main`、`origin/main` 与 `v2.1.7` tag 指向 `cf599f26`；Web Production 已正式部署并加载 `assets/index-DeAQeEjp-jc20260610b.js`，GitHub Release 已建立。
- Actions `30805047950` 按用户要求不等待；检查时 Apple Silicon 产物已存在，Windows、Intel Mac 和生产 `latest.json` 切换仍未全部完成，不登记为三平台全部成功。
- iPhone `2.1.7` 开发签名版已安装、启动并由用户确认当前流程通过；它不是 TestFlight / App Store 公开版。现有 TestFlight 仍是 `2.1.0` 内部测试，Android 无公开版本。
- `jc-new-user-guide` 删除强制 GIF / 菜单、旧模式和静默上传问答，按现行三端能力重写；Skill 校验与 27 项索引生成通过，证据 `sha256:0f24861b8194`；Web quick build、TypeScript 和产物审计通过，证据 `sha256:3d9ac46c07c8`。变更发生在 `v2.1.7` tag 之后，进入后续构建。

## [2026-08-03] iPhone App Store 账号入口最小收敛与注销

- 只在 iPhone 开启账号精简：保留已有账号登录、退出和文字同步，隐藏注册、API Key、充值、日志、邀请与签到；Desktop / Web 默认行为不变。
- 新增 `DELETE /auth/account`：Gateway 只信任现有 Session，删除当前用户同步文字，调用 NewAPI 官方自助注销，再清理 Gateway 身份；客户端成功后清除本机登录凭据和当前项目云绑定，本地 Raw、Wiki、媒体不删除。
- 新增隐私政策、用户支持和服务条款静态页；Web 产物允许，Desktop / iOS 产物继续裁剪。
- 自动验证：focused 1439/1447（8 个既有跳过，`sha256:cc4dcb81d4ef`）、Gateway 20/20（`sha256:86ea9f00f57f`）、TypeScript（`sha256:1d58a6f525b8`）、Web quick build 与产物审计（`sha256:0321306433c2`）、iOS quick build 和补丁检查通过；三个合规路径本地 HTTP 均为 200。
- 尚未部署 Gateway / 合规页面，未执行真实 iPhone 不可恢复注销或生产旧 Key 失效验收；本轮未提交、未推送、未发布。

## [2026-08-04] 修正并实施 | 文字同步改为方向性覆盖

- 根因：旧 `ProjectTextSync.syncCycle()` 固定先拉后推，并在冲突时合并 Raw 或生成冲突副本；项目中心与设置页又把该行为分别命名为“立即同步/上传到云端”，导致用户无法知道哪一侧覆盖哪一侧。
- 现行合同：项目中心提供 `上传并覆盖云端` 和 `下载并覆盖本地`；前者以本地允许同步文字快照覆盖云端并 tombstone 云端独有文字，后者以云端文字快照覆盖本地并删除本地独有可同步文字。媒体、空目录、凭据、设置、Skill/MCP/Provider/Session 和 `.raw/.sync` 不处理。
- 实施：`src/services/projectTextSync.ts` 移除文件变化监听、待上传队列合并和冲突副本，复用现有 `pullFiles/pushFiles` 完整快照；项目中心增加两个明确按钮和覆盖确认，设置页改为只读状态；旧实现记录保留为历史并在 SDD 标注已被替代。
- 验证：方向性同步与界面定向 `52/52`；完整 focused `1438 passed / 8 skipped / 0 failed`；`vue-tsc -b` 通过；`pnpm run build:quick` 与 Web 产物审计通过；`git diff --check` 通过。真实 Web/Desktop/iPhone 覆盖删除人工矩阵待验收。

## [2026-08-04] 正式发布 | v2.1.9

- 发布提交 `f302c251` 已推送 `main`，`v2.1.9` tag 已推送；版本已统一为 `2.1.9`。
- `pnpm run build` 通过：focused Node `1438 passed / 8 skipped`、Rust `403 passed / 1 ignored`、TypeScript、Web 构建和产物审计成功。Cloudflare Pages Production 已部署至 `https://b45e2960.jiucaihezi.pages.dev`；正式域名返回 HTTP 200 并加载 `assets/index-C0PmvFme-jc20260610b.js`。
- GitHub Actions `30904082094` 成功完成 macOS ARM、macOS Intel、Windows x64 和发布清单；GitHub Release `v2.1.9` 已公开，生产 `latest.json` 返回 `2.1.9` 及三种桌面更新地址。iOS App Store 与 Android 商店公开状态未改变。

## [2026-08-04] 架构决策 | 记忆工作台单产品化边界与同步合同收口

- 用户确认唯一规则：记忆工作台当前拥有的全部功能保留，当前没有的功能迁出；OpenCode、旧 Studio、文/武/道/创、电商、漫剧和制作工作台属于迁出范围。
- 新增 [[开发/通用记忆工作台单产品化分离SDD]]，共享模块按记忆入口实际依赖闭包归属；Desktop/Mobile Bundle ID、Deep Link、Web/Gateway、更新通道、数据目录、账号和云项目绑定不得改变。`v2.1.9` / `f302c251` 为回滚基线。
- 现行同步只保留项目中心的 `上传并覆盖云端` 与 `下载并覆盖本地`；不合并、不创建冲突副本、不自动同步，媒体、空目录、凭据、设置和 `.raw/.sync` 不处理。设置页只显示状态。本轮未移动或删除代码和目录。
- [修复回执] [[开发/制作工作台零隐式上下文SDD]] 的不存在链接 `[[开发/电商工作台无上下文单次运行SDD]]` 已改指现存唯一目标 `[[开发/电商工作台绝对独立SDD]]`；文件指纹 `c0a627ca0197 -> 0a4085108df5`，旧值剩余 0。
- Wiki 状态查询根因已修复：应用内 `wikiRuntime` 与随包 `wiki_query.py` 原先都读取 append-only `log.md` 的第一条标题，现统一从末尾读取最新标题。TDD 红灯双端复现后，应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 和 TypeScript 均通过；真实状态输出已指向本条 2026-08-04 决策。

## [2026-08-04] SDD | 单产品化目录清单

- [[开发/通用记忆工作台单产品化分离SDD]] 新增目录级“保留、移出、禁止删除”清单，并区分整目录、混合目录和仍被记忆入口依赖的迁出阻塞项。
- 确认 `runtime/workbench` 的媒体计划、`public/skills/`、Gateway、文档/媒体服务、发布身份和用户项目数据属于记忆工作台；漫剧工作台迁出不等于删除记忆工作台可调用的漫剧 Skill。
- `src/opencodeClient/` 最终必须迁出，但当前仍被 `agentStore`、创作面板和全局搜索间接依赖；执行顺序固定为先用 TDD 完成等价替换，再迁出 TypeScript/Rust/SDK/脚本。本轮未移动或删除任何文件。
- [修复回执] SDD 已取消不可执行的跨仓库 `git mv`，改为先验证 `f302c251` 独立备份再在主仓分批删除；移动端身份明确为 iOS `com.jiucaihezi.mobile`，Android 暂停且 `src-tauri/gen/` 不作为 Git 回滚或身份验证证据。

## [2026-08-05] 开发收尾 | 记忆工作台单产品化分离实施

- 四组 TDD 已完成：模型目录改用 Gateway；创作面板解除 OpenCode session/owner；全局搜索改为 Raw 对话；Rust 移除 OpenCode Runtime、命令和二进制发现。
- 旧 Studio、OpenCode、文/武/道/创、电商、制作、漫剧工作台产品代码与专属发布物已从主仓迁出；Raw、Wiki、媒体、同步、身份、Gateway、云绑定、更新与发布链路保留。独立备份仓库 `../jiucaihezi-legacy-products/` 固定于 `f302c251` 并通过完整性检查。
- 自动验证通过：分离门禁 `5/5`、Node `985/985`、Rust `395 passed / 1 ignored`、TypeScript、Web/Desktop quick build和两端产物审计。证据指纹依次为 `7d1c33ff370d`、`372d120b0593`、`acd2fc7fee37`。
- 未验证：真实 Windows、Intel Mac、iOS 升级与云绑定连续性；Android 按既定决策暂停。`jc-raw-wiki closeout` 因删除的 PDF/PPTX 二进制 diff 触发 UTF-8 解码错误，Wiki validate 独立执行。

## [2026-08-05] 修正 | 单产品分离第二轮 Wiki 与随包 Skill 一致性

- README、AGENTS 和工作区配置已收口为通用记忆工作台；旧 Studio/OpenCode 架构页、模式 Canvas 和旧存储 SDD 完整移入 [[归档/单产品分离前/README]]，不再充当现行入口。
- `jc-everything-wiki` 与 `jc-raw-wiki` 的对话来源统一为当前项目 `.raw/对话记录/*.md`，Markdown 是唯一持久化真源；旧 Studio/OpenCode `ses_*` 来源模板已移除。
- 修正当前记忆审批 SDD、Wiki Skill 规范、生存手册、来源索引、发布边界和移动身份措辞；详见 [[巡检报告/2026-08-05-单产品分离第二轮Wiki一致性巡检]]。
- 自动复检：单产品分离门禁 10/10、Wiki Skill 18/18、Wiki 建库脚本 7/7、完整 focused 969/969、Rust `395 passed / 1 ignored`、TypeScript、Gateway 36/36、Wiki validate、Web/Desktop quick build 与两端产物审计全部通过。
- Gateway 同步收口：根路径测试对齐现行账号登录跳转；删除无生产调用者、且与登录/同步专用边界冲突的旧 `/api/*` 同源代理。本轮未推送、未发布。
- 最后一份 Tiptap smoke 试验说明已删除，历史 TDD 继续留在归档；分离门禁覆盖整个旧 smoke 目录。
- 并发审计补强：动态图标扫描恢复播放图标；Web/Desktop 递归清理并拒绝 Python 缓存；删除无调用的 `lowlight` 和孤立旧测试说明。现行 Wiki 断链为 0，追加日志与历史巡检断链只记归档卫生；15 条孤儿页建议保留。

## [2026-08-05] 开发收尾 | 产品内置 Skill 收口为 7 项

- TDD 锁定 App 只随包提供 `jc-cha-wiki`、`jc-everything-wiki`、`jc-jian-wiki`、`jc-new-user-guide`、`jc-raw-wiki`、`jc-xiu-wiki` 和 `skill-creator`。
- 20 个个人写作、视觉、旁白 Skill 先逐字迁入 `/Users/by3/Documents/jiucaihezi-personal-skills` 并提交为 `863a738`，再从 App 删除；原 `/Users/by3/.agents/skills/` 未修改。
- 产品侧删除旧推荐指令总表、个人创作模板和无人调用的一次性迁移配置；Skill 卡片只读取当前 Skill 包自己的 `commands`。旧客服自动上传草案与个人媒体 Skill 方案移入单产品分离前归档。
- 验证通过：分离门禁 `11/11`、Node `970/970`、Rust `395 passed / 1 ignored`、Wiki Skill `20/20`、建库脚本 `7/7`、Gateway `36/36`、TypeScript、Wiki validate、Web/Desktop quick build 与两端产物审计；最终产物只有 7 个产品 Skill。Wiki 深层巡检现行必修 `0`、重要 `0`、断链 `0`。
- [修复回执] 依据用户确认的 7/20 清单修正现行边界：分离 SDD `69f6144b0434 -> 9e58f1265b19`，`hot.md` `9c4be1a65a78 -> eae4eac42691`，来源索引 `65a606f0ced1 -> 6785e6530237`，第二轮巡检报告 `e6df640d314f -> fc19627a7fb5`。本轮未推送、未发布、未改版本号。

## [2026-08-05] 开发收尾 | 通用文件附件原生优先与 Markdown 降级

- 附件合同已收口为“保存原件 -> 原生文件优先 -> 明确不支持时 Markdown/OCR 降级 -> 两者都失败则明确报错”；App 不再限制模型只能读取 Markdown。
- 单个原生 data URL 上限为 32 MiB；Office/PDF/其他文档在可用时同时保留原件与 `textContent`，媒体仍走原有原生媒体 part；生产 NewAPI MIME 能力只由 Gateway/Provider 适配器决定。
- 自动验证：完整 `pnpm run build` 通过，包含 focused Node `974/974`、Rust `395 passed / 1 ignored`、TypeScript、Web 构建与产物审计；构建日志指纹 `sha256:88d767bf7043`。真实付费文件请求和跨端人工矩阵仍未验证，不能写成已发布。

## [2026-08-05] 决策修正 | 附件表示按需解析第一阶段

- 用户确认当前只实施第一阶段：原件作为唯一真源，上传不提前生成 Markdown，发送时原生表示优先，原生明确不可用时才按需生成并缓存 Markdown/OCR。
- 第二阶段的 NewAPI `unsupported_input` 统一错误码、Provider 能力探测、文件句柄和大文件通道，第三阶段的分页读取、结构化抽取、索引和 RAG 均暂不建设，等待真实使用数据。
- 同步修正通用记忆工作台 TDD、核心 SDD、`hot.md` 和来源索引；当前 TDD 保持 RED，上一轮请求层 native-first 改动不代表上传合同已完成。

## [2026-08-05] 决策修正 | Markdown-first 作为跨 Provider 文档表示

- 用户确认记忆工作台不应把 NewAPI 或任何 Provider 的原生附件能力作为主链路；DOCX/PDF/XLSX/PPTX 默认使用按需生成并缓存的 Markdown/结构化文本表示。
- 原件仍是唯一事实来源；原生文档附件只作为视觉、复杂版式等场景的可选增强。更换 NewAPI 或后端时，Markdown 主链路不变。
- 第一阶段只实施上述稳定边界；NewAPI 原生文件错误码、文件句柄、大文件通道、分页读取、结构化抽取、索引和 RAG 延后到真实数据证明必要时再做。

## [2026-08-05] 决策确认 | 附件沿用 Markdown 主链路

- 用户确认当前产品逻辑已满足后端无关诉求：Office/PDF/XLSX/PPTX 保存原件、生成 Markdown 并将 Markdown 发送给 NewAPI；本轮不改附件链路。
- 本轮唯一代码修复是记忆系统提示读取 canonical `wiki/CLAUDE.md`，忽略项目根部旧 `CLAUDE.md`；已有根部文件不迁移、不删除、不覆盖。

## [2026-08-05] 决策修正 | Everything Wiki 不再负责完整建库

- 原“知识库建库与企业 Schema”草案已被 [[开发/通用记忆工作台基础README与EverythingWiki按需规划TDD]] 取代；generic 基础骨架由 App 初始化，业务结构按用户确认后扩展。
- 旧 `jc-everything-wiki` 的 Reference 与 scaffold 已移到工作区外备份；Raw 所需项目语境归 `jc-raw-wiki` 持有。

## [2026-08-05] 开发收尾 | 基础 README 与 Everything Wiki 按需规划

- generic 记忆空间新增 `wiki/README.md`，解释 `wiki/` 入口和 `.raw/jc-media/` 原件目录；`对话记录`、`.sync`、`jc-canvas` 仅标为系统管理目录。
- `jc-everything-wiki` 改为对话式 Wiki 架构规划：读取现状、理解目标、提出最小方案、用户确认后用 `extend`/`link` 执行；不再创建完整业务模板。
- 旧 Everything Skill 的 Reference 与 scaffold 脚本已备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-everything-wiki-2026-08-05`；项目语境 Reference 迁入 `jc-raw-wiki/references/项目语境/`，避免 Raw 填充断链。

## [2026-08-05] 决策修正 | Obsidian 兼容最小 Wiki 骨架

- 对照 Obsidian 官方 Help 确认 Vault、Markdown、目录和内部链接均按需存在，官方没有“每次必读文件”；generic 新建记忆空间因此只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`。
- App 不创建 README、CLAUDE 或任何替代性的强制读取页，记忆请求不自动注入 Wiki 页面；已有用户文件不迁移、不删除、不覆盖。
- `jc-everything-wiki` 只在现有 Wiki 上规划最小目录结构；`index.md` 导航顶层分类，各目录 `_index.md` 说明用途并导航直属子目录。

## [2026-08-05] TDD | Raw Wiki 精准沉淀

- 审计确认 `jc-raw-wiki` 当前把内容沉淀、项目类型模板、Canvas、Bases、开发收尾和全 Raw 盘点混在一个 Skill；这与已修正的 Everything Wiki 属于同类过度设计。
- 新 TDD 将唯一职责固定为：把用户明确指定范围内的已确认、可复用信息增量写入现有 Wiki，并登记真实来源；不自动扫描全部 Raw，不设计目录，不生成派生视图。
- 本轮只写 TDD，尚未修改 Skill；实施时先备份旧包、补红灯测试，再删除旧 Reference 和脚本。

## [2026-08-05] 开发收尾 | Raw Wiki 精准沉淀

- `jc-raw-wiki` 已收缩为只处理用户指定来源和本轮确认内容的增量沉淀 Skill；不再默认扫描 Raw、识别行业类型、设计目录或执行开发收尾。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-raw-wiki-2026-08-05/` 后，17 份 Reference、`digest_raw.py` 与旧专项测试已移出产品包。
- 关系图、标准 `.canvas` 和统计归 `jc-cha-wiki`；统计保存为 Markdown，`.base` 等 App 支持解析和显示后再实现。
- 验证通过：旧实现红灯 `5/5`、新合同 `5/5`、Wiki Skill `26/26`、分离门禁 `11/11`、Skill Creator 校验、完整 focused、Rust `395 passed / 1 ignored`、TypeScript及两项独立模型前向检查。

## [2026-08-05] TDD | Cha Wiki 精准检索

- 对照 Obsidian 官方 Search、Graph、Backlinks 与当前原生 Wiki 工具，确认 Cha Wiki 的核心是“问题 -> 多词召回 -> 读取原页 -> 证据回答”，不是固定必读页、开发目录排序、状态计数或固定四段模板。
- 当前随包 Python 查询器与 App 原生工具重复；原生 `graph` 还会扫描全库并覆盖固定 `关系图.canvas`，与现行局部项目地图合同冲突。
- 新 TDD 保留查询、统计和显式派生视图；Canvas 收紧为用户指定主题的局部可点击文件图并保护既有布局。RAG、向量库、BM25、Bases 和自动回写答案本轮不建设。
- 本轮只写 TDD 和修正现行文档入口，尚未修改 `jc-cha-wiki`、查询脚本、原生 Wiki 工具或测试。

## [2026-08-05] 开发收尾 | Cha Wiki 精准检索

- `jc-cha-wiki` 已收缩为“短词多轮召回 -> 读取原页 -> 必要关联核对 -> 带来源回答”的只读查询 Skill；不再绑定固定必读页、开发目录、查询模式或固定四段回答。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-cha-wiki-2026-08-05/` 后，3 份 Reference、Python 查询器及缓存已移出产品包。
- 原生关系图必须提供种子页面，默认一层、最多两层，生成可点击 `file` 节点；已有 Canvas 默认只预览，确认更新后保留无关节点和既有坐标。
- 红灯已确认：旧 Skill 合同 `5/5`、旧 Canvas 合同 `3/3`；绿色验证：Cha 专项 `5/5`、Wiki Skill `28/28`、原生 Wiki 运行时 `15/15`、Skill Creator 校验。完整 focused、TypeScript 与最终门禁结果见本条后续验证回执。
- 四类真实模型前向检查未完成：Claude CLI 只读调用出现预算超限或无输出超时，未将其记作通过；需在可用模型环境复跑单页事实、同义词跨页、冲突和无答案用例。

## [2026-08-05] TDD | Jian Wiki 精准巡检

- 审计确认 `jc-jian-wiki` 当前把通用 Wiki 健康检查、语义一致性、换皮漏改、映射撞车、时代穿帮、伏笔回收和 Python/Node 运行时混在一个 Skill；其中个人创作规则不属于通用记忆工作台。
- 新 TDD 将唯一职责固定为：只读检查机械完整性和用户指定主题的语义一致性，并给出可追溯的问题证据；默认只在对话报告，显式要求时才保存 Markdown 派生报告。
- 原生 `audit` 将区分导航断链、普通未解析链接、同名歧义、孤儿候选和历史卫生；删除“目录文件数失衡就是架构问题”的误报规则。RAG、Embedding、Dataview、定时任务和自动修复本轮不建设。
- 本轮只写 TDD 和修正现行文档入口，尚未修改 `jc-jian-wiki`、原生 `audit`、旧脚本、构建逻辑、新手指南或测试。

## [2026-08-05] 开发收尾 | Jian Wiki 精准只读巡检

- `jc-jian-wiki` 已收缩为“机械完整性 + 用户指定主题语义一致性”的只读巡检 Skill；默认在对话报告，只有显式要求时才保存 Markdown 派生报告。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-jian-wiki-2026-08-05/`；Reference、Python/Node 扫描器、缓存和专用构建步骤不再随 App 分发。无人引用的旧个人预设迁到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/source/kbCommandPresets-2026-08-05.ts`。
- 原生 `wiki audit` 已支持 `evidencePaths`，并区分导航断链、同名歧义、普通未解析链接、孤儿候选和历史卫生；`log.md` 按历史流水处理，目录数量不再作为架构错误。
- 红灯确认：Jian Skill 合同 `8/8`、原生新增场景 `3/3` 均在旧实现失败。绿色验证：Skill Creator、Wiki Skill `30/30`、原生 Wiki `17/17`、分离门禁 `11/11`、完整 focused、Rust `395 passed / 1 ignored`、TypeScript。四类独立模型前向检查仍留作发布前人工验收，本轮未提交、未推送、未发布。

## [2026-08-05] TDD | Xiu Wiki 精准修正

- 审计确认 `jc-xiu-wiki` 当前把确定性改错、架构扩展、巡检报告回写、日志留痕和个人创作规则混在一个 Skill；随包 Python 修正器还与 App 原生 Wiki 工具重复。
- 新 TDD 将唯一职责固定为：对一个明确 Wiki Markdown 文件中的唯一旧值，按用户或可靠证据已经确认的新值执行“预览 -> 批准 -> 精确替换 -> 重读验证”。
- 原生 `replace` 将强制单文件范围，多命中默认拒绝并要求显式 `replaceAll`；只会向文末追加裸链接的 `link` action 删除。目录规划与 `extend` 归 Everything，新事实归 Raw，复检归 Jian。
- Obsidian 的重命名自动更新内部链接、废纸篓和 File recovery 被记录为独立文件生命周期差距，本轮不冒充 Xiu 已具备。本轮只写 TDD 和修正现行文档入口，尚未修改 Skill、原生修正工具、旧脚本、新手指南或测试。

## [2026-08-05] 开发收尾 | Xiu Wiki 精准修正已实施

- 原 `jc-xiu-wiki` 已完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-xiu-wiki-2026-08-05/`；产品包现在只保留标准 `SKILL.md`。
- 已删除随包 Reference、`apply_fix.py` 和 Python 缓存；新 Skill 只声明“一个明确 Markdown 文件 + 唯一旧值/新值 + 依据”的预览、批准、精确替换和重读验证合同。
- 原生 `wiki replace` 已拒绝无路径、Wiki 外路径、非 Markdown 文件；单文件多命中默认拒绝，显式 `replaceAll: true` 才允许全部替换，并返回行号、指纹和验证结果。
- 原生 `link` 已从工具合同、参数解析、审批策略和运行时删除；断链修正统一使用 scoped `replace`，目录扩展继续由 Everything 使用 `extend`。
- 红灯先在旧实现失败；当前 Skill 契约 `32/32`、focused `978/978` 已通过。TypeScript、Rust 和最终 diff 门禁待本轮最后验证。

## [2026-08-05] 验证回执 | Xiu Wiki 精准修正

- Skill Creator 校验通过；Wiki Skill 契约 `32/32`、focused `978/978`、TypeScript 和 Rust `395 passed / 1 ignored` 全部通过。
- `git diff --check` 通过。Xiu 实施完成；本轮未提交、未推送、未发布。

## [2026-08-05] 最终门禁 | Xiu Wiki 精准修正

- 补齐工具 Schema 不暴露 `link/target`、缺少 `reason/basis` 拒绝和新手指南职责测试后，最终结果为 Skill 契约 `34/34`、focused `980/980`、TypeScript、Rust `395 passed / 1 ignored`、`git diff --check` 全部通过。

## [2026-08-06] 开发收尾 | Raw、Cha、Jian 证据链与可信检索

- 原生 Wiki 工具新增只读 `evidence`，Web 与 Desktop 按项目文件原始字节计算完整 SHA-256；generic 来源索引使用空六列表，`audit` 能检查来源一致、变化、丢失、无法验证和登记不完整。
- `jc-raw-wiki` 在正文写入成功后登记证据，`jc-cha-wiki` 回答重要项目事实时展示 Wiki 章节和已登记原始来源，`jc-jian-wiki` 复用原生审计且不自动判错或改写。
- 红灯先确认旧实现缺少上述合同；绿色验证为相关原生/Web/Desktop/审批 `57/57`、Wiki Skill `38/38`、完整 focused `986/986`、Rust `395 passed / 1 ignored`、TypeScript、Web/Desktop quick build、两端产物审计与 `git diff --check`。
- 五类脱敏用例已建立，独立模型前向验收尚未执行，不记为通过。本轮未增加 RAG、向量库、BM25、新依赖或遥测，未提交、未推送、未发布。

## [2026-08-06] 产品决策 | 媒体与 3D 继续保留

- 用户最终撤销媒体与 3D 迁出决定；图片、视频、音频、`.jccanvas`、`.jcscene`、GLB/GLTF 和 Desktop 动画导出继续属于韭菜盒子现有能力闭包。
- 原迁出 SDD/TDD 在实施前停止，短视频工厂未被修改，韭菜盒子没有迁出提交、源端删除或迁移发布。两份文档已收口为不可执行的撤销记录。
- 性能方向固定为按需加载、卸载和减少非活动资源；不得降低最终画质、删除功能或限制高性能设备正常并发。后续性能实现必须另写 TDD。

## [2026-08-06] 稳定性修复 | 媒体任务等待 SQLite 初始化

- 真实 Desktop 启动复现 `MemoryWorkbench mounted -> mediaTaskStore.init -> loadTasks -> SQLite storage is not ready`，证明共享 Store 仍会与后台 `initDB()` 竞态。
- TDD 先暂停存储初始化，确认数据库放行前任务历史读取次数为 0，放行后只读取 1 次；随后让 `initDB()` 并发调用复用同一个 Promise，并让媒体 Store 在读历史前等待该 Promise。
- 媒体任务专项 `46/46`、完整 focused、TypeScript、Desktop quick build、产物审计和 `git diff --check` 通过。两次干净启动中 SQLite 约 5.1 秒、4.9 秒完成，均未再出现 mounted-hook 未处理异常。
- 此前中断的 Grok Video 任务按已保存 `pollUrl` 自动恢复并最终 `success 100%`；Veo 3.1 与 Fast 仍在提交阶段返回真实 `404 fail_to_fetch_task`，本轮没有修改或宣称修复其 NewAPI/上游链路。

## [2026-08-07] 修复 | 附件图标与 Windows 启动合同

- 根因：图标离线扫描器只匹配下划线名称，漏掉输入框使用的 `attach-file`；Windows 发布仅生成便携 ZIP，未提供处理 WebView2 的安装入口。OpenCode 不是运行依赖。
- 修复：扫描器及覆盖测试支持连字符并重新生成 `icons-bundle.json`；Windows CI 同时构建 NSIS 安装器和便携 ZIP，安装器使用可见 `downloadBootstrapper` 引导 WebView2。
- 验证：Windows 发布合同测试、完整 focused `986/986`、Rust `395 passed / 1 ignored`、TypeScript 与 `git diff --check` 通过。
- 未验证：当前环境没有 Windows 真机，缺少 WebView2 的安装、首次启动和升级仍需人工验收；因此本条不记作 Windows 真机通过。

## [2026-08-07] 功能 | 3D 手动运镜录制

- 根因：3D 编辑器已有 OrbitControls 和 Canvas/FFmpeg 录制链路，但界面录制入口只支持自动时间线，没有手动录制入口。
- 实施：新增开始/停止按钮；录制时隐藏网格和变换控件，保留旋转、平移、推进、拉远；停止后交给现有 `dev_export_scene_video` 保存 MP4。
- 验证：合同测试 `49/49`、TypeScript、图标检查和 `git diff --check` 通过；真实 Desktop 手动操作与成片播放待人工验收。

## [2026-08-07] 功能 | 3D 白膜对话增量编辑

- 决策：`.jcscene` 继续作为 `.raw/jc-media/文档/` 中的源工程；图片和视频只是导出结果，不与源文件混放。
- 实施：Desktop 新增 `edit_3d_scene` 原子操作，支持新增对象/排列、移动、删除和调整镜头；整批操作先校验后一次写回，失败不改变原文件。场景预览下方增加当前场景输入框，发送后自动重读并刷新；Web 保持现有只查看边界。
- 边界：普通修改不重建、不增加第二套聊天；只有明确“重做/重新生成”才使用 `create_3d_scene` 覆盖；本阶段只做白模基础。
- 验证：3D 增量编辑专项 `81/81`、TypeScript 通过；完整 focused 和真实 Desktop 对话修改待最终验收。

## [2026-08-07] 发布准备 | Windows 上传与 OTA 合同收口

- Windows GitHub Release 上传步骤不再依赖前一步的 PowerShell 局部变量，当前步骤重新声明并校验 NSIS 与便携 ZIP 路径。
- 旧 OTA 的 RSA 公钥、OpenSSL 签名和 Tauri 2 minisign 验签合同不兼容；在没有新的生产 signer 密钥前，配置与发布清单任务暂时关闭，安装包继续通过 GitHub Release/官网分发。
- 3D 非人物标签默认隐藏，人物及人物编队保留标签；吸附按钮改用现有 `sync` 图标，场景修改发送后恢复主输入框草稿。
- 自动验证：发布合同 `12/12`、TypeScript、完整 focused、Rust `395 passed / 1 ignored` 与 `git diff --check` 通过；真实 Windows NSIS 安装启动、Web/桌面正式构建和发布尚未执行。

## [2026-08-07] 紧急修复 | v2.1.11 Desktop 启动 panic

- 真实发布结果：macOS ARM/Intel 构建后启动冒烟均在 `PluginInitialization("updater")` 失败；Windows job 因只检查包内容而显示绿色，但用户双击 EXE 同样无法启动。
- 根因：`plugins.updater` 配置已删除，Rust Builder 仍注册 `tauri-plugin-updater`，插件反序列化空配置时在窗口创建前 panic；不是 WebView2 或 OpenCode 依赖问题。
- 修复：删除 Rust updater 注册、Cargo/npm updater 依赖和无人调用的 `useUpdater.ts`；Windows CI 在打包前启动 release EXE 并要求存活 15 秒，提前退出时打印 stderr 并阻断发布。
- 验证：红灯合同先复现 updater 注册和 Windows 启动门禁缺失；完整 focused `1002/1002`、Rust `395 passed / 1 ignored`、TypeScript 与 `git diff --check` 通过。本机 aarch64 macOS 生产 release 已成功构建并真实启动存活 15 秒；真实 Windows 修复包待新版本发布后验收。

## [2026-08-07] v2.1.13 发布链路修复

- 根因：下载页使用 `api.jiucaihezi.studio/updates/latest.json`，而该文件由已停用的 OTA `publish-manifest` 任务生成，因此仍停在 `2.1.10`；同时三个 Tauri job 并发尝试创建同一个 GitHub Release，ARM 任务在创建 Release 时收到 `Resource not accessible by integration`。
- 修复：新增 `prepare-release` 单一预创建任务；三平台只上传资产，不再自行创建 Release；新增独立 `publish-download-manifest`，从 GitHub Release 下载并上传资产，生成不含 updater 签名的公开下载清单；支持 `workflow_dispatch` 的 `publish_tag` 对既有 tag 补发清单。
- 红灯/绿灯：发布合同先失败后通过；YAML、`git diff --check`、完整 focused `1002/1002`、Rust `395 passed / 1 ignored` 通过。v2.1.12 ARM 重跑已成功并补齐 GitHub Release 资产；根因修复作为 v2.1.13 走正常 tag 发布，不覆盖旧 tag，也不采用一次性清单补发作为正式方案。

## [2026-08-07] 产品收缩 | Jina 网页工具迁出

- 用户确认 Desktop 是核心平台，Web 与 Mobile 不需要为网页读取或搜索保留 Jina 辅助链路；Desktop 继续使用需审批的本机 Terminal 联网。
- `web_search`、`read_url`、输入框 `@联网搜索`、前端实现和 `jina-adapter` 已从主仓迁出，原实现备份于 `/Users/by3/Documents/jiucaihezi-jina-backup`；普通聊天、Wiki、文件、MCP、媒体和 3D 不受影响。
- 当前无法登录生产服务器，旧容器和 NewAPI 渠道只记录为待核验下线，未写成已经停止。

## [2026-08-07] 功能 | 官方 Playwright MCP 零内置接入

- 内置 MCP 目录增加固定版本 `@playwright/mcp@0.0.79`；Desktop 点击连接后复用现有 `npx` stdio、工具发现和 MCP Bridge，不新增依赖或浏览器引擎。
- 缺少 Node/npx 时显示真实错误、Node.js 官方下载入口和重新检测按钮；Windows 补齐 `npx.cmd` 常见路径解析及 `cmd.exe /C` 启动。
- Web 与 Mobile 保持不能运行本地 stdio MCP 的边界；Playwright 作为高权限扩展，只有用户主动连接后才向模型暴露完整官方工具。
- TDD 先确认目录项、一键连接、安装引导和 Windows 命令入口合同缺失；专项合同 `6/6`、完整 focused、TypeScript、Rust `396 passed / 1 ignored`、Desktop 生产构建与产物审计已通过。macOS Desktop 已确认卡片与高权限标识正确，官方 MCP 命令可启动；真实点击连接及 Windows 安装后重连仍待人工验收。

## [2026-08-08] 修复 | Playwright MCP 点击无反应

- 根因一：Tauri 开发页是远程 URL，原能力地址没有使用 URLPattern 路径通配符，IPC 与外链打开均未得到开发环境权限。根因二：只声明 3 个 MCP 自定义命令会触发 Tauri 对全部应用命令的 ACL 检查，造成文件、Skill、密钥等既有命令被拦截。
- 修复：开发能力改为 `http://localhost:1420/*`；新增 `allow-app-commands`，与 `generate_handler!` 当前 147 个 Rust 命令全量一致；合同测试逐项比较两份清单。`Plugin not found` 不再误判为缺少 Node，下载按钮复用统一外链打开。
- 验证：MCP 专项 `7/7`、完整 focused、Rust `396 passed / 1 ignored`、TypeScript、Desktop quick build 与产物审计通过；开发启动日志已无 `not allowed`，`npx -y @playwright/mcp@0.0.79 --help` 真实成功，用户已确认最新开发版点击连接成功。包含修复的新版本和干净外部电脑安装链仍待验收。

## [2026-08-08] 经验沉淀 | Windows 窗口不可见与 MCP 依赖诊断

- Windows 启动问题通过“绝对 EXE 路径 + stderr + 进程存活”确认程序主体可运行，再通过改名 App 数据目录确认是持久化状态；真实失败状态包含零尺寸和 `-32000` 坐标。共同读写入口已拒绝无效状态，用户随后确认桌面和开始菜单可正常打开。
- MCP 问题必须先区分权限错误与依赖缺失：`Plugin not found` 不能引导安装 Node；只有真实找不到 `npx` 才显示下载和重试。Tauri 应用自定义 ACL 不能只登记新增命令，必须与全部 `generate_handler!` 注册命令保持一致。

## [2026-08-08] 运维验证 | 火山方舟豆包渠道

- 用户确认 NewAPI 中必须选择“火山方舟”渠道类型；使用 OpenAI 渠道会把请求错误拼成 `/v1/chat/completions`，不适用于豆包媒体/音频模型。
- 方舟渠道配置已由用户实测成功；模型列表包含 `doubao-seed-2-1-turbo-260628`、`doubao-seed-evolving`、`doubao-seed-2-1-pro-260628`、`seed-audio-1.0`。API Key 内容不写入 Wiki。

## [2026-08-09] 稳定性修复与经验沉淀 | 模型请求中断恢复

- 根因不是单一“网络不稳定”：旧链路没有当前模型请求重试；浏览器与 Tauri/reqwest 的网络错误文本不同；失败落盘、项目切换和可编辑 composer 之间还存在错误分类与竞态。
- 最小修复只重试当前模型请求两次，退避 `2 秒、4 秒`；仅把明确的请求或流中断写入 Markdown/Raw 恢复点。Raw 追加按 `userTurn.id` 幂等，旧 generation 不能更新新项目状态，发送期间锁定输入、附件、引用、Skill 和执行模式。
- Markdown 恢复点不冒充完整工具 checkpoint：它保存原任务、已有正文和风险提示，继续前必须检查项目现状，避免重复写入或外部操作。客户端取消也不宣称能终止已经进入 Tauri/Rust 或上游的请求。
- 经验已增量写入 [[学习/AI编程生存手册#34 失败恢复不是只加重试]]，具体合同保留在 [[开发/通用记忆工作台稳定性修复与Markdown体验升级SDD#3.6.1 网络中断恢复合同]]。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和 `git diff --check` 通过；真实 NewAPI/Cloudflare 三端故障注入未执行。

## [2026-08-09] 运维核对 | Seed Audio 1.0 与现有适配器

- 用户使用火山语音专用 Key 直连 `openspeech.bytedance.com/api/v3/tts/create` 成功，返回约 5.9 秒 MP3；方舟 Key 与语音 Key 不通用。
- 生产 NewAPI `rc.20` 仍按旧火山 TTS `appid|access_token` 合同，官方仓库没有 `seed-audio-1.0` 原生 HTTP JSON 适配；官方 PR `#4710` 尚未合并且面向 `seed-tts-*` 流式协议。本项暂缓，不修改生产。
- 核对确认现有两套媒体适配器为 `rh-adapter`（RunningHub 图片/视频/音频）与 `zx-video-adapter`（ZX Grok 固定时长视频）；支付 `jiucai-adapter` 和已迁出的旧 `jina-adapter` 不计入媒体适配器。
- 新增独立 `seed-audio-adapter/`，只实现已验证的文本生成主链路：OpenAI `input` 转 `text_prompt`，火山语音 Key 转 `X-Api-Key`，Base64 响应解码为原始音频。单元测试、Python 编译与 Compose 解析通过；本机 Docker daemon 未启动，镜像构建及生产部署未执行。
- NewAPI `rc.22` 起后台认证合同与数据库表发生迁移，当前 Gateway 浏览器 Cookie 登录/一键 Key 链路尚未适配；生产不能直接从 `rc.20` 拉取 `latest(rc.24)`。运维页已记录备份、镜像回滚和最低验收步骤。

## [2026-08-09] 修复 | Seed Audio 适配器上线阻断

- 适配器改为从豆包真实响应的 `data.audio` 读取 Base64 音频；回归测试同步使用嵌套真实响应形状，避免错误的顶层 `audio` Mock 掩盖故障。
- NewAPI `rc.20` 部署合同改为 OpenAI 渠道 + `http://seed-audio-adapter:8791`；不使用会把 Base URL 当完整请求地址的 Custom Channel。
- 单元测试 `1/1`、Python 编译、Compose 配置解析和 `git diff --check` 通过；Docker 镜像构建、生产部署及付费闭环尚未执行。

## [2026-08-09] 生产验收 | Seed Audio 1.0 渠道 66

- 提交 `25851e66` 已推送并由用户部署到服务器 `/opt/seed-audio-adapter/`；Docker 镜像构建和容器启动成功，健康检查返回 `seed-audio-1.0`。
- 经 `https://api.jiucaihezi.studio/v1/audio/speech` 的真实 NewAPI 用户 Token 调用返回 `HTTP 200 | audio/mpeg`；输出文件被识别为 24 kHz、64 kbps、Stereo 的有效 MP3，约 34 KB。
- 渠道 66 的 `seed-audio-1.0` 已完成 NewAPI 鉴权/计费、内网适配、豆包上游与音频返回的端到端闭环。NewAPI 仍保持 `rc.20`，不进行升级。

## [2026-08-09] 生产验收 | Seed Audio 参考音频

- 适配器提交 `d1773603` 已部署到 `/opt/seed-audio-adapter/`，容器启动正常。
- 复用 `/tmp/seed-audio-newapi.mp3`，经 NewAPI 渠道 66 将 Base64 放入 `metadata.audio_data`，真实请求返回 `HTTP 200 | audio/mpeg`。
- 输出 `/tmp/seed-audio-reference-test.mp3` 为有效 MP3（24 kHz、64 kbps、Stereo，约 27 KB），确认参考音频链路已打通。

## [2026-08-09] 修复 | 记忆模式中断续写工具调用

- 根因：Direct Runtime 在流式正文中断后自动追加“不要调用工具”，同时移除续写请求的工具定义；第一轮修复恢复工具定义后，审计又发现续写解析没有接收和执行工具调用。
- 修复：记忆模式系统合同明确对话文字不关闭工具权限；中断续写保留完整工具池，续写阶段的工具调用复用原有审批、执行、失败保护和结果回传循环。快速模式及其他调用者保持原行为。
- 提交 `055d8e8c`；完整 focused `1021/1021`、TypeScript 与 `git diff --check` 通过。真实上游中断和三端人工验收未执行。

## [2026-08-10] 生产验收 | Seed Audio 创作面板与按 Token 计费

- 创作面板新增并注册 `seed-audio-1.0`，用户可见名称为 `豆包音频生成1.0`，前端价格保持 `1.2元/分钟`；提示词、最多 3 段参考音频、画布音频选择、任务历史和 JC Media 音频保存链路均已接通。
- 真实测试确认画布选择的音频被提交为 Seed Audio 参考音，返回有效 MP3；完整前端 focused 测试 `1027/1027`、TypeScript 和 `git diff --check` 通过。
- NewAPI 模型定价改为“按 Token”：普通输入、补全和音频输入均填写 `1` 美元/1M Token，音频输出填写 `1000` 美元/1M Token。后台表单要求这些输入项先启用并填写后才能保存音频输出价格；`1000` 对应约 `1000` 音频 Token/分钟，不是单次收费。实测约 `1183` 输出 Token 按约 `$1.183` 基础价，再叠加分组和会员倍率正常扣费。

## [2026-08-10] 未解决排障 | iPhone 下载并覆盖本地无响应

- 新增 [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]，记录 `2.1.17` 开发签名版真实 iPhone 13 Pro Max 点击云端项目并确认下载后无可见结果。
- 多轮局部修改包括删除重复下载按钮、恢复单一云项目入口、修正 iOS 移动端识别，以及把同步状态读取从全项目扫描收紧到 `.raw/.sync` 固定目录；局部测试、TypeScript、IPA 构建、安装和启动均通过。
- 用户最后操作后只读复查，四个本地项目的 `.raw/.sync/state.json` 修改时间全部未变化，证明真实下载未落盘。本轮明确暂停，未提交、未推送、未发布，不登记为修复完成。
## [2026-08-13] Desktop 验收与经验沉淀 | 本机 ComfyUI Z-Image Turbo

- 用户已确认韭菜盒子 Desktop 通过本机 ComfyUI 成功生成 Z-Image Turbo 图片。地址为 `http://127.0.0.1:8000`，创作面板提供 `720p/1080p` 与 `16:9`、`9:16`、`4:3`、`3:4`、`1:1`；模型卡显示“本地模型”。
- 后续接入必须先导出并复刻人工验收通过的 API 工作流，只替换明确的用户输入节点。Z-Image 当前映射为 `CR Text(47).text` 和 `EmptyLatentImage(21).width/height`；两个 LoRA、正负提示词、KSampler、VAE 和 SaveImage 保持原工作流。
- 本轮排障确认：端口不是 `8188`；WebKit Blob/Base64 保存不能作为本机结果通道；单张发糊不等于采样器未连；先比较 `/history` 节点 JSON 并使用相同种子 A/B。旧 Tauri 窗口失去 Vite 服务后不会热更新，必须重启开发版再验收。
- 详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13]]；MiniMax H3 和其他本机工作流未接入，不写成已支持。

## [2026-08-13] 修复与模型下线 | GPT Image 2 结果落盘、Grok Image 4.2

- GPT Image 2 的远程结果 URL 在 Desktop 自动下载写入项目之前就会失效，造成预览/下载拿到 `image not found`，且没有项目路径所以不显示“放到画布”。现强制请求 `b64_json`，复用既有图片字节落盘链路；未落盘的远程结果不再显示预览入口。旧失效链接不能恢复，必须重新生成。
- 用户确认下线 `Grok Image 4.2 文生图` 和 `Grok Image 4.2 图生图`；两项已从创作注册表删除，旧 RunningHub ID 同时禁止再次执行。`rh-grok-image-video` 保留。
- focused 测试、TypeScript 与 `git diff --check` 通过；真实 GPT Image 2 新生成结果仍待 Desktop 人工验收。

## [2026-08-13] 修复与沉淀 | 创作面板异步保存方法缺失

- 症状为创作任务后出现 `flushCanvasSave is not a function`，并阻断创作面板打开、收起或项目切换；项目和素材本身未损坏。
- 根因是异步 `CreationPanel` 的 ref 已存在，但 `defineExpose` 方法尚未就绪；外层只保护 ref、不保护方法，类型又错误声明方法必定存在。
- 最小修复将 ref 方法标为可选，并使用 `creationPanelRef.value?.flushCanvasSave?.()`；回归测试同时禁止不安全调用重新进入。
- 相关测试 `92/92`、TypeScript、Desktop quick build 与产物审计通过；Web 连续开关 10 次无页面错误。完整 focused `1030/1031` 的唯一失败是两份既有 ComfyUI 测试未登记；真实 Desktop 安装包点击待发布后验收。详见 [[排障/创作面板异步保存方法缺失-2026-08-13]]。

## [2026-08-14] 发布准备 | v2.1.22 与小易图片异步适配器

- 版本统一为 `2.1.22`：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 与 `Cargo.lock` 一致。
- 新增独立 `xiaoyi-image-adapter`，六个 GPT Image 2 / Gemini 图片模型复用 NewAPI `/v1/videos` 异步任务系统，不修改 NewAPI 官方源码。
- 修复图片任务默认 4 秒计费倍率、NewAPI 模型映射兼容、轮询瞬时错误终态化、旧 `gpt-image-2` 历史计划、Gemini 无效 4K/比例、Web 大 Base64 落盘及上传边界。
- 适配器 7/7、前端 focused 1037/1037、Rust 396 项、TypeScript、Web 正式构建和产物审计通过；生产容器部署、NewAPI 渠道切换与真实付费生图待执行。详见 [[运维/小易图片异步适配与部署-2026-08-14]]。

## [2026-08-14] 生产排障暂停 | 小易 GPT 图片多参考图与账号池

- `xiaoyi-image-adapter` 已在生产构建并启动，容器内健康检查成功；NewAPI 渠道 88 的 `gpt-image-2-1k` 已真实生成成功。
- 生产数据库确认中质量请求命中渠道 92、VIP 请求命中渠道 115，模型映射没有串入 1K 渠道；两者的 2K 任务均返回 `No available 2K image accounts`，低质量渠道另有 `fetch failed`。
- 绕过 App、NewAPI 和适配器，直接向小易 `/v1/images/edits/async` 提交 `gpt-image-2-vip`、`2048x1152` 和三张参考图，任务成功取得 `task_id`，随后仍由小易返回 `No available 2K image accounts`。因此模型名、三文件 multipart、异步提交和同 Key 轮询均被接受，最终阻断位于小易 2K 账号池。
- 画布编号、文字和箭头不会被烘焙进参考图；它们不是失败原因，但也不控制上传顺序。App 并发提交与 600 秒轮询上限是后续稳定性事项，本轮未修改。
- 用户决定停止继续测试；不修改模型映射、不修改 NewAPI 官方源码、不静默降级分辨率。详见 [[排障/小易GPT图片多参考图与账号池失败-2026-08-14]]。

## [2026-08-14] 生产补验与渠道接入 | 小易三参考图成功、官方稳定渠道

- 此前长时间等待的三参考图任务最终成功，并由 App 保存到项目，确认 App、NewAPI、适配器、小易异步编辑、轮询和项目落盘主链正常。
- `No available 1K/2K image accounts` 与 `fetch failed` 更新为小易上游间歇性可用性问题，不再表述为对应分辨率永久不可用。
- 新增 `gpt-image-2-官方` 前端路由、NewAPI 可用性识别和适配器映射，上游真实模型仍为 `gpt-image-2`；单价为 `0.25/张`，待生产部署与真实生成验收。

## [2026-08-14] 生产验收 | 小易 GPT Image 2 官方渠道

- 生产 `xiaoyi-image-adapter` 已重建，健康检查列出 `gpt-image-2-官方`；`creation-models` 已重启并处于 `active`。
- App 内 `gpt-image-2-官方` 已真实生成并保存结果，确认前端、NewAPI、适配器、小易异步链路与回收落盘可用。
- 首次提交的 `model_price_error` 是 NewAPI 管理端尚未配置模型价格；设置 `0.25/张` 后成功。该错误优先检查 NewAPI 价格配置，不归类为上游账号池或适配器故障。

## [2026-08-14] 修复待部署 | 小易完成态超大载荷

- 生产排查确认：小易上游已完成、适配器查询返回 `completed`，NewAPI `tasks` 中对应渠道任务均为 `SUCCESS`；不是上游轮询卡死。
- 根因是小易适配器透传 `response_format=b64_json`，使 NewAPI 任务查询携带整张生成图片；Desktop 任务卡不能稳定接收该超大完成响应，仍显示 `processing`。
- 适配器移除该透传，使用 URL 结果，客户端继续立即下载并写入项目。适配器单测 `8/8` 和前端 focused 测试通过；新版尚未部署，生产验收待一次真实图片任务完成与落盘。

## [2026-08-14] 修复与沉淀 | 画布单图标注参考图上传

- 根因：画布箭头、笔迹、编号和文字曾是独立节点，创作提交只读取选中图片的原始媒体路径，标注不在上传文件中。
- `v2.1.23` 将每张图片改为包含真实图片节点的 Group；标注记录为该 Group 的同 `assetId` 子节点，使用图片局部坐标。提交时无标注直传原图，有标注只导出这一图片 Group，并保留原图尺寸和比例；三张选中图片分别上传，不拼画布。
- TypeScript、画布合同与 Creation Runtime/Plan 定向测试通过。历史画布的散落标注无法可靠关联，需重新标注；真实上游三张不同标注图片的视觉理解仍待人工验收。

## [2026-08-15] 生产部署 | 小易 Gemini 图片参数合同

- 提交 `cffeb8e4` 已把两项 Gemini 图片模型改为小易上游合同：10 种比例、1K/2K/4K、最多 10 张参考图、每张 10 MB、提示词最多 20,000 字符；App 的 `aspectRatio` 经异步媒体请求由适配器原样转发。
- 用户已在生产执行强制重建，容器启动为 `Up`；`/health` 返回 `status=ok`，`/v1/models` 返回两项 Gemini 与全部既有模型，证明新版镜像已加载。
- 随后用户实际测试确认本次 Gemini 请求全部成功；截图可见带参考图的 `16:9` 任务完成并保存至 `.raw/jc-media/图片/`，两项 Gemini 图片模型的生产主链完成验收。详见 [[运维/小易图片异步适配与部署-2026-08-14]]。
## [2026-08-16] 媒体文件树性能与命名收口

- 文件树取消所有媒体缩略图读取、队列、缓存和 Blob URL，统一使用类型图标，保留现有点击预览；根因是缩略图解码与视频首帧提取会和画布恢复争抢主线程与缓存，项目规模扩大后不符合流畅性优先原则。
- Desktop 与 Web 统一新生成媒体命名：可选任务摘要、清理后的提示词、模型名、六位任务 ID；不调用模型或接口，不使用日期前缀，不改名既有文件。摘要仅在仍匹配当前提示词时使用，避免编辑提示词后沿用旧内容。
- 自动验证：`vue-tsc -b`、focused 前端测试 `1058/1058`、Oxlint（仅既有警告）和 `git diff --check` 通过。

## [2026-08-16] 方案确认 | 附件拖放恢复与重复导入去重

- 确认 Desktop 原生拖放由当前 `App.vue` 单例分发，记忆对话输入区复用既有附件和 `ProjectFileService` 链路；Web 只处理 `DataTransfer.files`，Mobile 保持系统选择器，不恢复旧 `WorkspaceLayout` 或新增上传器。
- 绝对路径只作瞬时导入输入，不持久化；导入后仍以项目相对 `ProjectResource` 为事实源，确保重启、原文件移动或删除后可恢复。
- 重复导入按“同项目、同分类、同规范化文件名、同 SHA-256”复用已有资源；同名不同内容、明确改名的相同内容仍保留独立资源。Office/PDF 命中去重时复用原件和 Markdown 可读副本，缺失时只补 Markdown。
- 本轮只更新 Wiki 决策与验收合同，未修改代码、未执行自动测试或真机验收，不登记为已实施。

## [2026-08-16] TDD 建立 | 统一拖拽路由与附件导入去重

- 新建 [[开发/文件系统/通用记忆工作台统一拖拽路由与附件导入去重TDD]]，把对话区、创作画布和文件树的目标命中规则固定为红灯测试。
- 明确窗口空白区域的回退优先级：对话可见时进入对话；只有创作面板全屏/专注且对话不可见时进入画布。明确命中画布 drop zone 时仍由画布优先。
- 去重继续只放在共享导入与 `ProjectFileService` 边界；Desktop/Web 入口互斥，Mobile 不增加拖拽逻辑。当前仅完成 TDD，代码、自动测试和三端人工验收均待执行。

## [2026-08-16] 实施完成 | 统一拖拽路由与附件导入去重

- 已恢复 `App.vue` 唯一 Desktop 原生拖放分发，接入对话输入区 Web 文件/目录拖入，并保持创作面板、文件树目标路由和 Desktop/Web/Mobile 入口互斥。
- `ProjectFileService`、Rust 外部导入和 Web 项目传输已加入 SHA-256 内容去重；同内容复用且不发虚假 `created`，同名不同内容沿用 keep-both。Office/PDF 优先复用 Markdown，缺失时只补副本。
- 自动验证已通过：路由/服务/Web 传输定向测试 `29/29`、`vue-tsc -b`、Rust 去重单测；三端人工拖放矩阵尚未执行。

## [2026-08-16] 人工验收 | 对话框与创作画布拖拽上传

- 用户在当前真实产品中确认：文件拖到对话框可正常进入对话附件，拖到创作画布可正常上传到画布。
- 本次只确认上述两个拖拽入口；跨端、窗口空白区、提示词区、文件夹上限、部分读取失败、重复导入、同名不同内容和重启恢复等人工矩阵仍待验证。

## [2026-08-17] 修复与沉淀 | 输入法组合态回车

- 根因：对话输入框已有 `event.isComposing` 保护，但部分 WebView 的候选回车仅报 `keyCode === 229`；该兼容判断最初在 `@` 候选菜单之后，仍可能截获输入法事件。
- 修复：将 `isComposing || keyCode === 229` 置于 `handleComposerKeydown()` 入口，统一早于候选菜单和发送分支退出；不新增输入法状态、计时器或第二套键盘处理。
- 验证：记忆工作台定向 `55/55`、`vue-tsc -b` 和 `git diff --check` 通过。完整 focused 和真实 WebView、Desktop、iPhone/iPad 人工矩阵待后续执行。

## [2026-08-17] 修复与验收 | 3D 编辑器空白与高度为零

- Debug App 原先因错误使用 `#[cfg(dev)]` 可能加载旧 `dist`；改用 `#[cfg(debug_assertions)]` 后确认当前 WebContent 连接 `http://localhost:1420`。
- 最终根因是场景解析器直接返回人物骨骼的响应式四元数数组，编辑器初始化撤销历史时 `structuredClone()` 抛出 `DataCloneError`，中止 `setup()`；模板变量错误和高度为 0 均为连锁症状。
- `quaternion()` 现在返回普通新数组，并将响应式人物骨骼加入回归测试。当前 `tauri dev` 画布和编辑器尺寸非 0、错误列表为空，用户确认恢复；Scene3D `13/13`、工作台 `55/55`、TypeScript、Rust 和差异检查通过。

## [2026-08-17] 版本准备 | v2.1.26

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `Cargo.lock` 已统一为 `2.1.26`。
- 完整 focused 门禁、TypeScript 和差异检查通过，其中 Rust 为 `396 passed / 1 ignored`。
- 本轮只完成版本准备与提交；没有创建 tag、push、构建 Web/APP 或执行发布。

## [2026-08-18] 实施完成 | ZX 视频适配器六模型合同

- 三个 `grok-1.5-video-6s/10s/15s` 固定时长别名统一改为 `0~7` 张参考图：0 张发送 JSON，1~7 张全部转为重复的 multipart `input_reference`，第 8 张在适配器和创作计划边界拒绝。
- 同一适配器新增 `doubao-seedance-2-5-260628`、`omni-fast`、`omni-v2v`；Seedance 使用独立 `/v1/video/generations` 和 `metadata.content`，Omni 使用 `/v1/videos` JSON。
- 视频 `/content` 已改为流式代理并在响应结束后关闭上游流，避免并发下载时把完整 MP4 缓冲进适配器内存；图片上传链路保持不变。
- 适配器 `7/7`、25 并发内容代理冒烟、创作计划与运行时定向测试、TypeScript、Python 编译和差异检查通过。未部署，未用真实 ZX Key 提交或核对账单；上游网页未列出的 Seedance 2.5 与 Omni V2V 别名保持部分验证状态。详见 [[开发/ZX视频适配器多模型升级TDD-2026-08-18]]。

## [2026-08-18] 实施完成 | RH Seedance 2.5 双模型与旧模型退役

- 新增 `rh-seedance25-no-video-ref` 与 `rh-seedance25-with-video-ref`，统一固定 `native1080p`；后者强制 `1-10` 个参考视频。
- UI / NewAPI 输入价格分别为 `80/百万TOKEN` 与 `50/百万TOKEN`；后台按 Token 模式只填写输入价格。
- Seedance 2.0、Fast、Mini 三套共 9 个旧 RH 模型退出可选目录并禁止新执行，历史规格和映射保留用于读取旧任务。
- RH 适配器 `41 passed`、focused `1087 passed`、TypeScript 和差异检查通过；未部署，未进行真实生产生成、压力并发或账单验收。详见 [[开发/RH Seedance 2.5双模型接入与旧模型退役TDD-2026-08-18]]。

## [2026-08-18] 路由确认与修复 | ZX Veo、Grok、Omni

- Veo 3.1/Fast 与 Grok 6s/10s/15s 均由 NewAPI 直连 ZX；用户截图确认 Grok 渠道 Base URL 为 `https://img-api.zxcode.vip`。只有 `omni-fast`、`omni-v2v` 和 ZX Seedance 2.5 由 NewAPI 转入独立 `zx-video-adapter`。APP 的 `newapi-direct` 标记只描述 APP 到 NewAPI，不描述 NewAPI 后端是否经过适配器。
- RH 三个 Gemini Omni 和 RH Grok 继续只走 `rh-adapter`；本轮未把任何 RH 模型加入 ZX 适配器。
- Omni 下载失败的根因是官方 `/content` 必须使用创建任务时的 ZX Key，不能使用 APP 用户 Token。提交 `260803e3` 增加任务 ID到 ZX 渠道 Key的进程内映射，并保持下载入口本身仍需鉴权；适配器 `12/12` 回归通过。
- 用户已真实确认 Veo 直连生成成功、ZX Grok 6 秒生成并落盘、Omni Fast 生成完成；Omni 最终 MP4保存仍需部署 `260803e3` 后复验，当前不得登记为下载成功。

## [2026-08-19] Wiki 更正 | ZX Grok 生产路由

- 根据用户提供的 NewAPI 后台截图，更正此前将 Grok 6s/10s/15s 写成走 `zx-video-adapter` 的错误：三个模型当前生产渠道均直连 `https://img-api.zxcode.vip`。
- Grok 适配器代码与历史 SDD继续保留为历史实现和备用能力；现行路由不据代码是否存在判断，只以 NewAPI 渠道 Base URL为准。
- Omni Fast/V2V 与 ZX Seedance 2.5 的独立适配器安排不变；RH 三个 Gemini Omni 与 RH Grok 的渠道边界不变。

## [2026-08-19] Wiki 沉淀 | 创作画布设计、运行链路与旧产物排障

- 统一记录画布存储、恢复、保存、定向任务写入、单图 Group 标注、独立参考图上传和从左到右排序合同。
- 更正三处过时描述：生成结果不是自动入画布；整理媒体不是多行网格；标注已经归属于各自图片 Group。
- 记录“工具全部无效”的真实根因：后台测试 APP 外壳加载旧 `dist`，没有连接 Vite/Tauri Dev 服务；固定先核对版本、产物旧文案和 `1420` 监听，再重建前端与 bundle。
- 明确验证边界：源码类型检查、focused 测试和合同测试不等于最新打包 APP 的人工验收；本轮只提交 Wiki，不改变现有源码改动。

## [2026-08-19] 实施与沉淀 | v2.1.30 主线整合与创作画布热修

- 建立“同一仓库同一时间只有一个写入负责人”的固定规则；多个对话不会自动合并未提交状态，新写任务必须从最新已提交的 `main` 开始。
- 完成创作画布标注坐标、超大 Base64 污染恢复和媒体落点修复；按用户决定移除非必要且无法稳定命中的画布视频播放入口，保留静态视频参考。
- Grok 下载已确认正常；Veo 上游稳定性、iPhone 下载覆盖本地及正式跨端安装包人工验收仍未完成。
- 版本统一为 `v2.1.30`；本记录形成时尚未推送、打 tag 或发布。见 [[开发/v2.1.30整合与创作画布热修TDD-2026-08-19]]。

## [2026-08-20] TDD 建立 | Codex 创作 MCP 服务

- 新建 [[开发/韭菜盒子Codex创作MCP服务TDD-2026-08-20]]，确认核心不是复制 `jc_media.py`，而是让 Codex MCP 安全进入正在运行的韭菜盒子 Creation Runtime 与 `mediaTaskStore`。
- 任务必须进入创作面板同一历史，并复用现有模型目录、参数校验、同步/异步处理、取消、恢复、项目落盘和显式画布动作；API Key 继续只由韭菜盒子管理。
- 当前只完成 TDD；MCP Server、本机桥接、自动测试、真实付费生成、Codex 媒体显示、正式安装包和跨平台验收均未执行。

## [2026-08-20] 实施完成 | Codex 创作 MCP 图片、参考图与输出目录

- 已实现 `jiucaihezi-creation` stdio MCP、Desktop 回环鉴权桥接和设置页一键动态配置；入口路径、Node 路径按当前安装环境解析，不写死用户目录。
- MCP 任务复用韭菜盒子现有模型注册表、`buildCreationRunPlan()`、`mediaTaskStore`、创作历史、项目落盘和显式画布动作；API Key 仍只由韭菜盒子管理。
- `submit_creation_task` 支持本机绝对参考图路径、data URL、HTTPS URL，以及可选 `directory` 输出目录。Desktop 会把本机图片读取为 data URL；参考图数量/大小和参数限制继续由现有模型表校验，不在 MCP 复制静态上限。
- 用户已真实确认 Codex 调用韭菜盒子生成图片并成功保存；MCP schema/build、TypeScript、完整 focused `1104/1104` 和差异检查通过。
- 正式安装包、Windows/Intel Mac 真机、多参考图付费矩阵、视频/音频内嵌播放和跨重启任务恢复仍未验证。

## [2026-08-20] 生产修复与验收 | 迅虎支付跳转 404

- 确认 `jiucai-adapter` 自 2026-06-09 持续运行且零重启，容器内 `/submit.php` 正常返回迅虎收银台跳转；故障不是支付容器或 NewAPI。
- Nginx 于 2026-08-20 06:09 重启后，旧 `/xunhu/` 的 `rewrite +` 无尾斜杠 `proxy_pass` 未可靠剥离前缀；改成 `proxy_pass http://127.0.0.1:8081/;` 后 reload。
- 公网探测恢复 `200`，用户确认真实支付正常。首次备份误放 `sites-enabled` 曾导致重复监听、配置检查失败；已移到 `/etc/nginx/backups/`。回环探测仍为 `404`，不登记为已通过。见 [[运维/服务器运维#迅虎支付 `/xunhu/submit.php` 在 Nginx 重启后 404（2026-08-20）]]。

## [2026-08-22] 实施与用户验收 | Desktop AnyDoc 内置格式转换

- Desktop 的文档导入统一由 Tauri 内置 AnyDoc `0.2.3` 解析并生成 Markdown 可读副本；保留原件、项目相对路径、SHA-256 去重和现有模型读取合同，用户上传操作不变。
- 用户已在 macOS ARM 安装包实际验证 DOCX、XLSX、PPTX 转换成功。复杂 104 页 PDF 为图片型扫描件，无文字层；当前明确提示需要 OCR，不再误报文件损坏，原件继续保留。
- Desktop 本地 AnyDoc 链路不调用 MarkItDown；仅 `internal`/不可用错误可回退云端。Web/Mobile 仍走现有 `/documents/markdown` 云端 MarkItDown 服务；云端 AnyDoc staging、生产切换和 OCR 能力均暂缓，未部署服务器。
- 自动验证：前端 focused `1111/1111`、Rust AnyDoc `4 passed`、TypeScript、Rust 格式与差异检查通过；macOS ARM `.app` 签名和 DMG 完整性校验通过。Intel Mac 与 Windows x64 真机仍待后续发布门禁。详见 [[开发/通用记忆工作台AnyDoc内置格式转换升级TDD-2026-08-22]]。

## [2026-08-23] Wiki 沉淀 | 本机 MLX 最小连接入口

- 用户确认本机 MLX 不做下载器、安装助手、模型目录管理或进程管理；用户自行下载模型并启动兼容服务，韭菜盒子只提供服务地址、连接和模型自动识别入口。
- Desktop 默认地址统一为 `http://127.0.0.1:8081`，连接请求 `/v1/models`，模型以独立 `local-mlx` Provider 保存并与 Ollama/云端模型共存；只接受本机回环地址，Web/Mobile 不显示入口。
- 首次使用流程固定为“外部启动服务 -> 设置填写/确认地址 -> 连接 MLX -> 顶部选择模型 -> 快速模式先验证，记忆模式再使用 Wiki/项目工具”。详见 [[开发/通用记忆工作台本机MLX兼容服务接入TDD-2026-08-21#10. 最终界面合同与首次使用流程（2026-08-23）]]。

## [2026-08-24] 实施与 Wiki 沉淀 | 工作台右侧对话 Dock

- 文档预览或创作面板打开时，工作区采用“项目树｜主工作区｜右侧对话 Dock”；中间只承载文档或创作之一，对话复用原消息、输入和滚动状态。
- Dock 支持完整态、约 `56px` 窄栏、宽度持久化与恢复；不足 `560px` 时顶部入口切为图标，对话下拉菜单未修改。旧创作宽度状态和第二条分隔线已删除。
- 创作与资源预览切换复用同一个画布关闭 Promise；设置保持悬浮抽屉，层级高于 Dock；`940px` 以下继续使用既有全屏/移动布局。
- 文档大纲折叠后退出 Grid 列，正文恢复单列全宽，仅保留紧凑展开入口。
- 用户已完成 Desktop 多尺寸布局实测；定向测试 `56/56`、TypeScript、`build:quick`、Web 产物审计和差异检查通过。真实触控拖拽及移动端人工验收仍待执行。详见 [[开发/通用记忆工作台右侧对话Dock布局TDD-2026-08-23]]。

## [2026-08-24] 修复与 Wiki 沉淀 | MiniMax H3 视频请求合同

- `invalid_json` 根因是 App 向 NewAPI 同时发送数字 `duration` 和数字 `seconds`，而 NewAPI 的 `seconds` 入站字段要求字符串；请求因此在到达小易适配器前失败。
- 三个 MiniMax H3 模型现只发送字符串 `seconds`，不再重复发送 `duration`；其他视频模型请求保持原合同。
- 小易适配器 `/v1/models` 现要求 Bearer Token，使用同一 Token 查询上游并只返回实际可见模型对应的公开别名；适配器测试同步改为真实 `"seconds": "8"` 入站。
- 三个模型在生产验收前保持 `partial`。适配器 `12/12`、Runtime `29/29`、完整 focused、Rust `402 passed / 1 ignored`、TypeScript 和差异检查通过；未部署，未执行真实付费生成、MP4 落盘或扣费核对。详见 [[开发/MiniMaxH3视频seconds类型修复TDD-2026-08-24]]。

## [2026-08-25] TDD 建立 | iPhone TestFlight 外部测试

- 用户确认继续基于当前 `main / v2.1.34` 开发 iPhone App，不正式上架 App Store，使用 TestFlight 外部测试让其他用户安装和更新。
- 新建 [[开发/通用记忆工作台iPhone TestFlight外部测试TDD-2026-08-25]]；顺序固定为“云下载真机可观测 RED -> 根因回归测试 -> 共享根因修复 -> Mobile 真机矩阵 -> TestFlight 内部安装 -> Beta App Review -> 定向外测 -> 公开链接”。
- 继续使用 `com.jiucaihezi.mobile`、Apple Team `RXD4L9387J` 和现有 App Store Connect App；不新建 Mobile App，不恢复自动双向同步，不使用 Ad Hoc 或 Enterprise 绕过 TestFlight。
- 已加入云下载操作追踪和回归合同；iOS Debug 仅桌面加载 Vite，创作面板遵守顶部安全区并保留唯一返回对话入口。`1115` 个 focused 测试、iOS Rust target 检查、Debug IPA 构建、真机覆盖安装和启动完成，用户确认可返回对话。
- 未执行云下载真机文件落盘验证；未上传 `2.1.34` 到 App Store Connect，未完成 TestFlight 内部安装、Beta App Review 或外部公开链接。

## [2026-09-15] 发布准备 | v2.1.51

- Word 故事集标题兼容修复随 `2.1.51` 收口；`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `Cargo.lock` 版本一致。
- 发布前验证通过：focused Node `1350/1350`、Rust `412 passed / 1 ignored`、TypeScript、定向 lint 与差异检查。当前只提交并推送 `main`；三平台构建、签名、公证、Windows 启动和下载清单须由 `v2.1.51` tag 另行触发并验收。

## [2026-09-14] 修复 | Word 故事按集拆分

- 用户提供的 `.docx` 中集标题使用正文段落、文本内 Markdown `##` 与整段加粗；AnyDoc 输出 `**## 第一集…**`，旧边界识别因此漏掉全部集标题。
- `markdownSplit.ts` 在共享标题入口解开整行强调包装，并阻止包裹后的 Markdown 数字标题被独立数字段号规则重复计入；未新增 Word 专用拆分旁路。
- 真实文件转换复验得到 3 个集节点与 1 个无损前置节点；focused `1350/1350`、`vue-tsc -b`、定向 lint 与差异检查通过，真实 App 点击验收待完成。

## [2026-08-26] TDD 建立 | Wiki 任务执行提速

- 用户确认后续按“一次多词 Wiki 扫描、同轮只读工具并行、写操作串行屏障、最小耗时记录”的最小路线执行，新建 [[开发/通用记忆工作台Wiki任务执行提速TDD-2026-08-26]]。
- 根因固定为开放式模型工具循环放大模型往返，不是“简单 Agent 必然比编程 Agent 快”或模型权重差异。
- 不先引入 RAG、向量库、新索引服务、Responses API 或 WebSocket；不全局将 `64` 轮上限改为 `12`，避免削弱媒体、3D、MCP 和 Terminal 长任务。
- 当前只完成 TDD 与 Wiki 登记；运行时代码、红灯、自动验证和三次同模型真实前向均未执行。

## [2026-08-26] 实施完成 | Wiki 批量检索、只读并行与耗时观测

- Wiki 搜索增加一次 `1-3` 词扫描，连续项目内只读工具按段并行；写入、Terminal、MCP、项目外读取和其他操作默认串行，工具消息仍按模型原始顺序回填，取消不进入后续写入。
- Direct Runtime 记录真实 HTTP 请求次数、逐请求耗时、工具轮数、工具耗时和总耗时，不记录正文或参数；工作台运行步骤显示工具耗时。Cha Skill 改为一次提交初始短词及同轮读取独立证据页。
- 红灯已在旧实现确认；定向 `158/158`、Cha Skill `7/7`、完整 Node focused `1129/1129`、Rust `402 passed / 1 ignored`、TypeScript、定向 lint 和差异检查通过。
- 当前项目三词本地基准读取 `363 -> 121` 次，中位 `48.66 ms -> 24.27 ms`，约 `2.0x`。当前正式 App 为旧版 `2.1.33`；新构建上的三次 `gpt-5.6-sol` / `jiucaihezi` 真实前向未执行，不登记为端到端性能验收通过。

## [2026-08-29] 生产验收 | RH AI App 统一模型注册与部署

- 6 个 Minimax-h3 RunningHub AI App 通过 `rh-aiapp` 通用模型接入，不新增独立模型名或渠道 ID。
- 服务器部署固定为 `/opt/jiucai-repo` 拉取 `main`、稀疏检出 `rh-adapter`、复制到 `/opt/rh-adapter`，再执行 `docker compose up -d --force-recreate --build rh-adapter`；`.env` 的 `RH_AI_APP_WHITELIST` 必须包含新 `webappId`。
- 首次部署因在 `/opt/rh-adapter` 执行 `cp rh-adapter/*` 而失败，修正复制目录和白名单后，容器内映射、公网 `app-directory`（11 项）及创作面板显示均已确认。

## [2026-09-02] iPhone 文件树与云端覆盖根因修复

- 支线 `0902-shouji` 从 `main` / `v2.1.40` 创建。iOS 文件树导出不再进入 Desktop 目录选择器，改为 `navigator.share({ files })`，不支持时逐文件下载；移动端隐藏“电脑中打开”。
- 手机云项目只按 `.raw/.sync/state.json` 中的 `cloudProjectId` 精确复用本地目录；同名但未绑定时创建新 App 管理目录。上传/下载继续复用 `ProjectTextSync` 的完整文字覆盖合同，媒体、凭据、设置和 `.raw/.sync` 排除。
- 文件树专项回归 `33/33`、TypeScript、`git diff --check` 通过；真实 iPhone、IPA 安装和 TestFlight 未执行，不登记为移动端发布通过。

## [2026-09-03] 实施完成 | 对话记忆索引摘要模型接口约束

- 索引模型固定返回 `summary + keywords`；请求携带严格 `response_format.json_schema`，程序只解析 `message.content`，拒绝 reasoning、Markdown、额外字段、截断和长度越界，并在校验成功后才写入 Wiki。
- 已补摘要请求与响应解析 TDD，删除 JSON 大括号截取和 reasoning fallback；不支持结构化输出的模型明确失败且不写入。
- 本地 focused `1176/1176`、`vue-tsc -b`、格式检查和 `git diff --check` 通过；真实 `jiucaihezi`、Ollama、MLX Provider、Web/Desktop/Mobile 人工验收仍待执行。

## [2026-09-16] 修复 | 对话记忆索引不再依赖结构化输出

- 用户实测“记录对话”失败后确认改为“模型出文字，程序负责拼结构”。根因是旧链路把 `response_format.json_schema` / 强制工具调用作为写索引前置条件，部分模型或网关不支持该协议。
- 摘要请求统一为两行纯文本；程序负责提取简介与关键词、限长、去重和原有索引结构写入。索引文件格式、正链和查询均不变；无关键词行时用简介和技术标识兜底。

## [2026-09-16] 修复 | 持续引用重开后主对话请求 400

- 用户实测持续引用文件后主对话直接返回 `API 400: invalid message format`。根因是 Raw 只保存附件定位信息，重开后内联文本为空；发送链路把它回退编码为二进制 `file` 消息片段，而当前网关不接受该格式。
- 持续文本引用现按已保存的 `readablePath` 重读文本并以内联文本发送，避免二进制 `file` 片段；媒体附件原路径不变。focused Node `1361/1361`、`vue-tsc -b` 与 `git diff --check` 通过，用户已用原失败场景确认成功。
## 2026-09-10 改编 Wiki 建库与双链输入合同确认

- 用户确认韭菜盒子只提供通用基础能力：文件树“建库”、Markdown 双链按钮、`Command/Ctrl + Shift + K`、输入 `[[` 自动联想；角色、场景、道具判断及逐集改编继续交给 Skill。
- 新增并实施 [[开发/通用记忆工作台改编Wiki建库与双链输入TDD-2026-09-10]]，加入 [[CLAUDE]] 当前开发入口；类型检查、相关测试和完整 focused 测试通过，真实平台人工验收仍待执行。

## [2026-09-15] v2.1.52 Desktop 入口事故与发布链修复

- 用户安装 `v2.1.52` 后确认三平台 Desktop 包把 Web 官网当成首屏；该版本视为坏版本，按用户决定不回滚，直接准备 `v2.1.53`。
- 根因是 GitHub Actions 三个平台手工执行 `vite build`，同时清空 Tauri `beforeBuildCommand`，绕过 `prune-desktop-dist.mjs` 与 `audit:desktop-dist`。本地开发直接打开 `/try/`，所以未暴露正式包入口错误。
- 三个平台现统一调用 `pnpm run build:desktop:quick`；发布合同测试逐 job 锁定该命令。定向测试 `5/5`、本地 Desktop quick build和产物审计通过，正式包首屏待新 tag 构建后人工验收。

## [2026-09-17] 修复 | Skill Creator 草稿目录被 Tauri ACL 拒绝

- Desktop 草稿路径与 Rust 安装读取均使用 `$TEMP/jiucaihezi-skill-drafts/**`，但 `fs:default` 原先只允许 AppData、下载和指定 Home 子目录；因此 `@文件` 已选中也无法越过宿主 ACL。
- `src-tauri/capabilities/default.json` 仅新增该应用专属临时子目录；`scripts/check-tauri-fs-acl.mjs` 新增精确 scope 断言并登记进 focused 测试。
- 旧配置红灯已复现；修复后 ACL、JSON 解析与 Node focused `1368/1368` 通过。真实 Desktop 全链待验收。

## [2026-09-17] 调整 | 创作面板 GPT Image 2.5 官方档

- 面板删除 `gpt-image-2.5-flare-CF-超分`、`gpt-image-2.5-sunburst-CF-超分`；新增 `gpt-image-2.5-官方`、`gpt-image-2.5-flare-官方`、`gpt-image-2.5-sunburst-官方`。
- 三个新模型按原名提交 NewAPI，支持 1K/2K/4K，显示价均为 `0.15/张`；旧 CF 路由继续留在小易适配器和公开 API 兼容层。
- TDD 红灯 4 项已复现；定向注册表与可用性测试 `59/59`、Node focused `1368/1368`、`vue-tsc -b` 与差异检查通过；真实渠道生成待验收。

## [2026-09-19] 实施完成 | 故事导入补齐格式真源、文件夹批量与长书分段

- 文档格式清单收敛到 `src/utils/documentFormats.ts` 单一真源（等于 AnyDoc 0.2.3 的 20 个扩展名），附件分类与故事导入共用同一份，避免再出现「UI 让选、服务端 415 拒」。
- 文件树选中文件夹即可批量导入：可导入的文档排队，弹窗显示「第 N / 共 M 本」，每本都要看过预览才写盘，出错可以「跳过这一本」。
- 书名不再等于文件名：`书名(作者).epub` 这类写法会识别出作者，书名与作者都能在预览里改，改完按新名字重建拆分计划。
- 拆分改为受控刷新：`原文.md` 仅在纯追加时覆盖；`来源.md` 只刷新 Runtime 自己生成的记录（`type: story-source`）并原样保留标记 `<!-- jc-story-source -->` 之后的用户笔记；节点仅在正文是旧正文的延长时刷新（`source_range`/`source_hash` 本来就变，不参与比较）。此前任何重导都会被冲突闸门整条拦住。
- `prepare_story_analysis` 新增 `startOrder` 与 `progress`（`total`/`analyzed`/`remaining`/`nextOrder`）：上千章的书可以只处理某一卷、某五十章，`nextOrder` 只往前走，不会往回跳。
- 定向回归：故事导入与节点分析 `31/31`、文件树 `35/35`、完整 focused `1414/1414`、`vue-tsc -b` 通过。真实超长书分段推进、Web/Mobile 线上 EPUB 转换（需重新部署 `document-converter`）待人工验收。

## [2026-09-19] 修复 | 自动识别不再被目录页拦下

- 用户导入《三国：中兴大汉，蜀之浪漫》后实测：明明通篇是 `# 第N章`，却报「未识别到边界 / 检测到多种接近但切片位置不同的故事边界」，只能手填标记词。根因是候选打分按**候选条数**比分数（`ordinals.length * 100`），而这本书的目录页写的是 `1. [第1章 …](#anchor)`，条数与正文章节几乎一样，于是两套规则「接近但位置不同」→ 直接拒绝导入。
- 现在规则按可靠度分层：明确章词（第N章 / Chapter N）> markdown 标题层级 > 裸编号；只有同一层的候选才判互斥，低层规则位置再不同也只是噪声。
- 目录行不再算边界：带页码导引线（`…… 6`）或锚点链接的行，自动规则与手填标记词都跳过。卷不单独成节点（同时有 `第N卷` 与 `第N章` 时按章拆，整本只用卷时才按卷拆）。边界行必须是标题，行首撞上单位词的长句（工具书里的「第一幕是开端，可看成建置(setup)部分…」）不再算章节。
- 报错改成点名冲突的两种写法（`检测到两种同样可靠的拆分写法：按章（第…章）2 处与按标题（##）2 处`），不再只说「请先明确拆分规则」。
- 作者改为先看文件名、再读简介区的 `作者：` 行——AnyDoc 不解析文档元数据，而电子书常把作者写在简介里（实测自动带出「满地是菠萝」）。
- 真样本验证：《三国》自动识别与用户手填「章」的结果**逐节点路径完全一致**（101 节点）；真实 PDF 工具书自动识别从「138 节点（裸编号胜出）」变为按章拆，且目录行不再成节点。定向 `25/25`、完整 focused `1417/1417`、`vue-tsc -b` 通过；工具书这类「章与幕混排」的书仍需人工确认。

## [2026-09-19] 验收 | 故事拆分自动识别通过真实 UI 验收

- 用户在 Desktop 重新导入《三国：中兴大汉，蜀之浪漫》确认成功：弹窗显示「识别方式：章节标题（第X章 / 第X场 / SC01）」「识别节点数：100」「首个节点：第1章 开局抢了赵云的戏」「最后节点：第100章 第二次征合淝！」，命名示例为 `0001_开局抢了赵云的戏.md` 等，作者栏自动带出「满地是菠萝」，无需再手填标记词。目录页与「第一卷：默认」都留在前置内容里。
- 上一轮登记的真样本比对（自动与手填「章」逐节点路径完全一致，101 节点 = 100 章 + 前置内容）由此获得真实 UI 侧的确认；「章与幕混排」的工具书仍需人工确认。

## [2026-09-23] 实施 | @DH 流式正文与执行进度

- SDK JSON-RPC 构建补丁转发 `agent/assistant-stream`，工作台复用既有流式消息区域；只展示正文增量，不展示 reasoning，持久化仍只采用最终 `assistant/message`。
- `tool/call`/`tool/result` 映射到现有步骤条，`step/start` 与 `llm/retry` 更新运行状态。定向 `92/92`、TypeScript、补丁幂等和差异检查通过；真实 Desktop 待验收。

## [2026-09-23] 根治 | @DH 官方 SDK Client 与首轮文件直送

- 用官方 `@deepseek-ai/dsh-sdk-client@0.1.7-alpha.2` 替换前端自写的 Harness JSON-RPC 请求、订阅和 idle 收尾；资源内 Node bridge 只做 WebView 到官方 Client 的逐行消息转交。
- SDK Runtime/Client 版本统一；Helper 或 Harness 退出会把官方错误与 stderr 传回当前 run，不再永久显示“正在执行”。重试由 5 次降为 1 次。
- 工作台已读取的 `@文件` 正文和转换文档随第一轮 prompt 发送，减少一次或多次模型决定 `read` 的往返。
- 定向 `93/93`、TypeScript 与 SDK 错误传播验证通过；完整 focused 的两个既有门禁失败未在本任务中扩修，真实 Desktop/Provider 待验收。

## [2026-09-23] 根治 | @DH 与 @文件改为执行器和能力组合

- 删除两枚芯片的双向互斥：`@DH` 只选择执行器，`@文件` 作为文件能力可在任意点击顺序下同时保留；会话 `toolChips` 恢复不再因 `dh` 提前返回而丢失 `file`。
- `@DH + @文件` 通过官方 `DSH_PERMISSION_MODE=danger-full-access` 获得本机文件全权；`@DH` 单独使用时为 `workspace-write`。权限模式纳入 Runtime key，开关变化会关闭旧 Runtime 后按新权限启动。
- 定向 `95/95`、TypeScript 和差异检查通过；真实 Desktop 外部 Skill 目录读写待人工验收。

## [2026-09-23] 根治 | @DH 使用官方持久 Session，不再截成最近三轮

- 一个 Raw 对话稳定映射到一个带版本命名空间的 Harness Session；删除 Runtime nonce。连续 @DH 轮次只发送当前消息，完整历史、工具轨迹和 Compaction 由 Harness Session 自己负责。
- 首次启用 @DH 会按上下文容量移交已有完整对话；从普通执行器切回 @DH 时只移交中间新增轮次。`dh-session-v1` 隐藏标记保证旧 nonce 会话升级后执行一次完整迁移，此后不重复注入。
- pinned SDK Server 首次见到持久 ID 时改用官方 `sessionPersistence.stat()` 判断并调用 `agents.resume()`；不存在才 `agents.create()`，根除跨 Runtime 的 `session already exists`。停止链完整等待官方 SDK `close()`，不再用 2 秒超时提前杀 runner。
- 定向 `106/106`、TypeScript、补丁两次幂等和差异检查通过；完整 focused 的 Jev 断言与两项测试登记失败为本轮前既有问题。真实 Desktop 跨重启续接与 Provider 文件修改待验收。
## [2026-09-24] 实施 | Harness Session 读回与 Runtime 数据出项目

- runner 新增薄 `session/list`、`session/read` 请求，服务端直接调用官方 `ctx.sessionQuery`；UI 可把持久 Session 的人类 `user/message` 与 `assistant/message` 投影回现有对话节点，不解析 `$DSH_HOME` 文件。
- Harness 数据与 route patch 迁到 AppData，按项目路径哈希隔离；首次启动复制旧项目内 Harness 目录后继续恢复原 Session。
- 工作台默认选择 Harness，删除“记忆/查询”按钮及编辑链路，并关闭旧 `memory_search`；“建立改编 Wiki”幂等增加 `.raw/文档|图片|视频|音频`。
- 轻量对话目录、停止 Raw 双写、取消 `memoryReady` 门禁和旧 Raw 惰性移交已实施；定向退役回归 `127/127` 与 `vue-tsc -b` 通过，真实 Desktop 跨重启待验收。

## [2026-09-24] 根治 | Harness Runtime 按工作区持有

- 根因是宿主层只有一个可替换的全局 Runtime；任一项目的 Session 读回都可能先执行全局 stop，把另一个项目仍在运行的官方 Harness 子进程关闭，于是 UI 立即显示“DeepSeek Harness 已退出”。
- 现按工作区持有 Runtime，同工作区共享创建 Promise；Session Query 优先复用该工作区实例，不同项目不再相互关闭。同项目更换固定启动配置时，严格等待旧实例完整退出后再启动新实例。
- 取消任务改为关闭任务捕获的实例，不再从工作台调用全局停机。定向 `101/101`、完整 focused `1509/1509`、`vue-tsc -b` 与差异检查通过；真实 Desktop 跨项目并行待人工验收。

## [2026-09-25] 定位 | 产品定位定为「协作漫剧本地工作台」，漫剧移出迁出名单

- 用户确认：「协作」= 人与 AI 协作（不是多人协作），「本地」= 数据与模型可留在本机；漫剧是主用途，不再属于迁出对象。
- **漫剧移出名单不等于恢复旧漫剧工作台**：其产品壳（`src/components/workbench/` 等）仍在兄弟仓库 `../jiucaihezi-legacy-products/`，不搬回主仓；漫剧能力由现行记忆工作台与创作面板（`CreationPanel`、`mediaTaskStore`）承接。OpenCode、旧 Studio、文/武/道/创、电商、制作工作台仍属迁出范围。
- 涉及：`docs/wiki/架构/产品架构.md`（第 1 节改名「产品定位与唯一产品边界」并改写）、`docs/wiki/hot.md`、`docs/wiki/CLAUDE.md` 同步。
- 本轮只改文档，不动任何代码。

## [2026-09-25] 实施 | Web 端删除「体验」（/try/ 工作台入口）

- Web 只保留下载与主页展示：落地页（`index.html`，纯静态、不挂 app 脚本）删掉 3 处 `/try/` 链接与「网页版」文案；`prune-web-dist.mjs` 在 Web 产物里删除 `dist/try/`；`audit-web-dist.mjs` 的 `allowedTopLevelDirs` 移除 `try`，工作台若重新进 Web 产物会直接审计失败；`public/sitemap.xml` 移除 `/try/`。
- `vite.config.ts` 的 `try` 入口保留不动：桌面/iOS 构建靠 `prune-desktop-dist.mjs` 把 `try/index.html` 提回根目录成为 Tauri `frontendDist`。
- `src/` 一行未改；web-only 分支变死代码属于后续独立批次。
- 验证：Web 构建 `[web-dist] removed try/` + `audit passed`，产物根目录无 `try/`；桌面构建 `audit passed` 且 `dist/index.html` 仍是工作台（入口 `./assets/try-*.js`、含 `id="app"`）；`vue-tsc -b`、lint、分离门禁 `12/12`、聚焦 `1506/1506` 通过。线上 `jiucaihezi.studio/try/` 与搜索引擎收录的清理属部署侧，未执行。

## [2026-09-25] 发版 | 版本号统一到 2.2.0（自 2.1.64 的累计大更新收尾）

- 自 `2.1.64` 起的累计变更：通用自定义 OpenAI 兼容端点取代本机 MLX；账号登录与模型调用 Key 解耦；平台收缩（桌面只增不减、Web 只留下载展示、移动端冻结待改造为桌面控制器）；产品定位改为协作漫剧本地工作台；Web 端删除 `/try/` 体验入口。
- 版本号由 `scripts/set-version.mjs 2.2.0` 统一写入 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，`Cargo.lock` 随 cargo 更新；落地页版本号是运行时从 `latest.json` 读的，无需同步。
- **同时修复一个既有 Rust 测试失败。** `tests::skill_material_command_writes_to_job_workspace` 自 2026-07-05（`e03a0332` 提取 `skill_material.rs`）起在 macOS 上必失败：测试辅助函数 `temp_test_dir` 返回 `std::env::temp_dir()` 的路径，而 macOS 的 `/var` 是指向 `/private/var` 的符号链接，被测守卫 `reject_symlink_path` 会遍历每个路径组件并拒绝符号链接，于是该路径永远非法。修法是让辅助函数返回 `std::fs::canonicalize` 后的真实路径，测的才是被测代码而不是宿主目录布局。CI 不跑 `cargo test`，所以该失败此前只在 macOS 本地可见。
- 验证：`vue-tsc -b`、lint、分离门禁、前端聚焦 `1506/1506`、`cargo test --lib`  `427 passed / 0 failed / 1 ignored` 通过。真实安装包、升级链路与 Windows/iOS 构建未验收。

## [2026-09-25] 根治 | 修复 CI 安装包无法对话（Harness 运行时未打进包）

- 现象：`pnpm tauri dev` 正常，CI 出的安装包一发消息就「处理失败 00:00 · 无法启动 MCP 进程: No such file or directory (os error 2)」。
- 根因：Harness 是用**随包分发的 node** 起子进程的（`src/services/deepSeekHarness.ts:378` 的 `deepseek-harness/node_modules/node/bin/node(.exe)` 交给 `McpStdioTransport` → `mcp_spawn_stdio`）。而该目录在 `.gitignore` 里，只有 `build:deepseek-harness` 会准备它；那道工序原本只长在 `tauri.conf.json` 的 `beforeBuildCommand` 上，**而 CI 为注入 `VITE_GITHUB_OAUTH_CLIENT_ID` 把 `beforeBuildCommand` 置空**，改跑 `build:desktop:quick`（不含该工序），于是安装包里的资源目录缺运行时，开发态却完全正常。
- 修法（根因，不是症状）：把 `pnpm run build:deepseek-harness` 放进 `build:desktop:quick`，让构建入口自足；`scripts/audit-desktop-dist.mjs` 新增守卫，运行时缺失时直接构建失败并指出确切路径；`deepSeekHarness.test.ts` 把「准备工序必须在 `build:desktop:quick` 里」钉成合同。
- 验证：缺失场景下审计 `exit=1` 并报出 `deepseek-harness/node_modules/node/bin/node`（临时改名实测，已恢复）；恢复后 `build:desktop:quick exit=0` + `audit passed`；聚焦 `1506/1506`、`vue-tsc -b`、lint 通过。**本轮未重发安装包**，已发布的 `v2.2.0` 安装包仍带此缺陷（随后由 `2.2.1` 重发，见下条）。

## [2026-09-25] 发版 | 2.2.1 重发安装包，修复 CI 包无法对话

- `2.2.0` 的 CI 安装包带「Harness 运行时未打进包」缺陷（一发消息即 `处理失败 · 无法启动 MCP 进程: os error 2`），`2.2.1` 是重发补丁版；根因与修法见上一条根治记录。
- 本次只 bump 版本号并重跑 CI，未改任何代码：`scripts/set-version.mjs 2.2.1` 写入 `package.json`、`tauri.conf.json`、`Cargo.toml`，`Cargo.lock` 随 `cargo check` 更新。
- 验证：`vue-tsc -b`、lint、分离门禁、前端聚焦 `1506/1506` 通过。**新包是否真能对话以 CI 产物实测为准**，代码与构建层只做到「缺运行时即构建失败」。

## [2026-09-25] 运维 | 服务器旧版本安装包自动清理 + 文档补齐

- 背景：安装包从每版 48MB 涨到约 487MB（arm dmg 325 + intel dmg 18 + win setup 144），而 `publish-download-manifest` 只 `mkdir` + `scp`，**旧版本永不被删**，磁盘会一直累积。
- 新增 `scripts/prune-updates.sh`：只保留最近 N 个版本目录（CI 传 5）。两条硬约束写进脚本：只删「目录名形如 `2.2.1`」的目录；**永不删 `latest.json`，也永不删它指向的版本**。
- 接到发版流程最后一步（scp 全部成功之后才跑），并加合同断言钉住接线；新增 `scripts/__tests__/prune-updates.test.mjs`（4 条，含「钉住版本不被删」的反例）。
- `docs/wiki/运维/服务器运维.md` 补齐 `/opt/updates/`：布局、谁写谁读、每版体积、保留策略、`df -h` / `du -sh` 巡检与手工清理命令。此前该目录在文档里**完全没有记录**。
- 结论：下载页或客户端的更新提示只读 `latest.json`，删旧版本目录不影响任何更新路径。
- 验证：`node --test scripts/__tests__/prune-updates.test.mjs` 4/4；完整聚焦、门禁、`vue-tsc -b`、lint 通过。**未在真服务器上执行过**（无凭据），磁盘实际占用待人工确认。

## [2026-09-25] 重构 | 自定义端点取代本机 MLX，设置页本机块收拢

- 新增通用「自定义端点（OpenAI 兼容）」：可用 LM Studio / mlx_vlm.server / mlx-optiq / llama.cpp / vLLM 等任何提供 `/v1/chat/completions` 的服务；只用端点自带的 apiBase 与 apiKey，绝不回落云端凭据（未填 Key 时不发鉴权头）。地址校验允许本机回环 `http` 与远程 `https`，拒绝把凭据、查询参数或片段写进地址。
- 删除 `local-mlx` Provider 整条链路：`localMlxRuntime`、`providerConfig` 的 MLX 常量与函数、`resolveLocalMlxApiConfig`、`agentStore` 的 MLX 条目；Rust 侧删除 `commands/local_mlx.rs`（224 行）、`start_mlx_service` 注册、ACL 条目与退出时的 `stop_mlx_service`。
- 新增 `isLocalLikeProviderId()`（本机 Ollama 或已注册自定义端点），统一本地/自定义端点的 `32K/4K` 预算、`local` 运行时与不启用 responses/reasoning；本地与自定义模型声明 `text+image`，修复 VLM 收不到图。
- 设置页 Ollama、自定义端点、@Jev 打分器、本机 ComfyUI 收进可折叠的「本机模型与服务」，默认收起并显示状态摘要。
- 验证：`vue-tsc -b`、`pnpm run lint`（exit 0）、聚焦 `1510/1510`、`cargo check` 与残留引用 grep 通过；真窗口 UI 与 mlx_vlm / LM Studio 真实服务未验收。净删 303 行。

## [2026-09-25] 重构 | 账号登录与模型调用 Key 解耦（阶段 1：客户端）

- 一键登录只建立云端身份与同步会话：`gatewayLogin` 不再解析或保存 `api_key`，登录响应即使带 `api_key` 也一律忽略，也不覆盖用户已填的 Key；`handleLogin` 不再回填 Key 输入框。同步链路本来就只认 `X-JC-Session`，不受影响。
- 「一键抄配置」改为只在已有 Key 时生成配置文本，无 Key 时禁用并提示「请先填写并保存 API Key」；删除自动建 Key 通道 `createAutoGroupApiKey` 与整个 `newApiOneClickLogin.ts`（含无调用者的 Web 回跳 intent 机制）及其测试。
- 文案：`getCloudRequiredMessage` 明确「账号登录只开启云端同步」并指向「管理密钥」页面与本地模型；登录态改为「已登录，云端同步已启用」；输入框标签由「API Key」改为「模型调用 Key」。
- 范围：本轮只动客户端。服务端 `/auth/login` 仍返回 `api_key`（`ensureLegacyManagedTokenKey` 同时被服务端聊天代理 `gateway/src/newapi.js` 使用，不能删），留待云端阶段；浏览器登录 deep link 回调（`main.ts` 的 `consumeApiKeyCallbackUrl`）同为待完善项。
- 验证：`vue-tsc -b`、lint（exit 0）、聚焦 `1505/1505`（含新增 `src/components/auth/__tests__/loginKeySeparation.test.ts`）通过；用户真机实测正常使用（登录后 App 可正常使用）。

## [2026-09-25] 定位 | 平台收缩：桌面为唯一主产品，Web 只留下载展示，Mobile 冻结待改造为控制器

- 决策依据：Harness 只在 Desktop 进程内运行（`src/services/deepSeekHarness.ts` 持有 Session），Web / Mobile 无法复用，两端长期只能提供半残能力，继续维护只会分散精力。
- 桌面端**零改动**：本次不改任何桌面功能与代码，并在 `AGENTS.md` 写成硬约束「桌面端只增不减」。
- Web：保留 `https://jiucaihezi.studio` 域名与现有 `public/` 展示页（landing / help / support / terms / privacy），删除 Web 端记忆工作台（「体验」）——代码改动待实施。
- Mobile：代码暂不动，现有 App 冻结；目标形态是桌面 App 的控制器。
- 移动端调研（下一步选型）：Happy（MIT，23.9k★，最接近目标形态）、VibeTunnel（不自建中继的路子）、Omnara（云端 agent 控制面，方向相反）。结论：以 Happy 为蓝本但去掉 CLI 包装层 —— Harness 已是进程内运行时，只需给 Session 加远程通道。
- 涉及：`AGENTS.md` 平台能力段与产品边界段、`docs/wiki/架构/产品架构.md` 第 3 节。真实代码改动（Web 体验删除）尚未执行。

## [2026-09-26] 接入 | 本机 ComfyUI 的 Qwen-Image 2.1 与 MiniMax H3 以 jc- 前缀进 NewAPI 与创作面板

- 新增 `comfy-adapter/`：把本机 ComfyUI（RTX 4090）封成 OpenAI 兼容接口，源码入仓、独立 venv（Python 3.13）、只监听 `127.0.0.1:9000`；对外暴露一律走 frp 隧道（kcp over UDP 7000 + tcp 7000，出口 `remotePort=8796`）。
- NewAPI：渠道 140「本机 ComfyUI 4090（comfy-adapter）」，`base_url=http://frps:8796`（容器内网名，不暴露公网），模型名即面板公开名 `jc-qwen-image-2.1` / `jc-minimax-h3` / `jc-minimax-h3-ref2v`，价格 0.2/张、0.2/秒。SSRF 端口白名单追加 `8796`。
- 面板注册 5 个 `jc-` 模型（下拉新增「jc 本机」分组）：图片 `jc-Qwen-Image 2.1`（不给参考图＝文生，给图＝单图/多图编辑，最多 10 张）；视频四条 `jc-MiniMax H3`（文生 / 首帧 / 首尾帧 / 参考生），成片经 NewAPI 的 `/v1/videos/{id}/content` 回收。
- 尺寸改成能看懂的说法：档位＝长边（1K=1024、2K=1920）×常规比例，**4K 给不了**（两个模板的 `max_size` 都是 2048）；表由 `scripts/gen-jc-sizes.mjs` 按模板 `constraints`（图片 8 的倍数、视频 32 的倍数、像素 ≤2.1MP）推导并校验，比例误差 <1%。图片默认 2K 竖屏 `1080×1920`；视频 9:16 的 2K 是 `1088×1920`（32 的倍数）。
- 参考生视频：模板节点 29 是 `ResolutionSelector`，`aspect_ratio` 可以绑（`bind.aspect_ratio -> 29.aspect_ratio`），枚举必须带后缀（如 `9:16 (Portrait Widescreen)`）；`megapixels` 仍由 `mode` 决定。界面上**去掉档位、换成比例**，`mode` 退回工作流默认 0。
- 图片结果改走 `response_format: b64_json`：适配器的 `public_base_url` 是 Docker 内网名 `frps:8796`，桌面客户端解析不了；改成 `127.0.0.1` 又会被 `src/utils/urlSafety.ts` 的私有地址校验拦下 —— 只剩内联回收一条路。新增规格级 `imageResultFormat`，只对 jc 图片模型生效，其它图片模型行为不变。
- 验证：`vue-tsc -b` exit 0；定向测试失败集合与基线逐项一致（47 项，全落在 creationPanel 契约 / filetree / memoryWorkbench / scene3d / skillMaterialRuntime / prune-updates，本次**新增 0**，`runtime/creation` 与 `data` 域 0 失败）；`comfy-adapter` 自检 `app.py --check` 四步全绿；`tools/verify_newapi_contract.py` 19/19。
- **已实测**：图片文生成功并落盘（b64 路径通）。
- **已实测**：视频端到端跑通（2026-09-26 10:42，面板绿勾并落盘 `.raw/jc-media/视频/...mp4`）。路上逐个修掉三处：参考图把 Tauri 本地地址直接透传给远端（改成先上传）、改了 meta 但没重启适配器导致比例失效、异步提交回 202 被 NewAPI 当成失败。
- 供应商可直接使用：`docs/wiki/运维/韭菜盒子本机ComfyUI图片模型API对外接入-2026-09-26.md`、`docs/wiki/运维/韭菜盒子本机ComfyUI视频模型API对外接入-2026-09-26.md`。
- 运维记录见 `docs/wiki/运维/本机ComfyUI模型对外接入-2026-09-26.md`（含端口漂移、适配器父+子进程模型等坑）。

## [2026-09-26] 决策 | 撤下本机图片模型 jc-qwen-image-2.1，本机只跑视频

- 用户决定：图片模型有多个备选，本机只留视频；「服务器里不用删除，等我以后再买电脑单独部署图片模型就行了」。
- 根因是**显存**，不是质量：H3 权重栈（UNET 19.53GB + 32B CLIP + LoRA + 潜空间上采样）与 Qwen-Image 栈合计超过 48GB，而真实用法是图片/视频交替，每次切换必然整栈重载，切换过程会把显存顶满甚至卡死 ComfyUI（已实测：探针换栈后连 `/interrupt` 都够不到，用户的视频任务排队 300 秒被拒）。
- 客户端改动（本仓库）：
  - `creationModelRegistry.ts` 删除 `jc-qwen-image-2.1` 规格；`mediaModelCapabilities.ts` 删除对应面板条目与 `JC_IMAGE_SIZE_OPTIONS` / `JC_IMAGE_SIZES`。
  - 只为它存在的规格字段 `imageResultFormat` 一并删除（`creationMediaTypes.ts`、`creationMediaPlan.ts`、`useCreation.ts` 三处取值改回固定 `'url'`）—— 留死代码就是留补丁层，将来接回时这条链路必然一起回来（`git log` 可查）。
  - 视频侧一律不动：`isLocalAssetUrl` / `uploadCreationAsset` 仍然必要（视频参考图同样是 Tauri 本地地址），四个 H3 模型、`JC_VIDEO_SIZE_OPTIONS`、`JC_H3_RATIO_OPTIONS` 全部保留。
- 服务器端**不动**：`comfy-adapter` 的 `qwen-image-2.1` 模板与工作流、frp 隧道、NewAPI 渠道 140 的模型映射都留在原地；只有 NewAPI 里的模型与价格条目由用户自行删除。
- 文档：图片供应商文档保留并加「当前未上线」标注（接回时合同不用重写）；视频供应商文档里「与图片模型共享同一个队列」的说法同步修正；运维文档新增一节说明取舍，以及将来真要混跑的两条路（适配器换模板前 `POST /free`，或 ComfyUI 带 `--disable-smart-memory` 启动）。
- 验证：`vue-tsc -b` exit 0；`jcComfyAdapterPlan.test.ts` 10/10 全绿；全量聚焦测试 **fail 50 → 47**（顺手修掉 3 条过时断言：尺寸标签用全角 × 导致像素比较失败、ref2v 的 `mode` 断言在「去档位改比例」时已失效），本次新增 0 失败。

## [2026-09-27] 实施 | Harness 输出显示对齐官方：过程与推理挂到轮次上

- 用户先要求对比我们产品与 DH 官方 GUI 在输出显示上的差别，再问「对照官方优化升级适合我们的方案是什么」；定案见 [[开发/韭菜盒子Harness输出显示对齐官方TDD-2026-09-27]]。
- 结论：差别不在运行时能力，而在投影层。同一批 Session 事件，官方投影成结构化会话节点，我们只留正文——`deepSeekAssistantText` 只取 `text` 块、`applyDeepSeekAssistantStream` 只认 `text-delta`、`deepSeekProgress` 只给 `{id,label,state}`，于是纯工具步（`assistant/message` 只有 `tool-call` 块、无正文）根本不产出 turn。真样本实测：一整轮 10 个工具步、11 次工具调用、约 1 分钟，在产品里完全不可见。
- 第一档只补投影与显示，**运行时 0 处改动**：新增 `deepSeekAssistantReasoning` / `deepSeekMessageUsage` / `deepSeekSessionProcess` / `deepSeekSessionReasoning`；`deepSeekProgress` 补参数摘要（白名单）、`startedAt`/`endedAt`、`resultText`（截断 4000 字）、`errorReason`；服务新增 `onReasoning`，实时推理与正文分开累积；UI 在轮次内渲染 Think 折叠行与工具行（摘要 + 时长 + 展开结果），过程不再只在「正在运行」时可见。
- 过程不需要新的持久化格式：Harness 对话以 Session 为唯一真源，`mergedHarnessTurns` 每次打开重建，所以过程按 UI 轮次侧存，`ConversationTurn` 与旧 Raw 序列化格式不动。
- **实施中发现的根因修正**：归属必须落在**本轮发起人**（该轮 `source.kind === 'user'` 的消息）上，不能落在 assistant message 上——后者对纯工具步（无正文）不产出 UI 轮次，挂上去等于过程仍然不可见，那个锤点就没解决。没有真人发起人的注入式轮次退回该轮 assistant message id 兜底；`deepSeekSessionTurns()` 与两个投影共用 `deepSeekUserMessageId()` 防键名漂移。过程与 Think 行因此渲染在用户轮次的正文之后（「问 → 它做了什么 → 答」）。
- 三条合同**由真样本确定而非推测**（本机工作区经官方 `session/read`，未解析 `$DSH_HOME` 物理文件，已裁剪脱敏为 30 事件 / 24.8 KB 的 fixture）：① 事件顺序 `step/start` → `assistant/message` → `tool/call` → `tool/result` → `step/end`，故按 `{turn, step}` 归并；② 参数键实测 `file_path`（`read`/`read_image`，不是 `path`）、`path`+`pattern`（`glob`）、`command`+`description`（`pwsh`）、`name`（`skill`）；③ 失败的 `tool/result` 可以 `isError: true` 而 `error` 整个是 `undefined`，失败原因必须回退到结果正文首行。
- 同时回答了一个影响后续决策的问题：**上游目前不产生推理**（真样本 16/16 无 `reasoning` 块、嵌入式 stream 无 `reasoning-chunks`）。根因指向 route patch 未声明 `reasoningEfforts`（自定义模型 id 不在已安装目录里，而 `llm-pi-ai` 的规则是「省略该字段时保留已安装目录条目的能力」）。Think 行因此休眠，要让它出现属独立决策。
- 明确不做：不引入官方 `@deepseek-ai/dsh-client-ui-*`（插件化 React，我们是 Vue）、不做 Trajectory 表格与 StatsPills、不做审批交互（官方 SDK 协议明说 server→client 请求从不发送）。同一轮多个 assistant step 的 turn 级分组也留到第二档，本档轮内仍会出现多个答案气泡。
- 验证：新增 11 条用例（含真样本 fixture 断言）；定向 `121/121`；完整 focused `1545 tests / 1537 pass / 0 fail / 8 skipped`、Rust `422 passed / 0 failed / 1 ignored`、`exit=0`；`vue-tsc -b`、`pnpm run lint`、`git diff --check` 通过。**真机已验收通过**：过程行在真实 Desktop 上可见且刷新后仍在。

## [2026-09-27] 根治 | comfy 成片「保存到项目失败」：content 端点判据有四处各写一份

- 用户实测报错：`保存到项目失败：HTTP 下载失败: error sending request for url (http://frps:8796/files/20260927-09e058eaedbb4652.mp4)`。三段证据表明**成片已经生成成功**：适配器 `static/` 下有该 15.4 MB 文件、`adapter.log` 里任务 `task_20260927_4fed141a05f7` 执行 596 秒后 succeeded、App 的任务记录 `status = success`。所以坏的只有下载这一步。
- 根因不在网络：`frps:8796` 是 **frp 隧道出口端口**（`comfy-adapter/deploy/frps.example.toml` 的 `allowPorts`），只绑在容器内部、不进 VPS 宿主端口表，Windows 宿主上的桌面客户端解析不了 `frps`，失败发生在 DNS 阶段。而「这条成片要不要走 NewAPI `/v1/videos/{id}/content` 回收」这个判断在代码里有**四份且互相矛盾**：首轮轮询（`creationMediaRuntime.ts`）按 apiStyle 白名单，`comfy-*` 走 content；保存/重试/刷新路径（`mediaTaskStore.ts`）只认 omni 或直接硬编码 `false`。对 `comfy-video` 两边结论相反，于是保存路径调用 `pollTask(..., false)`，把已经正确的 content 地址**覆盖成了适配器回的内网地址**。
- 修法（根因，不是症状）：`usesNewApiContentEndpoint()` 收成唯一判据（`creationMediaPlan.ts`），四处 `pollTask` 调用点与重试守卫全部改用它；`normalizeAuthenticatedVideoResultUrl` 不再判断旧地址长得对不对，而是**按已知的上游任务号重建** content 地址——这样已经被写坏的历史任务点「重试保存」也能救回来，不需要重新生成、不产生新计费。
- 排障方法记进热缓存：App 的任务记录在 `%APPDATA%\com.jiucaihezi.desktop\data\jiucaihezi.db` 的 `kv_store` → `jc_media_tasks_v1`（**双重 JSON 编码，要 parse 两次**），里面有 `resultUrl` / `upstreamTaskId` / `pollUrl` / `planSnapshot.apiStyle`，比看界面猜快得多；适配器侧看 `comfy-adapter/logs/adapter.log`。
- 验证：新增 3 条用例（唯一判据单元测试、四处调用点契约测试、内网地址重建的行为测试，后两条先红后绿）；完整 focused `1548 tests / 1540 pass / 0 fail / 8 skipped`、Rust `422 passed / 0 failed / 1 ignored`；`vue-tsc -b`、`pnpm run lint`、`git diff --check` 通过。
- **真机验收通过**：新任务（11:05）与那条被写坏的旧任务（10:18）**都落盘了**；旧任务的成片与适配器产物逐字节相同（15,386,931 bytes），所以“卡住”实际上是 14.7 MB 走“客户端 ← Cloudflare ← Nginx ← NewAPI ← frp 隧道 ← 本机”的 **3 分 11 秒**（≈ 80 KB/s），慢与卡在界面上无法区分。
- 验收同时暴露两个独立缺陷（以前那个永远失败的地址让它们进不到下载阶段）：① 同一任务会**并发下载**（项目目录里同时出现两个同任务 `.part` 文件）；② 后到的失败会**覆盖“已保存”状态**——文件已在项目里，卡片却显示 `保存到项目失败：读取下载数据失败: error decoding response body`。两者已修复，见下条。

## [2026-09-27] 根治 | 保存链路两项修复：并发下载与“失败覆盖成功”

- 真机验收（15,386,931 bytes 逐字节一致）同时暴露两个独立缺陷，用户要求一起修：① 同一任务**并发下载**；② 后到的失败**覆盖已保存状态**。两者都是以前那个永远失败的地址挡住、进不到下载阶段才没发病的。
- 缺陷②的根因是**异常被吞掉，状态被写了一半**：`downloadAndPersistMediaAsset` 自己 catch 掉下载异常、各自写 `assetStatus`/`errorMsg`，然后正常返回；上层 `completeMediaTask` 当它成功，又写了另一半（`progressText=完成`）。DB 里因此出现自相矛盾记录：`progressText=完成` + `assetStatus=remote-only` + `errorMsg=保存到项目失败：读取下载数据失败: error decoding response body` + `projectPath` 为空——“文件在但卡片红”就是这个组合。
- 修法（单一职责点，不是打补丁）：① `savingTaskIds` 做成**唯一互斥点**（`completeMediaTask` 开头 `return`），并加**终态保护**（`assetStatus === 'local'` 且已有 `projectPath`/`assetUri` 时直接返回）；② 下载函数的异常一律上抋（原始 `cause`、HTTP 非 2xx、空结果都变成异常），失败状态**只由 `handleAssetDownloadFailure` 一处写**，`markWebMediaPersistenceFailure` 不再把 `local` 降级为 `remote-only`。
- 证据：项目视频目录里同时存在两个同任务 `.part` 文件（下载过程中直接 `Get-ChildItem` 看到，12 秒后一个消失一个继续长）；同一条任务的 DB 记录如上自相矛盾。
- 明确不做（用户 2026-09-27 决定）：保存阶段的**进度反馈**。已实现的 Rust 事件 `creation:download-progress` + 前端 `listen` 订阅已**回滚**，`src-tauri/`、`src/utils/projectMediaWriter.ts` 无改动，所以本次不需重新编 Rust、也不用重启 App。
- 验证：媒体用例全绿（新增 2 条：失败必须走失败分支、保存单一互斥点与终态）；完整 focused `1550 tests / 1542 pass / 0 fail / 8 skipped`、Rust `422 passed / 0 failed / 1 ignored`、`vue-tsc -b` 通过。

## [2026-09-28] 优化 | DH 支线三项：会话级权限、附件路径、实时过程进消息流

- 背景：用户决定继续用 DH（自研内核保留但当前无线上入口），从 `main` 开支线 `0928-DHyouhua` 做三项优化（手机端 WIP 已先在 `main` 提交为 `32f6387d`，支线与之不互相干扰）。
- ① **会话级权限**（根因非推测，从真实会话文件解出）：`permission/preset=workspace-write` + `sandbox/mode=workspace-write` + `approval/policy=ask` 就是会话里记下的 durable 事实。官方 `pinInitialPermission` 对**已存在**会话保留它自己记下的开关，进程级 `DSH_PERMISSION_MODE` 只决定新会话默认值 —— 所以打开 `@文件` 也松不开老会话的沙箱，写 `~/.agents/skills` 被判 `file access denied under workspace-write mode`（用户报的「没有权限」）。修法走官方命令面：第 5 处 vendor patch 暴露 `session/permission` → `commands.execute(agent, '/permission <preset>')`，客户端每个 (runtime, 会话) 拉齐一次。**不得**自己写 `permission/preset` 事件绕过官方推导。
- ② **附件路径进 prompt**：原来只发 base64 图片块、从不给路径，视频连块都没有，模型只能满盘找文件（实测 11 步工具 16 分钟后 524）。现无条件附一段 `[本轮附件]` 路径清单 —— 官方读图就是 `read_image(file_path)`，视频官方也没工具，只能 `bash` 抽帧（落到已有 `jc-watch`）。
- ③ **实时过程进消息流**：`visibleRunSteps` 的「最近 5 条」只挂在输入框上方，跑完/断开即消失，用户看不到进程走到哪。DH 的实时过程改为挂到本轮发起人（`liveProcessTurnId`）上，与历史（`harnessProcess`/`harnessReasoning`）共用 `memory-turn-process` 那一套渲染，工具结果 `resultText` 也实时带。5 条缩略保留给未迁移的自研内核（Web 未发布工作台），能力不减。
- 踩到并修掉：第 5 处补丁的锚点最初落在 `session/prompt` 之后，插进第 4 处补丁那段**连续字符串内部**，使它第二次运行误判「还没打过」并抛 `Unsupported ... request server layout`（开发机只跑一次，装包/CI 会撞）。锚点改到 switch 末行（`shutdown`）之后；新增 `scripts/__tests__/deepseek-harness-patch.test.mjs` **真跑两次**守住幂等。
- 替换旧合同：`韭菜盒子Harness输出显示对齐官方TDD-2026-09-27` 里「实时列表仍需按最近 5 条收敛」被本次取代，已在测试注释里写明替换理由。
- 验证：定向 `deepSeekHarness` 38/38；完整 focused `1659 tests / 1659 pass / 0 fail`；Rust `450 passed / 0 failed / 1 ignored`；`vue-tsc -b` 通过；补丁脚本连跑 3 次 exit=0 + `node --check` 通过。
- 未验证：真机上开 `@文件` 改 `~/.agents/skills` 的 skill（需重开 App 让新 runtime 与补丁产物生效）。
- ④ **内置 Skill 对 DH 不可见（扫盘的真因，用户指出）**：用户问「`jc-duibai` 与 `jc-watch` 的区别」，模型只调到了 `skill 3d-animation-short-generator`，然后开始 `find /Users/by3 -maxdepth 6 -iname "*jc-watch*"`。根因：`jc-watch` 是**内置** Skill（`public/skills` → 打包成 `resources/skills`），而官方 skill 扫描根只覆盖项目与用户目录 —— `bundledSkillDir` / `DSH_BUNDLED_SKILL_DIR` 都没配，就没有 rank 600 的 `bundled` 根，四个内置 Skill 对模型完全不存在。修法：DH runtime env 加 `DSH_BUNDLED_SKILL_DIR`（dev/prod 双路解析复用 Rust `preset_skills_src`）。
- ⑤ **输出对齐官方 GUI 四条**：运行中不再挂「正在执行 05:23」横幅（官方轨迹视图明确不给在飞记录臆造 elapsed），状态改由轮次内过程行表达；思考行改带最新一行预览（官方 Chat 的 reasoning previews）；新增在飞标记「思考中」——等模型那 83 秒 / 一分多钟不再看起来没动静；已完成的轮次折叠过程行（官方 fold completed-turn process rows），用 `:open="isLiveTurn(turn.id) || undefined"` 以免抢用户手动展开的状态。自研内核（Web 未发布工作台）保留原 5 条缩略。
- 失败取证（用户报「10 分钟后 524」）：两条 attempt 都是 `usage 0/0` 后 `finish error 524 status code (no body)`，各 126 秒；524 = Cloudflare 源站超时，即**上游 100 秒没吐第一个字节**。该轮上下文只有 27k token，所以**不是**扫盘撑爆上下文（不拿错的理由顶罪）。用户 2026-09-28 决定上游/抖动问题另找时间专项解决，本轮只记证据不做改动。
- 验证：定向 `deepSeekHarness` 42/42；完整 focused `1663 tests / 1663 pass / 0 fail`；Rust `453 passed / 0 failed / 1 ignored`（含新增 3 条）；`vue-tsc -b` 通过。替换了两条旧断言（`!runVisible` 状态条口径、过程区 `v-if`）并写明理由。
- ④ 落地时踩到的第二个坑（用户真机 0.00 秒失败）：`forbidden path: .../src-tauri/target/debug/skills, maybe it is not allowed on the scope for allow-exists permission`。根因不在路径，在**权限**：`@tauri-apps/plugin-fs` 的 `exists()` 除 `fs:allow-*` 外还受 `capabilities/default.json` 的 `fs:default` scope 白名单约束（只放行 `$APPDATA/**`、`$HOME/.agents/**` 等 7 条），越界**抛错而不是返回 false**，于是探测把整个 run 打死。修法：探测移进 Rust（`commands::tools::bundled_skills_dir`，`Path::exists()` 无 ACL），前端只 `invoke('resolve_bundled_skills')`；同时把 `lib.rs` 播种里那份重复探测收敛到同一实现。新命令按惯例登记 `permissions/app-commands.json`（acl-manifests 命中 1 已核）。没有往 fs scope 里加路径——那是安全收缩面，`scripts/check-tauri-fs-script.mjs` 在守。

## [2026-09-28] 优化 | Harness transcript 对齐官方：一轮一条记录 + 逐字抄官方谓词

- 触发：用户看到界面上连续出现三个空的「韭菜盒子」。取证（最新会话 turn 7）：三步的正文分别是 `'\n\n'`、`'\n\n'`、`'搞定 ✅'`（textLen 2 / 2 / 341）。
- 根因（数据层，非样式）：`deepSeekSessionTurns` 用 `if (content)` 判空 —— `'\n\n'` 是**真值字符串**，于是纯工具步也被当成「有正文的助手轮次」，而渲染层又无条件画角色名，就留下一个孤儿标签。
- 用户要求直接对齐官方 GUI。**先去官方包里取证再动手**（上一轮在“官方长什么样”上猜错过一次）：`dsh-client-ui-chat` 的 `visibleAssistantEvent` / `hasAssistantReplyContent` / `latestAnswer` / `processSpec` / `turnProcessDefinition`，规则逐条抄进实现（详见 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.5）。
- 三条偏差一次改掉：① `text` 块 `trim()` 后判空；② 只认 `surfaceOp === 'append'`（实测本机会话已有 28 条 `{op:'replace'}`，以前会把被压缩替掉的旧范围也显示给用户）；③ **一轮一条 assistant 记录**（官方是一过程节点 + 一答案节点），中途叙述改归过程（`kind: 'narration'`）。
- 两个自己踩到并修掉的坑：**`turn/end` 是 log-only 事件、不带 `surfaceOp`**（把 surface 过滤放在循环开头会把所有助手轮次一起滤掉）；**纯工具轮仍需要一条内容为空的锚点轮次**做过程挂载点，渲染层用 `turnHasBody()` 判掉 article —— 判定必须覆盖 article 的全部内容来源，否则那种内容会整块消失。
- 明写不做：官方那个「工作过程展示」开关（`settings.transcript.title`）。先让**默认形态**真对齐官方，再在正确底座上加开关，否则是在错的底座上调参数。
- 验证：定向 `deepSeekHarness` 43/43；完整 focused `1664 tests / 1664 pass / 0 fail`；Rust `453 passed / 0 failed / 1 ignored`；`vue-tsc -b` 通过。共改写 4 条既有断言（均写明替换理由）并把 3 个 fixture 补成真实事件形状（带 `surfaceOp` / 轮次边界）。

## [2026-10-01] 排障 | 面板选 4:3 出 9:16：NewAPI 只转发 TaskSubmitReq 字段，画幅与戏种从未到达适配器

- 现象：创作面板选 9:16 / 4:3，成片恒为适配器 `defaults` 的值；戏种（文戏/武戏）选了也没用。
- 三段证据（谁发的 → 谁收得下 → 谁实际收到）：
  ① App **发了**：直接跑 `buildCreationRunPlan` + `buildCreationSubmitRequest`，`videoParams.aspectRatio = "4:3 (Standard)"`，`size` 为空所以守卫不会抹掉它；面板 LocalStorage（WebView2 leveldb，值区是 UTF-16LE）里 `jc_cp_state_v3.ar` 也是 `4:3 (Standard)`。
  ② 适配器 **收得下**：`ImageGenerationRequest` 已开 `ConfigDict(extra="allow")`，`model_dump()` 保留 `aspect_ratio` / `extra_fields` / `metadata`（只有 `resolution` 被自己的整数校验器丢掉）；探针直连 `tpl.normalize()` 时三种载波都能落到节点 29。
  ③ 适配器 **没收到**：`GET /v1/tasks/{id}` 的归一化 `values` 显示 `aspect_ratio: "9:16 (Portrait Widescreen)"`，正是它自己的默认值。
- 根因：NewAPI 只转发 `TaskSubmitReq` 认得的字段（`relay/common/relay_info.go`）：`model` / `prompt` / `image` / `images` / `duration` / `size` / `mode` / `seconds` / `input_reference` / `metadata`；`aspect_ratio`、`extra_fields`、`resolution` 一律丢。**戏种从上线起就没生效过**（`mode` 同样走 `extra_fields`，历史 `戏种` 恒为 0）。
- 排除过才下的结论：适配器无辜（见②）；ComfyUI 历史里 `21:9` / `3:4` / `1:1` 那几笔是**直连适配器**的手工测试（适配器任务记录里有 `ratio` 字段与固定种子 `20261100` / `20261101`），不是面板成功 —— 别被「直连能跑通」误导成「NewAPI 也能跑通」。
- 临时修法（已实施，待实测）：自定义参数除顶层 + `extra_fields` 外**再镜像一份到 `metadata`**（`metadata` 是 NewAPI 唯一保留的自定义槽位，RH 链路 `metadata.rh_aiapp` 已被用户确认可用，官方内置插件也普遍用 `metadata`）；适配器 `adp/template.py` 的 `normalize()` 把 `extra_fields` 与 `metadata` 里的**标量**摊平回顶层（嵌套对象如 `rh_aiapp` 不摊平，顶层已有的优先）。
- 验证：改写 2 条断言（`extra_fields`、`metadata`），撤回源码 → 精确 RED，恢复 → GREEN（5 个文件 170 例全绿）；适配器探针 7/7（含 metadata-only、嵌套对象忽略、顶层优先）；`app.py --check` 四步全通过。
- **未验证**：`metadata` 对**本机 comfy 渠道**的实测尚未做（RH 是另一条渠道）—— 需真跑一笔；适配器还需重启才加载新 `template.py`。
- 顺带修掉两个环境坑：`cargo` 会把 crates.io 请求发给已关闭的 `127.0.0.1:7897`（来源没找到，`*.cargo/config.toml`、环境变量、系统代理都排除了，而 `curl` 直连正常）→ 用 `NO_PROXY` 绕过；`pnpm run tauri:dev` 挂在前台终端会被回收并连带杀掉整棵进程树 → 改用 `Start-Process` 脱离终端启动。
- 方案（待审，未实施）：[[运维/本机ComfyUI接入NewAPI任务插件通道SDD-2026-10-01]] —— 换 type 61「Task Plugin」渠道 + 自写 `comfy` 插件，`decodeRequest` 拿原始 body，从根上不再丢字段。

## [2026-10-01] 决策 | 适配器统一收编为 NewAPI 任务插件（分波推进，不做一次性全下岗）

- 触发：用户提出把 `rh-adapter` / `boluo-minimax` / `seed-audio` / `kik` / `zx-video` 全部收编，让适配器下岗，并授权直接判断。
- 盘清家底（全仓 8 个适配器 + 2 个非生成服务）后的三条决策：
  ① **不做一次性全下岗**：每波必须真出片 + 核计费 + 成片下载 + Range 四项验收完，才动下一个；新通道验收通过前旧适配器与旧渠道一律不动。
  ② **先试「官方插件直用」再谈自写**：`kik-seedance-adapter` 的上游是 `https://51kik.com/providers/volcengine` + `/api/v3/contents/generations/tasks`，而官方 `doubao`（火山 Ark）插件拼的正是 `ctx.baseUrl + "/api/v3/contents/generations/tasks"` —— **base URL 指到 51kik 就逐字相同**，且 KIK 模型名本来就是火山名（`doubao-seedance-2-mini`）→ 可能**零代码下岗**。
  ③ **三个永不下岗**：`comfy-adapter`（执行器：模板渲染/ComfyUI 提交/Topaz/成片存储，插件无网络无 fs 装不下）、`seed-audio-adapter`（走 `/v1/audio/speech`，而宿主协议只有 `openai_responses`/`openai_video`/`openai_image`，**没有音频**）、`attachment-processor` 与 `document-converter`（非生成任务）。
- 波次：Wave 0 = `comfy`（方案已定，自写插件）→ Wave 1 = `kik`（零代码试验）→ Wave 2 = `boluo`（最简自写，模板定型）→ Wave 3 = `dola` / `shanhai` / `xiaoyi-image` → Wave 4 = `zx-video` → Wave 5 = `rh-adapter`（最复杂，最后做）。
- 未决（Wave 1 唯一风险，要真跑才能判）：官方 `doubao` 插件的 `meta.models` 未确认是否声明 `doubao-seedance-2-*`；未声明的话该模型可能落到内置 relay 而不是进插件 —— 判定卡已写进方案 §5。
- 适配器代码**保留为「翻译逻辑的事实源」**，下线只删部署（Docker/compose/端口/计划任务），代码删除另开提交并先确认无调用者。
- 方案：[[运维/适配器收编任务插件总方案-2026-10-01]]（含分类表、铁律、Wave 1 试验卡与判定）。

## [2026-10-01] 实施 | Wave 1 定为 boluo：自写插件正稿 + 13 例夹具落盘

- 用户明确主力是 `dola-seedance` / `rh-adapter` / `boluo-minimax` / `shanhai` + 本机 ComfyUI，并指定先用 `boluo-minimax` 试。所以**波次从「好写优先」改成「主力优先」**：Wave 1 = boluo（自写模板定型）→ Wave 2 = dola（主力）→ Wave 3 = shanhai → Wave 4 = rh-adapter → Wave 5 = kik / xiaoyi / zx（非主力）。kik 由原 Wave 1 降级（它只是**可能**零代码，不是主力）。
- 产物（TDD，先夹具后实现）：`newapi-plugins/__tests__/boluo.test.mjs`（RED：模块不存在 → GREEN 13 例全过）与 `newapi-plugins/boluo.plugin.js`；夹具已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`。
- 事实源是 `boluo-minimax-adapter/src/main.py`，逐条搬过来：`ref_image_N` / `ref_audio_N` 摊平、时长 1~15 与模型默认值（旧版 15 / 增强版 5）、**方向只认 `resolution` 后缀**（`aspect_ratio` 仅在缺 `resolution` 时推导，两者矛盾必须 400）、图 ≤9 音 ≤3、seed 非负整数、prompt ≤12000。
- 与适配器的三处**有意**差异：① 任务号改用上游真实 id（宿主自己持久化任务行，不需要当年那层「立即返回本地 id」的间接）；② **顺手消掉适配器的 7 天内存任务表**（重启即丢，README 自己写着的故障面）；③ 成片不返回上游 URL（带临时 token，走宿主 `/content` 代理）。
- 计费：两个模型单价不同 —— 旧版 `0.08/秒`、增强版 `0.1/秒`，走 `usageSchema.seconds` + `u("seconds")` 表达式。
- 已知边界（写进方案，避免下次误判）：上游**不支持 Range**（总是完整字节流），所以 boluo 这波不能要求 206；参考素材透传的 Worker KV TTL 只有 15 分钟，排队超时可能取不到素材；上游 create 现在是**同步**等的（适配器当年改成后台提交），慢过宿主提交超时会退化成提交失败 —— 这是本波唯一未验的时序风险。
- 未验证：插件未上传、渠道未建、未真跑一笔（管理员页动作在用户侧）。

## [2026-10-01] 实施 | Wave 0 落地 comfy 插件：10 例夹具全绿，画幅与戏种从根上不再被丢

- 触发：用户对「要不要现在把 comfy 插件也写出来」回答「要」。comfy 是**当前主力**（它既是面板在用的线路，也是「选 4:3 出 9:16」这条 Bug 的现场），所以它插到 boluo 验收之前做。
- 产物（TDD，先夹具后实现）：`newapi-plugins/__tests__/comfy.test.mjs`（RED：模块不存在 → GREEN 10 例全过）与 `newapi-plugins/comfy.plugin.js`；夹具已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`（紧随 boluo 一行）。文档同步：[[运维/本机ComfyUI接入NewAPI任务插件通道SDD-2026-10-01]] §4 改为「已落地 + 草案差异表」，§5 步骤 1 标完成。
- 核心是**无脑透传**：`decodeRequest` 把客户端原始 body 直接当 `requestBody` 交出去（`meta.protocols` 只声明 `openai_video`，`action` 由首/尾帧或 `images` 推导）。夹具第一条断言就是「同一份 body 里的 `aspect_ratio`、`extra_fields.mode`、`metadata.mode` 三处都能读到」—— 这条以后就是防回归的锁。
- 不重复适配器的活：不做 clamp、不做枚举、不做 17n+5 帧对齐（那是 `adp/template.py` 的 `constraints` 职责）。插件只留三条快速失败：prompt 非空、model 认得、duration 是正数（且必须是 number，`"3"` 这种字符串也拒），避免白占额度。
- `meta.models` = `['jc-minimax-h3', 'jc-minimax-h3-ref2v']`，是逐个核对 `creationModelRegistry` 四个条目得出的（三个模式共用前一个对外名）；渠道再映射成适配器内部 id，`buildSubmitRequest` 用 `ctx.upstreamModel || ctx.model` 兜底，避免没配映射时发出 `model: undefined`。
- 与草案不同的三处（对照官方文档 + boluo 插件校准）：未知状态一律 `UNKNOWN`（绝不伪装 `IN_PROGRESS`，否则轮询永远不失败）；失败原因取响应体 `fail_reason` / `error` / `message`；结算时长优先取 `body.params.duration`（适配器归一化 clamp 后的实际值），退回 `body.duration`。
- 有意**不返回** `metadata.url`：插件通道下那就是适配器的内网地址 `http://frps:8796/...`，外泄等于泄露网络布局。成片继续走宿主 `/content` 代理 —— 适配器支持 Range，所以 comfy 这波**可以**要求 206（与 boluo 相反，boluo 上游不支持）。
- 未验证：插件未上传、type 61 渠道未建、未真跑一笔。另外 `comfy-adapter` 仍需重启才会加载 `adp/template.py` 里 `extra_fields` / `metadata` 摊平的改动 —— 那是**旧渠道 140 的即时修法**，与插件通道并行存在。

## [2026-10-01] 实施 | Wave 2 落地 dola 插件：否证「官方插件直用」，12 例夹具全绿

- 触发：用户对「接着写 dola 吗」回答「要」。dola 是用户点明的主力线路之一。
- **判定否证**：原假设「dola 疑似 Ark 兼容 → 可能零代码用官方 `doubao` 插件」**不成立**。实测上游是 `https://43.254.166.145/api/v1/videos`（自家形状，不是 `/api/v3/contents/generations/tasks`），官方插件路径逐字对不上 → 只能自写。
- **决定架构的发现**：上游创建接口**只吃 `multipart/form-data`**，规格原文写死「图片必须上传实际文件，不能用图片 URL 或 Base64 文本代替；文件字段名必须为 `images[]`」。插件没有 `fetch`/`fs`，拿不到图片字节 → **物理上做不到**。所以 `dola-seedance-adapter` 归入**不下岗的执行器**（与 `comfy-adapter` 同类），插件只做代理，把 `ratio` 送到它手上。方案里「不下岗的三个」改成四个。
- 顺手核到宿主 v1 契约里确实有 `bodyType: "multipart"` + `parts[].fileRef`，但 `fileRef` 只指**客户端 multipart 上传**进来的文件（`ctx.files`）；App 走 `assetFlow: newapi-upload` 发的是 URL，`ctx.files` 为空 → 这条能力本波用不上。
- **本波真正修掉的 Bug**：面板提交时顶层同时发 `ratio` 与 `aspect_ratio`（`buildDirectVideoBody` 通用尾段，`creationMediaRuntime.ts` 955-956 行），两者都**不在** `TaskSubmitReq` 白名单里 → 适配器永远落回自己的 `16:9` 兜底。**面板选 9:16 出 16:9，一直是这条**，与 Wave 0 同一个根因 —— 主力线路一直在丢画幅。
- 产物（TDD，先夹具后实现）：`newapi-plugins/__tests__/dola.test.mjs`（RED：模块不存在 → GREEN 12 例全过）与 `newapi-plugins/dola.plugin.js`；夹具已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`。文档同步：[[运维/适配器收编任务插件总方案-2026-10-01]] §2 分类、§4 波次、§5 新增 Wave 2 判定卡、§6 改为「不下岗的四个」、§7 补两条风险。
- 有意**不整份转发**适配器快照：快照里的 `id`/`task_id` 是上游任务号，而面板的 `extractTaskId` 会**优先读嵌套的** `data.task_id`/`data.id` —— 整份转发会让它拿着上游号去查 NewAPI 的公开任务号（`task_xxx`）。`render` 只给面板要的 `video_url` + `error`。
- 有意**不导出** `listArtifacts` / `buildContentRequest`：适配器没有 `/content` 路由，成片是上游公开免签 URL，面板对 `newapi-task` 也不走 `/content`（`usesNewApiContentEndpoint` 为 false）。补上只会多一条没人走的死路。
- 计费：上游只有 `seconds: "30"` 一档（规格原文），预授权与结算都按 30 秒，杜绝「估 5 秒扣 30 秒」的差额；按 0.2/秒 即 6 元/笔。
- 状态映射：`queued`→`QUEUED`、`processing`→`IN_PROGRESS`、`completed`/`succeeded`→`SUCCESS`、`failed`→`FAILURE`，不认识的一律 `UNKNOWN`（绝不伪装进行中，否则任务永远不失败、永远占额度）。适配器查询是**无状态**的（直透上游），所以适配器重启不影响轮询 —— 比 comfy 干净。
- 新记两条风险（**未修**，避免顺手改现行 type 1 渠道的行为）：① 适配器每次请求自己 `uuid4()` 生成 `Idempotency-Key`，入参里的键被忽略 → 宿主重试提交会在上游建第二个任务、**再扣一次**积分；② 参考图张数三处不一致：上游规格与适配器是 **9 张**，而面板注册表 `max: 30`、对外文档写「最多 30 张」。
- 未验证：插件未上传、type 61 渠道未建、未真跑一笔（管理员页动作在用户侧）。

## [2026-10-01] 实施 | Wave 4 落地 rh 标准链路插件：纠正 ak|sk 错判，13 例夹具全绿

- 触发：用户「写rh」。
- **纠正两处错判**（原方案写 RH 需要 `meta.auth` 的 ak\|sk JWT 与动态节点映射）：`rh-adapter` 全仓检索 `jwt|HS256|hmac|ak|sk|accessKey|secretKey` **零命中**；上游鉴权就是 `Authorization: Bearer <key>` + body `apikey`（标准链路）/ `apiKey`（AI App）。而且适配器用的是**自己环境变量里的** `RUNNINGHUB_API_KEY`，根本不看调用方 Authorization（所以渠道密钥填什么都行）；`site: global` 的模型另要 `RUNNINGHUB_GLOBAL_API_KEY`。→ **不需要 `meta.auth`，也用不上 `utils.jwtSignHS256`**。
- **边界判定**：**音频**不进插件（这些模型的 App endpoint 是 `/v1/audio/speech`，而宿主只有 `openai_responses` / `openai_video` / `openai_image`，**没有音频协议**）；`z-image-turbo` 不进插件（与本机 comfy 条目**撞名**，收进来会截胡）。这两类继续留在旧 Custom Channel。
- **同日更正（重要）**：初版还排除了 AI App（`rh-aiapp*`），理由是「换 RH `fileName` 令牌要下载再上传，插件做不到」。**该理由不成立** —— 插件走的是**代理**（插件 → 适配器），换令牌本来就发生在适配器内部，插件不需要下载能力；我把「适配器要干的活」误当成了「插件的阻断」。已改为一并收编：`meta.models` 加 4 个 AI App 视频模型（`rh-aiapp` / `rh-aiapp-director` / `rh-aiapp-digital-human` / `rh-aiapp-fast-digital-human`），并补两处适配：① `render` 透传 `ai_app`（面板据此带 `?ai_app=true` 直连适配器）；② 查询口改走 `GET /tasks/{id}?ai_app=true`（标准口查不到 aiapp 任务）。
- **收编范围**：35 个模型（7 图 + 24 标准视频/3D + 4 个 AI App 视频），走 `openai_video` + `openai_image` 双协议代理 `http://rh-adapter:8789`；提交打到 `/v1/videos` 或 `/v1/images/generations`，查询走适配器**专为 NewAPI 准备**的 `GET /v1/videos/{taskId}`（AI App 走 `/tasks/{id}?ai_app=true`）。媒体是公网 URL，适配器 `maybe_upload` 对标准模式**原样透传**（只有 `data:` 才上传）→ 插件不需要下载能力。
- **本波真正修的 Bug**：面板把画幅/分辨率发在顶层 `aspectRatio`/`aspect_ratio`/`ratio`/`resolution`、模型独有字段发在 `extra_fields`，全在 `TaskSubmitReq` 白名单之外 → 适配器只能吃 capabilities 的默认值。这也解释了当年为什么给 AI App 路径加 `extra_fields` + `metadata.rh_aiapp` 双重兜底：那时候就在跟同一个问题打交道。
- **RH 专属设计（容易踩）**：面板是**直连适配器轮询**的（`extractTaskId` 优先读 `rh_task_id`，注释写明「永远直连 rh-adapter 轮询，NewAPI 只承担提交+计费，不做轮询」），而宿主会删掉 render 输出里的 legacy `task_id` → 插件把适配器任务号放在 **`rh_task_id`** 上，面板轮询链路一字不改；宿主自己另跑一份轮询做任务行与结算。
- 计费用 `count` 型事实（`calls: 1`），与旧 Custom Channel 的「按次计费；每个模型单独设置价格」一致 —— 不做秒级改写。
- 产物（TDD，先夹具后实现）：`newapi-plugins/__tests__/rh.test.mjs`（RED：模块不存在 → GREEN 13 例全过）与 `newapi-plugins/rh.plugin.js`；已接入 `scripts/run-focused-tests.mjs`。四个插件合计 **51 例全绿**。文档同步：[[运维/适配器收编任务插件总方案-2026-10-01]] §2 分类、§3 铁律、§4 波次、§5 新增 Wave 4 卡、§6 改为「不下岗的五个」、§7 补三条风险。
- 新记三条风险：① **`rh_task_id` 可能被宿主改写**（README 说 render 前会替换「known private task IDs」，未验 —— 本波唯一硬风险，已写两条退路）；② 建新渠道时**必须**把旧 Custom Channel 模型列表里被接管的 35 个删掉，否则两个渠道声明同名模型 = 负载均衡，任务随机落两边；③ `site: global` 的模型要 `RUNNINGHUB_GLOBAL_API_KEY`，适配器缺它时插件侧看不出来。
- 未验证：插件未上传、type 61 渠道未建、旧渠道模型列表未改、未真跑一笔（管理员页动作在用户侧）。

## [2026-10-01] 修复 | 宿主硬校验 artifact hooks：dola / rh 上传被拒，已补齐

- 症状（用户实测上传）：`plugin dola protocol "openai_video" is missing driver hook "listArtifacts"`，`rh` 同样被拒；`comfy` / `boluo` 能上传 —— 它们本来就有这两个 hook。
- 根因：**我判断错了**。同日写的 dola / rh 插件里写了「有意不导出 `listArtifacts` / `buildContentRequest`」，理由是「面板对这两条线路不走 `/content`」。但**宿主的校验规则不看这个** —— 它要求声明了 `openai_video` 的插件**必须同时导出这两个 hook**，少了直接拒收。README 那句 "plugins that expose task outputs export `listArtifacts` and `buildContentRequest` together" 是**硬要求**，不是建议。
- 修法：两边都补上 —— `listArtifacts` 只在 `SUCCESS` 返回 `[{key:'video', type:'video', mimeType:'video/mp4'}]`；`buildContentRequest` 直取快照里的上游成片地址（dola 读 `video_url`、rh 读 `url`）并标 `credentialless: true`（两者上游都是公开免签直链，宿主只放 GET/HEAD、不带插件头，且对每跳做 SSRF 检查）。
- 夹具同步改写（dola / rh 各一条），四个插件合计 **51 例全绿**。

## [2026-10-01] 排障 | 旧渠道 140 的 metadata 兜底不成立：选 4:3 仍出 9:16

- 用户按要求跑了一笔 **4:3**：ComfyUI history 里该任务 `status=success`（52 节点、`dur27=3.0`、`images=2`），但 **`ar29` 仍是 `9:16 (Portrait Widescreen)`** —— 面板选的 4:3 **没有到达**模板。
- 排除假阳性的依据（重要）：模板 `defaults.aspect_ratio` **本身就是 9:16**（见 `minimax-h3-ref2v.meta.json`），所以「选 9:16」与「什么都没送到」长得一模一样，**只有非 9:16 的取值才有判定力**。时长 3 秒能到（默认 15），但 `duration` 本来就在 `TaskSubmitReq` 白名单里，代表不了 `aspect_ratio`。
- 结论：`metadata` 镜像 + 适配器摊平这套**对渠道 140 不生效**。处置：**不在旧渠道上继续纠缠**，走插件通道（`comfy` 插件已可上传）；旧渠道 140 保留 `jc-qwen-image-2.1`，两个 H3 模型迁走后即可。
- 未查（可查）：`metadata` 究竟有没有被 NewAPI 转发到适配器 —— 适配器的 `/v1/tasks` 需要密钥（匿名访问回 `Invalid API key`，实测）。

## [2026-10-01] 验证 | comfy 插件通道实测通过：选 4:3 → 节点 29 = `4:3 (Standard)`

- 实证：ComfyUI history `id=5846dc81 | success | ar29=4:3 (Standard) | mode65=0 | dur27=3.0`；适配器 `total 3 / succeeded 3`。**面板选的画幅真的到了工作流节点** —— 「选 4:3 出 9:16」这条 Bug 从根上解决。
- 对照：同一渠道走 type 1 时，选 4:3 出的仍是 `9:16 (Portrait Widescreen)`（= 模板 `defaults` 值）。
- **用户发现更简的迁移路径（优于原方案）**：**不用新建渠道** —— 直接把**现有渠道的类型改成 `Task Plugin`、选上插件**即可。好处：不用改模型列表，也不会出现「同名模型两条渠道分流」那个坑（原方案要求建新渠道 + 从旧渠道删掉同名模型）。已写进总方案 §3 铁律第 7 条。
- 该路径的两个前提（已写进文档）：
  ① **那条渠道上的每个模型都要被插件覆盖** —— 渠道 140 上还挂着 `jc-qwen-image-2.1`（面板 2026-09-26 已撤下、comfy 插件 `meta.models` 里没有）→ 该模型会开始报 unsupported，要么从渠道删掉，要么加进插件再重传；
  ② **`rh-adapter` 的 Custom Channel 不能整体改类型** —— 它还担着音频（`rh-suno-*` / `rh-speech-*` / `rh-music` / `rh-voice-clone`），而宿主没有音频协议。RH 要另建一条 type 61 只放那 35 个视频/图片模型。

## [2026-10-01] 收尾 | 四个插件全部上线；对外合同要改读 `id`

- 状态：`comfy` / `dola` / `boluo` / `rh` 四个插件已上传启用，用户实测「都成功了」；comfy 的画幅实证：节点 29 = `4:3 (Standard)`。
- 迁移方式（用户发现，优于原方案）：**直接改现有渠道的类型为 `Task Plugin`，不新建渠道** —— 已写进 §3 铁律第 7 条。
- **对外合同的三处影响**：
  1. **`task_id` → `id`**：宿主对 `openai_video` 的 render 会**移除 legacy `task_id`**（同时覆盖 `id` / `object` / `model` / `status` / `progress` / `created_at` / `completed_at`）。所以插件通道下响应里只剩 `id`。让第三方改读 `id` 是**两种情况都安全**的写法（旧通道与插件通道下 `id` 都在）。已更正 dola 对外文档。
  2. **dola 参考图上限**：对外文档写「最多 30 张」，而上游规格与适配器（`MAX_IMAGES = 9`）都是 **9 张** —— 第三方传 10 张会吃 400。已按 9 更正。
  3. **`ratio` 现在真的生效**：文档原来就写 `ratio` 受支持，只是以前被 `TaskSubmitReq` 静默丢掉、实际按模板默认值出片；插件通道下文档由假变真，不用改。
- 收尾改动：`hot.md` 加当日条目；总方案新增 §4.1 收尾状态；`韭菜盒子Seedance2.5中转接入.md`、`本机ComfyUI模型对外接入-2026-09-26.md` 按上面第 1、2 条更正。
- **用户侧待确认三件**（我没有 key、也不该拿）：① RH 那条是「改类型」还是「新建」——若改类型，音频（suno/speech/music/voice-clone）会断，要单独测一笔；② 渠道上被插件未覆盖的模型（140 上的 `jc-qwen-image-2.1`）；③ 计费口径（类型变了 → 用量事实 × 单价），逐个渠道看用量日志。

## [2026-10-01] 实施 | Wave 3 `shanhai` 与 Wave 5 `zx` 插件落盘：32 例夹具全绿，并查实一条宿主铁律

- 产物（TDD，先夹具后实现）：`newapi-plugins/shanhai.plugin.js` + `newapi-plugins/__tests__/shanhai.test.mjs`（15 例）、`newapi-plugins/zx.plugin.js` + `newapi-plugins/__tests__/zx.test.mjs`（17 例）；两者已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`，「每个测试只注册一次」守卫跑过。六个插件合计 **84 例**。
- **查实一（读官方 `docs/plugin-api/v1.md` 的 Host protocols 表）：宿主协议路径是封闭集合。** `openai_responses` = `POST /v1/responses` + `GET /v1/responses/:id`；`openai_video` = `POST /v1/videos` + `GET /v1/videos/:id` + `GET|HEAD /v1/videos/:id/content`；`openai_image` = `POST /v1/images/generations` + `POST /v1/images/edits`。后果：**面板 `endpoint` 不在这张表里的模型收编不了** —— type 61 渠道只在这些路径上被触发，原生路线（`meta.routes`）会被加上插件前缀（`/doubao/api/v3/...`）顶不上原路径。实例：`doubao-seedance-2-5-260628` 的面板 endpoint 是 `/v1/video/generations` → **有意不进** zx 插件，继续留在旧渠道（要收编得先改 App 的 endpoint）。已写进总方案 §3 铁律第 9 条。
- **查实二：`openai_video` 的成品由宿主的 artifact 通道下发**（`GET /v1/videos/:task_id/content` 走插件导出的 `buildContentRequest`）。而 shanhai 适配器回的是 `/v1/videos/{上游任务号}/content`（相对路径 + 成片要带山海 Key 才能取）、zx 的 Omni 是同一形状 —— **这种地址不能透给客户端**（等于让客户端拿上游任务号去问宿主）。两个插件的 `render` 都不透它，改由 `buildContentRequest` 打回适配器带 Bearer 取；只有上游**绝对**直链（Grok / Seedance / MJ 成图）才标 `credentialless` 直取。
- 两处边界写进代码与卡：zx 的 Grok **时长写在模型名里**（适配器不发 `seconds`），所以用量按模型名查表；zx 的 MJ 是**图片任务却走 `openai_video` 协议**（面板 endpoint 就是 `/v1/videos`）→ `render` 按模型名把 `object` 改成 `image` 并报 `url` + `metadata.url`，定价**必须用 `u("calls")`**；shanhai 的 `seconds` 缺省/越界时回落 **30**（面板唯一允许的档位，报 0 会静默扣不到钱）。
- 文档：总方案 §2 分类表、§3 铁律第 9 条、§4 波次表与 §4.1 状态、§5 新增 Wave 3 / Wave 5 实施卡、§7 补三条风险；`hot.md` 当日条目同步。
- **未上传 = 未验证**：两个插件都还没进过管理员页。各自有一条明确未验风险 —— shanhai 的成片要走宿主 artifact 通道、zx 的 MJ 成图能否被面板取到（处置退路写在卡里）。

## [2026-10-02] 运维 | 本机 ComfyUI 云链路：开机自动就绪 + 每 5 分钟自愈

- 问题：用户问「每次关机再开机，怎么才能启动，让其他电脑云端用上本机 MiniMax H3」。当时实况：ComfyUI 8188 活着，**适配器 9000 与 frpc 都没在跑**，云链路是断的。
- 定性过程（先审根因）：① 两个服务任务都在、触发都是登录，本机 `AutoAdminLogon=1` → 自启本身没问题；② 两者的「上次运行结果」都是 `3221225786` = `0xC000013A` = `CTRL_C/CONSOLE_CLOSE`；③ frpc 日志 `08:33:13 service ... stopped` 与适配器日志停在 01:04:22 对得上 → 同一时刻被**关掉控制台窗口**带走的（动作是 `cmd.exe /c ... >> log`，窗口可见）；④ ComfyUI 不在启动文件夹、也不在 Run 键里，它是 GUI，开机后没人开就永远没 8188。
- 产物：`comfy-adapter/tools/cloud.ps1`（`status` / `ensure-all` / `ensure-services` / `restart-adapter` / `restart-frpc` / `run-adapter` / `run-frpc`）+ `comfy-adapter/tools/install-autostart.ps1`（幂等重装四个任务）。服务任务的动改成隐藏窗口 powershell；`comfy-cloud-boot` 登录后 30 秒全保，`comfy-cloud-guard` 每 5 分钟只保适配器 + 隧道。设置：无执行时限、IgnoreNew、错过触发补跑。
- 又踩两个坑：① `-RepetitionDuration ([TimeSpan]::MaxValue)` 会被 `Register-ScheduledTask` 拒（生成的 `P99999999DT23H59M59S` 超范围，0x80041318），XML 里省略 `<Duration>` 才是「无限期重复」；② `.ps1` 只有 LF 无 BOM 时 PS 5.1 按 ANSI 读，中文乱码并报成「字符串缺少终止符」—— 两个脚本都存成 UTF-8 with BOM。
- 验证：`cloud.ps1 -Action status` 三跳全绿；服务器 NewAPI 容器内 `wget -qO- http://frps:8796/health` → `{"adapter":"ok","comfyui":"ok","comfyui_devices":["cuda:0 ... RTX 4090 ..."]}`；frps 日志 `new proxy [comfy-adapter] type [tcp] success`。**未做真实出片**（会占唯一并发槽与显存，按规矩先问用户）。
- 遗留（用户侧一个设置）：Comfy Desktop 的「端口冲突」仍是 `auto`，8188 被占会静默漂到 8189；建议改「询问」。脚本已能识别并明确报错。

## [2026-10-02] 文档 | 对外视频接入合同按实际渠道更正：模型名两个、时长 1–28、只读 `id`

- 起因：用户问「对外接入 API key 的文档有没有需要更新」。核对代码与实际渠道后改了六处（`韭菜盒子本机ComfyUI视频模型API对外接入-2026-09-26.md`）：
  1. **模型名**：原来列了四个，其中 `jc-minimax-h3-first-frame` / `jc-minimax-h3-first-last` **渠道里不存在**（面板注册表与 `comfy` 插件 `meta.models` 都只有 `jc-minimax-h3` / `jc-minimax-h3-ref2v`；用户 2026-10-02 确认「渠道里没有那两个」）。改成「**只有两个模型名**，`jc-minimax-h3` 一个名字覆盖文生/首帧/首尾帧，模式由传的字段决定」，并加显式警告：用那两个名字会被判为模型不存在。
  2. **`duration` 1–15 → 1–28**（2026-09-27 已统一到 28 秒，对外文档漏改）。
  3. `size` 与画幅小节的「前三个模型」→「**仅 `jc-minimax-h3` 生效**」。
  4. **响应示例**换成插件通道的形状，并把「请用 `task_id`（或 `id`）」改成「**只读 `id`**」—— 宿主对 `openai_video` 会移除 legacy `task_id`。
  5. 查询任务小节补一句：轮询响应不保证带成片地址。
  6. 下载成片小节改成「**只通过 `/content`**」。
- 同步的内部文档：`本机ComfyUI模型对外接入-2026-09-26.md` 的对外接口表（`GET /v1/videos/{id}` 不再承诺 `metadata.url`）与「产物地址」小节（补：插件通道下取片不再经过 `metadata.url`）；`运维/index.md` 里 SDD 那条「待审，未实施」→「已实施并实测通过」。
- **判定为不用改的两处**（先审根因，不留错的待办）：① 图片那份对外文档开头已有「本模型当前未上线（2026-09-26 起）」横幅；② `comfy-adapter/tools/verify_newapi_contract.py` 里「completed 带 metadata.url」的断言**是对的** —— 它 `BASE = http://127.0.0.1:9000`，测的是适配器本身。总方案 §7 那句「同时更新那条断言」是当时的误判，已在原位改成「已决 + 不用改」。

## [2026-10-02] 实施 | Qwen-Image 2.1 接回对外（comfy 插件 0.2.0）+ 订正「显存装不下就不能交替」的错判

- 起点：用户问「显存装不下两套栈有判断依据吗？我自己图/视频交替没有任何问题」。复核结论：**用户是对的**。① 「同时常驻装不下」有依据且成立（磁盘实测：H3 栈 UNET 19.53 + 文本编码器 14.61 + 8 个以上 LoRA + 上采样 1.29 ≈ 40GB；Qwen 栈 UNET 6.63 + 文本编码器 16.33 ≈ 23GB；合计 ≈63GB > 48GB）；② 但「因此不能交替用」是我把 2026-09-26 那次的**探针事故**（探针占住唯一并发槽位 → 用户任务排队 300 秒被拒 + 98% 显存 + HTTP 全超时）当成了「交替不可行」，而撤下图片模型的直接原因其实是**用户自己的产品决定**（留视频、图片等独立机器）。实测：用户图→视频→视频三笔全 success，跑完 `free 46.3GB`。
- 产物（TDD）：`newapi-plugins/comfy.plugin.js` **0.2.0** —— `meta.models` 加 `jc-qwen-image-2.1`、新增宿主协议 **`openai_image`**（同步，无轮询）、`usageSchema` 加 `image_count`（unit `count` + `unitLabel: 张`）、`buildSubmitRequest` 按模型分岔（图片 `/v1/images/generations` + `async:false` + `b64_json`）、`parseSubmitResponse` 对同步图片回 `immediate`、`openai_image.render` 回 `{data:[{b64_json}]}`、`listArtifacts` 图片返回空、图片用量按 `n` 预约（不超适配器 `max_batch = 4`）并用响应 `data.length` 结算；夹具 `comfy.test.mjs` 10 → **19 例**，六个插件合计 **93 例全绿**。
- 适配器：`adp/service.py` + `adp/api.py` 加**换栈观测**（`Stats.model_switches`、日志 `栈切换 #N：X -> Y`、`/health` 暴露），**不加卸载动作**（那是在应付臆想的问题）；`app.py --check` 四步全绿；按 `cloud.ps1 -Action restart-adapter` 重启后 `/health` 已带 `model_switches: 0`。
- 文档订正：内部文档把「切换会把显存顶满、甚至卡死 ComfyUI」改成「同时常驻装不下 → 用完即卸、切换需重载」并写明那次卡死的真实根因（探针占槽位）；图片模型那节改成「2026-09-26 撤下 → 2026-10-02 接回对外」+ 做法表；对外图片文档「未上线」→「已上线」+「交替调用下一笔慢几十秒」+ `response_format` 固定 b64。
- **未上传/未验证**：插件要用户上传（0.2.0）+ 渠道加模型 + 定价 `tier("base", u("image_count") * 0.2)`。唯一未验风险：图片是单个同步请求（35–50 秒）可能撞宿主提交超时，退路是改成宿主内轮询（600 秒预算）。
- 首次上传被拒：`unsupported plugin syntax ".async": plugins must be synchronous and cannot import modules` —— **宿主对插件源码做静态检查，且扫整份源码（注释也算）**，图片同步开关的点号写法被当成非法语法。处置：不再传该开关（适配器 `default_async` 回落到 `output_kind == "video"`，图片模板天然同步），并给夹具加一条**源码守卫用例**（读插件文件逐 token 断言）—— 它当场就抓出了我写在注释里的同一个词，于是连注释一起改掉。此规则已写进总方案 §3 铁律第 10 条。
- 对外文档互相对齐（用户准备接回后直接用其他电脑测）：图片那份的响应示例改成插件通道的**实际形状**（只保证 `created` + `data`，`model`/`prompt_id`/`elapsed_seconds` 是旧直连适配器的字段，不再承诺）、补「同步接口超时给足 90 秒」与「与视频共用队列、交替调用下一笔多几十秒」；视频那份把**已过时**的「本机只对外提供视频模型」改成「同时提供图片模型 + 共用显卡与队列」。两份文档不合并（协议不同、各约 150 行），而是互相点名。


- 灵动（满血）Seedance 2.5 上架（2026-10-02）：`newapi-plugins/lingdong.plugin.js`（0.2.0）+ 面板 5 条（分组 `满血seedance2.5`）。上游三条路径与宿主 `openai_video` 逐字相同 → 直连厂商，无适配器无隧道。真机验收：`Sd 2.5 480P` 4 秒出片、后台实扣 2 元 → 5 条全部 verified。面板默认视频模型改成 `Sd 2.5 480P`（分组置顶 + 组内第一条，配源码守卫测试）。对外合同见 [[运维/韭菜盒子灵动Seedance2.5API对外接入-2026-10-02]]。
- 山海适配器对齐官方字字动画插件契约：`POST /generations` 补 `scene`（有参考图 `image-to-video`，否则 `text-to-video`）；`/content` 优先用任务返回的 `output.url`（同域校验 + 相对地址补全），写死的 `/media/runs/{id}` 降为回落。夹具 13 → 15 例。

## [2026-10-02] 修复 | 本机 Qwen 图片 502 到位、H3 参考生视频 `aspect_ratio` 校验失败、失败原因丢失

- **图片 502 的根因**（用户实测「用 qianwen 生图 502 `task submit response exceeds size limit`」）：宿主任务插件把提交响应落库的上限是 **1 MiB**（`maxTaskPluginPersistedJSONBytes`），2 MB 级 PNG 内联成 base64 约 2.8 MB，必超。`comfy.plugin.js` **0.3.0** 改为图片分支显式 `body.response_format = 'url'`；适配器 `config.yaml` 已是 `public_base_url: https://api.jiucaihezi.studio` + `default_response_format: url` + `static_ttl: 86400`。
- **公网取图/取片链路打通**（此前公网 `/files/` 落到网页路由，客户端存下来的「图片」是 1573 字节的首页 HTML）：VPS 上 frps 加 `127.0.0.1:8796:8796`（仅回环，不对外），nginx `api.jiucaihezi.studio` 加 `location /files/ { limit_except GET HEAD { deny all; } proxy_pass http://127.0.0.1:8796/files/; proxy_buffering off; }`。验证：公网 HEAD 图片 `200 image/png 2178711`、视频 `200 video/mp4`、`Range` 回 `206` + PNG magic 正确。
- **H3 参考生视频失败的真因**（`task_20261002_a0d3ccf9392e`，提交 2 秒内 failed 且已退款）：适配器日志只有 `ComfyError: Prompt outputs failed validation`，节点级原因只在 ComfyUI 自己的 `comfyui.log`：`Failed to validate prompt for output 74: * ResolutionSelector 29: - Value not in list: aspect_ratio: '16:9' not in ['16:9 (Widescreen)', ...]`。即客户端把比例发成了界面标签短式。同一晚 19:10 的重试（输入图 1672x941）`/prompt` 返回 `200`，证明工作流本身没问题。
- 修法（三层收口，防「旧版本存下来的计划被重试复用」绕过入口校验）：`useCreation.setAspect` 按模型枚举补全短式 → plan 入口 `validateSelectField` 拒短式 → 新增 `canonicalCreationRatio()` 在 comfy 视频提交体**出口**再收敛一次，认不出就不发（交工作流默认）。
- **失败原因不再丢**：`comfy.plugin.js` 原来 `String(body.error)`，而适配器回的 `error` 是 `{message,type,code}` 对象 → 客户端空白（`[object Object]`）。改为取 `error.message`；适配器 `comfy_client.submit` 同时把 `node_errors` 压成一行塞进 `ComfyError.message`，日志与客户端都能看到「哪个节点哪一项错」。
- 验证：聚焦 **1794 测试 / 1 失败**（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs` Windows `/tmp` 硬编码）；插件夹具 33/33（comfy 21 + lingdong 12）。适配器已重启（`/health` ok、`inflight 0`）。
- **排障陷阱（写进仓库记忆）**：`comfy-adapter/logs/adapter.log` 是**混合编码** —— Python 写 UTF-8，`tools/cloud.ps1` 的 `*>> $AdapterLog` 追加的是**未对齐的 UTF-16LE**，所以 `Select-String`/`grep 'task_...'` 一律 0 命中，直接 `Get-Content` 只是把 NUL 吞掉、看着像正常文本；要按 UTF-16LE 区段起点解码才能读到。
- **补一刀：任务永远卡在「排队中」**（用户报 `jc-MiniMax H3 参考生视频` 224 秒仍 queued）。适配器日志显示该笔 19:50:45 就 `succeeded（耗时 100.75s）`、公网 mp4 可下，成功后又收到 8 次轮询才停。真因是**插件状态词表脱钩**：`/v1/videos/{id}` 视图回 `in_progress`/`completed`（`adp/api.py` 的 `_VIDEO_TASK_STATUS`），而插件映射表照抄了 `adp/tasks.py` 的内部状态机 `running`/`succeeded` → `completed` 落到 `UNKNOWN` → 宿主不认终态、任务永远停在 SUBMITTED。`failed` 两套拼写相同，所以此前只有失败可见、成功不可见。修：映射表改成 API 视图词表（保留内部别名），并加**契约测试**直接读 `adp/api.py` 的 `_VIDEO_TASK_STATUS` 逐词断言（`comfy.plugin.js` **0.3.1**，夹具 22/22，聚焦 1795/1）。
- 文档同步：图片那份对外接入文档的「固定内联 b64」整段改成 URL（含 1 MiB 上限的原因与 `502 exceeds size limit` 一行）；视频那份补「短式比例不是 400 而是任务失败」+ 节点级 `error.message` 样例；内部 `本机ComfyUI模型对外接入` 的做法表更新为插件 0.3.0 + url。

# 韭菜盒子 Mobile 桌面控制器统一合同与局域网 MVP TDD

> 日期：2026-09-27
> 状态：用户已确认；P0 与 P1 Desktop 局域网 Bridge 已完成自动化实现；P2 iOS 控制器进行中（iOS 构建链路隔离与 Mobile 协议客户端已落地，界面、扫码、Rust 客户端与真机验收未实施）
> 范围：Desktop 唯一 Harness Runtime、Mobile 控制器、局域网配对、当前活动 Session 的读取/订阅/发送/停止/审批
> 后续但不在首期：项目与会话完整导航、公网 Relay、推送、媒体与文件传输、Android 发布
> 前置合同：[[韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]、[[架构/产品架构]]

## 1. 一句话结论

Mobile 不是第二个工作台，也不运行第二套 Agent：**Desktop 是 Harness Runtime、模型配置、Skill/MCP、项目文件和权限的唯一所有者；Mobile 只是经认证的远程控制面，读取并操作 Desktop 已有的同一个 Harness Session。**

首期先交付可真实运行的局域网 MVP，只控制 Desktop 当前活动项目与当前活动对话。协议、安全和同 Session 闭环验收通过后，才扩展项目/会话导航和公网 Relay。

## 2. 用户目标

用户在 Mac 或 Windows 上运行韭菜盒子后，可以拿起 iPhone：

1. 扫描 Desktop 显示的一次性二维码并经 Desktop 明确确认；
2. 看到当前活动项目、对话历史、运行状态、工具过程和最终回复；
3. 在同一个 `jc-v1-<conversationId>` Harness Session 中继续发送文字；
4. 停止当前任务，或对当前任务的待审批动作作出决定；
5. 断线重连后以官方 Session 历史恢复，不重复触发已经提交的任务；
6. 返回电脑后继续使用原对话，不需要迁移、合并或重放手机侧历史。

## 3. 产品与平台边界

### 3.1 正式解冻的只有“控制器”

- 现有 Mobile 独立工作台继续冻结，不继续补齐 Desktop 能力。2026-09-27 起 iOS 入口已换为控制器，手机不再加载工作台；`isTauriMobileRuntime()` 分支随之成为桌面仓库里的死代码，留给单独清理，不在 P2 里顺手删除。
- Mobile 桌面控制器作为新形态解冻，复用现有 Vue 3、TypeScript、Tauri v2、iOS Bundle ID `com.jiucaihezi.mobile` 与发布身份。
- iOS 是第一真实平台。Android 当前没有稳定发布身份，协议稳定且 iOS 真机通过后再单独立项。
- 旧 Studio、旧漫剧工作台和 OpenCode 产品壳不得借本项目回流。

### 3.2 “唯一 Runtime”的准确含义

“唯一”指 **Mobile 不拥有或启动 Runtime**，不把 Desktop 当前按工作区持有 Runtime 的实现改成一个全局进程：

- Desktop 继续按 `cwd` 持有 Harness Runtime；
- 同一工作区在现有配置下复用 Runtime；
- 模型、权限或工具组成变化时沿用现有完整关闭再重建规则；
- Mobile 只向 Desktop 发控制命令，不调用 Provider，不持有 API Key，不启动 runner。

## 4. 数据所有权

| 数据 | 唯一所有者 | Mobile 可以持有 | Mobile 禁止持有 |
| --- | --- | --- | --- |
| 完整对话、工具轨迹、Compaction | Harness Session | 当前屏幕投影与短期缓存 | 第二份完整会话数据库、私有 Session 文件 |
| 对话目录与 Session 映射 | Desktop 韭菜盒子 | 当前活动项的展示字段 | 独立目录真相或映射改写权 |
| 模型、Provider、API Key | Desktop | 当前模型展示名 | Key、Provider 编辑能力、模型调用能力 |
| Skill、MCP 与能力开关 | Desktop | 当前能力展示与任务过程 | 安装、配置或自行执行能力 |
| 项目文件与媒体 | Desktop 项目目录 | 首期不传文件；只显示必要名称 | 整盘访问、绝对路径、批量文件镜像 |
| 配对设备与授权 | Desktop | 本设备私钥/凭证及 Desktop 公钥 | 其他设备凭证、Desktop 长期私钥 |

Mobile 缓存丢失不能改变 Session；Desktop 目录损坏不能由 Mobile 缓存反向“修复”对话。

## 5. 现状审计与缺口

现有主链可复用：

1. `conversationId → jc-v1-<conversationId>` 已稳定；
2. `session/list`、`session/read` 已经通过官方 Session Query 薄桥实现；
3. `runDeepSeekHarness()` 已复用现有 SDK、Session、Skill、MCP 与项目执行器；
4. `MemoryWorkbench` 已按 `owner::resourcePath` 持有后台运行状态，同一对话已有并发守卫；
5. iOS 的 Tauri 工程、Bundle ID 和平台差异代码仍在仓库中。

首期必须补的缺口：

1. runner 的实时通知仍绑定本地 `requestId`，没有供后来连接的 Mobile 独立订阅当前 Session 的入口；
2. `MemoryWorkbench` 的运行状态、审批和发送入口仍在组件内，没有受控的 Desktop Host API；
3. Desktop 没有默认关闭、按需开启的局域网认证入口；
4. Mobile 仍是旧独立工作台形态，没有只读远程投影与控制客户端；
5. 当前没有扫码配对、设备密钥、吊销、重放保护和连接恢复合同。

根治位置是给**现有 Desktop Session 增加远程通道**，不是复制 runner、解析 `$DSH_HOME`，也不是让 Mobile 调现有 Gateway 代跑模型。

## 6. 目标架构

```text
Mobile Tauri UI
  └─ Remote Client（配对、加密连接、快照、事件、控制命令）
       ⇅ 局域网认证加密通道
Desktop Remote Bridge（连接、设备身份、限流、协议校验）
  └─ Desktop Conversation Host（当前活动项目/对话、发送、停止、审批、投影）
       ├─ MemoryWorkbench 既有产品状态
       └─ deepSeekHarness.ts → runner.mjs → 官方 DH SDK / Harness Session
```

责任边界：

- Rust/Tauri 侧只负责网络监听、设备认证、帧限制和与 WebView 的消息桥接，不理解 Prompt 或 Session 内容。
- TypeScript `Desktop Conversation Host` 是唯一产品控制入口，调用现有发送/停止/审批链，不直接另调 Provider。
- runner 只补官方 Session 的订阅薄桥；不增加 Session 存储、不解释私有物理文件。
- Mobile 只渲染 DTO，不导入 `deepSeekHarness.ts`，不包含 bundled Node、route patch 或执行器。

## 7. 局域网 MVP 范围

### 7.1 必须有

- Desktop “连接手机”入口、一次性二维码、待确认设备、已授权设备与吊销；
- Mobile “连接电脑”入口、扫码、连接状态和重新连接；
- 当前活动项目名、当前活动对话标题与 Session ID 的受控标识；
- `session/read` 权威历史投影；
- 当前 Session 实时事件：用户消息、助手正文、工具步骤、失败与结束；
- 发送纯文字到当前 Session；
- 停止当前运行；
- 展示并响应当前待审批动作；
- Desktop 离线、App 退出、Session 忙、权限不足和协议不兼容的明确状态。

### 7.2 明确不做

- 不浏览或切换全部项目、全部对话，不从手机新建项目；
- 不从手机选择模型、开关 `@文件`、安装 Skill、配置 MCP 或输入 API Key；
- 不上传附件，不下载项目文件、图片、视频、音频或 3D 资产；
- 不做公网 Relay、推送通知、后台常驻或无人值守开机启动；
- 不做 Android 安装包；
- 不把 Desktop Web 页面整页投到 Mobile WebView；
- 不为首期建立通用 RPC 框架或插件市场。

首期把“当前活动 Session”跑通，是为了先验证唯一 Runtime、同 Session、权限和恢复四条主链。全量导航在 P2 增量增加。

## 8. 配对与安全合同

### 8.1 默认关闭

- Desktop 默认不监听局域网；只有用户打开“连接手机”后才临时进入可配对状态。
- 关闭配对页不撤销已配对设备，但停止签发新配对凭证。
- 不能用“同一局域网”“知道 IP”“Origin 看起来正确”代替身份认证。

### 8.2 二维码

二维码只包含：协议版本、可达地址、Desktop 公钥/指纹、一次性 offer、过期时间和校验信息。

禁止包含：长期设备凭证、API Key、模型配置、项目路径、Session 正文和 Desktop 私钥。

规则：

- offer 最长 5 分钟；
- 只能消费一次；
- Desktop 必须显示设备信息并由用户确认；
- 拒绝、过期、已消费或被篡改的 offer 均不可换取设备凭证；
- 六位短码不能单独建立长期信任，只能作为已认证配对流程的辅助输入。

### 8.3 连接

- 从局域网第一版开始保护内容，不把明文 Prompt、工具结果或审批内容交给局域网旁观者；
- 使用成熟、可审计的加密实现，实施前先确认现有依赖或标准平台能力，不自创密码协议；
- 每台 Mobile 使用独立设备身份，Desktop 可单独吊销；
- 每次连接使用新会话密钥和挑战，旧帧不能在新连接中重放；
- 固定限制单帧大小、连接数和请求频率；日志不得记录凭证、Prompt、完整工具结果或文件正文；
- iOS 的 Local Network 权限、ATS 约束和 Desktop 防火墙提示属于首期真机验收，不得用浏览器模拟替代。

## 9. 最小协议

所有已配对消息使用统一信封：

```ts
type RemoteEnvelope = {
  version: 1
  requestId: string
  type: string
  sentAt: number
  payload: unknown
}
```

首期只有以下业务消息：

| 方向 | 类型 | 语义 |
| --- | --- | --- |
| Mobile → Desktop | `context.get` | 读取当前活动项目/对话及连接能力 |
| Mobile → Desktop | `session.read` | 读取当前 Session 权威快照 |
| Mobile → Desktop | `session.subscribe` | 从指定事件序号订阅当前 Session |
| Mobile → Desktop | `message.send` | 向当前 Session 提交一条纯文字消息 |
| Mobile → Desktop | `run.stop` | 幂等停止当前运行 |
| Mobile → Desktop | `approval.respond` | 对当前待审批动作作一次决定 |
| Desktop → Mobile | `session.snapshot` | 官方 Session Query 投影及最后事件序号 |
| Desktop → Mobile | `session.event` | 带官方或等价单调序号的实时事件 |
| Desktop → Mobile | `context.changed` | 当前活动项目/对话已切换，客户端须丢弃旧投影并重新 `session.read` |
| Desktop → Mobile | `run.state` | idle/running/waiting-approval/done/failed |
| 双向 | `ping` / `pong` | 在线状态，不携带业务数据 |

实现约定（2026-09-27 核对当前代码后固化）：

- Desktop 目前只发 `session.event`，且它是**整份状态投影**（完整 `turns` + `streamingText` + `run` 步骤与待审批项），不是增量事件；`session.snapshot` 与 `run.state` 在白名单内但保留未用。
- 因此客户端按「最新 seq 覆盖整份投影」处理即可：`session.read` 给权威历史，`session.event` 给最新全量；快照不带 `lastSeq`，不依赖事件回放，也就不需要 §10.5 的跨边界补事件。

不新增通用反射 RPC。未知 `type` 必须返回 `UNSUPPORTED_MESSAGE`，不能静默执行。

## 10. Session、事件与恢复

1. Mobile 只能操作 Desktop 当前公开的 `conversationId/sessionId`；客户端传入其他 ID 必须拒绝。
2. 历史永远来自官方 `session/read`，不从 Mobile 缓存回填 Desktop。
3. 实时事件按 Session ID 过滤；子代理事件只有进入当前根 Session 的正式投影后才对 Mobile 可见。
4. 初次连接和断线重连都执行：`context.get → session.read → session.subscribe(lastSeq)`。
5. 快照与实时流交界按事件序号去重；重复事件不得重复显示或重复改变终态。
6. Desktop 切换项目或对话时发送新的 context；Mobile 先停止旧订阅，再读取新快照。
7. Desktop 关闭或网络中断时 Mobile 显示离线，不猜测任务成功或失败。

## 11. 发送、并发与幂等

- Desktop 本地发送和 Mobile 发送必须进入同一 `Desktop Conversation Host`。
- 同一 Session 同时只允许一个活动运行；已有运行时，新的 `message.send` 返回 `SESSION_BUSY`，首期不做队列。
- 不同客户端同时发送时，以 Desktop 第一个成功接收的命令为准，其余明确失败。
- 查询命令可以安全重试；`message.send`、`approval.respond` 等副作用命令在未取得接收确认时**不得自动重发**。
- 连接中断后先 `session.read` 对账；无法证明未提交时，由用户决定是否重新发送，不能为了“看起来可靠”冒险重复任务。
- `run.stop` 幂等；已结束运行再次停止返回当前终态。
- 审批只接受当前待审批项的精确 ID，第一份有效决定生效，后续决定返回 `APPROVAL_RESOLVED`。

这套规则复用现有同 Session 写锁，避免再建持久命令队列或第二套任务账本。

## 12. 权限合同

1. Mobile 继承 Desktop 当前 Session 已有的能力面，但不能扩大它。
2. 首期新对话默认不开放；Mobile 不能自行打开 `@文件`、`@影音`、`@排版`、`@3D` 或 MCP。
3. Mobile 发出的文字走现有发送链，包括标题、Prompt、Session、运行态和工具审批，禁止直接调用 runner 绕开产品状态。
4. 审批显示必须包含 Desktop 现有的动作说明；敏感参数不能为了远程 UI 额外展开。
5. 设备授权不等于项目外文件授权，也不等于 Harness `danger-full-access`。
6. 吊销设备后，现有连接立即失效，新请求全部拒绝。

## 13. TDD：先写红灯

### 13.1 协议与配对单元测试

| 红灯 | 预期 |
| --- | --- |
| 同一 offer 消费两次 | 第二次失败 |
| offer 超过 5 分钟 | 配对失败 |
| Desktop 未确认 | 不签发设备凭证 |
| 篡改地址、公钥或 offer | 配对失败 |
| 设备吊销后重连 | 认证失败 |
| 重放旧连接帧 | 拒绝且不执行命令 |
| 超大帧、过频请求、未知消息类型 | 明确拒绝，Desktop 保持可用 |
| 日志序列化 | 不含凭证、Prompt、工具正文和项目路径 |

### 13.2 Desktop Host 合同测试

| 红灯 | 预期 |
| --- | --- |
| Mobile 模块尝试启动 Harness | 构建合同失败；Mobile 不包含 Runtime |
| `context.get` | 只返回当前活动项目/对话最小字段 |
| `session.read` | 复用现有官方 Session Query，不解析物理文件 |
| Session A 事件进入 Session B 订阅 | 被过滤 |
| 子代理失败事件直接顶替根 Session | 被过滤 |
| 本地与 Mobile 同时发送 | 一个成功，另一个 `SESSION_BUSY` |
| Mobile 发送成功 | Desktop 原对话出现同一轮，Session ID 不变 |
| 停止/审批 | 复用当前运行对象，不创建第二运行态 |
| Desktop 切换当前对话 | Mobile 收到 context 变化并停止旧订阅 |

### 13.3 恢复测试

| 红灯 | 预期 |
| --- | --- |
| 工具执行中 Mobile 断线 | Desktop 任务继续 |
| 重连时快照与实时流重叠 | 按 seq 去重，不重复消息 |
| `message.send` 后回执前断线 | 不自动重发；重连先读 Session |
| Desktop 进程重启 | Mobile 显示离线；重开后恢复当前 Session 历史 |
| Mobile 清缓存 | Desktop Session 与项目不受影响 |

### 13.4 回归门禁

- 现有 Desktop 对话、后台运行、Session 恢复、Skill、MCP、媒体和审批测试必须保持通过；
- Desktop 未启用“连接手机”时不得新增监听端口或防火墙提示；
- Web 继续只有下载与展示，不因 Remote Bridge 恢复 Web 工作台；
- Mobile 构建不得打包 bundled Node、Harness 私有数据或 Desktop API Key；
- `vue-tsc -b`、Node focused、Rust、Desktop quick build、iOS build 按阶段执行并如实记录。

### 13.5 真实验收

自动测试不能替代：

1. Mac + iPhone 同一局域网扫码、确认、续聊、停止、审批、吊销；
2. Windows + iPhone 的防火墙、局域网发现和断线恢复；
3. iPhone 锁屏/切后台再回来后的快照恢复；
4. Desktop 长任务执行中连接、断线、重连；
5. Desktop 与 Mobile 同时发送的可见失败；
6. App Store/TestFlight 构建的 Local Network 与 ATS 行为。

未执行的平台不得登记为通过。

## 14. 分阶段实施

### P0：协议和红灯

- 固化 DTO、错误码、配对状态机和日志脱敏；
- 用内存 transport 跑通 Desktop Host 与假 Mobile；
- 验证不启动第二 Runtime、不解析 Session 文件。

验收：§13.1、§13.2 红灯先在旧代码失败，最小协议实现后通过；不开放真实端口。

实施记录（2026-09-27）：

- 新增 `desktopRemoteProtocol.ts`：版本 1 信封、消息白名单、帧大小/时间戳/请求 ID 校验、重放拒绝、设备级固定窗口限流、5 分钟一次性配对 offer、Desktop 确认、拒绝、设备凭证与吊销、只含元数据的审计记录；
- 新增 `desktopRemoteHost.ts`：只公开当前 context，按当前 Session 读/订阅并过滤串线事件，发送共用单忙锁，停止与审批只委托既有产品入口；模块不导入或启动 Harness；
- 红灯证据：加入测试后，旧代码因两个模块不存在而构建失败；最小实现后新增 `11/11`、完整 focused `1561/1561`、`vue-tsc -b`、定向 oxlint 与 `git diff --check` 通过；
- 当前仍是纯内存边界，没有真实监听、密钥交换、加密传输、Tauri 命令或 Mobile UI。上述平台安全能力属于 P1/P2，不得把 P0 凭证状态机宣传为已完成网络安全。

### P1：局域网 Desktop Bridge

- Tauri/Rust 增加默认关闭的局域网监听与配对；
- TypeScript 增加 Desktop Conversation Host；
- 给现有 runtime 增加按 Session 过滤的独立事件订阅；
- 接通当前活动 Session 的读、订阅、发送、停止和审批。

验收：假 Mobile 经真实 TCP + Noise 加密通道完成往返；Desktop 关闭入口后旧监听代次和连接立即失效、无新设备可接入。浏览器不能连接原始 TCP，因此不再用浏览器模拟代替传输验收。

实施记录（2026-09-27）：

- Rust/Tauri 新增默认关闭、手动开启的随机端口 Bridge；使用 `Noise_XX_25519_ChaChaPoly_BLAKE2s`、长度前缀帧、64 KiB 上限、每连接 30 请求/秒、最多 4 个连接、时间窗与请求 ID 重放校验；长期 Noise 身份和设备 token 哈希写入系统钥匙串；设备同时绑定 Mobile Noise 公钥，吊销会立即关闭现有连接；
- 配对使用 5 分钟一次性 offer，扫码后仍须 Desktop 明确允许；设置页提供开启/关闭、二维码、允许/拒绝和单设备吊销，且 App 启动不自动监听；快速关闭再开启使用单调监听代次，旧监听线程和旧连接不能复活；
- TypeScript Bridge 把最小协议映射到既有 `DesktopRemoteHost`；`MemoryWorkbench` 只注册当前 context、官方 Session Query 快照、同一发送/停止/审批入口和按 Session 过滤的实时投影。远程纯文字不借用桌面输入框附件、文件引用、编辑态或 Jev 状态；
- 自动验证：Node/focused `1564/1564`；Rust 全量 `436 passed / 1 ignored`，其中 Remote Bridge `8/8`（含真实 `127.0.0.1` TCP + Noise 假 Mobile 往返和快速重启代次回归）；`build:desktop:quick` 与 Desktop 产物审计通过；
- 未实施：P2 Mobile 客户端、iOS 构建、Mac/Windows 防火墙与 iPhone 真机矩阵。因此当前代码提供的是 Desktop Host 端，不能登记为手机已可连接使用。

### P2：iOS 控制器

- 复用现有 Mobile 包壳和 Bundle ID，替换为控制器入口；
- 实现扫码、设备页和单会话聊天页；
- 完成 Local Network、ATS、后台恢复与真机矩阵。

验收：Mac/Windows + iPhone 完成 §13.5，不要求公网。

实施记录（2026-09-27，进行中）：

用户决策（本轮定案）：

- **旧 App 不沿用**：手机端不再加载工作台；现有 TestFlight 公开链接不再维护，旧 App 无有效用户，不为兼容保留任何旧界面。
- **复用 Bundle ID `com.jiucaihezi.mobile` 与发布身份**：这是配管件（App Store Connect 记录、Team、签名），不是要沿用旧产品形态。
- 手机端 UI 是**新写的控制器**（设备页 + 单会话聊天页），只复用展示层与包壳，不复制工作台骨架。

已完成：

1. **iOS 构建链路隔离**（合同 §13.4）：
   - `tauri.ios.conf.json` 用 JSON Merge Patch 的 `bundle.resources: null` 删除全部 5 项桌面资源（含 `resources/deepseek-harness` 这个打包进安装包的 Node 运行时）。注意 RFC 7396 语义：`null` 才删除成员，写 `{}` 或省略都会静默继承。
   - `vite.config.ts` 增加 `JC_BUILD_TARGET=mobile` 分支，只编 `/mobile/index.html`；桌面与 Web 默认输入保持原样。
   - 新增 `scripts/prune-ios-dist.mjs`（把控制器入口提回根、删除 landing/help/skills 等 Web 与桌面专用内容）、`scripts/audit-ios-dist.mjs`（拦桌面运行时标记、悬空引用、入口缺失）。
   - `build:ios:quick` 不再跑 `build:deepseek-harness` 与 `build:creation-mcp`。
2. **协议收口**：`context.changed` 进入 `REMOTE_MESSAGE_TYPES`（此前 Desktop 已在发、协议表却未收录）；§9 补记 `session.event` 是全量投影的实现约定。
3. **Mobile 连接客户端**：`src/services/mobileRemoteClient.ts` + 10 条合同测试，覆盖连接顺序（§10.4）、副作用命令不自动重发（§11）、seq 单调与串线过滤（§10.3、§10.5）、切对话重同步（§10.6）、未知入站消息、断线后迟到推送、停止与审批的精确 ID。
4. **Rust 客户端半边**：`src-tauri/src/commands/remote_client.rs` 实现 Noise XX 发起方握手、二维码公钥 pinning（对端静态公钥不一致即 `DESKTOP_KEY_MISMATCH`）、最多 5 分钟的配对等待、认证后长期连接的读写分离与写锁（避免并发帧互相插入）、按 requestId 的请求/响应关联、连接断开时唤醒所有等待者。设备身份与 Desktop 签发的 token 只入本机钥匙串，不回传 WebView（§4），且模块不监听任何端口。新增 5 个命令并登记 ACL。测试直接复用服务端那套握手代码，在真实 `127.0.0.1` TCP 上跑，7/7 通过。
5. **TS 传输层**：`src/services/mobileRemoteTransport.ts` 把 5 个命令封成 `MobileRemoteTransport`；二维码解析只允许五个字段，多带字段即拒绝（§8.2）。客户端新增 `handleTransportClosed()`：通道断开只置离线，不动已有投影、不猜成败（§10.7）。
6. **扫码**：采用 Tauri 官方 `tauri-plugin-barcode-scanner`（与仓库已在用的 fs/dialog/notification 同源，Apache-2.0/MIT），Rust 与 JS 两侧都锁 `2.4.6`（两边版本不一致时 CLI 直接拒绝构建）。iOS 加 `NSCameraUsageDescription`；新增只面向 iOS 的 `capabilities/mobile.json`（扫码 + 本项目命令白名单），同时把桌面 `default.json` 限定到 `macOS/windows/linux`，手机包拿不到文件、Shell、SQL 与对话框能力。
7. **控制器界面**：设备页 + 单会话聊天页（`src/mobile/*`）。只发纯文字，无附件与 `@` 入口；复用 `ToolApprovalStrip`、`ChatScrollNav`、`streamingTextRenderer`，不引工作台运行时、也不新造第二套 markdown 管线（正文先用与本地同一套转义渲染，富渲染后置）。
8. **安装包审计**：新增 `scripts/audit-ios-app.mjs`（`pnpm run audit:ios-app`）直接检查打出来的 `.app`：无 `skills`/`deepseek-harness`/`creation-mcp`/`storyboarder`/`jev-scorer`、`assets/` 为空、二进制 plist 里的相机用途与 Bundle ID 正确。前端 dist 审计看不到 `bundle.resources` 这一层。

证据：focused `1592/1592`；Rust 全量 `443 passed / 1 ignored`（Remote Client `7/7`）；`tauri ios build -t aarch64-sim -d` 真实构建成功，`pnpm run audit:ios-app` 在安装包上通过（`assets/` 为空、相机说明与 Bundle ID 正确）；iOS 目标 ACL manifest 含 `mobile_remote_*` 与 `barcode-scanner:allow-scan`，macOS ACL 仍含全部桌面命令；`build:ios:quick` 与 `build:desktop:quick` + 两侧产物审计通过；`build:desktop:quick` 后桌面入口仍是 `try-*`（未削弱）。

本轮两个必须记住的坑：

1. **Xcode 27 与 swift-rs 1.0.7 不兼容**：带 Swift 的插件（扫码）在 `cargo build --target aarch64-apple-ios*` 时就失败，报 macOS SDK 的 `CoreServices/AppKit/WebKit` 模块建不起来；根因不是本仓库代码。把锁文件里的 `swift-rs` 从 `1.0.7` 升到 `1.0.8`（只改 `Cargo.lock`）后正常。同时这也意味着 `cargo check --target aarch64-apple-ios` 从引入 Swift 插件起不能再当作 iOS 验证通道，真实验证只能用 `tauri ios build`。
2. **陈旧资源拷贝会绕过配置**：Xcode 工程把 `gen/apple/assets` 整个目录当资源打包（`project.yml` 的 `buildPhase: resources`），而该目录是 CLI 早先写入的拷贝。因此 `tauri.ios.conf.json` 的 `resources: null` 已生效（新构建不会再重建内容），安装包里却仍带着 8 月 25 日那份含 1.2 MB `skills` 的旧拷贝。处理：`rm -rf src-tauri/gen/apple/assets`（`gen/` 不受版本控制）后重建，并用 `audit:ios-app` 在**安装包**层面把关。

未做：iOS 真机装包与 Local Network/ATS/后台恢复矩阵（本机已检测到可用真机，属下一阶段）、应用内控制台的 markdown 富渲染、服务端命令的平台 cfg 门禁。iOS 尚未在真机上运行，不得登记为可用。

### P3：完整项目与会话控制

- 增加授权电脑的项目列表、对话列表、新建/切换对话；
- 每个会话仍映射现有 `jc-v1-<conversationId>`，不建立 Mobile 对话库；
- 再评估文字附件和轻量预览，媒体原件仍后置。

### P4：公网 Relay

- Desktop 主动出站 WSS；
- Relay 只路由认证后的密文和必要元数据；
- 复用现有账号身份，但 Relay 使用独立协议、权限、存储和日志；
- 完成 E2EE、短期票据、推送、设备吊销、限流与合规审查。

P4 不得倒逼 P1 抽象通用传输框架；局域网协议稳定后再抽共同信封。

### P5：Android

先确定稳定 application ID、签名、升级与商店路径，再复用已经通过 iOS 验收的 Remote Client。不得与 P1/P2 并行开发两套平台问题。

## 15. 预计改动边界

文件名可在红灯阶段按现有目录风格微调，但职责不得扩张：

- `src-tauri/src/commands/remote_bridge.rs`：监听、配对、设备身份、限流与 Tauri 桥；
- `src-tauri/permissions/app-commands.json`：只增加精确 Remote Bridge 命令；
- `src/services/desktopRemoteHost.ts`：当前 context、Session 快照/订阅、发送/停止/审批适配；
- `src/services/mobileRemoteClient.ts`：Mobile 连接、快照、事件和控制命令；
- `src/services/deepSeekHarness.ts`、`runner.mjs`：只补现有 Runtime 的独立 Session 订阅薄桥；
- `MemoryWorkbench.vue`：注册现有发送/停止/审批入口，不复制业务链；
- Mobile 控制器页面：设备连接与单 Session 聊天；
- 对应 Node/Rust/组件合同测试。

若实现需要大规模搬空 `MemoryWorkbench` 或重写 Harness 生命周期，必须停止并重新审根因；这不是首期授权。

## 16. 参考项目采用边界

| 来源 | 采用 | 不采用 |
| --- | --- | --- |
| `guoyihub/deepseek-harness-mobile`（MIT） | 配对状态机、设备吊销、Host/Client/App 分层、会话 RPC 思路 | 24 小时 QR、默认免确认、Vite 双端口、完整官方 Web Host |
| `april-jk/dsh-mobile-suite`（MIT） | Desktop 主动出站 WSS、短期 Web ticket、Relay 只转密文、离线状态 | Flutter 客户端、整页 DSH Web UI 代理、现成公共 Relay |
| `slopus/happy`（MIT） | 每设备身份、Session 事件流、E2EE、审批与推送交互 | CLI wrapper、第二 Agent/daemon、整套 server 和远程文件 RPC |
| 官方 `deepseek-ai/deepseek-harness`（MIT） | Session、Session Query、SDK 通知、写锁和恢复语义 | 私有文件解析、未经验证的非公开接口 |

复制任何源码前必须核对具体文件许可证与依赖；能按现有协议重写的薄适配优先于引入整个包。

## 17. 冲突裁决

从本合同生效起：

- “Mobile 继续补齐独立工作台”是历史方向；
- “Android 与 iOS 同步首发”不进入现行计划；
- “局域网可以先明文，公网再做安全”无效；
- “手机直接调用 runner 或 New API”无效；
- “一个全局 Harness 进程”改按 §3.2 理解；
- “首期必须浏览所有项目和会话”被当前活动 Session MVP 取代。

发生冲突时，以本合同、[[韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]、[[架构/产品架构]] 和 [[hot]] 为准。

## 18. 依据

- 当前源码：`src/services/deepSeekHarness.ts`、`src-tauri/resources/deepseek-harness/runner.mjs`、`src/components/memory/MemoryWorkbench.vue`、`src/runtime/memory/harnessConversationCatalog.ts`、`src-tauri/tauri.ios.conf.json`
- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness Mobile](https://github.com/guoyihub/deepseek-harness-mobile)
- [DSH Mobile Suite](https://github.com/april-jk/dsh-mobile-suite)
- [Happy](https://github.com/slopus/happy)

## 19. 真机联调记录（2026-09-27 晚）

环境：iPhone 13 Pro Max / iOS 26.6.2、Xcode 27、Tauri 2.11.2、官方 barcode-scanner 2.4.6、Noise XX 局域网 Bridge。

### 19.1 真机已验证

- 配对：扫码路径可用（修完二维码后）；「复制配对信息 → 手机粘贴」兜底路径可用
- 电脑端「允许这台设备连接？」审批弹窗 → 允许 → 手机完成配对
- 手机端 session 读取与订阅推送（电脑对话内容与逐字输出同步到手机）
- 手机发送 → 电脑执行 run
- 手机端错误提示可读（含电脑返回原文；不再出现 [object Object] 或裸 io 错误）

### 19.2 本轮修掉的真机 bug（全部有本机验证或代码依据）

1. 二维码生成器两处错误（**扫码识别不到的真因**）：画图顺序反了（定时图形覆盖定位框边缘 12 个模块）、校正图形步长公式错（8 版算成 6/22/42，标准为 6/24/42）。文件 `src/utils/qrCode.ts`。验证：与 Nayuki 参考实现逐位一致（12 种长度 / 版本 1~37）；严格解码器 jsQR 在 160/200/240/300/400px 全部可解（修复前全部不可解）；新增 3 条回归用例与黄金矩阵哈希。
2. 电脑端接客套接字继承了监听 socket 的非阻塞标志（macOS/BSD 会继承，Linux 不会），第一次读立刻 EAGAIN，连接在 Noise 手握手之前就被丢掉。`src-tauri/src/commands/remote_bridge.rs` 增加 `prepare_connection`。
3. 电脑端认证后仍保留 30 秒读超时，空闲会话被读死（手机连上 30 多秒后自动断开）。增加 `enter_session_mode`。
4. 手机端会话关闭后状态仍报「已连接」，且藏起重连入口。`DesktopSession` 增加 `closed` 标志，状态与请求统一走 `live_session`。
5. 事件序号是页面内自增计数器，页面重载/热更新后归零，手机端（要求严格递增）会把之后所有事件当旧事件丢弃。新增 `src/services/desktopRemoteEventSeq.ts`（时钟打底）。
6. 桥接监听器每次组件挂载都注册一个新的，且 `await` 期间卸载会导致清理失效（`offDesktopRemote` 仍是 null），旧实例被留在事件上，用空 context 抢答。`registerDesktopRemoteBridge` 改为进程内单例且始终指向最新 host。

### 19.3 当前阻塞点（交接）

- `context.get` 已正常：电脑返回 `sessionId = jc-v1-conversation-<uuid>`。
- 卡在下一步 `session.read`：电脑返回 `session "jc-v1-conversation-<uuid>" not found`。
- 入口链路：`src/components/memory/MemoryWorkbench.vue` 的 `desktopRemoteSnapshot` → `readDeepSeekHarnessSession`（`src/services/deepSeekHarness.ts`）。即该对话尚无对应的 harness 会话时，需要给出可用快照（或先建立会话），而不是抛错。

### 19.4 诊断手段（保留）

- 电脑端：debug 构建下 Bridge 生命周期写入 `/tmp/jc-bridge.log`（accept / 手握手 / 认证 / 认领 offer / 审批 / 断开原因）。
- 手机端：`INVALID_CONTEXT` 等失败会把电脑返回的原始 JSON 一起显示出来。

### 19.5 验证命令

- 门禁：`pnpm run test:focused:build && pnpm run test:focused:run`（本轮 1609/1609）、`pnpm exec vue-tsc -b`、`cd src-tauri && cargo test --lib remote_`（19/19）
- 出包装机：`pnpm run build:ios:quick` → `npx tauri ios build -t aarch64 -d --config '{"build":{"beforeDevCommand":""}}'` → `xcrun devicectl device install app --device <UDID> <解包后的 .app>`

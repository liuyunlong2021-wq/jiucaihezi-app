# 韭菜盒子 Mobile 控制 Desktop：Gateway 与 Mini Relay 统一合同 TDD V2

> 日期：2026-09-28
> 状态：现行目标合同，非已交付功能清单；G0 已复现四项红灯，G1 实施中且未过真机闸门，G2 仅有部分原型，G3→G5 未实施
> 目标：Mobile 控制韭菜盒子 Desktop 中同一个 Harness 对话；提供与 Codex 手机远控相当的控制闭环，LAN 与异地共用一套应用语义
> 取代：[[韭菜盒子Mobile桌面控制器统一合同与局域网MVP-TDD-2026-09-27]] 的目标架构、同步协议、幂等规则与 P3–P5 路线；旧文档继续作为 P0/P1/P2 实施和真机排障证据
> 前置合同：[[韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]、[[架构/产品架构]]

## 1. 一句话定案

韭菜盒子采用 **Desktop Gateway + Harness Runtime + Mobile Client + 可选 Mini Relay**：

- Desktop Gateway 是唯一远程控制平面；
- Desktop Harness 是唯一 Agent Runtime；
- Harness Session 是唯一对话历史真相；
- Mobile 只是经过认证的控制端，不运行 Agent、不保存第二份会话；
- Mini Relay 只转发端到端加密帧，不执行任务、不读取内容、不成为会话真相。

OpenClaw 只提供 Gateway 组织方式，Happy 只提供可靠同步与端到端加密参照；不引入它们的第二 Runtime、完整服务器、CLI wrapper、插件市场或多通信渠道。

### 本次校准的三个边界

1. 按此前“手机直接操作电脑的 APP”的上下文，本合同将目标解释为控制**韭菜盒子 Desktop App**，其现有执行链是 DeepSeek Harness；不是接管 OpenAI 官方 Codex Desktop App 或复用其私有会话。若目标其实是后者，须另立适配合同与可验证 API，不得把本合同验收写成已实现该能力。
2. 下文 V2 信封、`connect`、ledger、Relay 都是**目标协议**。当前仓库仍是 `REMOTE_PROTOCOL_VERSION = 1`、`requestId/type/payload` 信封和 LAN Noise Bridge；已有的 `session.attach` 等只是 V1 上的过渡实现。V1/V2 不得凭同名方法混用；迁移须明确版本拒绝/兼容与升级提示。
3. 优先修复手机“命令已执行却看不到结果”的闭环。Gateway 是否拆出一个新文件不是闸门；能在页面卸载后安全接收命令、执行、发布和补读，且只有一个 Runtime 与 Session 真相，才算过闸门。

## 2. 为什么必须重写合同

2026-09-27 真机已经证明：扫码、Noise 配对、手机发命令、Desktop 执行均可工作，但出现了两类结构性故障：

1. 新建目录对话尚未惰性创建 Harness Session，Mobile 初次 `session.read` 直接失败；
2. Mobile 命令已经让 Desktop 成功执行，手机却没有任何状态变化。

第二类不是单个 UI Bug。现有实现把远程状态发布挂在 `MemoryWorkbench.vue` 的响应式 `watch` 上，发布失败被吞掉，Mobile 只丢弃旧序号却不识别断档，`message.send` 又在 `void send(text)` 后立即返回 `accepted`。因此：

- “Desktop 接收了命令”与“Desktop 建立了运行”没有协议边界；
- “实时事件丢失”与“任务没有开始”在手机上表现相同；
- 页面生命周期、响应式依赖遗漏和连接抖动都会破坏控制链；
- 重连只能碰运气收到下一次推送，不能确定恢复到权威状态。

根因是缺少独立 Gateway 和可恢复同步协议，不是参考仓库名气不足，也不是 Harness 执行链需要重写。

## 3. 产品终态

用户可以在 iPhone 上：

1. 查看 Desktop 在线、离线、忙碌和当前版本；
2. 查看授权 Desktop 的项目与 Harness 对话；
3. 新建、选择和继续对话；
4. 发送文字，后续按独立合同增加图片和文件引用；
5. 实时看到用户消息、助手输出、推理、工具步骤、审批、失败和终态；
6. 停止、继续或按明确状态重试；
7. 在局域网直连，或通过韭菜盒子 Mini Relay 异地连接；
8. 手机锁屏、切后台、断网或切换网络后恢复同一 Desktop Session；
9. 撤销任意 Mobile 后使其 LAN 与 Relay 连接同时失效；
10. 回到 Desktop 后无迁移、合并或双写，继续使用同一对话。

“Codex 手机版级别的远控”指上述韭菜盒子会话控制闭环，不代表与官方 Codex App 互通、接管其线程或复制全部 Desktop 编辑器。

## 4. 不变量

以下规则在所有阶段均不得放宽：

1. Mobile 不启动 Harness、runner、Provider、Skill、MCP 或项目执行器。
2. 模型 Key、Desktop 私钥、绝对项目路径和 Session 私有文件不得下发 Mobile 或 Relay。
3. Harness Session 是持久对话与工具轨迹的唯一真相，不建立 Mobile/Relay 对话数据库。
4. Gateway 可以保存最小命令回执与设备记录，但不得复制正文历史。
5. Desktop 本地 UI 与 Mobile 命令进入同一个 Conversation Runtime 和同一并发规则。
6. Relay 失效不能影响 Desktop 本地使用；Mobile 缓存丢失不能影响 Desktop 数据。
7. 未取得确定回执的副作用命令不得换新 ID 自动重发。
8. 设备授权不扩大 Session 的文件、工具或审批权限。
9. Desktop 既有功能只增不减；不得为 Mobile 删除或降级本地能力。
10. 不自创密码算法，优先复用现有 `snow` 的 Noise 实现和系统钥匙串。

## 5. 目标架构

```text
                         LAN: Noise TCP
Mobile Client ─────────────────────────────────┐
                                              │
                         Remote: Noise over WSS│
Mobile Client ── WSS ── Mini Relay ── WSS ────┤
                                              ▼
                                     Desktop Gateway
                                      ├─ Device/Auth
                                      ├─ Command ledger
                                      ├─ Session projection
                                      ├─ Seq/stateVersion
                                      └─ Subscription routing
                                              │
                                              ▼
                                Desktop Conversation Runtime
                                      ├─ send / stop / approval
                                      ├─ current runs
                                      └─ project/session catalog
                                              │
                                              ▼
                                  deepSeekHarness / runner
                                              │
                                              ▼
                                   Official Harness Session
```

### 5.1 Desktop Gateway

Gateway 是 Desktop 应用级单例，不属于 `MemoryWorkbench` 页面：

- Tauri Desktop 启动时创建一次；LAN 连接和设备授权继续由现有 Rust 进程持有，应用协议与投影由应用级服务持有；
- 管理设备、连接、请求、命令去重、订阅和状态版本；
- 接收 Conversation Runtime 的显式状态变更；
- 生成 Mobile DTO；
- 页面重挂、路由切换不重置 Gateway；G1 的“常驻”只保证 Desktop 窗口及其 WebView 仍在运行；保留旧组件闭包并不等于 Runtime 独立，卸载后发送和审批仍须行为测试；
- 关闭窗口后继续工作属于 G5 的托盘/进程驻留闸门，未实施前必须明确显示 Desktop 离线，不得宣称无人值守可用。

`MemoryWorkbench` 不再通过 `watch` 猜测并发布远程状态。当前应用级服务仍以 `watch` 观察共享响应式状态，它只能作为过渡通知；正确性必须由 Runtime 状态、可补读的 snapshot 和明确的发布失败处理保证。最终 Desktop UI 和 Gateway 都消费同一 Runtime，不能依赖页面重新挂载来恢复命令入口。

### 5.2 Desktop Conversation Runtime

它是现有发送、停止、审批与运行状态的产品服务化边界，不是第二 Agent：

- 继续调用现有 `runDeepSeekHarness()`；
- 继续复用当前项目、能力开关、审批和同 Session 单忙锁；
- 对本地 UI 和 Gateway 提供同一套命令入口与状态订阅；
- 不要求重写 Harness 生命周期或解析物理 Session 文件。

迁移应分步完成：先把远程可见状态和命令生命周期移出组件，再按需要收拢其余运行状态；不得一次性重写整个工作台。

### 5.3 Mobile Client

Mobile 只持有：

- 本设备身份和 Desktop 配对凭证；
- 当前连接、context、snapshot、`stateVersion` 与 `seq`；
- 尚未完成对账的本地 pending 消息；
- UI 所需的短期投影。

Mobile 不以缓存修复 Desktop，不在离线时假装命令已送达。

### 5.4 Mini Relay

Relay 第一版只做：

- Desktop/Mobile 主动出站 WSS 连接；
- 认证后的设备在线登记；
- 将 Mobile 与目标 Desktop 的不透明二进制帧双向转发；
- 连接数、帧大小、速率、票据过期和设备撤销限制；
- 通用的“任务有更新”推送信号。

Relay 不做：

- Agent 执行、模型调用或工具审批；
- Prompt、回复、工具结果或项目文件解密；
- 对话历史数据库；
- Desktop 离线时排队执行副作用命令；
- 多渠道插件系统。

## 6. 真相与短期状态

| 数据 | 真相所有者 | Gateway 可保存 | Mobile 可保存 | Relay 可见 |
| --- | --- | --- | --- | --- |
| 对话与工具轨迹 | Harness Session | 当前投影 | 当前投影缓存 | 密文长度与路由元数据 |
| 项目/对话目录 | Desktop catalog | 受控列表投影 | 展示缓存 | 不可见正文 |
| 当前运行 | Conversation Runtime | 运行投影与版本 | 展示缓存 | 加密帧 |
| 命令回执 | Desktop Gateway | 最小 ledger | pending/receipt | 加密帧 |
| 设备授权 | Desktop secure store | 授权、吊销状态 | 自身凭证 | 路由身份、撤销版本 |
| API Key/工具配置 | Desktop | 不复制 | 禁止 | 禁止 |

Gateway 命令 ledger 只允许保存：`deviceId`、`commandId`、`sessionId`、命令类型、参数摘要哈希、状态、`runId`、时间和过期时间。不得保存消息正文或工具参数。

## 7. 统一应用协议 V2

局域网 TCP 与 Relay WSS 最终只替换传输层，使用同一应用协议。本节是目标 V2，不是当前已上线的 V1 信封。G1 可在现有 V1 LAN 上先修通控制闭环；G2 再完成版本化迁移。配对二维码的格式版本与业务信封版本分开判断，不能因同为数字 1 就假定两者相同。

### 7.1 信封

```ts
type GatewayRequest = {
  v: 2
  kind: 'req'
  id: string
  method: string
  params: unknown
}

type GatewayResponse = {
  v: 2
  kind: 'res'
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string; retryable: boolean }
}

type GatewayEvent = {
  v: 2
  kind: 'event'
  event: string
  sessionId?: string
  gatewayEpoch: string
  seq?: number
  stateVersion?: number
  payload: unknown
}
```

禁止用错误文案字符串参与控制逻辑。所有可处理错误必须有稳定 `code`。

迁移测试：V1 Mobile 连到 V2 Desktop、V2 Mobile 连到 V1 Desktop，均须给出可读的升级/协议不兼容状态；不得把未知字段当作成功，更不得因回包解析失败而重发副作用命令。若保留 V1 兼容层，其支持期限和真实可调用方法须显式列出；未列出时默认明确拒绝。

### 7.2 连接握手

Noise 握手完成后，首个应用请求必须是 `connect`。现有扫码配对已经固定 Desktop Noise 静态公钥，并以 Mobile 设备密钥和授权记录认证；V2 不额外发明一套签名身份。`connect` 的设备身份必须与已认证的 Noise 连接绑定，Relay 票据只负责路由，不替代设备授权：

```ts
type ConnectParams = {
  protocol: 2
  role: 'mobile'
  deviceId: string
  deviceName: string
  platform: 'ios' | 'android'
  appVersion: string
}
```

成功返回 `hello`：

- `gatewayEpoch`；
- Desktop ID、版本、平台与在线能力；
- 支持的 methods/events；
- 当前授权和吊销版本；
- 心跳间隔；
- 是否经 LAN 或 Relay。

`gatewayEpoch` 每次 Gateway 实例创建时重新生成（含 Desktop 重启、WebView 重载或异常恢复）。Mobile 发现 epoch 变化必须丢弃旧增量游标并重新 attach，不得拿旧 `seq` 与新实例比较。

### 7.3 核心方法

| 方法 | 语义 |
| --- | --- |
| `gateway.health` | 读取 Gateway/Runtime 健康状态 |
| `context.get` | 当前 Desktop context 与最小能力 |
| `project.list` | G3 起读取授权项目列表 |
| `session.list` | G3 起读取项目下对话目录 |
| `session.create` | G3 起新建 Desktop 对话目录项 |
| `session.attach` | 订阅与 snapshot 无丢失窗口；按 §7.4 验证基线一致性 |
| `session.read` | 重新读取权威 snapshot |
| `message.send` | 以 `commandId` 提交消息 |
| `command.get` | 按原 `commandId` 查询回执或不确定状态；只读，不执行命令 |
| `run.stop` | 幂等停止当前 run |
| `approval.respond` | 回答精确审批 ID |
| `question.respond` | G3 起回答模型追问 |

未知方法返回 `METHOD_NOT_FOUND`。方法权限由设备 scope 与当前 Session 权限共同决定。

### 7.4 原子 attach

旧的 `session.read → session.subscribe` 存在读完尚未订阅时丢事件的窗口。V2 改为一个 `session.attach`：

1. Gateway 先登记订阅并开始缓存该订阅后发生的事件；
2. 在异步读取官方 Session **之前**记录该订阅的基线，读取期间不丢事件；
3. 将官方历史与 Runtime 即时状态合并为 snapshot，并核对它对应的版本/序号；若读到的历史仍落后于已经完成的 run，不能把它标成最新 snapshot；
4. 只有能证明 snapshot 与返回的基线一致，或客户端按版本规则重放缓存事件后可收敛到相同状态，才返回成功；否则有界重读或返回 `REATTACH_REQUIRED`，绝不悄悄跳过窗口内的终态；
5. 订阅取消、切换 Session 和连接断开时释放缓存；缓存超限则要求客户端重新 attach。

这里的“原子”指客户端看不到 `read → subscribe` 空窗，不要求把异步 Harness Session Query 锁在一个长临界区，也不得阻塞 Desktop 本地发送。

实现约束：`attach` 的初始序号基线必须在异步读取前取得；不能在重读后随意提升游标而丢掉已发生的终态事件。若 snapshot 混入基线之后的状态，重放缓存事件时不得把较新的投影覆盖回旧状态。G1 闸门须用“读取中产生事件、历史查询返回旧值、连续流式事件、终态事件后官方历史尚未可读”四个场景验证最终投影一致；只证明没有漏序号不等于证明快照原子性。

返回值至少包含：

```ts
type SessionAttachment = {
  sessionId: string
  gatewayEpoch: string
  seq: number
  stateVersion: number
  snapshot: MobileSessionProjection
}
```

空白新对话是合法 snapshot，不要求提前创建 Harness Session。

## 8. Session 投影

```ts
type MobileSessionProjection = {
  context: {
    projectId: string
    projectName: string
    conversationId: string
    conversationTitle: string
    sessionId: string
  }
  turns: MobileTurn[]
  pendingTurn?: {
    commandId: string
    runId: string
    role: 'user'
    content: string
    state: 'accepted' | 'running'
  }
  streamingText: string
  reasoningText?: string
  run: {
    runId?: string
    state: 'idle' | 'accepted' | 'running' | 'waiting-approval' | 'done' | 'failed' | 'stopped'
    status?: string
    steps: MobileStep[]
    approval?: MobileApproval
    error?: { code: string; message: string }
  }
}
```

投影必须覆盖纯工具轮：没有 assistant 正文时，`pendingTurn/run/steps` 仍然变化并可见。

历史 `turns` 来自官方 Session Query；尚未持久化的用户消息与流式状态来自 Conversation Runtime。两者只在 Gateway 投影中合并，不写第二份会话文件。

## 9. 事件、版本与恢复

### 9.1 两类事件

- 持久结果失效通知：`session.changed`、`context.changed`。客户端可随时用 snapshot 恢复。
- 临时运行事件：`run.changed`、`stream.delta`、`approval.changed`、`presence.changed`。

事件不是永久日志。丢失后以 `session.attach/read` 恢复，不在 G1/G2 建事件数据库。

### 9.2 顺序规则

每个 Session 在一个 `gatewayEpoch` 内拥有独立连续 `seq`：

```text
seq == lastSeq + 1  → 应用
seq <= lastSeq      → 重复或旧事件，丢弃
seq > lastSeq + 1   → 出现断档，停止应用并重新 session.attach
epoch 改变          → 清空游标并重新 session.attach
```

`stateVersion` 仅在可见投影变化时递增；同一投影变更对应的完整状态事件带该版本。`seq` 是每个 Session 的事件序号，二者不是同一个计数器。Mobile 对 `seq` 检查断档；对完整状态事件检查 `stateVersion` 单调性，只有协议声明为“逐版本增量”的事件才要求版本连续。`context.changed` 等全局事件不占某个 Session 的 `seq`，而是触发重新获取 context/attach。

`session.read/attach` 必须能恢复当前运行投影（含尚未落入官方 Session 的 pending、流式文本、工具步骤和终态）；不能只读持久历史，否则丢了最后一个事件时仍会显示旧状态。

### 9.3 生命周期恢复

以下情况必须重新 attach 当前 Session：

- 物理连接重建；
- iOS 从后台回到前台；
- `seq/stateVersion` 断档；
- Desktop `gatewayEpoch` 改变；
- context 改变；
- Mobile 发现 pending 命令超过确认期限（先 `command.get`，再 attach）；
- Relay 从不可用切回可用。

重连使用指数退避和随机抖动；回到前台允许立即尝试一次。网络恢复不得自动生成新的 `commandId`。

## 10. 命令回执、幂等与并发

### 10.1 `commandId`

所有副作用请求必须包含 Mobile 生成的 UUID `commandId`。Gateway 对 `(deviceId, commandId)` 建唯一约束：

- 第一次收到：校验参数摘要，认领命令；
- 相同 ID、相同摘要：返回已有 receipt；
- 相同 ID、不同摘要：返回 `COMMAND_ID_CONFLICT`；
- 已撤销设备：即使 ledger 有记录，也拒绝执行与查询；吊销不能被历史回执绕过。

G1 先以进程内 ledger 阻止当前进程重复执行；G2 起执行前必须持久认领，写入失败时不得调用 Runtime。认领后若 Desktop 在“实际执行/记录回执”之间崩溃，恢复为 `uncertain`，不能把“没看到完成记录”解释为“没执行”。持久 ledger 保留至少 30 天；过期命令不允许自动重试，客户端只能通过 snapshot 对账并由用户发起新命令。因此 G1 只保证进程内去重，G2 才保证保留窗口内的跨重启 at-most-once。

### 10.2 发送状态

Mobile 本地状态：

```text
draft → sending → accepted → running → committed
                         └→ failed/stopped
```

- `sending`：只存在 Mobile，本地立即显示；
- `accepted`：Runtime 已给出可查询的 `runId`，Gateway 已建立 pending turn 和当前进程可查询的回执后返回；若建立 run 失败，返回明确错误而不是 `accepted`；G2 起回执还须持久；
- `running`：Harness 已开始处理；
- `committed`：官方 Session snapshot 已包含正式轮次，或官方查询明确确认该轮次；
- `failed/stopped`：必须带明确终态。

`committed` 只表示用户轮次已进入官方 Session，不等于 Agent 已完成；运行终态仍以 `run.state` 独立表示。Mobile 只有在正式轮次可见后才按 `commandId/runId` 去掉本地 pending，不能因收到 accepted 就删除输入。若官方 Session 尚未读到而 Runtime 已终止，仍保留可解释的 pending/终态并继续补读；不能显示“已完成”同时丢掉用户消息与结果。

`message.send` 不得在 `void send()` 后提前返回成功。

### 10.3 重试语义

- 查询与 attach 可以自动重试；
- 未收到回执的副作用命令只能使用原 `commandId` 重试；
- Gateway 返回缓存 receipt 时不得再次执行；
- 手机回前台或回执超时，先 `command.get` 再 `session.attach` 对账；查询结果为 `unknown/uncertain` 时不得自动换新 ID 重发；
- Desktop crash 后 ledger 状态为 `uncertain` 的命令不自动执行，由 snapshot 对账后让用户决定；
- Desktop 离线时 Relay 不缓存命令，Mobile 保留草稿并明确显示未送达。

G2 起提供 ledger 保留窗口内的 at-most-once 执行，不宣称跨进程崩溃下的数学 exactly-once。

### 10.4 错误码最小集合

`INVALID_REQUEST`、`UNAUTHORIZED_DEVICE`、`DEVICE_REVOKED`、`SESSION_NOT_CURRENT`、`SESSION_BUSY`、`MESSAGE_EMPTY`、`COMMAND_ID_CONFLICT`、`COMMAND_EXPIRED`、`RUN_NOT_STARTED`、`APPROVAL_RESOLVED`、`METHOD_NOT_FOUND`、`REATTACH_REQUIRED`。错误响应保留 `code/message/retryable`；只有 `retryable=true` 且命令仍在保留窗口内时，Mobile 才能沿用同一 `commandId` 重试。未知错误不得显示为成功。

### 10.5 并发

- 同一 Session 同时只允许一个活动 run；
- Desktop 本地和 Mobile 使用同一个忙锁；
- 第二条消息返回 `SESSION_BUSY`，G1/G2 不建队列；
- `run.stop` 幂等；
- 审批只接受当前精确 approval ID，后续响应返回 `APPROVAL_RESOLVED`。

## 11. 传输与安全

### 11.1 LAN

保留现有 Noise XX TCP、一次性二维码、Desktop 明确确认、钥匙串身份、设备吊销、帧/连接/速率限制。V2 只替换 Noise 内的应用协议，不因架构升级先重写已经工作的密码和 socket 层。

### 11.2 Relay

Desktop 与 Mobile 都只建立主动出站 WSS。Relay 根据最小路由头匹配连接，随后转发 Noise 握手帧和加密业务帧：

- 二维码固定 Desktop Noise 静态公钥；
- 每次连接重新协商会话密钥；
- Relay 无法获得明文；
- Relay 只能看到账号/设备路由 ID、连接时间、IP、帧大小、流量和在线状态；
- Relay 日志不得记录完整票据、密文帧或推送内容；
- 服务器泄露不能恢复历史正文。

Relay 的连接票据由现有账号服务签发且短期有效；账号身份只负责“路由到哪台电脑”，内容信任仍由设备配对和 Noise 公钥决定。

### 11.3 推送

APNs 第一版只发送通用类别：任务完成、任务失败、需要审批、电脑离线。通知正文不含 Prompt、回复、文件名或工具参数；点开后 Mobile 重新连接并读取 snapshot。

### 11.4 撤销

Desktop 吊销设备后：

1. 关闭 LAN 与 Relay 现有连接；
2. 增加授权版本；
3. Relay 拒绝该设备的新路由；
4. Mobile 本地凭证即使未删除也无法重连；
5. 审计只记录设备 ID、时间、动作和结果。

## 12. 完整手机控制面的范围

### 12.1 必须完成

- 电脑、项目和对话导航；
- 新建/选择对话；
- 文字发送与可靠状态；
- 历史、流式正文、推理和工具步骤；
- 审批、追问、停止、失败与恢复；
- 当前模型、推理档位和能力只读展示；
- 经独立安全合同后允许选择 Desktop 已配置模型；
- 图片与文件引用按受控上传合同后增加；
- LAN/Relay 自动选路、离线和重连状态；
- 完成、失败与审批通知。

### 12.2 本合同不做

- 手机本地 Agent/模型/runner；
- 项目完整文件镜像或任意文件浏览器；
- 远程桌面、屏幕操控或终端复刻；
- WhatsApp、Telegram、Slack 等多渠道；
- 通用 Gateway 插件 SDK；
- Relay 端搜索、摘要或历史分析；
- Android 与 iOS 同时首发。

当第二个真实通信渠道出现前，不抽象 Channel 插件系统。

## 13. TDD 红灯矩阵

### 13.1 Gateway 生命周期

| 红灯 | 预期 |
| --- | --- |
| `MemoryWorkbench` 重挂 | Gateway epoch、连接和命令 ledger 不重置 |
| 页面未打开但 Runtime 可用 | Gateway health 可响应，不依赖 Vue `watch` |
| 关闭 Desktop 窗口（G5 前） | 显示离线，不宣称后台继续执行；G5 驻留启用后才验证关窗常连 |
| Desktop 进程重启 | epoch 改变，Mobile 强制全量 attach |
| 发布到已关闭连接 | 返回可观测失败，不得静默吞掉 |
| 两个 Gateway 实例注册 | 第二个失败，单例边界明确 |

### 13.2 attach 与同步

| 红灯 | 预期 |
| --- | --- |
| attach 建快照时产生新事件 | 事件不会落入 read/subscribe 间隙 |
| 读取中收到终态、官方历史查询暂时返回旧值 | 保留 pending/终态并补读；不得以较新的游标返回旧 snapshot |
| 流式事件不断发生且查询重读仍有变化 | 最终投影单调，不因旧全量事件覆盖新 snapshot；不无限阻塞 attach |
| 新建空白对话 | 返回空 snapshot，不报 Session not found |
| 收到连续 seq | 快速应用且版本前进 |
| 丢失 seq=12 后收到 13 | 不直接应用 13，自动重新 attach |
| 重复事件 | 不重复消息或倒退终态 |
| epoch 改变但 seq 更大 | 仍然全量 attach，不跨 epoch 比较 |
| 旧 Session 事件迟到 | 不污染当前 Session |
| 纯工具轮 | 无正文也显示 pending/run/steps/终态 |

### 13.3 命令与回执

| 红灯 | 预期 |
| --- | --- |
| 手机点发送 | 立即显示 `sending`，无需等待 Desktop 推送 |
| `void send()` 尚未建立 run | 不得返回 accepted |
| 页面卸载后发送/停止/审批 | 不访问已销毁的组件状态；命令由同一 Runtime 执行，官方 Session 可补读 |
| Desktop 本地与 Mobile 同时发送 | 共用同一 busy 判断；被拒绝的一方不生成孤儿 user turn |
| accepted 响应丢失后同 ID 重试 | 返回原 receipt，只执行一次 |
| 回执超时后 `command.get` | 只读返回原状态；`unknown/uncertain` 不触发新 run |
| ledger 持久认领失败 | 不进入 Runtime，不产生副作用 |
| 认领后执行前崩溃 | 重启标为 uncertain，不猜测为未执行 |
| 同 ID 不同正文摘要 | `COMMAND_ID_CONFLICT` |
| 同 Session 本地与 Mobile 同发 | 一个认领，另一个 `SESSION_BUSY` |
| Desktop 离线 | Relay 不排队，Mobile 明确显示未送达 |
| crash 后命令状态不明 | 标记 uncertain，不自动再次执行 |
| stop/approval 重试 | 幂等或返回已解决，不重复副作用 |

### 13.4 Mobile 生命周期

| 红灯 | 预期 |
| --- | --- |
| iPhone 锁屏期间任务完成 | 回前台后 snapshot 恢复完整终态 |
| Wi-Fi 切蜂窝 | 重连并重新 attach，不重复发送命令 |
| 事件监听尚未注册 | attach 不得完成，封住初始化竞态 |
| 连接中断 | 保留屏幕投影，明确显示重连中 |
| pending 超时 | 主动对账，不假装成功或失败 |

### 13.5 安全与 Relay

| 红灯 | 预期 |
| --- | --- |
| Relay 查看业务帧 | 只能得到密文和路由元数据 |
| 篡改 Noise 帧 | 解密失败且不执行命令 |
| 假 Relay 替换 Desktop 公钥 | Mobile pinning 拒绝 |
| 被吊销设备走 LAN/Relay 重连 | 两条路径都拒绝 |
| 票据过期/重放 | 路由失败，不到达 Gateway |
| 超帧、过频、多连接 | 限制生效且 Desktop/Relay 保持可用 |
| 日志审计 | 不含正文、密钥、完整密文和项目路径 |

### 13.6 端到端故障注入

G1 必须有一条真实 Rust TCP/Noise 假 Mobile 闭环；G4 增加同一合同下的 Relay 集成测试：

```text
Mobile message.send
→ Gateway accepted
→ Harness 假 Runtime streaming
→ Mobile 显示 running
→ 人工丢弃中间事件
→ 下一事件触发 attach
→ Mobile 恢复 completed snapshot
→ 相同 commandId 重试不产生第二个 run
```

单元测试不能替代 iPhone 真机的后台、网络切换和 APNs 验收。

## 14. 实施阶段与闸门

### G0：合同与红测

- 登记 V2 schema、状态机、错误码与测试；
- 旧实现必须在“提前 accepted、事件断档恢复、页面生命周期”测试上出现真实红灯；
- 不在此阶段改网络或 UI。

提前 accepted、手机本地 pending 缺失、事件断档不补读、工作台卸载后 Gateway 不响应四项行为红灯已写并稳定复现；G0 红灯闸门已通过。后续逐项转绿，不以局部单元测试代替 G1 真机闸门。

闸门：红灯能稳定复现“电脑执行、手机无反应”，且不是只做源码字符串断言。

### G1：Desktop Gateway 与确定回执

- 先写行为红测：页面卸载后同 Session 的发送/停止/审批、同 Session 本地与手机争用、发送回执丢失、attach 历史落后和连续流式竞态；确认旧实现会失败；
- 在 Desktop 应用级保持 Gateway/Host；将发送、停止、审批和运行状态的**正确性边界**收至同一个 Conversation Runtime，Desktop UI 与远程入口使用同一 busy/权限规则。仅把 Map 或发布 `watch` 移出组件不算完成；
- LAN 上 `session.attach` 必须通过 §7.4 的快照/事件一致性测试，手机可主动补读官方 Session 与当前 Runtime 状态；
- `message.send` 使用 `commandId`，只在 run 建立且可按 ID 查询后返回 accepted；Mobile 立即显示 sending，并能呈现 accepted/running/终态/正式历史；
- 进程内去重覆盖成功、失败和回包丢失；G2 再持久化 ledger。发布失败必须可观测，手机不得只靠单次推送拿最终结果；
- 保留已工作的 V1 LAN/配对链路；V2 信封、`connect` 和跨重启保证不是 G1 已完成的隐含前提。

闸门：自动化覆盖上述红测并转绿；局域网 **iPhone 真机**以同一 Desktop Session 完成“发送 → 首 token 前看到状态 → 纯工具/审批或可观测步骤 → 最终官方历史 → 返回电脑继续”，再故意丢事件、切换工作台页面和重连，手机仍恢复最终状态，且命令只执行一次。记录设备、App 版本、网络、步骤与实际结果；缺少这份记录只能写“自动化通过、G1 真机未验收”。窗口关闭后的无人值守不在 G1 验收范围。

### G2：可靠同步与生命周期

- 将 LAN 业务信封迁到 §7 的 V2，完成 `connect`、结构化错误、协议不兼容提示和 V1/V2 升级测试；
- epoch、per-session seq、stateVersion 的语义与实现对齐，不能把已有的 V1 序号字段称作 V2 已交付；
- gap 检测与自动 attach；
- 前台恢复、心跳、指数退避重连；
- 最小持久命令 ledger；
- crash/uncertain 对账。

闸门：故障注入、锁屏、切网和 Desktop 重启不丢最终状态、不重复任务；对已认领但未确定是否执行的命令显示 uncertain，绝不自动执行第二次。真实锁屏/切网须有 iPhone 记录；仅模拟测试不算过闸门。

### G3：完整 Session 控制面

- 项目/对话列表、新建/切换；
- 审批、追问、停止、失败恢复；
- 模型/推理档位只读展示，再按权限合同开放选择；
- 图片和文件引用另立安全与大小合同。

闸门：手机可独立完成“选项目 → 新建对话 → 发任务 → 审批 → 查看结果”，但执行始终在 Desktop。

### G4：Mini Relay

- 先核实现有韭菜盒子服务器的部署入口、账号鉴权、WSS 反向代理、证书和日志权限；未核实前不能把“复用现有账号服务”当作已具备能力；
- 在核实可用的现有服务器上部署 WSS Relay；
- Desktop 主动出站常连；
- Noise over WSS、短期路由票据、限流与撤销；
- LAN 优先、Relay 回退；
- Relay 故障不影响 Desktop 本地或 LAN。

闸门：蜂窝网络真机完成与 LAN 相同的端到端用例；服务器侧无法解密测试载荷。

### G5：常驻、推送与发布

- 可选登录启动和关闭窗口驻留；
- APNs 通用通知；
- Gateway health/诊断与用户可读连接状态；
- iOS 正式签名、TestFlight、Mac/Windows 长时稳定性；
- iOS 验收后再立 Android 发布任务。

闸门：24 小时连接、后台通知、撤销、升级和多网络切换真实验收。

不得把 G1–G5 并成一次重写。每阶段只有前一阶段自动化和要求的真实设备闸门通过后才可宣称该阶段完成；可为后续阶段写红测或做不影响当前闸门的原型，但不得把它记作已交付。

## 15. 预计代码边界

名称可在红灯阶段按现有目录风格调整，职责不可回流到页面：

- `src/services/desktopRemoteGateway.ts`：Gateway 单例、attach、命令 ledger、投影、seq/version；
- `src/services/desktopConversationRuntime.ts`：现有发送/停止/审批和运行状态的产品服务边界；
- `src/services/desktopRemoteProtocol.ts`：V2 schema、错误码和校验；
- `src/services/mobileRemoteClient.ts`：pending、receipt、gap/epoch 恢复与前后台生命周期；
- `src-tauri/src/commands/remote_bridge.rs`：LAN Noise transport 与设备安全；
- `src-tauri/src/commands/remote_client.rs`：Mobile LAN/Relay transport；
- 新 Relay 服务：只做 WSS 路由、票据、限流、在线与推送信号；
- `MemoryWorkbench.vue`：改为 Runtime/Gateway 的 UI 消费者，不再负责网络发布；
- `src/mobile/*`：控制器 UI，不引入 Runtime。

禁止为了“架构漂亮”一次性搬空 `MemoryWorkbench`、重写 Harness 或建立通用插件框架。

## 16. 参考实现采用边界

| 来源 | 采用 | 不采用 |
| --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | 单常驻 Gateway、typed req/res/event、hello snapshot、挑战签名、设备角色、epoch/seq/version、gap 后刷新 | 多聊天渠道、插件系统、第二 Agent Runtime、Gateway 自有对话数据库、Node daemon 整搬 |
| [Happy](https://github.com/slopus/happy) | E2EE 远程控制、`localId`、outbox/receipt、游标补拉、前台恢复、审批与推送交互 | CLI wrapper、Happy Server/Agent 整套、公共 Relay、远程文件与终端全量 RPC |
| 官方 DeepSeek Harness | Session、Session Query、SDK 事件、写锁、Compaction 与恢复语义 | 私有物理文件解析、Mobile 直接调用、第二 Session 存储 |
| 现有韭菜盒子 P0/P1/P2 | Noise XX、扫码确认、钥匙串、吊销、LAN TCP、iOS 包壳和现有 UI 组件 | V1 fire-and-forget 全量投影、Vue `watch` 作为正确性来源、提前 accepted |

引用代码前逐文件核对许可证；优先复用协议思想和现有依赖，不复制整套工程。

## 17. 冲突裁决

自本合同生效：

- V1 的“`session.event` 整份投影覆盖即可、不需要断档恢复”失效；
- V1 的“副作用未确认时完全不重试”改为“只能用同一 `commandId` 安全重试”；
- V1 的“公网阶段再考虑共同语义”失效：G1 即按 V2 的命令/快照语义修 LAN 闭环，G2 再迁移实际业务信封；G4 复用 G2 的同一信封，不另造 Relay 专用协议；
- V1 的“MemoryWorkbench 注册 Host 并负责实时投影”仅保留为历史实现，不是终态；
- “直接整合 OpenClaw/Happy”无效，只采用 §16 的边界；
- “Mini Relay 保存离线命令”无效；
- “完整手机控制 = 手机运行 Agent/复制文件库/远程桌面”无效。

冲突时以本合同、Harness Session 合同、产品架构和 `hot` 为准。

## 18. 验证纪律

- 每一非平凡状态分支必须先有会失败的测试；
- 协议测试优先行为断言，源码字符串断言只能守构建边界；
- Rust 真实 socket/Noise 测试与 TypeScript 状态机测试都必须覆盖；
- Relay 必须有恶意路由、篡改、重放、撤销和日志脱敏测试；
- Desktop focused/Rust/Desktop build/iOS build 是基本门禁；
- 真机未执行不得写“手机可用”，公网未执行不得写“异地可用”；
- 只有“手机发出 → Desktop 执行 → 手机恢复最终结果”的故障注入闭环才算同步通过。

## 19. 当前基线

截至 2026-09-28：

- 已有 Noise XX LAN Bridge、扫码/粘贴配对、Desktop 审批、设备钥匙串、吊销和 iOS 控制器；
- 已有当前 Session 的读取、发送、停止、审批和真机上行执行；
- 已修新对话尚无 Harness Session 时的读取失败；
- 已确认“Desktop 执行成功但 Mobile 无反应”，证明 V1 事件发布与恢复合同不成立；
- G0 四项真实行为红灯均已复现，并在当前定向测试中转绿。当前 LAN **仍为 V1 信封**；已实现手机 pending、进程内去重、runId 回执、主动补读、先订阅后读取的 attach 原型、应用级运行状态/事件发布，以及终态后补读官方历史。Desktop App 现于启动时绑定应用级 Host；远程发送、停止、审批不再借用 `MemoryWorkbench` 闭包，本地与远程 Harness 进度均走共享 `executeDesktopHarnessRun` 并使用同一 run 表。页面只消费远程完成结果更新显示；官方 Session 仍是历史真相。
- **G1 新增红→绿证据**：手机推送里的乐观轮次不再冒充官方历史清除 pending；官方历史暂时落后时保持补读。attach 不再用较早外层基线覆盖快照自身游标，Mobile 也不会让已被快照包含的缓存旧事件倒退投影。共享执行入口拒绝已停止的 run，异步准备结束后不会再启动 Harness。Mobile 现接收 Desktop 的临时用户轮次，任务完成后仍显示工具步骤；空闲时低频补读可恢复完全丢失的 Desktop 主动任务推送，且低序号旧快照不能覆盖新投影。Desktop 只有在官方 Session 出现本次用户轮次后才清除临时状态；旧历史返回时等待后续补读。同文消息还必须检查官方事件时间不早于本次发送，避免页面原有历史不完整时误认旧轮次。Rust 新增复用生产认证连接循环的真实 TCP/Noise 假 Mobile：`auth → attach → message.send → running/done 事件 → session.read`，验证无 assistant 正文的纯工具轮在丢过程后仍可恢复；失败 attach 也不会留下越权订阅。执行端是测试假 Runtime，不是 Harness/WebView。上述均不等于 iPhone 真机验收。
- **G1 最新红→绿证据**：若 `context.changed` 丢失，Mobile 的空闲补读遇到 `SESSION_NOT_CURRENT` 会重新获取当前 context，再 attach 新 Session；前台恢复也先核对 context。Desktop 暂无打开的对话时，手机清掉旧投影，显示“已连接电脑，等待电脑打开对话”，之后继续侦测新对话。定向状态机/UI 测试 `43/43`、完整 focused `1653/1653`、Desktop/iOS quick build 与产物审计通过；不等于真实 iPhone 验收。
- **G1 真机长对话新红→绿**：用户截图曾把已成功的粘贴配对误判为相机权限失败；Desktop 日志证实 offer 领取、审批、认证均成功。实际卡在会话读取：当前长对话可见正文约 187 KB，旧 Noise 单帧 64 KB 写入失败后手机停在“已连接”配对页。真实 TCP/Noise 180 KB 双向红测复现 `FRAME_TOO_LARGE`，分块传输后转绿，认证 Gateway attach 大快照同样通过；分块总量上限 8 MiB、读取超时 30 秒，写失败关闭连接。手机已连传输却未进会话时显示重试而不要求重复配对，旧相机错误在恢复连接时清除。focused `1654/1654`、Rust `450 passed / 1 ignored`；新版 iPhone 包已构建安装，端到端复测仍待完成。
- **G1 未过闸门**：页面外远程 run/停止/审批与并发已由模拟执行器验证，Rust 传输闭环已覆盖假 Runtime，但真实 WebView Host + Harness + Rust Noise TCP 的页面卸载端到端尚未测；应用级发布者仍 `watch` 响应式状态；当前 attach 虽修了若干回退，仍未证明全部“旧官方历史 + 已发生终态 + 持续事件”的快照一致性；发布失败补读和 iPhone 真机恢复尚未验收。不能因已有自动化测试变绿就写“手机已可稳定使用”。
- **G2 仅部分原型**：已有 epoch/序号、gap 检测和前台恢复的代码，但还没有 V2 业务信封、持久 ledger、跨重启 uncertain 保证或真实锁屏切网证据。G3–G5 未实施。

下一步继续 G1：把已验证的 Rust Noise TCP 假 Mobile 与 WebView Host/Harness 执行接成同一条页面卸载端到端故障注入，补齐持续流式/旧历史快照一致性；最后做 LAN iPhone 真机闭环。G1 闸门过后才按 G2 迁移 V2 信封、持久 ledger 和跨重启对账。

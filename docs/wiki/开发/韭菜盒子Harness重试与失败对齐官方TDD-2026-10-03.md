# 韭菜盒子 Harness「重试与失败」对齐官方 TDD

> 状态：**待用户确认，未实施**
> 日期：2026-10-03
> 范围：`MemoryWorkbench` 的 Harness 路径（`runtime === 'dh'`）的重试显示与失败显示
> 前提：**100% 搬运官方语义与实现**，不新增自研设计；官方未公开的接口沿用已登记的薄桥

## 0. 官方版本调查（2026-10-03 实测，不是推测）

| 项 | 值 |
| --- | --- |
| npm dist-tags | `latest` / `next` = **0.2.0-rc.2**；`alpha` = **0.1.7-alpha.2**（我们装的） |
| 我们的安装 | `src-tauri/resources/deepseek-harness/package.json` → `@deepseek-ai/dsh-sdk-client: 0.1.7-alpha.2` |

把 `@deepseek-ai/dsh-sdk-protocol@0.2.0-rc.2` 与 `@deepseek-ai/dsh-sdk-jsonrpc-server@0.2.0-rc.2` 下载解包后逐字对比：

| 面 | 0.1.7-alpha.2 | 0.2.0-rc.2 |
| --- | --- | --- |
| 请求方法 | `initialize` / `session/prompt` / `shutdown` | **逐字相同** |
| 通知方法 | `session.event` / `session.status` / `subagent.started` / `subagent.finished` | **逐字相同** |

**结论（决定本 TDD 的边界）：**

1. **升级 0.2.0-rc.2 换不到任何接口面**（请求/通知面逐字相同）。所以升级的收益不在接口，而在**行为修复**（官方 0.2.0-rc.1 修了「工具调度异常后对话无法继续」、rc.2 优化了「过程信息」）。
   **顺序已定：先升级，再做本 TDD**，见 [[开发/韭菜盒子Harness升级0.2.0-rc.2方案-2026-10-03]]。因此本 TDD §1 的 fixture 与 §2 的官方 UI 语义，实施时一律以**升级后**的官方源码为准重采一次，不按 0.1.7-alpha.2 写两遍。
2. **「零 patch 的 100% 官方」在官方接口下不可行**：官方 SDK 至今不公开会话读、权限切换与投影通道。
3. 本 TDD 的「100% 官方」落实为：**官方有实现的，100% 搬运（节点类型、字段名、文案、折叠规则、重试语义逐字对齐）；官方没公开的，维持已登记薄桥**——符合本合同 §12.1「只允许两类覆盖」与 §12.4「官方没有的能力不自己造，只补最薄的桥」。

## 1. 数据源：全部是官方事件，不解析私有存储

`session/read` 返回的完整事件流（我们已在用）。本期**新消费**三种官方事件：

| 事件 | 官方出处 | 用途 |
| --- | --- | --- |
| `llm/retry` | `dsh-llm-retry/lib/types/types.d.ts` | 重试链：`retry` / `maxRetries` / `delayMs` / `failure.code` / `failure.message` / `policyKey` |
| `llm/retry-started` | 同上 | 该次重试由 `scheduled` → `started` |
| `assistant/attempt` | `dsh-session/lib/types/types.d.ts:344` | 「未成为可见消息的模型尝试」：`stream[].chunk.reason.failure` |

已消费、不再改动的：`turn/end(reason.error)`（`types.d.ts:279`）→ 终态失败行；`tool/call` + `tool/result` → 过程行；`assistant/message` → 正文与推理。

**明确不解析** `storages/session_projcache/*.json`：那是官方投影缓存的物理文件，合同 §「不解析 Harness 私有存储」禁止直接读，必须走官方通道。

## 2. 搬运清单（逐条给出官方出处）

| # | 搬运什么 | 官方出处 | 我们的落点 |
| --- | --- | --- | --- |
| 1 | **重试行**：`<details>` 摘要 = `{label}（{retry}/{maximum}） · {seconds}s`，展开 = 「重试延迟 / 失败原因」 | `dsh-client-ui-chat/lib/client.js:1192-1250`（`ModelRetryItem`） | 过程区内新增一行，数据来自 `llm/retry` |
| 2 | **重试四态文案**：`正在重试模型请求` / `等待重试模型请求` / `已重试模型请求` / `模型请求重试已取消` | 同文件 `:5329-5335` | 逐字搬运（含 `（{retry}/{maximum}） · {seconds}s` 组合格式） |
| 3 | **倒计时**：活跃重试每秒刷新剩余秒数 | 同文件 `:1196-1216` | 与「在飞耗时」共用一个秒级时钟（官方 `LIVE_RUN_CLOCK_INTERVAL_MS = 1e3` 口径） |
| 4 | **终态失败行**：独立红点行 + `本轮运行失败` + 失败原因 + code | 同文件 `:1255-1270`（`TurnErrorItem`） | 现有「任务失败」行改成官方文案与结构；**重试历史绝不吞掉它**（`conversation-nodes/turn-error.d.ts` 注释原文） |
| 5 | **失败尝试可见**：每次无正文尝试的失败原因与结算时间 | `dsh-session` 的 `assistant/attempt` | 失败行补「第 N 次尝试」；不再只显示最后一次的 code |
| 6 | **折叠资格**：只折叠「符合条件的**已完成**轮次」，且**不隐藏最终答案** | `dsh-client-ui-chat/lib/client.js:2258`（`turnClosed && !alwaysOpen && stored.answerStep !== spec.answerStep`）、`README.zh.md:79` | `MemoryWorkbench.vue:3649` 的 `:open="isLiveTurn(turn.id) \|\| undefined"` 改为「运行中 **或本轮未成功** 时保持展开」 |
| 7 | **重试在同一个打开的轮次内** | `dsh-llm-retry/README.zh.md` | 失败不再立刻收敛为轮次终态：`phase='failed'` 只用于「重试预算耗尽后」，期间过程与用户轮次保持原位 |
| 8 | **续跑提示**：`已有输出保留在对话中。发送「继续」可让模型接着输出。` | `dsh-client-ui-chat/lib/client.js:5339`（`message.maxTokens.hint`） | 失败行下加同义提示 + 一个「继续」按钮（等价发一条「继续」，**不自动发送**），替换现在静默的 `restoreDraft()`（`MemoryWorkbench.vue:2037-2053`） |
| 9 | **失败信息单一来源** | 官方只有一个 `turn-error` 节点（message + code） | DH 路径以 Session 投影为权威，runner 回传的 RPC 错只作兜底；投影读取失败时把 `run.steps` + `run.userTurn` 留在屏上（现在整轮直接消失） |

## 3. P2：重试策略对齐官方默认（不动自研内核）

`src/services/deepSeekHarness.ts` 的 route patch：

| 项 | 现在 | 改为 | 官方依据 |
| --- | --- | --- | --- |
| `retryPolicy.maxRetries` | `1` | **`5`** | `DEFAULT_MAX_RETRIES = 5`（`dsh-llm/lib/types/retry-policy.d.ts`） |
| `retryPolicy.backoff` | 未写 | **继续不写** | 官方默认 `initialDelayMs 500` / `maxDelayMs 10000` / `jitterRatio 0.1`；实测 5 次共多等约 15 秒（`dsh-llm-retry/lib/index.js:46-48`） |
| `retryPolicy.retryableCodes` | 官方 6 类 | **不动** | 同上 |
| `streamIdleTimeoutMs` | 未写（默认 300000） | **继续不写** | 见 §4 第 3 条：实测有 5 个成功步骤首字 ≥120s |

**为什么敢从 1 提到 5（有实测支撑）：**

- 会话实测：253 个步骤里 12 次传输故障 → 每个模型请求约 **4.5%** 撞上；平均 7 步/轮 → 单轮约 27% 概率；42 步的长轮次（turn 35）**约 85%**。长任务的失败是必然事件，不是异常。
- 两类故障的代价完全不同：**502/TRANSPORT 是秒级失败**（turn 3–7 实测 2–7s），官方默认多花 ~15 秒几乎必然救回；**524 是 ~126 秒零字节**（turn 33/34/35 实测 126–133s，`usage` 全 0）。
- 决定性的正面证据：**turns 33/34 的 524 正是被那唯一一次重试救回来的**（两轮最终 `completed`）。重试本身有效，缺的只是预算。
- 代价与对冲：524 走满 5 次最坏约 10 分钟。对冲手段就是 §2 的第 1–3、8 条（可见倒计时 + 失败即停 + 不丢过程），这也是官方自己的设计——**有界重试 + 全程可见 + 随时可停**；09-23 那次「5 次盲等」的问题是缺可见性，不是次数本身。

## 4. 明确不做（避免顺手扩张）

1. **不在本 TDD 里做升级**：升级是独立任务，先于本 TDD 执行，见 [[开发/韭菜盒子Harness升级0.2.0-rc.2方案-2026-10-03]]。
2. **不加第 6 处 patch**（例如 `session/projection`）：官方 `llmRetry` 投影是 pending-only（实测投影缓存里 `llmRetry.val = {}`），历史重试链官方自己也是从事件回放（`retryDefinition` 的 `RetryState { turn, step, attempts }`），加了也换不掉现有投影。
3. **不设固定首字看门狗**：本机 245 个成功步骤的首字延迟 `p50=17s / p90=58s / p99=236s / max=260s`，其中 **5 个 ≥120s 且全部成功**；任何固定阈值都会误杀它们（也印证 09-28 撤销 `streamIdleTimeoutMs: 90000` 的决定）。
4. **不在 Harness 外套整轮定时器**；不改官方 6 类 `retryableCodes`。
5. **不碰自研内核链路**（`runtime === 'legacy'` 的 2 次 / 2s+4s 重试与 Raw 中断恢复点保持原样）。
6. **不新增任务表、断点表、后台队列或逐 token 持久化**（沿用 2026-09-24 合同）。

## 5. 验证

- **红测（先写）**：用本机真样本构造 fixture —— 12 条 `llm/retry`、12 条 `llm/retry-started`、8 条 `assistant/attempt`、5 条 `turn/end(error)`、1 条 `turn/end(aborted)`；断言重试链行、四态文案、倒计时秒数、`第 N 次尝试`、终态失败行不被吞。
- **源码契约测试**（沿用 `memoryWorkbench.test.ts` 既有风格）：失败轮次过程默认展开、`restoreDraft` 不再静默、文案逐字等于官方中文。
- **门禁**：`pnpm run test:focused`（当前基线 `1795 tests / 1786 pass / 1 fail`，唯一失败是既有的 Windows `/tmp` 用例）、`vue-tsc -b`、`oxlint`。
- **真机**：真实 524 出现时由用户确认（本轮不做故障注入，避免把它写成已通过）。

## 6. 已知风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| 524 走满 5 次约 10 分钟 | 每次尝试 126s 是上游/网关行为，重试次数放大等待 | 靠 §2 可见倒计时 + 停止按钮承担；§2 落地前**不得**单独先改次数 |
| 524 的真正闸门在服务端 | ~126s 结算不像 Cloudflare 的 100s 判决（有 260s 首字的成功反例），更像链路中某一跳的 ~120s 超时（nginx / new-api / 上游白标） | 本 TDD 治不了；需要 NewAPI + 上游日志对齐定位（另立事项） |
| 502 簇 | turn 3–7 连续 5 轮秒级 502，与超时无关 | 由 §3 的 5 次重试覆盖；若仍复现，转服务端排查 |

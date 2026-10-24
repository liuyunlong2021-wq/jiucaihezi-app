# DSH 的 pi-ai 依赖与 Strata 引擎退出错误溯源（2026-10-24）

## 状态与范围

用户要求先提交此前三创作模式改动，再专查 DSH 为什么使用 PI，以及 `PI_AI_ERROR: the engine stopped unexpectedly (exit code 1); the next request restarts it` 的来源。

前一阶段已本地提交 `28d1686c`（`fix(runtime): scope creation capabilities and preserve failed inputs`），未推送；FK/Wan 等无关既有改动保留。本轮只核对依赖、读取日志和运行临时诊断，不修改模型适配器或重试策略。

## 1. PI 位于模型通信层

已安装版本：DSH / `@deepseek-ai/dsh-llm-pi-ai` 为 `0.2.1-rc.2`，`@earendil-works/pi-ai` 为 `1.3.0`，随包 Node 为 `22.23.2`。

- DSH 自己的 `dsh-base/cordis.patch.yml` 注册官方 `@deepseek-ai/dsh-llm-pi-ai` 插件。该插件原本没有 provider 路线，应用配置后才激活。
- 本产品 `src/services/deepSeekHarness.ts` 生成 `llm-pi-ai` 配置，声明 OpenAI Completions、Responses 或 Anthropic Messages 协议以及模型容量/模态。
- 官方 `dsh-llm-pi-ai/package.json` 直接依赖 `@earendil-works/pi-ai`；适配器调用其 `streamSimple()` 并将流式事件转换回 DSH 格式。
- Session、Agent 执行循环、Skill 注册及工具执行仍由 DSH 管理。此依赖关系不意味着另起一个 Pi Coding Agent。

调用链：

```text
韭菜盒子
  → DSH：持久会话、Skill、工具、Agent 循环
  → dsh-llm-pi-ai：官方模型适配器
  → pi-ai：多供应商协议与流式请求库
  → 模型服务端：如 Strata 或云端 API
```

官方资料：[DSH 适配器说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)、[Pi 模型 API 库](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)。在线 master/main 可能比随包版本新，运行时事实以本机精确版本为准。官方还提供直连 DeepSeek 的适配器；当前产品包含其他模型与自定义端点，不能据 PI 名称直接换成仅 DeepSeek 路线。

## 2. 完整报错文案来自 Strata 服务端

在 [Strata 官方 `serve/server.py`](https://github.com/Niko1221/Strata/blob/main/serve/server.py) 找到相同文案：

- `StrataEngine` 通过 stdin/stdout 管理常驻 `strata --serve` 子进程，其 stderr 写入引擎日志。
- `_send()` 在管道断开时、`_control()` 在控制流结束时抛出 `EngineDied`，消息包含子进程退出码。
- API 的 `EngineDied` 处理追加 `the next request restarts it`。未开始流式响应时可以返回 HTTP 503；流已经开始后，则以 SSE 错误事件传回同样的消息。
- 因而这段文案中的 engine 有明确的 Strata 服务端含义。不能仅因前缀为 `PI_AI_ERROR` 就判断 DSH 或 PI 的进程崩溃。

源码检索留证 `/tmp/jc-strata-server.py`；本轮在线 main 的相关位置为 `_send` 约1473行、`_control` 约1499行、OpenAI SSE 的 `EngineDied` 处理约7096行。在线文件行号随上游提交变化。

## 3. 为什么显示 PI_AI_ERROR

随包适配器 `lib/index.js` 的 `classifyPiAiError()` 按错误文字映射 AUTH、RATE_LIMIT、SERVER、TIMEOUT、TRANSPORT 等类别，无法匹配时返回 `PI_AI_ERROR`。`mapStopReason()` 对 pi-ai 的 error 事件保留原消息并使用这个分类。

流式响应已经以 HTTP 200 开始后，Strata 的消息本身没有 `500` / `503` 等数字；该文字也不匹配当前已知网络/超时类别，于是被标为 `PI_AI_ERROR`。这个前缀是适配层兜底错误码，不是“PI 自身崩溃”的证明。

`PI_AI_ERROR` 继续沿用官方非自动重试行为，不能为了让界面不报错就把整个类别加入自动重试；真实退出原因仍需要查服务端。

## 4. 实际 SDK 复现

临时诊断 `/tmp/jc-audit-strata-error-propagation.mjs` 使用真实随包 SDK 和本地 SSE 模拟端点：

1. 第一轮响应 HTTP 200，并发送包含原始 engine 退出消息的 Strata 形状 SSE error。
2. SDK 收到的终止错误 code 为 `PI_AI_ERROR`，message 与用户所述一致，只有一次请求。
3. 同一 SDK 的下一轮返回 `RECOVERED`，报错前后 SDK 子进程 PID 相同。

1/1 通过。这验证了“上游错误经过适配层显示为 PI_AI_ERROR”的传播路径；不是对真实 Strata 崩溃的故障注入，也不能据此确定用户机器的退出根因。

## 5. 用户那次 exit code 1 仍待引擎日志

本机当前未发现运行中的 Strata 进程。读取桌面 Harness 下145份压缩 Session 日志，未检出该完整 engine 退出消息；存在其他 `PI_AI_ERROR`，不能将它们合并为同一种故障。

退出码1不足以区分模型加载/执行错误、资源问题、驱动问题或引擎自身错误。需要确认用户当时的模型端点、Strata 版本和崩溃前引擎日志末尾50–100行；若在另一台 Windows/Linux 电脑，还需要其日志位置。本轮已向用户询问，未将猜测写成根因。

此前28→9/10工具的精简减少请求负担，但没有证明能修复 Strata 子进程退出，也不能宣称更换/移除 pi-ai 会解决该错误。

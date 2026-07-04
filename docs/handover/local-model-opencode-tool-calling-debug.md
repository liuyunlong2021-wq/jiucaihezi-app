# 本地模型 OpenCode 文/武模式 — 调试交接

> **最后更新**: 2026-07-04
> **分支**: pingguo-inter
> **状态**: 已找到根因，最后修复待验证

---

## 目标

让本地 Ollama 模型（或任意 openai-compatible 端点）能驱动 OpenCode 的 **文/武模式**（plan/build），实现文件查看、代码编辑等工具调用。

## 已完成的修改

| commit | 改动 | 文件 |
|--------|------|------|
| `a07d8a7` | 多 Provider OpenCode 配置 — 按 providerId 分组模型 | providerProjection, providerConfig, agentStore |
| `03a79a9` | attachment 恒 true + config_signature 稳定 | providerProjection |
| `090bf76` | 未登录纯本地模型允文/武（不强制要求 apiKey） | providerProjection |
| `c206027` | 上下文窗口 4096→32768（后回退，改为不设 limit） | modelContextWindows |
| `e523d41` | supportsVision 不误判本地模型、output 动态、注释修正 | 5 files |
| `124cb34` | 100% 对齐 OpenCode — 不设 limit 字段 | providerProjection |
| `9e51da9` | **短路修复**: 本地模型只在直连模式走直接 API，文/武走 OpenCode | useChat.ts |

## 尝试过的方向

### 1. 工具调用失效排查链

```
模型支持 tools ✅（直接 curl Ollama 验证）
  → config 设 tool_call:true ✅
  → config_signature 稳定 ✅
  → 不设 limit（对齐 OpenCode 默认 0,0）✅
  → 模型仍然文字回复 ❌
```

每步都验证过，但模型始终不调用工具。

### 2. OpenCode 二进制 CLI 测试

尝试用 `OPENCODE_CONFIG_CONTENT` + `opencode run` 命令行测试，但 CLI 不支持或命令格式不对，未成功。

### 3. 日志排查

在 `projectNewApiForOpenCode`、`getActiveOpenCodeClient` 多处加 `console.log`，但 **日志从未出现**，说明代码根本没走到 OpenCode 配置生成。

## 根因（第 9 个 commit 修复）

**`src/composables/useChat.ts:1494`**:

```ts
// 之前（BUG）
if (isLocalModelProviderId(selectedProviderId)) {
  await sendDirectLocalModelMessage(options, runId, controller)
  return  // ← 无条件短路！不管文/武/直连，本地模型全部走直连
}

// 修复后
if (isLocalModelProviderId(selectedProviderId) && options.chatMode !== 'build' && options.chatMode !== 'plan') {
  await sendDirectLocalModelMessage(options, runId, controller)
  return  // 仅在直连（或 chatMode 未设置）时短路
}
```

**影响**：之前所有"武模式+本地模型"的测试，消息都绕过了 OpenCode，直接发到 Ollama 的 `/v1/chat/completions`。没有 tools 参数 → 模型只能纯文本回复。

## 对照 OpenCode 官方

OpenCode 官方**没有这个短路逻辑**。在 OpenCode 源码中，provider 选择完全由 config 决定：
- 用户在 `opencode.json` 中声明 provider（含 `npm`/`api`/`models`）
- 运行时通过 `providerID/modelID` 路由到对应 provider
- 无论 provider 是云端还是本地，都经过相同的 LLM pipeline（`llm.ts → openai-chat.ts → /v1/chat/completions`）
- 工具调用由 `request.tools` 参数控制，对所有 provider 一致

我们的短路逻辑是之前为"直连模式+本地模型"加的优化（跳过 OpenCode 开销），但忘记加模式判断。

## 待验证

```bash
pnpm tauri dev
```

1. 选 `gpt-oss:20b`，**武模式**，发「查看项目文件」
2. Console 应出现 `[JC-OC-PROJECT]` 日志，确认 `toolCall: true`
3. 模型应调用 `list_dir`/`read_file` 工具，而非纯文字回复

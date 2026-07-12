# 本地模型驱动 OpenCode 文/武模式 — 完整交接文档

> **日期**: 2026-07-04
> **分支**: `pingguo-inter`
> **状态**: 两处关键修复已完成，**待 `pnpm tauri dev` 实测验证**

---

## 目标

让本地 Ollama 模型（`gpt-oss:20b` 等）能驱动 OpenCode 的**文模式（plan）和武模式（build）**，实现文件查看、代码编辑、命令执行等工具调用。

云端模型（Claude/GPT 等通过 NewAPI 网关）已经能正常使用文/武模式。本地模型之前被一个代码短路拦截了。

---

## 已完成的关键修改

### 修改 1 — 本地模型短路修复（`src/composables/useChat.ts:1494`）

**问题**：本地模型的所有消息都被无条件拦截，走直连 API（`sendDirectLocalModelMessage`），完全跳过 OpenCode 文/武流程。

```typescript
// 修复前（BUG）
if (isLocalModelProviderId(selectedProviderId)) {
  await sendDirectLocalModelMessage(options, runId, controller)
  return  // ← 不管什么模式都短路！
}

// 修复后
if (isLocalModelProviderId(selectedProviderId) && options.chatMode !== 'build' && options.chatMode !== 'plan') {
  await sendDirectLocalModelMessage(options, runId, controller)
  return  // 仅在直连模式（或 chatMode 未设置时）才短路
}
```

### 修改 2 — Provider 列表动态构建（`src/opencodeClient/providerProjection.ts`）

**问题**：之前强制在 OpenCode config 中包含 `jiucaihezi` 空 provider，导致未登录时仍然校验 apiKey。

**修复后逻辑**：
```
用户状态              → OpenCode config
─────────────────────────────────────────
已登录+有Key+云端模型  → jiucaihezi(有模型) + ollama(有就加)
未登录+Ollama运行       → ollama(有模型)          纯本地
什么模型都没有          → 空 config              报错
```

关键函数 `groupModelsByProvider()` 现在只在 provider 实际有模型时才加入列表。

### 修改 3 — 配置对齐 OpenCode 官方（`src/opencodeClient/providerProjection.ts`）

`buildModelConfig()` 生成的 V1 model config 完全对齐 OpenCode：

```typescript
{
  name: "gpt-oss:20b",
  tool_call: true,        // 启用工具调用
  attachment: true,       // 启用文件上下文
  modalities: {
    input: ["text"],       // ["text", "image"] 如果支持 vision
    output: ["text"]
  }
  // 不设 limit — OpenCode 默认 {context:0, output:0}
}
```

### 修改 4 — supportsVision 不误判本地模型（`src/utils/providerConfig.ts`）

新增 `providerId` 参数，本地/custom provider 的视觉模型不再被 Gateway 端点黑名单误判：
```typescript
export function supportsVision(modelId, providerId?) {
  if (providerId === 'local-ollama' || ...) return true  // 本地模型乐观放行
  // ...
}
```

---

## OpenCode 官方对照

### OpenCode 的本地模型接入方式

OpenCode 通过 `@ai-sdk/openai-compatible` npm 包 + 可配置 `baseURL` 支持任意 OpenAI 兼容端点：

```json
// opencode.json 用户配置
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "http://localhost:11434/v1",
      "models": { "qwen2.5": { "tool_call": true } }
    }
  }
}
```

**关键源码路径**（OpenCode 仓库 `/Users/by3/Documents/jiucaihezi-opencode`）：

| 组件 | 文件 | 作用 |
|------|------|------|
| V1 config schema | `packages/core/src/v1/config/provider.ts` | `tool_call`, `attachment`, `modalities` 等字段定义 |
| V1→V2 迁移 | `packages/core/src/v1/config/migrate.ts:199-248` | `tool_call` → `capabilities.tools` |
| 协议路由 | `packages/llm/src/protocols/openai-compatible-chat.ts` | 复用 `OpenAIChat.protocol`，endpoint `/chat/completions` |
| 工具发送 | `packages/llm/src/protocols/openai-chat.ts:349` | `tools: request.tools.map(lowerTool)` — 独立 `tools` 参数 |
| Provider 插件 | `packages/core/src/config/plugin/provider.ts:66-70` | 读取 `capabilities.tools` 注入 catalog |
| 运行时模型 | `packages/core/src/session/runner/model.ts:100` | `limits: { context, output }` 传递 |
| 工具控制 | `packages/core/src/session/runner/llm.ts:183` | `toolMaterialization` + `toolChoice` 控制 |

### 我们和 OpenCode 的差异

| 方面 | OpenCode | 我们 |
|------|----------|------|
| 模型发现 | 用户手写 `opencode.json` | `agentStore.fetchModels()` 自动发现 |
| Provider 格式 | 直接写 `npm`/`api`/`models` | `projectNewApiForOpenCode()` 动态生成 |
| 工具开关 | `tool_call: true` per model | 同样 |
| 上下文窗口 | 默认不限制 | 同样（已对齐） |
| 输出限制 | 默认不设 max_tokens | 同样 |
| 本地模型路径 | 统一走 LLM pipeline | **被短路拦截了**（已修复） |

---

## 数据流全貌

```
用户选模型 → 武模式 → 发送消息
  │
  ├─ useChat.ts:1494 ── 判断是不是本地模型且非 build/plan 模式
  │   ├─ 是直连 → sendDirectLocalModelMessage (直接 curl Ollama)
  │   └─ 是文/武 → 继续 ↓
  │
  ├─ projectNewApiForOpenCode() ── 生成 OpenCode config JSON
  │   ├─ groupModelsByProvider() ── 按 providerId 分组
  │   ├─ buildModelConfig() ── 每个模型 { tool_call, attachment, modalities }
  │   └─ 返回 { enabled_providers, model, provider }
  │
  ├─ ensureOpenCodeServer({ config }) ── Rust IPC → 启动 OpenCode 进程
  │   环境变量: OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  │
  ├─ OpenCode 内核:
  │   ├─ loadInstanceState() → loadConfig() → V1 校验
  │   ├─ ConfigMigrateV1.migrate() → V1→V2 转换
  │   ├─ ConfigProviderPlugin → 注入 catalog
  │   └─ session.prompt({ model: { providerID, modelID } })
  │
  └─ LLM pipeline:
      ├─ llm.ts → tools.materialize() → request.tools
      └─ openai-chat.ts → POST /v1/chat/completions → Ollama
```

---

## Ollama 模型工具调用验证

`gpt-oss:20b` 已通过直接 API 测试验证支持 function calling：

```bash
curl http://localhost:11434/v1/chat/completions -d '{
  "model": "gpt-oss:20b",
  "messages": [{"role":"user","content":"列出当前目录的文件"}],
  "tools": [{"type":"function","function":{"name":"list_files",...}}]
}'
# 返回: finish_reason=tool_calls, tool_calls=[{function:{name:"list_files",...}}]
```

**注意**: `gpt-oss:20b` 在流式模式下使用非标准 `reasoning` 字段，不确定 OpenCode 的 SSE 解析器是否能正确处理。`qwen2.5:7b` 是更安全的选择（标准 OpenAI 格式）。

---

## 待验证

```bash
pnpm tauri dev
```

1. **未登录 + Ollama**：选 `gpt-oss:20b`，武模式，发「查看项目文件」
   - 预期：不抛 apiKey 错误，OpenCode 启动，模型调用 `list_dir`/`read_file` 工具

2. **已登录 + 云端模型**：选 Claude，武模式，正常对话
   - 预期：与之前行为一致，不退化

3. **切换模型不丢历史**：云端模型发几轮 → 切 Ollama → 历史保留

---

## 关键文件

| 文件 | 作用 | 改动 |
|------|------|:--:|
| `src/opencodeClient/providerProjection.ts` | OpenCode config 生成 | ✅ |
| `src/composables/useChat.ts:1494` | 本地模型路由 | ✅ |
| `src/utils/providerConfig.ts` | supportsVision + CustomProvider | ✅ |
| `src/stores/agentStore.ts` | 模型发现 + 自定义 provider 加载 | ✅ |
| `src/data/modelContextWindows.ts` | 上下文窗口（不再被 OpenCode config 使用） | ✅ |
| `src-tauri/src/lib.rs` | Rust IPC，透传 OPENCODE_CONFIG_CONTENT | - |
| `src-tauri/binaries/opencode-aarch64-apple-darwin` | OpenCode 二进制（6月22日） | - |

---

## 如果还不工作，排查方向

1. **确认消息真的走到了 OpenCode**：在 `useChat.ts` 的 `sendDesktopDirectCloudMessage` 调用前后加 `console.log`，确认没有其他短路
2. **看 OpenCode server 日志**：Rust 端 `opencode_ensure_server` 的 stderr 输出可能包含 config 解析错误
3. **换模型**：`gpt-oss:20b` 的 `reasoning` 字段可能干扰 OpenCode 流式解析，试 `ollama pull qwen2.5:7b`
4. **升级 OpenCode 二进制**：当前版本较旧（6月22日），可能有不兼容的 V1→V2 迁移逻辑

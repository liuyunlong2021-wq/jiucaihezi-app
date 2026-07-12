# 交接文档：直连模式读图问题

> **分支**: `xitongyouhua`（从 main 创建）
> **日期**: 2026-06-30
> **接手前必读**: `AGENTS.md` § 分支边界、`CLAUDE.md`

---

## 问题描述

直连模式下上传图片发送，模型回复"请上传图片"——图片未到达模型。

## 已完成的工作（全部已验证 `vue-tsc -b` 零错误）

### 架构重构

- ✅ 删除 `buildDirectLocalMessages` / `buildWebCloudMessages` 两个重复函数
- ✅ 新增统一 builder `src/utils/directMessageBuilder.ts`（纯函数，7 个测试全部通过）
- ✅ 三个 sender（`sendDesktopDirectCloudMessage`、`sendDirectLocalModelMessage`、`sendWebCloudMessage`）全部接线到新 builder
- ✅ `resolveWebSkillSystemPrompt` 从两处重复定义提取到 `src/utils/skillContentResolver.ts`
- ✅ assistant 消息 push 移到 builder 之后（否则 builder 看到最后一条是 assistant 不构建 multimodal）

### 图片数据流

- ✅ `ChatPanel.vue` `handleSend()`：直连模式下 FileReader → data: URL（已验证 `images[0].length = 2485454`）
- ✅ `options.images` 正确传到 `sendDesktopDirectCloudMessage`
- ✅ `buildDirectMessages` 收到 `images=1, vision=true`
- ✅ `persistCurrentSession` 的 `saveSession`→images→jc-media:// 转换通过 shallow copy 隔离，不碰内存
- ⚠️ 删除了 `await persistCurrentSession()` 在 `sendPromise` 之前的调用（防止并发转 jc-media://）

### 最后一次日志

```
[JC] direct send: images= 1 model= gpt-5.5 vision= true
[JC] builder last msg role= "user" isArray= false parts= "string"
```

`isArray=false` 说明 builder 最后一条消息是纯文本，没有进 multimodal 分支。

## 根因分析（待验证）

builder 的 multimodal 分支条件是：
```ts
if (hasImages && args.visionModel && args.apiFormat === 'openai') { ... }
```

已确认 `hasImages=true`、`visionModel=true`。**唯一可能失败：`args.apiFormat !== 'openai'`**。

验证方法：在 `sendDesktopDirectCloudMessage` 的 `buildDirectMessages({...})` 调用前加：
```ts
console.log('apiFormat=openai', 'platform=desktop')
```
确认传入的参数值。

或者直接在 `directMessageBuilder.ts` 的 `if (hasImages && ...)` 前加：
```ts
console.log('builder check:', { hasImages, vision: args.visionModel, apiFormat: args.apiFormat })
```

## 其他可能原因

1. **Tauri Rust HTTP bridge 对大 body 有限制** — data: URL 2.4MB，JSON body 约 3MB。如果 bridge 截断，image_url 的 url 会变短
2. **NewAPI 对 data: URL 有限制** — 某些 adapter 可能不处理 data: URL 的 image_url
3. **GPT-5.5 对 data: URL 格式的 image_url 支持** — 需确认

## 建议排查方向

1. 用 Chrome DevTools Network 抓包看实际发送的 JSON body（搜索 `"image_url"`）
2. 对比文武模式（OpenCode）同一张图片发送的请求 body
3. 如果 body 里确实有完整 data: URL 但模型看不到，转成远程 HTTP URL 试试（先上传到某处）

---

## 分支任务盘点

| # | 任务 | 状态 |
|:--:|------|:--:|
| 1 | 直连模式读图 | 🔴 调试中 |
| 2 | gallery-dl 工具仓库 | ✅ 已完成（11 条指令） |
| 3 | GitHubSkillCard Open in GitHub 修复 | ✅ 已完成 |
| 4 | 上下文用量 100% 对齐官方 OpenCode | ✅ 已完成（16 stats + breakdown + system prompt + raw messages） |
| 5 | Web 端不显示上下文用量 | ✅ 已完成 |
| 6 | 8091 OCR 全部清理 | ✅ 已完成（`webChatAttachments.ts` 已删除） |
| 7 | 直连消息构建器统一（`directMessageBuilder.ts`） | ✅ 已完成 |
| 8 | `resolveWebSkillSystemPrompt` 去重 | ✅ 已完成 |
| 9 | `catalog.ts` usage 百分比修复 | ✅ 已完成 |
| 10 | Ollama visual model 支持 | ✅ 已完成 |
| 11 | 非 vision 模型 + 图片提示 | ✅ 已完成 |
| 12 | `ContextUsagePanel` 重写（smart component） | ✅ 已完成 |
| 13 | `contextMetrics` / `contextBreakdown` / `contextFormat` | ✅ 已完成（7+2 tests 全过） |

## 关键文件速查

| 文件 | 用途 |
|------|------|
| `src/utils/directMessageBuilder.ts` | 直连消息构建器（纯函数，唯一入口） |
| `src/components/chat/ChatPanel.vue:840-870` | 图片 data: URL 转换 |
| `src/composables/useChat.ts:1280-1320` | `sendDesktopDirectCloudMessage` |
| `src/composables/chatCloud.ts:160-205` | `sendWebCloudMessage` |
| `src/stores/sessionStore.ts:183` | `saveSession` images→jc-media:// 转换 |
| `src/utils/webChatAttachments.ts` | ❌ 已删除 |
| `attachment-processor/` | ❌ 服务端目录，前端不再引用 |

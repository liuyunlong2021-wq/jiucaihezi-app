# TDD: 直连模式多模态优化

> **分支**: `xitongyouhua`
> **创建日期**: 2026-06-30
> **原则**: 不影响文武模式；复用现有组件；支持图片+文本文件（对标 ChatGPT 附件能力）

---

## 现状问题

```
桌面直连: buildDirectLocalMessages → 纯文本，图片被压成 "[图片附件: N 张]"  → 模型看不见图
Web 直连:  buildWebCloudMessages     → vision 模型可用 image_url，但 blob:/data: 被过滤 → 本地上传的图也看不见
```

两个函数 90% 重复，都是手写的纯文本消息构建器。文武模式走 OpenCode SDK，不受影响。

---

## 目标架构

```
handleSend()  →  图片转 data: URL（桌面 Tauri readFile / Web FileReader）
              →  文本文件直接读 content
              →  sendMessage({ images: ["data:image/png;base64,..."], files: [{name, content}] })

sendMessage() →  桌面直连 → buildDirectMessages({ messages, images, files, visionModel, platform })
              →  Web 直连  → buildDirectMessages({ messages, images, files, visionModel, platform })
              →  文武模式 → 不动

buildDirectMessages() — 唯一入口
  ├─ system prompt (共用)
  ├─ 最后 24 条历史：
  │   ├─ 最后一条 user message → 如果有 images + visionModel → multimodal content array
  │   │                          → [{type:"text", text:"..."}, {type:"image_url", image_url:{url:"data:..."}}]
  │   │                          → 如果非 visionModel 或无 images → 纯文本
  │   └─ 其他消息 → 纯文本（files 作为 "[附件: name]\ncontent" 注入）
  └─ 返回 {role, content}[]
```

---

## 不改的文件

| 文件 | 原因 |
|------|------|
| `src/opencodeClient/**` | 文武模式专属 |
| `src/runtime/direct/directEngine.ts` | 只消费 messages，不关心构建 |
| `src/composables/useChat.ts` 中 `sendMessage` 的路由逻辑 | 只改它调用的 builder |

---

## ⚠️ 审计结论（2026-06-30 并发审计）

### P0 问题

| # | 问题 | 修正 |
|---|------|------|
| 1 | `resolveWebSkillSystemPrompt` 在 useChat.ts 和 chatCloud.ts 中**重复定义**（两份一模一样的 async 函数）。Builder 要纯函数就必须先在外面 resolve | Phase 1 新增 Step 0：将 `resolveWebSkillSystemPrompt` 提取到 `src/utils/skillContentResolver.ts`，删两份重复代码 |
| 2 | `images` 类型不清：TDD 说 `data:` URL，但 `handleSend` 实际传入的是 `remoteUrl`（HTTP）+ `preview`（blob:） | Phase 2 明确：本地 blob 转 `data:` URL；远程 HTTP URL 暂不处理（Web 端已有过滤；桌面端远程 URL 模型不可达，标记为已知限制） |

### P1 问题

| # | 问题 | 修正 |
|---|------|------|
| 3 | 历史消息图片静默丢失——当前至少还有 `[图片附件: N 张]` 文本标记，新 builder 什么都不留 | 历史消息图片保留 `[之前有 N 张图片]` 文本标记 |
| 4 | Ollama **不支持** OpenAI `image_url` content parts！Ollama 用顶层 `images: ["base64..."]` 字段 | Builder 加 `apiFormat: 'openai' | 'ollama'` 参数。Ollama 模式下图片不进 messages content，由 sender 放到 body 顶层 |
| 5 | `appendSystemEvidence` 兼容性未提及 | 无影响——该函数修改 system message content，不依赖 builder 返回格式 |

### 修正后的 Phase 调整

```
Phase 0 (新增): 提取 resolveWebSkillSystemPrompt 到 skillContentResolver.ts，删重复代码
Phase 1: 新建 directMessageBuilder.ts + 7 测试（含 apiFormat 分支）
Phase 2: ChatPanel.vue 图片转 data: URL
Phase 3: 删除旧函数 + 接线
```

原 Phase 4（接线）合并到 Phase 3。共 4 个 Phase。

---

## Phase 0: 提取 `resolveWebSkillSystemPrompt`

### TDD-0.1: 删除两处重复定义，提取到 `skillContentResolver.ts`

```
现状: useChat.ts:L455-477 和 chatCloud.ts:L133-155 各有一份完全相同的 resolveWebSkillSystemPrompt

改为: src/utils/skillContentResolver.ts 新增导出 resolveWebSkillSystemPrompt
      两个文件改为 import { resolveWebSkillSystemPrompt } from '@/utils/skillContentResolver'
```

---

## Phase 1: 统一消息构建器

### TDD-1.1: 新建 `src/utils/directMessageBuilder.ts`

**输入**:
```ts
{
  messages: ChatMessage[]              // 全量历史消息
  systemPrompt?: string                // 用户设置的 system prompt
  skillSystemPrompt?: string           // 已 await resolveWebSkillSystemPrompt() 的结果
  images?: string[]                    // 当前消息的图片（data: URL 或远程 HTTP URL）
  files?: Array<{name:string, content:string}>  // 当前消息的文本文件
  visionModel: boolean                 // 当前模型是否支持视觉
  apiFormat: 'openai' | 'ollama'       // ★ 新增：Ollama 不用 image_url parts
  platform: 'desktop' | 'web'          // 用于 platform hint
}
```

**输出**:
```ts
Array<{ role: 'system'|'user'|'assistant', content: string | Array<{type:'text',text:string}|{type:'image_url',image_url:{url:string}}> }>
```

**行为**:
```
1. 构建 system prompt（合并 systemPrompt + skillSystemPrompt + platform hint）
2. 取最后 24 条 user/assistant 历史
3. 遍历：
   a. 最后一条 user message:
      - 构建文本主体（files 内容注入）
      - 如果 visionModel && images.length > 0 && apiFormat === 'openai':
        → 拼接 image_url parts（data: URL 或远程 HTTP URL）
      - 如果 visionModel && images.length > 0 && apiFormat === 'ollama':
        → 不构建 image_url parts（Ollama 不支持）
        → 返回纯文本，images 由 sender 放到 body.images 顶层
      - 如果 非 visionModel → 纯文本 + "[附带 N 张图片，当前模型不支持视觉]"
   b. 其他消息:
      - assistant → 纯文本
      - user:
        - files 注入为 "[附件: name]\ncontent"
        - images 标记为 "[之前有 N 张图片]"（保留上下文线索）
4. content 截断到 16000 字符（openai）/ Ollama 不截断
```

### TDD-1.2: 测试用例

```
test 1: vision+openai+有图片 → 最后一条 user 是 multimodal
  输入: images=["data:image/png;base64,xxx"], visionModel=true, apiFormat='openai'
  输出: 最后一条消息 = [{type:"text",...}, {type:"image_url",...}]

test 2: vision+ollama+有图片 → 全部纯文本（图片由 sender 处理）
  输入: 同上, apiFormat='ollama'
  输出: 全部纯文本，无 image_url

test 3: 非vision+有图片 → 纯文本 + 不支持提示
  输入: images=["data:..."], visionModel=false
  输出: 最后一条消息包含 "[附带 N 张图片，当前模型不支持视觉]"

test 4: vision+无图片 → 全部纯文本
  输入: images=[], visionModel=true
  输出: 全部纯文本

test 5: 文本文件注入到最后一条 user
  输入: files=[{name:"readme.md", content:"# Hello"}]
  输出: 最后一条消息 = "用户文本\n\n[附件: readme.md]\n# Hello"

test 6: 历史消息图片 → "[之前有 N 张图片]" 文本标记
  输入: messages 中有历史 user message 带 images:["data:..."]
  输出: 历史消息 content 包含 "[之前有 N 张图片]"

test 7: system prompt 合并
  输入: systemPrompt="你是助手", skillSystemPrompt="<SKILL.md>...</SKILL.md>", platform="desktop"
  输出: system消息包含三者拼接
```

---

## Phase 2: ChatPanel.vue — 图片转 data: URL

### TDD-2.1: `handleSend()` 中图片处理

```
现状:
  images.push(af.remoteUrl)     // 远程 URL 字符串
  images.push(af.preview)       // blob: URL 或 data: URL

目标:
  直连模式: 本地图片文件 → readAsDataURL → images.push("data:image/png;base64,...")
  文武模式: 不动
```

### TDD-2.2: 改动点

```ts
// handleSend() 中，收集图片时：
if (agentMode.value === 'direct') {
  // 直连模式：本地文件转 data: URL，远程 URL 保持不变
  for (const af of memberAttachedFiles) {
    if (af.file && isImageFile(af.file)) {
      const dataUrl = await fileToDataUrl(af.file)  // FileReader
      images.push(dataUrl)
    } else if (af.remoteUrl) {
      images.push(af.remoteUrl)  // 远程 URL 直接保留
    }
  }
} else {
  // 文武模式：保持现有逻辑不变
}
```

---

## Phase 3: 删除旧函数 + 接线

### TDD-3.1: 删除 `appendWebMessageAttachments`
### TDD-3.2: 删除 `buildDirectLocalMessages`
### TDD-3.3: 删除 `buildWebCloudMessages`
### TDD-3.4: 清理 `chatCloud.ts` 中 `buildWebCloudMessageContent`

### TDD-3.5: 三个 sender 接线

```
sendDesktopDirectCloudMessage:
  改为: skillPrompt = await resolveWebSkillSystemPrompt(skillName, agentStore)
        apiMessages = buildDirectMessages({ messages, systemPrompt, skillSystemPrompt: skillPrompt, images: options.images, files: options.files, visionModel, apiFormat: 'openai', platform:'desktop' })

sendDirectLocalModelMessage:
  改为: 同上，但 apiFormat: isOllama ? 'ollama' : 'openai'
        Ollama 分支: body 加 images 顶层字段（从 options.images 取 base64）

sendWebCloudMessage:
  改为: 同上，但 visionModel: supportsVision(modelId), apiFormat: 'openai', platform:'web'
        appendSystemEvidence 保持不动（在 builder 输出后修改 system message）
```

---

## 实施顺序

```
Phase 0: 提取 resolveWebSkillSystemPrompt（删重复代码）
  ↓
Phase 1: 新建 directMessageBuilder.ts + 7 个测试
  ↓
Phase 2: ChatPanel.vue 图片转 data: URL
  ↓
Phase 3: 删除旧函数 + 接线（含 Ollama body.images）
```

每 Phase 后验证：
```bash
pnpm exec vue-tsc -b
npx tsx src/utils/__tests__/directMessageBuilder.test.ts  # Phase 1
```

---

## 安全边界

- `buildDirectMessages` 是纯函数，无副作用
- 不 import Tauri API（platform 差异在 ChatPanel 和 sender 层处理）
- 文武模式路径完全不引入新代码
- `visionModel` 由调用方传入（`supportsVision(modelId)` / `isVisionModel`），builder 不猜

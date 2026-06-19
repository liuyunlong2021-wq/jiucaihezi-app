# Web 端画布核心节点升级 SDD

> 版本: v1.0  
> 日期: 2026-06-19  
> 状态: 评审通过，按 Phase 推进  
> 分支: `webhuabu`（自 `desktop`）  
> 对标: huobao-canvas (chatfire-AI) + 创作面板参数体系
>
> 原则：画布双端一致。桌面专属能力（Tauri 本地文件、ToMD、浏览器操控）在 Web 端自动降级或友好提示；纯云端节点（LLM、媒体生成）双端完全一致。

---

## 零、产品宪法（不可违反）

所有设计必须严格遵守 `CLAUDE.md` + `AGENTS.md`：

- **纯手动显式控制**：无自动编排，用户手动连线、手动点执行
- **Skill 只做上下文注入**：不自动选择、不自动修改
- **Tool 默认关闭**：通过 Toolset 节点显式开启
- **画布与对话区共享底层 Store**（agentStore / mediaTaskStore / newApiClient），但**执行路径完全独立**
- **Web/桌面双端一致**：纯云端节点共享，桌面专属节点降级不崩溃

---

## 一、核心目标

### 1.1 本次解决的问题

1. **Skill 节点是占位符** — `V8SkillNode` 用 `prompt()` 弹窗选 Skill，不可用
2. **LLM 节点缺少模型选择器** — `V8LlmNode` 需手动输入 modelId 字符串
3. **LLM 节点输入不完整** — 只接受文本，不接受图片、不接受上游 LLM 链式输出
4. **LLM 节点无输出分发** — 生成结果无法一键创建下游节点
5. **媒体生成节点是假数据** — ImageGen/VideoGen/AudioGen 用假 URL，未接真实 API
6. **媒体参数未对齐创作面板** — 比例/分辨率/时长等字段与创作面板不一致

### 1.2 最终节点清单

**本次改造 5 个节点：**

| # | type | 名称 | 角色 | 改造程度 |
|---|------|------|------|:--:|
| 1 | `skill` | Skill 选择器 | context (浅紫) | 🔧 重度：真实下拉选择器 |
| 2 | `llm` | AI 大脑 | think (紫) | 🔧 重度：模型选择器 + 多输入 + 输出分发 |
| 3 | `imageGen` | 图片生成 | generate (绿) | 🔧 中度：真实 API + 参数对齐 |
| 4 | `videoGen` | 视频生成 | generate (绿) | 🔧 中度：真实 API + 图生视频 |
| 5 | `audioGen` | 音频生成 | generate (绿) | 🔧 中度：真实 API + 参数对齐 |

**不动节点：** `text`, `toolset`, `imageResult`, `videoResult`, `audioResult`, `loop`, `textSplit`, `group`，及所有 T8 旧节点。

---

## 二、设计原则

1. **模型选择器内置** — LLM/生图/生视频/生音频节点各自内置模型下拉框，不独立成节点（理由：模型是执行参数，每个生成节点可能用不同模型）
2. **Skill 独立横切** — Skill 节点连线到多个 LLM，同一 Skill 注入多个下游（理由：Skill 是上下文提供者）
3. **LLM = 微缩版对话框** — 上游连线 = 粘贴内容，Skill 连线 = 选 Skill，内置模型选择器 = 模型菜单，点执行 = 发消息
4. **万物皆可入 LLM** — 文本（text 节点）、图片（image/upload 节点）、上游 LLM 输出（链式）、Skill（系统提示）——全部通过边连接聚合
5. **输出可分发** — LLM 生成结果一键创建下游文本/生图/生视频节点
6. **参数对齐创作面板** — 媒体生成节点的参数选项 100% 与 `mediaModelCapabilities.ts` + `CreationPanel` 一致

---

## 三、节点详细设计

### 3.1 V8SkillNode — Skill 选择器

#### 现状
- `skillName` 字段存字符串
- 点击选 Skill 时弹 `prompt()` 对话框

#### 改造后

**数据字段：**
```typescript
interface V8SkillNodeData {
  skillId: string          // agentStore 中的 skill id
  skillName: string        // 显示名
  skillContent: string     // SKILL.md 原文（解析后）
  skillSource: string      // 'preset' | 'user' | 'github' | 'superpower'
}
```

**UI 交互：**
- 点击节点 body → 弹出下拉菜单，列出所有可用 Skill
- 数据源：`agentStore.loadSkills()` + `agentStore.getPresetSkills()`
- 搜索/过滤：支持输入关键词筛选
- 选中后自动解析 `skill://` URI → 加载 SKILL.md 全文 → 存入 `skillContent`
- 空选择：支持「无 Skill」选项，清除选择

**连接语义：**
- 输出 handle：`right-context` (source) → 连接 LLM 节点的 `left-context`
- 多个 LLM 可同时连接同一个 Skill 节点（横切注入）

**依赖：**
- `@/stores/agentStore` — `loadSkills()`, `getPresetSkills()`, `resolveSkillUriContent()`
- 不涉及 Tauri / OpenCode

---

### 3.2 V8LlmNode — AI 大脑（万能聚合器）

#### 现状
- `modelId` 字段是文本输入
- 上游检测只识别 `skill` / `toolset` 类型
- 输出只有 `outputContent` 文本展示

#### 改造后

**数据字段：**
```typescript
interface V8LlmNodeData {
  // 模型配置
  modelId: string          // 模型 ID（下拉选择）
  providerId: string       // provider ID
  temperature: number      // 温度，默认 0.7
  maxTokens: number        // 最大 token，默认 4096
  
  // system prompt
  systemOverride: string   // 用户自定义 system prompt
  
  // 上游聚合（运行时计算，不持久化）
  // 来自边连接的 text/image/llm/skill/toolset 节点
  
  // 输出
  outputContent: string    // 生成结果文本
  status: 'idle' | 'running' | 'success' | 'error'
  error?: string
}
```

**模型选择器 UI：**
- 下拉菜单（替代原文本输入框）
- 数据源：`agentStore.availableModels` → 过滤 `capability === 'text'` 的模型
- 显示 `ModelEntry.label`，存储 `ModelEntry.id`
- 支持搜索/过滤
- 默认值：`agentStore.currentModel` 或 `'claude-sonnet-4-6'`

**输入聚合逻辑（`resolveUpstreamInputs()`）：**

遍历所有以本节点为 target 的边，按 source 节点类型分类：

| source 类型 | 提取内容 | 注入位置 |
|-------------|---------|---------|
| `text` | `data.content` | user message |
| `image` / `upload` | `data.url` | user message 的 `image_url` |
| `llm` | `data.outputContent` | user message（链式） |
| `skill` | `data.skillContent` | system prompt 注入 |
| `toolset` | `data.enabledTools` | tools 参数 |

**API 调用：**
- 端点：`/v1/chat/completions` (stream: true)
- 鉴权：通过 `buildGatewayHeaders()` 复用 NewAPI Token
- 流式解析：复用 `readSSEStream()` 或自行解析 SSE
- 停止支持：AbortController

**输出分发（右键菜单 / 输出区按钮）：**

| 操作 | 效果 |
|------|------|
| 「生图」 | 创建 ImageGenNode + edge (LLM → ImageGen) |
| 「生视频」 | 创建 VideoGenNode + edge (LLM → VideoGen) |
| 「建文本」 | 创建 TextNode + edge，内容预填 outputContent |
| 「拆分文本」 | 按段落拆分 outputContent → 批量创建多个 TextNode |
| 「拆分图文」 | 按段落拆分 → 批量创建 TextNode + ImageGenNode 对 |

**连接语义：**
- 输入 handle：
  - `left-prompt` (target) — 主 prompt 文本
  - `left-context` (target) — Skill / Toolset 系统上下文
- 输出 handle：
  - `right-text` (source) — 生成文本输出

**依赖：**
- `@/stores/agentStore` — 模型列表
- `@/services/newApiClient` — API 调用
- `@/utils/httpClient` — SSE 流
- 不涉及 Tauri / OpenCode

---

### 3.3 V8ImageGenNode — 图片生成

#### 现状
- 假 URL 占位（SHA 缓存 + `setTimeout` 模拟）
- 参数：`ratio`（16:9/1:1/9:16）、`quality`（high/medium）

#### 改造后

**数据字段：**
```typescript
interface V8ImageGenNodeData {
  model: string            // 模型 ID（下拉选择）
  prompt: string           // 生成提示词
  aspectRatio: string      // 比例，默认 '1:1'
  size: string             // 尺寸，默认 'auto'
  quality?: string         // 质量（模型支持时）
  url: string              // 生成结果 URL
  status: 'idle' | 'submitting' | 'polling' | 'success' | 'error'
  error?: string
}
```

**模型选择器：**
- 数据源：`agentStore.availableModels` → 过滤 `capability === 'image'`
- 补充：`mediaModelCapabilities.ts` 中 Gateway Image + RunningHub Image 模型
- 默认值：`'gpt-image-2'`

**参数面板（对齐创作面板）：**

| 参数 | 选项来源 | 控件 |
|------|---------|------|
| 比例 (aspectRatio) | 模型 `fields` 或 `ar` 数组 | 下拉 / 按钮组 |
| 尺寸 (size) | 模型 `fields` 或 `sizes` 数组 | 下拉 |
| 质量 (quality) | 模型 `fields`（如有） | 下拉 |
| prompt | 上游 text 节点 + 手动输入 | textarea |

**API 调用：**
- Gateway Image：`/v1/images/generations`
- RunningHub Image：走 rh-adapter → `/api/creations/tasks` 提交 + 轮询
- 参数透传：模型参数 → `MediaModelCapability.fields` → API body
- 复用 `media-generation.ts` 的 `submitImageGeneration()` 或直接 fetch

**状态机（保持现有）：**
```
idle → submitting → polling → success
                   ↘ error
```

**输入连接：**
- `left-ref` (target) — 上游 text 节点 prompt + 上游 image 节点参考图

**输出连接：**
- `right-result` (source) → ImageResultNode

**依赖：**
- `@/api/media-generation.ts` — API 调用
- `@/data/mediaModelCapabilities.ts` — 模型参数
- 不涉及 Tauri

---

### 3.4 V8VideoGenNode — 视频生成

#### 现状
- 假 URL 占位
- 参数：`ratio`、`resolution`、`duration`

#### 改造后

**数据字段：**
```typescript
interface V8VideoGenNodeData {
  model: string            // 模型 ID
  prompt: string           // 生成提示词
  ratio: string            // 比例，默认 '16:9'
  resolution: string       // 分辨率，默认 '720p'
  duration: number         // 时长（秒），默认 6
  firstFrameUrl?: string   // 首帧图片 URL（图生视频）
  lastFrameUrl?: string    // 尾帧图片 URL（图生视频）
  url: string              // 生成结果 URL
  status: 'idle' | 'submitting' | 'polling' | 'success' | 'error'
}
```

**图生视频支持（🆕 huobao 同款）：**
- 上游连接 image 节点 → 自动识别为 `firstFrameUrl`
- 两个 image 节点可分别连首帧/尾帧
- 边类型：`imageRole` → `{ imageRole: 'first_frame_image' | 'last_frame_image' }`

**模型选择器：**
- 数据源：`agentStore.availableModels` → `capability === 'video'`
- 补充：Gateway Video + RunningHub Video 模型
- 默认值：`'grok-video-3'`

**参数面板（对齐创作面板）：**

| 参数 | 选项 |
|------|------|
| 比例 | 16:9, 9:16, 1:1, 2:3, 3:2（按模型能力） |
| 分辨率 | 480p, 720p, 1080p（按模型能力） |
| 时长 | 4-30 秒（按模型能力，slider） |

**API 调用：**
- Gateway Video：`/v1/videos` → 轮询 `/v1/videos/:id`
- RunningHub Video：走 rh-adapter
- 复用 `media-generation.ts`

**输入连接：**
- `left-ref` (target) — text prompt + image 首帧/尾帧

**输出连接：**
- `right-result` (source) → VideoResultNode

---

### 3.5 V8AudioGenNode — 音频生成

#### 现状
- 假 URL 占位
- 参数：`style`（suno/custom）、`length`、`prompt`

#### 改造后

**数据字段：**
```typescript
interface V8AudioGenNodeData {
  model: string            // 模型 ID
  prompt: string           // 生成提示词（歌词/描述）
  title: string            // 歌曲标题
  tags?: string            // 风格标签
  mv?: string              // MV 模型（suno 专用）
  makeInstrumental?: boolean // 纯音乐模式
  url: string              // 生成结果 URL
  status: 'idle' | 'submitting' | 'polling' | 'success' | 'error'
}
```

**模型选择器：**
- 数据源：Gateway Suno + RunningHub Audio 模型
- 默认值：`'suno-custom-song'`

**参数面板（对齐创作面板）：**

| 参数 | 说明 |
|------|------|
| 模型 | Suno 自定义 / Suno v5.5 一句话 / RH Suno 等 |
| 标题 | 歌曲名 |
| 风格标签 | 逗号分隔（pop, rock, jazz...） |
| MV 模式 | chirp-fenix 等 |
| 纯音乐 | 开关 |

**API 调用：**
- Suno：`/suno/submit/music` → `/suno/fetch/:id`
- RH Audio：走 rh-adapter

**输入连接：**
- `left-ref` (target) — text prompt

**输出连接：**
- `right-result` (source) → AudioResultNode

---

## 四、LLM 节点输入/输出完整矩阵

### 输入端：它吃什么

```
                    ┌─── TextNode ───────→ left-prompt   (prompt 文本)
                    │
                    ├─── TextNode ───────→ left-context  (附加上下文)
                    │
                    ├─── ImageNode ──────→ left-context  (vision 图片)
V8LlmNode ←────────┤
  (model selector)  ├─── LLMNode ────────→ left-context  (链式输出)
                    │
                    ├─── SkillNode ──────→ left-context  (SKILL.md 注入 system)
                    │
                    ├─── ToolsetNode ────→ left-context  (工具开关)
                    │
                    └─── systemOverride  (节点内手动 system prompt)
```

### 输出端：它吐什么

```
                    ┌─── outputContent (文本结果)
                    │
                    ├─── 右键「生图」──→ ImageGenNode + edge
V8LlmNode ──────────┤
                    ├─── 右键「生视频」─→ VideoGenNode + edge
                    │
                    ├─── 右键「建文本」─→ TextNode + edge
                    │
                    ├─── 「拆分文本」───→ N × TextNode
                    │
                    └─── 「拆分图文」───→ N × (TextNode + ImageGenNode)
```

---

## 五、实施 Phase

### Phase 1: V8SkillNode 真实化
- 文件：`src/components/canvas/v8/nodes/V8SkillNode.vue`
- 改动：替换 `prompt()` → 下拉选择器，接入 `agentStore`
- 验证：点击节点能列出 Skill 列表，选中后 `skillContent` 正确填充

### Phase 2: V8LlmNode 万能聚合器
- 文件：`src/components/canvas/v8/nodes/V8LlmNode.vue`
- 改动：模型下拉选择器 + 多输入聚合（text/image/llm/skill/toolset）+ 输出分发菜单
- 验证：连线 text+skill → LLM 执行能调通 NewAPI，输出正确；右键能创建下游节点

### Phase 3: 媒体生成节点真实化
- 文件：`V8ImageGenNode.vue`, `V8VideoGenNode.vue`, `V8AudioGenNode.vue`
- 改动：假 URL → 真实 API，参数选项对齐 `mediaModelCapabilities.ts`，图生视频支持
- 验证：选模型 → 填参数 → 执行 → 轮询 → 成功输出到 Result 节点

### Phase 4: 输出分发 + 拆分
- 文件：`V8LlmNode.vue`
- 改动：右键菜单 + 输出区「拆分文本」「拆分图文」按钮
- 验证：LLM 输出后 → 拆分文本 → 画布出现 N 个 TextNode

### Phase 5: 类型/工厂/注册收尾
- 文件：`types/canvas.ts`, `canvasNodeFactory.ts`, `CanvasWorkspace.vue`
- 改动：确认字段类型、补默认数据、确认节点注册

---

## 六、不改的

| 项目 | 理由 |
|------|------|
| `src/composables/useChat.ts` | 画布走独立执行路径 |
| `src-tauri/**` | 纯云端节点 |
| `V8ToolsetNode` | 已可用 |
| `V8TextNode` | 已可用 |
| T8 旧节点 (upload/output/resize 等) | 不动 |
| @ 提及 system prompt (huobao 特色) | Phase 5+ 再做（依赖 contenteditable 富文本） |
| 自动工作流编排 (huobao useWorkflowOrchestrator) | 违反「纯手动显式」宪法，不做 |

---

## 七、验证标准

| 验证项 | 标准 |
|--------|------|
| TypeScript | `npx vue-tsc -b` 0 错 |
| 构建 | `npx vite build` 通过 |
| Skill 节点 | 下拉列出所有 Skill，选中后 `skillContent` 含 SKILL.md 全文 |
| LLM 模型选择 | 下拉列出所有 text 模型，切换后 modelId 更新 |
| LLM 多输入 | text + skill 连线后执行，NewAPI 收到完整 system + user message |
| LLM 图片输入 | image 节点连线后，LLM 请求含 `image_url` |
| LLM 链式 | LLM-A → LLM-B 连线后，B 的输入含 A 的 outputContent |
| LLM 输出分发 | 右键「生图」创建 ImageGenNode 并正确连线 |
| LLM 拆分 | 「拆分文本」按段落创建 N 个 TextNode |
| ImageGen 真实 API | 选模型 + 填 prompt → 执行 → 图片出现在 ImageResultNode |
| VideoGen 真实 API | 同上，视频出现在 VideoResultNode |
| VideoGen 图生视频 | image → VideoGen 连线，首帧正确传递 |
| AudioGen 真实 API | 同上，音频出现在 AudioResultNode |
| 参数对齐 | 比例/分辨率/时长等选项与创作面板 100% 一致 |
| Web 环境 | `pnpm dev` 浏览器，所有节点不崩溃 |

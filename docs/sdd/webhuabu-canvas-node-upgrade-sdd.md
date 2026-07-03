# Web 端画布核心节点升级 SDD

> 版本: v2.0（吸收 Claude 评审意见）  
> 日期: 2026-06-19  
> 状态: 评审修订完成，按 Phase 推进  
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
- **Web 端强制登录**：云端 API 调用前必须检查 session 状态，未登录给出友好提示

---

## 一、核心目标

### 1.1 本次解决的 6 个问题

| # | 问题 | 现状（修正后） | 目标 |
|---|------|--------------|------|
| 1 | Skill 节点是占位符 | `V8SkillNode` 用 `prompt()` 弹窗；`agentStore.resolveSkillUriContent()` 接口体未实装 | 真实下拉选择器，选完即解析 SKILL.md |
| 2 | LLM 模型选择是文本输入 | `V8LlmNode` 已有 5 Tab（含 temperature/maxTokens），但 modelId 需手输 | 升级为下拉选择器，把 Advanced Tab 参数前置到面板 |
| 3 | LLM 上游输入不完整 | 已有 3 路聚合但用启发式节点类型识别，**不看 edge handle ID**；不接受图片 | 用 edge 的 sourceHandle 精确分流；新增 image 输入 |
| 4 | LLM 无输出分发 | 只有 `outputContent` 文本展示 | 右键创建下游节点 + 拆分批量节点 |
| 5 | 媒体生成是假数据 | `setTimeout` + SHA 缓存，✅ 描述准确 | 接真实 NewAPI / rh-adapter |
| 6 | 媒体参数未对齐创作面板 | V8 硬编码字符串数组 | 运行时从 `MediaModelCapability.fields[]` 动态生成 |

### 1.2 最终节点清单

| # | type | 名称 | 角色 | 改造程度 |
|---|------|------|------|:--:|
| 1 | `skill` | Skill 选择器 | context (浅紫) | 🔧 重度 |
| 2 | `llm` | AI 大脑 | think (紫) | 🔧 重度 |
| 3 | `imageGen` | 图片生成 | generate (绿) | 🔧 中度 |
| 4 | `videoGen` | 视频生成 | generate (绿) | 🔧 中度 |
| 5 | `audioGen` | 音频生成 | generate (绿) | 🔧 中度 |

**不动节点：** `text`, `toolset`, `imageResult`, `videoResult`, `audioResult`, `loop`, `textSplit`, `group`，及所有 T8 旧节点。

**结果节点对齐目标：** 沿用 `desktop-canvas-firebao-parity-plan.md` 阶段 3 的「继续生成 / 替换 URL」设计，webhuabu 阶段不动 Result 节点本身。

---

## 二、设计原则

1. **模型选择器内置** — LLM/生图/生视频/生音频节点各自内置模型下拉框，不独立成节点
2. **Skill 独立横切** — Skill 节点连线到多个 LLM，同一 Skill 注入多个下游
3. **LLM = 微缩版对话框** — 上游连线 = 粘贴内容，Skill 连线 = 选 Skill，内置模型选择器 = 模型菜单
4. **万物皆可入 LLM** — 文本/图片/上游LLM输出/Skill/工具 全部通过边连接聚合
5. **edge sourceHandle 精确分流** — 不再靠节点 type 猜语义，用 handle ID（`left-prompt` vs `left-context`）区分主prompt和附加上下文
6. **输出可分发** — LLM 生成结果一键创建下游节点；批量操作用 `canvasStore.startBatch()/endBatch()` 包裹
7. **参数从 capability 表动态生成** — 禁止硬编码字符串数组，运行时读 `MediaModelCapability.fields[]`
8. **媒体走 mediaTaskStore 统一轨道** — 画布媒体节点不直接打 API，走 `mediaTaskStore.submitTask()`，天然获得限流/失败回写/画廊集成/24h失效提醒

---

## 三、节点详细设计

### 3.1 V8SkillNode — Skill 选择器

#### 现状
- `skillName` 字段存字符串
- 点击选 Skill 时弹 `prompt()` 对话框
- **`agentStore.resolveSkillUriContent()` 接口体未实装**，需先补 store 层

#### 改造后

**数据字段：**
```typescript
interface V8SkillNodeData {
  skillId: string          // agentStore 中的 skill id
  skillName: string        // 显示名
  skillContent: string     // SKILL.md 原文（解析后）
  skillSource: string      // 'preset' | 'user' | 'github' | 'superpower'
  applicability?: string[] // 适用场景标签（从 SKILL.md frontmatter 提取）
}
```

**store 层前置依赖（Phase 0，先补 agentStore）：**
- 实装 `resolveSkillUriContent(skillId: string): Promise<string>` — 加载 `skill://` URI 指向的 SKILL.md 文件内容
- 在 `loadSkills()` 返回的 Skill 对象上暴露 `skillContent: string`（已解析全文）
- 实装 `extractApplicability(skillContent: string): string[]` — 从 SKILL.md frontmatter 提取 `applicability` 字段

**UI 交互：**
- 点击节点 body → 弹出下拉菜单，列出所有可用 Skill
- 数据源：`agentStore.loadSkills()` + `agentStore.getPresetSkills()`
- 搜索/过滤：支持输入关键词筛选
- 选中后自动调用 `resolveSkillUriContent()` → 加载 SKILL.md 全文 → 存入 `skillContent`
- 同时调用 `extractApplicability()` 存入 `applicability`
- 空选择：支持「无 Skill」选项，清除选择

**Skill applicability 过滤：**
- LLM 节点聚合时，从 `skillContent` 中解析 `applicability` 字段
- 按当前任务类型（文本生成/图片生成/视频生成/代码）筛选哪些 Skill 真正注入 system prompt
- 不匹配的 Skill 跳过（不污染上下文）

**连接语义：**
- 输出 handle：`right-context` (source) → 连接 LLM 节点的 `left-context`
- 多个 LLM 可同时连接同一个 Skill 节点（横切注入）

---

### 3.2 V8LlmNode — AI 大脑（万能聚合器）

#### 现状（修正）
- `modelId` 字段是文本输入（已有 5 Tab progressive disclosure，含 temperature/maxTokens/systemOverride）
- 上游检测：已有 3 路聚合（text/skill/toolset），但用**启发式节点类型识别，不看 edge handle ID**
- 输出：`outputContent` 文本展示 + 流式输出状态机

#### 改造后

**数据字段：**
```typescript
interface V8LlmNodeData {
  // 模型配置
  modelId: string          // 模型 ID（下拉选择，替代文本输入）
  providerId: string       // provider ID
  temperature: number      // 温度，默认 0.7
  maxTokens: number        // 最大 token，默认 4096
  
  // system prompt
  systemOverride: string   // 用户自定义 system prompt（已有）
  
  // 输出
  outputContent: string    // 生成结果文本（已有）
  status: 'idle' | 'running' | 'success' | 'error'
  error?: string
}
```

**模型选择器 UI：**
- 下拉菜单（替代原 `<input>` 文本输入框）
- 把 Advanced Tab 的模型选择提升到面板顶部
- 数据源：`agentStore.availableModels` → 过滤 `capability === 'text'` 的模型
- 显示 `ModelEntry.label`，存储 `ModelEntry.id`
- 支持搜索/过滤
- 默认值：`agentStore.currentModel` 或 `agentStore.textModels[0]?.id`（运行时取首项，不硬编码 `'claude-sonnet-4-6'`）

**输入聚合逻辑（`resolveUpstreamInputs()`）：**

**核心变更：用 edge 的 sourceHandle ID 精确分流，不再靠节点 type 猜语义。**

遍历所有 `target === props.id` 的边，按 `edge.sourceHandle` 分类：

| edge.sourceHandle | source 节点类型 | 提取内容 | 注入位置 |
|-------------------|----------------|---------|---------|
| `right-text` | `text` | `data.content` | user message（主 prompt） |
| `right-text` | `llm` | `data.outputContent` | user message（链式） |
| `right-image` | `image` / `upload` | `data.url` | user message 的 `image_url`（vision） |
| `right-context` | `skill` | `data.skillContent` | system prompt（经 applicability 过滤） |
| `right-context` | `toolset` | `data.enabledTools` | tools 参数 |
| `right-context` | `text` | `data.content` | user message（附加上下文，拼接在 prompt 后） |

**消歧规则**：text 节点同时有 `right-text` 和 `right-context` handle，连线到哪个就按哪个语义处理。未指定 handle 时，按连接顺序：第一条连 `left-prompt`（主prompt），后续连 `left-context`（附加上下文）。

**API 调用：**
- 端点：`/v1/chat/completions` (stream: true)
- 鉴权：**不写死 `buildGatewayHeaders()`**。桌面端走 `src/utils/api.ts` 双路线鉴权（手动 Key / Session 路由），Web 端走直连。通过 `resolveApiConfig()` 统一获取 key。
- 流式解析：复用节点已有的 SSE 流式状态机
- 停止支持：AbortController（已有）
- **Web 未登录态**：执行前调用 `isCloudLoggedIn()` 检查 session，未登录 → `window.$message?.warning('请先在设置页登录')`

**输出分发（右键菜单 / 输出区按钮）：**

| 操作 | 效果 |
|------|------|
| 「生图」 | 创建 ImageGenNode + edge (LLM → ImageGen) |
| 「生视频」 | 创建 VideoGenNode + edge (LLM → VideoGen) |
| 「建文本」 | 创建 TextNode + edge，内容预填 outputContent |
| 「拆分文本」 | 按段落拆分 → 批量创建 N × TextNode |
| 「拆分图文」 | 按段落拆分 → 批量创建 N × (TextNode + ImageGenNode) 对 |

**批量操作原子性（关键）：**
> 拆分/批量创建必须用 `canvasStore.startBatch()` / `endBatch()` 包裹。
> 单次「拆分图文」输出 10 段 = 20 个节点 + 20 条边，只占 **1 条 undo 记录**。
> 见 `docs/sdd/canvas-optimization-sdd.md` 已有实装，直接引用。

**连接语义：**
- 输入 handle：
  - `left-prompt` (target) — 主 prompt 文本
  - `left-context` (target) — Skill / Toolset / 附加上下文
- 输出 handle：
  - `right-text` (source) — 生成文本输出

---

### 3.3 V8ImageGenNode — 图片生成

#### 现状
- 假 URL 占位（SHA 缓存 + `setTimeout` 模拟），✅ 描述准确

#### 改造后

**数据字段：**
```typescript
interface V8ImageGenNodeData {
  model: string            // 模型 ID（下拉，运行时从 capability 表取首项）
  prompt: string           // 生成提示词
  aspectRatio: string      // 比例
  size: string             // 尺寸
  quality?: string         // 质量（模型支持时）
  url: string              // 生成结果 URL
  assetId?: string         // 本地化后的 media_asset ID
  status: 'idle' | 'submitting' | 'polling' | 'success' | 'error'
  error?: string
}
```

**模型选择器：**
- 数据源：`agentStore.imageModels` + `mediaModelCapabilities.ts` Image 模型
- 默认值：`agentStore.imageModels[0]?.id`（运行时取 capability 表第一个，不硬编码 `'gpt-image-2'`）

**参数面板 — 运行时动态生成（关键）：**

> **禁止硬编码字符串数组。** 参数 UI 必须运行时从 `MediaModelCapability.fields[]` 动态渲染。
> 复用 `src/composables/useCreation.ts` 的 `buildCurrentCreationParams()` 或抽取为共享函数 `resolveModelFieldOptions(modelId)`。

| 参数 | 来源 | 控件 |
|------|------|------|
| 比例 | `fields.find(f => f.key === 'aspect_ratio')?.options` | 按钮组 / 下拉 |
| 尺寸 | `fields.find(f => f.key === 'size')?.options` | 下拉 |
| 质量 | `fields.find(f => f.key === 'quality')?.options` | 下拉 |
| prompt | 上游 text 节点聚合 + 手动输入 | textarea |

**API 调用 — 走 mediaTaskStore 统一轨道（关键）：**

> **画布媒体节点不直接调 API**。必须走 `mediaTaskStore.submitTask()`：
> - 画廊（MediaLibrary）自动可见
> - 全局并发限流（默认 3 并发）自动生效，防止 100 节点同层 100 并发请求
> - 失败回写、重试、24h 失效提醒、复制 URL **全部免费获得**
> - 创作面板已有 24h 提醒 banner，画布产物自动复用

调用链：
```
V8ImageGenNode 点执行
  → mediaTaskStore.submitTask({ kind: 'image', model, params })
    → mediaTaskStore 内部管理提交/轮询/成功/失败
      → 成功：回写 node.data.url + node.data.assetId
      → 失败：回写 node.data.error
```

**COS URL 本地化落地：**
- 生成成功后调用 `downloadAndPersistMediaAsset()` 落地到 `output/canvas/YYYY-MM/`
- Web 端：`isTauriRuntime() === false` 时标记 `assetStatus: 'remote-only'`，使用 `sourceUrl` 渲染
- 24h 失效提醒：复用创作面板顶部 banner 机制，不重复造轮子
- 见 `docs/sdd/canvas-media-foundation-fix-sdd.md` 已设计落地路径

**状态机：**
```
idle → submitting → polling → success
                   ↘ error
```

**输入连接：**
- `left-ref` (target) — 上游 text prompt + 上游 image 参考图

**输出连接：**
- `right-result` (source) → ImageResultNode

---

### 3.4 V8VideoGenNode — 视频生成

#### 改造后

**数据字段：**
```typescript
interface V8VideoGenNodeData {
  model: string            // 模型 ID，默认 capability 表首项
  prompt: string           // 生成提示词
  ratio: string            // 比例
  resolution: string       // 分辨率
  duration: number         // 时长（秒）
  firstFrameUrl?: string   // 首帧图片 URL
  lastFrameUrl?: string    // 尾帧图片 URL
  url: string              // 生成结果 URL
  assetId?: string
  status: 'idle' | 'submitting' | 'polling' | 'success' | 'error'
}
```

**边语义角色 — ImageRoleEdge（关键）：**

> SDD v1 说"上游 image 节点自动识别为 firstFrame"，但**两张图都连过来时无法区分谁首谁尾**。
> 必须补边携带 `imageRole` 字段 + 连线中点 UI。

- 当 image 节点连到 VideoGen 时，创建 `ImageRoleEdge` 类型边
- 边 data 携带 `{ imageRole: 'first_frame_image' | 'last_frame_image' }`
- **连线中点放 `<select>`** 让用户切换首帧/尾帧角色（huobao 同款）
- 见 `docs/sdd/canvas-optimization-sdd.md` 已有该设计，交叉引用

**模型选择器：**
- 数据源：`agentStore.videoModels` + `mediaModelCapabilities.ts` Video 模型
- 默认值：运行时取 capability 表第一个，不硬编码 `'grok-video-3'`

**参数面板** — 运行时从 `fields[]` 动态生成（同 ImageGen 规则）

**API 调用** — 走 `mediaTaskStore.submitTask()`（同 ImageGen 规则）

**输入连接：**
- `left-ref` (target) — text prompt + image 首帧/尾帧（带 imageRole）

**输出连接：**
- `right-result` (source) → VideoResultNode

---

### 3.5 V8AudioGenNode — 音频生成

#### 改造后

**模型选择器：**
- 数据源：Gateway Suno + RunningHub Audio 模型
- 默认值：运行时取 capability 表第一个，不硬编码

**参数面板** — 运行时从 `fields[]` 动态生成

**API 调用** — 走 `mediaTaskStore.submitTask()`

其余设计与 §3.3/3.4 一致。

---

## 四、LLM 节点输入/输出完整矩阵

### 输入端

```
                    ┌─── TextNode (right-text) ──→ left-prompt   (主 prompt)
                    │
                    ├─── TextNode (right-context) → left-context (附加上下文)
                    │
                    ├─── ImageNode (right-image) ─→ left-context (vision 图片)
V8LlmNode ←────────┤
  (model selector)  ├─── LLMNode (right-text) ───→ left-context (链式输出)
                    │
                    ├─── SkillNode (right-context)→ left-context (SKILL.md → system)
                    │
                    ├─── ToolsetNode (right-context)→ left-context (工具开关)
                    │
                    └─── systemOverride (节点内手动)
```

**handle 分流规则：`left-prompt` = 主消息体，`left-context` = 附加上下文/system注入。**

### 输出端

```
                    ┌─── outputContent (文本结果)
                    │
                    ├─── 右键「生图」──→ ImageGenNode + edge
V8LlmNode ──────────┤
                    ├─── 右键「生视频」─→ VideoGenNode + edge
                    │
                    ├─── 右键「建文本」─→ TextNode + edge
                    │
                    ├─── 「拆分文本」───→ N × TextNode (startBatch)
                    │
                    └─── 「拆分图文」───→ N × (TextNode + ImageGenNode) (startBatch)
```

---

## 五、实施 Phase（调序后）

> Phase 1a (Skill) 和 Phase 1b (媒体) 可并行（store 依赖不重叠）；
> Phase 2 (LLM) 必须最后做（它聚合所有上游，依赖前两个阶段稳定）。

| Phase | 内容 | 依赖 | 可并行 |
|:--:|------|------|:--:|
| **0** | **前置：store 层补全** — `agentStore.resolveSkillUriContent()` + `extractApplicability()` | 无 | — |
| **1a** | V8SkillNode 真实下拉选择器 | Phase 0 | ║ |
| **1b** | 媒体节点真实化（3 个） — 假 URL → mediaTaskStore.submitTask() | 无 | ║ |
| **2** | V8LlmNode 万能聚合器 — 模型下拉 + handle 分流 + 多输入 + 输出分发 | Phase 1a, 1b | 串行 |
| **3** | 输出分发 + 拆分 + startBatch/endBatch | Phase 2 | 串行 |
| **4** | 参数动态生成 + 双端降级 + 边角色 UI + 验证 | Phase 1b, 2 | 串行 |
| **5** | 类型/工厂/注册收尾 | Phase 4 | 串行 |

---

## 六、不改的

| 项目 | 理由 |
|------|------|
| `src/composables/useChat.ts` | 画布走独立执行路径 |
| `src-tauri/**` | 纯云端节点 |
| `V8ToolsetNode` | 已可用 |
| `V8TextNode` | 已可用 |
| T8 旧节点 (upload/output/resize 等) | 不动 |
| @ 提及 system prompt (huobao 的 contenteditable chip) | Phase 6+ 再做 |
| 自动工作流编排 (huobao useWorkflowOrchestrator) | 违反「纯手动显式」宪法 |
| 底部自然语言入口 (desktop-canvas-firebao-parity 阶段 5) | Web 端先不做 |
| 结果节点「继续生成 / 替换 URL」 | 沿用 `desktop-canvas-firebao-parity-plan.md` 阶段 3，webhuabu 不动 |

---

## 七、验证标准

| # | 验证项 | 标准 |
|---|--------|------|
| 1 | TypeScript | `npx vue-tsc -b` 0 错 |
| 2 | 构建 | `npx vite build` 通过 |
| 3 | Skill 节点 | 下拉列出所有 Skill，选中后 `skillContent` 含 SKILL.md 全文 |
| 4 | LLM 模型选择 | 下拉列出所有 text 模型（运行时取），切换后 modelId 更新 |
| 5 | LLM 多输入 handle 分流 | text(right-text)→left-prompt 做主prompt，text(right-context)→left-context 做附加上下文 |
| 6 | LLM 图片输入 | image 节点连线后，LLM 请求含 `image_url` |
| 7 | LLM 链式 | LLM-A → LLM-B 连线后，B 的输入含 A 的 outputContent |
| 8 | Skill applicability 过滤 | 不匹配当前任务的 Skill 不注入 system prompt |
| 9 | LLM 输出分发 | 右键「生图」创建 ImageGenNode 并正确连线 |
| 10 | LLM 批量拆分原子性 | 「拆分图文」10 段 = 20 节点只占 1 条 undo |
| 11 | ImageGen 真实 API | 选模型 → 执行 → 图片出现在 ImageResultNode + 画廊 |
| 12 | VideoGen 真实 API | 同上，视频 + 画廊 |
| 13 | VideoGen 图生视频 | image→VideoGen，边带 imageRole，首帧正确传递 |
| 14 | AudioGen 真实 API | 同上，音频 + 画廊 |
| 15 | 参数动态生成 | 比例/分辨率/时长从 `MediaModelCapability.fields[]` 动态渲染 |
| 16 | 媒体并发限流 | 100 节点同层执行不超 mediaTaskStore 3 并发 |
| 17 | Web 未登录态 | 执行 LLM/媒体节点前检查 session，未登录 → 友好提示 |
| 18 | 媒体结果入画廊 | 画布生成的图片/视频/音频出现在 MediaLibrary |
| 19 | 24h 失效提醒 | 画布媒体结果复用创作面板 banner 机制 |
| 20 | Web 环境 | `pnpm dev` 浏览器，所有节点不崩溃 |

---

## 八、双端降级矩阵

| 节点 | 能力 | Web 端 | 桌面端 |
|------|------|--------|--------|
| `skill` | Skill 列表 | agentStore（localStorage） | agentStore + Tauri 文件系统 |
| `skill` | skill:// URI 解析 | fetch 或内联 | Tauri FS 读取 |
| `llm` | API 鉴权 | `resolveApiConfig()` 手动 Key / Session 双路线 | 同 Web |
| `llm` | 未登录态 | `isCloudLoggedIn()` 检查 → toast 提示 | Tauri 自动处理 |
| `imageGen` | 本地文件作为参考图 | 仅 URL / 上传的图 | Tauri convertFileSrc |
| `imageGen` | COS URL 落地 | `remote-only` → `sourceUrl` 渲染 | `downloadAndPersistMediaAsset` 落地 `output/canvas/` |
| `videoGen` | 首帧/尾帧本地图 | 仅 URL | Tauri 路径 |
| 所有媒体 | 画廊可见性 | mediaTaskStore 统一轨道，双端一致 | 同 Web |
| 所有媒体 | 并发限流 | mediaTaskStore 3 并发，双端一致 | 同 Web |

---

## 九、与现有 SDD 的交叉引用

| 引用 SDD | 引用内容 | 用途 |
|----------|---------|------|
| `canvas-optimization-sdd.md` | ImageRoleEdge 边角色 + startBatch/endBatch | §3.4 图生视频 + §3.2 批量原子性 |
| `canvas-media-foundation-fix-sdd.md` | output/canvas/ 落地路径 + COS URL 本地化 | §3.3/3.4 媒体结果持久化 |
| `desktop-canvas-firebao-parity-plan.md` | 阶段 3 结果节点操作 + 阶段 5 底部入口 | §1.2 结果对齐 + §6 不改的 |
| `unified-file-access-design-v2.md` | jc-media:// 渲染契约 + media_assets 表 | §3.3 assetId 字段 |
| `storage-media-asset-migration.md` | mediaTaskStore 任务队列 | §3.3 媒体双轨 |
| `creation-gallery-overhaul-sdd.md` | 创作面板 24h 失效 banner | §3.3 COS URL 失效 |

---

## 十、回滚方案

### 10.1 单节点级别回退

Phase 1b 真实 API 一旦出问题（如冲服务端），**单节点级别回退到假数据**，不影响 Phase 0/1a/2：

- 媒体节点保留 `useFakeUrl` flag（`localStorage.getItem('jc_canvas_fake_media') === 'true'`）
- 当 flag 开启时，跳过 `mediaTaskStore.submitTask()`，走原有 SHA 缓存 + `setTimeout` 模拟路径
- 不影响 LLM 节点（LLM 走独立 API 路径）

### 10.2 全局降级

```js
// 浏览器控制台一键降级：
localStorage.setItem('jc_canvas_fake_media', 'true')
// 刷新后所有画布媒体节点走假数据
```

### 10.3 恢复

```js
localStorage.removeItem('jc_canvas_fake_media')
```

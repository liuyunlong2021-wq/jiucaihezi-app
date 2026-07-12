# VueFlow 画布功能桌面版迁移执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在韭菜盒子 Studio 桌面版中新增节点式 AI 画布，让用户能在本地 App 里用节点组织文本、Skill、知识库、图片、视频和本地工具链，并把产物沉淀到第二列文件区。

**Architecture:** 画布作为桌面版独立工作区模式接入：第一列 Rail 新增“画布”，第二列 FileTree 保留，右侧由 `CanvasWorkspace` 占满原 ChatPanel + RightPanel 区域。Vue Flow 只负责交互渲染，Pinia `canvasStore` 是唯一状态源；执行层复用现有云端模型、本地 Ollama、媒体生成、文件区和 Tauri 本地工具能力。

**Tech Stack:** Vue 3, Pinia, Tauri 2, IndexedDB `kv_store/documents`, `@vue-flow/core`, existing `useFileStore`, `mediaTaskStore`, `resolveApiConfig`, `localOllamaRuntime`, `toolRegistry`.

---

## 1. 参考来源与桌面版改造原则

源计划：`/Users/by3/Documents/jiucaihezi-v6/docs/canvas/VueFlow画布功能迁移执行计划.md`

桌面版不能照搬 Web 版方案，必须按当前 App 事实重写：

- 当前桌面布局是 `ActivityRail + FileTreePanel + ChatPanel + RightPanel`，不是 Web 版单主区结构。
- 桌面版已有 Tauri 本地文件系统、格式转换、浏览器控制、媒体处理、Ollama 连接能力，画布应复用这些能力。
- 不做 Web 版“会员拦截/用户中心”逻辑；桌面版入口规则是“用户有 Key 走云端，选 Ollama 走本地”。
- 不暴露 Provider、本地代理、复杂 API 地址设置。
- 不直接复制火宝或 Cherry Studio 源码，只参考功能行为，全部按韭菜盒子现有架构重写。
- 第一版避免大改聊天主链路，所有画布代码动态加载，默认聊天首屏不增加明显负担。

## 2. 产品形态

### 2.1 桌面默认布局保持不变

普通模式仍然是：

```text
第一列 ActivityRail | 第二列 FileTreePanel | 第三列 ChatPanel | 第四列 RightPanel
```

### 2.2 画布模式

点击第一列“画布”后切换为：

```text
第一列 ActivityRail | 第二列 FileTreePanel | 右侧 CanvasWorkspace
```

其中 `CanvasWorkspace` 占用原来的 `ChatPanel + RightPanel` 横向空间。

设计理由：

- 第二列文件区继续保留，方便把节点产物写入和查看。
- 画布需要大空间，不适合塞进当前第四列面板。
- 不新增第五列，符合当前桌面版“第四列切换，不再无限加列”的方向。
- 聊天模式和画布模式互不污染，降低回归风险。

### 2.3 第一版用户入口

第一列新增按钮：

```ts
{ key: 'canvas', icon: 'account_tree', label: '画布' }
```

行为：

- 点击 `canvas`：进入画布模式。
- 再点击其他 Rail 按钮：退出画布模式，恢复聊天模式并打开对应右侧面板。
- 文件按钮 `files` 仍只控制第二列显示/隐藏。
- 移动端第一版不做完整画布，仅显示“画布暂建议桌面窗口使用”占位。

## 3. 文件结构

新增：

```text
src/types/canvas.ts
src/stores/canvasStore.ts
src/components/canvas/
  CanvasWorkspace.vue
  CanvasToolbar.vue
  CanvasNodeLibrary.vue
  CanvasInspector.vue
  CanvasRunConfirmDialog.vue
  nodes/
    CanvasTextNode.vue
    CanvasLlmNode.vue
    CanvasImageGenNode.vue
    CanvasImageResultNode.vue
    CanvasVideoGenNode.vue
    CanvasVideoResultNode.vue
    CanvasFileNode.vue
    CanvasToolNode.vue
  edges/
    PromptOrderEdge.vue
    MediaRoleEdge.vue
  runtime/
    canvasInputs.ts
    canvasLlmRuntime.ts
    canvasMediaRuntime.ts
    canvasToolRuntime.ts
    canvasExecutor.ts
  utils/
    canvasSerialization.ts
    canvasPersistence.ts
    canvasFileSync.ts
    canvasGraph.ts
```

修改：

```text
package.json
src/layouts/WorkspaceLayout.vue
src/components/rail/ActivityRail.vue
src/composables/useFileStore.ts
src/stores/mediaTaskStore.ts
src/utils/api.ts
src/utils/providerConfig.ts
```

测试建议新增：

```text
src/components/canvas/runtime/__tests__/canvasInputs.test.ts
src/components/canvas/utils/__tests__/canvasSerialization.test.ts
src/components/canvas/utils/__tests__/canvasGraph.test.ts
src/stores/__tests__/canvasStore.test.ts
```

如果当前项目继续不引入 Vitest，先用 `vue-tsc` + 纯函数人工测试；但推荐本阶段同步引入 `vitest`，否则画布这种状态机功能很难长期维护。

## 4. 数据模型

### 4.1 节点类型

```ts
export type CanvasNodeType =
  | 'text'
  | 'llm'
  | 'imageGen'
  | 'imageResult'
  | 'videoGen'
  | 'videoResult'
  | 'file'
  | 'tool'

export type CanvasRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export interface CanvasNodeBaseData {
  label: string
  status: CanvasRunStatus
  progress?: number
  error?: string
  fileId?: string
  createdAt: number
  updatedAt: number
}
```

### 4.2 边类型

```ts
export type CanvasEdgeKind =
  | 'default'
  | 'prompt-order'
  | 'image-role'
  | 'media-role'

export interface CanvasEdgeData {
  kind: CanvasEdgeKind
  order?: number
  role?: 'reference' | 'first_frame' | 'last_frame' | 'voice' | 'music'
  createdAt: number
}
```

### 4.3 画布文档

```ts
export interface CanvasDocumentV1 {
  version: 1
  id: string
  title: string
  updatedAt: number
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: { x: number; y: number; zoom: number }
}
```

存储：

```text
IndexedDB kv_store
key: jc_canvas_document_v1
```

桌面版增强：

- 第一版主存储仍用 IndexedDB，避免先引入多画布文件管理复杂度。
- 第二版再增加导出 `.jccanvas`，用于分享、备份和跨设备迁移。
- NodeData 必须是纯 JSON，不保存 `File`、`Blob`、`ArrayBuffer`、函数、Vue ref 或组件实例。
- 大文件统一进入 `documents` store 和本地文件系统，只在节点里保存 `fileId/url/path`。

## 5. 节点能力边界

### 5.1 Text 节点

用途：提示词、脚本、分镜、备注。

核心字段：

```ts
content: string
```

### 5.2 LLM 节点

用途：调用云端模型或本地 Ollama 生成文本。

核心字段：

```ts
modelId: string
modelProviderId: string
agentId?: string
vaultId?: string
systemPrompt?: string
prompt: string
outputContent?: string
outputFileId?: string
```

规则：

- 选择云端模型：走现有 `resolveApiConfig({ forceCloud: true })`。
- 选择 Ollama 模型：走 `resolveLocalOllamaApiConfig`。
- LLM 节点可以选择Skill和知识库。
- 知识库仍遵守现有规则：选择知识库才注入和沉淀，不选择不写入 raw。
- 第一版 LLM 节点不自动调用本地工具，避免画布执行不可控；工具节点单独表达。

### 5.3 ImageGen / ImageResult 节点

用途：图片生成与结果展示。

规则：

- ImageGen 输入来自 Text/LLM/ImageResult。
- 生成成功后自动创建或更新 ImageResult。
- ImageResult 写入第二列文件区，类型为 `image`。

### 5.4 VideoGen / VideoResult 节点

用途：视频生成与结果展示。

规则：

- VideoGen 输入来自 Text/LLM/ImageResult。
- ImageResult -> VideoGen 的边可以设置首帧、尾帧、参考图。
- 生成任务进入现有 `mediaTaskStore` 或 `media-generation.ts` 封装。
- 结果写入第二列文件区，类型为 `video`。

### 5.5 File 节点

用途：引用第二列文件区的文本、图片、视频或知识库条目。

规则：

- 节点只保存 `fileId`。
- 文件不存在时显示“文件已被删除，节点引用保留”。
- 第一版只做从文件区拖入/选择文件生成 File 节点，不做文件区删除后自动改画布。

### 5.6 Tool 节点

用途：承接桌面版本地能力。

第一版只做两个工具节点：

- ToMD：调用现有格式转换能力，把文件转 Markdown。
- 浏览器搜索/读取：复用已成功的浏览器控制或本地搜索能力，只输出结构化文本。

第二版再扩展：

- Office 生成。
- 字幕/音频处理。
- 命令执行。
- 文件批处理。

## 6. 输入合并规则

统一由 `runtime/canvasInputs.ts` 实现。

算法：

```text
1. 找到 target = 当前节点的所有边。
2. 过滤 prompt-order/default 输入边。
3. 按 edge.data.order 升序。
4. order 缺失时按 edge.data.createdAt 升序。
5. 读取 source 节点可输出内容：
   Text -> data.content
   LLM -> data.outputContent || data.prompt
   File(text) -> file.content
   Tool -> data.outputContent
6. 用分隔符拼接。
```

默认拼接格式：

```text
[输入 1：节点名]
内容

---

[输入 2：节点名]
内容
```

执行前校验：

- LLM/Image/Video 当前 prompt 和输入合并结果都为空：禁止执行。
- 引用文件丢失：允许执行，但明确标注缺失项，不静默忽略。
- 多个图片/视频输入边角色冲突：提示用户调整边角色。

## 7. 执行队列与扣费保护

`canvasExecutor.ts` 负责：

- 单节点执行。
- 选中节点执行。
- 下游执行。
- 全画布执行。
- 拓扑排序。
- 状态更新。
- 错误隔离。
- 批量执行确认。

第一版并发限制：

```text
LLM: 1
Image: 1
Video: 1
Tool: 1
```

批量执行前确认文案：

```text
即将执行：
- 文本生成节点 X 个
- 图片生成节点 X 个
- 视频生成节点 X 个
- 本地工具节点 X 个

云端模型和媒体生成会消耗韭菜花；本地工具不消耗模型额度。是否继续？
```

取消规则：

- 第一版支持停止队列后续任务。
- 已提交给云端的媒体任务无法保证取消，只停止后续轮询并提示用户。

## 8. 阶段执行计划

### 阶段 0：Vue Flow 技术验证

**Files:**

- Modify: `package.json`
- Create: `src/components/canvas/CanvasWorkspace.vue`
- Create: `src/stores/canvasStore.ts`

- [ ] 安装并锁定 Vue Flow 依赖：`@vue-flow/core`、`@vue-flow/background`、`@vue-flow/controls`、`@vue-flow/minimap`。
- [ ] 创建最小 `CanvasWorkspace`，渲染 2 个节点和 1 条边。
- [ ] 验证自定义节点组件能读取/更新 `node.data`。
- [ ] 验证自定义边 label 可点击。
- [ ] 验证动态加载后普通聊天首屏可正常打开。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Exit Criteria:**

- Vue Flow 在 Tauri production build 中可正常渲染。
- 普通聊天布局不受影响。

### 阶段 1：桌面布局接入

**Files:**

- Modify: `src/components/rail/ActivityRail.vue`
- Modify: `src/layouts/WorkspaceLayout.vue`
- Create: `src/components/canvas/CanvasWorkspace.vue`

- [ ] `ActivityRail` 新增 `canvas` 按钮。
- [ ] `WorkspaceLayout` 新增 `workspaceMode: 'chat' | 'canvas'`。
- [ ] 桌面画布模式渲染 `Rail + FileTree + CanvasWorkspace`。
- [ ] `CanvasWorkspace` 使用 `defineAsyncComponent` 动态加载。
- [ ] 点击其他 Rail 按钮时退出画布模式并恢复聊天布局。
- [ ] 移动端显示画布占位，不做完整交互。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- 默认进入 App 仍是聊天。
- 点击画布后 ChatPanel 和右侧面板被画布替代。
- 第二列文件树仍可收起/展开。
- 再点Skill仓库/工具仓库/设置能回到聊天布局。

### 阶段 2：类型、Store、序列化和持久化

**Files:**

- Create: `src/types/canvas.ts`
- Create: `src/stores/canvasStore.ts`
- Create: `src/components/canvas/utils/canvasSerialization.ts`
- Create: `src/components/canvas/utils/canvasPersistence.ts`

- [ ] 定义 `CanvasDocumentV1`、节点类型、边类型和状态类型。
- [ ] 实现 `sanitizeCanvasDocument`，剔除非 JSON 字段。
- [ ] 实现 `serializeCanvasDocument` 和 `parseCanvasDocument`。
- [ ] `canvasStore` 管理 nodes/edges/viewport/currentSelection/history。
- [ ] 自动保存 debounce 500ms 到 `kv_store:jc_canvas_document_v1`。
- [ ] 打开画布时恢复上次状态。
- [ ] 实现 undo/redo 基础栈，限制最多 50 步。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- 添加节点后刷新 App，节点仍在。
- 拖动节点后刷新，位置保持。
- 删除节点后 undo 可恢复。

### 阶段 3：基础节点和连接规则

**Files:**

- Create: `src/components/canvas/CanvasNodeLibrary.vue`
- Create: `src/components/canvas/CanvasInspector.vue`
- Create: `src/components/canvas/nodes/CanvasTextNode.vue`
- Create: `src/components/canvas/nodes/CanvasLlmNode.vue`
- Create: `src/components/canvas/nodes/CanvasImageGenNode.vue`
- Create: `src/components/canvas/nodes/CanvasImageResultNode.vue`
- Create: `src/components/canvas/nodes/CanvasVideoGenNode.vue`
- Create: `src/components/canvas/nodes/CanvasVideoResultNode.vue`
- Create: `src/components/canvas/nodes/CanvasFileNode.vue`
- Create: `src/components/canvas/edges/PromptOrderEdge.vue`

- [ ] 节点库支持添加 Text/LLM/ImageGen/VideoGen/File。
- [ ] 节点支持选中、重命名、删除、复制。
- [ ] 复制节点必须深拷贝 data，不能共享引用。
- [ ] 实现基础连线。
- [ ] Text/LLM/File -> LLM/ImageGen/VideoGen 自动生成 `prompt-order` 边。
- [ ] ImageResult -> ImageGen/VideoGen 自动生成 `image-role` 边。
- [ ] `PromptOrderEdge` 显示顺序数字并可编辑。
- [ ] 边 data 保存和恢复。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- 多个 Text 连到 LLM 后可调整顺序。
- 刷新后边顺序仍在。
- 复制 Text 后修改副本不影响原节点。

### 阶段 4：LLM 节点执行

**Files:**

- Create: `src/components/canvas/runtime/canvasInputs.ts`
- Create: `src/components/canvas/runtime/canvasLlmRuntime.ts`
- Create: `src/components/canvas/runtime/canvasExecutor.ts`
- Modify: `src/utils/api.ts`
- Modify: `src/stores/agentStore.ts`

- [ ] 实现输入合并算法。
- [ ] LLM 节点支持选择当前模型列表中的云端模型和 Ollama 模型。
- [ ] LLM 节点支持选择Skill。
- [ ] LLM 节点支持选择知识库。
- [ ] 云端模型走现有 NewAPI 隐藏地址和 Key 轮询逻辑。
- [ ] Ollama 模型走 `local-ollama` 路径，不走云端 Key。
- [ ] 输出写回节点 `outputContent`。
- [ ] 输出写入第二列文件区：`useFileStore().addText(...)`。
- [ ] 执行失败时节点进入 `error`，保留错误摘要和重试按钮。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- Text -> LLM 可执行。
- LLM 输出显示在节点里。
- LLM 输出出现在第二列文件区。
- 云端模型和 Ollama 模型都能手动选择，互不自动切换。

### 阶段 5：图片和视频节点执行

**Files:**

- Create: `src/components/canvas/runtime/canvasMediaRuntime.ts`
- Modify: `src/stores/mediaTaskStore.ts`
- Modify: `src/api/media-generation.ts`
- Modify: `src/composables/useFileStore.ts`

- [ ] ImageGen 读取 Text/LLM/File prompt。
- [ ] ImageGen 读取 ImageResult 参考图。
- [ ] 调用现有 `media-generation.ts` 图片生成能力。
- [ ] 图片成功后自动创建/更新 ImageResult。
- [ ] ImageResult 自动连线并写入第二列 `image`。
- [ ] VideoGen 读取 Text/LLM/File prompt。
- [ ] VideoGen 读取 ImageResult 首帧/尾帧/参考图。
- [ ] 调用现有视频生成能力并显示轮询进度。
- [ ] 视频成功后自动创建/更新 VideoResult。
- [ ] VideoResult 自动连线并写入第二列 `video`。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- Text -> ImageGen 生成图片，自动出现 ImageResult。
- Text -> VideoGen 生成视频，自动出现 VideoResult。
- 结果文件在第二列可查看。

### 阶段 6：桌面本地工具节点

**Files:**

- Create: `src/components/canvas/nodes/CanvasToolNode.vue`
- Create: `src/components/canvas/runtime/canvasToolRuntime.ts`
- Modify: `src/utils/toolRegistry.ts`
- Modify: `src/utils/formatConverter.ts`
- Modify: `src/utils/browserTools.ts`

- [ ] Tool 节点第一版只开放 ToMD 和浏览器读取。
- [ ] ToMD 节点输入 File 节点，输出 Markdown 文本文件。
- [ ] 浏览器读取节点输入搜索词或 URL，输出结构化 Markdown。
- [ ] 本地工具节点默认不消耗模型额度，但可被 LLM 节点读取输出。
- [ ] 工具执行状态必须可见：queued/running/success/error。
- [ ] 工具失败保留错误，不阻断其他非依赖节点。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
pnpm tauri build --bundles app
```

**Manual Check:**

- File -> ToMD 可以把文件转成 Markdown，并写入第二列。
- 浏览器读取节点可输出 Markdown 摘要。
- LLM 节点能读取工具节点输出继续生成。

### 阶段 7：模板、队列和批量确认

**Files:**

- Create: `src/components/canvas/CanvasRunConfirmDialog.vue`
- Create: `src/components/canvas/CanvasWorkflowPanel.vue`
- Create: `src/components/canvas/runtime/canvasWorkflows.ts`
- Modify: `src/components/canvas/runtime/canvasExecutor.ts`

- [ ] 实现执行队列和拓扑排序。
- [ ] 执行多个节点前弹确认。
- [ ] 第一批模板：文生图、图生图、文生视频、图生视频、文案到分镜。
- [ ] 模板只创建节点，不自动执行。
- [ ] 支持执行选中节点、执行下游、执行全部。
- [ ] 支持停止队列。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
```

**Manual Check:**

- 点击模板生成节点网络。
- 执行全部前出现确认。
- 停止队列后未开始的节点保持 idle 或 cancelled。

### 阶段 8：桌面打包验收

**Files:**

- Modify only if needed: `src-tauri/tauri.conf.json`
- Modify only if needed: `scripts/fix-macos-app.mjs`

- [ ] 检查 CSP 是否允许画布需要的本地资源和媒体预览。
- [ ] 检查大文件预览不会把 Blob 写入画布 JSON。
- [ ] 检查普通聊天、工具仓库、知识库、编辑区没有回归。
- [ ] 打包 macOS `.app`。
- [ ] 执行 `pnpm tauri:fix-macos-app`。

**Verification:**

```bash
pnpm exec vue-tsc -b
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app
pnpm tauri:fix-macos-app
```

**Manual Check:**

- 从打包后的 `.app` 打开。
- 画布可打开、保存、恢复。
- 云端模型、本地 Ollama、媒体生成、ToMD 节点各走自己的路径。
- 默认聊天功能不变。

## 9. 第一版上线范围

必须包含：

- 第一列“画布”按钮。
- 桌面画布模式布局。
- Vue Flow 动态加载。
- 受控 `canvasStore`。
- 画布自动保存和恢复。
- Text / LLM / ImageGen / ImageResult / VideoGen / VideoResult / File 节点。
- PromptOrderEdge 顺序编辑。
- LLM 节点支持云端模型、本地 Ollama、Skill、知识库。
- 图片/视频自动结果节点。
- 结果写入第二列文件区。
- 执行队列和批量确认。

第一版不做：

- 多画布项目管理。
- Web 会员拦截。
- 自动意图编排。
- 复杂命令执行节点。
- 文件区到画布的双向同步。
- 多人协作。
- Canvas 图表或 Obsidian canvas 兼容。

## 10. 风险与处理

| 风险 | 处理 |
| --- | --- |
| Vue Flow 影响普通聊天首屏 | `CanvasWorkspace` 动态加载，依赖只在画布模式加载 |
| 画布布局破坏现有列宽逻辑 | `workspaceMode` 独立分支，不在普通布局里塞复杂 `v-if` |
| 节点数据污染 IndexedDB | `sanitizeCanvasDocument` 强制纯 JSON |
| 本地/云端模型路径混乱 | 节点保存 `modelProviderId`，执行时按 provider 分派 |
| 批量执行误扣费 | 队列确认 + 并发限制 + 云端消耗提示 |
| 媒体任务轮询复杂 | 复用 `mediaTaskStore` 和 `media-generation.ts`，画布只订阅状态 |
| 文件被删除后节点引用失效 | 节点保留预览和 fileId，打开时提示文件已删除 |
| 本地工具执行不可控 | 第一版只开放 ToMD 和浏览器读取，命令执行放第二版 |
| 大图/视频卡顿 | 节点只预览缩略，不自动播放视频，不把文件内容写进 NodeData |

## 11. 推荐执行顺序

1. 阶段 0：Vue Flow 技术验证。
2. 阶段 1：桌面布局接入。
3. 阶段 2：类型、Store、序列化和持久化。
4. 阶段 3：基础节点和连接规则。
5. 阶段 4：LLM 节点执行。
6. 阶段 5：图片和视频节点执行。
7. 阶段 7：模板、队列和批量确认。
8. 阶段 8：桌面打包验收。
9. 阶段 6 工具节点可并入第一版后半段；如果时间紧，先只保留 ToMD 节点，把浏览器读取放第二版。

最小可用闭环是：

```text
Text/File -> LLM -> ImageGen/VideoGen -> Result -> 第二列文件区
```

桌面增强闭环是：

```text
File -> ToMD -> LLM -> 产物 -> 第二列文件区/本地文件系统
```

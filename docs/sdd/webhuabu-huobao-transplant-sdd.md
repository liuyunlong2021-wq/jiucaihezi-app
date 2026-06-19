# 火宝画布完整移植 SDD

> 版本: v1.0  
> 日期: 2026-06-19  
> 分支: `webhuabu`  
> 源: `/Users/by3/Documents/huobao-canvas` @ `e750733`（最新）  
> 原则: 完整搬运 UI + 交互 + 逻辑，替换 API/Store 后端，保留我们的 Skill/Toolset 独有节点

---

## 零、移植策略

**「先搬运，后替换」**：
1. 火宝组件完整放入 `src/components/canvas/huobao/`，先跑通
2. 逐步替换 API 层 → `media-generation.ts` + `newApiClient.ts`
3. 逐步替换 Store 层 → `canvasStore.ts` + `agentStore.ts`
4. 逐步剥离 NaiveUI → 原生 `<select>` `<input>` + 我们的 CSS
5. 逐步替换 Tailwind → 设计令牌 `--jc-*` + `--surface` 等

**回滚安全**：每个组件搬完立即 `vue-tsc` + `vite build`，任何一步不通过就回退。

---

## 一、文件对照表

### 1.1 核心画布

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `src/views/Canvas.vue` | `CanvasWorkspace.vue`（替换现有） | NaiveUI→原生, 事件→我们的 emit |
| `src/views/Home.vue` | 不需要（我们有 WorkspaceLayout） | — |

### 1.2 节点组件

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `nodes/TextNode.vue` | `v8/nodes/V8TextNode.vue` | Tailwind→tokens, NaiveUI→原生, JS→TS |
| `nodes/LLMConfigNode.vue` | `v8/nodes/V8LlmNode.vue` | +Skill注入, API→gatewayFetch, NaiveUI→原生 |
| `nodes/ImageConfigNode.vue` | `v8/nodes/V8ImageGenNode.vue` | API→media-generation.ts, NaiveUI→原生 |
| `nodes/VideoConfigNode.vue` | `v8/nodes/V8VideoGenNode.vue` | 同上 + 首帧尾帧逻辑 |
| `nodes/ImageNode.vue` | `v8/nodes/V8ImageResultNode.vue` | Tailwind→tokens |
| `nodes/VideoNode.vue` | `v8/nodes/V8VideoResultNode.vue` | Tailwind→tokens |
| `nodes/NodeHandleMenu.vue` | 新增 `v8/shared/NodeHandleMenu.vue` | 直接搬，轻改 |

### 1.3 边组件

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `edges/ImageRoleEdge.vue` | 替换 `edges/ImageRoleEdge.vue` | 直接替换 |
| `edges/PromptOrderEdge.vue` | 替换 `edges/PromptOrderEdge.vue` | 直接替换 |
| `edges/ImageOrderEdge.vue` | 新增 | 新增 |

### 1.4 Store

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `stores/canvas.js` | 合入 `canvasStore.ts` | JS→TS, 保留我们已有功能 |
| `stores/models.js` | 桥接 `agentStore.ts` | 模型列表走我们的 agentStore |
| `stores/projects.js` | 跳过（我们用 idb.ts） | — |
| `stores/pinia/index.js` | 桥接 `agentStore.ts` | — |
| `stores/theme.js` | 跳过（我们有 useTheme.ts） | — |
| `stores/api.js` | 跳过（我们用 newApiClient.ts） | — |

### 1.5 Hook / 逻辑层

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `hooks/useChat.js` | 桥接 `useChat.ts`（画布独立路径） | 替换 axios→gatewayFetch |
| `hooks/useImageGeneration.js` | 桥接 `media-generation.ts` | 替换 API 调用 |
| `hooks/useVideoGeneration.js` | 桥接 `media-generation.ts` | 同上 |
| `hooks/useProvider.js` | 跳过（用 resolveApiConfig） | — |
| `hooks/useModelConfig.js` | 桥接 `mediaModelCapabilities.ts` | — |
| `hooks/useWorkflowOrchestrator.js` | 可选（违反宪法，后续评估） | — |
| `hooks/useNodeRef.js` | 可选（@提及，P6+） | — |

### 1.6 配置

| 火宝文件 | 移植到 | 改动 |
|----------|--------|------|
| `config/models.js` | 不搬（用 mediaModelCapabilities.ts） | — |
| `config/providers.js` | 不搬（用 providerConfig.ts） | — |
| `config/workflows.js` | 可选搬到 `canvas/workflows/` | — |

---

## 二、NaiveUI 剥离清单

| NaiveUI 组件 | 替换为 |
|-------------|--------|
| `<n-icon>` | `<span class="mso">icon_name</span>` |
| `<n-select>` | `<select>` + 我们的 `.v8-select` 样式 |
| `<n-spin>` | CSS 动画 spinner |
| `<n-dropdown>` | 自定义下拉（我们已有模式） |
| `<n-button>` | `<button>` |
| `<n-input>` | `<input>` |
| `window.$message` | 我们的 toast / console |

---

## 三、Tailwind → 设计令牌对照

| 火宝 Tailwind | 我们的令牌 |
|---------------|-----------|
| `bg-[var(--bg-secondary)]` | `background: var(--surface-alt)` |
| `bg-[var(--bg-tertiary)]` | `background: var(--surface)` |
| `text-[var(--text-primary)]` | `color: var(--ink1)` |
| `text-[var(--text-secondary)]` | `color: var(--ink2)` |
| `border-[var(--border-color)]` | `border-color: var(--border)` |
| `rounded-xl` | `border-radius: 12px` |
| `shadow-lg shadow-xxx/20` | `box-shadow: var(--jc-shadow-md)` |
| `transition-all duration-200` | `transition: all .2s` |
| `bg-purple-500` | `background: #8b5cf6`（role color） |
| `bg-green-500` | `background: #10b981` |
| `hover:bg-purple-600` | `&:hover { background: #7c3aed }` |

---

## 四、实施顺序（按依赖）

| # | 组件 | 原因 | 预计 |
|:--:|------|------|:--:|
| 1 | **NodeHandleMenu.vue** | 被所有节点依赖，先做 | 30min |
| 2 | **TextNode** → V8TextNode | 最简单的节点，验证搬运流程 | 45min |
| 3 | **ImageRoleEdge + PromptOrderEdge + ImageOrderEdge** | 边组件，被后续节点依赖 | 30min |
| 4 | **LLMConfigNode** → V8LlmNode | 最复杂节点，核心 | 2h |
| 5 | **ImageConfigNode** → V8ImageGenNode | 生图节点 | 1h |
| 6 | **ImageNode** → V8ImageResultNode | 图片结果 | 30min |
| 7 | **VideoConfigNode** → V8VideoGenNode | 生视频+首尾帧 | 1h |
| 8 | **VideoNode** → V8VideoResultNode | 视频结果 | 30min |
| 9 | **Canvas.vue** → CanvasWorkspace | 主画布集成 | 1h |
| 10 | **Store 桥接 + API 替换** | 接入真实后端 | 2h |
| 11 | **保留节点集成** | Skill/Toolset + T8 节点 | 1h |

**总计约 10 小时**，分 3 天。

---

## 五、每步验证

每完成一个组件的搬运：
```bash
npx vue-tsc -b          # 类型检查
npx vite build           # 构建验证
# 浏览器: pnpm dev → 拖入节点测试
```

---

## 六、不改的

| 项目 | 理由 |
|------|------|
| 我们的 `mediaTaskStore` | 保留，后续桥接 |
| 我们的 `agentStore` | 保留，模型选择走这个 |
| 我们的 `canvasStore` | 保留，合入火宝的 addNode/updateNode |
| `V8SkillNode` + `V8ToolsetNode` | 保留，我们独有 |
| T8 旧节点 (31个) | 不动 |
| `@/composables/useChat.ts` | 画布走独立路径 |
| `src-tauri/**` | Web 端纯云端 |

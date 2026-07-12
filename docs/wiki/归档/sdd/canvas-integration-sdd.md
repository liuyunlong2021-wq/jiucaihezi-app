# 韭菜盒子画布 — 支线交接文档

> **创建日期**: 2026-07-11
> **更新日期**: 2026-07-11（LeaferJS 方案确认）
> **来源分支**: `0710-xiubug`
> **目标分支**: `0711-canvas`
> **状态**: 规划阶段 — 技术选型已完成

---

## 一、目标

构建韭菜盒子自己的画布系统，融合以下能力：

| 能力类型 | 具体功能 | 灵感来源 |
|----------|---------|---------|
| **图片编辑** | 标注修图、图层分离、文字改写、去背景、扩图 | codex-canvas (Xiangyu-CAS, 45⭐) |
| **营销模板** | 小红书封面、电商组图、Logo生成、宣传册、跨平台适配 | AI-Canvas (binghe1980, 195⭐) |

**定位**：画布与创作面板互补——创作面板管「生成」，画布管「编辑+模板」。

---

## 二、技术选型：LeaferJS 🏆

### 2.1 为什么不用之前考虑的方案

| 方案 | 问题 |
|------|------|
| AI-Canvas (tldraw) | tldraw 是 React 生态，iframe 嵌入割裂。写剧本/Wiki/知识库需要与 Vue 组件深度联动 |
| codex-canvas | JS + Python 混合，自研画布引擎，移植成本高 |
| 自研画布 | 旧画布（VueFlow 节点式）已归档，重写成本太高 |

### 2.2 LeaferJS：完美的 Vue 3 画布引擎

> GitHub: [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | ⭐ 4.3k | MIT | v2.2.0（昨天发版）

| 维度 | LeaferJS | tldraw | @vue-flow/core |
|------|----------|--------|----------------|
| 语言 | **TypeScript 100%** ✅ | TypeScript | TypeScript |
| 框架 | **框架无关（纯 Canvas）** ✅ | React | Vue 3 |
| 体积 | **70KB min+gzip 零依赖** ✅ | ~500KB | ~200KB |
| 内置编辑 | **Editor 插件：旋转/缩放/多选/框选/吸附/标尺** ✅ | 需自定义 | 无（节点图） |
| 性能 | **100万元素 @ 60fps，320MB 内存** ✅ | 中等 | 中等 |
| AI 定位 | **官方定位「AI 无限画布引擎」** ✅ | 通用白板 | 流程图 |
| MCP | **有官方 MCP & Skills** ✅ | 无 | 无 |
| 中文 | **中文文档 + 中国团队** ✅ | 英文 | 英文 |
| 许可证 | MIT ✅ | MIT | MIT |

**LeaferJS 是 100% TypeScript、框架无关的 Canvas 引擎**。不像 tldraw 绑定 React，LeaferJS 可以直接在 Vue 3 组件的 `<div ref>` 上初始化：

```ts
// Vue 3 组件中直接使用，零包装
import { Leafer, Rect, Image } from 'leafer-ui'
import { Editor } from '@leafer-in/editor'

const leafer = new Leafer({ view: canvasDivRef.value })
// 图片编辑、拖拽、缩放、旋转 —— 全部内置
```

**这意味着画布是 Vue 组件树的一部分**，可以：
- 直接访问 Pinia stores（无需 postMessage）
- 直接用 eventBus 与聊天/编辑区通信
- 直接用 Tauri IPC 读写文件系统
- 直接用 `useCreation` 的生成结果

### 2.3 其他场景也覆盖

- **剧本/小说写作** → 画布上贴角色卡片、情节节点、时间线
- **Wiki 知识库** → 画布上可视化 [[双链]] 关系图谱
- **Obsidian 知识库** → 画布做 JSON Canvas 的可视化编辑

---

## 三、集成方式：Vue 组件直嵌（不要 iframe）

```
┌────────┬──────────┬──────────────┬──────────────────────────┐
│  Rail  │ FileTree │  ChatPanel   │  画布（第四列）           │
│  🎨    │          │              │  ┌──────────────────────┐ │
│  新增  │          │              │  │ LeaferJS 无限画布     │ │
│  画布  │          │              │  │ · 图片拖拽/图层管理   │ │
│  按钮  │          │              │  │ · 箭头标注修图        │ │
│        │          │              │  │ · 一键去背景          │ │
│        │          │              │  │ · 扩图/outpaint       │ │
│        │          │              │  │ · Skill 模板面板      │ │
│        │          │              │  └──────────────────────┘ │
│        │          │              │   纯 Vue 组件，非 iframe  │
└────────┴──────────┴──────────────┴──────────────────────────┘
```

**不跑 Node.js 服务，不嵌 iframe。** LeaferJS 就是一个 npm 包，直接 `import` 用。

---

## 四、旧画布代码

### 能找回吗？

旧画布是 **VueFlow 节点式工作流画布**（LLM 节点、图片生成节点、视频节点），不是图片编辑画布。

`scripts/remove-canvas.sh` 执行了 `mv` 到 `_canvas-archive/`，但这个目录后来被删了。不过 Git 历史里有：

```bash
git show 2cab8bc --stat  # 移除画布的 commit
# 包含：110+ 文件，31 节点 + runtime，6 个 Pinia store，470 行类型定义
git checkout 2cab8bc~1 -- src/components/canvas/  # 恢复旧画布代码
```

**但是旧画布不适合复用**，原因：
- 它是 VueFlow 节点工作流（类似 ComfyUI），不是无限画布
- 用 `@vue-flow/core` 做节点编排，不是图片编辑
- 已从 `package.json` 移除依赖

**可复用的只有架构经验**：
- Rail 按钮 → 切换 workspaceMode 的模式（`src/layouts/WorkspaceLayout.vue`）
- canvasStore 的设计思路
- `docs/sdd/desktop-vueflow-canvas-execution-plan.md` 的规划文档

---

## 五、分步实施计划

### Phase 0：基建（预计 1-2 天）

```
步骤 0.1：安装 LeaferJS 依赖
步骤 0.2：ActivityRail 加画布按钮 🎨
步骤 0.3：WorkspaceLayout 第四列加 CanvasPanel 组件
步骤 0.4：CanvasPanel 初始化 LeaferJS + Editor 插件
步骤 0.5：验证：画布能拖拽、缩放图片
```

**具体改动**：

#### 0.1 安装依赖

```bash
pnpm add leafer-ui @leafer-in/editor @leafer-in/view @leafer-in/viewport
```

#### 0.2 ActivityRail 加画布按钮

`src/components/rail/ActivityRail.vue`：

```diff
  const allTabs = [
+   { key: 'canvas',        icon: 'palette',                labelKey: 'rail.canvas' },
    { key: 'skills',         icon: 'paid',                   labelKey: 'rail.skillsManage' },
    ...
  ]
```

`src/i18n/index.ts`：
```ts
'rail.canvas': { zh: '画布', en: 'Canvas' },
```

⚠️ 画布是桌面端专属，不在 `webHiddenTabs` 中，但 `isMobile` 时不显示。

#### 0.3 WorkspaceLayout 第四列加 CanvasPanel

`src/layouts/WorkspaceLayout.vue`：

```diff
+ import CanvasPanel from '@/components/canvas/CanvasPanel.vue'

  // 在模板的第四列 v-if/else-if 链中：
+ <CanvasPanel v-else-if="rightPanel === 'canvas'" />
```

#### 0.4 CanvasPanel — 核心组件

```
src/components/canvas/
├── CanvasPanel.vue          # Vue 组件壳：初始化 Leafer + Editor
├── CanvasToolbar.vue        # 工具栏（标注/去背景/扩图/Skill）
├── layers/
│   └── ImageLayer.ts        # 图片图层封装（拖入/生成/粘贴）
├── tools/
│   ├── QuickEditTool.ts     # 箭头标注 + 画笔 + 文字
│   ├── RemoveBgTool.ts      # 去背景（调 RH/NewAPI）
│   ├── ExpandTool.ts        # 扩图框 + 比例预设
│   ├── EditTextTool.ts      # OCR 文字识别+改写
│   └── EditElementsTool.ts  # 图层分离（GPT 分割）
├── skills/
│   ├── SkillPanel.vue       # Skill 面板壳（分类+表单）
│   ├── XiaohongshuCover.vue # 小红书封面参数表单
│   ├── ProductMarketing.vue # 电商组图参数表单
│   ├── LogoBrand.vue        # Logo 品牌参数表单
│   └── CrossPlatform.vue    # 跨平台适配参数表单
├── bridge/
│   ├── creationBridge.ts    # 创作面板 → 画布（产出自动入画布）
│   ├── chatBridge.ts        # 画布 → 聊天（Send to Chat / Copy @file）
│   └── agentBridge.ts       # 画布 ↔ OpenCode Agent（MCP tools）
└── store/
    └── canvasStore.ts       # Pinia store：画布状态 + 持久化
```

**CanvasPanel.vue 核心结构**（≈60行）：

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Leafer } from 'leafer-ui'
import { Editor } from '@leafer-in/editor'
import { Viewport } from '@leafer-in/viewport'

const containerRef = ref<HTMLDivElement>()
let leafer: Leafer

onMounted(() => {
  leafer = new Leafer({ view: containerRef.value!, type: 'design' })
  // 内置 Editor：旋转/缩放/多选/框选/吸附
  new Editor({ target: leafer })
  // 无限画布视窗：滚轮缩放 + 拖拽平移
  new Viewport({ target: leafer })
})

onBeforeUnmount(() => leafer?.destroy())
</script>

<template>
  <div class="canvas-panel">
    <CanvasToolbar :leafer="leafer" />
    <div ref="containerRef" class="canvas-container" />
  </div>
</template>
```

### Phase 1：图片编辑功能（预计 3-5 天）

基于 LeaferJS 的 Editor 插件实现：

```
步骤 1.1：Quick Edit — 箭头画笔标注（LeaferJS 原生支持）
步骤 1.2：Remove BG — 选中图片 → 调 RH 去背景模型 → 替换图层
步骤 1.3：Expand — 拖拽扩图框 → 调 outpainting → 补全边缘
步骤 1.4：Edit Text — OCR 识别 → 文字覆盖层编辑 → 回写图片
步骤 1.5：Edit Elements — GPT-image-2 分割 → 拆分图层 → LeaferJS 图层管理
```

**关键**：这些功能不需要从 codex-canvas 移植代码，而是用 LeaferJS 的原生能力 + NewAPI 媒体生成实现。

### Phase 2：Skill 模板面板（预计 2-3 天）

Vue 3 组件实现的参数表单，提交后调用 NewAPI 生成：

```
步骤 2.1：SkillPanel.vue — 分类导航 + 表单框架
步骤 2.2：小红书封面 — 3:4 比例，标题/风格/保留元素
步骤 2.3：产品营销组图 — 多图批量，主图/卖点图/场景图
步骤 2.4：Logo 品牌 — 品牌名/行业/风格 → 多方案对比
步骤 2.5：宣传册 + 跨平台适配
步骤 2.6：生成结果自动回写画布
```

### Phase 3：深度联动（预计 2-3 天）

```
步骤 3.1：创作面板产出 → 自动入画布（creationBridge.ts）
步骤 3.2：画布选中图片 → Copy @file → 粘贴到聊天
步骤 3.3：画布 ↔ OpenCode Agent（MCP tools）
步骤 3.4：画布选中 → 右键 → 导入编辑区（Wiki/剧本写作）
步骤 3.5：编辑区/聊天中的图片 → 右键 → 发送到画布
```

### Phase 4：打磨（预计 1-2 天）

```
步骤 4.1：画布数据持久化（.jiucaihezi/canvas/{project}/）
步骤 4.2：暗色模式适配
步骤 4.3：右键菜单 + 快捷键
步骤 4.4：画布会话隔离（不同 OpenCode session 不同画布）
```

---

## 六、文件变更清单

### 新增文件

```
src/components/canvas/
├── CanvasPanel.vue              # 核心组件（~60行）
├── CanvasToolbar.vue            # 工具栏
├── layers/ImageLayer.ts         # 图片图层封装
├── tools/                       # 编辑工具
│   ├── QuickEditTool.ts
│   ├── RemoveBgTool.ts
│   ├── ExpandTool.ts
│   ├── EditTextTool.ts
│   └── EditElementsTool.ts
├── skills/                      # Skill 模板面板（纯 Vue）
│   ├── SkillPanel.vue
│   ├── XiaohongshuCover.vue
│   ├── ProductMarketing.vue
│   ├── LogoBrand.vue
│   └── CrossPlatform.vue
├── bridge/                      # 联动桥梁
│   ├── creationBridge.ts
│   ├── chatBridge.ts
│   └── agentBridge.ts
└── store/canvasStore.ts         # Pinia store

docs/sdd/canvas-integration-sdd.md  # 本文档
```

### 修改文件

```
src/components/rail/ActivityRail.vue     # +1 画布按钮
src/layouts/WorkspaceLayout.vue           # +CanvasPanel + rightPanel='canvas'
src/i18n/index.ts                         # +画布翻译
package.json                              # +leafer-ui @leafer-in/editor @leafer-in/viewport
```

**不需要 Rust 端改动**（纯前端能力，不依赖 Node.js 服务）。

---

## 七、与旧方案的对比

| | 旧方案（AI-Canvas 基座） | 新方案（LeaferJS） |
|---|---|---|
| 画布引擎 | tldraw (React) | LeaferJS (框架无关) |
| 集成方式 | iframe + postMessage | Vue 组件直嵌 |
| 额外服务 | Node.js MCP Server 进程 | 无 |
| 与 Vue 联动 | postMessage 桥接 | 直接调 Pinia/eventBus/Tauri |
| 体积 | tldraw ~500KB | LeaferJS 70KB |
| 编辑能力 | 需从 codex-canvas 移植 | Editor 插件内置 |
| Skill 面板 | 从 AI-Canvas 移植（React→Vue） | 原生 Vue 3 组件 |

---

## 八、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| LeaferJS API 学习曲线 | 低 | 中文文档 + 丰富示例 + 类 DOM API |
| Editor 插件功能够不够 | 低 | 旋转/缩放/多选/框选/吸附/标尺 均内置 |
| 图片生成依赖 NewAPI | 中 | 已有链路，创作面板已验证 |
| OCR (Edit Text) | 中 | tesseract.js WASM 或 GPT-4V |
| Skill 模板 prompt 质量 | 中 | 先抄 AI-Canvas 的参数表单，prompt 调优迭代 |
| 性能 | 低 | 100万元素 60fps，远超需求 |

---

## 九、启动命令

```bash
# 分支已建：
git branch  # 确认在 0711-canvas

# 安装画布依赖（Phase 0.1）：
pnpm add leafer-ui @leafer-in/editor @leafer-in/viewport

# 开始 Phase 0.2：改 ActivityRail 加按钮
```

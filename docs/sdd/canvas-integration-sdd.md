# 韭菜盒子画布 — 支线交接文档

> **创建日期**: 2026-07-11
> **来源分支**: `0710-xiubug`
> **目标分支**: `0711-canvas`（待创建）
> **状态**: 规划阶段

---

## 一、目标

融合两个开源 Codex Canvas 插件的全部能力，构建韭菜盒子自己的画布系统：

| 来源 | 能力 | 仓库 |
|------|------|------|
| **codex-canvas** | Quick Edit（箭头标注修图）、Edit Elements（图层分离+PSD导出）、Edit Text（OCR文字改写）、Remove BG（去背景）、Expand（扩图/outpaint） | Xiangyu-CAS/codex-canvas (45⭐, MIT) |
| **AI-Canvas** | 小红书封面、YouTube缩略图、产品营销组图、Logo与品牌、营销宣传册、一键跨平台适配 | binghe1980/AI-Canvas (195⭐, MIT) |

**合成一个韭菜盒子画布**，在第四列打开，与现有创作面板互补：创作面板管生成，画布管编辑+模板。

---

## 二、架构决策

### 2.1 选择 AI-Canvas 作为基座

| 维度 | AI-Canvas | codex-canvas | 选择 |
|------|-----------|-------------|------|
| 语言 | TypeScript 94% | JavaScript 83% + Python 10% | **AI-Canvas** ✅（与我们的 Vue3/TS 栈一致） |
| 画布引擎 | tldraw（成熟开源） | 自研 Lovart 风格 | **AI-Canvas** ✅（tldraw 生态好） |
| 插件结构 | Codex Plugin + MCP Server | Codex Plugin + MCP Server | 两者同构 |
| 编辑能力 | 基础标注修图 | **Quick Edit / Edit Elements / Edit Text / Remove BG / Expand** | codex-canvas 更强 |
| 模板能力 | **6 个业务 Skill 面板** | 无 | AI-Canvas 独有 |
| 活跃度 | 2 周前 | **昨天还在发版（v0.3.1）** | codex-canvas 更活跃 |

**决策**：以 **AI-Canvas 为基座**（tldraw 画布 + Skill 面板），从 codex-canvas **移植编辑功能**（Quick Edit / Edit Elements / Edit Text / Remove BG / Expand）。

### 2.2 集成方式

```
┌────────┬──────────┬──────────────┬──────────────────────────┐
│  Rail  │ FileTree │  ChatPanel   │  画布（第四列）           │
│  🎨    │          │              │  ┌──────────────────────┐ │
│  新增  │          │              │  │ tldraw 无限画布       │ │
│  画布  │          │              │  │ · 图片拖拽/排列       │ │
│  按钮  │          │              │  │ · Quick Edit 标注      │ │
│        │          │              │  │ · Edit Elements 图层   │ │
│        │          │              │  │ · Skill 面板（右侧）   │ │
│        │          │              │  └──────────────────────┘ │
│        │          │              │  本地服务 127.0.0.1:43218 │
└────────┴──────────┴──────────────┴──────────────────────────┘
```

画布以 **iframe 嵌入第四列**，运行本地 Node.js 服务（tldraw + MCP Server）。通过 MCP 协议与 OpenCode Agent 通信。

### 2.3 为什么不直接装 Codex Plugin

Codex Plugin 依赖 Codex 的 Plugin 运行时（`codex plugin add`），我们的 Plugin 系统是自建的，不兼容。需要做适配层。

---

## 三、分步实施计划

### Phase 0：基建（预计 1-2 天）

```
步骤 0.1：克隆 AI-Canvas，提取 canvas-app 核心
步骤 0.2：在 src-tauri 中注册本地画布服务启动
步骤 0.3：ActivityRail 加画布按钮 🎨
步骤 0.4：WorkspaceLayout 第四列加 iframe 容器
步骤 0.5：验证画布能在第四列打开
```

**具体改动**：

#### 0.1 提取 canvas-app

```bash
# 在项目根目录
mkdir -p canvas/
cd canvas/
git clone --depth 1 https://github.com/binghe1980/AI-Canvas.git upstream
# 只取 ai-canvas-codex-plugin/packages/canvas-app/
cp -r upstream/ai-canvas-codex-plugin/packages/canvas-app ./app
cp -r upstream/ai-canvas-codex-plugin/packages/mcp-server ./mcp-server
cp -r upstream/ai-canvas-codex-plugin/packages/shared ./shared
rm -rf upstream
```

#### 0.2 Rust 端：管理画布服务生命周期

在 `src-tauri/src/commands/` 新增 `canvas.rs`（≈80行）：

```rust
// 功能：
// - start_canvas_server(project_dir: String) -> u16  // 返回端口号
// - stop_canvas_server()
// - canvas_server_status() -> bool
//
// 实现：
// - tokio::process::Command 启动 node canvas/app/dist/server/server.js
// - 端口用 43218（与 AI-Canvas 一致）
// - 健康检查 GET http://127.0.0.1:{port}/api/health
// - 进程管理：存储 Child handle，drop 时 kill
// - 数据目录：{project_dir}/.ai-canvas/
```

在 `lib.rs` 注册命令：
```rust
mod commands;
// ... 现有 ...
pub mod canvas;  // 新增
```

在 `capabilities/default.json` 加权限：
```json
"shell:allow-execute",
"shell:allow-spawn"
```

#### 0.3 ActivityRail 加画布按钮

`src/components/rail/ActivityRail.vue`：

```diff
  const allTabs = [
+   { key: 'canvas',        icon: 'palette',                labelKey: 'rail.canvas' },
    { key: 'skills',         icon: 'paid',                   labelKey: 'rail.skillsManage' },
    ...
  ]
```

同时在 `src/i18n/index.ts` 加翻译：
```ts
'rail.canvas': { zh: '画布', en: 'Canvas' },
```

⚠️ 手机端（`isMobile`）不显示画布按钮——画布是桌面端专属功能。

#### 0.4 WorkspaceLayout 第四列加画布容器

`src/layouts/WorkspaceLayout.vue`：

```diff
  const canvasEnabled = ref(false) // 画布已移除，始终禁用
+ const canvasEnabled = ref(true)  // 画布回归

  const rightPanel = ref<string>('settings')
+ const canvasUrl = ref('')        // 画布服务 URL

  // 在 onRailSwitch 中：
  function onRailSwitch(mode: string) {
    ...
+   if (mode === 'canvas') {
+     toggleRightPanel('canvas')
+     return
+   }
  }
```

模板中加画布 panel：
```html
<!-- 画布 -->
<div v-else-if="rightPanel === 'canvas' && canvasEnabled" class="ws-canvas-container">
  <iframe
    v-if="canvasUrl"
    :src="canvasUrl"
    class="ws-canvas-iframe"
    allow="clipboard-read; clipboard-write"
    sandbox="allow-scripts allow-same-origin allow-forms"
  />
  <div v-else class="ws-canvas-loading">
    <JcIcon name="sync" /> 画布启动中...
  </div>
</div>
```

#### 0.5 画布启动流程

```
用户点画布按钮
  → toggleRightPanel('canvas')
  → WorkspaceLayout watch rightPanel === 'canvas'
  → invoke('start_canvas_server', { projectDir })
  → Rust 启动 node 进程，等待健康检查
  → 返回端口号 → canvasUrl = 'http://127.0.0.1:{port}'
  → iframe 加载画布
```

### Phase 1：编辑功能移植（预计 3-5 天）

从 codex-canvas 移植以下功能到 tldraw 画布：

```
步骤 1.1：Quick Edit — 箭头标注修图
步骤 1.2：Remove BG — 一键去背景
步骤 1.3：Expand — 扩图/outpaint
步骤 1.4：Edit Text — OCR 识别+文字改写
步骤 1.5：Edit Elements — 图层分离+PSD导出
```

**每项功能的结构**：
```
canvas/app/src/
├── components/
│   ├── QuickEditTool.tsx      # 箭头+画笔+文字标注工具
│   ├── RemoveBgTool.tsx       # 去背景按钮+结果展示
│   ├── ExpandTool.tsx         # 扩图画框+比例预设
│   ├── EditTextTool.tsx       # OCR 文字列表+改写
│   └── EditElementsTool.tsx   # 图层分离+PSD导出
├── tools/                     # tldraw 自定义工具注册
└── mcp/                       # MCP tool 定义（给 Agent 调用）
    └── canvas-tools.ts        # edit_image, remove_bg, expand_image 等
```

**关键技术点**：
- Quick Edit 的标注数据 → MCP tool `edit_image` → OpenCode Agent → GPT-image-2 / RH 图片模型
- Remove BG → 调 RH 去背景模型 或 `rembg` Python 库（codex-canvas 用 Python）
- Expand → 调图片生成模型做 outpainting
- Edit Text → `tesseract.js` (浏览器端 OCR) 或调 GPT-4V 识别
- Edit Elements → GPT-image-2 分割 + tldraw 图层管理

### Phase 2：Skill 面板（预计 2-3 天）

移植 AI-Canvas 的 6 个 Skill 面板：

```
步骤 2.1：Skill 面板框架（分类+表单+提交）
步骤 2.2：小红书封面 Skill
步骤 2.3：产品营销组图 Skill
步骤 2.4：Logo 与品牌 Skill
步骤 2.5：营销宣传册 + 跨平台适配 Skill
步骤 2.6：Skill 结果回写画布
```

**Skill 面板数据流**：
```
用户选图片 → 开 Skill 面板 → 填参数 → 点「提交生成」
  → MCP tool skill_generate(skillType, params, imageRef)
  → OpenCode Agent 构造生成 prompt
  → NewAPI/RH 生成图片
  → 结果回写画布（原图右侧）
```

### Phase 3：MCP 通信层（预计 1-2 天）

```
步骤 3.1：画布 MCP Server 定义 tools
步骤 3.2：OpenCode Agent 集成（MCP client 连接画布 server）
步骤 3.3：双向通信（Agent → 画布 推送结果，画布 → Agent 提交任务）
步骤 3.4：错误处理 + 超时 + 重试
```

**MCP Tools**（画布暴露给 Agent）：
| Tool | 输入 | 输出 |
|------|------|------|
| `canvas_edit_image` | imageRef + annotations[] | 新图片 URL |
| `canvas_remove_bg` | imageRef | 透明背景图 URL |
| `canvas_expand_image` | imageRef + targetRatio | 扩图结果 URL |
| `canvas_edit_text` | imageRef + textChanges[] | 改文字后的图片 |
| `canvas_separate_layers` | imageRef | 图层分离结果 + PSD |
| `canvas_skill_generate` | skillType + params + imageRef | 生成结果图片数组 |
| `canvas_list_images` | — | 画布上所有图片引用 |
| `canvas_get_annotations` | imageRef | 图片上的标注数据 |

### Phase 4：打磨（预计 1-2 天）

```
步骤 4.1：画布数据持久化（.jiucaihezi/canvas/{project}/）
步骤 4.2：画布与创作面板联动（创作产出自动入画布）
步骤 4.3：暗色模式适配
步骤 4.4：右键菜单 + 快捷键
步骤 4.5：画布会话隔离（不同 OpenCode session 不同画布）
```

---

## 四、文件变更清单

### 新增文件

```
canvas/                          # 画布子系统
├── app/                         # tldraw 画布前端（AI-Canvas 移植）
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx              # 主入口
│   │   ├── components/          # 编辑工具组件
│   │   │   ├── QuickEditTool.tsx
│   │   │   ├── RemoveBgTool.tsx
│   │   │   ├── ExpandTool.tsx
│   │   │   ├── EditTextTool.tsx
│   │   │   └── EditElementsTool.tsx
│   │   ├── skills/              # Skill 面板
│   │   │   ├── SkillPanel.tsx
│   │   │   ├── XiaohongshuCover.tsx
│   │   │   ├── ProductMarketing.tsx
│   │   │   ├── LogoBrand.tsx
│   │   │   └── CrossPlatform.tsx
│   │   └── mcp/                 # MCP client（连 Agent）
│   │       └── bridge.ts
│   └── server/                  # Express 服务端
│       └── server.js
├── mcp-server/                  # MCP Server（AI-Canvas 移植）
│   ├── package.json
│   └── src/
│       └── index.ts             # MCP tools 定义
└── shared/                      # 共享类型（AI-Canvas 移植）
    └── types.ts

src-tauri/src/commands/canvas.rs # Rust 画布服务管理

docs/sdd/canvas-integration-sdd.md  # 本文档
```

### 修改文件

```
src/components/rail/ActivityRail.vue     # +1 画布按钮
src/layouts/WorkspaceLayout.vue           # +画布 panel + iframe
src/i18n/index.ts                         # +画布翻译
src-tauri/src/lib.rs                      # +canvas 命令注册
src-tauri/capabilities/default.json       # +shell 权限
```

---

## 五、风险与未知

| 风险 | 等级 | 缓解 |
|------|------|------|
| tldraw 许可证 | 低 | MIT，商用友好 |
| AI-Canvas tldraw 版本兼容 | 中 | 锁定版本，不追新 |
| Node.js 进程管理稳定性 | 中 | 健康检查 + 自动重启 + 看门狗 |
| iframe 跨域通信 | 低 | 同源 127.0.0.1，postMessage 备用 |
| MCP 协议版本对齐 | 中 | 对照 OpenCode MCP 实现 |
| Edit Elements PSD 导出 | 高 | 可能太重，先跳过，Phase 1 末尾评估 |
| OCR（Edit Text）依赖 | 中 | tesseract.js WASM 或回退 GPT-4V |
| 画布性能（大量图片） | 低 | tldraw 虚拟化渲染，无限画布 |

---

## 六、与旧画布的关系

AGENTS.md 提到 `_canvas-archive/`——上次画布尝试已归档。旧画布的问题（据推测）：
- 可能是自研画布引擎，太重
- 没有 MCP/Plugin 标准接口
- 与创作面板割裂

**这次的核心不同**：
1. 不自己写画布引擎 → 用 tldraw（成熟开源）
2. 不走自创协议 → 用 MCP 标准（与 OpenCode Agent 通信）
3. 不独立于产品 → 嵌入第四列，与创作面板互补
4. 不重复造轮子 → 融合两个成熟开源项目的代码

---

## 七、启动命令

```bash
# 1. 建分支
git checkout 0710-xiubug
git checkout -b 0711-canvas

# 2. 初始提交（本文档）
git add docs/sdd/canvas-integration-sdd.md
git commit -m "docs: 画布支线交接文档"

# 3. Phase 0 开始
mkdir -p canvas/
# ... 按 Phase 0 步骤执行
```

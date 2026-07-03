# 火宝移植 — 白话版（给老板看）

---

## 一句话总结

把火宝的画布完整搬进韭菜盒子。火宝的 UI + 交互全部保留，但背后的 API、模型、存储全部换成我们的。

---

## 我的做法：不是一行一行抄，是「搬房子换水电」

火宝 = 一套精装修房子（UI漂亮、交互好）
我们 = 自己的水电系统（NewAPI、agentStore、mediaTaskStore）

**做法**：
1. 把火宝的每个房间（节点组件）搬过来
2. 把它的水电（axios、modelStore.js）掐掉
3. 接上我们的水电（gatewayFetch、agentStore）

这样房子还是那个漂亮房子，但里面跑的是我们的系统。

---

## 11 步移植清单（按顺序）

### 第 1 步：搬「NodeHandleMenu」——节点悬浮 + 号菜单
**是什么**：鼠标移到节点上，右边冒出一个 + 按钮。点了 + 弹出菜单：「生图」「生视频」「建文本」。
**为什么先搬它**：后面所有节点都要用到这个菜单。
**怎么搬**：文件直接拷过来，改几行 CSS（火宝用 Tailwind，我们没用），改成我们的颜色变量。
**时间**：30 分钟。

### 第 2 步：搬「TextNode」——文本输入节点
**是什么**：画布上可以打字的节点。
**为什么第二个搬**：这是最简单的节点，搬它验证整个流程跑通。
**怎么搬**：火宝的 TextNode 拷过来 → 替换它的 API 调用 → 类型检查 → 浏览器验证。
**时间**：45 分钟。

### 第 3 步：搬三个边组件
**是什么**：节点之间的连线。火宝有 3 种特殊连线：
- `PromptOrderEdge` — 标记提示词执行顺序
- `ImageRoleEdge` — 标记图片是首帧还是尾帧（图生视频用）
- `ImageOrderEdge` — 标记参考图顺序
**为什么现在搬**：后面的节点（生视频、生图）需要这些边。
**时间**：30 分钟。

### 第 4 步：搬「LLMConfigNode」—— AI 文本生成节点（最核心）
**是什么**：这是火宝最漂亮、最复杂的节点。有 5 个 Tab、模型选择、system prompt 输入框、执行按钮、输出预览、拆分按钮。
**为什么核心**：它的功能 = 我们的对话框功能。这个搬好了，其他都简单。
**怎么搬**：
- 搬 UI 和交互（完全保留）
- 掐掉它的 axios → 接我们的 `gatewayFetch()`
- 掐掉它的 modelStore.js → 接我们的 `agentStore.textModels`
- 新增：支持 Skill 注入（火宝没有这功能）
- 新增：支持图片输入（接 ImageNode 的连线）
**时间**：2 小时。

### 第 5 步：搬「ImageConfigNode」——生图配置节点
**是什么**：选模型、选比例、选尺寸、输入提示词、点生成。
**怎么搬**：搬 UI → 掐掉它的 useImageGeneration.js → 接我们的 `media-generation.ts` 的 `generateImage()`。
**时间**：1 小时。

### 第 6 步：搬「ImageNode」——图片结果展示节点
**是什么**：显示生成的图片，支持右键菜单（图生图、图生视频）。
**怎么搬**：直接搬，改 CSS。
**时间**：30 分钟。

### 第 7 步：搬「VideoConfigNode」——视频生成配置节点
**是什么**：和生图类似，多了首帧/尾帧设置（图生视频）。
**怎么搬**：搬 UI → 接 `generateVideo()` → 保留火宝的 ImageRoleEdge 逻辑。
**时间**：1 小时。

### 第 8 步：搬「VideoNode」——视频结果展示节点
**直接搬**：30 分钟。

### 第 9 步：集成主画布
**是什么**：把搬好的所有节点注册到我们的 `CanvasWorkspace.vue`，让画布能拖出这些节点。
**怎么集成**：在 CanvasWorkspace 里 import 新节点 → 注册到 nodeTypes → 浏览器验证。
**时间**：1 小时。

### 第 10 步：Store 桥接 + API 替换
**做什么**：
- 火宝的 `stores/canvas.js` → 合入我们的 `canvasStore.ts`（主要是 addNode、removeNode、updateNode 这些基础操作）
- 火宝的 `stores/models.js` → 桥接到我们的 `agentStore`（模型列表、模型选择）
- 火宝的 API 调用 → 全部换成我们的 `gatewayFetch()` 和 `media-generation.ts`
**时间**：2 小时。

### 第 11 步：保留节点集成
**做什么**：我们独有的节点（Skill 节点、Toolset 节点、31 个 T8 节点）和新搬来的火宝节点共存。
**怎么做到**：我们的 `CanvasNodeType` 已经包含了所有类型。火宝节点注册时用火宝的类型名，我们的节点用我们的。
**时间**：1 小时。

---

## 怎么融合：两套系统共存

| | 火宝 | 我们 | 融合后 |
|---|------|------|--------|
| 节点 UI | 火宝的漂亮组件 | 我们的旧 V8 组件 | **全用火宝的** |
| 模型选择 | modelStore.js | agentStore | **用我们的 agentStore** |
| API 调用 | axios | gatewayFetch | **用我们的 gatewayFetch** |
| 图片生成 | useImageGeneration.js | media-generation.ts | **用我们的 generateImage()** |
| 画布状态 | canvas.js (JS) | canvasStore.ts (TS) | **合二为一，保留我们的 TypeScript 类型** |
| Skill 功能 | ❌ 没有 | V8SkillNode | **保留，新加到火宝画布里** |
| Toolset 功能 | ❌ 没有 | V8ToolsetNode | **保留** |
| 项目管理 | projects.js (localStorage) | idb.ts (SQLite) | **用我们的 idb.ts** |

---

## 怎么保证搬得彻底

每搬完一个组件，立刻做三件事：
1. `npx vue-tsc -b` — 类型检查零错误
2. `npx vite build` — 打包通过
3. 浏览器打开 `pnpm dev`，拖节点进去，点执行，看结果

任何一步不通过，立刻回退那一个文件，不影响已经搬好的。

**全部搬完的标志**：
- 浏览器打开 → 左侧点画布 → 能拖出 TextNode、LLMNode、ImageGenNode、VideoGenNode
- 每个节点看起来和火宝一模一样
- 点 LLM 节点的执行按钮 → 能调通 NewAPI → 流式输出文字
- 点 ImageGen 的执行 → 能调通 NewAPI → 图片出来

---

## Q&A

**Q: 火宝用 Tailwind CSS，我们没有，怎么办？**
A: 一对一替换。`bg-[var(--bg-secondary)]` 换成 `background: var(--surface-alt)`。火宝的 Tailwind class 就十几个，花不了多少时间。

**Q: 火宝用 NaiveUI 组件库，我们没有，怎么办？**
A: 不用。`<n-select>` 换成 `<select>`，`<n-icon>` 换成 `<span class="mso">icon_name</span>`。功能不变，样子差点但能用。

**Q: 火宝的 store 和我们不一样，怎么合？**
A: 不合并。火宝的 store 文件搬过来当参考，功能一个一个嫁接到我们的 store 里。比如火宝的 `addNode` 逻辑嫁接到我们的 `canvasStore.addNodeWithData`。

**Q: 搬完之后老节点还在吗？**
A: 在。火宝替换的是 V8 节点（TextNode、LLMNode、ImageGenNode 等）。老的 T8 节点（upload、resize、combine 等 31 个）原封不动。

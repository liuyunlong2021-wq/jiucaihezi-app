# 画布系统交接方案

> **写给接手此系统的 AI 工具（或开发者）**
> 不包含任何指导或建议。只描述现状——文件、代码、工作状态。
> 日期：2026-07-12 | 分支：`0711-canvas`

---

## 一、文件清单

| 文件 | 绝对路径 | 行数 | 角色 |
|------|----------|------|------|
| 画布壳 | `src/components/creation/CreationPanel.vue` | ~1780 | 唯一实现文件。引擎初始化、工具栏、键盘、右键菜单、持久化、事件监听、拖放，全在这一个文件里 |
| Pinia store | `src/components/canvas/canvasStore.ts` | 65 | 纯数据状态（layers, annotations, viewport），不存 DOM 绑定 |
| 持久化 | `src/components/canvas/canvasPersistence.ts` | 68 | JSON 读写。桌面端写盘，Web 端 localStorage |
| 类型定义 | `src/types/canvas.ts` | 49 | CanvasLayer / CanvasAnnotation / CanvasDocument |
| SDD | `docs/sdd/canvas-sdd.md` | ~498 | 设计方案，部分过期 |
| 引擎裁决 | `docs/sdd/canvas-engine-verdict.md` | ~200 | 为什么选 LeaferJS |
| API 审计 | `docs/sdd/canvas-leaferjs-audit-v2.md` | ~100 | 61 项官方 API vs 实际实现对照 |
| 官方 UI 源码 | `/Users/by3/Documents/leaferjs-ui/` | — | 克隆的 LeaferJS 核心引擎源码 |
| 官方插件源码 | `/Users/by3/Documents/leaferjs-leafer-in/` | — | 克隆的 @leafer-in/* 插件源码 |

---

## 二、技术栈

### 运行时

- **LeaferJS v2.2.0**：TypeScript 100%、MIT、70KB、中文。`leafer-ui` + `@leafer-in/*`
- **Vue 3** / Pinia / TypeScript / Vite
- **Tauri v2**：桌面端用 `dev_read_file` / `dev_write_file_bytes` IPC 读盘写盘
- **@iconify/vue**：Material Symbols 图标，`src/assets/icons-bundle.json` 离线打包

### 已安装的 17 个 LeaferJS 插件

全部在 `CreationPanel.vue` 第 10-32 行 import：

```
@leafer-in/editor       — 图形编辑器：选中/旋转/缩放/框选/编组
@leafer-in/viewport     — 无限视窗：滚轮缩放 + 拖拽平移
@leafer-in/resize       — Editor 依赖
@leafer-in/arrow        — 箭头元素（Arrow 类，endArrow/startArrow/points 等）
@leafer-in/text-editor  — 文字编辑器：双击 Text 元素弹出 contentEditable div
@leafer-in/export       — SVG/PNG 导出（已导入，未暴露 UI）
@leafer-in/scroll       — 滚动条
@leafer-in/state        — 交互状态
@leafer-in/find         — 查找元素
@leafer-in/animate      — 动画
@leafer-in/flow         — 自动布局
@leafer-in/html         — HTML 嵌入
@leafer-in/motion-path  — 运动路径
@leafer-in/filter       — 滤镜
@leafer-in/color        — 颜色工具
@leafer-in/bright       — 突出显示
@leafer-in/scale-fixed  — 固定比例
@leafer-in/box          — Box 元素增强
@leafer-in/corner       — 路径圆角
@leafer-in/view         — View 插件
```

---

## 三、代码架构

### 3.1 App 实例

```typescript
let app: App | null = null  // 第 345 行，非响应式，模块级 let

// 第 567 行 onMounted 中初始化：
app = new App({
  view: canvasContainer.value,  // ref<HTMLDivElement>
  editor: {},                    // 自动创建 app.editor, tree, sky
  fill: getCanvasFill(),         // CSS 变量 --surface
})
```

App 结构：
- `app.tree` — 内容层，所有用户元素（图片、文字、箭头）放这里
- `app.sky` — 编辑器覆盖层（选框、控制点、editMask）
- `app.editor` — Editor 实例，API: `select()`, `cancel()`, `group()`, `ungroup()`, `lock()`, `unlock()`, `toTop()`, `toBottom()`, `openInnerEditor()`, `closeInnerEditor()`
- `app.mode` — `'normal'` 或 `'draw'`（控制编辑器行为）
- `app.zoomLayer` — 视口缩放层

### 3.2 状态变量（第 335-350 行）

```typescript
const canvasContainer = ref<HTMLDivElement>()     // DOM 容器
const canvasDragOver = ref(false)                 // 拖拽高亮
const showCanvasMore = ref(false)                 // 声明但未使用
const showTaskHistory = ref(false)                // 历史 Modal
const drawMode = ref(false)                       // 是否在绘制模式
const drawType = ref<'arrow' | 'text'>('arrow')   // 绘制类型
const activeDrawType = ref<'arrow' | 'text' | null>(null)  // 当前激活工具（切换防抖用）
const ctxMenu = ref({ show: false, x: 0, y: 0 }) // 右键菜单
let app: App | null = null
const clipboard: any[] = []                       // 复制粘贴
let textEditTimer: ReturnType<typeof setTimeout> | null = null
const canvasCleanups: (() => void)[] = []         // onBeforeUnmount 清理
```

### 3.3 工具栏 HTML（第 839-861 行）

**布局**：`position: absolute; top: 6px; right: 6px; flex-direction: column; gap: 4px`
即画布右上角单列纵向排列。

**17 个按钮 + 5 个分隔线**，从上到下的顺序：

```
1. 画箭头 (arrow_forward)      ← 有 :class="{ active: ... }" 高亮
2. 写文字 (title)              ← 有 :class="{ active: ... }" 高亮
--- cp-toolbar-sep ---
3. 撤销 (undo) Ctrl+Z
4. 重做 (redo) Ctrl+Shift+Z
--- cp-toolbar-sep ---
5. 复制 (content_copy) Ctrl+C
6. 粘贴 (note_add) Ctrl+V
7. 删除 (delete) Delete
--- cp-toolbar-sep ---
8. 编组 (group_add) Ctrl+G
9. 解组 (call_split) Ctrl+Shift+G
10. 锁定 (lock) Ctrl+L
11. 解锁 (toggle_off) Ctrl+Shift+L
--- cp-toolbar-sep ---
12. 置顶 (arrow_upward) Ctrl+]
13. 置底 (arrow_downward) Ctrl+[
--- cp-toolbar-sep ---
14. 适应窗口 (fit_screen)
15. 放大 (zoom_in)
16. 缩小 (zoom_out)
```

每个按钮 CSS：`width: 30px; height: 30px; border-radius: 6px;`
分隔线 CSS：`width: 1px; height: 20px; background: var(--line); margin: 0 2px;`
工具栏总高度 ≈ 17×34 + 5×24 = 698px（非常高）

**已知问题**：`cp-toolbar-sep` 的 `width: 1px` 在 `flex-direction: column` 下无意义（应该是 `height: 1px; width: auto` 或改为横线）。目前分隔线可能不可见。

### 3.4 右键菜单 HTML（第 863-882 行）

Teleport 到 `<body>`，`position: fixed`。13 个按钮 + 4 个 `<hr>` 分隔线。
每个按钮同时执行 `canvasTool('xxx'); ctxMenu.show = false`。
关联状态：`ctxMenu = ref({ show: false, x: 0, y: 0 })`。
菜单在 `PointerEvent.MENU` 事件触发时显示（第 575 行注册）。

### 3.5 `canvasTool(action)` 函数（第 478-566 行）

所有画布操作的总入口。switch/case 结构，支持 16 种 action：

| action | 实现方式 | 状态 |
|--------|---------|------|
| `'delete'` | `app.editor.list.forEach(el => el.remove())` | 可用 |
| `'fit'` | 计算所有子元素包围盒 → 调整 zoomLayer | 可用 |
| `'draw'` | 见下方详细分析 | 部分可用 |
| `'zoomIn'` | `zoomLayer.scale *= 1.3` | 可用 |
| `'zoomOut'` | `zoomLayer.scale /= 1.3` | 可用 |
| `'group'` | `app.editor.group()`（需 ≥2 选中） | 未实测 |
| `'ungroup'` | `app.editor.ungroup()` | 未实测 |
| `'lock'` | `app.editor.lock()` | 未实测 |
| `'unlock'` | `app.editor.unlock()` | 未实测 |
| `'toFront'` | `app.editor.toTop()` | 未实测 |
| `'toBack'` | `app.editor.toBottom()` | 未实测 |
| `'copy'` | `clipboard.push(el)` 存引用 | 未实测 |
| `'paste'` | `src.clone()` + offset(20,20) + `app.tree.add()` | 未实测 |
| `'undo'` | `(app.editor as any)?.undo?.()` | 不稳定 |
| `'redo'` | `(app.editor as any)?.redo?.()` | 不稳定 |

**`case 'draw'` 详细流程**（第 509-566 行）：

```
1. 清理旧模式：
   - 遍历 app.__drawCleanups，逐个 off_ 移除监听器
   - app.mode = 'normal'
   - clearTimeout(textEditTimer)

2. 同工具判断：
   sameTool = drawMode.value && activeDrawType.value === drawType.value
   drawMode.value = sameTool ? false : true
   activeDrawType.value = drawMode.value ? drawType.value : null
   → 同工具点两次 = 关闭；不同工具 = 切换（保持激活）

3. 进入绘制模式：
   app.mode = 'draw'

4. 注册 DragEvent 监听器（存入 app.__drawCleanups）：
   - DragEvent.START → onStart
   - DragEvent.DRAG → onDrag
   - DragEvent.END → onEnd

5. 文字工具 onStart：
   - new LeaferText({ x: e.x, y: e.y, editable: true, fill: '#333', fontSize: 18, text: '', padding: [4, 8] })
   - app.tree.add(text)
   - app.mode = 'normal'（立即退出绘制模式）
   - drawMode.value = false; activeDrawType.value = null
   - 清理监听器
   - setTimeout(50ms) → app.editor.select(text); app.editor.openInnerEditor(text)

6. 箭头工具 onStart：
   - new Arrow({ editable: true, stroke: '#e74c3c', strokeWidth: 3, endArrow: 'arrow', strokeCap: 'round' })
   - app.tree.add(arrow)

7. 箭头工具 onDrag：
   - 用 e.getPagePoint() 和 e.getPageTotal() 计算 signed 偏移
   - drawing.toPoint = { x: total.x, y: total.y }（四方向支持）
```

### 3.6 键盘快捷键（第 595-619 行）

`document.addEventListener('keydown', onKeyDown)`，全局监听，但有输入框守卫：

```typescript
const inCanvas = canvasContainer.value?.contains(el)
const inInput = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
if (inInput && !inCanvas) return  // 不在画布区域的输入框里，不处理
```

支持的快捷键：

| 按键 | 操作 | 备注 |
|------|------|------|
| Delete / Backspace | 删除选中 | `el.remove()` |
| Ctrl+Z | 撤销 | `(app.editor as any)?.undo?.()` |
| Ctrl+Shift+Z | 重做 | `(app.editor as any)?.redo?.()` |
| Ctrl+G | 编组 | 需选中 ≥2 |
| Ctrl+Shift+G | 解组 | |
| Ctrl+L | 锁定 | |
| Ctrl+Shift+L | 解锁 | |
| Ctrl+] | 置顶 | |
| Ctrl+[ | 置底 | |
| Ctrl+C | 复制 | 存元素引用到 clipboard 数组 |
| Ctrl+V | 粘贴 | `src.clone()` + offset |

### 3.7 图片入画布（第 123-175 行）

`addImageToCanvas(filePath)`：
1. 判断是否 Tauri 运行时 + 本地绝对路径
2. 是 → `invoke('dev_read_file', { root, relativePath, maxBytes: 20_000_000 })` → base64 data URL
3. 否 → 直接用 filePath
4. `new Image({ url, editable: true, x: 100+random*200, y: 100+random*200 })` → `app.tree.add(img)`
5. 监听 `error` 事件 → `img.remove()`

调用来源：
- `offCanvasSync`：监听 `media-task-settled` 事件（创作面板生成完成）
- `offFileTreeImage`：监听 `canvas:add-image` 事件（文件树右键）
- `onCanvasDrop`：拖放文件到画布
- `onMounted`：恢复持久化时重建图层

### 3.8 持久化（`canvasPersistence.ts`）

- 保存：`saveCanvas(doc)` → 桌面端写 `{projectDir}/.jiucaihezi/canvas/{canvasId}.json`，Web 端写 localStorage
- 恢复：`restoreCanvas(canvasId)` → 优先读文件，降级到 localStorage
- 自动保存：debounce 2s，watch `canvasStore.layers.length`
- 最终保存：`onBeforeUnmount` 中调用

### 3.9 canvasStore（`canvasStore.ts`）

Pinia store，纯数据：
- `layers: CanvasLayer[]` — 图层列表
- `annotations: CanvasAnnotation[]` — 标注列表（类型定义存在，代码中未实际使用）
- `canvasId: 'default'` — 硬编码
- `viewport: { x: 0, y: 0, zoom: 1 }` — 声明但未与 LeayerJS zoomLayer 同步
- `addLayer()`, `removeLayer()`, `updateLayerPosition()`, `updateLayerSize()`
- `getCanvasDoc()`, `loadCanvasDoc()`

---

## 四、实际工作状态

### ✅ 明确可用的

| 功能 | 细节 |
|------|------|
| 画布渲染 | LeaferJS App 正常挂载，17 个插件加载 |
| 编辑器选中/拖动/缩放/旋转 | Editor 插件原生能力，选中元素后出现控制点 |
| 框选 | Editor 原生 |
| 视口缩放/平移 | Viewport 插件，滚轮缩放 + 拖拽平移 |
| 图片入画布 | 从文件树右键 / 拖放 / 生成完成 |
| 适应窗口 (fit) | 正常 |
| 放大/缩小 | 1.3x 倍率 |
| Delete 键删除 | 正常 |
| 箭头绘制 | 四方向支持，endArrow: 'arrow'，红色 3px |
| 持久化 | 桌面端写 `.jiucaihezi/canvas/`，Web 端 localStorage |
| 主题同步 | MutationObserver 监听 data-theme |

### ⚠️ 部分可用 / 未充分测试

| 功能 | 状态 |
|------|------|
| 文字工具 | 点击创建 Text → 50ms 后调用 openInnerEditor。文本编辑器是否弹出取决于 text-editor 插件是否正确激活。text: '' 空字符串意味着创建时不可见 |
| Ctrl+Z 撤销 | `(app.editor as any)?.undo?.()` — 使用了 any 类型强制调用。Editor 类没有公开的 undo() 方法，只有内部的 TransformTool 可能有 |
| 复制粘贴 | clipboard 存原始元素引用，paste 时 `src.clone()`。未测试：clone() 是否对所有元素类型有效 |
| 编组/解组/锁定/解锁/置顶/置底 | API 调用正确，但未在真实场景中验证 |
| 右键菜单 | 监听 PointerEvent.MENU，菜单 HTML 正常渲染。但菜单位置使用 `e.x + rect.left` 计算，可能受 viewport 缩放影响 |

### ❌ 明确不可用或存在问题的

| 问题 | 描述 |
|------|------|
| 工具栏布局 | 17 个按钮纵向排成 ~700px 高的列。分隔线 `width: 1px` 在 column flex 下无效（应该是 height: 1px）。按钮过多，纵向排列可用性差 |
| 文字工具视觉反馈 | 创建 Text 时 `text: ''`，元素不可见。50ms 后才尝试打开编辑器。如果 openInnerEditor 失败，文字元素看不见也选不中 |
| undo/redo API | Editor 类没有公开的 `undo()` 方法。当前用 any 强转调用，可能不存在或签名不对 |
| 图标 | 部分图标名（arrow_forward, fit_screen, zoom_in, zoom_out, title）不在离线 bundle 中，依赖 Iconify 运行时网络加载。线上环境 CSP 可能阻止 |
| 复制粘贴 | clipboard 存原始元素引用，如果原元素被删除，paste 会 clone 一个已删除的元素 |
| canvasStore.viewport | 声明了但未与 LeaferJS 的 zoomLayer 状态同步。恢复画布时 viewport 不被还原 |
| annotations 类型 | CanvasAnnotation 类型定义存在，但代码中从未创建或使用 |
| 画布初始化竞态 | `onMounted` 中有多个异步操作（恢复持久化、消费 pending event），但它们之间没有顺序保证 |

---

## 五、关键 API 模式

### 5.1 LeaferJS 事件系统

```typescript
// 注册：on_ 返回 IEventListenerId
const id = app.on_(LeaferDragEvent.START, handler)

// 注销：off_ 接受 IEventListenerId（不是回调函数！）
app.off_(id)

// ❌ 错误：off_ 不能传两个参数
app.off_(LeaferDragEvent.START, handler)  // 编译错误

// PointerEvent.MENU 是右键事件
app.on_(PointerEvent.MENU, handler)
```

### 5.2 getPageBounds() vs getPageTotal()

```typescript
// getPageBounds() — width/height 永远是正数（内部调了 BoundsHelper.unsign）
// 适合 Rect，不适合 Arrow（箭头只能用右下方向）
const { x, y, width, height } = e.getPageBounds()

// getPagePoint() + getPageTotal() — signed 偏移
// 适合 Arrow，支持四个方向
const start = e.getPagePoint()
const total = e.getPageTotal()
arrow.toPoint = { x: total.x, y: total.y }
```

### 5.3 绘制模式

```typescript
// 进入绘制模式后，Editor 不处理选择/拖动，DragEvent 透传
app.mode = 'draw'

// DragEvent.START — 鼠标按下
// DragEvent.DRAG — 鼠标移动（按住时）
// DragEvent.END — 鼠标释放

// 三个事件的 handler 需要存入 app.__drawCleanups 数组
// 退出时逐个 off_ 清理
```

### 5.4 openInnerEditor

```typescript
// 打开 TextEditor（contentEditable div 覆盖在 Text 元素上）
app.editor.select(textElement)          // 先选中
app.editor.openInnerEditor(textElement) // 再打开内置编辑器
```

### 5.5 Element.clone()

```typescript
// 深克隆一个元素（不加入树）
const clone = sourceElement.clone()
clone.x += 20; clone.y += 20
clone.editable = true
app.tree.add(clone)
```

---

## 六、已知 Bug 清单

这些 Bug 是之前多轮修复中确认过但仍然存在的问题：

1. **工具栏分隔线不可见**：`width: 1px` 在 column flex 中无高度表现
2. **部分图标可能走网络加载**：arrow_forward, fit_screen, zoom_in, zoom_out, title 不在离线 bundle
3. **undo/redo 依赖 any 类型调用**：Editor 类无公开 undo API
4. **粘贴已删除元素**：clipboard 存引用，原元素删除后 clone 可能出错
5. **viewport 未恢复**：canvasStore.viewport 声明但未同步
6. **文字工具创建不可见元素**：`text: ''` + 50ms 延迟打开编辑器，失败时元素丢失
7. **右键菜单位置**：受 viewport 缩放影响，缩放后的坐标系可能不准确

---

## 七、相关文档索引

| 文档 | 路径 |
|------|------|
| 画布 SDD | `docs/sdd/canvas-sdd.md` |
| 引擎选型 | `docs/sdd/canvas-engine-verdict.md` |
| LeaferJS API 审计 | `docs/sdd/canvas-leaferjs-audit-v2.md` |
| SDD 代码审计 | `docs/sdd/canvas-sdd-audit.md` |
| 并发审计 | `memories/repo/canvas-concurrent-audit-2026-07-12.md` |
| LeaferJS UI 源码 | `/Users/by3/Documents/leaferjs-ui/` |
| LeaferJS 插件源码 | `/Users/by3/Documents/leaferjs-leafer-in/` |

---

## 八、AGENTS.md 相关约定

- **铁律 0**：所有代码是 OpenCode Desktop 的 Tauri+Vue 翻译。不自创、不简化、不添加
- **铁律 4**：图标走 `<JcIcon name="xxx">`，新增后跑 `node scripts/bundle-icons.mjs`
- 当前画布系统是**创作面板的一部分**，不是独立面板。代码全部在 `CreationPanel.vue` 中
- 桌面端专属（画布在 Web 端不可用）
- `vue-tsc -b && vite build` 是每次修改后的最低验证标准

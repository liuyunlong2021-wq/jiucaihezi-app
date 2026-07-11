# LeaferJS 官方源码逐行对照审计 v2

> **日期**: 2026-07-11
> **对比源**: https://leaferjs.com/ui/plugin/in/editor/ 官方编辑器示例
> **我们的代码**: `src/components/creation/CreationPanel.vue`

---

## 一、官方基准示例（逐行）

```ts
// #图形编辑器 [简洁创建]
import { App, Rect } from 'leafer-ui'
import '@leafer-in/editor'           // 导入图形编辑器插件
import '@leafer-in/viewport'         // 导入视口插件 (可选)

const app = new App({
    view: window,
    editor: {}                        // 配置 editor 会自动创建 app.editor, tree, sky
})

app.tree.add(Rect.one({ editable: true, fill: '#FEB027' }, 100, 100))
app.tree.add(Rect.one({ editable: true, fill: '#FFE04B' }, 300, 100))
```

---

## 二、逐行对照

| # | 项目 | 官方 | 我们 | 状态 |
|---|------|------|------|------|
| 1 | 核心导入 | `import { App, Rect } from 'leafer-ui'` | `import { App, Image as LeaferImage } from 'leafer-ui'` | ⚠️ 别名叫 `LeaferImage` 而非 `Image` |
| 2 | Editor 导入 | `import '@leafer-in/editor'` | `import '@leafer-in/editor'` | ✅ |
| 3 | Viewport 导入 | `import '@leafer-in/viewport'` | `import '@leafer-in/viewport'` | ✅ |
| 4 | Resize 导入 | 未在示例中，但 Editor 文档要求安装 | `import '@leafer-in/resize'` | ✅ 额外安装的必需依赖 |
| 5 | 引擎创建 | `new App({ view: window, editor: {} })` | `new App({ view: canvasContainer.value, editor: {} })` | ✅ div 引用同效 |
| 6 | fill 背景色 | 未在简洁示例中，其他示例用 `fill: '#333'` | `fill: getCanvasFill()` | ✅ CSS 变量，正确 |
| 7 | 添加元素 | `app.tree.add(Rect.one({ editable: true }, 100, 100))` | `app.tree.add(new Image({ url, editable: true, x, y }))` | ✅ tree.add 正确 |
| 8 | editable 属性 | `editable: true` | `editable: true` | ✅ |
| 9 | 元素销毁 | 官方无显式 destroy 示例 | `app.destroy()` | ✅ App 继承自 Leafer，destroy() 是标准方法 |

---

## 三、Image 元素逐行对照

| # | 项目 | 官方 | 我们 | 状态 |
|---|------|------|------|------|
| 10 | import 名称 | `import { Image } from 'leafer-ui'` | `import { Image as LeaferImage }` | ⚠️ 别名叫 `LeaferImage` |
| 11 | url 属性 | `url: '/image/leafer.jpg'` | `url: base64DataUrl` | ✅ 支持 Data URL |
| 12 | 宽高 | 默认自适应图片原始宽高 | 未设置 width/height（自动） | ✅ |
| 13 | x, y 定位 | 默认 0, 0 | `x: 100+random, y: 100+random` | ✅ 偏移放置避免重叠 |

---

## 四、App 结构对照

| # | 项目 | 官方 | 我们 | 状态 |
|---|------|------|------|------|
| 14 | app.tree | tree 层（主要内容），type: 'design' | `app.tree.add(img)` | ✅ |
| 15 | app.sky | sky 层（编辑器覆盖），auto-created | 未直接使用 | ✅ 自动创建 |
| 16 | app.editor | 编辑器实例 | 未直接使用 | ✅ 自动创建，不需要手动操作 |
| 17 | app.zoomLayer | 视口缩放层 | 未使用 | 🟢 可选，Viewport 导入后自动生效 |
| 18 | app.mode | 'normal' / 'draw' / 'preview' | 未设置（默认 normal） | ✅ |
| 19 | app.ground | 背景层 | 未使用 | 🟢 可选 |

---

## 五、依赖对照

| # | 包 | 官方要求 | 我们 | 状态 |
|---|-----|---------|------|------|
| 20 | leafer-ui | 必需 | ✅ 已安装 | ✅ |
| 21 | @leafer-in/editor | 必需 | ✅ 已安装 | ✅ |
| 22 | @leafer-in/viewport | 可选 | ✅ 已安装 | ✅ |
| 23 | @leafer-in/resize | Editor 必需依赖 | ✅ 已安装 | ✅ |

---

## 六、官方插件（我们未安装的）

这些是官方内置插件（`@leafer-in/*`），我们没有安装。不阻塞，但后续可能需要。

| # | 插件 | npm | 作用 | 我们的需求 |
|---|------|-----|------|-----------|
| 24 | arrow | `@leafer-in/arrow` | 箭头元素 | Phase 1 标注修图 |
| 25 | text-editor | `@leafer-in/text-editor` | 文字编辑器 | Phase 1 文字改写 |
| 26 | export | `@leafer-in/export` | 导出 SVG/PNG | P3 画布导出 |
| 27 | scroll | `@leafer-in/scroll` | 滚动条 | 🟢 可选 |
| 28 | state | `@leafer-in/state` | 交互状态 | 🟢 可选 |
| 29 | find | `@leafer-in/find` | 查找元素 | 🟢 可选 |
| 30 | animate | `@leafer-in/animate` | 动画 | 🟢 可选 |
| 31 | flow | `@leafer-in/flow` | 自动布局 | 🟢 可选 |
| 32 | html | `@leafer-in/html` | HTML 嵌入 | 🟢 可选 |
| 33 | motion-path | `@leafer-in/motion-path` | 运动路径 | 🟢 可选 |
| 34 | filter | `@leafer-in/filter` | 滤镜 | 🟢 可选 |
| 35 | color | `@leafer-in/color` | 颜色工具 | 🟢 可选 |
| 36 | bright | `@leafer-in/bright` | 突出显示 | 🟢 可选 |
| 37 | scale-fixed | `@leafer-in/scale-fixed` | 固定比例 | 🟢 可选 |
| 38 | box | `@leafer-in/box` | Box 元素增强 | 🟢 可选 |
| 39 | corner | `@leafer-in/corner` | 路径圆角 | 🟢 可选 |
| 40 | view | `@leafer-in/view` | 视图控制 | 🟢 可选 |

---

## 七、社区插件（leafer-x-*）

| # | 插件 | 作用 | 我们的需求 |
|---|------|------|-----------|
| 41 | leafer-x-connector | 连线（知识图谱核心） | Phase 2 JSON Canvas |
| 42 | leafer-x-snap | 吸附对齐 | Phase 1 标注工具 |
| 43 | leafer-x-ruler | 标尺 | Phase 1 编辑器增强 |
| 44 | leafer-x-edit-toolbar | 现成编辑工具栏 | Phase 1 工具栏 |
| 45 | leafer-x-dot-matrix | 点阵背景（透明画布） | 🟢 视觉效果 |
| 46 | leafer-vue | Vue 3 组件封装 | 🟢 简化 Vue 集成 |
| 47 | leafer-x-tooltip | 提示框 | 🟢 可选 |

---

## 八、Image API 我们没用到的

| # | 属性/方法 | 官方说明 | 我们 | 状态 |
|---|----------|---------|------|------|
| 48 | `pixelRatio` | 高清屏适配 | 未设置 | 🟢 可选 |
| 49 | `lazy` | 懒加载 | 未设置 | 🟢 可选 |
| 50 | `placeholderColor` | 加载中占位色 | 未设置 | 🟢 可选 |
| 51 | `ready` | 加载完成状态（只读） | 未监听 | 🟢 可选 |
| 52 | `ImageEvent.LOADED` | 图片加载成功事件 | 未监听 | 🟢 可选 |
| 53 | `ImageEvent.ERROR` | 图片加载失败事件 | 未监听 | 🟡 建议加 |
| 54 | `Resource.loadImage()` | 预加载图片 | 未使用 | 🟢 可选 |
| 55 | `Platform.image.crossOrigin` | 跨域配置 | 未设置 | 🟡 data URL 无所谓，远程 URL 可能需要 |

---

## 九、App API 我们没用到的

| # | API | 官方说明 | 我们 | 状态 |
|---|-----|---------|------|------|
| 56 | `app.zoomLayer` | 缩放层，可程序化控制缩放 | 未使用 | 🟢 可选 |
| 57 | `app.editor.select()` | 程序化选中元素 | 未使用 | 🟢 可选 |
| 58 | `app.editor.cancel()` | 取消选中 | 未使用 | 🟢 可选 |
| 59 | `app.editor.group()` | 编组 | 未使用 | 🟢 可选 |
| 60 | `EditorEvent.SELECT` | 选中事件 | 未监听 | 🟢 可选 |
| 61 | `app.on_(...)` / `app.off_(...)` | 应用级事件 | 未使用 | 🟢 可选 |

---

## 十、总结

| 类别 | 数量 | 
|------|------|
| ✅ 已对齐 | 19 项 |
| ⚠️ 有小偏差 | 2 项（Image 别名、fill 方式） |
| 🟢 官方可选，我们没装 | 17 个插件 |
| 🟡 建议后续加 | 2 项（ImageEvent.ERROR + Platform.image.crossOrigin） |

### 当前唯一需要修的小偏差

| # | 问题 | 修复 |
|---|------|------|
| 1 | `Image as LeaferImage` 别名 | 改为直接 `import { Image } from 'leafer-ui'`，代码中 `new Image(...)`。TypeScript 环境下 import 会覆盖全局 `Image`。 |

### 不需要动的

- App / tree.add / editor: {} / Viewport / Resize — 全部对齐官方
- fill 用 CSS 变量 — 官方不支持但这是我们的功能需求，不影响引擎
- x/y 偏移放置 — 官方默认 (0,0)，我们加偏移避免重叠，合理

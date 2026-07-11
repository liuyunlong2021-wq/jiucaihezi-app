# LeaferJS 官方对照审计

> **日期**: 2026-07-11
> **对比源**: [leaferjs.com 官方文档](https://leaferjs.com/ui/plugin/in/editor/) + [GitHub 示例](https://github.com/leaferjs/ai-docs)

---

## 🔴 阻塞问题（必须修）

| # | 问题 | 我们的代码 | 官方正确做法 | 影响 |
|---|------|-----------|-------------|------|
| 1 | **引擎用 Leafer 而非 App** | `new Leafer({ view })` | `new App({ view, editor: {} })` | Editor 不工作，点击无反应 |
| 2 | **Editor 手动 new** | `new Editor({ target: leafer })` | `import '@leafer-in/editor'` + App 的 `editor: {}` 配置自动创建 | 同上 |
| 3 | **元素加到 leafer 上** | `leafer.add(img)` | `app.tree.add(img)` | App 有 tree/sky 分层，元素加错层 |
| 4 | **Viewport 调 addViewport()** | `addViewport(leafer)` | `import '@leafer-in/viewport'`（副作用导入） | 可能不生效 |
| 5 | **缺少 @leafer-in/resize** | 未安装 | Editor 的必需依赖 | Editor 缺少 resize 能力 |

---

## 🟡 遗漏项（Phase 1 应补）

| # | 插件 | 作用 | 优先级 |
|---|------|------|--------|
| 6 | `@leafer-in/arrow` | 箭头元素（标注修图核心） | P1 |
| 7 | `@leafer-in/text-editor` | 文字编辑器（文字改写核心） | P1 |
| 8 | `@leafer-in/export` | 导出 SVG/PNG | P2 |
| 9 | `@leafer-in/scroll` | 滚动条 | P2 |
| 10 | `@leafer-in/find` | 查找元素 | P3 |
| 11 | `@leafer-in/state` | 交互状态（hover/press） | P3 |

---

## 🟢 社区资源（可选集成）

| # | 资源 | 链接 | 作用 |
|---|------|------|------|
| 12 | leafer-vue | https://leafer-vue.netlify.app/ | Vue 3 组件封装 |
| 13 | leafer-x-edit-toolbar | npm | 现成编辑工具栏 |
| 14 | leafer-x-snap | npm | 吸附对齐插件 |
| 15 | leafer-x-ruler | npm | 标尺插件 |
| 16 | leafer-x-connector | npm | 连线插件（知识图谱） |
| 17 | leafer-x-dot-matrix | npm | 点阵背景（透明画布效果） |

---

## 🟢 我们做对的部分

| 项目 | 状态 |
|------|------|
| `import { Leafer, Image } from 'leafer-ui'` | ✅ |
| `editable: true, draggable: true` 属性 | ✅ |
| 图片通过 base64 data URL 加载 | ✅ |
| 主题跟随 CSS 变量 | ✅ |
| MutationObserver 监听主题 | ✅ |
| 生成完成 → 入画布事件流 | ✅ |
| 拖入分流逻辑 | ✅ |
| canvasStore Pinia | ✅ |

---

## 修复方案

**核心改动：`Leafer` → `App`**

```diff
- import { Leafer, Image as LeaferImage } from 'leafer-ui'
- import { Editor } from '@leafer-in/editor'
- import { addViewport } from '@leafer-in/viewport'
+ import { App, Image as LeaferImage } from 'leafer-ui'
+ import '@leafer-in/editor'
+ import '@leafer-in/viewport'

- let leafer: Leafer | null = null
+ let app: App | null = null

  onMounted(() => {
-   leafer = new Leafer({ view: container, type: 'design', fill: ... })
-   new Editor({ target: leafer })
-   addViewport(leafer)
+   app = new App({ view: container, editor: {}, fill: ... })
  })

  function addImageToCanvas(filePath: string) {
-   if (!leafer) return
+   if (!app) return
    const img = new LeaferImage({ url, editable: true })
-   leafer.add(img)
+   app.tree.add(img)
  }

  onBeforeUnmount(() => {
-   leafer?.destroy()
+   app?.destroy()
  })
```

**新依赖**：`pnpm add @leafer-in/resize`

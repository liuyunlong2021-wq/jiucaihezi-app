# 画布 Phase 0-A 基础可用规划

> **日期**: 2026-07-11
> **原则**: 能用 > 好看。AI 能力以后加。

---

## 一、当前状态

| 功能 | 状态 | 问题 |
|------|------|------|
| 画布显示 | ✅ | 正常渲染 |
| 滚轮缩放 | ❓ | 未验证 |
| 生成→画布 | ❌ | 图片在 jc-media/ 但画布不显示 |
| 点击图片选中 | ❌ | Editor 是否有效未验证 |
| 拖拽移动图片 | ❌ | 同上 |
| 拖入图片到画布 | ❌ | drop 事件未触发 |
| 文件树右键→画布 | ❌ | 未实现 |
| 工具栏按钮 | ❌ | 全部占位，无功能 |

---

## 二、修复顺序（从现在开始）

### 第 1 步：让生成图片出现在画布（最核心）

**改动**：`CreationPanel.vue` 的 `addImageToCanvas` + `offCanvasSync`

- 加 `console.log` 调试，跑一遍看控制台
- 确认 `dev_read_file` 返回的 base64 正确
- 确认 `app.tree.add(img)` 生效

**验证**：生成一张图 → 画布上出现

### 第 2 步：让点击/拖拽工作（Editor 验证）

**改动**：无需改动代码，只需验证

- 图片出现在画布上后，点它 → 应出现选中框
- 拖动选中框 → 应能移动
- 如果不行 → 检查 `editable: true` 和 `editor: {}` 配置

**验证**：点图片有蓝色选中框，能拖拽

### 第 3 步：让拖入工作

**改动**：检查 `cp-canvas-zone` 的 `@drop.prevent.stop="onCanvasDrop"`

- 当前 drop 处理已写，但可能 Canvas 元素拦截了事件
- 备选方案：直接在 LeaferJS 的 canvas 元素上监听 drop

**验证**：从 Finder 拖图片到画布 → 出现

### 第 4 步：文件树右键「在画布中打开」

**改动**：`ProjectFileTree.vue` 右键菜单加一项

```ts
{ label: '在画布中打开', action: (path) => {
  emitEvent('switch-panel', 'creation')
  // 延迟等 CreationPanel 挂载后再 addImageToCanvas
  setTimeout(() => emitEvent('canvas:add-image', { url: path, source: 'filetree' }), 200)
}}
```

**验证**：右键图片文件 → 「在画布中打开」→ 出现在画布

### 第 5 步：工具栏改为半透明占位

**改动**：CSS 微调

- 按钮背景加 `rgba(255,255,255,0.85)` + `backdrop-filter: blur(4px)`
- 「更多」菜单暂时隐藏（按钮全放出来，不用折叠）

**验证**：工具栏可见但不干扰画布操作

---

## 三、之后再加（Phase 1 AI 能力）

所有 AI 工具走统一模式：

```
用户操作画布 → OpenCode Agent 收到 MCP tool 调用
  → Agent 调 NewAPI 生成
  → 结果回写画布
```

| 优先级 | 工具 | MCP tool |
|--------|------|----------|
| P1 | ✂ 去背景 | `canvas.remove_bg` |
| P1 | 🖌 标注修图 | `canvas.edit_image` |
| P2 | ⬛ 扩图 | `canvas.expand` |
| P2 | 📝 文字改写 | `canvas.edit_text` |
| P2 | 🎨 模板 | `canvas.skill_generate` |
| P3 | 🧩 图层分离 | `canvas.separate_layers` |

---

## 四、OpenCode Agent 控制画布

我们的 OpenCode SDK (`src/opencodeClient/*`) 支持 MCP tools。画布暴露 tools 给 Agent：

```
画布 → Agent 注册 MCP tools:
  canvas.add_image
  canvas.remove_image
  canvas.edit_image
  canvas.remove_bg
  canvas.expand_image
  ...

Agent 调用 tool → 我们的 handler 操作 LeaferJS → 结果返回 Agent
```

这个不需要额外服务——LeaferJS 实例在 Vue 组件内，MCP handler 直接调 `app.tree.add()` 等 API。**零额外进程。**

---

## 五、不要做的事（省时间）

- ❌ 不要调工具栏按钮功能（占位即可）
- ❌ 不要加「更多」折叠菜单（全部放出来）
- ❌ 不要调滚动条位置（默认右下）
- ❌ 不要加任何 AI 能力
- ❌ 不要动 cp-params / cp-composer

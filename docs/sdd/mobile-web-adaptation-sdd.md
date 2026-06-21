# Web 端移动端适配 SDD

> **分支**：`mobile-web` | **日期**：2026-06-21
> **基于**：`desktop` | **合入目标**：`desktop`
> **状态**：� Phase 1-3 代码完成，待真机验证
> **原则**：纯 CSS/布局改动，不改逻辑，不改 `src-tauri/`，不改 `opencodeClient/`

---

## 变更记录

| 日期 | 内容 |
|------|------|
| 2026-06-21 | Phase 1-3 代码完成，追加 CORS 双头修复（Gateway 代理去重） |

---

## 0. 目标

用户在手机上打开 Web 端，能流畅使用两个核心功能：

1. **对话 (ChatPanel)** — 已有基础移动端适配，本轮验证+微调
2. **创作面板 (CreationPanel)** — 本轮补齐移动端 CSS，确保可用

---

## 1. 分支策略

```
desktop ──→ mobile-web（本支线）
  │              ↓ 合回
  └──→ web（Web 直连也会自动拿到移动端适配）
```

- 基于 `desktop`（双端共享 UI 组件的主分支）
- 改动范围：纯前端 CSS/布局，不碰 Tauri/OpenCode
- 合回后桌面端和 Web 端同时受益

---

## 2. 改动清单

### Phase 1：CreationPanel 移动端 CSS（主战场） ✅ 已完成

> 文件：`src/components/creation/CreationPanel.vue`
> 预估新增 CSS：~80 行

#### 🔴 P0 — 参数栏溢出修复

**问题**：`cp-params` 用 `flex-wrap`，但在 375px 手机上 island 仍然挤在一起，popover 弹窗可能偏出屏幕。

**修法**：
```css
@media (max-width: 768px) {
  .cp-params {
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
  }
  .cp-island {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .cp-popover {
    max-width: calc(100vw - 24px);
    left: 50%;
    transform: translateX(-50%);
  }
  /* 参数按钮组换行 */
  .cp-btn-group {
    flex-wrap: wrap;
  }
}
```

#### 🔴 P0 — 画廊网格适配

**问题**：`minmax(150px, 1fr)` 在 iPhone SE (375px) 只能放 2 列，卡片偏小但可用；需确保不溢出。

**修法**：
```css
@media (max-width: 768px) {
  .cp-media-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 6px;
  }
  .cp-gallery-zone {
    padding: 6px 4px 4px;
  }
}
```

#### 🟡 P1 — 提示词输入区紧凑化

**问题**：`cp-composer` 的文件上传按钮 (48x48) + textarea + 发送按钮在小屏幕上占太多纵向空间。

**修法**：
```css
@media (max-width: 768px) {
  .cp-composer {
    padding: 6px 8px 8px;
    gap: 6px;
  }
  .cp-upload-trigger {
    width: 38px;
    height: 38px;
    min-width: 38px;
  }
  .cp-prompt-input {
    max-height: 80px;
    font-size: 16px; /* 防止 iOS 缩放 */
  }
}
```

#### 🟡 P1 — 工具栏紧凑化

**问题**：工具栏标题 + 提示词参考按钮 + 搜索框在小屏幕上挤。

**修法**：
```css
@media (max-width: 768px) {
  .cp-toolbar {
    padding: 0 8px;
    gap: 4px;
  }
  .cp-toolbar-link-text {
    display: none; /* 只显示图标 */
  }
}
```

#### 🟢 P2 — 媒体查看器已有适配

`MediaViewer.vue` 已有 `@media (max-width: 640px)` 断点，本轮验证即可，无需改动。

#### 🟢 P2 — 24h 过期提醒

当前 banner 文字较长，移动端缩短：
```css
@media (max-width: 768px) {
  .cp-expiry-banner {
    font-size: 0.75rem;
    padding: 6px 10px;
  }
}
```

---

### Phase 2：移动端布局微调 ✅ 已完成

> 文件：`src/layouts/WorkspaceLayout.vue`
> 预估新增 CSS：~15 行

#### 🟡 P1 — 移动端面板切换反馈

当前切换面板无过渡动画，加简单 slide：

```css
.ws-mobile-panel {
  animation: wsMobileSlideIn 0.15s ease;
}
@keyframes wsMobileSlideIn {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
}
```

#### 🟡 P1 — 迷你 Rail 增加「返回聊天」便捷入口

当前底部只有 settings，增加一个固定的聊天图标：

```vue
<!-- WorkspaceLayout.vue 移动端 rail 区域 -->
<!-- 已有 settings 在底部，中间 spacer 之上加 chat 快速返回 -->
```

改动极小，模板加 1 行。

---

### Phase 3：Web SPA 生产部署 + CORS 双头修复 ✅ 已完成

> 文件：`gateway/src/index.js` + `gateway/src/cors.js` + `src/services/creationModelAvailability.ts`

#### 任务

| # | 任务 | 说明 | 状态 |
|---|------|------|:--:|
| 3.1 | Gateway 加 SPA fallback 路由 | 非 `/auth/*`、`/landing/*`、`/api/*` 的 GET 返回 `index.html` | ✅ |
| 3.2 | Gateway 加 API 代理 + CORS 去重 | `/api/*` → `api.jiucaihezi.studio`，`dedupeCorsOrigin()` 去重 `Access-Control-Allow-Origin` | ✅ |
| 3.3 | 前端 Web 端走 Gateway 代理 | `creationModelAvailability.ts`：非 Tauri 环境用相对路径 `/api/creation/models` | ✅ |
| 3.4 | Vite build 产物上传 | `pnpm build` → `dist/` → Cloudflare Pages 或 R2（待部署） | 🟡 |
| 3.5 | CSP 头确认 | `img-src/media-src` 已含 `https:`，Web 端图片走远程 URL | ✅ |

#### CORS 双头修复详情

问题：`api.jiucaihezi.studio` Nginx 返回重复的 `Access-Control-Allow-Origin` 头，浏览器拦截跨域请求。

修复链路：
```
浏览器 → GET /api/creation/models (同源)
       → Gateway Worker
         → fetch https://api.jiucaihezi.studio/api/creation/models
         → dedupeCorsOrigin() 去重
         → 设置干净的单值 Access-Control-Allow-Origin
       ← 返回
浏览器 ✅ 同源无 CORS 拦截
```

**新增文件改动**：
- `gateway/src/cors.js` — `dedupeCorsOrigin(headers)` 工具函数
- `gateway/src/index.js` — `/api/*` 代理路由 + SPA fallback
- `src/services/creationModelAvailability.ts` — `isTauriRuntime()` 分流

#### Gateway 改动示意

```js
// gateway/src/index.js fetch handler 新增
// 在所有精确路由之后、notFound 之前
if (request.method === 'GET' && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/landing/')) {
  return serveSpaIndex(env); // 返回 index.html，让 Vue Router 接管
}
```

---

## 3. 不改的范围

| 文件/目录 | 理由 |
|-----------|------|
| `src-tauri/**` | 桌面专属，移动端适配不涉及 |
| `src/opencodeClient/**` | OpenCode 链路，移动端不涉及 |
| `src/composables/useChat.ts` | 对话引擎，逻辑不变 |
| `src/api/media-generation.ts` | 媒体生成 API，逻辑不变 |
| `src/stores/**` | 状态管理，逻辑不变 |
| `src/components/canvas/**` | 画布在移动端显式降级，不需要适配 |
| `src/components/editor/**` | 编辑器不在本轮目标范围内 |
| `src/components/skills/**` | Skill 面板在 Web 端已锁定，不适用 |

---

## 4. 验证方法

### 本地验证

```bash
# 1. 启动 dev server
pnpm dev

# 2. Chrome DevTools → 切换设备模拟
#    - iPhone SE (375×667)
#    - iPhone 12/13 (390×844)
#    - Pixel 5 (393×851)

# 3. 验证清单
#    □ 对话页：输入框不溢出、消息气泡正常、发送按钮可见
#    □ 创作页：参数 island 不溢出、弹窗在屏幕内、画廊至少 2 列
#    □ 创作页：选择模型、切换比例、输入 prompt、点击生成均正常
#    □ 创作页：生成结果卡片可见、点击可预览
#    □ 迷你 Rail：切换面板正常、按钮点击区域 ≥ 36px

# 4. 构建验证
pnpm exec vue-tsc -b
pnpm exec vite build
```

### 真机验证（推荐）

手机连同一 Wi-Fi，访问 `http://<mac-ip>:1420`，实际触摸操作一遍。

---

## 5. 验收标准

- [ ] iPhone SE (375px) 上对话页无横向滚动条
- [ ] iPhone SE (375px) 上创作面板所有控件可见、可点击
- [ ] 创作面板弹窗 (popover) 不超出屏幕边界
- [ ] 画廊网格至少 2 列，卡片不变形
- [x] `vue-tsc -b` 通过
- [x] `vite build` 通过
- [ ] 桌面端布局不受影响（回归验证）
- [ ] Web 端 CORS 双头不再拦截 `/api/creation/models`（需部署 Gateway 后验证）

---

## 6. 时间预估

| Phase | 内容 | 预估 | 实际 |
|-------|------|:--:|:--:|
| Phase 1 | CreationPanel CSS | 1-2 小时 | ✅ |
| Phase 2 | 布局微调 | 30 分钟 | ✅ |
| Phase 3 | SPA 部署 + CORS 修复 | 1-2 小时 | ✅ 代码完成 |
| 验证 | 多设备模拟 + 构建 | 30 分钟 | 🟡 待真机 |
| **合计** | | **3-5 小时** | |

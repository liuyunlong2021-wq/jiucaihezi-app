# 交接：Web 端创作面板对齐桌面端

> **日期**: 2026-07-05
> **作者**: Codex / by3
> **目标分支名建议**: `web-creation`
> **当前基线**: `main` @ `152f847`

---

## 一、目标

Web 端 (`jiucaihezi-app` 的 Cloudflare Pages 部署) 目前只有轻量聊天。需要补齐创作面板，与桌面端功能对齐。

桌面端创作面板核心链路：
```
CreationPanel → useCreation → media-generation.ts → NewAPI/rh-adapter → 轮询 → 任务列表
                                                                              ↓
                                                              产出写入 {projectDir}/jc-media/
```

---

## 二、可行性分析

**核心链路已经跨平台**。从提交任务到轮询结果的 HTTP 调用链（`media-generation.ts` → NewAPI → 轮询）不依赖 Tauri，Web 端可以直接复用。

**只需处理 3 个文件 I/O 差异**：

---

## 三、需要改的 3 个点

### Touchpoint 1: 参考图下载（解决跨域 CORS）

**文件**: `src/runtime/creation/creationMediaRuntime.ts` L122-140

**现状**: 桌面端通过 Tauri `http_download_base64` 下载参考图 URL，绕过浏览器 CORS。

```typescript
// 现状（仅桌面）
const { invoke } = await import('@tauri-apps/api/core')
const dl = await invoke('http_download_base64', { request: { url: images[0] } })
imageBase64 = dl.data_base64
```

**Web 方案**:
```
选项 A: 通过 gateway Worker 代理下载（推荐）
  - gateway/src/ 已有 Cloudflare Worker，加一个 /api/proxy-image?url=... 端点
  - Worker fetch 不受 CORS 限制
  - 前端: imageBase64 = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)

选项 B: 用户直接上传本地图片（更简单但体验不同）
  - Web 端不支持 URL 参考图，只支持 FileReader 读取本地文件
  - 加 `v-if="!isTauri"` 隐藏 URL 输入，只留文件上传

选项 C: CORS 代理公共服务
  - 不推荐，依赖第三方不稳定
```

**建议走 A**，gateway Worker 加一个轻量代理端点。

---

### Touchpoint 2: 产出文件写入

**文件**: `src/utils/projectMediaWriter.ts` L59-68

**现状**: 桌面端调用 Rust `dev_write_file_bytes` 写入项目文件夹。

```typescript
// 现状（仅桌面）
const { invoke } = await import('@tauri-apps/api/core')
await invoke('dev_write_file_bytes', { input: { root, relativePath, dataBase64 } })
```

**Web 方案**: 浏览器 Blob 下载

```typescript
// Web fallback
function downloadBlob(dataBase64: string, mime: string, filename: string) {
  const bytes = Uint8Array.from(atob(dataBase64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
```

**实施**: 在 `projectMediaWriter.ts` 导出两个函数：
- `writeProjectMediaDesktop()` — 当前 Tauri 路径
- `writeProjectMediaWeb()` — Blob 下载路径
- 或者 `writeProjectMedia()` 内部 `if (isTauri) ... else downloadBlob(...)`

---

### Touchpoint 3: 打开/预览产出文件

**文件**: `src/components/creation/CreationPanel.vue` L159-180

**现状**: 桌面端用 `open_in_shell` 系统默认程序打开，用 `dev_reveal_in_finder` 打开文件夹。

```typescript
// 现状（仅桌面）
await invoke('open_in_shell', { path: filePath })
await invoke('dev_reveal_in_finder', { path: task.assetUri })
```

**Web 方案**:
- 预览图片/视频：用 `window.open(resultUrl, '_blank')` 或内嵌 `<img>` 预览
- "打开文件夹" 不适用于 Web，隐藏该按钮
- 产出文件：配合 Touchpoint 2 的 Blob 下载

**实施**: `previewTask()` / `openTaskFolder()` 加 `if (isTauri) ... else web版本`

---

## 四、不需要改的

| 组件/模块 | 原因 |
|-----------|------|
| `useCreation.ts` | 状态管理、模型选择、参数构建全走 HTTP |
| `media-generation.ts` | 提交任务、轮询结果全走 NewAPI |
| `creationModelRegistry.ts` | 模型能力配置（静态数据） |
| `mediaModelCapabilities.ts` | 模型参数表（静态数据） |
| CreationPanel 模板/样式 | Vue 组件可直接复用 |
| 任务列表 UI | 纯前端展示 |

---

## 五、Web 端特有考虑

### 5.1 项目文件夹

Web 端没有 `projectDir` 概念。创作面板的"项目文件夹"按钮在 Web 端应隐藏或替换为"下载历史"。

### 5.2 任务持久化

桌面端任务列表存 IndexedDB（`mediaTaskStore`），Web 端可以直接复用 IndexedDB。

### 5.3 Rail 入口

Web 端 WorkspaceLayout 需要在 Rail 中显示创作面板入口。当前移动端 Rail 已包含创作面板按钮。

### 5.4 CORS

`api.jiucaihezi.studio` 的 CORS 配置需要确认允许 Cloudflare Pages 域名的请求。当前配置见 `gateway/` 和服务器 Nginx/Caddy 配置。

---

## 六、实施顺序

```
Phase 1: 参考图下载（Touchpoint 1）
  └── gateway Worker 加 /api/proxy-image 端点 + 前端调用

Phase 2: 产出文件下载（Touchpoint 2）
  └── projectMediaWriter 加 Web fallback

Phase 3: 预览/打开（Touchpoint 3）
  └── CreationPanel 预览按钮适配 Web

Phase 4: Web 端入口接入
  └── WorkspaceLayout 确认创作面板在 Web 端可见可用

Phase 5: 验证
  └── pnpm build && wrangler pages deploy dist
  └── 测试：选模型 → 填 prompt → 提交 → 轮询 → 下载结果
```

---

## 七、验证清单

- [ ] Web 端能打开创作面板
- [ ] 模型列表正常加载（来自 NewAPI）
- [ ] 参考图上传/URL 能正常工作
- [ ] 提交后任务出现在任务列表
- [ ] 轮询正常，完成后显示结果
- [ ] 点击结果能下载/预览
- [ ] 桌面端创作面板不受影响（回归测试）

---

## 八、当前代码库状态

| 项目 | 值 |
|------|-----|
| 分支 | `main` |
| 最新提交 | `152f847` docs: AGENTS.md 更新架构图 + 清理 |
| lib.rs | 1622 行，11 个命令模块 |
| binaries | 仅 opencode |
| 文档 | `docs/handover/web-creation-panel-alignment-handover.md`（本文） |

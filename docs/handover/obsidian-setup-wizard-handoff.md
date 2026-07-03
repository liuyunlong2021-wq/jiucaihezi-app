# Obsidian 设置向导 — 交接文档

> **状态**：向导 UI 已完成，检测逻辑被 Vite HMR 缓存卡住，需要绕过。
> **接手第一步**：读本文档 + 执行"立即修复"。

---

## 一、做了什么

### 已完成的文件

| 文件 | 作用 |
|------|------|
| `src/components/tools/ObsidianSetupWizard.vue` | 向导 UI（4 步引导：安装 Obsidian → 装插件 → 配 Key → 完成） |
| `src/utils/obsidianDetect.ts` | 检测工具（Rust invoke / plugin-fs / mdfind 三重回退） |
| `src/components/tools/ToolWarehousePanel.vue` | 工具仓库面板，「工具设置向导」区域有入口按钮 |
| `src-tauri/src/lib.rs` | 两个 Rust 命令：`check_obsidian_installed` + `mdfind_obsidian` |
| `src-tauri/tauri.conf.json` | CSP 加 `https://localhost:*` |
| `src-tauri/capabilities/default.json` | 加 `fs:allow-exists` |
| `src/data/githubTools.json` | 加 `obsidian-local-rest-api` 条目 |
| `src/data/githubSkills.json` | 加 `kepano/obsidian-skills` 条目 |

### 当前分支：`gongju`

---

## 二、当前问题

**症状**：打开向导后 Step 1 始终显示"未检测到 Obsidian"。

**根因**：`obsidianDetect.ts` 被 Vite 缓存了旧版本。向导组件（`.vue`）的 HMR 正常，但 `.ts` 工具文件的修改没被 Vite 热更新到 WebView。清 `node_modules/.vite` 无效。

**证据**：Console 里有 `[obsidian-wizard]` 日志（组件代码更新了），但完全没有 `[obsidian]` 日志（工具文件没更新）。

---

## 三、立即修复（3 选 1）

### 方案 A（推荐，10 分钟）：内联检测逻辑

把 `obsidianDetect.ts` 的 `checkObsidianInstalled()` 直接复制到 `ObsidianSetupWizard.vue` 的 `<script>` 里，不再 import 外部文件。Vite 对 `.vue` 文件的 HMR 比 `.ts` 可靠得多。

具体操作：
1. 打开 `src/components/tools/ObsidianSetupWizard.vue`
2. 移除 `import { checkObsidianInstalled, ... } from '@/utils/obsidianDetect'`
3. 把下面这段代码粘贴到 `<script setup>` 顶部（替换原 import）：

```ts
// ─── 内联检测（绕过 Vite HMR 缓存问题）───
async function checkObsidianInstalled(): Promise<boolean> {
  const w = window as any
  if (!w.__TAURI__) return false

  // 方式1: Rust 命令
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('check_obsidian_installed')
    console.log('[obsidian] Rust →', result)
    if (result) return true
  } catch (e) { console.warn('[obsidian] Rust 失败', e) }

  // 方式2: plugin-fs
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    if (await exists('/Applications/Obsidian.app')) {
      console.log('[obsidian] plugin-fs → true')
      return true
    }
  } catch (e) { console.warn('[obsidian] plugin-fs 失败', e) }

  // 方式3: mdfind (Spotlight)
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke('mdfind_obsidian')
    if (raw) { console.log('[obsidian] mdfind →', raw); return true }
  } catch (e) { console.warn('[obsidian] mdfind 失败', e) }

  return false
}
```

4. 删掉 `src/utils/obsidianDetect.ts` 的 import，向导里其他函数（`probeObsidianApi`、`testObsidianKey` 等）也内联或保留原 import（它们不涉及 Step 1，不受缓存影响）。

### 方案 B（5 分钟）：Vite 构建产物直接替换

```bash
cd /Users/by3/Documents/jiucaihezi-app
pnpm exec vite build
# 把 dist/ 里的构建产物复制到 Tauri dev server 的静态目录
# 但这和 pnpm tauri dev 的工作流冲突，不推荐
```

### 方案 C（15 分钟）：强制禁用 Vite HMR 对这个文件的缓存

在 `vite.config.ts` 里添加：
```ts
server: {
  watch: {
    ignored: []  // 不做忽略
  }
},
optimizeDeps: {
  exclude: []  // 强制不预构建
}
```

---

## 四、Rust 端状态

两个命令已编译通过并注册：

```rust
// lib.rs 第 ~7198 行（#[cfg(test)] 之前）
#[tauri::command]
fn check_obsidian_installed() -> bool { ... }

#[tauri::command]  
fn mdfind_obsidian() -> String { ... }

// lib.rs handler 中已注册
check_obsidian_installed,
mdfind_obsidian,
```

**不需要再改 Rust 端。**

---

## 五、验证步骤

修复后验证：

1. `pnpm tauri dev`
2. 打开工具仓库（左侧 Rail 点工具图标）
3. 往下滑，找到「工具设置向导」区域
4. 点「Obsidian 知识库」按钮
5. Console 搜 `[obsidian]`，应该看到至少一行日志
6. Step 1 应该显示 ✅

---

## 六、相关上下文

- 产品使用 OpenCode 作为 AI 引擎，不是 Codex
- 图标系统用 `<JcIcon name="..." />`，已全面替代旧 `<span class="mso">`
- `gongju` 分支有 7 个提交，都是本次工具仓库瘦身 + Obsidian 向导的工作
- 上一个稳定提交：`c6099a4` "debug: ObsidianSetupWizard onMounted/detectAll 加 console.log"

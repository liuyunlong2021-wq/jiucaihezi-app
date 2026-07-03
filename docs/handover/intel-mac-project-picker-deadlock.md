# 交接：Intel Mac 项目文件夹选择器无响应

> **日期**: 2026-07-03
> **分支**: `pingguo-inter`
> **状态**: 🔴 未解决 — M 芯片正常，Intel Mac 上点击「添加新项目」完全无反应

---

## 问题描述

Tauri v2 桌面应用。ChatPanel 顶部的项目选择器 + 第二列空态的「选择项目文件夹」按钮，在 Apple Silicon Mac 上正常弹系统对话框，在 Intel Mac 上点击后完全无反应（无弹窗、无错误日志、无 crash）。

## 已验证可用的部分

| 功能 | M 芯片 | Intel |
|------|--------|-------|
| 模型选择器（Teleport + stopPropagation） | ✅ | ✅ |
| 第二列项目 Tab 显示 | ✅ | ✅ |
| 顶部白条（titleBarStyle: Overlay） | ✅ | ✅ |
| Skill 仓库扫描 | ✅ | ✅ |
| **项目文件夹选择器** | ✅ | ❌ |

## 已尝试的方案（全部在 Intel 上失败）

### 方案 1：JS 侧 setTimeout 延迟

```ts
// ChatPanel.vue
showProjectMenu.value = false
await new Promise(r => setTimeout(r, 200))
const { open } = await import('@tauri-apps/plugin-dialog')
const selected = await open({ directory: true })
```

**结论**: Intel Mac 上 WKWebView 事件循环 + Tauri IPC 的时序不可控，延迟数值猜不准。

### 方案 2：Rust 侧 tauri-plugin-dialog（mpsc）

```rust
#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |result| { tx.send(result) });
    rx.recv()  // 阻塞 tokio worker 线程
}
```

**结论**: `rx.recv()` 阻塞 tokio 线程，可能阻碍对话框回调在主线程的执行。

### 方案 3：Rust 侧 tauri-plugin-dialog（tokio oneshot）

```rust
#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |result| { tx.send(result) });
    rx.await  // 不阻塞，yield 给 tokio
}
```

**结论**: 同样失败。说明不是阻塞问题，而是 tauri-plugin-dialog 的回调机制在 Intel Mac 的 WKWebView 进程上下文中压根不触发。

### 方案 4：rfd crate（spawn_blocking 直调 NSOpenPanel）

```rust
#[tauri::command]
async fn pick_project_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new().pick_folder()
    }).await
}
```

**结论**: `rfd` 在 `spawn_blocking` 中需要 macOS AppKit 的主线程。Tauri v2 的 tokio runtime 默认不在主线程 spawn blocking，`NSOpenPanel` 无法在非主线程呈现。

## 参考实现：OpenCode（Electron）

```
/Users/by3/Documents/jiucaihezi-opencode/
```

OpenCode 使用 Electron 的 `ipcMain.handle` + `dialog.showOpenDialog`：

```typescript
// desktop/src/main/ipc.ts L108
ipcMain.handle("open-directory-picker", async (_, opts) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: opts?.title,
  })
  return result.canceled ? null : result.filePaths[0]
})
```

Electron 的 `dialog.showOpenDialog` 在主进程（Node.js main process）中同步调用，Electron 保证主进程在主线程上运行，`NSOpenPanel` 可以正常呈现。这是 Electron 和 Tauri v2 在对话框 API 上的根本架构差异。

## 可能的解决方向

### 方向 A：Tauri `run_on_main_thread`

```rust
#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app.run_on_main_thread(move || {
        // 在主线程上打开对话框
        let result = rfd::FileDialog::new().pick_folder();
        let _ = tx.send(result);
    });
    rx.recv().map_err(|_| "cancelled".into())
}
```

`tauri::Manager::run_on_main_thread()` 确保 `rfd` 在主线程调用。

### 方向 B：Tauri `tauri::api::dialog` v1 风格同步 API

检查 Tauri v2 是否有类似 Electron 的同步对话框 API（可能被标记为 deprecated 或需要特定 feature flag）。

### 方向 C：macOS-specific 实现

```rust
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
fn native_open_panel() -> Option<String> {
    // 直接调用 NSOpenPanel
    unsafe {
        let panel: *mut Object = msg_send![class!(NSOpenPanel), openPanel];
        let _: () = msg_send![panel, setCanChooseDirectories: true as i8];
        let _: () = msg_send![panel, setCanChooseFiles: false as i8];
        let result: i32 = msg_send![panel, runModal];
        if result == 1 {
            let url: *mut Object = msg_send![panel, URL];
            let path: *mut Object = msg_send![url, path];
            let c_str: *const i8 = msg_send![path, UTF8String];
            Some(CStr::from_ptr(c_str).to_string_lossy().into())
        } else { None }
    }
}
```

这种方式最底层，完全控制线程模型，但平台绑定代码多。

### 方向 D：Tauri v2 配置级修复

检查 `tauri.conf.json` 是否有 macOS 特定配置影响对话框行为（如 `"useHttpsScheme": true` 可能影响 IPC 回调）。

## 关键文件

| 文件 | 相关内容 |
|------|---------|
| `src-tauri/src/lib.rs:41-56` | 当前 `pick_project_folder` 命令（rfd 版本） |
| `src/components/chat/ChatPanel.vue:199-214` | ChatPanel 前端调用 |
| `src/components/filetree/ProjectFileTree.vue:168-175` | 第二列空态按钮 |
| `src-tauri/Cargo.toml:19` | `tauri-plugin-dialog = "2"` + `rfd = "0.15"` |
| `src-tauri/tauri.conf.json` | 窗口配置（`titleBarStyle: Overlay`） |

## 测试方法

```bash
# M 芯片上交叉编译 Intel 版本
cargo check --manifest-path src-tauri/Cargo.toml
pnpm exec vue-tsc -b
pnpm exec tauri build --target x86_64-apple-darwin

# 产物
# src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/韭菜盒子_1.1.6_x64.dmg

# 拷到 Intel Mac 上安装测试：
# 1. 点击输入框上方的「选择项目」→ 点击「添加新项目」
# 2. 点击第二列「项目」Tab → 点击「选择项目文件夹」按钮
```

## Git 历史

```
8ef3304 — fix: move project folder picker to Rust side (bypass JS event loop)
9c0b61b — fix: use tokio oneshot instead of blocking mpsc for dialog
d8c3c5c — fix: replace tauri dialog plugin with rfd for project picker
```

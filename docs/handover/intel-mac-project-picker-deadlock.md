# 交接：Intel Mac 项目文件夹选择器无响应

> **日期**: 2026-07-03
> **分支**: `pingguo-inter`
> **状态**: 🔴 未解决 — M 芯片正常，Intel Mac 上点击「添加新项目」完全无反应

---

## 问题描述

Tauri v2 桌面应用。ChatPanel 顶部的项目选择器 + 第二列空态的「选择项目文件夹」按钮，在 Apple Silicon Mac 上正常弹系统对话框，在 Intel Mac 上点击后完全无反应（无弹窗、无错误日志、无 crash）。

---

## 已确认的两大根因（2026-07-03 通过日志定位）

### 根因 1：Intel WKWebView 不支持 `event.stopPropagation()`

通过注入 `console.log` 发现：点击「选择项目」按钮后，`toggleProjectMenu` 被调用，`showProjectMenu` 在 `true↔false` 之间疯狂跳变。

**证据**：
```
[Log] [pickProject] toggleProjectMenu, 当前状态: – false (x2)
[Log] [pickProject] toggleProjectMenu, 当前状态: – true
[Log] [pickProject] toggleProjectMenu, 当前状态: – false   ← 秒关！
```

**链路**：
1. 点击「选择项目」→ `toggleProjectMenu($event)` → `event.stopPropagation()` → state: false→true
2. Intel WKWebView 上 `stopPropagation` 不生效 → click 冒泡到 ChatPanel 根元素
3. 根元素 `@click="showProjectMenu = false"` → state: true→false
4. 菜单秒闪，「添加新项目」按钮从未被渲染（或渲染瞬间就销毁）

**已尝试修复**（`ChatPanel.vue`）：将根元素 click 改为 `closeAllMenus(e)`，用 `projectMenuRef.value?.contains(e.target)` 判断点击是否在菜单内，不依赖 `stopPropagation`。

```ts
// 当前代码（ChatPanel.vue）
const projectMenuRef = ref<HTMLElement | null>(null)
function closeAllMenus(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (projectMenuRef.value?.contains(target)) return  // 菜单内点击不关
  showProjectMenu.value = false
  // ...
}
```

```html
<!-- 根元素 -->
@click="closeAllMenus"

<!-- 菜单 div -->
<div v-if="showProjectMenu" ref="projectMenuRef" class="cp-project-menu">
  <button class="cp-project-item" @mousedown="...">添加新项目</button>
</div>
```

**⚠️ 此修复未经 Intel 实机验证**（用户反馈"无效"，但不确定是否重启了 tauri dev）。

### 根因 2：所有 Rust 侧对话框方案在 Intel 上静默失败

通过 `eprintln!` 日志确认：**IPC 调用（`invoke` / `dialog.open`）在 JS 侧就卡住，从未到达 Rust 命令**。

**证据**（ProjectFileTree 入口日志）：
```
[pft pickProject] 1. ctxAddProjectFolder 触发     ← 函数进入
[pft pickProject] 2. 等200ms...                    ← 延迟 OK
[pft pickProject] 3. 开始 invoke...                ← 进入 invoke
（此后无任何日志：invoke 挂起，永不 resolve/reject）
```

终端无 `[RUST pick_project]` 日志 → Rust 命令从未被调用。

---

## 已尝试的全部方案（按时间顺序）

| # | 方案 | 层级 | 结果 | 原因 |
|---|------|------|------|------|
| 1 | `rfd::AsyncFileDialog`（原始代码） | Rust | ❌ | AsyncFileDialog 在 tokio 线程创建，NSOpenPanel dispatch 失败 |
| 2 | JS setTimeout 200ms 延迟 | JS | ❌ | WKWebView 事件循环时序不可控 |
| 3 | `run_on_main_thread` + 同步 `rfd::FileDialog` + `mpsc` | Rust | ❌ | run_on_main_thread 可能未在主线程执行（或 rfd 同步阻塞 RunLoop） |
| 4 | `run_on_main_thread` + `AsyncFileDialog` + `block_on`（照抄 tauri-plugin-dialog 官方实现） | Rust | ❌ | 同上 |
| 5 | `@tauri-apps/plugin-dialog` 的 `open()` 直接调 | JS | ❌ | JS 侧 `invoke`/IPC 就卡住了，未到 Rust |
| 6 | `@mousedown` 替代 `@click` | JS | ❌ | 按钮事件仍不触发（菜单已秒关，见根因 1） |
| 7 | `contains()` 替代 `stopPropagation` | JS | 待验证 | 修复根因 1，但需重启 tauri dev 生效 |
| 8 | AppleScript `osascript` 调原生目录选择器 | Rust | 待验证 | 改造了 `pick_project_folder` 命令，但依赖方案 7 先让菜单稳定显示 |

### 当前代码状态（2026-07-03 最后提交）

**Rust 侧** (`src-tauri/src/lib.rs:42-62`)：
```rust
#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // AppleScript 方案：完全绕过 Tauri IPC 线程模型
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to set f to choose folder with prompt "选择项目文件夹" default location (path to home folder)"#)
        .arg("-e")
        .arg(r#"POSIX path of f"#)
        .output()
        .map_err(|e| format!("osascript 启动失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User cancelled") || stderr.is_empty() { return Ok(None); }
        return Err(format!("osascript 错误: {stderr}"));
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if path.is_empty() { None } else { Some(path) })
}
```

**JS 侧** — ChatPanel (`src/components/chat/ChatPanel.vue`)：
- 根元素：`@click="closeAllMenus"`（contains 判断）
- 菜单 div：`ref="projectMenuRef"`（不再用 `@click.stop`）
- 按钮：`@mousedown="...pickProjectFolder()"`
- `pickProjectFolder` 内：`invoke('pick_project_folder')`

**JS 侧** — ProjectFileTree (`src/components/filetree/ProjectFileTree.vue`)：
- 函数 `ctxAddProjectFolder`：`invoke('pick_project_folder')`

---

## 下一步建议

1. **确认方案 7（contains 替代 stopPropagation）是否生效**：重启 `pnpm exec tauri dev`（Rust 代码改了需要重新编译），看菜单是否能稳定显示
2. **如果菜单稳定了**：点击「添加新项目」，测试 AppleScript 方案（方案 8）
3. **如果 AppleScript 也不行**：最后方案是直接在 Rust 侧用 `objc2`（已在 dep tree 中，Tauri 自带）调用 `NSOpenPanel`，并用 `dispatch_sync` 确保在主线程执行
4. **终极方案**：如果以上全失败，考虑移植到 Electron（参考 OpenCode 的 `dialog.showOpenDialog` 实现，Electron 主进程天然在主线程）

## 关键文件

| 文件 | 相关内容 |
|------|---------|
| `src-tauri/src/lib.rs:42-62` | 当前 `pick_project_folder` 命令（AppleScript 版本） |
| `src-tauri/src/lib.rs:8660` | `pick_project_folder` 命令注册 |
| `src/components/chat/ChatPanel.vue:195-220` | `pickProjectFolder` 函数 + `closeAllMenus` |
| `src/components/chat/ChatPanel.vue:1928-1930` | 根元素 `@click="closeAllMenus"` |
| `src/components/chat/ChatPanel.vue:~1960` | 菜单 `ref="projectMenuRef"` + 按钮 `@mousedown` |
| `src/components/filetree/ProjectFileTree.vue:167-177` | `ctxAddProjectFolder` 函数 |
| `src-tauri/Cargo.toml:19` | `tauri-plugin-dialog = "2"` + `rfd = "0.15"` |
| `src-tauri/tauri.conf.json` | 窗口配置 |
| `src-tauri/capabilities/default.json` | Tauri 权限（`dialog:allow-open` 等） |
| `src-tauri/entitlements.plist` | macOS 权限（`user-selected.read-write`） |

## 测试方法

```bash
# 先确认 Rust/TS 编译：
cargo check --manifest-path src-tauri/Cargo.toml
pnpm exec vue-tsc -b

# 启动 dev（会重新编译 Rust）：
pnpm exec tauri dev

# 打开 Safari → 开发 → 选韭菜盒子 WebView → Console

# 测试入口 1：ChatPanel 顶部「选择项目」→「添加新项目」
# 测试入口 2：第二列「项目」Tab → 空态「选择项目文件夹」按钮
# 期望 Console 日志：[pickProject] 1. 进入 pickProjectFolder
#                    [pickProject] 2. 菜单关闭，invoke pick_project_folder...
#                    [pickProject] 3. 返回: "/Users/xxx/some-folder"

# 交叉编译 Intel 版本（在 M 芯片上）：
pnpm exec tauri build --target x86_64-apple-darwin
# 产物：src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/韭菜盒子_*.dmg
```

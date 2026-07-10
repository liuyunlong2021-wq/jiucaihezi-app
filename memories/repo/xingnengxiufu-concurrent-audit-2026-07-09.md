# 并发审计 — 0709-xingnengxiufu

> 审计范围：2026-07-09 所有改动（6 个文件，+297/-24）

## 一、锁路径审计

两个锁：`OpenCodeRuntime.operation`（操作互斥）和 `OpenCodeRuntime.session`（session 状态）

### 锁获取顺序（全部一致：operation → session）

| 函数 | 路径 | operation 锁 | session 锁 | 顺序 |
|------|------|:---:|:---:|:---:|
| `opencode_ensure_server` | 启动/复用子进程 | ✅ 全程持有 | ✅ 检查+替换时持有 | op→ses |
| `opencode_stop` | 停止子进程 | ✅ 全程持有 | ✅ take 时持有 | op→ses |
| `opencode_relaunch` | 停止+重启 | ✅ 作用域块 | ✅ 作用域块 | op→ses |
| 窗口 CloseRequested | 退出杀进程 | ✅ spawn 内持有 | ✅ spawn 内持有 | op→ses |
| 窗口 Resized/Moved | 保存状态 | ❌ 不用锁 | ❌ 不用锁 | N/A |

**结论：锁顺序全局一致，无死锁风险。** ✅

## 二、发现并修复的问题

### ❌ FIXED: load_shell_env() 阻塞在 operation 锁内

```
旧代码：opencode_ensure_server()
  let _guard = runtime.operation.lock().await;  // 锁已持有
  ...
  let shell_env = load_shell_env();  // ⚠️ 阻塞调用！StdCommand::output() 最多 5s

新代码：opencode_ensure_server()
  let shell_env = load_shell_env();  // ✅ 锁外执行
  let _guard = runtime.operation.lock().await;
```

**风险**：shell env 探测使用 `StdCommand::output()` 阻塞等待子进程，最多 5 秒。期间 `operation` 锁被持有，阻塞所有并发 `ensure_server`/`stop`/`relaunch` 调用。

**修复**：移到 `operation.lock()` 之前。

### ⚠️ FIXED: 窗口状态写入无节流

```
旧代码：每次 Resized/Moved 事件 → std::fs::write() 同步写文件
新代码：AtomicBool 节流 + std::thread::spawn 后台线程写
```

**风险**：窗口拖拽/缩放时每秒触发数百次事件，每次 `fs::write` 阻塞主线程事件循环。

**修复**：`AtomicBool` 做互斥节流（同一时间最多一个写操作），I/O 放到 `std::thread::spawn` 后台线程。

## 三、已验证安全

### ✅ 锁释放顺序

- `opencode_relaunch` 使用作用域块 `{}` 在调用 `app.restart()`（永不返回）前释放锁。
- `opencode_stop` 使用 `session.take()` 取出 session 后，`_guard` 在函数返回时自动 drop。

### ✅ 闭包生命周期

- 窗口事件闭包使用 `Arc<AtomicBool>` 和 `clone()` 传递给 `std::thread::spawn`。
- `AppHandle` 使用 `clone()` 在不同闭包/线程间传递（`AppHandle` 是 `Send + Sync + 'static`）。

### ✅ 文件写入安全性

- `window-state.json` 使用 `write`（原子覆盖），不存在部分写入问题。
- `export-debug-logs` 使用 `read_to_string` 只读操作，无竞态。

### ✅ useChat.ts 并发安全（已在前行审计）

- `runId !== activeRunId` 守卫防止过期 run 的 finalize
- `finalized` 标志防止重复 finalize
- `controller.signal.abort()` 事件监听器使用 `{ once: true }`

## 四、统计

| 分类 | 数量 |
|------|------|
| 锁路径审查 | 5 条，全部一致 |
| 发现 Bug | 2 个 |
| 已修复 | 2 个 |
| 误报 | 0 |
| 已知风险（无需修复） | 0 |

## 五、未覆盖范围

- `app/hooks/` 和 `app/context/` 的 TS 端并发（15+10 个文件，本次未审计）
- `useChat.ts` 已在 `skillxianshi-concurrent-audit` 中覆盖 ✅

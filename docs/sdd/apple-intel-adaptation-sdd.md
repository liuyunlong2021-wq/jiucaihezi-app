# SDD: 多平台健壮性修复（Apple Intel Mac 触发）

> **状态**: 方案评审
> **日期**: 2026-07-03
> **分支**: `pingguo-inter`
> **范围**: 修复在 Apple Intel Mac 上发现的跨平台时序/异步/路径 bug。问题根因是代码写错了、M 芯片太快藏住了——修复后 M 芯片、Intel Mac、Windows 三平台均受益。不改 Web 端、不调整 OpenCode 三层隔离架构、不恢复画布。

---

## 1. 背景

Apple Silicon Mac（M 芯片）当前可用。Apple Intel Mac 上报告了一组交互和布局问题：

1. 模型选择器点击后无法选择模型。
2. Skill 仓库打开后不显示内置 Skill，并报错 `scan already in progress`。
3. 点击输入框上方项目选择器后，无法添加新项目。
4. 第二列没有项目列。
5. APP 最上方有一条白色窄边。
6. （新增）Skill 仓库报 `Failed to resolve Central Skills root: No such file or directory`。

深入排查后发现：这六个问题的根因都是**时序竞态、异步未 await、路径未防御、事件未隔离**——全是代码 bug，只是 M 芯片性能太强把它们藏住了。同样的 bug 在 Windows 上也会炸，只是触发条件不同。

因此本次修复范围从「Intel Mac 适配」扩展为「多平台健壮性」——修的是代码正确性，受益的是所有桌面平台。

---

## 2. 初步定位

### 2.1 模型选择器无法选择

涉及文件：

- `src/components/chat/ChatPanel.vue`
- `src/stores/agentStore.ts`

当前模型菜单是 `ChatPanel.vue` 内部绝对定位菜单：

```vue
<div class="cp-model-wrap">
  <button class="cp-model-btn" @click="toggleModelMenu">
  <div v-if="showModelMenu" class="cp-model-menu">
    <button
      v-for="m in agentStore.openCodeTextModels"
      class="cp-model-item"
      @click="selectModel(m)"
    >
```

疑似风险：

- Intel Mac 的 WKWebView 点击/层叠行为更容易受父容器 `overflow: hidden`、resize handle、右侧面板遮挡影响。
- `.cp-model-menu` 使用局部绝对定位，仍在 `ChatPanel` 列内，可能被列边界裁剪或被右侧面板/resize handle 吃掉点击。
- 当前 `toggleModelMenu()` 没有 `event.stopPropagation()`，全局根节点点击关闭逻辑可能在同一轮点击中参与状态切换。

目标行为：

- 点击模型按钮只打开菜单。
- 点击模型项必须调用 `agentStore.setModel(model.id, providerId)` 并关闭菜单。
- 菜单在 Intel Mac 上不被右侧设置面板遮挡，不被列容器裁剪，不被全局点击提前关闭。

### 2.2 Skill 仓库 `scan already in progress`

涉及文件：

- `src/stores/skillsManageStore.ts`
- `src/components/skills/CentralSkillsPanel.vue`
- `src/components/chat/ChatPanel.vue`
- `src-tauri/src/skills/scanner.rs`

当前链路：

```ts
loadCentralSkills({ scan: true }) -> scanAllSkills() -> invoke('scan_all_skills')
```

Rust 侧已有全局扫描锁：

```rust
static SCANNING: AtomicBool = AtomicBool::new(false);
static SCAN_STARTED_AT: AtomicI64 = AtomicI64::new(0);

if SCANNING.swap(true, Ordering::SeqCst) {
    return Err("scan already in progress".into());
}
```

疑似风险：

- `ChatPanel.refreshOpenCodeSkills()` 和 `CentralSkillsPanel.onMounted()/refresh()` 都可能触发 `loadCentralSkills({ scan: true })`。
- 前端 `scanAllSkills()` 没有复用正在进行的 Promise，同一前端进程内重复调用会并发打到 Rust。
- Rust 侧遇到并发扫描直接返回错误，导致前端进入错误态，不显示已有 `centralSkills`。
- 30 秒锁超时对 Intel Mac 慢盘/首次内置 Skill seed 可能偏短；即使不是死锁，也会产生误判。

目标行为：

- 同一前端进程内，重复扫描请求复用同一个 Promise。
- Rust 侧并发扫描不应该让 Skill 仓库空白；至少前端应降级读取 `get_central_skills` 的已有数据。
- 打开 Skill 仓库时，内置 Skill 优先可见；扫描错误作为轻量提示，不阻断列表展示。

### 2.3 项目选择器无法添加新项目

涉及文件：

- `src/components/chat/ChatPanel.vue`
- `src/stores/projectStore.ts`
- `src/components/filetree/FileTreePanel.vue`
- `src/components/filetree/ProjectFileTree.vue`

当前项目选择器：

```ts
async function pickProjectFolder() {
  showProjectMenu.value = false
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, title: '选择项目文件夹' })
  if (typeof selected === 'string') selectProject(selected)
}
```

疑似风险：

- 菜单先关闭后立刻打开 Tauri dialog，在 Intel Mac 上可能出现 focus/activation 竞态。
- 按钮位于自定义菜单中，点击事件可能被根层关闭逻辑或菜单消失打断。
- 没有处理 Tauri dialog 返回 `string[]` 的情况；虽然目录单选一般返回 `string`，但这里可做兼容。

目标行为：

- 点击“添加新项目”稳定打开系统目录选择器。
- 选择目录后写入 `projectStore.selectProject(dir)`，左侧项目列立即出现项目 Tab 并切换过去。
- 取消选择不报错、不改变现有项目。

### 2.4 第二列没有项目列

涉及文件：

- `src/components/filetree/FileTreePanel.vue`
- `src/components/filetree/ProjectFileTree.vue`
- `src/layouts/WorkspaceLayout.vue`

当前第二列 Tab 只有在已有项目后才显示项目入口：

```ts
const tabItems = computed(() => [
  { key: 'history', icon: 'chat', label: '会话' },
  ...(isDesktop && projectStore.hasProject.value ? [
    { key: 'project', icon: 'folder', label: '项目' },
  ] : []),
])
```

这会造成一个产品死循环：

- 没有项目时，第二列没有“项目”Tab。
- 用户只能依赖 ChatPanel 顶部项目选择器添加项目。
- 如果顶部项目选择器在 Intel Mac 上失效，第二列也没有备用入口。

目标行为：

- 桌面端第二列始终显示“项目”Tab。
- 无项目时，`ProjectFileTree` 显示空态和“选择项目文件夹”按钮。
- 选中项目后自动加载文件树，保留已有“会话/文本”行为。

### 2.5 顶部白色窄边

涉及文件：

- `src-tauri/tauri.conf.json`
- `src/styles/base.css`
- `src/layouts/WorkspaceLayout.vue`

当前 Tauri 窗口配置：

```json
"decorations": true,
"transparent": false
```

截图中顶部白边是 macOS 原生标题栏/工具栏区域，APP 内容从其下方开始。Apple Silicon 上可能不明显，但 Intel Mac 的 WKWebView/窗口装饰渲染更容易暴露为白色窄边。

目标行为：

- 顶部不出现白色窄边。
- 仍保留 macOS 红黄绿窗口控制按钮可用。
- 主内容从窗口可视区域顶部开始，背景色与 APP 主题一致。

优先方案：

- 将窗口切到无边框 `decorations: false`。
- 新增自定义 titlebar/drag region，高度约 32px，背景使用 `var(--bg)`。
- macOS 用 CSS 给左上角窗口按钮区域留出空间。

备选方案：

- 若无边框窗口导致 macOS traffic lights 体验不可接受，则保留 `decorations: true`，用窗口背景色和根容器背景色消除视觉白边。但这通常不能完全控制系统标题栏。

### 2.6 Skill 仓库报 `Failed to resolve Central Skills root: No such file or directory`

涉及文件：

- `src-tauri/src/skills/skills.rs`

当前 `skills.rs` 中有两个获取 central root 路径的函数:

```rust
// 安全：先 create_dir_all 再 canonicalize
async fn ensure_central_root_path(pool: &DbPool) -> Result<PathBuf, String> { ... }

// 不安全：直接 canonicalize，目录不存在就炸
async fn central_root_path(pool: &DbPool) -> Result<PathBuf, String> { ... }
```

5 个调用点里 **4 个用了不安全的 `central_root_path()`**，只有 1 个用了 `ensure_`:

| 行号 | 函数 | 使用的变体 | 安全? |
|---|---:|---:|
| 1153 | `save_central_skill_impl` | `ensure_central_root_path` | ✅ |
| 1203 | `get_central_skill_bundles_impl` | `central_root_path` | ❌ |
| 1255 | `get_central_skill_bundle_detail_impl` | `central_root_path` | ❌ |
| 1292 | `preview_delete_central_skill_bundle_impl` | `central_root_path` | ❌ |
| 1310 | `delete_central_skill_bundle_impl` | `central_root_path` | ❌ |

根因链路：

1. **启动时**：`seed_preset_skills` 异步创建 `~/.agents/skills/`，跑在 `tauri::async_runtime::spawn` 里。Intel Mac 上 `preset_skills_src` 可能为 `None`（资源目录路径解析失败），目录从未被创建。
2. **首次使用**：走了 `scan_all_skills` 路径，可能因为 `scan_all_skills_impl` 内部有其他逻辑暂未触发此错误。
3. **几分钟后刷新 Skill 仓库**：前端调 `get_central_skill_bundles` → `central_root_path()` → `.canonicalize()` 在目录不存在时直接抛 `ENOENT`。

目标行为：

- 无论 `~/.agents/skills/` 是否存在，打开 Skill 仓库都不报此错误。
- 目录不存在时自动创建（`create_dir_all`），与 `save_central_skill_impl` 保持一致。

---

## 3. 修复设计

### 3.1 菜单类交互统一加固

适用对象：

- 模型选择器
- 项目选择器

设计：

- 所有打开菜单的按钮事件显式 `stopPropagation()`。
- 菜单容器继续 `@click.stop`。
- 菜单项点击先执行业务，再关闭菜单，不在打开系统 dialog 前提前销毁必要上下文。
- 对容易被列容器裁剪的菜单，改为 Teleport 到 `body`，用按钮 `getBoundingClientRect()` 定位。

优先级：

1. 先做事件传播修复，改动最小。
2. 如果 Intel Mac 仍复现，再将模型菜单和项目菜单抽成 body-level popover。

### 3.2 Skill 扫描改成“复用扫描 + 失败降级”

前端 `skillsManageStore` 增加模块内 Promise 复用：

```ts
let scanAllSkillsPromise: Promise<ScanResult> | null = null

async function scanAllSkills() {
  if (scanAllSkillsPromise) return scanAllSkillsPromise
  isScanning.value = true
  error.value = null
  scanAllSkillsPromise = invoke<ScanResult>('scan_all_skills')
    .then(result => {
      lastScan.value = result
      return result
    })
    .catch(err => {
      error.value = errorMessage(err)
      throw err
    })
    .finally(() => {
      scanAllSkillsPromise = null
      isScanning.value = false
    })
  return scanAllSkillsPromise
}
```

`loadCentralSkills({ scan: true })` 调整为：

- 先尝试扫描。
- 如果扫描报 `scan already in progress`，不抛出阻断，而是继续读取 `get_central_skills`。
- 其他扫描错误也不清空已有列表；在 UI 显示错误，但保留 `centralSkills`。

Rust 侧作为第二道保险：

- 将锁超时从 30 秒提高到 120 秒，适配 Intel Mac 首次 seed/慢盘。
- 用 RAII guard 释放锁，保证 `scan_all_skills_inner` panic/早退时也清理。
- 并发请求可以保留错误返回，前端负责复用与降级；不在 Rust 侧排队，避免阻塞 Tauri command 池。

### 3.3 项目入口双路径

路径 A：ChatPanel 顶部项目选择器。

- 修复点击事件和 dialog 返回值兼容。
- `pickProjectFolder()` 接收 `string | string[] | null`，数组取第一项。
- 成功选项目后关闭菜单并刷新项目列。

路径 B：第二列项目 Tab。

- `FileTreePanel.tabItems` 在桌面端始终包含项目 Tab。
- 无项目时点击项目 Tab 进入 `ProjectFileTree` 空态。
- `ProjectFileTree` 空态添加“选择项目文件夹”按钮，复用同一套 `pickProjectFolder` 逻辑。

### 3.4 顶部白边处理

建议分两步做：

1. 新增 `AppTitlebar.vue`，仅桌面端显示：
   - 左侧为 macOS traffic lights 安全留白。
   - 中间显示“韭菜盒子”。
   - 整条设置 `data-tauri-drag-region`。
2. 修改 `tauri.conf.json`：
   - `decorations: false`
   - `transparent: false`

CSS：

- `html, body, #app` 保持 `height: 100%; background: var(--bg); overflow: hidden;`
- `WorkspaceLayout` 外层高度改为 `calc(100vh - var(--app-titlebar-height))`，或由 App 根布局统一纵向排列。

---

### 3.5 Skill Central Root 路径统一用 `ensure_` 变体

适用对象：

- `get_central_skill_bundles_impl`
- `get_central_skill_bundle_detail_impl`
- `preview_delete_central_skill_bundle_impl`
- `delete_central_skill_bundle_impl`

设计：

- 将上述 4 个函数中的 `central_root_path(pool)` 替换为 `ensure_central_root_path(pool)`。
- `ensure_central_root_path` 内部先 `create_dir_all` 再 `canonicalize`，幂等安全。
- 改动最小（每个函数改 1 行），不涉及前端、不影响其他模块。

验证：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

人工验收：

- 手动删除 `~/.agents/skills/` 目录后打开 Skill 仓库，不再报 `No such file or directory`。
- 正常使用 Skill 仓库（浏览/安装/卸载）不受影响。

## 4. 实施任务

### Task 1: 建立 Apple Intel 回归观测点

文件：

- 修改：`src/utils/tauriEnv.ts` 或新增 `src/utils/runtimeDiagnostics.ts`
- 修改：`src/components/settings/SettingsPanel.vue`

内容：

- 增加只读诊断信息：平台、架构、Tauri 是否可用、WebView userAgent。
- 在设置页或开发日志中显示，用于确认问题机器是 `macos/x86_64`。

验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
```

人工验收：

- Intel Mac 设置页能看到 `arch=x86_64`。
- Apple Silicon Mac 显示 `arch=aarch64` 或等价信息。

### Task 2: 修复模型选择器点击选择

文件：

- 修改：`src/components/chat/ChatPanel.vue`

改动：

- `toggleModelMenu(event?: Event)` 内调用 `event?.stopPropagation()`。
- 模板改为 `@click="toggleModelMenu($event)"`。
- `.cp-model-menu` 增加 `@click.stop`。
- `selectModel(model, event?)` 内调用 `event?.stopPropagation()`，再 `agentStore.setModel(...)`。
- 如果 Intel Mac 仍复现，将菜单 Teleport 到 `body`，并用按钮 rect 定位。

验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
```

人工验收：

- 点击模型按钮打开菜单。
- 点击任意模型后按钮文本立即变为新模型。
- 菜单关闭。
- 右侧设置面板打开时仍可选择模型。

### Task 3: 修复 Skill 扫描并发

文件：

- 修改：`src/stores/skillsManageStore.ts`
- 修改：`src-tauri/src/skills/scanner.rs`
- 修改：`src/components/skills/CentralSkillsPanel.vue`

改动：

- 前端 `scanAllSkills()` 增加 Promise 复用。
- `loadCentralSkills()` 对 `scan already in progress` 做降级读取，不清空 `centralSkills`。
- `CentralSkillsPanel.refresh()` 并行加载时避免重复 `loadCentralSkills({ scan: true })`。
- Rust 扫描锁超时调到 120 秒，并用 guard 释放。

验证：

```bash
pnpm exec vue-tsc -b
cargo check --manifest-path src-tauri/Cargo.toml
pnpm exec vite build
```

人工验收：

- 快速连续点击 Skill 仓库刷新，不再出现空列表。
- 打开 Skill 仓库时内置 JC-* Skill 可见。
- 同时打开聊天页 Skill picker 和 Skill 仓库，不出现阻断式 `scan already in progress`。

### Task 4: 修复项目选择器和第二列项目 Tab

文件：

- 修改：`src/components/chat/ChatPanel.vue`
- 修改：`src/components/filetree/FileTreePanel.vue`
- 修改：`src/components/filetree/ProjectFileTree.vue`
- 可选新增：`src/utils/projectPicker.ts`

改动：

- 抽出 `pickProjectFolder()` 公共函数，统一处理 Tauri dialog。
- ChatPanel 项目菜单按钮加事件阻止传播。
- 桌面端 `FileTreePanel` 始终显示“项目”Tab。
- `ProjectFileTree` 空态新增“选择项目文件夹”按钮。

验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
```

人工验收：

- 无项目状态下，第二列可见“项目”Tab。
- 点击项目 Tab 显示空态和选择按钮。
- 从 ChatPanel 顶部添加项目成功。
- 从第二列项目空态添加项目成功。
- 添加后第二列自动切到项目文件树。

### Task 5: 消除顶部白色窄边

文件：

- 修改：`src-tauri/tauri.conf.json`
- 修改：`src/layouts/WorkspaceLayout.vue` 或 `src/App.vue`
- 新增：`src/components/layout/AppTitlebar.vue`
- 修改：`src/styles/base.css`

改动：

- Tauri 主窗口改为 `decorations: false`。
- 新增自定义 titlebar，桌面端显示，Web 端不显示。
- titlebar 背景与主题一致，并设置拖拽区域。
- 主工作区高度扣除 titlebar 高度。

验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
pnpm exec tauri dev
```

人工验收：

- Intel Mac 顶部不再有白色窄边。
- 窗口可拖动。
- 红黄绿窗口按钮可用。
- 深色/浅色/护眼主题下顶部颜色一致。

### Task 6: 修复 Skill Central Root 路径 ENOENT

文件：

- 修改：`src-tauri/src/skills/skills.rs`

改动：

- `get_central_skill_bundles_impl` → `ensure_central_root_path`
- `get_central_skill_bundle_detail_impl` → `ensure_central_root_path`
- `preview_delete_central_skill_bundle_impl` → `ensure_central_root_path`
- `delete_central_skill_bundle_impl` → `ensure_central_root_path`

验证：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

人工验收：

- 删除 `~/.agents/skills/` 后打开 Skill 仓库，不报错，目录自动重建。
- 正常浏览/安装/卸载 Skill 不受影响。

---

## 5. 验证矩阵

| 场景 | Intel Mac | Apple Silicon Mac | Windows | Web |
|---|---:|---:|---:|---:|
| 模型选择器打开/选择/关闭 | 必测 | 回归 | 回归 | 回归 |
| Skill 仓库首次打开显示内置 Skill | 必测 | 回归 | 回归 | 不适用 |
| 快速重复刷新 Skill 仓库 | 必测 | 回归 | 回归 | 不适用 |
| ChatPanel 顶部添加项目 | 必测 | 回归 | 回归 | 不适用 |
| 第二列项目 Tab 无项目空态 | 必测 | 回归 | 回归 | 不适用 |
| 项目文件树加载 | 必测 | 回归 | 回归 | 不适用 |
| 顶部白边消失 | 必测 | 回归 | 回归 | 不适用 |
| 窗口拖动/最小化/关闭 | 必测 | 回归 | 回归 | 不适用 |
| Skill 仓库 Central Root 目录缺失恢复 | 必测 | 回归 | 回归 | 不适用 |

最低命令验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## 6. 不做事项

- 不做全量跨平台审计——本次仅修复已发现的六个问题及其同类模式。全面审计见 §10 落地优先级。
- 不砍直连/本地模式；该决策仍看 `docs/sdd/app-opencode-only-sdd.md`。
- 不修改 NewAPI、rh-adapter。
- 不恢复画布。
- 不重构 `ChatPanel.vue` 大结构。
- 不改 OpenCode session/project/tool 三层隔离。

---

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---:|---|
| `decorations: false` 后 macOS 窗口按钮区域体验变化 | 高 | 先在 Intel Mac/Apple Silicon 双机验证；必要时回退为保留原生装饰，仅调整背景 |
| Windows 路径跳转/文件锁/WebView2 同类问题未覆盖 | 中 | 本次修复优先 macOS 双架构；Windows 对等验证列入 §10 第 1 周计划 |
| Skill 扫描降级掩盖真实扫描失败 | 中 | UI 保留错误提示，日志记录原始错误；列表不清空 |
| 菜单 Teleport 影响移动端 | 低 | 仅桌面端菜单使用 body popover，移动端保持现状 |
| 项目 Tab 常驻增加第二列拥挤 | 低 | 当前桌面宽度足够；手机端 Rail 逻辑不变 |

---

## 8. 建议提交顺序

1. `fix: use ensure_central_root_path in all central skill bundle ops`
2. `fix: stabilize model and project popovers on mac`
3. `fix: dedupe skill scans and preserve skill list`
4. `fix: always expose project tab on desktop`
5. `fix: replace native titlebar on mac desktop`

每个提交独立跑验证，方便在 Intel Mac 上逐项二分。

---

## 9. 根因复盘：为什么 M 芯片正常、Intel 炸了

代码完全一样。问题不出在 Tauri 跨平台层（Tauri API 在所有架构上行为一致），出在我们写的代码有 bug，M 芯片太快把 bug 藏住了。

### 九大反模式（本次六个问题的真正根因）

| # | 反模式 | 对应问题 | 为什么 M 不炸 |
|---|--------|----------|---------------|
| 1 | 异步创建资源 → 同步消费，中间没 await | Skill Central Root ENOENT | spawn 在消费前跑完了 |
| 2 | 多入口并发调同一 `invoke`，无去重 | scan already in progress | 第一次瞬间完成，第二次来时锁已释放 |
| 3 | 全局 click 关闭弹窗 + 弹窗内 click 无 stopPropagation | 模型选择器点不了 | 事件循环时序碰巧对 |
| 4 | 关 UI → 立刻开系统对话框 | 项目选择器不响应 | AppKit 焦点转移够快 |
| 5 | `canonicalize()` 无前置 `create_dir_all` | Central Root ENOENT | 目录已被前面的操作创建 |
| 6 | 资源路径用 `../../..` 相对跳转 | seed_preset_skills 可能静默失败 | dev/prod 目录层级碰巧一致 |
| 7 | 锁超时写死 30s，无 RAII guard | scan already in progress 误判 | 扫描 30s 内必完成 |
| 8 | `dialog.open` 返回值只处理 `string` 不处理 `string[]` | 项目选择器返回值丢失 | 单选碰巧返回 string |
| 9 | 产品入口依赖「已有项目」才显示 | 第二列无项目 Tab | 无项目时碰巧没用到这个入口 |

### Windows 会怎样

以上模式在 Windows 上同样会炸，只是触发条件不同：

- **时序竞态**：Windows 上 WebView2 的 IPC 延迟和文件系统性能与 macOS 不同，竞态窗口大小也不同。代码有 bug 就是有 bug。
- **路径问题**：`resolve_home_dir()` 在 Windows 上走 `USERPROFILE`，`~/.agents/skills` 会变成 `C:\Users\xxx\.agents\skills`。`path_utils.rs` 已处理，但 `../../..` 相对跳转在 Windows 的 `target\debug\` 层级下肯定不同。
- **文件锁**：Windows 的文件锁比 Unix 严格。`seed_preset_skills` 的原子复制（tmp → rename）在 Windows 上如果目标被占用会失败，而 Unix 上 `rename` 是原子的。
- **WebView 差异**：Windows 用 WebView2（Edge Chromium），macOS 用 WKWebView。CSS 渲染、事件冒泡时序可能有差异。

**结论**：这次六个问题修完后，Windows 端的同类风险依然存在——尤其是路径跳转、文件锁、锁超时这三类。建议后续在 Windows 实机上做一轮对等验证。

---

## 10. 顶尖团队怎么做多平台发布：从方法到落地

以下不是理论——是 Google Chrome 团队、Microsoft Windows 团队、Mozilla Firefox 团队实际在用的工程方法。每一步都给出在我们项目里的具体落地方式。

---

### 方法一：让每台机器都变慢（CPU Throttle 测试）

**核心思想**：在你的 M 芯片 Mac 上故意把 CPU 降速到 Intel 级别，跑一遍冒烟测试。竞态窗口会被放大到肉眼可见。

**怎么做**：

```bash
# 1. 安装 cpulimit（macOS）
brew install cpulimit

# 2. 启动 Tauri dev
pnpm exec tauri dev &

# 3. 找到 WebView 进程 PID 和 Rust backend PID，各限速到 30%
pgrep -f "jiucaihezi" | while read pid; do
  cpulimit -p $pid -l 30 &
done

# 4. 手动操作一遍关键路径（Skill 仓库、项目选择器、模型切换）
# 5. 观察是否有竞态问题
```

**进阶**：用 Xcode Instruments 的 "System Trace" 模板录制 Intel Mac 上的启动时序，对比 M 芯片的同一条路径，找到哪些操作在 Intel 上慢了 3 倍以上——那些就是需要加 await/去重/防御的地方。

**落地建议**：在 Release Checklist 里加一条：「发版前用 cpulimit 限速 30% 跑一遍冒烟」。

---

### 方法二：并发确定性模拟（Rust loom）

**核心思想**：Tokio 团队开发的 `loom` 库，不依赖硬件速度——它在单线程里系统性地穷举所有可能的并发执行顺序。你的代码如果有一个竞态 bug，`loom` 会在几秒内找到一个触发序列。

**怎么落地**：

```rust
// 把 AtomicBool + 时间戳锁 替换为 loom 可模拟的版本
#[cfg(test)]
use loom::sync::atomic::AtomicBool;
#[cfg(not(test))]
use std::sync::atomic::AtomicBool;
```

只对核心并发路径做（如 `scan_all_skills` 的锁逻辑、`seed_preset_skills` 的临时目录原子 rename），不用全量改造。

**第一步**：在 CI 加一个 job，跑 `cargo test --features loom`。

**预期收益**：`scan already in progress` 这类并发撞锁问题，loom 能直接在 M 芯片 CI 上复现，不需要 Intel Mac。

---

### 方法三：属性测试（Property-Based Testing）

**核心思想**：不写「输入 A 应该返回 B」的测试，而是写「无论什么输入，这个函数不应该 panic / 不应该在目录不存在时直接 canonicalize」。测试框架（`proptest` for Rust）自动生成海量随机输入。

**怎么落地**——针对这次最大的坑：

```rust
// 测试：任何路径，先 ensure 再 read 永远不会 ENOENT
proptest! {
  fn any_path_ensure_then_read_never_enoent(path in ".*") {
    let root = ensure_central_root_path(&pool).await.unwrap();
    assert!(root.exists());
  }
}
```

**第一步**：给 `ensure_central_root_path`、文件写入、dialog 返回值解析这三个最容易出跨平台问题的函数加上属性测试。

---

### 方法四：多架构 CI + 冒烟测试（最基础的防线）

**核心思想**：GitHub Actions 提供 `macos-14`（M 芯片）和 `macos-13`（Intel）两种 runner。每个 PR 在两个平台上跑同一套测试。CI 不过，不能 merge。

**具体配置**（在 `.github/workflows/build.yml` 中加一个 job）：

```yaml
cross-platform-smoke:
  strategy:
    matrix:
      os: [macos-14, macos-13, windows-latest]
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/checkout@v4
    - run: cargo check --manifest-path src-tauri/Cargo.toml
    - run: pnpm exec vue-tsc -b
    - run: pnpm exec vite build
    # 冒烟：启动 Tauri headless，执行关键路径脚本
    - run: pnpm exec tauri dev --headless &
    - run: node scripts/smoke-test.mjs   # 模拟用户操作
```

**`scripts/smoke-test.mjs`** 示例（用 Playwright 驱动 Tauri WebDriver）：

```js
// 1. 打开 Skill 仓库 → 确认 JC-* 列表不为空
// 2. 点击模型选择器 → 切换模型 → 确认生效
// 3. 添加项目文件夹 → 确认第二列出现项目 Tab
// 4. 刷新 Skill 仓库 3 次 → 确认不报 scan already in progress
```

**第一步**：先加构建矩阵（`cargo check + build`），再加冒烟脚本。前者今天就能做，后者需要 1-2 天写脚本。

---

### 方法五：错误遥测按平台拆分

**核心思想**：Chrome 团队不会等到用户报告 bug——他们在代码里埋了 `UMA`（用户行为指标），按 `os + arch` 维度看崩溃率。Windows / Intel Mac / M 芯片三条曲线应该接近——如果某条突然高出一截，自动告警。

**怎么落地**（桌面端已有 `tauri-plugin-log` 的基础）：

1. Rust 侧：每个 `eprintln!("[JC]")` 改为结构化日志，附加 `platform = std::env::consts::OS, arch = std::env::consts::ARCH`。
2. 前端侧：`window.addEventListener('error')` 和 `unhandledrejection` 捕获时，附加 `navigator.userAgent` 中的架构信息。
3. 服务端（NewAPI）：新增一个 `/api/telemetry` 端点，接收匿名错误摘要，按 `platform×arch` 聚合。
4. 设置页加一个「发送错误报告」开关（默认关，用户手动开）。

**第一步**：今天先把关键路径的错误日志带上 `arch` 字段，这样下次 Intel Mac 用户报问题时，日志里直接能看到 `arch=x86_64`。

---

### 方法六：慢机器虚拟机——穷人的 Intel Mac

**核心思想**：开发机上跑一个限速的虚拟机或 Docker 容器，模拟慢 CPU + 慢磁盘。

**怎么做**：

```bash
# 用 UTM（免费）在 M 芯片 Mac 上跑 macOS x86_64 虚拟机
# 分配 2 核 CPU、4GB 内存、限速 I/O
# 在这个虚拟机里跑 pnpm exec tauri dev
```

或者更轻量：

```bash
# Docker 限速启动（用于测试 Rust backend 的 I/O 竞态）
docker run --cpus=1 --memory=2g --blkio-weight=10 \
  -v $(pwd):/app -w /app rust:latest \
  cargo test --manifest-path src-tauri/Cargo.toml
```

**第一步**：不需要完整的 macOS 虚拟机。先在 Docker 里用 `--cpus=1 --blkio-weight=10` 跑 Rust 测试，就能暴露 I/O 竞态问题。

---

### 方法七：时间旅行调试（rr）

**核心思想**：Mozilla 的 `rr`（Record & Replay）能录制进程的完整执行轨迹，包括所有线程调度、系统调用、信号。在 Intel Mac 上录制一次崩溃，然后在你的 M 芯片 Mac 上无限次回放、反向执行、逐指令调试。

**怎么做**：

```bash
# Intel Mac 上
rr record ./src-tauri/target/debug/jiucaihezi-app
# 操作到崩溃
# 复制 RR 录制目录到 M 芯片 Mac
rr replay
```

限制：`rr` 主要支持 Linux。macOS 替代方案是用 `lldb` 的 `watchpoint` + `thread backtrace all`。但思想一样——把崩溃现场完整录下来，不要靠用户描述「大概过了几分钟」。

---

### 落地优先级（按我们能做的排）

```
第 0 天（今天就能做）：
  ├─ 方法一：brew install cpulimit，限速跑一轮冒烟（30 分钟）
  ├─ 方法四：CI 加 macos-13 + windows-latest runner（改 .github/workflows/build.yml，1 小时）
  └─ 方法五：关键路径日志加 arch 字段（改 3-5 处 eprintln!，30 分钟）

第 1 周：
  ├─ 方法四：写 3 个 Playwright 冒烟脚本（1-2 天）
  ├─ 方法三：给 3 个核心函数加 proptest（半天）
  └─ 方法七：配置 lldb watchpoint 录制脚本（半天）

第 1 月：
  ├─ 方法二：核心并发路径加 loom 测试（1-2 天）
  ├─ 方法五：/api/telemetry 端点 + 按平台聚合（2 天）
  └─ 方法六：Docker 限速环境集成到 CI（1 天）
```

---

### 一句话总结

> 不是写更多测试，是让 bug 在你开发用的 M 芯片上就能复现。方法一到七的本质都是同一件事：**把快机器变慢、把随机时序变确定、把单平台变多平台**。哪个方法你今天下午就能跑，就从哪个开始。

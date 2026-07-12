# dabao — Intel Mac / Windows 打包发布修复方案

> 分支：`dabao`
> 日期：2026-06-27
> 状态：SDD（待 CI 验证）

---

## 1. 结论

本次修复范围：

- **Intel Mac**：CI 从 ARM64 交叉编译改为原生 Intel runner + 崩溃 smoke test
- **Windows**：portable zip 可用性增强（README + 内容完整性校验 + WebView2 排障提示）
- **Windows 🔴**：修复 `tauri.localhost` 误判导致所有 API 请求失败（登录/Key/媒体生成全线崩溃）
- **UI**：输入区控件重组（指令+文/武/直连移出输入框、删除 OpenCode 命令按钮、帮助新增命令列表）
- **两端**：启动日志补全平台信息，方便实机排障

不做：MSI/NSIS 安装器、自动更新、Linux 构建、业务功能修改。

---

## 2. Intel Mac

### 2.1 问题

GitHub Actions `macos-latest` 当前是 ARM64（M 系列）runner。`macos-intel` job 在其上通过 `rustup target add x86_64-apple-darwin` 交叉编译。以下 C/asm 依赖在交叉编译时有已知风险：

- `libsqlite3-sys` — C 编译时 cc crate 可能误判 target arch
- `ring` — 含 per-arch 汇编，交叉编译需精确 `TARGET` 环境变量
- 系统 framework linker 路径 — `x86_64-apple-darwin` target 可能找不到 Xcode SDK 中的 x86_64 slice

证据：`docs/intel-mac-app-boot-stuck-fix.md` 记录了 Intel DMG 卡 logo 问题；deep link 修复后仍有交叉编译这一候选根因未排除。

### 2.2 修复

CI `macos-intel` job 的 `runs-on`：

```yaml
# 之前（ARM64 交叉编译）
runs-on: macos-latest

# 之后（原生 Intel）
runs-on: macos-15-intel
```

**依据**：GitHub 已公告 `macos-13` 退役，推荐 `macos-15-intel` 作为 Intel Mac runner。原生编译消除所有交叉编译不确定性。

**风险**：🟡 中 — `macos-15-intel` 是较新的 runner 标签，供给可能受限。fallback 方案见 §2.3。

### 2.3 fallback（当 macos-15-intel 不可用时）

```yaml
runs-on: macos-13  # 最后原生 Intel runner，已 deprecated
```

若 `macos-13` 也已下线，改用交叉编译 + 显式环境变量：

```yaml
runs-on: macos-latest
env:
  SDKROOT: /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
  CARGO_BUILD_TARGET: x86_64-apple-darwin
  MACOSX_DEPLOYMENT_TARGET: 10.15
```

### 2.4 崩溃 smoke test

新增与 ARM job 对标的 smoke test（挂载 DMG → 校验 sidecar 二进制非占位脚本 → 校验 APP 架构为 x86_64 → 启动 15s 内不崩溃）。

注意：smoke test 只验证"不崩溃"，不验证 UI 可用性。UI 可用性需实机验证（§5.3）。

---

## 3. Windows

### 3.1 WebView2 依赖说明

Tauri v2 不像 Electron 不自带 Chromium。Windows 上必须依赖系统 WebView2 Runtime。若 WebView2 完全缺失，Tauri 自身弹原生错误对话框引导安装。

本次增强的是**排障提示**（两类）：

| 类型 | 位置 | 触发条件 | 用户可见 |
|:---:|------|---------|:---:|
| 桌面启动日志 | `lib.rs` `run()` | WebView2 缺失 | stderr（Event Viewer 可查） |
| Web 版浏览器提示 | `main.ts` | 非 Edge 浏览器 | confirm 弹窗 |

**注意**：JS 代码在 WebView2 完全缺失时不会执行（WebView 未启动）。JS 提示覆盖的是 Web 版用户在非 Edge 浏览器打开的场景，以及桌面版 WebView2 版本过旧但进程仍可启动的边缘情况。

Rust 日志改善：明确打印 ✅/❌ 状态 + 检查过的具体路径，而非仅 `eprintln!` 一句话。

### 3.2 portable zip README

zip 内自动生成 `README.txt`（UTF-8 中文，CI 步骤内嵌），内容：

1. 解压后再运行（禁止 zip 内直接双击）
2. WebView2 Runtime 下载链接（Windows 11 通常已自带）
3. 卡 logo 排障：确保 exe 同目录、管理员运行、杀毒软件白名单
4. 数据目录：`%APPDATA%\com.jiucaihezi.desktop\`
5. 问题反馈 GitHub Issues 链接

### 3.3 zip 内容完整性校验

新增 CI smoke test：解压 zip → 校验以下文件存在：

- `韭菜盒子.exe`
- `opencode-x86_64-pc-windows-msvc.exe`
- `README.txt`

校验失败 → CI 直接报错，防止残缺 zip 被发布。

### 3.4 🔴 P0：Windows `tauri.localhost` 误判修复

**根因**：Tauri v2 的 WebView origin 因平台而异：

| 平台 | `window.location.origin` |
|------|--------------------------|
| macOS / Linux | `tauri://localhost` |
| **Windows** | **`https://tauri.localhost`** |

代码中 3 处 `localhost` 检测仅排除了 `tauri://` 前缀：
```js
if (!origin.startsWith('tauri://') && origin.includes('localhost'))
```

Windows 上 `https://tauri.localhost` 不匹配 `tauri://` 但匹配 `localhost` → 误判为 dev 模式 → API base 覆写为 `/__jc_api`（Vite proxy 路径，打包版不存在）→ 所有请求返回 HTML 404 → 触发「账号登录服务尚未接入统一 API」。

**影响面**（3 个文件，同一根因）：

| 文件 | 受影响功能 | 用户症状 |
|------|-----------|----------|
| `src/services/newApiClient.ts` `getGatewayBaseUrl()` | 一键登录、API Key 验证 | 登录失败 |
| `src/utils/api.ts` `resolveApiConfig()` | 直连模式对话 | 填 Key 也无法用 |
| `src/api/media-generation.ts` `getApiBase()` | 创作面板媒体生成 | 生成失败 |

**修复**：三处均改为 `isTauriOrigin` 变量同时检查两种 Tauri origin 格式：
```ts
const isTauriOrigin = origin.startsWith('tauri://') || origin.includes('tauri.localhost')
if (!isTauriOrigin && origin.includes('localhost')) { return '/__jc_api' }
```

**教训**：macOS 开发/打包均无法发现此 bug（macOS origin 是 `tauri://localhost`，guard 生效）；只有 Windows 打包版触发。CI 只编译不运行，无法发现运行时平台差异。

---

### 3.5 UI 调整：输入区控件重组

**改动**（`src/components/chat/ChatPanel.vue`）：

1. 「指令」按钮从输入框内移到 SkillPickerBar 下方新工具栏行（与文/武/直连同排）
2. 「文/武/直连」模式选择器从输入框内移到同一工具栏行
3. OpenCode 命令按钮（⌘ 图标）删除 — 功能已被工具栏替代
4. OpenCode 常用命令整理为帮助引导卡片 ⑦（`src/layouts/WorkspaceLayout.vue`）— 含 /help、/models、/clear、/compact、/cost 等 12 条常用命令

---

## 4. 启动日志增强

`__JC_BOOT_LOG__` 首条记录：

```
platform=MacIntel, userAgent=Mozilla/5.0 ...
isTauri=true, buildId=web-direct-20260615-boot-guard
```

实机排障时第一步即可知晓运行平台和环境，无需猜测。

---

## 5. 验证矩阵

### 5.1 本地构建验证（模板）

> 以下为验证记录模板。执行验证后填入实际值。

```bash
# 机器架构
uname -m                    # 填入: ____
# 分支 / commit
git rev-parse --short HEAD  # 填入: ____

# 编译检查
pnpm exec vue-tsc -b        # 期望: 0 errors, 实际: ____
cargo check 2>&1 | tail -5  # 期望: 0 new errors, 实际: ____
pnpm exec vite build        # 期望: built in ~2s, 实际: ____
cargo test --manifest-path src-tauri/Cargo.toml  # 期望: all pass, 实际: ____
```

### 5.2 CI 验证

```bash
git tag v1.0.16-dabao-rc1
git push origin v1.0.16-dabao-rc1
```

检查项：

- [ ] Intel Mac job: `macos-15-intel` runner 可用
- [ ] Intel Mac 崩溃 smoke test 通过
- [ ] Windows zip 内容完整性校验通过
- [ ] 三个 job 的 artifact 均上传到 Release

### 5.3 Intel Mac 实机验证

1. 下载 `韭菜盒子_*_x64.dmg`
2. 在 Intel Mac 上安装、打开
3. 验证：**15 秒内不崩溃 + 能进入主界面**；若卡 logo 查 boot log
4. 若卡 logo：打开 Console.app → 搜索 `[JC-boot]`，将日志贴入 issue
5. `__JC_BOOT_LOG__` 应包含 `platform=...` 首条日志

### 5.4 Windows 实机验证

1. 下载 `韭菜盒子_*_x64_windows_portable.zip`
2. 解压（优先解压到无特殊字符路径；如失败再换纯英文路径）
3. 阅读 `README.txt`
4. 双击 `韭菜盒子.exe`
5. 若无 WebView2：按 Tauri 弹框或 README 链接安装后重试
6. 验证：30 秒内不崩溃 + 能进入主界面

---

## 6. 发布检查清单

打正式 release tag 前逐项确认：

- [ ] tag 命名：`v<semver>`（如 `v1.0.16`）
- [ ] Intel DMG artifact 名称含 `x64` 标识
- [ ] Windows zip artifact 名称含 `x64_windows_portable` 标识
- [ ] 每个 artifact 有对应 `.sha256` 文件
- [ ] Release notes 写明 Windows 依赖 WebView2 Runtime
- [ ] Release notes 含下载链接和 SHA256 校验命令
- [ ] `macos-15-intel` runner 可用（若不可用已切到 fallback §2.3）

---

## 7. 已知风险

| 风险 | 等级 | 说明 |
|------|:--:|------|
| `macos-15-intel` runner 退役 | 🟡 中 | GitHub 可能在 2027 年下线所有 Intel runner。届时只能回退到 ARM64 交叉编译 + 显式 SDKROOT |
| Apple 签名证书过期 | 🟡 中 | `APPLE_SIGNING_IDENTITY` secret 若过期，Intel DMG 可能被 Gatekeeper 拒绝。临时方案：ad-hoc 签名 |
| Windows 无安装器 | 🟢 低 | portable zip 对小白用户不够友好。WiX light.exe 曾 CI 失败，待后续解决 |
| 崩溃 smoke test 假阴性 | 🟢 低 | DMG 挂载在 CI ARM runner 上测 Intel 二进制，`file` 命令可校验架构但无法真正执行 x86_64 指令 |
| WebView2 版本过旧 | 🟢 低 | Tauri 自身有最低版本检查，但老版本可能渲染异常。README 不含版本检测指引（Microsoft 建议用 registry 而非固定路径查版本） |

---

## A. 修改文件清单

| 文件 | 改动 |
|------|------|
| `.github/workflows/build.yml` | Intel runner → `macos-15-intel` + Intel 崩溃 smoke test + Windows README 生成 + Windows zip 内容完整性校验 |
| `src/services/newApiClient.ts` | 🔴 `getGatewayBaseUrl()`: `tauri.localhost` 排除（Windows 登录修复） |
| `src/utils/api.ts` | 🔴 `resolveApiConfig()`: `tauri.localhost` 排除（Windows Key 修复） |
| `src/api/media-generation.ts` | 🔴 `getApiBase()`: `tauri.localhost` 排除（Windows 创作修复） |
| `src/components/chat/ChatPanel.vue` | UI: 指令+文/武/直连移到输入框上方工具栏，删除 OpenCode 命令按钮 |
| `src/layouts/WorkspaceLayout.vue` | UI: 帮助引导新增 ⑦ OpenCode 常用命令列表 |
| `src-tauri/src/lib.rs` | Windows WebView2 检测日志增强（检查路径 + ✅/❌ 明确标识） |
| `src-tauri/tauri.conf.json` | 新增 `bundle.windows`（wix/nsis null, sha256） |
| `src/main.ts` | WebView2 JS 提示文案优化 + bootLog 平台信息 |

## B. 参考

- Intel Mac 修复前因：`docs/intel-mac-app-boot-stuck-fix.md`
- CI workflow：`.github/workflows/build.yml`
- 启动架构：`CLAUDE.md` §12
- Tauri WebView2 依赖：<https://v2.tauri.app/start/prerequisites/#windows>
- Microsoft WebView2 分发：<https://developer.microsoft.com/en-us/microsoft-edge/webview2/>
- GitHub runner 退役公告：<https://github.com/actions/runner-images/issues>（搜索 `macos-13 deprecation`）

# 三平台发布产物可用性门禁 SDD

> **日期**: 2026-06-22（修订版，吸收 codex 审查意见）
> **分支**: `shenji`（基于 `desktop`）
> **目标**: 用户从 GitHub Releases 下载 → 安装 → 启动 → 登录/Key → 对话/OpenCode/创作/画布/本地工具/存储恢复，全链路三平台实测通过
> **审查**: codex（发布工程 + 产物门禁 + 签名公证 + 外部依赖不可伪装）
> **参考**: `CLAUDE.md` §16-17、`AGENTS.md` §9、`/memories/repo/timeout-retry-audit-findings.md`

---

## 0. 执行摘要

当前问题不是"有些功能在某个平台上有 bug"，而是**用户下载后无法信任产物、无法确认所有功能真正可用**。具体表现：

1. **版本乱**：Git tag `v1.0.6`，但 `package.json`/`tauri.conf.json`/`Cargo.toml` 分别是 `1.0.5`/`1.0.5`/`1.0.0`，DMG asset 名也不一致。用户会下错，排障会混乱，未来自动更新会乱。
2. **macOS 无签名公证**：`signingIdentity: "-"`（ad-hoc），用户从 GitHub 下载后 Gatekeeper 阻拦，需右键打开。小白用户直接放弃。
3. **sidecar 不可信**：Intel DMG 里的 ffmpeg 实际是 ARM 二进制；whisper-cli 是占位脚本。但功能 UI 里「转文字」「视频解说」仍正常显示，用户点了就报错。
4. **外部依赖伪装**：`document_to_markdown` 可能依赖系统 Python/markitdown，用户只下载 APP 时没有这些。

**本 SDD 的核心转变**：从「跨平台缺口修复清单」升级为 **「发布产物可用性门禁」**。每个 Release 产物必须完成安装、启动、鉴权、对话、OpenCode、创作、画布、本地工具、存储恢复的实测闭环。

---

## 1. 当前版本基线（事实调查）

| 位置 | 版本号 | 问题 |
|------|--------|------|
| Git latest tag | `v1.0.6` | — |
| `package.json` | `1.0.5` | 与 tag 不一致 |
| `src-tauri/tauri.conf.json` | `1.0.5` | 与 tag 不一致 |
| `src-tauri/Cargo.toml` | `1.0.0` | 从未更新 |
| GitHub Release asset | 带 `1.0.5` | 与 tag `v1.0.6` 不匹配 |
| 本地 `binaries/` | 仅 ARM64 | 无 Intel/Windows 二进制 |

---

## 2. 缺口总览（重排后）

### P0 — 发布产物可信（用户下载即用，必须修）

| # | 缺口 | 平台 | 为什么是 P0 |
|---|------|------|-------------|
| 1 | **版本号统一** | 所有 | 用户下错版本、排障混乱、自动更新不可做 |
| 2 | **macOS Developer ID 签名 + 公证** | Mac | Gatekeeper 阻拦 → 小白用户直接放弃 |
| 3 | **Windows WebView2 检测** | Win | Win10 无 WebView2 → APP 白屏/崩溃无提示 |
| 4 | **Intel ffmpeg 修复 + CI 架构强制校验** | Intel Mac | 下载后 ffmpeg 不可用，功能静默失败 |
| 5 | **Windows 剪贴板** | Win | 「一键抄配置」核心功能不可用 |
| 6 | **HTTP connect_timeout + SSE 空闲 watchdog** | 所有 | 网络异常时 APP 永久挂起 |
| 7 | **placeholder 二进制 → 功能降级为 Tier2** | 所有 | whisper-cli 占位脚本 → 「转文字」暴露但不可用 |
| 8 | **markitdown 外部依赖 → 云端优先** | 所有 | 文档转 Markdown 依赖系统 Python |

### P1 — 监控与更新（用户留存）

| # | 缺口 | 平台 |
|---|------|------|
| 9 | Sentry 崩溃上报（含 Authorization/用户输入脱敏） | 所有 |
| 10 | 新版本检测 + 引导下载（非静默更新） | 所有 |

### P2 — 健壮性（打磨）

| # | 缺口 | 平台 |
|---|------|------|
| 11 | CI 产物级 smoke test（含 sidecar 版本校验） | 所有 |
| 12 | Deep link 超时 3s→15s | Win |
| 13 | `resolve_local_binary` Unix 路径清理 | Win |

---

## 3. P0 详细方案 — 发布产物可信

### 3.1 版本号统一（同源生成）

**现状**：4 处版本号各写各的，Git tag 与产物名不一致。

**方案**：引入 `scripts/set-version.mjs`，一次改版本号，所有位置自动同步。

```js
// scripts/set-version.mjs
// 用法: node scripts/set-version.mjs 1.0.7
import { readFileSync, writeFileSync } from 'fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/set-version.mjs 1.0.7')
  process.exit(1)
}

// 1. package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = version
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

// 2. tauri.conf.json
const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
tauriConf.version = version
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n')

// 3. Cargo.toml (src-tauri/)
let cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
cargo = cargo.replace(/^version = ".*"/m, `version = "${version}"`)
writeFileSync('src-tauri/Cargo.toml', cargo)

console.log(`✅ 版本号已统一设置为 ${version}`)
console.log('   下一步: git add . && git commit -m "chore: bump to ${version}"')
console.log('         git tag v${version} && git push origin v${version}')
```

**产物命名规范**（CI 自动生成）：

```
韭菜盒子_1.0.7_aarch64.dmg
韭菜盒子_1.0.7_aarch64.dmg.sha256
韭菜盒子_1.0.7_x64.dmg
韭菜盒子_1.0.7_x64.dmg.sha256
韭菜盒子_1.0.7_x64_windows_portable.zip
韭菜盒子_1.0.7_x64_windows_portable.zip.sha256
```

**CI 改动要点**（`build.yml`）：
- 产物名从 `${GITHUB_REF_NAME}` 派生，去掉 `v` 前缀
- 上传 asset 后自动生成 `.sha256`
- Release body 注明校验说明

**涉及文件**：
- `scripts/set-version.mjs` — 新增
- `package.json` — 版本号
- `src-tauri/tauri.conf.json` — 版本号
- `src-tauri/Cargo.toml` — 版本号
- `.github/workflows/build.yml` — 产物命名 + sha256 生成
- `CLAUDE.md` §15.3 — 更新打 tag 流程

---

### 3.2 macOS Developer ID 签名 + 公证

**现状**：`tauri.conf.json` 中 `"signingIdentity": "-"`（ad-hoc 签名）。Gatekeeper 阻拦。

**目标**：用户双击 DMG → 拖入 Applications → 双击打开，全程无阻拦。

**前置条件**：Apple Developer Program 账号（$99/年），在 [developer.apple.com](https://developer.apple.com) 生成 Developer ID Application 证书。

**步骤**：

1. 获取证书：
```bash
# 在 macOS 上生成证书签名请求 → 上传到 Apple Developer → 下载 .cer
# 导入钥匙串
security import developerID_application.cer -k ~/Library/Keychains/login.keychain-db
```

2. 配置 Tauri：
```json
// tauri.conf.json
"bundle": {
  "macOS": {
    "minimumSystemVersion": "10.15",
    "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
  }
}
```

3. CI 公证（`build.yml` macOS jobs）：
```yaml
- name: Notarize macOS app
  env:
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  run: |
    # 公证 DMG
    xcrun notarytool submit *.dmg \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_PASSWORD" \
      --wait
    # 装订公证票据（离线验证）
    xcrun stapler staple *.dmg
```

**所需 GitHub Secrets**：
- `APPLE_ID` — Apple Developer 账号邮箱
- `APPLE_TEAM_ID` — 团队 ID（10 位字符）
- `APPLE_APP_SPECIFIC_PASSWORD` — App 专用密码（appleid.apple.com 生成）

**⚠️ 若短期无法获取证书**：在 Release Notes 首条写清「首次打开请右键 → 打开」，或 DMG 中附带说明文件。但这不是长期方案。

**涉及文件**：
- `src-tauri/tauri.conf.json` — `signingIdentity` + 公证配置
- `.github/workflows/build.yml` — 公证 step
- `docs/notes/` — 新增证书申请 SOP

---

### 3.3 Windows WebView2 检测

**现状**：Windows portable zip 解压即运行，Tauri v2 需要 WebView2 Runtime。Win11 自带，Win10 不一定。缺失时白屏或静默崩溃。

**方案**：Rust 侧启动早期检测 + JS 侧备选提示。

```rust
// src-tauri/src/lib.rs — setup hook 最前面
#[cfg(target_os = "windows")]
fn check_webview2() -> Result<(), String> {
    use std::path::PathBuf;
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    let pfx86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let candidates = [
        PathBuf::from(&pf).join("Microsoft/EdgeWebView/Application/msedgewebview2.exe"),
        PathBuf::from(&pfx86).join("Microsoft/EdgeWebView/Application/msedgewebview2.exe"),
    ];
    for path in &candidates {
        if path.exists() { return Ok(()); }
    }
    Err("WebView2 Runtime 未安装。请从 https://go.microsoft.com/fwlink/p/?LinkId=2124703 下载。".into())
}
```

JS 备选（如果 WebView2 缺失但 Tauri 仍启动到了前端）：
```ts
// src/main.ts — mountApp() 之前
if (isTauriRuntime() && /Windows/.test(navigator.userAgent)) {
  if (!/Edg\//.test(navigator.userAgent)) {
    alert('韭菜盒子需要 Microsoft Edge WebView2 Runtime。\n即将打开下载页面。')
    window.open('https://go.microsoft.com/fwlink/p/?LinkId=2124703', '_blank')
  }
}
```

**涉及文件**：
- `src-tauri/src/lib.rs` — `#[cfg(windows)]` WebView2 检测
- `src/main.ts` — JS 备选检测

---

### 3.4 Intel ffmpeg/ffprobe 修复 + CI 架构强制校验

**现状**：`brew install ffmpeg` 在 ARM runner 产出 ARM 二进制 → 伪装成 x86_64 打包。

**修复**：从 BtbN 静态构建源下载 + CI 强制校验架构。

```yaml
# build.yml — macos-intel job
- name: Download ffmpeg + ffprobe (darwin x64, static)
  run: |
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-lgpl-shared.tar.xz"
    curl -fSL "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp
    FFMPEG_DIR=$(find /tmp -name "ffmpeg" -path "*/bin/*" 2>/dev/null | head -1 | xargs dirname)
    cp "$FFMPEG_DIR/ffmpeg" src-tauri/binaries/ffmpeg-x86_64-apple-darwin
    cp "$FFMPEG_DIR/ffprobe" src-tauri/binaries/ffprobe-x86_64-apple-darwin
    chmod +x src-tauri/binaries/ffmpeg-x86_64-apple-darwin
    chmod +x src-tauri/binaries/ffprobe-x86_64-apple-darwin

    # ★ CI 强制架构校验
    echo "=== 架构校验 ==="
    for bin in ffmpeg-x86_64-apple-darwin ffprobe-x86_64-apple-darwin; do
      ARCH=$(file "src-tauri/binaries/$bin" | grep -oE 'x86_64|arm64')
      if [ "$ARCH" != "x86_64" ]; then
        echo "❌ $bin 架构为 $ARCH，期望 x86_64！CI 中断。"
        exit 1
      fi
      echo "✅ $bin: $ARCH"
    done
```

**同步规范 macOS ARM job**：也用静态下载（去 brew 依赖，保持构建一致性）。

**涉及文件**：仅 `.github/workflows/build.yml`

---

### 3.5 Windows 剪贴板（arboard）

**现状**：`write_clipboard_text` 用 `pbcopy` 仅 macOS，Windows 直接返回错误。

**修复**：引入 `arboard` crate。

**步骤**：

1. `src-tauri/Cargo.toml` 加 `arboard = "3"`
2. `src-tauri/src/lib.rs` 替换 `write_clipboard_text`：

```rust
use arboard::Clipboard;

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    if text.is_empty() { return Ok(()); }
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("剪贴板不可用: {e}"))?;
    clipboard.set_text(&text)
        .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}
```

**验收场景**：「一键抄配置」+ 消息右键复制 + 创作 URL 复制，三场景都走同一 native clipboard 通路。

**涉及文件**：
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`

---

### 3.6 HTTP 超时（connect_timeout + SSE 空闲 watchdog）

**codex 审查意见**：初版 SDD 建议的 total timeout（如 120s）会误杀长时间流式对话。SSE 流不能设短 total timeout。

**修正方案**：分层超时。

```rust
// lib.rs — http_request 和 http_request_stream
use std::time::Duration;

let client = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(10))    // ★ 连接超时（所有请求通用）
    .pool_idle_timeout(Duration::from_secs(90))
    .build()
    .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
```

**策略矩阵**：

| 请求类型 | connect_timeout | total timeout | 说明 |
|---------|:--:|:--:|------|
| 非流式（models/images/轮询） | 10s | JS 侧 `pickTimeoutForUrl()` 指定 | 短请求正常超时 |
| SSE 流式（chat/completions stream） | 10s | **不设 total** | 依赖 `stream.next().await` 自然等待 |
| SSE 空闲 watchdog（可选加固） | 10s | 120s 无 chunk → abort | JS 侧 `httpClient.ts` ReadableStream 包装 |

```ts
// src/utils/httpClient.ts — SSE idle watchdog（加固用，非必须）
function createIdleWatchdog(controller: AbortController, idleMs = 120_000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), idleMs)
  }
  reset()
  return { reset, clear: () => clearTimeout(timer) }
}
// 在 rustFetchStream 内部每收一个 chunk 调用 watchdog.reset()
```

**涉及文件**：
- `src-tauri/src/lib.rs` — 两个 HTTP handler 加 `.connect_timeout()`
- `src/utils/httpClient.ts` — 可选 SSE idle watchdog

---

### 3.7 Placeholder 二进制 → 功能降级为 Tier2

**现状**：CI 生成 `whisper-cli` 占位脚本（echo "not bundled"），但 `toolRegistry.ts` 中的 `local_media_transcribe`（转文字）和 `local_video_narrate`（视频解说）仍然暴露。

**方案**：功能分级 + 真实验测。

```
Tier 1: 下载即用 — ffmpeg / ffprobe / yt-dlp / opencode / Chrome(检测到)
Tier 2: 需安装 — whisper-cli (转文字/视频解说) / markitdown (本地文档转换)
Tier 3: 纯云端 — LLM / OpenCode / 创作 / 画布 / OCR / Office
```

**落实到代码**：

1. Rust 侧加 `check_whisper_available` command——检测 sidecar 是否真实二进制、模型是否存在：
```rust
#[tauri::command]
fn check_whisper_available() -> Result<bool, String> {
    let bin = resolve_app_media_binary("whisper-cli")?;
    // 占位脚本通常 < 1KB
    let meta = std::fs::metadata(&bin).map_err(|e| e.to_string())?;
    if meta.len() < 2048 { return Ok(false); }
    // 尝试运行 --version（超时 5s）
    let output = StdCommand::new(&bin).arg("--version")
        .stdout(Stdio::piped()).stderr(Stdio::piped())
        .output().map_err(|e| e.to_string())?;
    Ok(output.status.success())
}
```

2. `localCapabilities.ts` 中 whisper check 改为真实验测（不再信任 localStorage flag）：
```ts
{
  id: 'whisper',
  name: '语音转文字',
  critical: false,
  check: async () => {
    if (!isTauriRuntime()) return false
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke('check_whisper_available')
    } catch { return false }
  },
  setup: async () => {
    window.dispatchEvent(new CustomEvent('jc-open-whisper-setup'))
  },
}
```

3. `toolRegistry.ts` 给 Tier2 工具加 `requiresSetup: true`，UI 显示「需安装」标签。

4. `LocalCapabilitySetup.vue` 中 Tier2 能力显示安装引导按钮而非「跳过」。

**涉及文件**：
- `src-tauri/src/lib.rs` — 新增 `check_whisper_available`
- `src/utils/localCapabilities.ts` — whisper check
- `src/utils/toolRegistry.ts` — Tier2 标记
- `src/utils/localContentTools.ts` — 工具定义加 `tier` 字段
- `src/components/settings/LocalCapabilitySetup.vue` — Tier2 引导

---

### 3.8 markitdown 外部依赖 → 云端优先

**现状**：`document_to_markdown` 在桌面端可能依赖系统 Python + markitdown。用户只下载 APP 时没有。

**方案**：两路 fallback。

```
document_to_markdown 调用链：
  1. 优先走 8091 attachment-processor POST /api/attachments/parse
     → 支持 Office/PDF/图片 OCR（已实现）
  2. 本地 markitdown 降级为 Tier2（检测不到时不暴露工具）
```

**8091 补齐**（新增统一 parse 端点）：
```python
# attachment-processor/app/main.py
@app.post("/api/attachments/parse")
async def parse_document(file: UploadFile):
    ext = file.filename.split('.')[-1].lower()
    if ext in ('docx', 'doc', 'xlsx', 'pptx'):
        return await office_to_markdown(file)   # → 8090
    elif ext == 'pdf':
        return await pdf_to_markdown(file)       # pdfplumber
    elif ext in ('png', 'jpg', 'jpeg', 'gif', 'bmp'):
        return await ocr_to_markdown(file)       # PaddleOCR
    else:
        return {"markdown": (await file.read()).decode('utf-8', errors='replace')}
```

**涉及文件**：
- `attachment-processor/app/main.py` — 新增 `/api/attachments/parse`
- `src/utils/localContentTools.ts` — `document_to_markdown` 改为云端优先
- `src/utils/localCapabilities.ts` — markitdown 降级 Tier2

---

## 4. P1 详细方案 — 监控与更新

### 4.1 Sentry 崩溃上报（含脱敏）

**同初版方案**，补充 codex 要求的脱敏规则：

```ts
// src/main.ts — Sentry beforeSend
Sentry.init({
  // ...
  beforeSend(event) {
    // 脱敏：绝对不发送
    if (event.request?.headers) {
      delete event.request.headers['Authorization']
      delete event.request.headers['X-Api-Key']
    }
    // 遮蔽 breadcrumb 中的敏感信息
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(b => ({
        ...b,
        message: b.message
          ?.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***')
          ?.replace(/Bearer [a-zA-Z0-9._-]{20,}/g, 'Bearer ***')
      }))
    }
    // 不发送可能含用户输入内容的原始 message
    if (event.message) event.message = '(content redacted)'
    return event
  },
})
```

**涉及文件**：
- `src-tauri/Cargo.toml` — `sentry`, `sentry-tauri`
- `src-tauri/src/lib.rs` — Rust 初始化
- `src/main.ts` — JS 初始化 + `bootLog` 加 breadcrumb
- `package.json` — `@sentry/vue`
- `.github/workflows/build.yml` — DSN 注入

---

### 4.2 新版本检测 + 引导下载（非静默更新）

**修正**：不上 `tauri-plugin-updater`（Windows portable 不适合静默更新）。改为启动时 GitHub API 检测。

```ts
// src/App.vue onMounted
async function checkNewVersion() {
  try {
    const resp = await fetch(
      'https://api.github.com/repos/liuyunlong2021-wq/jiucaihezi-app/releases/latest'
    )
    const release = await resp.json()
    const latestVer = release.tag_name.replace(/^v/, '')
    const currentVer = window.__JC_APP_BUILD_ID__?.match(/[\d.]+/)?.[0] || '0'

    if (latestVer > currentVer) {
      const ok = confirm(
        `韭菜盒子 ${release.tag_name} 已发布！\n\n` +
        `当前版本：v${currentVer}\n最新版本：${release.tag_name}\n\n` +
        `点击「确定」前往 GitHub 下载。`
      )
      if (ok) window.open(release.html_url, '_blank')
    }
  } catch { /* 静默失败 */ }
}
```

等签名、公证、NSIS/MSI 都稳定后，再上真正的 `tauri-plugin-updater`。

**涉及文件**：仅 `src/App.vue`

---

## 5. P2 详细方案 — 健壮性

### 5.1 CI 产物级 Smoke Test（含 sidecar 版本校验）

**升级**：不只是「启动 15s 不崩溃」，还要校验内置 sidecar 是否为真实二进制。

```yaml
# build.yml — macOS jobs (taiuri-action 之后)
- name: Smoke test — sidecar verification
  run: |
    DMG=$(ls src-tauri/target/*/release/bundle/dmg/*.dmg | head -1)
    hdiutil attach "$DMG" -quiet
    APP_PATH="/Volumes/韭菜盒子/韭菜盒子.app"
    BUNDLE_BIN="$APP_PATH/Contents/MacOS"

    echo "=== Sidecar 校验 ==="
    for bin in opencode ffmpeg ffprobe yt-dlp; do
      BIN=$(find "$APP_PATH" -name "$bin" -type f 2>/dev/null | head -1)
      if [ -z "$BIN" ]; then echo "⚠️  $bin 未找到"; continue; fi
      if file "$BIN" | grep -qE "shell script|ASCII text"; then
        echo "❌ $bin 是占位脚本！"
        exit 1
      fi
      echo "✅ $bin: $(file "$BIN" | cut -d: -f2-)"
    done

    echo "=== 启动存活 ==="
    "$BUNDLE_BIN/韭菜盒子" & APP_PID=$!; sleep 15
    if kill -0 $APP_PID 2>/dev/null; then
      echo "✅ APP 15s 存活"; kill $APP_PID
    else
      echo "❌ APP 提前退出"; exit 1
    fi
    hdiutil detach /Volumes/韭菜盒子 -quiet
```

Windows 等价（PowerShell）：检查 sidecar 大小 > 2KB + 启动存活 15s。

**涉及文件**：仅 `.github/workflows/build.yml`

### 5.2-5.3 Deep link + resolve_local_binary

同初版 SDD，方案不变。Deep link 3s→15s；`resolve_local_binary` 的 Unix 路径加 `#[cfg(not(windows))]`。

---

## 6. 执行顺序

```
Phase P0-A: 发布工程 (预计 3h)
  ├── 3.1 版本号统一 + set-version.mjs
  ├── 3.2 macOS 签名公证
  └── 3.3 Windows WebView2 检测
  合入 desktop → 打 v1.0.7 → CI 构建 → 产物名校验 + sha256

Phase P0-B: 二进制完整性 (预计 5h)
  ├── 3.4 Intel ffmpeg + 架构校验
  ├── 3.5 Windows 剪贴板 arboard
  ├── 3.6 HTTP connect_timeout (+ idle watchdog)
  ├── 3.7 whisper placeholder → Tier2 降级
  └── 3.8 markitdown → 云端优先
  合入 desktop → 打 v1.0.8 → CI 构建 → smoke test 含 sidecar 校验

Phase P1: 监控 + 更新检测 (预计 3h)
  ├── 4.1 Sentry（含脱敏）
  └── 4.2 新版本检测 + 引导下载
  合入 desktop → 打 v1.0.9

Phase P2: 健壮性 (预计 2h)
  ├── 5.1 CI smoke test 升级（含 sidecar 校验）
  ├── 5.2 Deep link 15s
  └── 5.3 resolve_local_binary 清理
  合入 desktop → 打 v1.0.10
```

---

## 7. 最终验收矩阵（三平台真机实测）

> 每个 Release 产物在对应平台真机/VM 上完成以下闭环。22 项全部 ✅ 才算「所有功能可用」。

| # | 验收项 | 具体操作 | ARM | Intel | Win |
|---|--------|---------|:--:|:--:|:--:|
| 1 | **安装/解压** | 双击 DMG / 解压 zip，首次打开无阻拦 | | | |
| 2 | **启动** | 不卡 logo，5s 进主界面 | | | |
| 3 | **鉴权 — 账号登录** | 登录 → 浏览器回调 → APP 收到登录态 | | | |
| 4 | **鉴权 — 手动 Key** | 粘贴 sk-xxx → 模型列表刷新 | | | |
| 5 | **一键抄配置** | 点击 → 弹配置 → 复制 → 粘贴验证 | | | |
| 6 | **对话 — 直连流式** | 发消息 → SSE 逐字输出 → 完整回复 | | | |
| 7 | **对话 — OpenCode 文模式** | 选项目 → 读文件/写文件/diff 正常 | | | |
| 8 | **对话 — OpenCode 武模式** | 同上 + bash 执行 + 权限确认 | | | |
| 9 | **创作 — 图片** | 选 gpt-image-2 → 生成 → 画廊可见 | | | |
| 10 | **创作 — 视频** | 选 grok-video → 轮询 → 结果可见 | | | |
| 11 | **创作 — 音频** | 选 suno → 生成 → 试听 | | | |
| 12 | **画布 — LLM 节点** | LLM 节点连 text → 执行 → 有输出 | | | |
| 13 | **画布 — 图片节点** | 图片生成节点 → 执行 → 结果可见 | | | |
| 14 | **画布 — 视频节点** | 视频生成节点 → 执行 → 结果可见 | | | |
| 15 | **附件 — 图片 OCR** | 贴截图 → 发送 → LLM 引用 OCR 文字 | | | |
| 16 | **附件 — PDF/Office** | 上传 PDF → LLM 引用文档内容 | | | |
| 17 | **本地 — ffprobe** | 上传视频 → AI 调媒体分析 → 返回元数据 | | | |
| 18 | **本地 — ffmpeg** | AI 调视频压缩/转格式 → 文件可下载 | | | |
| 19 | **本地 — 浏览器** | 搜索开关开 → browser_search → 返回结果 | | | |
| 20 | **存储恢复** | 对话后重启 → 历史/设置/媒体资产可恢复 | | | |
| 21 | **剪贴板** | Cmd/Ctrl+C 复制消息 → 外部粘贴 | | | |
| 22 | **产物校验** | asset 名、版本号、sha256 均一致 | | | |

---

## 8. 不改的内容（明确排除）

- ❌ 不换框架（不迁移 Electron/SwiftUI/MAUI）
- ❌ 不新增 Linux 支持
- ❌ 不做 Windows NSIS/MSI 安装器（P0 只补 WebView2 检测；安装器排入未来版本）
- ❌ 不上完整 `tauri-plugin-updater`（P1 只做检测 + 引导跳转）
- ❌ 不做 E2E 自动化测试框架
- ❌ 不修旧知识库/Vault 相关代码
- ❌ 不内置 whisper 真实 runtime 和模型管理（Tier2 降级即可）

---

## 9. 新增依赖汇总

| 依赖 | 用途 | 许可证 |
|------|------|------|
| `arboard` v3 | 跨平台剪贴板 | MIT/Apache 2.0 |
| `sentry` v0.34 | Rust 崩溃上报 | MIT |
| `sentry-tauri` v0.3 | Tauri + Sentry 桥接 | MIT |
| `@sentry/vue` v8 | JS 崩溃上报 | MIT |
| `scripts/set-version.mjs` | 版本号统一 | 自研 |

比初版 SDD 减少 `tauri-plugin-updater`（降级为 GitHub API 检测）。

---

## 10. 给接手者的行动指南

1. **先读 CLAUDE.md §1 和本 SDD §1-§2**，理解「发布产物门禁」的核心目标
2. **从 P0-A 开始**：版本号统一 → 签名公证 → WebView2 检测，这是用户信任的基础
3. **P0-A 完成后先打 tag 验证 CI**：确认三平台产物名正确、sha256 正确
4. **再进入 P0-B**：二进制完整性修复
5. **Rust 修改后跑** `cd src-tauri && cargo check`
6. **前端修改后跑** `pnpm exec vue-tsc -b && pnpm exec vite build`
7. **P0-B 完成后在真机/VM 上跑 §7 验收矩阵**（macOS ARM + Windows 至少各一台）
8. **不要顺手做 §8 明确排除的内容**

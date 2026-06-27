# Intel Mac 打包版卡 Logo 修复交接文档

> 日期：2026-06-24  
> 分支：`APPyouhua`  
> 修复文件：`src/main.ts`（仅 1 个文件）

---

## 一、问题现象

用户从 GitHub Releases 下载 Intel Mac DMG（`韭菜盒子_*_x64.dmg`），双击打开后只显示 logo（splash screen），永远进不去软件界面。

## 二、调试过程

将整个项目拷贝到一台 Intel Mac 上，执行 `pnpm tauri dev` 进行调试。

### 2.1 环境准备

- 创建了缺失的 Intel sidecar 占位脚本（`ffmpeg/ffprobe/yt-dlp/whisper-cli-x86_64-apple-darwin`）
- 安装 npm 依赖（`pnpm install`）
- 首次编译下载 183 个 Rust crates（18.8 MiB，耗时约 10 分钟）
- 编译 543 个 Rust 源文件（耗时约 15 分钟）

### 2.2 dev 模式结果

App 在 Intel Mac dev 模式下**正常运行**：

```
23:21:52 [JC-boot] initDB() 完成 (769ms)
23:21:52 [JC-boot] initBackend 结束 (769ms), storageDegraded=false
23:22:07 [JC] deepLink.getCurrent() 超时 (15s)，跳过回调等待
```

关键发现：
- SQLite 初始化正常（769ms）
- 存储未降级（`storageDegraded=false`）
- **Deep link 初始化超时 15s**，但被正确跳过

### 2.3 根因定位

问题出在 `src/main.ts` 的启动流程设计：

```
之前（可能卡死）:
  boot() → patchFetch → deepLink.getCurrent() 挂死（15s 超时）
    ↓
  boot() 被 8s 超时 Promise.race 包裹
    ↓
  boot() resolve 后，但 registerDeepLinkCallbackHandler 还在 pending
    ↓
  release 版中 deep link 插件可能同步阻塞 WebView → 永远卡 logo
```

**根因**：`registerDeepLinkCallbackHandler()` 放在 `boot()` 函数内部，而它调用 `deepLink.getCurrent()` 在 Intel Mac 的 release 打包版中可能不是简单的异步超时，而是导致 WebView 进程阻塞。

## 三、修复方案

### 3.1 核心思路

将 deep link 注册从 `boot()` 中移出，改为 `initBackend()` 中的 **fire-and-forget 后台任务**。

### 3.2 具体改动（3 处）

#### 改动 1：`boot()` 函数中删除 deep link 调用

```diff
 async function boot() {
   if (isTauri) {
     try {
       await patchFetch()
       ;(window as any).__JC_FETCH_PATCHED__ = true
     } catch (err) {
       bootLog('error', `patchFetch 失败: ${err}`)
     }
   }
   const callbackKey = consumeApiKeyCallbackUrl()
   if (callbackKey) await setApiKey(callbackKey)
-  if (isTauri) await registerDeepLinkCallbackHandler()
   // 对标 OpenCode 懒鉴权：不在启动时阻塞等待 Keychain
   initApiKey().then(() => { keyReadyResolve?.() }).catch(() => { keyReadyResolve?.() })
 }
```

#### 改动 2：`initBackend()` 中添加后台注册

在 `// 以下全部后台静默执行，不影响用户体验` 注释后添加：

```ts
  // P0: Deep link 回调注册（后台执行，不阻塞启动——Intel Mac 上可能超时/挂死）
  if (isTauri) {
    void registerDeepLinkCallbackHandler().catch((err) => {
      bootLog('warn', `Deep link 注册失败（非关键）: ${err}`)
    })
  }
```

#### 改动 3：缩短 deep link 内部超时

```diff
 async function registerDeepLinkCallbackHandler() {
   try {
     const deepLink = await import('@tauri-apps/plugin-deep-link')
-    // Windows 上 deep link 初始化可能需要更长时间（注册表操作）
     const pending = await Promise.race([
       deepLink.getCurrent(),
       new Promise<null>((resolve) => setTimeout(() => {
-        console.warn('[JC] deepLink.getCurrent() 超时 (15s)，跳过回调等待')
+        console.warn('[JC] deepLink.getCurrent() 超时 (5s)，跳过回调等待')
         resolve(null)
-      }, 15000)),
+      }, 5000)),
     ])
```

### 3.3 修复后的启动流程

```
修复后（不会卡死）:
  boot() → patchFetch → 结束（0.7s）
    ↓
  initDB() → 结束（0.8s）
    ↓
  UI 正常显示 ✅
    ↓
  后台: deepLink 慢慢注册（失败也无所谓，不阻塞任何东西）
```

## 四、验证方式

### 4.1 dev 模式验证（已完成）

在 Intel Mac 上 `pnpm tauri dev` 正常运行，启动日志正常。

### 4.2 打包 DMG 验证（待做）

1. 在主机上提交修改到 GitHub
2. 打 tag 触发 CI（`git tag v1.0.x && git push origin v1.0.x`）
3. 等待 GitHub Actions 完成 Intel build
4. 下载 `韭菜盒子_*_x64.dmg`
5. 在 Intel Mac 上安装测试：APP 应在 1-2 秒内显示界面

### 4.3 浏览器 Console 验证

如果打包版仍有问题，在 Intel Mac 上打开 Console.app，筛选 `jiucaihezi` 或 `韭菜盒子`，查看崩溃日志。重点关注：
- `[JC-boot]` 开头的日志
- `libsqlite3` 或 `SQLite` 相关的错误
- `deep-link` 或 `deepLink` 相关的错误

## 五、如果修复后仍有问题

如果上述修复后 Intel DMG 仍然卡 logo，进一步排查方向：

| 可能性 | 排查方法 |
|--------|---------|
| **CI 交叉编译问题** | GitHub Actions `macos-latest` 是 ARM64，交叉编译 `libsqlite3-sys` 到 x86_64 可能有问题。可改用 `macos-13` runner（原生 x86_64） |
| **deep link 插件 crash** | 在 `tauri.conf.json` 中临时移除 `deep-link` plugin 配置，看是否能启动 |
| **签名/公证问题** | 检查 `APPLE_SIGNING_IDENTITY` secret 是否有效。临时去掉 `signingIdentity` 用 ad-hoc 签名测试 |
| **CSP/assetProtocol** | 确认 `tauri.conf.json` 中 `assetProtocol.enable: true` 且 scope 包含 `$APPDATA/output/**` |

## 六、相关文件

| 文件 | 说明 |
|------|------|
| `src/main.ts` | 唯一修改的文件，启动流程核心 |
| `src-tauri/tauri.conf.json` | Tauri 配置，含 deep-link plugin、signingIdentity |
| `.github/workflows/build.yml` | CI workflow，`macos-intel` job |
| `src-tauri/binaries/` | sidecar 二进制目录 |

---

**一句话总结**：把 deep link 注册从启动关键路径移到后台，防止 Intel Mac release 版中被它阻塞整个 WebView。

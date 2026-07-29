# Android 分支恢复交接

> 用途：以后继续 Android App 阶段时，把本文件全文复制给 AI。

## 可直接复制的指令

你正在继续韭菜盒子 Studio 的 Android App 支线开发。

- 工作目录：`/Users/by3/Documents/jiucaihezi-app`
- Android 分支：`codex/android-app`
- 主线：`main`
- Android 真机：vivo `V2443BA`，Android 15 / API 35，ADB 序列号 `10AF8X1HSZ00164`
- 当前正确的 Mac 2.1.0 App：`/Applications/韭菜盒子.app`
- 绝对不要使用旧包：`/Volumes/韭菜盒子/韭菜盒子.app` 或 `/Volumes/韭菜盒子 6/韭菜盒子.app`

请先阅读：`AGENTS.md`、`docs/wiki/CLAUDE.md`、`docs/wiki/hot.md`、`docs/wiki/开发/通用记忆对话独立App SDD.md`，然后严格按 SDD 的 4D-3 -> 4D-9 顺序继续。不要把 APK 构建、安装或打开空壳说成 App 完成；只有真实 Android 设备通过对应门禁才能标记阶段完成。

## 已完成

- 4D-1：JDK、Android SDK/NDK、Rust Android targets、Tauri Android 工程初始化和交叉编译检查。
- 4D-2：vivo 真机 Debug APK 安装、冷启动、前台稳定运行 60 秒。
- 4D-3：真账号登录、Android Keystore 保存/恢复、杀进程恢复、退出登录和失效回登录页。
- 4D-4 前置：Android 上传、Mac 下载 Android 云项目、Mac -> Android 文字回流、Android 断网落盘/恢复去重、Android 反向上传已实测。

## 尚未完成

4D-4 仍不能标记完成。还需要在正确的 Mac 2.1.0 App 或同账号 Web 工作区中，拉取并核对 Android 反向 marker，然后完成冲突、越权和媒体/空目录不上传证据。完成 4D-4 后才能进入 4D-5、4D-6、4D-7；4D-8 还需要第二台不同 Android 版本或屏幕尺寸的设备；4D-9 最后做 Release APK/AAB、正式签名、mapping/符号文件和发布材料。

Android 验收云项目：`未命名项目Android4Dacceptance`。

## 代码和数据注意事项

- Android Keystore 实现在 `src-tauri/gen/android/app/src/main/java/com/jiucaihezi/desktop/MainActivity.kt` 和 `src-tauri/src/secure_store.rs`。
- Android Debug APK 包名：`com.jiucaihezi.desktop`。
- 不要把 Android 专属改动合并到 `main`，除非 4D-9 完成并通过完整发布门禁。
- Mac/Web 紧急 bug 修复应在 `main` 进行；Android 支线之后从最新 `main` rebase。
- 真实 Android 数据通过 `adb shell run-as com.jiucaihezi.desktop` 审计；不要读取或暴露凭据明文。

## 恢复工作命令

```bash
cd /Users/by3/Documents/jiucaihezi-app
git switch codex/android-app
git status --short --branch
adb devices -l
adb shell pidof com.jiucaihezi.desktop
adb exec-out run-as com.jiucaihezi.desktop cat 'projects/未命名项目Android4Dacceptance/.raw/.sync/state.json'
```

先完成 4D-4 剩余真实证据，再更新 SDD 和 `hot.md`，提交并推送 `codex/android-app`。不要跳阶段，不要误用旧 Mac App，不要把文档记录当成业务修复或真机验收。

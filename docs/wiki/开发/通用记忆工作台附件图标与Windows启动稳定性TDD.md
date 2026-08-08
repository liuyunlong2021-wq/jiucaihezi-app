# 通用记忆工作台附件图标与 Windows 启动稳定性 TDD

> 日期：2026-08-07
> 状态：已实施；updater panic 与无效持久化窗口状态均已修复，Windows 用户已完成启动验收

## 1. 目标

1. 对话输入框的附件按钮在 Web、Desktop、Windows 发布产物中都显示本地图标。
2. Windows 用户安装桌面 App 时，缺少 WebView2 不再表现为双击即退出；安装包应主动处理该系统运行时。
3. 便携 ZIP 保留给已具备 WebView2 的高级用户，正式下载入口优先提供安装器。

## 2. 红灯测试

- 离线图标包必须包含 `attach-file`。
- Windows Tauri 配置必须声明 `downloadBootstrapper` 且安装器不静默吞掉 WebView2 安装过程。
- Windows 发布工作流必须构建并上传 NSIS 安装器，不能只验证 ZIP 文件存在。
- OTA 配置停用时不得继续注册 updater 插件；Windows CI 必须真实启动 release EXE 并观察存活状态。

## 3. 非目标

- 不恢复 OpenCode；OpenCode 仅保留为迁出回归门禁，不是运行依赖。
- 不把 WebView2 二进制复制进 Git 仓库或便携 ZIP。
- 不修改附件解析、NewAPI 请求或 SQLite 任务逻辑。

## 4. 通过标准

- 图标覆盖测试通过，`icons-bundle.json` 含 `attach-file`。
- TypeScript、focused tests 和 Web/Desktop 产物审计通过。
- Windows CI 同时生成 NSIS 安装器与便携 ZIP；安装器的 WebView2 模式为可见下载引导。
- 发布说明和 Wiki 明确 Windows 运行时原因、安装器优先级及便携版前置条件。

## 5. 实施回执

- 图标扫描正则已支持 `-`，重新生成离线图标包后 `attach-file` 已存在。
- Windows CI 已改为同时构建 NSIS 安装器和便携 ZIP；安装器使用 `downloadBootstrapper` 且不静默隐藏 WebView2 安装。
- 通过：Windows 发布合同测试、完整 focused `986/986`、TypeScript、`git diff --check`。
- 未执行：当前环境无法启动 Windows EXE；必须在缺少 WebView2 的真实 Windows 设备安装 NSIS 包并启动验收。便携 ZIP 仍要求系统已有 WebView2。

## 6. v2.1.11 发布后补充

- macOS ARM/Intel 冒烟与用户 Windows 实测共同证明 App 在窗口创建前崩溃，日志为 `PluginInitialization("updater")`；Windows job 仅检查文件存在，因此错误显示绿色。
- 关闭 OTA 配置时遗漏了 Rust Builder 的 updater 注册，插件读取空配置后 panic。现已删除注册、Cargo/npm 依赖及无人调用的前端 composable。
- Windows workflow 在构建后、打包前启动 `jiucaihezi-app.exe`，等待 15 秒；提前退出时输出 stderr 并使 job 失败。
- 自动验证：完整 focused `1002/1002`、Rust `395 passed / 1 ignored`、TypeScript、`git diff --check` 通过；本机 aarch64 macOS 生产 release 已成功构建并真实启动存活 15 秒。修复必须使用新 tag 发布，不覆盖 `v2.1.11`。

## 7. Windows 持久化窗口状态真机根因（2026-08-07）

- 用户安装后的 EXE 可以从真实路径 `C:\Users\Administrator\AppData\Local\韭菜盒子\jiucaihezi-app.exe` 启动并持续运行；清理 `%APPDATA%\com.jiucaihezi.desktop` 与 `%LOCALAPPDATA%\com.jiucaihezi.desktop` 后，桌面和开始菜单也能连续正常打开。因此本次不是缺少 WebView2、安装路径错误或程序主体无法运行。
- 真正根因是 Windows 最小化/异常退出时可能保存 `x=-32000`、`y=-32000`、`width=0`、`height=0` 一类无效窗口状态。下一次启动恢复该状态后，进程仍可能存在，但窗口不可见，用户体验等同于“闪退”。
- 修复位于窗口状态读写的共同入口：恢复前拒绝零尺寸和极端负坐标，保存时也不写入这类状态；合法的多显示器负坐标仍允许。红灯测试使用真实失败几何数据，防止以后再次把不可见窗口状态持久化。
- 成功经验：先用绝对 EXE 路径和 stderr 日志区分“进程退出”与“窗口不可见”，再临时改名数据目录验证持久化状态，最后修复读写入口。不要先把问题归因于 WebView2，也不要要求用户永久删除数据目录。

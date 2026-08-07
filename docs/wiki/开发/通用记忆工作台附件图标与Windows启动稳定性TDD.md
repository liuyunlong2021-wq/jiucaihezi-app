# 通用记忆工作台附件图标与 Windows 启动稳定性 TDD

> 日期：2026-08-07
> 状态：已实施，待 Windows 真机验收

## 1. 目标

1. 对话输入框的附件按钮在 Web、Desktop、Windows 发布产物中都显示本地图标。
2. Windows 用户安装桌面 App 时，缺少 WebView2 不再表现为双击即退出；安装包应主动处理该系统运行时。
3. 便携 ZIP 保留给已具备 WebView2 的高级用户，正式下载入口优先提供安装器。

## 2. 红灯测试

- 离线图标包必须包含 `attach-file`。
- Windows Tauri 配置必须声明 `downloadBootstrapper` 且安装器不静默吞掉 WebView2 安装过程。
- Windows 发布工作流必须构建并上传 NSIS 安装器，不能只验证 ZIP 文件存在。

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

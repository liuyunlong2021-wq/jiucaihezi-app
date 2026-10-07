# Changelog

## v2.2.22 (2026-10-07)

- 接入官方 Tauri 桌面更新器：设置内检查、下载、签名验证、安装并重启；现有版本需手动安装本接入版一次。
- 独立截图会话从捕获、标注到保存/取消全程占用原生任务门闩，未选项目窗口也恢复草稿与创作选择。
- 窗口构造全程占用原生任务门闩，防止创建过程中与升级准备交错；安装前协调所有工作窗口保存内容，阻止新任务，保护 Harness、媒体、远程提交和原生导出任务；保存失败或仍有任务时不安装。
- Mac 更新包在 App 签名、公证和 stapling 后生成；Windows 使用最终 NSIS 安装器。三平台签名候选、官网清单与正式 OTA 推广分别处理，增加隔离原生升级门禁。
- 更新清单原子推广；目录清理同时保留下载版、当前更新版和上一可用更新版。A→B 的真实点击、安装权限和业务能力验收仍是后续 OTA 推广门禁。

## v2.2.19 (2026-10-07)

- 修复点击 `@MCP` 时先加载 Skill、递归搜索项目造成的延迟；MCP 选择器直接使用已连接工具的内存候选。
- 关闭候选弹层不再触发目录加载；切换入口和关闭后丢弃过期结果，保留 Skill 与综合 `@` 候选能力。

## v1.2.5 (2026-07-09) — 性能修复 & OpenCode Desktop 对齐

### 🔧 致命 Bug 修复
- **消息截断**: 50 轮以上历史消息消失（`client.session.messages()` 默认 limit=50 → 改为 500）
- **启动超时**: Intel Mac 冷启动 8s 超时（改为对齐 OpenCode 的 60s）
- **停止超时**: 新增 SIGTERM→6s→SIGKILL 优雅退出流程（对齐 `SIDECAR_STOP_TIMEOUT`）
- **看门狗优化**: 300s→120s，超时后杀进程清除僵尸 drain

### 📋 OpenCode Desktop 语法翻译对齐（新增 10 项）
- **Shell 环境变量**: `load_shell_env()` 加载终端 PATH（macOS GUI 应用必需）
- **macOS 原生菜单**: About/Edit/Window 等标准菜单项
- **窗口状态持久化**: 记住窗口位置和大小
- **文件选择器**: `open_file_picker` / `save_file_picker`
- **应用重启**: `opencode_relaunch` 命令
- **调试日志导出**: `opencode_export_debug_logs`
- **退出杀 sidecar**: 窗口关闭时自动停止 OpenCode 子进程

### 📐 开发体系建设
- **翻译方针**: 韭菜盒子 = OpenCode Desktop 的 Tauri + Vue 语法翻译版
- **完整对照表**: `docs/sdd/opencode-desktop-mapping.md` 覆盖 33 项，85% 对齐
- **翻译方案 SDD**: `docs/sdd/opencode-translation-plan-sdd.md`
- **审计清单**: `docs/sdd/glue-layer-audit-checklist.md`
- **并发审计**: 锁路径审查 5 条，发现并修复 2 个并发 Bug

### 🏗️ 编译
- ✅ `cargo check` — 零错误零警告
- ✅ `vue-tsc -b` — 零错误
- ✅ `vite build` — 1.20s

## v1.1.9 (2026-07-06) — 工具仓库 & 质量优化

### 工具仓库
- **批量扫描+缓存**: `check_all_tools` 一次 IPC 替代 19 次独立 IPC，缓存 5min TTL
- **7 种检测策略**: dir/which/brew/npm/pip/command，覆盖系统安装/包管理
- **修复首次打开卡顿**: 移除 npx 策略（会触发下载），brew/npm 结果缓存复用

### 设置 & 登录
- **登录持久化**: 重启 APP 自动恢复登录状态，不再需要重新填写
- **设置面板清理**: 删除 OpenCode 内核显示、桌面端备份导入
- **版本号**: 对齐 package.json v1.1.9

### 创作面板
- **文件拖拽**: 全面板 drop zone + 拖拽高亮虚线提示

### Bug 修复
- **Web Skill 弹窗**: 框选文字时不再意外关闭（`@click.self` → `@mousedown.self`）

### 帮助 & i18n
- **帮助弹窗 Markdown 化**: 硬编码卡片 → `public/help/guide.md` + `marked` 渲染
- **i18n 全局切换**: `locale` reactive ref，中英文切换立即生效

### 工程
- **消除 24 个 Rust 编译警告**: 0 warnings 0 errors 构建

---

## v0.1.7 (2026-06-13)

- 创作面板新增 prompt 参考按钮
- 下载链接改为夸克网盘
- 移除大字模式，刷新主题配色
- Web 端：隐藏本地 Ollama 配置区
- Web 端：完善 API 配置展示，云端对话需登录

## v0.1.6 (2026-06-13)

- 更新媒体 Skill 和 OpenCode 修复

## v0.1.5 (2026-06-12)

- 修复 Windows Tauri 构建配置传递

## v0.1.4 (2026-06-12)

- Windows x64 portable zip 构建发布

## v0.1.3 (2026-06-12)

- 修复 macOS release workflow 中 vue-tsc 异常中断

## v0.1.2 (2026-06-12)

- 修复桌面端 release workflow
- 使用打包的 Tauri CLI 构建

## v0.1.1 (2026-06-12)

- 首次发布
- CI 跳过测试，whisper-cli 改为占位
- 三平台构建链路打通（macOS ARM / Intel + Windows）

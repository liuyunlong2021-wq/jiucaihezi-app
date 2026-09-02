# 通用记忆工作台 iPhone TestFlight 外部测试 TDD（2026-08-25）

> 状态：已实施至 `2.1.40` Beta App Review；正在等待审核
> 初始基线：`main` / `v2.1.34` / `096fadc4`
> 移动身份：`com.jiucaihezi.mobile` / Apple Team `RXD4L9387J`
> 目标：不正式上架 App Store，先通过 TestFlight 外部测试让其他用户可安装和更新当前 iPhone App。
> 范围：先关闭 iPhone 云项目“下载并覆盖本地”回归，再完成 `2.1.34` 的 TestFlight 内部安装、外部 Beta 审核、公开链接和 90 天续期闭环。

## 1. 已确认目标与当前证据

用户已确认继续以当前仓库版本开发 iPhone App，即使不正式上架，也要让其他人能通过测试分发下载使用。分发路线固定为 TestFlight 外部测试：

- Apple 允许最多 100 名 App Store Connect 内部测试成员和 10,000 名外部测试者。
- 外部测试者可通过邮件或公开链接安装，不需要登记 UDID。
- 首个外部测试构建需要 Beta App Review；这不等于正式 App Store 上架。
- 每个 TestFlight 构建最多可测试 90 天，到期前必须上传新构建。

仓库已有可用的 Tauri iOS 工程、Bundle ID、Apple Team、图标/启动页、合规用途说明和历史 TestFlight 成功证据。`2.1.0 (2.1.0.1)` 曾完成 TestFlight 上传、安装和真机回归；不重建第二套 Mobile App。

当前发布前明确阻断是 [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]：`2.1.17` 真机操作后界面无可见结果，目标项目和 `.raw/.sync/state.json` 均未变化。自动测试、IPA 构建、安装和启动不能替代这条真实链路。

## 2. 根因链与不可变边界

真实链路为：

```text
点击云项目
-> confirmAction 确认覆盖
-> localOwnerForCloud 定位或 createMobileProject 创建本地项目
-> projectStore.selectProject
-> projectTextSync.open
-> projectTextSync.downloadNow 或 connect
-> pullFiles
-> ProjectFileService 创建/覆盖/删除可同步文字
-> 写入 .raw/.sync/state.json
-> 显示成功状态或真实错误
```

旧回归的根因尚未定位。本 TDD 不假设是点击、确认框、项目定位、网络请求或文件写入中的某一层；先用同一操作 ID 找到最后到达边界，再在该共享根因点修复。

不可变边界：

- 继续使用 `com.jiucaihezi.mobile`、现有 Apple 身份和 App Store Connect App `6795407590`。
- 云端和本地只执行用户明确选择的“上传并覆盖云端 / 下载并覆盖本地”，不恢复自动合并、冲突副本或双向同步。
- 只传输现有 `isSyncableTextPath()` 允许的文字；媒体、空目录、凭据、设置、Skill、MCP 和 `.raw/.sync` 不进入覆盖快照。
- 不用 UI 补丁、定时重试或第二套 Mobile 同步器掩盖链路根因。
- 未经真机证明文件落盘和状态可见，不得进入 TestFlight 外部测试。

## 3. TDD 实施顺序

### RED 1：真机可观测复现

1. 在 `openCloudProject` 点击入口、确认返回、`localOwnerForCloud`、`projectTextSync.open/connect/downloadNow`、远端拉取、本地写入和最终错误出口记录同一个临时操作 ID。
2. 记录只包含步骤名、项目 ID/路径的脱敏标识、文件数和错误类别；不记录 Session、项目正文、API Key 或媒体 URL。
3. 用当前 `main / 2.1.34` 的开发签名版在真实 iPhone 重现一次，同时记录目标项目和 `.raw/.sync/state.json` 操作前后状态。
4. 只有确认“最后到达步骤 + 第一个未到达步骤”才算 RED 完成；不根据无响应表象猜测修复点。

### RED 2：根因回归测试

定位停点后，先在最近的现有测试中加一个可执行的失败用例，覆盖实际根因。至少锁定：

- 用户取消确认时不创建、切换或覆盖项目。
- 已绑定同一云项目时调用 `downloadNow()`；同名但未绑定时调用 `connect(cloud.id)`。
- 手机不存在本地副本时，只创建一个 App 管理项目，完成 `open -> connect -> selectProject`。
- 成功时云端文字被创建/覆盖，本地独有可同步文字被删除，排除路径保持不变，状态文件记录同一云项目 ID。
- 确认、认证、网络、项目创建、拉取或写入失败时，界面显示真实错误，不静默关闭项目中心。

不为了测试预先建通用同步状态机或新服务层。只有现有 Vue 内部函数确实无法执行测试时，才提取最小的决策函数。

### GREEN 1：在共享根因点修复

- 只修复 RED 2 证明的根因，不在每个调用者复制 guard。
- 保留用户可见的进度、成功摘要和错误；删除诊断阶段的临时详细日志，只保留能支持后续排障的脱敏错误边界。
- 同一修复必须同时通过新增回归测试和现有文字覆盖测试。

### GREEN 2：真实 iPhone 闭环

在同一台真实 iPhone 执行两条路径：

1. 已有本地副本：云端改动一个测试文字并保留一个本地独有测试文字，下载后确认前者被覆盖、后者被删除。
2. 无本地副本：点击云项目后自动创建 App 管理项目，拉取文字并切换到该项目。

两条路径均必须同时满足：

- 界面明确显示进度和“已下载并覆盖本地”摘要，失败则显示可行动错误。
- 目标文字文件内容真实变化，`.raw/.sync/state.json` 记录正确云项目 ID；媒体和排除路径未改动。
- 杀进程重开后项目、绑定和文字结果仍存在。

## 4. `2.1.34` Mobile 发布回归矩阵

云下载 GREEN 后才执行：

| 范围 | 真机验收 |
| --- | --- |
| 身份 | 登录、退出、杀进程后登录恢复；失效 Session 回到登录态 |
| 项目 | 本地新建/切换，上传覆盖云端，下载覆盖本地，重启后恢复 |
| 核心工作流 | 快速/记忆对话、Raw 追加、Wiki 查询/写入、产品 Skill 调用 |
| 附件与媒体 | 相册/文件导入、站内预览、云媒体任务提交/恢复/播放；媒体不进入文字云覆盖 |
| 生命周期 | 前后台切换、杀进程、断网写入、恢复网络、重试不重复产生 turn |
| 移动布局 | iPhone 触控、安全区、键盘、文件树/设置全屏抽屉；`940px` 以下不进入 Desktop Dock |
| 删除 | 对话和文件的移动端永久删除有明确确认，取消时不变更数据 |

至少覆盖已有 iPhone 13 Pro Max 和一台不同屏幕尺寸或 iOS 版本的设备。第二台设备未执行前列为已知验收缺口，不写成已通过。

## 5. TestFlight 内部构建门禁

### RED 3：发布输入检查

- `tauri.conf.json` 版本为 `2.1.34`；`tauri.ios.conf.json` 仍覆盖为 `com.jiucaihezi.mobile` 和 Team `RXD4L9387J`。
- App Store Connect 中查询 `2.1.34` 已有构建号，只使用未占用的下一个 `--build-number`，不覆盖旧构建。
- 发布源必须是已记录的 Git commit；无关未跟踪文件不得进入 IPA。
- 先通过回归测试、TypeScript、Rust iOS target 检查、iOS quick build 和产物审计，再归档。

### GREEN 3：生成并上传构建

使用现有 Tauri 命令，`N` 替换为 App Store Connect 中未占用的构建号：

```bash
pnpm tauri ios build \
  --target aarch64 \
  --export-method app-store-connect \
  --build-number N \
  --ci -v
```

上传前验证：

- IPA 内 Bundle ID、版本、构建号、Team、用途说明和 `ITSAppUsesNonExemptEncryption` 与现行合同一致。
- 签名和 Provisioning Profile 有效，`codesign --verify --deep --strict` 通过。
- 包内只含当前产品 Skill 和 Mobile 可达资源，不因已忽略的 `src-tauri/gen/` 旧产物混入已迁出 Skill、Desktop sidecar、本机模型或 stdio MCP。
- 记录 IPA 路径、大小、完整 SHA-256、Git commit 和 Xcode/App Store Connect 上传回执。

先加入现有内部测试组，从 TestFlight 重新安装而不是覆盖开发签名版，然后在真机完整执行第 4 节矩阵。只有内部 TestFlight 安装、启动和核心回归通过，才允许进入外部测试。

## 6. TestFlight 外部测试门禁

### RED 4：Beta 信息与审核材料

在 App Store Connect 填写并复核：

- Beta App 描述、本轮测试重点、反馈邮箱、审核联系信息和必要的审核登录说明。
- 隐私政策、用户支持和服务条款仍指向现有正式 HTTPS 页面。
- 出口合规声明与 `Info.ios.plist` 和 App 的标准 TLS 使用一致，不伪称未使用加密。

### GREEN 4：外部组、Beta App Review 和公开链接

1. 建立一个外部测试组，只加入已通过内部回归的构建。
2. 提交首个外部构建的 Beta App Review；未获批前不对外声称可下载。
3. 审核通过后先用定向邮件邀请少量非 App Store Connect 团队成员，验证安装、首启、登录和反馈。
4. 定向外测稳定后再开启公开链接，设置合理的人数上限；达到上限或构建存在阻断问题时关闭链接。
5. 用外部 Apple 账号从邀请或公开链接安装，记录 TestFlight 中显示的版本/构建号和首次核心工作流结果。

本阶段不提交正式 App Store 版本、不设置审核通过后自动发布、不对公众声称 App Store 已上架。

## 7. 90 天续期与反馈闭环

- 记录每个外测构建的上传日、过期日、Git commit、构建号和已知问题。
- 默认在过期前 30 天开始准备下一构建；新构建必须重跑自动门禁和最小真机回归。
- 处理 TestFlight 崩溃、截图和文字反馈时，只把确认问题转成独立 Bug/TDD；不把未复现反馈直接写成已知事实。
- 构建到期、手动停止测试或关闭公开链接时，明确通知现有测试者更新或暂停原因。

## 8. 自动验证与真实平台证据

实施后的自动门禁至少包含：

```text
新增的 iPhone 云下载根因回归测试
src/services/__tests__/projectTextSync.test.ts
src/components/memory/__tests__/memoryWorkbench.test.ts
pnpm run test:focused
pnpm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios
pnpm run build:ios:quick
git diff --check
```

真实平台证据必须分开记录：

1. 开发签名真机：根因停点、修复后文件/状态变化和完整 Mobile 回归。
2. TestFlight 内部构建：上传回执、从 TestFlight 安装、启动和同一真机回归。
3. TestFlight 外部构建：Beta App Review 通过、外部账号邀请/公开链接安装和首次工作流。

未实际执行的真机、上传、Apple 处理、Beta 审核、外部安装或 90 天续期，不得写成已通过。

## 9. 本轮实施回执（2026-08-25）

- 云下载链路现在用同一操作 ID 记录进入、项目定位、`open`、`connect` / `downloadNow`、远端拉取、本地写入完成和失败边界；回归测试锁定了 `open -> connect -> pull -> 写入` 的顺序。
- iOS Debug 不再错误加载桌面 Vite 地址；创作全屏层从 iPhone 顶部安全区开始，保留唯一的右上角关闭入口返回对话。已构建、开发签名覆盖安装并启动到真实 iPhone，用户确认可返回对话。
- `pnpm run test:focused:build`、`pnpm run test:focused:run`（1115 通过）、iOS Rust target 检查、iOS Debug IPA 构建和差异检查通过。
- 未执行本 TDD 的云下载真机文件落盘验证；未生成 App Store Connect 签名构建、未上传 `2.1.34`、未完成 TestFlight 内部安装、Beta App Review、外部邀请或公开链接。

## 10. 明确不做

- 不重写 Mobile App，不引入 React Native、Flutter 或第二套同步实现。
- 不使用 Ad Hoc UDID 包作为对外分发主链路，不使用 Enterprise 签名绕过 TestFlight。
- 不修改 Desktop/Web 的现有产品能力、发布身份或更新通道。
- 不恢复 Android 开发，不把 Android 构建加入本轮门禁。
- 不在本轮开发签名验证中上传 App Store Connect、提交 Beta App Review 或生成公开链接。

## 11. `2.1.40` 实施与 TestFlight 回执（2026-09-02）

- `0902-shouji` 从 `main` / `v2.1.40` 建立，根因修复提交为 `902e85f0`。移动导出、Desktop 专属入口隐藏和 `cloudProjectId` 精确绑定均在该提交中完成。
- focused `1172/1172`、TypeScript、Rust iOS target、iOS quick build 和差异检查通过。开发签名 IPA 已在真实 iPhone 13 Pro Max 安装和启动；完整云覆盖与文件落盘人工矩阵未执行。
- App Store IPA 从 `902e85f0` 的独立干净 worktree 构建，未包含主工作区其他未提交改动。产物为 arm64、`com.jiucaihezi.mobile`、`2.1.40 (2.1.40.1)`、Team `RXD4L9387J`，使用 Apple Distribution 和 Store 描述文件签名，严格签名验证通过。
- IPA 大小 `19,817,102` bytes，SHA-256 `0198627403bee38bdf3e43f513a852422128d3608c9df6c1dbd6d52baa347bde`；Xcode 上传成功，App Store Connect 构建处理完成。
- 构建已加入内部组“4C-13 内部验收”和外部组“公开内测”，本轮测试重点已填写并提交 Beta App Review；当前状态为“正在等待审核”。公开链接为 <https://testflight.apple.com/join/FUySJFr6>，上限 `110` 人。
- 审核通过前不写成 `2.1.40` 已可供外部下载。TestFlight 安装回归、外部账号安装、第二台设备和 90 天续期仍未执行；本轮没有正式上架 App Store，也没有发布 macOS DMG。

## 关联

- [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]
- [[开发/通用记忆对话独立App SDD#4C 分项验收清单]]
- [[开发/通用记忆对话独立App SDD#14.24 4C-13 TestFlight 上传与内部测试记录（2026-07-28）]]
- [[架构/产品架构]]
- [[来源索引]]

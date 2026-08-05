# 通用记忆工作台单产品化分离 SDD

> 日期：2026-08-04
> 状态：边界已确认，待按 TDD 实施
> 回滚基线：`v2.1.9` / `f302c251`
> 依据：用户 2026-08-04 最终决策、[[架构/产品架构]]、[[开发/通用记忆对话独立App SDD]]

## 1. 唯一决断

**记忆工作台现在拥有的全部功能都保留；记忆工作台现在没有的功能全部迁出。**

这句话同时决定产品范围、代码归属、Wiki 优先级和验收标准。分离不是重写记忆工作台，也不是按目录名称清理仓库。

## 2. 保留与迁出

### 2.1 必须保留

- 默认记忆入口及 Desktop、Web、Mobile 当前可用的全部记忆工作台功能；
- 项目、文件树、Raw 对话、快速/记忆模式、Wiki、项目工具、附件、转换、预览和编辑；
- `.canvas`、`.jccanvas`、`.jcscene`、媒体生成与当前平台已有的导出能力；
- 登录、模型、Provider、Skill、MCP、审批、Gateway、文字云覆盖和发布更新链路；
- 上述能力直接或间接依赖的共享代码、资源、配置、服务和测试。

### 2.2 必须迁出

- OpenCode 产品及其独立 UI、运行时和发布物；
- 旧 Studio 与文/武/道/创四模式产品界面；
- 电商工作台、漫剧工作台、制作工作台及其产品专属入口和发布物；
- 其他记忆工作台当前不可达、也不承担迁移或发布责任的产品专属内容。

### 2.3 归属判定

从记忆 App 平台入口、Gateway、同步、发布配置和门禁测试建立实际依赖闭包。闭包内一律保留；闭包外且仅服务迁出产品的内容才可移动。`agentStore` 等历史命名共享模块若仍被记忆工作台使用，必须先替换或解除依赖，再考虑迁出。

## 3. 目录分离清单

### 3.1 状态定义

| 状态 | 含义 | 执行规则 |
| --- | --- | --- |
| 保留 | 已确认属于记忆工作台当前能力 | 不迁出；后续只允许记忆工作台内部重构 |
| 移出 | 已确认只属于旧产品 | 先验证独立 Git 备份仓库完整，再在主仓按批删除并提交；Git 不能跨仓库执行 `git mv` |
| 禁止删除 | 目录混合、仍被记忆入口依赖，或承载身份/用户数据 | 先拆依赖或按文件分类；禁止整目录移动、删除或清空 |

### 3.2 必须保留的整目录

| 目录 | 保留原因 |
| --- | --- |
| `src/components/memory/` | 记忆工作台主界面、设置、Markdown、项目地图与 3D 编辑 |
| `src/runtime/memory/` | Raw 对话、记忆对话、Wiki、项目骨架、Skill 安装、`.canvas` 与 `.jcscene` 合同 |
| `src/components/auth/` | 记忆工作台登录、退出和账号注销 |
| `src/components/canvas/` | `.jccanvas`、画布持久化、媒体结果入画布；当前记忆创作面板直接依赖 |
| `src/components/creation/` | 记忆工作台当前对话内媒体生成入口 |
| `src/components/icons/`、`src/components/mcp/`、`src/components/media/`、`src/components/skills/` | 当前记忆工作台的图标、MCP、媒体和 Skill 管理能力 |
| `src/runtime/creation/`、`src/runtime/direct/`、`src/runtime/tools/` | 记忆对话、附件、项目工具、Wiki 工具、MCP 与媒体运行时 |
| `src/api/`、`src/data/`、`src/services/`、`src/styles/`、`src/types/`、`src/utils/` | 记忆入口当前共享基础设施；内部可后续逐文件清理，不能整目录迁出 |
| `gateway/` | 登录、账号、文字覆盖、文档和媒体网关 |
| `document-converter/`、`rh-adapter/` | 当前文档转换与媒体生成服务 |
| `public/` | Web 静态资源、帮助/合规页和记忆工作台可调用的全部内置 Skill |
| `.github/` | Web/桌面正式发布与安装包门禁 |

`public/skills/` 中的漫剧、小说、分镜、海报等 Skill 是记忆工作台当前 Skill 能力的一部分。**迁出漫剧工作台不等于删除漫剧 Skill**；除非未来用户明确取消某个 Skill，否则 `public/skills/` 整体禁止迁出。

### 3.3 已确认移出项

以下内容只属于旧 Studio/OpenCode UI、文/武/道/创模式、电商或制作工作台。执行迁出前，先把回滚基线完整克隆到默认兄弟目录 `../jiucaihezi-legacy-products/`，验证其 `HEAD` 为 `f302c251` 且工作树干净；随后每组必须先通过对应红灯测试，再在主仓正常删除并提交。执行前可由用户指定其他备份目标。

| 目录或文件 | 归属 | 前置条件 |
| --- | --- | --- |
| `src/StudioApp.vue` | 旧 Studio/OpenCode 产品入口 | 默认构建不再支持 `studio` mode |
| `src/layouts/` | 旧 `WorkspaceLayout` 多产品壳 | 记忆入口、Desktop/Web/Mobile 构建通过 |
| `src/components/rail/` | 旧文/武/道/创、电商、制作导航 | 当前 `App.vue` 无引用 |
| `src/components/workbench/` | 电商工作台、制作工作台 UI | 共享媒体计划留在原仓库 |
| `src/components/agents/` | 旧 Studio Agent 编辑/评估 UI | 记忆 Skill 管理仍由 `components/skills/` 承担 |
| `src/components/plugins/`、`src/plugin/`、`src/plugins/` | 旧 Studio 插件管理面 | 记忆设置页无插件入口 |
| `src-tauri/tauri.studio.conf.json` | Studio 独立 Bundle/sidecar 配置 | Studio 构建脚本一并迁出 |
| `jiucaihezi-promo/` | Studio 宣传独立项目 | 确认发布脚本无引用 |

### 3.4 混合目录按文件拆分

这些目录不能整目录迁出：

| 混合目录 | 保留部分 | 移出候选 |
| --- | --- | --- |
| `src/runtime/workbench/` | `mediaPlan.ts`、`mediaPlanBridge.ts`、`mediaReference.ts` 及测试；记忆工作台和创作面板正在使用 | `ecommerce*`、`production*`、`singleTurnWorkbench.ts`、`workbenchManifest.ts` 及对应测试 |
| `src/components/chat/` | `ChatScrollNav.vue`、`MediaTaskBubble.vue`、`SkillInstallCard.vue`、`ToolApprovalStrip.vue`、记忆 Markdown/流式显示实际依赖及其测试 | `ChatPanel.vue`、OpenCode timeline/permission/question/todo/diff/context UI；迁出前必须用 import 图确认无记忆依赖 |
| `src/components/editor/` | `editorSessionStore.ts` 当前被 `ProjectFileTree.vue` 引用；其他被项目文件链路引用的模块 | `EditorPanel.vue` 与旧 Studio 独立编辑区；剩余文件逐项判定 |
| `src/components/filetree/` | `ProjectFileTree.vue` 及测试 | `FileTreePanel.vue` 旧 Studio 文件栏 |
| `src/components/settings/` | `LocalCapabilitySetup.vue` 被默认 `App.vue` 使用 | `SettingsPanel.vue` 旧 Studio 设置面 |
| `src/stores/` | `agentStore.ts`、`mediaTaskStore.ts`、`projectStore.ts`、`mcpStore.ts`、`skillsManageStore.ts` 等记忆依赖 | `ecommerceWorkbenchStore.ts`；OpenCode Store 须先解除下节依赖 |
| `src/composables/` | `useContentEditable.ts`、`useFileUpload.ts`、`useFilteredList.ts`、`useTheme.ts`、`useCreation.ts` 等记忆依赖 | `singleTurnWorkbench.ts`、旧 `useChat.ts` 等仅在依赖清零后迁出 |
| `src-tauri/src/` | 项目文件、附件、剪贴板、HTTP、MCP、媒体、Skill、安全存储、3D/FFmpeg 命令 | `commands/opencode.rs` 与 `lib.rs` 中 OpenCode 注册；必须先拆 Rust 状态和命令 |
| `scripts/` | 版本、Skill 索引、图标、Web/Desktop 审计、DMG、文档与媒体部署脚本 | `update-opencode-runtime.mjs` 和 Studio 专属脚本；先清理调用和测试 |
| `docs/wiki/` | 当前记忆 SDD、架构、运维、排障、学习、发布证据 | 旧产品 SDD 迁到备份 Wiki；先补替代链接，不直接删 |

### 3.5 现阶段禁止删除的迁出阻塞项

以下内容最终属于 OpenCode/旧 Studio，但仍在当前记忆依赖闭包中，**现在禁止删除或移动**：

| 阻塞项 | 当前依赖证据 | 解锁条件 |
| --- | --- | --- |
| `src/opencodeClient/` | `src/stores/agentStore.ts` 静态引用 `daemon/client/catalog/providerProjection`；记忆工作台直接使用 `agentStore` | 把记忆模型目录、Provider 和 Skill 能力拆成无 OpenCode 依赖的 Store，门禁证明功能等价 |
| `src/stores/openCodeSyncStore.ts` | 当前 `CreationPanel.vue` 仍读取活动 session/目录；记忆工作台动态加载该面板 | 创作面板改为只使用记忆项目 owner/path，不再读取 OpenCode session |
| `src/stores/sessionStore.ts`、`src/stores/chatModeStore.ts` | 默认 `App.vue` 加载的 `GlobalSearch.vue` 仍使用旧 Session Store | 全局搜索改为搜索 Raw 对话/项目文件，且默认入口无旧 Store 引用 |
| `src-tauri/src/commands/opencode.rs` 与 `src-tauri/src/lib.rs` 的 OpenCode 注册 | 默认原生库仍管理 `OpenCodeRuntime` 并注册命令 | Rust 门禁先证明默认记忆构建不注册 OpenCode 状态和命令 |
| `@opencode-ai/sdk`、`scripts/update-opencode-runtime.mjs`、OpenCode focused tests | `agentStore`、旧 Store 和当前测试编译仍引用 | 前述 TypeScript/Rust 依赖全部清零，再从 `package.json`、lockfile和测试清单移出 |

这张表是防误删清单，不代表 OpenCode 可以继续留在最终产品。正确顺序是“先替换记忆依赖，再迁出 OpenCode”，不是先删目录再补功能。

### 3.6 永久禁止删除的身份、数据与发布路径

- `src-tauri/tauri.conf.json`、`src-tauri/tauri.ios.conf.json`、`src-tauri/updater_public.pem`、`src-tauri/icons/`、`src-tauri/ios/`；
- `.github/workflows/build.yml`、`scripts/set-version.mjs`、`scripts/audit-web-dist.mjs`、`scripts/audit-desktop-dist.mjs`、`scripts/create-official-dmg.mjs`；
- `gateway/migrations/sync/`、`gateway/src/sync-service.js` 及其测试；
- 用户项目中的 `.raw/`、`.raw/对话记录/`、`.raw/jc-media/`、`wiki/`、`docs/wiki/`、`.sync/`、`jc-canvas/` 和普通项目文件；
- Desktop/Mobile 应用数据目录、浏览器 IndexedDB/OPFS、账号凭据、云 `project_id` 绑定和生产 D1 数据。

`dist/`、`node_modules/`、`src-tauri/target/`、`src-tauri/gen/`、`.wrangler/` 等可再生成目录不属于产品迁出物，不复制进备份仓库，也不能作为发布身份、回滚能力或源代码可删除的证据。

## 4. 同步合同

产品只提供两个手动数据动作：

- `上传并覆盖云端`：以本地完整可同步文字快照覆盖云端，删除云端独有可同步文字。
- `下载并覆盖本地`：以云端完整可同步文字快照覆盖本地，删除本地独有可同步文字。

不合并、不创建冲突副本、不判断“哪边更新”、不监听文件变化、不后台排队、不自动双向同步。媒体、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不比较、不传输、不删除。设置页只显示账号、绑定、范围、进度和最近结果；项目中心拥有两个动作。

## 5. 不可改变的身份

- Desktop：产品名“韭菜盒子”、`com.jiucaihezi.desktop`、`jiucaihezi://`、签名、更新地址、公钥和应用数据目录。
- iOS：`com.jiucaihezi.mobile`、现有 iOS 签名与数据身份。
- Android：当前无稳定独立身份和公开版本，生成工程可能仍使用 Desktop 标识；本轮暂停，不能登记为已验证或已发布。
- Web/Gateway：<https://jiucaihezi.studio>、<https://api.jiucaihezi.studio>。
- 数据：本地项目路径/owner、浏览器项目存储、账号、云 `project_id`、Raw/Wiki 路径与现有升级数据。
- 发布：`v*` tag、生产 `latest.json`、macOS ARM、macOS Intel、Windows x64 通道。

## 6. TDD 实施顺序

1. **基线门禁**：先写测试锁定记忆入口、现有功能入口、同步按钮文字与行为、Bundle ID、Deep Link、更新地址、公钥和产物禁入项。
2. **直接迁出旧壳**：让测试先失败，再迁出 3.3 已确认项；记忆共享依赖保持不动。
3. **拆分混合目录**：按 3.4 逐文件迁出电商、制作和旧 Studio 内容；每批独立提交。
4. **解除 OpenCode 阻塞**：按 3.5 先替换 `agentStore`、创作面板和全局搜索依赖，再迁出 OpenCode TypeScript/Rust/SDK/脚本。
5. **文档与发布收口**：迁出旧产品 Wiki，移除 Studio 构建命令，保留记忆发布身份和历史回滚证据。
6. **发布验收**：运行 focused、TypeScript、Web/Desktop/iOS 构建、产物审计和真实平台矩阵，确认旧版升级与云项目绑定连续；Android 仅在独立身份和工具链建立后另行验收。

任何一批失败都停止并回退该批；无需回滚已经通过的前一批。整体异常可回到 `v2.1.9` / `f302c251`。

## 7. 本轮范围

本轮只完成目录级 SDD，不移动、删除或归档代码与目录，不改变发布产物。下一轮从基线门禁测试和备份仓库初始化开始。

## 反向链接

- [[CLAUDE]]
- [[hot]]
- [[架构/产品架构]]
- [[开发/通用记忆对话独立App SDD]]

# Web 云端项目、Wiki、媒体同步与 APP 升级 SDD

> 状态：设计草案，待用户确认后实施  
> 设计分支：`0713-webchonggou`
> 日期：2026-07-13

## 1. 目标

让 Web 端在用户视角上接近本地 APP，重点支持两条主线：

1. 选择 Skill 后，由 Skill 自身定义并执行 Wiki 建库结构。
2. 直连 LLM 读取 Skill、`CLAUDE.md` 和 Wiki 内容，持续写作并回写项目文件树。

同时满足：

- Web 项目可跨浏览器、跨电脑同步；
- 文本、Wiki、Skill 状态由 Cloudflare D1 同步；
- 图片、视频、音频等字节放 Cloudflare R2；
- R2 媒体默认保留 12 小时，硬上限 24 小时；
- Web 与本地 APP 都支持项目文件右键“另存为”；
- 本地 APP 保留本地 SQLite/文件真源，通过显式同步连接云端；
- APP 更新使用真正的 Tauri updater 产物，不再把普通安装包误当 OTA 产物。

## 2. 非目标

- Web 不启动 OpenCode，不把 Desktop 的 `openCodeSyncStore` 搬到浏览器。
- 不给用户开放服务器宿主机 Shell。
- 不把图片、视频、音频字节写入 D1。
- 不承诺 R2 媒体超过 24 小时仍可跨设备访问；需要长期保留时必须另存为本地或未来接入持久媒体存储。
- 不把 Skill 的建库逻辑改写成一个通用固定模板。

## 3. 用户体验

### 3.1 新建项目

用户选择 Skill 并开始创作。系统调用该 Skill 的建库能力，创建项目文件树。例如 `JC-短剧-世界模型` 的事实源是：

- `public/skills/JC-短剧-世界模型/SKILL.md`；
- `references/建制阶段.md`、`references/核心机制.md` 等引用资料；
- `scripts/scaffold_wiki.py`；
- Skill 中定义的 `.raw/`、`wiki/`、`CLAUDE.md` 约定。

Web 不擅自生成一套通用 Wiki。它只执行 Skill 提供的 scaffold 结果：目录、初始文件和内容均来自 Skill。

### 3.2 写作与记忆

每次请求按渐进式上下文组装：

```text
用户输入
  + 当前 Skill 的 SKILL.md/必要 references
  + 项目 CLAUDE.md
  + wiki/index.md 或 wiki/hot.md
  ↓
LLM 判断需要的文件
  ↓
wiki_search / wiki_read
  ↓
生成内容
  ↓
wiki_write / wiki_mkdir
  ↓
文件树和同步状态刷新
```

不把整个 Wiki 每次塞进上下文。`CLAUDE.md` 负责导航，`index.md`/`hot.md` 负责快速召回，具体档案由工具按需读取。

### 3.3 右键另存为

同一个“另存为”命令在两端使用不同存储适配器：

| 运行环境 | 行为 |
|---|---|
| Desktop | 原生保存对话框，写入用户选择的本地目录 |
| Web | `Blob` + 浏览器下载，写入用户下载目录 |

文件树里的文本、图片、视频、音频均可导出。Web 端不把 `file://` 路径发送给服务器，而是下载或上传实际字节。

## 4. 运行时分层

```text
Cloudflare Pages
  └─ Web UI、项目文件树、编辑器、IndexedDB 缓存

Project Sync Worker
  ├─ 用户认证与项目 API
  ├─ D1 文本/元数据/版本
  ├─ R2 媒体临时对象
  └─ LLM 工具调用与同步事件

Existing LLM API
  └─ 直连模型请求，不经过 OpenCode

Desktop
  ├─ 本地 SQLite + 本地媒体文件
  └─ 显式同步到 Project Sync Worker
```

Web 端可以采用与 Desktop 相同的“事件 → Reducer → Store → UI 投影”思想，但事件来源是直连 LLM 和同步 API，不是 OpenCode `global.event`。

## 5. 数据存储

### 5.1 D1

D1 保存项目数据和文本，不设置自动过期：

- `projects`：用户、项目名、Skill、版本、更新时间；
- `project_files`：相对路径、文件类型、文本内容、父目录、版本号；
- `project_revisions`：同步游标、变更记录、冲突信息；
- `skill_bindings`：项目使用的 Skill 和版本；
- `media_assets`：媒体元数据、R2 key、MIME、大小、过期时间；
- `sync_cursors`：Web/APP 最后同步位置。

D1 数据保留到用户删除项目，或后续增加明确的项目清理功能。不能用 R2 的短 TTL 代替 D1 数据保留。

### 5.2 R2

R2 只存媒体字节和临时导出文件：

- 默认 TTL：12 小时；
- 硬上限：24 小时；
- `expiresAt` 写入 D1；
- Worker Cron 每小时清理过期对象和元数据；
- 不能只依赖 R2 生命周期规则，因为本需求需要小时级过期控制。

因此跨设备长期同步保证的是文本、Wiki 和项目结构。媒体必须在 24 小时内“另存为本地”；若未来要求云端长期保留媒体，需要单独增加持久媒体策略，不能继续使用这个硬上限。

## 6. Skill 建库协议

Skill 是建库事实源，不由 Web 自己猜目录。Skill 需要暴露可执行的 scaffold 结果：

```text
folders: string[]
files: { path, content, mimeType }[]
postCreate: 可选的 CLAUDE.md/索引更新动作
```

对于 `scaffold_wiki.py` 这类 Python 脚本，执行方式二选一：

1. 在受限 Worker 中运行 Skill 脚本并返回文件操作；
2. 在构建 Skill 索引时预编译为 scaffold manifest，Web 只执行 manifest。

推荐第 2 种：Web 建库不依赖服务器 Shell，且结果可审计、可重复。脚本仍保留为 Skill 的本地/桌面事实源。

## 7. LLM 工具协议

第一阶段只需要以下工具：

| 工具 | 作用 |
|---|---|
| `project_list` | 列出用户项目 |
| `wiki_list` | 列出目录和文件 |
| `wiki_search` | 按路径、标题、内容搜索 |
| `wiki_read` | 读取指定文本文件 |
| `wiki_mkdir` | 创建目录 |
| `wiki_write` | 写入或更新文本文件 |
| `media_read` | 获取媒体引用和可分析地址 |
| `media_export` | 生成用户下载/另存为任务 |

写操作必须携带项目 ID、相对路径和期望版本号。版本不匹配时返回冲突，不静默覆盖其他设备内容。

## 8. 媒体读取与视频关键帧

### 8.1 图片

`media_read` 返回短期签名 URL、MIME 和尺寸。支持视觉的模型直接将签名 URL 作为图片输入。签名 URL 的有效期不超过 R2 对象剩余 TTL。

### 8.2 视频

服务器不能靠浏览器直接分析任意视频。需要一个隔离媒体 Worker：

```text
R2 视频
  → Worker 临时下载
  → FFmpeg 提取关键帧
  → 关键帧上传 R2 临时目录
  → 返回图片 URL 给视觉模型
  → 任务完成后按 TTL 清理
```

所需组件是 FFmpeg，不是 OpenCode。FFmpeg 必须运行在独立容器或独立 Worker 主机，限制 CPU、内存、时长、文件大小和并发，不能直接在 NewAPI 宿主机上开放任意命令。

## 9. APP 与 Web 同步

- Desktop 继续以本地 SQLite 和本地媒体文件为真源；
- Web 以 D1/R2 为云端同步真源，IndexedDB 只是缓存；
- APP 不自动上传所有本地项目，用户通过“同步项目”显式选择；
- 文本采用版本号/变更游标同步；
- 媒体上传到 R2 后受 24 小时 TTL 约束；
- 用户导出到本地后，长期保存由本地文件负责。

## 10. APP 自动升级现状与修正方向

当前配置已经启用 `tauri-plugin-updater`，但发布链路存在两个根本问题：

1. 当前 `latest.json` 指向 DMG，而 Tauri updater 应使用 updater 专用归档及签名；
2. Windows 当前发布的是 portable zip，并没有 NSIS/MSI updater 产物，因此 Windows 不能真正点击自动升级。

目标发布物应分开：

| 用途 | macOS | Windows |
|---|---|---|
| 用户手动下载 | `.dmg` | portable `.zip` |
| Tauri OTA | `.app.tar.gz` + `.sig` | NSIS updater zip + `.sig` |

`latest.json` 只能把 OTA 平台 URL 指向签名后的 updater 产物。DMG 和 portable zip 继续作为下载页手动下载文件，不再混用。

自动升级验收条件：

- 当前版本低于清单版本；
- endpoint 返回正确平台条目；
- 签名和内置公钥匹配；
- updater 归档格式正确；
- 下载、验签、安装、重启全链路通过；
- Windows 先改为 NSIS/MSI 安装模式后再宣称支持 OTA。

## 11. Cloudflare 组件

推荐单独创建项目数据 D1，不与现有 Gateway 身份/路由 D1 混用：

- Pages：静态 Web；
- Project Sync Worker：项目、文件、同步 API；
- D1：项目、文本、版本和媒体元数据；
- R2：12-24 小时临时媒体；
- Cron Trigger：小时级媒体清理；
- 现有 API：LLM、登录和计费；
- 独立 Media Worker：FFmpeg 关键帧任务。

第一阶段不安装服务器 Shell，不改 NewAPI 容器，不搬 OpenCode。

## 12. 分阶段交付

1. Web 项目模型、D1 文件同步、IndexedDB 缓存；
2. Skill scaffold manifest，确保 Skill 自己生成 Wiki 结构；
3. `CLAUDE.md`/Wiki 渐进式读取和 `wiki_*` 工具；
4. 文件树右键另存为，Desktop/Web 共用命令语义；
5. R2 临时媒体、图片读取和媒体引用；
6. FFmpeg 关键帧 Worker；
7. Desktop 显式同步；
8. Tauri updater 专用产物和三平台升级验收。

## 13. 必须保留的产品决策

- Skill 决定 Wiki 结构，Web 不生成通用替代结构；
- D1 数据默认长期保留；
- R2 媒体默认 12 小时、最长 24 小时；
- Web/APP 都支持右键另存为；
- Web 不调用 OpenCode；
- 本地 APP 保留本地真源；
- 云端同步必须由用户显式触发；
- OTA 不能把 DMG/portable zip 当 updater 归档。

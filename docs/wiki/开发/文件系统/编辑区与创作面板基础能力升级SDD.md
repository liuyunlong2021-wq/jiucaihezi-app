# SDD：编辑区与创作面板基础能力升级

> 日期：2026-07-18
> 状态：核心实现完成；Desktop 部分人工验收已通过，完整双端人工验收待执行
> 分支：`0718-wenjianshu&bianjiqu`
> 前置：[[开发/文件系统/文件树一期资源身份与文件安全SDD]] 的已实施部分
> 目标：让编辑区和创作面板成为项目资源的可靠消费者，作为文件树二至五期的前置，而不是继续在文件树组件中补状态。

## 1. 结论

文件树一期已经有了资源分类、文件服务和改名/删除事件，但编辑区和创作面板尚未具备完整的资源生命周期。

- 编辑区的 Tab 目前主要是标题列表；内容、保存基线、异步加载和删除状态仍由 `EditorPanel.vue` 的单一当前文件变量持有。切换 Tab 会重新读取或自动保存，不能可靠地表达多个脏文档。
- 画布的 `.jccanvas` 已有单 `owner:path` 保存队列和任务 gate，但 `CanvasAsset.kind` 仅有 `image | video`。音频没有可持久化、可恢复、可播放的画布表示。
- Tiptap 是富文本编辑内核，不是文件工作副本管理器；LeaferJS 是场景树和交互内核，不是媒体库或播放器。文件身份、版本、冲突、保存顺序和运行时 URL 只能由应用层负责。

因此本 SDD 只补这两个消费者的基础合同。完成前，文件树不继续进入多选/移动/批量操作或 Explorer 增强。

## 2. 依据与边界

### 2.1 已核对的项目事实

| 事实 | 当前代码 | 影响 |
|---|---|---|
| 项目资源已有统一分类 | `src/utils/projectResource.ts` | 文本、媒体、画布、二进制已有正确入口，不能再各组件自行按扩展名判断。 |
| 文件服务已有完成后事件 | `src/services/projectFileService.ts` | 现有 `created / renamed / deleted` 可作为统一事件入口，但尚缺版本和外部 `changed` 合同。 |
| Tab 不保存独立文档状态 | `EditorPanel.vue` 的 `openTabs` 只保留元数据；当前内容在一个 Tiptap 实例中 | 多 Tab、自动保存、关闭确认和改名/删除不能只靠 `currentFilePath`。 |
| 当前保存仍可绕过文件服务 | `saveToFile()` 直接走磁盘/SQLite 分支 | 无法提供统一的 revision 比对、写后事件和冲突处理。 |
| 画布保存已按资源串行 | `canvasPersistence.ts` 的 `owner:path` 队列 | 这是正确基础，必须保留，不用新的全局锁覆盖。 |
| 画布资产只支持两种媒体 | `src/types/canvas.ts`、`CreationPanel.vue` | 项目树可以识别音频，却不能把它安全加入画布。 |

### 2.2 外部实现的可复用结论

| 项目 | 已核对内容 | 本项目采用什么，不采用什么 |
|---|---|---|
| [Tiptap](https://github.com/ueberdosis/tiptap/tree/4c25d55ab70f6c263b3ff2bcf8870018e74b7ce7) | `Editor` 发出 `transaction`、`update` 等事件，保存和状态由宿主处理。 | 用事务更新会话脏状态、用 `setContent(..., false)` 恢复会话；不把文件生命周期塞进 Tiptap extension。 |
| [Leafer UI](https://github.com/leaferjs/leafer-ui/tree/7e284cb3b1e7eec79d7e809c73884f7aee1efe5f) | 场景树、选择/移动/缩放/多选由 Editor 插件和可序列化节点承担。 | 继续用 Leafer 表示视觉节点；音频播放和项目资源解析留在应用层，不假装 Leafer 原生播放音频。 |
| [VS Code](https://github.com/microsoft/vscode) 本机源码 | `TextFileEditorModel` 将脏状态、资源、顺序化保存、冲突、孤儿状态分开管理；资源移动由 `oldResource -> newResource` 传播。 | 借用“每个工作副本独立状态 + 保存串行 + 删除不复活”的模型；不复制多编辑组、工作台备份服务和完整 diff/merge。 |

`defuddle` 在当前环境没有可执行文件，因此 GitHub 代码以仓库 commit、原始源码和本机 VS Code clone 核对。上述结论不依赖 README 的宣传语。

### 2.3 不做

1. 不做 CRDT、多人协作、在线合并或全量三方 diff。
2. 不做 VS Code 多编辑组、分屏、预览 Tab、工作区备份系统的完整复刻。
3. 不做音视频时间线、波形编辑、剪辑、混音或通用媒体编辑器。
4. 不做全项目自动改写 Markdown/画布引用；路径重命名的全局 refactor 是单独能力，不能隐式发生。
5. 不做文件树二至五期的菜单、拖放或批量 UI。本 SDD 只交付它们所依赖的消费者基础。

## 3. 完成文件树五期所需能力

### 3.1 能力清单

| 领域 | 必须具备的基础能力 | 缺失时会怎样 |
|---|---|---|
| 编辑区 | 每个 Tab 独立的资源、内容、保存基线、脏状态、加载令牌和保存状态 | 切 Tab 时覆盖内容；改名/删除只能修当前文件。 |
| 编辑区 | 完整读取、版本快照、条件保存和串行写入 | 大文件/外部修改可被部分内容或旧内容覆盖。 |
| 编辑区 | 关闭、保存、放弃、另存为、删除后恢复路径 | 删除脏文档会复活旧文件或丢失用户选择。 |
| 编辑区 | 外部修改与冲突状态 | 批量改名/移动、跨标签或外部程序修改会静默覆盖。 |
| 编辑区 | 项目文档与临时草稿的明确归属 | 自动创建的 SQLite 文档和项目文件混淆，文件树无法反向定位。 |
| 创作面板 | 统一 `image | video | audio` 资产模型及旧画布迁移 | 音频只能被“识别”，无法被恢复、删除或引用。 |
| 创作面板 | 音频的可序列化卡片、播放控制与缺失状态 | 文件树把音频交给画布后成为不可见或不可恢复的数据。 |
| 创作面板 | owner/path/revision 对应的运行时媒体 URL 获取与释放 | Web blob URL 泄漏，项目切换后旧素材可能进新画布。 |
| 创作面板 | 当前画布对资源改名/删除的确定行为及任务 gate | 文件树移动/删除会与异步生成、恢复、保存互相覆盖。 |
| 跨面板 | 单一资源事件、操作 ID、事件顺序、owner 隔离 | 树、Tab、画布各自刷新，二至五期会不断出现状态竞态。 |
| 跨端 | Desktop/Web 同语义的读、写、revision、错误结果 | 一端能保存另一端会覆写或误报冲突。 |

### 3.2 与文件树五期的依赖关系

| 文件树阶段 | 依赖的编辑区能力 | 依赖的创作面板能力 | 本 SDD 的交付门槛 |
|---|---|---|---|
| 一期，资源身份与安全 | 资源 Tab、删除不写回旧路径 | 画布 task gate | 已部分落地；本 SDD 收尾。 |
| 二期，复制/剪切/粘贴/拖放/批量删除 | 每个受影响 Tab 能按操作 ID 改名、删除、冲突或另存为 | 当前画布能冻结任务目标并标记缺失资产 | 未通过前，禁止批量 mutation UI。 |
| 三期，增量事件/大项目状态 | 加载令牌、干净文档重载、脏文档不自动重载 | owner/load token、URL 生命周期、可取消恢复 | 未通过前，轮询不能被简单删掉。 |
| 四期，编辑区对齐 | 会话模型、条件保存、关闭确认、冲突和草稿归属 | 不额外扩大范围 | 本 SDD 的编辑区主体。 |
| 五期，Explorer 增强 | Tab/资源反向定位不依赖标题或旧路径 | 画布资源缺失可定位、可重新关联 | 只是增强前提，不把 Git/回收站塞入本 SDD。 |

## 4. 目标架构

```text
ProjectFileService（资源读写 + revision + 完成事件）
  -> ProjectResourceChange（按 owner 串行的完成事件）
     -> EditorSessionStore（每个 Tab 一个工作副本）
        -> 单个 Tiptap View（只渲染 active session）
     -> CanvasSession（当前 .jccanvas + assets + load token）
        -> Leafer scene / 单一 HTMLAudioElement
```

组件只负责展示和用户选择。文件树、编辑区、创作面板都不得在各自组件里再定义资源身份、路径规则或写入旁路。

## 5. 跨面板资源合同

### 5.1 资源 revision

在既有 `ProjectResource` 之外增加只读 revision，不制造 Desktop 永久 ID。

```ts
interface ProjectResourceRevision {
  value: string              // 适配器生成的不透明值，只比较相等性
  size: number
  updatedAt?: number
}

interface ProjectTextRead {
  resource: ProjectResource
  content: string
  revision: ProjectResourceRevision
  truncated: boolean
}
```

- Web：在 IndexedDB 同一事务内读取 documents 记录的版本/更新时间和内容。
- Desktop：Rust 在读取和写入边界提供文件 stat 快照（mtime + size 的不透明编码）；条件写入在同一 Rust 命令中紧邻临时文件替换前检查。
- revision 不是 content hash，不用于文件身份，也不承诺拦住所有外部进程的 TOCTOU；它用于拒绝已观测到的旧工作副本覆盖新版本。

文件服务补齐如下能力。原有 API 保持，调用者不能直接绕过它写项目文本。

```ts
type WriteTextResult =
  | { status: 'saved'; resource: ProjectResource; revision: ProjectResourceRevision }
  | { status: 'conflict'; current: ProjectTextRead }
  | { status: 'missing' }

readText(resource): Promise<ProjectTextRead>
writeText(resource, content, expectedRevision): Promise<WriteTextResult>
createText(owner, path, content): Promise<{ resource: ProjectResource; revision: ProjectResourceRevision }>
```

### 5.2 完成后事件

```ts
type ProjectResourceChange =
  | { type: 'created'; resource: ProjectResource; revision?: ProjectResourceRevision; operationId: string; source: 'local' | 'external' }
  | { type: 'changed'; resource: ProjectResource; revision: ProjectResourceRevision; operationId: string; source: 'local' | 'external' }
  | { type: 'renamed'; oldResource: ProjectResource; resource: ProjectResource; operationId: string; source: 'local' | 'external' }
  | { type: 'deleted'; resource: ProjectResource; operationId: string; source: 'local' | 'external' }
```

规则：

1. mutation 成功后才发事实事件；失败、冲突和取消不伪造成功事件。
2. 每个 `owner` 的本地 mutation 按操作串行；同一 `operationId` 的事件由消费者去重。
3. 消费者先检查 runtime、owner 和当前 `loadToken`，再改变 UI。旧项目事件只记录日志，不碰当前会话。
4. `changed` 用于保存完成和外部观察；本地保存收到自己的事件只能确认 revision，不能把仍在编辑的新内容重载掉。
5. 目录移动/批量 mutation 后续以一个操作 ID 产生完整映射；本 SDD 不实现 UI，但先禁止“只通知根目录、让消费者猜后代路径”。

## 6. 编辑区基础

### 6.1 会话模型

一个 Tab 对应一个 `EditorSession`，而非一套全局 `currentFile*` 变量。

```ts
type EditorSessionState = 'loading' | 'ready' | 'saving' | 'conflict' | 'deleted' | 'readonly' | 'error'

interface EditorSession {
  tabId: string
  resource: ProjectResource | null // null 仅限明确的新建临时草稿
  title: string
  document: JSONContent
  markdown: string
  assets: EditorAssetRef[]
  baseRevision?: ProjectResourceRevision
  savedDocumentVersion: number
  documentVersion: number
  loadToken: number
  state: EditorSessionState
  saveError?: string
}
```

`dirty` 是 `documentVersion !== savedDocumentVersion`，不得以标题、是否磁盘文件或“曾调用保存”推断。Tiptap 的 `transaction`/`update` 只更新 active session 的版本；程序性 `setContent` 必须带 `emitUpdate: false`，防止加载被误标为用户修改。

本期保留一个 Tiptap View：切换 Tab 前将 `editor.getJSON()`、Markdown 和资源附件快照写回旧 session；切换后从新 session 恢复，不重新读文件。只有首次打开或用户明确“从磁盘重载”才读取资源。这样不引入多编辑组，也不会丢失不可保存的暂存内容。

### 6.2 打开、保存和关闭

| 场景 | 行为 |
|---|---|
| 打开项目文本 | 通过 `ProjectFileService.readText()` 取得完整内容和 revision；截断/NUL/二进制只读拒绝，不建可写 session。 |
| 新建项目文档 | 明确的项目内“新建”先 `createText()`，session 立刻有资源和 revision。 |
| 临时草稿 | 仅由明确入口创建 `resource: null` session；不会被自动当作项目文件。 |
| 保存 | 对 session 快照调用 `writeText(resource, markdown, baseRevision)`；保存期间串行，同一 session 的新编辑保留为脏状态。 |
| 保存成功 | 只有保存时的 `documentVersion` 仍等于当前版本，才推进 `savedDocumentVersion`；否则只更新 base revision，继续脏。 |
| 保存冲突 | 进入 `conflict` 且禁止自动保存；用户只能“重新加载并放弃本地修改”“另存为新文件”或取消。首期不做合并编辑器。 |
| 关闭脏 Tab | 显示“保存 / 放弃 / 取消”；保存失败或冲突时不关闭。 |
| 删除无脏 Tab | 关闭 session。 |
| 删除脏 Tab | 进入 `deleted`，禁止原路径保存；显示“另存为新项目文件 / 放弃修改”。未选择前保留 session。 |

“另存为”必须先让用户选合法项目相对路径，再通过 `createText()` 创建资源；成功后同一个 session 原子地换绑到新资源、revision 和 Tab 标题。它不是把旧 `filePath` 改个字符串，也不允许 `saveToFile()` 自动重建删除的文件。

### 6.3 外部变化、恢复和只读

1. 收到其他操作的 `changed`：干净 session 自动读取最新内容；脏 session 进入 `conflict`，不静默重载。
2. 收到 `renamed`：更新匹配资源的每个 session 的 resource、标题和 Tab ID，不改变内容或 dirty。
3. 收到 `deleted`：按上表处理全部匹配 session，而不是只处理 active Tab。
4. 解析失败、权限错误、文件超限、二进制或 NUL 内容都进入 `readonly`/`error`，不能提供保存按钮。
5. 可选的崩溃恢复只写本地 IndexedDB 的 session 快照，键为 `owner + path + baseRevision`；恢复提示不能自动写回项目，更不能复活已删除资源。

## 7. 创作面板与画布基础

### 7.1 可持久化资产模型

画布文档升级到 V3。V1/V2 都迁移到 V3；旧图片和视频保留原有视觉效果。`owner` 属于画布文件运行上下文，文档中只持久化项目相对路径和 Web 可选 id，避免 Desktop 绝对路径写进项目文件。

```ts
type CanvasMediaKind = 'image' | 'video' | 'audio'

interface CanvasAssetRef {
  path: string
  id?: string                 // 仅 Web 稳定 documents id
  revision?: ProjectResourceRevision
}

interface CanvasAssetV3 {
  id: string
  kind: CanvasMediaKind
  resource: CanvasAssetRef
  source: 'creation' | 'drop' | 'paste' | 'import'
  mimeType?: string
  duration?: number
  width?: number
  height?: number
  model?: string
  prompt?: string
  createdAt: number
}

interface CanvasDocumentV3 {
  version: 3
  canvasId: string
  updatedAt: number
  viewport: { x: number; y: number; zoom: number }
  scene: CanvasSceneNode[]
  assets: Record<string, CanvasAssetV3>
}
```

`CanvasAssetV3.resource.path` 必须是项目相对路径，禁止 `blob:`、`data:`、本机绝对路径和远程临时 URL。创建、导入和生成结果先落到项目媒体目录，再写画布文档。

### 7.2 音频在画布中的真实表现

音频不是 Leafer 的 image/video 节点。每个音频资产在 `scene` 中以可序列化的 `Group` 卡片表示，带 `tag: 'canvas-audio-card'` 和 `assetId`；恢复时由项目自己的 renderer 构建卡片子节点。播放由创作面板维护的单一 `HTMLAudioElement` 完成，卡片只控制播放、暂停、名称、时长和缺失状态。

这保证音频的加入、移动、删除、保存、重开和项目切换都有真实语义，同时不引入时间线或在 Leafer Canvas 内伪造播放器。模型参考能力由 capability 决定：当前只把图片/视频传给支持它们的生成接口；音频可被选中和播放，但不能偷偷当图片参考提交。

### 7.3 URL、恢复与资源变化

```text
CanvasAssetUrlResolver.acquire(owner, resource) -> { url, release }
CanvasAssetUrlResolver.releaseAll(canvasSessionId)
```

- Web 从 OPFS/IndexedDB blob 建立 object URL，并由 `release` 在卡片删除、画布切换、资源变化和组件卸载时 `URL.revokeObjectURL()`。
- Desktop 返回安全的 Tauri asset URL，不创建 object URL；同一 resolver API 仍负责失效。
- 画布打开、恢复媒体 URL、异步封面、任务结果都捕获 `owner + canvasPath + loadToken`。任一不匹配时丢弃结果并释放 URL。
- 已存在的 `owner:path` 保存队列、`canvas:before-rename`、`canvas:before-delete`、`canvas:before-task-write` gate 是正确的并发边界，必须保留。不得新增跨项目全局队列。

### 7.4 改名、删除和缺失资源

1. 当前打开画布收到媒体 `renamed`：在同一画布保存队列中更新匹配 asset 的 `resource.path`，再重新解析 URL；任务写入中的目标仍由现有 gate 拒绝改名。
2. 当前打开画布收到媒体 `deleted`：停止播放、释放 URL、保留卡片为 `missing`，不悄悄删除用户的排版；用户可移除卡片或通过“重新关联”选择同类型项目媒体。
3. 未打开画布不扫描、不静默重写。全项目引用重构未在本 SDD 范围；再次打开时路径找不到也显示 `missing`，这是比猜测错误文件更安全的行为。
4. `.jccanvas` 自身改名/删除继续先过 lifecycle gate；改名后 canvas session 更新路径，删除后不再 flush 旧快照。

## 8. 实施顺序

### Milestone A：资源版本与编辑会话

1. 给 Desktop/Web 适配器补 revision、条件 `writeText` 与 `changed` 事件；先写 Desktop/Web 共享 contract test。
2. 新建无 UI 的 `EditorSessionStore`，将 Tab、session、active session 和保存串行从 `EditorPanel.vue` 拆出。
3. 将 Tiptap 绑定为 active session view，移除以 `currentFilePath/currentFileId` 为唯一事实的保存路径。
4. 完成关闭、删除脏文件、另存为、外部冲突的最小界面与测试。

**门槛：** 任意 Tab 改名、删除、切换、保存都不能写旧路径；同一 session 连续保存不会丢后一次修改。

### Milestone B：画布 V3 与音频

1. 在纯 `canvasDocument` 层先完成 V1/V2 -> V3 迁移、类型校验和旧文档 round-trip 测试。
2. 扩展 `CreationPanel` 的媒体进入、恢复和卡片渲染，支持音频，不改写既有图片/视频入口。
3. 加入 `CanvasAssetUrlResolver` 与单音频播放控制器，覆盖 owner/load token 和释放。
4. 接入当前画布的媒体改名、删除、缺失和重新关联；保持 task gate。

**门槛：** 音频从项目树进入画布后，保存、关闭、重开、切项目、删除原文件均没有空白节点、泄漏 URL 或旧项目写入。

### Milestone C：统一联动与文件树解锁

1. 让 EditorSessionStore 与 CanvasSession 只订阅 `ProjectResourceChange`，删除组件间直接猜路径的事件旁路。
2. 添加 owner 隔离、operation ID 去重、外部 `changed` 和同时保存/改名的回归。
3. 进行 Desktop/Web 手工验收，记录结果回写本 SDD 和文件树一期 SDD。

**门槛：** 通过第 9 节矩阵后，才允许开始文件树二期的批量操作协议；不是直接开始其 UI。

## 9. 验收矩阵

| 场景 | Desktop | Web | 自动验证 |
|---|---|---|---|
| 两个项目文本交替编辑、切换 Tab | 各自内容和 dirty 独立 | 同左 | EditorSession store test |
| 连续保存后再次编辑 | 不丢第二次修改 | 同左 | 条件写入/串行 test |
| 外部修改干净文件 | 自动重载并更新 revision | 同左 | service + session test |
| 外部修改脏文件 | 进 conflict，不自动覆盖 | 同左 | session test |
| 改名已打开脏文档再保存 | 只写新路径 | 同左 | service + session test |
| 删除已打开脏文档 | 只能另存为或放弃，绝不复活旧路径 | 同左 | session test + 手工 |
| 音频加入画布并重开 | 音频卡片、播放、位置恢复 | 同左 | canvas document + UI contract |
| 删除/改名当前画布音频 | 卡片正确更新或缺失，不写旧资源 | 同左 | canvas session test |
| 任务 A 提交后切到项目 B | 结果不进入 B，也不覆盖 A 的旧快照 | 同左 | 既有 task gate 回归扩展 |
| 切画布/卸载 | Web object URL 全部释放；Desktop 无 blob URL | 同左 | resolver unit test |

完成命令以新增测试实际位置为准，最低包括：

```bash
pnpm exec esbuild src/services/__tests__/projectFileService.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/projectFileService.test.cjs
node --test /tmp/projectFileService.test.cjs

pnpm exec esbuild src/components/canvas/__tests__/canvasDocument.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/canvasDocument.test.cjs
node --test /tmp/canvasDocument.test.cjs

pnpm run test:focused
pnpm exec vue-tsc -b
pnpm exec vite build
git diff --check
```

若 `vue-tsc -b` 仍有本任务外的既有错误，必须在验收记录中逐条分离；不能把“没有新增报错”写成整仓类型检查通过。

## 10. 影响模块

| 模块 | 变化职责 |
|---|---|
| `src/services/projectFileService.ts` | revision、条件文本写入、`changed` 事件、操作 ID。 |
| `src/utils/projectResource.ts` | 继续只做纯资源判定/比较，不成为状态仓库。 |
| `src/components/editor/EditorSessionStore.ts`（新增） | Tab 工作副本、保存串行、冲突/删除/另存为状态。 |
| `src/components/editor/EditorPanel.vue` | 只绑定 active session 与呈现用户选择，移除路径旁路。 |
| `src/types/canvas.ts`、`canvasDocument.ts` | V3 资产定义、迁移、校验。 |
| `src/components/creation/CreationPanel.vue` | 音频卡片、恢复、选择能力和 URL 生命周期接入。 |
| `src/components/canvas/canvasPersistence.ts` | V3 读写、当前画布资源变更调和；保留现有保存队列。 |
| `src/components/filetree/ProjectFileTree.vue` | 本 SDD 完成前不增加操作，只继续作为资源事件发起方/视图。 |

## 11. 相关

- [[开发/文件系统/文件树一期资源身份与文件安全SDD]]
- [[开发/文件系统/文件树五期]]
- [[开发/画布开发与排障]]
- [[开发/创作工作台架构SDD]]
- [[开发/存储设计]]

## 12. 实施记录（2026-07-18）

### 12.1 已完成

| 里程碑 | 已落地内容 |
|---|---|
| A：资源版本与编辑会话 | `ProjectFileService` 现在返回 revision 并提供条件 `writeText`；Web 在项目锁内比较后写入，Desktop 在 Rust 中比较 mtime/size 后以同目录临时文件原子替换。所有同 runtime/owner mutation（包括跨 service 实例）串行。新增 `EditorSessionStore`，项目 Tab 各自保存内容、基线、dirty、load token 和状态。 |
| A：编辑器闭环 | 项目文本 Tab 切换不再重新读盘；每个 Tab 保存串行且不会把自身写入误报冲突；改名同步所有匹配 session；删除脏文档和冲突文档均可“另存为 / 放弃或取消”；另存为只能新建路径，Web 和 Desktop 都拒绝覆盖已有项目文件。 |
| B：画布 V3 与音频 | `.jccanvas` 新写入 V3，V1/V2 图片和视频迁移保持可恢复；`CanvasAsset` 支持 `image / video / audio`、项目相对资源引用、可选 revision 与 missing 状态。音频以可持久化 Leafer 卡片显示，由单一 `HTMLAudioElement` 播放。 |
| B：媒体生命周期 | Web 运行时 URL 有 acquire/release；卡片删除、画布切换和卸载都会释放 URL；当前画布收到媒体改名会更新路径，删除则保留 missing 卡片并支持重新关联。既有 `owner:path` 保存队列与任务 lifecycle gate 保持不变。 |
| C：跨面板联动 | 资源事件统一含 `operationId` 和 `source`；编辑会话对操作 ID 去重。文件树以 Desktop mtime/Web `updatedAt` 快照发现外部创建、修改、删除，以及 Web 稳定 ID 的改名；本地事件在下一次快照中被确认，避免假冲突。 |
| 文件树入口 | 项目树现在把音频也作为可加入画布的媒体；缩略图策略仍只处理图片/视频，避免把音频送入图像解码路径。 |

### 12.2 自动验证

- `EditorSessionStore`：8 项通过，覆盖多 Tab 独立内容、无变更切换、保存竞争、改名、删除、冲突、重载、操作去重和 session 保存队列。
- `ProjectFileService`：9 项通过，覆盖资源事件、截断保护、条件写入、跨实例 owner 串行、成功后的 revision 事件，以及 Desktop `isDir` 目录字段兼容。
- 编辑器交互表面：3 项通过，锁定不再挂载重复的浮动格式菜单、拦截正文原生英文右键菜单，并确保删除干净项目文件后不保留幽灵 Tab。
- `ProjectResourceWatcher`：4 项通过，覆盖外部修改、删除、Web 改名和本地变更抑制。
- 画布文档：39 项通过；URL resolver：3 项通过；创作面板契约：32 项通过，覆盖 Desktop 音频用项目字节而非 `asset://` 播放。
- `pnpm run test:focused:build`、`pnpm run test:focused:run`、`cargo test --manifest-path src-tauri/Cargo.toml`（377 passed、1 ignored）和 `pnpm exec vite build` 均通过。
- `vue-tsc -b` 仍被本任务无关的既有错误阻断：`CreationPanel.vue:412/422/432` 与 creation upstream `zx` 映射缺失；本轮模块没有新增类型错误。

### 12.3 待人工验收

必须在 Desktop 和 Web 各执行第 9 节的手工场景，尤其是：改名后保存、删除脏文档另存为、外部修改冲突、音频画布重开、切项目时的媒体 URL 和生成任务隔离。通过后才可解除文件树二期的批量操作限制。

### 12.4 Desktop 验收补记（2026-07-18）

- 已通过：两个 Markdown Tab 交替编辑内容独立；已打开文件改名后保存只写新路径；外部修改打开文件出现重新加载/另存为选择。
- 音频卡片的保存、重开和播放已在原项目目录中人工通过。文件服务已兼容 Desktop `isDir` 字段；Desktop 播放使用项目文件字节的 `data:` URL，避免 WebView 的 `asset://` 播放失败。
- 同名“另存为”人工步骤已免除。Web `createText` 拒绝覆盖的回归（26 项 Web 项目文件测试）和 Desktop `create_new` 原子新建回归均已通过；已有目标文件不会被覆盖。
- 删除已自动保存项目文件会关闭对应 Tab；此前被错误保留下来的幽灵 Tab 已修复。未保存修改被删除时仍显示“另存为 / 放弃”。
- 编辑器已移除与固定顶部工具栏重复的 Tiptap 浮动格式菜单；正文禁用 macOS 原生英文右键菜单。文件树自身仍使用既有中文应用内右键菜单。

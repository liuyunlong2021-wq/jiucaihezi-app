# 项目文件树一期：资源身份与文件安全 SDD

> 日期：2026-07-18
> 状态：一期代码合同已完成；Desktop 已完成核心人工验收，完整双端人工矩阵未完成
> 分支：`0718-wenjianshu&bianjiqu`
> 参考：本机 VS Code `src/vs/workbench/contrib/files/{common/explorerModel,browser/explorerService,browser/fileActions,browser/views/explorerView}.ts`
> 前置：[[开发/创作工作台架构SDD]] 已定义“项目文件树是内容真源”；本文件只落实该真源在文件变更、编辑器和画布之间的身份合同。

## 1. 一句话目标

把当前“组件直接读写项目、再用零散事件补 UI”的项目树，翻译为 VS Code Explorer 的最小内核：**统一文件服务 + 资源变更事件 + 资源打开路由**。

韭菜盒子只偏离 VS Code 两点：文本/结构化文档在编辑区打开，图片/视频/音频在画布打开；其余文件树语义保持 VS Code 的文件资源语义。

```text
用户在项目树操作资源
  -> ProjectFileService 执行一次文件变更
  -> ProjectFileService 发布同一笔资源变更
  -> 项目树、编辑 Tab 与画布消费同一资源变更
  -> ProjectExplorerService 给出资源打开动作
  -> 项目树更新 / 编辑 Tab 跟随 / 画布引用校验
  -> 文本进编辑区，媒体进画布，画布文件进创作面板
```

## 2. 根因与现状

### 2.1 根因

`ProjectFileTree.vue` 同时承担树模型、Desktop Tauri 调用、Web IndexedDB/OPFS 调用、右键操作、媒体预览、上传导出、画布生命周期和编辑器事件。文件改名、删除、打开不是一个可观察的资源变更，而是组件内一段各自完成的异步代码。

结果是：

1. 文件重命名或删除后，没有统一事实通知编辑器；已打开 Desktop 文件可按旧路径再次保存，重新创建旧文件。
2. 编辑区按扩展名黑名单把未知文件当文本，二进制可能被字符串读取后写坏。
3. Desktop `dev_read_file` 会返回 `truncated`，编辑器当前只取 `content`；大于 500 KB 的文件被编辑后可能以截断内容覆盖原文件。
4. Web 有 `BroadcastChannel` 和局部事件，Desktop 依赖 5 秒全量轮询；两端没有共同的文件变更合同。

### 2.2 VS Code 对照

| VS Code 层 | 官方职责 | 一期翻译 |
|---|---|---|
| `ExplorerItem` / `ExplorerModel` | 以 URI 表示树中资源与父子关系 | `ProjectResource` / `ProjectExplorerModel` 表示项目相对路径资源 |
| `IFileService` | 读写、移动、删除和文件变更事件 | `ProjectFileService`，提供 Desktop/Web 同名操作和 `onDidChange` |
| `IExplorerService` | 将文件变更、选择、可编辑节点协调给 Explorer | 资源变更事件是共享协调边界；`ProjectExplorerService` 只负责唯一打开路由 |
| `fileActions` | 新建、改名、删除等动作通过同一资源编辑执行 | 文件树不直接 `invoke` / `webProjectFiles`；动作只调用 service |
| `ExplorerView` | 展示、选中、展开、刷新 | `ProjectFileTree.vue` 保留为渲染层 |

VS Code 对重命名采用资源 URI 的 `oldResource -> newResource` 变更，不依赖 inode、隐藏 sidecar 或永久文件 ID。Desktop 一期同样采用这条路线：资源路径会改变，但同一笔 `renamed` 事件必须让所有消费者同步更新。Web 可以继续复用 IndexedDB 的稳定文件 ID，但不可要求 Desktop 为此增加隐式元数据。

## 3. 范围

### 3.1 本期做

1. 定义跨 Desktop/Web 一致的 `ProjectResource`、资源类型和文件变更事件。
2. 抽出 `ProjectFileService`，收口列表、读文本、创建、重命名、删除及变更通知；现有上传、导出、媒体二进制写入可继续复用底层实现。
3. 建立唯一 `openProjectResource()` 路由：文档进编辑区，媒体进画布，`.jccanvas` 进创作面板，其他二进制只预览/另存为/系统打开。
4. 让重命名和删除同步已打开编辑 Tab；让画布任务继续走现有异步生命周期屏障，不绕开它。
5. 拒绝截断文本和不可编辑二进制进入可写编辑器。
6. 为上述合同补 Desktop/Web 自动测试和人工验收矩阵。

### 3.2 明确不做

- 多选、复制/剪切/粘贴、项目内拖放移动、批量操作。
- 多根工作区、紧凑目录、文件嵌套、Git/诊断装饰、回收站。
- 重写编辑器富文本、画布保存队列、OPFS 二进制存储或上传导出流程。
- 为 Desktop 增加 inode、隐藏 sidecar、扫描数据库或“永久文件 ID”。
- 把“文件超过大小阈值”伪装为可编辑的部分内容；大文件编辑器/分块编辑另立 SDD。

## 4. 资源合同

### 4.1 ProjectResource

```ts
type ProjectResourceKind = 'document' | 'media' | 'canvas' | 'binary'
type ProjectRuntime = 'desktop' | 'web'

interface ProjectResource {
  runtime: ProjectRuntime
  owner: string                 // Desktop: projectDir；Web: webProjectId
  path: string                  // 项目根目录下、正斜杠、非空的相对路径
  id?: string                   // Web 使用既有 documents id；Desktop 不伪造永久 id
  name: string
  isDirectory: boolean
  mimeType?: string
  size?: number
  kind: ProjectResourceKind
}
```

`owner + path` 是 Desktop 的当前资源 URI；Web 的 `id` 是其存储身份，但 UI、工具和画布仍只传项目相对路径。所有路径必须复用现有相对路径校验，拒绝绝对路径、`..` 与空字节。

### 4.2 类型判定

类型判定必须是一个共享纯函数，不能分别散落在项目树、编辑器和上传流程中。

| 分类 | 规则 | 打开动作 |
|---|---|---|
| `canvas` | `.jccanvas` | `canvas:open` + 创作面板 |
| `media` | 图片、视频、音频的 MIME 或已支持扩展名 | `canvas:add-media` + 创作面板；右键仍可站内预览/另存为 |
| `document` | 现有 `SUPPORTED_TEXT_EXT`、`text/*`、`application/json`，且内容完整 | 编辑区 |
| `binary` | 其余全部，包括未知或含 NUL 的内容 | 不进入编辑器；提供既有预览、另存为或 Desktop 系统打开 |

扩展名只作为 MIME 缺失时的后备。Desktop 列表需要带回 MIME 或在打开时按共享判定读取首段字节；不得保留“未知格式默认文本”的行为。

### 4.3 读取完整性

```ts
interface ProjectTextRead {
  resource: ProjectResource
  content: string
  size: number
  truncated: boolean
}
```

`truncated === true` 时：不创建可写编辑 Tab、不设置自动保存、不以返回内容覆盖磁盘。UI 显示“文件过大，不能在编辑区安全编辑”，Desktop 可系统打开，Web 可另存为。第一期不增加分块加载或提高阈值来掩盖问题。

## 5. 文件服务与变更事件

### 5.1 最小接口

```ts
interface ProjectFileService {
  list(owner: string): Promise<ProjectResource[]>
  readText(resource: ProjectResource): Promise<ProjectTextRead>
  createText(owner: string, path: string, content: string): Promise<ProjectResource>
  rename(resource: ProjectResource, newName: string): Promise<ProjectResource>
  remove(resource: ProjectResource): Promise<void>
  onDidChange(listener: (event: ProjectResourceChange) => void): () => void
}
```

底层适配：Desktop 复用 `dev_list_files`、`dev_read_file`、`dev_write_file`、`dev_rename_file`、`dev_delete_file`；Web 复用 `webProjectFiles`。服务层不得改变现有 Web Locks、OPFS 先写真实字节再写元数据、画布 `owner:path` 队列等存储合同。

### 5.2 事件合同

```ts
type ProjectResourceChange =
  | { type: 'created'; resource: ProjectResource; transactionId: string }
  | { type: 'changed'; resource: ProjectResource; transactionId: string }
  | { type: 'renamed'; oldResource: ProjectResource; resource: ProjectResource; transactionId: string }
  | { type: 'deleted'; resource: ProjectResource; transactionId: string }
```

规则：

1. 一个用户动作只发布一笔完成后的事实事件；失败不发布成功事件。
2. `renamed` 必须同时带旧、新资源，目录重命名还须带受影响后代的映射或以批次事件完整发布，不能只刷新树。
3. Web 的本标签、`BroadcastChannel` 以及 Desktop 的本地操作都归入这个事件入口。Desktop 首期仍允许可见时刷新作为漏事件兜底，但不再以轮询作为正确性来源。
4. 文件树、编辑器和画布只消费事件，不互相猜路径或轮询对方状态。

## 6. 打开与联动规则

### 6.1 唯一打开路由

```text
ProjectFileTree 点击/键盘 Enter/右键“打开”
  -> openProjectResource(resource)
  -> canvas      : 打开创作面板中的对应画布
  -> media       : 加入画布并切换创作面板
  -> document    : 确认完整读取后打开编辑区
  -> binary      : 不进入编辑区，执行预览/另存为/系统打开
```

右键菜单根据 `ProjectResource.kind` 生成，不再分别以多个扩展名集合判断“编辑区打开”“加入画布”“系统打开”。

### 6.2 编辑区

1. Tab 保存 `ProjectResource`，不是仅保存 `filePath` 或 `fileId`。
2. 收到 `renamed`：匹配旧资源的 Tab 原地替换为新资源，标题、路径、文件树选中同步更新；不得自动保存旧路径。
3. 收到 `deleted`：若 Tab 无脏修改，关闭；若有脏修改，显示明确选择“另存为新项目文件”或“放弃”，绝不写回已删除路径。
4. 收到外部 `changed`：无脏修改则重载；有脏修改时显示冲突入口。本期只定义合同和最小提示，不实现 VS Code 全量 diff/merge。
5. 空白/导入生成的新文档必须由当前项目 `ProjectFileService.createText()` 创建；只有明确“临时草稿”入口才允许不归属项目。

### 6.3 画布

1. `.jccanvas` 重命名、删除继续先走现有 `canvas:before-rename` / `canvas:before-delete` 生命周期屏障；服务成功后再发布通用资源事件。
2. 媒体重命名/删除不得猜测修改 `.jccanvas`。一期至少阻止正在被任务写入的目标被删除；媒体引用重写或孤儿素材管理另立任务。
3. 项目切换后到达的旧 `owner` 事件必须被忽略，沿用现有 owner 快照原则。

## 7. 实施顺序

### Task 0：先锁失败用例

先写失败测试，再改实现：

- 读取 `truncated: true` 的 Desktop 文本后，编辑器不得建立可保存 Tab，且不得调用写入。
- 未知二进制、NUL 内容不得路由至编辑器。
- 已打开文本改名后保存，只写新路径；删除后保存不重建旧路径。
- Web 与 Desktop 的同一重命名/删除事件使编辑器达到同一状态。
- `.jccanvas` 有 pending 写入时，重命名/删除仍被现有屏障拒绝。

### Task 1：纯资源模型与路由

- 新建 `projectResource.ts`：资源类型判定、路径规范化、等价比较和打开目标。
- 把 `ProjectFileTree.vue`、编辑器和上传流程中的扩展名判断收敛到共享函数。
- 先以纯单测覆盖分类与截断拒绝，无 UI 改动。

### Task 2：ProjectFileService

- Desktop/Web 各实现一个适配器，统一产出 `ProjectResource` 与 `ProjectTextRead`。
- 把项目树的 list、create、rename、remove 迁移到服务；保持现有底层命令和 Web 锁。
- 每个成功 mutation 由服务发布 `ProjectResourceChange`；项目树、编辑器和画布只订阅该合同，打开动作统一经 `ProjectExplorerService`。

### Task 3：编辑器与画布订阅

- Tab 改存 `ProjectResource`；补重命名、删除、外部修改处理。
- 项目树改为调用 `openProjectResource()`；按资源类型生成右键动作。
- `.jccanvas` 操作在既有 lifecycle 成功后接入通用事件，不能删除现有 gate。

### Task 4：去除旧旁路与回归

- 删除组件内直接调用的重复文件 mutation 入口和只为旧路径服务的事件。
- Desktop 轮询降为兜底刷新；Web 保持跨标签广播，但统一转化为服务事件。
- 更新 Wiki、热缓存和本 SDD 的实施记录。

## 8. 验收矩阵

| 场景 | Desktop | Web | 自动验证 |
|---|---|---|---|
| 新建 `.md` | 文件树出现并打开编辑区 | 同左 | 服务+路由测试 |
| 打开图片/视频/音频 | 加入画布，不创建编辑 Tab | 同左 | 路由测试 |
| 打开未知二进制 | 不进编辑区，不能写坏 | 同左 | 分类测试 |
| 打开超过读取上限文本 | 明确拒绝可写编辑 | Web 不应产生部分文本路径 | 截断回归测试 |
| 已打开文本重命名 | Tab 标题/路径更新，保存只写新路径 | 同左 | 编辑器事件测试 |
| 已打开文本删除 | 无脏 Tab 关闭；有脏内容不能复活旧路径 | 同左 | 编辑器事件测试 |
| 画布 pending 时改名/删除 | 操作被拒绝 | 同左 | 既有画布合同回归 |
| 切项目后旧事件到达 | 不改新项目树、编辑器或画布 | 同左 | owner 隔离测试 |

完成条件：以上矩阵 Desktop/Web 均通过，且 `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm run build`、`git diff --check` 通过。真实 Desktop 验收必须包含“打开大文本被拒绝”“改名后保存不复活旧文件”“删除脏文档不复活旧文件”。

## 9. 影响文件

| 文件/模块 | 一期职责 |
|---|---|
| `src/components/filetree/ProjectFileTree.vue` | 收敛为树视图和 service/action 调用方 |
| `src/components/editor/EditorPanel.vue`、`EditorTabs.vue` | 以 `ProjectResource` 管理 Tab，消费资源变更 |
| `src/components/editor/editorDiffBridge.ts` | 返回完整性信息，不丢弃 `truncated` |
| `src/utils/webProjectFiles.ts` | 继续作为 Web 适配器底层，不复制存储规则 |
| `src-tauri/src/commands/dev.rs` | 保持安全文件命令；必要时补充列表 MIME/读文件完整性传递 |
| `src/components/canvas/canvasPersistence.ts` | 保留既有 lifecycle queue，接入成功后的通用事件 |
| 新增 `src/services/projectFileService.ts`、`src/utils/projectResource.ts` | 文件服务、资源合同和路由的唯一入口 |

## 10. 后续依赖

本 SDD 完成后，第二期“多选、复制/剪切/粘贴、项目内拖放移动”只能通过 `ProjectFileService` 的批量资源变更实现。不得重新在 `ProjectFileTree.vue` 中增加直接文件系统调用。

## 11. 实施记录（2026-07-18）

文件树后续开发在本记录之后暂停。这里记录已合入工作区的事实，不把尚未完成的体验写成已交付。

### 11.1 已实施

| 项目 | 落点 | 结果 |
|---|---|---|
| 资源合同与分类 | `src/utils/projectResource.ts` | 已有 `document / media / canvas / binary` 分类、资源等价比较和改名辅助函数；音频作为媒体进入画布。 |
| 跨端文件服务 | `src/services/projectFileService.ts` | Desktop 与 Web 适配器统一了列表、文本读取、新建文本、新建目录、改名、删除和完成后的资源事件；Desktop Rust 的 `isDir` 已在服务层映射为统一的 `isDirectory`。 |
| 文本安全边界 | `ProjectFileTree.vue`、`projectResource.ts` | `truncated` 或含 NUL 的内容不会打开为可写文本，未知二进制不再默认当文本。 |
| 树的常用单文件操作 | `ProjectFileTree.vue` | 新建文件/目录、改名、删除、文本打开已改走文件服务；目录可在当前项目内展开，画布改名/删除仍先经过既有 lifecycle gate。 |
| 编辑器的最小资源联动 | `EditorPanel.vue`、`EditorTabs.vue` | 打开的项目文本 Tab 会保存 `ProjectResource`；改名更新当前路径，删除后阻止保存回旧路径。 |
| 回归测试 | `projectResource.test.ts`、`projectFileService.test.ts`、`projectFileTreeCanvas.test.ts` | 已执行并通过：3/3、4/4、11/11；`git diff --check` 通过。 |
| 编辑区与画布前置能力 | [[开发/文件系统/编辑区与创作面板基础能力升级SDD]] | 条件保存、删除脏文档另存为、外部变更冲突、画布音频和资源 lifecycle 已实现；文件树二期前仍需完成双端人工验收。 |
| 目录后代变更 | `projectFileService.ts`、`editorSessionStore.ts` | 目录重命名/删除在成功后发布一笔 `batch` 资源事件，包含目录和全部后代；编辑器逐条消费，打开的后代 Tab 会改到新路径，或沿用既有的干净关闭/脏文档另存为策略。 |
| 统一资源打开路由 | `projectExplorerService.ts` | 文件树不再自行判断文档、媒体和画布的打开分支。服务统一返回编辑区、画布、媒体、二进制或安全拒绝动作；`truncated`/NUL 文本不会产生编辑 Tab。 |

Desktop 仍以 `owner + path` 表示当前资源。没有添加 inode、sidecar 或扫描数据库来伪造永久文件 ID；改名由同一笔 `oldResource -> resource` 事件传播，这是刻意采用 VS Code 资源语义的结果。

### 11.2 尚未完成，不能宣称一期验收通过

1. Desktop 与 Web 的完整人工验收矩阵尚未执行；`vue-tsc -b` 仍被本任务无关的 `CreationPanel.vue` 与 creation model registry 的既有错误阻断。
2. 文件树二至五期的批量操作、增量树状态和 Explorer 增强尚未开始。

### 11.3 Desktop 验收补记（2026-07-18）

| 场景 | 用户实际结果 | 结论 |
|---|---|---|
| 两个 `.md` 分别编辑并切换 Tab | 通过，内容不串。 | 通过。 |
| 编辑中的文件改名后保存 | 通过，只保存到新路径。 | 通过。 |
| 删除后另存为同名路径 | 人工步骤免除。Desktop `dev_create_file_if_missing` 使用原子 `create_new`，Web `createText` 也会拒绝已有路径；本轮自动测试均通过。 | 通过。 |
| 从项目子目录选取 `.mp3` 加入画布 | 在原项目展开目录后，左键和右键“加入画布”均可进入画布；保存、重开和播放通过。 | 通过。 |
| 外部编辑已打开文件 | 出现重新加载/另存为选择。 | 通过。 |

补充交互修正：文件树右键菜单本来就是应用内中文菜单。截图中的英文菜单是 Tiptap `contenteditable` 触发的 macOS 原生菜单，不是文件树功能；编辑器已移除与顶部工具栏重复的 `FloatingMenu`，并禁止正文原生右键菜单，保留顶部格式工具栏和系统剪贴板快捷键。Desktop 音频播放改为项目文件字节的 `data:` URL，避免 `asset://` 播放失败；删除已自动保存项目文件时，编辑器会关闭对应 Tab，不能保留幽灵内容。

### 11.4 暂停边界

下一步不是继续在 `ProjectFileTree.vue` 堆菜单。文件树二至五期的批量操作、复制/剪切/粘贴和拖放移动，必须复用本期 `ProjectFileService` 的批次事件，不得重新加入组件内直接文件系统调用。

### 11.5 一期代码闭环补记（2026-07-18）

本补记只陈述由自动化证明的代码事实；不把尚未进行的人工操作写成已验收。

1. `ProjectFileService.rename/remove` 会在 mutation queue 内先取得目录快照。Desktop 目录变更专用 `dev_list_file_descendants` 不受文件树 1000 项展示上限影响；Web 使用完整项目列表。目录操作成功后发布一笔 `batch`，其中每个后代各有一条 `renamed` 或 `deleted` 资源变更；普通文件仍保持单条事件。目录根未出现在异常快照时，服务仍保底发布根资源事件。
2. `EditorSessionStore` 展开 batch 后沿用已有的单资源规则：改名原地更新 Tab；删除干净 Tab 关闭；删除脏 Tab 进入只能另存为的 `deleted` 状态。文件树展开 batch 后只刷新一次；创作面板先应用同批全部媒体变更，再以新的 load token 恢复一次画布，避免异步旧快照覆盖新状态。
3. 新增纯 `openProjectResource()` 路由。文档只在读取完整且无 NUL 后进入编辑区；媒体返回画布媒体动作（包含 image/video/audio）；`.jccanvas` 打开创作面板；二进制不会进入编辑区。文件树保留界面事件派发和系统打开，但不再保留第二份资源类型判断。
4. Desktop 对外部文件修改仍以可见时的列表观察为兜底。由于一期明确不引入 inode、sidecar 或扫描数据库，外部改名没有可证明的同一资源身份，必须按“旧路径删除 + 新路径创建”处理，不能猜测为 Tab 改名。

自动验证：`pnpm run test:focused` 通过（含新增 `projectExplorerService`、目录批次和编辑会话回归）；`cargo test --manifest-path src-tauri/Cargo.toml` 通过（380 tests）；`pnpm exec vite build` 与 `git diff --check` 通过。`vue-tsc -b` 仍被本任务无关的 `CreationPanel.vue`、`creationMediaPlan.ts`、`creationModelRegistry.ts` 既有 6 项错误阻断，未新增本期错误。

### 11.6 Desktop 文件操作与当前目录新建补记（2026-07-18）

1. 顶部“新建文件/新建文件夹”现在读取当前选中的目录；只在没有选中目录时落到项目根。左键打开目录同时更新该选择状态。
2. Desktop 不再隐藏 Web 已有的“上传文件、上传文件夹、导入项目、导出项目”。“导入项目”在 Desktop 选择并切换本地项目文件夹；上传会复制选中的文件或文件夹到当前目录，导出会将整个项目复制到用户选定目录下的同名项目文件夹。
3. Rust 在复制前检查目标冲突；文件、文件夹或导出项目同名均直接拒绝，不覆盖原内容。复制不跟随符号链接，导出到项目自身或其子目录同样拒绝。自动测试覆盖文件字节保真、目录层级保留、同名拒绝和嵌套导出拒绝；真实 Desktop 点击验收仍待执行。

### 11.7 删除语义与重复删除修正（2026-07-18）

1. Desktop 项目文件和目录不再直接 `remove_file/remove_dir_all`，统一移入操作系统废纸篓；项目根目录不可被移入废纸篓。Web 项目存储没有系统废纸篓，因此仍明确提示永久删除。
2. 文件树删除改为本应用主题内的确认框。Desktop 的确认文案与主按钮均为“移入废纸篓”，不再使用 macOS 原生白色提示框。
3. 同一资源在删除等待和执行期间有单次锁；后续点击不会再次向 Rust 发送旧路径。此前上传目录首次删除已实际成功、第二次删除旧路径报不存在并阻止刷新，是该锁要消除的根因。
4. 若文件树节点已被旧版本或外部操作删除，Desktop 命令返回 `missing` 而非错误；服务仍发布删除事实并刷新树，避免过期节点持续显示红字。

### 11.8 路径空格根因修正（2026-07-18）

`clean_relative_path()` 曾对所有项目相对路径调用 `trim()`。这会把文件系统中合法的首尾空格文件名改成另一条路径，例如真实目录 ` 东周` 被删除命令错误地请求为 `东周`，从而报“项目内路径不可访问”。现已移除路径裁剪，仍保留绝对路径、`..` 和空字节拒绝；新增回归测试覆盖首尾空格目录名的废纸篓路径解析。

## 12. 相关

- [[开发/创作工作台架构SDD]]
- [[开发/文件系统/Web云端项目Wiki媒体同步与APP升级SDD]]
- [[开发/画布开发与排障]]
- [[开发/存储设计]]

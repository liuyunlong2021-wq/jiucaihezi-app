# 项目文件树四点五期：项目资源服务唯一文件总管 SDD

> 日期：2026-07-19
> 状态：已完成（2026-07-19）
> 分支：`0718-wenjianshu&bianjiqu`
> 前置：[[开发/文件树一期资源身份与文件安全SDD]]、[[开发/文件树二期批量文件操作SDD]]、[[开发/文件树三期Explorer状态与性能SDD]]、[[开发/文件树四期编辑区收尾SDD]]
> 后置：[[开发/文件树五期编辑区与项目文档统一SDD]]
> 路线：[[开发/文件树五期]]

## 1. 一句话目标

项目资源服务是项目中唯一的**文件总管**：任何项目文件或项目素材的打开、新建、读取、保存、导出、复制、移动、改名、删除、定位和 Desktop/Web 差异，都经过同一套共享文件动作。文件树是这套服务的可视化入口。

```text
任何界面的文件意图
  -> 文件总管动作
  -> ProjectFileService / ProjectResource / 平台适配器
  -> 一笔资源事件
  -> 文件树、编辑区、创作面板、画布消费同一结果
```

`ProjectFileTree.vue` 是这套动作的一个调用方和可视化界面，不是把所有业务塞进去。真正的总管是 `ProjectResource`、`ProjectFileService`、共享文件动作和资源事件；这与 VS Code 的 `IFileService` 是文件总管、Explorer 是调用方的分层一致。

## 2. 为什么单列四点五期

一期和二期已经建立了 `ProjectResource`、`ProjectFileService`、资源事件和批量动作；三期负责 Explorer 状态；四期负责编辑器生命周期。但当前项目仍有三处绕开文件总管的旁路：

| 位置 | 当前旁路 | 风险 |
|---|---|---|
| 编辑区 | 直接按 `filePath` 读写磁盘、按 `fileId` 读写 SQLite、自己创建文档、自己格式转换导出 | 同一个项目文件出现多套保存、导出、路径和身份规则 |
| 创作面板/画布 | 直接创建、列举、读取、写入、改名、删除 `.jccanvas`；拖入媒体后直接写 `jc-media` | 画布文件和素材不一定产生与文件树一致的资源事件、刷新和跨端行为 |
| 文件树组件 | 部分导出、画布动作仍留在 `ProjectFileTree.vue` 内 | 其他面板若要复用只能复制 Tauri、Web、重名和冲突逻辑 |

根因不是“缺少几个事件”，而是**文件规则有多位主人**。四点五期只解决这个根因：建立唯一文件总管动作层。第五期再用它完成编辑区和画布界面收口。

## 3. 铁律与边界

### 3.1 铁律

1. 项目文件和项目素材是项目内容的唯一事实源；项目资源服务是访问和变更它们的唯一文件总管。
2. 任何项目文件动作必须带 `ProjectResource` 或经文件总管解析成 `ProjectResource`；不得只传绝对路径、裸 `fileId` 或组件私有路径字符串。
3. 任一成功文件动作只发布一笔完成后的资源事件；所有界面据此同步，不互相猜路径或重扫整个项目。
4. Desktop/Web 差异只能在文件总管适配器内处理；编辑区、创作面板、画布不得自行分支 Tauri、OPFS、IndexedDB、浏览器目录选择器或系统路径。
5. 画布仍负责画布 JSON 的序列化、恢复、保存队列和生命周期 gate；但“向项目写一个画布文件/素材文件”必须交给文件总管提交。保留画布业务，不保留第二套文件管理。

### 3.2 本期做

1. 抽出可被所有面板调用的文件总管动作层。
2. 统一文本、二进制、画布、媒体的读取、写入、创建、导出和定位入口。
3. 将当前散落在文件树的导出、名称校验、重名处理、目标目录解析和 Desktop/Web 差异下沉到共享动作。
4. 为画布定义“画布内容编解码器 + 文件总管提交”的边界，不再让画布直接管理文件系统。
5. 建立可审计的旁路清单和禁止规则；迁移一个动作后删除旧入口，不留双写或静默降级。
6. 为共享动作补 Desktop/Web 自动测试和人工验收矩阵。

### 3.3 交给第五期

四点五期不改变编辑区工具栏、三点菜单、右键菜单、富文本样式或画布交互布局。第五期只做：

1. 编辑区改为保存当前资源、导出当前资源、中文右键和统一新建。
2. 项目文本按文件总管路由显示为富文本或原样文本。
3. 创作面板和画布接入统一新建、打开、导出、定位和资源同步。
4. 删除编辑区/画布的旧 UI 入口和临时文件旁路。

## 4. 共享文件总管合同

### 4.1 动作入口

新增一个面向界面的共享动作层，例如 `projectFileActions.ts`。它只编排已有的资源规则和服务，不保存 Vue 状态、不渲染菜单、不直接维护画布场景。

```ts
interface ProjectFileActions {
  open(resource: ProjectResource): Promise<ProjectResourceOpenResult>
  createText(input: CreateProjectTextInput): Promise<ProjectTextOpenResult>
  createCanvas(input: CreateProjectCanvasInput): Promise<ProjectCanvasOpenResult>
  saveText(input: SaveProjectTextInput): Promise<ProjectFileWriteResult>
  saveCanvas(input: SaveProjectCanvasInput): Promise<ProjectCanvasWriteResult>
  exportResources(input: ExportProjectResourcesInput): Promise<ProjectExportResult>
  rename(resource: ProjectResource, newName: string): Promise<ProjectResource>
  remove(resources: ProjectResource[]): Promise<ProjectBatchResult>
  executeBatch(plan: ProjectBatchPlan): Promise<ProjectBatchResult>
  locate(resource: ProjectResource): Promise<void>
}
```

接口名字可随现有代码调整，但以下事实不能改变：

1. 创建、保存、导出、重命名、删除、批量动作都从此层进入。
2. 每个动作在进入平台适配器前完成路径安全、目标目录、文件名、资源类型和冲突规则判断。
3. 每个动作返回明确结果，而不是依靠组件自行判断 Tauri 异常字符串。
4. 文件树、编辑区、创作面板使用同一个动作对象；不允许各自再包装一套语义相同的方法。

### 4.2 资源与内容合同

`ProjectResource` 继续表示项目内资源身份：`runtime + owner + path` 是 Desktop 当前资源身份，Web 可额外带已有 `id`。资源类型继续由共享纯函数决定：

| 资源 | 文件总管负责 | 面板负责 |
|---|---|---|
| 安全文本 | 完整读取、revision、条件写入、创建、导出原文件 | 编辑区决定富文本或原样文本显示 |
| `.jccanvas` | 创建资源、读取/写入提交、导出、改名、删除、资源事件 | 画布编码/解码 JSON、维护场景与生命周期 gate |
| 图片/音频/视频 | 导入/创建资源、二进制读取、预览 URL、导出、改名、删除 | 创作面板将资源引用加入/移出画布 |
| 二进制或不安全文本 | 拒绝文本编辑、提供文件树已有的预览/导出/站内打开选择 | 不创建空白文本 Tab 或伪造内容 |

文本内容必须携带 revision；画布内容必须通过 `CanvasDocumentV3` 编解码后提交；二进制不得经文本 API 转码。文件总管不把画布当 Markdown，也不让编辑区把二进制当文本。

### 4.2.1 补齐底层文件能力

当前 `ProjectFileService` 已有文本读取、条件文本写入、创建、改名、删除和批量动作，但还没有统一的二进制读取/导入能力；`canvasPersistence` 仍直接持有 Tauri/Web 写入实现。四点五期必须补齐这两个缺口，不能让动作层通过 `any` 或回调偷渡平台 API。

```ts
interface ProjectFileService {
  // 既有：readText / writeText / createText / rename / remove / executeBatch
  readBinary(resource: ProjectResource): Promise<ProjectBinaryRead>
  importBinary(input: ImportProjectBinaryInput): Promise<ProjectResource>
  writeProjectData(input: WriteProjectDataInput): Promise<ProjectFileWriteResult>
}
```

含义如下：

1. `readBinary()` 只返回原始字节/Blob，供文件树预览、导出和媒体 URL 解析使用；不允许经文本读取转码。
2. `importBinary()` 接收已选择、拖入、粘贴或生成完成的媒体字节、目标目录、文件名/MIME 和重名规则，成功后创建 `ProjectResource` 并发布 `created`。
3. `writeProjectData()` 是项目文件的统一写入通道：文本保存仍走现有 revision 条件写入；画布以 `CanvasDocumentV3` 编码的 JSON 通过这个通道原子提交；二进制不允许由编辑器调用此接口覆盖。
4. 名称可随现有代码风格调整，但不能继续存在 `projectMediaWriter`、`canvasPersistence`、编辑区各自直接调用 Tauri/Web 文件 API 的可达项目文件写入路径。

`projectFileService.ts` 当前反向导入 `canvasPersistence` 的画布解析/复制函数。四点五期应把 `CanvasDocumentV3` 的纯编解码与复制迁到无 UI 依赖的画布文档模块；服务层不得依赖 Vue 组件或持久化 UI 模块。

### 4.3 创建与目标目录

所有创建动作接收统一目标上下文：

```ts
interface ProjectCreationTarget {
  owner: string
  directoryPath: string // '' 表示项目根目录
}
```

目标目录由项目资源上下文统一解析：存在 Explorer 选中目录时使用该目录；选中的是文件时使用其父目录；没有可用选中资源时使用项目根目录。文件树提供选中状态，但规则不存放在 `ProjectFileTree.vue`；编辑区、画布也不各自解释或复制这一规则。

创建文本、画布、文件夹和媒体都使用同一套名称校验与重名处理。失败、取消、重名拒绝时不创建私有草稿、不切换到空白资源，也不发布成功事件。

### 4.4 保存

1. `saveText()` 复用 `ProjectFileService.writeText(resource, content, revision)` 的条件写入和返回 revision。
2. `saveCanvas()` 接受已编码的 `CanvasDocumentV3`；画布保存队列和 `canvas:before-*` gate 在画布侧继续保证场景一致，最终原子写入由文件总管执行并发布 `changed`。
3. 保存失败、资源缺失、revision 冲突、owner 切换都返回明确状态；动作层绝不重建旧路径或静默覆盖外部修改。
4. 保存不会在编辑区/画布自行直调 `writeRealFileContent`、`webProjectFiles.write`、Tauri `dev_write_*` 或 `fileStore.updateFile` 来代表项目文件保存。

### 4.5 导出

文件总管提供 `exportResources()`，复用文件树当前“导出项目/导出所选资源”的规则：

1. 导出的是选中资源的原始文件和目录结构，不是编辑器转换出的 Word、PDF、HTML、Markdown 或模板。
2. Desktop 复用目录选择、目标冲突提示和系统写入；Web 复用浏览器目录权限、冲突和写入。
3. 编辑区和画布只传当前资源或资源集合；不直接调用下载、保存对话框、Blob 或外部路径 API。
4. 当前资源有未保存修改时，调用方先走同一保存动作；保存失败或取消时不导出旧版本。

### 4.6 改名、删除、批量与同步

1. 统一复用 `ProjectFileService.rename/remove/executeBatch`，目录后代继续发布完整 batch 映射。
2. `.jccanvas` 的改名、删除、任务写入仍先经过画布 lifecycle gate；gate 只负责“是否允许提交”，不再自己完成文件系统 mutation。
3. 成功后只发布一笔 `ProjectResourceChange` 或 batch；文件树刷新受影响目录，编辑区更新 Tab，画布更新资源引用或标记缺失。
4. 外部文件提示、Web 跨标签广播和本地动作都被规范化为同一资源事件；消费者按 `owner` 过滤旧项目结果。

### 4.7 定位与打开

`open()` 继续使用唯一 `openProjectResource()` 路由；`locate()` 向 Explorer 请求定位同一 `ProjectResource`。编辑区和画布不得通过绝对路径、文件名或自建事件猜测文件树节点。

## 5. 旁路迁移清单

| 旧入口 | 迁移到文件总管 | 迁移后处理 |
|---|---|---|
| `EditorPanel` 的 `readRealFileContent` / `writeRealFileContent` 项目文件分支 | `open()` / `saveText()` | 删除项目文件直接磁盘读写；非项目 diff 临时预览另行标为只读，不伪装项目 Tab |
| `EditorPanel` 的 SQLite `fileStore` 自动建文档、自动保存 | 仅保留明确的非项目草稿能力；项目文档改 `createText()` | 草稿必须有明确视觉标记，不能进入项目文件流程 |
| `EditorPanel` 的 Word/PDF/HTML/Markdown/模板/预览/分片导出 | `exportResources()` | 删除格式转换导出器及其事件、状态、菜单入口 |
| `EditorPanel` 里的项目另存为路径输入 | 文件总管创建目标选择动作 | 复用文件树名称和冲突规则 |
| `canvasPersistence` 的创建、列举、写入、改名、删除 Tauri/Web 分支 | `createCanvas()` / `saveCanvas()` / `rename()` / `remove()` | 保留 Canvas JSON 编解码、队列和 gate；删除文件系统适配器重复实现 |
| `CreationPanel` 的新建画布、首次自动建画布 | `createCanvas()` | 资源创建事件刷新文件树并打开同一资源 |
| `CreationPanel` 的拖入/粘贴媒体直接 `projectMediaWriter` | 文件总管媒体导入动作 | 媒体进入项目后发布 created，再加入画布引用 |
| `ProjectFileTree` 内的导出、画布专用动作 | `exportResources()` / canvas 动作 | 文件树改为调用共享动作，供其他面板复用 |

迁移原则：每完成一个动作，先让文件树也改用共享动作，再迁移编辑区/画布，最后删除旧实现。禁止“共享动作和旧旁路同时长期保留”。

## 6. 实施顺序

### Task 0：动作审计与失败测试

1. 为当前文件树的创建、保存、导出、改名、删除、批量、画布和媒体路径画出调用图。
2. 把所有绕过 `ProjectFileService` 或文件树现有导出规则的项目文件读写列成可删除清单。
3. 先写跨端失败测试：相同资源动作从不同界面进入，必须得到相同文件、资源事件、冲突和取消结果。

### Task 1：共享动作层

1. 在服务层建立可注入、可测试的文件总管动作。
2. 将 `ProjectFileTree.vue` 的导出、目标目录解析、名称/冲突处理迁入该层，文件树改为调用方。
3. 保持 `ProjectFileService` 是唯一存储边界；动作层只负责界面级编排。

### Task 2：画布文件与素材迁移

1. 分离 Canvas JSON 编解码和文件提交；画布的 queue/gate 不删除。
2. 新建、列表、保存、改名、删除画布都经共享动作，并发布资源事件。
3. 拖入、粘贴、生成完成的媒体统一经媒体导入动作落入项目，再引用到画布。

### Task 3：删掉旧旁路并验证总管

1. 删除已迁移的 Tauri、Web、OPFS、SQLite、导出和路径拼接旁路。
2. 验证文件树、创作面板从同一动作进入时 Desktop/Web 行为一致。
3. 四点五期通过后，才开始第五期的编辑区保存、导出、右键和文本模式 UI 对齐。

## 7. 自动测试

| 测试 | 必须证明 |
|---|---|
| 创建目标 | 文件树、编辑区、画布请求同一目录时得到同一路径、同一重名结果、同一 created 事件。 |
| 文本保存 | 共享动作使用 revision 条件写入；冲突、缺失、切项目都不覆盖或复活旧文件。 |
| 画布保存 | 画布 queue/gate 保留，最终写入只经文件总管，且一次成功保存只发一次 changed 事件。 |
| 媒体导入 | 拖入、粘贴、生成媒体都先成为项目资源，再被画布引用；Desktop/Web 事件一致。 |
| 导出 | 文件树、编辑区、画布导出同一资源时，文件名、内容、目录结构、取消和冲突处理一致。 |
| 改名/删除/批量 | 目录后代映射完整；编辑 Tab、画布引用与文件树收到同一结果。 |
| 旁路清除 | 不再存在项目文件直接读写、独立格式导出或画布独立平台适配器的可达调用路径。 |

## 8. 人工验收

Desktop 与 Web 各执行一次：

1. 在文件树、编辑区、创作面板分别新建项目文件/画布，确认都进入相同项目、文件树立即出现、自动打开正确面板。
2. 修改文本和画布后保存，确认文件树刷新、切换项目再回来内容仍在；外部修改或删除不会复活旧路径。
3. 从文件树、编辑区、画布导出同一资源，确认得到同一原文件、同一重名提示和相同取消行为。
4. 拖入/粘贴/生成一个媒体，确认它先出现在项目素材目录，再加入画布；在文件树改名、删除、移动后画布正确更新。
5. 对包含已打开文本、画布和媒体的目录执行复制、移动、覆盖、删除；确认三个界面没有旧路径、孤立副本或不同步。
6. 切换项目期间发起保存、导入或导出，确认旧项目异步结果不污染新项目。

完成条件：上述矩阵 Desktop/Web 均通过，且 `pnpm run test:focused`、`pnpm exec vite build`、`git diff --check` 通过。若 `vue-tsc` 有历史无关错误，必须记录具体文件和错误，不得将其误报为四点五期通过。

## 10. 实施结果（2026-07-19）

1. `ProjectFileService` 已补齐二进制读取/导入；Desktop/Web 适配器在服务层处理字节、OPFS 和 Tauri 命令，成功写入统一发布资源事件。
2. 新增 `projectFileActions.ts`，承接跨面板复用的画布、媒体和导出编排；文件树内常规新建、改名、删除继续直接调用同一 `ProjectFileService`，没有第二套存储实现。
3. `canvasPersistence` 保留 Canvas JSON、队列和 lifecycle gate，已移除项目文件的 Tauri/OPFS 读写、列举、改名和删除旁路；文件树直接调用共享画布动作，不再手工补发画布资源事件。
4. 创作面板的 Web 媒体预览、运行时 URL 和提交 Data URL，以及创作任务的 Web 媒体落盘，均通过共享动作；`projectMediaWriter` 保留兼容返回值，但不再直接写 Tauri 文件。
5. 编辑区项目资源已经使用 `ProjectResource + revision + ProjectFileService` 保存。`editorDiffBridge` 仅保留非项目 diff/磁盘预览，不作为项目资源路径。
6. 验证：`pnpm run test:focused:run` 退出码 0；画布/文件树/资源服务/共享动作核心集合 85/85；`pnpm exec vite build`、`git diff --check` 均通过。生产构建仅有既有动态导入与大 chunk 告警。

第五期继续负责编辑区工具栏、格式导出 UI、右键菜单和富文本显示收口；不得重新引入项目文件存储旁路。

## 10.1 Desktop 原生拖放补充（2026-07-19，已完成）

人工验收发现两个根因：

1. 点击另一个画布时，创作面板会先保存当前画布；保存的 `changed` 资源事件被文件树错误当成结构变更，触发根目录重建，导致按需加载的 `jc-canvas` 展开状态丢失。
2. Finder 拖放在 Tauri 中是窗口级原生事件，不保证携带浏览器 `DataTransfer.files`。项目树在 Desktop 还显式忽略了拖放；对话区虽然监听原生事件，却用受 scope 限制的前端 `plugin-fs` 读取任意外部路径，并静默吞掉失败。

补充规则：

| 落点 | 落盘目录 | 导入后行为 |
|---|---|---|
| 画布 | `jc-media/` | 只接受图片、音频、视频；成功后加入当前画布 |
| 对话区 | `jc-imports/` | 先读项目资源字节，再形成当前消息附件 |
| 编辑区 | `jc-imports/` | 文本资源直接打开；非文本资源创建并打开引用它的 Markdown 文档 |
| 项目树 | 目录落点或项目根目录 | 展示同一项目资源 |

实现约束：

1. `WorkspaceLayout` 是唯一 `onDragDropEvent` 订阅者，按 `data-project-drop-target` 将原生路径路由给面板。
2. Rust `dev_import_project_drop` 校验项目根目录、项目内目标目录和外部普通文件，再复制；前端不扩大 `$HOME/Documents` 文件系统权限。
3. `ProjectFileService.importExternalFiles()` 负责把成功导入规范化为同一笔 `created` 资源事件；面板不得保留 Finder 绝对路径或把拖入图片直接写成 Data URL。
4. `changed` 只表示内容保存，文件树不得重建；`created`、`deleted`、`renamed` 只刷新受影响的已加载父目录，父目录未加载时刷新根目录但保留其他已加载子树。

新增自动验证：共享动作外部路径导入、Rust 外部路径复制、唯一原生分发器、四个落点标记、对话附件从项目资源读取、画布保存不整树刷新。

本次自动验证：

1. `pnpm run test:focused:run` 通过。
2. `cargo test --manifest-path src-tauri/Cargo.toml` 通过：393 passed、0 failed、1 ignored；其中包含 `desktop_drop_imports_external_paths_as_project_entries`。
3. `pnpm exec vite build` 通过；仅保留既有动态导入告警。
4. `git diff --check` 通过。
5. `pnpm exec vue-tsc -b` 仍有本分支既有 14 个错误，位于 `CreationPanel.vue`、`ProjectFileTree.vue`、`creationMediaPlan.ts`、`creationModelRegistry.ts`、`projectFileService.ts`；本次新增的拖放文件不在错误列表。`cargo fmt --check` 未执行，因为本机 stable 工具链未安装 `rustfmt`。
6. 收尾安全审计新增符号链接回归测试：外部来源符号链接、项目内符号链接目标目录均会被拒绝，拖放不能写出项目根目录。

用户已完成 Desktop 主路径验收：导入均先进入项目资源服务，文件树仍是唯一事实源，切换画布不再自动折叠目录。

### 已知后续项

1. 原生窗口拖入图片到画布时，个别界面布局下落点会命中对话区；文件仍会先安全导入项目，但应在后续按准确画布落点处理。用户确认本期先不扩大修复。
2. 同一项目连续发生结构事件时，文件树的定向异步刷新目前只按项目校验；极端并发下较旧请求可能短暂覆盖较新目录列表。现有轮询已移除，风险低，后续若出现实测问题再增加请求序号保护。
3. 普通文件树操作仍可直接使用 `ProjectFileService`；第五期若需要跨面板复用这些交互，再扩展动作层，而不是新增存储旁路。

## 9. 影响文件

| 文件/模块 | 四点五期职责 |
|---|---|
| 新增共享文件总管动作层 | 统一面板级文件动作，复用现有服务与文件树规则。 |
| `src/services/projectFileService.ts` | 继续唯一存储边界、revision 和资源事件。 |
| `src/services/projectExplorerService.ts`、`src/utils/projectResource.ts` | 继续唯一资源分类、打开路由和身份规则。 |
| `src/components/filetree/ProjectFileTree.vue` | 从动作实现者收敛为共享动作调用方和资源视图。 |
| `src/components/canvas/canvasPersistence.ts` | 保留 Canvas 编解码/队列/gate，迁出平台文件读写、列举、改名、删除。 |
| `src/components/creation/CreationPanel.vue` | 使用画布/媒体共享动作，不直接创建项目文件。 |
| 第五期编辑区文件 | 四点五期只预留动作入口；具体 UI 和旧路径删除放到第五期。 |

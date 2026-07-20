# 项目文件树三期：Explorer 状态与性能 SDD

> 日期：2026-07-18
> 状态：已完成
> 分支：`0718-wenjianshu&bianjiqu`
> 前置：[[开发/文件系统/文件树一期资源身份与文件安全SDD]]、[[开发/文件系统/文件树二期批量文件操作SDD]]
> 路线：[[开发/文件系统/文件树五期]]

## 1. 一句话目标

让项目树从“每 5 秒全量扫描并一次渲染所有节点”变成真正的 Explorer：任何用户选中的正常目录都能作为项目根目录完整打开，Desktop 外部变化由系统文件监听驱动，目录按需读取，树状态独立保存；大项目不静默丢节点，层级一眼可辨，编辑区和画布能可靠反向定位当前资源。

```text
Desktop 系统文件事件 / Web 项目存储事件 / 本地批量资源事件
  -> ProjectFileService 标准化资源变化
  -> ExplorerStateStore 按受影响父目录更新缓存
  -> ProjectFileTree 仅渲染已展开目录和可见行
  -> 编辑区 / 画布请求 locate(resource)
  -> 必要祖先逐层加载、展开并选中资源
```

## 2. 根因与现状

当前 `ProjectFileTree.vue` 在 `loadFileTree()` 中调用 `ProjectFileService.list()`，Desktop 最多读取 1000 项，随后构建完整嵌套树；Desktop 再以 5 秒定时器重复执行。结果：

1. 大于 1000 项时，后续节点被静默截断，不是“尚未加载”。
2. 任意外部文件变化都会等待下一个全量轮询，且每次都重建整棵树。
3. 展开、选择、焦点、筛选和加载状态散落在组件内，无法区分“目录为空”“尚未加载”“读取失败”。
4. 画布/编辑区的 `project-filetree:locate` 只能在目标祖先已经加载时工作；大项目或折叠深层目录定位失败。
5. 现有 `projectResourceWatcher` 通过两次全量快照猜外部变化，Desktop 无稳定 id 时无法可靠区分外部改名与删除加创建。

这不是“只能打开特定项目类型”的产品限制，而是旧的递归扫描模型不适合真实代码仓库。用户通过目录选择器选中的任何可读取目录都必须能作为根目录打开；目录里是否有 `package.json`、`.git` 或特定韭菜盒子文件都不能影响这一点。二期的 `ProjectFileService` 和完整 batch 资源事件是本期底座。三期不重做文件读写、批量操作、画布 lifecycle 或编辑器文件生命周期。

## 3. 范围

### 3.1 本期做

1. 任意可读取项目目录打开后立即完整显示其直接子级；展开任意子目录后完整显示其直接子级，不因项目类型、递归上限或历史跳过目录规则而变空或漏项。
2. Desktop 系统文件监听，替换 5 秒递归全量轮询。
3. 目录按需加载，删除 `dev_list_files(maxEntries: 1000)` 作为 Explorer 树来源的语义。
4. 独立 Explorer 状态：展开、选择、焦点、目录加载、排序、筛选和定位。
5. 多种来源的资源变化按受影响目录增量刷新，不因单个事件重建整树。
6. 编辑区、画布反向定位资源；必要时自动加载祖先目录。
7. Desktop/Web 一致的排序、展开恢复和筛选语义。
8. 增加 VS Code 式层级引导竖线，清楚表现每一行所属的目录层级。

### 3.2 明确不做

1. 二期以外的文件 mutation、撤销/重做、Git 状态或回收站浏览。
2. 多根工作区、文件嵌套、紧凑目录、固定/收藏、标签或诊断装饰。
3. 为 Desktop 制造 inode、sidecar 或数据库身份；外部改名无法由系统事件可靠配对时继续按删除加创建处理。
4. 全文内容搜索、模糊替换和跨项目搜索；本期筛选只匹配文件名和相对路径。
5. 无限量一次性搜索结果或无限递归渲染。
6. Git 的 `M`、`U`、目录聚合数量等版本控制状态装饰；它们属于第五期，不能与本期的目录层级引导线混为一谈。

## 4. 设计原则

1. **目录状态不是数组。** 每个目录必须明确是 `unloaded | loading | loaded | error`，空目录只在 `loaded` 后才可确认为空。
2. **事件是提示，查询是事实。** 系统监听事件不直接拼接树节点；它只标记受影响目录，由服务重新读取该目录得到最终状态。
3. **监听优先，低频校验兜底。** Desktop 不再 5 秒递归扫描；监听异常、溢出或恢复时进行节流校验，并提示用户可手动刷新。
4. **无可靠旧/新对时不猜改名。** Desktop watcher 只有在系统明确给出同一 rename 的旧、新路径时才发布 `renamed`；否则发 `deleted + created`。
5. **状态归 Explorer，不归视图。** `ProjectFileTree.vue` 只渲染状态模型和派发用户意图，不能再保存第二份树/展开/加载真相。
6. **保留一期、二期合同。** 所有本地 mutation 仍只走 `ProjectFileService`；三期仅增加树查询和外部事件适配。
7. **层级由路径决定，竖线不是数据。** 引导线只根据可见行的祖先深度绘制，不能改变节点结构、点击范围、虚拟列表行高或选择语义。

## 5. 树查询合同

### 5.1 新增接口

```ts
interface ProjectDirectoryQuery {
  owner: string
  path: string                 // '' 表示项目根目录
  sort: ExplorerSort
}

interface ProjectDirectoryResult {
  path: string
  entries: ProjectResource[]   // 仅直接子级，已经排序
  complete: true               // 本期不允许静默分页或截断
}

type ExplorerSortKey = 'name' | 'type' | 'modified' | 'size'
interface ExplorerSort {
  key: ExplorerSortKey
  direction: 'asc' | 'desc'
  directoriesFirst: boolean
}

interface ProjectFileService {
  listDirectory(query: ProjectDirectoryQuery): Promise<ProjectDirectoryResult>
  searchPaths(owner: string, query: string, limit: number): Promise<ProjectResource[]>
}
```

`list()` 保留给需要完整项目快照的既有业务，不再作为 Explorer 的正常加载路径。`listDirectory()` 不接受 `maxEntries`；资源过多时必须有真实分页协议，本期先保证完整返回并记录性能测试边界，绝不截断。目录查询不以项目标记筛选，也不沿用递归扫描的 `should_skip_dir()` 隐藏规则：`.git`、`node_modules`、`dist` 等必须作为可展开的直接子级返回；是否读取其内容由用户是否展开决定。

### 5.2 Desktop/Web 落点

| 运行时 | 目录查询 | 筛选搜索 |
|---|---|---|
| Desktop | Rust 新命令仅列举 `relativePath` 的直接孩子，安全复用 `clean_relative_path` 和根目录限制。 | Rust 递归按名称/相对路径匹配，返回最多 2000 条及 `truncated` 标记。 |
| Web | IndexedDB 项目记录按 `folderId` 或 `metadata.relativePath` 的直接父级筛选。 | IndexedDB 项目记录按名称/相对路径匹配；不读 OPFS 字节。 |

搜索结果超过 2000 条时，树显示“结果过多，请继续缩小筛选条件”，不伪装为全部结果。

## 6. Explorer 状态模型

新增 `ExplorerStateStore`，按 `runtime + owner` 隔离：

```ts
type DirectoryLoadState = 'unloaded' | 'loading' | 'loaded' | 'error'

interface ExplorerDirectoryState {
  path: string
  state: DirectoryLoadState
  children: string[]
  error?: string
  requestId: number
}

interface ExplorerState {
  owner: string
  runtime: ProjectRuntime
  directories: Map<string, ExplorerDirectoryState>
  resources: Map<string, ProjectResource>
  expandedPaths: Set<string>
  selectedPaths: Set<string>
  focusedPath: string | null
  selectionAnchorPath: string | null
  sort: ExplorerSort
  filter: string
}
```

规则：

1. 打开项目只加载根目录；展开目录才加载该目录。已 `loaded` 的目录再次展开不重复请求。
2. 用户手动刷新当前目录时，清空该目录后代缓存并重新加载；顶栏刷新只刷新已加载目录，不递归扫描未展开目录。
3. 项目切换清空旧 owner 状态。Web 复用项目 id，Desktop 复用规范化项目根路径。
4. 展开、排序和筛选在当前运行时会话内保持；展开状态按 owner 持久化到现有本地 UI 状态存储。失效路径在下次加载时删除。
5. 排序规则默认“目录在前、名称升序”，支持名称、类型、修改时间、大小及升降序；同值以名称稳定排序。
6. 多选、剪贴板的二期规则保持不变，但选择根的资源必须从 Explorer 状态取得，不能只从当前虚拟可见行取得。

### 6.1 层级引导线

1. 每个可见行根据其祖先目录深度绘制细竖线；根目录直接子级不额外画一层，嵌套项在每个祖先缩进槽位各有一条线。
2. 竖线与行的展开状态同步：折叠目录后，其后代行和对应引导线一起消失；筛选临时视图只画实际显示祖先的层级。
3. 当前焦点或鼠标所在分支的引导线可以使用主题强调色，其余使用低对比主题边框色；暗色和浅色主题都必须可见但不能压过文件名。
4. 实现只允许使用节点 `depth`、祖先关系和 CSS 变量/伪元素等视图信息；不得为装饰引入新的资源状态、逐行监听器或固定像素定位，虚拟滚动时不得错位。

## 7. 外部文件事件

### 7.1 Desktop 监听器

Rust 新增项目 watcher manager：每个打开的 Desktop `owner` 最多一个递归监听器。监听器使用跨平台 `notify` 后端，接收 macOS FSEvents、Windows ReadDirectoryChangesW 与 Linux inotify 的统一事件。

```ts
type DesktopProjectFsHint =
  | { kind: 'path'; owner: string; path: string; action: 'create' | 'modify' | 'remove' }
  | { kind: 'rename'; owner: string; oldPath: string; path: string }
  | { kind: 'rescan'; owner: string; reason: 'overflow' | 'watch-error' | 'manual' }
```

1. Rust 对事件按 100ms 去抖、按父目录合并，再通过 Tauri event 发给前端。
2. `rename` 仅在 watcher 事件提供配对路径且两端都在项目根内时发出；其他 rename-like 事件降级为两个 path hint。
3. 前端收到 path hint 后只失效并重新查询其父目录；rename 同时失效旧、新父目录，并经 `ProjectFileService` 形成共享资源事件。
4. watcher 溢出、根目录不可访问或连续错误时发 `rescan`。前端显示可恢复提示，节流执行“已加载目录”校验；不能悄悄恢复 5 秒全项目轮询。
5. 项目切换、窗口卸载或所有订阅取消时停止 watcher，防止监听旧项目。

### 7.2 Web 与本地事件

Web 继续使用 `web-project-files-changed` 与 `BroadcastChannel`，但收到通知后只失效当前已加载目录；本地批量操作的 `ProjectResourceChange` 直接增量应用资源映射，避免再请求整树。

所有来源最终使用一期的 `ProjectResourceChange`。外部 create/delete/changed 可以是单条或 batch；禁止引入第二套给编辑器/画布消费的事件总线。

## 8. 增量更新规则

| 事件 | Explorer 行为 | 消费者行为 |
|---|---|---|
| local `created` | 插入已加载父目录；未加载父目录只标记失效 | 不自动打开 Tab/画布 |
| local/external `changed` | 更新已缓存资源元数据 | 编辑器沿用一期 reload/conflict |
| `renamed` | 更新资源和所有已缓存后代路径；失效旧、新父目录 | 编辑器、画布沿用二期映射 |
| `deleted` | 移除资源和已缓存后代；清理展开/选择/剪贴板失效路径 | 编辑器、画布沿用一期、二期删除语义 |
| watcher `rescan` | 仅刷新已加载目录；刷新失败显示状态 | 不发布虚假的资源变更 |

单个批量动作只触发一次视图提交。多个 watcher hint 在去抖窗口内合并，不按每个文件做独立全树刷新。

## 9. 定位、筛选与恢复

### 9.1 反向定位

`project-filetree:locate` 改为调用 `ExplorerStateStore.locate(path)`：

1. 拆分路径祖先，从根逐层 `ensureDirectoryLoaded()`。
2. 每层加载完成后展开祖先；资源不存在时停止并给调用方 `missing`，不选择错误节点。
3. 找到后设置唯一焦点和选中项，并调用虚拟列表 `scrollToIndex()`；筛选存在时临时清空筛选并提示用户，确保目标可见。
4. 定位不打开文件、不修改剪贴板、不触发文件 mutation。

### 9.2 筛选

1. 空筛选时只显示已加载、已展开目录的虚拟树。
2. 非空筛选调用 `searchPaths()`，构建“匹配项及祖先”的临时视图；不改变常规展开状态。
3. 清空筛选后恢复原展开、选择和滚动位置。
4. 筛选不会把未加载的目录永久标记为已加载。

## 10. 失败与恢复

1. 目录读取失败显示该目录的可重试状态，不清空已经成功加载的兄弟目录。
2. 异步目录响应通过 `owner + requestId` 校验；项目切换、折叠后旧响应不能写入新状态。
3. watcher 只当作失效提示。事件丢失时，用户手动刷新或异常兜底校验能够恢复树；不对编辑器或画布伪造不确定的 rename。
4. 监听器启动失败不阻止文件树使用，UI 明示“实时刷新不可用”，并启用低频已加载目录校验。
5. 任何路径继续拒绝绝对路径、`..`、空字节；路径不是展示文本，禁止 `trim()`。

## 11. 实施顺序

### Task 0：失败测试

1. 根目录只加载直接孩子，不受 1000 项递归列表截断影响。
2. 选择不含任何项目标记的普通目录、含 `.git`/`node_modules`/`dist` 的代码仓库根目录，均显示全部直接子级；展开这些目录后同样不受历史跳过规则影响。
3. 展开目录只请求一次；失败可重试；项目切换后旧异步响应被丢弃。
4. Desktop watcher 的 create/modify/remove/rename hint 只失效受影响父目录；无配对 rename 不猜旧新资源。
5. 批量 rename/delete 更新已加载后代、选择、剪贴板和定位状态一次。
6. locate 深层未加载资源时按祖先顺序加载、展开并滚动；不存在时不误选。
7. 筛选结果只来自文件名/相对路径；超过上限明确标记为截断。
8. 多层可见目录的引导线随展开、折叠、筛选和虚拟滚动保持在正确缩进槽位；根级、浅色和深色主题的显示正确。

### Task 1：目录查询与 ExplorerStateStore

- 为 `ProjectFileService` 增加目录查询和搜索合同；Desktop/Web 适配器实现直接孩子查询。
- 新建纯状态 Store 与测试，先迁移展开、选择、排序、加载状态，不接 watcher。

### Task 2：按需树视图与定位

- `ProjectFileTree.vue` 改为只渲染 ExplorerStateStore；目录展开触发查询，顶栏刷新只刷新已加载目录。
- 接入 locate、筛选临时视图、虚拟列表滚动和层级引导线；引导线必须只从可见节点深度派生。

### Task 3：Desktop watcher 与 Web 失效适配

- Rust 添加 watcher lifecycle、事件去抖和 Tauri event；注册命令与清理逻辑。
- 前端将 watcher/Web storage hint 转为目录失效和既有资源事件；移除 5 秒递归轮询。

### Task 4：回归与收尾

- 补编辑器/画布外部事件边界测试、大项目目录加载测试和 Windows/Intel Mac 编译验证。
- 更新 [[开发/文件系统/文件树五期]]、`hot.md`、`log.md` 与本 SDD 实施记录。

## 12. 自动测试

| 测试文件 | 覆盖内容 |
|---|---|
| `src/services/__tests__/projectExplorerStateStore.test.ts` | 懒加载、状态隔离、排序、选择、定位、过期响应。 |
| `src/services/__tests__/projectFileService.test.ts` | 直接目录查询、搜索上限、资源事件映射。 |
| `src/services/__tests__/projectResourceWatcher.test.ts` | Desktop watcher hint 去抖、rename 降级、目录失效。 |
| `src-tauri/src/commands/dev.rs` 内嵌测试 | 直接孩子列举、根目录安全、watcher 事件转换、Windows 条件编译。 |
| `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts` | 普通目录/代码仓库根目录打开、展开按需加载、空/错误/重试状态、层级引导线、筛选、locate 和无 5 秒轮询。 |
| `src/components/editor/__tests__/editorSessionStore.test.ts` | 外部 rename/create/delete batch 消费不回归。 |

## 13. 人工验收

Desktop 与 Web 各执行一次：

1. Desktop 分别选择一个空白普通目录和当前韭菜盒子项目根目录；两者都立即显示全部直接子级。当前项目根的 `.git`、`node_modules`、`dist` 等目录可见且可展开，不能出现“选中后空白”。
2. 创建至少 1500 个文件，确认根目录和深层目录均可完整看到，未展开目录不会提前加载。
3. 展开、折叠一个含大量文件的目录，确认再次展开不重新读取；顶栏刷新只刷新已展开目录。
4. 展开至少三层目录，检查每一级缩进都有连续、清晰的引导竖线；折叠、筛选、滚动和切换浅/深主题后，竖线不漂移、不遮住文件名。
5. Desktop 用 Finder/资源管理器新建、修改、删除和改名已展开目录文件，确认树在短暂去抖后更新；已打开文本仍遵循一期冲突/删除规则。
6. 在编辑区打开深层文件、切到创作面板画布后执行定位，确认文件树逐层展开、滚动并选中该文件。
7. 使用名称片段筛选深层未展开文件，确认出现匹配和祖先；清空筛选后原展开状态恢复。
8. 运行大目录场景下的复制、移动、删除，确认二期选择、剪贴板、Tab 和画布映射不回归。
9. Desktop 在 Apple Silicon、Intel Mac、Windows 各至少编译一次；Windows 实机确认 watcher、系统回收站和目录选择器。

完成条件：上述矩阵通过；`pnpm run test:focused`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm exec vite build`、`git diff --check` 通过。`vue-tsc -b` 若仍有既有错误，必须单列且不能新增本期错误。

## 14. 影响文件

| 文件 | 三期职责 |
|---|---|
| `src/services/projectFileService.ts` | 目录查询、搜索、资源事件统一入口。 |
| `src/services/projectExplorerStateStore.ts`（新增） | Explorer 的加载、展开、选择、排序、筛选和定位状态。 |
| `src/services/projectResourceWatcher.ts` | 从快照比较收敛为外部事件 hint 的失效协调；保留 Web 所需适配。 |
| `src-tauri/src/commands/dev.rs`、`src-tauri/src/lib.rs` | 直接孩子目录查询、Desktop watcher 与 Tauri 事件。 |
| `src/components/filetree/ProjectFileTree.vue` | 纯树视图、用户意图、虚拟列表定位。 |
| `src/components/editor/*`、`src/components/creation/CreationPanel.vue` | 只验证并继续消费一期、二期资源事件，不重写文件生命周期。 |

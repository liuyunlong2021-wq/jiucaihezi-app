# SDD：编辑区与 Explorer 稳定性修复

> 日期：2026-07-22
> 状态：实现与 Web 真实验收完成，待 Desktop 人工验收
> 前置：[[开发/文件系统/文件树三期Explorer状态与性能SDD]]、[[开发/文件系统/文件树四期编辑区收尾SDD]]、[[开发/文件系统/文件树五期编辑区与项目文档统一SDD]]
> 路线：[[开发/文件系统/文件树五期]]

## 1. 目标

修复项目文件在编辑区打开后偶发空白或被覆盖、文件树目录在刷新后视觉折叠、底部右键菜单不可见三项问题。修复后的最小用户合同：

1. 从项目树打开安全文本，编辑区只显示该资源读取出的内容；打开或仅输入时，项目文件不会被其他内存内容或延迟定时器自动写入覆盖。
2. 已按需加载且展开的目录，在同项目的创建、导入、改名、删除、外部变更或 Web 存储通知后保持展开状态；有变更路径时只刷新受影响父目录，只有项目级通知时才原地刷新全部已加载目录。
3. 在任意视口边缘右键文件树，完整菜单均在可视区域内；空间不足时优先向上展开，仍不足时菜单本身滚动。

本期不增加多编辑组、草稿恢复、后台自动保存、文件历史、全量目录扫描或新的资源事件总线。

## 2. 根因

### 2.1 项目文档被旧草稿生命周期覆盖

项目文件已在四、五期接入 `EditorSessionStore + ProjectFileService`，但 `EditorPanel.vue` 仍保留五月的 `jc_tiptap_doc` 恢复路径：编辑器就绪后无条件从 `localStorage` 调用 `setContent()`，不检查当前是否已绑定项目资源。该旧内容会覆盖文件树刚打开的内容。

同一编辑器 `onUpdate` 又会：

```text
旧 localStorage 内容 setContent()
  -> captureActiveProjectSession()
  -> 1.5 秒自动 saveToFile()
  -> ProjectFileService.writeText(当前项目资源)
```

结果不是单纯“显示空白”：旧草稿若为空或过期，可能被捕获为当前项目会话内容并写回磁盘。这违反 [[开发/文件系统/文件树四期编辑区收尾SDD]] 的“项目文件不后台静默保存”规则，也重新引入了第五期应删除的编辑器私有内容路径。

挂载前的 `open-in-editor` 事件缓存曾是独立问题，现有 `consumeLastEvent()` 已覆盖该场景；它不是本次内容覆盖的根因。

### 2.2 Explorer 刷新只恢复路径标记，没有恢复已加载子树

`ProjectFileTree.vue` 的全量 `loadFileTree()` 只查询项目根目录直接子项。刷新前它以路径集合保存 `expanded`；刷新后重建根节点，再把匹配路径标为展开。但下层目录的 `children` 没有重新查询或复用，故目录虽可能保有 `expanded: true`，视觉上仍没有子项，表现为自动折叠。

该全量刷新可由 Web `BroadcastChannel`、上传导入、文件操作后的显式刷新和项目切换触发。复制路径动作本身只写剪贴板和关闭菜单，不调用刷新；若用户在复制路径后观察到折叠，是同期异步刷新暴露了此缺陷，不应把剪贴板当成根因。Web 的现有通知只有项目 ID，没有变更路径，因此不能假装做精确失效，也不应为本次修复扩展通知协议。

这也背离 [[开发/文件系统/文件树三期Explorer状态与性能SDD]] 的原则：Explorer 的目录加载状态必须独立，资源变化只能刷新受影响目录，不能把按需树重建为根目录快照。

### 2.3 右键菜单使用错误的固定高度猜测

文件树菜单以 `Teleport` 和 `position: fixed` 渲染，父容器裁切与层叠顺序均不是根因。定位函数把菜单高度固定估为 `320px`，而文件右键菜单在 Desktop 上可含十余个操作，实际高度可超过该值。因此底部菜单仍越过视口。

## 3. 修复设计

### 3.1 项目编辑会话是唯一可写内容来源

1. 删除项目编辑路径使用的 `jc_tiptap_doc` 恢复、持久化和旧 blocks 迁移；不再在 `EditorPanel` 初始化时无条件 `setContent()`。
2. 删除 `onUpdate` 为项目 Tab 安排的延迟 `saveToFile()`。保存按钮、`Cmd/Ctrl+S`、关闭确认和“导出前先保存”继续调用现有保存队列；插图、AI 编辑等既有命令式保存语义不在本次重定义。
3. 非项目临时内容如仍有明确产品入口，必须是独立、不绑定 `ProjectResource` 的草稿状态；它不得在项目资源打开后覆盖编辑器，也不得触发项目资源写入。本期不新增或恢复草稿功能。
4. `renderProjectSession()` 是活动项目 Tab 写入编辑器视图的唯一入口；切换、重载和资源事件仍使用会话的 revision、dirty、conflict 和 deleted 状态机。
5. 项目会话渲染继续使用现有的 `emitUpdate: false`；本期不扩展 `EditorSessionStore`，也不为其他非项目编辑入口重新设计内容捕获规则。

### 3.2 按需树不再因刷新丢失内容

1. 复用现有 `TreeNode` 的 `children`、`loaded` 和 `expanded` 状态；不新增目录缓存或第二套 Explorer 状态模型。
2. 根目录初始化和项目切换继续使用 `loadFileTree()`。同一项目且带路径的资源事件和导入结果使用已有的 `refreshAffectedDirectory()`，由它更新受影响父目录并复用旧节点的已加载子树；用户操作不再额外调用一次 `loadFileTree()`。
3. Web `BroadcastChannel`、现有 Web 项目级通知和用户明确刷新只有项目范围、没有变更路径，因此顺序刷新当前已加载目录并复用旧节点。不能只把路径重新标为 `expanded`，也不能用根目录快照覆盖所有已加载后代。
4. `changed` 继续只表示内容变化，不触发结构刷新；`created`、`deleted` 刷新资源父目录，`renamed` 刷新新旧父目录。复用现有资源事件，不新增 transaction、事件合并器或失效缓存。

### 3.3 菜单按真实尺寸定位

菜单打开后使用现有 `ctxMenu.x/y` 作为锚点；下一帧读取真实 `getBoundingClientRect()`，按可用视口重新计算坐标：

```text
right space insufficient  -> x 向左翻转
bottom space insufficient -> y 向上翻转
still insufficient        -> max-height = 可用高度，菜单内部 overflow-y: auto
```

安全边距固定为 8px。菜单仍使用 body Teleport 与 fixed 定位；空间不足时只通过现有菜单元素的 `max-height` 和 `overflow-y: auto` 滚动，不引入第三方浮层库。

## 4. 范围与禁区

| 做 | 不做 |
| --- | --- |
| 清理项目文档的旧草稿恢复和自动保存旁路 | 恢复或设计新的跨会话草稿恢复功能 |
| 保留已加载目录和定向刷新 | 递归全量扫描、分页、紧凑目录、多根工作区 |
| 真实测量文件树右键菜单并翻转/滚动 | 修改菜单项目、文件操作语义或编辑器右键 |
| 为上述链路增加回归测试 | 重写 `ProjectFileService`、资源身份或画布生命周期 |

## 5. 实施顺序

1. **先复现并固化编辑器覆盖链路。** 预置 `jc_tiptap_doc`，从未挂载编辑区的文件树打开有内容的 `.md`；断言显示项目内容且在等待自动保存窗口后 `writeText()` 未被调用。
2. **删除遗留编辑器旁路。** 移除旧恢复、持久化和 `onUpdate` 延迟保存，仅保留现有用户命令触发的保存路径；重跑步骤 1，并覆盖保存按钮、关闭确认和导出前保存。
3. **固化 Explorer 刷新回归。** 展开至少两层目录，分别触发带路径的创建/重命名事件和只有项目 ID 的 Web 通知；断言两类刷新都保留已加载后代与展开状态。
4. **收敛目录刷新。** 按 3.2 删除用户操作后的重复全量重建；带路径事件断言不读取未受影响目录，项目级通知断言只读取当前已加载目录且不递归加载折叠目录。
5. **固化右键视口回归。** 在低高度、右下角和移动窄视口打开文件及目录菜单；断言菜单边界位于视口内，超过空间时内部可滚动。
6. **执行双端人工矩阵。** Desktop 和 Web 分别执行第 7 节；没有完成的环境必须保留为未验证，不得标记完成。

## 6. 风险与防护

| 风险 | 级别 | 防护与验收 |
| --- | --- | --- |
| 旧草稿覆盖后自动写回，造成项目文档数据丢失 | 阻断 | 先删除自动保存旁路，再验证“旧 localStorage + 打开项目文件”不会调用写入；发布前用副本项目人工复测。 |
| 删除旧恢复影响非项目临时内容 | 高 | 本期只保证项目资源；若仍存在明确草稿入口，另立 SDD 定义其存储与恢复，不隐式复用项目编辑器。 |
| 定向刷新范围错误导致树显示陈旧项 | 中 | 事件只作失效提示，刷新目录结果为事实；created/deleted/renamed 覆盖父目录选择，项目级通知覆盖全部已加载目录。 |
| 菜单重新定位导致焦点或外部关闭语义回归 | 低 | 只更新坐标和最大高度；Esc、外部点击和右键目标选择语义不变。 |
| Desktop 与 Web 通知来源不同导致只修一端 | 高 | 同一 Explorer 刷新接口由两端通知调用；验收矩阵分别执行，不以单端通过代替双端。 |

## 7. 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 预置旧 `jc_tiptap_doc` 后首次从树打开非空 MD | 编辑区显示项目文件内容；等待 3 秒后磁盘内容不变，除非用户明确保存。 |
| 修改项目 MD 后等待、切换 Tab、关闭 Tab、导出 | 等待和切换不因 `onUpdate` 定时器写入；保存、关闭确认、导出前保存及既有命令式保存保持原语义；revision 冲突与删除不复活旧路径。 |
| 展开 `a/b/` 后创建、导入、改名或删除同项目资源 | `a/b/` 仍显示，未受影响分支不折叠；有精确路径时不读取无关目录。 |
| Web 另一标签页写入同项目 | 现有通知不含路径，因此原地刷新全部已加载目录；折叠且未加载的目录不被递归读取，展开状态不丢失。 |
| 桌面系统外部修改已加载目录 | watcher 定向刷新；打开的干净项目 Tab 按既有规则重载，脏 Tab 进入冲突。 |
| 在屏幕底部右键长菜单 | 菜单向上展开，所有操作可见；极矮视口中菜单内部可滚动。 |
| 在屏幕右侧右键 | 菜单向左展开，不超出右边界。 |

自动验证覆盖编辑器交互、文件树 Explorer 刷新与菜单定位的专属测试；隔离分支 `fix/editor-explorer-stability` 已完成：

- `pnpm run test:focused:build && pnpm run test:focused:run`：1170 tests，1169 passed，0 failed，1 skipped。
- `pnpm run test:tauri`：394 passed，0 failed，1 ignored。首次运行因隔离 worktree 缺少被 Git 忽略的 sidecar 失败，补充只读软链接后通过；该环境文件未纳入改动。
- `pnpm exec vue-tsc -b`：通过。
- `pnpm exec vite build`：通过；仅有仓库既有 dynamic-import/chunk-size 警告。
- `git diff --check`：通过。

2026-07-22 使用隔离 Chrome 配置对本地 Web 构建完成真实 DOM/IndexedDB 验收：

- 在 Web 项目创建 `a/b/doc.md` 并保存 `PROJECT_CONTENT_20260722`，切回对话后预置内容为 `LEGACY_OVERWRITE` 的 `jc_tiptap_doc`，再从文件树打开文档并等待 3.6 秒；编辑器与 IndexedDB 均仍为 `PROJECT_CONTENT_20260722`。
- 展开 `a/b` 后创建文件并把 `b` 重命名为 `c`，`doc.md` 与 `new.md` 仍直接可见且路径变为 `a/c`；第二标签在 `a/c` 创建 `external.md` 后，第一标签经 BroadcastChannel 立即显示新文件，原展开子树未折叠。
- 在 `500 x 220` 视口的右下角打开文件长菜单，实测菜单矩形为 `x=312, y=8, width=180, height=204`，右侧和底部安全边距均为 8px；`scrollHeight=305 > clientHeight=202`，`overflow-y=auto`。

Desktop 已完成隔离启动冒烟：用临时配置覆盖为 `com.jiucaihezi.desktop.stabilitytest` 和“韭菜盒子稳定性验收”，实际启动 Tauri WebView；CoreGraphics 确认独立进程窗口为 `1100 x 700`，正式应用和正式应用数据目录未被使用。当前 macOS 自动化环境无法取得该 dev WebView 的可操作内容：Computer Use 返回 `cgWindowNotFound`，System Events 坐标操作返回 `-25200`，Screen Capture 无窗口图像，底层 AX 只暴露应用壳与菜单栏。为避免把本任务扩展成测试基础设施开发，已停止临时实例。

因此尚未完成 Desktop 原生交互矩阵：系统 watcher 外部修改、Tauri 窗口底部菜单和项目副本数据安全仍需人工验收；在验收前不把本修复标记为发布完成。

## 8. 影响入口

| 模块 | 责任 |
| --- | --- |
| `src/components/editor/EditorPanel.vue` | 删除项目编辑遗留草稿与自动保存旁路；保持项目会话唯一渲染和显式保存。 |
| `src/components/filetree/ProjectFileTree.vue` | 保留已加载目录树，合并定向刷新，按真实尺寸定位右键菜单。 |
| `src/components/editor/__tests__/` | 覆盖旧草稿不可覆盖项目资源、显式保存语义。 |
| `src/components/filetree/__tests__/` | 覆盖展开子树刷新保持和视口边缘菜单。 |

## 9. 证据与后续

本设计来自 2026-07-22 对现行 Wiki、`EditorPanel.vue`、`ProjectFileTree.vue`、`editorSessionStore.ts`、`eventBus.ts` 和 Git 历史的只读审查。详细来源见 [[来源索引]]。2026-07-22 隔离分支已完成代码实现、自动门禁和 Web 真实矩阵；Desktop 人工矩阵仍是开放风险，不得以 Web 与自动测试替代。

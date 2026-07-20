# 项目文件树四期：编辑区收尾 SDD

> 日期：2026-07-18
> 状态：已完成
> 分支：`0718-wenjianshu&bianjiqu`
> 前置：[[开发/文件系统/文件树一期资源身份与文件安全SDD]]、[[开发/文件系统/文件树二期批量文件操作SDD]]、[[开发/文件系统/文件树三期Explorer状态与性能SDD]]
> 路线：[[开发/文件系统/文件树五期]]

## 1. 一句话目标

让编辑区的项目文件生命周期接近 VS Code 的基本体验：用户能清楚地看到哪些已打开文件尚未保存、保存全部内容、关闭前处理未保存修改、在外部变化或冲突时明确选择下一步，并能区分“临时草稿”和“项目文件”，而不会静默覆盖、丢失或复活旧文件。

```text
编辑内容变化
  -> EditorSessionStore 记录每个 Tab 的 resource / revision / dirty / state
  -> 用户保存、全部保存、关闭或收到资源事件
  -> ProjectFileService 条件写入或读取最新内容
  -> 成功后更新 revision；冲突/删除时进入明确决策状态
```

## 2. 根因与现状

一期、二期已完成以下基础：

| 已有能力 | 当前落点 |
|---|---|
| 每个 Tab 独立工作副本、脏状态和保存队列 | `editorSessionStore.ts` |
| 条件保存与 revision 冲突结果 | `ProjectFileService.writeText()` |
| 改名、删除、批量覆盖的资源事件消费 | `EditorSessionStore.applyResourceChange()` |
| 删除脏文件后禁止写回旧路径，允许另存为 | `deleted` session state + `rebindToCreatedResource()` |
| 外部修改：干净 Tab reload、脏 Tab conflict | `applyResourceChange()` |

剩余问题不是存储协议，而是用户操作没有完整收口：

1. “保存全部”的范围、顺序、跳过规则和结果没有清楚的统一行为。
2. 关闭 Tab、切项目、关闭窗口时，脏项目文件和临时草稿缺少一致确认流程。
3. `conflict`、`deleted`、`error` 状态虽存在，但用户可见的动作和结果提示不足。
4. 临时草稿与项目文件在视觉和入口上不够明确，用户可能误以为草稿已经保存进项目；已打开且未保存的项目文件在 Tab 和文件树中也没有统一标记。
5. Desktop/Web 的人工矩阵没有覆盖外部修改、冲突、删除、另存为、切项目和应用关闭的组合。

三期完成后，Explorer 可以可靠定位资源；四期只调用其 locate，不重做文件树加载或系统监听。

## 3. 范围

### 3.1 本期做

1. 明确“保存”“保存全部”“另存为项目文件”的状态机和可见结果。
2. 对关闭 Tab、切项目、关闭窗口补脏状态确认流程。
3. 对外部修改、保存冲突、删除后保留修改、读取/保存错误补明确操作面板。
4. 明确临时草稿与项目文件的视觉区分、创建入口和关闭规则。
5. 为已打开且未保存的项目文件提供一致的小点标记：Tab 与文件树同源显示，保存、放弃或重新加载后立即消失。
6. 完成 Desktop/Web 编辑区人工验收矩阵与自动回归。

### 3.2 明确不做

1. 多编辑组、分屏、文件历史、撤销跨 Tab、版本控制或三方合并编辑器。
2. 自动保存、后台静默保存、离线同步或跨设备草稿同步。
3. 将项目文件转成数据库文档，或为 Desktop 增加永久文件 id。
4. 修改一期、二期的 `ProjectFileService` mutation/资源事件协议；本期只消费它。
5. 重做富文本编辑器、Markdown 解析、画布或创作面板。
6. Git 的 `M`、`U`、目录聚合数量或未跟踪文件状态。四期的小点只表示当前已打开 Tab 的本地未保存编辑，不表示磁盘改动或版本控制状态。

## 4. 编辑会话状态机

现有状态保留，不新增“半保存”或模糊状态：

```text
loading -> ready -> saving -> ready
                  \-> conflict
ready + external changed + dirty -> conflict
ready + deleted -> closed
dirty + deleted -> deleted
任何可读写状态 + write failure -> error
临时草稿 resource:null -> ready
```

| 状态 | 可编辑 | 可保存原路径 | 用户可见动作 |
|---|---:|---:|---|
| `ready` | 是 | 是 | 保存、保存全部、关闭 |
| `saving` | 是 | 当前保存快照正在写入 | 显示保存中；新编辑继续保持脏 |
| `conflict` | 是 | 否 | 重新加载并放弃、另存为新项目文件、取消 |
| `deleted` | 是 | 否 | 另存为新项目文件、放弃修改、关闭 |
| `error` | 保留内容 | 否，直到明确重试 | 重试保存、另存为、关闭 |
| `readonly` | 否 | 否 | 另存为/系统打开/关闭 |

`dirty` 仍只由 `documentVersion !== savedDocumentVersion` 决定。任何对话框都不得清除内容或把 dirty 设为 false，除非用户明确选择放弃或最新内容成功替换 session。

## 5. 保存行为

### 5.1 单 Tab 保存

1. 只对 `ready` 且 dirty、并且有 `resource` 的项目文件调用 `ProjectFileService.writeText()`。
2. 保存取当前 session 的 `documentVersion`、markdown、revision 快照；写入通过既有 session save queue 串行。
3. 保存成功只在当前版本仍等于保存快照时推进 `savedDocumentVersion`；否则更新 `baseRevision` 后保持 dirty。
4. `conflict`、`deleted`、`readonly` 绝不调用原路径保存。
5. 临时草稿点保存时打开“保存到项目”流程，不能静默创建 `untitled` 文件。

### 5.2 保存全部

工具栏和 `Cmd/Ctrl+Alt+S` 提供“全部保存”。它遍历当前项目的 session，固定按 Tab 打开顺序处理：

| session | 保存全部行为 |
|---|---|
| 干净项目文件 | 跳过 |
| 脏且 `ready` 的项目文件 | 保存 |
| `saving` | 等待现有队列完成后重新判断一次 |
| `conflict` / `deleted` / `error` | 不尝试原路径保存，列入未完成结果 |
| 脏临时草稿 | 不自动弹多个路径选择器，列入“未保存草稿”结果 |

保存全部在每个 Tab 内串行、不同 Tab 可受限并发（最多 3 个），但用户可见结果必须稳定：

```ts
interface SaveAllResult {
  saved: string[]
  skipped: string[]
  unresolved: Array<{ tabId: string; title: string; state: EditorSessionState; reason: string }>
}
```

结果提示只显示数量和未完成 Tab 名称；点击某项切换到该 Tab。无 unresolved 时显示“已保存 N 个文件”。保存全部不能关闭 Tab、不能把冲突当成功、不能重建已删除文件。

### 5.3 另存为项目文件

对临时草稿、`deleted`、`conflict`、`error` 提供同一入口“另存为项目文件”：

1. 用户选择项目内目录和文件名，复用文件树现有名称/冲突规则。
2. 使用 `ProjectFileService.createText()` 创建新资源；不得直接写 Tauri、OPFS 或系统绝对路径。
3. 创建成功后调用 `rebindToCreatedResource()`，同一 Tab 保留编辑内容、assets 和选中状态，标题改为新文件名，dirty 变为 false。
4. 取消、同名拒绝、创建失败均保持原 session 和内容不变。

本期“另存为项目文件”不等于导出系统文件。文件导出继续使用文件树既有“导出所选资源”。

## 6. 关闭与切换确认

### 6.1 关闭单个 Tab

关闭干净 Tab 立即执行。关闭脏 Tab 打开当前主题对话框：

| 按钮 | 行为 |
|---|---|
| 保存 | 仅在可保存原路径时保存；成功后关闭，失败/冲突时保持打开 |
| 另存为 | 对临时草稿、删除或冲突 Tab 可用；成功后关闭 |
| 放弃修改 | 删除 session，不修改项目文件 |
| 取消 | 保持打开 |

一次只关闭一个 Tab；关闭多个脏 Tab、切项目或窗口关闭使用统一汇总确认，不能连弹 N 个对话框。

### 6.2 切项目和关闭窗口

项目切换或应用关闭前，收集当前 owner 的脏 session：

1. 无脏 session：立即继续。
2. 有脏 session：显示最多五个标题和其余数量，提供“保存全部并继续”“放弃全部并继续”“取消”。
3. 选择保存全部后，只要存在 unresolved，就停留当前项目/窗口并定位第一个未解决 Tab；绝不丢弃它。
4. 浏览器 `beforeunload` 只能使用原生离开提示；Desktop 由窗口 close 事件拦截并在确认后重新触发关闭，不能异步绕过。

项目切换不自动保存临时草稿；它们会被列入未保存项，用户必须另存或放弃。

## 7. 外部变化与冲突界面

| 来源事件 | session 干净 | session 脏 |
|---|---|---|
| `changed` | 自动读取最新内容，显示短暂“已从磁盘更新” | 进入 `conflict`，保留本地内容 |
| `renamed` | 更新 resource、标题和定位目标 | 同左，不清除 dirty |
| `deleted` | 关闭 Tab | 进入 `deleted`，保留本地内容 |
| batch 覆盖目标删除 | 关闭/进入 deleted，随后源 Tab 按 rename 迁移 | 同左，严格按 batch 顺序 |

冲突面板显示文件名、来源（外部修改/保存冲突）和三个明确动作：

1. **重新加载并放弃本地修改**：再次读取当前资源，成功才 `replaceLoaded()`；读取失败则保持 conflict。
2. **另存为项目文件**：按第 5.3 节换绑新资源。
3. **继续保留本地修改**：关闭面板但维持 conflict，原路径保存仍禁止。

`deleted` 面板只有“另存为项目文件”“放弃修改”；不会出现“保存”或“恢复原文件”。

## 8. 草稿与未保存状态视觉

临时草稿只在用户点“新建草稿”时创建，`resource === null` 是唯一判定：

| 项目文件 | 临时草稿 |
|---|---|
| Tab 显示文件图标、文件名和项目相对路径 tooltip | Tab 显示草稿图标与“未保存草稿” |
| 保存写回绑定 resource | 保存打开“保存到项目” |
| 可由文件树定位 | 显示“尚未保存到项目”，无定位动作 |
| 项目资源事件可改变状态 | 不受项目文件事件影响 |

临时草稿不进入文件树、不会伪装成 `untitled.txt`、不会在切项目时自动继承给下一个项目。可选本地恢复快照必须显式提示恢复，且不自动写回项目。

### 8.1 已打开项目文件的未保存小点

1. 唯一数据源是 `EditorSessionStore` 的 `dirty`：仅 `resource !== null && dirty === true` 的当前项目 Tab 标为未保存。文件树不得自己比较文件内容、mtime 或 Git 状态。
2. `EditorTabs.vue` 在文件标题旁显示小点；`ProjectFileTree.vue` 在同一资源行的右侧显示小点。两处使用同一只读资源状态查询，不能各自维护一份 dirty 集合。
3. 保存成功、用户放弃修改、冲突后重新加载成功或 Tab 关闭后，小点立即消失；保存中仍保持小点，避免把未完成写入误显示为已保存。
4. `conflict`、`deleted`、`error` 保留各自明确状态图标/文案，小点可同时出现但不能替代错误含义。临时草稿仍只显示“未保存草稿”，不在文件树制造不存在的资源行。
5. 这是编辑状态装饰，不给目录聚合数量、不扫描未打开文件；第五期才处理 Git `M/U/9+` 等版本控制装饰。

## 9. 组件边界

| 模块 | 四期职责 |
|---|---|
| `editorSessionStore.ts` | 提供 save-all 候选、关闭决策、状态转换、按资源查询的只读 dirty 状态和纯结果；不弹 UI、不调用 Tauri。 |
| `EditorPanel.vue` | 保存/关闭/冲突/草稿的主题对话框、快捷键和结果提示；调用 service。 |
| `EditorTabs.vue` | Tab 状态图标、草稿标识、dirty 小点、conflict/deleted/error 展示与关闭请求。 |
| `ProjectFileService` | 保持条件读写、createText、资源事件；不感知 Tab 或对话框。 |
| `ProjectFileTree.vue` | 继续负责项目文件新建和定位入口；只读取编辑器 dirty 状态绘制资源小点，不管理保存或关闭确认。 |
| `ExplorerStateStore`（三期） | 提供 `locate(resource)`，不介入保存状态。 |

## 10. 失败与一致性

1. 保存过程项目切换、资源改名或删除时，以 `owner + resource + loadToken` 复核；不匹配结果不能更新新项目 session。
2. 同一 Tab 的保存与关闭串行；关闭确认等待保存结果，禁止双击关闭造成二次写入。
3. 保存全部若中途失败，已成功保存的 Tab 保持成功，未完成 Tab 保留原状态；提示精确数量，不回滚已成功文件。
4. 外部事件和本地保存的同一 `operationId` 继续由 store 去重，本地保存事件不能将更晚的用户编辑覆盖掉。
5. 任何错误消息使用主题内提示，不使用浏览器 `confirm()`；浏览器关闭提示是平台限制的唯一例外。

## 11. 实施顺序

### Task 0：先写失败测试

1. 保存全部跳过干净 Tab，保存脏 ready Tab，保留 conflict/deleted/error/草稿为 unresolved。
2. 保存完成时有新编辑，Tab 仍保持 dirty。
3. 关闭脏 Tab 的保存失败、冲突、取消都不能关闭 Tab。
4. 删除脏 Tab 只能另存或放弃，不能写回旧路径。
5. 外部 changed 对干净/脏 Tab 分别 reload/conflict；batch 覆盖顺序正确。
6. 临时草稿另存成功后换绑项目资源，取消后仍是草稿。
7. 脏项目文件的 Tab/树行同时出现小点；保存、放弃、reload、关闭后同时消失；未打开的文件和临时草稿不产生文件树小点。

### Task 1：Store 纯状态与保存全部结果

- 扩展 `EditorSessionStore`，先完成纯 save-all 计划/结果、关闭资格和状态测试。
- 不修改组件布局、不接快捷键，确保所有规则可在 Node 测试中验证。

### Task 2：保存与冲突交互

- 在 `EditorPanel.vue` 接入保存全部、冲突/删除动作和统一主题对话框。
- 将既有单 Tab 保存复用为唯一执行器，禁止保存全部重复实现写入逻辑。

### Task 3：关闭、切项目与窗口拦截

- `EditorTabs.vue` 只发关闭请求；`EditorPanel.vue` 承担单/多 Tab 确认和项目切换 guard。
- Desktop 处理窗口关闭，Web 处理 `beforeunload`；补 owner 切换和异步保存竞态测试。

### Task 4：草稿、定位、回归和收尾

- 补草稿入口、Tab/树行的 dirty 小点、另存为项目文件、三期定位联动；文件树只消费 editor store 的只读状态。
- 完成 Desktop/Web 人工矩阵，更新 [[开发/文件系统/文件树五期]]、`hot.md`、`log.md` 与本 SDD 实施记录。

## 12. 自动测试

| 测试文件 | 覆盖内容 |
|---|---|
| `src/components/editor/__tests__/editorSessionStore.test.ts` | save-all 计划、状态机、批量覆盖、另存换绑、关闭资格。 |
| `src/components/editor/__tests__/editorInteractionSurface.test.ts` | 快捷键、主题对话框、Tab 图标、dirty 小点和用户动作入口。 |
| `src/components/editor/__tests__/editorPanelProjectFiles.test.ts` | 条件保存、冲突、删除另存、owner 切换和外部重载。 |
| `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts` | 草稿不进文件树、已打开脏文件的小点、项目文件定位入口不回归。 |
| `src/services/__tests__/projectFileService.test.ts` | 条件写入、createText、operationId 与资源事件不回归。 |

## 13. 人工验收

Desktop 与 Web 各执行一次：

1. 打开两个项目文件，各修改一处，执行全部保存；确认两个文件落盘、提示正确、Tab 不再脏。
2. 修改一个项目文件和一个临时草稿，执行全部保存；确认项目文件保存，草稿列为未完成且内容未丢。
3. 修改文件后从 Finder/资源管理器或另一标签页改同一文件；确认进入冲突，可选择重新加载或另存为，不能覆盖外部内容。
4. 修改文件后从文件树删除；确认 Tab 只能另存为或放弃，原路径不会复活。
5. 修改多个 Tab 后关闭 Tab、切项目、关闭应用；确认只出现一次汇总确认，保存失败/冲突时不会继续切换或关闭。
6. 新建临时草稿，确认视觉上标为未保存、不出现在树中；另存到项目后同一 Tab 获得文件名、可由文件树定位。
7. 批量移动/覆盖已打开文件后，再全部保存；确认新路径保存、覆盖目标没有残留 Tab。
8. 修改一个已打开项目文件，确认 Tab 和文件树同一文件行都出现小点；保存、放弃修改、重新加载和关闭后小点都消失。未打开但被 Git 修改的文件不得因此出现该小点。

完成条件：上述矩阵在 Desktop/Web 通过；`pnpm run test:focused`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm exec vite build`、`git diff --check` 通过。第三期 Explorer 定位能力通过后，草稿转项目文件必须能反向定位；若三期未实施，此项仅验证项目文件定位入口不报错。

## 14. 影响文件

| 文件 | 四期职责 |
|---|---|
| `src/components/editor/editorSessionStore.ts` | 保存全部计划/结果、关闭资格、草稿换绑及按资源读取 dirty 状态的纯状态。 |
| `src/components/editor/EditorPanel.vue` | 保存全部、冲突、删除、关闭、切项目和窗口 guard 交互。 |
| `src/components/editor/EditorTabs.vue` | Tab 状态标识、dirty 小点和关闭请求。 |
| `src/components/editor/__tests__/*` | 保存、冲突、关闭、草稿、owner 隔离回归。 |
| `src/services/projectFileService.ts` | 仅验证既有条件保存和事件合同；不扩大 mutation 职责。 |
| `src/components/filetree/ProjectFileTree.vue` | 提供项目文件/定位衔接并读取 dirty 状态绘制小点，不管理编辑器保存 UI。 |

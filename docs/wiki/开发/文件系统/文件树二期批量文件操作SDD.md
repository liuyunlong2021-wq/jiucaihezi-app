# 项目文件树二期：批量文件操作 SDD

> 日期：2026-07-18
> 状态：已完成
> 分支：`0718-wenjianshu&bianjiqu`
> 前置：[[开发/文件系统/文件树一期资源身份与文件安全SDD]]、[[开发/文件系统/编辑区与创作面板基础能力升级SDD]]
> 路线：[[开发/文件系统/文件树五期]]

## 1. 一句话目标

让项目树具备可预测的多选、复制、剪切、粘贴、拖放移动、批量删除与所选资源导出能力；一次操作完成后，文件树、编辑 Tab 和画布只接收一份完整的资源变化事实。

```text
多选资源 / 内部剪贴板 / 拖到目标目录
  -> ProjectFileService 先生成批量计划（含冲突）
  -> 用户一次选择：保留两份 / 覆盖全部 / 取消全部
  -> Desktop 或 Web 适配器完成真实文件操作
  -> 成功后发布一个 batch 资源事件
  -> 文件树、编辑区、画布依次消费同一批映射
```

## 2. 根因与现状

一期已经解决了单个资源的安全读写、改名和删除，但 `ProjectFileTree.vue` 仍只有单选，`ProjectFileService` 只有 `rename(resource)` 和 `remove(resource)`。

现有底座已经可复用，不能推倒重写：

| 已有能力 | 落点 | 二期如何使用 |
|---|---|---|
| 按 `runtime + owner` 串行 mutation | `projectFileService.ts` | 批量计划执行必须进入同一队列，不能在组件内循环调用单文件命令。 |
| 目录后代完整事件 | `ProjectResourceChange.type = 'batch'` | 复制、移动、删除都复用；不能只通知目录根。 |
| Web IndexedDB + OPFS | `webProjectFiles.ts` | 文本元数据和二进制字节必须一起复制、移动或清理。 |
| Desktop 项目路径安全和系统废纸篓 | `src-tauri/src/commands/dev.rs` | 新 Rust 命令继续使用 `clean_relative_path`、根目录限制和 `trash`。 |
| 编辑会话与画布消费者 | `editorSessionStore.ts`、`CreationPanel.vue` | 移动使用 `renamed`；删除使用 `deleted`；复制只产生 `created`。 |
| 画布副本 | `parseCanvasDocument()`、`copyCanvasDocument()` | `.jccanvas` 复制必须生成新的 `canvasId`，不能当普通 JSON 字节拷贝。 |

二期不再允许在 `ProjectFileTree.vue` 中直接调用 Tauri、IndexedDB 或 OPFS 来实现复制/移动。否则又会回到一期之前“树、Tab、画布各自猜路径”的根因。

## 3. 范围

### 3.1 本期做

1. 文件树多选和内部资源剪贴板。
2. 项目内复制、剪切、粘贴。
3. 项目内拖放移动。
4. 同名处理、批量删除。
5. 所选资源“另存为”外部导出。
6. Desktop/Web 同语义的批量计划、结果映射和回归测试。

### 3.2 明确不做

1. 跨项目、跨工作区、跨浏览器或跨设备的复制/移动。
2. 从系统剪贴板粘贴任意文件。系统文件导入继续使用“上传文件/文件夹”。
3. 拖到项目树外、拖到 Finder/资源管理器、Linux/Windows 特有拖放协议。
4. 撤销/重做、回收站浏览、永久删除、Git 状态、文件嵌套或多根项目。
5. 移动后自动改写 Markdown、画布之外的文本引用。
6. 编辑器多组、三方合并、批量重命名规则或正则改名。

## 4. 用户交互

### 4.1 选择

1. 单击未选资源：只选中它；单击目录仍可展开，不把目录打开为文件。
2. `Cmd`（Windows/Linux 为 `Ctrl`）单击：加入或移出当前选择。
3. `Shift` 单击：在当前可见的扁平树列表中选择连续区间；筛选后的可见列表就是区间边界。
4. 右键未选资源：先只选中该资源，再打开菜单；右键已选资源：保留当前多选。
5. 项目切换、资源被删除或树刷新后不存在的路径必须从选择中移除。移动成功后，选择更新为新路径；复制成功后保留原选择。
6. 父目录与其后代同时被选中时，批量操作只保留父目录。此“选择根”归一化必须在服务层再次执行，不能只靠 UI。

### 4.2 剪贴板与拖放

内部剪贴板只保存当前项目资源身份，不写系统剪贴板：

```ts
interface ProjectResourceClipboard {
  owner: string
  runtime: ProjectRuntime
  mode: 'copy' | 'cut'
  roots: ProjectResource[]
}
```

- `Cmd/Ctrl+C` 复制，`Cmd/Ctrl+X` 剪切，`Cmd/Ctrl+V` 粘贴。
- 剪切资源在树中显示弱化状态；粘贴成功才清空剪贴板。复制可重复粘贴。
- 粘贴目标只能是目录；在空白处粘贴表示项目根目录。
- 内部拖放只做“移动到目录”，不根据修饰键隐式变成复制。用户要复制时使用复制/粘贴，避免误创建大量副本。
- 不能把资源移动到自身或自己的后代；移动到原父目录是无操作，不发事件。
- 剪贴板所属 `owner/runtime` 与当前项目不一致、任一源已消失、或源被外部改名后，粘贴前必须失效并提示用户重新复制/剪切。

### 4.3 菜单与键盘

文件/目录右键菜单新增“复制”“剪切”；目录和空白区域在有有效内部剪贴板时新增“粘贴”。多选时菜单文案显示数量，例如“删除 3 个项目”。

`Delete`/`Backspace` 触发批量删除确认框。确认框明确列出数量和最多五个名称；超出部分显示“及另外 N 项”。Desktop 文案为“移入废纸篓”，Web 为“永久删除”。

### 4.4 同名处理

遇到一个或多个同名目标时，操作暂停并出现**一张**统一对话框：

| 选择 | 结果 |
|---|---|
| 保留两份 | 每个冲突源按 `名称 (1).扩展名` 递增找到空位；目录同样改顶层目录名。 |
| 覆盖全部 | 完整替换每个冲突目标，文件替换文件、目录替换目录、不同类型也替换；覆盖目标先经过同一批生命周期删除检查。 |
| 取消全部 | 不改变项目，不发资源事件。 |

不提供“默认覆盖”或逐个弹框。执行时再次检查冲突；若在用户确认后被外部变化抢占，操作不开始，重新显示冲突状态。

## 5. 批量合同

### 5.1 计划、执行与结果

`ProjectFileService` 增加计划和执行接口。组件只显示计划和收集用户决定，不能自行计算目标路径或循环复制文件。

```ts
type ProjectBatchKind = 'copy' | 'move' | 'delete'
type ProjectCollisionPolicy = 'keep-both' | 'overwrite'

interface ProjectBatchRequest {
  kind: ProjectBatchKind
  resources: ProjectResource[]
  targetDirectory?: ProjectResource // copy/move 必填；delete 不传
}

interface ProjectBatchConflict {
  source: ProjectResource
  targetPath: string
  target?: ProjectResource
}

interface ProjectBatchPlan {
  id: string
  kind: ProjectBatchKind
  owner: string
  runtime: ProjectRuntime
  roots: ProjectResource[]
  targetDirectory?: ProjectResource
  conflicts: ProjectBatchConflict[]
}

interface ProjectBatchResult {
  planId: string
  change: ProjectResourceChange | null // 无操作时为 null
  failures: Array<{ resource: ProjectResource; message: string }>
}

interface ProjectFileService {
  planBatch(request: ProjectBatchRequest): Promise<ProjectBatchPlan>
  executeBatch(plan: ProjectBatchPlan, policy?: ProjectCollisionPolicy): Promise<ProjectBatchResult>
}
```

`planBatch()` 必须验证：资源非空、同 `owner/runtime`、目标为同项目目录、选择根已归一化、目标不在源目录内、源和目标均存在。它只读，不产生事件。

`executeBatch()` 必须在现有 `ownerMutationQueues` 内再次验证所有源、目标和冲突，成功后才返回一个事件。`planId` 只能使用一次；过期、已执行或所属项目不匹配的计划直接拒绝。

### 5.2 适配器结果

Desktop 与 Web 适配器接收同一份已验证计划和冲突决定，但各自完成真实文件操作。适配器必须返回精确的资源映射，服务层据此构造事件：

```ts
interface ProjectBatchAdapterResult {
  created: ProjectResource[]
  renamed: Array<{ oldResource: ProjectResource; resource: ProjectResource }>
  deleted: ProjectResource[]
  failures: Array<{ resource: ProjectResource; message: string }>
}
```

规则：

1. `copy`：所有新资源（目录和后代）发 `created`；原资源不变。
2. `move`：每个源根和全部后代发 `renamed(oldResource -> resource)`；移动不是“创建 + 删除”。
3. `delete`：每个根和后代发 `deleted`。
4. 覆盖时，原目标资源及其后代先发 `deleted`，随后同一 `batch` 发新资源的 `created` 或 `renamed`。
5. 一次用户动作只有一个 `transactionId` / `operationId`；事件顺序为覆盖目标删除、源移动/复制结果、其他删除结果。消费者按该顺序处理。
6. `created` 的 Web 资源必须使用新的 documents id 与新的 OPFS 文件 id；`move` 保留 Web 资源 id。

服务继续复用既有 `ProjectResourceChange.type = 'batch'` 和 `flattenProjectResourceChange()`，不新建第二套事件总线。

### 5.3 资源类型语义

| 资源 | 复制 | 移动 | 删除 |
|---|---|---|---|
| 文本 | 复制完整 UTF-8 内容和元数据 | 保持资源内容与 Web id | 走既有 Tab 脏状态规则 |
| 图片/视频/音频 | 复制真实字节；Web 新建 OPFS 文件 | 保持字节和 Web id | Web 清理 OPFS；Desktop 移入废纸篓 |
| 目录 | 递归复制全部后代；不跟随 Desktop 符号链接 | 移动根与全部后代 | 批量删除完整后代 |
| `.jccanvas` | 服务安全读取后解析 V3/旧版本，生成新 `canvasId` 再写入副本 | 仅改路径，保持原 `canvasId` | 先通过现有画布 lifecycle gate |
| 未知二进制 | 字节复制，不经过文本读取/保存 | 普通路径移动 | 按文件删除 |

路径和文件名是文件系统数据，不是展示文本：不得对源路径、目标路径或导入名称调用 `trim()`。仅用 `name.length === 0` 判断空名称；继续拒绝绝对路径、`..`、分隔符和空字节。

## 6. 失败与一致性

### 6.1 预检失败

生命周期检查先于任何文件变更：

1. 批量移动/删除源中的 `.jccanvas` 逐个执行 `canvas:before-rename` 或 `canvas:before-delete`。
2. 覆盖目标中的 `.jccanvas` 按删除执行相同检查。
3. 当前画布有 pending 写入、项目切换、资源已消失、路径不安全或目标在源内，整批不执行。
4. 预检失败必须发送 `canvas:lifecycle-failed` 释放此前已取得的 gate；不发文件资源事件。

### 6.2 执行失败

复制和移动先写入同项目临时位置；所有目标准备成功后才替换到最终路径。若中途失败，删除已创建临时/目标副本并保留源。Desktop 使用同卷 `rename`/临时路径；Web 在同一项目锁中先写 OPFS，再提交 documents 记录，失败时清理新 OPFS id。

不能对“移入操作系统废纸篓”伪造跨资源原子事务：多个资源中某一项被系统废纸篓拒绝时，已成功移入的项目资源保持成功，未执行项保持原样。此时服务只为已完成项发布一个 `batch`，并把失败路径返回给 UI；UI 刷新树并明确显示“已移入 N 项，M 项失败”。它不能宣称整批删除成功或向失败项发送 `deleted`。

### 6.3 消费者结果

- 编辑区：移动已打开文本时更新每个受影响 Tab；覆盖目标的干净 Tab 关闭、脏 Tab 进入 `deleted` 并只允许另存为；复制不自动打开新 Tab。
- 画布：媒体移动更新已有资产路径，媒体删除标记 `missing`；复制不自动把副本加入画布。画布本身移动照既有加载路径更新，复制的新画布是独立文档。
- 文件树：收到本地或外部完整 batch 后只刷新一次，更新选择和剪贴板，不对每个事件单独请求全树。

## 7. Desktop 与 Web 落点

| 层 | Desktop | Web |
|---|---|---|
| 批量执行 | 在 `src-tauri/src/commands/dev.rs` 新增受项目根限制的批量 copy/move/delete 命令，并在 `src-tauri/src/lib.rs` 注册。 | 在 `webProjectFiles.ts` 增加同语义的批量实现，始终持有既有 Web 项目锁。 |
| 字节复制 | 使用递归复制，不跟随 symlink；临时路径与目标必须在项目根内。 | 通过 `readBinary()`/`writeBinary()` 复制 Blob，写新 OPFS id；不把二进制降级为字符串。 |
| 文本/文件夹 | 保持 UTF-8 与层级，目标父目录不存在则在计划中创建。 | 复制/更新 IndexedDB 记录、`folderId`、`metadata.relativePath`，并保留目录层级。 |
| 画布副本 | `ProjectFileService` 调用纯 `parseCanvasDocument()` / `copyCanvasDocument()` 执行读-转换-写；文件树组件不得直接写入。 | 同左；不得调用通用二进制复制。 |
| 删除 | 继续调用 `trash`，项目根禁止删除。 | 继续永久删除 documents 和关联 OPFS。 |

批量另存为不改变项目，因此不走 `ProjectFileService` 的资源事件。它改名为“导出所选资源”：Desktop 使用系统目录选择和已有外部路径安全约束，Web 使用 File System Access API。两端都沿用本 SDD 的一张同名确认框和字节保真规则；不支持时明确提示，不静默下载或覆盖。

## 8. 实施顺序

### Task 0：先写失败测试

1. 多选父目录与子文件只形成一个选择根。
2. 同名复制在 `keep-both` 时生成稳定、无冲突的全部目标路径；`overwrite` 对目录是整体替换，不合并。
3. 移动到自身/后代、跨项目粘贴、过期剪贴板和过期计划均被拒绝且无事件。
4. 复制文本、二进制、目录和 `.jccanvas`：二进制字节相同但 Web OPFS id 不同，画布副本 `canvasId` 不同。
5. 移动目录发出完整 `renamed` 映射；覆盖目标先 `deleted`；复制发 `created`；失败不发成功事件。
6. 删除脏 Tab、画布媒体、待写入画布和 Desktop/Web 删除语义保持一期规则。

### Task 1：服务层计划与事件

修改 `src/services/projectFileService.ts`，新增选择根归一化、`planBatch()`、`executeBatch()`、冲突描述和适配器批量结果。先以纯 service 测试锁定结果映射与队列串行。

### Task 2：跨端存储实现

修改 `src-tauri/src/commands/dev.rs`、`src-tauri/src/lib.rs`、`src/utils/webProjectFiles.ts`。先做文件/目录/二进制的批量 copy/move/delete，再接 `.jccanvas` 副本转换；每个分支都有字节、路径、冲突和失败清理测试。

### Task 3：文件树交互与 lifecycle 预检

修改 `src/components/filetree/ProjectFileTree.vue`：选择状态、内部剪贴板、菜单、快捷键、内部拖放、统一冲突/批量删除对话框。它只调用服务计划/执行，并在执行前协调已有 canvas lifecycle gate。

### Task 4：消费者和导出所选

修改 `editorSessionStore.ts`、`CreationPanel.vue` 的 batch 回归边界；实现“导出所选资源”并复用现有上传/导出同名对话框，不发送项目资源变更事件。

### Task 5：收尾

删除二期新产生的组件内文件系统旁路，补 Wiki 实施记录、热缓存与人工验收步骤。

## 9. 自动测试

| 测试文件 | 必测内容 |
|---|---|
| `src/services/__tests__/projectFileService.test.ts` | 选择根、计划校验、冲突、完整 created/renamed/deleted batch、队列与失败无事件。 |
| `src/utils/__tests__/webProjectFiles.test.ts` | 文本/目录/OPFS 二进制复制和移动、id 规则、覆盖、回滚清理。 |
| `src-tauri/src/commands/dev.rs` 内嵌测试 | 项目根逃逸、symlink、文件/目录复制、目标冲突、临时清理、废纸篓部分失败。 |
| `src/components/canvas/__tests__/canvasDocument.test.ts` | 批量副本中的每个 `.jccanvas` 都产生独立 `canvasId`。 |
| `src/components/editor/__tests__/editorSessionStore.test.ts` | 覆盖目标和移动源的多个 Tab 正确关闭/改路径/进入 deleted。 |
| `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts` | 多选、剪贴板、内部拖放、统一对话框和 lifecycle 预检只经服务。 |

## 10. 人工验收

在同一个测试项目中，Desktop 和 Web 各执行一次：

1. 新建 `A/one.md`、`B/one.md`、一个图片、一个音频、一个 `.jccanvas`，以及一个含媒体的目录。
2. 用 `Cmd/Ctrl` 多选 `A` 与图片，复制并粘贴到 `B`；同名时选“保留两份”，确认两份内容、媒体和目录都存在。
3. 剪切已打开的 `A/one.md` 到另一目录；确认 Tab 标题变为新路径，保存后旧路径没有复活。
4. 把媒体目录拖到另一目录；回到创作面板，已有媒体卡片仍指向新路径并能播放。
5. 复制 `.jccanvas`；分别打开两份，在其中一份添加素材并保存，确认另一份不变化。
6. 选中多个资源删除：Desktop 确认它们进入废纸篓；Web 确认永久删除。删除包含一个脏 Tab 时，只该 Tab 显示另存为/放弃，不能写回旧路径。
7. 重复第 2 步选择“覆盖全部”；确认目标旧内容消失、覆盖目标的 Tab/画布状态没有残留。
8. 尝试拖动目录到自身、粘贴到另一项目、删除有待写入的画布；确认项目内容没有变化且提示明确。

完成条件：上述矩阵在 Desktop/Web 都通过；`pnpm run test:focused`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm exec vite build`、`git diff --check` 通过。`vue-tsc -b` 继续单列既有错误，只有本期引入的新错误才算阻断。

## 11. 影响文件

| 文件 | 二期职责 |
|---|---|
| `src/services/projectFileService.ts` | 批量计划、执行、映射事件和串行边界的唯一入口。 |
| `src/utils/webProjectFiles.ts` | Web 端文本、目录、OPFS 二进制的批量存储实现。 |
| `src-tauri/src/commands/dev.rs` | Desktop 端受项目根限制的批量文件操作和废纸篓语义。 |
| `src-tauri/src/lib.rs` | 注册新增 Tauri 命令。 |
| `src/components/filetree/ProjectFileTree.vue` | 多选、内部剪贴板、拖放、确认框和调用服务。 |
| `src/components/canvas/canvasPersistence.ts` | 提供可被批量副本调用的画布文档解析与复制辅助。 |
| `src/components/editor/editorSessionStore.ts` | 验证覆盖/移动 batch 的 Tab 生命周期。 |
| `src/components/creation/CreationPanel.vue` | 验证媒体和画布资源映射后的恢复行为。 |

## 12. 后续边界

二期完成后，第三期才能把 Desktop 5 秒轮询替换为增量观察并处理大项目的按需加载；第四期再完善编辑区的“全部保存”和完整人工矩阵。二期不提前做排序、紧凑目录或 Git 装饰。

## 13. 实施记录（2026-07-18）

- `ProjectFileService` 已成为批量计划、执行和单一 batch 事件的入口；Desktop 命令直接返回完整后代映射，不再依赖 1000 条树列表补查。
- Desktop 与 Web 已实现目录/文本/OPFS 二进制的复制、移动、删除、同名保留两份与覆盖；覆盖目标的 `deleted` 映射先于创建或移动映射。
- 画布批量副本会生成新的 `canvasId`；批量移动、删除和覆盖前会经过既有 canvas lifecycle gate。
- 文件树已支持多选、内部剪贴板、拖放移动、剪切弱化显示、批量删除、所选资源导出与选择/剪贴板路径同步。
- 自动验证已通过：`pnpm run test:focused`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm exec vite build`、`git diff --check`。
- 人工验收：用户已完成本分支提供的 Desktop 六项验收，结果成功；Windows 系统回收站与目录选择器仍建议在发版前真机验证。

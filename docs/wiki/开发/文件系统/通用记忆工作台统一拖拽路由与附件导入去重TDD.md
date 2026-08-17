# 通用记忆工作台统一拖拽路由与附件导入去重 TDD

> 日期：2026-08-16
> 状态：已实施；自动验收通过；对话框与创作画布拖拽人工验收通过；其余跨端矩阵待执行
> 前置：[[开发/文件系统/文件树四点五期文件总管统一SDD#10.2 当前记忆工作台拖放恢复与重复导入去重（2026-08-16，方案已确认、待实施）]]

## 1. 目标

恢复记忆工作台的 Desktop 原生拖拽上传，并统一 Desktop、Web、文件树、对话区和创作面板的导入边界：

1. 用户把文件或文件夹拖到对话区时，进入当前对话附件。
2. 用户把媒体拖到创作画布时，进入创作面板画布。
3. 对话区和创作面板同时存在、但拖拽没有命中具体区域时，对话区优先。
4. 创作面板无论分栏还是全屏/专注显示，都只有明确拖到画布区域才进入画布；提示词区、工具栏和窗口空白不兜底接收。
5. 同一项目内重复导入同一资源时复用已有项目资源，不生成无限重名副本。

文件导入成功后，事实源仍是项目内相对 `ProjectResource`；Finder 路径、浏览器 `File` 和临时 Blob 只用于本次导入。

## 2. 根因

单产品分离删除了旧 `WorkspaceLayout` 和其挂载的 `desktopProjectDrop` 分发器。当前 `ProjectFileTree`、`CreationPanel` 仍有 `project:desktop-drop` 消费者，但没有统一 Desktop 事件生产者；`MemoryWorkbench` 输入区也没有 DOM `drop` 入口。

这不是附件解析或 NewAPI 上传故障，而是拖拽事件没有到达现有导入链路。若在各组件内分别补事件，还会造成同一次拖拽被重复导入、对话区与创作面板抢事件，以及 Desktop/Web 行为分叉。

## 3. 红灯测试

实施代码前先新增或恢复以下测试，使旧实现失败：

### 3.1 路由合同

1. Desktop 只有 `App.vue` 一个 `onDragDropEvent` 订阅者；不得恢复 `WorkspaceLayout`。
2. Tauri drop 坐标经过 `devicePixelRatio` 换算后使用 `elementFromPoint`，最近的 `[data-project-drop-target]` 决定目标。
3. 明确命中 `chat` 时只发出对话拖放事件；明确命中 `canvas` 时只发出创作面板事件；明确命中 `project` 时只发出文件树事件。
4. 坐标没有命中目标时，若对话区可见且可接收附件，目标为 `chat`；否则丢弃事件，不把创作面板或窗口空白兜底视为画布。
5. 对话区和创作画布同时可见时，窗口空白区域不得落到创作面板。
6. Desktop 原生路径和 Web `DataTransfer.files` 不能对同一次拖放各执行一次导入。
7. Mobile 不注册 Desktop 原生拖放分发器，现有系统选择器行为不变。

### 3.2 导入能力合同

1. `chat` 接收现有支持的文档、图片、音频、视频和目录文件；复用 `MemoryWorkbench` 现有附件解析与保存状态。
2. `canvas` 只接收图片、音频、视频；文档或其他类型显示明确提示，不偷偷改投对话区。
3. `project` 复用文件树现有项目导入目标，不新增平行存储目录。
4. Desktop 只消费 Tauri 原生路径；Web 只消费 `DataTransfer.files`；两者入口互斥。

### 3.3 去重合同

1. 同项目、同素材分类、同规范化文件名、同 SHA-256 再次导入时返回已有 `ProjectResource`，项目文件数不增加。
2. 去重命中不发布虚假的 `created` 资源事件；调用方仍能得到可继续生成附件元数据的已有资源。
3. 同名不同内容必须保留新副本并沿用现有 keep-both 命名。
4. 内容相同但用户明确改名必须保留独立资源。
5. Office/PDF 原件命中去重时复用原件和 Markdown 可读副本；原件存在但 Markdown 缺失时只补 Markdown。
6. 去重不得只依赖文件名、大小或修改时间，不得保存绝对路径、符号链接、硬链接或全局内容寻址索引。

## 4. 最小实现

1. 恢复一个轻量 `desktopProjectDrop` 服务，在 `App.vue` 挂载唯一 Desktop 监听器；服务只负责坐标命中、目标判定和事件分发，不负责写文件。
2. 在 `MemoryWorkbench` 的真实附件输入区域增加 `data-project-drop-target="chat"` 和 Web DOM `dragover/drop` 入口；复用现有文件选择器、附件解析、Office/PDF Markdown 转换和附件状态。
3. 保留 `CreationPanel` 的 `data-project-drop-target="canvas"` 与画布 drop；其 Desktop 事件仍只接受媒体类型。
4. 保留 `ProjectFileTree` 的 `data-project-drop-target="project"`；不让组件自行订阅 Tauri 原生窗口事件。
5. 在 `ProjectFileService` 或现有共享导入动作边界增加内容哈希去重；文件树、对话区和画布不各自实现去重。
6. 目录导入先展开为文件集合，再通过同一导入动作处理；单个拖入根读取失败不阻断其他根，达到 1000 个条目上限时明确提示，已成功文件不回滚。
7. 所有持久化路径继续使用当前 `.raw/jc-media/图片|视频|音频|文档` 和项目相对路径合同，不恢复旧 `jc-imports/` 或第二套附件目录。

## 5. 路由优先级

```text
真实 drop 命中具体 data-project-drop-target
  -> chat / canvas / project（命中谁就交给谁）

没有命中具体区域
  -> chat 可见且可接收：chat
  -> 否则：忽略
```

“对话区优先”只适用于窗口级拖拽没有命中具体区域的情况；用户明确把文件拖到画布 drop zone 时，画布目标优先，避免破坏已有媒体编排。

## 6. 影响边界

| 文件/模块 | 责任 |
|---|---|
| `src/App.vue` | 唯一 Desktop 原生拖放监听器生命周期 |
| `src/services/desktopProjectDrop.ts` | 坐标命中、路由和事件分发 |
| `src/components/memory/MemoryWorkbench.vue` | 对话 drop zone、Web 文件 drop、现有附件入口复用 |
| `src/components/creation/CreationPanel.vue` | 画布 drop zone、媒体类型边界 |
| `src/components/filetree/ProjectFileTree.vue` | 项目文件树 drop 目标，继续消费共享事件 |
| `src/services/projectFileActions.ts`、`src/services/projectFileService.ts` | 统一导入和 SHA-256 去重 |
| 对应 `__tests__` | 红灯路由、入口互斥、类型边界、去重和回归测试 |

不修改 NewAPI、Raw 格式、记忆模式工具合同、附件绝对路径持久化规则、Mobile 系统选择器或创作模型协议。

## 7. 验收矩阵

### 自动验收

1. Desktop 只存在一个原生拖放监听器；组件卸载后无残留订阅。
2. 坐标命中 `chat/canvas/project` 的事件只到达对应消费者。
3. 对话区和创作面板并存时，空白区域默认进入对话；创作面板全屏时仍须明确拖到画布。
4. Web 单次 drop 不触发 Desktop 路径导入；Desktop 单次 drop 不触发 Web 文件导入。
5. 目录文件、文档、图片、音频、视频分别遵守目标能力边界。
6. 重复导入、同名不同内容、明确改名和 Office/PDF Markdown 补全均通过。
7. TypeScript、相关 focused tests、Web/Desktop 构建和 `git diff --check` 通过。

### 人工验收

| 场景 | 预期 | 状态 |
|---|---|---|
| 对话框与创作面板并存，拖到对话输入区 | 进入对话附件，不进入画布 | 2026-08-16 用户确认通过 |
| 对话框与创作面板并存，拖到画布 drop zone | 进入画布，不进入对话 | 2026-08-16 用户确认通过 |
| 两者并存，拖到窗口空白处 | 进入对话附件 | 待验证 |
| 只有全屏/专注创作面板，拖到窗口空白处或提示词区 | 忽略，不进入画布 | 待验证 |
| 只有全屏/专注创作面板，拖到真实画布区域 | 进入画布 | 待验证 |
| 文件夹拖到对话区 | 文件逐项进入对话附件，目录本身不保存为外部路径 | 待验证 |
| 文档拖到创作画布 | 明确提示不支持，不改投对话 | 待验证 |
| 同一个文件连续拖入两次 | 项目只保留一份，两个引用指向同一资源 | 待验证 |
| 同名不同内容连续导入 | 保留两份，使用 keep-both 名称 | 待验证 |
| 重启 App 后再次引用已导入附件 | 使用项目相对路径恢复，不依赖原电脑绝对路径 | 待验证 |
| Web、Desktop、Mobile 各执行一次 | Web/Desktop 走各自入口且不重复，Mobile 选择器不变 | 待验证 |

## 8. 实施顺序

```text
恢复/新增红灯测试
  -> 恢复 App 单例 Desktop 分发
  -> 接入 chat drop zone 与 Web 入口
  -> 收口 canvas/project 路由
  -> 在共享导入边界加入 SHA-256 去重
  -> 跑自动验收
  -> 执行 Desktop/Web/Mobile 人工矩阵
```

自动验收已完成：路由合同、入口互斥、ProjectFileService SHA-256 去重、Web 同内容导入和 Rust 外部导入去重均通过。2026-08-16 用户在当前真实产品中确认对话框与创作画布拖拽上传通过；其余跨端、异常和去重人工矩阵尚未执行，不能扩大登记为已通过。

## 9. 实施记录（2026-08-16）

- `App.vue` 挂载唯一 Desktop 原生拖放分发器；按坐标命中 `chat`、`canvas`、`project`，窗口级回退只保留可见对话区，创作画布必须明确命中。
- 对话输入区增加 Web 目录/文件拖入；创作面板与文件树继续消费共享事件，Desktop 原生路径和 Web `DataTransfer.files` 互斥，Mobile 不注册 Desktop 分发。
- `ProjectFileService`、Rust 外部导入和 Web 项目传输均按同名同内容复用资源；同名不同内容保留 keep-both；去重命中不发布 `created` 事件。
- Office/PDF 优先复用已有 Markdown；原件存在但 Markdown 缺失时只补可读副本；创作媒体统一保存到当前 `.raw/jc-media` 分类目录。
- Desktop 目录展开按拖入根逐项容错；可读文件继续分发，失败项和达到 1000 个条目上限的目录在目标区域显示提示。
- 自动验证：路由、服务、Web 传输定向测试 `31/31`；`pnpm run test:focused`（前端 focused 与 Rust `396 passed / 1 ignored`）通过；`pnpm exec vue-tsc -b`、Web/Desktop quick build 与产物审计通过；`git diff --check` 通过。
- 人工验证：2026-08-16 用户在当前真实产品中确认对话框拖拽上传和创作画布拖拽上传均正常；未覆盖的人工矩阵继续保持待验证。

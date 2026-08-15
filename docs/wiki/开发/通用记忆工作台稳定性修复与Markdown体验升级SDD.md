# 通用记忆工作台稳定性修复与 Markdown 体验升级 SDD

> 状态：Android 阶段暂停期间实施；Android 恢复后复用本 SDD 的共享修复并补做 Android 验收
> 范围：通用记忆 Web、Mac、Windows、iPhone、iPad、Android
> 原则：先夯实共享 Web/Desktop/iPhone/iPad 地基，再恢复 Android；不改变项目文件为真源，不新增第二套会话或记忆系统。
> 现行 Raw 时序：以 [[开发/通用记忆工作台模型主导工具与审批SDD]] 为准；本轮用户消息和流式回复先留在内存，完整回复结束后一次写入 user/assistant 对；可重试的网络或上游错误耗尽重试后，额外写入一次带中断标记的 user/assistant 恢复点。

## 1. 目标

在不影响现有正式版本的前提下，补齐通用记忆工作台的 Markdown 文件体验、双向链接、编辑保存、对话渲染一致性、移动端预览稳定性和媒体模型选择体验。

本 SDD 不重新设计通用记忆工作台，不开发漫剧、电商或制作工作台，不改 API 业务合同，不把 Markdown 内容复制到新的数据库或 Store。

## 2. 现状问题

| 编号 | 问题 | 影响 | 优先级 |
| --- | --- | --- | --- |
| P0-1 | iPhone/iPad 查看 Markdown 文件时可能自动返回对话 | 打断阅读，移动端文件预览不可稳定使用 | P0 |
| P0-2 | 创作面板保留已下线或无效的 GPT Image 旧模型引用 | 用户可能选择失效模型，提交无效任务 | P0 |
| P0-3 | 发送后消息视口可能停在旧位置，流式内容不跟随或结束时突然跳转 | 用户看不到当前输入或最新输出，无法稳定阅读回复 | P0 |
| P0-4 | 手机执行 Wiki 增加/填充时明显发热 | 重复扫描、同步和工具循环占用 CPU、桥接和网络 | P0 |
| P1-1 | Markdown 文件阅读显示为纯文本，标题、表格、引用和粗体没有排版 | 文件树阅读体验明显低于 Obsidian/VS Code | P1 |
| P1-2 | 对话部分内容显示 `###`、`**`、`>`、`---` 等 Markdown 源符号 | 对话阅读不够自然，跨入口显示不一致 | P1 |
| P1-3 | 缺少 `[[文件路径]]` 双向链接和项目内跳转 | 角色、场景、道具和集数之间无法快速导航 | P1 |
| P1-4 | Markdown 文件只能阅读，不能直接编辑保存 | 用户需要离开 App 使用外部编辑器 | P1 |
| P2-1 | 消息复制按钮占据过多垂直空间 | 对话列表密度偏低 | P2 |
| P2-2 | 创作面板模型按渠道平铺，GPT Image、Banana 等家族不易识别 | 模型选择和费用比较困难 | P2 |
| P2-3 | 模型费用缺少统一显示单位 | 用户无法判断一次任务的预估消耗 | P2 |

## 3. 设计决断

### 3.1 Markdown 四层合同

| 层 | 合同 |
| --- | --- |
| 存储 | 项目文件保存 Markdown 原文；不删除 `#`、`**`、`>`、`|` 等语法，不创建隐藏副本 |
| 阅读 | 使用统一安全 Markdown 渲染器显示标题、列表、表格、引用、代码、链接、图片和双链 |
| 编辑 | 显示 Markdown 原文，提供语法高亮和保存；保存走现有版本冲突保护 |
| 对话 | 对话消息和文件阅读使用同一 Markdown 渲染语义；复制时保留原始 Markdown 文本 |

“HTML”只是渲染实现，不是另一种用户内容。文件阅读和对话显示应有相同的 Markdown 排版，只保留各自的外层标题、返回、复制和保存操作。

### 3.2 双链与反向链接

正向链接示例：

```markdown
[[角色/王小二]]
```

点击后打开目标 Markdown 文件。目标不存在时显示明确的“文件不存在”，不得静默创建。

反向链接是目标文件自动列出的引用来源：打开 `角色/王小二.md` 时，系统扫描当前项目 Markdown 文件中引用它的地方，并显示：

```text
被以下文件引用：
- 第001集/剧本.md
- 第002集/剧本.md
```

点击引用项返回来源文件。反向链接是派生视图，不写入第二份索引数据库；项目文件仍是真源。

第一版不做块引用、嵌入、知识图谱、插件兼容和反向链接数据库。未来知识图谱可以复用现有画布引擎：Markdown 文件是节点，双链是边；媒体画布与知识图谱画布保持不同数据合同。

### 3.3 编辑模式

第一版提供清晰的“阅读 / 编辑”切换：

- 阅读模式显示渲染后的 Markdown，不显示语法符号。
- 编辑模式显示原文，并对标题、强调、引用、代码块和双链做语法高亮。
- 保存前执行版本检查；冲突时保留用户内容并要求选择，不覆盖其他设备的更新。
- 移动端先采用稳定的原文编辑器，不实现 Obsidian 式实时局部排版，避免光标、键盘和滚动位置不稳定。

### 3.4 模型家族与费用

创作面板按模型家族分组，家族内保留具体模型和真实模型 ID：

```text
GPT Image
  GPT Image 2
  GPT Image 2 VIP
  GPT 文生图
  GPT 图生图

Banana（Google 图片模型）
  Nano Banana Flash  ← Gemini 3.1 Flash Image
  Nano Banana Pro    ← Gemini 3 Pro Image
```

模型家族必须由规范化模型 ID/能力信息推导，不只依赖显示名称。已下线模型不能出现在列表中，也不能成为默认模型。

已确认的渠道别名关系：

| UI 分组 | UI 显示名 | 底层模型/渠道名 |
| --- | --- | --- |
| Banana | Nano Banana Flash | `gemini-3.1-flash-image-preview` |
| Banana | Nano Banana Pro | `gemini-3-pro-image-preview` |

两者属于同一 Google 图片模型家族；前端按 Banana 家族归组，仍保留真实底层模型 ID 用于请求、能力判断和费用读取。

费用只显示数字和明确单位，不显示人民币符号：

```text
0.2/次
0.05/张
6.6/次
```

费用来源必须是现有模型注册表、New API 或已核实的管理员配置；前端不得猜测、硬编码或把不同计费单位混写。若无法确认单位，显示“费用以实际扣费为准”，不得显示孤立数字。

当前价格快照（完整清单见 `docs/wiki/运维/模型价格表-2026-07-29.md`）：

```json
{
  "rh-3d-image": 6.6,
  "rh-3d-text": 4.8,
  "rh-gpt2-text": 0.15,
  "rh-gpt2-image": 0.15,
  "gpt-image-2": 0.08,
  "gpt-image-2-vip": 0.2,
  "gemini-3-pro-image-preview": 0.2,
  "gemini-3.1-flash-image-preview": 0.1,
  "rh-image-v2": 0.3,
  "rh-pro-image": 0.5,
  "rh-seedance2": 2.3,
  "rh-seedance2-text": 1.5,
  "rh-seedance2-image": 1.5,
  "rh-sora2-text": 2,
  "rh-sora2-image": 2,
  "rh-aiapp": 0.3
}
```

完整价格清单以该价格表和管理员/网关真实配置为准；客户端只负责展示注册表数值和单位，不拼接渠道前缀，也不推导渠道价格。

### 3.5 手动方向性覆盖合同（2026-08-04 修订）

通用记忆工作台不是实时协作产品。项目文件始终本地优先，云端只用于用户主动执行的跨设备接续和备份。

用户只在项目中心看到两个数据动作：

- `上传并覆盖云端`：以本地允许同步的完整文字快照覆盖云端；云端独有文字删除。
- `下载并覆盖本地`：以云端允许同步的完整文字快照覆盖本地；本地独有可同步文字删除。

平时编辑 Wiki、Raw 和普通文字文件时，只写本地 `ProjectFileService`，不联网、不执行全量扫描、不自动上传。打开项目、App 回到前台、网络恢复和模型工具写文件均不自动传输。

两个动作均执行：

1. 明确确认覆盖方向和删除后果；
2. 读取本地与云端完整文字快照；
3. 以用户选择的一侧新增、覆盖并删除另一侧可同步文字；
4. 更新 cursor、revision、hash 和结果状态。

不合并、不创建冲突副本。媒体、空目录、凭据、Skill、MCP、Provider、Session、设置和 `.raw/.sync` 不比较、不传输、不删除。设置页只诊断状态，不提供操作按钮。

### 3.6 最小流式显示合同

Markdown/Raw 仍是对话唯一真源。流式阶段只保留一个内存中的 `streamingText`，每次收到模型返回的文字就追加并立即显示；不为流式片段创建文件、数据库记录、消息副本或第二套事件模型。

模型结束后，将本轮用户消息和完整回复作为一对一次写入当前 Raw，再用已落盘的对话内容替换临时用户/助手行。手动停止时本轮不写 Raw，原输入和附件保留供重发。

### 3.6.1 网络中断恢复合同

- `502`、`503`、`504`、`524` 和明确的网络连接错误只重试当前模型请求；网络错误识别必须覆盖浏览器错误和 Tauri/reqwest 的 `error sending request`。不重跑整轮用户任务，也不重复已经完成的工具调用。
- 当前模型请求最多自动重试两次，固定退避 `2 秒、4 秒`；界面显示“正在重连 1/2”或“正在重连 2/2”。鉴权、参数、内容限制和用户取消不重试。
- 自动重试继续复用内存中的当前消息、已完成工具结果和项目真实文件；正常成功后仍只写入一组完整 user/assistant 对。
- 两次重试耗尽后，仅对明确的模型请求或流传输中断复用现有 `appendMemoryRound()`；参数、鉴权、工具和落盘错误不得伪装成网络中断。原用户消息、已有部分正文和固定中断标记作为一组 user/assistant 对写入当前 Raw；相同 `userTurn.id` 重复调用时保持幂等。
- 中断恢复点只用于让后续读取原任务和已有正文，不保存已完成工具结果。固定标记必须提醒继续前检查项目现状，避免重复写入或外部操作；工具已经修改的项目文件仍是工具结果真源。
- 发送期间锁定输入、附件、引用、Skill 和执行模式；切换项目或会话使当前 generation 失效，旧任务不得再更新新界面状态。第一版不增加任务表、断点表、后台队列、无限重试或逐 token 持久化。

滚动只保留三条规则：

1. 用户在底部时，流式文字持续跟随底部；
2. 用户主动向上滚动时，停止自动跟随，不抢回视口；
3. 用户回到底部时，恢复自动跟随。

临时流式显示行与已保存对话使用同一个普通文档流和同一个底部锚点；“临时”只表示尚未落盘，不表示新增持久化容器。记忆工作台不使用虚拟列表、绝对定位、估算高度或手工测量，正文增长由浏览器自然布局处理；只复用现有 `ChatScrollNav` 的底部跟随状态，不搬入 OpenCode 的完整 Part/事件存储体系。

长对话继续保留完整自然文档流，但每条 `.memory-message` 复用主聊天已验证的浏览器原生 `content-visibility: auto`：屏幕外消息仍在同一 DOM 顺序中，由浏览器跳过不必要的布局和绘制，进入视口时自动恢复。不得增加固定行数、固定屏数、轮询、`IntersectionObserver`、虚拟列表、绝对定位、估算高度或 `contain-intrinsic-size`；这些方案会重新引入可变高度 Markdown 的测量和滚动补偿问题。

工具调用属于当前运行状态，不属于对话文件真源。运行中只在内存保留 `status`、`streamingText` 和既有工具循环所需消息；工具修改项目文件时继续通过现有 `ProjectFileService`/工具执行器写入真实文件并标记待同步，不把工具事件、工具结果或流式片段另存为 Raw 消息。工具结束并得到完整最终正文后，本轮 user/assistant 对只写入 Raw 一次。

运行状态必须消费 Direct Engine 已有的工具开始和结束事件，在输入框上方显示当前阶段、实际完成的最近步骤与耗时。工具结束后立即切换为“正在等待模型继续处理”，不得继续显示“正在使用工具”；只展示已经发生的真实动作，不伪造未来计划。该状态仅存在于 `MemoryWorkbench` 内存与界面，不引入 OpenCode、全局 Store 或新的持久化结构，也不进入 Markdown/Raw。

## 4. 实施顺序

### Task 0：冻结基线

- 从当前稳定 `main` 冻结基线；不等待 Android 4D 阶段恢复，也不把 Android 未完成代码带入本轮。
- 保留 Web、Mac、Windows、iPhone、iPad 的构建和真机验收证据；Android 恢复后补做同一修复的 Android 验收。
- 确认 Markdown 渲染库、文件服务、模型注册表和费用来源。
- 抓取一次 iPad 自动返回问题的最小复现日志。

验收：修复工作从稳定 `main` 开始，不把 Android 未完成状态带入本阶段。

### Task 1：移动端预览稳定性

- 复现 iPhone/iPad Markdown 预览自动返回。
- 检查移动平台识别、项目切换 watcher、异步文件读取和预览组件卸载链路。
- 修复后，打开 Markdown 至少停留 3 分钟、滚动到底部、切换后台再返回，仍停留在预览页。

验收：iPhone、iPad 各完成一次冷启动、打开、滚动、后台恢复；无自动跳转、无空白预览、无控制台/原生错误。Android 恢复后补做同一矩阵。

### Task 1.5：发送、流式输出与自动滚动

- 保留一个内存中的 `streamingText`，每次收到模型文字就追加显示；不保存流式片段，不新增消息数据库或事件存储。
- 将临时用户/流式助手行纳入现有普通文档流，与已保存 Raw 消息使用同一个底部锚点；不使用虚拟列表、绝对定位、估算高度或手工测量；流式结束后一次写入完整 user/assistant 对并替换临时行。
- 复用主 App 已验证的粘性跟随合同：底部自动跟随、用户上滚停止、回到底部恢复；不创建第二套滚动状态机。
- 发送开始、流式文字变化、流式结束和最终 Raw 落盘只经过同一个滚动入口，避免多个 watcher 互相抢夺视口。
- 工具执行只更新当前运行内存状态；真实文件修改继续走现有文件工具，工具事件和中间结果不写入 Raw、不建立 Part/事件存储。

验收：连续发送长文本、触发 Wiki 工具、触发多轮工具和普通直答各 3 次；文字按返回过程持续出现，结束后每轮只写入一组完整 user/assistant 对；每次都能看到自己的最新输入和当前流式输出，结束后不跳到旧消息；主动上滚时不抢回视口；手动取消时 Raw 零新增；可重试错误在两次重试内成功时只写完整结果，重试耗尽时只写一组带固定标记的中断恢复点。

### Task 1.5.2：长对话屏外绘制降热

- 保留现有 `timelineTurns -> v-for -> .memory-message` 普通文档流和全部显示效果。
- 只给 `.memory-message` 增加 `content-visibility: auto`，复用主聊天的原生浏览器策略。
- 不改变 Raw、模型上下文、Markdown、Mermaid、媒体卡、滚动导航或跨端同步合同。
- 不恢复 `@tanstack/vue-virtual`，不增加固定消息数量、“加载更早记录”或自行计算可视区。

验收：样式合同确认每条记忆消息启用 `content-visibility: auto`，同时继续禁止虚拟列表、绝对定位和手工测高；TypeScript 与记忆工作台定向测试通过。真实降温效果由用户在当前 Desktop App 先验证，Web/iPhone 长对话矩阵随后补充。

### Task 1.6：移动 Wiki 操作降热

- 移除项目文件变化触发的自动网络同步。Wiki、Raw 和普通文字文件写入只落本地。
- 项目中心只保留两个数据动作：`上传并覆盖云端`和`下载并覆盖本地`；设置页没有操作按钮。
- 打开项目、App 回到前台、网络恢复和模型工具写文件均不自动同步；本地工作期间不发起网络请求、不扫描全量项目、不上传。
- 每次动作使用完整文字快照覆盖目标侧；服务端保留 revision、hash、mutation id 和 tombstone 作为传输安全机制，但产品层不合并、不生成冲突副本。
- 在一次模型工具循环内复用可安全复用的 Wiki 文件快照；写入后使相关快照失效，不能读取旧内容冒充新结果。
- 为 Wiki 搜索/验证/填充记录文件扫描数、读取数、工具轮数和同步轮数，先用真实手机确认热源再调整窗口。
- 不先把 Wiki 逻辑搬到服务器；只有本地合并和缓存仍不足时才单独评估。

验收：同一 Wiki 填充任务在手机上完成后，“上传并覆盖云端”使云端文字与手机一致；另一设备执行“下载并覆盖本地”后本地文字与云端一致；被源侧删除的文字不会在目标侧复活，媒体和空目录不受影响；连续操作 5 分钟无明显异常升温、卡顿或自动传输。

### Task 2：统一 Markdown 阅读渲染

- 文件阅读和对话显示共用安全 Markdown 渲染合同。
- 支持标题、段落、列表、表格、引用、分割线、代码块、链接、图片和常见特殊字符兼容。
- 保留原文复制和 Raw 内容，不对源文件做破坏性清洗。

验收：同一份 Markdown 在文件阅读和对话中排版语义一致；标题不显示 `#`，粗体不显示 `**`，表格不显示分隔竖线；恶意 HTML 不执行。

### Task 3：双向链接

- 解析 `[[相对路径]]`、`[[相对路径|显示名称]]` 和必要的文件名短写法。
- 点击正向链接打开目标文件。
- 目标文件显示自动生成的引用来源列表；点击来源回到对应文件。
- 不存在的目标只提示，不自动写文件。

验收：用“王小二”角色和第001至第005集建立真实样例；从集数跳到人物小传，再从引用列表返回集数，冷启动后仍可用。

### Task 4：Markdown 编辑与保存

- 编辑器提供 Markdown 语法高亮、双链可识别和稳定光标。
- 保存使用 `ProjectFileService` 和 revision 冲突合同。
- Web 使用浏览器项目文件系统，Desktop/Mobile 使用各自项目目录。

验收：编辑标题、双链、表格和正文后保存；刷新、杀进程、重新打开后内容一致；制造版本冲突时不静默覆盖。

### Task 5：模型分组与费用

- 按家族分组 GPT Image、Banana 和其他媒体模型。
- 清理 `runninghub/api/rh-gpt2-official` 等已下线旧引用；以当前真实模型 ID为准。
- 显示真实费用数字和计费单位，不显示人民币符号。
- 模型不可用或价格缺失时明确标记，不允许选择后才失败。

验收：模型分组顺序稳定；选择的具体模型 ID 与请求一致；费用单位与管理员扣费记录一致；失效模型不出现在 Web、Mac、iPhone。Android 恢复后补做模型列表验收。

### Task 6：复制和界面收口

- 将复制操作压缩为紧凑图标按钮或消息顶部操作，不独占整行。
- 保持复制内容为原始 Markdown 文本。

验收：桌面和移动端消息密度提高；复制成功提示不改变布局；长消息、代码块和表格复制内容完整。

### Task 7：跨端回归和发布

- Web、Mac Apple Silicon、Mac Intel、Windows、iPhone、iPad 各完成核心矩阵；Android 阶段恢复后复用本 SDD 并补做 Android 核心矩阵，不阻塞本轮共享修复收口。
- 记录构建、安装、启动、阅读、编辑、保存、双链、模型选择和费用显示结果。
- 修复完成后更新本文件和 `hot.md`，再发布对应版本。

验收：当前 Web、Mac、Windows、iPhone、iPad 全部通过后，本轮共享修复才能标记完成；不能用单个平台或“构建成功”代替跨端证据。Android 作为恢复后的追加验收，不得据此提前宣称 Android 完成。

## 5. 2026-07-29 实施记录

状态：共享代码修复已完成，平台矩阵未完成，因此本 SDD **未完成**，Android 阶段继续暂停。

| 任务 | 根因与最小修改 | 修改文件 | 自动验证 | 真实平台结果 |
| --- | --- | --- | --- | --- |
| Task 0 | `main` 缺少三笔纯文档提交；只同步 `13213c19`、`0f3e0d5b`、`8dce98e8`，未合并 Android 代码 | 本 SDD、独立 App SDD | 基线 focused、TypeScript、Web/Desktop quick build 通过 | 不适用 |
| Task 1 | 自动同步后的 `refreshProjectView -> openResource` 会关闭 Markdown 预览；删除打开项目、窗口 focus 和创建空间时的自动联网/刷新 | `projectTextSync.ts`、`MemoryWorkbench.vue` | 同步与工作台回归通过 | Web 预览保持；iPhone/iPad 待本轮真机 |
| Task 1.5 | 根因是记忆工作台把连续 Markdown 对话套进绝对定位虚拟列表，流式正文增长必须依赖估算高度、手工测量和滚动补偿；临时行、落盘替换和通用滚动观察器之间的合同反复失配。删除记忆工作台虚拟列表和全部手工测高，已保存消息与 `streamingText` 使用同一普通文档流；工具调用只保留当前运行状态，真实文件修改继续走既有文件工具；Raw 写入后立即替换临时行，完整 Markdown 仅在结束后渲染 | `MemoryWorkbench.vue`、`ChatScrollNav.vue`、`memoryWorkbench.test.ts` | 专项 `39/39`、完整 focused `1387/1387`、TypeScript、Desktop quick build、正式 Mac 构建与产物审计通过；合同覆盖普通文档流、单次 Raw 落盘、工具状态不持久化和粘性滚动 | Mac 新包已生成，待用户真实长回复验收；移动端手势待真机 |
| Task 1.5.1 | 记忆工作台只消费工具开始事件，工具结束后仍显示“正在使用工具”；转发现有开始/结束事件，并在输入框上方显示真实阶段、最近步骤和耗时，不保存工具状态；最终 Raw 打开后再清除流式正文，避免首次回复闪空 | `memoryChat.ts`、`MemoryWorkbench.vue`、`memoryWorkbench.test.ts` | 专项 `38/38`、完整前端 focused `1396 passed, 8 skipped`、TypeScript、Desktop quick build 与产物审计通过；覆盖工具结束切换等待模型、完成/停止/失败收口、OpenCode 边界、Raw 单次落盘和最终正文无空窗合同 | 待正式签名包真机 |
| Task 1.5.2 | 保留自然文档流，只给每条记忆消息复用主聊天已有的 `content-visibility: auto`；浏览器跳过屏外布局与绘制，不恢复虚拟列表或自行计算可视区 | `MemoryWorkbench.vue`、`memoryWorkbench.test.ts` | 记忆工作台定向 `45/45`、TypeScript、Wiki validate 与 `git diff --check` 通过 | 当前 Desktop App 待用户长对话体感；Web/iPhone 长对话降温矩阵待补 |
| Task 1.6 | 文件监听和 `open()` 直接触发 `syncCycle()`；删除自动网络动作，只保留 pending 标记和手动上传/同步 | `projectTextSync.ts` | 新增“打开/编辑不上传，手动同步才上传”测试 | Web 本地创建/保存无自动同步；其余平台待真机 |
| Task 2 | 记忆对话和文件预览绕过共享安全 Markdown 策略；统一复用 `renderMessageMarkdown` | `MemoryWorkbench.vue` | 既有 XSS、链接、代码、表格测试与工作台测试通过 | Web 标题、表格真实渲染通过 |
| Task 3 | 缺少 WikiLink 解析与反向来源投影；从当前项目 Markdown 文件按需扫描，不建索引库 | `markdownLinks.ts`、对应测试、`MemoryWorkbench.vue` | 正向、别名、相对路径、反向引用测试通过 | Web `[[人物小传]]` 点击与缺失提示通过；真实双文件往返待矩阵 |
| Task 4 | Markdown 只有阅读态；在现有预览内加原文 textarea/高亮层，并用 `writeText(..., revision)` 保存 | `MemoryWorkbench.vue` | 保存 revision、冲突保留草稿合同测试通过 | Web 编辑、保存、重新渲染通过；重启和跨设备冲突待矩阵 |
| Task 5 | 下线 `rh-gpt2-official` 仍在能力表、注册表和默认回退；删除旧渠道绑定，默认使用模型级 ID `gpt-image-2`，请求仍交给 NewAPI 选择可用渠道。前端不再硬编码 T8 价格；价格未从 NewAPI 返回时显示“费用以实际扣费为准” | 模型注册表、能力表、`mediaPlan.ts`、`CreationPanel.vue`、`MediaPlanCard.vue` 及测试 | 下线 ID 不可解析、模型级默认 ID、家族、未知费用提示测试通过 | Web 模型 UI 可启动；真实扣费记录核对待管理员/平台矩阵 |
| Task 6 | 复制按钮在正文后独占一行；改为消息右上角 26px 图标，复制函数仍读取原始 Markdown | `MemoryWorkbench.vue` 及测试 | 原文复制和紧凑布局合同通过 | Web 布局通过；移动端密度待真机 |
| Task 7 | 共享实现完成后再逐平台验收 | 本记录、`hot.md` | focused：Rust `400 passed, 0 failed, 1 ignored`；TypeScript 通过；Web/Desktop/iOS quick build 通过 | Web：创建项目、编辑保存、标题/表格渲染、双链缺失提示通过。Mac、Windows、iPhone、iPad 本轮完整功能矩阵未完成；Android 未开始 |

构建说明：Vite 仍有既有大 chunk 和 ineffective dynamic import 警告，不影响本轮构建结果。Web 与 Desktop 构建必须串行执行；并行执行会竞争同一 `dist`，曾导致一次 Web 审计误报缺少 `404.html`/`_headers`，不作为产品失败证据。

### 5.1 Markdown 视觉与创作面板审计补充（2026-07-29）

| 项目 | 根因与最小修改 | 修改文件 | 自动验证 | 真实平台结果 |
| --- | --- | --- | --- | --- |
| Markdown 统一视觉 | 消息组件和记忆工作台各自维护局部 Markdown/代码块 CSS，且复制图标使用彩色 Emoji；新增全局样式入口，阅读/对话使用 `.markdown-body`，编辑层与代码块共用 `--hl-*` 变量，复制按钮改为单色符号并接入记忆工作台事件 | `src/styles/markdown.css`、`main.ts`、`MessageBubble.vue`、`MemoryWorkbench.vue`、`markdownDisplayPolicy.ts`、`streamingTextRenderer.ts`、`highlight-theme.css` | focused 1387/1387；TypeScript；桌面产物审计 | Mac 新包已生成；用户待安装测试 |
| 创作面板分组 | 仅识别 `gpt-image-*` 导致 `rh-gpt2-*` 被放入其他模型；按价格表增加 GPT Image、Banana、Seedance Mini/Fast/2、Veo、Sora2、Grok、LTX、Suno、3D、AI 应用等家族分组，仍按原始 `model` 请求 | `creationModelRegistry.ts`、`CreationPanel.vue`、对应测试 | 分组/价格测试通过；全部模型注册表计划校验通过 | Mac 待用户核对菜单与真实渠道可用性 |
| 价格一致性 | 价格表视频章节中 `rh-video-v31-fast` 的 `2/次` 与“视频按秒”矛盾；按统一规则改为 `2/秒`，注册表数值保持不变 | `docs/wiki/运维/模型价格表-2026-07-29.md` | `displayModelPrice` 输出 `2/秒` | 尚未做真实扣费核对 |

Mac 构建证据：`pnpm run tauri:build` 成功，生成 Apple Silicon `.app` 与 `.dmg`。构建后发现 `fix-macos-app.mjs` 会把 Tauri 的 Developer ID 签名覆盖成 ad-hoc；最小修复为复用 `tauri.conf.json` 现有签名身份并保留 hardened runtime/entitlements，不新增签名配置。最终 APP 与 DMG 均使用 `Developer ID Application: yunlong liu (RXD4L9387J)` 签名；APP `codesign --verify --deep --strict` 与 DMG `codesign --verify` 均通过，最终 APP `TeamIdentifier=RXD4L9387J`。DMG SHA-256：`5483db8514c1c3004fdff000762f14febf619d2a38315495e13f57e67086b825`。未配置 Apple 公证凭据，因此不宣称已公证或发布。版本仍为 `2.1.0`。

### 5.2 v2.1.1 发布与真实验收补充（2026-07-29）

- 用户已在最新 Mac 开发包真实发送长回复，确认流式文字持续显示、视口停在当前回复、结束后不跳回旧消息，Task 1.5 的 Mac 用户功能验收通过；这项证据不是单纯构建或安装成功。
- 版本已统一为 `2.1.1`；`b0655db8`、`40b634c4` 已推送 `main`。Web 正式产物重新构建并通过审计，Cloudflare Production 部署成功，部署证据为 `https://55beb256.jiucaihezi.pages.dev`。
- annotated tag `v2.1.1` 已推送；GitHub Actions `30466581443` 已成功完成 Mac Apple Silicon、Mac Intel、Windows x64 构建。正式 Release 已包含两种 Mac DMG、两种 Mac App 压缩包和 Windows x64 便携包；`https://api.jiucaihezi.studio/updates/latest.json` 已返回 `2.1.1` 及三个桌面平台下载地址。这里证明发布产物可用，不代替 Windows/Intel Mac 的用户功能验收。
- 发布仍使用既有合同：`push main -> Web Production -> push version tag -> GitHub Actions 自动上传并生成 latest.json`。本机 GitHub 凭据过期只需恢复官方登录，不构成新的发布步骤。
- iPhone/iPad 正式开发与完整回归仍按既定节奏放在 Web/桌面发布之后；Android 继续暂停。

### 5.3 Veo 3.1 远程结果待修诊断（2026-07-29，仅分析）

真实现象：Veo 3.1 生成成功后，任务历史只显示远程 `https://api.jiucaihezi.studio/v1/videos/{task}/content` 和“预览”；没有“放到画布”“打开文件夹”。预览播放器黑屏，下载会显示 New API“无效的令牌”。用户把结果地址放到外部浏览器后可以取得视频，证明上游生成结果和 MP4 本体没有损坏。

根因链路：

1. `CreationPanel` 只有在任务存在 `projectPath` 或 `assetUri` 时才显示“放到画布”，只有本地 `assetUri` 才显示“打开文件夹”；只有远程 `resultUrl` 时按设计只显示“预览”。
2. Veo 的 `/v1/videos/{task}/content` 属于韭菜盒子 API 同源受保护结果，读取时需要当前 New API Bearer Token。
3. Web 的 `fetchCreationMediaBlob()` 已按同源规则附加 Token，并明确禁止把 Token 发往第三方 CDN；Desktop 的 `http_download_base64` 请求结构只有 `url` 和 `timeout_secs`，下载时没有请求头。
4. Desktop 生成结束后的项目落盘因此收到未认证响应，任务无法产生 `projectPath/assetUri`，退化为 remote-only 结果。
5. remote-only 预览把远程 URL 直接交给 `<video>`，下载把同一 URL 直接交给 `<a download>`；两者都不能附加 Bearer Token，所以分别表现为黑屏和“无效的令牌”。

现有测试只验证 Web 同源下载会附加 Token；Desktop 测试桩对任意 `http_download_base64` 都直接返回 200，没有断言同源认证头，因此发布门禁没有覆盖这条真实合同。

最小修复边界（本轮尚未实施）：只补齐共享下载命令的可选请求头，并在韭菜盒子 API 同源结果上复用当前 Token；第三方 CDN 仍不带 Token。生成完成后优先把视频一次写入当前项目，预览、下载和放到画布继续消费现有项目文件，不增加 Veo 专用分支、第二套下载器或远程媒体存储。

### 5.4 模型请求中断恢复（2026-08-09）

- 根因：流开始前返回 `524` 时，当前模型请求没有重试；最终失败时用户消息、部分正文和已发生工具步骤只在内存，Raw 没有恢复点。
- 最小修改：当前模型请求对 `502/503/504/524`、浏览器网络错误和 Tauri/reqwest 发送错误退避重试两次；重试耗尽后只把明确的请求/流中断写为 Raw 恢复点。复用现有 generation 阻止旧任务覆盖新项目状态，发送期间锁定编辑，并以 `userTurn.id` 保证 Raw 追加幂等。
- 自动验证：覆盖 Tauri 网络拒绝后成功、重试耗尽、退避取消、`401` 不重试和重复追加同一 `userTurn.id` 的可执行测试；界面合同检查覆盖 generation 前后保护与编辑锁。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和 `git diff --check` 通过。
- 未验证：尚未在 Web、Desktop、Mobile 的真实 NewAPI 链路主动制造 `524`；不宣称生产中转、Cloudflare 或三端真实重连已经验收。

### 5.5 模型上下文、输出预算与重试策略收口（2026-08-15）

- 根因：旧实现同时存在模型族猜测、未知云端模型默认 `128K`、每条历史消息固定截取 `16,000` 字符和固定 `4,096` 输出；这些限制会在模型真实容量尚未用满时提前丢失上下文或截断长文。
- 最小修改：云端模型统一兜底 `1,000,000` 输入 token 与 `128,000` 输出 token；本地 Ollama/MLX 保持 `32,768/4,096` 保守值。Gateway 返回的 `contextWindow`、`maxOutputTokens` 优先于兜底值。
- 上下文按 `tokenx` 估算真实消息和工具定义 token，预算为 `contextWindow - (maxOutputTokens + 32,768)`；从最新完整轮次向前保留，不再按字符截断单条消息。装不下的较早轮次仍完整保存在 Raw，记忆模式可按需读取 Raw/Wiki/项目事实页。
- 每次请求动态发送 `min(modelMaxOutput, contextWindow - requestInputTokens)` 的 `max_tokens`；达到 `finish_reason=length` 后最多续写 3 次，续写要求从末尾继续，已生成正文保留在同一结果中。
- 上下文确实淘汰较早完整轮次时只显示一次提示，告知用户 Raw 仍完整保存，可按需填充 Wiki 或开始新对话；不自动摘要、不自动写 Wiki、不增加第二套记忆数据库。
- 同一轮的旧回调、快速切换会话、异步资源解析和模型目录刷新均受 generation/selection 保护；停止后工具执行链收到 `AbortSignal`，不再继续后续工具或写盘。
- 重试策略保持当前产品合同：请求建立失败或 `502/503/504/524` 最多重试两次，退避 `2 秒、4 秒`；流开始后中断最多做现有一次语义续传；工具调用不自动重放；输出上限续写最多三次。不上调到 Codex 的五次，也不叠加五次流重连、客户端 `429` 策略或固定 300 秒总超时，避免重复请求、重复副作用和误杀合法长输出。
- 自动验证：聚焦测试 `1047/1047`、`vue-tsc` 和 `git diff --check` 通过。真实 NewAPI/Cloudflare 故障注入、所有平台人工长文矩阵仍未执行，不登记为生产链路验收。

## 6. 不做事项

- 不新建 Markdown 数据库、向量库或隐藏摘要。
- 不把 Obsidian 插件系统搬入项目。
- 不把知识图谱和媒体画布强行合并为同一业务合同。
- 不因为 Markdown 改造重写 ProjectFileService、同步服务或对话存储。
- 不把费用配置复制成另一份前端真源。

## 7. 完成标准

用户可以在任一正式平台：

1. 稳定打开 Markdown 文件并阅读漂亮排版。
2. 在文件和对话中看到一致的 Markdown 渲染。
3. 点击双链跳转到目标文件，并查看谁引用了当前文件。
4. 编辑并保存 Markdown，重启后内容不丢失。
5. 在创作面板按模型家族选择具体模型，并看到可信的数字/单位费用。
6. 复制消息时获得完整原始 Markdown。

只有以上闭环和跨端证据全部完成，本 SDD 才能标记为已完成。

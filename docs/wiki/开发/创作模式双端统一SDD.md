# 创作模式双端统一 SDD

> 日期：2026-07-23
> 状态：方案确认，待执行
> 范围：Web / Desktop 的道模式与创模式直连家族
> 基线：道模式真实视频验收成功，提交 `347d38f3`
> 核心原则：模型原生能力优先；道是纯直连，创是纯直连加 Skill 渐进能力

## 1. 一句话定义

```text
道模式 = 当前模型直连
创模式 = 同一条当前模型直连 + Skill 按需加载 + Skill 加载后的产品工具
文模式 = OpenCode Plan
武模式 = OpenCode Build
```

道和创是一套直连产品的两个档位，不是两个聊天产品。两者共用会话、消息、附件、请求、错误、取消和 UI；创模式只增加 Skill 与工具循环。

文武继续代码级对齐 OpenCode。创模式可以复用韭菜盒子已经翻译完成的 OpenCode 产品 UI，但不得伪装成 OpenCode Agent，不得创建 OpenCode session，也不得改写 OpenCode 核心链路。

## 2. 已验证事实

### 2.1 道模式成功基线

真实 Desktop 验收已经证明以下链路成立：

```text
用户文字 + 原始附件
  -> directMessageBuilder
  -> New API 官方内容协议
  -> 当前 Provider/K 的当前模型
  -> 模型直接回复或返回真实能力错误
```

附件协议以 [[开发/道创模式NewAPI原生多媒体附件协议SDD]] 为准：

- 图片使用 `image_url`；
- 视频使用 `video_url`；
- 音频使用 `input_audio`；
- PDF 和普通文件使用 `file`；
- 不自动换模型，不自动使用本地工具，不修改 New API。

创模式必须直接复用这条链路，不能另写一套附件判断、Base64 包装或 Provider 发送器。

### 2.2 当前产品已经共用的部分

现行代码已经共用：

- `ChatPanel` 外壳和输入区；
- `FileUploader` 与附件预览；
- `MessageBubble`、Markdown、复制、朗读、编辑和引用操作；
- 媒体任务气泡、审批条和错误展示；
- `ChatMessage` 可见消息结构；
- `directMessageBuilder`、直连 HTTP/SSE、错误清洗和取消信号。

因此本任务不是重做 UI，而是删除创模式的重复会话和重复发送边界，让道创真正使用同一公共层。

### 2.3 当前重复点

当前创模式仍使用独立 `creativeSessionStore` 和 `creative_*` 会话；道模式使用普通 `sessionStore`。道切创时会复制一次 transcript 并创建新会话。

这会造成：

- 同一段对话出现两个会话身份；
- 模式切换需要复制消息；
- 历史、附件和运行状态容易分叉；
- 创模式继续长出专属 UI 与专属修复。

本 SDD 只消除这条重复，不建立更大的“四模式总会话平台”。

## 3. 目标架构

```text
                    产品公共 UI
  会话列表 / 输入框 / 附件 / MessageBubble / 工具卡片 / 审批条
                             |
                    道创公共直连会话
               sessionStore + ChatMessage + 每轮 mode
                             |
                    公共直连请求底座
       历史 + 原始附件 + Provider/K + HTTP/SSE + 错误 + 取消
                    /                    \
             道模式                      创模式
          tools 为空               首轮只开放 skill(name)
          单次模型请求             Skill 加载后开放现有产品工具
                                      |
                          模型请求工具 -> 执行 -> 结果回模型
```

文武模式不进入上图的直连运行时。文武仍由 OpenCode session、官方 parts、权限、压缩和事件流负责。

## 4. 道创公共合同

### 4.1 单一会话

- 道和创共用现有 `sessionStore`，不新增 `directSessionStore`。
- 同一个会话可以逐轮切换道或创；模式是每轮元数据，不是会话种类。
- 道切创、创切道只改变下一轮发送策略，不复制 transcript，不创建新会话。
- 新创模式会话不再创建 `creative_*` ID。
- 本轮不迁移或删除旧 `creative_*` 历史；旧历史继续只读可见，迁移另行决定。

### 4.2 单一发送底座

道和创必须共用：

- 同一历史选择；
- 同一原始附件解析和 New API 协议；
- 同一 Provider/K 与模型选择；
- 同一请求体大小预算；
- 同一 HTTP/SSE 传输；
- 同一取消和错误提示；
- 同一失败后附件保留规则。

差异只能通过参数表达：

```text
道：tools = []，skillCatalog = []，单次请求
创：tools 初始只有 skill(name)，skillCatalog = 有效 Skill 名称/描述目录
```

禁止在 `ChatPanel`、Web 和 Desktop 各复制一套请求拼装。

## 5. 创模式渐进合同

### 5.1 首轮

创模式首轮给模型的原始任务与道模式相同：当前对话文字和原始附件必须先进入当前模型。

创模式额外只提供：

1. 有效 Skill 的名称和简短描述目录；
2. 唯一的 `skill(name)` 工具定义。

首轮不得提供 `read/glob/grep/write/edit/terminal/wiki/MCP` 的完整 schema，不得注入 Skill 正文，不得读取 Wiki 或项目目录。

模型能凭原生能力回答时直接结束。工具的存在不能拦截图片、视频、音频、PDF 或普通文件原件。

### 5.2 Skill 加载后

当模型调用 `skill(name)`：

```text
模型请求 skill(name)
  -> 从同一有效 Skill 注册表加载精确 SKILL.md
  -> Skill 内容作为工具结果回到同一模型
  -> 从下一次模型请求开始开放现有产品工具集合
  -> 模型按 Skill 指令决定是否调用工具
```

本轮不新增“每个 Skill 一套工具 ACL”或解析 Skill 自然语言推测权限。现有 Skill 没有统一工具声明标准，强行设计会增加维护成本。

第一版采用最小规则：

- 未加载任何 Skill：只有 `skill(name)`；
- 已加载 Skill：开放现有创模式工具集合；
- 写入、终端和其他有副作用工具继续经过现有审批；
- 连接的 MCP 只在 Skill 已加载且用户已启用时进入工具集合；
- 每轮结束后，下一轮重新从最小入口开始，不永久携带无关工具 schema。

以后只有出现真实的 Skill 工具隔离需求，才单独设计声明标准；不在本任务预埋。

### 5.3 明确选中 Skill

用户在 UI 明确选中 Skill 时，仍然只把精确名称交给模型，并要求先调用 `skill(name)`。不得因为用户选中就把完整 `SKILL.md` 塞进 system prompt。

选择器、名称/描述目录和 `skill(name)` 读取必须使用同一有效注册表：

- Web：`public/skills`；
- Desktop：内置 Skill 优先，本机注册 Skill 补充；
- 同名时只保留有效版本，不能出现 UI 可选但模型加载不到。

### 5.4 工具循环

创模式保持唯一事件顺序：

```text
模型请求工具
  -> tool_execution_start
  -> 执行或审批
  -> tool_execution_end
  -> 工具结果回到同一模型
  -> 模型继续或给出最终回复
```

复用现有 `directEngine` 和已统一的工具生命周期事件，不新增事件总线，不保存隐藏思维链，不把工具结果伪装成模型原生理解。

## 6. OpenCode 可以借什么

### 6.1 可以直接复用

这些是韭菜盒子的产品展示层，不属于 OpenCode runtime：

- `ChatPanel` 页面结构、滚动和虚拟列表；
- 输入框、模式选择、模型选择和附件入口；
- `MessageBubble` 的用户消息、助手正文和操作栏；
- Markdown、代码块、图片预览、文件标签和媒体气泡；
- 工具执行折叠卡片、错误卡片和审批条；
- OpenCode UI 翻译中已经验证的尺寸、状态和交互规则。

能通过普通 props 使用的组件直接共用，不复制 `CreativeMessageBubble` 或第二套 CSS。

### 6.2 不能借用

这些是 OpenCode 核心事实，只供文武模式使用：

- OpenCode sidecar / server；
- OpenCode SDK session 与 `ses_*`；
- `openCodeSyncStore` 和官方事件 reducer；
- OpenCode permission / question API；
- compaction、snapshot、diff、todo 和 subtask 语义；
- OpenCode Provider、Agent、工具和附件合同。

创模式工具事件不得伪装成 OpenCode parts。公共 UI 接收直连工具展示数据；`OpenCodePartList` 继续只渲染真实 OpenCode parts。

## 7. Web / Desktop

双端使用同一运行合同，平台差异只留在现有适配器：

| 边界 | Web | Desktop |
|---|---|---|
| 直连请求 | 公共 HTTP/SSE | 同一请求合同，Tauri 负责需要的传输 |
| 项目文件 | IndexedDB / OPFS | Tauri 文件 IPC |
| Skill 来源 | 内置注册表 | 内置优先 + 本机注册表 |
| 终端 | 不提供 | 现有受控终端 + 审批 |
| 会话/UI | 公共 `sessionStore` / `ChatMessage` / 组件 | 同左 |

不得以平台差异为理由复制模型循环、附件协议、错误处理或 Skill 加载逻辑。

## 8. 精准实施范围

1. 抽出道创公共直连发送入口，参数只区分纯直连与 Skill 渐进模式。
2. 让创模式改用 `sessionStore`，删除新会话对 `creativeSessionStore` 的依赖和道创 transcript 复制。
3. 创模式首轮工具缩减为 `skill(name)`；Skill 成功加载后才开放现有产品工具。
4. Web 与 Desktop 调用同一阶段化工具定义函数。
5. 继续使用 `ChatPanel`、`MessageBubble`、现有工具卡片和审批条，不改视觉结构。
6. 新流程稳定后，删除只服务于新创会话的死引用；旧 `creative_*` 历史读取保留。

不在本任务修改文武 OpenCode、工作台、CreationPanel、媒体任务引擎、Wiki 脚本或 New API。

## 9. 明确不做

- 不建立道创文武四模式总会话平台。
- 不把创模式迁入 OpenCode runtime。
- 不把直连工具事件伪装成 OpenCode parts。
- 不新增第二套聊天 UI、第二套消息数据库或第二套附件协议。
- 不自动查询 Wiki、扫描项目、切换模型或调用本地媒体工具。
- 不首轮全量注入工具 schema、Skill 正文、Wiki 内容或项目目录。
- 不在本轮迁移或删除旧用户历史。
- 不顺带重构工作台、文件树、编辑区或媒体面板。

## 10. 验收标准

### 自动验收

1. 道模式仍是一次当前模型请求，`tools` 为空。
2. 创模式普通问答只发送当前文字、历史、原件、Skill 目录和 `skill(name)`，没有其他工具 schema。
3. 模型不调用 Skill 时，创模式不会执行工具或读取项目。
4. 模型调用 Skill 后，下一次请求才出现现有产品工具，并保持“请求 -> 开始 -> 结束 -> 结果回模型”事件顺序。
5. 道和创共用 `sessionStore`；互相切换不创建新会话、不复制 transcript。
6. 道和创共用 `directMessageBuilder`，图片、视频、音频和文件协议不分叉。
7. Web 与 Desktop 共用模型循环；差异只发生在文件、Skill 和终端适配器。
8. 文武仍使用真实 OpenCode session、parts 和 runtime，现有回归测试通过。

### 人工验收

| 场景 | 预期 |
|---|---|
| 道模式发送“你好” | 当前模型直接回复，无 Skill、工具或 Wiki |
| 道模式上传 MP4 | 保持已验证的原生视频直连能力 |
| 道切创继续聊天 | 原会话原地继续，不复制、不新建会话 |
| 创模式普通问答 | 直接回复，不加载 Skill，不显示工具步骤 |
| 创模式上传视频 | 原件先进入当前模型，Skill 不成为门槛 |
| 创模式要求查询 Wiki | 模型先加载对应 Wiki Skill，再获得产品工具并执行 |
| 创模式明确选择 Skill | 先执行精确 `skill(name)`，不预注入正文 |
| 创切道继续聊天 | 保留可见上下文；下一轮恢复纯直连，无工具 |
| 创模式执行终端/写入 | 使用现有审批条和工具卡片，不启动 OpenCode |
| 文武模式 | OpenCode 行为、会话、Diff、Todo 和权限不变化 |

## 11. 成功标准

完成后，代码结构应能用一句话解释：

```text
道和创共用同一条直连管线；创只是在道的基础上，多了一个按需加载 Skill、再调用产品工具的循环。
```

如果实现需要新增总会话平台、OpenCode 兼容层、第二套 UI 或每 Skill 权限系统，说明偏离本 SDD，应停止并重新简化。

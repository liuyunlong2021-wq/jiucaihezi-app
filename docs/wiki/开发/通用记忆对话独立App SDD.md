# 通用记忆对话工作台 SDD

> 日期：2026-07-24
> 状态：第一阶段 Web 本地实现完成，待生产发布与真实模型/媒体验收
> 首发目标：<https://jiucaihezi.studio>
> 依据：`AGENTS.md`、[[架构/产品架构]]、[[开发/Wiki四Skill产品化升级SDD]]、[[开发/文件系统/索引]]、[[开发/文件系统/文件树一期资源身份与文件安全SDD]]、[[开发/文件系统/Web云端项目Wiki媒体同步与APP升级SDD]]、[[开发/创模式MCP工具接入SDD]]、[[开发/韭菜盒子原生媒体编排能力SDD]]

## 1. 决断

先把现有韭菜盒子换成一个极简的通用记忆对话工作台：

```text
项目文件树 + 中央内容区 + 隐藏设置
```

用户只在文件树里选择内容：

```text
对话 Raw       -> 中央区显示完整聊天记录和输入框
Markdown/文本  -> 中央区显示文档阅读器
图片/视频/音频 -> 中央区显示预览或播放器
其他文件       -> 中央区显示安全打开/下载动作
```

文件树就是唯一导航，也是对话选择器；不再增加项目选择器、对话下拉菜单、模式选择器、编辑区、创作面板或第三栏设置区。

产品能力仍然完整：登录、模型、Skill 仓库、MCP、附件、Wiki 读写和对话内图片/视频/音频生成都保留，只把设置收进按钮，把媒体生成收进对话。

## 2. 为什么这是正确边界

### 2.1 文件树可以代替对话选择器

每个对话本来就是 `.raw/对话记录/` 下的一个真实文件。再次维护“对话列表”只会产生第二份索引和两套选中状态。文件树已经能完成创建、选择、重命名、删除和恢复，因此应直接成为对话导航。

### 2.2 所有文件都能在中央区打开，但不能都按聊天显示

“中央区”是统一容器，不是统一渲染器。点击普通 Markdown 时显示文档正文；点击图片时显示图片；只有对话 Raw 才显示聊天气泡和输入框。

这样同时满足：

- 用户点任何可支持文件都能看到内容；
- 普通文档不会被误认为聊天记录；
- 不需要第二个对话选择器；
- 不需要重新引入独立编辑区或创作面板。

### 2.3 资源判断只能有一个入口

现有 `openProjectResource()` 已经统一处理文档、媒体、画布和二进制。实现时只在这个共享路由增加 `conversation` 结果，不允许文件树、聊天区和移动端分别复制路径判断。

```text
ProjectFileTree
  -> openProjectResource(resource)
  -> conversation | document | media | binary
  -> CentralContentHost 切换对应视图
```

## 3. 产品边界

### 3.1 用户可以做什么

- 创建、导入或打开一个项目，并在下次启动恢复最近项目。
- 在文件树中浏览项目的 Raw、Wiki、媒体和其他文件。
- 新建任意名称的对话，点击任意对话继续聊天。
- 点击 Markdown、文本、图片、视频和音频直接查看。
- 选择模型和一个可选专业 Skill。
- 上传当前模型支持的附件。
- 每轮由模型根据当前对话自主查询 Wiki 后回答。
- 明确同意后，把确认内容写入指定或确认的 Wiki 路径。
- 用自然语言生成图片、视频或音频，并在对话内确认费用、查看进度和结果。
- 从设置按钮登录、配置 Provider、管理 Skill、连接 MCP 和查看通用设置。

### 3.2 明确不做

- 不显示文、武、创、道四种模式。
- 不使用 OpenCode Agent、`ses_*`、sidecar 或 OpenCode 会话数据库。
- 不建立项目选择器或对话选择器。
- 不把所有文件渲染成聊天消息。
- 不建立向量库、隐藏摘要、第二套记忆或跨对话隐式拼接。
- 不自动把讨论、猜测或草稿写入 Wiki。
- 不加载 `CreationPanel`、画布、编辑区、画廊或媒体工作台。
- 不新增媒体 API、任务 Store、轮询器或音频专用流程。
- V1 不做云同步、跨设备自动同步或专用上下文管理。
- 当前阶段不创建新域名、Bundle ID、Deep Link、签名身份或更新通道。

## 4. 唯一真源

| 内容 | 唯一真源 |
| --- | --- |
| 完整对话 | 当前项目 `.raw/对话记录/*.md` |
| 已确认知识 | 当前项目现有 `wiki/` 或 `docs/wiki/` |
| 当前打开资源 | 页面存活期间的 UI 状态；重启后从最近项目和文件树恢复 |
| 项目文件 | `ProjectFileService` 背后的当前平台存储 |
| 模型与 Provider | 现有公共模型/Provider 配置 |
| 产品内置 Skill | `public/skills/` 与现有只读 loader；不进入仓库或选择器 |
| 用户已安装 Skill | Web `agentStore` 的 `jc_web_skills_v1`；仓库与选择器共用同一列表 |
| MCP | 现有 `mcpStore`、`mcpClient` 与安全凭据存储 |
| 生成媒体 | 当前项目 `jc-media/` |
| 在途媒体任务 | 现有 `mediaTaskStore` |

App 不再把同一份对话正文保存进 conversations/messages 数据库。清除页面状态后，只要项目目录还在，就必须能从 Raw 恢复全部对话，从 Wiki 恢复确认知识，从 `jc-media/` 恢复已生成媒体。

## 5. 项目文件合同

### 5.1 最小骨架

```text
项目根/
├── .raw/
│   └── 对话记录/
│       ├── chat_01J0A7F3.md
│       └── chat_01J0B2K9.md
├── jc-media/                 # 首次生成媒体后按需创建
│   ├── images/
│   ├── videos/
│   └── audios/
└── wiki/                     # 已有 docs/wiki/ 时接管原位置
    ├── CLAUDE.md
    ├── index.md
    ├── hot.md
    ├── log.md
    └── 来源索引.md
```

新建通用 Wiki 不预设“资料、主题、参考”等业务目录。用户需要什么，模型在用户确认后创建什么。已有 Wiki 只接管，不迁移、不删除、不覆盖。

### 5.2 对话身份

对话文件使用稳定 ID 文件名，首个 H1 是用户看到的标题：

```markdown
# 聊聊历史

<!-- jc:conversation id="chat_01J0B2K9" created-at="2026-07-24T15:00:00+08:00" -->

<!-- jc:turn id="turn_01J0B31A" role="user" created-at="2026-07-24T15:01:00+08:00" -->
## 用户

秦朝为什么灭亡得这么快？
<!-- /jc:turn -->
```

一个文件只有同时满足以下两项才是对话：

1. 路径位于 `.raw/对话记录/`；
2. 文件内容含可解析的 `jc:conversation` 元数据标记。

普通 `.md` 文件不能只因扩展名相同就成为对话。路径正确但标记缺失、标记存在但路径错误，都按普通文档打开；不得猜测或自动改写。

### 5.3 Raw 边界

Raw 只追加用户可见内容：

- 用户输入和模型完整最终回复；
- 用户可见附件的项目相对路径、名称和类型；
- 已确认媒体计划及最终成功、失败或取消结果；
- 用户确认了哪项 Wiki 写入。

Raw 不保存系统提示词、隐藏推理、模型内部加载的产品 Skill 正文、Wiki 查询结果、工具参数、工具回执、流式片段、轮询快照、鉴权地址或附件二进制副本。用户明确要求创建并用于安装确认卡的 `jc-skill-install` 块属于用户可见回复，随该轮 Raw 保存。

## 6. 文件树与中央内容区

### 6.1 唯一导航

当前项目打开后，所有资源切换都由文件树触发。V1 不再放置项目下拉框或对话下拉框。

- 桌面和大屏：左侧文件树，右侧中央内容区。
- 手机：文件树放入抽屉，中央内容区占满屏幕。
- 设置：顶部账号/齿轮按钮打开抽屉或覆盖层；关闭后回到原资源。

文件树根部只保留必要的“新建对话”、新建文件/目录、导入/导出等文件动作。没有项目时，中央区显示创建或导入项目的空状态；它不是常驻项目选择器。

### 6.2 统一打开路由

| 路由结果 | 识别规则 | 中央区行为 |
| --- | --- | --- |
| `conversation` | `.raw/对话记录/` + 有效 `jc:conversation` | 完整聊天记录、模型/Skill、附件、输入框 |
| `document` | 可安全完整读取的 Markdown/文本 | 只读文档视图；Markdown 渲染，纯文本保留格式 |
| `media` | 图片、视频或音频 MIME/扩展名 | 图片预览、视频播放器或音频播放器 |
| `binary` | 其他格式、超大或含 NUL 的内容 | 文件信息与安全打开、另存为或下载 |

`.jccanvas` 在本产品没有画布承载面，按不支持的结构化文件处理，只提供安全操作，不加载创作面板。

### 6.3 对话在文件树中的显示

- 文件真实路径和稳定 ID 不变。
- `.raw/对话记录/` 下的有效对话行显示首个 H1，而不是 `chat_*.md`。
- 行的内部 key 仍是 `owner + path`，标题只是显示别名。
- 首次展开目录时读取标题并在内存缓存；资源变更后失效重读，不建立标题数据库。
- `.raw/对话记录/` 保持可见且容易到达，不隐藏成内部系统目录。

### 6.4 新建、重命名、删除与恢复

新建对话：

```text
点击“新建对话”
  -> ProjectFileService 创建稳定 ID Raw
  -> 写入 H1 和 jc:conversation 标记
  -> 文件树选中该文件
  -> 中央区进入空对话
```

首条消息可直接取首段文本作为标题，不调用额外模型。用户重命名对话时只修改首个 H1，不修改稳定文件名或 conversation ID。

删除仍走现有文件删除确认和 `ProjectFileService` 事件；当前对话被删除后回到空状态或打开剩余最近对话，不保留隐藏副本。刷新、重启或清除 UI 状态后，App 重新扫描 Raw 文件恢复对话；已经删除的 Raw 只能从用户自己的项目备份或导出恢复。

普通文档的重命名仍是文件路径重命名，不能套用“只改 H1”的对话规则。

## 7. 对话运行合同

### 7.1 正确时序

```text
用户点击发送
  -> App 把用户消息追加到当前 Raw
  -> App 读取当前对话 Raw
  -> 把当前对话和可用工具发送给模型
  -> 模型根据整段对话与最新消息调用 jc-cha-wiki
  -> 模型自主决定 Wiki 查询词、页面和深度
  -> 查询结果回到同一次工具循环
  -> 模型按需调用已选 Skill 或已连接 MCP
  -> 模型生成最终回答
  -> App 把完整最终回答追加到当前 Raw
```

App 不在模型之前猜关键词，不提前查询 Wiki，不把固定查询结果拼进请求。最新用户消息只出现一次。

用户要求修改当前回答时仍走同一链路：当前 Raw 全文和最新意见一起进入模型，模型再按实际需要查询 Wiki。

### 7.2 查询硬条件

每次正式回答前必须发生当前 Wiki 的真实查询。模型未查询或查询失败时，候选文本不作为正式助手回复写入 Raw；界面显示真实错误并允许用同一条用户消息重试。

模型选择器只展示已确认支持工具调用的模型。不支持工具调用的模型不能伪装成能完成本产品合同。

### 7.3 上下文

- Raw 永远保存当前对话完整原文。
- 每轮先读取当前 Raw，不创建隐藏摘要或第二套记忆。
- 请求沿用现有模型上下文装配；超出模型容量时只在请求边界保留最新完整 turns，不修改 Raw。
- 不阻止用户继续发送，也不增加专用“对话过长”流程。
- 跨对话知识只通过 Wiki 查询取得，不自动拼入其他对话。
- Provider 返回容量错误时如实显示，不伪造回答，不写 assistant Raw。

## 8. Wiki 与 Skill

### 8.1 系统 Skill

| 动作 | 自动使用 |
| --- | --- |
| 新建或接管 Wiki | `jc-everything-wiki` |
| 每轮回答前查询 | `jc-cha-wiki` |
| 用户确认写入新知识 | `jc-raw-wiki` |
| 用户确认修正错误 | `jc-xiu-wiki` |
| 用户要求巡检 | `jc-jian-wiki` |

这些系统 Skill 与 `skill-creator`、`jc-new-user-guide` 等产品能力继续放在 `public/skills/`，由产品或模型按动作调用，不进入 Skill 仓库和 Skill 选择器。`public/skills/index.json` 只服务内部路由，不再作为用户 Skill 列表。

### 8.2 用户 Skill

Skill 仓库和 `SkillPickerBar` 必须读取 `agentStore.getCustomSkills()` 的同一份结果：仓库里有什么，选择器里就有什么；新增、编辑和删除后两处立即同步。两处都不读取或展示 `public/skills/index.json`。

Web 用户 Skill 写入浏览器可写存储 `jc_web_skills_v1`。不得把 `public/zijian/skills/` 设计成用户安装真源，因为 `public/` 在发布后是只读静态资源，浏览器无法把运行时生成的 Skill 写回该目录。Desktop 阶段复用现有 Central Skill 用户目录，但仍以同一个 Store 同时供应仓库和选择器。

用户可以选择一个已安装专业 Skill 增强当前任务；它与 `jc-cha-wiki` 同时可用，不能取代每轮 Wiki 查询。Skill 正文只在选中后进入本轮请求，不把全部用户 Skill 正文预塞入上下文。

`skill-creator` 生成的 Skill 只有在用户明确说“安装”后，才输出包含完整单文件 `SKILL.md` 的 `jc-skill-install` 块。界面把它解析为“安装到我的 Skill / 继续修改”确认卡；只有用户点击安装后才调用现有 `createAgent()` 写入用户 Skill Store，不能静默安装。第一版不安装 `references/`、`scripts/` 或 `assets/`；需要这些资源时必须先把必要规则收进自包含 `SKILL.md`。仓库现有手动自建入口继续保留。

### 8.3 Wiki 写入

普通对话只提供 Wiki 只读工具。只有以下情况进入受限写入轮次：

- 用户明确要求写入或修改 Wiki；
- 用户指定路径；
- 用户确认模型建议的路径和内容；
- 用户通过现有工具审批。

未指定路径时，模型先查询现有 Wiki，优先复用已有页面；没有合适位置时提出一个最小新路径，等待确认。写入后更新必要入口、`hot.md`、`log.md` 和 `来源索引.md`，重要结论可追溯到 Raw 文件及 turn 范围。

## 9. MCP 与设置

### 9.1 隐藏设置

设置不是第三栏，也不是主导航。顶部账号/齿轮按钮打开覆盖层或抽屉，V1 只包含：

1. 登录、退出、会员/余额、Provider、API Key 和模型刷新；
2. Desktop 的现有本地模型能力；
3. Desktop `CentralSkillsPanel` / Web `WebSkillPanel`；
4. `McpManagerPanel`；
5. 外观、语言、版本、更新和关于。

不带插件管理、OpenCode 升级、变更审查、创作偏好或工作台专属设置。

### 9.2 MCP

已启用且已连接的 MCP 工具经现有 `mcpStore -> mcpBridge` 进入同一模型工具循环，由模型按本轮目标决定是否调用。MCP 不能取代每轮 Wiki 查询。

Desktop 支持现有本地 `stdio` 与远程 MCP；Web 只显示浏览器真实可执行的远程 MCP。凭据、OAuth token、工具参数和完整回执不进入 Raw 或 Wiki。

## 10. 对话内媒体

媒体生成是基础能力，不依赖创作面板或特定 Skill。用户要求生成图片、视频或音频时：

```text
模型完成 Wiki 查询
  -> 生成公共 MediaPlan(image | video | audio)
  -> 对话内确认模型、提示词、参数、素材和价格
  -> 用户点击“开始生成”
  -> preparePublicMediaPlan()
  -> mediaTaskStore.submitTask()
  -> 对话内显示进度、取消、失败和结果
  -> 结果写入当前项目 jc-media/
  -> Raw 追加最终可见结果和项目相对路径
```

- 三种媒体都使用现有模型注册表、公共计划、确认卡、任务 Store 和轮询恢复。
- 音频按现有模型字段进入 `buildCreationRunPlan()` 和 `audioParams`，不另造音频合同。
- 所有可能扣费的任务必须先由用户确认。
- 不持久化临时远程 URL；成功结果先落项目，再写 Raw。
- 任务状态库丢失时，已成功媒体仍可从 Raw 相对路径和 `jc-media/` 恢复。
- 不加载 `CreationPanel`、画布、画廊或第二套媒体引擎。

## 11. 最小实现架构

### 11.1 复用现有产品壳，不创建 `apps/chat`

当前阶段直接在现有 Web/Desktop 产品身份内实现“记忆对话工作台”入口和布局，不创建平行 App 工程。

最小新增边界：

| 模块 | 责任 |
| --- | --- |
| `CentralContentHost` | 根据统一打开结果显示对话、文档、媒体或安全文件视图 |
| `ConversationTranscript` | 创建、识别、解析、追加和重命名对话 Raw |
| `MemoryChatRuntime` | 当前 Raw 请求装配、Wiki/Skill/MCP 工具循环和回复落盘 |

名称可按现有代码风格调整；不为了对齐本文先创建空目录或抽象层。

### 11.2 共享资源打开链路

实现只扩展现有合同：

```ts
type ProjectResourceOpenResult =
  | { type: 'conversation'; resource: ProjectResource; transcript: ConversationTranscript }
  | { type: 'editor'; resource: ProjectResource; text: ProjectTextRead; editorMode: 'rich' | 'plain' }
  | { type: 'unsafe-text'; resource: ProjectResource }
  | { type: 'canvas'; resource: ProjectResource }
  | { type: 'media'; resource: ProjectResource; mediaKind: 'image' | 'video' | 'audio' }
  | { type: 'binary'; resource: ProjectResource }
```

`openProjectResource()` 对文档完成安全读取后，再用“路径 + 元数据”识别对话。普通资源分类仍沿用现有 `ProjectResource`，不把需要读正文才能确定的 conversation 硬塞进扩展名分类。

### 11.3 直接复用

- `ProjectFileService` 与 Desktop/Web 项目适配器；
- `openProjectResource()` 统一路由与资源变更事件；
- 现有账号、Provider、模型和安全凭据能力；
- `SkillPickerBar`、Skill loader 与双端 Skill 仓库；
- `McpManagerPanel`、`mcpStore`、`mcpClient` 与 `mcpBridge`；
- Direct Engine、附件和 Markdown 渲染的底层能力；
- `MediaPlanCard`、`MediaTaskBubble`、`preparePublicMediaPlan()` 与 `mediaTaskStore`；
- Web 的 IndexedDB + OPFS 项目存储和项目相对媒体路径。

只复用现有聊天 UI 的气泡、输入框和必要样式，不复用其 OpenCode、四模式或会话数据库逻辑。

## 12. 跨端布局与存储

### 12.1 Web

- 首发地址固定为 <https://jiucaihezi.studio>。
- 复用当前 Origin、账号回调、IndexedDB + OPFS 项目存储和发布流程。
- 不建立 `chat.jiucaihezi.studio` 或新的 Pages 产品。

### 12.2 Desktop

- 第二阶段继续使用现有“韭菜盒子”产品名、Bundle ID、签名、Deep Link 和更新通道。
- 不建立新安装身份，不要求用户并装第二个客户端。
- 现有主 App 源码、发布记录和可回退版本继续保留；新工作台验证失败可按现有版本回滚。

### 12.3 Mobile

- 第三阶段做手机 App。
- 使用同一 Raw、Wiki、媒体和 `ProjectFileService` 合同。
- 项目存放在 App 管理的可写目录；文件树读写的是该项目目录，不依赖任意系统目录权限。
- 支持系统文件导入、导出和分享；V1 不承诺跨设备自动同步。
- 手机只改变布局：文件树抽屉 + 中央内容区 + 设置抽屉，不改变模型和记忆链路。

## 13. 错误与并发

| 情况 | 行为 |
| --- | --- |
| 用户消息 Raw 追加失败 | 不发模型请求，保留输入并允许重试 |
| 对话读取失败 | 不请求模型，显示真实文件错误 |
| Wiki 查询失败或未发生 | 不接受候选回答，不追加 assistant |
| 模型失败、取消或流式中断 | 用户消息保留，不写不完整 assistant |
| assistant Raw 追加失败 | 保留可见结果并阻止下一轮，直到落盘成功 |
| Wiki 审批拒绝或写入失败 | 不回滚 Raw；拒绝则不写，失败可按相同来源重试 |
| 媒体失败或取消 | Raw 追加最终状态，不写成功路径 |
| 媒体成功但项目落盘失败 | 不标记成功，使用现有重试落盘能力 |
| MCP 未连接或调用失败 | 不伪造外部结果，显示真实错误 |
| 多窗口同时追加 | revision 冲突后重读，按 turn ID 去重重试 |
| Provider 容量错误 | 原样显示，不新增隐藏摘要流程 |

## 14. 实施顺序

### 第一阶段：Web 根域可用

1. 修正通用 Wiki 最小骨架和 Raw 来源合同。
2. 在 `openProjectResource()` 增加对话识别与打开结果。
3. 建立文件树 + `CentralContentHost`，完成四种资源显示。
4. 实现 Raw 新建、标题显示、聊天恢复、追加、重命名和删除。
5. 接入 Direct Engine、每轮 Wiki 查询、用户 Skill、确认写入和 MCP。
6. 接入隐藏设置及对话内图片/视频/音频能力。
7. 在 <https://jiucaihezi.studio> 完成真实发布验收。

验证：Web 用户无需模式、项目选择器或对话选择器，只用文件树即可打开文档/媒体、切换对话、查询和写入 Wiki，并完成真实媒体生成。

### 第二阶段：现有 Desktop App

1. 复用第一阶段公共运行时与布局。
2. 接入现有 Desktop 项目文件、Keychain、本地模型、本地 MCP 和系统打开能力。
3. 沿用当前产品身份、签名和更新通道发布。

验证：Apple Silicon、Intel Mac 和 Windows 使用现有更新路径完成同一闭环，且可回退到保留的主 App 版本。

### 第三阶段：Mobile App

1. 增加移动文件适配器和 App 管理项目目录。
2. 把文件树、设置改为抽屉，中央内容区保持同一资源路由。
3. 接入移动登录回调、附件、媒体上传/播放、导入导出。

验证：手机上可以新建/导入项目、切换 Raw 对话、读写 Wiki、生成和播放媒体；关闭重开后从项目文件恢复。

### 14.4 第一阶段实施记录（2026-07-24）

已完成：

- Web 入口切换为文件树 + 中央内容区 + 隐藏设置；Desktop 暂时保留原 `WorkspaceLayout`。
- 通用项目初始化只创建五个 Wiki 文件、`.raw/对话记录/` 和首条带标记对话，不建立会话数据库。
- `openProjectResource()` 已统一区分 `conversation / document / media / binary`；普通 Markdown 不进入聊天壳。
- 对话创建、H1 标题、Raw 追加、修订冲突重试和文件树切换已落地；用户消息先落 Raw，合格回复完成后再落 assistant。
- Direct 请求必须先加载 `jc-cha-wiki` 并真实调用 Wiki 查询工具；缺任一步都拒绝保存正式助手回复。
- 登录、模型、Skill 仓库和 MCP 进入设置抽屉；图片、视频、音频共用 `MediaPlanCard -> mediaTaskStore`，不加载创作面板。
- 桌面宽屏使用左树右内容，手机宽度使用文件树抽屉和全屏中央内容区。
- 记忆模式文件树顶栏固定为新建文件、新建文件夹、切换项目、刷新和隐藏文件树五个动作；切换项目会同步打开目标项目的首条 Raw，禁止中央区残留旧项目对话。
- 输入框复用主 App 的 `contenteditable` 纯文本提取和自动增高合同；普通文本文件可从右键菜单“引用到对话”，引用内容只进入下一轮请求，不改写原文件。
- 设置抽屉复用白色、浅色、黑夜和护眼四套主题；记忆 Web 首次启动默认护眼绿色，后续尊重用户选择。
- Web Skill 仓库与对话选择器统一读取用户已安装 Skill Store；`public/skills/` 只供产品内部调用，不再灌入仓库或选择器。
- `skill-creator` 的完整 `SKILL.md` 安装块、确认卡和 `createAgent()` 写入已接通；同名 Skill 明示为更新，确认前不写入。

验证证据：

- 对话身份、资源路由、通用 Wiki 和三类媒体合同定向测试 `43/43` 通过。
- `pnpm exec vue-tsc -b`、`pnpm run build:quick` 和 Web 产物审计通过。
- 应用内浏览器已验证：创建项目、五文件 Wiki、创建/切换 Raw 对话、H1 标题、普通文档只读、账号设置、Skill 仓库、MCP 和 `390x844` 手机布局。
- 本轮相关回归 `78/78`、TypeScript、Web quick build 和产物审计通过；应用内浏览器验证五按钮工具栏、文本引用、输入框 `24px -> 120px -> 24px` 自适应、四主题及绿色默认，无新增控制台错误。
- 完整 focused 当前仍有 4 条既有电商/旧 Web 会话源码合同失败，不登记为本阶段通过证据。

未完成：

- 尚未发布到 <https://jiucaihezi.studio>。
- 未使用真实登录账号完成模型回复、Wiki 确认写入和付费媒体闭环。
- Desktop 第二阶段和 Mobile 原生 App 第三阶段尚未实施。

## 15. 验收标准

### 15.1 导航与资源

1. 页面没有项目选择器、对话选择器和四模式入口。
2. 点击有效对话 Raw 才出现聊天记录和输入框。
3. 普通 Markdown/文本在中央区按文档显示，不出现聊天输入框。
4. 图片、视频、音频分别可预览或播放。
5. 二进制、超大文本和 `.jccanvas` 不进入聊天或可写文档，只有安全动作。
6. 对话行显示 H1 标题，但真实文件名和 ID 不变。
7. 刷新后只根据项目文件恢复，不依赖对话列表数据库。
8. 文件树顶栏只有新建文件、新建文件夹、切换项目、刷新和隐藏文件树五个动作。

### 15.2 对话与 Wiki

1. 新建对话立即创建带有效标记的唯一 Raw。
2. 用户消息先写 Raw，再发模型；完整回复后写 assistant Raw。
3. 模型看到当前对话后自主调用 `jc-cha-wiki`，App 不预查关键词。
4. 未查询或查询失败时不落正式助手回复。
5. 普通聊天不写 Wiki；用户确认后可写合理路径并追溯到 Raw turn。
6. 清除 UI 状态后，全部对话仍可从 Raw 恢复。
7. 普通文本文件可引用到当前对话；引用只进入本轮模型请求，原文件保持不变。

### 15.3 设置、Skill 与 MCP

1. 账号/齿轮按钮可打开登录、Provider、模型、Skill 仓库、MCP 和通用设置。
2. 设置不是常驻第三栏，关闭后回到原资源。
3. Skill 仓库与选择器只显示用户已安装 Skill，列表完全一致；新增、编辑或删除后立即同步。
4. `public/skills/` 中的产品内置 Skill 不在仓库和选择器出现，但内部调用不受影响。
5. 用户明确要求安装后才出现安装确认卡；点击“继续修改”不写入，点击“安装到我的 Skill”才写入并同步两处列表。
6. 只有 `enabled + connected` 的 MCP 工具进入模型候选池。
7. Web 不显示不可执行的本地 `stdio`；Desktop 可使用现有本地与远程 MCP。
8. 凭据不进入 Raw、Wiki、日志或模型上下文。
9. 设置提供白色、浅色、黑夜和护眼四主题；记忆 Web 首次启动默认护眼绿色。

### 15.4 媒体

1. 不选择媒体 Skill 也能自然语言生成图片、视频和音频。
2. 三种媒体使用同一公共计划、确认卡、`mediaTaskStore` 和落盘合同。
3. 未确认付费不提交任务。
4. 对话内能看到进度、取消、失败和最终媒体。
5. 结果分别写入 `jc-media/images`、`videos`、`audios`，Raw 只记项目相对路径。
6. 不加载 `CreationPanel`、画布、画廊或第二套任务引擎。

### 15.5 发布

1. 第一阶段在 <https://jiucaihezi.studio> 完成 Web 真实闭环。
2. 第二阶段沿用现有 Desktop 身份、签名、Deep Link 和更新通道。
3. 第三阶段再建立 Mobile 发布配置。
4. 当前阶段不存在 `chat.jiucaihezi.studio`、`com.jiucaihezi.chat`、`jiucaihezi-chat://`、`chat-v*` 或 `/updates/chat/`。
5. 现有主 App 源码与历史发布可用于回退。

## 16. 成功路径

```text
打开 https://jiucaihezi.studio
  -> 创建或导入项目
  -> 文件树出现 .raw、wiki 和已有文件
  -> 点击“新建对话”并开始聊天
  -> 用户消息写入当前 Raw
  -> 模型读取当前对话并自主查询 Wiki
  -> 模型回复写回同一个 Raw
  -> 点击另一个对话 Raw，中央区恢复并继续该对话
  -> 点击 Wiki 文档，中央区切为文档阅读
  -> 点击图片/视频/音频，中央区切为预览或播放器
  -> 从设置登录、选模型、管理 Skill 和 MCP
  -> 在对话内确认并生成媒体，结果落当前项目
  -> 用户确认后把结论写入 Wiki
  -> 关闭重开，仍从项目 Raw、Wiki 和媒体恢复
```

这条路径成立，就说明第一个工作台成立。之后再把同一公共底座送入现有 Desktop App，最后适配手机；不提前创建三套产品工程和发布身份。

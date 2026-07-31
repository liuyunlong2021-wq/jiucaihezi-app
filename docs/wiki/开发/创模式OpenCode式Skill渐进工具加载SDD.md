# 创模式 OpenCode 式 Skill 渐进工具加载 SDD

> 日期：2026-07-23
> 状态：已被替代，不执行
> 替代方案：[[开发/通用记忆工作台模型主导工具与审批SDD]]。用户于 2026-07-31 确认基础工具由模型自主选择，Skill 不再作为获得基础工具的前置门禁；本文仅保留历史讨论。
> 父级设计：[[开发/创作模式双端统一SDD]]
> 目标：创模式完全沿用 OpenCode 的 Skill 两阶段加载方式，并以 Skill 作为工具进入创模式的唯一入口

## 1. 一句话目标

```text
第一轮：模型 + 用户文字 + 原始附件 + Skill 目录 + skill(name)
模型直接回答，或者调用 skill(name)
Skill 加载成功后：完整 SKILL.md + 现有创模式工具
工具结果回到同一模型，直到最终回复
```

模型没有加载 Skill 时，创模式不提供项目工具、Wiki、终端、媒体工具或 MCP。

## 2. OpenCode 官方事实

OpenCode 的 Skill 合同是两阶段加载：

1. Skill 扫描器只收集 `name`、`description`、`location` 和正文。
2. 系统提示只列出 `<available_skills>` 中的名称、描述和位置。
3. 模型只能调用固定的 `skill({"name":"精确名称"})`。
4. `skill` 工具按精确名称加载完整 `SKILL.md`。
5. 工具结果返回 `<skill_content>`、Skill 根目录和抽样资源文件列表。
6. 模型根据 Skill 正文继续使用当前运行时已有工具。

事实源：

- `/Users/by3/Documents/jiucaihezi-opencode/packages/opencode/src/skill/index.ts`
- `/Users/by3/Documents/jiucaihezi-opencode/packages/opencode/src/tool/skill.ts`
- `/Users/by3/Documents/jiucaihezi-opencode/packages/opencode/src/session/system.ts`

本 SDD 不修改这套标准，不新增另一种 Skill 协议。

## 3. 当前创模式缺陷

当前创模式已经具备正确的 Skill 目录和 `skill(name)` 加载器，但第一轮同时发送：

- `skill`
- `wiki`
- `read`
- `glob`
- `grep`
- `write`
- `edit`
- Desktop `terminal`
- 已连接 MCP 工具

这导致：

1. 模型没有加载 Skill 也能主动扫描项目和 Wiki。
2. 简单图片、视频和文字任务容易被工具打断。
3. 每轮携带无关工具 schema。
4. Skill 不再是渐进披露入口，只剩下说明书作用。

## 4. 唯一升级规则

### 4.1 Skill 未加载

创模式请求只包含：

- 当前模型、Provider 和 K
- 当前对话的可见文字
- 本轮原始附件
- Skill 名称和描述目录
- 唯一的 `skill(name)` 工具

不得包含其他工具定义。

模型有两种选择：

```text
直接回答
或
调用 skill(name)
```

### 4.2 Skill 已加载

`skill(name)` 成功后，运行时：

1. 按 OpenCode 格式把完整 `SKILL.md`、Skill 根目录和声明资源返回模型。
2. 从下一次模型请求开始开放现有创模式工具。
3. Skill 正文决定模型应该使用哪些工具和执行什么流程。
4. 产品仍负责路径边界、用户审批、取消、真实错误和工具结果回传。

不增加 `tools:` frontmatter，不解析 Skill 正文猜工具，不维护 Skill 到工具的额外映射表。创模式现有工具集合继续是唯一工具事实源。

### 4.3 手动选择 Skill

用户在 UI 手动选择 Skill 时：

- 只把精确 Skill 名称交给模型。
- 要求模型首先调用 `skill(name)`。
- 不把完整 `SKILL.md` 预注入 system prompt。
- Skill 加载成功前仍不提供其他工具。

这与 OpenCode 的 Skill 选择和加载语义一致。

## 5. 工具生命周期

### 新对话

初始只开放 `skill`。

### Skill 加载后

本对话记录该 Skill 已加载，后续轮次可以继续使用现有创模式工具。Skill 内容作为真实工具结果留在对话上下文，不重复预注入。

### 加载其他 Skill

模型可以再次调用 `skill(name)` 加载另一个 Skill。不得重复加载同名 Skill；重复请求直接返回“本会话已加载”。

### 新建会话

清空已加载 Skill 状态，重新从 Skill 目录和唯一 `skill` 工具开始。

本 SDD 不设计自动卸载、超时淘汰、工具热度或能力图谱。

## 6. 现有工具保持不变

Skill 加载后复用现有工具合同：

- `wiki`
- `read`
- `glob`
- `grep`
- `write`
- `edit`
- Desktop `terminal`
- 当前已连接 MCP 工具

本 SDD 不新增工具、不合并工具、不改变工具参数，也不修改五个 Wiki Skill、媒体 Skill 或用户 Skill 的正文。

Skill 正文要求使用某个当前不存在的工具时，运行时返回真实“不支持/不存在”错误；不得伪造执行结果。

## 7. Wiki 和媒体示例

### 查询 Wiki

```text
用户：查 Wiki 里的苏晴设定
模型：skill({"name":"jc-cha-wiki"})
系统：返回完整 jc-cha-wiki SKILL.md
下一轮：开放创模式工具
模型：调用 wiki search/status/graph
系统：工具结果回模型
模型：最终回答
```

### 普通图片分析

```text
用户：分析这张图片
模型：直接读取原始图片并回答
```

不调用 Skill，不出现任何项目工具。

### 媒体创作

```text
用户：根据这张图生成一段视频
模型：加载匹配的媒体 Skill
系统：返回 Skill 正文并开放创模式工具
模型：按 Skill 使用媒体能力
结果：回到同一模型和同一对话
```

## 8. Web / Desktop

Web 与 Desktop 使用相同的渐进加载状态机：

```text
catalog-only
  -> skill-loaded
  -> tools-enabled
  -> final-answer
```

双端差异仅保留在工具执行适配器：

- Web 项目文件使用 IndexedDB / OPFS。
- Desktop 项目文件和终端使用 Tauri IPC。
- Web 不暴露 Desktop `terminal`。
- Skill 目录继续按现有来源合同生成，不能新增第三份目录。

## 9. 模型和错误边界

- 当前模型支持 function calling 时，可以调用 `skill(name)`。
- 当前模型不能调用工具时，仍发送文字和原始附件，让模型直接回答。
- 用户明确选择 Skill 但当前模型不支持工具时，明确提示当前模型不能执行该 Skill；不自动换模型。
- Skill 不存在、正文读取失败、资源缺失或工具执行失败时，返回真实错误给模型和用户。
- 工具失败后不能原样无限重试；继续使用现有失败重复保护和用户取消语义。

## 10. 统一对话和 UI

- Skill 目录不显示为普通聊天正文。
- `skill(name)` 调用和加载结果使用统一工具步骤 UI。
- Skill 加载后的项目工具继续使用统一工具步骤 UI。
- 最终模型回复进入统一助手消息。
- 道模式切换到创模式后，从当前对话文字和原始附件继续，但创模式仍从“只开放 skill”开始。
- 创模式切换到道模式后，只携带用户文字、助手最终回复和原始附件，不携带已加载 Skill 与工具过程。

## 11. 明确不做

- 不新增 capability 工具或能力注册中心。
- 不新增 Skill `tools:` 字段。
- 不解析 Skill 正文推断工具权限。
- 不在第一轮发送全量创模式工具。
- 不把完整 Skill 正文预注入 system prompt。
- 不按关键词替模型选择 Skill。
- 不自动加载五个 Wiki Skill、媒体 Skill 或任何内置 Skill。
- 不修改 OpenCode 官方 Skill 发现和加载语义。

## 12. 实施顺序

1. 冻结 OpenCode Skill 目录和 `skill(name)` 输出格式测试。
2. 为创模式增加失败测试：首轮工具列表只能包含 `skill`。
3. 删除 Web/Desktop 创模式首轮全量工具注入和手动 Skill 全文预注入。
4. 在 `skill(name)` 成功后，把现有创模式工具加入下一轮请求。
5. 在统一对话记录中保存“已加载 Skill”状态，不新增独立数据库。
6. 回归道/创模式切换、附件、Wiki、项目文件、媒体、MCP 和 Desktop 终端。

## 13. 验收标准

### 自动验收

1. 创模式首轮只有 `skill` 工具，没有 `wiki/read/glob/grep/write/edit/terminal/MCP`。
2. 模型不调用 `skill` 时，整轮没有其他工具调用和工具事件。
3. `skill(name)` 返回完整正文、根目录和资源列表，格式与 OpenCode 等价。
4. Skill 加载后的下一次请求包含现有创模式工具。
5. 手动选择 Skill 不预注入正文，必须先出现一次精确 `skill(name)`。
6. 新建会话清空已加载 Skill；同一会话重复加载同名 Skill不会重复读取。
7. Web/Desktop 使用相同状态机，Desktop 仅多出 `terminal`。

### 人工验收

| 场景 | 预期 |
|---|---|
| 创模式发送“你好” | 模型直接回复，只发生一次模型请求 |
| 创模式分析图片 | 模型直接看图，不查项目、不加载 Skill |
| 创模式查 Wiki | 先加载对应 Wiki Skill，再出现 Wiki 工具 |
| 创模式读取文件夹 | 模型加载匹配 Skill 后才出现项目文件工具 |
| 手动选择 Skill | 首步是精确 `skill(name)`，不是全文 system prompt |
| Skill 只要求写作 | 模型读取 Skill 后直接写作，不必调用项目工具 |
| Skill 要求本地程序 | Desktop 显示终端审批；Web 明确不支持终端 |

## 14. 成功标准

```text
Skill 是创模式唯一的渐进式入口。
工具是 Skill 加载后的附属能力。
模型能直接回答时，不加载 Skill，也不获得其他工具。
```

完成后，创模式保留现有 Skill 和工具能力，但不再因为全量工具注入而把简单任务变成 Agent 探索任务。

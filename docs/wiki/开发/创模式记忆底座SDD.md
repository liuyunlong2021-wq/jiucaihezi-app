# 创模式记忆底座 SDD

> 日期：2026-07-16
> 状态：历史实现；其中项目 `.raw` 账本与对话 Wiki 已于 2026-07-20 由 [[创模式Raw账本与对话Wiki移除SDD]] 删除
> 范围：只升级创模式；文模式、武模式和 OpenCode 不改。

> 以下保留原始设计和演进证据，不再作为当前实现合同。

## 1. 历史目标

让创模式的项目记忆不再依赖模型“记得自己去写”。App 自动留下事实、带上最低必要上下文；模型继续自由决定要不要加载专业 Skill、查更多 Wiki、读写文件和使用终端。

完成后删除：

- `public/skills/JC-手脚/`
- `public/skills/jc-creative-memory/`
- 它们的 Skill 索引项、每轮强制加载提示和相关测试。

## 2. 最小架构

```text
用户消息
  -> App 追加 .raw/sessions/jcses_<会话>.jsonl 的 user 事件
  -> App 按容量装配最近对话；有 wiki/hot.md 时附 CLAUDE.md + wiki/hot.md
  -> 既有 runDirectChatCompletion 工具循环
  -> App 追加 tool_call / tool_result / assistant / turn_finished 事实事件
  -> 界面继续消费既有流式文本和工具步骤
```

App 只做确定性工作。模型仍决定专业 Skill、Wiki 深读、文件、终端和最终答案；本轮不自动压缩 Wiki、不自动创建知识结构、不自动调用任何“记忆 Skill”。

## 3. 数据合同

每个创作会话使用一个项目内的追加文件：

```text
.raw/sessions/jcses_<creative 会话后缀>.jsonl
```

一行一个 JSON 事件，最小字段固定为：

```json
{"v":1,"sessionId":"jcses_xxx","turnId":"user_xxx","type":"user","at":0,"data":{}}
```

合法 `type`：`user`、`tool_call`、`tool_result`、`assistant`、`turn_finished`。

- `turn_finished` 状态只能是 `done`、`failed`、`cancelled`。
- 记录用户原话、附件名称/项目相对路径、工具名、参数、真实结果、最终文本和真实错误。
- 不记录系统提示词、隐藏推理、API Key、附件二进制内容或附件真实缓存绝对路径。
- 已收到的文字、工具结果和失败现场不得在失败后消失。

Desktop 通过 `dev_read_file` 与 `dev_append_file` 操作当前项目；Web 通过已有 `webProjectFiles.read/write` 操作同一路径。两端各自项目存储是真源，本轮不承诺跨设备云同步。

## 4. 上下文合同

1. 完整创作会话仍由 `creativeSessionStore` 保存，用于显示和恢复。
2. 发给模型时不再固定截取最近 24 条。按当前模型的 `getModelContextWindow(...)`，从最新消息向前装入能容纳的完整消息对。
3. 若项目存在 `wiki/hot.md`，视为项目第二大脑已启用：同时读取项目根 `CLAUDE.md`（存在时）和 `wiki/hot.md`，作为本轮系统上下文。二者缺失、读取失败或为空时不阻断创作请求。
4. 不自动读取整个 `wiki/` 或 `.raw/`；需要细节时继续由模型调用现有 `read`、`glob`、`grep`。
5. 本轮只做容量内的“最近对话 + 热记忆”装配，不实现 OpenCode 式自动摘要、向量索引或独立上下文数据库。用户后续的手动压缩和物理外挂可直接读取 `.raw`。

## 5. 实施任务

### Task 1：先固化失败用例

- 新增创模式记忆合同测试，验证一次用户消息、成功工具、失败工具、取消和最终回答分别形成正确 JSONL 事件。
- 新增上下文装配测试：小模型只带容量内的最新完整消息对；有 `wiki/hot.md` 时带入 `CLAUDE.md` 与热记忆；文件不存在时照常发送。
- 新增回归断言：创模式不导入 OpenCode；文/武不调用创模式记忆写入器。

### Task 2：实现最小的共享事实账本

- 新增一个只包含事件格式、`creative_ -> jcses_` 转换和 JSONL 编码的公共纯函数。
- Desktop 和 Web 只各提供“读/追加项目文本文件”的小适配，不复制事件格式或状态机。
- 在用户消息进入循环前先落 `user`；工具调用、工具结果、最终流结束和取消/错误处追加对应事件。
- 账本写入失败只在工具详情/控制台留下真实错误，不取消模型正在完成的任务。

### Task 3：替换固定 24 条历史

- 从 `buildDirectMessages(...)` 抽出创模式专用的容量装配入口，保留文/武及其他调用方的既有行为。
- 复用 `getModelContextWindow(...)` 和项目已有的字符/Token 估算规则；从尾部保留完整消息对，不切半条消息。
- 先放入当前用户消息、`CLAUDE.md`、`wiki/hot.md`，剩余容量再放最近历史；不足时只省略更旧的历史，不省略本轮输入和热记忆。

### Task 4：接入双端直连发送

- Desktop `ChatPanel -> creativeChat` 和 Web `useChat -> chatCloud` 都在同一事实时点调用账本：用户消息、工具调用、工具结果、最终文本、结束状态。
- Web 不获得 `terminal`；Desktop 继续使用现有三按钮审批和终端工具。不得改变工具定义、审批语义或媒体输入合同。
- 继续使用现有 `creativeSessionStore` 保存 UI 会话；`.raw` 是项目可追溯副本，不取代 UI 会话列表。

### Task 5：让保留的对话转 Wiki Skill 读取创模式事实

- 修改 `public/skills/JC-对话转Wiki/SKILL.md`：创模式对话源改为当前项目 `.raw/sessions/*.jsonl`；不得再要求读取 OpenCode 数据库。
- 保留它的“用户确认分类方案后才沉淀”的交互，不由 App 自动建 Wiki。
- 验收：一段创模式 JSONL 能被该 Skill 读取、分类并沉淀；文/武历史的现有读取方式不在本轮删除。

### Task 6：删除两条补位 Skill

- 删除 `JC-手脚`、`jc-creative-memory` 两个目录及 `public/skills/index.json` 条目。
- 删除 `creativeHands.ts`、强制加载提示、相关专用测试和失效文档描述。
- 保留所有专业 Skill 与 `jc-raw-wiki`；后者改为用户或模型按需使用的普通专业 Skill，不由 App 自动触发。

### Task 7：验收

- Desktop：新建项目、发送带工具任务、允许一次工具、拒绝一次工具、取消一次任务。检查 `.raw` 事件顺序、状态和已有结果均正确。
- Web：同一组文本/文件工具任务，检查 Web 项目内相同路径的 JSONL 与热记忆注入。
- 长会话：用小上下文模型验证不再机械截取 24 条，而是按容量保留最新完整消息对并带 `hot.md`。
- 回归：`pnpm run test:focused`、`pnpm exec vue-tsc -b`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check`。

## 6. 明确不做

- 不接 OpenCode `ses_*`、自动压缩器、Todo、MCP 或权限内核。
- 不创建新的 Agent、后台 Worker、向量库、SQLite 记忆引擎或云同步服务。
- 不让 App 判断“哪句话值得成为长期知识”；这仍由用户按需调用普通 Wiki Skill 完成。
- 不改文模式、武模式的历史、权限、Skill 或自动压缩行为。

## 7. GitHub 对照

- [OpenCode](https://github.com/anomalyco/opencode)（审计时 186,471 stars）：完整会话事实与工具 Part 由运行时保存；其 [`compaction.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts) 按模型可用上下文保留最近完整轮次、处理旧内容。创模式只借鉴“事实与容量由运行时负责”，不移植它的完整压缩内核。
- [Aider](https://github.com/Aider-AI/aider)（审计时 47,433 stars）：[`history.py`](https://github.com/Aider-AI/aider/blob/main/aider/history.py) 先按 token 判断超限，再保留最近对话尾部、汇总较旧历史；[`chat_chunks.py`](https://github.com/Aider-AI/aider/blob/main/aider/coders/chat_chunks.py) 把系统、仓库、历史和当前输入分层装配。创模式采用同样的最小原则，但不在本轮自动摘要。
- [OpenHands](https://github.com/OpenHands/OpenHands)（审计时 81,001 stars）：仓库将 conversation、event service 与 condenser 设置分开管理。创模式只取“事件先落盘、界面再消费”的边界，不引入其服务端会话系统。

结论：行业成熟实现都将事实记录和容量控制放在运行时，不交给模型自觉执行；模型仍负责选择工具和完成任务。本方案只实现这条最小共同原则。

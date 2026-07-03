# OpenCode 换芯与 Skill 执行核心 SDD

> 状态：Wave 0-5 执行准则草案  
> 决策日期：2026-06-06  
> 本地 OpenCode 仓库：`/Users/by3/Documents/1OKAPP/my-opencode`  
> 核心原则：先清除旧对话内核，再把 OpenCode 作为唯一 Agent / Skill 执行核心接入韭菜盒子 UI。

---

## 1. 产品决策

韭菜盒子不再自研对话 Agent 内核。

新的产品定位：

```text
韭菜盒子 = OpenCode 的可视化工作台壳 + Skill 仓库 + 知识库仓库 + 创作/画布/主动工具生产台
OpenCode = 对话、Agent、Session、Tool Loop、Permission、Skill Tool、Plan/Build 的唯一执行核心
```

这次换芯不是为了把韭菜盒子做成代码 IDE，也不是替代 VS Code。使用 OpenCode 的核心目的，是获得成熟的 Agent 与 Skill 执行能力。后续产品精力应主要放在：

- Skill 仓库
- 知识库 Skill 化
- 主动工具
- 创作面板
- 画布

不再投入精力维护旧的手搓聊天内核。

---

## 2. 最高准则

1. **不 fork OpenCode 核心。**  
   韭菜盒子只连接 OpenCode、写配置、同步 Skill/知识资源、渲染 UI。OpenCode 官方升级时，应能通过拉取上游继续升级。

2. **不重写 OpenCode 已有能力。**  
   不重写 session、tool loop、permission、skill tool、上下文管理、agent/subagent 执行。

3. **不保留旧聊天 fallback。**  
   Wave 1 开始清理旧内核。换芯期间可以出现“OpenCode 内核未连接”的空状态，但不能偷偷回退到旧 `useChat.ts` 执行链路。

4. **连接层必须极薄，并且必须基于 OpenCode 官方 SDK。**  
   新增代码只做 UI 到 OpenCode 官方 SDK 的客户端门面，不做二次 Agent、不做任务规划、不做工具调用解析。禁止从零手搓 OpenCode HTTP client、SSE client、session client 或 tool loop。

5. **Skill 选择器保留，但语义简化。**

```text
未选择 Skill = 自动，OpenCode 可以看到全部启用 Skill，并自行判断是否调用
选择 Skill = 固定，本会话只允许 OpenCode 使用该 Skill
```

没有“关闭 Skill”状态。

6. **知识库不再走旧聊天 RAG 注入链路。**  
   知识库逐步转为 Skill 的 `references/` 资源，让 OpenCode 通过原生 `skill`、`read`、`grep`、`glob` 能力读取。

---

## 3. 非目标

Wave 0-5 不做以下事情：

- 不重做创作面板。
- 不重做画布。
- 不把主动工具全部接入 OpenCode。
- 不做 Skill Marketplace 完整升级。
- 不做知识库复杂 RAG 或向量检索。
- 不改 OpenCode 官方源码核心。
- 不搬 OpenCode 自带 UI。
- 不把韭菜盒子改成代码 IDE。

P6 以后再慢慢磨主动工具、创作面板、画布和 OpenCode Agent Node。

---

## 4. 目标架构

```text
韭菜盒子 Tauri/Vue UI
  ├─ ChatPanel / MessageBubble / SkillPickerBar
  │    └─ src/opencodeClient/*
  │         └─ OpenCode serve / session / prompt / events / permissions
  ├─ Skill 仓库
  │    └─ ~/.agents/skills/jiucaihezi/<skill-slug>/SKILL.md
  ├─ 知识库仓库
  │    └─ Skill references / vault exports
  ├─ 编辑区
  ├─ 创作面板
  └─ 画布
```

OpenCode 负责：

- 对话 session
- agent / subagent
- plan / build
- tool loop
- permission ask/reply
- skill 扫描与 `skill` 工具加载
- 模型调用与上下文执行

韭菜盒子负责：

- UI 展示和交互
- Skill 仓库管理
- 知识库仓库管理
- NewAPI / 模型入口配置
- 媒体创作生产台
- 画布编排
- 主动工具仓库

---

## 5. OpenCode 原生能力接点

基于本地仓库确认，OpenCode 已提供以下原生接点：

### 5.1 Headless Server

OpenCode 支持：

```text
opencode serve
```

韭菜盒子应连接 headless server，而不是嵌入 OpenCode TUI / Desktop UI。

### 5.2 Session API

OpenCode API 支持：

```text
POST /session
POST /session/{sessionID}/message
PATCH /session/{sessionID}
GET /session/{sessionID}/message
POST /session/{sessionID}/abort
```

`session.create` 和 `session.update` 均支持 `permission`。这允许韭菜盒子在会话层控制固定 Skill，而不是修改 OpenCode 核心。

### 5.3 Skill 扫描

OpenCode 会扫描：

```text
~/.agents/skills/**/SKILL.md
~/.claude/skills/**/SKILL.md
项目 .opencode/skills/**/SKILL.md
OpenCode config 目录下的 skill/skills
opencode.jsonc 中的 skills.paths / skills.urls
```

韭菜盒子 Skill 仓库应输出到 OpenCode 原生扫描目录，优先：

```text
~/.agents/skills/jiucaihezi/<skill-slug>/SKILL.md
```

### 5.4 Skill Permission

OpenCode 支持 `permission.skill`。固定 Skill 时，韭菜盒子在 session permission 中写入：

```json
[
  { "permission": "skill", "pattern": "*", "action": "deny" },
  { "permission": "skill", "pattern": "选中的 Skill 名", "action": "allow" }
]
```

注意顺序：OpenCode permission 使用最后匹配规则生效，宽规则必须在前，窄规则必须在后。

### 5.5 Skill Tool

OpenCode 会在系统提示中列出可用 Skill，并通过内置 `skill` 工具加载完整 `SKILL.md`。模型加载 Skill 后，可获得：

- Skill 正文
- Skill 所在目录
- 附加文件采样
- references/scripts/assets 的相对路径说明

韭菜盒子不再自己拼接 Skill prompt。

### 5.6 官方 SDK

OpenCode 已提供 `@opencode-ai/sdk`：

```text
createOpencodeServer()
createOpencodeClient()
createOpencode()
```

韭菜盒子必须基于官方 SDK 接入 OpenCode，不从零实现连接层。

当前本地 OpenCode SDK 同时导出根入口和 v2 入口：

```text
@opencode-ai/sdk
@opencode-ai/sdk/v2
```

Wave 0-5 优先使用 `@opencode-ai/sdk/v2`，因为 v2 入口覆盖 workspace、question、permission、command、skill、event、message part 等更完整的官方表面积。只有某个能力在 v2 暂不可用时，才允许在 `src/opencodeClient/` 中集中调用根入口。

允许的适配：

- 启动/关闭 OpenCode server。
- 传入 `OPENCODE_CONFIG_CONTENT`。
- 创建 SDK client。
- 调用 SDK 暴露的 session、prompt、event、permission、question、command、config、skill API。
- 把 SDK 返回的 message/part/event 映射到现有 UI。

禁止的适配：

- 自己解析 OpenCode 流式协议。
- 自己维护 OpenCode session 状态机。
- 自己实现 OpenCode permission ask/reply。
- 绕过 SDK 直接拼 OpenCode 内部 API，除非 SDK 暂未暴露且必须临时包一层，并集中在 `src/opencodeClient/`。

### 5.7 NewAPI Provider 投影

韭菜盒子现有登录与模型设置不推翻，但 OpenCode 不能直接读取韭菜盒子的 Tauri 安全存储、Pinia store 和 localStorage 业务语义。

因此需要一个极薄投影层：

```text
韭菜盒子当前设置
  ├─ getApiKey()
  ├─ DEFAULT_API_BASE_URL / jcApiBase
  ├─ agentStore.textModels
  └─ currentModel + providerId
       ↓
OpenCode config.provider / config.model / auth
```

投影规则：

```json
{
  "enabled_providers": ["jiucaihezi"],
  "model": "jiucaihezi/claude-sonnet-4-6",
  "provider": {
    "jiucaihezi": {
      "name": "韭菜盒子 NewAPI",
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://api.jiucaihezi.studio/v1",
      "options": {
        "apiKey": "sk-...",
        "timeout": false,
        "chunkTimeout": 60000
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "claude-sonnet-4-6",
          "tool_call": true,
          "attachment": true,
          "limit": {
            "context": 200000,
            "output": 8192
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        }
      }
    }
  }
}
```

鉴权路线：

```text
手动 Key 用户：
  getApiKey()
    → provider.options.apiKey

账号 Session 用户：
  读取 Rust 安全存储中的 Jiucaihezi session token
    → 调韭菜盒子服务端换取 OpenCode 可用的短期 NewAPI API Key
    → provider.options.apiKey
```

Wave 2 不把 `X-JC-Session` 直接塞给 OpenCode provider 作为默认路线。原因：OpenCode 的 `@ai-sdk/openai-compatible` provider 是否稳定支持自定义 header 不能作为产品前提。韭菜盒子服务端必须提供“账号 Session → 临时 API Key / scoped API Key”的兑换能力，OpenCode 只接收标准 `apiKey`。

验收要求：

```text
手动 Key 用户可用。
账号登录用户也可用。
如果临时 API Key 兑换接口未完成，Wave 2 只能作为开发态验证，不能作为面向普通用户的换芯上线。
```

Wave 0-5 只把聊天可用的 text models 投给 OpenCode。图片、视频、音频模型仍归创作面板、画布和主动工具使用，不进入 OpenCode chat model selector。

能力字段来源优先级：

1. 服务端 `/v1/models` 返回的显式 capability / context / modalities / tool_call。
2. `agentStore` 与 `modelContextWindows.ts` 的本地映射。
3. `supportsVision()` 的端点能力推断。
4. 保守兜底：text-only、`tool_call: true`、默认 context window。

---

## 6. 新增连接层边界

新增连接层建议命名为：

```text
src/opencodeClient/
```

不使用 `runtime/opencode` 命名，避免误解为新内核。

职责只包括：

| 文件 | 职责 |
|---|---|
| `daemon.ts` | 启动/连接 OpenCode server，读取 server URL 和鉴权信息 |
| `client.ts` | 创建并持有 OpenCode 官方 SDK client |
| `eventBridge.ts` | 订阅 OpenCode 事件流，分发到 Vue 响应式状态 |
| `session.ts` | 创建/更新 session，发送 prompt，abort，会话 permission 设置 |
| `messageMapper.ts` | 将 OpenCode message/part/event 映射到现有 MessageBubble 可渲染结构 |
| `skillScope.ts` | 根据 SkillPickerBar 状态生成 session permission |
| `skillSync.ts` | 将韭菜盒子 Skill 同步为 OpenCode 可扫描的 `SKILL.md` 目录 |
| `providerProjection.ts` | 将 NewAPI 登录态、BaseURL、text model 列表投影为 OpenCode provider config |

禁止在连接层中出现：

- 二次 tool loop
- 二次 agent loop
- 手写 SSE chat completions parser
- 手写 OpenCode SDK 替代品
- 手写 tool_calls 解析和执行
- 旧知识召回注入
- 自动 Skill 选择逻辑
- 任务规划器

连接层是客户端门面，不是新内核。

---

## 7. 执行波次（Wave 0-5）

执行拆为 6 个独立波次，每个波次有明确验收条件。**每个 wave 完成后必须通过 gate 审计再进入下一个 wave**，不允许跳过或合并 gate。

Gate 审计标准（每个 wave 结束后执行）：

```text
1. pnpm run typecheck 通过
2. pnpm run test:focused 通过（旧测试按计划删除/改写后）
3. pnpm tauri dev 启动不崩溃
4. 手动冒烟：该 wave 验收条件逐条确认
5. 创作面板、画布、编辑区不受影响（每个 wave 都检查）
6. 记录 gate 结果（通过/阻塞项），阻塞项必须修复后重新 gate
```

---

### Wave 0：执行前准备

目标：建立安全执行环境，记录当前基线。

处理：

1. 新建分支 `opencode-kernel`（或 worktree），避免主工作区直接爆炸。
2. 把本 SDD 固化为当前执行基线（commit 到分支）。
3. 跑一次现状检查：`pnpm run typecheck`、`pnpm run test:focused`、`pnpm tauri dev` 启动。
4. 记录当前测试结果：哪些绿、哪些已经坏、哪些是旧内核相关。
5. 标记旧内核相关测试文件，准备 Wave 1 删除/改写。

验收：

```text
知道当前项目本来哪些是绿的，哪些已经坏。
有独立分支，主工作区不受影响。
后续 wave 的 gate 审计有对比基线。
```

---

### Wave 1：清旧内核，但不接 OpenCode

目标：让旧聊天执行链不可达。第一天目标是”旧芯断电但 UI 不塌”。

断开（不删文件，只断开调用链路）：

- `useChat.ts` 中的 `runToolLoop`、`buildApiMessages`、`executeToolCall`
- 手搓 SSE 解析、手搓 `tool_calls`
- 聊天主链路中的 `recallKnowledgeWithTrace` 注入
- 聊天主链路中的 `imageBridge`
- `src/runtime/conversationContext/**` 对聊天主链路的影响
- `src/runtime/connection/**` 对聊天主链路的影响
- 旧工具开关 UI
- 帮我配置入口
- 聊天里的主动工具选择逻辑
- 旧上下文裁剪/水位执行逻辑

保留（UI 壳不动）：

- `ChatPanel.vue`
- `MessageBubble.vue`
- `SkillPickerBar.vue`
- 输入框 UI、消息列表 UI、附件展示 UI、模型选择 UI

实现策略：

1. 暂时保留 `useChat.ts` 文件名作为 UI facade，避免 import 一次性炸裂。
2. facade 内不得调用旧模型 API、旧 tool loop、旧知识注入。
3. Wave 1 结束时，ChatPanel 显示”OpenCode 内核未连接”占位状态。
4. `src/runtime/conversationContext/**` 和 `src/runtime/connection/**` 可先断开调用、后续 Wave 5 删除，避免 Wave 1 diff 过大；但 Wave 1 结束时不得再影响聊天主链路。
5. 删除或标记废弃旧内核相关测试（见 Section 11.1）。

验收：

```text
旧手搓对话内核不可达。
ChatPanel 不再能通过旧 NewAPI chat completions 主链路回复。
创作面板、画布、编辑区不受影响。
pnpm run typecheck 通过。
pnpm run test:focused 通过（旧测试已删除/改写）。
```

---

### Wave 2：OpenCode 最小连接

目标：ChatPanel 通过 OpenCode 完成普通聊天。这是风险最高的一波。

新增：

```text
src/opencodeClient/daemon.ts
src/opencodeClient/client.ts
src/opencodeClient/session.ts
src/opencodeClient/eventBridge.ts
src/opencodeClient/messageMapper.ts（最小版本）
src/opencodeClient/providerProjection.ts
```

核心链路：

```text
ChatPanel
  → opencodeClient.session.create()
  → opencodeClient.session.prompt()
  → OpenCode session/tool loop/model
  → eventBridge → messageMapper
  → MessageBubble
```

Wave 2 只要求普通文本对话跑通。权限请求和工具调用结果可以先以最小卡片形式展示。

`providerProjection.ts` 解决手动 Key + 账号 Session 双路线（见 Section 5.7 鉴权路线）。

Rust/Tauri event bridge 可以先用 SDK 直连验证，但 Wave 2 gate 审计前必须切到 Rust bridge（见 Section 12.3）。

Wave 2 必须使用 OpenCode 官方 SDK：

```text
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk/v2"
import { ServerAuth } from "@opencode-ai/server/auth"

createOpencodeServer({ config: projectedNewApiConfig })
createOpencodeClient({
  baseUrl: server.url,
  directory,
  experimental_workspaceID,
  headers: ServerAuth.headers({ password: serverPassword })
})
```

`projectedNewApiConfig` 来自 `providerProjection.ts`，只负责把韭菜盒子当前登录态、BaseURL 和 text model list 转成 OpenCode 原生 provider config。

验收：

```text
应用内发消息后，OpenCode 能返回回答。
消息能显示在现有 MessageBubble 中。
可以指定默认 agent。
可以指定模型。
可以 abort 当前回复。
手动 Key 用户可用。
账号 Session 用户可用（如临时 Key 兑换接口未完成，明确记录为阻塞项）。
没有旧内核 fallback。
```

---

### Wave 3：Skill 接管

目标：让 SkillPickerBar 真正控制 OpenCode Skill。

新增：

```text
src/opencodeClient/skillScope.ts
src/opencodeClient/skillSync.ts
```

Skill 同步目录：

```text
~/.agents/skills/jiucaihezi/<skill-slug>/SKILL.md
```

选择器规则：

```text
未选择 Skill：
  不写 skill 限制，OpenCode 自动看到全部启用 Skill

选择 Skill：
  session permission 写入：
    skill * deny
    skill <选中 Skill 名> allow
```

固定 Skill 不等于手动拼 prompt。模型仍通过 OpenCode 原生 `skill` 工具加载完整 Skill。

**关键前置**：实现前必须用当前 OpenCode 源码或单元测试重新确认 permission rules 的匹配顺序。当前方案按”最后匹配规则生效”设计，宽规则 `deny *` 必须在前，窄规则 `allow <Skill>` 必须在后。如果实测结果不同，必须在 gate 审计前调整 `skillScope.ts`。

验收：

```text
不选 Skill 时，OpenCode 可自动发现全部启用 Skill。
选中 Skill 时，本 session 只允许加载该 Skill。
模型加载 Skill 时走 OpenCode skill tool，而不是韭菜盒子 prompt 拼接。
SkillPickerBar UI 保留。
skillSync 同步到磁盘的 SKILL.md 内容与 agentStore 一致。
```

---

### Wave 4：知识库 references + UI 清理

目标：删除旧聊天 RAG 注入，知识库转为 OpenCode 可读资源；清理聊天区旧 UI。

#### 知识库导出

第一阶段采用”知识跟随 Skill”的设计。

导出结构：

```text
~/.agents/skills/jiucaihezi/<skill-slug>/
  SKILL.md
  references/
    vaults/
      <vault-id>/
        index.md
        wiki/    ← symlink 到知识库原始存储
        raw/     ← symlink 到知识库原始存储
```

默认使用 symlink，零额外磁盘开销。Wave 4 冒烟必须验证 OpenCode `read`/`glob`/`grep` 能跟随 symlink 正常读取。若 OpenCode 或权限规则不跟随 symlink，降级为浅复制（只复制 wiki/index，不复制 raw 大文件），并在 gate 审计中记录。

`SKILL.md` 中应包含简短说明：

```text
如任务需要项目知识、背景资料、设定、案例或风格约束，请优先读取 references/vaults/ 下的资料。
```

不做向量检索，不做复杂 RAG，不做自动写入知识库。

同步时机：

1. 应用启动时对启用的 Skill 做一次全量同步。
2. Skill 内容变更后增量同步对应 Skill 目录。
3. 知识库 raw/wiki/index 变更后增量同步到已关联 Skill 的 `references/vaults/`。
4. 增量同步必须防抖（500ms），避免整理知识库时频繁写磁盘。
5. 同步失败只影响 OpenCode 读取该 refs，不阻塞知识库本体使用。

#### UI 清理

- 删除聊天顶部知识库选择器强绑定入口。
- 删除旧搜索按钮（Jina 搜索 / 浏览器工具互斥开关）。搜索能力归属见 Section 7.1。
- 删除工具开关 UI。
- 删除帮我配置入口。
- Token 水位计：先隐藏或只读展示 OpenCode usage（见 Section 8）。
- 第二列新会话走 OpenCode `session.list`/`session.messages`。
- 旧会话进第二列底部折叠组「旧会话（只读）」，点击只展示消息、不可继续对话。

验收：

```text
选中 Skill 后，OpenCode 加载 Skill 能看到 references/vaults 说明。
OpenCode 可用 read/grep/glob 读取知识库 wiki（symlink 跟随正常）。
旧 recallKnowledge 聊天主链路已移除。
知识库仍然只接受用户手动添加/整理。
旧搜索/工具开关/帮我配置 UI 不可见。
旧会话折叠组显示正常。
```

---

### Wave 5：收尾硬化

目标：OpenCode 成为唯一对话核心，旧聊天系统退出产品。

#### 补齐交互

- Permission UI：展示 OpenCode permission request，用户 allow/deny，回传走官方 API。
- Question UI：展示 OpenCode question request，支持单选/多选/自定义回答/reject。
- Command/Slash 最小入口：读取 `command.list`，输入框 `/` 触发选择，执行走 `session.command`。

#### 错误状态硬化

- OpenCode 未安装或不可执行。
- server 启动失败 / 端口占用。
- NewAPI 未登录 / provider 鉴权失败（离线降级：不阻塞历史/Skill/知识库/创作面板浏览）。
- OpenCode permission 被拒绝。
- session abort。
- event stream 断开后重连。
- server crash 自动重启（指数退避 1s/2s/5s，最多 3 次；重启后重建 SDK client 实例 + event bridge）。
- 子进程退出：覆盖 app close、Cmd+Q、主窗口关闭、进程异常退出。

#### 旧系统清理

- 删除旧对话执行测试、旧 tool loop 测试、旧知识注入测试。
- 删除旧工具开关组件和状态。
- 删除未被创作面板/画布/编辑区使用的旧 utils。
- 删除或归档 `src/runtime/conversationContext/**` 和 `src/runtime/connection/**`。
- 更新 CLAUDE.md：移除旧内核章节（useChat.ts 详解、旧工具清单、旧上下文引擎、旧知识注入流程、旧对话显示体验层），替换为 OpenCode 换芯后的架构描述。

验收：

```text
韭菜盒子聊天默认只走 OpenCode。
普通聊天可用。
Skill 自动模式可用。
固定 Skill 可用。
知识库 references 可读。
Permission / Question / Command UI 可交互。
旧 useChat 核心逻辑不存在。
旧 runtime/conversationContext 不存在。
CLAUDE.md 已更新为换芯后架构。
创作面板、画布、编辑区不被破坏。
```

### 7.1 工具归属矩阵

旧内核有 10+ 个 LLM 工具。换芯后每个工具必须有明确归属，避免 Wave 1 动手时纠结。

| 工具 | Wave 0-5 状态 | 说明 |
|------|--------------|------|
| `office_create` / `office_convert` / `run_code` | 保留，编辑区独立调用 | 不进入 OpenCode tool loop |
| `export_editor_document` | 保留，编辑区独立调用 | 不进入 OpenCode tool loop |
| `document_to_markdown` | 保留，主动工具面板 | 格式转换工作台继续可用 |
| `media_url_inspect` / `media_url_download` | 保留，主动工具面板 | 网页媒体采集继续可用 |
| `local_media_*`（转写/处理/检测） | 保留，主动工具面板 | 不进入 OpenCode tool loop |
| `browser_search` / `browser_open` | Wave 4 删除 UI 入口 | P6 再决定是否接入 OpenCode tool |
| `dev_*`（源码项目读写/命令） | 暂停 | P6 作为 OpenCode 项目模式原生能力 |
| `todo_*`（会话级 todo） | 删除 | OpenCode 有原生 todo |
| `graphify_build` / `graphify_query` | 保留后端 API | 不进入 OpenCode tool loop |
| Jina API 搜索（`webSearch.ts`） | Wave 4 删除搜索按钮 UI | P6 再决定是否作为 OpenCode MCP tool 接入 |

原则：主动工具面板和创作面板/画布的工具**不进入 OpenCode tool loop**，继续独立运行。Wave 0-5 只换聊天内核，不重做工具体系。

### 7.2 搜索能力归属

旧内核有 Jina API 搜索（按钮 ON）和浏览器操控（按钮 OFF）两条互斥通道。换芯后：

- Jina 搜索按钮 UI 在 Wave 4 删除。搜索不再作为聊天区显式开关。
- 浏览器工具 UI 在 Wave 4 删除。
- OpenCode 自身如果有 web search 或 MCP 搜索能力，由 OpenCode 原生管理，韭菜盒子不拦截也不注入。
- P6 再决定是否把 Jina API 或浏览器工具作为 OpenCode MCP tool / custom tool 接入。

---

## 8. UI 调整范围

Wave 0-5 中，UI 调整遵守最小原则。

保留：

- 聊天主界面视觉结构
- Skill 选择器
- 消息气泡
- 创作面板入口
- 画布入口
- 编辑区入口

删除：

- 知识库选择器在聊天顶部的强绑定入口
- 工具开关
- 帮我配置
- 搜索按钮旧语义

工具归属和搜索能力归属见 Section 7.1 和 7.2。

Skill 选择器文案：

```text
未选择：自动
已选择：固定使用 <Skill 名>
```

不要出现“关闭 Skill”概念。

Token 水位计：

```text
Wave 1：删除旧 token 水位执行逻辑。
Wave 2：如果 OpenCode SDK / event 暂不稳定暴露 usage，则隐藏水位计。
Wave 3+：只读展示 OpenCode 返回的 usage / cost / context 信息，不再由韭菜盒子计算和裁剪上下文。
```

会话切换：

```text
Wave 0-5 允许多会话存在，但 ChatPanel 只保持一个 active session。
第二列点击 OpenCode session 即切换当前 active session。
OpenCode server 可同时存在多个 running session，UI 只聚焦当前 active session，其它 session 通过 session.status / event 更新列表状态。
```

---

## 9. 数据迁移

### 9.1 Skill 数据

现有 `agentStore.ts` 中的 Skill 数据需迁移/同步为文件：

```text
~/.agents/skills/jiucaihezi/<skill-slug>/SKILL.md
```

同步规则：

1. 内置 Skill 可只读同步。
2. 用户 Skill 可编辑后重新写入。
3. Skill 名必须与 `SKILL.md` frontmatter 中的 `name` 一致。
4. 同名冲突时，用户 Skill 优先，内置 Skill 后缀或跳过。
5. 删除 Skill 时，不直接删除用户磁盘文件；先标记停用或移动到 archive。

### 9.2 对话历史

新会话历史以 OpenCode 官方存储为唯一真源。

OpenCode 官方存储事实：

```text
XDG data/opencode/opencode.db
  session
  message
  part
  todo
  session_message
  session_input
  session_context_epoch
  ...
```

OpenCode 自己负责：

- SQLite 文件位置。
- WAL / PRAGMA。
- schema migration。
- session/message/part/todo 投影。
- event sourced session input。
- 删除、重命名、归档、fork、children。

韭菜盒子不得直接写 OpenCode SQLite 表，不得复制一份新聊天消息到 `jiucaihezi.db` 作为真实历史。

韭菜盒子只能通过 OpenCode 官方 SDK / API 管理新会话：

```text
session.list
session.create
session.get
session.messages
session.prompt
session.update
session.delete
session.abort
event.subscribe
```

第二列「会话」改为 OpenCode session browser：

| 旧实现 | 新实现 |
|---|---|
| `sessionStore.loadAllSessions()` 读 `jiucaihezi.db/conversations` | 调 OpenCode `session.list` |
| `sessionStore.loadSessionMessages()` 读 `jiucaihezi.db/messages` | 调 OpenCode `session.messages` |
| `sessionStore.saveSession()` 手动写消息 | 删除；OpenCode `session.prompt` 自动落库 |
| `sessionStore.renameSession()` 写本地记录 | 调 OpenCode `session.update({ title })` |
| `sessionStore.deleteSession()` 删除本地记录 | 调 OpenCode `session.delete` |
| `sessionStore.searchMessages()` 扫本地 messages | 先用 `session.list({ search, limit })`，必要时再拉 `session.messages` 做本地展示搜索 |

OpenCode session scope：

```text
默认只展示韭菜盒子 OpenCode workspace/directory 下的会话。
不要默认混入用户在 OpenCode CLI / 其它项目里的会话。
```

建议创建稳定目录：

```text
~/.jiucaihezi/opencode-workspace/default
```

`src/opencodeClient/daemon.ts` 启动/连接 OpenCode 时固定该 directory；第二列按这个 directory 查询 session。未来画布 Agent Node 或源码项目模式，再传入项目自己的 directory。

OpenCode DB 文件策略：

```text
默认遵循 OpenCode 官方数据目录。
如需避免污染用户已有 OpenCode CLI 会话，可设置官方支持的 OPENCODE_DB=jiucaihezi-opencode.db。
即使使用独立 DB，也仍由 OpenCode 创建、迁移和读写。
```

旧会话历史不强制迁移进 OpenCode。

Wave 0-5 策略：

```text
旧历史归档为第二列底部折叠组「旧会话（只读）」
点击旧会话只展示消息
旧会话不可继续对话
旧会话不可调用 OpenCode prompt
新聊天使用 OpenCode session
新聊天不再写 jiucaihezi.db/conversations 和 jiucaihezi.db/messages
```

不要为了迁移旧历史阻塞换芯。

### 9.3 知识库

知识库原始存储保留。新增导出层：

```text
vaultStore / vaultFs
  → references/vaults export
  → OpenCode Skill references
```

知识库本体不被 OpenCode 自动写入。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OpenCode API 变化 | 连接层失效 | 将所有 API 调用集中在 `src/opencodeClient/` |
| OpenCode server 启动失败 | 聊天不可用 | UI 提示连接状态和修复入口，不回退旧内核 |
| Skill 固定限制过强 | 可能错过其他 Skill | 默认不选即自动，固定是用户主动聚焦 |
| Skill 同步目录污染 | OpenCode 扫描重复或冲突 | 使用 `~/.agents/skills/jiucaihezi/` 命名空间 |
| 知识 refs 太大 | Skill 加载后上下文/搜索负担大 | Wave 4 只挂 wiki/index，raw 作为可读资源，不强塞进 prompt |
| 旧内核删除导致 UI 编译失败 | 短期破坏聊天 | Wave 1 允许 `useChat.ts` 作为 facade 保留，但禁止旧执行逻辑 |
| 用户误以为韭菜盒子变代码 IDE | 产品定位跑偏 | 文案强调 Skill/创作/知识工作台，不强调代码文件管理 |
| NewAPI Key 已登录但 OpenCode 读不到 | 聊天无法鉴权 | 由 `providerProjection.ts` 从 `getApiKey()` 生成 OpenCode provider `options.apiKey` |
| `/v1/models` 能力字段不足 | OpenCode 模型能力不完整 | Wave 2 用本地映射兜底；后续服务端补充 context/tool_call/modalities |
| 误把媒体模型投给 OpenCode chat | 对话模型选择混乱或请求失败 | Wave 0-5 只投 text models；媒体模型仍走创作面板/画布 |

---

## 11. 测试策略

Wave 1 会主动断开旧聊天内核，因此测试策略不能以”保留旧测试全绿”为目标。测试要围绕新边界重建。

### 11.1 Wave 1 旧测试处理

删除或废弃：

- 旧 `runToolLoop` 测试。
- 旧 `buildApiMessages` 上下文裁剪测试。
- 旧 `executeToolCall` 测试。
- 旧知识注入 / `recallKnowledge` 聊天主链路测试。
- 旧工具开关影响 tool list 的测试。
- 旧图片桥接作为 chat 主链路的测试。

保留或改写：

- MessageBubble 渲染测试。
- SkillPickerBar 交互测试。
- 文件拖拽 / 附件 UI 测试。
- 创作面板、画布、编辑器测试。
- NewAPI 登录态和模型列表测试。

### 11.2 Wave 2 连接层单元测试

优先测试纯函数和边界适配，不 mock OpenCode 内核行为。

必须覆盖：

- `providerProjection.ts`：NewAPI base/key/text models → OpenCode provider config。
- `skillScope.ts`：未选择 Skill / 固定 Skill → session permission rules。
- `messageMapper.ts`：text、reasoning、tool、file、patch、error、compaction part → UI message model。
- `eventBridge.ts`：OpenCode event → store 更新。
- `session.ts`：create/prompt/abort/update 调用参数包含 directory/workspace/model/agent/permission。

### 11.3 Wave 2 集成冒烟

本地集成冒烟必须覆盖：

```text
启动 OpenCode server
创建 SDK client
读取 agents/models/skills
创建 session
发送普通文本 prompt
收到 message part / session status event
abort 正在回复
关闭 app 后 OpenCode 子进程退出
```

如果 NewAPI 不可用，集成测试仍需验证：

```text
OpenCode server 可启动
历史/session list 可读取
Skill 同步可完成
发送消息得到 provider/auth/model 错误卡片
不会回退旧内核
```

### 11.4 Wave 3-4 验收测试

Wave 3：

- 不选 Skill 时不写 skill 限制。
- 选中 Skill 时 permission rules 顺序正确。
- OpenCode skill tool 读取的是同步后的 `SKILL.md`。

Wave 4：

- 应用启动全量同步 refs。
- 知识库变更后防抖增量同步。
- OpenCode read/grep/glob 能看到 `references/vaults/`。
- OpenCode read/grep/glob 能读取 symlink 指向的 wiki/raw。
- 旧聊天 RAG 注入不可达。

### 11.5 端到端 UI 冒烟

每个阶段至少跑一次：

```text
pnpm run typecheck
pnpm run test:focused
pnpm run tauri dev
```

若 `test:focused` 因旧内核测试失败，必须先删除/改写旧测试，再继续实现；不能为了过测试恢复旧内核 fallback。

---

## 12. 执行前兜底适配清单

这些不是新增产品功能，而是 OpenCode 成为唯一聊天内核前必须补齐的运行适配。缺任意一项，都可能出现“能聊一句，但不能稳定成为产品内核”的问题。

### 12.1 OpenCode server 生命周期与鉴权

OpenCode `serve` 可以无密码启动，但这不适合桌面产品内嵌。

必须适配：

- 只绑定 `127.0.0.1`。
- 使用随机可用端口。
- 为内嵌 server 生成独立 `OPENCODE_SERVER_PASSWORD`。
- client 请求必须带 OpenCode 官方 `ServerAuth.headers({ password })` 生成的 `Authorization`。
- password 不进 localStorage，只能进入 Rust 安全文件或内存。
- 启动、健康检查、重启、退出、版本检查都由 `src/opencodeClient/daemon.ts` 集中处理。

`createOpencodeServer()` 可以继续作为官方 SDK 入口，但如果它不能完整传递 server password / env，就在外层写极薄 daemon wrapper。wrapper 只负责进程生命周期，不重写 OpenCode API。

Tauri/Rust 侧生命周期契约：

- 生产版优先由 Rust `std::process::Command` 或 Tauri sidecar 启动 OpenCode server；JS 侧 `daemon.ts` 只发起 IPC，不直接长期持有生产子进程。
- 开发态允许 JS SDK `createOpencodeServer()` 启动，用于快速验证。
- Rust 侧保存 child handle，应用退出、窗口关闭、崩溃清理路径中必须 kill 子进程。
- macOS 退出路径必须覆盖 app close、Cmd+Q、主窗口关闭和进程异常退出。
- server crash 后允许自动重启，建议指数退避：1s、2s、5s，最多 3 次；超过后进入“OpenCode 未连接”状态，不回退旧内核。
- 重启后必须重新创建 SDK client 实例、重新建立 event bridge，并刷新 session/status/model/agent/skill 缓存。
- server password 由 Rust 侧生成和保存，文件权限按现有 session token 标准处理，不进入 JS 持久化存储。

### 12.2 OpenCode workspace / directory 隔离

OpenCode session 与 directory/project 有关。韭菜盒子不能把用户平时 CLI 使用 OpenCode 的 session 混进第二列。

必须适配：

- 默认 directory 使用稳定工作区，例如 `~/.jiucaihezi/opencode-workspace/default`。
- `session.list`、`session.create`、`session.prompt` 都带同一 directory。
- 旧韭菜盒子会话和 OpenCode 新会话分区展示。
- 未来项目/画布节点需要真实项目目录时，再显式切换 directory。

### 12.3 事件流适配

OpenCode 不是一次性返回纯文本。UI 必须订阅官方事件流。

必须映射：

- `message.part.delta`
- `message.part.updated`
- `message.part.removed`
- `message.updated`
- `message.removed`
- `session.created`
- `session.updated`
- `session.deleted`
- `session.status`
- `session.error`
- `session.diff`
- `todo.updated`
- `mcp.tools.changed`
- `command.executed`
- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`
- `question.rejected`

ChatPanel 不应该靠轮询拼凑流式输出。

传输机制：

```text
OpenCode server SSE
  → Rust/Tauri event bridge
  → app_handle.emit("opencode:event", payload)
  → src/opencodeClient/eventBridge.ts
  → Vue/Pinia 响应式状态
```

选择 Rust/Tauri event bridge 作为生产路径，原因：

- WKWebView 直连 SSE 容易再次遇到 CORS / stream 兼容问题。
- 项目已有 Rust `http_request_stream` 绕 WKWebView fetch 的经验。
- OpenCode server auth header 和重连策略可以集中在 Rust 侧。

开发态可以临时用 SDK client 直连 `event.subscribe`，但 Wave 2 上线验收必须走 Rust/Tauri event bridge。

### 12.4 Permission UI

OpenCode 的权限是 Agent 体验的一部分。固定 Skill 只是其中一种权限规则，不能替代通用 permission bridge。

必须适配：

- UI 展示 OpenCode permission request。
- 用户可以 allow / deny。
- 回传必须走 OpenCode 官方 permission reply API。
- Skill 固定模式通过 session permission rules 实现。
- 明确：OpenCode permission 是交互控制，不是系统级沙箱；server 鉴权和 Tauri 权限仍然必须独立做。

### 12.5 Question UI

OpenCode Agent 可以在执行中通过 `question` 工具主动向用户提问，不只是 permission allow / deny。

必须适配：

- UI 展示 OpenCode question request。
- 支持单选、多选和自定义回答。
- 支持 reject / dismiss。
- 回传必须走 OpenCode 官方 question reply / reject API。
- plan 完成后切 build 这类官方交互不能被吞掉。

### 12.6 Command / Slash UI

OpenCode 支持官方 command 系统和 slash command，包括项目内 `.opencode/commands/*.md` 自定义命令。

必须适配：

- 读取 `command.list` / `v2.command.list`。
- 输入框支持 `/` 命令选择，或提供等价 command palette。
- 执行命令走 `session.command`，不能把命令模板展开后伪装成普通 prompt。
- `!shell` 类直接命令如果要支持，也走 OpenCode 官方 `session.shell`。
- Wave 0-5 可以先做最小入口，但不能设计成永远无法接入。

### 12.7 Message part 映射

OpenCode message 不是旧的 `{ role, content }`。它是 message + parts。

`messageMapper.ts` 至少要支持：

- text
- reasoning
- file / attachment
- tool call / tool result
- subtask
- step-start / step-finish
- snapshot
- patch / diff
- agent switch
- retry
- compaction
- error / status
- model / agent metadata

Wave 2 可以先做最小卡片，但数据结构不能被压扁成纯文本，否则 Wave 3-5 会返工。

### 12.8 附件与拖拽文件

现有输入框、Finder 拖拽、图片附件不能继续走旧 `buildApiMessages`。

必须适配到 OpenCode Prompt：

```text
Prompt.FileAttachment {
  uri,
  mime,
  name
}
```

vision 能力由 OpenCode provider model `modalities` / `attachment` 控制。非 vision 模型不再走旧 `imageBridge` 主链路。

### 12.9 Agent / 模式映射

build / plan / general 必须映射到 OpenCode agent，而不是韭菜盒子自造 mode。

必须适配：

- 启动后读取 OpenCode `app.agents`。
- UI 模式选择只保存 agent id。
- 普通写作/剧本默认可走 general；编码任务再走 plan/build。

### 12.10 OpenCode 可执行文件与升级策略

开发期可以指向 `/Users/by3/Documents/1OKAPP/my-opencode`。发布前必须明确 OpenCode runtime 来源。

必须适配：

- 检测 `opencode` executable 是否可用。
- 记录 OpenCode version。
- 启动失败给出可恢复提示。
- 发布版可使用官方包/sidecar，但不能 fork core。
- 上游升级只影响 runtime 与 SDK 版本，不要求改韭菜盒子业务代码。

### 12.11 OpenCode config / auth 隔离

韭菜盒子不应污染用户个人 OpenCode CLI 配置。

必须适配：

- NewAPI provider config 通过 `OPENCODE_CONFIG_CONTENT` 注入。
- 必要时用 `OPENCODE_AUTH_CONTENT` 注入内存态 auth。
- 如需隔离数据库，可设置 `OPENCODE_DB`，但仍由 OpenCode 自己创建和迁移。
- 不直接修改用户 `~/.config/opencode`。

### 12.12 错误状态

Wave 2 不能只处理”成功返回”。

必须覆盖：

- OpenCode 未安装或不可执行。
- server 启动失败。
- 端口占用。
- NewAPI 未登录。
- model 不存在或不支持 tool/attachment。
- provider 鉴权失败。
- OpenCode permission 被拒绝。
- session abort。
- event stream 断开后重连。

离线/无网络降级：

- OpenCode server 本身应可在本地启动，不依赖 NewAPI 网络连通。
- NewAPI 未登录或 provider 鉴权失败时，UI 显示“API 未连接 / 模型不可用”。
- API 不通不阻塞查看 OpenCode 历史、旧会话归档、Skill 管理、知识库管理、创作面板已有作品浏览。
- 发送消息时若模型不可用，明确失败在当前消息卡片，不创建旧内核 fallback。

### 12.13 搜索与旧历史

全局搜索和第二列会话不能只改展示。

必须适配：

- OpenCode 新会话通过 OpenCode `session.list/search/messages` 查询。
- `sess_...` 旧会话只读归档。
- 搜索结果明确标记来源：OpenCode session / legacy archive / editor / vault。

### 12.14 官方能力保真边界

“保留官方能力”分两层：

1. **内核能力保真**：必须做到。只要不 fork OpenCode core，不手写 session/tool loop，不过滤官方 agent/tool/skill/permission/question/command/MCP 通道，OpenCode 的核心能力可以随上游升级保留。
2. **官方 TUI 操作体验保真**：Wave 0-5 不承诺 100%。OpenCode TUI 的 command palette、diff viewer、theme/help、MCP 管理、worktree、PTY、LSP、share、fork、revert、summarize、todo sidebar 等，需要在韭菜盒子 UI 中逐步补等价入口，或直接提供“打开官方 TUI / Web”的逃生入口。

因此，Wave 0-5 的验收口径是：

```text
OpenCode 官方内核能力不被破坏；
韭菜盒子 UI 先覆盖聊天、Skill、permission、question、command 的核心路径；
未覆盖的官方 UI 能力必须保持 API 可达，不能被连接层设计堵死。
```

### 12.15 P6 预留接口

Wave 0-5 不把主动工具、创作面板、画布塞进 OpenCode，但连接层要预留入口：

- OpenCode tool result 可以映射到媒体任务卡。
- 创作面板任务可以未来变成 OpenCode tool。
- Canvas `OpenCode Agent Node` 可以复用同一 `opencodeClient`。
- MCP、plugin、command、自定义 slash 命令以后可以逐步变成韭菜盒子工作台能力。

---

## 13. P6+ 延后方向

P6 以后再做：

1. 主动工具仓库升级为 OpenCode plugin/tool。
2. 创作面板能力工具化，让 OpenCode 可调用生图/视频/音频任务。
3. 画布新增 `OpenCode Agent Node`。
4. 知识库 Marketplace 化，与 Skill 仓库统一搜索/安装/启用。
5. Skill 仓库升级为类似 Agent Skills Marketplace 的体验。
6. OpenCode 工具调用结果与媒体作品库打通。

这些不进入 Wave 0-5，避免换芯阶段战线过长。

---

## 14. 完成定义

Wave 0-5 完成后，必须满足：

```text
旧聊天内核删除或不可达。
ChatPanel 默认且唯一使用 OpenCode。
连接层基于 OpenCode 官方 SDK。
NewAPI 登录态和 text model selector 可投影为 OpenCode provider config。
Skill 选择器可控制自动/固定 Skill。
现有 Skill 可被同步到 OpenCode 扫描目录。
知识库可作为 Skill references 被读取。
创作面板、画布、编辑区保持可用。
OpenCode 官方仓库仍可独立升级。
```

一句话验收：

```text
OpenCode 负责强 Agent，韭菜盒子负责把它关在一个好用、漂亮、可理解的工作台里。
```

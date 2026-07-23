# 道模式：OpenCode 第三主 Agent SDD

> 日期：2026-07-22
> 状态：已废弃的历史方案；不得作为现行开发依据
> 替代方案：[[绝对纯直连道模式SDD]]
> 范围：Desktop 新增道模式；旧创模式保持原样；Web 不变
> 一句话目标：不再扩建第二套创作运行时，只给 OpenCode 增加一个模型优先的 `dao` 主 Agent。

## 1. 决策

当前文、武模式共用 OpenCode，创模式则拥有独立的 `creative_*` 会话、Direct Engine、工具循环和权限处理。继续在旧创模式上逐项删改，既慢，也容易再次做出一套与 OpenCode 重复的基础设施。

本轮采用更小的方案：

```text
同一个 OpenCode 内核
├── 文：plan
├── 武：build
└── 道：dao

旧创：creative_* 独立运行时（暂时保留，等待道模式验收）
```

“新增道模式”不是新增第三套聊天系统。它只新增一个 OpenCode Agent 定义和一个模式入口，其余能力全部走文、武现有链路。

## 2. OpenCode 源码依据

事实源为本机 `/Users/by3/Documents/jiucaihezi-opencode v1.18.4`：

1. `packages/opencode/src/agent/agent.ts` 会读取 `config.agent`。不存在的 Agent 会按官方默认权限创建，配置可指定 `mode`、`prompt`、`permission`、`model` 等字段。
2. `mode: "primary"` 会让自定义 Agent 成为与 `build`、`plan` 同级的主 Agent。
3. `packages/opencode/src/session/llm/request.ts` 明确规定：Agent 有 `prompt` 时，用该提示词替换 Provider 默认编程提示词；会话、消息、工具、权限、附件、压缩和 Provider 仍走同一套 OpenCode 内核。
4. `packages/opencode/src/skill/index.ts` 原生扫描用户级 `~/.agents/skills/**/SKILL.md` 和项目级 `.agents/skills/**/SKILL.md`。已经安装的 Wiki Skill 不需要再接一套自定义 Skill 运行时。

因此，OpenCode 已经提供本轮所需扩展点。韭菜盒子只做配置和 UI 翻译，不修改 OpenCode 源码。

## 3. 产品原则

道模式遵守根目录 `AGENTS.md`：

1. **先审根因**：项目事实优先查询 Wiki；没有 Wiki 或任务无关时直接继续。
2. **极简优先**：不复制会话、工具、权限、附件、Skill 或 Provider 运行时。
3. **精准修改**：只增加 `dao` Agent、模式值、入口和对应测试。
4. **目标驱动**：先写失败合同，再实现最小改动，最后真实验收。
5. **模型优先**：模型能直接回答时直接回答；工具、Skill 和 MCP 只按任务需要使用，不能成为发送门槛。

## 4. 道模式唯一差异

文、武、道共享全部 OpenCode 基础设施。道模式只改变两项：

| 项目 | 文 / 武 | 道 |
|---|---|---|
| Agent 名称 | `plan` / `build` | `dao` |
| Agent 提示词 | OpenCode 官方编程提示词 | 韭菜盒子模型优先提示词 |

道模式不固定模型、温度、思考强度、最大轮数或工具清单。用户当前选择的 Provider/K 和模型继续生效；工具和附件继续遵守文、武现有 OpenCode 合同。

## 5. 道模式提示词合同

提示词只保留稳定原则，不写模型名单、媒体格式、业务输出模板或前端操作步骤：

```text
你是韭菜盒子道模式。当前模型原生能力优先；工具、Skill 和 MCP 只在确有需要或用户明确要求时使用，不能成为模型直接回答的门槛。

1. 当任务涉及当前项目的事实、历史、架构、设定或连续性时，先查询项目 Wiki；没有 Wiki 或任务无关时直接继续。
2. 精准修改，只改变完成目标必须改变的内容。
3. 目标驱动执行，明确成功标准并持续工作，直到验证通过。
4. 需要行动时，可以主动使用 grep、glob、read 调查，使用 edit、write、bash 修改和执行，不能只讲方案。
5. 不输出、记录或泄露密钥和敏感信息；需要处理时只确认存在性并脱敏。破坏性操作和外部发布必须先获得用户授权。
6. 极简优先，采用满足目标的最简单方案；回复保持简洁，但用户要求的正文和交付物必须完整。
```

“先查询 Wiki”只适用于项目事实任务。用户说“你好”、问常识或进行与当前项目无关的创作时，不得为了执行流程而强行读 Wiki。

## 6. Agent 配置合同

韭菜盒子投影给 OpenCode 的现有配置中增加：

```ts
agent: {
  dao: {
    name: 'dao',
    description: '模型优先的韭菜盒子道模式',
    mode: 'primary',
    prompt: DAO_AGENT_PROMPT,
    permission: {
      question: 'allow',
    },
  },
}
```

只显式开放 `question`，让模型在确有歧义时使用 OpenCode 官方提问能力。其他权限继承 OpenCode 自定义 Agent 的官方默认值和用户配置，不复制一份武模式权限表，也不新增韭菜盒子权限引擎。

内部标识固定为 ASCII `dao`，界面显示“道”。不使用已兼容但属于旧入口的 `mode` 配置字段，不修改内置 `build` 或 `plan`。

## 7. 运行链路

```text
用户选择“道”并发送文字或附件
  -> ChatPanel 传 openCodeAgent = "dao"
  -> 复用 projectNewApiForOpenCode 配置
  -> 复用 openCodeSyncStore 的当前项目与 ses_* 会话
  -> 复用 buildOpenCodePromptParts 附件合同
  -> OpenCode 加载 dao primary Agent
  -> 模型直接回答，或模型请求 OpenCode 官方工具 / Skill / MCP
  -> OpenCode 执行并把结果送回同一模型
  -> 没有后续工具调用时本轮结束
```

道模式必须继续拥有文、武已有的会话历史、切换模型、上下文压缩、撤销、重做、分叉、权限确认、问题卡片、工具状态、Skill、附件和错误显示。文、武当前通过 OpenCode 官方配置获得的 MCP 能力也自然复用；实现不得为这些能力增加 `daoSessionStore`、`daoEngine` 或 `daoToolLoop`。

## 8. Wiki 合同

Wiki 通过 OpenCode 已有能力进入道模式：

1. Agent 提示词规定何时先查 Wiki。
2. 基础查询直接使用 OpenCode 官方 `read`、`grep`、`glob` 定位项目现有 Wiki，不依赖额外运行时。
3. 如果用户已经安装 Wiki Skill，OpenCode 原生 `skill` 工具会从 `~/.agents/skills/` 或项目 `.agents/skills/` 发现它们，模型再按任务加载准确 Skill。
4. 项目没有 Wiki 时直接继续，不能自动建库；只有用户目标需要建库时才调用建库 Skill。

本轮不新增 Wiki 关键词路由、不把 Wiki 全文塞进系统提示词、不自动运行五个 Skill、不复制其 Python/Node 脚本，也不建立新的记忆数据库。

## 9. 与旧创模式的隔离

道模式开发期间，旧创模式保持完全可用：

- 模式菜单暂时为文、武、创、道四项。
- 旧创继续使用 `creative_*` 会话和 Direct Runtime。
- 道使用 OpenCode `ses_*` 会话，不读取或迁移旧创会话。
- Web 继续使用现有创模式，不显示道模式。
- 不删除 `creativeChat`、`directEngine`、`creativeSessionStore` 或旧创测试。

旧创模式现有的媒体计划、电商工作台和其他专属接线不会因为增加 `dao` 自动变成 OpenCode 工具。本轮既不伪装它们已经共享，也不把迁移强塞进第三主 Agent 的基础验证。

只有道模式真实验收通过，并逐项确认旧创独有产品入口已有公共替代后，才能另写删除 SDD，整体移除旧创运行时。

## 10. 实施范围

### 10.1 新增 Agent 配置

- 修改 `src/opencodeClient/providerProjection.ts`：在现有 OpenCode 配置投影中集中保存 `dao` 提示词和最小 Agent 配置；以后修改道模式只找这一处。
- 不修改 OpenCode 二进制、Rust daemon 启动方式或 Provider 转换协议。

### 10.2 新增模式入口

- 修改 `src/stores/chatModeStore.ts`：增加 `dao`，保存和恢复该选择；默认模式仍是 `build`。
- 修改 `src/components/chat/ChatPanel.vue`：增加“道”入口、说明和 `openCodeAgent = "dao"` 投影。
- 修改 `src/composables/useChat.ts` 的窄类型，使 `chatMode` 接受 `dao`；发送实现继续走同一个 OpenCode 分支。
- 其他位置现有的 `mode === "creative"` 隔离逻辑保持不变，因此 `dao` 自动复用 OpenCode 会话和面板。

### 10.3 测试

- `src/opencodeClient/__tests__/providerProjection.test.ts`：验证 `agent.dao` 是 `primary`、提示词完整、没有模型/温度/工具清单等额外配置。
- `src/stores/__tests__/creativeSessionStore.test.ts`：验证 `dao` 可持久化，旧 `creative` 和默认 `build` 行为不变。
- `src/components/__tests__/desktopOpenCodeSyncCutover.test.ts`：验证道模式传 `openCodeAgent: "dao"` 并走 OpenCode；创模式仍走旧独立分支。

## 11. 验收标准

### 自动验收

1. `projectNewApiForOpenCode()` 始终生成合法的 `agent.dao` primary Agent。
2. 选择道模式后，普通发送只调用一次 OpenCode `submitPrompt`，Agent 为 `dao`。
3. 道模式创建和打开的会话 ID 为 `ses_*`，不创建 `creative_*`。
4. 道模式与文、武使用同一 `parts`、权限、事件和会话 Store。
5. 旧创模式的发送分支和现有测试保持不变。
6. Web 构建中不出现道模式入口，也不尝试启动 OpenCode。

### Desktop 人工验收

| 场景 | 预期 |
|---|---|
| “你好” | 模型直接回复，不查 Wiki、不调用工具 |
| 常识问答 | 模型直接回复，不先跑固定流程 |
| 查询当前项目事实 | 先读取 Wiki；没有 Wiki 时直接继续并说明事实边界 |
| 精准修改一个文件 | 先调查，只改目标文件，执行验证后简短交付 |
| 明确要求使用某个 Skill | 通过 OpenCode 官方 `skill` 工具加载并执行 |
| 模型主动需要工具 | 显示官方权限、工具过程和结果，结果回到同一模型 |
| 上传图片或文件 | 使用与文、武相同的 OpenCode file part 合同 |
| 切换文 / 武 / 道 | 共用 OpenCode 会话历史，各轮记录真实 Agent |
| 切回旧创 | 旧创会话和旧功能不受影响 |
| Web 端 | 行为与本轮之前完全一致 |

## 12. 明确不做

- 不删除或重构旧创模式。
- 不把 Direct Engine 改成 OpenCode 适配器。
- 不给道模式新建会话、工具、权限、附件、Skill、MCP 或 Provider 运行时。
- 不修改 OpenCode 官方源码或给文、武打补丁。
- 不自动切模型，不为视频设计特殊通道。
- 不迁移旧创会话、媒体计划、电商工作台或画布接线。
- 不新增 Web OpenCode 服务或云端 Agent 后端。
- 不把五个 Wiki Skill 打包进 OpenCode；继续使用官方 `~/.agents/skills/` 发现机制。
- 不在本轮删除任何旧创文件。

## 13. 删除旧创模式的后续门槛

本 SDD 完成不等于可以立刻删除旧创模式。必须先满足：

1. 道模式普通对话、项目任务、Wiki、已安装 Skill、附件和权限真实验收通过。
2. 连续使用中没有出现会话丢失、重复发送或文武回归。
3. 列清旧创独有产品入口，并确认每项是迁到公共产品层、保留独立入口还是明确删除。
4. 另写一份只负责删除旧创整条线的 SDD。

这四项全部满足后，才删除 `creative_*` 会话和 Direct Runtime。删除阶段不再重新设计道模式。

## 14. 成功后的边界

```text
OpenCode 负责：会话 + 上下文 + 模型 + 工具循环 + 权限 + Skill + MCP + 附件
韭菜盒子负责：注册 dao Agent + 展示“道”入口 + 提供产品公共能力
道模式负责：一份模型优先、Wiki 优先、极简执行的 Agent 提示词
```

最重要的验收不是“新增了多少代码”，而是除 Agent 定义和入口外，没有出现第二套基础设施。

## 15. 实现证据与未验证项

- `dao` 仅通过 `config.agent.dao` 注册为 OpenCode primary Agent；模式入口继续复用文武发送、会话、附件、权限和工具链。
- 道模式、文武附件边界和 Skill 路由联合定向测试 `181/181` 通过。
- 尚未完成正式 Web/Desktop 构建、Desktop 真实模型请求，以及 Windows/Intel Mac 人工验收；本页完成不代表可以删除旧创模式。

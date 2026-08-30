# 通用记忆工作台 OpenClaw 能力借鉴与 WikiAgent 适配计划

> 日期：2026-08-30  
> 分支：`codex/0830-skill-first-agent`  
> 状态：计划冻结，按阶段实施

## 1. 结论

以现有 WikiAgent 为底盘，不复制 OpenClaw 的完整 Runtime，也不新建第二套
Agent。OpenClaw 只作为成熟约束的参考来源；每项借鉴都必须落到现有模块、最小
差异和可执行测试上。

```text
现有 WikiAgent 循环与工具
+ OpenClaw 的成熟上下文、Skill、工具和安全约束
-> 一个 Skill-first Agent
```

## 2. 复制、借鉴、保留、排除

| 分类 | OpenClaw 来源 | 韭菜盒子处理 |
|---|---|---|
| 借鉴 | `src/agents/system-prompt.ts`、`system-prompt.types.ts` | 借鉴首轮上下文分段和稳定/动态边界；实现到现有 `directMessageBuilder`，不复制完整文件 |
| 借鉴 | `src/skills/loading/*` | 借鉴名称校验、来源优先级、冲突诊断、快照和资源路径规则；复用现有 `skillContentResolver` 与 `SkillConfig` |
| 借鉴 | `src/agents/tool-policy*.ts`、`agent-tools.before-tool-call*.ts` | 借鉴白名单、参数校验、执行前后钩子和审批顺序；复用现有 `memoryToolPolicy`、`directTools` |
| 借鉴 | `src/agents/tool-search*.ts` | 借鉴目录、描述、搜索和结果绑定；接入现有 Wiki 文件、MCP、媒体、3D、Terminal 工具 |
| 对照增强 | `packages/agent-core/src/agent-loop.ts` | 只逐项对照取消、Observation 配对、重复调用保护、请求上限和并发顺序；现有 `runDirectChatCompletion` 仍是实现主体 |
| 保留 | 韭菜盒子 `wikiRuntime`、模型传输、工具执行和 UI | 不替换，不搬运 OpenClaw 对应产品实现 |
| 排除 | `embedded-agent-runner`、Workspace、Memory、渠道、Gateway、多 Agent、调度、沙箱 | 不进入产品运行链路 |

只有在现有实现缺少某个必要行为，并且无法通过复用已有 helper 解决时，才允许
复制 OpenClaw 的小段通用代码。复制或实质改写的代码必须保留 MIT 版权声明，并
登记到 `THIRD_PARTY_NOTICES.md`。

## 3. 适配顺序

### SA1：首轮上下文和统一路由

目标：解决 `Skill + Wiki` 失败的根因。

- 选中的 Skill 首轮注入完整 `SKILL.md`。
- 选中 Wiki 时首轮预读 `wiki/index.md`。
- `Skill + Wiki` 走统一工具循环，只有 Wiki-only 保留兼容两阶段路径。
- 无 Skill 时不加载 Skill，不改变普通对话行为。

验收：无 Skill、仅 Skill、仅 Wiki、Skill + Wiki 四种组合均能完成首轮请求；
本地模型和云端模型都必须真实记录请求结果。

### SA2：Skill 装载规则

目标：让 Skill 成为最高任务规则，同时保持程序安全边界。

- 复用现有本地/云端 Skill 读取。
- 增加名称、描述、同名冲突和资源路径校验。
- 选中 Skill 必须加载；未选中 Skill 不由模型隐式扩权。
- Skill 引用的 references、scripts、assets 按需读取。

验收：Skill 加载失败、同名冲突、资源越界和多 Skill 组合都有可见诊断。

### SA3：统一工具白名单和 Tool Search

目标：工具多时可发现，工具调用仍由程序授权。

- 直接展示少量核心工具：`wiki_context`、必要回复工具。
- 其他 Wiki 文件工具、MCP、媒体、3D、Terminal 进入目录。
- 流程为 `tool_search -> tool_describe -> tool_call`。
- 未注册、未授权、参数不合法的调用不执行，并返回真实 Observation。
- MCP 在授权层按服务器管理，在调用层保留具体 operation schema。

验收：搜索结果只能绑定当前运行中的工具实例；跨会话或伪造工具 ID 不可调用。

### SA4：Agent Loop 定向增强与清理

目标：只吸收 OpenClaw 已证明有价值的循环保护，不重写现有循环。

- 对照并补齐取消收口、Observation 配对、重复调用保护、请求上限和并发顺序。
- `runMemoryChat()` 切换到统一 Skill-first 路径。
- 新路径通过回归后删除 `runWikiTwoPhase`、`wikiPlans` 和 File Agent 用户模式。
- 保留底层文件能力，供 Wiki、Skill 和其他工具使用。

验收：现有定向回归、四种能力组合、本地/云端模型和 Desktop/Web/Mobile 矩阵通过。

## 4. 每阶段工作方式

每个阶段只做四件事：

1. 读取对应 OpenClaw 源码和测试，记录要借鉴的具体行为。
2. 在现有模块中寻找可复用实现，避免新增抽象。
3. 先增加最小回归测试，再改适配代码。
4. 通过后更新本文件的状态，不跨阶段提前清理旧代码。

## 5. 完成标准

- 产品只有一个 Agent，Skill 是规则，Wiki 是事实和工作目录。
- 所有工具都由程序注册和白名单控制。
- 现有 Wiki、媒体、3D、MCP、Terminal 能力没有减少。
- OpenClaw 只留下必要的行为借鉴和合法归属记录。
- 没有第二套隐式 Agent、固定 JSON 协议或重复工具编排。

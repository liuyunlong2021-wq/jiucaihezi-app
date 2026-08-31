# 通用记忆工作台 WikiAgent 统一路由与白名单 TDD-1

> 日期：2026-08-30
> 状态：阶段 1-3 已实施；真实模型、MCP 连接和跨平台组合仍待验收
> 范围：唯一 WikiAgent 的能力路由、工具暴露、白名单校验和拒绝回执
> 前置：[[通用记忆工作台WikiAgent索引渐进读取与确定性事务规范-2026-08-29]]、[[通用记忆工作台SkillAgent完整规则与渐进披露规范-2026-08-29]]

## 0. 决策

产品只有一个 Agent：`WikiAgent`。所有记忆工作台请求都进入同一条 `runMemoryChat` 路由；文件、Wiki、媒体、3D、Terminal 和 MCP 只是工具能力，不创建并列 Agent、独立循环或第二套任务协议。

Skill 是最高业务规则层，决定方法、步骤、格式和质量标准。程序安全约束始终优先：路径、授权、连接、审批、费用、事务、回滚和真实回执不能被 Skill、Wiki 内容或模型文本覆盖。

本 TDD 只改统一路由和白名单边界。Wiki 的索引渐进读取与一次 `wiki apply` 继续由现行 WikiAgent 规范负责；工具的领域实现继续复用现有 Runtime。

## 1. 根因与目标

当前 `selectMemoryTools()` 存在三个根因：

1. 选中任意 Skill 会把几乎全部工具暴露给模型，破坏“显式选择、最小上下文”。
2. 文件、3D 和 MCP 的选择集合与实际工具不完整或边界不一致：文件漏 `move/delete`，3D 只暴露创建，MCP 目录仍含不允许的 Obsidian。
3. `wikiOnlyTask`、`MemoryProgramStatus` 和工具拒绝路径没有统一体现“一个 WikiAgent、真实 Observation/Receipt”的合同。

目标是让程序在模型请求前确定不可扩大的能力集合，模型只能看到该集合内的 schema；任何越权、未连接、未暴露或不存在的工具都返回真实拒绝结果，不执行副作用。

## 2. 统一路由合同

### 2.1 路由输入

继续复用 `MemoryChatInput` 的现有选择字段：

- `wikiSelected`
- `selectedSkillNames`
- `fileToolsSelected`
- `selectedMcpToolNames`（兼容输入；授权按所属 MCP 整体判断）
- `mediaSelected`
- `scene3dSelected`
- `terminalSelected`
- 明确需要读取的附件

程序先解析用户选择，再加载 Skill 内容和连接状态；模型不能返回新的 Agent、能力或授权集合来扩大路由。

### 2.2 四种基本状态

| 状态 | 默认暴露 | 禁止 |
| --- | --- | --- |
| 无 | 空工具集合；只发送当前消息和明确附件正文 | 读取 Wiki、加载 Skill、读取历史、执行 `wiki apply` |
| Wiki | `wiki_context`、`wiki` | 通用文件写入、媒体、3D、Terminal、未选 MCP |
| Skill | 选中的完整 `SKILL.md`；默认不自动暴露工具 | 因 Skill 被选中而全量开放工具；加载其他 Skill |
| Wiki + Skill | Wiki 工具 + 选中 Skill；先证据闭包，后 Skill 处理 | 证据阶段创作或执行副作用 |

Skill 明确声明需要 Wiki 或其他工具时，程序只能在该能力已连接、已授权且平台可用时加入对应集合；Skill 不能自行连接、注册工具或扩大权限。没有明确声明时，Skill-only 不读取 Wiki。

### 2.3 工具白名单

白名单按 WikiAgent 工具名维护，实际暴露集合由“用户选择 + Skill 要求 + 连接状态 + 平台能力”交集确定：

| 能力 | 工具范围 |
| --- | --- |
| Wiki | `wiki_context`、`wiki` |
| 文件 | `read`、`glob`、`grep`、`write`、`edit`、`mkdir`、`move`、`delete` |
| 媒体/文档 | 现有 `create_document`、`create_html`、`export_markdown_png`、`export_markdown_slides` 及已注册媒体工具 |
| 3D | `create_3d_scene`、`edit_3d_scene`、`export_3d_scene_video`（平台支持时） |
| Terminal | `terminal`（平台支持且用户授权时） |
| MCP | 仅 `GitHub`、`Playwright`、`韭菜盒子创作` 三个整体连接的已注册工具 |

白名单只决定模型可见性，不替代执行前校验。每个调用仍须通过既有 schema、项目路径、用户授权、审批、费用、连接和平台权限校验。Wiki 写入只能进入 `wiki apply`，不能用 `write/edit/delete` 绕过事务。

### 2.4 Skill 规则优先级

选中 Skill 后：

1. Skill 覆盖 WikiAgent 的默认业务方法、输出格式和质量说明。
2. Skill 不能覆盖工具 schema、路径边界、授权、审批、费用、事务、回滚或平台权限。
3. Skill 不能隐式加载其他 Skill；`skill` 工具不向已选 Skill 的模型循环暴露。
4. 证据阶段只依据 Skill 判断所需资料；证据闭包完成后才生成最终答案和工具动作。

### 2.5 MCP 整体授权

MCP 的授权、连接状态和用户展示单位是 MCP 整体，而不是内部单个接口。现有 `selectedMcpToolNames` 只作为兼容路由输入：程序先解析工具所属 MCP，再按 MCP ID 校验连接和授权；未知工具、未知 MCP 或未连接 MCP 一律拒绝。不得把 MCP 内部接口拆成独立 Agent、独立授权对象或隐式跨 MCP 调用。

## 3. TDD 实施阶段

每阶段先写红灯，红灯复现根因后才实现；阶段门禁失败就停止，不增加兼容分支掩盖边界错误。

### 阶段 1：统一 WikiAgent 路由

**红灯**（`src/runtime/memory/__tests__/memoryToolRouting.test.ts`）：

- 普通消息的工具集合为空，且不加载历史、Wiki 或 Skill。
- Wiki-only 只暴露 `wiki_context` 和 `wiki`。
- Wiki + Skill 仍走 Wiki 证据阶段；不会因 Skill 被选中而绕过 `runWikiTwoPhase`。
- 所有能力组合都只进入 `runMemoryChat`，不存在 File/Media/3D/MCP 独立循环。

**实现**：

- 收敛 `runMemoryChat` 的能力判断和 `wikiOnlyTask` 条件，Skill 不能误触发全工具路径。
- 复用现有 `selectMemoryTools()`，只修正其路由输入和输出，不新增 Agent registry、TaskEnvelope 或 Provider。
- 保持无能力请求的单次模型请求和当前附件语义。

**门禁**：路由矩阵测试全绿；请求快照能证明每个状态只收到规定的工具定义。

### 阶段 2：最小白名单与 MCP 整体边界

**红灯**：

- 选中 Skill 不再暴露所有当前工具，也不暴露 `skill`。
- 文件选择包含 `move/delete`；未选择文件时两者不可见。
- 3D 选择包含创建、增量编辑和视频导出；Web 不暴露 Desktop-only 工具。
- 选中 MCP 只允许已连接的 GitHub、Playwright 或韭菜盒子创作工具；Obsidian 和未知 MCP 被拒绝。
- 模型请求不在可见集合中的工具时，执行器返回明确拒绝 Observation，且不调用底层 Runtime。

**实现**：

- 在现有工具定义集合上修正 `selectMemoryTools()` 的最小集合。
- 在 MCP catalog/bridge 边界过滤允许的三个整体 MCP；不复制 MCP 工具 schema。
- 保持 Web/Desktop 现有平台差异；平台不支持的工具不进入模型 schema。

**门禁**：白名单集合、平台过滤、未知工具拒绝和“拒绝不产生副作用”测试全绿。

### 阶段 3：统一真实状态回执

**红灯**：

- Wiki、文件、媒体、3D、Terminal 和 MCP 的失败、取消、空结果都回传真实 Observation。
- 模型文本中的“已完成”不能生成成功状态卡。
- 工具拒绝、未连接和未授权均产生失败 Receipt，且保留已生成的模型答案。
- `MemoryProgramStatus` 不再把所有状态伪装成 `kind: 'wiki'`。

**实现**：

- 复用现有 `DirectToolResult`、`normalizeMemoryToolResult`、`onProgramStatus` 和工具执行器。
- 将状态类型扩展为实际能力/工具来源，保持 UI 只消费程序回执。
- 不增加第二套 Receipt JSON；每个工具继续返回其既有真实结果，Wiki 写入仍最多一次 `apply`。

**门禁**：失败/取消/部分成功测试全绿；状态卡与模型答案分离；无成功伪报。

## 4. 测试矩阵

| 场景 | 预期结果 |
| --- | --- |
| 普通消息 | 空工具、无 Wiki/Skill/历史注入、一次模型请求 |
| 仅 Wiki | 仅 Wiki 工具；按索引渐进读取；必要时一次 `wiki apply` |
| 仅 Skill | 仅选中 Skill 规则；无 Wiki，除非 Skill 明确要求；不全量开放工具 |
| Wiki + Skill | 先证据闭包，再按 Skill 处理；工具动作走白名单 |
| 仅文件 | 文件工具最小集合；路径和写后验证由程序负责 |
| 仅媒体/3D/Terminal | 只暴露所选能力且遵循平台和审批边界 |
| 仅 MCP | 只允许三个整体 MCP 中已连接者；未知工具真实拒绝 |
| Skill + 未选能力 | 返回缺少能力/连接，不自动扩权 |
| 模型伪造工具结果 | 丢弃伪造字段，保留程序真实 Observation |
| 任一工具失败或取消 | 保留答案；状态卡显示真实失败/取消和执行范围 |

## 5. 文件与实现映射

| 责任 | 当前入口 | TDD-1 动作 |
| --- | --- | --- |
| 统一路由 | `src/runtime/memory/memoryChat.ts` | 收敛能力判断、Wiki 分支和工具选择 |
| 工具集合 | `selectMemoryTools()` | 最小白名单、Skill 不全量开放、补齐文件/3D工具 |
| 工具 schema/参数 | `src/runtime/direct/creativeToolContract.ts` | 复用现有定义和参数校验 |
| Wiki 循环 | `src/runtime/memory/wikiTwoPhase.ts` | 只修路由进入条件；不重写 Wiki 协议 |
| MCP 整体目录 | `src/data/mcpCatalog.ts`、MCP bridge | 只保留三个允许的整体 MCP，拒绝未知/未连接者 |
| 状态回执 | `DirectToolResult`、`MemoryProgramStatus`、UI 状态卡 | 统一真实失败/取消/部分成功展示 |
| 回归测试 | `src/runtime/memory/__tests__/memoryToolRouting.test.ts` 及对应 Runtime tests | 先红后绿，覆盖本 TDD 全部门禁 |

## 6. 禁止事项

- 创建 `FileAgent`、`MediaAgent`、`3DAgent` 或 `MCPAgent`。
- 选中 Skill 后把所有工具一次性暴露给模型。
- 让模型返回的能力集合覆盖程序解析出的用户授权集合。
- 用关键词、工具名或 Skill 内容隐式连接 Wiki、MCP、媒体、3D 或 Terminal。
- 将 MCP 内部工具拆成独立用户授权或跨 MCP 自动调用。
- 通过普通文件工具修改 Wiki 正文、入口、来源或日志以绕过 `wiki apply`。
- 用模型文本、空结果或未连接状态伪造成功 Receipt。
- 为本 TDD 新增第二套 Provider、模型循环、审批器、文件服务或任务外壳。

## 7. 完成定义

1. 所有任务只有一条 WikiAgent 路由，四种 Wiki/Skill 状态行为可测试且无误扩权。
2. 模型只看到当前任务允许的白名单工具；未知、未暴露、未授权工具在执行前被拒绝。
3. 文件、媒体、3D、Terminal 和 MCP 复用现有 Runtime；MCP 只保留三个整体连接。
4. Skill 只改变业务规则，不覆盖程序安全约束，不自动加载其他 Skill。
5. 失败、取消、空结果和部分成功均有真实 Observation/Receipt，答案不被删除。
6. `memoryToolRouting`、相关 Runtime focused tests、TypeScript 和对应平台门禁通过；未执行的真实模型、MCP 连接和跨平台组合明确标为未验证。

## 8. 实施记录

### 已完成

- 阶段 1：`selectMemoryTools()` 不再因选中 Skill 全量开放工具；Wiki、文件、3D 和普通任务路由矩阵已锁定。
- 阶段 2：文件白名单补齐 `move/delete`；3D 白名单补齐编辑和视频导出；WikiAgent 只接受 GitHub、Playwright、韭菜盒子创作三个整体 MCP；Obsidian 从内置目录移除；不可见工具在执行前返回 `TOOL_NOT_ALLOWED`。
- 阶段 3：`MemoryProgramStatus` 按 Wiki、文件、媒体、3D、Terminal、MCP 区分；UI 状态卡按能力展示真实成功、失败和取消，不采信模型文本。
- 回归：`memoryToolRouting`、MCP bridge、MCP 面板、MemoryWorkbench focused 测试通过；完整 focused 测试 1223 项通过；`vue-tsc -b` 通过。

### 待验收

- 真实模型工具调用、三个 MCP 的真实连接和授权矩阵。
- Desktop、Web、Mobile 的真实组合及付费媒体执行。
- Desktop、Web、Mobile 对应平台人工验收。

## 反向链接

- [[CLAUDE]]
- [[hot]]
- [[通用记忆工作台WikiAgent索引渐进读取与确定性事务规范-2026-08-29]]
- [[通用记忆工作台SkillAgent完整规则与渐进披露规范-2026-08-29]]

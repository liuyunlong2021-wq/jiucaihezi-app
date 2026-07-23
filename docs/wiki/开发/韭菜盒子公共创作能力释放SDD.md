# 韭菜盒子公共创作能力释放 SDD

> 日期：2026-07-22
> 状态：Phase 1 媒体公共能力已实施；Wiki 脚本产品化仍按独立阶段推进
> 并行前提：与 [[开发/文武道模式OpenCode-v1.18.4官方对齐升级SDD]] 分支并行，但不得交叉修改 OpenCode 基础链路
> 依据：`AGENTS.md`、[[架构/产品架构]]、[[开发/韭菜盒子原生媒体编排能力SDD]]、[[开发/Wiki四Skill产品化升级SDD]]

## 1. 一句话目标

把已经存在于创模式、创作面板和 Wiki Skill 中的确定性产品能力整理到韭菜盒子公共产品层；创模式、文武道和 UI 只保留薄入口，共用同一份业务实现。

本轮不重写 OpenCode、不重写旧创模式，也不一次迁移所有能力。先释放媒体生成能力，验证公共合同成立；再单独释放五个 Wiki Skill 的脚本能力。

> 现行事实（2026-07-23）：媒体公共合同已经实施。媒体入口统一经 `preparePublicMediaPlan()`、`CreationPanel` 与 `mediaTaskStore`；后续制作工作台只能调用该合同，不得复制提交、轮询、落盘或媒体 API。

## 2. 根因

韭菜盒子已经有成熟能力，但入口和能力归属没有完全分开：

- `CreationPanel + mediaTaskStore` 已经是统一媒体任务引擎，聊天仍需要通过创模式专属计划接线进入它。
- `mediaPlan`、`mediaReference` 和项目文件服务已经包含可复用业务规则，但部分编排仍由 `ChatPanel` 协调。
- 五个 Wiki Skill 同时包含工作流说明和确定性脚本；脚本没有成为随 App 可用的产品运行时能力。
- 文武道可以使用韭菜盒子公共产品能力，但这些能力不能塞进 OpenCode 内核，也不能复制成另一套实现。

根因不是“缺更多工具”，而是公共业务核心与各模式入口之间缺少稳定的薄合同。

## 3. 目标架构

```text
韭菜盒子公共产品能力
├── 媒体：计划校验 / 素材引用 / 提交 / 任务状态 / 结果落盘
├── Wiki：建库 / 查询 / 填充 / 修正 / 巡检的确定性脚本
├── 项目资源：文件、画布素材和工作台动作
└── 既有 MCP：连接、工具发现和执行

创模式 Direct Runtime ──薄适配器──┐
文武道 OpenCode       ──Tool/MCP───┼──> 同一公共能力
Vue UI                ──直接调用────┘
```

约束：

1. 业务规则只保留一份。
2. 模式适配器只转换输入、输出和运行时事件，不实现业务规则。
3. OpenCode Tool/MCP 只是调用入口，不拥有媒体、Wiki 或项目资源状态。
4. 创模式继续模型优先；公共能力不能成为普通模型请求的前置门槛。
5. 文武道继续遵循 OpenCode 官方 Agent 循环；公共能力作为可调用工具进入，不修改循环。
6. UI 继续可以直接使用公共能力，不需要经过模型。

## 4. 能力清单与处理决定

| 现有能力 | 当前事实来源 | 释放方式 | 本 SDD 顺序 |
|---|---|---|---|
| 生图、生视频、付费确认和任务恢复 | `CreationPanel`、`mediaTaskStore`、Creation 注册表 | 提炼无 UI 的提交合同；所有入口复用 | 第一阶段 |
| 项目、本轮附件、画布、最近任务素材引用 | `mediaReference`、`ProjectFileService`、`mediaTaskStore` | 保持现有资源身份，提供统一引用合同 | 第一阶段 |
| 媒体计划校验与提交桥 | `mediaPlan`、`mediaPlanBridge` | 作为公共纯逻辑保留，不复制到模式适配器 | 第一阶段 |
| Wiki 建库、查询、填充、修正、巡检脚本 | 五个 Wiki Skill 的受控脚本 | 脚本迁入产品运行时；Skill 只保留方法和触发说明 | 第二阶段，另设门禁 |
| 文件树、画布和电商工作台动作 | 现有 Vue 入口与项目服务 | 只暴露已有确定性动作，不把组件变成工具 | 后续按真实需求逐项接入 |
| MCP | `mcpStore`、`mcpClient`、`mcpBridge` | 继续共用现有实现 | 不重做 |

“释放”不等于让每个模式默认加载全部工具。能力只有在当前运行时、模型和用户任务需要时才作为候选入口；模型原生可以完成的请求仍可直接完成。

## 5. 两条并行支线的硬边界

### 5.1 支线 A：OpenCode v1.18.4 官方对齐

建议分支：`feat/opencode-v1.18.4-alignment`

只负责：

- sidecar 生命周期和发送热路径；
- OpenCode SDK/runtime v1.18.4；
- 文武道会话工作区、Provider、variant、输入和上下文；
- OpenCode 官方行为的测试与验收。

禁止：

- 迁移媒体或 Wiki 业务逻辑；
- 修改旧创模式 Direct Runtime；
- 为公共能力增加临时 OpenCode 私有实现。

### 5.2 支线 B：公共创作能力释放

建议分支：`feat/public-creative-capabilities`

第一阶段只负责：

- 划清现有媒体核心、UI 协调和模式适配边界；
- 把仍在 `ChatPanel`/创模式入口中的确定性媒体业务规则移到现有 `src/runtime/workbench/` 或已有服务；
- 让创模式和 UI 继续通过薄入口调用同一份能力；
- 为公共合同补纯逻辑和回归测试。

禁止：

- 修改 `src/opencodeClient/`、OpenCode session/store/sidecar、SDK 或 runtime 版本；
- 给文武道增加最终 Tool/MCP 接线；
- 改写 `mediaTaskStore` 已有提交、轮询、落盘和恢复语义；
- 在第一阶段迁移 Wiki 脚本；
- 删除旧创模式或旧 Skill。

### 5.3 文件冲突规则

| 区域 | 支线 A | 支线 B |
|---|---:|---:|
| `src-tauri/src/commands/opencode.rs` | 可改 | 禁止 |
| `src/opencodeClient/` | 可改 | 禁止 |
| OpenCode SDK/runtime 配置 | 可改 | 禁止 |
| `src/runtime/direct/` | 禁止 | 仅薄适配所需的精准修改 |
| `src/runtime/workbench/` | 原则上禁止 | 可改 |
| `src/stores/mediaTaskStore.ts` | 禁止 | 仅公共合同无法复用时精准修改 |
| `src/components/creation/` | 禁止 | 仅移除业务规则、改为调用公共合同 |
| `src/components/chat/ChatPanel.vue` | 禁止，除非 A 的官方输入接线确实需要 | 仅媒体薄接线；发生交叉时暂停并拆分提交 |
| `public/skills/jc-*-wiki/` | 禁止 | 第一阶段禁止 |

两条支线发现必须修改同一文件时，不能各自解决。先确定该改动属于 OpenCode 基础链还是公共产品层，再只交给对应支线。

## 6. Phase 1：释放媒体公共能力

### 6.1 目标合同

公共媒体入口只接收应用拥有的数据：

```ts
interface PublicMediaPlanRequest {
  plan: MediaPlan
  owner: ProjectOwner
  sessionId?: string
}

interface PublicMediaPlanResult {
  plan: MediaPlan
  submission: CreationSubmission
}
```

具体类型必须优先复用现有 `MediaPlan`、项目 owner 和 Creation 提交类型。实施时如果现有函数已满足合同，不新增同义接口。

公共入口负责：

1. 刷新并验证素材引用；
2. 根据现有 Creation 注册表校验模型和参数；
3. 生成现有 `mediaTaskStore.submitTask()` 能接收的提交数据；
4. 返回结构化错误，让各入口按自己的 UI 展示。

公共入口不负责：

- 理解自然语言；
- 决定模型何时调用能力；
- 渲染确认卡；
- 新建媒体 API、队列、Store、轮询器或落盘路径；
- 绕过用户确认直接创建付费任务。

### 6.2 入口关系

```text
创模式模型形成计划 -> Direct 薄适配器 -> 公共媒体合同
创作面板手动操作   -> UI 薄适配器     -> 公共媒体合同
电商工作台计划     -> 现有桥接         -> 公共媒体合同
```

本阶段不接文武道。文武道接线必须等支线 A 和 B 都合并后执行。

### 6.3 验收

- 创模式现有生图、生视频、参考素材和确认卡行为不变。
- 创作面板和电商工作台仍进入同一个 `mediaTaskStore`。
- 同一无效媒体计划从不同入口得到同一种业务错误，不各写校验。
- 没有安装媒体 Skill 时，现有产品媒体能力仍可用。
- 不新增第二套任务、轮询、下载、落盘或项目资源实现。
- Desktop 与 Web 继续遵循现有项目 owner 和资源读取边界。

## 7. 合并后的最小接线

只有支线 A、B 都完成并分别通过门禁后，才从最新 `main` 创建第三个短分支：

建议分支：`feat/opencode-public-capability-adapter`

该分支只做：

1. 把公共媒体动作投影成 OpenCode 可发现的 Tool/MCP 定义；
2. 将 OpenCode 工具参数转换为公共媒体合同；
3. 把结果和错误按 OpenCode 官方 part/event 合同回传；
4. 复用现有权限和付费确认，不建立第二套审批；
5. 验证文、武、道共用同一工具入口。

禁止修改 OpenCode Agent 循环、Provider 转换或公共媒体业务规则。如果接线必须修改这两层，说明 A 或 B 的合同仍不完整，应回到对应层修正，不能在适配器里补丁。

## 8. Phase 2：释放 Wiki 脚本能力

媒体公共合同真实验收通过后，再实施 Wiki；不得与 Phase 1 混成一个大提交。

目标：

- 把五个 Wiki Skill 依赖的确定性 Python/Node 脚本放入 App 可定位、可打包、可跨平台执行的产品运行时目录；
- Skill 保留触发条件、工作流程、判断标准和回复规范；
- 创模式和文武道通过各自薄入口调用同一脚本；
- App 升级脚本时不要求用户重新安装 Skill；用户删除 Skill 不会删除产品运行时脚本。

实施前必须另写脚本清单和三平台依赖矩阵。没有完成 Windows、Intel Mac、Apple Silicon 的路径与解释器验证前，不能宣称正式安装包可用。

明确不做：

- 不把整个 Skill 文案硬编码进产品；
- 不复制五套 Wiki 文件读写逻辑；
- 不让脚本直接绕过项目 Wiki 根目录和写权限；
- 不在媒体 Phase 1 中顺手迁移 Wiki。

## 9. 测试和回归门禁

每个行为修改先有能失败的测试，再做最小实现。

支线 B 最少验证：

- `mediaPlan`、`mediaReference`、`mediaPlanBridge` focused tests；
- `mediaTaskStore` 与 Creation 提交回归；
- 创模式媒体计划和普通文本请求回归；
- Web/Desktop 项目 owner 与素材越界回归；
- `vue-tsc -b`、相关 focused tests、`pnpm run build:desktop`、`git diff --check`。

真实人工验收：

1. 创模式生成图片；
2. 引用刚生成图片继续生成视频；
3. 创作面板手动生成同类任务；
4. 无效素材、切项目和拒绝付费时不提交；
5. 文武道在最终接线前行为完全不变。

## 10. 提交与合并顺序

```text
共同基线提交
├── A: feat/opencode-v1.18.4-alignment
└── B: feat/public-creative-capabilities

A 独立验证并合并
B 独立验证并合并
-> main 全量回归
-> C: feat/opencode-public-capability-adapter
-> 文武道真实工具调用验收
-> 更新 Wiki
```

A、B 谁先完成都可以，但必须分别合并，禁止把两个分支互相 merge 后再一次性进入 `main`。最终 C 必须基于两者已合并后的最新 `main`。

## 11. 完成标准

本 SDD 第一阶段完成必须同时满足：

1. 媒体业务规则只有一份公共实现；创模式和 UI 只是入口。
2. 现有创模式、创作面板和电商工作台行为不退化。
3. 支线 B 未修改 OpenCode 基础链路。
4. 支线 A 未承载公共媒体或 Wiki 业务实现。
5. 文武道公共能力接线是合并后的独立小提交。
6. 没有新增第二套任务引擎、权限系统、资源系统或 MCP 桥。
7. Wiki 脚本仍是后续独立阶段，没有被本轮媒体改造夹带实施。

## 12. 失败回退

- 支线 A 失败：回退 A，不影响现有媒体能力。
- 支线 B 失败：回退 B，创模式和 UI 继续走原有入口。
- 最终 OpenCode 适配器失败：只回退适配器；不得回退已经验证的 OpenCode 官方对齐或公共媒体核心。

这种可独立回退是两条支线允许并行的前提。

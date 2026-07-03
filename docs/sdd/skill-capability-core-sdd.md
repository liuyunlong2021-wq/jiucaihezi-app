# Skill 能力核心完备化 SDD

日期：2026-06-03  
状态：SDD v3 定稿，待实现  
关联外部项目：`/Users/by3/Documents/Skill_Seekers`  
关联当前模块：`agentStore.ts`、`skillConnectionAdapter.ts`、`toolConnectionAdapter.ts`、`skillTestRunner.ts`、`useChat.ts`、`mcpStore.ts`

## 1. 背景

Skill 是韭菜盒子 Studio 的核心产品力。当前产品已经具备三块基础：

1. 官方 Skill 形态：`SKILL.md` + 可选 `references/`、`scripts/`、`assets/`。
2. 手动选择运行：用户明确选择 Skill、Knowledge、Tool、Model 后才进入对话执行链。
3. 创建闭环雏形：`Skill Creator` / `Skill Builder` 可以通过 `run_skill_tests` 与 `save_skill` 完成测试和保存。

但当前还没有真正完成“从资料生成高质量 Skill”的能力。`Skill Builder` 过去的提示词曾假设存在 Skill Seekers MCP 工具，但应用内没有完成真实集成；因此它最多只能基于用户粘贴/上传内容起草 `SKILL.md`，不能自动采集文档、仓库、PDF、视频、OpenAPI 等来源，也不能把来源整理成可审查的 Skill 包。

`/Users/by3/Documents/Skill_Seekers` 提供了成熟的资料预处理能力：

- 18 类来源采集：网页文档、GitHub、PDF、本地代码库、Word、EPUB、Jupyter、HTML、OpenAPI、AsciiDoc、PPTX、RSS、man page、Confluence、Notion、Slack/Discord、视频等。
- 多源合并：可把文档、代码、PDF 等合成同一个 Skill，并标注冲突。
- 增强：从参考资料中提取示例、快速参考、使用指南，生成更强的 `SKILL.md`。
- 打包：支持 Claude、OpenAI、Gemini、Markdown、RAG/vector DB 等目标。
- MCP：提供 40 个工具，但工具面过大，不能无筛选直接暴露给韭菜盒子的普通对话循环。

本 SDD 的目标是把 Skill Seekers 变成韭菜盒子内受控、可审查、可测试、可保存的 Skill 工厂，而不是把它原样搬成一个黑盒 Agent。

## 2. 产品原则

### 2.1 不变原则

1. Skill 仍然是官方 Skill，不扩展成自主 Agent。
2. 用户必须显式选择来源、工具和模型。
3. 采集、增强、测试、保存都有可见状态和用户确认。
4. 任何资料不得自动写入知识库 Vault。
5. 任何生成的 Skill 不得自动启用为默认执行规则。
6. 不允许让 LLM 声称拥有未注册、未连接、未授权的工具。
7. 最终进入产品的资产必须是标准 Skill 包：`SKILL.md` + 可选 `references/`、`scripts/`、`assets/`。

### 2.2 Skill Builder 与 Skill Creator 的边界

`Skill Creator`：

- 面向空白创建。
- 用户描述需求，LLM 起草 `SKILL.md`。
- 只依赖 `run_skill_tests` 与 `save_skill`。
- 适合写作类、流程类、提示词类 Skill。

`Skill Builder`：

- 面向“从资料构建 Skill”。
- 用户提供 URL、GitHub 仓库、本地文件、PDF、视频、OpenAPI 等来源。
- 通过受控的 Skill Seekers 适配器采集和整理资料。
- 生成 `SKILL.md`、`references/`、构建报告、冲突报告、测试建议。
- 最终仍然必须经过用户审查、测试、确认后才能保存。

`Skill Seekers`：

- 是底层资料编译器。
- 不直接决定产品状态。
- 不直接写入 `agentStore`。
- 不直接写入 Vault。
- 不直接把 40 个 MCP 工具暴露给普通对话。

## 3. 目标

### 3.1 用户目标

用户可以完成以下闭环：

1. 打开 Skill 中心。
2. 选择“新建 Skill”或“从资料构建 Skill”。
3. 添加来源：网页文档、GitHub 仓库、PDF、Word、Markdown、本地代码目录、OpenAPI、视频等。
4. 应用展示来源识别结果、预计采集范围、风险和需要的权限。
5. 用户确认后开始构建。
6. 应用展示构建进度：采集、解析、归类、冲突检测、生成草稿、增强、质量检查。
7. 用户审查 `SKILL.md`、参考资料、冲突报告、测试用例。
8. 用户运行测试，看到 with-skill / without-skill 对比。
9. 用户迭代修改。
10. 用户明确确认后保存到“我的 Skill”。
11. 用户在聊天中手动选择该 Skill 使用。

### 3.2 工程目标

1. 建立一个 Tauri 管理的 Skill Build Job Runner，用子进程方式调用 Skill Seekers CLI。
2. 前端只调用韭菜盒子定义的 Tauri command / 工具门面，不直接面对 40 个 MCP 工具。
3. 形成可持久化的 Skill 构建任务模型。
4. 支持构建产物预览和导入。
5. 保留当前 `run_skill_tests` / `save_skill` 闭环，并扩展为完整质量门。
6. 所有文件写入限定在应用控制目录或用户显式选择目录。
7. 所有网络/本地文件/长任务都有用户授权和可取消状态。

## 4. 非目标

1. 不做通用 Agent Loop。
2. 不让 Skill Builder 自动决定用户应该用什么 Skill。
3. 不默认连接外部 Skill Seekers MCP 并暴露全部工具。
4. 不在 P1 支持自动上传 Claude/OpenAI/Gemini 平台。
5. 不在 P1 支持 vector DB 导出。
6. 不把采集资料自动沉淀到 Vault。
7. 不把 Skill Seekers Python 代码直接混进 Vue 前端或 Tauri Rust 主进程。

## 5. 当前缺口

### 5.1 当前做得对的部分

- `src/types/skill.ts` 已定义 `SkillConfig`，与官方 `SKILL.md` 形态接近。
- `src/stores/agentStore.ts` 已能保存用户 Skill，并放入“我的 Skill”。
- `src/runtime/connection/skillConnectionAdapter.ts` 已能加载 `skill://.../SKILL.md`，并给 Skill Creator/Builder 追加运行时限制。
- `src/runtime/connection/toolConnectionAdapter.ts` 已能对 Skill 创建类 Skill 只暴露创建工具。
- `src/utils/skillTestRunner.ts` 已有 with-skill / without-skill 测试对比。
- `src/composables/useChat.ts` 已有 `run_skill_tests` 与 `save_skill` 执行器。
- `src/stores/mcpStore.ts` 与 `src/services/mcpClient.ts` 已有 MCP 连接雏形。

### 5.2 当前缺失的部分

1. 没有真实的来源采集流水线。
2. 没有 Skill 构建任务状态。
3. 没有 Skill 包目录模型，`references/scripts/assets` 没有成为一等产物。
4. 没有构建报告、冲突报告、质量报告。
5. `Skill Builder` 的静态 `SKILL.md` 与实际可用工具之间曾经不一致。
6. `save_skill` 当前更像保存单个 Markdown 字符串，不是导入一个完整 Skill 包。
7. 测试结果没有持久化到 Skill 版本历史。
8. MCP 工具虽然可接入，但缺少本地服务生命周期、权限提示、工具白名单和风险分级。

## 6. 推荐架构

采用“本地隔离适配器 + 产品内 Skill 工作台 + 窄工具门面”的方案。

```
用户
  ↓
Skill 中心 / Skill Builder 工作台
  ↓
skillBuildStore（任务状态、产物索引、权限状态）
  ↓
skillBuildClient（前端窄接口）
  ↓
Tauri Skill Build Runner（spawn CLI、读 stdout/stderr、写 job event log）
  ↓
uv run skill-seekers / 已安装的 skill-seekers CLI
  ↓
构建工作区 ~/.jiucaihezi/skill-builds/<jobId>/
```

### 6.1 为什么不直接暴露 Skill Seekers MCP

Skill Seekers MCP 有 40 个工具，包含抓取、上传、安装、marketplace、vector DB、配置源、workflow 等。直接暴露给对话模型会导致：

- 工具面过大，模型容易选错工具。
- 部分工具涉及网络、上传、marketplace、外部 token，默认风险过高。
- 用户很难理解当前到底执行到了哪一步。
- 与韭菜盒子“纯手动、显式选择”的产品原则冲突。

因此产品内只暴露韭菜盒子定义的 5 到 7 个高层工具；适配器内部可以调用 Skill Seekers CLI/API/MCP，但这属于实现细节。

### 6.2 方案对比

| 方案 | 说明 | 优点 | 问题 | 结论 |
|---|---|---|---|---|
| A. 直接接 Skill Seekers MCP | 配一个 MCP server，把 40 个工具全暴露 | 快速试验 | 工具面过大，安全和 UX 不可控 | 只可作为开发调试 |
| B. 本地隔离适配器 | 独立服务封装 Skill Seekers，产品只调用窄接口 | 稳定、可控、可测试、符合产品原则 | 需要做适配层 | 推荐 |
| C. 用 TypeScript 重写 Skill Seekers | 完全融入当前代码 | 长期一致 | 成本极高，重复造轮子 | 不采用 |

## 7. 核心模块

### 7.1 Tauri Skill Build Runner

P1 不新建常驻 Python/FastAPI 服务。原因：

- 桌面应用不需要每个用户本地常驻 HTTP 服务。
- 常驻服务会引入端口分配、进程清理、SSE 重连和防火墙问题。
- 当前目标只是受控调用 CLI、收集产物、展示日志，Tauri 子进程足够。
- NewAPI Token 留在前端/Rust 既有鉴权链路中，不传给外部 Python 进程。

P1 新增模块：

```
src-tauri/src/skill_build_runner.rs
src/services/skillBuildClient.ts
src/stores/skillBuildStore.ts
src/utils/skillBuilderTools.ts
```

职责：

- 管理构建任务。
- 识别来源类型。
- 调用 Skill Seekers CLI。
- 按行读取 stdout/stderr，生成 job event log。
- 规范化输出目录。
- 生成产物索引。
- 返回状态、日志和错误。
- 不直接写入前端 store。
- 不直接上传外部平台。

### 7.2 构建工作区

所有构建写入：

```
~/.jiucaihezi/skill-builds/<jobId>/
├── manifest.json
├── sources/
├── normalized/
├── skill/
│   ├── SKILL.md
│   ├── references/
│   ├── scripts/
│   └── assets/
├── reports/
│   ├── source-analysis.json
│   ├── conflicts.md
│   ├── quality.json
│   └── build.log
└── package/
    └── skill.zip
```

原则：

- `sources/` 存原始采集快照或用户文件副本。
- `normalized/` 存清洗后的中间材料。
- `skill/` 是最终待导入包。
- `reports/` 是用户审查材料。
- `package/` 只做本地导出，不自动上传。

### 7.3 前端 `skillBuildStore`

新增 Pinia store：

```ts
interface SkillBuildJob {
  id: string
  name: string
  status: 'draft' | 'awaiting_approval' | 'running' | 'failed' | 'ready' | 'testing' | 'saved' | 'cancelled'
  sources: SkillSource[]
  options: SkillBuildOptions
  progress: SkillBuildProgress
  artifacts: SkillArtifact[]
  reports: SkillBuildReports
  createdAt: number
  updatedAt: number
}

interface SkillSource {
  id: string
  type: 'documentation' | 'github' | 'pdf' | 'word' | 'markdown' | 'local_codebase' | 'video' | 'openapi' | 'generic'
  input: string
  displayName: string
  requiresNetwork: boolean
  requiresFileAccess: boolean
  status: 'pending' | 'validated' | 'failed'
  error?: string
}

interface SkillArtifact {
  path: string
  kind: 'skill_md' | 'reference' | 'script' | 'asset' | 'report' | 'package'
  title: string
  size: number
  previewable: boolean
}
```

职责：

- 保存构建任务列表。
- 记录来源授权状态。
- 订阅 Tauri job event。
- 管理草稿、测试结果、保存状态。
- 不保存大文件内容；大文件通过 Tauri artifact command 按需读取或在 Finder 中显示。

### 7.4 前端客户端 `skillBuildClient`

窄接口：

```ts
health(): Promise<SkillBuildRuntimeHealth>
detectSources(inputs: string[]): Promise<SkillSource[]>
createJob(input: CreateSkillBuildJobInput): Promise<SkillBuildJob>
startJob(jobId: string): Promise<void>
cancelJob(jobId: string): Promise<void>
getJob(jobId: string): Promise<SkillBuildJob>
listArtifacts(jobId: string): Promise<SkillArtifact[]>
readArtifact(jobId: string, path: string): Promise<string | Blob>
enhanceSkill(jobId: string, options: EnhanceOptions): Promise<void>
packageSkill(jobId: string): Promise<SkillArtifact>
```

### 7.5 Chat 工具门面

不要把 Skill Seekers 的 40 个工具给模型。给 Skill Builder 暴露这些产品级工具：

| 工具 | 作用 | 何时可用 |
|---|---|---|
| `skill_builder_detect_sources` | 识别用户输入来源类型、权限需求、风险 | Skill Builder 选中时 |
| `skill_builder_create_job` | 根据用户确认的来源创建构建任务 | 用户确认来源后 |
| `skill_builder_start_job` | 开始采集/构建 | 用户确认权限后 |
| `skill_builder_read_artifact` | 读取 `SKILL.md`、报告或参考文件预览 | job ready 后 |
| `skill_builder_enhance` | 基于参考资料增强 `SKILL.md` | 用户确认增强后 |
| `run_skill_tests` | 测试草稿 Skill | 用户确认测试用例后 |
| `save_skill` / `save_skill_package` | 保存 Skill | 用户明确确认后 |

P1 可以先只做工作台 UI 调用适配器，不急着让 LLM 调用全部工具。LLM 工具门面用于聊天式 Builder，但工作台按钮必须也能完整跑通。

### 7.6 Skill 保存模型

当前 `save_skill` 保存的是一个 Markdown 字符串。完整形态需要新增 `save_skill_package`：

```ts
interface SaveSkillPackageInput {
  jobId?: string
  skillMd: string
  references?: { path: string; content: string }[]
  scripts?: { path: string; content: string; executable?: boolean }[]
  assets?: { path: string; contentBase64: string; mimeType: string }[]
  testResults?: SkillTestSummary
  sourceManifest?: SkillSource[]
}
```

保存后进入 `agentStore`：

- `skillContent` 存完整 `SKILL.md` 文本。
- `references` 保存引用索引，不把大文件塞进描述字段。
- 新增持久化包目录或 artifact store，用来保留 `references/scripts/assets`。
- `evolutionLog` 记录来源、测试结果、版本变更。

P1 若暂不改 `SkillConfig` 大结构，可以先把 `references/` 内容保存为应用内部文档记录，并在 Skill 运行时以 resources 注入；P2 再把 Skill 包作为一等存储对象。

## 8. 用户操作流

### 8.1 空白创建 Skill

1. 用户打开 Skill 中心。
2. 点击“新建 Skill”。
3. 进入 Skill Creator。
4. 用户描述用途、触发场景、输出格式。
5. LLM 起草 `SKILL.md`。
6. 用户确认测试用例。
7. 运行 `run_skill_tests`。
8. 用户审查结果并迭代。
9. 用户说“保存”后调用 `save_skill`。
10. Skill 出现在“我的 Skill”。

这条路径保持轻量，不依赖 Skill Seekers。

### 8.2 从资料构建 Skill

1. 用户打开 Skill 中心。
2. 点击“从资料构建 Skill”。
3. 添加来源：
   - 粘贴文档 URL。
   - 粘贴 GitHub repo。
   - 上传 PDF/Word/Markdown/OpenAPI。
   - 选择本地代码目录。
4. 系统识别来源类型，并显示：
   - 将访问哪些网络地址。
   - 将读取哪些本地路径。
   - 预计页面数/文件数。
   - 是否需要 token。
   - 是否可能耗时较长。
5. 用户确认后创建 job。
6. 系统开始构建，显示阶段进度：
   - 来源验证
   - 采集
   - 解析
   - 分类
   - 冲突检测
   - 草稿生成
   - 增强
   - 质量检查
7. 构建完成后展示：
   - `SKILL.md` 预览
   - `references/` 列表
   - 冲突报告
   - 质量报告
   - 建议测试用例
8. 用户可以编辑 `SKILL.md`。
9. 用户确认测试用例后运行测试。
10. 用户确认保存后导入为“我的 Skill”。
11. 用户在聊天中手动选择该 Skill。

## 9. 权限与安全

### 9.1 网络权限

- URL 来源必须在 UI 中展示后由用户确认。
- 默认只允许 `http` / `https`。
- 阻止本地网络 SSRF：`127.0.0.0/8`、`localhost`、`169.254.0.0/16`、私网 IP、file URL 默认拒绝。
- GitHub token、Notion token、Confluence token 等敏感信息不进 localStorage。
- P1 禁用 Confluence、Notion、Slack/Discord token 类来源，除非后续单独做凭据中心。

### 9.2 文件权限

- 本地文件必须来自用户选择或拖拽。
- 本地代码目录必须由用户选择根目录。
- 适配器只读取用户授权路径。
- 输出只写入 `~/.jiucaihezi/skill-builds/`。
- 禁止路径穿越、空字节、符号链接逃逸。

### 9.3 工具权限

- 普通对话不默认暴露 Skill Builder 工具。
- 只有选中 `Skill Builder` 或进入 Skill 工作台时才加载相关工具。
- `upload_skill`、`publish_to_marketplace`、`export_to_*`、`install_skill` 在 P1 不暴露。
- 所有 destructive 或外部上传类能力必须后续单独做权限卡。

### 9.4 Prompt Injection

采集来的文档、README、issues、PDF 文本都属于不可信资料。处理规则：

- 作为 source material，不作为系统指令。
- 注入到 LLM 时必须包在边界标记中。
- 生成 `SKILL.md` 时要求模型提取可验证规则，不执行资料中的指令。
- 报告中标注“来源材料中疑似 prompt injection”。

## 10. 质量门

一个 Skill 只有同时满足以下条件才允许保存：

1. `SKILL.md` 有合法 frontmatter：`name`、`description`。
2. 正文包含明确的 “When to Use” 或同等触发说明。
3. 正文包含工作流程或输出规范。
4. `SKILL.md` 大小不超过运行时限制，建议 500 行以内；过大时提示拆分或 router skill。
5. references 路径合法，无绝对路径泄露。
6. 至少有 3 个测试用例，除非用户明确选择“跳过测试保存”。
7. 保存前必须有用户确认。

P2 追加：

- 测试结果写入版本历史。
- 支持回滚到上一版。
- 支持 router skill 拆分建议。
- 支持“质量分”：触发清晰度、流程明确度、示例覆盖、输出约束、风险提示。

## 11. 与知识库 Vault 的关系

Skill Builder 的采集资料不自动进入 Vault。

关系如下：

- Skill Builder 的 `sources/normalized/references` 是 Skill 构建材料。
- Vault 是用户长期知识库。
- 用户可以在构建完成后手动选择“把参考资料也加入某个知识库”。
- 默认不做这件事，避免自动写入造成知识污染。

## 12. 与 MCP 系统的关系

当前项目已有 MCP 连接能力，但本方案不以“用户自己配 Skill Seekers MCP”为主路径。

建议策略：

1. P1：适配器内部直接调用 Skill Seekers CLI/Python API。
2. P2：如果 Skill Seekers MCP 更稳定，可以让适配器内部使用 MCP，但前端接口不变。
3. P3：通用 MCP 设置页继续保留，但 Skill Builder 不依赖用户手动配 MCP。

这样可以保证产品体验稳定：用户看到的是“Skill 构建能力”，不是“请先理解 MCP、配置 40 个工具”。

## 13. 实施阶段

### P0：稳住现有创建闭环

目标：两个创建 Skill 的 Skill 都能跑通。

范围：

- `Skill Creator` 保持只用 `run_skill_tests` / `save_skill`。
- `Skill Builder` 在适配器未完成前不能再声称有 Skill Seekers MCP。
- 创建后自动出现在“我的 Skill”。
- 测试覆盖创建、测试、保存。

验收：

- 空白创建 Skill 可保存。
- Skill Builder 基于用户粘贴内容可保存。
- 未接入 Skill Seekers 时不出现虚假工具声明。

### P1：Skill Build Runner MVP

目标：完成真实“从资料构建 Skill”。

范围：

- 新建 Tauri `skill_build_runner` 和前端 `skillBuildClient/skillBuildStore`。
- 支持来源：
  - Markdown/文本文件
  - PDF
  - 文档 URL
  - GitHub repo
  - 本地代码目录
- 支持 job 创建、启动、取消、查询。
- 生成标准 `skill/SKILL.md` 与 `references/`。
- 生成 `source-analysis.json`、`build.log`、`quality.json`。
- 前端新增 runner client 和 store。
- Skill Builder 工作台可以用按钮跑完整流程。
- 保存时导入为用户 Skill。

验收：

- 用一个 Markdown 文件能生成 Skill，预览、测试、保存。
- 用一个小型 GitHub repo 或本地 clone 能生成 Skill，至少有 `SKILL.md` 和 references。
- Skill Seekers runtime 不可用时，UI 明确显示“本地 Skill 构建运行时未配置/不可用”，不让模型假装执行。
- 用户不确认时不会保存。

### P2：产品级 Skill 工作台

目标：把 Skill 构建变成稳定产品体验。

范围：

- Skill 中心新增“我的 Skill / 内置 Skill / 构建任务 / 导入导出”。
- 工作台提供 6 步 UI：来源、计划、构建、审查、测试、保存。
- 支持编辑 `SKILL.md`。
- 支持查看 references、冲突报告、质量报告。
- 支持测试结果持久化。
- 支持 Skill 版本历史与回滚。
- 支持 `save_skill_package`。

验收：

- 用户无需理解 Skill Seekers/MCP，就能完成资料到 Skill。
- 构建失败能看到可读错误和重试入口。
- 已保存 Skill 可回看来源和测试记录。

### P3：高级能力

目标：把 Skill 做成长期资产系统。

范围：

- 多源冲突可视化。
- Router Skill / 子 Skill 拆分。
- 定期更新检测。
- 手动导出 zip。
- 手动加入 Vault。
- 可选连接 marketplace。
- 可选 vector DB 导出。

验收：

- 大型资料可拆分为 router + sub-skills。
- 用户可以手动更新 Skill，并看到 diff。
- 外部上传类能力全部有单独确认。

## 14. 关键实现建议

### 14.1 适配器优先调用 CLI

P1 不要深度绑定 Skill Seekers 内部 Python API。优先用 CLI 作为边界：

- 内部变化影响小。
- 日志天然可捕获。
- 便于后续替换为 wheel、Docker 或 MCP。

适配器负责把 CLI 结果规范化为固定 manifest。

### 14.2 不把所有来源一次做完

虽然 Skill Seekers 支持 18 类来源，但 P1 只做 5 类：

1. Markdown/文本
2. PDF
3. 文档 URL
4. GitHub repo
5. 本地代码目录

Word、视频、OpenAPI 可排 P2/P3。原因：P1 的核心不是来源数量，而是闭环质量。

### 14.3 先做按钮式工作台，再做聊天式 Builder

LLM 工具调用适合辅助解释和迭代，不适合承载长任务主流程。P1 主路径应是按钮式工作台：

- 用户更容易理解状态。
- 权限更清楚。
- 失败更好恢复。
- 测试更稳定。

聊天式 Skill Builder 可以调用同一套 store/client，但不是唯一入口。

### 14.4 静态 Skill Builder 文案必须改

`public/skills/skill-builder/SKILL.md` 最终应改成条件式描述：

- 如果本地 Skill 构建 runtime 可用：可以调用 Skill Builder 工具。
- 如果不可用：只能基于用户提供内容起草 `SKILL.md`。
- 不再写“你有 40 个 MCP 工具”这种不一定真实的声明。

运行时 appendix 只是保险，静态 Skill 本身也要产品正确。

## 15. 测试策略

### 15.1 单元测试

- source detector：URL/GitHub/PDF/local path/OpenAPI 识别。
- path validator：路径穿越、空字节、私网 URL 拒绝。
- artifact indexer：正确列出 `SKILL.md`、references、reports。
- save package：frontmatter 解析、非法 references 拒绝。
- tool exposure：只有 Skill Builder 场景暴露 builder 工具。

### 15.2 集成测试

- runner health。
- Markdown 文件构建 Skill。
- PDF fixture 构建 Skill。
- GitHub fixture 或本地 fake repo 构建 Skill。
- job cancel。
- job failure log。
- package import。

### 15.3 前端测试

- Skill 工作台 6 步状态流转。
- runtime unavailable 状态。
- 构建完成后预览 artifacts。
- 保存前需要确认。
- 保存后出现在“我的 Skill”。

### 15.4 回归测试

- 现有聊天、Skill Creator、Skill Picker 不回退。
- 普通对话不暴露 Skill Builder 工具。
- localTools 关闭时普通工具仍关闭；Skill 创建流程的必要工具按既有策略可用。

## 16. 运行与部署

### 16.1 本地开发

开发期允许读取 `/Users/by3/Documents/Skill_Seekers`：

```bash
cd /Users/by3/Documents/Skill_Seekers
uv run skill-seekers --help
uv run skill-seekers create --help
```

runner 通过配置读取 Skill Seekers 项目路径和 runtime 命令；P1 默认使用 `uv run skill-seekers`。

### 16.2 桌面打包

P1 不承诺正式包内嵌 Python/Skill Seekers。2026-06-03 实测 `uv run skill-seekers --help` 首次创建 `.venv` 后约 400M，且依赖下载可能因 `cryptography` 等大包超时。发布打包必须单独评估。

P1 只支持开发/内测 runtime：

1. 用户机器已有 `/Users/by3/Documents/Skill_Seekers` 或可配置 Skill Seekers 项目路径。
2. runner 使用 `uv run skill-seekers`。
3. Tauri 管理 CLI 子进程生命周期。
4. UI 显示 runtime 检测、依赖安装状态和错误。

P2 再决定是否打包 wheel、创建私有 venv 或引入 sidecar。

### 16.3 失败处理

常见失败必须可读：

- Python runtime 缺失。
- 依赖安装失败。
- 网络失败。
- GitHub rate limit。
- PDF 加密或 OCR 失败。
- 来源过大。
- Skill Seekers CLI 返回非零退出码。
- 输出目录缺少 `SKILL.md`。

## 17. 验收标准

最终上线前至少满足：

1. 两条路径都可用：
   - 空白创建 Skill。
   - 从资料构建 Skill。
2. 从本地 Markdown 构建、测试、保存全流程通过。
3. 从小型 GitHub repo 或本地 clone 构建、预览、保存全流程通过。
4. 构建中断/失败可恢复或重试。
5. `Skill Builder` 不再声明不存在的工具。
6. 未授权来源不会被访问。
7. 未确认不会保存。
8. 保存后的 Skill 可以在聊天中手动选择并影响输出。
9. 所有新增工具有参数大小限制和路径/URL 校验。
10. P1 范围内测试全部通过：focused tests、conversation tests、typecheck。

## 18. 决策结论

本项目应把 Skill 能力升级为三层：

1. **Skill 资产层**：标准 Skill 包、版本、测试记录、来源记录。
2. **Skill 构建层**：受控调用 Skill Seekers，把资料编译成 Skill 包。
3. **Skill 使用层**：用户手动选择 Skill，在对话/创作/画布中作为显式上下文使用。

推荐从 P1 开始做 Tauri Skill Build Runner 和 Skill 工作台 MVP。不要先做泛 MCP，不要先暴露 40 个工具，也不要先追求 18 类来源全覆盖。先把 5 类最常用来源打穿，并把“预览、测试、确认、保存、使用”做稳，这才是 Skill 产品力的核心。

## 19. V3 补充：Tauri Command 契约

P1 不做 FastAPI、REST API、OpenAPI 或 SSE。桌面端的正确边界是 Tauri command：

- 前端通过 `invoke()` 调用 Rust。
- Rust 管理 job 状态、子进程和文件系统。
- 长任务通过 Tauri event 推送进度。
- 不占本地端口，不需要防火墙/端口清理，不维护 HTTP server 生命周期。

### 19.1 Command 总规则

- 所有 command 返回统一 envelope。
- 所有写操作必须带 `requestId`，用于幂等和日志关联。
- 所有 command 返回 `runnerVersion` 与 `skillSeekersVersion`。
- 前端请求超时：
  - `skill_build_health`：2s
  - `skill_build_detect_sources` / `skill_build_create_job`：10s
  - `skill_build_start_job` / `skill_build_cancel_job`：5s，启动长任务后立即返回
  - `skill_build_get_job`：5s
  - artifact 文本读取：15s
  - artifact 二进制打开：交给系统默认应用，不读入 JS 内存

统一响应：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "runnerVersion": "0.1.0",
  "skillSeekersVersion": "3.8.0.dev0"
}
```

错误响应：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "UNSUPPORTED_SOURCE_TYPE",
    "message": "P1 does not support source type: notion",
    "recoverable": true,
    "retry_after_seconds": null,
    "details": {}
  },
  "runnerVersion": "0.1.0",
  "skillSeekersVersion": "3.8.0.dev0"
}
```

### 19.2 错误码

| code | 含义 | recoverable | 前端动作 |
|---|---|---:|---|
| `SKILL_SEEKERS_UNAVAILABLE` | 找不到可用 `skill-seekers` CLI/uv runtime | true | 显示安装/配置入口 |
| `VERSION_MISMATCH` | runner 与 Skill Seekers 版本不兼容 | false | 要求升级或切换 runtime |
| `UNSUPPORTED_SOURCE_TYPE` | P1 不支持该来源 | true | 禁止继续，提示支持范围 |
| `SOURCE_LIMIT_EXCEEDED` | 超过规模上限 | true | 允许用户降低范围 |
| `UNAUTHORIZED_SOURCE` | 用户未授权来源 | true | 回到授权步骤 |
| `PRIVATE_NETWORK_BLOCKED` | URL 命中 SSRF/私网规则 | false | 阻止 |
| `INVALID_PATH` | 本地路径非法或越权 | false | 阻止 |
| `JOB_NOT_FOUND` | job 不存在 | false | 从列表移除或刷新 |
| `JOB_STATE_CONFLICT` | 当前状态不允许此操作 | true | 刷新 job |
| `SKILL_SEEKERS_FAILED` | CLI 执行失败 | true | 展示日志和恢复动作 |
| `ARTIFACT_NOT_FOUND` | 产物不存在 | true | 刷新 artifacts |
| `QUALITY_GATE_FAILED` | 硬性质量门失败 | true | 跳到审查页 |
| `ARTIFACT_TOO_LARGE` | 预览文件过大 | true | 在 Finder 中显示或用系统默认应用打开 |

### 19.3 Tauri Commands

#### `skill_build_health`

响应：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "runnerVersion": "0.1.0",
    "skillSeekersVersion": "3.8.0.dev0",
    "runtime": {
      "mode": "external_uv",
      "cwd": "/Users/by3/Documents/Skill_Seekers",
      "command": "uv",
      "argsPrefix": ["run", "skill-seekers"]
    },
    "workspaceRoot": "~/.jiucaihezi/skill-builds",
    "supportedSources": ["markdown", "pdf", "documentation", "github", "local_codebase"],
    "protocolVersion": "2026-06-03.v1"
  },
  "error": null
}
```

#### `skill_build_detect_sources`

请求：

```json
{
  "requestId": "req_...",
  "inputs": [
    {
      "raw": "https://docs.react.dev/",
      "kind_hint": null
    }
  ]
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "sources": [
      {
        "id": "src_...",
        "type": "documentation",
        "input": "https://docs.react.dev/",
        "display_name": "React Docs",
        "requiresNetwork": true,
        "requiresFileAccess": false,
        "requiresSecret": false,
        "supported": true,
        "risk": "network",
        "estimated": {
          "pages": 120,
          "files": 0,
          "bytes": null,
          "duration_seconds": 300
        },
        "warnings": []
      }
    ]
  },
  "error": null
}
```

#### `skill_build_create_job`

请求：

```json
{
  "requestId": "req_...",
  "name": "react-docs",
  "description": "React 官方文档 Skill",
  "sources": [
    {
      "id": "src_...",
      "type": "documentation",
      "input": "https://docs.react.dev/"
    }
  ],
  "options": {
    "preset": "standard",
    "enhanceLevel": 0,
    "maxPages": 200,
    "maxFiles": 5000,
    "maxBytes": 524288000,
    "includeTests": true,
    "allowNetwork": true,
    "allowLocalFiles": false
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "job": {
      "id": "job_...",
      "name": "react-docs",
      "status": "awaiting_approval",
      "workspace": "~/.jiucaihezi/skill-builds/job_...",
      "sources": [],
      "options": {},
      "progress": {
        "stage": "planned",
        "percent": 0,
        "message": "Ready to start"
      },
      "created_at": "2026-06-03T12:00:00Z",
      "updated_at": "2026-06-03T12:00:00Z"
    }
  },
  "error": null
}
```

#### `skill_build_start_job`

请求：

```json
{
  "requestId": "req_...",
  "jobId": "job_...",
  "userApproved": true
}
```

响应：`202 Accepted`

```json
{
  "ok": true,
  "data": {
    "job_id": "job_...",
    "status": "running"
  },
  "error": null
}
```

#### `skill_build_get_job`

返回 job 当前状态、progress、artifacts 摘要、最近 50 条事件。

#### `skill_build_cancel_job`

取消任务。runner 必须终止子进程并标记 job 为 `cancelled`。已生成 artifacts 保留。

#### `skill_build_list_artifacts`

响应：

```json
{
  "ok": true,
  "data": {
    "artifacts": [
      {
        "path": "skill/SKILL.md",
        "kind": "skill_md",
        "title": "SKILL.md",
        "size": 12450,
        "mime_type": "text/markdown",
        "previewable": true,
        "sha256": "..."
      }
    ]
  },
  "error": null
}
```

#### `skill_build_read_artifact_text`

只允许读取 job workspace 内的相对路径。文本大于 1MB 返回 `ARTIFACT_TOO_LARGE`。

#### `skill_build_reveal_artifact`

对大文件或二进制文件，用 Finder 显示或系统默认应用打开，不把内容读入 JS 内存。

#### `skill_build_quality_check`

运行硬性质量门，返回 `QualityReport`。

#### `skill_build_package`

本地打包为 zip，不上传。

## 20. V3 补充：Skill Seekers CLI 映射表与实测结论

2026-06-03 已在 `/Users/by3/Documents/Skill_Seekers` 实测：

- 本机没有全局 `skill-seekers` 命令。
- `uv run skill-seekers --help` 可用，但首次创建 `.venv` 并安装 152 个包，`.venv` 约 400M。
- `skill-seekers create --help` 证实存在位置参数 `source`、`--name`、`--output/-o`、`--preset/-p`、`--max-pages`、`--repo`、`--token`、`--non-interactive`。
- `skill-seekers scan --help` 的参数是 `--out`，不是 `--output`，且用途偏项目扫描/配置生成；P1 不把 `scan` 当 Skill 构建主路径。
- Markdown `.md` 文件不能被 `create` 识别；相对路径还会被误判成 web source。
- PDF fixture 可通过 `create <pdf>` 生成 `SKILL.md` 和 references，但 `--dry-run` 仍实际产生输出，且实测中 `--output /private/tmp/...` 未生效，输出到了默认 `output/<name>/`。

因此 P1 规则：

- 不假设全局安装；runner 支持 `uv run skill-seekers` 的外部 runtime。
- 所有 CLI 在隔离 job cwd 中运行，避免污染 Skill Seekers 项目自带 `output/`。
- 不依赖 `--dry-run` 做无副作用验证。
- 不把 `--output` 作为唯一可信产物路径；runner 必须从 stdout 和 job cwd 的 `output/<name>/` 兜底查找。
- Markdown/text 由韭菜盒子原生 builder 处理，不交给 Skill Seekers。
- 收到其他来源时返回 `UNSUPPORTED_SOURCE_TYPE`，不降级、不猜测。

| 前端来源 | 适配器 source type | Skill Seekers 命令 | 输出位置 | P1 行为 |
|---|---|---|---|---|
| Markdown / txt | `markdown` | 不调用 Skill Seekers；原生 builder 复制原文到 `references/source.md` 并生成基础 `SKILL.md` 草稿 | `<job>/skill/` | 必做 |
| PDF | `pdf` | `uv run skill-seekers create <absolutePdfPath> --name <name> --enhance-level 0 --quiet`；可尝试 `--output <rawOut>`，但必须兜底扫描 job cwd output | `<job>/raw-output/<sourceId>` | 必做 |
| 文档 URL | `documentation` | `uv run skill-seekers create <url> --name <name> --preset <quick|standard> --max-pages <N> --enhance-level 0 --quiet` | `<job>/raw-output/<sourceId>` | P1 需用小型公开 URL fixture 再验 |
| GitHub repo | `github` | `GITHUB_TOKEN=<in-memory-token?> uv run skill-seekers create <owner/repo> --name <name> --preset <quick> --non-interactive --enhance-level 0 --quiet`；token 不进入 argv 和日志 | `<job>/raw-output/<sourceId>` | P1 需 token 流程 |
| 本地代码目录 | `local_codebase` | `uv run skill-seekers create <absoluteDir> --name <name> --preset <quick|standard> --enhance-level 0 --quiet` | `<job>/raw-output/<sourceId>` | P1 需 fixture 再验 |
| Word / EPUB / OpenAPI / video / Notion / Confluence / Slack 等 | 对应上游类型 | 无 P1 命令 | 无 | P1 拒绝，P2/P3 再加 |

### 20.1 输出规范化

Skill Seekers 原始输出不得直接作为产品存储。适配器必须执行 normalize：

1. 查找原始输出中的 `SKILL.md`。
2. 复制到 `<job>/skill/SKILL.md`。
3. 查找 `references/`、`assets/`、`scripts/`，存在则复制到 `<job>/skill/` 对应目录。
4. 生成 `<job>/manifest.json`。
5. 生成 `<job>/reports/source-analysis.json`，记录原始命令、退出码、来源、文件计数、hash。
6. 生成 `<job>/reports/build.log`。
7. 对所有复制文件执行路径净化：
   - 不允许绝对路径。
   - 不允许 `..`。
   - 不允许空字节。
   - 不允许 symlink 逃逸。
8. 不认识的大文件放入 `assets/unknown/`，但不注入运行时上下文。

### 20.2 多源合并与 LLM 路由

P1 多源只支持“合并为一个 build job，但逐源构建后由 runner 汇总材料”。LLM 合成不在 runner 中执行。

1. 每个 source 先独立产出 raw-output。
2. runner 收集各 source 的 `SKILL.md` 与 references。
3. 生成 `normalized/source-<id>.md`。
4. 默认使用本地模板合成，输出可编辑的 `skill/SKILL.md` 草稿。
5. 如果用户选择“AI 增强”，前端通过现有 NewAPI 主 Token 调 LLM，runner 只提供 normalized material，不接触 NewAPI Token。
6. AI 增强结果写回 job workspace，进入审查和测试。
7. Skill Seekers CLI 永远使用 `--enhance-level 0`，避免它自己拉起 Claude Code 或读取外部 API Key。
8. 冲突只标注，不自动替用户裁决。详见第 26 节。

## 21. V2 补充：Skill 包物理存储模型

P1 不允许“只保存 `SKILL.md`，references 以后再说”。完整 Skill 包是存储根基。

### 21.1 目录

构建工作区：

```
~/.jiucaihezi/skill-builds/<jobId>/
```

保存后的长期 Skill 包：

```
~/.jiucaihezi/skills/<skillId>/
├── manifest.json
├── SKILL.md
├── references/
├── scripts/
├── assets/
├── reports/
│   ├── source-analysis.json
│   ├── quality.json
│   └── test-results.json
└── versions/
    └── v1/
```

规则：

- job workspace 是临时构建区。
- 保存时必须复制到 `~/.jiucaihezi/skills/<skillId>/`。
- `agentStore` 只保存索引和 `skillContent` 快照，不引用 job workspace。
- job 清理不会破坏已保存 Skill。
- SQLite/idb 保存元数据，不保存大 blob。
- 二进制 assets 保存在文件系统。

### 21.2 Skill manifest

```json
{
  "schema_version": "2026-06-03.v1",
  "skill_id": "skill_...",
  "name": "react-docs",
  "version": 1,
  "source": "user",
  "created_at": "2026-06-03T12:00:00Z",
  "updated_at": "2026-06-03T12:00:00Z",
  "entry": "SKILL.md",
  "paths": {
    "references": "references",
    "scripts": "scripts",
    "assets": "assets",
    "reports": "reports"
  },
  "source_manifest": [],
  "quality": {
    "hard_gate_passed": true,
    "warnings": []
  },
  "test_summary": {
    "total_tests": 3,
    "with_skill_pass_rate": 0.9,
    "without_skill_pass_rate": 0.4
  }
}
```

### 21.3 `SkillConfig` 兼容方案

P1 不强行大改 `SkillConfig`，但必须新增最小字段：

```ts
interface SkillConfig {
  packagePath?: string
  packageManifestPath?: string
  assetIndex?: SkillAssetIndex[]
}
```

运行时加载：

- `skillContent` 仍用于快速加载 `SKILL.md`。
- `packagePath` 用于按需读取 references/scripts/assets。
- references 注入前做大小限制和边界标记。

迁移策略：

- 三个新增字段全部可选。
- 旧 Skill 没有 `packagePath` 时按纯 `skillContent` 运行，不报错。
- `agentStore` 加 `normalizeSkillConfig()`，读取时补齐 `references/examples/evolutionLog` 等默认值，并保留未知字段。
- 保存新版包时才写入 `packagePath/packageManifestPath/assetIndex`。
- 不做一次性破坏式迁移。

## 22. V3 补充：任务持久化

`skillBuildStore` 不能只放内存。

P1 规则：

- job 元数据存 SQLite/idb：`skill_build_jobs` 或现有 `kv_store` 前缀。
- job 大文件在文件系统。
- 应用重启后恢复 job 列表。
- `running` 状态的 job 启动后如果 runner 子进程不在，标记为 `interrupted`。
- `interrupted` job 可以：
  - 查看已有 artifacts。
  - 继续/重试。
  - 删除。

新增状态：

```ts
type SkillBuildStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'interrupted'
  | 'failed'
  | 'ready'
  | 'testing'
  | 'saved'
  | 'cancelled'
```

## 23. V3 补充：进度事件与 Tauri 推送

P1 不使用 SSE。runner 通过 Tauri event 推送 job 事件，同时把事件落盘。

事件通道：

```text
skill-build://job-event
```

事件：

```json
{
  "eventId": 17,
  "jobId": "job_...",
  "timestamp": "2026-06-03T12:01:00Z",
  "type": "stage_started",
  "stage": "scraping",
  "percent": 20,
  "message": "Skill Seekers: Extracting from PDF",
  "data": {
    "sourceId": "src_...",
    "stream": "stdout",
    "rawLine": "🔍 Extracting from PDF: document.pdf"
  }
}
```

事件类型：

| type | 说明 |
|---|---|
| `job_started` | job 开始 |
| `stage_started` | 阶段开始 |
| `progress` | 进度更新 |
| `log` | 可展示日志 |
| `artifact_created` | 产物生成 |
| `warning` | 可恢复问题 |
| `error` | 错误 |
| `job_ready` | 构建完成 |
| `job_failed` | 构建失败 |
| `job_cancelled` | 用户取消 |

进度规则：

- CLI stdout/stderr 不是结构化 API，不能假设每个阶段都有精确百分比。
- runner 按行解析已知关键词生成阶段事件；无法解析时作为 `log`。
- 百分比是 best-effort：阶段级估算，不承诺页级精确。
- CLI 长时间无输出时，runner 每 10 秒发 heartbeat：`type=progress,message=Still running...`。
- 每个 job 保留最近 500 条事件到 SQLite/idb。
- UI 展示阶段进度，不把完整 CLI stdout 塞进聊天消息。

## 24. V2 补充：质量门分级

质量门分为硬门和软门。

硬门不可跳过：

1. `SKILL.md` 存在。
2. frontmatter 合法：`name`、`description`。
3. `name` 长度 1-80。
4. `description` 长度 10-300。
5. 正文非空，且小于 50KB 运行时上限。
6. 所有 package 文件路径合法。
7. references/scripts/assets 不存在 symlink 逃逸。
8. 单个可注入 reference 文本小于 1MB，超过只能作为附件预览。
9. 保存前有用户确认。

软门可跳过，但必须记录 warning：

1. 少于 3 个测试用例。
2. `SKILL.md` 超过 500 行。
3. 没有 examples。
4. 没有明确输出格式。
5. with-skill 相比 without-skill 提升小于 20%。
6. 存在未处理冲突。

用户跳过软门时，`manifest.quality.warnings` 必须记录：

```json
{
  "code": "TESTS_SKIPPED",
  "message": "User saved without running 3 recommended tests",
  "user_confirmed_at": "2026-06-03T12:00:00Z"
}
```

## 25. V2 补充：失败恢复策略

| 失败 | 是否保留已完成数据 | 恢复动作 |
|---|---:|---|
| GitHub rate limit | 是 | 暂停 job，提示等待重试或填写 GitHub token；token 只保存在本次运行内存中，runner 通过子进程 env `GITHUB_TOKEN` 传给 CLI，不写入 argv、日志、localStorage 或 SQLite |
| 网络超时 | 是 | 允许重试当前 source；已下载页面不重抓 |
| PDF 加密 | 是 | 提示输入密码后重试 PDF source |
| PDF OCR 失败 | 是 | 降级为文本提取；允许关闭 OCR 重试 |
| 来源超规模 | 是 | 允许用户降低 `max_pages/max_files/max_bytes` 后重试 |
| CLI 非零退出 | 是 | 展示命令、退出码、最近日志；允许重试 |
| 缺少 `SKILL.md` | 是 | 允许用已提取 references 手动生成草稿，或重跑 build 阶段 |
| runner/CLI 进程崩溃 | 是 | job 标记 `interrupted`；重启 runner 后恢复 |
| 用户取消 | 是 | job 标记 `cancelled`；可复制已有 artifacts 新建 job |

每个 job stage 必须可重试：

```ts
type RetryStage = 'detect' | 'scrape' | 'normalize' | 'merge' | 'draft' | 'quality'
```

## 26. V2 补充：冲突模型

多源冲突不能只写一份 `conflicts.md`。P1 至少需要结构化冲突。

```ts
interface SkillSourceConflict {
  id: string
  topic: string
  severity: 'info' | 'warning' | 'blocking'
  sources: {
    sourceId: string
    claim: string
    evidencePath: string
    line?: number
  }[]
  suggestedResolution: 'prefer_docs' | 'prefer_code' | 'manual_review' | 'merge_with_warning'
  status: 'open' | 'accepted' | 'ignored' | 'resolved'
  resolutionNote?: string
}
```

P1 策略：

- runner 检测并标注冲突。
- 默认不让 LLM 自动裁决 blocking 冲突。
- 用户可以选择：
  - 采用文档说法。
  - 采用代码说法。
  - 保留警告。
  - 手动编辑 `SKILL.md`。
- 未处理的 warning/blocking 冲突进入软门 warning；blocking 冲突不阻止保存，但必须醒目标注。

## 27. V2 补充：规模上限

P1 默认上限：

| 来源 | 默认上限 | 可调最大值 | 超过后的行为 |
|---|---:|---:|---|
| 文档 URL | 200 页 | 1000 页 | `SOURCE_LIMIT_EXCEEDED`，提示降低范围 |
| GitHub repo | 5000 文件 / 500MB | 20000 文件 / 2GB | 建议 quick preset 或本地 clone |
| 本地代码目录 | 10000 文件 / 1GB | 50000 文件 / 5GB | 需要用户二次确认 |
| PDF | 300 页 / 200MB | 1000 页 / 1GB | 建议关闭 OCR 或分段 |
| Markdown/text | 20MB | 100MB | 超过只作为 reference，不直接进 prompt |
| 单个 artifact 预览 | 1MB 文本 | 10MB 文本 | 超过只在 Finder 中显示或用系统默认应用打开 |

所有上限写入 job options，不能隐藏在代码常量里。

## 28. V3 补充：桌面打包可行性策略

原 SDD 的“打包 wheel + venv”需要风险收敛。P1 不把 Python runtime 强行塞进正式包。

阶段策略：

1. **P1 开发版**：使用外部 `/Users/by3/Documents/Skill_Seekers` + `uv run skill-seekers`。目标是产品闭环，不做安装器。
2. **P1.5 内测版**：提供“配置 Skill Seekers runtime”入口，检测 `uv`、项目路径、版本和 `.venv` 体积。
3. **P2 发布版**：评估 macOS 签名/公证和 Windows 打包后，再决定是否内嵌 Python。

必须先量化：

- venv 安装后体积。
- 首次安装耗时。
- PyMuPDF 等 native dependency 在 macOS notarization 下是否可执行。
- Windows venv 路径、进程管理、杀进程策略。
- 离线安装是否可行。

P1 验收不要求解决跨平台打包，只要求本机开发环境可稳定运行。

## 28.1 V3 补充：外挂能力包 Skill Runtime Pack

产品决策：核心 Skill 能力必须内置，高级采集能力可以做成外挂能力包。目标用户是小白用户，不能要求他们自己找 Skill Seekers、装 Python、配依赖、看命令行。

### 内置能力

用户只安装韭菜盒子 APP 就必须可用：

1. Skill Creator：空白创建 `SKILL.md`。
2. 基础 Skill Builder：基于用户粘贴文本、Markdown/text 文件生成 Skill。
3. `run_skill_tests` / `save_skill` / `save_skill_package`。
4. Skill 保存、选择、聊天使用。
5. Skill 工作台 UI、任务列表、预览、测试、保存。

### 外挂能力包

高级能力以我们提供的包交付，而不是让用户自己安装：

```
Jiucai-SkillSeekers-Pack/
├── pack.json
├── README.txt
├── runtime/
│   ├── bin/
│   ├── python/
│   ├── wheels/
│   └── skill-seekers/
├── presets/
├── checksums.json
└── signature.json
```

也可以压缩为：

```
Jiucai-SkillSeekers-Pack-mac-arm64.jcpack
Jiucai-SkillSeekers-Pack-win-x64.jcpack
```

用户操作：

1. 安装韭菜盒子 APP。
2. 拿到我们提供的能力包文件夹或 `.jcpack` 文件。
3. 打开 APP 设置里的“能力包”。
4. 点击“添加能力包”或把包拖进去。
5. APP 校验签名、平台、版本、依赖。
6. 显示“Skill 高级构建能力已启用”。
7. 用户之后在 Skill Builder 里可用 PDF、文档 URL、GitHub、本地代码目录等能力。

### 能力包 manifest

```json
{
  "packId": "jiucai.skillseekers",
  "name": "Skill Seekers 高级构建包",
  "version": "0.1.0",
  "platform": "darwin-arm64",
  "minAppVersion": "1.0.0",
  "runtime": {
    "type": "cli",
    "command": "runtime/bin/skill-seekers",
    "argsPrefix": [],
    "versionCommand": ["runtime/bin/skill-seekers", "--version"]
  },
  "capabilities": [
    "skill.source.pdf",
    "skill.source.documentation",
    "skill.source.github",
    "skill.source.local_codebase"
  ],
  "entryChecksums": {
    "runtime/bin/skill-seekers": "sha256:..."
  }
}
```

### 安全规则

- APP 不执行未签名能力包。
- 能力包必须声明 platform，例如 `darwin-arm64`、`darwin-x64`、`win-x64`。
- 能力包只能暴露 manifest 声明的 capabilities。
- 能力包 runtime 不读取 NewAPI Token。
- GitHub token 仍只走 job 内存环境变量，不写入能力包。
- 能力包安装后复制到 `~/.jiucaihezi/packs/<packId>/<version>/`。
- 删除能力包不影响已保存 Skill 包。

### 阶段策略

P1：

- APP 内置核心 Skill 创建能力。
- Skill Seekers runtime 先使用开发者本机路径验证。

P1.5：

- 做第一个 macOS arm64 `.jcpack` 内测包。
- 设置页增加“能力包”管理 UI。
- 支持选择文件夹/`.jcpack` 后启用。

P2：

- 做 macOS x64 / Windows x64 包。
- 能力包签名、校验、升级、卸载。
- 官网提供“APP + 高级能力包”的下载说明。

## 29. V3 补充：测试与 CI

### 29.1 Rust/Tauri runner

- Rust 单元测试覆盖 CLI command builder、路径校验、artifact normalize、event parser。
- 不测试 Skill Seekers 源码内部逻辑，只测试我们如何调用和收敛产物。
- P1 本地命令：

```bash
cd src-tauri
cargo test skill_build
```

测试范围：

- source detection。
- path/URL validators。
- CLI command builder。
- stdout/stderr event parser。
- artifact normalize。
- failure recovery。

### 29.2 前端

- 单元测试：Vitest。
- P1 命令继续纳入现有 focused tests。
- 新增测试文件：
  - `src/stores/__tests__/skillBuildStore.test.ts`
  - `src/services/__tests__/skillBuildClient.test.ts`
  - `src/runtime/connection/__tests__/skillBuilderTools.test.ts`

### 29.3 E2E

P1 不要求完整 Playwright 自动化，但需要手动验收脚本：

1. 本地 Markdown fixture。
2. 小型 fake GitHub/local repo。
3. 小型 PDF fixture。

P2 再纳入 Playwright。

### 29.4 CI

P1 可以先不接远端 CI，但本地验收命令必须固定：

```bash
pnpm run test:focused:build
pnpm run test:focused:run
pnpm run test:conversation
pnpm exec vue-tsc -b
cd src-tauri && cargo test skill_build
```

## 30. V3 补充：画布系统接入

Skill 不是只给聊天使用。P1 保存后的 Skill 必须可被画布节点读取。

P1 范围：

- 画布 LLM 节点继续使用现有 Skill 选择逻辑。
- 保存到“我的 Skill”的 Skill 出现在画布 Skill 选择器中。
- P1 不把 `packagePath` references 注入画布 runtime，避免牵动 `canvasLlmRuntime.ts`、`canvasInputs.ts` 和节点数据模型。
- 画布不直接执行 Skill Builder 长任务。

P1.5/P2 范围：

- 评估并实现 package references 在聊天和画布的统一注入策略。
- 修改 `canvasLlmRuntime.ts` / `canvasInputs.ts` 时必须单独做画布回归测试。
- 新增 `SkillBuildNode` 或在工具节点中选择“构建 Skill”。
- 画布可引用构建 job artifact，但仍需用户确认保存。

## 31. V3 补充：Skill Seekers 版本锁定

P1 锁定 Skill Seekers 版本，不跟随最新。

规则：

- runner 记录 `SUPPORTED_SKILL_SEEKERS_VERSION_RANGE`。
- 开发期锁定当前本地项目的 git commit 和 `pyproject.toml` 版本。
- runner 启动时检查 `uv run skill-seekers --version`，不匹配返回 `VERSION_MISMATCH`。
- 升级 Skill Seekers 必须跑 Rust runner tests + 三个 fixture 构建验收。
- 不允许线上自动升级。

manifest 中记录：

```json
{
  "skill_seekers_version": "3.8.0.dev0",
  "skill_seekers_git_commit": "..."
}
```

## 32. V2 补充：前端 UI 布局

工作台不做大弹窗。按现有 5 列工作台协调：

- `ActivityRail`：新增或复用 Skill 入口。
- `FileTreePanel`：展示 Skill 分类、我的 Skill、构建任务。
- 主内容区：`SkillWorkbenchPanel`，替换 ChatPanel 的主视图，不叠在聊天上。
- 右侧详情区：artifact preview / quality report / conflicts。

6 步 UI 是主内容区内的 stepper：

1. 来源
2. 计划
3. 构建
4. 审查
5. 测试
6. 保存

移动端：

- stepper 改为顶部横向 compact。
- artifact preview 进入全屏子页。

## 33. V3 补充：Chat 工具注册和执行链路

新增工具不要散落在 `useChat.ts` switch-case 中无限增长。P1 增加独立模块：

```
src/utils/skillBuilderTools.ts
```

职责：

- 导出工具 definitions。
- 导出 `executeSkillBuilderToolCall(call)`。
- 内部调用 `skillBuildClient`，再由 Tauri command 进入 runner。
- 做参数 schema 校验、大小限制、错误脱敏。

注册：

- `toolConnectionAdapter.ts` 的 `isSkillCreationAgent()` 扩展：
  - `preset_skill-creator`：只给 `run_skill_tests` / `save_skill`。
  - `preset_skill-builder`：给 `skill_builder_*` + `run_skill_tests` + `save_skill_package`。
- 普通聊天不暴露。

执行：

- `useChat.ts` 只加一条分发：

```ts
const skillBuilderResult = await executeSkillBuilderToolCall(call)
if (skillBuilderResult) return skillBuilderResult
```

工具名到方法映射在 `skillBuilderTools.ts`：

```ts
const SKILL_BUILDER_TOOL_HANDLERS = {
  skill_builder_detect_sources: detectSourcesHandler,
  skill_builder_create_job: createJobHandler,
  skill_builder_start_job: startJobHandler,
  skill_builder_read_artifact: readArtifactHandler,
  skill_builder_quality_check: qualityCheckHandler,
  save_skill_package: saveSkillPackageHandler,
}
```

## 34. V2 补充后自检

- 没有把 Skill 改成自主 Agent。
- 没有让资料自动进入 Vault。
- 没有要求用户理解 MCP 才能使用。
- 没有默认上传外部平台。
- 没有把 Skill Seekers 直接塞进前端。
- 已明确当前缺口、推荐架构、用户流程、权限、安全、测试、阶段验收。
- 已明确拒绝 P1 FastAPI/REST/SSE，改为 Tauri command + event。
- 已补齐 Skill Seekers CLI 实测结论、映射、输出规范化和 P1 拒绝策略。
- 已补齐 Skill 包长期文件系统存储模型，避免 job 清理后 Skill 损坏。
- 已补齐 Tauri 进度事件、任务持久化、失败恢复和规模上限。
- 已补齐硬/软质量门，跳过测试只允许跳过软门。
- 已补齐冲突模型、测试/CI、画布接入、版本锁定、UI 布局和工具执行链路。

# 素材转Skill P2 原生资料编译器 SDD

日期：2026-06-04  
状态：SDD 草案，等待 P1 用户实测反馈后执行  
关联文档：`docs/sdd/native-tool-runtime-kernel-sdd.md`、`docs/sdd/skill-capability-core-sdd.md`  
核心结论：P2 不把 Skill Seekers 的 MCP/CLI 原样暴露给模型；只新增一个韭菜盒子高层工具 `compile_skill_materials`，内部通过 Job Runner 调用资料编译器，最终回到 P1 已完成的 `draft_id -> run_skill_tests -> save_skill` 链路。

---

## 1. 一句话定案

`素材转Skill` P2 的目标不是做一个新的工作台，也不是让用户配置 Skill Seekers。  

目标是：

```text
用户选择“素材转Skill”
  ↓
用户粘贴/上传/提供资料来源
  ↓
模型只调用一个高层资料编译工具 compile_skill_materials
  ↓
APP 后台 Job 采集、转换、规范化资料
  ↓
生成 Skill 草稿 draft_id
  ↓
继续沿用 P1：展示草稿 -> 至少 3 个测试 -> 用户确认 -> save_skill
```

用户看到的体验仍然简单：

```text
把资料给 APP
等它整理成 Skill 草稿
确认测试结果
保存
```

底层可以接 Skill Seekers、未来也可以换成其它资料编译器，但对用户和聊天模型都只暴露韭菜盒子自己的窄接口。

---

## 2. P2 范围

### 2.1 P2 必做

1. 新增 `compile_skill_materials` 高层工具。
2. 通过 `ToolJobRunner` 后台执行资料编译，不阻塞聊天流。
3. 支持 4 类高级来源：
   - PDF 文件
   - 文档 URL
   - GitHub 仓库
   - 本地代码目录
4. 编译完成后生成应用内 `draft_id`。
5. 产物必须规范化为标准 Skill 包：
   - `SKILL.md`
   - `references/`
   - `assets/`
   - `scripts/`
   - `skill-package.json`
   - `reports/source-analysis.json`
   - `reports/build.log`
6. 保存仍然调用现有 `save_skill`，并且必须满足 P1 保存门禁。
7. 没有高级 runtime 时，不暴露高级来源工具，不让模型假装能抓取 URL/GitHub/PDF。

### 2.2 P2 不做

1. 不新增按钮式工作台。
2. 不把 40 个 Skill Seekers MCP 工具暴露给聊天模型。
3. 不让用户自己安装 Python、uv、MCP server。
4. 不把 NewAPI Token 传给 Skill Seekers 或外挂 runtime。
5. 不做 AI 自动写入知识库。
6. 不做多轮黑盒 Agent Loop。
7. 不做完整跨平台能力包发布；P2 只要求本机开发版和能力包接口设计可用。

---

## 3. 用户体验

### 3.1 有高级 runtime 时

用户操作：

```text
1. 选择 Skill：素材转Skill
2. 输入：“把这个 PDF 做成一个 Skill”
3. 拖入 PDF，或粘贴文档 URL / GitHub 地址 / 本地目录
4. APP 显示工具正在整理资料
5. 工具完成后，聊天里出现 Skill 草稿摘要和下一步测试建议
6. 用户确认后运行测试
7. 测试通过后用户说“保存”
8. Skill 进入“我的 Skill”
```

用户不需要知道：

- Skill Seekers
- MCP
- uv
- Python venv
- CLI 参数
- 输出目录

### 3.2 没有高级 runtime 时

用户拖入 PDF / URL / GitHub 时：

```text
当前已支持：文本、Markdown、可读附件。
PDF、文档 URL、GitHub、本地代码目录需要“Skill 高级构建能力包”。
```

处理原则：

- 不报复杂技术错误。
- 不让模型继续编造处理过程。
- 文本/Markdown 路径仍然可用。
- 后续能力包接入后自动解锁高级来源。

---

## 4. 总架构

P2 嵌入现有 RuntimeConnection，不新增第二个协调器。

```text
ChatPanel
  ↓
ConversationContextEngine
  ↓
RuntimeConnection
  ├─ SkillConnection：选中 preset_skill-builder
  ├─ KnowledgeConnection：只读，可关闭
  ├─ ToolConnection：暴露 P2 builder 工具
  └─ LlmConnection
  ↓
LLM tool_call: compile_skill_materials
  ↓
ToolRuntimeKernel
  ↓
SkillMaterialCompilerExecutor
  ↓
ToolJobRunner
  ↓
Runtime Pack / Dev Skill Seekers CLI
  ↓
Normalize Output
  ↓
SkillBuilderDraftStore
  ↓
返回 draft_id
  ↓
run_skill_tests
  ↓
save_skill
```

边界：

| 层 | 负责 | 不负责 |
|---|---|---|
| `RuntimeConnection` | 决定本轮能暴露哪些工具 | 执行 CLI |
| `ToolRuntimeKernel` | 校验工具是否被暴露、调用执行器 | 选择 Skill/Knowledge/Model |
| `ToolJobRunner` | 后台执行、记录事件、取消任务 | 拼 prompt |
| `SkillMaterialCompilerExecutor` | 调 runtime、规范化产物、创建 draft | 保存最终 Skill |
| `save_skill` | 保存已确认 Skill 包 | 采集资料 |

---

## 5. 工具契约

### 5.1 新增工具：`compile_skill_materials`

只在选中 `preset_skill-builder` 且高级 runtime 可用时暴露。

```ts
interface CompileSkillMaterialsArgs {
  name: string
  description?: string
  sources: SkillMaterialSourceInput[]
  preset?: 'quick' | 'standard'
  limits?: {
    maxPages?: number
    maxFiles?: number
    maxBytes?: number
  }
}
```

```ts
type SkillMaterialSourceInput =
  | {
      type: 'pdf'
      fileName: string
      attachmentId?: string
      path?: string
    }
  | {
      type: 'documentation_url'
      url: string
    }
  | {
      type: 'github_repo'
      repo: string
      ref?: string
      githubToken?: string
    }
  | {
      type: 'local_codebase'
      path: string
    }
```

返回：

```ts
interface CompileSkillMaterialsResult {
  status: 'running' | 'ok' | 'error'
  jobId?: string
  draft_id?: string
  message: string
  package?: {
    skillMdPath: string
    manifestPath: string
    referenceCount: number
    assetCount: number
    reportPath: string
  }
  error?: SkillMaterialCompilerErrorCode
  next_step?: string
}
```

错误码：

```ts
type SkillMaterialCompilerErrorCode =
  | 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE'
  | 'UNSUPPORTED_SOURCE_TYPE'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_ACCESS_DENIED'
  | 'GITHUB_TOKEN_REQUIRED'
  | 'GITHUB_RATE_LIMITED'
  | 'PDF_ENCRYPTED'
  | 'CLI_COMMAND_FAILED'
  | 'SKILL_OUTPUT_MISSING'
  | 'SKILL_OUTPUT_UNSAFE_PATH'
  | 'SKILL_PACKAGE_NORMALIZE_FAILED'
```

### 5.2 为什么只新增一个工具

P1 已有 5 个工具：

```text
build_skill_from_text
local_extract_attachment
document_to_markdown
run_skill_tests
save_skill
```

P2 只补高级资料来源：

```text
compile_skill_materials
```

不再新增：

- `scrape_docs`
- `scrape_github`
- `scrape_pdf`
- `enhance_skill`
- `install_skill`
- `marketplace_*`

原因：这些是实现细节，不是用户理解的产品动作。

---

## 6. Source 映射

| 用户输入 | source type | P2 行为 | Runtime |
|---|---|---|---|
| 粘贴文本 / Markdown | `text` / `markdown` | 继续走 P1 `build_skill_from_text` | 原生 TS |
| 可读附件 | `attachment_text` | 继续走 P1 `local_extract_attachment` | 原生 TS |
| 需要转换的本地文档 | `document_to_markdown` | 继续走 P1 `document_to_markdown` | 原生 TS |
| PDF | `pdf` | `compile_skill_materials` | Skill Seekers runtime |
| 文档 URL | `documentation_url` | `compile_skill_materials` | Skill Seekers runtime |
| GitHub repo | `github_repo` | `compile_skill_materials` | Skill Seekers runtime |
| 本地代码目录 | `local_codebase` | `compile_skill_materials` | Skill Seekers runtime |
| Notion / Confluence / Slack / 视频 / EPUB / OpenAPI | unsupported | P2 拒绝，P3 再加 | 无 |

原则：

- 不降级猜测。
- 不把不支持来源塞进文本 prompt 让模型硬编。
- 不支持就明确告诉用户当前能力边界。

---

## 7. Runtime 策略

### 7.1 P2 开发版 runtime

开发期允许使用：

```text
/Users/by3/Documents/Skill_Seekers
```

默认命令：

```bash
uv run skill-seekers create <source> --name <name> --enhance-level 0 --quiet --non-interactive
```

已知事实：

- 本机没有全局 `skill-seekers`。
- `uv run skill-seekers --help` 可用。
- 首次安装 `.venv` 约 400M。
- `--output` 不完全可信，runner 必须兜底扫描 job cwd 的输出目录。
- `.md` 不交给 Skill Seekers，继续由 P1 原生 builder 处理。

### 7.2 P2 能力包接口

P2 先做接口，不要求发布完整跨平台包。

能力包 manifest：

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
    "versionCommand": ["runtime/bin/skill-seekers", "--version"]
  },
  "capabilities": [
    "skill.source.pdf",
    "skill.source.documentation_url",
    "skill.source.github_repo",
    "skill.source.local_codebase"
  ]
}
```

P2 只实现检测和读取配置：

- 读取开发路径 runtime。
- 读取已安装能力包 runtime。
- 检测 runtime 是否可执行。
- 检测支持的 source capabilities。
- 根据检测结果决定是否暴露 `compile_skill_materials`。

不做：

- `.jcpack` 解压安装。
- 签名校验。
- 自动升级。
- Windows 打包。

---

## 8. Job Workspace

每个编译任务必须隔离：

```text
~/.jiucaihezi/skill-builds/<jobId>/
├── input/
│   └── source-manifest.json
├── raw-output/
│   └── source-<n>/
├── normalized/
│   └── source-<n>.md
├── skill/
│   ├── SKILL.md
│   ├── references/
│   ├── assets/
│   └── scripts/
└── reports/
    ├── source-analysis.json
    └── build.log
```

`skill/` 才能进入保存链路。`raw-output/` 不直接暴露给 `save_skill`。

---

## 9. 输出规范化

Compiler 完成后必须执行 normalize：

1. 从 raw output 查找 `SKILL.md`。
2. 复制到 `<job>/skill/SKILL.md`。
3. 复制 `references/`、`assets/`、`scripts/`。
4. 生成 `skill-package.json`。
5. 生成 `reports/source-analysis.json`。
6. 生成 `reports/build.log`。
7. 对所有路径做安全检查：
   - 不允许绝对路径。
   - 不允许 `..`。
   - 不允许空字节。
   - 不允许 symlink 逃逸。
8. 对文件大小做限制：
   - `SKILL.md` 最大 100KB。
   - 单个 reference 最大 20MB。
   - 单个 asset 最大 50MB。
   - 总包最大 200MB。

如果找不到 `SKILL.md`：

```text
返回 SKILL_OUTPUT_MISSING
保留 reports/build.log
提示用户可换更小资料或先转成 Markdown
```

---

## 10. Draft 接入

P2 不新增保存系统。编译完成后，把 `skill/` 目录读取成 P1 草稿记录：

```ts
interface SkillBuilderCompiledDraftRecord {
  draftId: string
  sessionId: string
  jobId: string
  skillMd: string
  references: SkillPackageReference[]
  manifest: SkillPackageDraftManifest
  packageWorkspacePath: string
  reports: {
    sourceAnalysisPath: string
    buildLogPath: string
  }
  createdAt: number
}
```

之后继续使用已有门禁：

```text
draftReady -> run_skill_tests >= 3 -> user explicit save -> save_skill(draft_id)
```

---

## 11. GitHub Token 策略

P2 支持无 token 和临时 token 两种。

无 token：

- 小仓库可以跑。
- 触发 rate limit 时返回 `GITHUB_RATE_LIMITED`。
- 提示用户：“这个仓库需要 GitHub Token 才能继续。”

有 token：

- token 只在本次 job 内存中使用。
- token 通过环境变量传给子进程，不进入 argv。
- `build.log` 必须脱敏。
- 不写入 SQLite、localStorage、能力包目录、job workspace。

---

## 12. 进度事件

P2 不承诺 Skill Seekers CLI 有结构化实时进度。Job 事件分两类：

确定事件：

```text
queued
runtime_check
source_prepare
compiler_start
compiler_exit
normalize_start
normalize_done
draft_ready
failed
```

推断事件：

```text
stdout_line
stderr_line
elapsed
```

用户侧文案只显示稳定状态：

```text
正在检查资料
正在整理资料
正在生成 Skill 草稿
正在保存草稿
已生成草稿
```

不显示虚假的百分比。

---

## 13. UI 原则

P2 不改主 UI 结构。

允许的小改动：

1. 工具卡片显示“正在整理资料”。
2. 工具完成后显示“草稿已生成，可测试”。
3. 错误时显示一句用户能理解的话。
4. 产物按钮沿用 Artifact Store：打开 `SKILL.md`、打开报告、在 Finder 显示。

禁止：

1. 新增 6 步按钮式工作台。
2. 在 Skill 仓库右键菜单增加“从资料创建 Skill”。
3. 让用户选择 CLI、MCP、Python、venv。
4. 弹复杂配置表单。

---

## 14. 文件级方案

### 14.1 新增文件

```text
src/utils/skillMaterialCompiler.ts
src/utils/skillMaterialRuntime.ts
src/utils/skillMaterialNormalizer.ts
src/utils/__tests__/skillMaterialCompiler.test.ts
src/utils/__tests__/skillMaterialRuntime.test.ts
src/utils/__tests__/skillMaterialNormalizer.test.ts
```

职责：

| 文件 | 职责 |
|---|---|
| `skillMaterialRuntime.ts` | 检测开发路径 / 能力包 runtime，构建安全 CLI 命令 |
| `skillMaterialCompiler.ts` | 高层 executor，创建 job、调用 runtime、写 draft |
| `skillMaterialNormalizer.ts` | 从 raw output 复制并净化为标准 Skill 包 |

### 14.2 修改文件

```text
src/utils/skillBuilderTools.ts
src/runtime/connection/toolConnectionAdapter.ts
src/runtime/connection/skillConnectionAdapter.ts
src/runtime/tools/nativeExecutors.ts
src/composables/useChat.ts
package.json
docs/sdd/native-tool-runtime-kernel-sdd.md
public/skills/skill-builder/SKILL.md
```

修改点：

| 文件 | 修改 |
|---|---|
| `skillBuilderTools.ts` | 导出 `COMPILE_SKILL_MATERIALS_TOOL` 和 executor |
| `toolConnectionAdapter.ts` | runtime 可用时给 `preset_skill-builder` 暴露 `compile_skill_materials` |
| `skillConnectionAdapter.ts` | prompt 改成“高级 runtime 可用时可编译 PDF/URL/GitHub/目录” |
| `nativeExecutors.ts` | 路由 `compile_skill_materials` |
| `useChat.ts` | 传入 files/sessionId/userInput 给 compiler executor |
| `package.json` | focused 测试加入 P2 测试文件 |
| `public/skills/skill-builder/SKILL.md` | 去掉“当前没有 Skill Seekers”绝对说法，改条件式 |

---

## 15. TDD 执行步骤

### Task 1：Runtime 检测与命令构建

测试：

- 找不到 runtime 时返回 unavailable。
- 开发路径存在时返回 capabilities。
- GitHub token 不进入 argv。
- URL 只允许 `http/https`。
- 本地目录必须是绝对路径且不能包含空字节。

命令：

```bash
pnpm exec esbuild src/utils/__tests__/skillMaterialRuntime.test.ts --bundle --platform=node --format=esm --alias:@=./src --outdir=/private/tmp/jc-skill-material-tests
node --test /private/tmp/jc-skill-material-tests/skillMaterialRuntime.test.js
```

### Task 2：Normalizer

测试：

- raw output 有 `SKILL.md` 时复制到 `skill/`。
- `references/` 被保留。
- `../secret.md` 被拒绝。
- symlink 逃逸被拒绝。
- 缺 `SKILL.md` 返回 `SKILL_OUTPUT_MISSING`。

### Task 3：Compiler Executor

测试：

- 调用 `compile_skill_materials` 立即返回 running job。
- job 完成后生成 `draft_id`。
- draft 只绑定当前 session。
- runtime 不可用时返回 `SKILL_MATERIAL_RUNTIME_UNAVAILABLE`。
- PDF/GitHub/URL/本地目录 source 分别能构建命令。

### Task 4：ToolConnection 暴露策略

测试：

- 普通对话不暴露 `compile_skill_materials`。
- `preset_skill-builder` 且 runtime 可用时暴露。
- runtime 不可用时不暴露，并且 prompt 不声称支持高级来源。
- MCP 开关不影响该内置工具。

### Task 5：Chat 闭环

测试：

- 用户选 `素材转Skill`，传入 PDF，模型调用 `compile_skill_materials`。
- job 完成后下一轮可用 `draft_id` 运行 `run_skill_tests`。
- 未测试前 `save_skill` 仍被拦截。
- 用户确认保存后 `save_skill(draft_id)` 成功。

### Task 6：Focused 回归

加入：

```text
src/utils/__tests__/skillMaterialRuntime.test.ts
src/utils/__tests__/skillMaterialNormalizer.test.ts
src/utils/__tests__/skillMaterialCompiler.test.ts
```

验证：

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run test:focused:run
pnpm run test:conversation
```

---

## 16. 验收标准

P2 完成后必须满足：

1. 用户不装 MCP，也能通过 `素材转Skill` 使用高级资料编译。
2. 高级 runtime 不可用时，不暴露虚假工具。
3. PDF / URL / GitHub / 本地目录至少各有一个 fixture 级测试。
4. 编译任务后台运行，不让聊天停在“正在回复中”。
5. 编译产物必须进入 `draft_id`，不能靠模型复制大段 JSON 保存。
6. `references/` 保存后不丢失。
7. GitHub token 不进入日志、argv、SQLite、localStorage。
8. 失败有可恢复提示。
9. 不新增按钮式工作台。
10. 不影响 P1 文本/Markdown 路径。

---

## 17. 风险与决策

### 17.1 最大风险

Skill Seekers CLI 输出路径和格式不稳定。

决策：

- 不信任单一路径。
- runner 兜底扫描 raw output。
- normalize 后才进入产品存储。

### 17.2 第二风险

首次 runtime 安装太慢或不可用。

决策：

- P2 开发版只验证本机路径。
- 发布版走能力包，不让用户自己安装。
- runtime 不可用时工具不暴露。

### 17.3 第三风险

模型误以为可以直接保存。

决策：

- 保持 P1 `SkillBuilderRuntime` 保存门禁。
- `compile_skill_materials` 只能生成 draft，不能保存最终 Skill。

---

## 18. 最终判断

P2 的正确形态是：

```text
一个高层资料编译工具
一个后台 Job
一个规范化 Skill 包
一个 draft_id
回到 P1 保存门禁
```

这比直接接 MCP 更简单，比按钮式工作台更符合现有产品，也比把 Skill Seekers 直接塞进 APP 主链路更稳。


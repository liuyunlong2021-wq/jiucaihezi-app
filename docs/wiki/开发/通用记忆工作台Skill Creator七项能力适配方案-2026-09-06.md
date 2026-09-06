# 通用记忆工作台 Skill Creator 七项能力适配方案

> 日期：2026-09-06  
> 状态：七阶段代码适配已完成，待真实 Desktop 手工验收  
> 官方参照：[Anthropic Skill Creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)  
> 现行相关文档：[[排障/Skill Creator无法读取已安装Skill-2026-09-05]]、[[开发/通用记忆工作台Skill核心插件与统一插件架构SDD-2026-09-01]]

## 1. 用户决策与范围

Skill 由用户在界面中手动选择。没有选择就不加载、不执行，因此本方案不建设自动触发率优化：

- 不增加 `should_trigger` / `should_not_trigger` 查询集。
- 不增加训练集、保留集或自动 description 搜索循环。
- 不模拟 Claude 的 `available_skills`、`.claude/commands` 或 `claude -p`。
- `description` 仍需准确，用于用户理解、搜索和列表展示，但不以自动命中率作为产品目标。

本方案适配其余七项能力：

1. 完整多文件 Skill 包安装。
2. 评审反馈持久化与跨轮读取。
3. 草稿版本、内容哈希与确认绑定。
4. 官方结构校验与韭菜盒子扩展兼容。
5. 重复测试、旧版本基线与可信统计。
6. 完整 Grader：执行记录、文件产物、claims 和断言质量。
7. 可选 Blind A/B Comparator 与事后 Analyzer。

## 2. 不变的产品合同

以下边界在所有阶段保持不变：

- 用户 Skill 的唯一真实目录仍是中央 Skill 根目录 `~/.agents/skills/<skill-id>/`。
- 模型、普通文件工具和项目文件系统不得直接写中央 Skill 根目录。
- 创建和修改都先写受控临时草稿；只有用户确认安装卡后才能提交。
- 最终提交必须经过 Tauri/Rust 专用命令；Web 继续使用现有浏览器存储能力，不伪造 Desktop 文件落盘。
- 复用现有 `SkillCreatorRuntime`、`skillCreatorToolExecutor`、中央 Skill 扫描和安装卡，不建设第二套 Skill 管理器。
- `triggers` 是韭菜盒子的手动搜索与筛选扩展，继续支持，但不承担自动模型触发。
- 测试、评分和分析使用应用当前选择的 provider/model，不出现模型品牌硬编码。
- 测试默认可选；用户未要求测试时，允许在结构校验、预览和明确确认后安装。状态机必须与这一合同一致。

## 3. 目标数据模型

### 3.1 草稿

草稿以 `(session_id, draft_id)` 隔离，每次内容变更生成新 revision：

```ts
interface SkillCreatorDraft {
  schemaVersion: 2
  draftId: string
  sessionId: string
  targetSkillId?: string
  revision: number
  contentHash: string
  skillMd: string
  files: Array<{
    path: string
    content: string
    mimeType: string
    sha256: string
    bytes: number
  }>
  createdAt: string
  updatedAt: string
}
```

规则：

- `contentHash` 是规范化包内容的 SHA-256，不只计算 `SKILL.md`。
- 包路径只允许 `SKILL.md`、`references/`、`scripts/`、`assets/` 和经确认保留的扩展目录。
- Desktop 草稿保存在系统临时目录下的应用专属根目录，例如 `<temp>/jiucaihezi-skill-drafts/<session>/<draft>/revision-N/`。
- 草稿目录不是安装目录；应用启动时可恢复，成功安装后删除对应草稿，过期草稿按固定保留期清理。
- 内存 Map 只作热缓存，磁盘草稿才是 Desktop 的恢复真源。

### 3.2 安装确认令牌

新安装卡不再依赖模型重新复制完整 Skill 包，而引用已校验草稿：

```ts
interface SkillInstallTokenV2 {
  schemaVersion: 2
  draftId: string
  sessionId: string
  revision: number
  contentHash: string
  targetSkillId: string
}
```

兼容规则：

- 继续解析旧版单文件 `jc-skill-install`，避免历史对话失效。
- V2 安装卡展示从草稿读取的 `SKILL.md` 和文件清单。
- 点击确认时重新读取草稿并校验 revision/hash；不一致则拒绝安装并要求重新生成确认卡。
- 模型提供的目标路径一律不可信；Rust 只接受受控 token，并自行解析临时根和中央根。

### 3.3 评审工作区

```text
skill-workspaces/<session-id>/<draft-id>/
├── history.json
├── iteration-1/
│   ├── eval-results.json
│   ├── benchmark.json
│   ├── feedback.json
│   └── eval-001/
│       ├── eval-metadata.json
│       ├── with-skill/run-1/
│       │   ├── transcript.json
│       │   ├── outputs/
│       │   ├── metrics.json
│       │   ├── timing.json
│       │   └── grading.json
│       └── baseline/run-1/
└── iteration-2/
```

`history.json` 记录 revision、iteration、测试模型、用户反馈摘要和安装状态，不保存 API Key。

## 4. 七项能力的适配设计

### 4.1 完整多文件 Skill 包安装

#### 当前缺口

- `save_skill` 的临时草稿可以包含 references，但安装卡只解析完整 `SKILL.md`。
- `approveSkillInstall()` 最终调用 `createAgent()`，Rust 的 `save_central_skill` 只写一个 `SKILL.md`。
- `packageSkillDraft()` 只生成 manifest/asset index，没有形成可提交的真实包事务。

#### 适配方式

1. 扩展草稿 manifest，逐文件保存 `path`、`sha256`、`bytes` 和 MIME。
2. `save_skill` 返回 V2 安装 token，不直接写中央目录。
3. 安装卡通过 token 加载草稿预览，展示目标 ID、更新/新建状态和文件清单。
4. 新增专用 Rust 命令 `commit_central_skill_draft`：
   - 只从应用受控临时根读取 `draftId/revision`。
   - 重新计算包 hash，并与安装 token 比较。
   - 重新执行结构、路径、文件大小和符号链接检查。
   - 在中央根旁建立临时目标目录，成功后原子切换。
   - 失败时保留旧版本并清理未完成目录。
5. 中央 Skill 目录写入 `.jc-skill-package.json`，记录应用管理的文件。
6. 更新时只删除旧 manifest 标记为“应用管理”且新包已移除的文件；没有旧 manifest 的历史 Skill 默认保留未知文件，避免误删用户内容。
7. 安装成功后统一执行现有中央 Skill 扫描和 UI 刷新。

#### 主要修改位置

- `src/runtime/memory/skillInstall.ts`
- `src/components/memory/MemoryWorkbench.vue`
- `src/runtime/memory/skillCreatorToolExecutor.ts`
- `src/utils/skillBuilderTools.ts`
- `src/utils/skillPackageStorage.ts`
- `src/stores/agentStore.ts`
- `src-tauri/src/skills/skills.rs`
- 对应 Tauri command 注册文件和 focused/Rust 测试

#### 完成定义

- 新建包含 `SKILL.md + references + scripts + assets` 的草稿，确认前中央根无变化。
- 确认后所有文件一次性出现，任一文件失败时旧 Skill 完整保留。
- 更新包不会误删历史未知文件，也不会留下旧 manifest 管理的废弃文件。
- 路径穿越、绝对路径、符号链接逃逸、hash 不一致和过期 revision 均被拒绝。

### 4.2 评审反馈持久化与跨轮读取

#### 当前缺口

- 评审页 textarea 只写页面内存，没有保存按钮或应用回传。
- `previousFeedback` 参数存在，但打开评审页的调用没有传入。
- 工作区只写 `eval-review.html`、`eval-results.json`、`benchmark.json`。

#### 适配方式

1. 把评审页改为应用内可提交表单；静态 HTML 不直接获得任意文件写权限。
2. 新增 `skill_creator_submit_eval_feedback`，输入 `draft_id`、iteration 和逐 run 反馈。
3. 工具在对应工作区写入 `feedback.json`，返回已保存数量和空反馈数量。
4. 新增 `skill_creator_load_eval_feedback`，为下一轮返回上一轮反馈和输出索引。
5. `skill_creator_open_eval_review` 自动加载前一 iteration 的反馈与输出。
6. 空反馈定义为“该结果没有修改意见”，不得当成未提交。
7. 页面关闭、应用重启后重新打开，反馈仍可恢复。

#### 完成定义

- 提交反馈后磁盘存在结构化 `feedback.json`。
- 第二轮评审同时展示当前输出、上一轮输出和上一轮反馈。
- 非当前 session/draft 不能读取或覆盖反馈。
- Web 无 Desktop 工作区时使用现有浏览器持久化方案，并明确能力边界。

### 4.3 草稿 revision/hash 与确认绑定

#### 当前缺口

- 草稿主体仍以进程内 Map 为主，重启会丢失。
- `SkillCreatorRuntime` 只按 session/test ID 记录布尔状态，没有绑定 draft revision。
- 用户看到的版本与最终安装版本之间没有强一致校验。

#### 适配方式

1. 新建或首次校验生成 revision 1；每次修改生成 revision + 1，不覆盖旧 revision。
2. validate、test、review、package、save 都必须携带 `draft_id + revision + content_hash`。
3. 状态机快照增加这三个字段；工具结果与状态机不一致时返回 `STALE_SKILL_DRAFT`。
4. 任意内容修改后自动清空旧 revision 的 validated/tested/reviewed 状态。
5. 用户确认只对安装卡引用的 revision 生效。
6. 安装成功写入 history；失败不改变草稿和已安装版本。
7. 明确定义清理：成功安装立即清理已提交 revision，其余草稿超过保留期再清理。

#### 完成定义

- 修改草稿后点击旧安装卡必定失败，不会静默安装新内容。
- 应用重启后能够恢复未过期草稿和当前 revision。
- 两个会话使用相同 draft ID 文本也不能互相读取。

### 4.4 官方结构校验与产品扩展兼容

#### 当前缺口

- 当前 TypeScript 校验只确认 frontmatter、name、description、正文和安全路径是否存在。
- 没有完整校验 YAML 类型、name 形式和长度、description 长度与禁止字符、compatibility 类型与长度。
- 当前 frontmatter 解析依赖正则，不能可靠处理 YAML 引号、块文本和嵌套 metadata。

#### 适配方式

1. 复用 Rust 已有 `serde_yaml` 在最终信任边界执行完整校验；前端可以提供同规则预检，但不能替代 Rust。
2. 官方字段：`name`、`description`、`license`、`allowed-tools`、`metadata`、`compatibility`。
3. 产品扩展字段：允许 `triggers`，定义为字符串数组，仅用于 UI 搜索和手动选择。
4. name 规则：小写字母、数字、单连字符，不能首尾连字符或连续连字符，最长 64。
5. description：必须是字符串，非空，最长 1024，不包含 `<` 或 `>`。
6. compatibility：如存在必须为字符串，最长 500。
7. 校验所有包路径、单文件大小、总包大小、UTF-8 文本和符号链接。
8. 返回稳定错误码和字段路径，UI 展示具体问题，不只返回拼接字符串。

#### 完成定义

- 官方合法 Skill 和带 `triggers` 的韭菜盒子 Skill 均通过。
- 非法 YAML、错误类型、超长字段、非法 name 和危险路径均有定向测试。
- 前端预检和 Rust 最终校验共享同一组 fixture，结果不得漂移。

### 4.5 重复测试、旧版本基线与可信统计

#### 当前缺口

- 每个配置固定只运行一次，`runs_per_configuration` 和 `run_number` 实际恒为 1。
- 修改现有 Skill 时 baseline 仍是 without-skill，没有比较旧版本。
- 当前标准差跨不同测试用例计算，不能表示同一用例的稳定性。
- 结果没有明确记录 provider/model。

#### 适配方式

1. `run_skill_tests` 增加 `baseline_mode: without_skill | installed_version | revision`。
2. 新建 Skill 默认 `without_skill`；修改 Skill 默认使用加载时快照的 installed version。
3. 增加 `runs_per_configuration`，默认 1；用户要求稳定性或正式 benchmark 时建议 3，上限由成本门禁控制。
4. 每个 eval/configuration/run 独立记录 timing、tokens、错误和模型信息。
5. 统计先按同一 eval/configuration 聚合重复运行，再计算整个测试集摘要。
6. Benchmark metadata 写入 provider、model、draft revision、baseline revision 和运行时间。
7. 单次测试不显示具有误导性的 `± 0` 稳定性结论。
8. 保留最大并发数和 AbortSignal；同一次测试所有配置必须使用同一模型配置快照。

#### 完成定义

- 修改已有 Skill 时能明确比较“当前草稿 vs 安装前版本”。
- 三次重复运行产生正确 run number、均值、样本标准差和错误计数。
- API 失败不计为断言通过，也不会被 0 值掩盖。
- 结果能够追溯到实际 provider/model 和具体 revision。

### 4.6 完整 Grader

#### 当前缺口

- 当前评分只截取最终文本前 3000 字符交给模型。
- 没有执行 transcript、工具调用、真实输出文件、user notes、claims 验证和断言质量反馈。
- 模型声称“已生成文件”时，评分器无法核对文件是否存在或内容是否正确。

#### 适配方式

1. 测试执行器保存结构化 `transcript.json`，记录消息、工具名、状态、耗时和经过脱敏的错误，不保存 Key。
2. 每个 run 使用独立 `outputs/`，只允许受控路径；记录文件名、MIME、bytes 和 SHA-256。
3. Grader 输入包括 prompt、expect、assertions、transcript、outputs index、user notes 和 timing。
4. 文本断言由当前模型评分；文件存在、JSON schema、表格列、图片尺寸等可确定检查优先用代码完成。
5. Grader 输出保持官方核心字段 `text/passed/evidence`，并增加：
   - `claims`：输出中的关键声明及验证状态。
   - `execution_metrics`：工具调用、文件数、输出字符数。
   - `eval_feedback`：弱断言、不可验证断言和遗漏断言建议。
6. 大文件不直接塞入模型上下文；先按 MIME 使用现有文档、表格、PDF、图片读取能力生成受控摘要。
7. 所有评分证据必须引用实际输出或 transcript，不能只复述期望。

#### 完成定义

- “声称生成但文件不存在”的结果必须失败。
- Grader 能识别至少一类弱断言和一类未覆盖的重要结果。
- 文本、JSON 和至少一种二进制/结构化产物有定向测试。
- 敏感头、API Key 和完整私有输入不会写入 transcript。

### 4.7 可选 Blind A/B Comparator 与 Analyzer

#### 当前缺口

- `agents/comparator.md`、`agents/analyzer.md` 只是包内参考文件，没有运行时工具和结构化结果。
- 当前 benchmark notes 只有“所有配置都通过”和高方差两个简单启发式规则。

#### 适配方式

1. 新增 `skill_creator_compare_outputs`，只在用户要求严谨比较时开放或调用。
2. 输入必须是同一 eval 的两个完成 run；在发送给 Comparator 前随机映射为 A/B，隐藏配置名、revision 和 Skill 内容。
3. Comparator 输出 rubric、A/B 评分、winner、confidence 和理由，保存 `comparison.json`。
4. 新增 `skill_creator_analyze_comparison`，在比较完成后才解盲。
5. Analyzer 读取双方 Skill revision、transcript、真实输出和 comparison，输出优势、弱点、因果判断和修改建议，保存 `analysis.json`。
6. 平局允许存在；低 confidence 不得强行宣布新版更好。
7. 该能力不成为创建、保存或安装的前置条件。

#### 完成定义

- Comparator 输入中不能发现 with-skill/old-skill/revision 标签。
- 固定随机种子的 A/B 映射可以在测试中复现，用户界面不展示隐藏映射。
- Analyzer 建议能引用具体 Skill 指令、执行步骤和输出证据。
- 未请求比较时不增加额外模型调用和成本。

## 5. 实施顺序

七项能力不能按列表完全并行。推荐按依赖分六期实施：

| 阶段 | 内容 | 依赖 | 主要验收 |
| --- | --- | --- | --- |
| A | 草稿持久化、revision/hash、状态机绑定 | 无 | 旧卡拒绝、重启恢复、会话隔离 |
| B | 多文件安装 token 和 Rust 原子提交 | A | 确认前不写、完整包提交、失败回滚 |
| C | 官方校验与 `triggers` 扩展 | A、B | 前后端 fixture 一致、危险输入拒绝 |
| D | iteration/history/feedback 闭环 | A | 反馈持久化、上一轮对照、重启恢复 |
| E | 重复测试、旧版 baseline、执行产物和完整 Grader | A、D | 真实统计、文件核验、弱断言诊断 |
| F | 可选 Comparator 与 Analyzer | E | 盲测不泄漏、解盲分析有证据 |

## 5.1 2026-09-06 实施结果

- A：草稿 revision/hash、Web/desktop 临时持久化、状态机绑定和旧版本拒绝已实现。
- B：`jc-skill-install-v2`、旧单文件卡兼容、Rust 多文件原子提交、受管文件 manifest 和失败恢复已实现。
- C：官方 frontmatter 字段约束由前端预检、Rust `serde_yaml` 最终校验；`triggers: string[]` 保留为产品扩展。
- D：feedback、iteration、history 按 session/draft 隔离持久化，下一轮评审可读取上一轮反馈。
- E：支持最多三次重复运行、已安装版本基线、provider/model/revision 元数据、transcript、文件声明核验和弱断言提示。
- F：可选 Blind A/B 与解盲 Analyzer 已接入；未明确请求时不会增加模型调用。

自动测试不能替代真实 Desktop 安装验收。发布前仍需按 6.3 节完成 macOS/Windows 的安装卡点击、中央目录切换和应用重启恢复验证。

每一期单独完成 TDD、自动验证和真实 Desktop 验收，不在一期内同时重写全部运行时。

## 6. TDD 总体策略

### 6.1 先写的合同测试

- V2 安装 token 解析与旧安装块兼容。
- revision/hash 不一致拒绝提交。
- 多文件路径穿越、符号链接和部分写入回滚。
- `triggers` 合法扩展与官方字段约束。
- feedback/history 跨 iteration 恢复。
- installed-version baseline 与重复运行统计。
- Grader 对真实文件、claims 和弱断言的判断。
- Comparator 盲化和 Analyzer 解盲边界。

### 6.2 每期自动门禁

根据实际改动选择最小定向集，并在阶段收尾运行：

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run test:focused:run
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

没有修改 Rust 的阶段不强制重跑 Rust 全套，但必须运行对应前端定向测试。不能把未执行的命令记录为通过。

### 6.3 真实平台验收

涉及安装和临时目录的阶段必须至少人工验证：

- macOS Desktop：新建、更新、取消、hash 过期、重启恢复。
- Windows Desktop：目录原子切换、占用文件失败和路径分隔符。
- Intel Mac/Linux：有运行环境时验证；没有时明确记为未验证。
- Web/Mobile：确认不展示虚假的本地包、目录或脚本执行成功状态。

## 7. 兼容与迁移

- 旧版单文件安装卡继续可用；新生成的安装卡默认 V2。
- 历史中央 Skill 没有 `.jc-skill-package.json` 时，第一次更新不删除未知文件。
- 现有 `save_central_skill` 保留给手工单文件编辑器；Skill Creator V2 走新的草稿提交命令。
- 现有 `test_id` 在读取旧工作区时兼容，新流程内部统一映射到 `draft_id + iteration`。
- 现有 `eval-results.json` 和 `benchmark.json` 可读取；新字段保持向后兼容。
- 删除 Claude CLI 旁路的决定保持不变，不恢复已经移除的 provider-specific 脚本。

## 8. 明确不做

- 不做自动 Skill 触发或 description 命中率训练。
- 不让模型决定中央根路径或直接执行最终写入。
- 不新增数据库作为草稿真源；Desktop 先使用受控文件工作区和现有扫描能力。
- 不为普通创建流程强制三次重复测试、Blind A/B 或 Analyzer。
- 不在本方案中改造所有 Skill 的内容和目录。
- 不把 Skill Creator 重新设计成通用 Agent/工作流平台。

## 9. 最终完成标准

全部阶段完成后，以下链路必须成立：

```text
用户手动选择 Skill Creator
→ 创建或读取已安装 Skill
→ 受控草稿 draft/revision/hash
→ 官方结构 + 产品扩展校验
→ 可选测试、旧版基线、重复运行、真实产物评分
→ 可选盲测与原因分析
→ 评审反馈持久化并迭代
→ 用户明确确认某个 revision
→ Rust 校验 token 与完整包
→ 原子提交中央 Skill 根目录
→ 扫描刷新并清理草稿
```

判定完成必须同时满足：

- 确认前中央 Skill 根目录零修改。
- 确认内容与最终提交内容 hash 完全一致。
- 多文件包不会部分安装或因更新误删未知文件。
- 测试和评分可追溯到模型、revision、baseline 和真实产物。
- 反馈与历史可跨页面和应用重启恢复。
- 所有高级评测能力保持可选，手动选择 Skill 的基础流程不增加不必要成本。

## 10. 下一轮起点

下一轮从阶段 A 开始，不直接修改安装 UI：

1. 为草稿定义 V2 schema、revision 和规范化包 hash。
2. 先写 Map 丢失、旧 revision 误提交和跨 session 读取的失败测试。
3. 将 Desktop 草稿真源落到应用受控临时目录，Map 降级为缓存。
4. 把 `SkillCreatorRuntime` 的生命周期绑定到 `draft_id + revision + content_hash`。
5. 完成阶段 A 自动测试后，再进入阶段 B 的多文件原子安装。

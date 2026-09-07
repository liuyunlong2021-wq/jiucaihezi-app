---
name: skill-creator
description: Use when 用户想要创建、编辑、优化、评估、基准测试或确认安装可复用的 Skill 及其发现描述。
triggers:
  - 'Skill缔造'
  - '创建技能'
  - '编写skill'
  - '修改skill'
  - 'skill评估'
  - 'skill creator'
  - 'Skill设计'
  - '创建创作Skill'
  - '做一个创作型Skill'
  - '复制短剧模式'
  - '帮我建一个XXSkill'
---

# Skill 创建器

用于创建新 Skill 并迭代改进它们的 Skill。

从宏观上看，创建一个 Skill 的流程如下：

- 确定该 Skill 要完成什么，以及大致如何完成
- 编写 Skill 初稿
- 创建若干测试提示词，并在加载初稿 Skill 的情况下通过应用所选模型运行
- 协助用户从定性和定量两方面评估结果
  - 运行在后台进行时，如尚无定量 eval，先起草一些；如已有，可原样使用或在需要时修改。然后向用户说明这些 eval
  - 使用 `eval-viewer/generate_review.py` 脚本展示结果，并让用户查看定量指标
- 根据用户评估反馈及定量基准暴露的明显缺陷重写 Skill
- 重复至满意为止
- 扩大测试集并以更大规模再次尝试

使用此 Skill 时，判断用户正处于哪个阶段，并介入协助推进。例如用户说“我想为 X 做一个 Skill”时，你可以协助澄清意图、编写初稿与测试用例、确定评估方式、运行全部提示词并重复迭代。

另一方面，用户可能已有 Skill 初稿。这种情况下可直接进入循环中的评估和迭代部分。

当然，始终保持灵活；若用户表示“不需要跑一堆评估，和我一起构思就好”，则可按此方式进行。

Skill 稳定后，仅在用户要求更清晰的表述或搜索标签时改进其描述；本应用采用手动选择 Skill。

## 应用运行时约定

此 Skill 与模型无关。不要假定特定提供商、CLI、编排机制、发现变量或流式格式。请使用宿主应用的 Skill Creator 工具完成验证、测试、审查、打包与保存。

草稿归应用所有，并通过 `draft_id`、`revision` 和 `content_hash` 标识。在验证、可选测试、审查、打包和保存的全过程中携带这三个值。迭代期间将草稿保留在受控临时存储中。`save_skill` 仅准备安装结果，绝不可直接写入真实 Skill 根目录。获得用户明确确认后，在 `jc-skill-install-v2` 块中原样输出返回的令牌，并由宿主 UI 原子化安装完整包。

使用宿主生命周期工具，而非 shell 命令或提供商特定编排方式。测试为可选项。用户要求测试时，使用 `run_skill_tests`，通过 `skill_creator_submit_eval_feedback` 持久化反馈，并以 `skill_creator_load_eval_feedback` 加载既有反馈。仅在用户明确要求严格比较时，使用 `skill_creator_compare_outputs` 和 `skill_creator_analyze_comparison`。

明白了吗？很好。

## 与用户沟通

Skill 创建器面向对编程术语熟悉程度各异的用户。当上下文表明用户可能不了解评估术语时，请简要解释。

请留意上下文线索，以决定沟通措辞。默认情况下，可参考以下原则：

- “evaluation”和“benchmark”介于专业与通俗之间，但可以使用
- 对“JSON”和“assertion”，只有在用户明显了解这些概念时才可不加解释地使用

如有疑虑，可以简要解释术语；如果不确定用户能否理解，可用简短定义加以说明。

---

## 创建 Skill

### 收集意图

先理解用户意图。当前对话可能已经包含用户希望沉淀的工作流（例如用户说“把这个变成一个 Skill”）。此时应优先从对话历史中提取答案：使用过的工具、步骤顺序、用户作出的修正、已观察到的输入/输出格式。用户可能需要补齐空缺，并应在进入下一步前确认。

1. 这个 Skill 应让模型能够完成什么？
2. 这个 Skill 应在何时触发？（哪些用户措辞/上下文）
3. 预期输出格式是什么？
4. 是否应设置测试用例验证 Skill 有效？具有可客观验证输出的 Skill（文件转换、数据提取、代码生成、固定工作流步骤）会从测试用例中受益。具有主观输出的 Skill（写作风格、艺术）通常不需要。根据 Skill 类型建议合适默认方案，但由用户决定。

### 访谈与研究

主动询问边界情况、输入/输出格式、示例文件、成功标准和依赖项。厘清这些之前，不要编写测试提示词。

研究有帮助时检查可用 MCP。仅在宿主明确提供并行代理时使用；否则在当前上下文中完成工作。

### 编写 SKILL.md

根据用户访谈，补全以下部分：

- **name**：Skill 标识符
- **description**：何时触发、能做什么。这是主要触发机制，应同时包括能力与具体上下文。保持可辨识性，但不要假定特定模型的触发策略。
- **compatibility**：所需工具和依赖（可选，通常不需要）
- **Skill 的其余部分 :)**

### Skill 编写指南

#### Skill 的构成

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### 渐进披露

Skill 使用三级加载系统：

1. **元数据**（name + description）：始终在上下文中（约 100 词）
2. **SKILL.md 正文**：Skill 触发时加载到上下文（理想情况少于 500 行）
3. **随附资源**：按需加载（数量不限，脚本无需加载即可执行）

这些字数仅为近似参考；需要时可适当超出。

**关键模式：**

- 保持 SKILL.md 少于 500 行；接近该限制时，增加一层层级结构，并明确指引使用该 Skill 的模型下一步应到哪里继续。
- 在 SKILL.md 中清楚引用文件，并说明何时读取。
- 大型引用文件（超过 300 行）应包含目录。

**领域组织**：当一个 Skill 支持多个领域/框架时，按变体组织：

```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

当宿主运行时支持渐进披露时，活动模型只读取相关引用文件。

#### 不造成意外原则

无需赘言，Skill 不得包含恶意软件、利用代码或任何可能危及系统安全的内容。一个 Skill 的内容不应超出其描述所传达的用户意图。不要接受创建误导性 Skill，或为未经授权访问、数据外泄或其他恶意活动提供便利的 Skill 的请求；但“扮演某个角色”这类请求可以接受。

#### 编写模式

指令优先使用祈使句。

**定义输出格式**：可采用如下形式：

```markdown
## 报告结构

始终使用以下固定模板：

# [标题]

## 执行摘要

## 关键发现

## 建议
```

**示例模式**：包含示例很有帮助。可按如下方式编排（若示例中出现“输入”和“输出”，可视情况调整）：

```markdown
## 提交信息格式

**示例 1：**
输入：新增 JWT 用户认证
输出：feat(auth): 实现基于 JWT 的认证
```

### 编写风格

尽量向模型解释事项为何重要，而不是使用生硬、陈旧的 MUST。运用心智理论，让 Skill 保持通用，不要过度收窄到特定示例。先写出草稿，再以新的视角审阅并改进它。

### 测试用例

写完 Skill 草稿后，构思 2-3 个真实的测试提示词，即真实用户会实际提出的请求。把它们分享给用户：“我想尝试以下几个测试用例。它们是否合适，还是你希望再增加一些？”然后运行它们。

将测试用例保存到 `evals/evals.json`。暂时不要编写断言，只写提示词。运行进行时在下一步起草断言。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

完整 schema 参见 `references/schemas.md`（包括稍后添加的 `assertions` 字段）。

## 运行和评估测试用例

在本应用中，宿主生命周期工具负责执行、持久化、评分、基准汇总和审查渲染。下方的文件系统和命令示例描述兼容的产物形式；对应宿主工具可用时，不要直接执行它们。

本节是一条连续流程，不要中途停止。不要使用 `/skill-test` 或任何其他测试 Skill。

将结果放到与 Skill 目录同级的 `<skill-name>-workspace/` 中。工作区内按迭代组织结果（`iteration-1/`、`iteration-2/` 等），每个测试用例再拥有一个目录（`eval-0/`、`eval-1/` 等）。不要预先创建全部目录，按流程逐步创建即可。

### 第 1 步：运行全部用例（with-skill 和基线）

对每个测试用例，请宿主运行时执行一次加载草稿的运行和一次未加载草稿的基线运行。宿主可并行或串行执行，不要要求特定编排机制。

**使用 Skill 的运行：**

```
执行此任务：
- Skill 路径：<path-to-skill>
- 任务：<eval prompt>
- 输入文件：<eval files if any, or "none">
- 输出保存位置：<workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- 需保存的输出：<用户关注的产物，例如“`.docx` 文件”或“最终 CSV”>
```

**基线运行**（提示词相同，但基线取决于上下文）：

- **创建新 Skill**：完全不使用 Skill。使用相同提示词，不提供 Skill 路径，保存到 `without_skill/outputs/`。
- **改进现有 Skill**：使用旧版本。编辑前，先为 Skill 创建快照（`cp -r <skill-path> <workspace>/skill-snapshot/`），然后让基线子代理使用快照。保存到 `old_skill/outputs/`。

为每个测试用例写入 `eval_metadata.json`（断言暂时可为空）。为每个 eval 根据其测试内容命名，而不是只叫“eval-0”；目录也使用这个名称。若本次迭代使用新增或修改过的 eval 提示词，则为每个新 eval 目录创建这些文件，不要假定它们能从之前迭代沿用。

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### 第 2 步：运行进行时起草断言

不要只是等待运行结束，可以有效利用这段时间。为每个测试用例起草定量断言，并向用户解释。若 `evals/evals.json` 中已有断言，审阅它们并解释其检查内容。

好的断言可被客观验证，且具有描述性名称，应能在基准查看器中清晰呈现，使浏览结果的人立即明白每项检查的内容。主观型 Skill（写作风格、设计质量）更适合定性评估，不要强行为需要人工判断的内容设置断言。

断言起草完成后，更新 `eval_metadata.json` 文件和 `evals/evals.json`。还应向用户说明查看器中会看到什么，包括定性输出与定量基准。

### 第 3 步：运行完成时采集计时数据

每次宿主运行完成时，在 `timing.json` 中记录 `total_tokens` 和 `duration_ms`：

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

这是采集该数据的唯一机会：它通过任务通知传递，不会持久化到其他位置。通知一到就逐个处理，不要试图批量处理。

### 第 4 步：评分、汇总并启动查看器

全部运行完成后：

1. **为每次运行评分**：使用宿主评分器，将结果保存到 `grading.json`。期望数组必须使用 `text`、`passed` 和 `evidence`。文件是否存在和结构化输出优先采用确定性检查。

2. **汇总为基准**：从 skill-creator 目录运行汇总脚本：

   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```

  该命令生成 `benchmark.json` 和 `benchmark.md`，其中包含各配置的 pass_rate、时间和 Token，以及均值 ± 标准差与差异值。手动生成 benchmark.json 时，查看 `references/schemas.md` 以了解查看器要求的精确 schema。
  每个 with_skill 版本放在其对应基线版本之前。

3. **进行分析器审查**：读取基准数据，呈现汇总统计可能隐藏的模式。参见 `agents/analyzer.md` 的“分析基准测试结果”章节，重点关注无论是否使用 Skill 均通过的断言（缺少区分力）、高方差 eval（可能不稳定）及时间/Token 权衡。

4. **启动查看器**，同时提供定性输出和定量数据：

   ```bash
   nohup python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```

  对 iteration 2 及之后的版本，还需传入 `--previous-workspace <workspace>/iteration-<N-1>`。

  **无头环境：**若 `webbrowser.open()` 不可用，或环境没有显示器，使用 `--static <output_path>` 写入独立 HTML 文件，不要启动服务器。用户点击“提交全部审查”后，反馈会以 `feedback.json` 文件下载。

注意：请使用 generate_review.py 创建查看器，无需编写自定义 HTML。

5. **告知用户**，例如：“我已在浏览器中打开结果。这里有两个标签页：‘输出’可逐个查看测试用例并留下反馈，‘基准’展示定量比较。完成后请回来告诉我。”

### 用户在查看器中看到的内容

“输出”标签页一次展示一个测试用例：

- **提示词**：给定的任务
- **输出**：Skill 生成的文件，可能时以内联方式呈现
- **上一次输出**（iteration 2+）：展示上一轮输出的折叠区域
- **正式评分**（若已评分）：展示断言通过/失败的折叠区域
- **反馈**：输入时自动保存的文本框
- **上一次反馈**（iteration 2+）：上一次的评论，显示在文本框下方

“基准”标签页显示统计汇总：各配置的通过率、计时和 Token 用量，以及按 eval 拆分的结果和分析器观察。

通过上一项/下一项按钮或方向键导航。完成后，用户点击“提交全部审查”，所有反馈将保存到 `feedback.json`。

### 第 5 步：读取反馈

用户告知完成后，读取 `feedback.json`：

```json
{
  "reviews": [
    {
      "run_id": "eval-0-with_skill",
      "feedback": "the chart is missing axis labels",
      "timestamp": "..."
    },
    { "run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..." },
    { "run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..." }
  ],
  "status": "complete"
}
```

空反馈表示用户认为没有问题。将改进重点放在用户提出明确意见的测试用例上。

不再使用查看器服务器后终止它：

```bash
kill $VIEWER_PID 2>/dev/null
```

---

## 改进 Skill

这是循环的核心。你已运行测试用例，用户已审查结果；现在需要根据反馈改进 Skill。

### 如何思考改进

1. **从反馈中泛化。**这里的大方向是创建可在各种提示词下重复使用无数次的 Skill。你与用户反复迭代少量示例，是因为这样推进更快；用户熟悉这些示例，能迅速评估新输出。但若共同开发的 Skill 只适用于这些示例，它就没有价值。不要加入琐碎的过拟合改动或压迫性的 MUST。遇到顽固问题时，可尝试拓宽思路、使用不同隐喻，或建议不同工作模式。尝试成本相对很低，可能会找到真正有效的方法。

2. **保持提示词精简。**删除没有贡献的内容。务必阅读转录记录，而不仅是最终输出：若 Skill 让模型花大量时间做无效工作，可尝试删除造成该行为的 Skill 部分，观察结果。

3. **解释原因。**努力解释让模型做每件事背后的**原因**。今天的 LLM 很聪明，具备良好的心智理论，在良好框架下能超越机械执行，真正把事情做好。即使用户反馈简短或带有挫败感，也要努力理解任务、用户写下这些内容的动机和实际表达，并将此理解融入指令。若发现自己在全大写使用 ALWAYS 或 NEVER，或采用过于僵硬的结构，这就是警示信号：尽可能重述并解释理由，让模型理解所要求事项的重要性。这种方式更人性化、更有力，也更有效。

4. **寻找测试用例间的重复工作。**阅读测试运行的转录记录，注意子代理是否都独立编写了类似辅助脚本，或采用相同多步骤方法。若全部 3 个测试用例都让子代理写出了 `create_docx.py` 或 `build_chart.py`，这强烈表明 Skill 应随附该脚本。只写一次，放入 `scripts/`，并指示 Skill 使用它。这能避免未来每次调用重新造轮子。

这个任务很重要，思考时间不是瓶颈；请认真斟酌。建议先写出修订草稿，再以新的视角审阅和改进。尽力站在用户角度，理解他们真正想要和需要什么。

### 迭代循环

改进 Skill 后：

1. 将改进应用到 Skill
2. 将所有测试用例重新运行到新的 `iteration-<N+1>/` 目录，包括基线运行。创建新 Skill 时，基线始终是 `without_skill`（不使用 Skill），跨迭代保持不变。改进现有 Skill 时，自行判断适合作为基线的是用户带来的原始版本，还是上一次迭代。
3. 启动审查器，并让 `--previous-workspace` 指向前一次迭代
4. 等待用户完成审查并告知你
5. 读取新反馈，再次改进并重复

持续进行，直到：

- 用户表示满意
- 反馈全部为空（结果均无问题）
- 已无法取得有意义的进展

---

## 进阶：盲测比较

需要更严格比较一个 Skill 的两个版本时（例如用户问“新版本是否真的更好？”），可以使用盲测比较系统。详见 `agents/comparator.md` 和 `agents/analyzer.md`。基本思路是：将两个输出交给独立代理，但不告知它们分别由谁生成，让其判断质量；再分析获胜方为何胜出。

这是可选流程。宿主提供比较器和分析器工具时使用；否则跳过。人工审查循环通常足够。

---

## 交付与安装

评估完成后，保留最终草稿及其全部 `references/`、`scripts/`、`assets/` 文件。先向用户说明已完成的内容和验证结果，再等待明确安装确认；没有确认时，草稿仍停留在受控临时存储中。

用户明确说“安装”“帮我安装”或同等确认后，调用 `save_skill` 准备安装令牌。它冻结当前 `draft_id + revision + content_hash`，不会直接写入真实 Skill 根目录。不要手工复制草稿文件、生成 `.skill` 文件或改写令牌。

随后输出一句简短确认语，再输出且只输出一个如下格式的代码块，其中 JSON 必须是 `save_skill` 返回的 `install_token`：

````markdown
Skill 已准备好，请确认安装。

```jc-skill-install-v2
{"schemaVersion":2,"draftId":"draft-id","sessionId":"session-id","revision":1,"contentHash":"sha256","targetSkillId":"lowercase-hyphen-name"}
```
````

界面会从受控临时草稿读取 `SKILL.md` 和所有资源，并将代码块转换成安装确认卡。点击时重新校验 revision/hash；只有原子提交成功后才算安装成功。旧的单文件 `jc-skill-install` 只用于历史会话兼容。

---

## 宿主环境指导

宿主可能提供并行工作器、浏览器，或两者均不提供。将它们视为可选能力：可用时使用；不可用时通过应用工具完成相同生命周期，并在对话中展示结果。绝不调用提供商专用 CLI，也不要直接写入提供商专用命令目录。

更新现有 Skill 时，保留其 ID，并在应用受控的临时草稿存储中暂存编辑。不要自行写入 `/tmp/<name>/SKILL.md` 或已安装的 Skill 目录。最终安装仅能由用户通过宿主安装卡确认。

---

## 引用文件

`agents/` 目录包含供支持独立代理执行的宿主选用的评分器、比较器和分析器指导。

- `agents/grader.md`：如何根据输出评估断言
- `agents/comparator.md`：如何对两个输出进行盲测 A/B 比较
- `agents/analyzer.md`：如何分析一个版本为何胜过另一个版本

references/ 目录包含额外文档：

- `references/schemas.md`：evals.json、grading.json 等的 JSON 结构

---

再次强调核心循环：

- 明确 Skill 的目标
- 起草或编辑 Skill
- 使用宿主应用选定的模型，在加载和未加载草稿 Skill 的情况下运行测试提示词
- 与用户共同评估输出：
  - 创建 benchmark.json 并运行 `eval-viewer/generate_review.py` 协助用户审查
  - 运行定量 eval
- 重复直至你和用户满意
- 向用户交付验证结果；获得确认后通过安装卡安装最终 Skill

宿主任务 UI 可用时，在其中跟踪生命周期步骤；安装是流程的唯一终点，并始终以用户确认为最终关卡。

祝顺利！

## 指令

```commands
创建新 Skill: 请用 Skill 缔造器帮我创建新 Skill：
名称：[Skill名]
用途：[描述Skill要做什么]
触发词：[逗号分隔]
输出标准 SKILL.md + references/ + scripts/ + assets/ 目录结构。
修改已有 Skill: 请用 Skill 缔造器帮我修改 Skill「[Skill名]」：
修改要求：[描述要改什么]
保持 SKILL.md 格式规范。
```

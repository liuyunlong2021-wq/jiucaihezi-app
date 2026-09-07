# JSON 模式

本文档定义 skill-creator 使用的 JSON schema。

---

## evals.json

定义某个 Skill 的 eval。位于 Skill 目录内的 `evals/evals.json`。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's example prompt",
      "expected_output": "Description of expected result",
      "files": ["evals/files/sample1.pdf"],
      "expectations": [
        "The output includes X",
        "The skill used script Y"
      ]
    }
  ]
}
```

**字段：**
- `skill_name`：与 Skill frontmatter 匹配的名称
- `evals[].id`：唯一整数标识符
- `evals[].prompt`：要执行的任务
- `evals[].expected_output`：成功结果的人类可读说明
- `evals[].files`：可选的输入文件路径列表（相对于 Skill 根目录）
- `evals[].expectations`：可验证陈述列表

---

## history.json

在改进模式下跟踪版本演进。位于工作区根目录。

```json
{
  "started_at": "2026-01-15T10:30:00Z",
  "skill_name": "pdf",
  "current_best": "v2",
  "iterations": [
    {
      "version": "v0",
      "parent": null,
      "expectation_pass_rate": 0.65,
      "grading_result": "baseline",
      "is_current_best": false
    },
    {
      "version": "v1",
      "parent": "v0",
      "expectation_pass_rate": 0.75,
      "grading_result": "won",
      "is_current_best": false
    },
    {
      "version": "v2",
      "parent": "v1",
      "expectation_pass_rate": 0.85,
      "grading_result": "won",
      "is_current_best": true
    }
  ]
}
```

**字段：**
- `started_at`：开始改进时的 ISO 时间戳
- `skill_name`：正在改进的 Skill 名称
- `current_best`：表现最佳版本的标识符
- `iterations[].version`：版本标识符（v0、v1、...）
- `iterations[].parent`：此版本派生自的父版本
- `iterations[].expectation_pass_rate`：评分得出的通过率
- `iterations[].grading_result`：“baseline”“won”“lost”或“tie”
- `iterations[].is_current_best`：是否为当前最佳版本

---

## grading.json

评分代理的输出。位于 `<run-dir>/grading.json`。

```json
{
  "expectations": [
    {
      "text": "The output includes the name 'John Smith'",
      "passed": true,
      "evidence": "Found in transcript Step 3: 'Extracted names: John Smith, Sarah Johnson'"
    },
    {
      "text": "The spreadsheet has a SUM formula in cell B10",
      "passed": false,
      "evidence": "No spreadsheet was created. The output was a text file."
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "execution_metrics": {
    "tool_calls": {
      "Read": 5,
      "Write": 2,
      "Bash": 8
    },
    "total_tool_calls": 15,
    "total_steps": 6,
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "The form has 12 fillable fields",
      "type": "factual",
      "verified": true,
      "evidence": "Counted 12 fields in field_info.json"
    }
  ],
  "user_notes_summary": {
    "uncertainties": ["Used 2023 data, may be stale"],
    "needs_review": [],
    "workarounds": ["Fell back to text overlay for non-fillable fields"]
  },
  "eval_feedback": {
    "suggestions": [
      {
        "assertion": "The output includes the name 'John Smith'",
        "reason": "A hallucinated document that mentions the name would also pass"
      }
    ],
    "overall": "Assertions check presence but not correctness."
  }
}
```

**字段：**
- `expectations[]`：带有证据的已评分期望
- `summary`：通过/失败计数汇总
- `execution_metrics`：工具使用量和输出大小（来自执行器的 metrics.json）
- `timing`：墙钟计时（来自 timing.json）
- `claims`：从输出提取并验证的声明
- `user_notes_summary`：执行器标记的问题
- `eval_feedback`：（可选）针对 eval 的改进建议，仅在评分器发现值得提出的问题时出现

---

## metrics.json

执行器代理的输出。位于 `<run-dir>/outputs/metrics.json`。

```json
{
  "tool_calls": {
    "Read": 5,
    "Write": 2,
    "Bash": 8,
    "Edit": 1,
    "Glob": 2,
    "Grep": 0
  },
  "total_tool_calls": 18,
  "total_steps": 6,
  "files_created": ["filled_form.pdf", "field_values.json"],
  "errors_encountered": 0,
  "output_chars": 12450,
  "transcript_chars": 3200
}
```

**字段：**
- `tool_calls`：各工具类型的调用次数
- `total_tool_calls`：全部工具调用之和
- `total_steps`：主要执行步骤数量
- `files_created`：已创建输出文件列表
- `errors_encountered`：执行中遇到的错误数量
- `output_chars`：输出文件总字符数
- `transcript_chars`：转录记录字符数

---

## timing.json

某次运行的墙钟计时。位于 `<run-dir>/timing.json`。

**采集方式：**子代理任务完成时，任务通知会包含 `total_tokens` 和 `duration_ms`。立即保存这些数据：它们不会持久化到其他位置，事后无法恢复。

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3,
  "executor_start": "2026-01-15T10:30:00Z",
  "executor_end": "2026-01-15T10:32:45Z",
  "executor_duration_seconds": 165.0,
  "grader_start": "2026-01-15T10:32:46Z",
  "grader_end": "2026-01-15T10:33:12Z",
  "grader_duration_seconds": 26.0
}
```

---

## benchmark.json

基准模式的输出。位于 `benchmarks/<timestamp>/benchmark.json`。

```json
{
  "metadata": {
    "skill_name": "pdf",
    "skill_path": "/path/to/pdf",
    "executor_model": "selected-model-id",
    "analyzer_model": "most-capable-model",
    "timestamp": "2026-01-15T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 3
  },

  "runs": [
    {
      "eval_id": 1,
      "eval_name": "Ocean",
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": [
        "Used 2023 data, may be stale",
        "Fell back to text overlay for non-fillable fields"
      ]
    }
  ],

  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },

  "notes": [
    "Assertion 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
    "Eval 3 shows high variance (50% ± 40%) - may be flaky or model-dependent",
    "Without-skill runs consistently fail on table extraction expectations",
    "Skill adds 13s average execution time but improves pass rate by 50%"
  ]
}
```

**字段：**
- `metadata`：基准运行信息
  - `skill_name`：Skill 名称
  - `timestamp`：运行基准测试的时间
  - `evals_run`：eval 名称或 ID 列表
  - `runs_per_configuration`：每种配置的运行次数（例如 3）
- `runs[]`：单次运行结果
  - `eval_id`：数值 eval 标识符
  - `eval_name`：人类可读的 eval 名称（在查看器中用作章节标题）
  - `configuration`：必须为 `"with_skill"` 或 `"without_skill"`（查看器使用该精确字符串进行分组和颜色编码）
  - `run_number`：整数运行编号（1、2、3...）
  - `result`：包含 `pass_rate`、`passed`、`total`、`time_seconds`、`tokens`、`errors` 的嵌套对象
- `run_summary`：每种配置的统计汇总
  - `with_skill` / `without_skill`：每项均包含具有 `mean` 和 `stddev` 字段的 `pass_rate`、`time_seconds`、`tokens` 对象
  - `delta`：差异字符串，例如 `"+0.50"`、`"+13.0"`、`"+1700"`
- `notes`：分析器的自由形式观察

**重要：**查看器会精确读取这些字段名。使用 `config` 代替 `configuration`，或将 `pass_rate` 放在运行的顶层而非嵌套于 `result` 下，都会导致查看器显示空值/零值。手动生成 benchmark.json 时务必参照此 schema。

---

## comparison.json

盲测比较器的输出。位于 `<grading-dir>/comparison-N.json`。

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with proper formatting and all required fields. Output B is missing the date field and has formatting inconsistencies.",
  "rubric": {
    "A": {
      "content": {
        "correctness": 5,
        "completeness": 5,
        "accuracy": 4
      },
      "structure": {
        "organization": 4,
        "formatting": 5,
        "usability": 4
      },
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {
        "correctness": 3,
        "completeness": 2,
        "accuracy": 3
      },
      "structure": {
        "organization": 3,
        "formatting": 2,
        "usability": 3
      },
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted", "All fields present"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5,
      "strengths": ["Readable output", "Correct basic structure"],
      "weaknesses": ["Missing date field", "Formatting inconsistencies", "Partial data extraction"]
    }
  },
  "expectation_results": {
    "A": {
      "passed": 4,
      "total": 5,
      "pass_rate": 0.80,
      "details": [
        {"text": "Output includes name", "passed": true}
      ]
    },
    "B": {
      "passed": 3,
      "total": 5,
      "pass_rate": 0.60,
      "details": [
        {"text": "Output includes name", "passed": true}
      ]
    }
  }
}
```

---

## analysis.json

事后分析器的输出。位于 `<grading-dir>/analysis.json`。

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process the document appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise"
  ],
  "instruction_following": {
    "winner": {
      "score": 9,
      "issues": ["Minor: skipped optional logging step"]
    },
    "loser": {
      "score": 6,
      "issues": [
        "Did not use the skill's formatting template",
        "Invented own approach instead of following step 3"
      ]
    }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process the document appropriately' with explicit steps",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods"
  }
}
```

# JSON Schemas

本文档定义 Skill 创建中使用的 JSON 结构。

---

## evals.json

定义 Skill 的测试用例。位于 Skill 目录下 `evals/evals.json`（可选）。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "用户的测试 prompt",
      "expected_output": "期望输出的描述",
      "expectations": [
        "输出包含 X",
        "格式为 Y"
      ]
    }
  ]
}
```

**字段说明：**
- `skill_name`: 与 SKILL.md frontmatter 中 name 匹配
- `evals[].id`: 唯一整数标识
- `evals[].prompt`: 要执行的测试任务
- `evals[].expected_output`: 成功标准的人类可读描述
- `evals[].expectations`: 可验证的断言列表

---

## grading.json

对话模拟评分输出（LLM 生成的替代方案）。

```json
{
  "expectations": [
    {
      "text": "输出中包含名字 '张三'",
      "passed": true,
      "evidence": "在回答第3段找到：'客户姓名为张三'"
    },
    {
      "text": "输出包含表格格式的数据",
      "passed": false,
      "evidence": "输出为纯文本，未使用表格"
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "eval_feedback": {
    "suggestions": [
      {
        "assertion": "输出中包含名字 '张三'",
        "reason": "如果模型只是重复了 prompt 中的名字，也算通过，但这个断言太弱了"
      }
    ],
    "overall": "断言检查了表面特征，但没有验证业务逻辑正确性"
  }
}
```

**字段说明：**
- `expectations[]`: 逐断言评分，必须包含 `text`/`passed`/`evidence` 字段
- `summary`: 通过/失败汇总
- `eval_feedback`: （可选）对测试断言本身的评估建议

---

## history.json

追踪版本演进。位于 workspace 根。

```json
{
  "started_at": "2026-01-15T10:30:00Z",
  "skill_name": "example-skill",
  "current_best": "v2",
  "iterations": [
    {
      "version": "v0",
      "parent": null,
      "expectation_pass_rate": 0.65,
      "is_current_best": false
    },
    {
      "version": "v1",
      "parent": "v0",
      "expectation_pass_rate": 0.75,
      "is_current_best": false
    },
    {
      "version": "v2",
      "parent": "v1",
      "expectation_pass_rate": 0.85,
      "is_current_best": true
    }
  ]
}
```

---

## feedback.json

用户评审反馈。

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "图表缺少轴标签", "timestamp": "2026-01-15T10:45:00Z"},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "2026-01-15T10:45:30Z"},
    {"run_id": "eval-2-with_skill", "feedback": "完美，很喜欢这个", "timestamp": "2026-01-15T10:46:00Z"}
  ],
  "status": "complete"
}
```

空 feedback 表示用户认为没问题。重点关注用户有具体意见的测试用例。

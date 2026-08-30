# 通用记忆工作台 Skill 装载规则 TDD-SA2

> 日期：2026-08-30  
> 分支：`codex/0830-skill-first-agent`  
> 前置：SA1 `0a3e2ad5`  
> 状态：T1 已实施；T2/T3 待执行

## 目标

在 SA1 的统一路由上，冻结 Skill 的身份、来源、正文和包内资源边界。
不新增第二套 Skill 加载器；继续复用 `skillContentResolver`、`agentStore`、
`createCreativeSkillSession` 和现有项目工具执行器。

## 不做的事

- 不根据自然语言自动选择 Skill。
- 不让模型决定是否加载用户已选 Skill。
- 不把全部 Skill 或全部 references 预加载进首轮上下文。
- 不改变 Wiki、文件、媒体、3D、MCP、Terminal 的执行合同。

## 装载合同

1. 输入只能是用户从 UI 选中的具体 Skill 名称；空名称、通用 `Skill` 标签和未知名称必须失败并返回可见错误。
2. 同一名称在本轮只绑定一个确定身份。来源、名称和资源根路径必须记录在绑定结果中；不得静默替换为另一个同名 Skill。
3. 绑定成功后首轮注入完整 `SKILL.md` 和资源清单；Skill 正文属于强制规则，不是普通工具回执。
4. references、scripts、assets 只在模型提出路径且路径属于当前 Skill 包时读取。越界、缺失、空值和读取失败都作为真实 Observation 返回。
5. 已绑定具体 Skill 后不暴露通用 `skill` 工具，不能通过工具调用绕过本轮绑定边界。
6. 多 Skill 同时选择时保留独立规则段；冲突不静默合并，模型必须指出冲突。

## TDD 顺序

### SA2-T1：身份与来源

先写失败测试，再实现：

- 具体名称可解析；空名、通用标签、未知名称返回明确错误。
- 同名来源不会静默覆盖，绑定结果包含确定来源和资源根路径。
- 重复选择同一 Skill 只产生一个绑定段。

验证：`memoryToolRouting`、`skillContentResolver` 定向测试。

实施记录（2026-08-30）：`selectedSkillNamesForInput` 统一去空白、去重，并拒绝空名称与通用 `Skill` 标签；具体 Skill 仍由现有目录和本地 Skill 映射解析。新增回归测试，聚焦测试 `1218/1218` 通过。

### SA2-T2：完整正文与资源边界

- 首轮绑定包含完整 `SKILL.md` 和资源清单。
- 资源读取只接受当前 Skill 包相对路径；`..`、绝对路径、空路径和包外路径拒绝。
- 资源缺失或读取失败保留真实错误，不伪造成功。

验证：`desktopProjectTools`、Web Skill resolver 定向测试。

### SA2-T3：失败可见性与回归

- Skill 目录加载失败、正文加载失败、资源加载失败均能到达模型或用户可见错误路径。
- 选中 Skill 时不再注册 `skill` 工具；无 Skill 时保持普通对话行为。

验证：聚焦测试、类型检查、`git diff --check`。

## 完成标准

- SA2-T1 至 SA2-T3 测试通过。
- SA1 四种路由组合保持通过。
- 没有新增并行 Skill 服务或隐式 Agent。
- 完成后再进入 SA3 Tool Search，不在 SA2 提前改工具目录。

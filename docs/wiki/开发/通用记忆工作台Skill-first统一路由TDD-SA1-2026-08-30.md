# 通用记忆工作台 Skill-first 统一路由 TDD-SA1

> 日期：2026-08-30  
> 分支：`codex/0830-skill-first-agent`  
> 状态：已实施，自动测试与 Desktop Web 真实验收通过

## 目标

以现有 WikiAgent 和工具循环为底盘，把已选择 Skill 作为首轮强制规则接入，
不新建第二个 Agent。Skill 负责方法与输出约束，Wiki 负责事实读取与确定性写入。

## 首轮合同

模型首轮固定收到：

```text
系统安全与工具政策
+ 当前任务和必要对话上下文
+ 已选择 Skill 的完整 SKILL.md
+ 用户选择 Wiki 时的 Wiki 入口能力
+ 本轮允许使用的工具
```

已选 Skill 必须首轮加载；没有 Skill 时不加载 Skill。Skill 不能绕过程序白名单，
也不能把 Wiki 事实当成规则。

## 路由规则

| 组合 | 路由 |
|---|---|
| 无 Skill、无 Wiki | 普通对话循环 |
| 仅 Skill | 统一工具循环，首轮带完整 Skill |
| 仅 Wiki | 现有 Wiki 渐进读取协议 |
| Skill + Wiki | 统一工具循环，首轮带完整 Skill；Wiki 作为可调用工具 |

`Skill + Wiki` 不得进入仅为 Wiki 设计的固定 ReadPlan/JSON 两阶段协议，否则
Skill 规则会被协议覆盖，复杂任务无法继续调用 Skill 要求的其他工具。

## 本次实施

- 新增 `shouldUseWikiTwoPhase` 共享路由判定。
- 仅 `wikiSelected` 且未选择 Skill、文件、MCP、媒体、3D、Terminal 时保留 Wiki
  两阶段兼容路径。
- `Skill + Wiki` 进入现有统一工具循环，复用当前工具选择、审批、Observation 和
  取消处理。
- 添加路由回归测试，防止 Skill+Wiki 再次误入 Wiki-only 路径。

## 验收

- 路由单测通过。
- 现有 Wiki-only 测试不变。
- 现有 Skill 首轮注入测试不变。
- 真实验收（2026-08-30，项目 `SA1真实验收`，模型 `grok-4.6`）：普通消息、仅 Skill、仅 Wiki、Skill + Wiki 四种组合均成功。
- 真实验收观察：Skill + Wiki 能完成 Wiki 读取并按 Skill 输出；Wiki-only 保持渐进读取；未发现重复入口读取或错误进入固定 Wiki 两阶段协议。
- 本地/云端模型的独立对照尚未覆盖；当前记录以用户实际选用模型的成功结果为准。
- Tool Search、Skill 来源优先级和资源冲突规则属于 SA2/SA3，未在 SA1 提前实现。

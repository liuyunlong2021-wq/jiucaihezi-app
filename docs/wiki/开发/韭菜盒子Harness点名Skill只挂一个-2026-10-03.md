# 点名 Skill 后本会话只许用这一个（2026-10-03）

> 状态：**已实施，离线实测通过**；真机 UI 验收待用户
> 范围：`MemoryWorkbench` 的 Harness 路径（`runtime === 'dh'`）
> 关联：[[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.4 第 6 处补丁

## 0. 诉求

「我 @ 了一个具体 skill，后续任务**只允许用这一个**，不许用别的。」

## 1. 官方为什么做不到「只想用这一个」

官方的 skill 是**双通道**，两件事分开：

| 通道 | 实现（`@deepseek-ai/dsh-tool-skill`） | 是否受手选影响 |
| --- | --- | --- |
| 用户显式调用 | `agent/pre-step` 扫用户消息里的 `/name` 手势 → `ctx.skills.get()` → 把该 skill 正文作为**额外一条 user 消息**注入（`source.kind: 'skill-invocation'`） | 命中即注入，**只加不排他** |
| 模型自主发现 | 发布 `<available_skills>` **全量目录** + 注册 `skill` 工具；目录原文明确要求「动手前先用 `skill` 工具加载适用的 skill，**Load all applicable skills**」 | 不影响 |

所以「@ 了 A，模型又去加载 B」是官方语义下的正常行为：A 的指令确实注进去了，但模型手里还有一份**全部 skill 的菜单**，而且被明确要求照菜单挑。

官方只有**文件级**开关（每个 `SKILL.md` 的 frontmatter）：

- `disable-model-invocation: true` → 该 skill 从模型目录与 `skill` 工具里消失（**全局、不可按对话**）
- `user-invocable: false` → 反过来，摘掉用户命令入口

「本次会话只许用这几个」这个粒度，官方 UI 没有开关。

## 2. 官方现成的机制：掩掉 `skill` 工具

关键是官方自己的两个事实拼起来（都是读源码确认的，不是推测）：

```js
// ① dsh-tools：隐藏工具会在模型能调用它之前移除 schema；restrict 接受 scoped ctx（agent.ctx）
ctx.tools.restrict({ deny: ['skill'] })   // 返回 disposer，dispose 即解除

// ② dsh-tool-skill：工具不可见时，目录直接变空（连目录都不再发布）
const snapshot = ctx.tools.get(skillTool.name, agent) === skillTool
  ? await ctx.skills.snapshot({ cwd, signal, scope: agent })
  : { skills: [], complete: true }
```

于是「掩掉 `skill` 工具」= 模型看不到目录、也调不到任何 skill；而**手势注入属于另一个
pre-step 钩子、完全不看工具可见性**，所以点名的那份 `<skill_content>` 照样进上下文。

这正是我们要的语义，且全部用官方件 —— 不需要自己写提示词、不需要禁用别的 skill 文件。

## 3. 我们怎么接（第 6 处 vendor patch）

`scripts/prepare-deepseek-harness.mjs` 给官方 `dsh-sdk-jsonrpc-server` 加：

1. `prompt()` 里在 `createUserMessage` 之前调 `await this.applyPinnedSkillScope(rec, content)`；
2. 判定与官方 `invokedSkillNames()` **逐字同源**：同一个 `SKILL_GESTURE` 正则
   （`/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`）+ 真去 `ctx.skills.get()` 查一次 +
   `isUserInvocable`。**只按正则匹配会把 `/permission` 这类官方命令也当成点名**，
   把工具面误掩掉，所以必须查注册表。
3. 命中 → `rec.handle.agent.ctx.tools.restrict({ deny: ['skill'] })`，把 disposer 按 agent 存起来；
   手势消失（用户清空 skill 芯片）后的下一轮自动 `dispose()` 解除。
4. `inject` 数组补 `skills`（与 `commands` 同一处）。

**语义**：会话级粘性 —— 工作台的 skill 芯片本来就跨轮保留、新建对话才清，而我们每条消息都带一遍
`/name` 手势，所以「@ 了就一直只许用这些」自然成立；清空芯片后下一轮恢复模型自主挑选。
点名两个就只许这两个。子代理继承该掩码（agent 作用域取交集）。

## 4. 实测（离线，不花钱）

用本地假模型（OpenAI 兼容）把**这一轮收到的工具表**回显成回答正文，于是不用读会话日志、
也不用真调模型，直接看模型能看见哪些工具。三轮同一会话：

| 轮次 | 结果 | 工具数 | `skill` 在表里 |
| --- | --- | --- | --- |
| ① 无手势 `你好` | result | 24 | **true** |
| ② 点名 `/jc-daoju …` | result | 23 | **false** |
| ③ 撤掉手势 `继续` | result | 24 | **true** |

脚本：`tmp/probe-skill-scope.mjs`（自带假模型，`tmp/skill-scope-cfg.json` 指向本地端点）。

**踩坑（第一版就是这么挂的）**：漏在 `inject` 里声明 `skills` 时，`this.ctx.skills` 直接抛
`cannot get property "skills" without inject` —— 而且是在 `prompt()` 里同步抛，**整轮对话直接失败**。
现在两处兜底：`applyPinnedSkillScope` 把「查注册表」和「掩工具」分别包 try/catch，失败只记一行
`[skill-scope] …`，绝不把这一轮判死。

## 5. 同一批改动：删除 @Jev

@Jev 的「自动挑 Skill」会**覆盖**用户手选的芯片（原 `applyJevDecision`：
`if (result.skills.length) selectedSkillNames.value = result.skills`），正是本次要消灭的行为，
用户 2026-10-03 决定整体删除。删除范围：`src/runtime/decision/`（决策层与它的测试）、
`src/utils/jevScorerRuntime.ts`、`scripts/jev-scorer/`、`scripts/jev-eval/`、
`src-tauri/src/commands/jev_scorer.rs` 与它的命令注册/权限/资源映射、`agentStore` 的打分器开关、
设置面板那一节、`run-focused-tests.mjs` 的清单条目、打包审计里的目录名。

## 6. 未验收

- 真机 UI：@ 一个 skill 后界面上确实只调用它、清空芯片后恢复（本轮只做到离线工具表级验证）。
- `cargo check` 未在本机通过：dev App 正在跑，占着 `src-tauri/target` 的构建产物
  （`os error 32`，不是代码错误）；Rust 与 JSON 侧已用全文检索确认无残留引用。

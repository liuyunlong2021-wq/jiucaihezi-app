# Skill Applicability Routing SDD

## Goal

让用户显式选择的 Skill 成为“默认工作方法”，但不再硬性支配每一轮输入。每轮对话必须判断当前用户输入是否适用当前 Skill；明显不适用时，Skill 不进入强系统提示，只作为当前选择信息保留。

## Non-Goals

- 不自动替用户切换 Skill。
- 不做自主 Agent 路由。
- 不隐藏用户当前选择。
- 不削弱用户显式要求“按当前 Skill 执行”的能力。

## Final Behavior

1. `apply`
   - 当前输入明显要继续执行 Skill 的领域任务。
   - 当前输入询问“当前是什么 Skill / 你是什么 Skill”。
   - 用户明确说“按当前 Skill / 用这个 Skill”。
   - Skill 完整进入 `systemPrompt` 的 `[当前Skill]` section。

2. `reference-only`
   - 当前输入明显是临时通用请求、工具导出、格式转换、设置/解释问题。
   - Skill 不作为强执行规则进入 `systemPrompt`。
   - `systemPrompt` 加入 `[当前Skill选择状态]`，只说明用户当前选中了哪个 Skill，且本轮不强制执行该 Skill。

3. `off`
   - 用户未选择 Skill。
   - 使用默认 Skill/system prompt。

## Initial Heuristic

V1 用确定性规则，不引入 LLM 分类器：

- `apply`:
  - 输入包含：`当前Skill`、`你是什么Skill`、`这个Skill`、`按当前Skill`、`用这个Skill`
  - 输入与 Skill 名称、描述、触发词、SKILL.md 关键词有明显重合
- `reference-only`:
  - 输入是当前上下文转换/导出：`上面/刚才/当前对话 + 转成/导出/保存为 + Word/docx/Markdown/PDF`
  - 输入是设置/解释/排错类：`为什么`、`怎么配置`、`报错`、`日志`、`什么意思`
  - 输入与 Skill 元信息无明显相关性

## Files

- Create: `src/runtime/connection/skillApplicability.ts`
- Test: `src/runtime/connection/__tests__/skillApplicability.test.ts`
- Modify: `src/runtime/connection/chatRuntimeConnection.ts`
- Modify: `src/runtime/connection/types.ts`
- Modify: `src/runtime/connection/runtimeConnection.ts`
- Test: `src/runtime/connection/__tests__/runtimeConnection.test.ts`
- Modify: `src/composables/useChat.ts`

## Tasks

### Task 1: Skill Applicability Classifier

- [ ] Add failing tests for `apply`, `reference-only`, and `off`.
- [ ] Implement deterministic classifier.
- [ ] Verify tests pass.

### Task 2: Connection Prompt Integration

- [ ] Add failing runtime connection tests proving unrelated input does not inject full SKILL.md.
- [ ] Add `[当前Skill选择状态]` section for reference-only mode.
- [ ] Preserve full Skill injection for applicable input.
- [ ] Verify tests pass.

### Task 3: Chat Runtime Wiring

- [ ] Pass Skill metadata and user input into the classifier from `useChat.ts`.
- [ ] Ensure trace exposes `skillApplicability`.
- [ ] Verify existing Skill/Knowledge/Tool tests still pass.

### Task 4: Regression Guards

- [ ] Add focused tests to `package.json`.
- [ ] Run `npx vue-tsc -b`.
- [ ] Run `pnpm run test:focused`.
- [ ] Run `git diff --check`.

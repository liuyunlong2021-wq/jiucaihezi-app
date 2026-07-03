# Manual Workbench Final Form Checklist

> Date: 2026-05-30
> North star: 韭菜盒子 Studio is a pure manual AI workbench first.

## Final Definition

The product is complete when the default execution path is:

```text
User explicitly selects Skill
User explicitly selects Knowledge or leaves it off
User explicitly enables/selects Tools or leaves them off
User selects Model
LLM executes only that assembled configuration
```

Superpower, if present, is not an execution mode. It is only a pre-run configuration assistant:

```text
Help me configure
↓
Show suggested Skill / Knowledge / Tool / Model
↓
User confirms or edits
↓
Manual execution begins
```

## P0 Execution Boundary

- [x] Remove Superpower prompt injection from ChatPanel execution sends.
- [x] Remove automatic `routeMessage()` Skill switching from ChatPanel send flow.
- [x] Remove Chain Invoke / Pipeline execution flow from ChatPanel.
- [x] Remove persistent "超能模式" switch from the chat Skill picker.
- [x] Keep future "帮我配置" as a pre-run recommendation entry, not an execution source.
- [x] Prevent `systemPrompt` from becoming an inline runtime Skill.
- [x] RuntimeConnection execution source must be `manual` or `plain`, not `superpower`.
- [x] Local tools are off by default.
- [x] Tool exposure must not use one global all-tools bundle as the default manual state.
- [x] High-risk tools require an explicit approval boundary before execution.
- [x] Knowledge must be evidence/context, not system instruction material.

## P1 Visibility

- [x] Chat surface always shows current Skill state, including "no Skill selected".
- [x] Chat surface always shows current Knowledge state, including "Knowledge off".
- [x] Chat surface shows current Tool state and why tools are available.
- [x] Mobile chat keeps Skill and Knowledge controls visible or reachable.
- [x] "Create Skill" must not silently mutate the active execution Skill.
- [x] Runtime trace records tools exposed to the model, not only tools called.

## P2 Test Gates

- [x] Test: `systemPrompt` cannot override selected Skill.
- [x] Test: Superpower cannot become RuntimeConnection execution source.
- [x] Test: local tools are off by default.
- [x] Test: tools off means request has no tools and forged tool calls are rejected.
- [x] Test: high-risk browser/dev tools require approval or are not exposed.
- [x] Test: Knowledge is not included in system role as instruction text.
- [x] Test: ChatPanel has no Superpower prompt, route, invoke, or pipeline execution path.

## P3 Documentation

- [x] CLAUDE.md describes the product as a pure manual workbench first.
- [x] AGENTS.md removes product-facing Skill/Agent and L2 routing framing.
- [x] Old Connection checklist is updated or superseded by this manual-workbench checklist.
- [x] Superpower docs use "configuration assistant" language only.

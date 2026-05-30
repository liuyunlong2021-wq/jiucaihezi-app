# Connection Final Form Checklist

> Date: 2026-05-30
> Superseded by: `docs/sdd/manual-workbench-final-form-checklist.md`
> Current baseline: pure manual workbench first. Superpower is only a future configuration assistant, not a runtime execution mode.
> Goal: finish this checklist and 韭菜盒子 Studio reaches the complete Connection system shape.

## Final Definition

The product is complete when:

- UI only collects user choices and task input.
- SkillConnection owns official Skill resolution.
- KnowledgeConnection owns all Wiki/Vault evidence attachment.
- ToolConnection owns tool exposure and source tracing.
- SuperpowerConnection owns optional recommendation/auto-selection boundaries.
- RuntimeConnection owns run assembly and trace.
- LLM runtime only executes the assembled request and tool-call loop.
- No UI or chat runtime file directly assembles Skill + Knowledge + Tool relationships.

## P0 Must Finish

- [x] Move `resolveSelectedSkillPrompt()` out of `src/composables/useChat.ts` into `src/runtime/connection/skillConnectionAdapter.ts`.
- [x] Remove direct Skill prompt resolving from `useChat.ts`; `useChat.ts` should call SkillConnection only.
- [x] Move `buildAvailableTools()` out of `useChat.ts` into `src/runtime/connection/toolConnectionAdapter.ts` or a dedicated tool provider under `runtime/connection`.
- [x] Keep actual tool executors in existing leaf modules, but remove tool exposure ownership from `useChat.ts`.
- [x] Move `buildSuperpowersPrompt()` usage out of `src/components/chat/ChatPanel.vue`.
- [x] Add a SuperpowerConnection adapter that wraps current `useSkillRouter.ts` prompt/routing/chain-invoke behavior.
- [x] Make ChatPanel pass only UI state and task input; no final system prompt assembly in ChatPanel.
- [x] Add `buildChatRuntimeConnection()` as the single chat request builder.
- [x] Make `sendMessage()` accept a prebuilt RuntimeConnection request, then delete the temporary in-function assembly branch.
- [x] Ensure Canvas LLM, chat, and future panel runtimes all attach knowledge only through KnowledgeConnection.

## P1 Architecture Cleanup

- [x] Delete or rewrite old docs that describe private Agent/L2 orchestration as the product center.
- [x] Keep `tier?: 'L1' | 'L2'` only as a documented legacy storage field, not a product architecture concept.
- [x] Remove old wording that implies tools are only callable by Skill.
- [x] Remove old wording that implies Superpower is a violation; Superpower is optional user-controlled auto-selection space.
- [x] Rename misleading internal comments from Agent/Workflow ownership to Skill/Connection ownership where safe.
- [x] Add `src/runtime/connection/index.ts` exporting the public Connection API.
- [x] Add architecture guard tests that prove prompt sections are assembled only from RuntimeConnection.

## P2 Tests Required

- [x] SkillConnection test: inline official `SKILL.md` resolves.
- [x] SkillConnection test: `skill://` resolves through one loader.
- [x] SkillConnection test: malformed or missing Skill content fails visibly.
- [x] ToolConnection test: global tools dedupe and preserve source trace.
- [x] ToolConnection test: skill-creator special tool policy is preserved.
- [x] KnowledgeConnection test: off mode never recalls.
- [x] KnowledgeConnection test: selected Vault evidence renders with evidence boundaries.
- [x] SuperpowerConnection test: Superpower source is explicit and user-controlled.
- [x] RuntimeConnection test: deterministic section order.
- [x] useChat test: chat request uses RuntimeConnection prompt and tool definitions.
- [x] Canvas test or smoke check: canvas knowledge path uses KnowledgeConnection.

## P3 Verification Gates

- [x] `rg "buildSystemPrompt" src` returns no production prompt assembly owner.
- [x] `rg "resolveSelectedSkillPrompt" src` returns only Connection files or no result.
- [x] `rg "buildAvailableTools" src` returns only Connection/tool-provider files or tests.
- [x] `rg "buildSuperpowersPrompt" src/components/chat src/composables/useChat.ts` returns no direct ChatPanel/useChat ownership.
- [x] `rg "recallKnowledge\\(" src/components src/composables/useChat.ts` returns no direct product-runtime call.
- [x] `pnpm run test:focused` passes.
- [x] `pnpm exec vue-tsc -b` passes.

## Final Acceptance

- [x] User chooses Skill manually, or chooses Superpower to recommend/select.
- [x] User chooses Knowledge manually, or leaves Knowledge off.
- [x] Tool exposure is explicit and traceable.
- [x] LLM receives one assembled RuntimeConnection prompt.
- [x] Knowledge is always evidence, never workflow.
- [x] Skill remains official `SKILL.md`, not a private Agent schema.
- [x] Superpower remains optional and visible, never hidden black-box control.
- [x] Completing this checklist means Connection is the product core, not scattered glue code.

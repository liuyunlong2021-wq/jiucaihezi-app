# OpenCode Hardening A-C Acceptance Audit

**Date:** 2026-06-07

**Scope:** Hardening A-C after `docs/sdd/opencode-hardening-a-c-tdd-plan.md`.

**Rule:** `docs/sdd/opencode-official-ui-behavior-porting-sdd.md` Section 6:

> Every OpenCode official event, part type, session status, command, permission, question, and tool state must have a Jiucaihezi carrier.

## Executive Result

**Overall: FAIL for Non-Negotiable sign-off.**

Hardening A-C implementation gates are green:

- `pnpm exec vue-tsc -b`: PASS
- `pnpm run test:focused:build`: PASS
- `pnpm run test:focused:run`: PASS, 514/514
- `pnpm run test:tauri`: PASS after running outside sandbox, 387/387, 1 ignored

But strict acceptance is not signable yet because several official states/events are missing, weakly surfaced, or intentionally hidden.

## Subagent Audit Summary

| Audit Slice | Result | Main Finding |
|---|---:|---|
| Event / status / abort | FAIL | `session.status:error`, non-text `message.part.delta`, `session.finished`, stream close/error are not fully carried. |
| Part / timeline / mapper | FAIL | Main structured part flow works, but test coverage is incomplete for several part types. `todowrite` hidden is no longer considered a failure because official OpenCode hides it from the normal timeline. |
| Prompt input / session cache | PASS | Typed prompt parts, explicit parts passthrough, session id persistence, prefetch/cache are covered. |
| UI carriers | FAIL | permission/question/todo/diff mostly work, but slash/shell are too implicit and share is weakly actionable. |

## Hard Blockers

| ID | Area | Gap | Current Carrier | Required Fix |
|---|---|---|---|---|
| HA-001 | session status | `session.status` with `error` is ignored. | `busy`, `idle`, `retry` only. | Map `status:error` to error part + `finalizeOpenCodeRun('error')`. |
| HA-002 | event stream | `event.subscribe()` close/error has no explicit UI carrier. | Status polling + 5 minute timeout. | Add `onClose/onError` to `subscribeOpenCodeEvents()` and finalize/sync or show error immediately. |
| HA-003 | delta events | `message.part.delta` only handles `text` and `reasoning`. | Non-text delta is dropped. | Preserve non-text delta into part raw/title/result, or create unknown delta part. |
| HA-004 | completion | `session.finished` is not recognized. | `session.idle`, `session.next.finished`, `session.status idle`. | Add `session.finished` compatibility to complete-event detection. |
| HA-005 | tool visibility | Superseded by Hardening D0 official parity. `todowrite` hidden in normal timeline is official behavior. | Filtered by `HIDDEN_TOOLS` and `OpenCodePartList`; TodoDock carries todo state. | Keep hidden in normal timeline; require TodoDock carrier and tests. |

## Partial Gaps

| ID | Area | Gap | Suggested Fix |
|---|---|---|---|
| HP-001 | top-level runtime messages | Top-level `agent-switched` is explicitly dropped by mapper tests. | Confirm official history shape; if top-level runtime messages exist, convert them into synthetic `openCodeParts`. |
| HP-002 | slash commands | `/` command is functional but invisible unless user knows the prefix. | Add visible command affordance or command menu carrier. |
| HP-003 | shell command | `!` shell is functional but invisible. | Add visible shell command affordance. |
| HP-004 | share command | `session.share` returns notice text only. | Render actionable share row with copy/open actions. |
| HP-005 | question queue | `QuestionDock` only shows first pending request. | Show pending count and queue navigation. |
| HP-006 | attachment payload | Text attachments are duplicated in data URL and `source.text`. | Add size cap or switch large text attachments to file/source-only strategy. |
| HP-007 | URL validation | Prompt image URLs pass through helper without local protocol validation. | Validate allowed URL schemes in `buildOpenCodePromptParts()`. |

## Covered Areas

| Area | Status |
|---|---:|
| `session.status busy/idle/retry` | PASS |
| `session.error` | PASS |
| abort command and visible `cancelling` phase | PASS |
| timeout carrier | PASS |
| text/reasoning streaming delta | PASS |
| tool running/result/error for ordinary tools | PASS |
| file/attachment/subtask/patch/diff/snapshot/unknown part mapping | PARTIAL to PASS, needs table tests |
| system rows for agent/compaction/retry/step finish/fail | PASS |
| typed prompt parts for text/file/image/agent | PASS |
| explicit prompt parts passthrough | PASS |
| local session `openCodeSessionId` persistence | PASS |
| session switch prefetch + `preferCache` | PASS |
| permission asked/replied | PASS |
| question asked/replied/rejected | PASS |
| todo.updated dock | PASS |
| session.diff dock | PASS |
| fork/summarize/archive/delete/diff session commands | PASS |

## Required Next Wave

**Hardening D: Acceptance Closure**

1. Add tests for HA-001 to HA-004 plus revised HA-005/D0 todo carrier first.
2. Implement only the failing acceptance carriers.
3. Add table-driven mapper/timeline tests for all known OpenCode part types.
4. Re-run:
   - `pnpm exec vue-tsc -b`
   - `pnpm run test:focused:build`
   - `pnpm run test:focused:run`
   - `pnpm run test:tauri`

## Sign-off

Hardening A-C implementation is complete and verified.

Non-Negotiable Acceptance Rule is **not yet satisfied**.

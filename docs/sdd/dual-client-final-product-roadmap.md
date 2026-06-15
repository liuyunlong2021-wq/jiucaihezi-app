# Dual Client Final Product Roadmap SDD

## Status

Active execution roadmap. Any AI tool working on the final product shape must read this file after `CLAUDE.md` and `AGENTS.md`.

## Goal

Ship one coherent product with two equally important clients:

```text
Desktop APP: 文模式 + 武模式 + 直连模式
Web client: 直连模式
```

The largest architectural boundary is OpenCode:

- Desktop 文 / 武 modes use OpenCode.
- Web does not use OpenCode.
- Desktop 直连 should reuse the Web direct engine as much as possible.

## Product Shape

### Desktop APP

Desktop is the full local workbench:

- 文模式: OpenCode plan mode, project-aware, no direct computer control by default.
- 武模式: OpenCode build mode, project-aware, can drive official OpenCode tools and permissions.
- 直连模式: standard direct chat path, no OpenCode parts, intended to reuse the Web direct engine.
- Local capabilities: Tauri, local files, local tools, project directory, OpenCode server, sidecars.

### Web Client

Web is the browser product:

- Only 直连模式 is exposed.
- No OpenCode runtime, no Tauri, no `src-tauri/**`, no `src/opencodeClient/**`.
- Uses browser-safe direct chat, session history, persistence, streaming, web search, and web-safe tools.
- Shares visual components and product vocabulary with desktop where possible.

## Architectural Boundaries

### Shared Product Surface

These should stay consistent across Desktop and Web:

- Chat visual shell and message rendering.
- Model and Skill selection concepts.
- Creation panel behavior.
- Canvas and editor product workflows.
- Session/history concepts where runtime constraints allow.
- Error language and user-facing terminology.

### Desktop-Only Layer

These belong to Desktop/OpenCode and must not be modified from Web direct work:

- `src-tauri/**`
- `src/opencodeClient/**`
- OpenCode timeline, permission, question, todo, diff, VCS, shell, and project-directory logic.
- Local filesystem, shell, sidecar, and native capability bridges.

### Web Direct Layer

These belong to Web direct and must not leak OpenCode assumptions:

- Direct chat request/streaming logic.
- Browser persistence for conversations/messages.
- Web search and web-safe tool integration.
- Browser-safe API/session handling.
- Runtime guards for `!isTauriRuntime()`.

### Future Shared Direct Engine

The direct mode should converge into a shared engine with platform adapters:

```text
direct engine core
  - message shaping
  - OpenAI-compatible streaming parser
  - tool-call accumulation and follow-up calls
  - persistence contract
  - title/preview contract

web adapter
  - browser persistence
  - browser fetch/CORS behavior
  - web search

desktop direct adapter
  - Tauri-safe fetch/session route if needed
  - desktop persistence integration
  - no OpenCode parts
```

Do not put OpenCode concepts into the shared direct engine.

## Branch Strategy

Current truth:

- `main`: canonical integration trunk and release base.
- `codex/opencode-core-execution`: desktop/OpenCode work branch. It is currently aligned with `main` after promotion.
- `codex/web-direct-wongsaang`: Web direct branch. It must be rebased or merged onto the new `main` before further Web work.

Rules:

- Do not use `main` for experiments.
- Web direct work happens in `codex/web-direct-wongsaang`.
- Desktop/OpenCode work happens in `codex/opencode-core-execution` or a short branch from `main`.
- Cross-client direct-engine extraction should happen only after Web direct passes product validation.
- Every merge to `main` requires boundary audit and focused verification.

## Execution Phases

### Phase 0: Documentation and Branch Baseline

Goal: all tools understand the roadmap.

Exit criteria:

- `CLAUDE.md` and `AGENTS.md` point to this SDD and the execution plan.
- `main` is the canonical trunk.
- `codex/opencode-core-execution` is aligned with `main`.
- Web direct branch is identified as the next active branch.

### Phase 1: Rebase Web Direct Onto New Main

Goal: put Web work on top of the promoted product baseline.

Exit criteria:

- `codex/web-direct-wongsaang` is based on current `main`.
- Web branch contains only Web direct/WongSaang integration work.
- Web branch does not modify `src-tauri/**` or `src/opencodeClient/**`.
- Boundary audit script or manual audit result is recorded.

### Phase 2: Complete Web Direct Product

Goal: Web direct is a complete deployable product.

Required capabilities:

- Web exposes only 直连 mode.
- Conversation/history/multi-session management works.
- Direct API request path streams reliably.
- Tool-call layer handles model tool calls without empty assistant bubbles.
- Message rendering uses existing UI components without visual churn.
- Copy/edit/regenerate interactions remain intact.
- Persistence survives refresh and session switching.
- Web search and web-safe convenience tools are available behind explicit UI/config.
- Web build produces a deployable `dist`.

Exit criteria:

- Web direct focused tests pass.
- `pnpm exec vue-tsc -b` passes.
- `pnpm run build` passes for Web.
- Deployed or locally served Web build can send, stream, refresh, and restore history.

### Phase 3: Extract Shared Direct Engine

Goal: create a clean direct-mode engine that Web uses first and Desktop direct can reuse.

Constraints:

- Do not touch desktop OpenCode 文 / 武 behavior.
- Do not move UI rendering into the engine.
- Keep platform adapters explicit.

Exit criteria:

- Web direct still passes Phase 2 checks after extraction.
- Shared engine has focused tests for JSON fallback, SSE parsing, tool-call accumulation, second-pass follow-up, and persistence contract.
- No OpenCode imports in the direct engine.

### Phase 4: Add Desktop Direct Mode

Goal: Desktop gains a third mode, 直连, without disturbing 文 / 武.

Required behavior:

- 文 mode continues to use OpenCode plan path.
- 武 mode continues to use OpenCode build path.
- 直连 mode uses the shared direct engine.
- Desktop direct does not render OpenCode parts.
- Project directory is not injected as an OpenCode workspace in direct mode.

Exit criteria:

- Desktop 文 / 武 regression checks pass.
- Desktop direct can send, stream, persist, and restore.
- No regressions in OpenCode timeline/permission/question/tool parts.

### Phase 5: Dual-Client Regression

Goal: prove the final product shape works as a whole.

Web regression:

- Direct send/stream.
- Session create/switch/delete.
- Refresh restore.
- Search on/off.
- Tool-call response.
- Web build/deploy smoke test.

Desktop regression:

- 文 send with project directory.
- 武 send with project directory.
- OpenCode timeline parts.
- Permission/question/todo/diff surfaces.
- Desktop direct send/stream/persist.
- Tauri build or at least desktop type/build smoke test.

### Phase 6: Release

Goal: publish tested Web and Desktop artifacts from `main`.

Exit criteria:

- `main` contains both validated client paths.
- Web `dist` deployed.
- Desktop artifacts built for target platforms.
- Release notes distinguish Web direct and Desktop 文/武/直连 behavior.

## Boundary Audit Checklist

Before merging Web work to `main`:

- [ ] No modifications under `src-tauri/**`.
- [ ] No modifications under `src/opencodeClient/**`.
- [ ] No OpenCode imports in Web direct engine.
- [ ] No Web-only CORS/browser assumptions in desktop OpenCode path.
- [ ] `ChatPanel.vue` visual changes are limited and intentional.
- [ ] `MessageBubble.vue` rendering behavior is unchanged unless explicitly approved.

Before merging Desktop/OpenCode work to `main`:

- [ ] No Web direct/WongSaang experimental logic in OpenCode event loop.
- [ ] No direct-mode tool-call loop mixed into OpenCode 文 / 武.
- [ ] `src-tauri/**` changes are reviewed for permissions and side effects.
- [ ] `@opencode-ai/sdk` changes are intentional and typechecked.
- [ ] Desktop OpenCode 文 / 武 behavior is verified.

## Prohibited Shortcuts

- Do not reset or clear `main`.
- Do not mix Web direct and OpenCode changes in one unreviewed commit.
- Do not place OpenCode parts into Web direct messages.
- Do not make Web depend on Tauri.
- Do not make desktop direct depend on OpenCode internals.
- Do not change visual rendering layers as part of engine work unless the phase explicitly calls for it.

## Handoff Rule

When switching AI tools, paste this instruction:

```text
Read CLAUDE.md, AGENTS.md, docs/sdd/dual-client-final-product-roadmap.md, and docs/superpowers/plans/2026-06-15-dual-client-final-product.md. Continue the current unchecked phase only. Do not skip boundary audits.
```

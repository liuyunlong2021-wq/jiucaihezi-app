# CLAUDE.md

**铁律零**: OpenCode 源码是唯一事实源。OpenCode 有的架构/功能/行为，一字不差照抄——三层隔离、UI、滚动，全抄。不自行发挥。

## 0. Root Cause First — 先审根因，再修症状 ⭐

**A bug is a symptom. The thing that caused it may itself be unnecessary.**

Before fixing any bug:
1. Trace the full chain: what change → what broke → what was that change for?
2. Question every link: does each piece need to exist?
3. If removing the cause fixes the bug AND simplifies the code → remove it.
4. Only if the cause is truly necessary, then fix the symptom.

**Real example from this project**: Health check (added for process reuse safety) killed and restarted a process → JS session ID pointed to dead session → 400/404 errors. The fix wasn't tracking PID to detect restart — it was questioning whether the health check was even needed. Removing unnecessary complexity is always better than adding complexity to handle it.

**Counter-example**: Don't add `lastServerPid` to detect process restart when you could just let the server tell you the session is invalid (which is what OpenCode official does).

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# Tool Gating, One-Click Login, and Hidden Unready Entrances TDD

Date: 2026-06-02

## Scope

This change covers three production-readiness behaviors:

1. Hide Canvas and Creation panel entry points from the normal ActivityRail.
2. Treat enabled local tools as permission, not a requirement to expose tools on every turn.
3. Make one-click NewAPI login auto-fill and auto-save the generated API key when a key is available.

## Non-Goals

- Do not delete Canvas or Creation code.
- Do not redesign Canvas or Creation internals.
- Do not change media generation sync/async behavior in this pass.
- Do not connect Mem0.
- Do not package the macOS app in this pass unless explicitly requested.

## Required Tests First

### Hidden Entrances

- ActivityRail must not expose `canvas` or `creation` in the normal `tabs` list.
- The code may keep those modes internally for future development, but users should not see entry buttons.

### Tool Applicability Gate

- If local tools are off, no tools are exposed.
- If local tools are on but current input is ordinary knowledge/explanation/chat, no tools are exposed.
- If local tools are on and current input asks for document creation/export/conversion, office tools are exposed.
- If local tools are on and current input asks to search/open/read a webpage, browser tools are exposed when web search is not already enabled.
- If local tools are on and current input asks to read/convert local files, local content tools are exposed.
- If local tools are on and current input asks to inspect or modify a code project, dev tools are exposed when a dev project root exists.
- Skill Creator keeps its special tool policy.

### One-Click Login

- When `createAutoGroupApiKey()` returns an API key, SettingsPanel must set the input value and persist the key immediately.
- When a pending callback key is consumed, SettingsPanel must persist it immediately.
- A failed or unauthorized one-click login must not overwrite an existing key.
- The success message should say the key has been auto-saved, not ask the user to click Save.

## Manual Acceptance

1. ActivityRail no longer shows Canvas or Creation buttons.
2. With tools enabled, asking a normal question such as “曾国藩为什么取得这样的成就？” responds without tool-call delay.
3. With tools enabled, asking “把上面的内容转成 Word 文档” still exposes and uses document tools.
4. Clicking 一键登录 while already logged in creates an auto-group key, fills the key field, and saves it without requiring 保存设置.
5. If not logged in, 一键登录 opens the login path and does not erase the current key.


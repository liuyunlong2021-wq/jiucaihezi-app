# Browser Runtime V1 Design

## Goal

Give韭菜盒子 Studio a visible, local browser execution layer that can search, open, read, screenshot, click, and type in a dedicated Google Chrome window. The user should see AI operating a real browser, while the product hides Gateway/OpenClaw terminology.

## Product Principles

- Default to a dedicated Chrome profile at `~/.jiucaihezi/browser-profile`; do not operate the user's daily Chrome tabs.
- Use visible Chrome by default. The visual action is part of the product value for nontechnical users.
- Treat browser search as a local tool, not as a chat toolbar switch.
- Show simple activity copy in chat: `调用工具中...`, `正在搜索`, `正在阅读网页`, `正在整理结果`.
- Keep risky actions separated: search/open/read/screenshot are safe; click/type/download require an agent or approval-capable flow.

## Architecture

```text
Vue Chat Tool Loop
  -> browserTools.ts
  -> Tauri invoke(browser_*)
  -> Rust BrowserRuntime state
  -> chromiumoxide
  -> Dedicated visible Google Chrome
  -> DOM text / links / screenshots
  -> model tool result
```

`chromiumoxide` is the preferred execution layer because it is Rust-native and controls Chrome through Chrome DevTools Protocol. It avoids a Go sidecar (`chromedp`) and avoids importing another AI-agent stack (`browser-use`) that duplicates韭菜盒子的模型、Skill、知识库和工具系统.

## Commands

### Safe commands

- `browser_launch`: starts dedicated visible Chrome if needed.
- `browser_open`: opens a URL in the current browser page.
- `browser_read`: returns title, URL, and extracted body text.
- `browser_state`: returns title, URL, body excerpt, and visible clickable/input elements.
- `browser_screenshot`: captures PNG screenshot as base64.
- `browser_search`: opens Google Search, extracts result links/snippets, and returns clean structured data.
- `browser_close`: closes the dedicated browser process.

### Approval commands

- `browser_click`: clicks a CSS selector.
- `browser_type`: focuses a CSS selector and types text.

## Search Flow

```text
User asks for current/web information
  -> model calls browser_search
  -> Chrome opens visibly
  -> Google search page loads
  -> Rust extracts top results
  -> optional follow-up browser_open/browser_read
  -> model writes concise answer with sources
```

The old `web_search` name remains as a compatibility alias, but it should route to `browser_search`. The chat toolbar search switch should be removed so search is always a tool decision.

## UI Integration

- Tool warehouse card name stays `浏览器`.
- Source becomes `local`.
- Safe aliases are visible and available in plain chat.
- Approval aliases are only exposed when the tool policy allows approval tools.
- Chat no longer renders the old `正在搜索全网最新信息...` block.

## Self-Check Per Stage

1. Documentation exists and explains boundaries.
2. Rust compiles with browser commands registered.
3. Frontend unit tests confirm tool definitions and aliases.
4. Search/click/type/state commands are callable through the same tool executor.
5. Top search toggle is absent; `web_search` compatibility calls browser search.

## Non-Goals For V1

- Do not control the user's existing personal Chrome tabs.
- Do not implement cloud browser automation.
- Do not expose Gateway/OpenClaw panels.
- Do not add multiple visible search engines in the user UI.

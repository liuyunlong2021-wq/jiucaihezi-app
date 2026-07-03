# Gateway Desktop Integration

## Goal

Desktop becomes "Web user-center experience + desktop local capabilities + Gateway account and billing". The desktop app must not ask normal users to fill API keys. Cloud account, balance, membership, model lists, cloud chat, media generation, topup, checkin, redeem, affiliate and logs go through `https://gateway.jiucaihezi.studio`.

## Non-Goals

- Do not modify `/Users/by3/Documents/jiucaihezi-v6`.
- Do not copy the Gateway source tree into the desktop app.
- Do not remove desktop-only capabilities just because Web does not have them.
- Do not connect desktop directly to NewAPI.

## Ownership

Desktop owns:

- UI shell and workspace layout.
- Local files, local knowledge vault files and raw/wiki material.
- Agents/skills UI and local skill storage.
- Editor, canvas, browser control, format conversion and local tools.
- Ollama local model selection and local chat path.

Gateway owns:

- Login, register, logout and session.
- `/api/me` account snapshot.
- Balance, membership, mode, topup, checkin, redeem, affiliate and ledger/logs.
- Cloud model list and cloud model calls.
- Cloud media/creation proxy routes.

NewAPI stays behind Gateway:

- Final user/quota/account records.
- Usage logs, model groups, channels and billing.

## Gateway Contract

Base URL:

```text
https://gateway.jiucaihezi.studio
```

Required endpoints:

```text
POST /auth/login
POST /auth/register
POST /auth/logout
GET  /auth/session
GET  /api/me
GET  /api/me/checkin
POST /api/me/checkin
POST /api/topup/create-order
GET  /api/topup/order-status?order_id=xxx
POST /api/me/redeem
GET  /api/me/ledger
GET  /api/me/usage
GET  /api/me/logs
GET  /api/me/affiliate
POST /api/me/membership/subscribe
POST /api/me/mode
GET  /api/models
POST /v1/chat/completions
```

Cloud media/creation endpoints must also go through Gateway:

```text
/v1/images/*
/v1/videos/*
/v2/videos/generations/*
/v1/audio/speech
/api/creations/*
/rh-openai/*
/jina-openai/*
```

## Session Rules

Desktop stores the Gateway session token locally and sends it on every Gateway request:

```text
Authorization: Bearer <session>
X-JC-Session: <session>
x-api-key: <session>
```

For Web compatibility during migration, desktop accepts both:

```text
jcGatewaySessionToken
jcUserAccessToken
```

Gateway requests should use `credentials: "include"` where the Web client does. In Tauri, bearer headers remain the durable session path because Rust HTTP bridging does not automatically persist browser cookies.

## Account Normalization

`/api/me` can return any of these shapes:

```text
account
user
data.account
data.user
balance_flowers
balanceFlowers
quota
membership
mode
modeLabel
permissions
```

Desktop normalization must prefer Gateway/NewAPI values. Balance display is never calculated from local usage. `quota` can be converted to flowers only as a fallback when Gateway does not return flowers.

## Permission Rules

Unauthenticated:

- Allowed: conversation/session viewing, starting a local chat shell, Settings/User Center, Help.
- Blocked: agents, knowledge vault features, tools, creation, editor, canvas, non-history file tree tabs and cloud model calls.

Authenticated non-member:

- Allowed: normal chat and viewing conversations.
- Blocked: agents, knowledge vault features, tools, creation, editor, canvas and non-history file tree tabs.

Member:

- Allowed: all desktop capabilities, including desktop-only canvas, editor, local tools, format conversion, browser control, local files, agents and knowledge vaults.

Local Ollama models remain selectable in the desktop model selector. Selecting a Gateway model uses Gateway; selecting an Ollama model uses `http://127.0.0.1:11434`. The app must not auto-switch between cloud and local paths.

## UI Adaptation

Use the Web user center as the reference for account UX:

- Username and user ID.
- Jiucaihua balance with logo.
- `100 韭菜花 = 1 元`.
- Membership state and expiry.
- Normal/performance mode.
- Topup, checkin, redeem, affiliate and logs.
- Help content that explains no-proxy cloud models, model picker, agents, knowledge vault and account balance.

Do not downgrade desktop workspace UX. Keep desktop local panels and only add permission gates where needed.

## Implementation Boundaries

Gateway requests must go through `src/services/gatewayClient.ts`.

Account state must go through `src/stores/gatewayAccountStore.ts`.

Feature gating must go through `src/utils/gatewayPermissions.ts`.

Components should not hand-roll Gateway fetches except lower-level streaming chat/media code that still uses the same Gateway headers/session helpers.

# Jiucaihezi Studio Auth Broker

This Worker only handles one-click login for Jiucaihezi Studio.

```text
Studio -> /auth/login -> NewAPI account login
       -> create or reuse NewAPI workbench key
       -> return api_key + base_url

Studio chat -> NewAPI directly
```

## Responsibilities

- `POST /auth/login`: validates a NewAPI username/password, creates or reuses the user's `韭菜盒子工作台` token, and returns:

```json
{
  "success": true,
  "api_key": "sk-...",
  "base_url": "https://api.jiucaihezi.studio/v1",
  "username": "..."
}
```

- `GET /health`: health check.

Legacy `/auth/session` and `/auth/logout` handlers remain for old clients, but new Studio chat does not depend on Gateway sessions.

## Non-Responsibilities

- Does not proxy `/v1/chat/completions`.
- Does not proxy `/api/chat/completions`.
- Does not handle membership, billing, recharge, check-in, invite, usage logs, media generation, or adapters.

## Routes

`wrangler.toml` should only bind:

```text
api.jiucaihezi.studio/auth/*
api.jiucaihezi.studio/health
```

Do not bind chat completion routes to this Worker.

## Environment

```text
NEWAPI_BASE_URL=https://api.jiucaihezi.studio
NEWAPI_DEFAULT_GROUP=auto
NEWAPI_GATEWAY_SECRET=optional
```

## Test

```bash
npm test
```

## Deploy

```bash
npm run deploy
```

# Jiucaihezi Studio Gateway

This Worker handles Studio login and authenticated text sync. Model and media requests still go directly to NewAPI or their existing adapters.

```text
Studio -> /auth/login -> NewAPI account login
       -> create or reuse NewAPI workbench key
       -> return api_key + sync_session + base_url

Studio chat -> NewAPI directly
Studio text sync -> /sync/* -> SYNC_DB
```

## Responsibilities

- `POST /auth/login`: validates a NewAPI username/password, creates or reuses the user's `韭菜盒子工作台` token, and returns:

```json
{
  "success": true,
  "api_key": "sk-...",
  "sync_session": "sess_...",
  "base_url": "https://api.jiucaihezi.studio/v1",
  "username": "..."
}
```

- `GET /sync/projects`: lists the logged-in user's projects.
- `DELETE /auth/account`: deletes the logged-in NewAPI account and its synced text data.
- `POST /sync/projects`: creates a project for the logged-in user.
- `GET /sync/projects/:id/files?cursor=0`: pulls changed text files and tombstones.
- `POST /sync/projects/:id/files`: pushes 1-100 idempotent, revision-checked text mutations.
- `POST /sync/projects/:id/delete` and `/restore`: toggles the project tombstone.
- `GET /health`: health check.
- `POST /api/creations/uploads`: stores a short-lived local media reference in the existing KV and returns a public HTTPS URL for video providers that require URL-based references.
- `GET /media/creation/:token`: serves those references until their 15-minute expiry.

Chat continues to use the ordinary NewAPI key. `/sync/*` accepts only a valid `jc_session` cookie or `X-JC-Session`; the client cannot submit its own user ID.

## Non-Responsibilities

- Does not proxy `/v1/chat/completions`.
- Does not proxy `/api/chat/completions`.
- Does not handle membership, billing, recharge, check-in, invite, usage logs, media generation, or adapters. Temporary creation media is limited to 20 MB and expires automatically.

## Routes

`wrangler.toml` should only bind:

```text
api.jiucaihezi.studio/auth/*
api.jiucaihezi.studio/health
api.jiucaihezi.studio/sync/*
api.jiucaihezi.studio/api/creations/uploads
api.jiucaihezi.studio/media/creation/*
```

Do not bind chat completion routes to this Worker.

## Environment

```text
NEWAPI_BASE_URL=https://api.jiucaihezi.studio
NEWAPI_DEFAULT_GROUP=auto
NEWAPI_GATEWAY_SECRET=optional
SYNC_DB=Cloudflare D1 binding
```

## Test

```bash
npm test
```

## Deploy

```bash
npm run deploy
```

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

- Serves an iframe-ready Studio homepage body for NewAPI's native homepage setting, favicon, landing images, and support/privacy/terms pages on the API host. `npm run deploy` synchronizes these files from the repository's current `index.html` and `public/` assets before deployment.
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

Chat continues to use the ordinary NewAPI key. `/sync/*` accepts only a valid `jc_session` cookie or `X-JC-Session`; the client cannot submit its own user ID.

## Non-Responsibilities

- Does not proxy `/v1/chat/completions`.
- Does not proxy `/api/chat/completions`.
- Does not handle membership, billing, recharge, check-in, invite, usage logs, media generation, or adapters.

## Routes

`wrangler.toml` binds public static pages and these gateway routes:

```text
api.jiucaihezi.studio/homepage-content/*
api.jiucaihezi.studio/support/*
api.jiucaihezi.studio/privacy/*
api.jiucaihezi.studio/terms/*
api.jiucaihezi.studio/auth/*
api.jiucaihezi.studio/health
api.jiucaihezi.studio/sync/*
```

The root `/` remains on NewAPI so its navigation shell and client-side routes keep working. Set NewAPI's homepage content to `https://api.jiucaihezi.studio/homepage-content/` to show the Studio page beneath that shell. Do not bind `/`, `/v1/*`, `/api/*`, or media routes to this Worker. Those continue to NewAPI and its existing adapters.

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

## Creation media ownership (2026-10-06)

`POST /api/creations/uploads` and `GET/HEAD /media/creation/:token` belong to NewAPI.
Do not bind either route to this Worker. The NewAPI extension stores temporary media
in its persistent `/data` volume (20 MiB per file, 7 days, 10 GiB budget).
See [deployment scripts](../scripts/newapi-media/README.md). No R2 subscription is required.

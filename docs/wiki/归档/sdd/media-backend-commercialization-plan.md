# SDD: Media Backend Commercialization

> Status: P0 deployed, P1 deployed
> Scope: keep client direct to NewAPI while moving media reliability behind NewAPI

## Product Rule

韭菜盒子用户端仍然只使用主 NewAPI Token。用户不填写 RunningHub、Seedance、Suno、Grok、Veo 等上游 Key。

This plan does not restore a user-visible Gateway. The backend addition is an internal Media Orchestrator behind NewAPI channels.

## Current Chain

```text
Desktop/Web
  -> https://api.jiucaihezi.studio
  -> NewAPI
  -> channel upstreams
     -> rh-adapter for RunningHub
     -> direct/proxy routes for selected providers
```

## Target Chain

```text
Desktop/Web
  -> api.jiucaihezi.studio
  -> NewAPI: auth, user token, groups, billing entry
  -> internal Media Orchestrator: routing, key pool, durable jobs, health
  -> provider adapters: RunningHub, T8, Seedance, Suno, Grok, Veo
```

## P0: Stop The Bleeding

- [x] RH adapter binds to a non-public host by default and is deployed on Docker bridge `172.17.0.1`.
- [x] RH adapter requires an internal bearer token when `RH_ADAPTER_SECRET` is set.
- [x] RH adapter rejects oversized request bodies.
- [x] RH adapter adds upstream submit/upload/query timeouts.
- [x] RH adapter classifies repeated query failures instead of returning endless pending forever.
- [x] `grok-video-3` maps to a supported RH route.
- [x] Deployment script and systemd docs include `RH_ADAPTER_SECRET` without printing real secrets.

## P1: Model Availability Truth Source

- [x] Add a typed client for `/api/creation/models`.
- [x] If backend availability is reachable, merge backend status into the local media catalog.
- [x] If backend is unavailable, keep the current static catalog behavior.
- [x] The frontend must not enable a model unless the local catalog allows it and backend status is not `disabled`.
- [x] Backend reasons are normalized for maintenance/degraded/disabled states.
- [x] `creation-models` service is deployed behind Nginx at `/api/creation/models`.

## Deployment Notes

### 2026-05-31

- `/opt/rh-adapter` runs as `rh-adapter.service`, listening on `172.17.0.1:8789`.
- NewAPI RH channels use `http://172.17.0.1:8789` plus an internal `RH_ADAPTER_SECRET`.
- `/opt/creation-models` runs as `creation-models.service`, listening on `127.0.0.1:8790`.
- Public availability endpoint: `https://api.jiucaihezi.studio/api/creation/models`.
- `creation-models` reads NewAPI channel status from PostgreSQL using `/opt/creation-models/.env`; no database password is stored in source code.

## P2: Media Orchestrator

The RH adapter becomes the first adapter inside a durable media orchestrator.

Minimum tables:

```text
media_providers
media_provider_keys
media_models
media_model_routes
media_tasks
media_model_health
media_errors
media_smoke_runs
```

Minimum adapter interface:

```text
submit(input) -> normalized task or sync result
poll(task) -> normalized status/result/error
cancel(task) -> best-effort cancellation
normalizeError(raw) -> stable error code
```

## P3: Provider Unification

Seedance, Suno, Grok, Veo, T8 image/video routes should use the same orchestrator contract.
Frontend should stop knowing provider-specific poll paths except NewAPI-compatible public endpoints.

## P4: Canvas Unification

Canvas media nodes should use the same task engine as the creation panel. Legacy `/api/proxy/*` and duplicate canvas media routes should be removed only after the unified task path is stable.

# KIK Seedance Adapter

Minimal async-video adapter for KIK Seedance 2.0. New API retains authentication, billing, and the KIK key; this service translates `/v1/videos` to KIK's official Volcengine-compatible task API:

```text
POST https://51kik.com/providers/volcengine/api/v3/contents/generations/tasks
GET  https://51kik.com/providers/volcengine/api/v3/contents/generations/tasks/:id
```

Text, image, video, and audio references are converted to the official `content[]` format. Audio requires an image or video reference.

## Test

```bash
../rh-adapter/.venv/bin/python -m unittest discover -s tests -v
```

## Deploy

```bash
docker compose up -d --build
```

Configure channel 111 as `OpenAI` with base URL `http://kik-seedance-adapter:8792`, keep its existing KIK key, and retain these models:

```text
doubao-seedance-2,doubao-seedance-2-0-fast-260128,doubao-seedance-2-mini
```

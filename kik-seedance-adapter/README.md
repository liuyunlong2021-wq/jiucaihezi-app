# KIK Seedance Adapter

Minimal async-video adapter for KIK Seedance 2.0. New API retains authentication, billing, and the KIK key; this service only translates `/v1/videos` to KIK's `/video/v1/generations` and task polling endpoint.

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

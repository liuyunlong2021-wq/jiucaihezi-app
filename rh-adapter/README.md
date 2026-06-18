# rh-adapter

RunningHub protocol adapter — translates OpenAI-compatible requests to RunningHub native API. Designed to sit behind New API as a custom channel.

Current production shape: Python FastAPI in Docker. New API handles user auth and billing; rh-adapter stays on the Docker/internal network and does not add a separate adapter secret.

## Quick Start

```bash
# 1. Set your RunningHub API key
cp .env.example .env
# Edit .env, fill in RUNNINGHUB_API_KEY

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
python -m uvicorn src.main:app --host 0.0.0.0 --port 8789 --reload
```

## Docker

```bash
docker compose up -d
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/v1/models` | List available models |
| POST | `/check` | Validate API key + check balance |
| POST | `/v1/images/generations` | Image generation |
| POST | `/v1/videos` | Video generation |
| POST | `/v1/audio/speech` | TTS generation |
| GET | `/tasks/{task_id}` | Stateless single poll; add `?ai_app=true` for AI App models |

## New API Integration

In New API admin panel:

1. **Channel → New → Custom Channel**
   - Proxy URL: `http://rh-adapter:8789`
   - Timeout: `30s`
   - Model list: `rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,z-image-turbo,rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design`
   - For custom AI Apps, append the custom model id you register in `RH_CUSTOM_AI_APPS`.

2. **Models → Pricing**
   - Set per-use price for each model

The adapter is stateless — New API handles all auth, user management, and billing.

Nginx should expose only the poll route outside New API:

```nginx
location /rh/tasks/ {
    proxy_pass http://172.17.0.1:8789/tasks/;
    proxy_read_timeout 30s;
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `RUNNINGHUB_API_KEY` | ✅ | - | Your RunningHub API key |
| `HOST` | ❌ | 0.0.0.0 | Server host |
| `PORT` | ❌ | 8789 | Server port |
| `LOG_LEVEL` | ❌ | info | debug/info/warn/error |
| `RH_CUSTOM_AI_APPS` | ❌ | - | JSON registry for custom RunningHub AI Apps |
| `MAX_POLL_SECONDS` | ❌ | 600 | Legacy internal poll helper timeout; current NewAPI flow uses async submit + single `/tasks/{id}` poll |
| `POLL_INTERVAL_IMAGE` | ❌ | 5 | Legacy internal poll helper interval |
| `POLL_INTERVAL_VIDEO` | ❌ | 10 | Legacy internal poll helper interval |

Custom AI App example:

```bash
RH_CUSTOM_AI_APPS='[
  {
    "id": "rh-custom-demo",
    "label": "自建视频Demo",
    "output_type": "video",
    "webapp_id": "123456789"
  }
]'
```

Rules:

- `output_type` must be `image`, `video`, or `audio`.
- `id` must not override a built-in model id.
- Add the same `id` to the NewAPI channel model list so NewAPI can bill it.
- Custom models always run through official AI App `apiCallDemo` node discovery and `/task/openapi/upload`.

## Supported Models

See `src/models/mapping.py` for the complete model registry.

| Category | Models |
|----------|--------|
| Image | rh-pro-image, rh-image-v2, rh-gpt2-image, rh-gpt2-text |
| Video | rh-video-v31-fast, rh-seedance2-text-video, rh-seedance2-image-video, rh-seedance2-multimodal-video, rh-grok-text-video, rh-grok-image-video, rh-aiapp-fast-digital-human, rh-aiapp-digital-human, rh-aiapp-director |
| Audio | rh-suno-v55-single, rh-suno-v55-custom, rh-suno-lyrics, rh-speech-hd, rh-speech-turbo, rh-music, rh-voice-clone, rh-aiapp-voice-clone, rh-aiapp-voice-design |

## Tests

```bash
pip install pytest pytest-asyncio httpx
python -m pytest tests/ -v
```

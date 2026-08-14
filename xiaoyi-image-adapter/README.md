# Xiaoyi Image Adapter

NewAPI remains the gateway for authentication, billing, task persistence, and the Xiaoyi key. This stateless adapter translates NewAPI's existing `/v1/videos` task contract to Xiaoyi's asynchronous image API.

## Test

```bash
../rh-adapter/.venv/bin/python -m unittest discover -s tests -v
```

## Deploy

```bash
docker compose up -d --build
```

Keep the existing quality channels separate. For each Xiaoyi image channel:

- use channel type `OpenAI`;
- change Base URL to `http://xiaoyi-image-adapter:8793`;
- keep exactly one Xiaoyi Key per channel, and do not rotate it while tasks are running;
- keep only that channel's explicit model aliases; do not combine all quality tiers into one channel;
- disable upstream model auto-sync/auto-add for these channels.

The adapter accepts both the six public aliases and NewAPI's mapped canonical `gpt-image-2`, so existing model mappings may remain. The public aliases are:

```text
gpt-image-2-1k,gpt-image-2-低质量,gpt-image-2-中质量,gpt-image-2-vip,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview
```

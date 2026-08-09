# Seed Audio Adapter

Minimal OpenAI speech adapter for Volcengine `seed-audio-1.0`. NewAPI keeps authentication, billing, and the upstream API key; this internal service only translates the request and response protocol.

```text
POST /v1/audio/speech {model,input,response_format}
  -> POST https://openspeech.bytedance.com/api/v3/tts/create {model,text_prompt,audio_config}
  -> decode Base64 audio
  -> audio/mpeg, audio/wav, audio/pcm, or audio/ogg
```

## Test

```bash
../rh-adapter/.venv/bin/python -m unittest discover -s tests -v
```

## Deploy

```bash
docker compose up -d --build
```

The service joins `new-api-new_new-api-network` and does not publish a host port. Configure a separate NewAPI OpenAI-compatible channel. Do not select `Custom Channel` in NewAPI `rc.20`: it treats the configured URL as the complete request URL and would send this request to `/`.

| Field | Value |
|---|---|
| Channel type | `OpenAI` |
| Base URL | `http://seed-audio-adapter:8791` |
| Key | Seed Audio API Key from the Volcengine speech console |
| Model | `seed-audio-1.0` |
| Request path | `/v1/audio/speech` |

NewAPI forwards the channel key as `Authorization: Bearer`; the adapter sends it upstream as `X-Api-Key`. Do not put `seed-audio-1.0` in the Ark channel because Ark and Seed Audio credentials and protocols are different.

The NewAPI channel test button may use a chat request and is not evidence for this audio-only channel. Verify it through the real endpoint:

```bash
read -rsp "NewAPI Token: " TOKEN; echo
curl -sS --max-time 180 \
  -o /tmp/seed-audio-newapi.mp3 \
  -w 'HTTP %{http_code} | %{content_type}\n' \
  https://api.jiucaihezi.studio/v1/audio/speech \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"seed-audio-1.0","input":"请自然地说：Seed Audio 渠道测试成功。","voice":"alloy","response_format":"mp3"}'
unset TOKEN
file /tmp/seed-audio-newapi.mp3
```

Supported now: text-only generation, `mp3`, `wav`, `pcm`, `opus`, and `ogg_opus`. Reference audio/images and OpenAI `voice`/`speed` mapping are intentionally deferred until a product workflow needs them.

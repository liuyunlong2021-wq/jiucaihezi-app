# ZX Grok Video Adapter

独立的 ZX Grok 固定时长视频协议适配器。它位于 NewAPI 和 `img-api.zxcode.vip` 之间，不修改 NewAPI 源码，也不复用只服务 RunningHub 的 `rh-adapter`。

## 支持模型

- `grok-1.5-video-6s`
- `grok-1.5-video-10s`
- `grok-1.5-video-15s`

无参考图时，适配器按 ZX 文生视频合同发送 JSON；有参考图时，将 `image`/`images`/`reference_images` 或直接 multipart 统一转换为 `input_reference` 文件。模型名决定时长，不发送 `seconds`。

## 本地验证

```bash
../rh-adapter/.venv/bin/python -m unittest discover -s tests -v
```

## 部署

服务加入现有 `new-api-new_new-api-network`，不公开端口。先在 NewAPI 复制 96 渠道做临时验证，把 Base URL 指向 `http://zx-video-adapter:8789`；验证提交、轮询、扣费和 `video_url` 后，再决定是否切换正式渠道。

```bash
docker compose up -d --build
```

适配器从 NewAPI 请求的 `Authorization: Bearer` 头取得本次渠道 Key 并转发；日志不记录 Key、完整图片 data URL 或完整提示词。

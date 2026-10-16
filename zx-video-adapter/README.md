# ZX Video Adapter

独立的 ZX 视频协议适配器。它位于 NewAPI 和 `img-api.zxcode.vip` 之间，不修改 NewAPI 源码，也不复用只服务 RunningHub 的 `rh-adapter`。

## 支持模型

- `grok-1.5-video-6s`
- `grok-1.5-video-10s`
- `grok-1.5-video-15s`
- `doubao-seedance-2-5-260628`
- `seedance-2.0-0826-480p`
- `seedance-2.0-0826-720p`
- `seedance-2.0-fast-0826-480p`
- `seedance-2.0-fast-0826-720p`
- `seedance-2.0-TS`
- `seedance-2.5`
- `seedance-2.5-30s`
- `omni-fast`
- `omni-v2v`

Grok 支持 0~7 张参考图：无图时发送 JSON，有图时将 `image`/`images`/`reference_images` 或直接 multipart 统一转换为重复的 `input_reference` 文件字段。模型名决定时长，不发送 `seconds`。

Omni 走 `/v1/videos` JSON 合同。NewAPI 插件与创作面板统一走 `/v1/videos`；适配器将 Seedance 转发到 ZX 的 `/v1/video/generations`，并将素材 URL 转为带 `role` 的 `metadata.content`。旧 `doubao-seedance-2-5-260628` 仍保留 `/v1/video/generations` 兼容入口。

NewAPI 渠道 `model_mapping`：

```json
{
  "seedance-2.0-0826-480p": "zx-seedance-2.0-0826-480p",
  "seedance-2.0-0826-720p": "zx-seedance-2.0-0826-720p",
  "seedance-2.0-fast-0826-480p": "zx-seedance-2.0-fast-0826-480p",
  "seedance-2.0-fast-0826-720p": "zx-seedance-2.0-fast-0826-720p",
  "seedance-2.0-TS": "zx-seedance-2.0-TS",
  "seedance-2.5": "zx-seedance-2.5",
  "seedance-2.5-30s": "zx-seedance-2.5-30s"
}
```

适配器接收 `zx-` 映射名后去掉命名空间，再将模型 ID 发给 ZX。

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

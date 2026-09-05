# 菠萝 MiniMax 参考生视频适配器

将 NewAPI 的 OpenAI-compatible `/v1/videos` 请求转发到 `aimanplay.cn` 的
`minimax_h3_image_audio_to_video_v2_15s`。

## 部署

```bash
cd /opt/boluo-minimax-adapter
docker compose up -d --build --force-recreate boluo-minimax-adapter
curl http://127.0.0.1:8794/health
```

将目录复制到服务器后，确保它加入与 NewAPI 相同的 Docker 网络。当前 compose 使用：
`new-api-new_new-api-network`。

## NewAPI 渠道

- 类型：OpenAI 兼容
- Base URL：`http://boluo-minimax-adapter:8794`
- 模型：`minimax_h3_image_audio_to_video_v2_15s`
- 对外售价：`0.08/秒`
- 上游密钥：菠萝平台 `sk-...` 令牌

NewAPI 负责鉴权和计费，适配器负责素材上传、字段转换、上游任务轮询和成片下载。

# NewAPI RH Channel 配置

> Step 3 部署配置。rh-adapter 使用 Python FastAPI + Docker，NewAPI 负责用户鉴权和按次计费；adapter 本身不再增加独立鉴权。

## NewAPI 后台

在 NewAPI 管理后台新增一个 Custom Channel：

配置清单：

- Proxy URL: `http://rh-adapter:8789`
- Timeout: `30s`
- Billing: 按次计费；每个模型单独设置价格

| 字段 | 值 |
|------|----|
| Type | Custom Channel |
| Proxy URL | `http://rh-adapter:8789` |
| Fallback Proxy URL | `http://172.17.0.1:8789` |
| Timeout | `30s` |
| Billing | 按次计费；每个模型单独设置价格 |

模型列表（22 个，逗号分隔）：

```text
rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design
```

按类型核对：

| 类型 | 模型 |
|------|------|
| Image | `rh-pro-image`, `rh-image-v2`, `rh-gpt2-image`, `rh-gpt2-text` |
| Video | `rh-video-v31-fast`, `rh-seedance2-text-video`, `rh-seedance2-image-video`, `rh-seedance2-multimodal-video`, `rh-grok-text-video`, `rh-grok-image-video`, `rh-aiapp-fast-digital-human`, `rh-aiapp-digital-human`, `rh-aiapp-director` |
| Audio | `rh-suno-v55-single`, `rh-suno-v55-custom`, `rh-suno-lyrics`, `rh-speech-hd`, `rh-speech-turbo`, `rh-music`, `rh-voice-clone`, `rh-aiapp-voice-clone`, `rh-aiapp-voice-design` |

自建 RH AI App：

- 在 `rh-adapter` 环境变量 `RH_CUSTOM_AI_APPS` 中登记模型。
- 在 NewAPI 渠道模型列表中追加同名模型 ID。
- 对同名模型单独配置价格，NewAPI 即可按该模型计费。

示例：

```bash
RH_CUSTOM_AI_APPS='[{"id":"rh-custom-demo","label":"自建视频Demo","output_type":"video","webapp_id":"123456789"}]'
```

NewAPI 渠道模型列表追加：

```text
...,rh-custom-demo
```

## Nginx Poll 代理

提交仍走 NewAPI `/v1/*`，轮询不走 NewAPI，避免重复计费：

```nginx
location /rh/tasks/ {
    proxy_pass http://172.17.0.1:8789/tasks/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
}
```

可用 `scripts/rh-deploy/install-nginx-rh-tasks.py` 在服务器上幂等安装该 location。安装后执行：

```bash
nginx -t
systemctl reload nginx
```

## 验证

1. rh-adapter Docker 容器启动，`GET /health` 返回 `models: 22`。
2. `GET /rh/tasks/test` 能到达 rh-adapter；测试 task 不存在时允许返回 404。
3. NewAPI 模型列表包含上面的 19 个 RH 模型。
4. 用创作面板提交 `rh-pro-image`，NewAPI 产生一次计费记录，随后前端通过 `/rh/tasks/{task_id}` 轮询到结果。

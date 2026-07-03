# SDD: RunningHub 适配器 (rh-adapter)

> **状态**: 已部署 P0
> **目标**: 替代 8788 网关，使所有 RunningHub 模型通过 NewAPI 计费通道可用
> **对标**: Seedance 架构 (`sd2.mengfactory.cn` Nginx 直连代理)

---

## 1. 问题陈述

### 当前状态
- 前端注册 20 个模型，后端仅 10 个渠道
- 8788 网关尝试把 RH 原生 API → OpenAI 格式翻译，但 RH 是异步状态机（QUEUED/RUNNING/SUCCESS），OpenAI 图片 API 是同步的，根本对不上
- RH 图片/视频/声音模型全部不可用

### 目标
- 所有 RH 模型走 NewAPI 自定义 Channel → 统一鉴权+计费
- 前端无需改动业务逻辑（继续调 `api.jiucaihezi.studio`）
- 适配器无状态、可水平扩展

---

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────┐
│  前端 (jiucaihezi-app)                                    │
│    generateImage({model:"rh-pro-image", prompt, ...})     │
│    generateVideo({model:"rh-seedance2", prompt, ...})     │
│    generateAudio({model:"rh-voice-clone", text, ...})     │
└──────────────────────┬──────────────────────────────────┘
                       ↓ POST /v1/images/generations 等
┌─────────────────────────────────────────────────────────┐
│  Nginx (api.jiucaihezi.studio:443)                       │
│    /v1/*  → NewAPI :3000                                 │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  NewAPI (:3000)                                          │
│    Channel ID: ? (type=custom, 指向 http://rh-adapter:8789)│
│    计费: group=1, model_ratio 按模型配置                   │
└──────────────────────┬──────────────────────────────────┘
                       ↓ POST /v1/images/generations
┌─────────────────────────────────────────────────────────┐
│  rh-adapter (Node.js, 172.17.0.1:8789, systemd)            │
│    ┌─────────────────────────────────────────────────┐   │
│    │ POST /v1/images/generations                      │   │
│    │   → 上传图片 → RH /openapi/v2/media/upload/binary│   │
│    │   → 提交任务 → RH /openapi/v2/{workflow}/...     │   │
│    │   → 返回 { id: taskId, status: "pending" }       │   │
│    │                                                   │   │
│    │ GET /v1/images/generations/:id                    │   │
│    │   → 查询 RH /openapi/v2/query                     │   │
│    │   → 翻译结果 → OpenAI 格式                         │   │
│    └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  RunningHub API (www.runninghub.cn)                      │
│    /openapi/v2/{workflow}/text-to-image                   │
│    /openapi/v2/{workflow}/image-to-image                  │
│    /openapi/v2/{workflow}/text-to-video                   │
│    /openapi/v2/{workflow}/image-to-video                  │
│    /openapi/v2/query                                      │
│    /openapi/v2/media/upload/binary                        │
│    /openapi/v2/workflow/run  (数字人/声音克隆)             │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 适配器 API 协议

### 3.1 图片生成 (image)

**NewAPI 期望格式** (与 OpenAI `/v1/images/generations` 兼容):

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer sk-xxx

{
  "model": "rh-pro-image",
  "prompt": "一只猫",
  "aspect_ratio": "16:9",
  "resolution": "1k",
  "image": "data:image/png;base64,..."   // 可选，base64 data URI
  // 或
  "images": ["data:...", "data:..."]     // 多图
}
```

**提交响应** (NewAPI 异步模式):

```json
{
  "id": "rh_abc123",
  "status": "pending"
}
```

**轮询响应** (NewAPI 自动调用 `GET /v1/images/generations/rh_abc123`):

```json
// 进行中:
{ "id": "rh_abc123", "status": "pending" }

// 完成:
{
  "id": "rh_abc123",
  "status": "completed",
  "data": [{ "url": "https://rh-images-.../output.png" }]
}

// 失败:
{
  "id": "rh_abc123",
  "status": "failed",
  "error": { "message": "提示词包含敏感词" }
}
```

### 3.2 视频生成 (video)

**提交**:
```http
POST /v1/videos
{
  "model": "rh-seedance2",
  "prompt": "...",
  "ratio": "16:9",
  "resolution": "1080p",
  "duration": 5,
  "images": ["data:..."]     // 可选参考图
}
```

**轮询**: `GET /v1/videos/:id`

### 3.3 音频生成 (audio)

**提交**:
```http
POST /v1/audio/generations
{
  "model": "rh-voice-clone",
  "text": "输出文字",
  "ref_text": "参考音频文字",
  "audio": "data:audio/mp3;base64,...",
  "language": "中文"
}
```

**轮询**: `GET /v1/audio/generations/:id`

---

## 4. 模型 → RH Endpoint 映射表

| 模型 ID (前端) | 任务 | RH Endpoint | 参数 |
|---------------|------|-------------|------|
| `rh-pro-image` | image | `/openapi/v2/rhart-image-n-pro/text-to-image` | prompt, aspectRatio, resolution |
| `rh-gpt2-image` | image | `/openapi/v2/rhart-image-g-2/image-to-image` | prompt, aspectRatio, resolution, imageUrls |
| `rh-gpt2-text` | image | `/openapi/v2/rhart-image-g-2/text-to-image` | prompt, aspectRatio, resolution |
| `rh-seedance2` | video | `/openapi/v2/rhart-video-sd2/text-to-video` | prompt, ratio, resolution, duration, images |
| `rh-video-v31-fast` | video | `/openapi/v2/rhart-video-v3.1-fast/text-to-video` | prompt, ratio, resolution, duration, images |
| `rh-grok-text-video` | video | `/openapi/v2/rhart-video-g/text-to-video` | prompt, ratio, resolution, duration |
| `rh-grok-image-video` | video | `/openapi/v2/rhart-video-g/image-to-video` | prompt, ratio, resolution, duration, imageUrls |
| `rh-grok-video-edit` | video | `/openapi/v2/rhart-video-g-official/edit-video` | prompt, resolution, video |
| `rh-mimic` | video | `/openapi/v2/workflow/run` (nodeInfoList) | image, video, text, width, height |
| `rh-digital-human-fast` | video | `/openapi/v2/workflow/run` (nodeInfoList) | image, audio, value |
| `rh-digital-human` | video | `/openapi/v2/workflow/run` (nodeInfoList) | prompt, text, image, audio, width, height |
| `rh-voice-clone` | audio | `/openapi/v2/workflow/run` (nodeInfoList) | audio, text, ref_text, language |
| `rh-voice-design` | audio | `/openapi/v2/workflow/run` (nodeInfoList) | text, voice_prompt, language |

> **注意**: `rh-mimic`、`rh-digital-human-*`、`rh-voice-*` 使用 `/openapi/v2/workflow/run` + `nodeInfoList` 格式，而非标准 text-to-image 格式。这些传给适配器的 body 中需要包含 `nodeInfoList` 字段。

---

## 5. 适配器实现要点

### 5.1 核心流程

```
收到请求
  ├─ 解析 model → 查映射表 → 确定 RH endpoint
  ├─ 如果 body 含 base64 data URI:
  │   └─ POST /openapi/v2/media/upload/binary → 替换为 RH URL
  ├─ 构建 RH 原生请求体 (映射字段名)
  ├─ POST {RH endpoint} → 获取 {taskId, status}
  ├─ 存储 taskId → 内存 Map (taskId → {model, createdAt})
  └─ 返回 { id: taskId, status: "pending" }

轮询请求 (GET /v1/images/generations/:id)
  ├─ POST /openapi/v2/query {taskId}
  ├─ status === "SUCCESS" → 提取 results[0].url → 返回 completed
  ├─ status === "FAILED" → 返回 failed
  └─ 其他 → 返回 pending
```

### 5.2 图片上传

RH 的 `imageUrls` 参数支持:
- 公开 URL: 直接传
- Base64 data URI: 需先上传到 RH

适配器逻辑:
```js
async function resolveImageUrls(images) {
  const urls = []
  for (const img of images) {
    if (img.startsWith('data:')) {
      const blob = dataUriToBlob(img)
      const uploaded = await uploadToRH(blob)
      urls.push(uploaded.download_url)
    } else if (img.startsWith('http')) {
      urls.push(img)
    }
  }
  return urls
}
```

### 5.3 超时与清理

- 任务最长保留 30 分钟
- 每 60 秒清理过期任务
- 超时未完成 → 返回 failed

### 5.4 鉴权

- NewAPI 负责用户 Token 鉴权和计费。
- rh-adapter 仍需要内部通道鉴权：`RH_ADAPTER_SECRET` 必须与 NewAPI Channel `key` 一致。
- rh-adapter 默认仅监听 `127.0.0.1:8789`。如果 NewAPI 在 Docker 容器里访问宿主机，生产环境应监听 docker0 地址（通常 `172.17.0.1:8789`），不要监听 `0.0.0.0` 或开放公网访问。
- RH API Key 通过环境变量 `RUNNINGHUB_API_KEY` 配置。

---

## 6. 部署配置

### 6.1 systemd service

```
[Unit]
Description=RunningHub Adapter for NewAPI
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rh-adapter
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
EnvironmentFile=/opt/rh-adapter/.env
Environment=NODE_ENV=production
Environment=RH_ADAPTER_HOST=127.0.0.1
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 6.2 NewAPI Channel 配置

```sql
-- 图片 Channel
INSERT INTO channels (type, name, models, base_url, `key`, `group`, status)
VALUES (1, 'RH-图片', 'rh-pro-image,rh-gpt2-image,rh-gpt2-text',
        'http://127.0.0.1:8789', '<RH_ADAPTER_SECRET>', '1', 1);

-- 视频 Channel
INSERT INTO channels (type, name, models, base_url, `key`, `group`, status)
VALUES (1, 'RH-视频', 'rh-seedance2,rh-video-v31-fast,rh-grok-text-video,rh-grok-image-video,rh-grok-video-edit,rh-mimic,rh-digital-human-fast,rh-digital-human',
        'http://127.0.0.1:8789', '<RH_ADAPTER_SECRET>', '1', 1);

-- 音频 Channel
INSERT INTO channels (type, name, models, base_url, `key`, `group`, status)
VALUES (1, 'RH-音频', 'rh-voice-clone,rh-voice-design',
        'http://127.0.0.1:8789', '<RH_ADAPTER_SECRET>', '1', 1);
```

### 6.3 ModelRatio 配置 (计费)

```sql
-- 在 option 表中设置 ModelRatio
-- RH 图片模型: 按 RH 实际消耗定价
-- RH 视频模型: 按 RH 实际消耗定价
```

---

## 7. 前端改动

`media-generation.ts` 中所有 RH 模型统一走 `/v1/images/generations`（图片）或 `/v1/videos`（视频）：

```ts
// generateImage: 所有 RH 图片模型用统一路径
const isRhImage = capability?.task === 'image' && capability.webappId
if (isRhImage) {
  const body = { model, prompt, aspect_ratio: aspectRatio, resolution, images }
  const data = await apiCall('/v1/images/generations', body, 'POST', model)
  // NewAPI + 适配器处理异步轮询
}
```

---

## 8. 测试计划

- [ ] rh-pro-image 文生图
- [ ] rh-gpt2-image 图生图 (含 base64 上传)
- [ ] rh-grok-image-video 图生视频
- [ ] rh-digital-human-fast 数字人
- [ ] rh-voice-clone 声音克隆
- [ ] 超时清理
- [ ] 错误处理 (RH 返回 FAILED)

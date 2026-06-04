# SDD: RH-Adapter — RunningHub 协议适配层

> **状态**: 设计阶段，不涉及代码  
> **版本**: v0.1  
> **日期**: 2026-06-02

---

## 1. 概述

### 1.1 定位

rh-adapter 是一个**协议翻译层**，位于 New API 和 RunningHub API 之间。它将 OpenAI 兼容格式的请求翻译为 RunningHub 原生 API 调用，并负责异步任务轮询和结果回传。

### 1.2 为什么需要

| 问题 | rh-adapter 解决 |
|------|----------------|
| RunningHub API 不是 OpenAI 格式 | 翻译为标准 OpenAI 格式 |
| RunningHub 是异步任务（提交→轮询→下载） | 适配器内部处理轮询，对外表现为同步 |
| 前端不想关心上游细节 | 跟调 GPT Image 一样的体验 |
| New API 按次定价 | New API 按模型定价扣费，适配器只负责执行 |

### 1.3 与现有系统的关系

```
┌──────────────────────────────────────────────────────────┐
│                      现有系统（不动）                       │
│                                                            │
│  前端(Vue) ──→ Worker(CF) ──→ New API ──→ LLM/GPT Image   │
│                                                            │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                      新增（rh-adapter）                    │
│                                                            │
│  New API ──→ rh-adapter ──→ RunningHub API                │
│              (本 SDD)        (356+ 端点)                    │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

**关键约束**：
- ✅ 不修改 New API 源码
- ✅ 不修改前端代码（前端已有 rh-pro-image、rh-seedance2 等模型定义）
- ✅ 不修改 Gateway Worker
- 🔧 只在 New API 后台新增「自定义渠道」

---

## 2. 架构设计

### 2.1 完整链路

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────┐
│  前端     │────→│  New API │────→│rh-adapter│────→│ RunningHub   │
│  Vue 3   │     │          │     │ :8789    │     │ API          │
└──────────┘     └────┬─────┘     └──────────┘     └──────────────┘
                      │
                      │ 内置
                      ▼
               ┌──────────┐
               │ 定价/扣费 │
               │ 用户管理  │
               │ 额度系统  │
               └──────────┘
```

### 2.2 技术栈

| 选型 | 理由 |
|------|------|
| **Python 3** | 可复用 `OpenClaw_RH_Skills` 中 runninghub.py 的核心逻辑 |
| **FastAPI** | 轻量、异步、自动生成 OpenAPI 文档 |
| **httpx** | 异步 HTTP 客户端，替代 curl |
| **Docker** | 标准部署，与 New API 同一 docker-compose 编排 |
| **stdlib 优先** | 参考 runninghub.py 的无外部依赖理念，减少维护负担 |

### 2.3 部署拓扑

```
                    docker-compose
                    ┌─────────────────────────────────┐
                    │                                 │
                    │  new-api (cautionion/new-api)   │
                    │  :3000                          │
                    │       │                         │
                    │       │ 转发 RH 请求到            │
                    │       ▼                         │
                    │  rh-adapter (自建)               │
                    │  :8789                          │
                    │       │                         │
                    │       │ HTTPS                   │
                    │       ▼                         │
                    │  www.runninghub.cn              │
                    │                                 │
                    └─────────────────────────────────┘
```

---

## 3. API 设计

### 3.1 对外接口（New API 调用）

所有接口遵循 OpenAI 兼容格式，New API 作为渠道转发请求。

#### 3.1.1 图片生成

```
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer <RH_API_KEY>

{
  "model": "rh-pro-image",           // NewAPI 模型名 → 内部映射 RH 端点
  "prompt": "一只在公园里玩耍的小狗",
  "aspect_ratio": "16:9",            // 可选
  "resolution": "2k",                // 可选: 1k/2k/4k
  "images": ["data:image/png;base64,..."]  // 可选: 图生图
}
```

**返回**：
```json
{
  "data": [
    {
      "url": "https://.../result.png",
      "task_id": "abc123"
    }
  ],
  "usage": {
    "total_tokens": 1,
    "cost": 0.50
  }
}
```

#### 3.1.2 视频生成

```
POST /v1/videos
Content-Type: application/json
Authorization: Bearer <RH_API_KEY>

{
  "model": "rh-video-v31-fast",
  "prompt": "一只小狗在公园奔跑",
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 5,
  "images": ["data:..."],            // 可选: 图生视频
  "video": "data:...",               // 可选: 视频编辑
  "audio": "data:..."                // 可选: 口型同步
}
```

**返回**（同步风格，内部已完成轮询）：
```json
{
  "id": "rh_video_abc123",
  "status": "completed",
  "output": {
    "url": "https://.../result.mp4"
  },
  "usage": {
    "cost": 3.00,
    "duration_seconds": 5,
    "task_time_seconds": 85
  }
}
```

> **设计决定**：视频轮询在适配器内部完成（1-5分钟），对外表现为同步返回。超时时间 600 秒。  
> 但需要考虑：New API 作为中间层也会等待这个时间。如果 New API 有超时限制，改用异步模式（见 4.3 节）。

#### 3.1.3 音频/TTS 生成

```
POST /v1/audio/speech
Content-Type: application/json

{
  "model": "rh-speech-hd",
  "prompt": "你好，欢迎使用韭菜盒子",
  "language": "zh"
}
```

#### 3.1.4 3D 模型生成

```
POST /v1/models/generations
Content-Type: application/json

{
  "model": "rh-3d-hunyuan",
  "prompt": "一个红色的陶瓷茶杯",
  "images": ["data:..."]             // 可选: 图生3D
}
```

#### 3.1.5 AI 应用（ComfyUI 工作流）

```
POST /v1/workflows/run
Content-Type: application/json

{
  "model": "rh-app-1877265245566922800",
  "nodeInfoList": [
    {"nodeId": "39", "fieldName": "image", "fieldValue": "..."},
    {"nodeId": "52", "fieldName": "text",  "fieldValue": "把头发变成短发"}
  ]
}
```

### 3.2 管理接口

```
GET /health        → { status: "ok", uptime: 3600 }
GET /v1/models     → 返回可用模型列表（供 New API 自动发现）
POST /check        → 验证 API Key + 查询余额
```

---

## 4. 数据流设计

### 4.1 图片生成流程（快速，5-30秒）

```
New API                              rh-adapter                    RunningHub
  │                                      │                             │
  │  POST /v1/images/generations         │                             │
  │  {model, prompt, images}             │                             │
  │ ────────────────────────────────────→│                             │
  │                                      │                             │
  │                                      │  ① 模型路由                  │
  │                                      │  rh-pro-image                │
  │                                      │  → rhart-image-n-pro         │
  │                                      │  /text-to-image              │
  │                                      │                             │
  │                                      │  ② POST /openapi/v2/...     │
  │                                      │ ────────────────────────────→│
  │                                      │                             │
  │                                      │  ③ 轮询任务 (每5秒)          │
  │                                      │  GET /openapi/v2/query      │
  │                                      │ ────────────────────────────→│
  │                                      │ ← status: completed          │
  │                                      │                             │
  │                                      │  ④ 下载结果                  │
  │                                      │  GET result_url             │
  │                                      │ ────────────────────────────→│
  │                                      │ ← 图片二进制                 │
  │                                      │                             │
  │  ← {data: [{url: "..."}]}           │                             │
  │                                      │                             │
```

### 4.2 视频生成流程（慢，1-8分钟）

流程与图片相同，区别：
- 轮询间隔：10 秒
- 最大轮询时间：600 秒（10 分钟）
- 超时后返回 `status: "timeout"` + `task_id` 供后续查询
- 结果文件可能是 MP4，需要处理 mov→mp4 转换

### 4.3 异步模式（备选）

如果 New API 等待视频生成会超时，改用异步模式：

```
New API                              rh-adapter
  │                                      │
  │  POST /v1/videos                     │
  │ ────────────────────────────────────→│
  │                                      │  提交任务 → 拿到 rh_task_id
  │  ← {id: "abc", status: "pending"}   │
  │                                      │
  │  GET /v1/videos/abc                  │  (前端轮询，适配器代理查询)
  │ ────────────────────────────────────→│
  │  ← {id: "abc", status: "running"}   │
  │                                      │
  │  GET /v1/videos/abc                  │
  │ ────────────────────────────────────→│
  │  ← {id: "abc", status: "completed",  │
  │      output: {url: "..."}}           │
  │                                      │
```

**选择标准**：
- 图片/TTS：同步模式（快，稳定在 30 秒内）
- 视频/3D/音乐：看 New API 超时配置决定同步/异步

---

## 5. 模型映射表

### 5.1 图片模型

| NewAPI 模型名 | 前端 label | RunningHub 端点 | 类型 |
|:---|:---|:---|:---|
| `rh-pro-image` | 全能图片PRO | `rhart-image-n-pro/text-to-image` | 文生图 |
| `rh-pro-image` | 全能图片PRO | `rhart-image-n-pro/image-to-image` | 图生图 |
| `rh-gpt2-image` | GPT2.0 | `webapp:2046514150500524033` | AI应用 |
| `rh-image-v2` | 全能图片V2 | `rhart-image-n-v2/text-to-image` | 文生图 |

### 5.2 视频模型

| NewAPI 模型名 | 前端 label | RunningHub 端点 | 类型 |
|:---|:---|:---|:---|
| `rh-video-v31-fast` | 全能视频V3.1-Fast | `rhart-video-v3.1-fast/text-to-video` | 文生视频 |
| `rh-video-v31-fast` | 全能视频V3.1-Fast | `rhart-video-v3.1-fast/image-to-video` | 图生视频 |
| `rh-kling-v30-pro` | Kling v3.0 Pro | `kling-video-o3-pro/text-to-video` | 文生视频 |
| `rh-veo-31-fast` | Veo 3.1 Fast | `veo-3-1-generate-preview/text-to-video` | 文生视频 |
| `rh-seedance2` | Seedance 2.0 | `webapp:2034917373414539273` | AI应用 |
| `grok-video-3` | Grok Video 3 | `rhart-video-g/text-or-image-to-video` | 文/图生视频 |

### 5.3 音频模型

| NewAPI 模型名 | 前端 label | RunningHub 端点 |
|:---|:---|:---|
| `rh-speech-hd` | 语音合成HD | `rhart-audio/text-to-audio/speech-2.8-hd` |
| `rh-speech-turbo` | 语音合成快速 | `rhart-audio/text-to-audio/speech-2.8-turbo` |
| `rh-music` | 音乐生成 | `rhart-audio/text-to-audio/music-2.5` |
| `rh-voice-clone` | 声音克隆 | `rhart-audio/text-to-audio/voice-clone` |

### 5.4 3D 模型

| NewAPI 模型名 | 前端 label | RunningHub 端点 |
|:---|:---|:---|
| `rh-3d-text` | 文生3D | `hunyuan3d-v3.1/text-to-3d` |
| `rh-3d-image` | 图生3D | `hunyuan3d-v3.1/image-to-3d` |

---

## 6. 定价模型

### 6.1 设计原则

定价在 **New API 后台** 配置，rh-adapter 不感知价格。New API 设置 `模型价格: ¥X.XX/次`，请求进来时自动检查余额 + 扣费，扣费成功后才转发给 rh-adapter。

### 6.2 建议价格表

| 模型 | 建议价格 | 说明 |
|:---|:---|:---|
| rh-pro-image | ¥0.50/次 | 文生图/图生图 |
| rh-gpt2-image | ¥0.60/次 | AI 应用模式 |
| rh-video-v31-fast (5s) | ¥1.50/次 | |
| rh-video-v31-fast (10s) | ¥3.00/次 | |
| rh-seedance2 (5s) | ¥8.00/次 | 贵模型 |
| rh-seedance2 (15s) | ¥22.00/次 | |
| rh-kling-v30-pro (5s) | ¥3.00/次 | |
| rh-speech-hd | ¥0.10/次 | |
| rh-music | ¥0.80/次 | |
| rh-3d-text | ¥2.00/次 | |

> **注意**：New API 按次定价无法区分同一个模型的「不同时长」。如果 `rh-video-v31-fast` 5秒和10秒价格不同，需要在 New API 注册为两个独立模型（如 `rh-video-v31-fast-5s` 和 `rh-video-v31-fast-10s`），或者所有时长统一定价。

### 6.3 可选方案：按时长分级

如果不希望注册太多模型，可以采用「统一价 + 超额补扣」：

1. New API 定价：`rh-video-v31-fast = ¥3.00/次`（按最大时长 10s 定价）
2. rh-adapter 返回实价：`{"cost": 1.50, "duration": 5}`
3. 前端展示 "实际消费 ¥1.50"
4. 不补退差价（Keep it simple）

---

## 7. 模块划分

```
rh-adapter/
│
├── main.py                  # FastAPI 入口 + 路由注册
├── config.py                # 配置：RH_API_KEY, 超时, 日志级别
│
├── models/
│   ├── __init__.py
│   ├── mapping.py           # 模型映射表 (NewAPI名 → RH端点)
│   └── schemas.py           # Pydantic 请求/响应模型
│
├── services/
│   ├── __init__.py
│   ├── runninghub_client.py # RunningHub API 客户端 (核心)
│   │   ├── submit_task()    #   提交任务
│   │   ├── poll_task()      #   轮询任务
│   │   ├── upload_file()    #   上传文件
│   │   └── download_result()#   下载结果
│   ├── image_service.py     # 图片生成逻辑
│   ├── video_service.py     # 视频生成逻辑
│   ├── audio_service.py     # 音频/TTS 生成逻辑
│   ├── model_service.py     # 3D 生成逻辑
│   └── app_service.py       # AI 应用 (ComfyUI) 工作流
│
├── middleware/
│   ├── __init__.py
│   └── error_handler.py     # 统一错误处理 + 日志
│
├── Dockerfile
├── requirements.txt
└── README.md
```

### 7.1 核心逻辑复用

`runninghub_client.py` 的设计直接参考 `OpenClaw_RH_Skills/runninghub/scripts/runninghub.py`：

| runninghub.py (参考) | runninghub_client.py (新) |
|:---|:---|
| `resolve_api_key()` | `config.RH_API_KEY` |
| `curl_post_json()` | `httpx.AsyncClient.post()` |
| `poll_task()` | `poll_task()` — 逻辑相同，httpx 实现 |
| `build_payload()` | `build_payload()` — 逻辑相同 |
| `download_file()` | `download_file()` — 逻辑相同 |
| `fix_mov_to_mp4()` | `fix_mov_to_mp4()` — 逻辑相同 |
| `find_endpoint()` | 用 `mapping.py` 映射表替代 |
| `cmd_execute()` | 拆分为 `image_service/video_service/...` |

---

## 8. 错误处理

### 8.1 错误分类

| 错误类型 | HTTP 状态码 | 处理方式 |
|:---|:---|:---|
| API Key 无效 | 401 | 返回错误，不重试 |
| 余额不足（RunningHub 侧） | 402 | 返回错误，通知管理员充值上游 |
| 参数校验失败 | 400 | 返回具体字段错误 |
| 任务执行失败 | 500 | 返回 RunningHub 原始错误信息 |
| 轮询超时 | 504 | 返回 task_id 供后续查询 |
| 文件下载失败 | 500 | 重试 3 次后报错 |

### 8.2 New API 侧的容错

- New API 设置了失败重试：rh-adapter 返回 5xx 时 New API 自动重试
- rh-adapter 返回 4xx 时不重试
- 如果用户在 rh-adapter 执行期间余额被扣但任务失败了 → **New API 不会自动退款**。需要人工处理或在 rh-adapter 返回特定错误码时触发退款（高级功能，暂不实现）

---

## 9. 部署方案

### 9.1 Docker Compose（推荐）

```yaml
# 在现有 new-api 的 docker-compose.yml 中追加：
services:
  rh-adapter:
    build: ./rh-adapter
    ports:
      - "8789:8789"
    environment:
      - RUNNINGHUB_API_KEY=${RUNNINGHUB_API_KEY}
      - LOG_LEVEL=info
      - MAX_POLL_SECONDS=600
    restart: always
    networks:
      - newapi-network
```

### 9.2 New API 渠道配置

在 New API 后台：
1. **渠道管理 → 新建渠道**
   - 类型：自定义渠道
   - 代理：`http://rh-adapter:8789`
   - 模型列表：填入所有 RH 模型名（`rh-pro-image`, `rh-video-v31-fast`, ...）
2. **模型价格 → 添加模型**
   - 为每个模型设置 `¥X.XX/次`

---

## 10. 待定问题

| # | 问题 | 选项 | 建议 |
|:---|:---|:---|:---|
| 1 | 视频用同步还是异步？ | A) 同步等待 | 先试 A，如果 New API 超时就改 B |
| | | B) 异步 taskId 轮询 | |
| 2 | 同一模型不同时长怎么定价？ | A) 注册多个模型 | A 最简单 |
| | | B) 统一定价 | |
| 3 | 前端现有模型定义要不要改？ | A) 不动 | A，rh-adapter 适配现有 model name |
| | | B) 重新定义 | |
| 4 | Gateway Worker 要不要介入？ | A) 前端直连 NewAPI | A，减少链路 |
| | | B) 走 Worker 转发 | |
| 5 | 需不需要退款机制？ | A) 不做 | A（先不做），后续再加 |
| | | B) 任务失败自动退 | |

---

## 11. 非目标（v0.1 不做）

- ❌ 不支持实时流式返回（视频/3D 不需要）
- ❌ 不做失败自动退款
- ❌ 不做用量统计 Dashboard（New API 已有）
- ❌ 不做前端改动（现有 CreationPanel 够用）
- ❌ 不做 API Key 多租户（一个 rh-adapter 实例对应一个上游 RH Key）

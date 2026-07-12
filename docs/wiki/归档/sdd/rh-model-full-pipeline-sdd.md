# SDD: RH 模型创作面板全链路打通

> 日期: 2026-06-03
> 状态: Step 2 前端已完成；Step 3 部署配置产物已准备，线上待执行
> 范围: Phase 1 — 创作面板。画布收敛另做独立 SDD。
> 核心诉求: 用户在创作面板使用 RunningHub 渠道的模型能力，统一在 NewAPI 里收费。

---

## 一、目标架构

**异步 submit + poll 模型。**

```
提交（走 NewAPI，计费）：
  创作面板 → media-generation.ts
    → POST api.jiucaihezi.studio/v1/{images/generations | videos | audio/speech}
    → NewAPI 匹配渠道，按次扣费
    → 转发到 http://rh-adapter:8789/v1/*
    → rh-adapter 提交给 RH → 拿到 taskId
    → 立刻返回 { task_id, status: "processing" }（<2 秒）

轮询（不走 NewAPI，不重复计费）：
  media-generation.ts pollTask()
    → GET api.jiucaihezi.studio/rh/tasks/{task_id}
    → Nginx 直接转发到 rh-adapter
    → rh-adapter 调 RH /openapi/v2/query 查一次
    → 返回 { task_id, status, url?, error? }

完成：
  status === "SUCCESS" → 前端拿到 url，显示结果
  status === "FAILED"  → 前端显示错误
  其他                  → 继续轮询（每 5s 图片 / 10s 视频）
```

### 为什么选异步

| 维度 | 同步（一个长连接等结果） | 异步（提交+轮询） |
|------|----------------------|-----------------|
| 稳定性 | 10 分钟长连接，网络一抖就断 | 每次轮询独立，断了重连就行 |
| 并发 | N 个任务 = N 个长连接挂着，容易撑爆 NewAPI 并发上限 | N 个提交 <2s 完成，轮询是轻量 GET |
| 断线恢复 | 连接断了任务丢失 | task_id 存 mediaTaskStore，重启 APP 恢复轮询 |
| 进度反馈 | 零反馈，只有转圈 | 每轮 poll 返回 RH 状态（QUEUED→RUNNING→SUCCESS） |
| 超时配置 | NewAPI/Nginx/前端全得设 1200s+ | 只需要 Nginx poll 超时 30s |
| NewAPI 计费 | 一次请求 = 一次扣费（简单） | POST 提交时扣费，GET 轮询免费（同样简单） |

### Nginx 配置（唯一的部署改动）

```nginx
# 轮询端点：Nginx 直接转发到 rh-adapter，不经过 NewAPI
location /rh/tasks/ {
    proxy_pass http://172.17.0.1:8789/tasks/;
    proxy_read_timeout 30s;
}
```

### rh-adapter 无状态设计

rh-adapter 不缓存任务状态。每次 GET `/tasks/{task_id}` 都实时调 RH 的 `/openapi/v2/query`。
这意味着：
- rh-adapter 重启不丢任务（状态在 RH 侧）
- 不需要内存任务表、Redis、数据库
- 水平扩展无障碍（多实例无共享状态）

---

## 二、模型审计

### 2.1 前端 ↔ rh-adapter 交叉对照

**前端有、adapter 没有（需要加到 adapter）：**

| 前端 ID | 前端默认启用? | RH 端点 | 动作 |
|---------|-------------|---------|------|
| `rh-gpt2-text` | ✅ 是 | `rhart-image-g-2/text-to-image` | adapter 加映射 |
| `rh-grok-text-video` | ✅ 是 | `rhart-video-g/text-to-video` | adapter 加映射 |
| `rh-grok-image-video` | ✅ 是 | `rhart-video-g/image-to-video` | adapter 加映射 |

> 这 3 个模型已经在前端默认启用、用户能看到，但 rh-adapter 不认识它们 — 用户选了会报错。必须修。

**adapter 有、前端没有（需要加到前端）：**

| adapter 模型 | 类型 | 动作 |
|-------------|------|------|
| `rh-image-v2` | 图片 | 加到 mediaModelCapabilities.ts |
| `rh-kling-v30-pro` | 视频 | 加到 mediaModelCapabilities.ts |
| `rh-veo-31-fast` | 视频 | 加到 mediaModelCapabilities.ts |
| `rh-veo-31-pro` | 视频 | 加到 mediaModelCapabilities.ts |
| `rh-speech-hd` | TTS | 加到 mediaModelCapabilities.ts |
| `rh-speech-turbo` | TTS | 加到 mediaModelCapabilities.ts |
| `rh-music` | 音乐 | 加到 mediaModelCapabilities.ts |

**两边都有、状态需调整：**

| 模型 | 当前状态 | 动作 |
|------|---------|------|
| `rh-pro-image` | ✅ 前端默认启用，adapter 有 | 不动 |
| `rh-gpt2-image` | ✅ 前端默认启用，adapter 有 | 不动 |
| `grok-video-3` | ✅ 前端默认启用，adapter 有 | 不动 |
| `rh-seedance2` | ❌ 前端 `enabled:false`，adapter 有 | 前端改为 `enabled:true` |
| `rh-video-v31-fast` | ❌ 前端 `enabled:false`，adapter 有 | 前端改为 `enabled:true` |
| `rh-voice-clone` | ❌ 前端 `enabled:false`，adapter 有 | 前端改为 `enabled:true`，adapter 加参数 |

**adapter 有但要删：**

| 模型 | 原因 |
|------|------|
| `rh-3d-text` | 无 UI 入口、无路由 |
| `rh-3d-image` | 无 UI 入口、无路由 |

**前端有但保持禁用（Phase 1 不做）：**

| 模型 | 原因 |
|------|------|
| `rh-grok-video-edit` | 视频编辑 UI 未就绪 |
| `rh-mimic` | 数字人 UI 未就绪 |
| `rh-digital-human-fast` | 数字人 UI 未就绪 |
| `rh-digital-human` | 数字人 UI 未就绪 |
| `rh-voice-design` | adapter 未注册 |

### 2.2 Phase 1 完成后的模型全景

adapter 总模型数: 3 (原有) + 3 (新增) + 6 (视频) + 4 (音频) - 2 (删3D) = **16 个**

| 类型 | 模型 | 前端启用 |
|------|------|---------|
| 图片 | rh-pro-image, rh-gpt2-image, rh-gpt2-text, rh-image-v2 | ✅ 全部 |
| 视频 | rh-video-v31-fast, rh-kling-v30-pro, rh-veo-31-fast, rh-veo-31-pro, rh-seedance2, grok-video-3, rh-grok-text-video, rh-grok-image-video | ✅ 全部 |
| 音频 | rh-speech-hd, rh-speech-turbo, rh-music, rh-voice-clone | ✅ 全部 |

---

## 三、变更清单

### 3.1 rh-adapter 改动

#### A. mapping.py — 模型映射

删除 `MODEL_3D` 字典及 `MODEL_MAP` 中的 `**MODEL_3D`。

新增 3 个前端已启用但 adapter 缺失的模型：

```python
# 加到 IMAGE_MODELS
"rh-gpt2-text": {
    "endpoint": "rhart-image-g-2/text-to-image",
    "label": "GPT2.0 文生图",
    "output_type": "image",
},

# 加到 VIDEO_MODELS
"rh-grok-text-video": {
    "endpoint": "rhart-video-g/text-to-video",
    "label": "Grok Video 文生视频",
    "output_type": "video",
},
"rh-grok-image-video": {
    "endpoint": "rhart-video-g/image-to-video",
    "label": "Grok Video 图生视频",
    "output_type": "video",
},
```

#### B. schemas.py — 请求模型

扩展 AudioRequest，兼收 `audio` 和 `audio_url`（前端可能用任意一个）：

```python
class AudioRequest(BaseModel):
    model: str
    prompt: str = ""
    language: Optional[str] = None
    voice: Optional[str] = None
    # 声音克隆
    audio_url: Optional[str] = Field(None, alias="audioUrl")
    audio: Optional[str] = None               # 兼容前端 audio 字段
    start_time: Optional[str] = Field(None, alias="startTime")
    end_time: Optional[str] = Field(None, alias="endTime")
    ref_text: Optional[str] = Field(None, alias="refText")
    text: Optional[str] = None

    @property
    def reference_audio(self) -> Optional[str]:
        """取参考音频，audio_url 优先，audio 兜底"""
        return self.audio_url or self.audio
```

扩展 ImageRequest 和 VideoRequest，加 `aspect_ratio` / `resolution` / `ratio` 字段（前端不同模型用不同名字）：

```python
class ImageRequest(BaseModel):
    model: str
    prompt: str
    aspect_ratio: Optional[str] = Field(None, alias="aspectRatio")
    ratio: Optional[str] = None
    resolution: Optional[str] = None
    size: Optional[str] = None
    images: Optional[list[str]] = None
    image: Optional[str] = None

class VideoRequest(BaseModel):
    model: str
    prompt: str = ""
    ratio: Optional[str] = Field(None, alias="aspect_ratio")
    resolution: Optional[str] = None
    duration: Optional[int] = None
    images: Optional[list[str]] = None
    video: Optional[str] = None
    audio: Optional[str] = None
    text: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
```

#### C. rh_client.py — 修复

- 删除死代码：`download_result()`、`fix_mov_to_mp4()`、`import struct`
- 保留 `upload_file()`，修复 `fileType` 硬编码：`"fileType": mime_type.split("/")[0]`
- 新增 `maybe_upload()`:

```python
UPLOAD_THRESHOLD = 5_242_880  # 5MB
MAX_UPLOAD_SIZE = 20_971_520  # 20MB
ALLOWED_UPLOAD_MIMES = {"image/", "video/", "audio/"}

async def maybe_upload(data_url: str) -> str:
    """data URL >5MB → 上传到 RH 拿 URL；≤5MB 原样返回。HTTP URL 直接放行。"""
    if not data_url:
        return data_url
    if data_url.startswith(("http://", "https://")):
        return data_url
    if not data_url.startswith("data:"):
        return data_url

    # 解析 MIME + 解码
    header, encoded = data_url.split(",", 1)
    mime = header.split(":")[1].split(";")[0]
    if not any(mime.startswith(prefix) for prefix in ALLOWED_UPLOAD_MIMES):
        raise RHError(f"不支持的文件类型: {mime}", code=400)

    raw = base64.b64decode(encoded)
    if len(raw) > MAX_UPLOAD_SIZE:
        raise RHError(f"文件超过 20MB 限制", code=413)
    if len(raw) > UPLOAD_THRESHOLD:
        return await upload_file(raw, f"upload.{mime.split('/')[1]}", mime)
    return data_url
```

#### D. image.py — 加 >5MB 上传 + 新参数透传

- 构建 payload 时对 `images` 列表每个元素调用 `maybe_upload()`
- 透传 `aspect_ratio`/`ratio`/`resolution` 到 RH payload

#### E. video.py — 加 >5MB 上传

- 对 `images`/`video` 字段调用 `maybe_upload()`

#### F. audio.py — 改为异步提交 + 声音克隆支持

与 image.py/video.py 统一：只提交，不轮询，立刻返回 task_id。

```python
async def generate_audio(request: AudioRequest) -> dict:
    model = request.model
    endpoint = get_rh_endpoint(model)

    payload = {"prompt": request.prompt or request.text or ""}
    if request.language:
        payload["language"] = request.language
    if request.voice:
        payload["voice"] = request.voice

    # 声音克隆专属字段
    ref_audio = request.reference_audio
    if ref_audio:
        payload["referenceAudio"] = await maybe_upload(ref_audio)
    if request.start_time:
        payload["startTime"] = request.start_time
    if request.end_time:
        payload["endTime"] = request.end_time
    if request.ref_text:
        payload["refText"] = request.ref_text
    if request.text:
        payload["text"] = request.text

    result = await submit_task(endpoint, payload)
    task_id = extract_task_id(result)
    # 不在这里 poll — 前端自己轮询 GET /tasks/{task_id}
    return {"task_id": task_id, "status": "processing"}
```

#### G. image.py / video.py — 同样改为异步提交

所有服务统一模式：`submit_task()` → 提取 task_id → 立刻返回。删除内部 `poll_task()` 调用。

AI App 模型（rh-gpt2-image, rh-seedance2）走 `submit_ai_app()` → 同样立刻返回 task_id。

#### H. main.py — 新增 GET /tasks/{task_id} 查询端点

```python
@app.get("/tasks/{task_id}")
async def query_task(task_id: str):
    """无状态查询：每次实时调 RH /openapi/v2/query，不缓存。"""
    result = await rh_query(task_id)   # 调 RH 一次
    status = result.get("status", "RUNNING").upper()

    response = {"task_id": task_id, "status": status}

    if status in ("SUCCESS", "COMPLETED", "DONE"):
        response["status"] = "success"
        response["url"] = extract_result_url(result)
        response["usage"] = result.get("usage")
    elif status in ("FAILED", "FAILURE", "ERROR", "CANCELLED"):
        response["status"] = "failed"
        response["error"] = result.get("errorMessage", "任务失败")
    else:
        response["status"] = "processing"

    return response
```

这个端点由 Nginx 直接转发，不经过 NewAPI（不重复计费）。

#### I. main.py — POST 端点返回格式统一

所有 POST 端点（`/v1/images/generations`、`/v1/videos`、`/v1/audio/speech`）统一返回：

```json
{
  "task_id": "rh_abc123",
  "status": "processing"
}
```

AI App 模型额外返回 `"ai_app": true`，前端据此轮询 `/rh/tasks/{task_id}?ai_app=true`。POST 响应不返回 `poll_url`；poll URL 由前端统一拼接。

前端收到后立刻进入轮询循环。

---

### 3.2 前端改动

#### A. mediaModelCapabilities.ts — 新增 7 个模型 + 启用 3 个

**新增（adapter 有但前端缺）：**

```typescript
// 图片
{ id: 'rh-image-v2', label: '全能图片V2', task: 'image', model: 'rh-image-v2',
  provider: 'gateway-image', webappId: 'rhart-image-n-v2/text-to-image',
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(NANO_ASPECT_RATIOS) },
    { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1k', options: options(['1k', '2k', '4k']) },
  ],
},

// 视频
{ id: 'rh-kling-v30-pro', label: 'Kling v3.0 Pro', task: 'video', model: 'rh-kling-v30-pro',
  provider: 'gateway-video', webappId: 'kling-video-o3-pro/text-to-video',
  maxFiles: 3, acceptedFiles: ['image'],
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(VIDEO_RATIOS) },
    { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
    { key: 'images', label: '参考图', kind: 'images' },
  ],
},
{ id: 'rh-veo-31-fast', label: 'Veo 3.1 Fast', task: 'video', model: 'rh-veo-31-fast',
  provider: 'gateway-video', webappId: 'veo-3-1-generate-preview/text-to-video',
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(VEO_RATIOS) },
  ],
},
{ id: 'rh-veo-31-pro', label: 'Veo 3.1 Pro', task: 'video', model: 'rh-veo-31-pro',
  provider: 'gateway-video', webappId: 'veo-3-1-pro-generate/text-to-video',
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(VEO_RATIOS) },
  ],
},

// 音频
{ id: 'rh-speech-hd', label: 'RH 语音合成HD', task: 'audio', model: 'rh-speech-hd',
  provider: 'gateway-audio',
  fields: [
    { key: 'prompt', label: '文稿', kind: 'prompt', required: true },
    { key: 'language', label: '语言', kind: 'select', defaultValue: '中文', options: options(LANGUAGES) },
  ],
},
{ id: 'rh-speech-turbo', label: 'RH 语音合成快速', task: 'audio', model: 'rh-speech-turbo',
  provider: 'gateway-audio',
  fields: [
    { key: 'prompt', label: '文稿', kind: 'prompt', required: true },
    { key: 'language', label: '语言', kind: 'select', defaultValue: '中文', options: options(LANGUAGES) },
  ],
},
{ id: 'rh-music', label: 'RH 音乐生成', task: 'audio', model: 'rh-music',
  provider: 'gateway-audio',
  fields: [
    { key: 'prompt', label: '描述', kind: 'prompt', required: true },
  ],
},
```

**启用 3 个已有模型：**

| 模型 | 改动 |
|------|------|
| `rh-seedance2` | 删除 `enabled: false` |
| `rh-video-v31-fast` | 删除 `enabled: false` |
| `rh-voice-clone` | 删除 `enabled: false` |

#### B. media-generation.ts — 异步轮询 + 声音克隆修复

**RH 模型统一异步流程**：所有 RH 模型的 generate 函数改为：

```typescript
// 1. 提交（走 NewAPI 计费，<2s 返回）
const resp = await apiCall('/v1/images/generations', body, 'POST', model)
const taskId = resp.task_id

// 2. 通知 mediaTaskStore 任务已提交（UI 立刻显示进度）
if (params.onSubmitted) {
  params.onSubmitted({
    taskId,
    pollUrl: `/rh/tasks/${taskId}`,   // 轮询走 Nginx 直连 rh-adapter
    pollKind: 'image',
  })
}

// 3. 轮询（走 Nginx，不经过 NewAPI，不重复计费）
return pollTask(`/rh/tasks/${taskId}`, 'image', onProgress, 600, 5000)
```

`pollTask` 已有的逻辑不变（状态检测、超时、重试），只是 poll URL 从 `/v1/images/generations/{id}` 改为 `/rh/tasks/{id}`。

**超时不再需要特殊配置**：提交 POST 是瞬时的（<2s），标准 180s 超时足够。轮询每次也是瞬时查询，标准 60s 超时足够。长等待时间由 pollTask 的 maxPollsSec 控制（图片 600s / 视频 1200s / 音频 600s）。

**声音克隆**：当前代码构建 nodeInfoList 发到 `/v1/audio/generations`。改为扁平参数到 `/v1/audio/speech`：

```typescript
// 改前：
const nodeInfoList = [{ nodeId: '4', fieldName: 'audio', fieldValue: params.audioUrl }, ...]
body = { model, nodeInfoList, webappId: cap.webappId }
resp = await apiCall('/v1/audio/generations', body, 'POST', model)

// 改后：
body = {
  model,
  prompt: params.prompt || params.text || '',
  audio_url: params.audioUrl,
  audio: params.audioUrl,        // 兼容字段
  start_time: params.startTime,
  end_time: params.endTime,
  ref_text: params.refText,
  text: params.text,
  language: params.language,
}
resp = await apiCall('/v1/audio/speech', body, 'POST', model)
// 然后走统一异步轮询流程
```

**RH TTS/音乐模型**（`rh-speech-hd`、`rh-speech-turbo`、`rh-music`）也走 `/v1/audio/speech` + 异步轮询。

#### C. media-generation.ts — RH 图片/视频参数传递

确保 `generateImage` 和 `generateVideo` 的 RH 模型分支正确传递 `aspect_ratio`/`ratio`/`resolution`/`duration`/`images` 到 request body（当前已有大部分逻辑，需验证字段名与 adapter 的 schema alias 对齐）。

#### D. mediaTaskStore.ts — 断线恢复

mediaTaskStore 已有 task 持久化机制（`upstreamTaskId`、`pollUrl`、`pollKind`）。在 APP 重启时，对 `status === 'running'` 的 RH 任务，用存储的 `pollUrl` 恢复轮询。这在当前代码中已部分实现（创作面板 `onMounted` 恢复逻辑），需验证 `/rh/tasks/` poll URL 格式兼容。

---

## 四、不做的事

| 事项 | 原因 |
|------|------|
| rh-adapter 加鉴权 | Docker 内网隔离 + Nginx 只转发 /rh/tasks/。部署 checklist 验证 |
| `/v1/rh/workflow` 端点 | 画布工作流节点推到 Phase 2 |
| 画布 canvasGeneration.ts 任何改动 | Phase 2 独立 SDD。Phase 1 不删不改画布代码 |
| 3D 模型 | 无 UI 入口 |
| 数字人模型 | UI 未就绪 |
| 声音设计模型 | adapter 未注册 |
| rh-adapter 内部状态缓存 | 无状态设计，每次 GET 实时查 RH |

---

## 五、风险

| 风险 | 缓解 |
|------|------|
| RH 官方修改 AI App 节点 ID | rh-gpt2-image 和 rh-seedance2 的 nodeInfoList 节点 ID 硬编码在 adapter 中；需要监控 |
| `maybe_upload` 内存占用 | 已加 20MB 硬上限 + MIME 白名单 |
| 部署时端口意外暴露 | 部署 checklist：确认 rh-adapter 端口只绑 Docker 内网 |
| Nginx /rh/tasks/ 被滥用探测 | task_id 是 RH 生成的随机串，无法遍历；且只返回状态不返回敏感信息 |
| 模型名在前端和 adapter 不匹配 | 本 SDD 第二节做了完整审计，Phase 1 补齐所有缺失映射 |
| RH 任务超时（>20 分钟） | pollTask maxPollsSec 兜底，超时后前端显示友好错误 |
| 用户关 APP 后任务丢失 | mediaTaskStore 持久化 task_id + pollUrl，APP 重启自动恢复轮询 |

---

## 六、部署 Checklist

配置产物：

- Nginx 幂等安装脚本：`scripts/rh-deploy/install-nginx-rh-tasks.py`
- NewAPI 渠道配置清单：`scripts/rh-deploy/newapi-rh-channel.md`
- 回归测试：`node --test scripts/rh-deploy/__tests__/config.test.mjs`
- 当前验证状态：RH targeted 测试通过；全量 `pnpm run test:focused` 仍被 unrelated ContextBoundary 测试阻塞。

```
1. [ ] docker compose 确认 rh-adapter 端口绑定为 172.17.0.1:8789 或 127.0.0.1:8789，不暴露 0.0.0.0
2. [ ] rh-adapter 容器启动，GET /health 返回 {"models": 16}
3. [ ] Nginx 添加轮询代理规则：
       location /rh/tasks/ {
           proxy_pass http://172.17.0.1:8789/tasks/;
           proxy_read_timeout 30s;
       }
4. [ ] Nginx reload，验证 GET /rh/tasks/test → rh-adapter 返回 404（test 不存在，但路由通了）
5. [ ] NewAPI 后台添加自定义渠道：
       - 代理地址: http://rh-adapter:8789
       - 模型列表: rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,
                   rh-video-v31-fast,rh-kling-v30-pro,rh-veo-31-fast,rh-veo-31-pro,
                   rh-seedance2,grok-video-3,rh-grok-text-video,rh-grok-image-video,
                   rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone
       - 超时: 30 秒（提交是瞬时的，不需要长超时）
6. [ ] NewAPI 后台为每个模型设置价格（按次计费）
7. [ ] 验证端到端：
       curl -X POST .../v1/images/generations -d '{"model":"rh-pro-image","prompt":"a cat"}'
       → 返回 {"task_id":"xxx","status":"processing"}
       curl .../rh/tasks/xxx → 轮询直到 {"status":"success","url":"https://..."}
8. [ ] 验证声音克隆：
       curl -X POST .../v1/audio/speech -d '{"model":"rh-voice-clone","audio_url":"data:...","text":"你好"}'
       → 返回 task_id → 轮询拿到音频 URL
9. [ ] 发版前端
10.[ ] 创作面板选 rh-pro-image → 生图 → NewAPI 扣费记录可见
11.[ ] 创作面板选 rh-voice-clone → 上传参考音频 → 生成成功
12.[ ] 同时提交 3 个图片任务 → 全部并发执行，无超时或排队
```

---

## 七、Phase 2 预告（画布收敛，独立 SDD）

Phase 1 不动画布代码。Phase 2 要解决的问题：

1. **canvasMediaRuntime.ts** 从 canvasGeneration.ts 改为调用 media-generation.ts
2. **canvasGeneration.ts** 的旧 `/api/proxy/*` 路径全部收敛
3. **节点组件直接 import canvasGeneration.ts** 的调用面清理（CanvasRunningHubNode、CanvasRhToolsNode、CanvasSeedanceNode 等）
4. **RunningHub 工作流节点（任意 webappId）** 的计费策略和白名单设计
5. **画布进度回调** 从手动轮询改为 media-generation.ts 的统一回调

这些问题需要单独设计，不应塞进 Phase 1 的交付物里。

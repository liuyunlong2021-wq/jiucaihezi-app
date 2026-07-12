# Codex 交接：RH 模型全链路 Step 2 + Step 3

> 日期: 2026-06-03
> 前置: Step 1 (rh-adapter) 已完成并审计通过，17/17 测试通过
> SDD: `docs/sdd/rh-model-full-pipeline-sdd.md`

---

## 已完成 (Step 1)

rh-adapter 全部改完：

- `mapping.py`: 16 个模型（砍 2 个 3D，加 rh-gpt2-text / rh-grok-text-video / rh-grok-image-video）
- `schemas.py`: AudioRequest 加 6 个声音克隆字段（audio_url/audio/start_time/end_time/ref_text/text），兼收 camelCase 和 snake_case
- `rh_client.py`: 删死代码（download_result/fix_mov_to_mp4/struct），加 maybe_upload（>5MB 上传 + 20MB 上限 + MIME 白名单），加 query_task/query_ai_app_task（无状态单次查询）
- `image.py / video.py / audio.py`: 全部改为异步提交，不再内部轮询，立刻返回 `{task_id, status: "processing"}`
- `main.py`: POST 端点直接返回 task_id；新增 `GET /tasks/{task_id}` 无状态查询端点（前端轮询用）
- 测试修复：3D 断言改为 rh-gpt2-text，17/17 通过

---

## 已完成 (Step 2): 前端改动

### 2A. `src/data/mediaModelCapabilities.ts`

**新增 7 个模型定义**（插入到 `// ── RunningHub 模型 ──` 区域）：

| id | label | task | model | provider | 关键字段 |
|----|-------|------|-------|----------|---------|
| rh-image-v2 | 全能图片V2 | image | rh-image-v2 | gateway-image | prompt, ratio(NANO_ASPECT_RATIOS), resolution(1k/2k/4k) |
| rh-kling-v30-pro | Kling v3.0 Pro | video | rh-kling-v30-pro | gateway-video | prompt, ratio(VIDEO_RATIOS), duration(4-15s), images |
| rh-veo-31-fast | Veo 3.1 Fast | video | rh-veo-31-fast | gateway-video | prompt, ratio(VEO_RATIOS) |
| rh-veo-31-pro | Veo 3.1 Pro | video | rh-veo-31-pro | gateway-video | prompt, ratio(VEO_RATIOS) |
| rh-speech-hd | RH 语音合成HD | audio | rh-speech-hd | gateway-audio | prompt, language(LANGUAGES) |
| rh-speech-turbo | RH 语音合成快速 | audio | rh-speech-turbo | gateway-audio | prompt, language(LANGUAGES) |
| rh-music | RH 音乐生成 | audio | rh-music | gateway-audio | prompt |

每个模型的 `webappId` 设为对应的 RH endpoint 路径（参考 `rh-adapter/src/models/mapping.py`）。

**启用 3 个已有模型**（删除 `enabled: false`）：
- `rh-seedance2`（约 line 219）
- `rh-video-v31-fast`（约 line 237）
- `rh-voice-clone`（约 line 372）

### 2B. `src/api/media-generation.ts`

**核心改动 1 — 所有 RH 模型的 poll URL 改为 `/rh/tasks/{id}`**

当前 RH 模型的 generateImage/generateVideo/generateAudio 在拿到 resp 后调用 pollTask：

```typescript
// 当前 (各处散落)：
return pollTask(`/v1/videos/${taskId}`, 'video', ...)
return pollTask(`/v1/images/generations/${taskId}`, 'image', ...)
```

改为：
```typescript
// 统一改为：
return pollTask(`/rh/tasks/${taskId}`, 'video', ...)
return pollTask(`/rh/tasks/${taskId}`, 'image', ...)
```

注意：rh-adapter 的 POST 返回格式已从旧的 `{data: [{url, task_id}], usage: {...}}` 改为 `{task_id, status: "processing"}`。需要在 extractTaskId 之前适配这个新格式。

rh-adapter 的 GET /tasks/{id} 返回格式：
```json
// processing:
{"task_id": "xxx", "status": "processing"}
// success:
{"task_id": "xxx", "status": "success", "url": "https://...", "usage": {"cost": 0.12, "duration_seconds": 45}}
// failed:
{"task_id": "xxx", "status": "failed", "error": "余额不足"}
```

pollTask 已有的状态检测逻辑应该能识别 "success"/"failed"/"processing"。需验证 extractMediaUrl 能从 `{url: "..."}` 中提取 URL。

**核心改动 2 — 声音克隆参数**

当前代码（`generateAudio` 内，约 line 758，RH Voice Models 分支）：
```typescript
// 当前：构建 nodeInfoList，发到 /v1/audio/generations
const nodeInfoList = [
  { nodeId: '4', fieldName: 'audio', fieldValue: params.audioUrl },
  // ...
]
body = { model, nodeInfoList, webappId: cap.webappId }
resp = await apiCall('/v1/audio/generations', body, 'POST', model)
```

改为：
```typescript
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
```

**核心改动 3 — RH TTS/音乐模型路由**

新增的 rh-speech-hd / rh-speech-turbo / rh-music 模型也需要走 `/v1/audio/speech` 端点（不是 `/suno/*`）。在 generateAudio 中识别 `model.startsWith('rh-')` 的音频模型，统一走：

```typescript
body = { model, prompt: params.prompt || params.text || '', language: params.language }
resp = await apiCall('/v1/audio/speech', body, 'POST', model)
const taskId = resp.task_id
// 异步轮询
return pollTask(`/rh/tasks/${taskId}`, 'audio', onProgress, 600, 5000)
```

**核心改动 4 — AI App 模型的 poll 需要 ai_app=true 参数**

rh-adapter 的 `GET /tasks/{id}` 端点接受 `?ai_app=true` 查询参数，用于区分标准 API 和 AI App 的查询路径。对于 rh-gpt2-image 和 rh-seedance2（AI App 模型），poll URL 应为：

```typescript
return pollTask(`/rh/tasks/${taskId}?ai_app=true`, 'image', ...)
```

如何判断：submit 的返回中有 `ai_app: true` 字段。

### 2C. 验证

改完后跑：
```bash
pnpm run test:focused
```

重点关注 media-generation 相关测试。如果有针对 generateAudio nodeInfoList 的测试，需要同步更新。

---

## Step 3: 部署配置

> 本地配置产物已准备；线上还需在服务器执行 Nginx reload 并在 NewAPI 后台保存渠道。

### 3A. Nginx 配置

在服务器 Nginx 配置中添加：
```nginx
location /rh/tasks/ {
    proxy_pass http://172.17.0.1:8789/tasks/;
    proxy_read_timeout 30s;
}
```

本仓库已新增幂等安装脚本：`scripts/rh-deploy/install-nginx-rh-tasks.py`。

### 3B. NewAPI 渠道配置

后台添加自定义渠道：
- 代理地址: `http://rh-adapter:8789`（或 `http://172.17.0.1:8789`）
- 模型列表（16 个，逗号分隔）:

```
rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,rh-video-v31-fast,rh-kling-v30-pro,rh-veo-31-fast,rh-veo-31-pro,rh-seedance2,grok-video-3,rh-grok-text-video,rh-grok-image-video,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone
```

- 超时: 30 秒（提交是瞬时的）
- 按次计费，每个模型设价格

本仓库已新增配置清单：`scripts/rh-deploy/newapi-rh-channel.md`。

### 3C. CLAUDE.md

已更新 rh-adapter 架构描述和已知问题状态。Step 2 完成后再把 RH 模型集成状态从 🟡 改为 ✅。

---

## 不要做的事

- **不动 `canvasGeneration.ts` 和画布相关代码** — Phase 2 独立 SDD
- **不动 rh-adapter 代码** — Step 1 已完成并审计
- **不加 rh-adapter 鉴权** — Docker 内网隔离足够
- **不删 rh_client.py 的 poll_task / poll_ai_app** — 画布 Phase 2 可能复用

---

## 关键文件清单

| 文件 | 改什么 |
|------|--------|
| `src/data/mediaModelCapabilities.ts` | 加 7 个模型 + 启用 3 个 |
| `src/api/media-generation.ts` | 声音克隆扁平参数 + poll URL 改 /rh/tasks/ + RH TTS 路由 |
| `src/data/creationModels.ts` | 不用改，自动从 mediaModelCapabilities 派生 |
| `src/composables/useCreation.ts` | 不用改，audioParams 已有所有字段 |
| `src/stores/mediaTaskStore.ts` | 验证 pollUrl 格式兼容（可能需要适配 /rh/tasks/ 路径白名单） |

---

## 验收标准

- [x] RH targeted / focused 内 RH 相关测试通过
- [ ] `pnpm run test:focused` 全量通过（当前仍有 unrelated ContextBoundary 失败：`clearContextBoundary keeps history but excludes older messages from api payload`）
- [x] 创作面板模型下拉能看到 16 个 RH 模型（图片4 + 视频8 + 音频4）
- [x] 选 rh-voice-clone 后 UI 显示：参考音频上传 + 参考文字 + 起止时间 + 语言 + 输出文字
- [x] 代码中无 `nodeInfoList` 用于声音克隆（改为扁平参数）
- [x] 所有 RH 模型的 poll URL 统一为 `/rh/tasks/{id}`

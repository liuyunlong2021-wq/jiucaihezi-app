# 模型注册表矩阵 — 全渠道端点映射

> **日期**: 2026-06-18
> **分支**: `codex/media-runtime-rescue`
> **状态**: 已验证可用，待合回 main
> **测试**: 687 tests, 0 fail

---

## 架构总结

```
创作面板 → CreationModelRegistry → CreationRunPlan → CreationMediaRuntime
  ├─ NewAPI Direct (T8/火山/特朗普/WorldRouter)
  │     directImage/directVideo/baseSpec → /v1/images/generations, /v1/videos, etc.
  └─ RunningHub Adapter
        runninghubStandard → /v1/images/generations 或 /rh/submit/v1/videos → rh-adapter → RH 官方
```

### 端点速查

| 渠道 | 图片提交 | 视频提交 | 音频提交 | 轮询 |
|------|---------|---------|---------|------|
| T8 直连 | `/v1/images/generations` | `/v1/videos` | `/suno/submit/music` | `{endpoint}/{id}` |
| RH 图片 | `/v1/images/generations` | — | — | `/rh/tasks/{id}` |
| RH 视频 | — | `/rh/submit/v1/videos` | — | `/rh/tasks/{id}` |
| RH 音频 | — | — | `/v1/audio/speech` | `/rh/tasks/{id}` |
| MJ | `/mj/submit/imagine` | — | — | `/mj/task/{id}/fetch` |
| Seedance T8 | — | `/api/seedance/v1/videos` | — | `/api/seedance/v1/videos/{id}` |

---

## 一、NewAPI T8 直连 — 图片

| # | 前端 label | model | endpoint | pollKind | 图生图 | 状态 |
|---|-----------|-------|----------|----------|--------|------|
| 1 | GPT Image 2 · T8 直连 | `gpt-image-2` | `/v1/images/generations` | none | ✅ auto→`/v1/images/edits` | ✅ |
| 2 | Grok 4.2 Image · T8 直连 | `grok-4.2-image` | `/v1/images/generations` | none | ⚠️ partial | partial |
| 3 | Gemini 3.1 Flash Image · T8 直连 | `gemini-3.1-flash-image-preview` | `/v1/images/generations` | none | ✅ 上传触发 | partial |
| 4 | Gemini 3.1 Flash Image 2K · T8 直连 | `gemini-3.1-flash-image-preview-2k` | `/v1/images/generations` | none | ✅ 上传触发 | partial |
| 5 | Gemini 3 Pro Image · T8 直连 | `gemini-3-pro-image-preview` | `/v1/images/generations` | none | ✅ 上传触发 | partial |
| 6 | Gemini 3 Pro Image 2K · T8 直连 | `gemini-3-pro-image-preview-2k` | `/v1/images/generations` | none | ✅ 上传触发 | partial |
| 7 | Gemini 3 Pro Image 4K · T8 直连 | `gemini-3-pro-image-preview-4k` | `/v1/images/generations` | none | ✅ 上传触发 | partial |

### 关键设计决策

- **智能 mode 切换**: `resolveEffectiveContract` 检测到参考图时，自动将 `text-to-image` → `image-to-image`
- **image 始终数组**: `imageValueForRequest` 始终返回数组，匹配 T8 `/v1/images/generations` 的 `image: type: array` schema
- **GPT Image 2 图生图**: 自动切换 `/v1/images/edits` + multipart form data
- **Gemini 图生图**: 走 `/v1/images/generations` + JSON body 含 `image` 数组

---

## 二、NewAPI T8 直连 — 视频

| # | 前端 label | model | endpoint | pollKind | 状态 |
|---|-----------|-------|----------|----------|------|
| 1 | Grok Video 3 · T8 直连 | `grok-video-3` | `/v1/videos` | newapi-task | ✅ |
| 2 | ~~Grok Video 3 Fast · T8 直连~~ | `grok-video-3-fast` | — | — | broken (503) |
| 3 | ~~Veo 3.1 Fast · T8 直连~~ | `veo3.1-fast` | — | — | broken |
| 4 | Veo 3.1 Fast · NewAPI Alias | `veo_3_1-fast` | `/v1/videos` | newapi-task | partial |
| 5 | ~~Seedance 2.0 · 特朗普~~ | `seedance-2.0` | — | — | broken (404) |
| 6 | ~~Seedance 2.0 Fast · 特朗普~~ | `seedance-2.0-fast` | — | — | broken (404) |
| 7 | Seedance 2.0 · T8/火山 | `seedance-2-0` | `/api/seedance/v1/videos` | seedance-task | ✅ |
| 8 | Seedance 2.0 Pro · T8/火山 | `seedance-2-0-pro` | `/api/seedance/v1/videos` | seedance-task | ✅ |
| 9 | Seedance 2.0 Fast · T8/火山 | `seedance-2-0-fast` | `/api/seedance/v1/videos` | seedance-task | degraded (522) |
| 10 | Doubao Seedance 2.0 · 火山 | `doubao-seedance-2-0-260128` | `/api/seedance/v1/videos` | seedance-task | ✅ |

### 关键设计决策

- **directVideo 默认端点**: `/v1/videos`（之前错误使用 `/v1/video/generations`，已修复）
- **broken 模型**: 标记 `contractStatus: 'broken'`，前端不展示，`validateCreationModelSpec` 抛异常阻止提交

---

## 三、NewAPI T8 直连 — 音频

| # | 前端 label | model | endpoint | pollKind | 状态 |
|---|-----------|-------|----------|----------|------|
| 1 | Suno 自定义歌曲 · T8 直连 | `suno_music` | `/suno/submit/music` | suno-task | partial |
| 2 | Suno 灵感歌曲 · T8 直连 | `suno_music` | `/suno/submit/music` | suno-task | partial |
| 3 | Suno 歌词 · T8 直连 | `suno_lyrics` | `/suno/submit/lyrics` | suno-task | partial |

---

## 四、NewAPI T8 直连 — MJ

| # | 前端 label | model | endpoint | pollKind | 轮询 | 状态 |
|---|-----------|-------|----------|----------|------|------|
| 1 | MJ Relax Imagine · T8 直连 | `mj_relax_imagine` | `/mj/submit/imagine` | mj-task | `/mj/task/{id}/fetch` | partial |

### 关键设计决策

- **apiStyle: 'mj-task'**: 独立 API 风格，pollKind 也是 'mj-task'
- **extractTaskId**: 支持 MJ 的 `result` 字段
- **executeDirectImageRequest**: 检测 mj-task，轮询路径特殊处理为 `/mj/task/{id}/fetch`
- **poll URL 白名单**: `/mj/task/{id}/fetch` 已加入 `isAllowedCreationPollUrl`
- **URL 白名单**: `innk.cc` (MJ 图片 CDN) 已加入 `CREATION_RESULT_HOST_PATTERNS`

---

## 五、RunningHub — 图片

| # | 前端 label | model | RH endpoint | fallback (图生图) | 状态 |
|---|-----------|-------|-------------|-------------------|------|
| 1 | Z Image Turbo · RunningHub | `z-image-turbo` | `rhart-image/z-image/turbo-lora` | — | ✅ |
| 2 | GPT2.0 图生图 · RunningHub | `rh-gpt2-image` | `rhart-image-g-2/image-to-image` | — | ✅ |
| 3 | GPT2.0 文生图 · RunningHub | `rh-gpt2-text` | `rhart-image-g-2/text-to-image` | — | ✅ |
| 4 | 全能图片 V2 · RunningHub | `rh-image-v2` | `rhart-image-n-g31-flash/text-to-image` | `.../image-to-image` ✅ | ✅ |
| 5 | 全能图片 PRO · RunningHub | `rh-pro-image` | `rhart-image-n-pro/text-to-image` | `.../edit` ✅ | ✅ |

### 关键设计决策

- **rh-adapter fallback_endpoint**: `rh-image-v2` 和 `rh-pro-image` 在 rh-adapter mapping.py 中配置了 `fallback_endpoint`，检测到 `has_image=True` 时自动切到图生图端点
- **rh-adapter 部署**: 2026-06-18 成功部署，models 23→24

---

## 六、RunningHub — 视频

| # | 前端 label | model | RH endpoint | 状态 |
|---|-----------|-------|-------------|------|
| 1 | 全能视频 V3.1 Fast · RunningHub | `rh-video-v31-fast` | `rhart-video-v3.1-fast/text-to-video` + fallback `image-to-video` | ✅ |
| 2 | Grok Video 文生视频 · RunningHub | `rh-grok-text-video` | `rhart-video-g/text-to-video` | ✅ |
| 3 | Grok Video 图生视频 · RunningHub | `rh-grok-image-video` | `rhart-video-g/image-to-video` | ✅ |
| 4 | Grok Video 视频编辑 · RunningHub | `rh-grok-video-edit` | `rhart-video-g-official/edit-video` | ✅ 🆕 |
| 5 | Seedance 2.0 文生视频 · RunningHub | `rh-seedance2-mini` | `rhart-video/sparkvideo-2.0/text-to-video` | ✅ |
| 6 | Seedance 2.0 图生视频 · RunningHub | `rh-seedance2-fast` | `rhart-video/sparkvideo-2.0/image-to-video` | ✅ |
| 7 | Seedance 2.0 全能参考 · RunningHub | `rh-seedance2` | `rhart-video/sparkvideo-2.0/multimodal-video` | ✅ |

### 关键设计决策

- **RH 视频提交端点**: `/rh/submit/v1/videos`（之前错误使用 `/v1/videos`，已恢复为旧 RH 支线验证路径）
- **rh-grok-video-edit**: 2026-06-18 新增，rh-adapter 和前端均已启用

---

## 七、RunningHub — 音频

| # | 前端 label | model | RH endpoint | 状态 |
|---|-----------|-------|-------------|------|
| 1 | Suno v5.5 一句话成歌 · RunningHub | `rh-suno-v55-single` | `rhart-audio/suno-v5.5/single` | ✅ |
| 2 | Suno v5.5 自定义成歌 · RunningHub | `rh-suno-v55-custom` | `rhart-audio/suno-v5.5/custom` | ✅ |
| 3 | Suno 创作歌词 · RunningHub | `rh-suno-lyrics` | `rhart-audio/suno/lyrics` | ✅ |
| 4 | 语音合成 HD · RunningHub | `rh-speech-hd` | `rhart-audio/text-to-audio/speech-2.8-hd` | unknown |
| 5 | 语音合成 Turbo · RunningHub | `rh-speech-turbo` | `rhart-audio/text-to-audio/speech-2.8-turbo` | unknown |
| 6 | 音乐生成 · RunningHub | `rh-music` | `rhart-audio/text-to-audio/music-2.5` | unknown |
| 7 | 声音克隆 · RunningHub | `rh-voice-clone` | `rhart-audio/text-to-audio/voice-clone` | unknown |

---

## 八、RunningHub — AI App 工作流 (5个)

| # | 前端 label | model | webapp_id | rh-adapter | 状态 |
|---|-----------|-------|-----------|------------|------|
| 1 | 极速数字人 · RunningHub 工作流 | `rh-aiapp-fast-digital-human` | `2028055408421642241` | ✅ | partial |
| 2 | 数字人 · RunningHub 工作流 | `rh-aiapp-digital-human` | `2036019863617015809` | ✅ | partial |
| 3 | 我是导演 · RunningHub 工作流 | `rh-aiapp-director` | `2029950473750454274` | ✅ | partial |
| 4 | 声音克隆 · RunningHub 工作流 | `rh-aiapp-voice-clone` | `2046193597401276417` | ✅ | partial |
| 5 | 声音设计 · RunningHub 工作流 | `rh-aiapp-voice-design` | `2035739697670000642` | ✅ | partial |

### 关键设计决策

- 5 个工作流全部以 `rh-aiapp-*` 前缀命名，前端无重复条目
- 旧别名 `rh-digital-human-fast`、`rh-digital-human` 已删除
- `rh-voice-design` 标准版已删除（rh-adapter 无此映射，仅 AI App 版本存在）

---

## 九、已删除/不可用

| 模型 | 原因 |
|------|------|
| `gpt2.0` · NewAPI 直连 | 冗余（比例+尺寸+分辨率三套参数混乱） |
| `rh-seedance2` 聚合 | 无 rh-adapter 映射，3个具体模型已覆盖 |
| `rh-voice-design` 标准 | rh-adapter 无此映射 |
| `rh-digital-human-fast` | 重复 rh-aiapp-fast-digital-human |
| `rh-digital-human` | 重复 rh-aiapp-digital-human |
| 特朗普 async 图片 (4个) | NewAPI 不代理 `/v1/images/generation_tasks` |

---

## 十、rh-adapter 部署状态

| 属性 | 值 |
|------|-----|
| 服务器路径 | `/opt/rh-adapter` |
| 端口 | `172.17.0.1:8789` |
| 模型数 | **24** |
| 最新部署 | 2026-06-18 |
| 新增模型 | `rh-grok-video-edit` |
| 新增 fallback | `rh-image-v2` → `.../image-to-image` |

### NewAPI RH Channel 模型列表（24个）

```
rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,z-image-turbo,
rh-video-v31-fast,rh-seedance2-mini,rh-seedance2-fast,rh-seedance2,
rh-grok-text-video,rh-grok-image-video,rh-grok-video-edit,
rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,
rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,
rh-speech-hd,rh-speech-turbo,rh-music,
rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design
```

---

## 十一、协议与命名约定

### 身份字段体系

```text
source       — 大来源：newapi-direct / runninghub
route        — Runtime 分发：newapi-direct / runninghub-adapter
upstreamFamily — 上游供应商：t8 / volcengine / trump / runninghub / openai-compatible
apiStyle     — 接口风格：openai-images / newapi-task / mj-task / rh-standard / rh-aiapp / ...
contractStatus — 可信度：verified / partial / unknown / broken / degraded
```

### 新增模型 checklist

1. `creationModelRegistry.ts` 注册（选正确的工厂函数）
2. `rh-adapter/src/models/mapping.py` 映射（仅 RH 模型）
3. `rh-adapter/src/models/capabilities.json` 确认端点存在
4. NewAPI 后台 RH channel 模型列表追加（仅 RH 模型）
5. 服务器 `docker compose up -d --build rh-adapter`
6. `pnpm exec vue-tsc -b` + `pnpm run test:focused:run`
7. 本地 `pnpm tauri dev` 冒烟测试

### 端点必须精确

```text
T8 直连 ≠ 特朗普（不同的 NewAPI 路径）
RH 图片 ≠ RH 视频（不同的提交端点）
standard API ≠ AI App（rh-adapter 路由不同）
```

---

## 十二、相关文件

- `src/runtime/creation/creationModelRegistry.ts` — 前端模型唯一事实源
- `src/runtime/creation/creationMediaTypes.ts` — 类型定义
- `src/runtime/creation/creationMediaPlan.ts` — RunPlan + 契约校验
- `src/runtime/creation/creationMediaRuntime.ts` — Runtime 分发 + 端点路由
- `src/api/media-generation.ts` — 底层 API client
- `rh-adapter/src/models/mapping.py` — RH 模型↔端点映射
- `rh-adapter/src/models/capabilities.json` — RH 官方能力
- `docs/rh-adapter-server-deploy-runbook.md` — 服务器部署手册
- `docs/sdd/rh-runtime-adapter-newapi-sdd.md` — 架构设计文档

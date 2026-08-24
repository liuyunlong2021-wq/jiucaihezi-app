# Boyesir 视频适配器首批双模型接入 TDD（2026-08-24）

> 状态：待实施
> 分支：`0824Boyesir`
> 首批模型：`dvc-seedance-2.5`、`seedance2.5-720p`
> 范围：先用独立适配器打通现有 App / NewAPI 视频任务链路；本阶段只写 TDD，不创建适配器、不注册模型、不部署、不发起付费请求。

## 1. 目标与根因

现有 App 统一向 NewAPI 提交并轮询：

```text
POST /v1/videos
GET  /v1/videos/{task_id}
```

Boyesir 的合同是：

```text
POST https://www.boyesir.icu/v1/videos/generations
GET  https://www.boyesir.icu/v1/tasks/{task_id}
```

响应字段和状态也不同。直接把 NewAPI OpenAI 渠道 Base URL 指向 Boyesir 会因路径与任务响应不兼容而失败，根因是协议不一致，不在 App 的创作面板或轮询器。

最小方案是在两者之间新增独立 `boyesir-video-adapter`，复用现有 `directVideo()`、`newapi-task`、素材上传和 MP4 落盘链路，不修改 NewAPI 源码，也不新增 App 轮询协议。

## 2. 已确认官方合同

来源：用户提供的 `API 文档 — Boyesir AI.html`，本地证据路径为 `/Users/by3/Library/Containers/com.tencent.WeWorkMac/Data/Documents/Profiles/ABE2715D91CA7AB12852CECA2614F87D/Caches/Files/2026-08/98f8af7713e504397b903d9a464bcaf9/API 文档 — Boyesir AI.html`。

### 2.1 首批模型

| 模型 | 计费方式 | 分辨率 | 时长 |
| --- | --- | --- | --- |
| `dvc-seedance-2.5` | 按秒 | `720p` | `4–30` 秒 |
| `seedance2.5-720p` | 按秒 | `720p` | `4–30` 秒 |

官方文档未提供这两个模型的实时价格、专属画幅列表和专属参考素材上限。控制台实时价格、模型实际画幅和素材能力必须在产品注册前确认，不得套用文档中其他模型的限制。

### 2.2 提交与轮询

- 鉴权：`Authorization: Bearer sk-...`。
- 提交：`POST /v1/videos/generations`。
- 必填：字符串 `model`、字符串 `prompt`。
- 可选：整数 `duration`、字符串 `ratio`、字符串 `resolution`、数组 `images` / `reference_image_urls` / `reference_video_urls`、字符串 `audio_url` / `first_frame_url` / `last_frame_url`。
- 素材只接受公网 `http` / `https` URL，不支持 Base64 或本地路径。
- 提交成功：`{"task_id":"canvas_vid_xxxx","status":"queued"}`。
- 轮询：`GET /v1/tasks/{task_id}`，官方建议每 5–10 秒一次。
- 处理中：`{"status":"processing"}`。
- 完成：`{"status":"succeeded","result":{"videos":["https://.../xxx.mp4"]}}`。
- 失败：`{"status":"failed","error":"..."}`。
- 任务记录保留 2 小时，生成结果文件保留 24 小时；App 必须继续在完成后及时保存到项目。

官方列出的错误码为 `400`、`401`、`402`、`404`、`502`、`504`。适配器应保留这些上游 HTTP 状态和可用错误信息；不得把余额不足、任务不存在或已退款的上游错误统一伪装成普通 `500`。

## 3. 最小适配合同

### 3.1 路由

```text
App -> NewAPI POST /v1/videos
    -> adapter POST /v1/videos
    -> Boyesir POST /v1/videos/generations

App -> NewAPI GET /v1/videos/{task_id}
    -> adapter GET /v1/videos/{task_id}
    -> Boyesir GET /v1/tasks/{task_id}
```

NewAPI 渠道保存一个 Boyesir Key。适配器把收到的同一 Bearer Token 原样转发给提交和轮询请求；任务运行期间不得轮换该渠道 Key。

### 3.2 请求映射

| NewAPI / App 入站 | Boyesir 出站 |
| --- | --- |
| `model` | `model`，且只允许首批两个 ID |
| `prompt` | `prompt` |
| `duration` | `duration`，整数且为 `4–30` |
| `ratio` 或 `aspect_ratio` | `ratio` |
| `resolution` | 固定校验为 `720p` 后传 `resolution` |
| `images`、`image`、`imageUrl`、`imageUrls` | 合并为 `reference_image_urls` |
| `video_url`、`video_urls` | 合并为 `reference_video_urls` |
| `audio_url` | `audio_url` |

只接受带 host 的非空 `http` / `https` 素材 URL；非 URL、本地路径、Base64 和其他 scheme 在调用上游前返回 `400`。适配器不自行请求素材，公网实际可达性由 Boyesir 响应和生产验收确认。首尾帧角色如何从 App 入站字段无损表达尚未确认，首批不自行推断映射。

### 3.3 响应映射

| Boyesir | NewAPI / App |
| --- | --- |
| 提交 `task_id` | `id` 和 `task_id` 均返回同一值，`status: processing` |
| `queued` / `processing` | `status: processing` |
| `succeeded` + `result.videos[0]` | `status: completed`、`video_url` |
| `failed` + `error` | `status: failed`、规范化 `error` |
| 未知非终态 | `status: processing`，避免提前终止有效任务 |

成功状态缺少非空 `result.videos[0]`、提交成功缺少任务 ID、上游成功响应不是 JSON 对象时返回 `502`，不得制造完成结果。

## 4. TDD 顺序

### 红灯一：适配器协议测试

先在 `boyesir-video-adapter/tests/test_main.py` 写失败测试，覆盖：

1. 缺失或空 Bearer Token 返回 `401`；提交和轮询均把同一 Token 转发到 Boyesir。
2. 两个允许模型分别把 `model`、`prompt`、`duration`、`ratio`、`resolution` 映射到 `/v1/videos/generations`。
3. 图片、视频和音频的现有 App 别名被归一为 Boyesir 字段，且非公网 HTTP(S) 素材在上游调用前被拒绝。
4. 未支持模型、空提示词、非整数或超出 `4–30` 的时长、非 `720p` 分辨率返回 `400`。
5. 提交响应把 `task_id` 规范为现有 NewAPI 任务响应。
6. 轮询路径映射到 `/v1/tasks/{task_id}`；非法或含路径分隔符的任务 ID 在上游调用前返回 `400`。
7. `queued`、`processing`、`succeeded`、`failed` 和未知状态按第 3.3 节转换。
8. 完成视频取 `result.videos[0]`；无任务 ID、完成但无视频、无效 JSON 或非对象响应返回 `502`。
9. 上游 `400/401/402/404/502/504` 的状态码和错误信息被保留。
10. 日志不包含 Bearer Token、提示词或素材 URL。

### 绿灯一：最小适配器

只参考 `kik-seedance-adapter` 的单服务结构创建：

```text
boyesir-video-adapter/
├── src/main.py
├── tests/test_main.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md
```

使用 FastAPI、httpx 和标准库完成静态模型白名单、请求校验、字段翻译、状态翻译与错误透传。不增加数据库、任务缓存、Webhook、`/content` 代理、重试框架或新依赖。

### 红灯二：App 注册测试

价格、比例和素材上限确认后，先扩展现有 `creationMediaPlan.test.ts` 与 `creationMediaRuntime.test.ts`，要求：

- 两个模型都使用 `directVideo()`、`/v1/videos`、`newapi-task` 和 `newapi-upload`。
- 合同状态为 `partial`，真实生产验收后才能改为 `verified`。
- 时长为 `4–30`，分辨率只有 `720p`。
- Runtime 保持现有请求构造和轮询，不新增 Boyesir 条件分支。

### 绿灯二：模型注册

只在现有模型注册表中增加两个 `directVideo()` 条目，并填写已确认的真实价格、比例与素材限制。若这些数据仍缺失，则适配器可以完成，但模型不得进入创作面板和 NewAPI 正式渠道。

## 5. NewAPI 与部署计划

1. 部署独立适配器并加入现有 NewAPI 内网。
2. 复制一个 OpenAI 渠道做临时验证，Base URL 指向适配器内网地址，只配置一个 Boyesir Key。
3. 临时渠道只开放首批两个模型；不改正式渠道，直到生产验收完成。
4. 价格必须以 Boyesir 控制台实时价格为依据，再配置 NewAPI 倍率并核对实际扣费。

## 6. 验收门禁

自动验证：

```text
python -m unittest discover -s boyesir-video-adapter/tests
pnpm run test:focused
pnpm run typecheck
git diff --check
```

生产验证按最低成本依次执行：

1. 每个模型各提交一次最低时长、纯文本任务，取得任务 ID、轮询完成并确认 MP4 保存到项目。
2. 只有确认该模型素材合同后，才执行图片参考任务；不拿其他 Seedance 型号的能力代替验证。
3. 核对 NewAPI 扣费与 Boyesir 上游实际扣款；失败任务核对退款结果。
4. 确认完成视频在 Boyesir 24 小时过期后仍可从项目打开。

真实部署、生成、落盘、扣费和退款没有执行前，不得登记为已通过。

## 7. 明确不做

- 不接入 Boyesir 其他模型。
- 不处理 RH 三个模型。
- 不继续修改 MiniMax。
- 不修改 NewAPI 源码或 App 公共轮询器。
- 不增加 `/content` 代理、Base64 / multipart、数据库、任务缓存或 Webhook。
- 本 TDD 阶段不部署、不发付费请求、不注册未定价模型。

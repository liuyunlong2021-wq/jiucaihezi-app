# 韭菜盒子 Fk 渠道 Seedance / MiniMax H3 视频 API 对外接入

> 本文面向第三方调用方，说明如何通过韭菜盒子 NewAPI 调用 Fk 渠道 Seedance 与 MiniMax H3 视频模型。调用方使用韭菜盒子 API Key；Fk 供应商 Key 保存在平台渠道配置中，不向调用方提供。
>
> **接入状态：** Fk 插件及渠道由用户配置。本文参数表按用户提供的上游模型目录和已登记的插件合同整理。真实公网生成、各模型参数组合、实际扣费/退款及成片下载尚未逐项验收，生产返回值和账户明细优先。

## 1. 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 查询可用模型 | `GET /v1/models` |
| 创建视频任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 下载成片 | `GET /v1/videos/{task_id}/content` |
| 认证 | `Authorization: Bearer <韭菜盒子 API Key>` |
| 请求格式 | JSON（`application/json`） |
| NewAPI 插件 | `fk`，协议 `openai_video` |

`task_id` 指 NewAPI 创建响应中的任务 ID。不要拿 Fk 上游任务号或上游标准接口的 `jobId` 代替。调用方不需要也不应发送 Fk 供应商 API Key、`X-Public-Model-Ids` 等上游鉴权信息。

## 2. 查询可用模型

```bash
export JIUCAI_API_KEY='<你的韭菜盒子 API Key>'

curl 'https://api.jiucaihezi.studio/v1/models' \
  -H "Authorization: Bearer $JIUCAI_API_KEY"
```

以该 API Key 实际返回的模型列表为准。创建任务时，`model` 必须填写下表中的完整模型 ID，不能填展示名称。模型是否出现在列表中还受账号权限和 NewAPI 渠道状态影响。

## 3. 模型、参数与对外价格

价格是当前为调用方配置的人民币价格，不等同于 Fk 上游采购价；NewAPI 账户明细是实际扣费依据。所列时长、画幅与分辨率必须按所选模型组合传入。

| 模型 ID（请求 `model`） | 展示名称 | 分辨率 | 时长 | 画幅 | 参考素材上限 | 对外价格 |
| --- | --- | --- | --- | --- | --- | --- |
| `ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563` | 特价渠道-Seedance2.5满血720p(30图) | 720p | 4–30 秒 | 16:9、9:16、1:1、4:3、3:4、21:9 | 图片 30；视频 0；音频 0 | ¥0.1/秒 |
| `ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70` | 特价渠道Seedance2.5满血720p(可过真人) | 720p | 15 或 30 秒 | 16:9、9:16、1:1、4:3、3:4 | 图片 9；视频 0；音频 0 | ¥0.4/秒 |
| `ft-video-v1-bdf45387433ac0a9042ebab3fae0299d` | 长期特惠Seedance2.5满血720p | 720p | 固定 30 秒 | 16:9、9:16、1:1、4:3、3:4、21:9 | 图片 30；视频 10；音频 10；提示词最多 6000 字符 | ¥0.2/秒 |
| `ft-video-v1-69ef4c70291248a25c8198cd1c7c9c1f` | XZ-Seedance 2.5 720p(9图参考) | 720p | 4–30 秒 | 9:16、16:9、1:1、4:3、3:4 | 图片 9；视频 0；音频 0 | ¥0.1/秒 |
| `ft-video-v1-7393b0529b788d532d031dcac5e820cb` | XN1-Seedance 2.5满血 480-720p | 480p、720p | 4–30 秒 | 21:9、16:9、4:3、1:1、3:4、9:16 | 图片 30；视频 10；音频 10；提示词最多 15000 字符 | 480p ¥0.5/秒；720p ¥1/秒 |
| `ft-video-v1-9f4e77de6c05f3c360c1c0b9938a44a4` | XN2-Seedance 2.5满血 480-720p | 480p、720p | 4–29 秒 | 16:9、9:16、1:1、4:3、3:4、21:9 | 图片 30；视频 0；音频 10；提示词最多 9999 字符 | 480p ¥0.5/秒；720p ¥0.8/秒 |
| `ft-video-v1-451adae35b0c4a3d275c2c46394abc98` | 官方渠道-Seedance2.5满血720p | 720p | 4–30 秒 | 16:9、9:16、1:1、21:9、4:3、3:4 | 图片 30；视频 10；音频 10 | ¥1/秒 |
| `ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746` | 特价渠道 MiniMax H3-768p | 768p | 1–15 秒 | 16:9、4:3、1:1、3:4、9:16 | 图片 9；视频 0；音频 3 | 对外 ¥0.08/秒；上游目录价 ¥0.06/秒 |

参数表来自用户提供的当前上游目录。目录未列出的提示词长度限制不代表无限制；上游未来可能调整账号可用模型或参数，提交时仍会由上游校验。XZ Seedance 2.0「933全参」ID `ft-video-v1-b92bdf13b031fea6d7e80431def22584` 不在当前 Fk 插件白名单内，不能通过本文接口调用。

## 4. 创建视频

### 请求

```http
POST /v1/videos
Authorization: Bearer <韭菜盒子 API Key>
Content-Type: application/json
```

### Seedance 示例

```bash
curl 'https://api.jiucaihezi.studio/v1/videos' \
  -H "Authorization: Bearer $JIUCAI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "model": "ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563",
    "prompt": "雨夜霓虹街道，骑手穿过积水，电影感冷色调",
    "ratio": "16:9",
    "duration": 5,
    "resolution": "720p",
    "imageUrls": ["https://example.com/reference.png"]
  }'
```

### MiniMax H3-768p 示例

以下示例参数与当前上游目录一致。图片和音频可以按需省略或传 URL 数组；该模型不接受参考视频。

```bash
curl 'https://api.jiucaihezi.studio/v1/videos' \
  -H "Authorization: Bearer $JIUCAI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "model": "ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746",
    "prompt": "根据参考图生成一段自然流畅的短视频",
    "ratio": "16:9",
    "duration": 5,
    "resolution": "768p",
    "imageUrls": ["https://example.com/reference.png"],
    "audioUrls": []
  }'
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 上表中的完整模型 ID。 |
| `prompt` | string | 是 | 视频提示词；模型如果设有长度限制，遵循模型表。 |
| `duration` | number | 按模型 | 生成时长，单位秒。也接受 `seconds` 别名。必须使用该模型支持的时长。 |
| `resolution` | string | 按模型 | 分辨率/画质，例如 `480p`、`720p`、`768p`。必须与所选模型匹配。 |
| `ratio` | string | 按模型 | 画面比例。也接受 `aspect_ratio` 别名。必须使用模型表中的比例。 |
| `imageUrls` | string[] | 否 | 参考图片公网 URL。也接受 `images`、`image_urls`、`imageUrl`、`image_url`、`image`。 |
| `videoUrls` | string[] | 否 | 参考视频公网 URL。也接受 `video_urls`、`videoUrl`、`video_url`、`video`；仅限支持参考视频的型号。 |
| `audioUrls` | string[] | 否 | 参考音频公网 URL。也接受 `audio_urls`、`audioUrl`、`audio_url`、`audio`；仅限支持参考音频的型号。 |

每个素材字段可以传 URL 字符串数组，也可以传单个 URL；插件还接受 `{ "url": "https://..." }` 形式的数组元素。素材须能由服务端访问。不要传本机路径、`file:`、`data:` URL、需要登录的网页或无法直连的分享页面。NewAPI 对外接口当前要求 JSON，不承诺支持 multipart 本地文件上传；如使用本地文件，须先上传到可供服务端访问的 HTTPS 地址。

参考素材的可用种类和数量按模型表限制。不同模型对音频/图片组合可能还有上游条件，超出组合限制会由上游拒绝。不要把一个模型的参数套到其他模型上。

## 5. 创建响应与任务 ID

创建任务是异步操作。插件会将 NewAPI 任务编号返回在 `id` 字段中；保存该值，并将其用于后续查询和内容下载。不要使用 Fk 上游 `jobId` 或 `taskId`。

```json
{
  "id": "<newapi_task_id>",
  "object": "video",
  "status": "queued",
  "progress": 0,
  "created_at": 0
}
```

上面是字段形态示意，不保证每个响应都包含所有字段。收到 `queued` 只表示任务已受理，不代表视频已完成。接口成功响应也不等于生成成功。

## 6. 查询任务状态

```bash
curl 'https://api.jiucaihezi.studio/v1/videos/<NEWAPI_TASK_ID>' \
  -H "Authorization: Bearer $JIUCAI_API_KEY"
```

| `status` | 含义 | 调用方动作 |
| --- | --- | --- |
| `queued` | 已受理/排队 | 稍后继续查询。 |
| `in_progress` | 生成中 | 稍后继续查询。 |
| `completed` | 已完成 | 下载成片。 |
| `failed` | 任务失败 | 查看 `error`，停止轮询。 |
| `unknown` | 上游状态未被插件识别 | 保存任务 ID 和响应，联系平台排查。 |

建议每 10–30 秒查询一次；如账号或服务端另有轮询间隔提示，按提示执行。HTTP 200 只表示查询请求成功，必须检查任务 `status`。查询失败可在退避后重试；不要因创建请求超时就直接重复提交付费生成任务。

```json
{
  "id": "<newapi_task_id>",
  "object": "video",
  "status": "completed",
  "progress": 100,
  "video_url": "<平台返回的成片地址>"
}
```

失败响应可能带有 `error`；错误对象或字段形态以实际 NewAPI 返回为准。保存完整响应和任务 ID，便于平台定位。

## 7. 下载成片

任务 `status` 为 `completed` 后，通过 NewAPI content 接口下载：

```bash
curl --location \
  'https://api.jiucaihezi.studio/v1/videos/<NEWAPI_TASK_ID>/content' \
  -H "Authorization: Bearer $JIUCAI_API_KEY" \
  --output result.mp4
```

接口返回视频二进制，不要按 JSON 保存。优先使用这个带鉴权的平台代理接口，不要自行拼接 Fk 上游下载地址。`Range`、`HEAD`、断点续传和下载链接有效期尚未验收；客户端应检查 HTTP 状态和 `Content-Type`，避免把 JSON/HTML 错误响应保存成视频文件。

## 8. 计费口径

固定单价模型按用量字段 `seconds` 计费，当前表达式形态为：

```text
tier("base", u("seconds") * <该模型每秒费率>)
```

XN1/XN2 按分辨率分别使用 `seconds_480p` 与 `seconds_720p`。NewAPI 中各模型的表达式和价格应与本页表格一致；本页费率记录的是对外价格，真实扣费以当前 NewAPI 定价配置及账单明细为准。H3-768p 上游目录价为 ¥0.06/秒，对外设置为 ¥0.08/秒。

插件提交时按请求的 `duration` 提取秒数；任务完成响应若提供实际 `duration`/`seconds`，会用实际值更新用量。价格表和成功响应不等于扣费验收。失败退款、实际用量修正及每个型号的最终实扣尚未逐项核对，请以账户账单为准。

## 9. 错误处理与重试

| HTTP 状态/任务结果 | 常见原因 | 建议 |
| --- | --- | --- |
| `400` | 模型 ID、提示词、参数类型或规格组合错误 | 按模型表修正参数后再提交。 |
| `401` | API Key 缺失、无效或已停用 | 检查韭菜盒子 API Key。 |
| `402` | 余额不足 | 检查调用账号余额。 |
| `403` | 账号没有模型/任务权限 | 确认账号权限及模型是否开放。 |
| `404` | 任务不存在或不属于当前账号 | 使用创建响应中的 NewAPI `id`，并使用同一个账号 Key。 |
| `409` | 任务尚未完成或视频暂不可读 | 先查询状态，稍后重试下载。 |
| `429` | 请求频率或并发限制 | 降低请求频率；只对查询做退避重试。 |
| `5xx` / 网络超时 | 平台或上游暂时不可用 | 查询请求可以稍后重试；创建请求不要盲目重发。 |
| `status: failed` | 上游任务生成失败 | 保存任务 ID 和错误原文；退款/扣款以账单为准。 |

具体错误状态和字段由 NewAPI、插件宿主及上游共同决定，表格是排查指南而非对每个错误响应的保证。上游文档不保证 `Idempotency-Key` 或重复 POST 自动去重；创建响应丢失时先查已有任务或联系平台，不要自动重新生成。

## 10. 安全与验收边界

- API Key 只放服务端环境变量或密钥管理器，不放在浏览器代码、公开仓库、截图或日志中；供应商 Key 不提供给调用方。
- NewAPI 对外请求与 Fk 上游接口不是同一套地址和认证。调用方使用本页 Base URL、韭菜盒子 API Key 和 `/v1/videos` 路径；上游 `/api/open/v1/video/generate`、上游 Key 和 `X-Public-Model-Ids` 不用于此接入。
- 用户已确认插件上传和渠道配置；本页记录的是登记合同。真实公网出片、各参数组合、扣费、失败退款、Range/HEAD 尚未完成逐项验收。
- 如需新增模型，先将模型 ID 加入 Fk 插件 `meta.models` 并上传生效，再同步创作面板可用性和本页模型合同。

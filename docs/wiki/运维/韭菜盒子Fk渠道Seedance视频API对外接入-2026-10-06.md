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

以该 API Key 实际返回的模型列表为准。插件 0.3.2 与当前面板支持中文公开名提交，渠道模型列表和模型映射必须同步；长期特惠公开名为“长期特惠 Seedance 2.5 满血 720p”。真实 ID 仍由插件识别，但仅在渠道也登记真实 ID 时才可直接请求。完整映射见 [[运维/FK-Seedance2.5模型与标准视频合同对齐-2026-10-14]]。模型权限与启用状态以生产配置为准。

## 3. 当前型号与上游参考价格

2026-10-14 源码已对齐六个 Seedance 2.5 型号；插件 0.3.0 尚待上传、渠道映射与 Task Usage 同步及生产验收。下面是 FK 上游参考价，不代表韭菜盒子实际对外售价；可调用型号与扣费以生产 /v1/models 和账户明细为准。历史四个旧 ID 不再作为新提交推荐。

| 模型 ID（请求 model） | 官方显示名 | 分辨率 | 时长 | 画幅 | 参考素材上限 | 上游参考价 |
| --- | --- | --- | --- | --- | --- | --- |
| `ft-video-v1-89e87205d3be4eb2cf3fda249569e693` | 特价渠道 Seedance 2.5 满血 720p | 720p | 30 秒 | 16:9、9:16、1:1、4:3、3:4 | 9 图、0 视频、0 音频 | ¥2.1/次 |
| `ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70` | 特价渠道 Seedance 2.5 满血 720p（可过真人） | 720p | 15、30 秒 | 16:9、9:16、1:1、4:3、3:4 | 9 图、0 视频、0 音频 | ¥3.5/次 |
| `ft-video-v1-bdf45387433ac0a9042ebab3fae0299d` | 长期特惠 Seedance 2.5 满血 720p（量大长期稳定，不保售后） | 720p | 30 秒 | 16:9、9:16、1:1、4:3、3:4、21:9 | 30 图、10 视频、10 音频；提示词最多 6000 字符 | ¥2.5/次 |
| `ft-video-v1-b8a797753dd4c6bf8e5a69820b293848` | Seedance 2.5 满血 480-720p | 480p、720p | 4–30 秒 | 16:9、9:16、1:1、4:3、3:4 | 30 图、10 视频、10 音频；提示词最多 10000 字符 | 480p ¥0.35/秒；720p ¥0.4/秒 |
| `ft-video-v1-756e0feb4b3e1f893726314109762123` | XN2-Seedance 2.5 满血 480-720p | 480p、720p | 15–30 秒 | 16:9、9:16、4:3、3:4、1:1 | 30 图、0 视频、10 音频；提示词最多 10000 字符 | 480p ¥0.35/秒；720p ¥0.4/秒 |
| `ft-video-v1-451adae35b0c4a3d275c2c46394abc98` | 官方渠道-Seedance 2.5 满血 720p | 720p | 4–30 秒 | 16:9、9:16、1:1、21:9、4:3、3:4 | 30 图、10 视频、10 音频 | 无视频参考 ¥0.85/秒；有视频参考 ¥31.5/百万 Token |
| `ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746` | 特价渠道 MiniMax H3-768p | 768p | 1–15 秒 | 16:9、4:3、1:1、3:4、9:16 | 9 图、0 视频、3 音频 | 既有对外 ¥0.08/秒；上游 ¥0.06/秒 |

官方型号有视频参考时需要等待 Token 结算，任务未返回视频时不要重复提交。NewAPI 返回的任务 ID 仍用于公网查询和下载。生产激活、计费表达式及历史兼容见 [[运维/FK-Seedance2.5模型与标准视频合同对齐-2026-10-14]]。目录未声明限制不代表无限制；最终规格以当前账号目录为准。

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
    "model": "Seedance 2.5 满血 480-720p",
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

插件 0.3.0 按模型区分按次、按秒和 Token 用量。以下是表达式结构，系数必须使用 NewAPI 对外售价对应的计价货币；本页上游人民币参考价不能直接代入美元系数：

```text
按次：tier("base", u("calls") * <每次售价系数>)
分辨率按秒：tier("base", u("seconds_480p") * <480p系数> + u("seconds_720p") * <720p系数>)
官方：tier("base", u("seconds") * <每秒系数> + u("video_reference_tokens") * <每Token系数>)
```

特价、可过真人、长期特惠三个型号使用 calls；普通 480–720p 与 XN2 使用分辨率秒数。官方型号无参考视频按秒，有参考视频按实际 Token；完成时秒数归零，避免重复计费。H3 仍使用 seconds。upstream_cost_yuan 只用于核对上游实际费用。

官方 Token 任务在 NewAPI 预授权时先按请求秒数估扣，完成后按实际 Token 重算；FK 自身的 Token 预扣属于上游账单。新版插件必须与渠道 Task Usage 同步激活；旧 seconds-only 表达式会错误计费。当前未执行生产定价更新、实际补扣/退款验收，请以账户账单为准。详细激活步骤见 [[运维/FK-Seedance2.5模型与标准视频合同对齐-2026-10-14]]。

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

## 11. 2026-10-29 新增三型号（插件 0.7.0）

以下三型号对用户的售价由用户提供；型号、参数与上限以插件 `catalog` 为准，面板自动跟随，App 无需发版。未上传激活、未配置渠道模型名与表达式、未做真实生成与扣费核对前，不以本节作为生产可用证据。

| 公开模型名（请求 `model`） | 上游 ID | 画质 · 时长 | 比例 | 图/视频/音频上限 | 售价 | Task Usage 表达式 |
| --- | --- | --- | --- | --- | --- | --- |
| `特价渠道 Seedance 2.5 满血 720p（9图）` | `ft-video-v1-1795bf4b67ce998dbfd8ab55cf838d93` | 720p · 固定 15 秒 | 16:9、9:16 | 9/0/0 | 2 元/次 | `tier("base", u("calls") * 2)` |
| `特价渠道 Seedance 2.5 满血 480p（10图）` | `ft-video-v1-d69cdf94c9ed6d80ef7ec6ebf00f74ff` | 480p · 4–30 秒（默认 30） | 16:9、9:16、1:1、4:3、3:4 | 10/0/3 | 3.5 元/次 | `tier("base", u("calls") * 3.5)` |
| `特价渠道 Seedance 2.5 满血 720-1080p（全能参考）` | `ft-video-v1-22c418bc12d30fcc1bde650b2bc9727b` | 720p、1080p · 4–30 秒（默认 30） | 16:9、9:16、1:1、4:3、3:4 | 30/10/10 | 720p 8 元/次、1080p 12 元/次 | `tier("base", u("calls_720p") * 8 + u("calls_1080p") * 12)` |

三个型号都是按次收费（用户 2026-10-29 确认，8 元 / 12 元为每次任务价格，与实际时长无关），因此面板默认时长取该型号最大值（固定档 15 秒；480p（10图）与全能参考均为 4–30 秒、默认 30 秒）；既有 933 型号同样改为默认 15 秒。

第三个型号按次但按画质定价，插件按 `calls_720p` / `calls_1080p` 各计一次调用，不能用 `u("calls")` 单系数（会把 1080p 按 720p 收）。该形状超出可用性服务的表达式换算范围，面板价格回退到目录 `price` 文案。详见 [[运维/FK六视频型号收敛与计费合同-2026-10-24]]。

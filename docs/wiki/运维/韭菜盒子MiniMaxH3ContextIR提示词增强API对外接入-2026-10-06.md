# 韭菜盒子 MiniMax H3 Context IR 提示词增强 API

> 本文档是韭菜盒子 API 的第三方接入说明。接口接收文本及可选图像、视频、音频上下文，返回 MiniMax H3 增强后的视频提示词；**不会生成视频**。
>
> **接入状态：基础链路已完成公网验收。** 已通过纯文本、后台任务模式的创建与轮询，成功取回非空增强提示词。官方上游合同于 2026-10-10 复核。多模态输入、同步模式、流式模式、回调通知以及 `usage` 与实际结算的对账尚未完成专项验收。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建增强任务 | `POST /v1/responses` |
| 查询任务与结果 | `GET /v1/responses/{response_id}` |
| 模型名 | `MiniMax-H3-Context-IR` |
| 认证 | `Authorization: Bearer <韭菜盒子 API Key>` |
| 请求格式 | `application/json` |
| 协议 | OpenAI Responses API 兼容；`content`、`duration`、`ratio`、`callback_url` 为本模型支持的扩展字段 |

请使用韭菜盒子发放且已开通该模型权限的 API Key。MiniMax 上游密钥由服务端渠道管理，客户端不需要也不应传 MiniMax 密钥。

## 兼容范围与验收状态

| 能力 | 当前说明 |
| --- | --- |
| 后台任务 | 推荐使用；纯文本创建、轮询和非空结果已完成公网验收。 |
| 同步响应 | 网关插件声明支持；尚未专项验收。 |
| 流式响应 | 网关插件声明支持；尚未专项验收。 |
| 图像、视频、音频输入 | 插件按上游格式转发；仅有上游规格依据，尚未完成公网多模态验收。 |
| `callback_url` | 转发给 MiniMax，由 MiniMax 直接回调调用方；尚未专项验收。 |
| 计费 | 已验收样例的 `usage` 为 0，尚未与账户结算记录对账；请勿据此推算价格。 |

“插件声明支持”表示网关已实现对应协议分支，不代表该形态已完成公网验收。需要稳定接入时，请优先采用下方已验收的纯文本后台任务模式。

## 快速开始

推荐使用后台任务模式：创建接口快速返回响应 ID，之后轮询直到任务完成。

```bash
curl --location 'https://api.jiucaihezi.studio/v1/responses' \
  --header 'Authorization: Bearer <YOUR_JIUCAIHEZI_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "MiniMax-H3-Context-IR",
    "background": true,
    "content": [
      {
        "type": "text",
        "text": "一名女舰长留在空荡的舰桥，舰队跃迁离去，强光爆闪，舰桥震动。"
      }
    ],
    "duration": 5,
    "ratio": "16:9"
  }'
```

创建成功后，保存响应中的 `id`，用于查询：

> 必须使用顶层 `id`（`resp_...`）作为 `{response_id}`。`metadata.task_id`（`task_...`）是另一种 ID，不能用于 `GET /v1/responses/{response_id}`。

```bash
curl --location 'https://api.jiucaihezi.studio/v1/responses/<RESPONSE_ID>' \
  --header 'Authorization: Bearer <YOUR_JIUCAIHEZI_API_KEY>'
```

下面只展示读取任务所需的关键字段，完整响应可能包含其他 Responses API 字段：

```json
{
  "id": "resp_<response_id>",
  "status": "completed",
  "metadata": {
    "task_id": "task_<upstream_task_id>"
  },
  "output": [
    {
      "type": "message",
      "content": [
        { "type": "output_text", "text": "<增强后的视频提示词>" }
      ]
    }
  ]
}
```

任务成功时，须同时确认 `status` 为 `completed` 且 `output[].content[]` 中 `type` 为 `output_text` 的 `text` 非空。`metadata.task_status` 可辅助排查任务状态，但不能替代对最终输出文本的检查。响应文本就是增强后的提示词，可交给后续视频生成模型。

截至本次基础链路验收，成功响应的 `usage` 字段返回了 0；其与实际费用结算的关系尚未对账。不要用 `usage` 判断任务是否成功或推断实际费用，费用以韭菜盒子账户的结算记录为准。

## 创建请求

### 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 固定使用 `MiniMax-H3-Context-IR`。 |
| `background` | 建议 | 建议为 `true`，使用后台任务并通过 `GET /v1/responses/{response_id}` 查询。 |
| `content` | 多模态请求必填 | MiniMax H3 Context IR 原生上下文数组，见下方素材输入。数组必须包含至少一个非空 `text` 项。 |
| `input` | 仅纯文本便捷输入 | 纯文本或文本数组。未提供 `content` 时，插件会将可识别的文本整理为 `content: [{"type":"text","text":"..."}]`。 |
| `prompt` | 仅纯文本便捷输入 | `content`、`input` 均未提供时使用。多模态输入请使用 `content`。 |
| `duration` | 是 | 目标视频时长，整数 `4`–`15` 秒。 |
| `ratio` | 文生视频必填 | 见下方画幅规则。图生视频和多模态参考生视频可省略。 |
| `callback_url` | 否 | 可选的任务状态回调 URL，行为见「回调通知」。 |

### 文生视频提示词增强

`content` 仅包含一个非空文本项；必须提供具体画幅，不能使用 `adaptive`。

```json
{
  "model": "MiniMax-H3-Context-IR",
  "background": true,
  "content": [
    { "type": "text", "text": "雨夜的老街上，一名侦探撑伞走进霓虹灯下。" }
  ],
  "duration": 6,
  "ratio": "9:16"
}
```

### 首帧、尾帧或首尾帧提示词增强

图像的 `role` 可为 `first_frame`、`last_frame`。单张首帧图也可省略 `role`；省略时按首帧处理。画幅由帧图决定，插件会向上游传 `adaptive`。

```json
{
  "model": "MiniMax-H3-Context-IR",
  "background": true,
  "content": [
    { "type": "text", "text": "镜头从人物站在门口开始，缓慢推近；人物走进房间并在窗边停下。" },
    { "type": "image_url", "role": "first_frame", "image_url": { "url": "https://example.com/first.jpg" } },
    { "type": "image_url", "role": "last_frame", "image_url": { "url": "https://example.com/last.jpg" } }
  ],
  "duration": 8
}
```

首尾帧最多各一张。首帧/尾帧模式不能和多模态参考素材混用。

### 多模态参考提示词增强

多模态参考模式支持参考图、参考视频和参考音频的组合。参考图需标记 `reference_image`；参考视频和音频需分别标记 `reference_video`、`reference_audio`。

```json
{
  "model": "MiniMax-H3-Context-IR",
  "background": true,
  "content": [
    { "type": "text", "text": "保持图1人物外观，参考视频的运镜节奏，并采用参考音频的氛围。" },
    { "type": "image_url", "role": "reference_image", "image_url": { "url": "https://example.com/character.png" } },
    { "type": "video_url", "role": "reference_video", "video_url": { "url": "https://example.com/camera-reference.mp4" } },
    { "type": "audio_url", "role": "reference_audio", "audio_url": { "url": "https://example.com/mood-reference.mp3" } }
  ],
  "duration": 10,
  "ratio": "adaptive"
}
```

参考图也可以显式设置一个具体画幅；未设置时默认为 `adaptive`。多模态参考素材不能与 `first_frame` / `last_frame` 同时出现。

## `content` 输入格式与限制

每个请求至少包含一个非空文本项。插件支持的元素类型与用途如下：

| `type` | 用途 | `role` |
| --- | --- | --- |
| `text` | 提示词文本 | 不需要 |
| `image_url` | 首帧、尾帧或参考图 | `first_frame`、`last_frame`、`reference_image`；首帧图可省略并按 `first_frame` 处理 |
| `video_url` | 多模态参考视频 | 必须为 `reference_video` |
| `audio_url` | 多模态参考音频 | 必须为 `reference_audio` |

媒体 URL 可以写成字符串或 `{ "url": "https://..." }`。推荐使用公网可访问的 HTTPS 文件 URL；请勿传本机路径、内网地址或需要登录后才能访问的链接。服务端不代替调用方上传媒体文件。

上游官方限制：

| 素材 | 数量与限制 |
| --- | --- |
| 请求体 | 总大小不超过 64 MB；大文件使用公网 URL，不要将大文件编码成 Base64。 |
| 图片 | JPG、JPEG、PNG、WEBP、HEIC、HEIF；单张不超过 30 MB；宽高各 256–5760 px；宽高比 0.4–2.5；首帧最多 1 张、尾帧最多 1 张、参考图最多 9 张。 |
| 视频 | MP4 或 MOV；单个不超过 50 MB，最多 3 个；每段 2–15 秒，合计不超过 15 秒；宽高各 256–5760 px，宽高比 0.4–2.5，帧率 23.976–60 fps；视频编码 H.264/AVC 或 H.265/HEVC，音频编码 AAC 或 MP3。 |
| 音频 | WAV 或 MP3；单个不超过 15 MB，最多 3 段；每段 2–15 秒，合计不超过 15 秒。 |

插件在创建前检查元素类型、URL 字段、角色、数量、模式互斥、时长与画幅。图片尺寸、媒体编码、时长和实际可访问性由 MiniMax 上游读取素材后校验；不符合上游限制的任务会以错误结束。

## 时长与画幅

`duration` 必须为 4–15 之间的整数，包括 4 和 15。

| 输入场景 | `ratio` 规则 |
| --- | --- |
| 文生视频（只有 `text`） | 必填；可用 `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；不能用 `adaptive`。 |
| 首帧/尾帧图生视频 | 可省略；插件统一传 `adaptive`，画幅由输入帧图决定。 |
| 多模态参考生视频 | 可省略，默认 `adaptive`；也可指定 `21:9`、`16:9`、`4:3`、`1:1`、`3:4` 或 `9:16`。 |

## 任务查询与结果

后台任务创建后，使用返回的响应 `id` 查询：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/responses/<RESPONSE_ID>' \
  --header 'Authorization: Bearer <YOUR_JIUCAIHEZI_API_KEY>'
```

任务状态按 Responses API 返回。常见状态包括 `queued`、`in_progress`、`completed` 和 `failed`。轮询间隔建议从 3–5 秒开始；遇到限流时拉长间隔。成功时读取最终输出消息中非空的文本内容，失败时读取响应中的错误信息。仅有 `completed` 但输出文本为空时，不应继续提交视频任务，应记录响应 ID 并联系韭菜盒子支持。此 API 的输出是**提示词文本**，没有视频文件，也没有视频下载接口。

如使用 `stream: true`，可消费 Responses 流式事件；需要能够处理进度事件，并在收到最终输出后结束读取。第三方集成若不需要实时输出，优先使用后台模式加轮询。

## 回调通知

传入 `callback_url` 后，插件会把它转发给 MiniMax。MiniMax 会先向该地址发送包含 `challenge` 的验证请求；接收端必须在 3 秒内原样返回 `challenge`。验证成功后，任务每次状态变化都会收到 POST 通知，通知体结构与官方查询任务响应一致，终态为 `succeeded`、`failed` 或 `cancelled`。

回调由 MiniMax 服务直接发送给 `callback_url`，不是由韭菜盒子 API 代发。建议第三方同时保留任务查询作为补偿方式，并对重复回调做幂等处理。

## 错误处理

请求字段或组合不符合插件合同会在提交前拒绝。上游可能返回以下 HTTP 状态：

| HTTP 状态 | 含义与处理 |
| --- | --- |
| `400` | 参数不合法，例如缺少文本、时长/比例不支持、素材角色冲突。修正请求后再创建任务。 |
| `401` | API Key 无效或未正确传入。 |
| `402` | 额度或余额不足；结合错误正文和账户记录确认是调用额度还是上游账户余额。 |
| `422` | 内容审核拒绝。修改输入后再试。 |
| `429` | 请求限流。降低并发并延迟重试；避免重复创建任务。 |
| `5xx` | 上游或网关暂时不可用。若创建请求未返回响应 ID，确认任务是否已创建后再重试，避免重复扣费。 |

上游错误响应可能包含 `error.message` 和 `request_id`。网关可能会将其包装为统一错误格式；客户端应同时检查 HTTP 状态码和错误响应体。创建接口返回成功仅表示任务已受理，增强结果要等查询状态变为 `completed` 后读取。

## 使用边界

- 此接口只做 H3-Context-IR 提示词增强；后续视频生成需由调用方另行调用视频生成 API。
- 请求中的素材 URL 会传给 MiniMax 上游处理。请只提交有权使用的素材，并确保上游可以访问。
- 本文不承诺具体增强耗时、并发量、保留期限或价格；以账号权限、服务状态和实际套餐为准。
- 本接口当前通过 Responses 协议暴露；尚无独立的 MiniMax 风格 `POST /v2/h3_context_ir` 公共路由，也未提供对上游任务的取消路由。

## 官方接口参考

- [MiniMax 创建 H3-Context-IR 任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-h3-context-ir)
- [MiniMax 查询任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query)
- [MiniMax 查询任务列表](https://platform.minimax.cn/docs/api-reference/video-generation-v2-list)

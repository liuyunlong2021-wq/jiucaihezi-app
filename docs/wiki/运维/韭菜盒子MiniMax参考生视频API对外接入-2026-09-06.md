# 韭菜盒子 MiniMax 参考生视频 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含上游服务、内部适配器或密钥信息。
>
> 适用对象：需要通过第三方客户端调用 `minimax_h3_image_audio_to_video_v2_15s` 或 `minimax_h3_zm_u24` 的用户。
>
> 2026-09-12 起：创建接口立即返回任务 ID，参考素材转存和上游提交在响应之后进行；素材类失败改在任务状态里体现，不再占用创建接口的 HTTP 状态码。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建视频 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 下载成片 | `GET /v1/videos/{task_id}/content` |
| 上传参考素材 | `POST /api/creations/uploads` |
| 认证 | `Authorization: Bearer <你的 API Key>` |

### 模型与计价

| 模型名 | 说明 | 计价 | 支持的 `resolution` | 默认时长 |
| --- | --- | --- | --- | --- |
| `minimax_h3_image_audio_to_video_v2_15s` | 参考生视频 | `0.08/秒` | `480p竖`、`768p竖`、`480p横`、`768p横` | 15 秒 |
| `minimax_h3_zm_u24` | 参考生视频增强版 | `0.1/秒` | `480p竖`、`768p竖`、`480p横`、`768p横`、`480p(1:1)`、`768p(1:1)` | 5 秒 |

两个模型的请求字段、素材数量上限和时长范围完全相同，只有上表的三个差异。`duration` 不传时按上表的默认值计费，**建议显式传**。

## 创建任务

接口为异步接口，成功后返回任务 ID。第三方客户端只需要连接上面的 Base URL。

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "minimax_h3_image_audio_to_video_v2_15s",
    "prompt": "人物随着音乐节奏自然地弹奏钢琴，电影感光影",
    "duration": 5,
    "resolution": "768p竖",
    "images": [
      "https://example.com/reference.png"
    ],
    "audios": [
      "https://example.com/reference.mp3"
    ]
  }'
```

最小响应示例：

```json
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "minimax_h3_image_audio_to_video_v2_15s",
  "status": "queued",
  "progress": 0
}
```

创建成功只表示请求已被受理：参考素材的转存和上游提交在这之后进行。因此刚创建时轮询会先看到 `queued`，这是正常状态；轮询和下载始终使用创建时返回的 `id`。

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | `minimax_h3_image_audio_to_video_v2_15s` 或 `minimax_h3_zm_u24`，其它值返回 400。 |
| `prompt` | 是 | 视频内容描述，最多 12,000 个字符。 |
| `duration` | 否 | 视频时长，1–15 秒；不传时按模型默认值（15 秒 / 5 秒）计费，建议显式传入。也兼容 `seconds`。 |
| `resolution` | 否 | 见上方模型表；取值必须是该模型支持的枚举之一，否则 400。默认 `768p竖`。 |
| `images` | 否 | 参考图 URL 数组，最多 9 张。 |
| `audios` | 否 | 参考音频 URL 数组，最多 3 段。 |

### 比例与分辨率

菠萝模型的横竖方向由 `resolution` 的后缀决定：

- `16:9` 建议使用 `480p横` 或 `768p横`
- `9:16` 建议使用 `480p竖` 或 `768p竖`
- `1:1` 只有 `minimax_h3_zm_u24` 支持，使用 `480p(1:1)` 或 `768p(1:1)`

客户端可额外传 `ratio` 或 `aspect_ratio`，服务会据此纠正横竖方向（`16:9` 把 `竖` 纠正成 `横`，`9:16` 反向，`1:1` 纠正成 `(1:1)`）；推荐直接传与目标画幅一致的 `resolution`。

### 参考素材

参考素材必须是服务端可访问的 `http://` 或 `https://` URL，不接受本地路径或 `data:` URL。已有公网 URL 可以直接使用；本地文件先上传到韭菜盒子临时素材接口，再将返回的 URL 填入 `images` 或 `audios`。

```bash
curl --location 'https://api.jiucaihezi.studio/api/creations/uploads' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --form 'file=@./reference.png'
```

响应示例：

```json
{
  "url": "https://api.jiucaihezi.studio/media/creation/<token>"
}
```

临时素材接口支持 `image/*`、`audio/*` 和 `video/*`，单文件最大 20 MB；返回 URL 为公网 HTTPS 地址，15 分钟后自动失效。请在上传完成后 15 分钟内创建视频任务。

- 图片最多 9 张，每张不超过 20 MB
- 音频最多 3 段，每段不超过 20 MB
- 图片和音频可以同时传入，用于图片与音频参考生视频
- 每个素材链接必须在 **60 秒内**能被服务端完整读取。素材放在慢速或不稳定的服务器上时，任务会失败并在 `error.message` 中给出该素材的主机名；建议先用临时素材接口转存。
- 多个素材会并发读取，单个素材慢不会拖慢其他素材，但会单独触发上面的 60 秒超时。

## 查询任务

建议每 3 秒查询一次，直到 `status` 为 `completed` 或 `failed`：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

状态说明：

| 状态 | 含义 |
| --- | --- |
| `queued` | 已受理：正在转存参考素材，或已排队等待上游生成。 |
| `in_progress` | 生成中 |
| `completed` | 已完成 |
| `failed` | 失败，查看 `error` 字段 |

## 下载成片

完成后通过 `/content` 获取视频二进制，不要按 JSON 解析：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>/content' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --output result.mp4
```

## 错误处理

| 状态/错误 | 原因与处理 |
| --- | --- |
| `401` / `403` | API Key 缺失、错误或无模型权限。 |
| `400` | 模型名、提示词、时长、分辨率或素材字段不合法（含素材数量超过 9 张 / 3 段、素材不是 http/https URL）。在创建接口同步返回。 |
| `413` | 只在临时素材上传接口出现：单文件超过 20 MB。 |
| 任务 `status: failed` | 创建成功之后的失败：素材无法读取、单个素材超过 60 秒或 20 MB、上游提交失败、上游生成失败。都读 `error.message`；素材类失败会指出素材主机。 |
| `model_not_found` | 检查模型名是否完全正确。 |
| `model_price_error` | 管理端尚未配置该模型价格，请联系管理员。 |
| `5xx` / `502` | 服务或上游暂时不可用，稍后重试；避免重复提交大量任务。 |

## 接入边界

- API Key 只放在 `Authorization` 请求头，不要写入前端公开代码、日志或提交记录。
- 不要把渠道编号、内部适配器地址或上游地址拼入请求。
- 模型可用性、价格和最终限额以韭菜盒子 NewAPI 当前配置为准。

# 韭菜盒子 MiniMax 参考生视频 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含上游服务、内部适配器或密钥信息。
>
> 适用对象：需要通过第三方客户端调用 `minimax_h3_image_audio_to_video_v2_15s` 的用户。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建视频 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 下载成片 | `GET /v1/videos/{task_id}/content` |
| 上传参考素材 | `POST /api/creations/uploads` |
| 模型名 | `minimax_h3_image_audio_to_video_v2_15s` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 计价 | `0.08/秒` |

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

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 固定为 `minimax_h3_image_audio_to_video_v2_15s`。 |
| `prompt` | 是 | 视频内容描述，最多 12,000 个字符。 |
| `duration` | 否 | 视频时长，1–15 秒；建议显式传入。也兼容 `seconds`。 |
| `resolution` | 否 | `480p竖`、`768p竖`、`480p横`、`768p横`。 |
| `images` | 否 | 参考图 URL 数组，最多 9 张。 |
| `audios` | 否 | 参考音频 URL 数组，最多 3 段。 |

### 比例与分辨率

菠萝模型的横竖方向由 `resolution` 的后缀决定：

- `16:9` 建议使用 `480p横` 或 `768p横`
- `9:16` 建议使用 `480p竖` 或 `768p竖`

客户端可额外传 `ratio` 或 `aspect_ratio`，服务会据此纠正横竖方向；推荐直接传与目标画幅一致的 `resolution`。

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

## 查询任务

建议每 3 秒查询一次，直到 `status` 为 `completed` 或 `failed`：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

状态说明：

| 状态 | 含义 |
| --- | --- |
| `queued` | 排队中 |
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
| `400` | 模型名、提示词、时长、分辨率或素材字段不合法。 |
| `413` | 图片或音频超过数量或单文件大小限制。 |
| `model_not_found` | 检查模型名是否完全正确。 |
| `model_price_error` | 管理端尚未配置该模型价格，请联系管理员。 |
| `5xx` / `502` | 服务或上游暂时不可用，稍后重试；避免重复提交大量任务。 |

## 接入边界

- API Key 只放在 `Authorization` 请求头，不要写入前端公开代码、日志或提交记录。
- 不要把渠道编号、内部适配器地址或上游地址拼入请求。
- 模型可用性、价格和最终限额以韭菜盒子 NewAPI 当前配置为准。

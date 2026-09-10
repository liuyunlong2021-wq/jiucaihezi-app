# 韭菜盒子 Grok Imagine Image 2.0 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述第三方 APP 需要调用的接口。
>
> 注意：该模型输出图片，但当前使用异步任务端点 `POST /v1/videos`，不是 `/v1/images/generations`。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建图片任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 模型名 | `grok-imagine-image-2.0` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 生成方式 | 文生图、最多 8 张参考图 |

## 文生图

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "grok-imagine-image-2.0",
    "prompt": "一张电影感的未来城市海报，夜景，震撼光影",
    "size": "2048x1152",
    "response_format": "url"
  }'
```

## 参考图生成

有参考图时使用 `multipart/form-data`。多张图片重复提交 `image[]` 字段：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --form 'model=grok-imagine-image-2.0' \
  --form 'prompt=保留第一张的人物，融合第二张的色彩和光影风格' \
  --form 'size=2048x2048' \
  --form 'response_format=url' \
  --form 'image[]=@./subject.png' \
  --form 'image[]=@./style.jpg'
```

参考图必须是 `image/*`，最多 8 张，单张最大 20 MB，合计最大 64 MB。本地图片直接使用 multipart 上传，不要把本地路径、`file:` URL 或 `data:` URL 写入 JSON。

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 固定为 `grok-imagine-image-2.0`。 |
| `prompt` | 是 | 非空的图片描述或编辑指令。 |
| `size` | 否 | 输出像素尺寸，例如 `1024x1024` 或 `2048x1152`。 |
| `response_format` | 否 | 当前公开合同固定使用 `url`。 |
| `image[]` | 否 | 参考图文件；仅用于 `multipart/form-data`，可重复传入。 |

韭菜盒子 APP 当前提供 `1:1`、`16:9`、`9:16`、`3:2`、`2:3` 五种比例和 `1k`、`2k`、`4k` 三档分辨率。第三方 APP 应将选中的比例和分辨率换算为 `size`；常用值如下：

| 比例 | 1K | 2K | 4K |
| --- | --- | --- | --- |
| `1:1` | `1024x1024` | `2048x2048` | `2880x2880` |
| `16:9` | `1536x864` | `2048x1152` | `3840x2160` |
| `9:16` | `864x1536` | `1152x2048` | `2160x3840` |
| `3:2` | `1536x1024` | `2016x1344` | `3504x2336` |
| `2:3` | `1024x1536` | `1344x2016` | `2336x3504` |

## 创建任务响应

提交成功后返回任务 ID：

```json
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "grok-imagine-image-2.0",
  "status": "processing",
  "progress": 0,
  "created_at": 1788800000
}
```

`object` 为 `video` 是当前 NewAPI 通用异步任务协议的固定值，不代表该模型会生成视频。客户端应使用 `id` 或 `task_id` 继续查询。

## 查询任务

建议每 10 秒查询一次，直到任务完成或失败：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

状态说明：

| 状态 | 含义 |
| --- | --- |
| `queued` | 已排队 |
| `in_progress` / `processing` | 生成中 |
| `completed` | 已完成 |
| `failed` | 生成失败，查看 `error` |

完成响应示例：

```json
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "model": "grok-imagine-image-2.0",
  "status": "completed",
  "progress": 100,
  "metadata": {
    "url": "<IMAGE_URL>"
  },
  "completed_at": 1788800060
}
```

客户端从 `metadata.url` 取得图片地址并及时下载或落盘，不应假设结果 URL 永久有效。

## 错误响应

典型错误格式：

```json
{
  "error": {
    "code": "400",
    "message": "prompt is required",
    "type": "xiaoyi_image_error"
  }
}
```

| 状态/错误 | 原因与处理 |
| --- | --- |
| `400` | 模型名、提示词或请求格式不合法；修正后重试。 |
| `401` / `403` | API Key 缺失、错误或无模型权限。 |
| `413` | 参考图数量或大小超限。 |
| `model_not_found` | 检查模型名是否完全一致，以及账号是否有可用渠道。 |
| `model_price_error` | 该模型尚未配置计费价格，联系管理员。 |
| `429` | 请求过快或额度受限；降低频率后重试。 |
| `5xx` / `524` | 服务或上游暂时不可用；稍后重试，避免并发重复提交。 |

## 接入边界

- 第三方 APP 只连接 `https://api.jiucaihezi.studio`，不要使用内部适配器或上游地址。
- API Key 只放在服务端或可信本地环境的 `Authorization` 请求头中，不要写入公开前端代码、日志或提交记录。
- 只在网络超时或明确的暂时性服务错误后重试；如果已获得 `task_id`，应继续查询原任务，不要重复创建。
- 模型可用性、账号权限、价格和限额以韭菜盒子 NewAPI 当前配置为准。

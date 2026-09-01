# 韭菜盒子 Seedance 2.5 API 接口说明

> 本文档以附件《API接口说明.md》的参数和调用流程为底稿，仅按已确认的中转合同修正参考图数量和单文件大小限制，并将入口映射到韭菜盒子 NewAPI。
>
> 适用对象：希望通过韭菜盒子 NewAPI 中转站调用 Dola Seedance 2.5 的 OpenAI 兼容客户端。
>
> 本页是中转站接入说明；RunningHub 上游原始参数请参阅 [[RH-seedace25]]，两者不要混用。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建视频 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 模型名 | `dola-seedance2.5` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 计价 | `0.2/秒`，当前任务固定生成 30 秒 |
| 分辨率 | `720p`（固定，不需要额外选择） |

## 创建任务

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "dola-seedance2.5",
    "prompt": "一只橘猫在窗边伸懒腰，电影感，自然光",
    "ratio": "16:9",
    "images": [
      "https://example.com/reference-1.jpg"
    ]
  }'
```

### 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 固定为 `dola-seedance2.5` |
| `prompt` | 是 | 1-3000 个字符 |
| `ratio` | 否 | `16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9`；默认 `16:9` |
| `images` | 否 | 参考图 URL 数组，最多 30 张；每张不超过 20 MiB |

参考图必须是中转服务可以直接访问的 `http://` 或 `https://` URL，并返回 `image/jpeg` 或 `image/png`。本中转接口不接受本地路径，也不接受 Base64 Data URI。图片数量最多 **30 张**；大小限制是**每个文件单张** 20 MiB，不是所有图片合计 20 MiB。

成功提交后会返回任务 ID，例如：

```json
{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "dola-seedance2.5",
  "status": "queued",
  "progress": 0
}
```

## 查询结果

使用返回的 `task_id` 轮询：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/task_xxx' \
  --header 'Authorization: Bearer YOUR_API_KEY'
```

完成时返回 `status: "completed"` 和 `video_url`：

```json
{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "dola-seedance2.5",
  "status": "completed",
  "progress": 100,
  "video_url": "https://..."
}
```

`video_url` 的值就是上游官方响应中的 `task.url` 原始视频地址；中转站不改写、不转码，也不通过自建下载接口代理。点击或下载时直接使用这个 URL。上游结果链接是临时链接，通常只保留 24 小时，请在任务完成后尽快预览或下载。

## 常见错误

| 错误 | 原因 |
| --- | --- |
| `Unsupported Dola Seedance model` | `model` 不是 `dola-seedance2.5` |
| `Reference images must be URLs` | `images` 传入了本地路径、Base64 或其他类型 |
| `Unable to fetch reference image` | 图片 URL 对中转服务不可访问，或返回了错误状态 |
| `Only JPG, JPEG and PNG images are supported` | 参考图不是 JPEG/PNG |
| `Reference image exceeds 20 MiB` | 单张参考图超过 20 MiB |
| `Dola Seedance supports at most 30 images` | 参考图超过 30 张 |

## 与附件上游接口的映射

- 第三方客户端只连接上面的 NewAPI Base URL，不直接连接 Dola 或 RunningHub。
- 客户端发送 `model: dola-seedance2.5`；不要发送 `rh-seedance25-*`，也不要拼接渠道 ID。
- 附件中的上游 `POST /api/v1/videos` 是 multipart 文件上传；韭菜盒子公开中转使用 `POST /v1/videos` JSON，并通过 `images` URL 数组传递参考图。
- 附件中“最多 9 张、总计 20 MiB”是上游旧限制；韭菜盒子中转已按确认结果改为最多 30 张、每张不超过 20 MiB。
- 当前 Dola 中转仅支持参考图片；不支持参考视频和参考音频。

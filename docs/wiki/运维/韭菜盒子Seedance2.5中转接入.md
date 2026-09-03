# 韭菜盒子 Seedance 2.5 API 接口说明

> 本文档是韭菜盒子 NewAPI 的对外接入合同，只描述公开接口，不包含上游渠道信息。
>
> 适用对象：希望通过韭菜盒子 NewAPI 中转站调用 Dola Seedance 2.5 的 OpenAI 兼容客户端。
>

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建视频 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 模型名 | `dola-seedance2.5` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 计价 | `0.2/秒`，当前模型固定生成 30 秒 |
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

`video_url` 是可直接预览或下载的视频地址。请在任务完成后尽快保存结果。

## 常见错误

| 错误 | 原因 |
| --- | --- |
| `Unsupported model` | `model` 不是 `dola-seedance2.5` |
| `Reference images must be URLs` | `images` 传入了本地路径、Base64 或其他类型 |
| `Unable to fetch reference image` | 图片 URL 对中转服务不可访问，或返回了错误状态 |
| `Only JPG, JPEG and PNG images are supported` | 参考图不是 JPEG/PNG |
| `Reference image exceeds 20 MiB` | 单张参考图超过 20 MiB |
| `Reference images exceed the limit` | 参考图超过 30 张 |

## 接入边界

- 第三方客户端只连接上面的 NewAPI Base URL，不需要知道任何上游服务。
- 客户端发送 `model: dola-seedance2.5`，不要拼接渠道 ID。
- 韭菜盒子公开接口使用 `POST /v1/videos` JSON，并通过 `images` URL 数组传递参考图。
- 当前接口仅支持参考图片，不支持参考视频和参考音频。

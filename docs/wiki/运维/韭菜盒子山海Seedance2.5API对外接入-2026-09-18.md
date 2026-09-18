# 韭菜盒子 Seedance 2.5（山 / 海）API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含上游服务、内部适配器或密钥信息。
>
> 适用对象：需要通过第三方客户端调用 `山seedance2.5` 或 `海seedance2.5` 的用户。
>
> 2026-09-18 起：两条线路完成下载链路修复，任务数据保留 7 天。

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

| 模型名 | 说明 | 计价 | 参考图上限 | 时长 |
| --- | --- | --- | --- | --- |
| `山seedance2.5` | Seedance 2.5 参考生视频，720p | 1 元/次 | 9 张 | 4–30 秒，默认 30 |
| `海seedance2.5` | Seedance 2.5 参考生视频，720p | 2 元/次 | 10 张 | 固定 30 秒 |

两个模型均为**按次计费**（与时长无关），画幅通过 `ratio` 选择。

## 创建任务

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "山seedance2.5",
    "prompt": "雨夜霓虹街道，骑手穿过积水，电影感冷色调",
    "images": [
      "https://example.com/reference.png"
    ],
    "ratio": "16:9",
    "duration": 30
  }'
```

成功后返回任务 ID：

```json
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "山seedance2.5",
  "status": "queued",
  "progress": 0
}
```

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | `山seedance2.5` 或 `海seedance2.5`，其它值返回 400。 |
| `prompt` | 是 | 视频内容描述。 |
| `images` | 否 | 参考图 URL 数组；`山seedance2.5` 最多 9 张，`海seedance2.5` 最多 10 张。 |
| `ratio` | 否 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`；不传由服务端自适应。 |
| `resolution` | 否 | 当前固定 `720p`。 |
| `duration` | 否 | 秒；`山seedance2.5` 支持 4–30（默认 30），`海seedance2.5` 固定 30。也兼容 `seconds`。 |
| `audios` | — | **暂不支持**，传入返回 422。 |

### 参考图

参考图必须是服务端可访问的 `http://` 或 `https://` URL，不接受本地路径或 `data:` URL。本地文件先上传到韭菜盒子临时素材接口，再将返回的 URL 填入 `images`：

```bash
curl --location 'https://api.jiucaihezi.studio/api/creations/uploads' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --form 'file=@./reference.png'
```

```json
{
  "url": "https://api.jiucaihezi.studio/media/creation/<token>"
}
```

临时素材接口支持 `image/*`、`audio/*` 和 `video/*`，单文件最大 20 MB；返回 URL 为公网 HTTPS 地址，15 分钟后自动失效，请在上传完成后 15 分钟内创建视频任务。创建成功后参考图会被平台读取，不再受临时 URL 过期影响。

## 查询任务

建议每 3–5 秒查询一次，直到 `status` 为 `completed` 或 `failed`：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

| 状态 | 含义 |
| --- | --- |
| `queued` | 已受理，等待上游生成 |
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

接口支持 `Range` 请求，可用于播放器拖动与断点续传。生成耗时视上游负载而定，客户端轮询超时建议放宽（≥30 分钟）。

任务数据自任务创建起在平台保留 **7 天**；超过保留期后查询和下载会返回 `404`。请把成片保存到自己的存储，不要依赖平台长期托管。

## 错误处理

| 状态/错误 | 原因与处理 |
| --- | --- |
| `401` / `403` | API Key 缺失、错误或无模型权限。 |
| `400` | 模型名、提示词或参数不合法，在创建接口同步返回。 |
| `422` | 传入了不支持的字段（如 `audios`）。 |
| 任务 `status: failed` | 上游生成失败，读 `error.message`。 |
| `404` | 任务 ID 不存在，或任务已超过 7 天保留期。 |

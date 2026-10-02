# 韭菜盒子灵动（满血）Seedance 2.5 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含上游服务、内部适配器或密钥信息。
>
> 适用对象：需要通过第三方客户端调用 `cvk-2.5-*` / `sd2.5-a` / `SD-2.5-特价` 的用户。
>
> 2026-10-02 上线。创作面板里的分组名是「**满血seedance2.5**」，默认视频模型就是 `cvk-2.5-480`。

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

| 模型名 | 分辨率 | 计价 | 时长 | 参考图上限 | 画幅 |
| --- | --- | --- | --- | --- | --- |
| `cvk-2.5-480` | 480p | **0.5 元/秒** | 4–30 秒 | 30 张 | 1:1、16:9、9:16、4:3、3:4 |
| `sd2.5-a` | 720p | **0.5 元/秒** | 4–30 秒 | 30 张 | 同上 |
| `cvk-2.5-720` | 720p | **0.75 元/秒** | 4–30 秒 | 30 张 | 同上 |
| `cvk-2.5-1080` | 1080p | **1.5 元/秒** | 4–30 秒 | 30 张 | 同上 |
| `SD-2.5-特价` | 不传该参数 | **2.5 元/次** | **固定 30 秒** | 9 张 | 上面 5 档 + `21:9` |

- **按秒计费**的四条：实扣 = 单价 × `duration`。例：`cvk-2.5-480` 生成 4 秒 = **2 元**（2026-10-02 真机验收，后台实扣 2 元）。
- **按次计费**的 `SD-2.5-特价` 与时长无关，且**只能 30 秒**（传别的时长返回 400）。
- `SD-2.5-特价` 支持**提示词最多 12000 字**，并支持 `21:9`；它**没有分辨率参数**，不要传 `resolution`。

## 创建任务

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "cvk-2.5-480",
    "prompt": "雨夜霓虹街道，骑手穿过积水，电影感冷色调",
    "images": [
      "https://example.com/reference.png"
    ],
    "ratio": "16:9",
    "resolution": "480p",
    "duration": 4
  }'
```

成功后返回任务 ID：

```json
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "cvk-2.5-480",
  "status": "queued",
  "progress": 0
}
```

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 上表 5 个模型名之一，其它值返回 400。 |
| `prompt` | 是 | 视频内容描述；`SD-2.5-特价` 最多 12000 字。 |
| `images` | 否 | 参考图 URL 数组，必须是公网 `https://` 直链。上限见上表（9 张 / 30 张）。 |
| `ratio` | 否 | `1:1`、`16:9`、`9:16`、`4:3`、`3:4`；`SD-2.5-特价` 另支持 `21:9`。 |
| `resolution` | 否 | 按模型传对应值（`480p` / `720p` / `1080p`）；`SD-2.5-特价` **不要传**。 |
| `duration` | 否 | 秒；按秒四条支持 4–30，`SD-2.5-特价` 固定 30。也兼容 `seconds`。 |
| `videos` / `audios` | — | **暂不支持**，传入返回 422。 |

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

建议每 5–10 秒查询一次，直到 `status` 为 `completed` 或 `failed`：

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

接口支持 `Range` 请求，可用于播放器拖动与断点续传。客户端轮询超时建议放宽（≥30 分钟）。任务记录沿用平台保留策略（其它线路实测 7 天），**成片请及时下载自存**，不要依赖平台长期托管。

## 错误处理

| 状态/错误 | 原因与处理 |
| --- | --- |
| `401` / `403` | API Key 缺失、错误或无模型权限。 |
| `400` | 模型名、提示词或参数不合法（时长越界、参考图超限、分辨率与模型不匹配），在创建接口同步返回。 |
| `422` | 传入了不支持的字段（`videos` / `audios`）。 |
| 任务 `status: failed` | 上游生成失败，读 `error.message`；`SD-2.5-特价` 提示词超 12000 字也会在创建时返回 400。 |
| `model_price_error` | 该模型未配置价格，请联系管理员。 |
| `404` | 任务 ID 不存在，或已超过平台保留期。 |

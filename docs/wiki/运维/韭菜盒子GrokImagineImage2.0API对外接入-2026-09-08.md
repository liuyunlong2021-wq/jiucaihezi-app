# 韭菜盒子 Grok Imagine Image API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述第三方 APP 调用方式。
> 更新：2026-10-08。服务器 NewAPI 官方版本为 `v1.0.0-rc.40`；小易通道内部使用 `openai_image` 任务插件。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 文生图 | `POST /v1/images/generations` |
| 图生图 | `POST /v1/images/edits` |
| 模型名 | `grok-imagine-image-2.0` 或 `grok-imagine-image` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 生成方式 | 同步返回 OpenAI 图片响应；NewAPI 在服务端轮询上游任务 |

NewAPI 返回后，客户端直接处理 `data[].url` 或 `data[].b64_json`。小易上游异步任务号不会暴露给客户端，不要轮询 `/v1/videos`。

## 文生图

```bash
curl --location 'https://api.jiucaihezi.studio/v1/images/generations' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "grok-imagine-image-2.0",
    "prompt": "一张电影感的未来城市海报，夜景，震撼光影",
    "size": "2048x1152",
    "aspect_ratio": "16:9",
    "n": 1,
    "response_format": "url"
  }'
```

`size` 必须明确，并且和 `aspect_ratio` 指定相同比例。支持比例：`1:1`、`16:9`、`9:16`、`3:2`、`2:3`。`response_format` 支持 `url` 和 `b64_json`。

## 参考图编辑

图生图使用 `multipart/form-data`，字段名为 `image`；多张图片重复提交 `image[]`：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/images/edits' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --form 'model=grok-imagine-image-2.0' \
  --form 'prompt=保留第一张的人物，融合第二张的色彩和光影风格' \
  --form 'size=2048x2048' \
  --form 'response_format=url' \
  --form 'image[]=@./subject.png' \
  --form 'image[]=@./style.jpg'
```

不要手动设置 `Content-Type: multipart/form-data`，让客户端生成 boundary。参考图必须是可读取的图片文件。不要将本地路径或 `file:` URL 放进 JSON。

## 成功响应与结果下载

URL 响应示例：

```json
{
  "created": 1785180000,
  "data": [{ "url": "https://.../generated.png" }]
}
```

NewAPI 会在服务端轮询小易任务直至完成，再返回该 OpenAI 图片结构。URL 可能有有效期，客户端应立即下载并保存。`b64_json` 不带 `data:image/...;base64,` 前缀，客户端需先 Base64 解码。小易会尽量返回归档 URL；归档失败时可能返回短期签名的上游 URL。

## 错误处理

| 错误 | 处理 |
| --- | --- |
| `401` | 检查韭菜盒子 API Key。 |
| 模型不可用 | 确认 NewAPI 已将模型配置到小易图片渠道，且小易当前 Token 的 `/v1/models` 可见该模型。 |
| `422 At least one reference image is required` | 图生图请使用 `/v1/images/edits` 并以 multipart 上传真实文件。 |
| `504 task_timeout` | NewAPI 等待上游超过图片协议时限；任务仍由服务器后台轮询，避免立即重复提交同一业务请求。 |
| 返回成功但没有图片 | 检查 `data[]` 是否包含 `url` 或 `b64_json`，并确认图片下载没有因临时 URL 过期而失败。 |

## 旧接口说明

`POST /v1/videos`、`GET /v1/videos/{task_id}` 是 2026-10-06 前后沿用的历史适配器合同，不是当前 Grok Image 公网接口。NewAPI `rc40` 提供 OpenAI Images Task Plugin 协议，当前图片接口请使用 `/v1/images/generations` 和 `/v1/images/edits`。

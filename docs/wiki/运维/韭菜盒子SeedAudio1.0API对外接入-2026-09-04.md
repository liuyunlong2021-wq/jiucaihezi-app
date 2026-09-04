# 韭菜盒子 Seed Audio 1.0 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含任何上游服务、渠道或密钥信息。
>
> 适用对象：需要通过第三方客户端调用韭菜盒子 `seed-audio-1.0` 音频生成模型的用户。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 生成音频 | `POST /v1/audio/speech` |
| 模型名 | `seed-audio-1.0` |
| 认证 | `Authorization: Bearer <你的 API Key>` |
| 参考音频 | 最多 3 段 |
| 默认输出 | MP3 |

创作面板显示名为 `豆包音频生成1.0`；第三方请求必须使用模型名 `seed-audio-1.0`。

## 最小调用

接口返回原始音频二进制，不是 JSON。使用 `curl` 时应通过 `-o` 保存结果：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/audio/speech' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --output result.mp3 \
  --data '{
    "model": "seed-audio-1.0",
    "input": "请自然地说：这是一段 Seed Audio 测试。",
    "response_format": "mp3"
  }'
```

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 固定为 `seed-audio-1.0`。 |
| `input` | 是 | 文本提示词，1-3000 个字符。 |
| `response_format` | 否 | `mp3`、`wav`、`pcm`、`opus` 或 `ogg_opus`；默认 `mp3`。 |
| `metadata.references` | 否 | 参考音频对象数组，最多 3 个。 |

`voice`、`speed`、`n`、`stream` 等 OpenAI 语音接口字段不属于当前公开合同，客户端不要依赖其效果。

## 参考音频

参考音频必须放在 `metadata.references` 中。数组最多 3 项，每项使用一个可访问的音频 URL 或原始 Base64 数据：

```json
{
  "model": "seed-audio-1.0",
  "input": "保持参考音频的音色，自然演绎这段文字。",
  "response_format": "mp3",
  "metadata": {
    "references": [
      { "audio_url": "https://example.com/reference-1.mp3" },
      { "audio_url": "https://example.com/reference-2.wav" }
    ]
  }
}
```

使用 Base64 时不要带 `data:audio/...;base64,` 前缀：

```json
{
  "model": "seed-audio-1.0",
  "input": "参考这些声音生成一段新的音频。",
  "metadata": {
    "references": [
      { "audio_data": "<RAW_BASE64_AUDIO_1>" },
      { "audio_data": "<RAW_BASE64_AUDIO_2>" },
      { "audio_data": "<RAW_BASE64_AUDIO_3>" }
    ]
  }
}
```

约束：

- `references` 必须是 1-3 个对象的数组。
- 单个 `audio_data` 不得超过 10 MiB 的音频数据规模。
- `audio_url` 必须是韭菜盒子服务端可以访问的音频地址；本地路径不能作为 URL 使用。
- 同一请求不要混用图片参考和音频参考；本文档只保证音频参考合同。

## 输出格式

成功时 HTTP 状态码为 `200`，响应体是音频二进制，并带对应 `Content-Type`：

| `response_format` | `Content-Type` |
| --- | --- |
| `mp3` | `audio/mpeg` |
| `wav` | `audio/wav` |
| `pcm` | `audio/pcm` |
| `opus` / `ogg_opus` | `audio/ogg` |

客户端不要按图片或聊天接口解析成功响应；应按二进制音频保存或播放。

## 错误处理

错误返回 JSON，格式如下：

```json
{
  "error": {
    "message": "input must contain 1-3000 characters",
    "type": "seed_audio_error",
    "code": "invalid_input"
  }
}
```

| 状态 | 常见原因 | 处理 |
| --- | --- | --- |
| `401` | 缺少或错误的 Bearer API Key | 检查请求头格式和账号权限。 |
| `400` | 模型名、输入文本、输出格式或参考音频数量不合法 | 按本文档字段和限制修正后重试。 |
| `502` | 音频服务暂时不可用、返回无效数据或空音频 | 稍后重试；不要在未确认失败前重复提交大量任务。 |

## 接入边界

- 第三方客户端只连接 `https://api.jiucaihezi.studio`，不需要知道任何内部服务地址。
- 请求模型固定为 `seed-audio-1.0`，不要拼接渠道编号或其他名称。
- API Key 只放在 `Authorization` 请求头，不要写入前端公开代码、日志或提交到仓库。
- 模型可用性、账号权限和计费以韭菜盒子 NewAPI 当前配置为准。

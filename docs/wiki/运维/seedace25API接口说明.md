# Dola 30 秒视频生成 API 使用说明

本文档面向 API 用户，说明如何使用令牌创建视频任务、查询任务结果、管理任务和使用卡密充值。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| API 地址 | `https://43.254.166.196` |
| 字符编码 | UTF-8 |
| 鉴权方式 | Bearer Token |
| 视频时长 | 固定 30 秒 |
| 创建请求格式 | `multipart/form-data` |
| 其他请求和响应格式 | JSON |
| 建议创建请求超时 | 300 秒 |

除健康检查外，所有 API 都需要携带以下请求头：

```http
Authorization: Bearer YOUR_TOKEN
```

令牌是用户的唯一身份凭证。请勿将令牌提交到公开仓库、写入公开网页源码或记录到公开日志。

## 接口一览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/videos` | 创建视频任务 |
| `GET` | `/api/v1/videos/{task_id}` | 查询单个任务并刷新结果 |
| `GET` | `/api/v1/videos` | 获取当前令牌的任务列表 |
| `DELETE` | `/api/v1/videos/{task_id}` | 删除任务 |
| `POST` | `/api/v1/cards/redeem` | 使用卡密充值 |
| `GET` | `/healthz` | 检查服务是否可用 |

## 推荐调用流程

1. 为每个新任务生成一个新的 `Idempotency-Key`。
2. 调用创建接口并保存返回的 `task_id`。
3. 每隔 5 至 10 秒查询一次该任务。
4. `task.status` 为 `queued` 或 `processing` 时继续等待。
5. `task.status` 为 `succeeded` 时读取 `task.url`。
6. `task.status` 为 `failed` 时读取 `task.error`；本次查询会同时完成失败退款。

## 公共响应约定

响应中的 `code` 是字符串：

- `"1"`：该接口定义的成功结果。
- `"0"`：任务尚未完成、业务失败或请求失败。

查询任务时，排队中、生成中和生成失败的顶层 `code` 都是 `"0"`。客户端应同时判断 HTTP 状态码、`code` 和 `task.status`，不要只判断 `code`。

时间字段采用 RFC 3339 格式，通常为 UTC 时间，例如：

```text
2026-08-30T08:00:00Z
```

---

## 1. 创建视频任务

### 请求

```http
POST /api/v1/videos
Authorization: Bearer YOUR_TOKEN
Idempotency-Key: UNIQUE_KEY
Content-Type: multipart/form-data
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 视频提示词，1 至 3000 个 Unicode 字符 |
| `ratio` | string | 是 | 视频画面比例 |
| `seconds` | string | 否 | 只支持 `30`；不传也按 30 秒处理 |
| `images[]` | file | 否 | 参考图片；多张图片重复传入该字段 |

支持的画面比例：

```text
16:9
9:16
1:1
3:4
4:3
21:9
```

### 图片限制

- 只支持内容有效的 JPG、JPEG 和 PNG 图片。
- 最多上传 9 张图片。
- 所有图片的总大小不能超过 20 MiB。
- 单张图片任意一边不能超过 8192 像素。
- 单张图片不能超过 4000 万像素。
- 整个 HTTP 请求体不能超过 22 MiB。
- 无图任务不要传递 `images[]`。
- 不要手动设置 multipart boundary，由 HTTP 客户端自动生成。
- 客户端创建请求超时建议设置为 300 秒。

### 幂等键

每次创建请求必须携带 `Idempotency-Key` 请求头。

规则：

- 长度为 8 至 128 个字符。
- 只能包含 `A-Z`、`a-z`、`0-9`、`.`、`_`、`:` 和 `-`。
- 创建不同任务时必须使用不同的幂等键。
- 同一次创建因超时、断网、`500`、`502` 或 `504` 需要重试时，必须继续使用原幂等键。
- 相同令牌使用相同幂等键重试时，会返回原任务，不会重复创建或重复扣费。

推荐直接使用 UUID：

```text
550e8400-e29b-41d4-a716-446655440000
```

### PowerShell 无图示例

```powershell
$token = "YOUR_TOKEN"
$idem = [guid]::NewGuid().ToString()

curl.exe -X POST "https://43.254.166.196/api/v1/videos" `
  -H "Authorization: Bearer $token" `
  -H "Idempotency-Key: $idem" `
  -F "prompt=清晨的未来城市，阳光穿过云层，电影级平稳运镜" `
  -F "ratio=16:9" `
  -F "seconds=30" `
  --max-time 300
```

### PowerShell 带图示例

```powershell
$token = "YOUR_TOKEN"
$idem = [guid]::NewGuid().ToString()

curl.exe -X POST "https://43.254.166.196/api/v1/videos" `
  -H "Authorization: Bearer $token" `
  -H "Idempotency-Key: $idem" `
  -F "prompt=保持参考图主体外观一致，让画面产生自然运动" `
  -F "ratio=16:9" `
  -F "seconds=30" `
  -F "images[]=@C:\images\01.jpg" `
  -F "images[]=@C:\images\02.png" `
  --max-time 300
```

### Linux/macOS cURL 示例

```bash
curl -X POST "https://43.254.166.196/api/v1/videos" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -F "prompt=清晨的未来城市，阳光穿过云层，电影级平稳运镜" \
  -F "ratio=16:9" \
  -F "seconds=30" \
  -F "images[]=@/home/user/01.png" \
  --max-time 300
```

### 创建成功响应

```json
{
  "code": "1",
  "message": "任务创建成功",
  "task_id": "0123456789abcdef0123456789abcdef",
  "status": "queued",
  "charged_points": 1,
  "balance": 19,
  "idempotent_replay": false
}
```

| 字段 | 说明 |
| --- | --- |
| `task_id` | 32 位任务 ID，请持久化保存 |
| `status` | 初始任务状态，通常为 `queued` |
| `charged_points` | 本任务实际扣除的积分 |
| `balance` | 扣费后的令牌剩余积分 |
| `idempotent_replay` | `true` 表示返回的是相同幂等键对应的原任务 |

创建成功仅表示任务已被服务器接受并进入处理流程，不表示视频已经生成完成。创建成功后立即扣除积分。

创建请求过多或任务队列已满时会返回 HTTP `429`，此时应等待后再重试，不要连续提交。

---

## 2. 查询单个任务

该接口会读取任务状态；当任务正在生成时，还会尝试刷新最新结果。

### 请求

```http
GET /api/v1/videos/{task_id}
Authorization: Bearer YOUR_TOKEN
```

只能查询当前令牌创建且尚未删除的任务。

### PowerShell 示例

```powershell
$token = "YOUR_TOKEN"
$taskId = "0123456789abcdef0123456789abcdef"

curl.exe "https://43.254.166.196/api/v1/videos/$taskId" `
  -H "Authorization: Bearer $token"
```

### 查询限制

- 同一来源 IP 每分钟最多查询 30 次。
- 同一个任务的有效刷新间隔最短为 5 秒。
- 建议每隔 5 至 10 秒查询一次。
- 同一任务在 5 秒内重复查询时，会返回已保存状态，但不会再次刷新上游结果。
- 每 IP 每分钟超过 30 次时，会返回 HTTP `429` 和 `Retry-After` 响应头。

### 任务状态

| `task.status` | 含义 | 建议操作 |
| --- | --- | --- |
| `queued` | 任务排队中 | 5 至 10 秒后继续查询 |
| `processing` | 正在提交或生成视频 | 5 至 10 秒后继续查询 |
| `succeeded` | 生成成功 | 读取并保存 `task.url` |
| `failed` | 生成失败 | 读取 `task.error` 和 `billing_state` |

### 排队中响应

```json
{
  "code": "0",
  "message": "任务排队中",
  "task": {
    "task_id": "0123456789abcdef0123456789abcdef",
    "status": "queued",
    "charged_points": 1,
    "billing_state": "charged",
    "created_at": "2026-08-30T08:00:00Z",
    "updated_at": "2026-08-30T08:00:00Z"
  }
}
```

### 生成中响应

```json
{
  "code": "0",
  "message": "生成中，本次从创建到完成大概需要15分钟",
  "task": {
    "task_id": "0123456789abcdef0123456789abcdef",
    "status": "processing",
    "charged_points": 1,
    "billing_state": "charged",
    "estimated_wait": "15分钟",
    "created_at": "2026-08-30T08:00:00Z",
    "updated_at": "2026-08-30T08:00:20Z"
  }
}
```

`estimated_wait` 是上游返回的预计时间，可能不出现，也不代表完成时间承诺。

### 生成成功响应

```json
{
  "code": "1",
  "message": "生成成功",
  "task": {
    "task_id": "0123456789abcdef0123456789abcdef",
    "status": "succeeded",
    "charged_points": 1,
    "billing_state": "charged",
    "url": "https://example.dola.com/path/video.mp4",
    "created_at": "2026-08-30T08:00:00Z",
    "updated_at": "2026-08-30T08:15:00Z"
  }
}
```

`task.url` 是客户端直接访问的 Dola 视频地址，不经过本 API 服务器中转。服务器会移除视频 URL 中 `?` 后面的查询参数。结果链接可能存在有效期，请在生成成功后尽快预览或下载。

### 生成失败响应

```json
{
  "code": "0",
  "message": "任务生成失败，请检查视频参数后重试",
  "task": {
    "task_id": "0123456789abcdef0123456789abcdef",
    "status": "failed",
    "charged_points": 1,
    "billing_state": "refunded",
    "error": "任务生成失败，请检查视频参数后重试",
    "created_at": "2026-08-30T08:00:00Z",
    "updated_at": "2026-08-30T08:02:00Z"
  }
}
```

最终失败任务在用户主动调用本接口时执行退款。退款只会成功执行一次，完成后 `billing_state` 为 `refunded`。

---

## 3. 获取任务列表

### 请求

```http
GET /api/v1/videos
Authorization: Bearer YOUR_TOKEN
```

返回当前令牌最近的最多 100 条、尚未删除的任务，按创建时间倒序排列。目前不支持分页参数。

### PowerShell 示例

```powershell
$token = "YOUR_TOKEN"

curl.exe "https://43.254.166.196/api/v1/videos" `
  -H "Authorization: Bearer $token"
```

### 成功响应

```json
{
  "code": "1",
  "tasks": [
    {
      "task_id": "0123456789abcdef0123456789abcdef",
      "status": "processing",
      "charged_points": 1,
      "billing_state": "charged",
      "estimated_wait": "15分钟",
      "created_at": "2026-08-30T08:00:00Z",
      "updated_at": "2026-08-30T08:00:20Z"
    }
  ]
}
```

任务列表只读取已保存的状态，不会主动刷新视频结果，也不会触发失败退款。需要最新结果时，应调用“查询单个任务”接口。

---

## 4. 删除任务

### 请求

```http
DELETE /api/v1/videos/{task_id}
Authorization: Bearer YOUR_TOKEN
```

### PowerShell 示例

```powershell
$token = "YOUR_TOKEN"
$taskId = "0123456789abcdef0123456789abcdef"

curl.exe -X DELETE "https://43.254.166.196/api/v1/videos/$taskId" `
  -H "Authorization: Bearer $token"
```

### 成功响应

```json
{
  "code": "1",
  "message": "任务已删除"
}
```

删除规则：

- 删除后，该任务不会再出现在任务列表中，也不能继续通过 API 查询。
- 尚未开始提交的排队任务会停止后续处理。
- 已经提交到生成服务的任务只能从本系统中删除，无法保证终止上游生成。
- 正在提交的任务暂时不能删除，会返回 HTTP `409`。
- 主动删除任务不会退还积分。
- 失败任务建议先查询，确认 `billing_state` 已变为 `refunded`，再执行删除。

---

## 5. 卡密充值

### 请求

```http
POST /api/v1/cards/redeem
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json
```

请求体：

```json
{
  "card": "YOUR_RECHARGE_CARD"
}
```

### PowerShell 示例

```powershell
$token = "YOUR_TOKEN"
$body = @{ card = "YOUR_RECHARGE_CARD" } | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post `
  -Uri "https://43.254.166.196/api/v1/cards/redeem" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

### 成功响应

```json
{
  "code": "1",
  "message": "充值成功",
  "points": 20,
  "balance": 35
}
```

| 字段 | 说明 |
| --- | --- |
| `points` | 本次充值增加的积分 |
| `balance` | 充值后的总积分 |

卡密只能成功使用一次。卡密无效、已过期或已被使用时，统一返回“卡密无效或已使用”。

---

## 6. 服务健康检查

健康检查不需要令牌。

```http
GET /healthz
```

服务正常时返回：

```json
{
  "ok": true,
  "time": "2026-08-30T08:00:00Z"
}
```

服务或数据库不可用时返回 HTTP `503`：

```json
{
  "ok": false
}
```

---

## 任务字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 32 位任务 ID |
| `status` | string | `queued`、`processing`、`succeeded` 或 `failed` |
| `charged_points` | number | 创建任务时实际扣除的积分 |
| `billing_state` | string | `charged` 表示已扣费，`refunded` 表示已退款 |
| `estimated_wait` | string | 预计等待时间，仅在上游提供时返回 |
| `error` | string | 对用户公开的失败原因，仅失败时返回 |
| `url` | string | 视频地址，仅成功时返回 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 最近更新时间 |

未产生内容的可选字段会从 JSON 中省略，而不是返回空字符串或 `null`。

## HTTP 状态码

| HTTP 状态码 | 说明 |
| --- | --- |
| `200` | 请求已正常处理；具体任务状态见响应体 |
| `400` | 参数、图片、任务 ID、幂等键或卡密无效 |
| `401` | 未提供令牌，或令牌无效、已禁用 |
| `402` | 积分不足 |
| `404` | 任务不存在、已删除或不属于当前令牌 |
| `405` | 请求方法错误 |
| `409` | 任务当前正在提交，暂时不能删除 |
| `413` | HTTP 请求体过大 |
| `429` | 创建请求过多、任务队列已满或查询过于频繁 |
| `500` | 服务器内部错误 |
| `502`、`504` | 网关或临时网络错误 |
| `503` | 健康检查发现服务暂时不可用 |

应用层错误通常返回：

```json
{
  "code": "0",
  "message": "具体错误原因"
}
```

由网关直接产生的 `413`、`502` 或 `504` 可能不是 JSON。客户端应先判断 HTTP 状态码，再解析响应体。

查询限流响应会携带 `Retry-After` 响应头，表示建议等待的秒数。

## 重试规则

### 创建任务

- 请求超时、连接中断、`500`、`502` 或 `504`：使用原来的 `Idempotency-Key` 重试。
- 参数错误：修正参数后使用新的 `Idempotency-Key` 创建。
- `402`：充值后再创建。
- `413`：减少图片数量或大小后，使用新的幂等键创建。
- `429`：等待后重试，不要立即循环请求。

### 查询任务

- `queued` 或 `processing`：等待 5 至 10 秒后继续查询。
- `429`：按照 `Retry-After` 等待。
- 临时 `500`、`502` 或 `504`：等待数秒后重试。
- `succeeded` 或 `failed`：任务已经结束，不再轮询。

## 使用注意事项

- 令牌只应保存在服务端或受保护的客户端配置中。
- 日志中不要记录完整令牌或卡密。
- 创建成功后必须保存 `task_id`。
- 同一次创建重试必须复用原幂等键。
- 不要高频查询任务；推荐 5 至 10 秒一次。
- 成功视频链接可能存在有效期，应尽快预览或下载。
- 客户端应验证 HTTPS 证书，不建议关闭 TLS 验证。

---

文档更新时间：2026-08-30

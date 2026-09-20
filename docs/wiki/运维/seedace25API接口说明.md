# 视频生成 API 接口说明（用户版）

版本：API v1 · 更新日期：2026年9月19日

本文介绍视频任务的创建、查询和删除，参数与响应格式按当前服务核对。示例中的令牌、任务编号、余额与视频地址均为占位或示例数据，请替换后使用。

## 1. 快速开始

服务地址：

```text
https://43.254.166.145
```

下文使用 `BASE_URL` 表示该地址，不包含末尾的 `/`。

接入步骤：

1. 准备服务方发放的用户访问令牌。
2. 提交提示词、画面比例和可选参考图片，取得 `task_id`。
3. 定期查询同一个 `task_id`，建议每次查询返回后等待 **7秒**再查。
4. `status` 为 `succeeded` 时读取 `url`；为 `failed` 时读取 `error`，停止轮询。

**创建成功表示任务已受理，不代表视频已经生成成功。** 不要因为等待时间较长而重复创建。

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/v1/videos` | 创建视频任务 |
| `GET` | `/api/v1/videos/{task_id}` | 查询单个任务及结果 |
| `DELETE` | `/api/v1/videos/{task_id}` | 删除自己的任务记录 |

## 2. 认证与通用规则

### 2.1 用户令牌

调用视频任务接口时，在请求头携带：

```http
Authorization: Bearer YOUR_USER_TOKEN
```

`Bearer` 后有一个空格。令牌必须使用完整值，不能使用用户编号或令牌前缀代替。

- 程序直接使用 Bearer 令牌即可调用这三个业务接口。
- 只能操作当前令牌所属的任务；查询其他用户的任务返回404。
- 令牌无效或已被禁用时返回401。
- 使用 HTTPS；不要将令牌放入 URL 或公开代码。

### 2.2 响应与任务状态

JSON 使用 UTF-8。`code` 是**字符串**：`"1"` 表示请求正常处理，`"0"` 表示请求出错。

视频是否完成，必须检查 `status`：

| `status` | 含义 | 下一步 |
|---|---|---|
| `queued` | 排队等待，也可能是自动重试后重新排队 | 继续查询原任务 |
| `processing` | 处理中，尚未得到最终结果 | 继续查询原任务 |
| `succeeded` | 视频生成成功 | 读取 `url`，停止查询 |
| `failed` | 任务最终失败 | 展示 `error`，停止查询 |

`HTTP 200` 且 `code="1"` 也可能对应 `status="failed"`：表示本次查询成功，查到的任务结果为失败。

### 2.3 积分与自动重试

- 创建任务成功时扣取积分，实际扣费金额以 `charged_points` 为准，客户端不要写死价格。
- 符合条件的异常会自动重试，沿用原 `task_id`，不重复扣取用户积分。
- 自动重试期间可能从 `processing` 回到 `queued`。继续查询原任务即可，无须重新创建。
- 并非所有失败都会自动重试；以最终返回的 `status` 为准。
- 任务最终失败后，退回本次扣取的积分，`billing_state` 为 `refunded`。
- 查询和请求重发不会造成重复退款。
- **HTTP超时、停止轮询、删除任务，都不会自动触发退款。**

### 2.4 字段约定

- `task_id` 为32位小写十六进制字符串，请按字符串保存。
- 时间为带时区的 RFC 3339 / ISO 8601 字符串；例如 `2026-09-19T10:00:00Z` 对应北京时间18:00。
- 可选字段可能为空或省略。客户端应忽略新增的不认识的字段。
- `error`、`message` 是展示文案，不应当作固定错误编号使用。
- 建议保存创建时的幂等键、任务编号和最终结果，便于恢复查询与问题反馈。

## 3. 创建视频任务

### 3.1 请求格式

```http
POST /api/v1/videos
Authorization: Bearer YOUR_USER_TOKEN
Idempotency-Key: video-order-20260919-000001
Content-Type: multipart/form-data; boundary=客户端生成的边界
```

**创建接口只使用 `multipart/form-data`。即使没有图片，也应使用 multipart，不能提交 JSON。**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | 文本 | 是 | 提示词，去掉首尾空白后为 **1～8000个 Unicode 字符** |
| `ratio` | 文本 | 是 | 画面比例，取值见下方，无默认值 |
| `seconds` | 文本 | 否 | 只支持 `"30"`，省略时按30秒参数创建 |
| `images[]` | 文件，可重复 | 否 | 最多9张参考图片；多张图片重复使用此字段名 |
| `idempotency_key` | 文本 | 与请求头二选一 | 可代替 `Idempotency-Key` 请求头，推荐统一使用请求头 |

`ratio` 支持：

```text
16:9   9:16   1:1   3:4   4:3   21:9
```

提示词长度按字符计算，不是 UTF-8 字节数或 tokens 数。时长参数表示视频生成请求的时长，不是任务完成所需的等待时间。

标量字段只传一次。不要添加 `model`、`duration`、`callback_url`、重试次数等未列出的参数。图片必须上传实际文件，不能用图片 URL 或 Base64 文本代替；文件字段名必须为 `images[]`。

### 3.2 图片与请求大小

| 项目 | 限制 |
|---|---|
| 图片格式 | JPG/JPEG、PNG |
| 图片数量 | 最多9张 |
| 所有图片文件合计大小 | 最多20 MiB，即20,971,520字节 |
| 单张图片宽、高 | 分别不超过8192像素 |
| 单张图片总像素 | 宽 × 高不超过40,000,000 |
| 完整 multipart 请求体 | 最多22 MiB，即23,068,672字节，包含文本字段和边界 |

请上传内容完整、可正常打开的图片。部分损坏图片可能在创建后才被判定无法处理，此时任务会失败并退款；创建成功不表示图片已通过全部检查。

创建请求必须携带真实的 `Content-Length`，不支持未知长度的分块上传。让 HTTP 库生成 multipart 边界和请求长度，不要自行填写错误的 `Content-Type` 或长度。

### 3.3 幂等键：避免重复创建和扣费

幂等键用于识别“同一次创建请求”。规则如下：

- 长度8～128个字符，仅允许英文字母、数字和 `.`、`_`、`:`、`-`。
- 在原任务记录保留期间，同一用户令牌下，同一个键对应同一任务。
- 每个新任务使用新键，并在发送请求前保存该键。
- 如同时传请求头和表单幂等键，两者应完全相同；推荐只传请求头。

| 情况 | 操作 |
|---|---|
| 创建请求超时或断网，不确定是否成功 | 用原令牌、原键、原内容重发 |
| 已经获得 `task_id`，还没有结果 | 查询原任务，不重复创建 |
| 修改提示词、图片或比例后重新生成 | 使用新键，按新任务计费 |
| 原任务最终失败，用户决定再生成一次 | 使用新键；原键只会返回原任务 |
| 原任务已经删除 | 原键不能恢复任务，也不能创建替代任务；当前返回404 |

**复用键不会更新原任务内容，也不能强制重新生成。**

### 3.4 cURL 示例

以下为 Bash 写法。Windows PowerShell 使用 `curl.exe`，并相应调整变量和换行写法。

先设置服务地址和用户令牌：

```bash
BASE_URL="https://43.254.166.145"
VIDEO_API_TOKEN="YOUR_USER_TOKEN"
```

纯文本创建：

```bash
curl --request POST "$BASE_URL/api/v1/videos" \
  --header "Authorization: Bearer $VIDEO_API_TOKEN" \
  --header "Idempotency-Key: video-order-20260919-000001" \
  --form-string "prompt=海边日落，旅人缓缓走过沙滩，镜头平稳推进。" \
  --form-string "ratio=16:9" \
  --form-string "seconds=30"
```

携带参考图片：

```bash
curl --request POST "$BASE_URL/api/v1/videos" \
  --header "Authorization: Bearer $VIDEO_API_TOKEN" \
  --header "Idempotency-Key: video-order-20260919-000002" \
  --form-string "prompt=参考图片中的人物自然行走，镜头缓缓跟随。" \
  --form-string "ratio=9:16" \
  --form-string "seconds=30" \
  --form "images[]=@./reference-1.jpg;type=image/jpeg" \
  --form "images[]=@./reference-2.png;type=image/png"
```

这两条命令分别创建一个任务。同一条命令仅作为网络重发时，应保留原幂等键和内容。

### 3.5 成功响应

HTTP 200：

```json
{
  "code": "1",
  "task_id": "0123456789abcdef0123456789abcdef",
  "status": "queued",
  "charged_points": 1,
  "balance": 99
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | `"1"` 表示请求正常处理 |
| `task_id` | string | 后续查询和删除使用的任务编号 |
| `status` | string | 首次创建时为 `queued` |
| `charged_points` | integer | 此任务扣取的积分 |
| `balance` | integer | 本次返回的积分余额 |
| `existing` | boolean，可选 | 为 `true` 时表示取回已有任务，没有再次扣费 |

幂等重发返回的 `status` 是原任务当前状态，可能已经是 `processing`、`succeeded` 或 `failed`。

## 4. 查询任务结果

### 4.1 请求

```http
GET /api/v1/videos/{task_id}
Authorization: Bearer YOUR_USER_TOKEN
```

```bash
TASK_ID="0123456789abcdef0123456789abcdef"
curl "$BASE_URL/api/v1/videos/$TASK_ID" \
  --header "Authorization: Bearer $VIDEO_API_TOKEN"
```

### 4.2 查询频率

**同一个任务在任意连续60秒内，最多查询10次。**

- 不同任务分别计数；多个设备、IP或程序查询同一个任务时，共用该任务的10次额度。
- 建议每次查询返回后等待7秒，再发下一次；避免同时查询同一个任务。
- 超限返回 HTTP 429，并携带 `Retry-After`，值为需要等待的秒数。
- 已成功或失败的任务也受此限制，取得最终结果后应停止轮询。
- 查询可能需要等待一段时间，建议客户端读取超时设为45～60秒。HTTP超时不代表任务最终失败。

查询超限示例：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 7
Content-Type: application/json; charset=utf-8
```

```json
{
  "code": "0",
  "message": "同一任务每分钟最多查询10次，请稍后重试"
}
```

### 4.3 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | `"1"` 表示本次查询正常返回 |
| `task_id` | string | 任务编号 |
| `status` | string | `queued`、`processing`、`succeeded`、`failed` |
| `charged_points` | integer | 本任务原扣取积分，退款后仍保留此金额 |
| `billing_state` | string | `charged`：已扣费；`refunded`：已退款 |
| `url` | string | 成功后的完整视频地址，无结果时为空 |
| `error` | string | 最终失败提示，无错误时为空 |
| `estimated_wait` | string | 参考等待信息，可能为空，不是完成时间承诺 |
| `refreshed` | boolean | 本次是否进行了状态刷新，不代表视频是否成功 |
| `query_notice` | string | 本次查询提示，正常时为空 |
| `task` | object | 任务对象，字段说明见本节下方 |

任务对象中，`task_id`、`status`、`charged_points`、`billing_state`、`url`、`error`、`estimated_wait` 的含义与查询响应相同，后三个字段为空时可能省略。另外包含：

| 字段 | 类型 | 说明 |
|---|---|---|
| `created_at` | string | 任务创建时间 |
| `updated_at` | string | 最近记录更新时间，不一定是视频完成时间 |
| `can_delete` | boolean | 当前是否允许删除；实际删除时会再次检查 |

任务对象不返回提示词正文或参考图片内容，需要复用素材时请自行保存。

成功后的完整响应示例：

```json
{
  "code": "1",
  "task_id": "0123456789abcdef0123456789abcdef",
  "status": "succeeded",
  "charged_points": 1,
  "billing_state": "charged",
  "url": "https://media.example.com/example-video.mp4",
  "error": "",
  "estimated_wait": "",
  "refreshed": false,
  "query_notice": "",
  "task": {
    "task_id": "0123456789abcdef0123456789abcdef",
    "status": "succeeded",
    "charged_points": 1,
    "billing_state": "charged",
    "url": "https://media.example.com/example-video.mp4",
    "created_at": "2026-09-19T10:00:00Z",
    "updated_at": "2026-09-19T10:03:00Z",
    "can_delete": true
  }
}
```

其他状态的关键字段节选如下，实际响应还包含任务编号等字段：

```json
{
  "code": "1",
  "status": "processing",
  "billing_state": "charged",
  "url": "",
  "error": "",
  "refreshed": false,
  "query_notice": "本次查询未刷新，请稍后重试"
}
```

此时保留当前任务，稍后查询，不要显示为“生成失败”。

```json
{
  "code": "1",
  "status": "failed",
  "charged_points": 1,
  "billing_state": "refunded",
  "url": "",
  "error": "任务失败请重试"
}
```

此时任务已经结束，本次扣取的积分已退回。失败文案可能不同，请以实际 `error` 展示。

### 4.4 结果使用

- 对尚未完成的任务，应调用单任务查询以获取最新进度。当前没有 Webhook 回调接口。
- 已结束的任务返回已保存结果。重复查询成功任务不会重新生成视频，也不会刷新视频链接。
- 使用实际返回的完整 `url`，保留全部参数；不要将请求 API 使用的 Bearer 令牌附加到视频地址。
- 视频地址不承诺永久有效，请及时下载保存。地址不可访问时联系服务方。
- `refreshed=false` 也可能只是正在读取已完成的结果，应始终以 `status` 判断任务结果。

## 5. 删除任务

```http
DELETE /api/v1/videos/{task_id}
Authorization: Bearer YOUR_USER_TOKEN
```

```bash
curl --request DELETE "$BASE_URL/api/v1/videos/$TASK_ID" \
  --header "Authorization: Bearer $VIDEO_API_TOKEN"
```

成功响应：

```json
{
  "code": "1",
  "message": "任务已删除"
}
```

删除后，查询或再次删除该编号返回404，当前不提供恢复接口。

**删除任务不会自动退款，也不能保证取消已经开始的视频生成。** 请勿把删除用作取消扣费或处理超时的方式。任务正在提交时会返回409和“任务正在提交，暂不能删除”，稍后再操作。

## 6. 错误处理

请求错误通常返回：

```json
{
  "code": "0",
  "message": "具体错误说明"
}
```

也可能收到非 JSON 错误页面或没有收到响应，因此先检查 HTTP 状态和响应格式，再解析 JSON。

| HTTP 状态 | 常见含义 | 建议 |
|---|---|---|
| `400` | 提示词超长、字段/图片/比例/幂等键无效 | 修正请求；修改生成内容时使用新幂等键 |
| `401` | 令牌无效或已禁用 | 核对用户令牌，必要时联系服务方 |
| `402` | 积分不足 | 补充积分后再创建 |
| `404` | 任务不存在、不属于当前用户或已删除 | 核对令牌与任务编号 |
| `409` | 任务暂不能删除 | 按 `message` 处理 |
| `411` | 创建请求没有合法的 `Content-Length` | 使用能计算 multipart 长度的客户端 |
| `413` | 请求体过大 | 压缩图片或减少文件数量 |
| `429` | 单任务查询过快或当前待处理任务已满 | 按 `Retry-After` 等待；无该头时延迟重试 |
| `500`、`502`、`503`、`504` | 服务暂不可用、繁忙或请求暂时超时 | 延迟重试，创建请求保留原幂等键 |

创建超时后不要立即换新键，否则可能生成两个任务并各自扣费。查询超时或收到5xx时，稍后继续查询原任务，不要在客户端把它改为最终失败。

## 7. Python 创建与查询示例

依赖：Python 3、`requests`。

```bash
python -m pip install requests
```

运行前设置环境变量：

| 变量 | 说明 |
|---|---|
| `VIDEO_API_TOKEN` | 必填，用户访问令牌 |
| `VIDEO_IDEMPOTENCY_KEY` | 创建新任务时必填；重发同一次创建须保留原值 |
| `VIDEO_TASK_ID` | 可选，填入已有任务编号时只查询，不创建 |

未提供 `VIDEO_TASK_ID` 时，示例会创建一个计费任务。可修改代码中的提示词、比例和图片路径。

```python
import os
import time
from contextlib import ExitStack
from pathlib import Path

import requests

BASE_URL = "https://43.254.166.145"
PROMPT = "海边日落，旅人缓缓走过沙滩，镜头平稳推进。"
RATIO = "16:9"
IMAGE_PATHS = []  # 例如 ["reference-1.jpg", "reference-2.png"]

session = requests.Session()
session.headers["Authorization"] = "Bearer " + os.environ["VIDEO_API_TOKEN"]
task_id = os.environ.get("VIDEO_TASK_ID", "").strip()

if not task_id:
    create_key = os.environ["VIDEO_IDEMPOTENCY_KEY"]
    # 文本字段也通过 files 传入，以保证无图片时仍为 multipart。
    with ExitStack() as stack:
        parts = [
            ("prompt", (None, PROMPT)),
            ("ratio", (None, RATIO)),
            ("seconds", (None, "30")),
        ]
        for filename in IMAGE_PATHS:
            path = Path(filename)
            stream = stack.enter_context(path.open("rb"))
            mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
            parts.append(("images[]", (path.name, stream, mime)))

        response = session.post(
            BASE_URL + "/api/v1/videos",
            headers={"Idempotency-Key": create_key},
            files=parts,
            timeout=(10, 120),
        )
        response.raise_for_status()
        created = response.json()
        if created.get("code") != "1":
            raise RuntimeError(created.get("message", "创建请求未成功"))
        task_id = created["task_id"]

print("任务编号，请保存：", task_id, flush=True)

def retry_after(response):
    try:
        return max(7, int(response.headers.get("Retry-After", "7")))
    except ValueError:
        return 7

# 这是示例的客户端等待期限，不是任务的生成时限。
deadline = time.monotonic() + 20 * 60
while time.monotonic() < deadline:
    try:
        response = session.get(
            BASE_URL + "/api/v1/videos/" + task_id,
            timeout=(10, 60),
        )
    except (requests.Timeout, requests.ConnectionError):
        print("本次查询未收到响应，稍后继续查询原任务。")
        time.sleep(7)
        continue

    if response.status_code == 429 or response.status_code >= 500:
        time.sleep(retry_after(response))
        continue
    response.raise_for_status()
    try:
        result = response.json()
    except ValueError:
        print("本次响应格式异常，稍后继续查询。")
        time.sleep(7)
        continue
    if result.get("code") != "1":
        raise RuntimeError(result.get("message", "查询请求未成功"))

    status = result.get("status")
    print("状态：", status, result.get("query_notice", ""))
    if status == "succeeded":
        print("视频地址：", result["url"])
        break
    if status == "failed":
        print("失败原因：", result.get("error", ""))
        print("积分状态：", result.get("billing_state", ""))
        break
    time.sleep(7)
else:
    print("已停止本次等待，任务未被取消。后续使用此编号继续查询：", task_id)
```

如果创建请求超时或没有收到正常响应，重发时保留原幂等键和全部内容；已经保存任务编号后，设置 `VIDEO_TASK_ID` 即可继续查询。

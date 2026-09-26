# 韭菜盒子本机 ComfyUI 视频模型 API 对外接入

> 本文档是韭菜盒子 NewAPI 的公开接入合同，只描述韭菜盒子接口，不包含上游服务、内部适配器或密钥信息。
>
> 适用对象：需要通过第三方客户端调用 `jc-MiniMax H3` 系列视频模型的用户。
>
> 该系列跑在本机工作站的 RTX 4090（48 GB 显存）上，**单并发**：请串行调用。成片自带同步音轨（mp4 / H.265 + AAC）。

## 接入信息

| 项目 | 值 |
| --- | --- |
| Base URL | `https://api.jiucaihezi.studio` |
| 创建任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 下载成片 | `GET /v1/videos/{task_id}/content` |
| 上传参考素材 | `POST /api/creations/uploads` |
| 认证 | `Authorization: Bearer <你的 API Key>` |

## 模型与计价

四个模型共用同一套工作流，区别只在「给几张图、怎么给」。

| 模型名 | 用途 | 怎么传图 | 张数 | 默认时长 | 计价 |
| --- | --- | --- | --- | --- | --- |
| `jc-minimax-h3` | 文生视频 | **不要传图** | 0 | 5 秒 | `0.2/秒` |
| `jc-minimax-h3-first-frame` | 首帧图生视频 | `first_frame` | 1 | 5 秒 | `0.2/秒` |
| `jc-minimax-h3-first-last` | 首尾帧 | `first_frame` + `last_frame` | 各 1 | 5 秒 | `0.2/秒` |
| `jc-minimax-h3-ref2v` | 参考生视频 | `images`（数组，按顺序） | 1–6 | 3 秒 | `0.2/秒` |

计价 = `0.2 × duration`（秒）。`duration` 不传时按上表默认值计费，**建议显式传**。

> ⚠️ 传图字段不要混用：`jc-minimax-h3-first-frame` / `-first-last` 请用 `first_frame` / `last_frame`；`images` 语义是「参考图」，用错模型会切到另一种模式。`jc-minimax-h3`（文生）请一张图都不要传。

## 创建任务

接口为异步接口，创建成功返回任务 ID，随后轮询状态、再下载成片。

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "jc-minimax-h3-ref2v",
    "prompt": "图1的男子骑着图2的驴，在树林里缓慢行走，镜头跟随",
    "duration": 3,
    "aspect_ratio": "9:16 (Portrait Widescreen)",
    "images": [
      "https://example.com/person.png",
      "https://example.com/donkey.png"
    ]
  }'
```

响应示例（HTTP **200**）：

```json
{
  "id": "task_20260926_98bf9754ce1a",
  "task_id": "task_20260926_98bf9754ce1a",
  "object": "generation.task",
  "type": "video.generation",
  "model": "minimax-h3-ref2v",
  "status": "queued",
  "created_at": 1790388368,
  "queued_seconds": 0.0,
  "elapsed_seconds": null,
  "status_url": "/v1/tasks/task_20260926_98bf9754ce1a"
}
```

**请用 `task_id`（或 `id`）作为后续轮询与下载的任务标识。**

## 请求字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 上表四个模型名之一，其它值返回 400。 |
| `prompt` | 是 | 视频内容描述。写清镜头、动作、光线效果更好；参考生模型建议在提示词里用「图1 / 图2」指代参考图顺序。 |
| `duration` | 否 | 时长（秒），1–15。不传按模型默认值计费。 |
| `size` | 否 | 画幅，取值见下方画幅表。默认 `1344x768`。**仅前三个模型生效**。 |
| `aspect_ratio` | 否 | 比例，**仅 `jc-minimax-h3-ref2v` 生效**，取值见下方枚举。默认 `16:9 (Widescreen)`。 |
| `first_frame` / `last_frame` | 否 | 首帧 / 尾帧图（单张），见模型表。 |
| `images` | 否 | 参考图数组（`ref2v` 用），1–6 张。 |

画面尺寸不接受分辨率档位字符串（如 `720p` / `1080p`）—— 只认 `size` 里的像素串和 `aspect_ratio` 的枚举。

### 画幅（`size`）

API 收的是**像素串**；「1K / 2K」是创作面板里的显示档位，不是接口取值。前三个模型适用。

| 档位 | 1:1 方图 | 16:9 横屏 | 9:16 竖屏 | 4:3 横屏 | 3:4 竖屏 | 3:2 横屏 | 2:3 竖屏 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 默认 | — | `1344x768` | — | — | — | — | — |
| 1K | `1024x1024` | `1024x576` | `576x1024` | `1024x768` | `768x1024` | `960x640` | `640x960` |
| 2K | `1440x1440` | `1920x1088` | `1088x1920` | `1664x1248` | `1248x1664` | `1760x1184` | `1184x1760` |

约束：宽高都是 **32 的倍数**、最长边 ≤ **2048**、总像素 ≤ **210 万**。因此 16:9 的 2K 是 `1920x1088`（不是 1920×1080），9:16 的 2K 是 `1088x1920`。**不支持 4K**（上限 2048）。

### 比例枚举（`aspect_ratio`，仅 `ref2v`）

取值必须**原样**带上括号后缀，简写成 `9:16` 会报错：

| 取值 | 含义 |
| --- | --- |
| `16:9 (Widescreen)` | 横屏 16:9（默认） |
| `9:16 (Portrait Widescreen)` | 竖屏 9:16 |
| `1:1 (Square)` | 方图 |
| `4:3 (Standard)` | 横屏 4:3 |
| `3:4 (Portrait Standard)` | 竖屏 3:4 |
| `3:2 (Photo)` | 横屏 3:2 |
| `2:3 (Portrait Photo)` | 竖屏 2:3 |
| `21:9 (Ultrawide)` | 超宽 21:9 |

`ref2v` 的最终像素由工作流内部决定（先按所选比例和档位算首采尺寸，再做 1.5 倍潜空间上采样），**只选定方向与比例即可，不要承诺具体像素值**。

### 参考素材

参考素材必须是服务端可访问的 `http://` 或 `https://` URL，不接受本地路径。已有公网 URL 可直接用；本地文件先上传：

```bash
curl --location 'https://api.jiucaihezi.studio/api/creations/uploads' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --form 'file=@./reference.png'
```

```json
{ "url": "https://api.jiucaihezi.studio/media/creation/<token>" }
```

- 支持 `image/*` / `video/*` / `audio/*`，单文件 ≤ **20 MB**，返回 URL **15 分钟**后失效，请在 15 分钟内创建任务。
- 服务端读取单张参考图的超时是 **30 秒**；慢速主机上的素材会失败。
- **张数上限 6**：这是显存硬限制，7 张会击穿 48 GB 显存且无法中断，因此所有传图模型都卡在 6 张以内。

## 查询任务

建议每 5–15 秒查询一次，直到 `status` 为 `completed` 或 `failed`。**排队与失败都只在这里体现**：提交接口返回 `200` 只表示已受理，排队超时、参考图读取失败、上游生成失败都写在 `error.message` 里。

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

| 状态 | 含义 |
| --- | --- |
| `queued` | 已受理，排队中。 |
| `in_progress` / `running` | 生成中。 |
| `completed` | 已完成。 |
| `failed` | 失败，读取 `error.message`。 |

## 下载成片

完成后通过 `/content` 获取 mp4 二进制，不要按 JSON 解析：

```bash
curl --location 'https://api.jiucaihezi.studio/v1/videos/<TASK_ID>/content' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --output result.mp4
```

支持 `Range` 请求（可断点续传 / 播放器拖动）。

**任务与成片保留 24 小时**（与平台上其它渠道的 7 天不同）。超过保留期后查询与下载都会返回 `404`，请及时保存到自己存储，不要依赖平台长期托管。

## 错误处理

| 状态/错误 | 原因与处理 |
| --- | --- |
| `401` / `403` | API Key 缺失、错误或无该模型权限。 |
| `400` | 模型名、`duration`、`size`、`aspect_ratio`、参考图数量或格式不合法；参考图无法读取。同步返回。 |
| `413` | 只在临时素材上传接口出现：单文件超过 20 MB。 |
| `429` / `server_busy` | **提交阶段**被拒：在途任务已超过上限（单并发 1 + 排队 4）。降低并发、稍后重试。 |
| 任务 `status: failed` 且 `error.code: server_busy` | **已受理但排不上队**：前面有任务在跑时接口会自动排队，不会失败；但排队等待超过 **5 分钟**仍未拿到执行槽位，任务就以此失败。注意：这类失败发生在提交之后，提交时拿到的仍然是 `200`，不会补一个 `429`——必须在轮询里读 `error.message` 才能发现。处理：降低并发、稍后重试。 |
| 任务 `status: failed` | 创建成功之后的失败：参考图读取失败、上游生成失败等。读 `error.message`。 |
| `404` | 任务 ID 不存在，或已超过 24 小时保留期。 |
| `503` | 本机 ComfyUI 不可用（未启动、正在加载模型或正在执行上一个任务），稍后重试。 |
| `5xx` / `502` | 服务或上游暂时不可用，稍后重试；避免重复提交大量任务。 |

耗时参考（RTX 4090，3 秒成片、2 张参考图、竖屏）：**74–104 秒**。时长越长越慢；首次调用（冷启动）可能多 10–30 秒。

时长口径：`duration` 按秒传入，适配器按 **24 fps** 换算成帧，工作流再对齐到 `17n+5` 帧，因此成片实际时长与传入值**略有出入**（通常 ±1 秒内）。

## 接入边界

- API Key 只放在 `Authorization` 请求头，不要写入前端公开代码、日志或提交记录。
- 本系列为**单并发**本地推理，请以串行方式调用。并发提交只会排队，排队超过 5 分钟会被拒；批量任务请客户端自行排队。
- 生成期间该机器的显卡被独占，与图片模型（`jc-qwen-image-2.1`）**共享同一个队列**：图片任务进行中提交视频，或反之，都会排队。
- 请勿把「本机视频模型」当作高可用服务：它是单台工作站上的本地推理，故障、维护或断电都会中断服务，客户端需要有降级或重试策略。

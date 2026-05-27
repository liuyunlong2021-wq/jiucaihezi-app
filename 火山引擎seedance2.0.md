# seedance-2-0-pro 使用文档

本文面向接入方和前端调用方，说明如何提交 `seedance-2-0-pro` 视频生成任务、接入虚拟人像图片素材、查询结果并处理常见错误。当前只按模型名 `seedance-2-0-pro` 对外说明。

## 基础信息

| 项目 | 说明 |
| --- | --- |
| Base URL | `https://sd2.mengfactory.cn` |
| 提交接口 | `POST /v1/videos` |
| 查询接口 | `GET /v1/videos/{task_id}` |
| 鉴权方式 | `Authorization: Bearer sk-your-api-key` |
| 模型名 | `seedance-2-0-pro` |
| 请求格式 | `application/json` 或 `multipart/form-data` |

请求头示例：

```http
Authorization: Bearer sk-your-api-key
```

## 生成流程

1. 调用 `POST /v1/videos` 提交任务。
2. 保存返回的 `task_id`。
3. 每 `10-15` 秒调用 `GET /v1/videos/{task_id}` 查询同一个任务。
4. `status=succeeded` 时读取 `url`。
5. `status=failed` 时读取 `error`，按错误原因修改提示词或素材后再重新提交。

提交成功只代表任务已进入系统，不代表视频已经生成完成。拿到 `task_id` 后不要重复提交同一个请求。

## 模型能力

| 能力 | 支持分辨率 |
| --- | --- |
| 官转 | `480p`、`720p`、`1080p` |
| 优质官转 | `480p`、`720p` |

优质官转不支持 `1080p`。如果当前使用优质官转，请只传 `480p` 或 `720p`。

当前所有模型都不支持引用视频；不要传 `video_file_*`，也不要把视频 URL 当成参考素材传入。

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 使用 `seedance-2-0-pro` |
| `prompt` | string | 是 | 视频描述，直接描述要生成的画面 |
| `duration` | integer | 是 | 视频时长，支持 `4-15` 秒整数 |
| `ratio` | string | 否 | 默认 `auto`；支持 `auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16` |
| `resolution` | string | 否 | 分辨率档位；官转支持 `480p`、`720p`、`1080p`，优质官转支持 `480p`、`720p` |
| `image_file_1` ~ `image_file_9` | string | 否 | 图片 URL、base64，或素材库返回的 `asset_id` 组成的 `asset://<asset_id>` |
| `generate_audio` | boolean | 否 | 是否生成音频，默认 `true`；不需要音频可传 `false` |
| `seed` | integer | 否 | 随机种子；传同一个整数可尽量复现相近结果 |

## 参考素材字段

`seedance-2-0-pro` 的图片参考素材走普通图片字段，不使用嵌套 `content` 参数。当前所有模型都不支持引用视频。

| 用法 | 写法 |
| --- | --- |
| 第一张参考图 | `image_file_1` |
| 第二张参考图 | `image_file_2` |
| 提示词 | 示例里会用 `@图片1`、`@图片2` 表示第一张、第二张参考图；用户也可以按自己的业务自然描述 |

## 普通视频生成

普通文本生成不需要传图片参数，只传模型、提示词、时长、比例和分辨率即可。

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/videos" \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2-0-pro",
    "prompt": "一只机器人在未来城市街头行走，电影感镜头，雨夜霓虹灯反射在地面上",
    "duration": 8,
    "ratio": "16:9",
    "resolution": "720p"
  }'
```

## 使用虚拟人像素材生成

### 适用场景

- 提交虚拟主播、虚拟员工、数字人、IP 角色或人物设定图。
- 让图中的虚拟人像做表情、动作、讲解、走路、转身等视频动作。
- 让虚拟人像按指定动作、姿态或镜头描述生成视频。

### 素材建议

- 优先使用清晰、授权明确、非侵权的虚拟人像图片。
- 主体尽量完整，脸部不要过小，避免严重遮挡、强反光、模糊、低分辨率。
- 背景越简单越稳定；如果只想保留人物形象，避免上传背景复杂的设定图。
- 多张图时，保持同一角色的一致性；不要混入风格差异过大的图片。
- 如果返回人脸、版权、商标或安全策略相关错误，需要更换素材或修改提示词。

### 单张虚拟人像

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/videos" \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2-0-pro",
    "prompt": "让 @图片1 中的虚拟人像在镜头前介绍产品，保持角色形象一致，自然口播，画面干净",
    "duration": 8,
    "ratio": "9:16",
    "resolution": "720p",
    "image_file_1": "asset://asset_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }'
```

### 多张虚拟人像参考图

多张图片用于强化角色一致性或提供不同角度。图片按 `image_file_1`、`image_file_2` 的顺序传入；下面的 `@图片1`、`@图片2` 只是示例写法，用来表达第一张和第二张参考图。

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/videos" \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2-0-pro",
    "prompt": "以 @图片1 为主要角色形象，参考 @图片2 的侧脸角度和服装细节，让虚拟人像在科技发布会舞台上向镜头挥手",
    "duration": 10,
    "ratio": "16:9",
    "resolution": "720p",
    "image_file_1": "asset://asset_front_xxxxxxxxxxxxxxxxxxxxxxxx",
    "image_file_2": "asset://asset_side_xxxxxxxxxxxxxxxxxxxxxxxxx"
  }'
```

## 虚拟人像素材库上传

如果你想先把虚拟人像图片存入素材库，再在多个视频任务里复用，调用：

```http
POST https://sd2.mengfactory.cn/v1/volc/assets
Authorization: Bearer sk-your-api-key
Content-Type: multipart/form-data
```

请求参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | file | 二选一 | 要入库的虚拟人像图片文件 |
| `url` | string | 二选一 | 要入库的虚拟人像图片 URL |
| `asset_type` | string | 否 | 素材类型；虚拟人像图片传 `Image`，不传时会按文件类型识别 |
| `name` | string | 否 | 素材名称，方便后续列表中识别 |
| `description` | string | 否 | 素材说明，方便团队或用户区分 |

Linux/macOS 示例：

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/volc/assets" \
  -H "Authorization: Bearer sk-your-api-key" \
  -F "file=@avatar.png" \
  -F "asset_type=Image" \
  -F "name=virtual-avatar-front" \
  -F "description=正面虚拟人像"
```

Windows PowerShell 示例：

```powershell
curl.exe -X POST "https://sd2.mengfactory.cn/v1/volc/assets" `
  -H "Authorization: Bearer sk-your-api-key" `
  -F "file=@avatar.png" `
  -F "asset_type=Image" `
  -F "name=virtual-avatar-front" `
  -F "description=正面虚拟人像"
```

如果虚拟人像图片已经可以通过 URL 拉取，也可以用 JSON 直接入库：

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/volc/assets" \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://cdn.example.com/virtual-avatar-front.png",
    "asset_type": "Image",
    "name": "virtual-avatar-front",
    "description": "正面虚拟人像"
  }'
```

可以传本地文件 `file`，也可以传图片 URL `url`。这里的 `url` 只用于素材库入库，不是生成任务里的素材参数。

## 虚拟人像素材库上传返回

如果先把虚拟人像图片上传到素材库，调用 `POST /v1/volc/assets`。上传成功后，顶层返回字段是 `asset`：

```json
{
  "asset": {
    "asset_id": "asset_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "file_id": "",
    "url": "https://volc.example.com/asset_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.png",
    "asset_type": "Image",
    "name": "virtual-avatar-front",
    "description": "正面虚拟人像",
    "status": "active",
    "last_used_at": 1770000000,
    "last_synced_at": 1770000000,
    "delete_after": 1770259200,
    "pinned": false,
    "created_at": 1770000000,
    "updated_at": 1770000000
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `asset_id` | string | 素材库资产 ID，提交视频时用 `asset://<asset_id>` 引用 |
| `file_id` | string | 本地文件上传时可能返回临时文件 ID；URL 入库时通常为空 |
| `url` | string | 素材预览或远端素材地址，可能为空；不要把它当作生成任务的素材地址 |
| `asset_type` | string | 素材类型；虚拟人像图片为 `Image` |
| `name` | string | 上传时传入的素材名称 |
| `description` | string | 上传时传入的素材描述，可能为空 |
| `status` | string | 素材状态；`active` 表示可用于生成，`processing` 表示仍在处理中，`failed` 表示上传处理失败 |
| `last_used_at` | integer | 最近使用时间，Unix 秒 |
| `last_synced_at` | integer | 最近同步素材库状态时间，Unix 秒 |
| `delete_after` | integer | 计划清理时间，Unix 秒；可能为空或为 `0` |
| `pinned` | boolean | 是否置顶保留；当前接口通常返回 `false` |
| `created_at` | integer | 创建时间，Unix 秒 |
| `updated_at` | integer | 更新时间，Unix 秒 |

后续提交 `POST /v1/videos` 时，把返回的 `asset_id` 组成 `asset://<asset_id>` 放进 `image_file_1`，提示词按业务自然描述即可：

```json
{
  "model": "seedance-2-0-pro",
  "prompt": "让 @图片1 中的虚拟人像自然口播，面向镜头介绍产品",
  "duration": 8,
  "ratio": "9:16",
  "resolution": "720p",
  "image_file_1": "asset://asset_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

## 提交返回

提交成功会返回任务 ID：

```json
{
  "code": 102,
  "status": "queued",
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "progress": {
    "message": "已接收，等待提交视频生成请求"
  }
}
```

需要保存 `task_id`，后续用它查询生成结果。

## 查询任务

```bash
curl "https://sd2.mengfactory.cn/v1/videos/task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer sk-your-api-key"
```

状态说明：

| status | code | 说明 |
| --- | --- | --- |
| `queued` | `102` | 已接收或排队中 |
| `submitting` | `201` | 正在提交到生成服务 |
| `queueing` | `202` | 上游排队中 |
| `processing` | `203` | 正在生成 |
| `succeeded` | `200` | 生成成功 |
| `failed` | 常见 `422/502/503/504` | 生成失败，读取 `error` |

成功返回示例：

```json
{
  "code": 200,
  "status": "succeeded",
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "history_id": "21686434283780",
  "url": "https://cdn.sd2.mengfactory.cn/sd2/result-assets/xxx/video.mp4",
  "metadata": {
    "model_label": "seedance-2-0-pro",
    "aspect_ratio": "16:9",
    "duration_label": "8s",
    "frame_rate": 24,
    "resolution": "720p",
    "resolution_label": "720p",
    "generated_at": "2026-05-06 12:00"
  }
}
```

读取建议：

```text
status == "succeeded" -> 取 url
status == "failed"    -> 取 error
其它状态              -> 继续轮询
```

## 常见错误处理

| code | 含义 | 处理 |
| --- | --- | --- |
| `400` | 参数错误 | 检查 `model`、`prompt`、`duration`、`ratio`、`resolution`、`image_file_1` |
| `401` | 鉴权失败 | 检查 API Key 和 `Authorization: Bearer sk-...` |
| `402` | 额度不足 | 更换有额度的 Key 或联系管理员补充额度 |
| `404` | 任务不存在 | 确认 `task_id` 是否完整；任务过期则重新提交 |
| `422` | 内容或素材不合规 | 修改提示词、替换素材，不要反复重试同一请求 |
| `502` | 生成服务异常 | 稍后重试；连续出现时联系管理员 |
| `503` | 服务暂时不可用 | 稍后重试 |
| `504` | 超时 | 先继续查询同一个 `task_id`，确认失败后再重新提交 |
| `521` | 查询链路源站暂时不可达 | 不要立即判失败；建议每 `15s` 继续查同一个 `task_id`，先持续 `3 分钟` |

素材相关错误处理：

| 错误 | 处理 |
| --- | --- |
| `图片素材最多支持 9 张` | 减少图片数量 |
| `seed 必须是整数` | 删除 `seed` 或改为整数，例如 `12345` |
| `下载素材失败` | 重新上传素材库资产后再提交 |
| `Authorization expired for uploaded asset, please upload again` | 重新上传素材后再提交 |
| `Face detected in your media. Try another one.` | 更换虚拟人像素材或调整内容，避免触发人脸安全策略 |
| `uploaded material contains copyrighted character` | 更换为自有、授权或不侵权的虚拟角色素材 |
| `contains disallowed trademark` | 移除提示词或素材中的受限商标/品牌元素 |

## 接入注意事项

- `duration` 必填，只能传 `4-15` 的整数。
- `seed` 可选，只接受整数；同一个 `seed` 会固定随机种子，但不保证在素材、提示词或上游模型变化后完全一致。
- Pro 普通文本生成不需要图片字段；有虚拟人像素材时传 `image_file_1`、`image_file_2`。
- 示例提示词里的 `@图片1`、`@图片2` 只是占位表达，不限制用户实际提示词写法。
- 本地图片或图片 URL 可以先通过素材库上传接口入库；视频提交接口里使用返回的 `asset_id` 组成 `asset://<asset_id>`，放到 `image_file_1` 等图片字段。
- 已经拿到 `task_id` 后，只轮询查询接口，不要重复提交同一个任务。
- 只依赖公开返回字段：`task_id`、`status`、`code`、`url`、`error`、`progress`、`metadata`。

---

# seedance-2-0-fast 兼容使用教学

这页面向仍在使用早期模型名的老用户，说明如何继续兼容老用户接入 `seedance-2-0-fast`，并在提交后通过 `task_id` 做安全轮询。

## 快速开始

1. Base URL 固定使用 `https://sd2.mengfactory.cn`
2. 提交接口固定使用 `POST /v1/videos`
3. 查询接口固定使用 `GET /v1/videos/{task_id}`
4. 素材直接在 `/v1/videos` 里传本地文件或远程 URL
5. 鉴权头固定使用 `Authorization: Bearer sk-...`
6. 模型名固定填写 `seedance-2-0-fast`

当前所有模型都不支持引用视频；`seedance-2-0-fast` 只作为早期模型名兼容老用户，不新增旧的视频引用能力。

完整提交地址：

```text
https://sd2.mengfactory.cn/v1/videos
```

完整查询地址：

```text
https://sd2.mengfactory.cn/v1/videos/{task_id}
```

## 基础参数

| 参数名 | 中文名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | 模型名 | string | 是 | 固定为 `seedance-2-0-fast` |
| `prompt` | 提示词 | string | 是 | 视频提示词 |
| `duration` | 视频时长 | integer | 是 | 仅支持 `4-15` 秒整数 |
| `ratio` | 画面比例 | string | 否 | 支持 `auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；默认 `auto` |
| `generate_audio` | 生成音频 | boolean | 否 | 是否生成同步音频，默认 `true`；传 `false` 可关闭音频生成 |
| `seed` | 随机种子 | integer | 否 | 传同一个整数可尽量复现相近结果 |
| `reference_mode` | 素材模式 | string | 否 | 默认 `omni_reference` |

说明：

- 不传 `ratio` 时，默认按 `auto`
- 不传 `generate_audio` 时，默认按 `true`
- 不传 `seed` 时，系统自动随机；传入时只接受整数
- 不传 `reference_mode` 时，默认按 `omni_reference`
- 当前不要传 `resolution`
- 当前支持的 `ratio` 固定为：`auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`

## 素材模式

`omni_reference` 只支持图片参考素材，让模型基于这些图片生成视频。

### omni_reference

- 图片字段：`image_file_1` 到 `image_file_9`
- 只支持图片参考素材，本地文件或远程 URL 都可以
- 不支持引用视频，也不要传视频 URL 作为参考

| 参数名 | 中文名 | 类型 | 说明 |
| --- | --- | --- | --- |
| `image_file_1` ~ `image_file_9` | 图片素材 1 ~ 9 | file/string | 图片素材，本地文件或远程 URL，最多 9 张 |

## 素材传入方式

`/v1/videos` 支持两种素材写法：

| 写法 | 适用场景 | 示例 |
| --- | --- | --- |
| 本地文件直传 | 文件不大，想一次请求提交 | `-F "image_file_1=@C:\path\image.png"` |
| 图片 URL | 你的素材已经有图片 URL | `"image_file_1": "https://example.com/image.png"` |

推荐规则：

- 文件较小且调用端方便 multipart 时，可以直接在 `/v1/videos` 上传文件
- 使用图片 URL 时，确保接口可以读取该素材链接

## 查询状态

| status | code | 说明 |
| --- | --- | --- |
| `queued` | `102` | 已进入排队 |
| `submitting` | `201` | 正在提交生成请求 |
| `queueing` | `202` | 进入生成排队 |
| `processing` | `203` | 正在生成 |
| `succeeded` | `200` | 生成成功 |
| `failed` | `422 / 502 / 503 / 504（常见）` | 失败时优先看 `error`，再按下面“失败码说明与解决方式”处理 |

## 失败码说明与解决方式

当前公开接口对外暴露的失败码，按“用户该怎么处理”收口为下面这些稳定口径：

| code | 什么时候出现 | 典型错误 | 解决方式 |
| --- | --- | --- | --- |
| `400` | 请求参数不合法 | `model and prompt are required`、`task_id is required`、时长/比例/模式参数错误 | 对照本文参数表检查字段名、类型和必填项；修正后重新提交 |
| `401` | 鉴权失败 | `missing API key`、`invalid API key`、`未授权` | 检查请求头是否为 `Authorization: Bearer sk-...`；确认 Key 没填错、没过期、没被禁用 |
| `402` | 额度不足 | `insufficient API key quota`、`额度不足，请联系管理员`、`预扣费额度失败...` | 更换有额度的 API Key，或联系管理员补充额度后再试 |
| `404` | 查询不到任务 | `Task not found`、`任务不存在`、`任务ID不存在或已过期` | 核对 `task_id` 是否完整；如果任务已过期或确实不存在，就重新提交新任务 |
| `413` | 上传文件或请求体超过限制 | `上传文件超过当前用户限制：单个文件最大 80MB，请压缩后重试`、`请求体过大，请压缩素材或调整请求内容后重试` | 按返回文案里的 MB 上限压缩素材，或改用更小文件后重新上传 |
| `422` | 内容/素材/输入问题 | `Face detected in your media. Try another one.`、`The audio may contain inappropriate content`、`Generation failed due to policy violation: unsafe content detected`、`Generation failed: uploaded material contains copyrighted character`、`Invalid prompt content: contains disallowed trademark` | 改提示词、换素材、删掉违规/敏感内容后再试；不要只反复重试原请求 |
| `502` | 生成服务异常 | 生成链路暂时没有返回可展示结果 | 先等待几分钟后重试；如果连续多次都是 `502`，联系管理员排查 |
| `503` | 当前生成服务暂时不可用 | 当前生成服务不可用或临时繁忙 | 先稍后重试；如果持续出现，联系管理员处理 |
| `504` | 当前生成服务响应超时 | `当前生成服务响应超时，请稍后重试`、`任务超时（N分钟）` | 先继续查询同一个 `task_id`；若确认已失败，再重新提交，不要立刻连发多次相同任务 |
| `521` | 查询链路源站暂时不可达 | Cloudflare `521` | 这不是业务失败；保持查同一个 `task_id`，按 `15s` 一次继续轮询，建议先继续轮询 `3 分钟` |

补充说明：

- 用户侧集成时，只按公开接口返回的 `code`、`status`、`error`、`progress.message` 处理
- 不要根据错误文案猜状态；最终状态以 `status` 为准

查询时优先按下面规则处理：

- `status=succeeded`：读取 `url`
- `status=failed`：直接读取 `error`
- 其它状态：读取 `progress.message`

## 调用示例

### JSON 提交

```json
{
  "model": "seedance-2-0-fast",
  "prompt": "让 @图片1 中的人物开始微笑，镜头缓慢推进",
  "duration": 5,
  "ratio": "16:9",
  "generate_audio": true,
  "seed": 12345,
  "reference_mode": "omni_reference",
  "image_file_1": "https://example.com/ref-image.jpg"
}
```

### multipart/form-data 提交

```bash
curl -X POST "https://sd2.mengfactory.cn/v1/videos" \
  -H "Authorization: Bearer sk-your-api-key" \
  -F "model=seedance-2-0-fast" \
  -F "prompt=让 @图片1 中的人物开始微笑，镜头缓慢推进" \
  -F "duration=5" \
  -F "ratio=16:9" \
  -F "generate_audio=true" \
  -F "seed=12345" \
  -F "reference_mode=omni_reference" \
  -F "image_file_1=@/path/to/ref-image.jpg"
```

### 使用远程 URL 提交任务

```json
{
  "model": "seedance-2-0-fast",
  "reference_mode": "omni_reference",
  "prompt": "@图片1 人物坐在沙发上喝茶打电话",
  "ratio": "1:1",
  "duration": 10,
  "generate_audio": true,
  "seed": 12345,
  "image_file_1": "https://example.com/ref-image.png"
}
```

### 查询任务

```bash
curl "https://sd2.mengfactory.cn/v1/videos/task_xxx" \
  -H "Authorization: Bearer sk-your-api-key"
```

## 生成成功的返回值及意思

查询接口在任务成功后，通常会返回下面这些字段：

| 字段 | 类型 | 什么时候出现 | 意思 |
| --- | --- | --- | --- |
| `code` | integer | 成功时总会出现 | 成功状态码，固定为 `200` |
| `status` | string | 成功时总会出现 | 当前任务状态，成功时固定为 `succeeded` |
| `task_id` | string | 成功时总会出现 | 你提交任务时拿到的任务 ID |
| `history_id` | string | 大多数成功任务会出现 | 生成记录 ID，便于排查和定位 |
| `url` | string | 成功时通常出现 | 主返回视频链接，用户优先取这个值 |
| `revised_prompt` | string | 成功时可能出现 | 实际生成时使用或修正后的提示词；没有修正时可能为空字符串 |
| `metadata` | object | 成功时通常出现 | 结果补充信息；只包含下面列出的公开字段 |

`metadata` 字段说明：

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `model_label` | string | 模型显示名 | `seedance-2-0-fast` |
| `aspect_ratio` | string | 实际使用的画面比例 | `16:9` |
| `duration_label` | string | 实际生成时长标签 | `5s` |
| `frame_rate` | integer | 视频帧率 | `24` |
| `resolution` | string | 实际分辨率档位 | `720p` |
| `resolution_label` | string | 分辨率显示名 | `Standard` |
| `generated_at` | string | 主站记录的生成完成时间 | `2026-04-24 18:30` |

成功返回示例：

```json
{
  "code": 200,
  "status": "succeeded",
  "task_id": "task_9f52b58e7ef54f3ab12c7f8d4c2a6b10",
  "history_id": "21686434283780",
  "url": "https://example.com/video-main.mp4",
  "revised_prompt": "",
  "metadata": {
    "model_label": "seedance-2-0-fast",
    "aspect_ratio": "16:9",
    "duration_label": "5s",
    "frame_rate": 24,
    "resolution": "720p",
    "resolution_label": "Standard",
    "generated_at": "2026-04-24 18:30"
  }
}
```

读取建议：

- 最优先读取 `url`
- 如果要判断任务是不是已经成功，以 `status=succeeded` 为准
- 如果要展示视频信息，只读取 `metadata` 里上表列出的公开字段
- 如果既要判断成功，又要拿链接，最常见的判断方式就是：

```text
status == succeeded -> 读取 url
```

## 轮询建议

1. 提交成功后只保存 `task_id`
2. 查询时优先按 `status` 解析，不要把 `progress.message` 当失败原因
3. `status=succeeded` 时读取 `url`
4. `status=failed` 时直接读取 `error`

## 轮询遇到 521 怎么办

如果查询 `task_id` 时遇到 `521`，不要立刻把任务判定为失败。

推荐策略：

- 保持对同一个 `task_id` 继续轮询
- 轮询间隔固定为 `15s`
- 建议先继续轮询 `3 分钟`
- 如果仍然持续 `521`，建议对已经拿到 `task_id` 的任务支持手动重连后继续查询同一个 `task_id`

## 常见报错

| 消息 | 处理方法 |
| --- | --- |
| `missing API key` | 检查 `Authorization: Bearer sk-...` |
| `invalid API key` | 检查 API Key 是否正确 |
| `seedance-2-0-fast 仅支持 4-15 秒整数时长计费` | 改为 `4-15` 秒整数 |
| `seed 必须是整数` | 删除 `seed` 或改为整数，例如 `12345` |
| `上传文件超过当前用户限制：单个文件最大 80MB，请压缩后重试` | 按文案中的 MB 上限压缩文件，或联系管理员调整上传档位 |
| `图片素材最多支持 9 张` | 减少图片数量 |
| `Face detected in your media. Try another one.` | 更换素材 |
| `视频生成失败，请稍后重试` | 稍后重试或更换提示词/素材 |

---

# seedance-2-0-fast 兼容 NewAPI 教学

本文用于兼容老用户在 NewAPI 后台接入 `seedance-2-0-fast` 渠道。接入完成后，你的用户通过你自己的 `/v1/videos` 接口提交视频生成任务，并用同一个 `task_id` 轮询结果。

## 一句话结论

在你的 NewAPI 后台新增渠道时，`API 地址` 填：

```text
https://sd2.mengfactory.cn/openai-compatible
```

不要填：

```text
https://sd2.mengfactory.cn/v1/videos
https://你的NewAPI域名/v1/videos
```

`/v1/videos` 是终端用户调用 NewAPI 的地址，不是后台渠道的上游地址。

## 地址区别

| 场景 | 应该使用的地址 | 说明 |
| --- | --- | --- |
| 你的 NewAPI 后台新增渠道 | `https://sd2.mengfactory.cn/openai-compatible` | 上游渠道 Base URL |
| 你的用户调用你的 NewAPI | `https://你的NewAPI域名/v1/videos` | 这是你的用户请求地址 |
| 你的用户轮询任务 | `https://你的NewAPI域名/v1/videos/{task_id}` | 使用提交接口返回的 `task_id` |

调用链路：

```text
终端用户/业务程序
-> 你的 NewAPI: POST /v1/videos
-> 你的 NewAPI 渠道
-> https://sd2.mengfactory.cn/openai-compatible/v1/videos
-> seedance-2-0-fast 兼容生成服务
```

## NewAPI 后台渠道配置

进入你的 NewAPI 后台：

```text
控制台 -> 渠道管理 -> 添加渠道
```

推荐配置：

| 配置项 | 填写内容 |
| --- | --- |
| 类型 | `OpenAI` |
| 名称 | `seedance-2-0-fast` |
| 密钥 | 分配给你的 `sk-...` API Key |
| API 地址 | `https://sd2.mengfactory.cn/openai-compatible` |
| 模型 | `seedance-2-0-fast` |
| 分组 | 按你的 NewAPI 分组策略填写，例如 `default` |
| 默认测试模型 | `seedance-2-0-fast` |

如后台有“模型重定向”配置，填写：

```text
seedance-2-0-fast -> seedance-2-0-fast
```

如果渠道测试报下面这种错误：

```text
invalid api key format for jimeng: expected 'ak|sk'
```

通常是渠道类型选错了。请确认类型是 `OpenAI`，不要选择即梦、Jimeng、火山或其它专用类型。

## NewAPI 模型配置

如果你的 NewAPI 模型列表里没有 `seedance-2-0-fast`，需要手动添加模型。

推荐模型配置：

| 配置项 | 填写内容 |
| --- | --- |
| 模型名称 | `seedance-2-0-fast` |
| 匹配类型 | 精确匹配 |
| 参与官方同步 | 否 |
| 可用分组 | 与渠道分组一致，例如 `default` |
| 计费类型 | 按次计费 |

说明：

- 模型管理页面只影响 NewAPI 对用户展示和计费
- 真实调用路由以“渠道管理”里的渠道配置为准
- 如果模型没有绑定到可用分组，用户调用时可能报模型不可用

## 用户调用方式

配置完成后，用户不需要知道上游地址。用户只调用你的 NewAPI 域名。

下面以 `https://你的NewAPI域名` 为例。实际使用时替换成你的真实域名。

### 文生视频

```bash
curl -X POST "https://你的NewAPI域名/v1/videos" \
  -H "Authorization: Bearer sk-你的NewAPI用户Key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2-0-fast",
    "prompt": "一只白色小猫在草地上慢慢走路，镜头缓慢推进",
    "duration": 4,
    "ratio": "16:9",
    "generate_audio": true,
    "seed": 12345
  }'
```

成功返回示例：

```json
{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "seedance-2-0-fast",
  "status": "queued",
  "progress": 0
}
```

### 图片参考生视频

图片参考使用 `multipart/form-data`，图片字段名写 `image_file_1`。下面提示词里的 `@图片1` 只是示例占位，用来表达第一张参考图。

```bash
curl -X POST "https://你的NewAPI域名/v1/videos" \
  -H "Authorization: Bearer sk-你的NewAPI用户Key" \
  -F "model=seedance-2-0-fast" \
  -F "reference_mode=omni_reference" \
  -F "duration=4" \
  -F "ratio=16:9" \
  -F "generate_audio=true" \
  -F "seed=12345" \
  --form-string "prompt=@图片1 让参考图中的主体轻轻动起来，保持原图风格，镜头缓慢推进" \
  -F "image_file_1=@/path/to/image.jpeg;type=image/jpeg"
```

Windows `curl.exe` 示例：

```bat
curl.exe --ssl-no-revoke -X POST "https://你的NewAPI域名/v1/videos" ^
  -H "Authorization: Bearer sk-你的NewAPI用户Key" ^
  -F "model=seedance-2-0-fast" ^
  -F "reference_mode=omni_reference" ^
  -F "duration=4" ^
  -F "ratio=16:9" ^
  -F "generate_audio=true" ^
  -F "seed=12345" ^
  --form-string "prompt=@图片1 让参考图中的主体轻轻动起来，保持原图风格，镜头缓慢推进" ^
  -F "image_file_1=@C:\path\to\image.jpeg;type=image/jpeg"
```

## 轮询任务

提交成功后，用返回的 `task_id` 轮询：

```bash
curl "https://你的NewAPI域名/v1/videos/task_xxx" \
  -H "Authorization: Bearer sk-你的NewAPI用户Key"
```

状态说明：

| status | 说明 |
| --- | --- |
| `queued` | 已进入队列，等待调用机处理 |
| `in_progress` | 正在提交或正在生成 |
| `completed` | 生成完成 |
| `failed` | 生成失败 |

完成后返回里会包含直链：

```json
{
  "id": "task_xxx",
  "status": "completed",
  "url": "https://example.com/video-main.mp4",
  "model": "seedance-2-0-fast",
  "object": "video"
}
```

推荐优先读取：

```text
url
```

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定 `seedance-2-0-fast` |
| `prompt` | string | 是 | 视频提示词 |
| `duration` | integer | 是 | 支持 `4-15` 秒整数；若管理员给用户设置了更低上限，以用户权限为准 |
| `ratio` | string | 否 | 支持 `auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；不传默认 `auto` |
| `generate_audio` | boolean | 否 | 是否生成同步音频，默认 `true`；传 `false` 可关闭音频生成 |
| `seed` | integer | 否 | 随机种子；传同一个整数可尽量复现相近结果 |
| `reference_mode` | string | 图片参考时建议填 | 推荐 `omni_reference` |
| `image_file_1` | file/string | 图片参考时使用 | 本地图片文件或远程 URL |

图片参考规则：

- 第一张图字段名：`image_file_1`
- 第二张图字段名：`image_file_2`
- 示例 prompt 里的 `@图片1`、`@图片2` 只表示第一张、第二张参考图
- 表单字段名仍然是 `image_file_1`、`image_file_2`

## 常见问题

### 1. 渠道 API 地址到底填哪个？

填：

```text
https://sd2.mengfactory.cn/openai-compatible
```

不要加 `/v1/videos`。

### 2. 用户实际调用哪个地址？

用户调用你的 NewAPI 地址，例如：

```text
POST https://你的NewAPI域名/v1/videos
GET  https://你的NewAPI域名/v1/videos/{task_id}
```

### 3. 为什么后台测试正常，但用户调用模型不可用？

检查三处：

- 模型管理里是否存在 `seedance-2-0-fast`
- 模型可用分组是否包含用户 token 所在分组
- 渠道分组是否包含用户 token 所在分组

### 4. 为什么一直是 queued？

`queued` 表示已经进入上游队列，通常是等待调用机。客户端应继续轮询同一个 `task_id`，不要重复提交同一个任务。

### 5. 为什么一直是 in_progress？

`in_progress` 表示任务已经进入提交或生成阶段。视频生成耗时不固定，客户端继续按同一个 `task_id` 轮询即可。

### 6. 为什么旧任务的 result_url 还是 `/content`？

旧任务在 NewAPI 数据库里已经存过结果，不会自动改写。新任务完成后应优先返回真实视频直链。

## 最小配置清单

```text
渠道类型：OpenAI
渠道名称：Seedance
API地址：https://sd2.mengfactory.cn/openai-compatible
密钥：sk-分配给你的Key
模型：seedance-2-0-fast
默认测试模型：seedance-2-0-fast
```

用户侧调用：

```text
POST https://你的NewAPI域名/v1/videos
GET  https://你的NewAPI域名/v1/videos/{task_id}
```

---

# API Key 查额度说明

## 适用范围

本文说明当前 Seedance Fast Studio 客户端里，如何通过 `API Key` 查询额度，以及界面上额度标签的换算方式。

这里描述的是桌面端现有实现行为：

- 客户端不会在本地把 `API Key` 转成其他账号标识
- 客户端会直接把 `API Key` 作为 Bearer Token 发给上游服务
- 上游服务根据该 Token 返回额度数据

## 使用方法

### 1. 在设置页填写连接信息

需要先准备两项全局配置：

- `Base URL`：固定填写 `https://sd2.mengfactory.cn`
- `API Key`

客户端后续查询额度时，使用的是这里保存的全局设置，而不是某一个单独会话临时输入的值。

### 2. 客户端发起额度查询

请求接口如下：

```http
GET {baseUrl}/api/usage/token/
Authorization: Bearer {apiKey}
```

完整请求地址：

```text
https://sd2.mengfactory.cn/api/usage/token/
```

示例：

```bash
curl -H "Authorization: Bearer sk-xxxx" https://sd2.mengfactory.cn/api/usage/token/
```

服务端识别额度归属的方式是：

- 看 `Authorization` 请求头
- 头部格式为 `Bearer <API Key>`

客户端本地不做额外的额度映射逻辑。

同一个查询接口同时支持月亮积分 Key 和太阳积分 Key，不需要为太阳积分换接口。服务端会根据当前 `API Key` 自身的积分类型返回同一套字段：

- `credit_type = "moon"`：下方额度字段表示月亮积分
- `credit_type = "sun"`：下方额度字段表示太阳积分

### 3. 查询频率

同一个 `API Key` 最多查询 `120` 次 / 分钟。

限频按 `API Key` 计算，不按客户端 IP 计算；同一公司或同一代理出口下的不同 Key 不会互相挤占查询次数。

## 自动刷新时机

当前实现里，额度一般会在下面几个时机自动刷新：

- 应用启动后，加载设置完成时
- 你修改 `API Key` 或 `Base URL` 后
- 提交任务成功并拿到 `taskId` 后

如果 `Base URL` 或 `API Key` 为空，客户端不会发起额度请求，并会清空当前显示的额度标签。

## 返回字段说明

客户端当前使用的额度响应字段如下：

- `token_group`
- `effective_group`
- `credit_type`
- `total_used`
- `total_granted`
- `total_available`
- `unlimited_quota`

典型响应示例：

```json
{
  "code": true,
  "data": {
    "token_group": "vip",
    "effective_group": "vip",
    "credit_type": "sun",
    "total_used": 3875000,
    "total_granted": 0,
    "total_available": 0,
    "unlimited_quota": true
  },
  "message": "ok"
}
```

字段含义：

- `token_group`：令牌自身设置的分组；为空表示继承用户主分组
- `effective_group`：当前令牌实际生效的主分组
- `credit_type`：当前 Key 的积分类型，`moon` 表示月亮积分，`sun` 表示太阳积分
- `total_used`：当前已使用的原始额度值
- `total_granted`：当前总授权额度的原始值
- `total_available`：当前剩余可用额度的原始值
- `unlimited_quota`：是否为无限额度

## 换算方式

界面显示时，不会直接展示接口返回的原始整数，而是按固定比例换算：

```text
显示额度 = 原始额度 / 500000
```

客户端里的显示规则如下：

- 保留 2 位小数
- 使用千分位分隔
- 如果 `unlimited_quota = true`，总额度显示为 `∞`

可以写成下面的公式：

```text
usedLabel = format(total_used / 500000)
totalLabel = unlimited_quota ? "∞" : format(total_granted / 500000)
最终显示 = "{usedLabel} / {totalLabel}"
```

## 换算示例

### 示例 1

原始数据：

```text
total_used = 0
total_granted = 50000000
unlimited_quota = false
```

显示结果：

```text
0.00 / 100.00
```

### 示例 2

原始数据：

```text
total_used = 3875000
total_granted = 0
unlimited_quota = true
```

显示结果：

```text
7.75 / ∞
```

### 示例 3

原始数据：

```text
total_used = 500000
total_granted = 2500000
unlimited_quota = false
```

显示结果：

```text
1.00 / 5.00
```

## 实现备注

如果你看到界面上的额度文本和接口原始值不一致，先确认是否已经按 `500000` 做了换算。当前客户端显示的是换算后的值，不是接口里的原始整数。

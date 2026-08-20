# KIK 官方 Seedance 接口迁移 TDD

> 状态：已本地实施并通过自动验证；真实 KIK、NewAPI、账单与生产部署待验收
> 日期：2026-08-20
> 范围：`kik-seedance-adapter` 内部上游协议；不修改 APP、NewAPI 渠道、计费和其他视频适配器
> 官方依据：[[运维/KIK.pdf]]

## 1. 目标

在保持 APP 与 NewAPI 现有 `/v1/videos` 合同不变的前提下，把 KIK 适配器从旧 `/video/v1/*` 协议迁移到 KIK 官方火山兼容接口：

```text
APP -> NewAPI /v1/videos -> kik-seedance-adapter
                            -> POST /providers/volcengine/api/v3/contents/generations/tasks
                            -> GET  /providers/volcengine/api/v3/contents/generations/tasks/:id
```

`doubao-seedance-2`、`doubao-seedance-2-0-fast-260128` 和 `doubao-seedance-2-mini` 使用同一套请求、任务和结果合同，不建立模型专属分支。

## 2. 已确认现状与根因

- 现有适配器调用 `https://51kik.com/video/v1/generations` 和 `/video/v1/tasks/:id`，请求体使用 `prompt`、`image`、`video`、`audio`、`upstream_options`。
- 该旧链路在 2026-08-12 至少完成过一次 Mini 真实生成，目前未带 Key 探测仍返回 `401`，因此不能认定旧接口已经失效。
- KIK 官方文档指定 Base URL 为 `https://51kik.com/providers/volcengine`，创建任务使用 `/api/v3/contents/generations/tasks`，输入统一放入 `content[]`。
- 官方成功任务把结果放在 `content.video_url`；现有解析器只识别顶层 `url` 或旧版 `data[].url`，直接切换 URL 后会误报 `KIK completed without a video URL`。
- 官方明确禁止只有音频的输入；音频必须同时带图片或视频。现有适配器和测试把纯音频视为合法。
- 现有自动测试完整模拟旧协议，因此 `8/8` 通过只能证明旧实现自洽，不能证明符合官方合同。

根因不是 APP 的 `/v1/videos` 设计，也不是三个模型参数不同，而是适配器内部仍固化了另一套 KIK 上游合同。

## 3. 保持不变的边界

- APP 仍向 NewAPI 提交 `POST /v1/videos`，并轮询 `GET /v1/videos/:id`。
- NewAPI 渠道 `111` 继续使用 OpenAI 类型、现有 Base URL、KIK Key、模型映射和计费配置。
- 三个 KIK 模型的名称、价格、比例、分辨率、4-15 秒时长和现有创作面板入口不变。
- 继续保持严格 120 秒提交总时限、10 秒连接时限、无自动重试和不记录 Key/提示词/素材 URL 的日志边界。
- 不修改 RunningHub、ZX、WorldRouter、Veo、Grok、Omni 或其他 `/v1/videos` 渠道。
- 不部署、不重启生产容器、不更换 Key；实施与生产切换分开执行。

## 4. 官方上游合同

### 4.1 鉴权与地址

```http
Authorization: Bearer <KIK_API_KEY>
Content-Type: application/json
```

```text
POST https://51kik.com/providers/volcengine/api/v3/contents/generations/tasks
GET  https://51kik.com/providers/volcengine/api/v3/contents/generations/tasks/:id
```

创建成功至少返回：

```json
{
  "id": "uuid",
  "model": "doubao-seedance-2",
  "status": "queued"
}
```

任务成功至少返回：

```json
{
  "id": "uuid",
  "model": "doubao-seedance-2",
  "status": "succeeded",
  "error": null,
  "content": {
    "video_url": "https://example.com/result.mp4"
  }
}
```

### 4.2 请求转换

适配器继续接收当前 NewAPI 请求，内部只生成一份官方请求：

```json
{
  "model": "doubao-seedance-2",
  "content": [
    { "type": "text", "text": "提示词" },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/frame.jpg" },
      "role": "reference_image"
    },
    {
      "type": "video_url",
      "video_url": { "url": "https://example.com/reference.mp4" },
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": { "url": "https://example.com/reference.mp3" },
      "role": "reference_audio"
    }
  ],
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 5
}
```

转换规则：

1. `prompt` 的文字部分转换为一个 `type=text` 项。
2. `image/images` 转换为 `image_url` 项；显式 `first_frame`、`last_frame`、`reference_image` 角色原样保留，普通图片默认 `reference_image`。
3. `video/video_url` 转换为 `video_url` 项，角色固定为 `reference_video`。
4. `audio/audio_url` 转换为 `audio_url` 项，角色固定为 `reference_audio`。
5. `ratio`、`resolution` 和整数 `duration` 放在请求顶层，不再生成 `upstream_options`。
6. 不把未知客户端字段或 `upstream_options` 任意透传给 KIK。

## 5. 输入校验

适配器是独立网络信任边界，不能只依赖 APP 校验：

- `model` 必须是已确认的三个模型之一，`prompt` 必须包含非空文字。
- `duration` 若存在，必须是 4-15 的整数；不得静默接受小数、字符串垃圾值或越界值。
- 只有音频、没有图片或视频时返回本地 `400`，不得请求 KIK。
- 图片、视频和音频必须包含有效的非空 URL；角色只能使用官方允许值。
- 保持当前产品上限：图片最多 9 张、视频最多 1 个、音频最多 1 个。官方更高上限不自动扩大当前产品能力。
- 文件格式、字节大小和真实媒体时长无法仅凭远程 URL 可靠判断，适配器不下载媒体做二次探测；由素材入口校验和 KIK 上游共同处理。

## 6. 状态与错误转换

- `queued`、`running` 等活动状态继续向 NewAPI 返回 `processing`。
- `succeeded` 返回 `completed`，视频地址读取 `content.video_url`。
- 官方失败状态返回 `failed`，优先保留官方 `error` 的 code/message，不把字典粗暴转成 Python 字符串。
- 非 JSON、缺少任务 ID、成功却缺少 `content.video_url`、网络错误和超时继续返回现有结构化错误，不泄漏 KIK Key 或请求内容。
- 不继续兼容旧 `data[].url` 来掩盖迁移错误；切换后的测试和实现只认官方结果合同。

## 7. 取消能力边界

官方文档已确认：

```text
DELETE /providers/volcengine/api/v3/contents/generations/tasks/:id
```

但当前 APP 取消只停止本地等待和轮询，尚未通过 NewAPI 调用适配器的删除接口。本次迁移不增加无人调用的适配器路由，也不改变现有取消文案。

后续只有确认 NewAPI 能安全透传 `DELETE /v1/videos/:id`、真实 KIK 返回成功且账单语义明确后，才另写 TDD 接入上游取消。不得把“接口返回 200”等同于“不扣费”或“退款”。

## 8. TDD 验收

### 8.1 红灯测试

先替换测试夹具为官方合同，确认当前实现失败：

1. 创建请求必须命中 `/providers/volcengine/api/v3/contents/generations/tasks`，当前仍命中 `/video/v1/generations`。
2. 上游请求必须包含 `content[]` 和顶层整数 `duration`，当前仍发送分离媒体字段和 `upstream_options.duration`。
3. 官方 `content.video_url` 成功响应必须返回视频 URL，当前解析器会返回 502。
4. 纯音频请求必须在本地返回 400 且上游调用次数为 0，当前返回 200 并调用上游。
5. 图片的 `first_frame`、`last_frame` 和 `reference_image` 角色必须进入官方字段，当前结构不符合官方格式。
6. 三个模型分别提交同构请求，必须生成除 `model` 外完全相同的官方结构。

### 8.2 绿灯测试

最小自动测试覆盖：

1. 三模型文字请求均命中官方创建地址并正确返回任务 ID。
2. 文字+图片、文字+视频、文字+图片+音频、文字+视频+音频和完整多模态均生成正确 `content[]`。
3. 纯音频、空提示词、未知模型、无效角色、无效 URL、非整数或越界时长在本地返回 400，且不调用上游。
4. `queued/running/succeeded/failed` 正确映射；成功结果读取 `content.video_url`。
5. 401、429、5xx、非法 JSON、缺少 ID、成功无视频 URL、连接异常和总超时保持结构化错误。
6. 超时日志继续只包含异常类型和耗时，不包含 Key、提示词或素材 URL。
7. Python 编译和 `git diff --check` 通过。

旧协议测试必须删除或改写，不能同时让两套互相冲突的 KIK 合同都通过。

### 8.3 真实验收

自动测试通过后才允许部署测试容器，并使用真实 KIK Key 逐项验收：

| 模型 | 最小真实任务 |
| --- | --- |
| `doubao-seedance-2` | 文字生成一次；图片参考生成一次 |
| `doubao-seedance-2-0-fast-260128` | 文字生成一次；图片参考生成一次 |
| `doubao-seedance-2-mini` | 文字生成一次；图片参考生成一次 |

再补充一次带参考视频的任务和一次“图片或视频 + 音频”任务，覆盖官方多模态路径。每个成功任务必须同时确认：

- KIK 返回任务 ID；
- NewAPI 能持续轮询到成功；
- `content.video_url` 经适配器返回并能访问有效 MP4；
- NewAPI 任务记录和扣费仍符合现有 `/v1/videos` 计费合同；
- 日志不包含 Key 或素材内容。

未执行真实 KIK、NewAPI、Desktop/Web 和账单验证前，不得把迁移标记为生产已完成。

## 9. 实施文件与顺序

```text
1. 改写 kik-seedance-adapter/tests/test_main.py
   -> 验证：官方合同红灯，确认失败点来自旧 URL、旧请求体和旧结果解析
2. 最小修改 kik-seedance-adapter/src/main.py
   -> 验证：适配器测试、Python 编译、git diff --check
3. 更新 kik-seedance-adapter/README.md
   -> 验证：只描述官方上游合同和现有 NewAPI 部署方式
4. 部署测试容器并执行真实矩阵
   -> 验证：三模型、参考媒体、轮询、MP4、日志和计费
5. 用户确认后替换生产容器
   -> 验证：保留旧镜像标签，可立即回滚；观察首批真实任务
```

适配器迁移本身只修改上述三个适配器文件和本 TDD，不修改 NewAPI、Nginx 或其他适配器。实施后审计若发现 APP 现有合同无法送达官方适配器，必须先补失败测试并记录根因，禁止无测试扩大边界。

## 10. 回滚与完成条件

- 部署前保留当前旧协议容器镜像和 compose 配置，不删除已验证的回滚版本。
- 新容器出现提交失败、轮询失败、结果 URL 丢失或计费异常时，直接回滚旧镜像，不在生产现场加入双协议自动降级。
- 只有自动测试全部通过、真实验收矩阵完成、用户确认三个模型可用且计费无回归，才能把本文状态改为“已实施”。
- 回滚能力保留到迁移后至少完成一轮稳定观察；旧协议代码不长期留在主分支形成双实现。

## 11. 本地实施结果（2026-08-20）

- `kik-seedance-adapter` 已改用官方 Base URL、创建地址和查询地址，APP/NewAPI 的 `/v1/videos` 对外合同未变。
- 三个模型共用同一转换路径；文字和参考媒体统一生成官方 `content[]`，`duration` 使用顶层整数。
- 成功任务只从官方 `content.video_url` 读取结果；旧 `/video/v1/*`、`upstream_options.duration` 和 `data[].url` 合同已从实现与测试移除。
- 适配器已在请求上游前拦截纯音频、非法角色、非法 URL、越界媒体数量以及非整数或 4-15 秒以外的时长。
- 官方合同测试 `11/11`、Python 编译和 `git diff --check` 通过。
- 实施后审计发现 APP 把 KIK 的本地视频和音频保留为 Data URL，但三个模型显式配置 `assetFlow: 'none'`；同时通用参数归一化遗漏 `videos`，导致素材在到达上传运行时前丢失。已恢复现有 `newapi-upload` 链路并保留 `videos`，没有新增上传器。
- 三个 KIK 模型已写入官方单文件大小上限：图片 30 MB、视频 200 MB、音频 15 MB；计划层已拒绝纯音频，并保留图片加音频、视频加音频。
- APP 计划与运行时测试共 `65/65` 通过，其中新增测试证明本地 MP4 和音频会先经 `/api/creations/uploads` 转为公网 URL，再提交 `/v1/videos`；`vue-tsc -b` 通过。
- 未部署或重启 KIK 适配器，未使用真实 KIK Key，未执行三个模型的真实生成、NewAPI 轮询、MP4、账单或 Desktop/Web 验收；因此当前不得标记为生产完成。

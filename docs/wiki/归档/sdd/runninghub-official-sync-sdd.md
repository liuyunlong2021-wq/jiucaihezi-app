# RunningHub 官方仓库同步改造 SDD

> 状态：草案已落地，作为后续 RH 改造最高执行准则。
> 官方源：`https://github.com/HM-RunningHub/OpenClaw_RH_Skills`
> 本地官方仓库：`/Users/by3/Documents/写剧本/runninghub_Skills-main`
> 旧仓库备份：`/Users/by3/Documents/写剧本/runninghub_Skills-main.backup.20260603-214931`

---

## 1. 最高准则

RunningHub 相关实现必须严格以官方最新仓库为最高事实源：

1. 标准 OpenAPI 模型必须以官方 `runninghub/data/capabilities.json` 为准。
2. 标准 OpenAPI payload 必须按官方 endpoint 的 `params` 动态组装。
3. AI App / 自建工作流必须按官方 `runninghub/scripts/runninghub_app.py` 流程执行：
   - `webappId` 来自 RunningHub AI App。
   - 先通过 `/api/webapp/apiCallDemo` 获取真实 `nodeInfoList`。
   - 文件上传走 `/task/openapi/upload`。
   - 上传后的文件值使用官方返回的 `fileName`。
   - 提交时使用 `webappId + nodeInfoList + apiKey`。
4. 禁止用旧本地仓库、旧 endpoint 名、经验字段名或猜测字段替代官方定义。
5. 如果官方 capabilities 中找不到某个 endpoint，该模型不得标记为“官方 capabilities 已覆盖”；必须先对照官方最新仓库修正 endpoint 或下架/禁用。

---

## 2. 当前仓库状态

已将旧本地 RunningHub Skill 仓库替换为官方最新仓库：

```text
新仓库路径：
/Users/by3/Documents/写剧本/runninghub_Skills-main

备份路径：
/Users/by3/Documents/写剧本/runninghub_Skills-main.backup.20260603-214931

官方 remote：
https://github.com/HM-RunningHub/OpenClaw_RH_Skills

当前 commit：
fb7de2b

最新 capabilities endpoint 数：
356
```

本地核验通过：

```text
runninghub/scripts/runninghub.py 存在
runninghub/scripts/runninghub_app.py 存在
runninghub/references/ai-application.md 存在
runninghub/data/capabilities.json endpoint_count = 356
```

---

## 3. 我们当前 RH 架构边界

产品链路保持不变：

```text
创作面板
  → NewAPI 鉴权 / 计费 / 渠道
  → rh-adapter Python FastAPI
  → RunningHub 官方 OpenAPI / AI App API
```

不改变：

- 不把 adapter 公开暴露给用户。
- 不给 adapter 增加额外鉴权；NewAPI 继续负责鉴权和计费。
- 不改画布。
- 不绕过 NewAPI 主 Token。
- 不使用旧 Node.js adapter。

---

## 4. 官方标准 API 对照结论

基于官方最新 `capabilities.json`，我们现有 RH 模型需要重新对照。

### 4.1 已确认官方覆盖

| 模型 | 当前/目标 endpoint | 官方状态 | 关键参数 |
|---|---|---|---|
| `rh-pro-image` 文生图 | `rhart-image-n-pro/text-to-image` | 已覆盖 | `prompt`, `aspectRatio`, `resolution` |
| `rh-pro-image` 图生图 | `rhart-image-n-pro/edit` | 已覆盖，需修正旧映射 | `imageUrls`, `prompt`, `aspectRatio`, `resolution` |
| `rh-image-v2` | `rhart-image-n-g31-flash/text-to-image` | 已覆盖，需修正旧映射 | `prompt`, `aspectRatio`, `resolution` |
| `rh-gpt2-text` | `rhart-image-g-2/text-to-image` | 已覆盖 | `prompt`, `aspectRatio`, `resolution` |
| `rh-video-v31-fast` 文生视频 | `rhart-video-v3.1-fast/text-to-video` | 已覆盖 | `prompt`, `aspectRatio`, `duration`, `resolution` |
| `rh-video-v31-fast` 图生视频 | `rhart-video-v3.1-fast/image-to-video` | 已覆盖 | `prompt`, `aspectRatio`, `imageUrls`, `duration`, `resolution` |
| `rh-grok-text-video` | `rhart-video-g/text-to-video` | 已覆盖 | `prompt`, `aspectRatio`, `resolution`, `duration` |
| `rh-grok-image-video` | `rhart-video-g/image-to-video` | 已覆盖 | `prompt`, `aspectRatio`, `imageUrls`, `resolution`, `duration` |
| `rh-speech-hd` | `rhart-audio/text-to-audio/speech-2.8-hd` | 已覆盖 | `text`, `voice_id`, `speed`, `volume`, `pitch`, `emotion` |
| `rh-speech-turbo` | `rhart-audio/text-to-audio/speech-2.8-turbo` | 已覆盖 | `text`, `voice_id`, `speed`, `volume`, `pitch`, `emotion` |
| `rh-music` | `rhart-audio/text-to-audio/music-2.5` | 已覆盖 | `prompt`, `lyrics`, `bitrate`, `sampleRate` |
| `rh-voice-clone` | `rhart-audio/text-to-audio/voice-clone` | 已覆盖 | `audio`, `custom_voice_id`, `text`, `accuracy`, `model`, `language_boost` |

### 4.2 当前映射需要纠正

| 模型 | 当前问题 | 正确处理 |
|---|---|---|
| `rh-pro-image` 图生图 | 当前 fallback 使用 `rhart-image-n-pro/image-to-image`，官方最新无此 endpoint | 改为 `rhart-image-n-pro/edit` |
| `rh-image-v2` | 当前使用 `rhart-image-n-v2/text-to-image`，官方最新无此 endpoint | 改为 `rhart-image-n-g31-flash/text-to-image` |
| `grok-video-3` | 当前使用混合 endpoint `rhart-video-g/text-or-image-to-video`，官方最新无此 endpoint | 前端便利别名必须拆到 `rh-grok-text-video` / `rh-grok-image-video`，adapter 不再注册该伪 endpoint |
| `rh-veo-31-fast` / `rh-veo-31-pro` | 当前 RH 映射 endpoint 未在官方最新 capabilities 中找到 | 不得标记为 RH 官方标准模型；需重新确认来源，无法确认前禁用或移出 RH adapter |

---

## 5. 官方 AI App / 自建节点规则

自建 RH App 不走标准 `capabilities.json` endpoint。

官方流程来自：

```text
runninghub/scripts/runninghub_app.py
runninghub/references/ai-application.md
```

执行规则：

1. 用户提供 RunningHub AI App 链接或 `webappId`。
2. 服务端调用：

```text
GET https://www.runninghub.cn/api/webapp/apiCallDemo?apiKey=...&webappId=...
```

3. 读取返回的真实 `nodeInfoList`。
4. 用户输入只能填入真实节点，不允许凭空发明 `nodeId`。
5. 文件字段必须先上传：

```text
POST https://www.runninghub.cn/task/openapi/upload
form:
  apiKey=...
  fileType=input
  file=@...
```

6. 上传成功后取 `data.fileName` 写入对应节点 `fieldValue`。
7. 提交：

```text
POST https://www.runninghub.cn/task/openapi/ai-app/run
body:
  apiKey
  webappId
  nodeInfoList
```

---

## 6. 五步执行顺序

必须按顺序执行，禁止跳步。

### Step 1：标准 API 官方 capabilities 驱动

目标：

- 当前 RH 标准模型不再靠手写 payload 猜字段。
- adapter 读取官方 capabilities registry。
- payload builder 按 endpoint params 自动组装。
- endpoint 名称先按官方最新表修正。

必须完成：

1. 将官方最新 `capabilities.json` 纳入 adapter 的标准 API registry。
2. 修正 `rh-adapter/src/models/mapping.py` 中错误 endpoint：
   - `rh-pro-image` fallback → `rhart-image-n-pro/edit`
   - `rh-image-v2` → `rhart-image-n-g31-flash/text-to-image`
   - `grok-video-3` 从 adapter 标准模型表移除，改为前端别名拆分
   - `rh-kling-v30-pro` 图生视频按 `firstImageUrl` / `lastImageUrl`
   - `rh-veo-31-fast` / `rh-veo-31-pro` 暂停 RH 标准映射，等待官方来源确认
3. 新增标准 payload builder：
   - `STRING` → `prompt` / `text` 等文本字段
   - `IMAGE` → 按官方 key 上传/填充
   - `VIDEO` → 按官方 key 上传/填充
   - `AUDIO` → 按官方 key 上传/填充
   - `INT` / `FLOAT` / `BOOLEAN` / `LIST` → 类型转换后填入
4. 标准上传规则严格按官方 `runninghub.py`：
   - 小文件可 data URI
   - 需要上传时走 `/openapi/v2/media/upload/binary`
   - 视频类输入强制上传
5. 测试必须覆盖所有保留 RH 标准模型的 endpoint 和参数 key。

验收：

```text
所有保留 RH 标准模型 endpoint 均能在官方最新 capabilities.json 中找到。
payload key 与官方 params 完全一致。
测试禁止出现仅靠 image / inputImage / referenceAudio 等猜测字段通过的情况。
```

### Step 2：AI App 真实 apiCallDemo nodeInfoList 驱动

目标：

- `rh-gpt2-image`、`rh-seedance2` 不再猜节点。
- 先调用 `apiCallDemo` 拉真实节点。
- 再按真实节点填 prompt、图片、比例、时长、尺寸。

验收：

```text
AI App 提交 payload 中 nodeInfoList 来自 apiCallDemo 或用户显式注册节点。
媒体字段 fieldValue 为官方 upload 返回的 fileName。
```

### Step 3：自建 RH App 注册表

目标：

- 添加自建 RH App 不再改核心代码。
- 用户/管理员只需登记 model id、label、output_type、webappId。

最低实现：

```text
RH_CUSTOM_AI_APPS='[
  {
    "id": "rh-custom-demo",
    "label": "自建视频Demo",
    "output_type": "video",
    "webapp_id": "123456789"
  }
]'
```

验收：

```text
adapter /v1/models 能列出自建模型。
自建模型提交时走 AI App apiCallDemo 流程。
NewAPI 渠道中同名模型可计费。
```

### Step 4：线上冒烟测试

目标：

以低成本任务验证线上真实链路。

测试矩阵：

1. 图片：`rh-pro-image` 或 `rh-gpt2-text`
2. 文生视频：`rh-grok-text-video`
3. 图生视频：`rh-grok-image-video`
4. 音频：`rh-speech-turbo`
5. AI App：`rh-gpt2-image` 或 `rh-seedance2`

验收：

```text
NewAPI 计费渠道命中正确。
adapter 提交成功。
/rh/tasks/{task_id}` 轮询成功。
创作面板画廊可保存结果。
失败时错误信息不泄露 RUNNINGHUB_API_KEY。
```

### Step 5：正式开放创作面板

目标：

- 创作面板只展示官方验证通过的 RH 模型。
- 自建 RH App 通过注册表进入模型列表。
- 不再展示未在官方 capabilities 或 AI App 注册表中验证的模型。

验收：

```text
创作面板所有 RH 模型均来自：
1. 官方 capabilities 标准 endpoint
2. 官方 AI App apiCallDemo 注册表

不存在旧 endpoint、猜字段、无法计费模型。
```

---

## 7. 禁止事项

- 禁止继续使用旧仓库 `runninghub_Skills-main.backup.*` 做实现依据。
- 禁止在 adapter 中保留官方 latest capabilities 查不到的标准 endpoint。
- 禁止把 AI App 当标准 OpenAPI endpoint 处理。
- 禁止凭经验写 `prompt/image_0/duration/ratio` 作为最终方案。
- 禁止在未完成 Step 1 前继续推进 Step 4 线上冒烟。
- 禁止部署未经过官方 capabilities 对照的 RH adapter。

---

## 8. 下一步

从 Step 1 重新开始：

1. 将官方最新 capabilities registry 接入 `rh-adapter`。
2. 修正模型 endpoint 映射。
3. 编写 payload builder 测试。
4. 让标准 API 服务层全部改用 payload builder。
5. 通过测试后，再进入 Step 2。


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
| `rh-seedance2-text-video` | `rhart-video/sparkvideo-2.0/text-to-video` | 已覆盖 | `prompt`, `resolution`, `duration`, `generateAudio`, `ratio`, `webSearch`, `returnLastFrame` |
| `rh-seedance2-image-video` | `rhart-video/sparkvideo-2.0/image-to-video` | 已覆盖 | `prompt`, `resolution`, `duration`, `firstFrameUrl`, `lastFrameUrl`, `generateAudio`, `ratio`, `returnLastFrame` |
| `rh-seedance2-multimodal-video` | `rhart-video/sparkvideo-2.0/multimodal-video` | 已覆盖 | `prompt`, `resolution`, `duration`, `imageUrls`, `videoUrls`, `audioUrls`, `generateAudio`, `ratio`, `returnLastFrame` |
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
| `rh-kling-v30-pro` | 用户已决定移除该模型 | 从 adapter、NewAPI 渠道、创作面板目录和测试中移除 |
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
   - `rh-kling-v30-pro` 移除
   - 新增 Seedance 2.0 官方标准模型：
     - `rh-seedance2-text-video` → `rhart-video/sparkvideo-2.0/text-to-video`
     - `rh-seedance2-image-video` → `rhart-video/sparkvideo-2.0/image-to-video`
     - `rh-seedance2-multimodal-video` → `rhart-video/sparkvideo-2.0/multimodal-video`
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

- `rh-gpt2-image` 以及后续登记的自建 AI App 不再猜节点。
- 先调用 `apiCallDemo` 拉真实节点。
- 再按真实节点填 prompt、图片、比例、时长、尺寸。

说明：

- Seedance 2.0 已按官方 capabilities 拆为 `rh-seedance2-text-video`、`rh-seedance2-image-video`、`rh-seedance2-multimodal-video` 三个标准模型。
- 旧 `rh-seedance2` AI App 模型不再作为当前目标模型保留。

验收：

```text
AI App 提交 payload 中 nodeInfoList 来自 apiCallDemo 或用户显式注册节点。
媒体字段 fieldValue 为官方 upload 返回的 fileName。
```

本轮执行结果：

- `submit_ai_app()` 已贴齐官方 `runninghub_app.py`：提交体只包含 `apiKey`, `webappId`, `nodeInfoList`。
- `rh-gpt2-image` 未显式传入 `nodeInfoList` 时，必须先调用 `/api/webapp/apiCallDemo` 获取真实节点。
- `apiCallDemo` 返回空节点或用户输入找不到可修改节点时直接失败，不再 fallback 猜 `prompt/image_0/size` 等节点。
- 用户显式传入的 `nodeInfoList` 仍允许作为注册节点来源，但其中 data URL 媒体必须先走 `/task/openapi/upload` 并替换为 `fileName`。

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

本轮执行结果：

- `RH_CUSTOM_AI_APPS` 支持 JSON array 和 JSON object 两种格式。
- 自建模型 `output_type` 支持 `image` / `video` / `audio`。
- 自建模型禁止覆盖内置模型 ID，避免误把标准模型改成 AI App。
- `/v1/models` 会列出自建模型，并返回 `custom: true`。
- 自建 image/video/audio 模型提交时均走 Step 2 的官方 AI App 流程：`apiCallDemo` 拉真实节点，媒体走 `/task/openapi/upload`，提交走 `/task/openapi/ai-app/run`。
- NewAPI 渠道文档已说明：在渠道模型列表追加同名自建模型 ID 后即可单独计费。

### Step 4：线上冒烟测试

目标：

以低成本任务验证线上真实链路。

测试矩阵：

1. 图片：`rh-pro-image` 或 `rh-gpt2-text`
2. 文生视频：`rh-grok-text-video`
3. 图生视频：`rh-grok-image-video`
4. Seedance 2.0 文生视频：`rh-seedance2-text-video`
5. Seedance 2.0 图生视频：`rh-seedance2-image-video`
6. Seedance 2.0 全能参考：`rh-seedance2-multimodal-video`
7. 音频：`rh-speech-turbo`
8. AI App：`rh-gpt2-image`

验收：

```text
NewAPI 计费渠道命中正确。
adapter 提交成功。
/rh/tasks/{task_id}` 轮询成功。
创作面板画廊可保存结果。
失败时错误信息不泄露 RUNNINGHUB_API_KEY。
```

本轮执行记录（2026-06-04）：

- 本地 Step 1-3 基线验证通过：
  - `cd rh-adapter && .venv/bin/python -m pytest -q` → 41 passed。
  - `pnpm exec vue-tsc -b` → 通过。
  - `node --test scripts/creation-models/__tests__/server.test.mjs scripts/rh-deploy/__tests__/config.test.mjs` → 10 passed。
- 公网只读检查：
  - `https://api.jiucaihezi.studio/rh/tasks/nonexistent` 已命中 adapter 轮询代理，返回 `processing`，说明 `/rh/tasks/` 路由存在。
  - `https://api.jiucaihezi.studio/api/creation/models` 仍返回旧模型目录，包含已移除的 `rh-kling-v30-pro`、`rh-veo-31-fast`、`rh-veo-31-pro`、旧 `rh-seedance2`，且缺少 Seedance 2.0 三个新标准模型。
- 当前阻塞：
  - 从本机到 `47.82.86.196:22` 超时；`ping` 与 HTTPS 正常，判断是 SSH 22 端口入站不可达，不是密码认证失败。
  - 本机未找到可复用的 NewAPI 测试 Token，因此无法完成“NewAPI 计费渠道命中正确”的付费冒烟。
- 已新增服务器侧继续执行脚本：
  - `scripts/rh-deploy/step4-server-deploy-and-check.sh`
  - 功能：备份并替换 `/opt/rh-adapter`，刷新 `/opt/creation-models`，幂等安装 `/rh/tasks/` Nginx 路由，收敛 NewAPI RH 渠道模型列表到 19 个，执行健康检查。
  - 若服务器环境变量提供 `NEWAPI_TEST_TOKEN`，脚本会额外执行 NewAPI `/v1/models` 与低成本 `rh-gpt2-text` 提交冒烟。
- Step 4 状态：已启动，但尚未验收完成。必须先完成服务器部署/刷新和 NewAPI Token 冒烟后，才能进入 Step 5。

服务器部署检查（2026-06-04 08:33 CST）：

- `rh-adapter` Docker 镜像已重新构建并启动。
- NewAPI RH 渠道已按分类修正：
  - `RH-图片`：`rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text`
  - `RH-视频`：`rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video`
  - `RH-音频`：`rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone`
- `GET http://172.17.0.1:8789/health` 返回 `models: 14`。
- `GET http://172.17.0.1:8789/v1/models` 返回 14 个 adapter 模型；不再包含 `rh-kling-v30-pro`、`rh-veo-31-fast`、`rh-veo-31-pro`、旧 `rh-seedance2`。
- `GET https://api.jiucaihezi.studio/api/creation/models` 已刷新为新模型目录；Seedance 2.0 三个标准模型均为 enabled。
- `GET https://api.jiucaihezi.studio/rh/tasks/step4-check` 已命中公网轮询代理。
- 剩余未验收项：需要使用有效 NewAPI Token 通过 `/v1/*` 实际提交图片、视频、音频、AI App 任务，并轮询 `/rh/tasks/{task_id}`。
- 已新增付费冒烟脚本：`scripts/rh-deploy/step4-newapi-smoke.sh`。该脚本不改线上配置，只读取 NewAPI Token 后依次测试模型列表、图片、音频、文生视频、图生视频、Seedance 2.0 三种视频与 AI App。
- 重要约束：NewAPI RH 渠道 `group` 必须保持为 `1`，这是生产收费分组。禁止为了让默认组 token 看见 RH 模型而把 RH 渠道改成 `default`。Step 4 冒烟必须使用可访问 `group=1` 的测试 token。

本地补充（2026-06-04）：已按用户提供的官方 AI App 文档新增 5 个 RH AI App 模型：`rh-aiapp-fast-digital-human`、`rh-aiapp-digital-human`、`rh-aiapp-director`、`rh-aiapp-voice-clone`、`rh-aiapp-voice-design`。其中 3 个数字人模型归入创作面板 `digital-human` 分类，前端显式提交官方 `nodeInfoList`，adapter 负责上传媒体与异步 submit+poll。下次服务器部署后 `/health` 应从 `models: 14` 升为 `models: 19`。

残留清理记录（2026-06-04）：

- 删除旧 Node.js adapter 目录 `scripts/rh-adapter/`，避免误部署旧同步/鉴权方案。
- 删除危险的 `scripts/rh-deploy/step4-newapi-fix-group-and-refresh.sh`，避免误把 RH 收费渠道 `group=1` 改成 `default`。
- 画布模型注册表移除旧 `rh-seedance2`，改为官方三个 Seedance 2.0 标准模型：
  - `rh-seedance2-text-video`
  - `rh-seedance2-image-video`
  - `rh-seedance2-multimodal-video`
- 新增测试守护：旧 Node adapter 文件不得存在；画布不得再注册旧 `rh-seedance2`。
- 允许保留旧模型字符串的范围仅限：
  - 测试断言“旧模型必须被拒绝”。
  - 部署脚本用于识别并清理旧 NewAPI 渠道配置的匹配条件。
  - SDD 历史/迁移记录。

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
- 禁止继续保留旧 `rh-seedance2` AI App 作为 Seedance 2.0 当前入口。
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

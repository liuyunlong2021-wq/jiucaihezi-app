# SDD: 在创作面板增加“普”前缀的5个媒体模型

> **日期**: 2026-06
> **状态**: 已实施 (code changes applied via additive edits; NewAPI config is user-side)
> **目标**: 支持“普” (普通/一般用户 group=1) 版本的媒体模型在创作面板出现和使用，与“川普特供” (高 group) 版本分离。
> **模型列表** (共5个):
> 1. 普gpt-image-2 (图片)
> 2. 普gemini-3-pro-image-preview (图片)
> 3. 普gemini-3.1-flash-image-preview (图片)
> 4. 普seedance2.0 (视频, 对应 backend seedance-2.0)
> 5. 普seedance2.0-fast (视频, 对应 backend seedance-2.0-fast)
> **原则**: 纯添加 (additive only)，不修改任何现有模型定义、逻辑、测试默认行为。现有 gpt-image-2、rh-seedance2-*、seedance-2-0 等保持不变。

## 1. 问题陈述

### 当前状态
- 创作面板模型列表由静态 `MEDIA_MODEL_CAPABILITIES` (in `src/data/mediaModelCapabilities.ts`) + 运行时 availability (`/api/creation/models` 来自 NewAPI channels 查询) 驱动。
- 现有 image: 只有 `gpt-image-2` (和其他 disabled nano/rh)。
- 现有 video Seedance: `seedance-2-0` (disabled, model=seedance-2-0-pro, legacy /api/seedance), 和 3 个 rh-seedance2-* (RH AI App 路径)。
- 用户在 NewAPI 已为“川普特供”配置了 channels (group 高倍率)，模型名如 gpt-image-2、gemini-*-image-preview、seedance-2.0 / seedance-2.0-fast。
- 官方/CNS Seedance 只有 seedance-2.0 和 seedance-2.0-fast (无 Pro 变体)。
- 需要在前端 UI (创作面板模型选择器) 增加带“普”前缀的独立入口，让普通用户 (group=1 token) 能看到和使用这些模型。
- 生成时应路由到对应 NewAPI channel (按 model 名 + token group 选择 channel)，使用已配价格。

### 目标
- 创作面板中出现 5 个新“普xxx”模型选项 (label 以“普”开头)。
- 可用性由 普 group channel 状态控制 (status=1 则 enabled)。
- 调用时走标准路径 (image 用 /v1/images/generations/edits；video 用 /v1/videos 因为 model 名不是 seedance-2-0-pro)。
- 不影响现有模型、Trump 特供通道、canvas 节点、技能等。
- 最小变更：只在 catalog 和 availability ROUTES 添加。

## 2. 架构变更

### 2.1 前端 Catalog (mediaModelCapabilities.ts)
- 在 `MEDIA_MODEL_CAPABILITIES` 数组末尾追加 5 个新对象 (纯追加)。
- 结构参考现有：
  - id: '普xxx' (e.g. '普gpt-image-2')
  - label: '普xxx' (e.g. '普gpt-image-2')
  - task: 'image' 或 'video'
  - model: backend NewAPI model 名 (e.g. 'gpt-image-2', 'seedance-2.0', 'seedance-2.0-fast')
  - provider: 'gateway-image' (for images, 无 webappId 则走 gpt image path) 或 'gateway-video'
  - enabled: true
  - 对于 images: maxFiles, acceptedFiles, fields (prompt, size/aspect, image, response_format) — 复制 gpt-image-2。
  - 对于 videos (seedance 普): 复制 seedance-2-0 的 fields (prompt, ratio, resolution, duration, images)，但 model 用 2.0/fast 名，endpoint 可省 (走通用 /v1/videos 路径)。
- 更新 `isRemovedMediaModelId`：在 seedance 检查中添加对 '普seedance' 的豁免 (return false)，防止被误判 removed。
- 影响：`getMediaModelsForTask` 会包含它们 (如果 availability enabled)；`getMediaModel` 可查到；面板会显示 label。

### 2.2 Availability 服务 (scripts/creation-models/server.mjs)
- 在 `CREATION_MODEL_ROUTES` 数组末尾追加 5 个新 entry (纯追加)：
  ```ts
  { id: '普gpt-image-2', aliases: ['gpt-image-2'] },
  { id: '普gemini-3-pro-image-preview', aliases: ['gemini-3-pro-image-preview'] },
  { id: '普gemini-3.1-flash-image-preview', aliases: ['gemini-3.1-flash-image-preview'] },
  { id: '普seedance2.0', aliases: ['seedance-2.0'] },
  { id: '普seedance2.0-fast', aliases: ['seedance-2.0-fast'] },
  ```
- 服务逻辑不变：查询 NewAPI channels，如果 channel.models 包含 alias 且 status=1，则该 id enabled。
- 这样 /api/creation/models 会返回这些 普 id 的 status (基于 普 group channel)。

### 2.3 生成逻辑 (media-generation.ts)
- 无需修改。
- Images (3 个普): 都会走非-rh 非-nano 分支 (因为无 webappId)，调用 /v1/images/generations 或 /edits，body 带 model 名。NewAPI 按 model + token group 路由到对应 channel。
- Videos (2 个普): model = 'seedance-2.0' 或 '-fast'，`isSeedanceVideo` (只检查 'seedance-2-0-pro') 不触发，走通用 `videoPath = '/v1/videos'`，调用 NewAPI /v1/videos。完美匹配 md 文档的 NewAPI 兼容用法。
- assertMediaModelExecutable 会通过 (不在 removed 列表，且 availability enabled)。

### 2.4 NewAPI 配置 (用户侧)
- 为“普” group (通常 "1") 创建/更新 channel(s)：
  - 类型 OpenAI 或 Custom (视模型)。
  - models 列表包含这 5 个名字：gpt-image-2, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview, seedance-2.0, seedance-2.0-fast。
  - 分组: 1 (普)。
  - 状态: 启用。
  - 价格: 在模型价格或 channel ratio 设置 (镜像 Trump 通道但 group 不同)。
- 模型管理中注册这些 model 名 (精确匹配)，可用分组包含 1。
- Trump 通道 (川普特供) 保持不变，可同时列这些 model 名 (group 选择决定使用哪个 channel)。
- 结果：普 token 的 /api/creation/models 会看到 普 id enabled；调用时 NewAPI 选 普 channel。

### 2.5 UI (CreationPanel + useCreation)
- 无需修改。
- `availableModels` 会包含新 id (来自 getModelsForTask + availability)。
- 模型 popover 会显示新 label ('普xxx')。
- 选择后，fields 驱动参数 UI (size/prompt/images/duration 等)。
- 提交时传 modelKey (新 id)，但 generation 用 .model (backend 名)。

### 2.6 其他影响 (最小)
- Tests: 部分测试可能需更新 (e.g. mediaGenerationModelGuard.test, mediaModelCapabilities.test) 来 cover 新 id，但核心测试应 pass (additive)。
- Canvas / agentStore / skills: 不影响 (它们用自己的模型列表或 gpt-image-2 默认)。
- isRemovedMediaModelId: 已更新豁免 普seedance。
- 可用性刷新: 面板 onMounted 会调 refreshCreationModelAvailability。

## 3. 实施步骤 (代码变更)

1. 编辑 `src/data/mediaModelCapabilities.ts`：
   - 数组末尾追加 5 个新对象 (见上面描述)。
   - 在 `isRemovedMediaModelId` 的 seedance if 块中添加：
     ```ts
     if (value.startsWith('普seedance')) return false
     ```
     (放在 rh 检查后)。

2. 编辑 `scripts/creation-models/server.mjs`：
   - ROUTES 数组末尾追加 5 个 {id, aliases}。

3. NewAPI 后台操作 (非代码)：
   - 普 group channel 添加上述 5 个 model 名。
   - 设价格。
   - 启用 channel。
   - (可选) 模型管理注册。

4. 测试：
   - 运行 `pnpm test` 或特定 creation 相关测试。
   - 在 APP 中用 普 token 打开创作面板，检查 5 个 普 模型出现并可提交。
   - 用 Trump token 检查原有模型仍正常。

5. 文档更新 (可选)：
   - 更新 我的服务器运维手册.md 或 特朗普API.md 记录 普 channels。
   - 更新本 SDD 状态为 "已实施"。

## 4. 风险与缓解

- Gemini image preview 是否支持 /v1/images/generations：假设 NewAPI 已配置 channel 支持 (用户侧确认)。
- 字段不匹配 (Gemini vs GPT)：先用 gpt 相同 fields；如需可后续加 aspect_ratio 等 (additive)。
- Availability 全局 (任何 channel enabled 就报)：execution 时 group 仍强制 (NewAPI 侧)。
- 重复 model 名 (gpt-image-2 已有)：两个 id (原有 + 普) 会同时出现 (用户可见两个入口)，符合“普 vs 特”分离需求。
- Seedance 2.0 vs Pro：按官方用 2.0/fast；legacy pro 仍保留给其他用途。
- 无 breaking：所有变更 additive，原有 id/label/行为不变。

## 5. 验证

- 普 token: 创作面板应列出 5 个新“普xxx”模型 (images + videos)。
- 提交生成：成功，计费走 普 channel。
- Trump token: 原有模型正常 (gpt-image-2 等仍可用)。
- /api/creation/models : 包含新 普 id 且 status=enabled (当 channel on)。
- 无 regression: 现有 nano/rh/grok 等模型仍按原样工作。

此 SDD 描述了最小、安全的实现方式，符合“纯手动”产品原则 (用户显式选模型，NewAPI 渠道控制可用性)。 

后续可考虑动态从 NewAPI models 拉取，但当前静态 + ROUTES 是现有架构。
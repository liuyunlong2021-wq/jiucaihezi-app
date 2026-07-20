# 启动默认对话、媒体确认卡参数编辑与 ZX 参考图视频修复 SDD

> 日期：2026-07-21
> 状态：设计已确认，待实施
> 依据：`AGENTS.md`、[[开发/创作工作台架构SDD]]、[[开发/韭菜盒子原生媒体编排能力SDD]]、[[开发/ZX-Grok视频双模式修复SDD]]、[[归档/模型文档/zx-生图生视频模型]]

## 1. 目标

1. Desktop 每次启动先显示对话界面，只有用户点击“电商”时才进入电商工作台。
2. 媒体确认卡使用韭菜盒子橄榄绿主题，默认保持一键生成，并可按需在卡片内调整模型、比例、分辨率和时长。
3. ZX Grok 1.5 Video 6s、10s、15s 使用本地参考图时，不再调用已删除的上传接口，按 ZX 现行合同完成图生视频提交和轮询。

## 2. 根因

### 2.1 启动总是进入电商工作台

`ecommerceWorkbenchStore.surface` 默认是 `workbench`。用户的聊天模式持久化为 `creative` 时，`WorkspaceLayout` 启动后立即满足电商工作台显示条件。

根因是工作台表面默认值错误，不是路由、会话或创模式本身错误。

### 2.2 确认卡颜色和参数控制不足

`MediaPlanCard` 使用旧的紫色 `--accent`，没有复用产品主色 `--olive`。计划虽然已有模型、比例、分辨率、时长和价格，但卡片只展示部分参数，也没有受控修改入口。

### 2.3 ZX 参考图视频 404

真实链路在模型提交前失败：

```text
本地参考图
  -> uploadCreationAsset()
  -> POST /api/creations/uploads
  -> 该旧 Gateway 路由已明确删除
  -> 404，ZX 模型尚未收到请求
```

ZX 文档允许 `image` 接收图片 URL 或 data URL，并规定：

- 提交：`POST /v1/videos/generations`
- 图片：`image: { image_url: <URL 或 data URL> }`
- 轮询：`GET /v1/videos/{request_id}`

现有注册表和运行时仍套用通用直连视频上传、提交与轮询合同。上次修复只校正了文生视频/图生视频模式推导，没有覆盖真实本地参考图提交。

## 3. 已确认交互

### 3.1 启动行为

- `ecommerceWorkbenchStore.surface` 默认改为 `collaboration`。
- 不清除用户选择的文、武、创模式，不修改会话和项目恢复。
- 用户点击左侧“电商”后，当前运行期间照常进入工作台。
- APP 重启后重新从对话界面开始。

### 3.2 媒体确认卡

卡片默认直接展示：

- 模型名称与有效模式；
- 比例、分辨率、时长；
- 参考素材；
- 价格；
- “开始生成”和“调整”按钮。

“调整”默认折叠。点击后在当前卡片内展开控件，不弹出模态框。用户不调整时，原有一键生成流程不增加步骤。

卡片边框、浅色背景和主按钮统一使用 `--olive`、`--olive-pale`、`--olive-dark`，不再使用紫色 fallback。

## 4. 参数编辑合同

### 4.1 唯一事实来源

- 模型列表来自 `listCreationModels({ task: plan.kind })`。
- 可用性继续由现有模型可用状态过滤。
- 比例、分辨率、时长选项来自 `CreationModelSpec.fields` 和 `capabilities`。
- 不在 Vue 组件中复制模型或参数表。

### 4.2 数据归属

```text
MediaPlanCard 修改参数
  -> MessageBubble 透传 messageId + patch
  -> ChatPanel 更新该消息的 mediaPlan
  -> validateMediaPlan()
  -> persistCurrentSession()
  -> 用户确认
  -> CreationPanel + mediaTaskStore 唯一执行链
```

卡片不能只保存临时本地值，否则虚拟列表卸载、刷新或重启会丢失选择。

### 4.3 换模型规则

- 只显示与计划类型相同、当前可用、且能容纳现有参考素材数量的模型。
- 保留标题、提示词和参考素材。
- 新模型支持原比例、分辨率、时长时保留；不支持时使用该模型注册表默认值或第一个合法值。
- 每次修改后立即重新运行 `validateMediaPlan()`，同步刷新模式、价格和错误。
- `submitting`、`submitted` 状态禁止调整；`ready`、`failed` 可以调整并重新验证。

## 5. ZX 请求合同

仅对 `upstreamFamily === 'zx'` 的 Grok 1.5 Video 使用 ZX 合同：

1. 注册表提交端点改为 `/v1/videos/generations`。
2. ZX 素材流不调用 `uploadCreationAsset()`；本地 data URL 和远程 URL 直接进入请求。
3. 单张参考图写为 `image: { image_url: value }`。
4. 轮询地址固定为 `/v1/videos/{request_id}`，不能拼成 `/v1/videos/generations/{id}`。
5. 继续限制最多一张参考图。

其他直连模型仍按各自 `assetFlow` 处理，不能因为修 ZX 而全局跳过上传。不得恢复 `/api/creations/uploads`，因为它已不属于当前 Gateway 职责。

## 6. 文件责任

| 文件 | 修改责任 |
| --- | --- |
| `src/stores/ecommerceWorkbenchStore.ts` | 默认表面改为对话协作 |
| `src/components/chat/MediaPlanCard.vue` | 展示与编辑参数、主题样式 |
| `src/components/chat/MessageBubble.vue` | 透传计划更新事件 |
| `src/components/chat/ChatPanel.vue` | 更新、验证并持久化消息计划 |
| `src/runtime/workbench/mediaPlan.ts` | 提供纯参数归一和可选模型能力，避免组件硬编码 |
| `src/runtime/creation/creationModelRegistry.ts` | 修正三个 ZX 模型端点和素材流声明 |
| `src/runtime/creation/creationMediaRuntime.ts` | 按 assetFlow 处理素材并生成 ZX 请求/轮询合同 |

不新增 Store、上传服务、Gateway 路由或第二套媒体任务执行器。

## 7. 失败处理

- 调整后的参数无效：卡片原地显示原因并禁用生成。
- 模型不可用或参考图超限：不静默换模型，要求用户重新选择。
- ZX 返回非任务 ID：保留当前计划和参考图，显示提交失败，可继续调整或重试。
- 项目或参考素材失效：继续使用现有素材刷新与项目归属校验。

## 8. 测试与验收

先写失败测试，再改实现：

1. Store 测试：创模式启动时默认显示对话，点击电商仍可进入工作台。
2. 计划纯函数测试：模型过滤、换模型后的参数保留/回退、无效参数拒绝。
3. 组件合同测试：卡片展示四类参数、折叠调整区、橄榄绿主题和更新事件。
4. ZX 运行时测试：data URL 不调用旧上传接口，提交 `/v1/videos/generations`，请求体使用 `image.image_url`，轮询 `/v1/videos/{id}`。
5. 回归测试：三个 ZX 时长的文生/图生模式仍正确；其他直连视频的上传策略不变。
6. 自动门禁：定向测试、完整 focused、Rust、TypeScript、Web/Desktop 构建和产物审计。

人工验收：

- 重启 Desktop 后首先看到对话界面；
- 卡片默认不弹窗，一键生成仍可用；
- 展开调整后能改合法模型和参数，刷新后选择仍在；
- 用刚生成的图片执行一次 ZX Grok 6 秒真实图生视频；
- 控制台不再出现 `/api/creations/uploads` 404，请求完成提交、轮询、落盘和画布回流。

## 9. 完成标准

以上自动门禁通过，并完成至少一次真实 ZX 6 秒参考图视频闭环后，才能把本问题标记为完成。真实付费链路未验收时只能声明“代码与自动验证完成”。

# 对话框调用现有创作面板 SDD

> 日期：2026-07-20
> 状态：已实施并通过自动验证；真实付费媒体任务待人工确认
> 依据：`AGENTS.md`、`docs/wiki/开发/创作模式双端统一SDD.md`、`docs/wiki/开发/电商工作台SDD.md`

## 目标

用户在 Web 或 Desktop 创作模式对话框用自然语言提出生图或生视频需求；模型只负责理解需求并输出可审阅的媒体计划，用户确认后由现有 `CreationPanel` 和 `mediaTaskStore` 统一提交、轮询、落盘和展示。创作面板的媒体执行逻辑不复制、不迁移。

## 根因与边界

当前创作面板已有稳定的模型注册、参数校验、任务提交、轮询、`jc-media` 落盘和画布回流链路，但普通对话只有两条分裂路径：直接选媒体模型时绕过文本模型，电商工作台使用专用 `ecommerce-media-plan-*` 事件。缺少一个普通对话可用的、需要用户确认的通用媒体计划入口。

本次只补这个入口，不改：

- `CreationPanel` 的表单和媒体执行器；
- `mediaTaskStore.submitTask()` 的统一任务入口；
- 已有电商工作台事件；
- Web/桌面不同的媒体 API 适配。

## 设计

### 1. 媒体计划合同

模型在创作模式明确识别到媒体生成意图时，最终回复可包含一个 `jc-media-plan` fenced JSON 块。计划支持 `image`、`video` 两类，字段只允许文本、合法模型 ID 和已声明的参考素材数组。解析与校验复用 `creationModelRegistry`、`buildCreationRunPlan`，未知模型或非法参数在提交前拒绝。

模型不得在此路径运行 `jc_media.py`、媒体 API、轮询或下载；没有媒体意图时照常自然语言回答，不生成计划块。

### 2. 对话确认

创作模式助手消息解析出合法计划后，在消息气泡内显示计划摘要和“开始生成”按钮。点击前不提交付费任务；按钮提交后进入 `submitting` 状态，防止重复点击。计划解析失败只显示普通回答，不自动执行。

### 3. 现有创作面板桥

“开始生成”发出通用 `media-plan-approved` 事件，携带 `sessionId`、`messageId` 和计划。`CreationPanel` 复用 `buildMediaPlanSubmission()`，补充对话归属字段后调用现有 `mediaTaskStore.submitTask({ source: 'creation' })`。成功发出 `media-plan-submitted`，失败发出 `media-plan-failed`。任务完成仍由现有 `media-task-settled` 提供真实状态。

对话收到提交事件后插入现有 `MediaTaskBubble` 所需的任务消息；后续进度和完成结果由该现有任务气泡响应 `mediaTaskStore`。结果仍只由 `mediaTaskStore` 写入项目 `jc-media` 并由创作面板/画布展示。

### 4. 默认模型策略

通用对话的媒体计划不再把模型选择交给模型猜测。应用按真实素材选择默认模型；模型回复中的 `modelId` 不作为选择依据，只有用户在确认卡手动调整后才覆盖默认：

| 请求 | 默认模型 | 说明 |
| --- | --- | --- |
| 生图（无图或有参考图） | `runninghub/api/rh-gpt2-official` | `GPT Image 2 官方`，已有文生图/图生图统一合同 |
| 文生视频 | `runninghub/api/rh-seedance2-text` | `Seedance 2.0 文生视频` |
| 一张参考图生视频 | `runninghub/api/rh-seedance2-image` | `Seedance 2.0 图生视频` |
| 多张图片或参考视频参与的视频生成 | `runninghub/api/rh-seedance2` | `Seedance 2.0 多模态` |

解析阶段将计划标记为应用默认；素材 ID 在应用内解析后，再根据真实素材类型补全对应的 Seedance 模型。确认卡手动改模型会清除默认标记。默认模型失效时，计划不自动偷换成其他付费模型，而是显示不可提交状态，要求用户在“调整”中选择当前可用模型。

媒体策略提示明确要求模型不输出默认模型 ID；模型只负责理解创作需求和填写真实媒体参数。

### 5. 可编辑性

`SKILL.md` 只负责模型规则和计划输出要求；计划解析、模型校验、事件和任务归属是 TypeScript 合同。以后可以独立修改 Skill 文案，也可以独立修改执行代码，不把付费任务交给模型自由拼接。

## 文件责任

| 文件                                        | 责任                                               |
| ------------------------------------------- | -------------------------------------------------- |
| `src/runtime/workbench/mediaPlan.ts`        | 解析、字段校验、默认模型选择、Creation 模型校验    |
| `src/runtime/workbench/mediaPlanBridge.ts`  | 将计划转换为现有提交参数                           |
| `src/components/chat/MediaPlanCard.vue`     | 计划摘要、确认按钮、状态展示                       |
| `src/components/chat/MessageBubble.vue`     | 在助手消息中挂载计划卡并转发确认事件               |
| `src/components/chat/ChatPanel.vue`         | 创作回复解析计划、处理确认/提交/完成事件和任务消息 |
| `src/components/creation/CreationPanel.vue` | 接收通用计划事件，继续调用现有任务引擎             |
| `src/composables/creativeChat.ts`           | 注入媒体计划输出规则，不执行媒体任务               |

## 验收

- 创作模式普通对话提出图片或视频需求时，模型可输出合法计划；普通问题不出现计划卡。
- 计划卡显示模型、提示词摘要和参考素材数量；未点击“开始生成”不产生任务。
- 点击一次只提交一次；非法模型/参数不显示确认按钮、不进入任务引擎；提交阶段错误显示在卡片上。
- 提交调用 `CreationPanel` 既有 `mediaTaskStore.submitTask`，任务来源为 `creation`，并保留对话 session/message 归属。
- 任务状态和结果复用现有 `MediaTaskBubble`、`jc-media`、创作面板和画布，不新增第二套轮询或下载逻辑。
- 电商工作台既有事件和测试继续通过。
- 生图未指定模型时使用 `GPT Image 2 官方`；无参考图视频、一张图视频和多模态视频分别使用对应的 Seedance 2.0 默认模型。
- 模型回复中的 `modelId` 不覆盖产品默认；确认卡手动改模型不被默认策略覆盖；默认模型不可用时不自动换成其他收费模型。
- 针对性 Node 测试、TypeScript 检查、`git diff --check` 通过；完整构建若受无关既有问题阻断，必须如实记录。

## 明确不做

- 不把口播、Whisper、FFmpeg、HyperFrames 接入本次通用对话桥。
- 不把所有 Skill 自动猜成表单。
- 不在模型回复后自动消费计划或自动产生付费任务。
- 不复制 `CreationPanel` 的媒体 API、轮询、落盘和画布逻辑。

## 实施与审计结果

- Web `chatCloud` 与 Desktop `creativeChat` 共用同一 `MEDIA_PLAN_POLICY`；普通回答不含计划块时不改变现有对话行为。
- 图片和视频计划共用既有 `mediaPlan` 解析、Creation 模型注册表、`buildCreationRunPlan`、`CreationPanel` 和 `mediaTaskStore`；未新增依赖、任务队列、轮询器或下载器。
- 用户确认前不提交任务；同步状态锁阻止重复点击，提交失败后可原地重试。
- 修复首次打开创作面板时事件可能早于组件挂载的竞态：复用现有 `consumeLastEvent`，不增加新队列。
- 电商工作台继续使用原事件名，但与普通对话共用同一个提交函数，避免两套媒体桥漂移。
- 过度设计审计删除了未被本轮要求的音频计划和音频专属字段；口播及本机媒体依赖不进入本次实现。
- 自动验证覆盖图片、视频、非法模型/类型、Web/Desktop 计划规则、用户确认事件和唯一任务入口。未实际点击付费生成；本地内置浏览器实例不可用，计划卡视觉与一次真实媒体结果仍需人工验收。

## 默认模型策略实施记录（2026-07-21）

- 已实施：缺省 `modelId` 标记为应用默认；真实参考素材解析后统一选择 GPT Image 2 官方或对应的 Seedance 2.0 模型。
- 已自动验证：缺省生图、模型错误指定 Fast、无参考图视频、一张参考图视频、多素材视频，以及确认卡手动改模型六条路径；默认模型临时下线由既有可用性校验拒绝提交，不自动换成其他付费模型。

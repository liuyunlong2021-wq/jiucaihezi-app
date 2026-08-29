# Wiki 操作日志

## [2026-08-28] 实施完成 | Wiki Agent 结果优先与独立状态卡

- Wiki Agent 收敛为最小两阶段：一次最小 ReadPlan、一次回答与可选 ChangePlan；不再因资料不足自动补读或阻断回答，`paths` 可为空。
- 模型负责理解任务、选择页面、生成答案和变更意图；程序负责路径安全、正文、`index.md`、双链、来源、日志、回滚和写后验证。
- Wiki 写入结果改为独立程序状态卡展示真实路径、索引/双链/日志验证和失败原因，不把完整内部 apply 回执拼入模型正文。
- 验证：Wiki/内存定向 `25/25`，UI + Wiki `75/75`，完整 focused `402 passed / 1 ignored`，TypeScript 与差异检查通过。

## [2026-08-18] 实施与沉淀 | RunningHub Grok Video 低价渠道合同变更

- 新建 [[开发/RunningHub Grok Video低价渠道合同变更TDD-2026-08-17]]，同步文生与图生两个低价渠道模型：时长 `6-15秒`，UI `0.25元/秒`。
- 图生视频改为 `1-7` 张参考图、单图 `10 MB`；前端 RunPlan 与 RH 标准 payload 均会拒绝越界数量和 `duration=16`。
- 根因是旧注册仍为 `6-30秒/最多3图/0.08元每秒`，且 RH capability 的数值 `min/max` 过去没有在共享 payload 构造器执行；现已补通用数值范围校验，不改变 endpoint、上传和轮询。
- 验证：前端 focused `1081/1081`、RH 聚焦 `40/40`、TypeScript、JSON 解析和差异检查通过；未部署，未执行真实 RH/NewAPI 账单或生成验收。

## [2026-08-17] 方案确认 | Gemini Omni RH 三模型接入 TDD

- 建立 [[开发/Gemini Omni RH三模型接入TDD-2026-08-17]]，复用现有 RH 标准 API、上传和轮询链路，不新建适配器或计费服务。
- 文生和图生视频固定 `1080p/10秒`，UI 显示 `2.5元/次`；视频编辑固定 `1080p`，UI 显示 `0.4元/秒`。
- 视频编辑必须按输入视频真实媒体时长向上取整计费；无法读取时长时阻止付费提交，不使用 NewAPI 默认秒数。
- 已完成最小实现与自动化验收：前端完整 focused 1080 passed、RH 适配器映射/payload/站点路由 39 passed、`vue-tsc -b` 与 `git diff --check` 通过；未部署、未进行 RH/NewAPI 真实账单验收。

## [2026-08-17] 用户验收 | 创作画布 Base64 泄漏与大文件恢复

- 用户已实际打开修复后的创作画布，确认现在可以正常打开。
- 与自动测试和 Desktop `Cmd+S` 回归一致：文件保持轻量引用结构，不再因标注图片组内的运行时 Base64 URL 重新膨胀。
- 本次用户验收仅覆盖该画布的打开回归，不代表几百张图片同时渲染性能已完成跨端验收。详见 [[开发/创作画布Base64泄漏与大文件恢复TDD-2026-08-17]]。

## [2026-08-17] 修复与沉淀 | 创作任务统一取消与重新生成

- 统一 `mediaTaskStore` 的取消边界：运行时明确区分执行器尚未启动、提交进行中、已取得上游任务 ID，以及结果已被 APP 接收并正在保存到项目的阶段；不把恢复的 `pending` 或缺少任务 ID 的请求误称为“未提交”。
- `cancelTask()` 现在等待取消状态写入历史后返回。取消会中断可中断的提交/轮询；未提交任务不调用执行器，已提交任务停止本地等待或跟踪，但不承诺上游取消、退款或扣费结果。
- 结果保存阶段隐藏两个 UI 入口的取消按钮，同时维持既有“保存完成才是 `success`”状态合同；不新增文件回滚、删除远程结果或 Rust 请求注册表。
- 创作历史中的“重新生成”覆盖成功、失败和已取消任务；仅在存在 `planSnapshot` 时回填模型、参数和提示词，参考素材仍需重新选择，绝不自动提交。对话气泡将文本成功、取消阶段和未知终态分开显示。
- 验证：新增/更新取消和 UI 合同后，定向 `94/94`、完整 focused、Rust `396 passed / 1 ignored`、`pnpm exec vue-tsc -b` 与 `git diff --check` 通过。Web、Desktop、KIK 真实取消与账单矩阵尚未执行。

## [2026-08-15] Desktop 验收与排障沉淀 | Grok 本机 ComfyUI 视频工作流

- 用户已在创作面板选择 `Grok 视频 30 秒 · 本机 ComfyUI`，框选 4 张画布参考图并于 15:49 获得成功视频任务；本次只确认这一份已登记 API 工作流，不外推为 MiniMax H3 或任意 ComfyUI 工作流可用。
- 固化映射：提示词节点 `16`，参考图槽位 `22/10/13/9/11/12/23`，生成节点 `7`，结果节点 `18`。Key 使用 Desktop 本机安全存储，Wiki 不记录 Key、提示词、参考图、视频地址或项目内容。
- 固化排障结论：ComfyUI CORS `OPTIONS 403` 改走 Rust HTTP 桥；多图上传使用唯一文件名；Tauri 参数使用 `mime_type/data_base64`；当前 `SaveVideo` 的 `crf` 不兼容，改为直接读取生成结果；Runtime 修改后完整重启开发 App，避免旧媒体执行器继续运行。
- “在创作面板中调整”首次打开为空的根因是空宿主先于异步 `CreationPanel` 模块就绪；统一打开入口现先等待模块再挂载和投递计划。工作台专项 `54/54` 与 TypeScript 通过，Desktop 点击复验待执行。
- 详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#Grok 视频工作流首轮真机验收（2026-08-15）]] 和 [[开发/本机ComfyUI工作流接入规范SDD]]。

## [2026-08-15] 收口 | 模型上下文、输出预算与重试策略

- 删除旧的模型族猜测、云端 `128K` 默认、每条历史消息固定 `16,000` 字符截断和固定 `4,096` 输出；云端统一兜底 `1M` 输入与 `128K` 输出，本地 Ollama/MLX 保持 `32K/4K`。
- Gateway 的 `contextWindow`/`maxOutputTokens` 优先；请求使用 `tokenx` 估算真实消息和工具 token，按剩余上下文动态设置 `max_tokens`。历史只保留最新完整轮次，较早轮次完整留在 Raw；达到输出上限最多自动续写 3 次并保留已有正文。
- 上下文淘汰只在当前会话提醒“Raw 仍完整，可查询或填充 Wiki”，不自动摘要、不自动填充 Wiki、不新增记忆数据库。旧回调、资源加载、会话快速切换、模型目录刷新和工具停止链路补上 generation/AbortSignal 保护。
- 对 Codex 与 DeepSeek Harness 的复核结论：本产品继续使用请求最多两次重试、一次断流续传和三次长度续写；不照搬五次请求、五次流重连、客户端 429 重试或固定 300 秒总超时，避免重复请求、工具副作用和合法长文被总时限截断。
- 验证：聚焦 `1047/1047`、`vue-tsc`、`git diff --check` 通过；未执行真实 NewAPI/Cloudflare 故障注入和跨端人工长文验收。

## [2026-08-14] 真实验收 | 韭菜盒子首个 ComfyUI 自定义图片节点

- 用户已在本机 ComfyUI 实际成功生成；节点合并为一个“韭菜盒子 图片生成”，按选择的 5 个 GPT Image 2 档或 2 个 Gemini 图片模型联动真实分辨率与比例，不复制第三方无效字段。
- 节点独立位于 `comfyui-jiucaihezi/` 与 ComfyUI custom_nodes 安装目录。Key 仅节点显式输入；图片只交给 ComfyUI，`Save Image` 保存到本机 output，不写入韭菜盒子主 App。
- 已记录后续接入准则：注册表/Wiki 是合同源；模型选择器统一入口；前端缩小不支持选项且 Python 再校验；`/object_info`、自动测试和用户真实生成缺一不可。详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#韭菜盒子 ComfyUI 自定义节点首轮验收（2026-08-14）]]。

## [2026-08-13] 发布准备 | v2.1.21

- 版本统一为 `2.1.21`：`package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 一致。
- 上次 Web 发布的 `ELIFECYCLE` 只是 pnpm 对失败子任务的转报；首个真实失败是 `memory-product-separation` 门禁发现两份既有本机 ComfyUI 测试遗漏 focused 清单。已登记 `localComfyRuntime.test.ts` 与 `comfyUiRuntime.test.ts`，完整 `pnpm run build`、Web 产物审计和 `git diff --check` 通过。
- 本记录时 `main` 尚未推送，Cloudflare Pages 尚未部署，`v2.1.21` tag 及 macOS ARM、macOS Intel、Windows CI 尚未触发；发布结果待真实执行后补充。

## [2026-08-13] 修复 | 创作画布本地媒体预览与 3D 编辑器收尾

- 新增 [[排障/创作画布本地图片视频预览空白-2026-08-13]]：`asset://` 地址导致图片、视频空框；共享路径恢复为 `dev_read_file -> data:`，用户确认图片预览恢复。
- 新增 [[排障/3D编辑器导出与选中控件-2026-08-13]]：FFmpeg 诊断与保存状态可见；基础编辑操作已补齐；空白点击、Esc 和捕获入口都会取消选择，避免移动箭头遮挡。
- 验证：`vue-tsc -b`、focused 测试构建和 `git diff --check` 通过；此前完整 focused 的唯一失败是既有测试登记清单遗漏两个文件。

## [2026-08-13] 排障 | 云端 GPT 图片渠道、RH 回收与画布落盘边界

- 新增 [[排障/云端GPT图片与RunningHub任务回收-2026-08-13]]：服务器直测和 NewAPI 日志确认 GPT Image 2 的 `502` 来自图片渠道 `104` 上游暂时不可用，不是本机 ComfyUI 接入造成；已从 App 模型目录下线 `GPT Image 2 VIP`，旧 ID 也禁止再次执行。
- Git `4e33901f` 修复 RunningHub 返回 `global:` 任务 ID 时被 URL 编码为 `%3A` 后遭安全校验拦截的问题。白名单只解码并校验 RH 任务路径，未放开任意 URL、路径或查询。GPT2.0 文生图/图生图的真实付费回收仍待更新后人工复验。
- 同时固化“成功但无放到画布”的排查边界：画布只使用项目内稳定媒体路径；远程结果下载超时或落盘失败时应显示保存入口，不应归因为画布插入故障。

## [2026-08-12] 计费确认 | KIK 视频任务按输入价格计费

- NewAPI `logs` 回执确认成功 KIK 视频任务为 `is_task=true`、`prompt_tokens=0`、`completion_tokens=0`，但按 `/v1/videos` 任务计费分支扣除 quota。
- 当前适配器没有可拆分的输入/输出 Token 明细，因此输入价格是视频任务计费基准；补全价格在本链路不参与。官方基础价由管理员配置，用户组和会员倍率由 NewAPI 叠加形成收益。
- `/v1/chat/completions`、错误 `/v1/video/generations` 的 404 记录 quota 为 0，不扣费。

## [2026-08-11] 修复 | Thinking 模型工具续请求

- 新增 [[排障/thinking模型工具调用reasoning_content中断-2026-08-11]]：thinking 流式响应的 `reasoning_content` 曾被共享 direct runtime 当作隐藏文本丢弃，工具结果回填后的下一次请求因此被上游以 400 拒绝。
- Git `d98b72bf` 仅在本轮 runtime 内回放该字段；不改变 `.raw` Markdown、历史对话或 UI。direct runtime `39/39`、TypeScript 与差异检查通过；真实 NewAPI 多轮工具回归待验收。

## [2026-08-11] 修复 | Playwright MCP PATH 二次遗漏

- 用户在已安装的 `v2.1.17` 中仍复现 `env: node: No such file or directory`；此前绝对 Node + `npx-cli.js` 只修复第一层启动，npx 后续通过 `env node` 启动 Playwright 时仍受桌面 App PATH 缺失影响。
- 共享 `mcp_spawn_stdio` 现在将解析后的可执行文件目录置于 Unix 子进程 PATH 最前，覆盖 Playwright 与同类本地 stdio MCP，不为单一服务加补丁。
- MCP 专项 `5/5`、TypeScript、Rust 编译和 `git diff --check` 通过；空 PATH 失败、补 `/opt/homebrew/bin` 后官方 Playwright MCP `--help` 成功。正式 `v2.1.18` 安装包点击验收待执行。

## [2026-08-09] 修复 | Playwright 打包版 Node PATH 根因

- `v2.1.16` 打包版的 Playwright 以 `npx` 启动，stderr 返回 `env: node: No such file or directory`；终端开发版能用、桌面包失败的差异来自 LaunchServices 不继承终端 PATH。
- `mcpClient.ts` 现在把 Unix `npx` 归一为绝对 Node + npm `npx-cli.js`，保留 Node 候选回退；MCP 测试 `11/11`、TypeScript 和绝对 Node 直接执行验证通过。
- 版本必须先统一为 `2.1.17` 再提交并打 tag；安装新包后才能记录 Playwright 正式发布验收。

## [2026-08-08] 真实验收 | short-video-factory 本地 stdio MCP

- [[开发/自定义MCP添加SDD]] 记录 Git `10553f10`：Node + tsx 启动归一、stdio 诊断、30 秒连接/列表超时、120 秒工具调用超时，以及失败连接和旧工具缓存清理。
- 用户在 Desktop 开发版确认服务端真实返回 8 个工具，并成功调用 `open_project` 打开 `0807功夫女友`，获得项目 ID 与 `episode-001`。`refresh_production_materials`、断 pipe 重连和外部安装包矩阵未执行。

## [2026-08-03] iOS 发布 | 2.1.7 已提交 App Store 审核

- App Store Connect 已提交 iOS App `2.1.7`（构建 `2.1.7.1`），页面确认“已提交 1 个项目”，当前状态为“正在等待审核”。
- iPhone 与 13 英寸 iPad 截图已通过；iPad PNG 的 alpha 通道错误通过转换为同尺寸无 alpha JPEG 解决。
- 审核通过后自动发布；当前不是 App Store 公开版，不登记为普通用户已可下载。

## [2026-08-03] 模型验证 | RunningHub Grok Video 多图与切镜

- 更新 [[运维/模型矩阵]]：`rh-grok-image-video` 已由短视频工厂完成真实多图参考任务，九宫格分镜板、人类与动物角色一致性及片内切镜验证通过；官方 `6-30` 秒合同保留，但不声称所有时长已逐档实测。
- ZX 渠道 `grok-1.5-video-6s/10s/15s` 的失败记录保持不变，不与 RunningHub 渠道验证结果混用。

## [2026-08-03] 开发收尾 | 记忆长对话屏外绘制降载

- [[开发/通用记忆工作台稳定性修复与Markdown体验升级SDD]] 固定并实施最小方案：保留完整自然文档流，只给每条 `.memory-message` 复用主聊天已有的 `content-visibility: auto`。
- 不改变显示、Raw、模型上下文、Markdown、Mermaid、媒体卡、滚动或同步；不恢复虚拟列表，不增加固定行数、固定屏数、观察器、估算高度或新依赖。
- 记忆工作台定向 `45/45`、TypeScript、Wiki validate 与 `git diff --check` 通过；Desktop/Web/iPhone 长对话降温体感待人工验收。

## [2026-08-03] 设计核实 | 快速/记忆对话上下文与工具权限

- 代码与 Git `b3faa1ab` 核实：对话 Markdown 是唯一持久化真源；App 只解析当前选中的 Raw，发送时按模型容量从最新完整问答轮次向前装入，能装下即装入当前对话全部历史。
- 快速模式唯一工具为只读 `wiki_search`；记忆模式在同一上下文上提供完整候选工具。模式选择器是工具权限唯一来源，用户消息不能增删工具池，模型只决定是否实际调用。
- 新对话不自动装入其他 Raw；快速模式不能读取其他 Raw，记忆模式初始上下文也只含当前 Raw，但可通过项目级 `read/grep` 主动读取。当前实现符合用户目标，不改代码。

## [2026-08-03] 真实验收 | 本地三维科普动画与分段镜头

- 用户在真实 Desktop 记忆模式完成一句话选矿 MP4；Markdown、`.jcscene`、系统 FFmpeg 和最终 MP4 链路通过。
- 首次成片暴露固定全景后，复用现有 `timeline.camera` 补强模型合同；第二次真实成片已确认分段镜头语言生效。
- 镜头增强没有新增字段、依赖或播放器分支；相关定向 25/25 与 TypeScript 检查通过。详见 [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]]。

## [2026-08-02] 设计确认 | 本地三维科普动画与 MP4 导出

- [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]] 固定下一步最小方案：复用现有 Markdown、`.jcscene`、Three.js、项目文件服务、Desktop 审批与用户电脑中的 FFmpeg。
- 动画时间线定义为 `.jcscene` 中“时间、对象、动作、目标状态”的数据，不是新引擎或独立编辑器；新增一个 `export_3d_scene_video` 工具负责原生画布录制和系统 FFmpeg MP4 导出。
- 当前仅完成设计，没有代码、测试或真实 MP4 闭环；不内置 FFmpeg，不增加游戏引擎、视频编辑器、远程服务、配音或复杂人物动画。

## [2026-08-02] 开发收尾 | 本地三维科普动画与 MP4 导出第一版

- [[开发/通用记忆工作台本地三维科普动画与MP4导出SDD]] 已实施 `.jcscene` 时间线、Three.js 播放和原生画布录制；Desktop 记忆模式新增 `export_3d_scene_video`，经现有审批调用系统 FFmpeg 输出 H.264 MP4。
- 没有增加依赖或内置 FFmpeg；Web 不暴露导出工具，临时录制文件不进入项目。
- 自动验证：相关定向 73/73、完整 focused 1434/1442（8 跳过）、Rust 403/404（1 忽略）、TypeScript、Desktop quick build和产物审计通过；真实 Desktop 模型一句话选矿成片待人工验收。

## [2026-08-02] 开发收尾 | Markdown 衍生、项目地图与主要人物白膜

- 记忆工作台复用现有 Mermaid 渲染并加入 H1-H3 可折叠大纲；新增 `export_markdown_slides`，在 Web/Desktop 生成 HTML、无打印弹窗的分页 PDF 和包含可编辑标题、正文、项目符号及表格的真实 PPTX。
- 标准 `.canvas` 作为独立项目地图进入资源路由，支持文本、文件、链接、分组、连线、关系标签、平移缩放、适配和只保存坐标的拖动；不合并 `.jccanvas`、`.jcscene`，不加载万能画布。
- 独立 3D 人物补齐胶囊双臂双腿并保留头部、躯干和朝向；群众阵列继续使用实例化躯干与头部。
- 验证：完整 focused 1431 通过、8 个既有条件跳过；最终定向 78/78 及幻灯片 25/25、TypeScript、Web/Desktop quick build、两端产物审计和浏览器桌面/移动视口通过。浏览器实际生成 PDF/PPTX 文件头有效；PowerPoint/WPS 和三平台安装包人工矩阵待补。

## [2026-08-02] 开发收尾 | 通用记忆工作台项目骨架代码对齐

- 新增共享项目路径合同，初始化补齐 `.raw`、`.raw/jc-media/{图片,视频,音频,文档}`、`.raw/对话记录`、`.raw/.sync`、`jc-canvas` 与 `wiki`；旧素材继续按类型 keep-both 迁移。
- 文件树隐藏对话、同步、画布记录和 `.DS_Store`，保护固定目录；Web/Desktop 上传与 AI 生成统一按文件类型归档，模型项目工具复用同一保护规则。
- 验证：合同专项 98/98、完整 focused Node 1431 通过（8 个既有条件跳过）、Rust 403 通过（1 个既有忽略）；TypeScript、Desktop quick 构建、产物审计与 `git diff --check` 通过。真实设备升级和打开既有项目仍待人工验收。

## [2026-08-02] 准则确认 | 通用记忆工作台项目骨架

- [[开发/通用记忆工作台原始素材与文档按需阅读SDD]] 成为项目骨架唯一事实源：上传与 AI 生成统一按图片、视频、音频、文档四类归档，不按来源增加目录。
- 固定并保护 `.raw`、`.raw/jc-media`、四个中文分类、`.raw/对话记录`、`.raw/.sync`、`jc-canvas` 与 `wiki`；普通媒体文件仍可管理。
- 文件树隐藏对话记录、同步状态、`jc-canvas` 与 `.DS_Store`；对话和画布分别只由各自选择器管理。旧 Studio/Web/媒体工作台文档不得覆盖本合同。
- 依据：用户 2026-08-02 明确确认；本条记录当时只固化 Wiki 准则，随后代码实现与验证见同日“开发收尾”记录。

## [2026-08-02] 修正 | 统一当前产品优先级

- 用户确认当前唯一主线为“通用记忆工作台”；主 Studio/旧主 Web、媒体、制作、电商和漫剧工作台降为兼容、历史参考或后续独立产品。
- 已更新 [[CLAUDE]]、[[架构/产品架构]]、[[hot]] 三个现行入口；其他工作台 SDD 与历史记录保留，不再从其内容推导当前开发重点。
- 依据：用户 2026-08-02 明确指令；现行 [[开发/通用记忆对话独立App SDD]] 已将记忆工作台定义为默认 `src/App.vue` 入口及独立产品壳。

## [2026-07-24] 收尾 | 电商工作台绝对独立

- [[开发/电商工作台绝对独立SDD]] 更新为实施事实：Rail 直接挂载电商，Chat 不挂载；模型目录不等待 OpenCode；当前字段、原始附件和显式 Skill 进入一次无工具直连请求。
- 运行记录收敛为 `jc-media/ecommerce/<run-id>/record.json` 的定位文件，页面不再建设反推/商品图历史；公共媒体链保持 `MediaPlanCard -> CreationPanel -> mediaTaskStore`，不增加 Wiki 双写、迁移或媒体回写层。
- 新增 [[开发/电商工作台绝对独立成功总结]]，作为以后新增独立工作台的入口、请求、共享能力、记录与验收模板。真实 Provider 和付费媒体人工闭环仍待验收。

## [2026-07-23] Web 解禁 | 电商工作台入口

- 移除 Rail 和布局对 Web 电商工作台的硬编码阻断；宽屏 Web 可从 Rail 打开，窄屏 Web 可从移动 Rail 打开。
- 移动端工作台确认媒体计划后会切到现有移动创作面板；不新建 Web 专属生成器或任务链。
- Web 解禁定向测试、TypeScript 和 `pnpm run build` 已通过；真实 Web 模型与媒体付费链路待人工测试。

## [2026-07-23] 交互收敛 | 商品图比例由媒体计划确认

- 移除商品图页的“交付目标”和“发布位置”：它们不能可靠推导平台版位或图片比例，也不再进入独立提示词模型请求。
- 商品图页只保留商品图、参考图和用户诉求；提示词生成后，用户在公共 `MediaPlanCard` 中按当前媒体模型的真实支持能力选择或调整比例、模型及其他参数。

## [2026-07-23] 架构更正 | 电商工作台独立提示词请求

- 更新 [[开发/电商工作台SDD]]：商品图和反推由图片、用户信息与指定 Skill 发起独立单次模型调用；不建立或借用 Chat、创模式或 OpenCode 会话，也不进入工具循环。
- 固定后续链路：模型只返回一条最终中文提示词；用户确认后，商品图与参考图一并进入 `MediaPlanCard -> CreationPanel -> mediaTaskStore`。`jc-gpt-image` 为纯提示词 Skill，不读密钥、不执行 API 或媒体任务。
- 实现已完成并通过定向 20 项、TypeScript 与 `pnpm run build:desktop`；真实模型请求和媒体付费链路仍待人工测试。

## [2026-07-22] 开发收尾 | OpenCode 道模式基础接入

- 新增 [[开发/道模式OpenCode第三主Agent SDD]] 对应实现：只注册 `config.agent.dao` primary Agent 和 Desktop 模式入口，复用文武已有会话、附件、权限、Skill、MCP 与工具链；旧创和 Web 不变。
- 道模式、文武附件边界和 Skill 路由联合定向测试 `181/181` 通过；正式 Web/Desktop 构建、Desktop 真实模型请求与 Windows/Intel Mac 人工验收待补。

## [2026-07-22] 状态修正 | 编辑区与 Explorer 稳定性已完成

- [[开发/文件系统/编辑区与Explorer稳定性修复SDD]] 已由 Git `2c9e9109` 实现并通过自动测试、构建及 Web 真实验收，合并记录为 `589deee8`，文档提交为 `421e4eac`。
- 修正此前索引中的“待实施”状态；Desktop 人工验收仍待补。

## [2026-07-22] 待实施 SDD | 文武道 OpenCode v1.18.4 官方对齐升级

- 新增 [[开发/文武道模式OpenCode-v1.18.4官方对齐升级SDD]]：实施顺序固定为 sidecar 生命周期、发送热路径、目录会话工作区、SDK/runtime v1.18.4、Provider variant、输入真实缺口和全量验收。
- 只读审计发现当前发送仍会经过配置投影、`ensureConnected`、目录 bootstrap 和 session permission 更新；Rust 每次 `ensure` 都会加载登录 Shell，并错误地因项目目录变化重启 sidecar。
- 当前开发机有 59 个 `opencode serve`，其中 58 个 PPID 为 1；SQLite 约 384 MiB、277 个 session。只记录为实施前风险，本轮没有清理进程、修改产品代码、运行测试或声称修复完成。

## [2026-07-22] 修正 | 撤销文武模式 Gemini 原生协议实验

- 真实 22 MB MOV 经 OpenCode Google Provider 转为约 30.8 MB Base64 后，首轮请求超过 8 分钟无响应；NewAPI 官方最新版没有 Gemini Files API 上传链路。
- 已撤销 Gemini 模型级 `@ai-sdk/google + /v1beta` 覆盖，恢复文武模式统一 `@ai-sdk/openai-compatible`；自然语言中的视频路径保持普通文字，由 OpenCode和用户自选外部工具处理。
- 不修改 OpenCode或NewAPI，不内置、不检测、不推荐任何第三方视频工具；文字、图片、Skill、工具和创作能力不变。
- Provider、OpenCode file part 与项目媒体路径定向回归 `37/37`、TypeScript 和补丁检查通过；测试证据 `/private/tmp/test result jc-opencode-video-rollback.log`，`sha256:699a755feb75`。正式构建与 Desktop 重启后真实复测尚未执行。

## [2026-07-22] 开发收尾 | 文武模式 NewAPI Gemini 原生协议

- Gemini 原生协议实验曾确认：真实 MOV 已进入 OpenCode，通用 `@ai-sdk/openai-compatible` 会在本地拒绝 `video/mov`；该实验随后因大文件 Base64 请求长期悬挂而撤销，现行结论见上方修正记录。
- 按 OpenCode v1.17.18 和 NewAPI rc.20 官方现有能力，只为韭菜盒子 NewAPI 的 `gemini-*` 模型增加 `@ai-sdk/google + /v1beta` 模型级覆盖；不改 OpenCode、NewAPI、创模式、模型选择、Skill 或工具循环。
- TDD 与回归证据：Provider RED 实际失败后转 GREEN；Provider、file part、项目媒体路径联合测试 37/37，TypeScript 与 `git diff --check` 通过。测试证据 `/private/tmp/test result jc-opencode-gemini-native.log`，`sha256:c770888df516`；正式构建和 Desktop 真实 MOV 内容读取尚未验收。

## [2026-07-22] 待实施 SDD | 编辑区与 Explorer 稳定性

- 新增 [[开发/文件系统/编辑区与Explorer稳定性修复SDD]]：项目文档打开后空白/覆盖、按需树刷新后视觉折叠、底部右键菜单不可见三项根因及最小修复设计。
- 风险分级：旧 `localStorage` 恢复会覆盖当前项目会话，现有自动保存可能写回项目文件，列为阻断风险；Explorer 与菜单问题尚未实施或验证。
- 更新 [[开发/文件系统/索引]]、[[hot]] 与 [[来源索引]]；没有修改产品代码或声称测试通过。

## [2026-07-21] 排障交接 | ZX Grok 参考图视频真实失败

- 新增 [[排障/ZX-Grok参考图视频真实失败交接-2026-07-21]]：三次真实失败后，选 1 参考图的 ZX Grok 6 秒仍返回 `Alias.image` 对象类型 400。
- 已记录 `79ddbddc`、`86690b7e`、`4b17c0cf` 及完整自动验证；但真实付费提交未通，不作修复完成结论。
- 接手者必须从 Vite `/__jc_api` proxy 或 Desktop WebView 抓取真实 `POST /v1/videos` 请求体类型，再判断客户端与服务器之间的对象在哪一层引入。

## [2026-07-21] 交互修正 | 默认对话、媒体参数编辑与 ZX 参考图视频

- 完成 [[开发/启动默认对话与媒体确认卡参数编辑及ZX参考图视频修复SDD]]：Desktop 启动默认进入对话；媒体确认卡改用橄榄绿主题，并可在卡片内调整模型、比例、分辨率和时长。
- ZX Grok 6/10/15 秒参考图直接按产品 `/v1/videos` 合同提交 data URL，不再调用已删除的 `/api/creations/uploads`；其他渠道素材流不变。
- 自动验证完成；真实 ZX Grok 6 秒付费闭环、截图级视觉检查和三平台正式安装包人工矩阵仍待验收。

## [2026-07-20] 能力升级 | 韭菜盒子原生媒体编排

- 完成 [[开发/韭菜盒子原生媒体编排能力SDD]] 的代码实施：本轮附件、项目文件树、画布选择和同项目同会话最近成功媒体任务统一为应用拥有的素材引用；模型只选择短期 ID，确认后仍复用 CreationPanel 与 mediaTaskStore。
- 审计并修复重复付费提交窗口、实时下线模型仍可选、Windows 项目绝对路径、任务落盘副本、历史计划参考图清空和跨项目确认状态；删除重复预览字段并合并素材映射，没有新增第二套媒体执行架构。
- 验证：TypeScript、focused Node 1117/1117、Rust 394/394、Web/Desktop Vite 构建及两端产物审计通过；真实付费、刷新/重启恢复和三平台正式安装包人工矩阵未执行。证据清单 `sha256:3a1e6607ddd5`。

## [2026-07-20] 排障收尾 | Web 创作面板控制台红字

- 新增 [[排障/Web创作面板控制台红字排障-2026-07-20]]：归档 CSP inline script、创作模型接口误走 Pages、画布项目图片路径被当作网站 URL 三项独立根因及最小修复。
- 更新 [[运维/服务器运维#RunningHub Web CORS（2026-07-20）]]：生产 Nginx 的 `/api/runninghub/` 已允许正式站点和 Pages 预览站，公网 `OPTIONS` 204 与本机 access log 均验证通过。
- 验证：本次定向测试 103/103、TypeScript、Web quick build 和产物审计通过；前端待重新发布后人工验收。当前完整 focused 被并行 Skill prompt 合同变更阻断，不记为本次回归。

## [2026-07-20] 能力升级 | Wiki 四 Skill 产品化

- 完成 [[开发/Wiki四Skill产品化升级SDD]]：查询默认现行优先并限制单页证据；Raw 新增只读收尾预览、证据状态与来源指纹；巡检分离现行风险和归档卫生；修正新增问题/依据/diff 预览和修后回执。
- Markdown 链接扫描复用 `marked` token，并由 `esbuild` 生成自包含 helper；构建 Skill 索引时自动重建，不依赖用户项目安装 npm 包。
- 验证：Wiki Skill 20/20、Raw Wiki 17/17、完整 `pnpm run test:focused`、TypeScript、Vite 正式构建和 Web 产物审计通过；正式 Desktop 三平台工具环境与普通用户四 Skill 闭环未人工验收。

## [2026-07-20] 修正 | 工作区边界与发布知识专项巡检

- 修正 [[开发/电商工作台SDD]]：移除 7 处已失效的 `.raw/sessions` 现行依赖，改为创模式 UI 会话与项目媒体结果链路；Raw 历史方案和删除依据分别保留在关联 SDD。
- 更新 [[CLAUDE]]：新增 [[学习/GitHub推送与发布边界-2026-07-20]] 长期入口。
- 修正 `jc-jian-wiki` 扫描器对 fenced/inline code 和特殊 Markdown 文件名的误报；复巡后其余断链仅落在归档历史示例，未批量修改。

## [2026-07-20] 发布门禁 | v1.3.0 全仓 53 条失败清零

- 完成 [[开发/v1.3.0全仓53条失败清零SDD]]：53 条失败全部处理。根因主要是全仓格式化后测试仍逐字匹配旧单行源码，少量断言仍引用旧品牌、旧 Web 面板范围和已移除模型。
- 保留并验证当前业务事实：创模式独立于 OpenCode、画布 owner/gate、统一项目文件服务、Web 媒体 Blob 字节所有权、文件树项目切换清理及媒体输入能力校验均未削弱。
- 修复额外发布阻断：为 `CreationPanel.vue` 多行模板事件的连续语句补分号，Vite 可正确解析，交互语义不变。
- 验证：focused Node 1096/1096、Rust、TypeScript、Web 正式构建与产物审计、Desktop 正式构建与产物审计全部通过；Production 部署、桌面签名和跨平台人工矩阵未执行。

## [2026-07-20] 功能恢复 | Web 自建 Skill

- 归档 [[开发/Web端自建Skill恢复SDD]]：恢复 Web Skill 仓库的“自建”、编辑与删除；原 `jc_web_skills_v1` 本地数据重新与内置 Skill 同时加载，新增变更继续写回同一浏览器本地存储。
- 边界：不上传、不迁移、不承诺跨浏览器或跨设备恢复；Desktop 中央 Skill 仓库不改。
- 验证：专属 7/7、TypeScript 与差异检查通过；完整聚焦测试仍有 53 条既有失败，Web 构建被 `CreationPanel.vue:3210` 既有模板语法错误阻断。

## [2026-07-20] 架构收敛 | 创模式 Raw 账本与对话 Wiki 移除

- 归档 [[开发/创模式Raw账本与对话Wiki移除SDD]]：删除 `jc-chat-wiki` 及创模式把对话、工具过程和媒体结果自动复制到项目 `.raw/sessions` 的全部链路。项目 `.raw` 只接纳用户主动放入的原始资料，不再由 Studio 自动生成对话副本。
- 保留 UI 会话存储、当前会话按模型容量装配，以及项目 `CLAUDE.md`、`wiki/hot.md` 的只读上下文；不删除用户已有 `.raw` 历史文件。
- 验证：TypeScript、raw 防回归 Node 测试、Skill 身份测试、`jc-raw-wiki` 契约测试和差异检查通过。Web/Desktop 完整构建均被 19 条既有源码合同测试阻断，详见 SDD；未为凑绿修改无关 UI。

## [2026-07-20] 整理记忆体 | GitHub 推送与发布边界盘点

- 新增 [[学习/GitHub推送与发布边界-2026-07-20]]：明确 Git push 只上传已提交文件，Web 只部署通过构建审计的 `dist/`，桌面包由版本 tag 的 CI 构建。
- 盘点发现：`.raw/sessions/` 的 2 个会话文件、`.git.backup/` 的 7,356 个文件及 `.superpowers/` 的 20 个本机状态文件仍被 Git 追踪；它们不应继续推送。
- 验证：当前旧 `dist/` 含 `.DS_Store`，`pnpm run audit:web-dist` 失败；未修改产品代码或删除任何用户文件。

## [2026-07-20] 发布收尾 | v1.3.0 发布失败修复

- 归档 [[开发/v1.3.0发布失败修复SDD]]：发布失败由一处原生确认框与多处过期测试合同组成；画布生产链路未回退，测试双桩已对齐 `ProjectFileService` 的 revision 写入和 V3 画布资源结构。
- 记录发布规则：`wrangler pages deploy` 未带 `--branch=main` 只生成 Preview，不能作为正式上线证据。
- 验证：局部 80/80、完整 `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`pnpm run build`、`pnpm run build:desktop` 全部通过；尚未执行 Production 部署或推送 v1.3.0 tag。

## [2026-07-20] 整理记忆体 | 0719-MCP 用户连接与对话排版收尾

- 归档 [[开发/自定义MCP添加SDD]]：设置的 MCP 扩展现可添加 Streamable HTTP、SSE 和 Desktop stdio 服务；添加后复用现有 store、client 和共享文/武/创工具池立即连接。Web 不显示 stdio，OAuth 与密钥输入不进入自定义表单。
- 归档 [[开发/对话Markdown正文紧凑化SDD]]：根因是助手 Markdown HTML 容器使用 pre-wrap，把标签间源码换行显示为额外空白；改为正常 HTML 空白折叠并收紧长文正文、列表间距。
- 验证：两项功能均新增合同测试并通过完整 pnpm run test:focused；用户已人工确认 MCP 表单功能与 UI。真实自定义远程 MCP 调用、Web/Windows/Intel 人工矩阵仍未执行。

## [2026-07-19] 整理记忆体 | GitHub OAuth MCP 连接实现审计

- 补充 [[开发/创模式MCP工具接入SDD]]：GitHub 卡片提供“连接”，授权页、深链回调、PKCE/state、Keychain 凭据与 `listTools()` 成功门控已落地；同一工具池继续供文、武、创共用。
- 归档安全边界：GitHub OAuth App Client Secret 只在 Cloudflare 网关中换 token，桌面包仅使用 Client ID；未配置 OAuth App 和未发布网关时，不能宣称用户已能连接。
- 验证：OAuth 与网关合同测试通过、Rust 394/394 通过；完整 focused suite 和 `vue-tsc -b` 仍被 MCP 以外的既有失败阻断。

## [2026-07-19] 整理记忆体 | 文件系统六期合并收尾压缩

- 建立 [[开发/文件系统/索引]]：六期 SDD、前置编辑能力与 Web 项目/媒体同步文档统一归入“文件系统”，明确 `ProjectResource -> ProjectFileService -> ProjectResourceChange -> 消费者` 的唯一事实源。
- 刷新 [[hot]]：将单一五期 SDD 替换为文件系统最终入口；自动验证、人工验收缺口和两个已知遗留问题同时保留，避免把未执行的跨端矩阵写成通过。
- 记录主线事实：文件树一期至五期、四点五期已合入 `main`，原 `0718-wenjianshu&bianjiqu` 已删除；重复 MCP 草案仍待用户决定，不自动删除。

## [2026-07-19] 修正 | 文件树六期专项巡检：补文件系统索引、全阶段入口、路线状态和主线合并历史；跨端人工验收缺口与遗留问题保留为待补

## [2026-07-19] 查询 | 文件树六期收尾状态（详见 [[巡检报告/2026-07-19-文件树六期收尾状态查询]]）

## [2026-07-19] 整理记忆体 | 创模式 MCP 工具接入与审计

- 归档 [[开发/创模式MCP工具接入SDD]]：创模式请求动态追加共享 `mcpStore` 中已连接 MCP server 工具；Desktop/Web 执行器均复用 `mcpBridge`，核心工具不变。
- 归档根因：核心工具参数白名单会在执行器分支前拒绝 `mcp__` 调用，现仅允许该前缀通过对象参数解析，实际可见性、连接校验和错误码仍由桥接层处理。
- 审计与验证：focused tests、Rust `cargo check`、`git diff --check` 通过；真实 GitHub MCP / Web SSE 人工调用尚未执行，`vue-tsc -b` 仍有本任务无关的既有错误。

## [2026-07-19] 整理记忆体 | 文件树第五期编辑区与项目文档统一完成

- 归档 [[开发/文件系统/文件树五期编辑区与项目文档统一SDD]]：编辑区保存只作用于当前项目文件；旧 Word/PDF/HTML/Markdown 转换导出、预览、模板导出、分片导出和关闭自动落库路径已删除。
- 归档统一出口：编辑区导出先保存当前项目资源，再委托可缓存回放的文件树导出命令宿主，因此继承同一份 Desktop/Web 目录选择、重名冲突和取消规则；项目文档插图先写入 `jc-media/images`。
- 归档交互：富文本和原样文本右键都使用中文产品菜单，并按选区显示既有编辑命令；编辑区和创作面板的新建项目文档均由文件树按当前选中上下文创建和打开。
- 验证：focused tests、Vite production build 与 `git diff --check` 通过。

## [2026-07-19] 整理记忆体 | 文件树四点五期文件总管统一完成

- 归档 [[开发/文件系统/文件树四点五期文件总管统一SDD]]：文件树、编辑区、画布和创作媒体通过同一 `ProjectFileService + ProjectResource` 进入统一存储与资源事件；共享动作层承接跨面板的画布、媒体和导出编排，项目文件是唯一事实源。
- 归档 Desktop 拖放：窗口级原生事件在 `WorkspaceLayout` 集中分发；任何外部文件先由 Rust 安全复制进项目，再由画布、对话区、编辑区或项目树消费，前端不再直接读取 Finder 路径。
- 归档根因与边界：`changed` 不是目录结构事件，文件树定向刷新避免画布切换时目录折叠；导入拒绝来源或目标目录符号链接，避免越界写入。画布落点偶发命中对话区与目录刷新极端竞态已记录为后续项。

## [2026-07-18] 整理记忆体 | 0717-RHAPP 分支全链路经验归档

- 更新「开发历史.md」：新增 0717-RHAPP 完整开发历史（AI 应用通道 + ZX 渠道 + 模型清理）
- 重写「AI应用适配-交接-2026-07-17.md」：状态改为 ✅ 全链路跑通，补充排障速查表
- 更新「hot.md」：新增第 9 条热索引指向 AI 应用交接文档
- 生存手册 #30-32 已在上次录入（Docker 缓存 / API 包装 / Nginx 嵌套）

## [2026-07-18] 整理记忆体 | 文件树一期完成

- 归档 [[开发/文件系统/文件树一期资源身份与文件安全SDD]]：统一资源身份、文件服务、打开路由与资源变更事件，编辑区和画布不再各自猜路径。
- 记录 Desktop/Web 文件安全和生命周期：截断或含 NUL 的内容不进入可写编辑器；改名、删除同步 Tab 与画布；音频画布可保存、恢复和播放。
- 记录 Desktop 文件操作：上传/导入/导出对齐 Web 菜单，删除进入系统废纸篓；重复删除和缺失节点按幂等语义处理。
- 记录根因：项目路径不是普通展示文本，不能对合法文件名统一 `trim()`；首尾空格目录必须保真。

## [2026-07-18] Wiki壳填充 | 文件树二期批量文件操作完成

- 归档 [[开发/文件系统/文件树二期批量文件操作SDD]]：多选、内部剪贴板、复制/剪切/粘贴、拖放移动、批量删除和所选资源导出统一通过 `ProjectFileService` 的批量计划与单一资源事件执行。
- 归档跨端结果：Desktop Rust 直接返回完整后代映射；Web 复制二进制时创建新的 documents/OPFS 身份，移动保留原身份；两端支持保留两份与覆盖。
- 归档画布与消费者：画布副本生成新的 `canvasId`，批量移动/删除/覆盖经 lifecycle gate；编辑区按 batch 顺序关闭覆盖目标 Tab、更新移动源 Tab，画布媒体同步改路径或标记缺失。
- 验证：用户已完成 Desktop 六项手工验收；自动验证 `pnpm run test:focused`、Rust 全量测试、Vite build 与 `git diff --check` 通过。

## [2026-07-18] 整理记忆体 | 文件树三期 Explorer 状态与性能完成

- 归档 [[开发/文件系统/文件树三期Explorer状态与性能SDD]]：Explorer 不再用 1000 项递归快照构树，项目根和目录均按需读取；普通目录和代码仓库目录可完整打开。
- 归档 Desktop 监听：使用跨平台 `notify` 监听项目根，前端按事件路径刷新已加载父目录，不恢复 5 秒全量轮询。
- 归档交互：深层资源定位逐层加载祖先；筛选通过 Desktop/Web 路径搜索构造临时祖先树；层级引导线由可见节点深度绘制。
- 验证：文件树 focused 测试、Rust `cargo check` 通过；Git 状态装饰明确留给第五期。

## [2026-07-18] 整理记忆体 | 文件树四期编辑区收尾完成

- 归档 [[开发/文件系统/文件树四期编辑区收尾SDD]]：编辑会话作为唯一 dirty 数据源，项目文件 Tab 和 Explorer 树行显示同一未保存小点；草稿不会伪装成文件树资源。
- 归档保存边界：全部保存复用单 Tab 条件保存，只处理可写回原路径的脏项目文件；冲突、删除、错误和草稿明确保留为未完成项，防止静默覆盖或重建旧路径。
- 验证：编辑会话/文件树 focused 测试与 Vite production build 通过；Git `M/U/9+` 保留第五期。
## [2026-07-21] 整理记忆体 | 三项生产故障本地修复

- 更新 [[开发/三项生产故障闭环SDD-2026-07-21]]：Web 文档转换拒绝 HTML 200 fallback；新画布图片只持久化资源身份；已提交 RH 任务的轮询异常保留为待恢复，客户端不再调用不存在的退款接口。
- 验证：定向 Node 86/86、`pnpm exec vue-tsc -b`、`document-converter` Python 3/3、`git diff --check` 通过。
- 未验证：VPS 转换服务与 Nginx 路由部署、Web 发布、真实 Word 上传、RH 真实付费回收及 Intel/Apple Silicon/Web 人工矩阵。

## [2026-07-21] 生产部署 | Web 文档转换服务

- 已部署 `document-converter`，容器仅监听 `127.0.0.1:8810`；`/health` 返回 JSON 200。
- 已安装 `/documents/markdown` Nginx 精确路由并自动备份原配置；`nginx -t` 通过，正式域名 `OPTIONS` 预检返回 204 和预期 CORS 头。
- 仍待：使用真实有效 Key 上传 `.docx`，确认返回 Markdown 并进入创模式附件；Web 画布与 RH 修复的发布、真实任务回收和跨平台人工矩阵不受本次服务部署替代。

## [2026-07-21] 生产验收 | Web Word 转换闭环

- 首次真实 `.docx` 上传 `422` 的根因是基础 `markitdown` 未安装 `docx` 可选依赖，不是 Nginx、鉴权、Intel Mac 或文件传输失败。
- 独立分支 `fix/document-converter-docx` 的 `b29da91b` 改用 `markitdown[docx]` 并阻止 Python Traceback 回传；本地真实 DOCX 容器验证输出 5206 字节 Markdown 后，VPS 已重建该容器。
- 用户确认正式 Web 上传真实 Word 后内容进入会话。画布与 RH 问题仍保持待发布、待真实验收状态。

## [2026-07-21] 修正 | 创模式核心原则一致性

- 用户确认唯一原则：创模式以模型原生能力为第一优先，产品能力补位，Skill 和工具按需增强；工具不能成为模型原生能力的门槛。
- 修正 [[架构/产品架构]]、[[开发/创作模式双端统一SDD]]、[[开发/创作工作台架构SDD]]、[[开发/韭菜盒子原生媒体编排能力SDD]]、[[开发/创模式MCP工具接入SDD]]、[[hot]] 与用户说明；历史实测保留并明确为实现缺口。
- 巡检与修正回执见 [[巡检报告/2026-07-21-创模式核心原则一致性巡检]]；本轮只改 Wiki，不改代码。

## [2026-07-21] 修正 | 创模式原生附件模型能力与工具补位合同

- 直接读取 OpenRouter 模型页与实时模型接口，只核对 GPT、Claude、Gemini、DeepSeek、Grok 五家：GPT-5.6、Claude 5/4.8、Grok 4.5 为文字+图片+文件，DeepSeek V4 为文字，Gemini 3.5 Flash 为文字+图片+文件+音频+视频。
- 更新 [[开发/创模式原生附件直连合同SDD]]：模型能力按“模型 ID + 渠道 + 输入模态”真实合同登记；OpenRouter 只缩小候选范围，不能替代 NewAPI/RH 生产实测。
- 修正不支持模态时的流程：附件身份与能力缺口仍进入模型，模型可按需调用读取/预处理工具；产品不自动切换模型、不提前运行 FFmpeg、转写、视觉或 OCR。

## [2026-07-21] 修正 | 补齐创模式端到端总架构

- 用户复核发现 [[开发/创模式原生附件直连合同SDD]] 只有附件合同、能力和测试，缺少从点击发送到最终回复的完整主链。
- 新增唯一 Direct Runtime 总架构、七步发送时序、六层职责和三种结果分支；明确模型是大脑，Direct Runtime 是唯一调度循环，工具是候选手脚，CreationPanel 只是受控媒体执行界面。
- 媒体计划改为模型基于用户目标提出后再校验和展示确认卡；产品不得用关键词在模型之前截流。

## [2026-07-21] 修正 | 创模式智能媒体增强与 Gemini 媒体专家

- 用户确认智能媒体增强默认开启：主模型原生支持媒体时直接读取；不支持时由 Gemini 3.5 Flash 读取原件并返回结构化理解，最终仍由用户选择的主模型回答。
- 明确模型协作与普通工具是两层能力：“不要使用工具”不禁止 Gemini；“只用当前模型”才禁止 Gemini；两者都禁止且主模型不支持时明确失败。
- Gemini 完成整体媒体理解后，主模型仅在精确镜头、时间点、逐字稿、OCR 或不确定性需要时调用工具验证，不默认双跑全套流程。
- 更新 [[开发/创模式原生附件直连合同SDD]] 的总架构、职责、能力合同、错误、实施任务、验收矩阵、风险和完成架构；生产默认启用仍以 Gemini 3.5 Flash 真实渠道合同测试通过为门槛。

## [2026-07-21] 修正 | 原生附件 SDD 产品哲学审计

- 依据根目录 `AGENTS.md` 将实施拆成两个独立门禁：先闭环原生附件发送合同，真实验收通过后再增加 Gemini 媒体专家，避免用跨模型协作掩盖基础合同缺陷。
- 第一阶段能力只认当前 Provider 和生产 NewAPI 的渠道级证据，不把模型模态声明复制到 RH、Ollama 或自定义 Provider。
- 首次跨模型发送前增加一次知情确认并允许撤回；Gemini 协作必须复用现有直连鉴权、传输、取消和错误链，不新增第二套客户端。
- 实施基线固定为 Git `c48e95b1`；本轮只修 Wiki，不改代码。

## [2026-07-21] 修正 | 媒体专家使用用户自有 Provider/K

- 用户确认韭菜盒子只提供创模式调度逻辑，不提供公共 Gemini、不代付费，也不读取其他分组或其他 Provider 的 K。
- Gemini 只有在用户当前 Provider/K 的模型目录真实可见且合同测试通过时才可协作；没有时询问是否使用现有本地工具，拒绝、缺失或平台不支持则明确失败。
- 纯本地模型原生支持媒体时直接读取；不支持时只走用户同意的本地工具，绝不自动上传云端。

## [2026-07-21] 生产合同 | 当前用户 K 的原生媒体输入

- 当前用户 K 的 `/v1/models` 返回 74 个模型并包含 `gemini-3.5-flash`，但不返回模态字段。
- 极小真实请求证明：Gemini 使用 `file.file_data` 可读取 MP4 和 WAV，并可与 `tools` 同请求；`video_url` 虽返回 200，但模型回答“没有提供”，不能作为有效视频合同。
- GPT-5.6 Terra 对同一 `file` 视频回答“无法判断”；只登记为不支持，不伪造已读取。
- SDD 第一阶段据此统一图片 `image_url`、视频/音频/文件 `file.file_data`，不增加 Provider Adapter。

## [2026-07-21] 开发收尾 | 创模式原生附件与用户自有媒体补位

- 完成 [[开发/创模式原生附件直连合同SDD]] 的代码实现：Web/Desktop 共用原生附件合同；请求态原件与持久态素材引用分离，Base64 不写入创模式会话。
- 主模型不支持媒体时，只在当前 Provider/K 内使用已验证 Gemini 3.5 Flash，并在首次发送前显示知情确认；没有 Gemini、用户拒绝或协作失败时，只允许用户授权后的本地工具补位。纯本地模型不上传云端。
- 工具能力与附件投递解耦；明确的“不要工具”和“只用当前模型”分别生效。设置可关闭智能媒体增强并撤回跨模型长期授权；413、400/415、524 有明确附件错误，失败或取消保留输入区附件。
- 当前用户 K 真实复测：74 个模型；Gemini 正确识别 378B PNG、2290B MP4、32078B WAV 和 MP4 + tools，GPT-5.6 Terra 对同一 MP4 明确未读取。未输出 K 或 Base64。
- 验证通过：完整 focused、Rust 394/0/1、TypeScript、Web/Desktop 正式构建、两端产物审计和 `git diff --check`。Desktop/Web UI、刷新恢复、真实付费和 Windows/Intel/Apple Silicon 安装包人工矩阵仍待执行。

## [2026-07-21] 审计修正 | 创模式附件与 Provider 边界

- Git `701021a6` 修正六项实现缺口：媒体计划嵌套 Base64 清洗、文件提取失败保留原件、Web 失败与取消向外传播、本地模型禁止云端回退、自定义 Provider 禁止冒用默认 K、旧图片入口统一进入输入模态判断。
- 新增 Web 行为测试覆盖无同 Provider Gemini、用户拒绝、媒体专家失败、API 配置失败、专家阶段取消、本地视频零云请求和文字模型不接收旧图片。
- 验证通过：`pnpm run test:focused`、Rust 394/0/1、TypeScript、Web/Desktop 正式构建、两端产物审计和 `git diff --check`。人工验收边界不变。

## [2026-07-21] 修正 | 创模式真实视频第三轮合同

- 真实 17.1 MB、127秒MOV与旧会话回归推翻“原生附件已经完整闭环”的状态：浏览器`video/quicktime`未按NewAPI官方`video/mov`归一化，历史重发没有恢复`modelAttachments`，HTTP 500正文被吞，`content_filter`被显示为空回复，失败UI文本继续污染模型历史。
- 更新[[开发/创模式原生附件直连合同SDD]]：新增完整NewAPI官方MIME矩阵、最终JSON请求预算、错误状态与模型历史分离、历史附件恢复、时间轴剧本结果和真实验收任务。
- 生产边界保持不变：继续使用`calciumion/new-api:latest`官方镜像；官方`/v1/files`仍为501且相关issue开放，本轮不维护NewAPI Fork、不引入LangChain或Google Files API服务。本轮只修Wiki，不改代码。

## [2026-07-21] 纠偏 | 创模式第三轮回归基础合同

- 用户确认视频剧本、时间轴、分镜、台词和固定 JSON 不是创模式底座验收标准；这些属于后续 Skill、提示词或确定性工具与创模式的组合能力。
- 重新整理[[开发/创模式原生附件直连合同SDD]]第三轮：只保留 NewAPI 官方 MIME、请求预算、错误状态、失败历史、附件恢复和真实附件回归；模型回答保持自由文本。
- 删除剧本 JSON、时间轴实现任务和内容质量验收；本轮仍只修 Wiki/SDD，不改代码。

## [2026-07-22] 最终纠偏 | 创模式只使用当前模型

- 用户最终确认：创模式不负责在当前模型不支持附件时自动寻找 Gemini、换模型或询问本地工具补位；当前模型不支持时只明确结束。
- 重写[[开发/创模式原生附件直连合同SDD]]：唯一路径是“当前模型 + 当前 Provider/K + NewAPI 官方附件合同”；保留普通模型工具循环，但工具不作为产品级附件降级。
- 实施范围只包含：删除自动媒体专家路由，修正 NewAPI MIME 与请求预算、HTTP/`content_filter` 错误、失败历史污染和旧附件重发。本轮只修 Wiki/SDD，不改代码。

## [2026-07-22] 开发收尾 | 文武道 OpenCode Prompt 上下文对齐

- [[开发/文武道模式OpenCodePrompt上下文对齐SDD]] 已实施：当前项目内 `@` 文件和目录变为官方 `file` parts，显式 agent 变为 `agent` part；发送前复核引用存在性，失败保留输入与 pill。
- 固定 Skill permission 在新 `session.create` 同步写入，既有会话在 `promptAsync` 前按规则集去重同步，避免首轮权限竞争。
- 本分支专项、完整 focused、`vue-tsc -b`、`pnpm run build:desktop:quick` 和补丁检查通过；真实 Desktop Provider 和三平台人工验收待补。

## [2026-07-23] 开发收尾 | OpenCode 会话时间线与上下文对齐

- 更新 [[开发/文武道模式OpenCodePrompt上下文对齐SDD]]、[[开发/OpenCode差异修复记录]]、[[hot]] 和来源索引：Desktop 时间线固定为 OpenCode Sync Store 单一真源；侧栏会话选择始终先加载指定 session，不允许 Web/创模式遗留 guard 阻断。
- 分支提交范围：`c720be5a` 至 `694d1132`，包含 `@` file/agent parts、Skill permission、附件投影、消息乱序/快照连续性、官方 thinking row、分页历史、代码块复制和 session 切换回归。
- 自动验证：`desktopOpenCodeSyncCutover` 39/39、`pnpm exec vue-tsc -b`、`pnpm run build:desktop:quick` 和 `git diff --check` 通过；quick build 生成的无关图标差异未纳入提交。
- 未验证：本轮 `pnpm run test:focused` 未产生可归属结束码，原因是 2026-07-19 遗留 Node 测试进程使用固定 `/private/tmp/jc-focused-tests`；已停止该进程，需在干净临时目录复跑。真实 Desktop Provider、停止/权限交互及三平台人工矩阵仍待补。

## [2026-07-23] 修正 | 统一道模式现行文档入口

- `CLAUDE.md` 的道模式入口改为 [[开发/绝对纯直连道模式SDD]]。
- `来源索引.md` 登记纯直连 SDD、实施记录和 Git 证据；旧 OpenCode `dao` Agent 方案标记为已替代。
- [[开发/道模式OpenCode第三主Agent SDD]] 明确降为历史方案，不再作为现行开发依据。

## [2026-07-31] 发布收尾 | v2.1.3 通用记忆工作台工具与文档链路

- 完成模型主导工具与当前运行审批：Desktop 增加 Terminal，双端补齐目录、移动和删除；`read_url` 与显式 `@联网搜索` 分离。
- 文档上传后保存可读副本并由模型按需 `grep/read`，不再逐轮注入全文；画布快捷键只在焦点或事件目标位于画布内时拦截复制。
- 版本统一为 `2.1.3`。发布前验证：focused Node 1412/1420（8 跳过）、Rust 401/402（1 忽略）、TypeScript、Web/Desktop 正式构建与产物审计通过。
- `.raw/jc-media/{文档,图片,视频,音频}` 的 App 层迁移仍待实施；Web 生产地址和三平台 CI/Release 结果仅在真实完成后补记。
- Web Production 已部署至 `https://04db458f.jiucaihezi.pages.dev`；正式域名 `https://jiucaihezi.studio` 返回 HTTP 200，防缓存请求加载本次构建的 `index-Bub6mWvw-jc20260610b.js`。三平台结果继续等待 tag 流水线真实完成。
- `v2.1.3` tag 触发 GitHub Actions `30616993714`：Mac Apple Silicon、Mac Intel、Windows x64 与 `publish-manifest` 全部成功；两份 macOS DMG 均完成 Developer ID 签名、公证、SHA256 和记忆 App 边界冒烟，Windows ZIP 完成内容冒烟。
- GitHub Release `https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/tag/v2.1.3` 为正式非草稿，含 ARM DMG、Intel DMG 和 Windows portable ZIP；服务器三个下载地址均返回 HTTP 200，`https://api.jiucaihezi.studio/updates/latest.json` 已更新为 `2.1.3`。

## [2026-08-01] 发布准备 | v2.1.4

- 收口 `v2.1.3..main`：自动分组登录 Key、记忆工作台消息/Raw/基础作品工具、HTML/PNG 渲染、Three.js 3D 白膜与 RH 全球站逐模型路由。
- RH adapter 已在服务器重建；全球 Key 已进入容器，`/health` 返回 `status=ok`、44 个模型。真实 Grok/Suno 与其他迁移模型任务尚未验收，不记为成功。
- 版本号统一为 `2.1.4`；发布前门禁通过：focused Node 1422/1430（8 跳过）、Rust 402/403（1 忽略）、类型检查、Web/Desktop 正式构建与两端产物审计。Web Production 和三平台 CI 仅在真实触发后补充证据。

## [2026-08-01] 发布准备 | v2.1.5

- 修复 Suno 经 NewAPI 标准音频合同调用时自定义字段丢失：App 同时发送标准 `input`，RH adapter 将其兜底映射为 `prompt / description / lyrics`；服务器必须拉取本提交后只重建 `rh-adapter` 才生效。
- 修复 3D 白膜标签遮挡主体和 Web 崩溃：标签固定小尺寸、人物头顶锚定并恢复深度遮挡；底部提供九个通用机位；空白/截断 `.jcscene` 降级为纯文本，编辑器通过现有解析器获得可克隆纯数据。
- 用户已完成 Web 人工验收；版本统一为 `2.1.5`。发布门禁通过：Node 1424/1432（8 跳过）、Rust 402/403（1 忽略）、类型检查、Web/Desktop 正式构建与两端产物审计。Web Production 和三平台 CI 结果只按本轮真实执行结果继续补充。
- Web Production 已部署至 `https://ae9a1a0b.jiucaihezi.pages.dev`；正式域名 `https://jiucaihezi.studio` 返回 HTTP 200，并与本地正式产物共同加载 `index-Dlc60MQ5-jc20260610b.js`。三平台构建状态在 tag 真实触发后记录。
- `v2.1.5` tag 已触发 GitHub Actions `30690007566`；Mac Apple Silicon、Mac Intel 和 Windows x64 均已进入运行状态，按发布要求未等待完成，不记为构建成功。
- 服务器仅重建 `rh-adapter`，容器健康检查返回 `status=ok`、44 个模型。真实海外 Suno 歌词任务提交约 113ms，RunningHub 约 15 秒完成，adapter 和公网 `/rh/tasks/global:<id>` 均能返回 `completed` 与完整歌词。
- Web 一直显示“提交中”的根因不是 RH 或 NewAPI 慢：NewAPI 约 125ms 返回 200 后，前端等待任务历史持久化完成才开始轮询；Web 存储等待会阻断后续查询。现改为任务 ID 和轮询地址先写内存并立即轮询，持久化后台执行；focused Node 1424/1432（8 跳过）和类型检查通过。

## [2026-08-02] 生产摸底 | Gemini 3.6 Flash 视频读取前置核验

- 生产只读实查确认 NewAPI 仍为 `v1.0.0-rc.20`，运行镜像摘要为 `sha256:6da2278e7f28109043375e373546efdfb96d9a60d82a46f039d0a81499ec8cd3`；官方最新 `main` 不能替代生产行为证据。
- `gemini-3.6-flash` 存在于渠道 `71/73/89`，三者均启用、类型均为 `24`、上游均为 `zxai.work`，且 `model_mapping` 为空。该事实只证明可路由，不证明上游身份或视频已被读取。
- 容器没有显式设置请求体、文件下载和流超时环境变量；Nginx server 块有 `200m`，但存在 location 级覆盖，正式域名确认经过 Cloudflare。真实大小上限必须由阶梯请求确定。
- [[运维/服务器运维]] 已登记生产事实、NewAPI 官方通用视频转换边界和未验证项；下一步先用专用低额度 Token 跑 `2 MiB` 防假读 MP4，不升级生产或修改限制。

## [2026-08-02] 开发收尾 | 快速模式只读 Wiki 查询

- 快速模式与记忆模式继续共享当前对话上下文，工具池固定为唯一只读 `wiki_search`；用户文字不能增减工具。
- `wiki_search` 复用现有 Wiki `search` 运行时，只接收 `query / scope / limit`，无写入、修正、建图或任意文件读取能力；Web 和 Desktop 执行路径已对齐。
- 自动验证：定向 69/69、完整 focused 1429/1437（8 跳过）、`vue-tsc -b` 和 `git diff --check` 通过；未执行正式构建，真实模型自主调用待人工验收。

## [2026-08-03] 设计确认 | Web / Mobile 核心能力收敛

- [[开发/通用记忆对话独立App SDD]] 新增第 18 节，确认 Desktop 完全不动，Web / Mobile 保留项目、对话、Wiki、项目内受限读写、附件/文档转换、项目地图和云媒体。
- Web / Mobile 计划移除 Three.js `.jcscene`、本机 FFmpeg、Terminal、本地模型和本地 `stdio MCP`；自定义 MCP / Skill 管理 UI 可隐藏，但内置 Wiki Skill 必须保留。
- 创作面板不删除、不重构；Web / Mobile 关闭时应卸载 LeaferJS 资源。文字同步合同不变，媒体二进制绝不同步。
- 当前仅完成设计记录，尚未改代码或执行功能验证。

## [2026-08-03] 开发收尾 | 历史文档定位续聊

- 记忆模式现在只从当前已装入上下文的历史用户轮次提取唯一文档名称和 `readablePath`；第二轮说“这个文档”时，模型可按原路径重新 `grep/read`。
- 文档正文和上一轮工具结果不重复注入；快速模式、当前轮附件、Raw 格式与项目工具不变。
- 自动验证：定向 55/55、完整 focused 1436/1444（8 个既有跳过）、TypeScript 和 `git diff --check` 通过。真实模型第二轮口语指代待人工验收。

## [2026-08-03] 设计修正 | 三端创作面板关闭释放资源

- 修正 [[开发/通用记忆对话独立App SDD]] 第 18 节：Desktop 不再长期挂载已关闭的创作面板；三端统一为关闭前保存 `.jccanvas`，保存后卸载 LeaferJS、Canvas、运行时媒体 URL、事件和画布写入锁。
- 已提交媒体任务继续由 `mediaTaskStore` 运行，关闭面板不得取消任务；重新打开后从任务状态和已保存画布恢复。
- Desktop 的 3D、FFmpeg、Terminal、本地模型和本地 MCP 能力不裁剪。当前仅更新设计，尚未执行代码或功能验证。

## [2026-08-03] 开发收尾 | Web / Mobile 能力收敛与创作面板卸载

- Web / Mobile 记忆工具白名单移除 `create_3d_scene` 和自定义 MCP；`.jcscene` 文件树入口与旧对话场景卡不再显示，自定义 Skill / MCP 管理入口仅保留 Desktop。Desktop 的 3D、FFmpeg、Terminal、本地模型和 MCP 工具装配未裁剪。
- 三端创作面板关闭与切换项目统一先保存 `.jccanvas`，保存成功后卸载 `CreationPanel`；既有卸载清理继续释放 LeaferJS、Canvas、事件、运行时媒体 URL 和画布写入锁，`mediaTaskStore` 中已提交任务不随面板卸载。
- 自动验证：focused 1435/1443（8 个既有跳过）、TypeScript、Web quick build、Web 产物审计与补丁检查通过，验证摘要指纹 `sha256:e146f804f114`。Desktop、Web 浏览器与真实 iPhone 人工矩阵待验收。

## [2026-08-03] 发布与记忆收尾 | v2.1.7 和新手指引

- `main`、`origin/main` 与 `v2.1.7` tag 指向 `cf599f26`；Web Production 已正式部署并加载 `assets/index-DeAQeEjp-jc20260610b.js`，GitHub Release 已建立。
- Actions `30805047950` 按用户要求不等待；检查时 Apple Silicon 产物已存在，Windows、Intel Mac 和生产 `latest.json` 切换仍未全部完成，不登记为三平台全部成功。
- iPhone `2.1.7` 开发签名版已安装、启动并由用户确认当前流程通过；它不是 TestFlight / App Store 公开版。现有 TestFlight 仍是 `2.1.0` 内部测试，Android 无公开版本。
- `jc-new-user-guide` 删除强制 GIF / 菜单、旧模式和静默上传问答，按现行三端能力重写；Skill 校验与 27 项索引生成通过，证据 `sha256:0f24861b8194`；Web quick build、TypeScript 和产物审计通过，证据 `sha256:3d9ac46c07c8`。变更发生在 `v2.1.7` tag 之后，进入后续构建。

## [2026-08-03] iPhone App Store 账号入口最小收敛与注销

- 只在 iPhone 开启账号精简：保留已有账号登录、退出和文字同步，隐藏注册、API Key、充值、日志、邀请与签到；Desktop / Web 默认行为不变。
- 新增 `DELETE /auth/account`：Gateway 只信任现有 Session，删除当前用户同步文字，调用 NewAPI 官方自助注销，再清理 Gateway 身份；客户端成功后清除本机登录凭据和当前项目云绑定，本地 Raw、Wiki、媒体不删除。
- 新增隐私政策、用户支持和服务条款静态页；Web 产物允许，Desktop / iOS 产物继续裁剪。
- 自动验证：focused 1439/1447（8 个既有跳过，`sha256:cc4dcb81d4ef`）、Gateway 20/20（`sha256:86ea9f00f57f`）、TypeScript（`sha256:1d58a6f525b8`）、Web quick build 与产物审计（`sha256:0321306433c2`）、iOS quick build 和补丁检查通过；三个合规路径本地 HTTP 均为 200。
- 尚未部署 Gateway / 合规页面，未执行真实 iPhone 不可恢复注销或生产旧 Key 失效验收；本轮未提交、未推送、未发布。

## [2026-08-04] 修正并实施 | 文字同步改为方向性覆盖

- 根因：旧 `ProjectTextSync.syncCycle()` 固定先拉后推，并在冲突时合并 Raw 或生成冲突副本；项目中心与设置页又把该行为分别命名为“立即同步/上传到云端”，导致用户无法知道哪一侧覆盖哪一侧。
- 现行合同：项目中心提供 `上传并覆盖云端` 和 `下载并覆盖本地`；前者以本地允许同步文字快照覆盖云端并 tombstone 云端独有文字，后者以云端文字快照覆盖本地并删除本地独有可同步文字。媒体、空目录、凭据、设置、Skill/MCP/Provider/Session 和 `.raw/.sync` 不处理。
- 实施：`src/services/projectTextSync.ts` 移除文件变化监听、待上传队列合并和冲突副本，复用现有 `pullFiles/pushFiles` 完整快照；项目中心增加两个明确按钮和覆盖确认，设置页改为只读状态；旧实现记录保留为历史并在 SDD 标注已被替代。
- 验证：方向性同步与界面定向 `52/52`；完整 focused `1438 passed / 8 skipped / 0 failed`；`vue-tsc -b` 通过；`pnpm run build:quick` 与 Web 产物审计通过；`git diff --check` 通过。真实 Web/Desktop/iPhone 覆盖删除人工矩阵待验收。

## [2026-08-04] 正式发布 | v2.1.9

- 发布提交 `f302c251` 已推送 `main`，`v2.1.9` tag 已推送；版本已统一为 `2.1.9`。
- `pnpm run build` 通过：focused Node `1438 passed / 8 skipped`、Rust `403 passed / 1 ignored`、TypeScript、Web 构建和产物审计成功。Cloudflare Pages Production 已部署至 `https://b45e2960.jiucaihezi.pages.dev`；正式域名返回 HTTP 200 并加载 `assets/index-C0PmvFme-jc20260610b.js`。
- GitHub Actions `30904082094` 成功完成 macOS ARM、macOS Intel、Windows x64 和发布清单；GitHub Release `v2.1.9` 已公开，生产 `latest.json` 返回 `2.1.9` 及三种桌面更新地址。iOS App Store 与 Android 商店公开状态未改变。

## [2026-08-04] 架构决策 | 记忆工作台单产品化边界与同步合同收口

- 用户确认唯一规则：记忆工作台当前拥有的全部功能保留，当前没有的功能迁出；OpenCode、旧 Studio、文/武/道/创、电商、漫剧和制作工作台属于迁出范围。
- 新增 [[开发/通用记忆工作台单产品化分离SDD]]，共享模块按记忆入口实际依赖闭包归属；Desktop/Mobile Bundle ID、Deep Link、Web/Gateway、更新通道、数据目录、账号和云项目绑定不得改变。`v2.1.9` / `f302c251` 为回滚基线。
- 现行同步只保留项目中心的 `上传并覆盖云端` 与 `下载并覆盖本地`；不合并、不创建冲突副本、不自动同步，媒体、空目录、凭据、设置和 `.raw/.sync` 不处理。设置页只显示状态。本轮未移动或删除代码和目录。
- [修复回执] [[开发/制作工作台零隐式上下文SDD]] 的不存在链接 `[[开发/电商工作台无上下文单次运行SDD]]` 已改指现存唯一目标 `[[开发/电商工作台绝对独立SDD]]`；文件指纹 `c0a627ca0197 -> 0a4085108df5`，旧值剩余 0。
- Wiki 状态查询根因已修复：应用内 `wikiRuntime` 与随包 `wiki_query.py` 原先都读取 append-only `log.md` 的第一条标题，现统一从末尾读取最新标题。TDD 红灯双端复现后，应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 和 TypeScript 均通过；真实状态输出已指向本条 2026-08-04 决策。

## [2026-08-04] SDD | 单产品化目录清单

- [[开发/通用记忆工作台单产品化分离SDD]] 新增目录级“保留、移出、禁止删除”清单，并区分整目录、混合目录和仍被记忆入口依赖的迁出阻塞项。
- 确认 `runtime/workbench` 的媒体计划、`public/skills/`、Gateway、文档/媒体服务、发布身份和用户项目数据属于记忆工作台；漫剧工作台迁出不等于删除记忆工作台可调用的漫剧 Skill。
- `src/opencodeClient/` 最终必须迁出，但当前仍被 `agentStore`、创作面板和全局搜索间接依赖；执行顺序固定为先用 TDD 完成等价替换，再迁出 TypeScript/Rust/SDK/脚本。本轮未移动或删除任何文件。
- [修复回执] SDD 已取消不可执行的跨仓库 `git mv`，改为先验证 `f302c251` 独立备份再在主仓分批删除；移动端身份明确为 iOS `com.jiucaihezi.mobile`，Android 暂停且 `src-tauri/gen/` 不作为 Git 回滚或身份验证证据。

## [2026-08-05] 开发收尾 | 记忆工作台单产品化分离实施

- 四组 TDD 已完成：模型目录改用 Gateway；创作面板解除 OpenCode session/owner；全局搜索改为 Raw 对话；Rust 移除 OpenCode Runtime、命令和二进制发现。
- 旧 Studio、OpenCode、文/武/道/创、电商、制作、漫剧工作台产品代码与专属发布物已从主仓迁出；Raw、Wiki、媒体、同步、身份、Gateway、云绑定、更新与发布链路保留。独立备份仓库 `../jiucaihezi-legacy-products/` 固定于 `f302c251` 并通过完整性检查。
- 自动验证通过：分离门禁 `5/5`、Node `985/985`、Rust `395 passed / 1 ignored`、TypeScript、Web/Desktop quick build和两端产物审计。证据指纹依次为 `7d1c33ff370d`、`372d120b0593`、`acd2fc7fee37`。
- 未验证：真实 Windows、Intel Mac、iOS 升级与云绑定连续性；Android 按既定决策暂停。`jc-raw-wiki closeout` 因删除的 PDF/PPTX 二进制 diff 触发 UTF-8 解码错误，Wiki validate 独立执行。

## [2026-08-05] 修正 | 单产品分离第二轮 Wiki 与随包 Skill 一致性

- README、AGENTS 和工作区配置已收口为通用记忆工作台；旧 Studio/OpenCode 架构页、模式 Canvas 和旧存储 SDD 完整移入 [[归档/单产品分离前/README]]，不再充当现行入口。
- `jc-everything-wiki` 与 `jc-raw-wiki` 的对话来源统一为当前项目 `.raw/对话记录/*.md`，Markdown 是唯一持久化真源；旧 Studio/OpenCode `ses_*` 来源模板已移除。
- 修正当前记忆审批 SDD、Wiki Skill 规范、生存手册、来源索引、发布边界和移动身份措辞；详见 [[巡检报告/2026-08-05-单产品分离第二轮Wiki一致性巡检]]。
- 自动复检：单产品分离门禁 10/10、Wiki Skill 18/18、Wiki 建库脚本 7/7、完整 focused 969/969、Rust `395 passed / 1 ignored`、TypeScript、Gateway 36/36、Wiki validate、Web/Desktop quick build 与两端产物审计全部通过。
- Gateway 同步收口：根路径测试对齐现行账号登录跳转；删除无生产调用者、且与登录/同步专用边界冲突的旧 `/api/*` 同源代理。本轮未推送、未发布。
- 最后一份 Tiptap smoke 试验说明已删除，历史 TDD 继续留在归档；分离门禁覆盖整个旧 smoke 目录。
- 并发审计补强：动态图标扫描恢复播放图标；Web/Desktop 递归清理并拒绝 Python 缓存；删除无调用的 `lowlight` 和孤立旧测试说明。现行 Wiki 断链为 0，追加日志与历史巡检断链只记归档卫生；15 条孤儿页建议保留。

## [2026-08-05] 开发收尾 | 产品内置 Skill 收口为 7 项

- TDD 锁定 App 只随包提供 `jc-cha-wiki`、`jc-everything-wiki`、`jc-jian-wiki`、`jc-new-user-guide`、`jc-raw-wiki`、`jc-xiu-wiki` 和 `skill-creator`。
- 20 个个人写作、视觉、旁白 Skill 先逐字迁入 `/Users/by3/Documents/jiucaihezi-personal-skills` 并提交为 `863a738`，再从 App 删除；原 `/Users/by3/.agents/skills/` 未修改。
- 产品侧删除旧推荐指令总表、个人创作模板和无人调用的一次性迁移配置；Skill 卡片只读取当前 Skill 包自己的 `commands`。旧客服自动上传草案与个人媒体 Skill 方案移入单产品分离前归档。
- 验证通过：分离门禁 `11/11`、Node `970/970`、Rust `395 passed / 1 ignored`、Wiki Skill `20/20`、建库脚本 `7/7`、Gateway `36/36`、TypeScript、Wiki validate、Web/Desktop quick build 与两端产物审计；最终产物只有 7 个产品 Skill。Wiki 深层巡检现行必修 `0`、重要 `0`、断链 `0`。
- [修复回执] 依据用户确认的 7/20 清单修正现行边界：分离 SDD `69f6144b0434 -> 9e58f1265b19`，`hot.md` `9c4be1a65a78 -> eae4eac42691`，来源索引 `65a606f0ced1 -> 6785e6530237`，第二轮巡检报告 `e6df640d314f -> fc19627a7fb5`。本轮未推送、未发布、未改版本号。

## [2026-08-05] 开发收尾 | 通用文件附件原生优先与 Markdown 降级

- 附件合同已收口为“保存原件 -> 原生文件优先 -> 明确不支持时 Markdown/OCR 降级 -> 两者都失败则明确报错”；App 不再限制模型只能读取 Markdown。
- 单个原生 data URL 上限为 32 MiB；Office/PDF/其他文档在可用时同时保留原件与 `textContent`，媒体仍走原有原生媒体 part；生产 NewAPI MIME 能力只由 Gateway/Provider 适配器决定。
- 自动验证：完整 `pnpm run build` 通过，包含 focused Node `974/974`、Rust `395 passed / 1 ignored`、TypeScript、Web 构建与产物审计；构建日志指纹 `sha256:88d767bf7043`。真实付费文件请求和跨端人工矩阵仍未验证，不能写成已发布。

## [2026-08-05] 决策修正 | 附件表示按需解析第一阶段

- 用户确认当前只实施第一阶段：原件作为唯一真源，上传不提前生成 Markdown，发送时原生表示优先，原生明确不可用时才按需生成并缓存 Markdown/OCR。
- 第二阶段的 NewAPI `unsupported_input` 统一错误码、Provider 能力探测、文件句柄和大文件通道，第三阶段的分页读取、结构化抽取、索引和 RAG 均暂不建设，等待真实使用数据。
- 同步修正通用记忆工作台 TDD、核心 SDD、`hot.md` 和来源索引；当前 TDD 保持 RED，上一轮请求层 native-first 改动不代表上传合同已完成。

## [2026-08-05] 决策修正 | Markdown-first 作为跨 Provider 文档表示

- 用户确认记忆工作台不应把 NewAPI 或任何 Provider 的原生附件能力作为主链路；DOCX/PDF/XLSX/PPTX 默认使用按需生成并缓存的 Markdown/结构化文本表示。
- 原件仍是唯一事实来源；原生文档附件只作为视觉、复杂版式等场景的可选增强。更换 NewAPI 或后端时，Markdown 主链路不变。
- 第一阶段只实施上述稳定边界；NewAPI 原生文件错误码、文件句柄、大文件通道、分页读取、结构化抽取、索引和 RAG 延后到真实数据证明必要时再做。

## [2026-08-05] 决策确认 | 附件沿用 Markdown 主链路

- 用户确认当前产品逻辑已满足后端无关诉求：Office/PDF/XLSX/PPTX 保存原件、生成 Markdown 并将 Markdown 发送给 NewAPI；本轮不改附件链路。
- 本轮唯一代码修复是记忆系统提示读取 canonical `wiki/CLAUDE.md`，忽略项目根部旧 `CLAUDE.md`；已有根部文件不迁移、不删除、不覆盖。

## [2026-08-05] 决策修正 | Everything Wiki 不再负责完整建库

- 原“知识库建库与企业 Schema”草案已被 [[开发/通用记忆工作台基础README与EverythingWiki按需规划TDD]] 取代；generic 基础骨架由 App 初始化，业务结构按用户确认后扩展。
- 旧 `jc-everything-wiki` 的 Reference 与 scaffold 已移到工作区外备份；Raw 所需项目语境归 `jc-raw-wiki` 持有。

## [2026-08-05] 开发收尾 | 基础 README 与 Everything Wiki 按需规划

- generic 记忆空间新增 `wiki/README.md`，解释 `wiki/` 入口和 `.raw/jc-media/` 原件目录；`对话记录`、`.sync`、`jc-canvas` 仅标为系统管理目录。
- `jc-everything-wiki` 改为对话式 Wiki 架构规划：读取现状、理解目标、提出最小方案、用户确认后用 `extend`/`link` 执行；不再创建完整业务模板。
- 旧 Everything Skill 的 Reference 与 scaffold 脚本已备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-everything-wiki-2026-08-05`；项目语境 Reference 迁入 `jc-raw-wiki/references/项目语境/`，避免 Raw 填充断链。

## [2026-08-05] 决策修正 | Obsidian 兼容最小 Wiki 骨架

- 对照 Obsidian 官方 Help 确认 Vault、Markdown、目录和内部链接均按需存在，官方没有“每次必读文件”；generic 新建记忆空间因此只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`。
- App 不创建 README、CLAUDE 或任何替代性的强制读取页，记忆请求不自动注入 Wiki 页面；已有用户文件不迁移、不删除、不覆盖。
- `jc-everything-wiki` 只在现有 Wiki 上规划最小目录结构；`index.md` 导航顶层分类，各目录 `_index.md` 说明用途并导航直属子目录。

## [2026-08-05] TDD | Raw Wiki 精准沉淀

- 审计确认 `jc-raw-wiki` 当前把内容沉淀、项目类型模板、Canvas、Bases、开发收尾和全 Raw 盘点混在一个 Skill；这与已修正的 Everything Wiki 属于同类过度设计。
- 新 TDD 将唯一职责固定为：把用户明确指定范围内的已确认、可复用信息增量写入现有 Wiki，并登记真实来源；不自动扫描全部 Raw，不设计目录，不生成派生视图。
- 本轮只写 TDD，尚未修改 Skill；实施时先备份旧包、补红灯测试，再删除旧 Reference 和脚本。

## [2026-08-05] 开发收尾 | Raw Wiki 精准沉淀

- `jc-raw-wiki` 已收缩为只处理用户指定来源和本轮确认内容的增量沉淀 Skill；不再默认扫描 Raw、识别行业类型、设计目录或执行开发收尾。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-raw-wiki-2026-08-05/` 后，17 份 Reference、`digest_raw.py` 与旧专项测试已移出产品包。
- 关系图、标准 `.canvas` 和统计归 `jc-cha-wiki`；统计保存为 Markdown，`.base` 等 App 支持解析和显示后再实现。
- 验证通过：旧实现红灯 `5/5`、新合同 `5/5`、Wiki Skill `26/26`、分离门禁 `11/11`、Skill Creator 校验、完整 focused、Rust `395 passed / 1 ignored`、TypeScript及两项独立模型前向检查。

## [2026-08-05] TDD | Cha Wiki 精准检索

- 对照 Obsidian 官方 Search、Graph、Backlinks 与当前原生 Wiki 工具，确认 Cha Wiki 的核心是“问题 -> 多词召回 -> 读取原页 -> 证据回答”，不是固定必读页、开发目录排序、状态计数或固定四段模板。
- 当前随包 Python 查询器与 App 原生工具重复；原生 `graph` 还会扫描全库并覆盖固定 `关系图.canvas`，与现行局部项目地图合同冲突。
- 新 TDD 保留查询、统计和显式派生视图；Canvas 收紧为用户指定主题的局部可点击文件图并保护既有布局。RAG、向量库、BM25、Bases 和自动回写答案本轮不建设。
- 本轮只写 TDD 和修正现行文档入口，尚未修改 `jc-cha-wiki`、查询脚本、原生 Wiki 工具或测试。

## [2026-08-05] 开发收尾 | Cha Wiki 精准检索

- `jc-cha-wiki` 已收缩为“短词多轮召回 -> 读取原页 -> 必要关联核对 -> 带来源回答”的只读查询 Skill；不再绑定固定必读页、开发目录、查询模式或固定四段回答。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-cha-wiki-2026-08-05/` 后，3 份 Reference、Python 查询器及缓存已移出产品包。
- 原生关系图必须提供种子页面，默认一层、最多两层，生成可点击 `file` 节点；已有 Canvas 默认只预览，确认更新后保留无关节点和既有坐标。
- 红灯已确认：旧 Skill 合同 `5/5`、旧 Canvas 合同 `3/3`；绿色验证：Cha 专项 `5/5`、Wiki Skill `28/28`、原生 Wiki 运行时 `15/15`、Skill Creator 校验。完整 focused、TypeScript 与最终门禁结果见本条后续验证回执。
- 四类真实模型前向检查未完成：Claude CLI 只读调用出现预算超限或无输出超时，未将其记作通过；需在可用模型环境复跑单页事实、同义词跨页、冲突和无答案用例。

## [2026-08-05] TDD | Jian Wiki 精准巡检

- 审计确认 `jc-jian-wiki` 当前把通用 Wiki 健康检查、语义一致性、换皮漏改、映射撞车、时代穿帮、伏笔回收和 Python/Node 运行时混在一个 Skill；其中个人创作规则不属于通用记忆工作台。
- 新 TDD 将唯一职责固定为：只读检查机械完整性和用户指定主题的语义一致性，并给出可追溯的问题证据；默认只在对话报告，显式要求时才保存 Markdown 派生报告。
- 原生 `audit` 将区分导航断链、普通未解析链接、同名歧义、孤儿候选和历史卫生；删除“目录文件数失衡就是架构问题”的误报规则。RAG、Embedding、Dataview、定时任务和自动修复本轮不建设。
- 本轮只写 TDD 和修正现行文档入口，尚未修改 `jc-jian-wiki`、原生 `audit`、旧脚本、构建逻辑、新手指南或测试。

## [2026-08-05] 开发收尾 | Jian Wiki 精准只读巡检

- `jc-jian-wiki` 已收缩为“机械完整性 + 用户指定主题语义一致性”的只读巡检 Skill；默认在对话报告，只有显式要求时才保存 Markdown 派生报告。
- 旧包完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-jian-wiki-2026-08-05/`；Reference、Python/Node 扫描器、缓存和专用构建步骤不再随 App 分发。无人引用的旧个人预设迁到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/source/kbCommandPresets-2026-08-05.ts`。
- 原生 `wiki audit` 已支持 `evidencePaths`，并区分导航断链、同名歧义、普通未解析链接、孤儿候选和历史卫生；`log.md` 按历史流水处理，目录数量不再作为架构错误。
- 红灯确认：Jian Skill 合同 `8/8`、原生新增场景 `3/3` 均在旧实现失败。绿色验证：Skill Creator、Wiki Skill `30/30`、原生 Wiki `17/17`、分离门禁 `11/11`、完整 focused、Rust `395 passed / 1 ignored`、TypeScript。四类独立模型前向检查仍留作发布前人工验收，本轮未提交、未推送、未发布。

## [2026-08-05] TDD | Xiu Wiki 精准修正

- 审计确认 `jc-xiu-wiki` 当前把确定性改错、架构扩展、巡检报告回写、日志留痕和个人创作规则混在一个 Skill；随包 Python 修正器还与 App 原生 Wiki 工具重复。
- 新 TDD 将唯一职责固定为：对一个明确 Wiki Markdown 文件中的唯一旧值，按用户或可靠证据已经确认的新值执行“预览 -> 批准 -> 精确替换 -> 重读验证”。
- 原生 `replace` 将强制单文件范围，多命中默认拒绝并要求显式 `replaceAll`；只会向文末追加裸链接的 `link` action 删除。目录规划与 `extend` 归 Everything，新事实归 Raw，复检归 Jian。
- Obsidian 的重命名自动更新内部链接、废纸篓和 File recovery 被记录为独立文件生命周期差距，本轮不冒充 Xiu 已具备。本轮只写 TDD 和修正现行文档入口，尚未修改 Skill、原生修正工具、旧脚本、新手指南或测试。

## [2026-08-05] 开发收尾 | Xiu Wiki 精准修正已实施

- 原 `jc-xiu-wiki` 已完整备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-xiu-wiki-2026-08-05/`；产品包现在只保留标准 `SKILL.md`。
- 已删除随包 Reference、`apply_fix.py` 和 Python 缓存；新 Skill 只声明“一个明确 Markdown 文件 + 唯一旧值/新值 + 依据”的预览、批准、精确替换和重读验证合同。
- 原生 `wiki replace` 已拒绝无路径、Wiki 外路径、非 Markdown 文件；单文件多命中默认拒绝，显式 `replaceAll: true` 才允许全部替换，并返回行号、指纹和验证结果。
- 原生 `link` 已从工具合同、参数解析、审批策略和运行时删除；断链修正统一使用 scoped `replace`，目录扩展继续由 Everything 使用 `extend`。
- 红灯先在旧实现失败；当前 Skill 契约 `32/32`、focused `978/978` 已通过。TypeScript、Rust 和最终 diff 门禁待本轮最后验证。

## [2026-08-05] 验证回执 | Xiu Wiki 精准修正

- Skill Creator 校验通过；Wiki Skill 契约 `32/32`、focused `978/978`、TypeScript 和 Rust `395 passed / 1 ignored` 全部通过。
- `git diff --check` 通过。Xiu 实施完成；本轮未提交、未推送、未发布。

## [2026-08-05] 最终门禁 | Xiu Wiki 精准修正

- 补齐工具 Schema 不暴露 `link/target`、缺少 `reason/basis` 拒绝和新手指南职责测试后，最终结果为 Skill 契约 `34/34`、focused `980/980`、TypeScript、Rust `395 passed / 1 ignored`、`git diff --check` 全部通过。

## [2026-08-06] 开发收尾 | Raw、Cha、Jian 证据链与可信检索

- 原生 Wiki 工具新增只读 `evidence`，Web 与 Desktop 按项目文件原始字节计算完整 SHA-256；generic 来源索引使用空六列表，`audit` 能检查来源一致、变化、丢失、无法验证和登记不完整。
- `jc-raw-wiki` 在正文写入成功后登记证据，`jc-cha-wiki` 回答重要项目事实时展示 Wiki 章节和已登记原始来源，`jc-jian-wiki` 复用原生审计且不自动判错或改写。
- 红灯先确认旧实现缺少上述合同；绿色验证为相关原生/Web/Desktop/审批 `57/57`、Wiki Skill `38/38`、完整 focused `986/986`、Rust `395 passed / 1 ignored`、TypeScript、Web/Desktop quick build、两端产物审计与 `git diff --check`。
- 五类脱敏用例已建立，独立模型前向验收尚未执行，不记为通过。本轮未增加 RAG、向量库、BM25、新依赖或遥测，未提交、未推送、未发布。

## [2026-08-06] 产品决策 | 媒体与 3D 继续保留

- 用户最终撤销媒体与 3D 迁出决定；图片、视频、音频、`.jccanvas`、`.jcscene`、GLB/GLTF 和 Desktop 动画导出继续属于韭菜盒子现有能力闭包。
- 原迁出 SDD/TDD 在实施前停止，短视频工厂未被修改，韭菜盒子没有迁出提交、源端删除或迁移发布。两份文档已收口为不可执行的撤销记录。
- 性能方向固定为按需加载、卸载和减少非活动资源；不得降低最终画质、删除功能或限制高性能设备正常并发。后续性能实现必须另写 TDD。

## [2026-08-06] 稳定性修复 | 媒体任务等待 SQLite 初始化

- 真实 Desktop 启动复现 `MemoryWorkbench mounted -> mediaTaskStore.init -> loadTasks -> SQLite storage is not ready`，证明共享 Store 仍会与后台 `initDB()` 竞态。
- TDD 先暂停存储初始化，确认数据库放行前任务历史读取次数为 0，放行后只读取 1 次；随后让 `initDB()` 并发调用复用同一个 Promise，并让媒体 Store 在读历史前等待该 Promise。
- 媒体任务专项 `46/46`、完整 focused、TypeScript、Desktop quick build、产物审计和 `git diff --check` 通过。两次干净启动中 SQLite 约 5.1 秒、4.9 秒完成，均未再出现 mounted-hook 未处理异常。
- 此前中断的 Grok Video 任务按已保存 `pollUrl` 自动恢复并最终 `success 100%`；Veo 3.1 与 Fast 仍在提交阶段返回真实 `404 fail_to_fetch_task`，本轮没有修改或宣称修复其 NewAPI/上游链路。

## [2026-08-07] 修复 | 附件图标与 Windows 启动合同

- 根因：图标离线扫描器只匹配下划线名称，漏掉输入框使用的 `attach-file`；Windows 发布仅生成便携 ZIP，未提供处理 WebView2 的安装入口。OpenCode 不是运行依赖。
- 修复：扫描器及覆盖测试支持连字符并重新生成 `icons-bundle.json`；Windows CI 同时构建 NSIS 安装器和便携 ZIP，安装器使用可见 `downloadBootstrapper` 引导 WebView2。
- 验证：Windows 发布合同测试、完整 focused `986/986`、Rust `395 passed / 1 ignored`、TypeScript 与 `git diff --check` 通过。
- 未验证：当前环境没有 Windows 真机，缺少 WebView2 的安装、首次启动和升级仍需人工验收；因此本条不记作 Windows 真机通过。

## [2026-08-07] 功能 | 3D 手动运镜录制

- 根因：3D 编辑器已有 OrbitControls 和 Canvas/FFmpeg 录制链路，但界面录制入口只支持自动时间线，没有手动录制入口。
- 实施：新增开始/停止按钮；录制时隐藏网格和变换控件，保留旋转、平移、推进、拉远；停止后交给现有 `dev_export_scene_video` 保存 MP4。
- 验证：合同测试 `49/49`、TypeScript、图标检查和 `git diff --check` 通过；真实 Desktop 手动操作与成片播放待人工验收。

## [2026-08-07] 功能 | 3D 白膜对话增量编辑

- 决策：`.jcscene` 继续作为 `.raw/jc-media/文档/` 中的源工程；图片和视频只是导出结果，不与源文件混放。
- 实施：Desktop 新增 `edit_3d_scene` 原子操作，支持新增对象/排列、移动、删除和调整镜头；整批操作先校验后一次写回，失败不改变原文件。场景预览下方增加当前场景输入框，发送后自动重读并刷新；Web 保持现有只查看边界。
- 边界：普通修改不重建、不增加第二套聊天；只有明确“重做/重新生成”才使用 `create_3d_scene` 覆盖；本阶段只做白模基础。
- 验证：3D 增量编辑专项 `81/81`、TypeScript 通过；完整 focused 和真实 Desktop 对话修改待最终验收。

## [2026-08-07] 发布准备 | Windows 上传与 OTA 合同收口

- Windows GitHub Release 上传步骤不再依赖前一步的 PowerShell 局部变量，当前步骤重新声明并校验 NSIS 与便携 ZIP 路径。
- 旧 OTA 的 RSA 公钥、OpenSSL 签名和 Tauri 2 minisign 验签合同不兼容；在没有新的生产 signer 密钥前，配置与发布清单任务暂时关闭，安装包继续通过 GitHub Release/官网分发。
- 3D 非人物标签默认隐藏，人物及人物编队保留标签；吸附按钮改用现有 `sync` 图标，场景修改发送后恢复主输入框草稿。
- 自动验证：发布合同 `12/12`、TypeScript、完整 focused、Rust `395 passed / 1 ignored` 与 `git diff --check` 通过；真实 Windows NSIS 安装启动、Web/桌面正式构建和发布尚未执行。

## [2026-08-07] 紧急修复 | v2.1.11 Desktop 启动 panic

- 真实发布结果：macOS ARM/Intel 构建后启动冒烟均在 `PluginInitialization("updater")` 失败；Windows job 因只检查包内容而显示绿色，但用户双击 EXE 同样无法启动。
- 根因：`plugins.updater` 配置已删除，Rust Builder 仍注册 `tauri-plugin-updater`，插件反序列化空配置时在窗口创建前 panic；不是 WebView2 或 OpenCode 依赖问题。
- 修复：删除 Rust updater 注册、Cargo/npm updater 依赖和无人调用的 `useUpdater.ts`；Windows CI 在打包前启动 release EXE 并要求存活 15 秒，提前退出时打印 stderr 并阻断发布。
- 验证：红灯合同先复现 updater 注册和 Windows 启动门禁缺失；完整 focused `1002/1002`、Rust `395 passed / 1 ignored`、TypeScript 与 `git diff --check` 通过。本机 aarch64 macOS 生产 release 已成功构建并真实启动存活 15 秒；真实 Windows 修复包待新版本发布后验收。

## [2026-08-07] v2.1.13 发布链路修复

- 根因：下载页使用 `api.jiucaihezi.studio/updates/latest.json`，而该文件由已停用的 OTA `publish-manifest` 任务生成，因此仍停在 `2.1.10`；同时三个 Tauri job 并发尝试创建同一个 GitHub Release，ARM 任务在创建 Release 时收到 `Resource not accessible by integration`。
- 修复：新增 `prepare-release` 单一预创建任务；三平台只上传资产，不再自行创建 Release；新增独立 `publish-download-manifest`，从 GitHub Release 下载并上传资产，生成不含 updater 签名的公开下载清单；支持 `workflow_dispatch` 的 `publish_tag` 对既有 tag 补发清单。
- 红灯/绿灯：发布合同先失败后通过；YAML、`git diff --check`、完整 focused `1002/1002`、Rust `395 passed / 1 ignored` 通过。v2.1.12 ARM 重跑已成功并补齐 GitHub Release 资产；根因修复作为 v2.1.13 走正常 tag 发布，不覆盖旧 tag，也不采用一次性清单补发作为正式方案。

## [2026-08-07] 产品收缩 | Jina 网页工具迁出

- 用户确认 Desktop 是核心平台，Web 与 Mobile 不需要为网页读取或搜索保留 Jina 辅助链路；Desktop 继续使用需审批的本机 Terminal 联网。
- `web_search`、`read_url`、输入框 `@联网搜索`、前端实现和 `jina-adapter` 已从主仓迁出，原实现备份于 `/Users/by3/Documents/jiucaihezi-jina-backup`；普通聊天、Wiki、文件、MCP、媒体和 3D 不受影响。
- 当前无法登录生产服务器，旧容器和 NewAPI 渠道只记录为待核验下线，未写成已经停止。

## [2026-08-07] 功能 | 官方 Playwright MCP 零内置接入

- 内置 MCP 目录增加固定版本 `@playwright/mcp@0.0.79`；Desktop 点击连接后复用现有 `npx` stdio、工具发现和 MCP Bridge，不新增依赖或浏览器引擎。
- 缺少 Node/npx 时显示真实错误、Node.js 官方下载入口和重新检测按钮；Windows 补齐 `npx.cmd` 常见路径解析及 `cmd.exe /C` 启动。
- Web 与 Mobile 保持不能运行本地 stdio MCP 的边界；Playwright 作为高权限扩展，只有用户主动连接后才向模型暴露完整官方工具。
- TDD 先确认目录项、一键连接、安装引导和 Windows 命令入口合同缺失；专项合同 `6/6`、完整 focused、TypeScript、Rust `396 passed / 1 ignored`、Desktop 生产构建与产物审计已通过。macOS Desktop 已确认卡片与高权限标识正确，官方 MCP 命令可启动；真实点击连接及 Windows 安装后重连仍待人工验收。

## [2026-08-08] 修复 | Playwright MCP 点击无反应

- 根因一：Tauri 开发页是远程 URL，原能力地址没有使用 URLPattern 路径通配符，IPC 与外链打开均未得到开发环境权限。根因二：只声明 3 个 MCP 自定义命令会触发 Tauri 对全部应用命令的 ACL 检查，造成文件、Skill、密钥等既有命令被拦截。
- 修复：开发能力改为 `http://localhost:1420/*`；新增 `allow-app-commands`，与 `generate_handler!` 当前 147 个 Rust 命令全量一致；合同测试逐项比较两份清单。`Plugin not found` 不再误判为缺少 Node，下载按钮复用统一外链打开。
- 验证：MCP 专项 `7/7`、完整 focused、Rust `396 passed / 1 ignored`、TypeScript、Desktop quick build 与产物审计通过；开发启动日志已无 `not allowed`，`npx -y @playwright/mcp@0.0.79 --help` 真实成功，用户已确认最新开发版点击连接成功。包含修复的新版本和干净外部电脑安装链仍待验收。

## [2026-08-08] 经验沉淀 | Windows 窗口不可见与 MCP 依赖诊断

- Windows 启动问题通过“绝对 EXE 路径 + stderr + 进程存活”确认程序主体可运行，再通过改名 App 数据目录确认是持久化状态；真实失败状态包含零尺寸和 `-32000` 坐标。共同读写入口已拒绝无效状态，用户随后确认桌面和开始菜单可正常打开。
- MCP 问题必须先区分权限错误与依赖缺失：`Plugin not found` 不能引导安装 Node；只有真实找不到 `npx` 才显示下载和重试。Tauri 应用自定义 ACL 不能只登记新增命令，必须与全部 `generate_handler!` 注册命令保持一致。

## [2026-08-08] 运维验证 | 火山方舟豆包渠道

- 用户确认 NewAPI 中必须选择“火山方舟”渠道类型；使用 OpenAI 渠道会把请求错误拼成 `/v1/chat/completions`，不适用于豆包媒体/音频模型。
- 方舟渠道配置已由用户实测成功；模型列表包含 `doubao-seed-2-1-turbo-260628`、`doubao-seed-evolving`、`doubao-seed-2-1-pro-260628`、`seed-audio-1.0`。API Key 内容不写入 Wiki。

## [2026-08-09] 稳定性修复与经验沉淀 | 模型请求中断恢复

- 根因不是单一“网络不稳定”：旧链路没有当前模型请求重试；浏览器与 Tauri/reqwest 的网络错误文本不同；失败落盘、项目切换和可编辑 composer 之间还存在错误分类与竞态。
- 最小修复只重试当前模型请求两次，退避 `2 秒、4 秒`；仅把明确的请求或流中断写入 Markdown/Raw 恢复点。Raw 追加按 `userTurn.id` 幂等，旧 generation 不能更新新项目状态，发送期间锁定输入、附件、引用、Skill 和执行模式。
- Markdown 恢复点不冒充完整工具 checkpoint：它保存原任务、已有正文和风险提示，继续前必须检查项目现状，避免重复写入或外部操作。客户端取消也不宣称能终止已经进入 Tauri/Rust 或上游的请求。
- 经验已增量写入 [[学习/AI编程生存手册#34 失败恢复不是只加重试]]，具体合同保留在 [[开发/通用记忆工作台稳定性修复与Markdown体验升级SDD#3.6.1 网络中断恢复合同]]。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和 `git diff --check` 通过；真实 NewAPI/Cloudflare 三端故障注入未执行。

## [2026-08-09] 运维核对 | Seed Audio 1.0 与现有适配器

- 用户使用火山语音专用 Key 直连 `openspeech.bytedance.com/api/v3/tts/create` 成功，返回约 5.9 秒 MP3；方舟 Key 与语音 Key 不通用。
- 生产 NewAPI `rc.20` 仍按旧火山 TTS `appid|access_token` 合同，官方仓库没有 `seed-audio-1.0` 原生 HTTP JSON 适配；官方 PR `#4710` 尚未合并且面向 `seed-tts-*` 流式协议。本项暂缓，不修改生产。
- 核对确认现有两套媒体适配器为 `rh-adapter`（RunningHub 图片/视频/音频）与 `zx-video-adapter`（ZX Grok 固定时长视频）；支付 `jiucai-adapter` 和已迁出的旧 `jina-adapter` 不计入媒体适配器。
- 新增独立 `seed-audio-adapter/`，只实现已验证的文本生成主链路：OpenAI `input` 转 `text_prompt`，火山语音 Key 转 `X-Api-Key`，Base64 响应解码为原始音频。单元测试、Python 编译与 Compose 解析通过；本机 Docker daemon 未启动，镜像构建及生产部署未执行。
- NewAPI `rc.22` 起后台认证合同与数据库表发生迁移，当前 Gateway 浏览器 Cookie 登录/一键 Key 链路尚未适配；生产不能直接从 `rc.20` 拉取 `latest(rc.24)`。运维页已记录备份、镜像回滚和最低验收步骤。

## [2026-08-09] 修复 | Seed Audio 适配器上线阻断

- 适配器改为从豆包真实响应的 `data.audio` 读取 Base64 音频；回归测试同步使用嵌套真实响应形状，避免错误的顶层 `audio` Mock 掩盖故障。
- NewAPI `rc.20` 部署合同改为 OpenAI 渠道 + `http://seed-audio-adapter:8791`；不使用会把 Base URL 当完整请求地址的 Custom Channel。
- 单元测试 `1/1`、Python 编译、Compose 配置解析和 `git diff --check` 通过；Docker 镜像构建、生产部署及付费闭环尚未执行。

## [2026-08-09] 生产验收 | Seed Audio 1.0 渠道 66

- 提交 `25851e66` 已推送并由用户部署到服务器 `/opt/seed-audio-adapter/`；Docker 镜像构建和容器启动成功，健康检查返回 `seed-audio-1.0`。
- 经 `https://api.jiucaihezi.studio/v1/audio/speech` 的真实 NewAPI 用户 Token 调用返回 `HTTP 200 | audio/mpeg`；输出文件被识别为 24 kHz、64 kbps、Stereo 的有效 MP3，约 34 KB。
- 渠道 66 的 `seed-audio-1.0` 已完成 NewAPI 鉴权/计费、内网适配、豆包上游与音频返回的端到端闭环。NewAPI 仍保持 `rc.20`，不进行升级。

## [2026-08-09] 生产验收 | Seed Audio 参考音频

- 适配器提交 `d1773603` 已部署到 `/opt/seed-audio-adapter/`，容器启动正常。
- 复用 `/tmp/seed-audio-newapi.mp3`，经 NewAPI 渠道 66 将 Base64 放入 `metadata.audio_data`，真实请求返回 `HTTP 200 | audio/mpeg`。
- 输出 `/tmp/seed-audio-reference-test.mp3` 为有效 MP3（24 kHz、64 kbps、Stereo，约 27 KB），确认参考音频链路已打通。

## [2026-08-09] 修复 | 记忆模式中断续写工具调用

- 根因：Direct Runtime 在流式正文中断后自动追加“不要调用工具”，同时移除续写请求的工具定义；第一轮修复恢复工具定义后，审计又发现续写解析没有接收和执行工具调用。
- 修复：记忆模式系统合同明确对话文字不关闭工具权限；中断续写保留完整工具池，续写阶段的工具调用复用原有审批、执行、失败保护和结果回传循环。快速模式及其他调用者保持原行为。
- 提交 `055d8e8c`；完整 focused `1021/1021`、TypeScript 与 `git diff --check` 通过。真实上游中断和三端人工验收未执行。

## [2026-08-10] 生产验收 | Seed Audio 创作面板与按 Token 计费

- 创作面板新增并注册 `seed-audio-1.0`，用户可见名称为 `豆包音频生成1.0`，前端价格保持 `1.2元/分钟`；提示词、最多 3 段参考音频、画布音频选择、任务历史和 JC Media 音频保存链路均已接通。
- 真实测试确认画布选择的音频被提交为 Seed Audio 参考音，返回有效 MP3；完整前端 focused 测试 `1027/1027`、TypeScript 和 `git diff --check` 通过。
- NewAPI 模型定价改为“按 Token”：普通输入、补全和音频输入均填写 `1` 美元/1M Token，音频输出填写 `1000` 美元/1M Token。后台表单要求这些输入项先启用并填写后才能保存音频输出价格；`1000` 对应约 `1000` 音频 Token/分钟，不是单次收费。实测约 `1183` 输出 Token 按约 `$1.183` 基础价，再叠加分组和会员倍率正常扣费。

## [2026-08-10] 未解决排障 | iPhone 下载并覆盖本地无响应

- 新增 [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]，记录 `2.1.17` 开发签名版真实 iPhone 13 Pro Max 点击云端项目并确认下载后无可见结果。
- 多轮局部修改包括删除重复下载按钮、恢复单一云项目入口、修正 iOS 移动端识别，以及把同步状态读取从全项目扫描收紧到 `.raw/.sync` 固定目录；局部测试、TypeScript、IPA 构建、安装和启动均通过。
- 用户最后操作后只读复查，四个本地项目的 `.raw/.sync/state.json` 修改时间全部未变化，证明真实下载未落盘。本轮明确暂停，未提交、未推送、未发布，不登记为修复完成。
## [2026-08-13] Desktop 验收与经验沉淀 | 本机 ComfyUI Z-Image Turbo

- 用户已确认韭菜盒子 Desktop 通过本机 ComfyUI 成功生成 Z-Image Turbo 图片。地址为 `http://127.0.0.1:8000`，创作面板提供 `720p/1080p` 与 `16:9`、`9:16`、`4:3`、`3:4`、`1:1`；模型卡显示“本地模型”。
- 后续接入必须先导出并复刻人工验收通过的 API 工作流，只替换明确的用户输入节点。Z-Image 当前映射为 `CR Text(47).text` 和 `EmptyLatentImage(21).width/height`；两个 LoRA、正负提示词、KSampler、VAE 和 SaveImage 保持原工作流。
- 本轮排障确认：端口不是 `8188`；WebKit Blob/Base64 保存不能作为本机结果通道；单张发糊不等于采样器未连；先比较 `/history` 节点 JSON 并使用相同种子 A/B。旧 Tauri 窗口失去 Vite 服务后不会热更新，必须重启开发版再验收。
- 详见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13]]；MiniMax H3 和其他本机工作流未接入，不写成已支持。

## [2026-08-13] 修复与模型下线 | GPT Image 2 结果落盘、Grok Image 4.2

- GPT Image 2 的远程结果 URL 在 Desktop 自动下载写入项目之前就会失效，造成预览/下载拿到 `image not found`，且没有项目路径所以不显示“放到画布”。现强制请求 `b64_json`，复用既有图片字节落盘链路；未落盘的远程结果不再显示预览入口。旧失效链接不能恢复，必须重新生成。
- 用户确认下线 `Grok Image 4.2 文生图` 和 `Grok Image 4.2 图生图`；两项已从创作注册表删除，旧 RunningHub ID 同时禁止再次执行。`rh-grok-image-video` 保留。
- focused 测试、TypeScript 与 `git diff --check` 通过；真实 GPT Image 2 新生成结果仍待 Desktop 人工验收。

## [2026-08-13] 修复与沉淀 | 创作面板异步保存方法缺失

- 症状为创作任务后出现 `flushCanvasSave is not a function`，并阻断创作面板打开、收起或项目切换；项目和素材本身未损坏。
- 根因是异步 `CreationPanel` 的 ref 已存在，但 `defineExpose` 方法尚未就绪；外层只保护 ref、不保护方法，类型又错误声明方法必定存在。
- 最小修复将 ref 方法标为可选，并使用 `creationPanelRef.value?.flushCanvasSave?.()`；回归测试同时禁止不安全调用重新进入。
- 相关测试 `92/92`、TypeScript、Desktop quick build 与产物审计通过；Web 连续开关 10 次无页面错误。完整 focused `1030/1031` 的唯一失败是两份既有 ComfyUI 测试未登记；真实 Desktop 安装包点击待发布后验收。详见 [[排障/创作面板异步保存方法缺失-2026-08-13]]。

## [2026-08-14] 发布准备 | v2.1.22 与小易图片异步适配器

- 版本统一为 `2.1.22`：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 与 `Cargo.lock` 一致。
- 新增独立 `xiaoyi-image-adapter`，六个 GPT Image 2 / Gemini 图片模型复用 NewAPI `/v1/videos` 异步任务系统，不修改 NewAPI 官方源码。
- 修复图片任务默认 4 秒计费倍率、NewAPI 模型映射兼容、轮询瞬时错误终态化、旧 `gpt-image-2` 历史计划、Gemini 无效 4K/比例、Web 大 Base64 落盘及上传边界。
- 适配器 7/7、前端 focused 1037/1037、Rust 396 项、TypeScript、Web 正式构建和产物审计通过；生产容器部署、NewAPI 渠道切换与真实付费生图待执行。详见 [[运维/小易图片异步适配与部署-2026-08-14]]。

## [2026-08-14] 生产排障暂停 | 小易 GPT 图片多参考图与账号池

- `xiaoyi-image-adapter` 已在生产构建并启动，容器内健康检查成功；NewAPI 渠道 88 的 `gpt-image-2-1k` 已真实生成成功。
- 生产数据库确认中质量请求命中渠道 92、VIP 请求命中渠道 115，模型映射没有串入 1K 渠道；两者的 2K 任务均返回 `No available 2K image accounts`，低质量渠道另有 `fetch failed`。
- 绕过 App、NewAPI 和适配器，直接向小易 `/v1/images/edits/async` 提交 `gpt-image-2-vip`、`2048x1152` 和三张参考图，任务成功取得 `task_id`，随后仍由小易返回 `No available 2K image accounts`。因此模型名、三文件 multipart、异步提交和同 Key 轮询均被接受，最终阻断位于小易 2K 账号池。
- 画布编号、文字和箭头不会被烘焙进参考图；它们不是失败原因，但也不控制上传顺序。App 并发提交与 600 秒轮询上限是后续稳定性事项，本轮未修改。
- 用户决定停止继续测试；不修改模型映射、不修改 NewAPI 官方源码、不静默降级分辨率。详见 [[排障/小易GPT图片多参考图与账号池失败-2026-08-14]]。

## [2026-08-14] 生产补验与渠道接入 | 小易三参考图成功、官方稳定渠道

- 此前长时间等待的三参考图任务最终成功，并由 App 保存到项目，确认 App、NewAPI、适配器、小易异步编辑、轮询和项目落盘主链正常。
- `No available 1K/2K image accounts` 与 `fetch failed` 更新为小易上游间歇性可用性问题，不再表述为对应分辨率永久不可用。
- 新增 `gpt-image-2-官方` 前端路由、NewAPI 可用性识别和适配器映射，上游真实模型仍为 `gpt-image-2`；单价为 `0.25/张`，待生产部署与真实生成验收。

## [2026-08-14] 生产验收 | 小易 GPT Image 2 官方渠道

- 生产 `xiaoyi-image-adapter` 已重建，健康检查列出 `gpt-image-2-官方`；`creation-models` 已重启并处于 `active`。
- App 内 `gpt-image-2-官方` 已真实生成并保存结果，确认前端、NewAPI、适配器、小易异步链路与回收落盘可用。
- 首次提交的 `model_price_error` 是 NewAPI 管理端尚未配置模型价格；设置 `0.25/张` 后成功。该错误优先检查 NewAPI 价格配置，不归类为上游账号池或适配器故障。

## [2026-08-14] 修复待部署 | 小易完成态超大载荷

- 生产排查确认：小易上游已完成、适配器查询返回 `completed`，NewAPI `tasks` 中对应渠道任务均为 `SUCCESS`；不是上游轮询卡死。
- 根因是小易适配器透传 `response_format=b64_json`，使 NewAPI 任务查询携带整张生成图片；Desktop 任务卡不能稳定接收该超大完成响应，仍显示 `processing`。
- 适配器移除该透传，使用 URL 结果，客户端继续立即下载并写入项目。适配器单测 `8/8` 和前端 focused 测试通过；新版尚未部署，生产验收待一次真实图片任务完成与落盘。

## [2026-08-14] 修复与沉淀 | 画布单图标注参考图上传

- 根因：画布箭头、笔迹、编号和文字曾是独立节点，创作提交只读取选中图片的原始媒体路径，标注不在上传文件中。
- `v2.1.23` 将每张图片改为包含真实图片节点的 Group；标注记录为该 Group 的同 `assetId` 子节点，使用图片局部坐标。提交时无标注直传原图，有标注只导出这一图片 Group，并保留原图尺寸和比例；三张选中图片分别上传，不拼画布。
- TypeScript、画布合同与 Creation Runtime/Plan 定向测试通过。历史画布的散落标注无法可靠关联，需重新标注；真实上游三张不同标注图片的视觉理解仍待人工验收。

## [2026-08-15] 生产部署 | 小易 Gemini 图片参数合同

- 提交 `cffeb8e4` 已把两项 Gemini 图片模型改为小易上游合同：10 种比例、1K/2K/4K、最多 10 张参考图、每张 10 MB、提示词最多 20,000 字符；App 的 `aspectRatio` 经异步媒体请求由适配器原样转发。
- 用户已在生产执行强制重建，容器启动为 `Up`；`/health` 返回 `status=ok`，`/v1/models` 返回两项 Gemini 与全部既有模型，证明新版镜像已加载。
- 随后用户实际测试确认本次 Gemini 请求全部成功；截图可见带参考图的 `16:9` 任务完成并保存至 `.raw/jc-media/图片/`，两项 Gemini 图片模型的生产主链完成验收。详见 [[运维/小易图片异步适配与部署-2026-08-14]]。
## [2026-08-16] 媒体文件树性能与命名收口

- 文件树取消所有媒体缩略图读取、队列、缓存和 Blob URL，统一使用类型图标，保留现有点击预览；根因是缩略图解码与视频首帧提取会和画布恢复争抢主线程与缓存，项目规模扩大后不符合流畅性优先原则。
- Desktop 与 Web 统一新生成媒体命名：可选任务摘要、清理后的提示词、模型名、六位任务 ID；不调用模型或接口，不使用日期前缀，不改名既有文件。摘要仅在仍匹配当前提示词时使用，避免编辑提示词后沿用旧内容。
- 自动验证：`vue-tsc -b`、focused 前端测试 `1058/1058`、Oxlint（仅既有警告）和 `git diff --check` 通过。

## [2026-08-16] 方案确认 | 附件拖放恢复与重复导入去重

- 确认 Desktop 原生拖放由当前 `App.vue` 单例分发，记忆对话输入区复用既有附件和 `ProjectFileService` 链路；Web 只处理 `DataTransfer.files`，Mobile 保持系统选择器，不恢复旧 `WorkspaceLayout` 或新增上传器。
- 绝对路径只作瞬时导入输入，不持久化；导入后仍以项目相对 `ProjectResource` 为事实源，确保重启、原文件移动或删除后可恢复。
- 重复导入按“同项目、同分类、同规范化文件名、同 SHA-256”复用已有资源；同名不同内容、明确改名的相同内容仍保留独立资源。Office/PDF 命中去重时复用原件和 Markdown 可读副本，缺失时只补 Markdown。
- 本轮只更新 Wiki 决策与验收合同，未修改代码、未执行自动测试或真机验收，不登记为已实施。

## [2026-08-16] TDD 建立 | 统一拖拽路由与附件导入去重

- 新建 [[开发/文件系统/通用记忆工作台统一拖拽路由与附件导入去重TDD]]，把对话区、创作画布和文件树的目标命中规则固定为红灯测试。
- 明确窗口空白区域的回退优先级：对话可见时进入对话；只有创作面板全屏/专注且对话不可见时进入画布。明确命中画布 drop zone 时仍由画布优先。
- 去重继续只放在共享导入与 `ProjectFileService` 边界；Desktop/Web 入口互斥，Mobile 不增加拖拽逻辑。当前仅完成 TDD，代码、自动测试和三端人工验收均待执行。

## [2026-08-16] 实施完成 | 统一拖拽路由与附件导入去重

- 已恢复 `App.vue` 唯一 Desktop 原生拖放分发，接入对话输入区 Web 文件/目录拖入，并保持创作面板、文件树目标路由和 Desktop/Web/Mobile 入口互斥。
- `ProjectFileService`、Rust 外部导入和 Web 项目传输已加入 SHA-256 内容去重；同内容复用且不发虚假 `created`，同名不同内容沿用 keep-both。Office/PDF 优先复用 Markdown，缺失时只补副本。
- 自动验证已通过：路由/服务/Web 传输定向测试 `29/29`、`vue-tsc -b`、Rust 去重单测；三端人工拖放矩阵尚未执行。

## [2026-08-16] 人工验收 | 对话框与创作画布拖拽上传

- 用户在当前真实产品中确认：文件拖到对话框可正常进入对话附件，拖到创作画布可正常上传到画布。
- 本次只确认上述两个拖拽入口；跨端、窗口空白区、提示词区、文件夹上限、部分读取失败、重复导入、同名不同内容和重启恢复等人工矩阵仍待验证。

## [2026-08-17] 修复与沉淀 | 输入法组合态回车

- 根因：对话输入框已有 `event.isComposing` 保护，但部分 WebView 的候选回车仅报 `keyCode === 229`；该兼容判断最初在 `@` 候选菜单之后，仍可能截获输入法事件。
- 修复：将 `isComposing || keyCode === 229` 置于 `handleComposerKeydown()` 入口，统一早于候选菜单和发送分支退出；不新增输入法状态、计时器或第二套键盘处理。
- 验证：记忆工作台定向 `55/55`、`vue-tsc -b` 和 `git diff --check` 通过。完整 focused 和真实 WebView、Desktop、iPhone/iPad 人工矩阵待后续执行。

## [2026-08-17] 修复与验收 | 3D 编辑器空白与高度为零

- Debug App 原先因错误使用 `#[cfg(dev)]` 可能加载旧 `dist`；改用 `#[cfg(debug_assertions)]` 后确认当前 WebContent 连接 `http://localhost:1420`。
- 最终根因是场景解析器直接返回人物骨骼的响应式四元数数组，编辑器初始化撤销历史时 `structuredClone()` 抛出 `DataCloneError`，中止 `setup()`；模板变量错误和高度为 0 均为连锁症状。
- `quaternion()` 现在返回普通新数组，并将响应式人物骨骼加入回归测试。当前 `tauri dev` 画布和编辑器尺寸非 0、错误列表为空，用户确认恢复；Scene3D `13/13`、工作台 `55/55`、TypeScript、Rust 和差异检查通过。

## [2026-08-17] 版本准备 | v2.1.26

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `Cargo.lock` 已统一为 `2.1.26`。
- 完整 focused 门禁、TypeScript 和差异检查通过，其中 Rust 为 `396 passed / 1 ignored`。
- 本轮只完成版本准备与提交；没有创建 tag、push、构建 Web/APP 或执行发布。

## [2026-08-18] 实施完成 | ZX 视频适配器六模型合同

- 三个 `grok-1.5-video-6s/10s/15s` 固定时长别名统一改为 `0~7` 张参考图：0 张发送 JSON，1~7 张全部转为重复的 multipart `input_reference`，第 8 张在适配器和创作计划边界拒绝。
- 同一适配器新增 `doubao-seedance-2-5-260628`、`omni-fast`、`omni-v2v`；Seedance 使用独立 `/v1/video/generations` 和 `metadata.content`，Omni 使用 `/v1/videos` JSON。
- 视频 `/content` 已改为流式代理并在响应结束后关闭上游流，避免并发下载时把完整 MP4 缓冲进适配器内存；图片上传链路保持不变。
- 适配器 `7/7`、25 并发内容代理冒烟、创作计划与运行时定向测试、TypeScript、Python 编译和差异检查通过。未部署，未用真实 ZX Key 提交或核对账单；上游网页未列出的 Seedance 2.5 与 Omni V2V 别名保持部分验证状态。详见 [[开发/ZX视频适配器多模型升级TDD-2026-08-18]]。

## [2026-08-18] 实施完成 | RH Seedance 2.5 双模型与旧模型退役

- 新增 `rh-seedance25-no-video-ref` 与 `rh-seedance25-with-video-ref`，统一固定 `native1080p`；后者强制 `1-10` 个参考视频。
- UI / NewAPI 输入价格分别为 `80/百万TOKEN` 与 `50/百万TOKEN`；后台按 Token 模式只填写输入价格。
- Seedance 2.0、Fast、Mini 三套共 9 个旧 RH 模型退出可选目录并禁止新执行，历史规格和映射保留用于读取旧任务。
- RH 适配器 `41 passed`、focused `1087 passed`、TypeScript 和差异检查通过；未部署，未进行真实生产生成、压力并发或账单验收。详见 [[开发/RH Seedance 2.5双模型接入与旧模型退役TDD-2026-08-18]]。

## [2026-08-18] 路由确认与修复 | ZX Veo、Grok、Omni

- Veo 3.1/Fast 与 Grok 6s/10s/15s 均由 NewAPI 直连 ZX；用户截图确认 Grok 渠道 Base URL 为 `https://img-api.zxcode.vip`。只有 `omni-fast`、`omni-v2v` 和 ZX Seedance 2.5 由 NewAPI 转入独立 `zx-video-adapter`。APP 的 `newapi-direct` 标记只描述 APP 到 NewAPI，不描述 NewAPI 后端是否经过适配器。
- RH 三个 Gemini Omni 和 RH Grok 继续只走 `rh-adapter`；本轮未把任何 RH 模型加入 ZX 适配器。
- Omni 下载失败的根因是官方 `/content` 必须使用创建任务时的 ZX Key，不能使用 APP 用户 Token。提交 `260803e3` 增加任务 ID到 ZX 渠道 Key的进程内映射，并保持下载入口本身仍需鉴权；适配器 `12/12` 回归通过。
- 用户已真实确认 Veo 直连生成成功、ZX Grok 6 秒生成并落盘、Omni Fast 生成完成；Omni 最终 MP4保存仍需部署 `260803e3` 后复验，当前不得登记为下载成功。

## [2026-08-19] Wiki 更正 | ZX Grok 生产路由

- 根据用户提供的 NewAPI 后台截图，更正此前将 Grok 6s/10s/15s 写成走 `zx-video-adapter` 的错误：三个模型当前生产渠道均直连 `https://img-api.zxcode.vip`。
- Grok 适配器代码与历史 SDD继续保留为历史实现和备用能力；现行路由不据代码是否存在判断，只以 NewAPI 渠道 Base URL为准。
- Omni Fast/V2V 与 ZX Seedance 2.5 的独立适配器安排不变；RH 三个 Gemini Omni 与 RH Grok 的渠道边界不变。

## [2026-08-19] Wiki 沉淀 | 创作画布设计、运行链路与旧产物排障

- 统一记录画布存储、恢复、保存、定向任务写入、单图 Group 标注、独立参考图上传和从左到右排序合同。
- 更正三处过时描述：生成结果不是自动入画布；整理媒体不是多行网格；标注已经归属于各自图片 Group。
- 记录“工具全部无效”的真实根因：后台测试 APP 外壳加载旧 `dist`，没有连接 Vite/Tauri Dev 服务；固定先核对版本、产物旧文案和 `1420` 监听，再重建前端与 bundle。
- 明确验证边界：源码类型检查、focused 测试和合同测试不等于最新打包 APP 的人工验收；本轮只提交 Wiki，不改变现有源码改动。

## [2026-08-19] 实施与沉淀 | v2.1.30 主线整合与创作画布热修

- 建立“同一仓库同一时间只有一个写入负责人”的固定规则；多个对话不会自动合并未提交状态，新写任务必须从最新已提交的 `main` 开始。
- 完成创作画布标注坐标、超大 Base64 污染恢复和媒体落点修复；按用户决定移除非必要且无法稳定命中的画布视频播放入口，保留静态视频参考。
- Grok 下载已确认正常；Veo 上游稳定性、iPhone 下载覆盖本地及正式跨端安装包人工验收仍未完成。
- 版本统一为 `v2.1.30`；本记录形成时尚未推送、打 tag 或发布。见 [[开发/v2.1.30整合与创作画布热修TDD-2026-08-19]]。

## [2026-08-20] TDD 建立 | Codex 创作 MCP 服务

- 新建 [[开发/韭菜盒子Codex创作MCP服务TDD-2026-08-20]]，确认核心不是复制 `jc_media.py`，而是让 Codex MCP 安全进入正在运行的韭菜盒子 Creation Runtime 与 `mediaTaskStore`。
- 任务必须进入创作面板同一历史，并复用现有模型目录、参数校验、同步/异步处理、取消、恢复、项目落盘和显式画布动作；API Key 继续只由韭菜盒子管理。
- 当前只完成 TDD；MCP Server、本机桥接、自动测试、真实付费生成、Codex 媒体显示、正式安装包和跨平台验收均未执行。

## [2026-08-20] 实施完成 | Codex 创作 MCP 图片、参考图与输出目录

- 已实现 `jiucaihezi-creation` stdio MCP、Desktop 回环鉴权桥接和设置页一键动态配置；入口路径、Node 路径按当前安装环境解析，不写死用户目录。
- MCP 任务复用韭菜盒子现有模型注册表、`buildCreationRunPlan()`、`mediaTaskStore`、创作历史、项目落盘和显式画布动作；API Key 仍只由韭菜盒子管理。
- `submit_creation_task` 支持本机绝对参考图路径、data URL、HTTPS URL，以及可选 `directory` 输出目录。Desktop 会把本机图片读取为 data URL；参考图数量/大小和参数限制继续由现有模型表校验，不在 MCP 复制静态上限。
- 用户已真实确认 Codex 调用韭菜盒子生成图片并成功保存；MCP schema/build、TypeScript、完整 focused `1104/1104` 和差异检查通过。
- 正式安装包、Windows/Intel Mac 真机、多参考图付费矩阵、视频/音频内嵌播放和跨重启任务恢复仍未验证。

## [2026-08-20] 生产修复与验收 | 迅虎支付跳转 404

- 确认 `jiucai-adapter` 自 2026-06-09 持续运行且零重启，容器内 `/submit.php` 正常返回迅虎收银台跳转；故障不是支付容器或 NewAPI。
- Nginx 于 2026-08-20 06:09 重启后，旧 `/xunhu/` 的 `rewrite +` 无尾斜杠 `proxy_pass` 未可靠剥离前缀；改成 `proxy_pass http://127.0.0.1:8081/;` 后 reload。
- 公网探测恢复 `200`，用户确认真实支付正常。首次备份误放 `sites-enabled` 曾导致重复监听、配置检查失败；已移到 `/etc/nginx/backups/`。回环探测仍为 `404`，不登记为已通过。见 [[运维/服务器运维#迅虎支付 `/xunhu/submit.php` 在 Nginx 重启后 404（2026-08-20）]]。

## [2026-08-22] 实施与用户验收 | Desktop AnyDoc 内置格式转换

- Desktop 的文档导入统一由 Tauri 内置 AnyDoc `0.2.3` 解析并生成 Markdown 可读副本；保留原件、项目相对路径、SHA-256 去重和现有模型读取合同，用户上传操作不变。
- 用户已在 macOS ARM 安装包实际验证 DOCX、XLSX、PPTX 转换成功。复杂 104 页 PDF 为图片型扫描件，无文字层；当前明确提示需要 OCR，不再误报文件损坏，原件继续保留。
- Desktop 本地 AnyDoc 链路不调用 MarkItDown；仅 `internal`/不可用错误可回退云端。Web/Mobile 仍走现有 `/documents/markdown` 云端 MarkItDown 服务；云端 AnyDoc staging、生产切换和 OCR 能力均暂缓，未部署服务器。
- 自动验证：前端 focused `1111/1111`、Rust AnyDoc `4 passed`、TypeScript、Rust 格式与差异检查通过；macOS ARM `.app` 签名和 DMG 完整性校验通过。Intel Mac 与 Windows x64 真机仍待后续发布门禁。详见 [[开发/通用记忆工作台AnyDoc内置格式转换升级TDD-2026-08-22]]。

## [2026-08-23] Wiki 沉淀 | 本机 MLX 最小连接入口

- 用户确认本机 MLX 不做下载器、安装助手、模型目录管理或进程管理；用户自行下载模型并启动兼容服务，韭菜盒子只提供服务地址、连接和模型自动识别入口。
- Desktop 默认地址统一为 `http://127.0.0.1:8081`，连接请求 `/v1/models`，模型以独立 `local-mlx` Provider 保存并与 Ollama/云端模型共存；只接受本机回环地址，Web/Mobile 不显示入口。
- 首次使用流程固定为“外部启动服务 -> 设置填写/确认地址 -> 连接 MLX -> 顶部选择模型 -> 快速模式先验证，记忆模式再使用 Wiki/项目工具”。详见 [[开发/通用记忆工作台本机MLX兼容服务接入TDD-2026-08-21#10. 最终界面合同与首次使用流程（2026-08-23）]]。

## [2026-08-24] 实施与 Wiki 沉淀 | 工作台右侧对话 Dock

- 文档预览或创作面板打开时，工作区采用“项目树｜主工作区｜右侧对话 Dock”；中间只承载文档或创作之一，对话复用原消息、输入和滚动状态。
- Dock 支持完整态、约 `56px` 窄栏、宽度持久化与恢复；不足 `560px` 时顶部入口切为图标，对话下拉菜单未修改。旧创作宽度状态和第二条分隔线已删除。
- 创作与资源预览切换复用同一个画布关闭 Promise；设置保持悬浮抽屉，层级高于 Dock；`940px` 以下继续使用既有全屏/移动布局。
- 文档大纲折叠后退出 Grid 列，正文恢复单列全宽，仅保留紧凑展开入口。
- 用户已完成 Desktop 多尺寸布局实测；定向测试 `56/56`、TypeScript、`build:quick`、Web 产物审计和差异检查通过。真实触控拖拽及移动端人工验收仍待执行。详见 [[开发/通用记忆工作台右侧对话Dock布局TDD-2026-08-23]]。

## [2026-08-24] 修复与 Wiki 沉淀 | MiniMax H3 视频请求合同

- `invalid_json` 根因是 App 向 NewAPI 同时发送数字 `duration` 和数字 `seconds`，而 NewAPI 的 `seconds` 入站字段要求字符串；请求因此在到达小易适配器前失败。
- 三个 MiniMax H3 模型现只发送字符串 `seconds`，不再重复发送 `duration`；其他视频模型请求保持原合同。
- 小易适配器 `/v1/models` 现要求 Bearer Token，使用同一 Token 查询上游并只返回实际可见模型对应的公开别名；适配器测试同步改为真实 `"seconds": "8"` 入站。
- 三个模型在生产验收前保持 `partial`。适配器 `12/12`、Runtime `29/29`、完整 focused、Rust `402 passed / 1 ignored`、TypeScript 和差异检查通过；未部署，未执行真实付费生成、MP4 落盘或扣费核对。详见 [[开发/MiniMaxH3视频seconds类型修复TDD-2026-08-24]]。

## [2026-08-25] TDD 建立 | iPhone TestFlight 外部测试

- 用户确认继续基于当前 `main / v2.1.34` 开发 iPhone App，不正式上架 App Store，使用 TestFlight 外部测试让其他用户安装和更新。
- 新建 [[开发/通用记忆工作台iPhone TestFlight外部测试TDD-2026-08-25]]；顺序固定为“云下载真机可观测 RED -> 根因回归测试 -> 共享根因修复 -> Mobile 真机矩阵 -> TestFlight 内部安装 -> Beta App Review -> 定向外测 -> 公开链接”。
- 继续使用 `com.jiucaihezi.mobile`、Apple Team `RXD4L9387J` 和现有 App Store Connect App；不新建 Mobile App，不恢复自动双向同步，不使用 Ad Hoc 或 Enterprise 绕过 TestFlight。
- 已加入云下载操作追踪和回归合同；iOS Debug 仅桌面加载 Vite，创作面板遵守顶部安全区并保留唯一返回对话入口。`1115` 个 focused 测试、iOS Rust target 检查、Debug IPA 构建、真机覆盖安装和启动完成，用户确认可返回对话。
- 未执行云下载真机文件落盘验证；未上传 `2.1.34` 到 App Store Connect，未完成 TestFlight 内部安装、Beta App Review 或外部公开链接。

## [2026-08-26] TDD 建立 | Wiki 任务执行提速

- 用户确认后续按“一次多词 Wiki 扫描、同轮只读工具并行、写操作串行屏障、最小耗时记录”的最小路线执行，新建 [[开发/通用记忆工作台Wiki任务执行提速TDD-2026-08-26]]。
- 根因固定为开放式模型工具循环放大模型往返，不是“简单 Agent 必然比编程 Agent 快”或模型权重差异。
- 不先引入 RAG、向量库、新索引服务、Responses API 或 WebSocket；不全局将 `64` 轮上限改为 `12`，避免削弱媒体、3D、MCP 和 Terminal 长任务。
- 当前只完成 TDD 与 Wiki 登记；运行时代码、红灯、自动验证和三次同模型真实前向均未执行。

## [2026-08-26] 实施完成 | Wiki 批量检索、只读并行与耗时观测

- Wiki 搜索增加一次 `1-3` 词扫描，连续项目内只读工具按段并行；写入、Terminal、MCP、项目外读取和其他操作默认串行，工具消息仍按模型原始顺序回填，取消不进入后续写入。
- Direct Runtime 记录真实 HTTP 请求次数、逐请求耗时、工具轮数、工具耗时和总耗时，不记录正文或参数；工作台运行步骤显示工具耗时。Cha Skill 改为一次提交初始短词及同轮读取独立证据页。
- 红灯已在旧实现确认；定向 `158/158`、Cha Skill `7/7`、完整 Node focused `1129/1129`、Rust `402 passed / 1 ignored`、TypeScript、定向 lint 和差异检查通过。
- 当前项目三词本地基准读取 `363 -> 121` 次，中位 `48.66 ms -> 24.27 ms`，约 `2.0x`。当前正式 App 为旧版 `2.1.33`；新构建上的三次 `gpt-5.6-sol` / `jiucaihezi` 真实前向未执行，不登记为端到端性能验收通过。
## [2026-08-29] 生产验收 | RH AI App 统一模型注册与部署

- 6 个 Minimax-h3 RunningHub AI App 通过 `rh-aiapp` 通用模型接入，不新增独立模型名或渠道 ID。
- 服务器部署固定为 `/opt/jiucai-repo` 拉取 `main`、稀疏检出 `rh-adapter`、复制到 `/opt/rh-adapter`，再执行 `docker compose up -d --force-recreate --build rh-adapter`；`.env` 的 `RH_AI_APP_WHITELIST` 必须包含新 `webappId`。
- 首次部署因在 `/opt/rh-adapter` 执行 `cp rh-adapter/*` 而失败，修正复制目录和白名单后，容器内映射、公网 `app-directory`（11 项）及创作面板显示均已确认。

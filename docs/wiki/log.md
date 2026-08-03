# Wiki 操作日志

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

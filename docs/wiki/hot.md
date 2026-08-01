# 🔥 热缓存

> 当前开发阶段最需要被 AI 读的二十份文档。

**当前焦点：[[开发/通用记忆工作台模型主导工具与审批SDD]] · [[开发/通用记忆工作台原始素材与文档按需阅读SDD]] · [[开发/通用记忆工作台本地作品生成基础工具SDD]] · [[开发/通用记忆工作台3D白膜场景基础工具SDD]] · [[运维/模型矩阵]]** — `v2.1.5` Web Production 与新版 RH adapter 已部署；adapter 健康检查为 44 个模型，海外 Suno 真实提交、RunningHub 完成和公网结果查询均已验证。Web “提交中”根因是轮询被任务历史持久化等待阻断，现改为先轮询、后台持久化，focused Node 1424/1432（8 跳过）和类型检查通过。三平台 Actions `30690007566` 已触发但未等待结果。Android 继续暂停。

1. **[[开发/文武道模式OpenCode-v1.18.4官方对齐升级SDD]]**、[[开发/OpenCode官方信息流翻译SDD]] — v1.18.4 对齐已实施：sidecar 不再随目录切换重启，Shell 环境按 App 缓存，暖发送只等既有 ready/session/prompt，目录 bootstrap 按 Server generation 缓存，事件桥会持续重连。SDK、更新器、CI 与 ARM64 runtime 固定 `v1.18.4`；variants 来自官方目录并随 prompt/session 恢复。focused、类型检查和 Desktop 前端产物审计通过。仍待人工三平台安装包、真实 Provider 性能和 orphan 进程矩阵；本机 Intel/Windows runtime 下载器挂起，CI 仍从同一 tag 下载。
2. **[[开发/文武道模式OpenCodePrompt上下文对齐SDD]]** — 本分支准备并入 `main`：`@` 引用、Skill permission、附件、等待态、历史分页和 Desktop Store 单一时间线均已按 OpenCode v1.18.4 接线。侧栏选择总是先加载 Store session，再丢弃过期响应；不保留本地消息镜像或跨会话 fallback。定向回归 39/39、TypeScript、Desktop quick build 与产物审计通过；完整 focused 本轮受 2026-07-19 遗留 Node 测试进程占用固定临时目录影响，未作为通过证据。Desktop Provider 连续会话和跨平台安装包仍待人工矩阵。
2. **[[开发/创模式Raw账本与对话Wiki移除SDD]]** — 创模式使用独立会话和模型原生能力优先的直连运行时，项目工具只按需进入工具循环；Desktop 文件适配与媒体任务均不启动 OpenCode。App 不再自动写项目 `.raw` 或打包 `jc-chat-wiki`；对话仍由 UI 会话保存，按模型容量装配最新完整对话，并按需只读 `CLAUDE.md` 与 `wiki/hot.md`。Desktop 合并 `public/skills` 内置 Skill 与 `~/.agents/skills` 本机 Skill，名称相同时内置优先，本机独有 Skill 正常可用；内置资源不复制到用户目录。
3. **[[开发/创模式MCP工具接入SDD]]** — 同一 `mcpStore` 中已启用且已连接的 MCP 工具构成创模式候选工具池，最终请求必须按模型 function calling 能力和任务需要裁剪；MCP 候选工具的无条件追加仍是待修实现缺口。`web_search` 已从默认工具池移除，仅在用户本轮选择 `@联网搜索` 后提供，成功发送或切换快速模式后清除。GitHub OAuth 连接、深链回调、Keychain 凭据和网关 token 代换已实现；真实验收前仍需配置 GitHub OAuth App 并发布网关。
4. **[[开发/创模式原生附件直连合同SDD]]** — 现行目标已收缩为“当前模型 + 当前 Provider/K + NewAPI 官方附件合同”。当前模型支持就发原件，不支持就明确结束；不自动换 Gemini，不询问本地工具补位。本轮只修 `video/quicktime` 等官方 MIME、最终请求预算、HTTP/`content_filter` 错误、失败历史污染和旧附件重发；不私改 NewAPI，不定义剧本或其他业务输出。
5. **[[开发/文件系统/Web云端项目Wiki媒体同步与APP升级SDD]]** — Web 项目适配已完成：项目树、画布、上传/导入导出、站内预览和创作媒体均使用当前浏览器 IndexedDB + OPFS；创作任务冻结提交时项目，媒体落 `jc-media`。无 D1/R2/服务器媒体存储或跨浏览器同步。
6. **[[开发/画布开发与排障]]** — 创作面板画布架构、保存恢复、工具、性能与已知问题的唯一入口；2026-07-16 项目文件树改为虚拟行渲染，视频缩略图由桌面后台生成并缓存，定向任务仍以 `owner:path` 队列和 scoped gate 保护 `read -> modify -> write`。
7. **[[开发/全仓测试失败审计-2026-07-13]]** — 测试债务已清理：Node 747/747、Rust 371/371；剩余是文→武、Intel/Ollama/交互人工矩阵。
8. **[[架构/对照表]]** — 韭菜盒子 ↔ OpenCode 文件映射，发现 Bug 的入口。
9. **[[开发/电商工作台绝对独立SDD]]**、[[开发/电商工作台绝对独立成功总结]] — 电商是独立工作台，不连接 Chat、文武创道或 OpenCode 运行时。当前字段、原始附件、选择的模型和静态 Skill 组成一次无工具直连；结果只保存项目定位文件。确认媒体计划后复用 `MediaPlanCard -> CreationPanel -> mediaTaskStore`，不自建历史、Wiki 双写或媒体回写链路。真实 Provider 和付费媒体仍待人工验收。
10. **[[开发/AI应用适配-交接-2026-07-17]]** — AI 应用白名单全链路：rh-adapter + 创作面板下拉菜单，5 个预置应用（极速数字人/数字人/我是导演/声音克隆/声音设计），运行时动态发现节点，通用 `rh-aiapp` 模型收敛。
11. **[[开发/文件系统/索引]]**、[[开发/文件系统/编辑区与Explorer稳定性修复SDD]] — 文件系统六期最终入口：`ProjectFileService` 是唯一项目文件总管，文件树是可视化入口，编辑区、创作面板和画布消费同一资源合同。编辑区旧草稿覆盖、Explorer 刷新折叠和底部右键菜单裁切已修复并完成自动测试、构建及 Web 真实验收；Desktop 人工验收待补。
12. **[[开发/对话Markdown正文紧凑化SDD]]** — 助手 Markdown 正文不再保留渲染 HTML 的源码换行；长文段落和列表已收紧，代码块、表格、标题及用户输入换行不变。
13. **[[开发/v1.3.0全仓53条失败清零SDD]]** — 发布门禁中的 53 条失败已全部清零：过期源码排版合同对齐当前语义，模型校验改用现存能力，创作面板多行事件表达式补齐语句分隔。focused 1096/1096、TypeScript、Web/Desktop 正式构建及两端产物审计全部通过；Production 部署、桌面签名和跨平台人工矩阵仍待执行。
14. **[[开发/Wiki四Skill产品化升级SDD]]** — 查询默认现行优先并输出结论/证据/风险/下一步；Raw 新增收尾预览与来源指纹；巡检分离现行风险和归档卫生并使用自包含 Markdown 解析器；修正新增精确预览与回执。专项、完整 focused 与 Web 正式构建通过，正式 Desktop 三平台工具环境和普通用户闭环待人工验收。
15. **[[排障/Web创作面板控制台红字排障-2026-07-20]]** — Web 创作面板三类控制台红字的根因与修复：启动脚本 CSP、创作模型接口误走 Pages、画布项目图片路径被当成网站 URL；RunningHub CORS 已在生产 Nginx 验证，前端修复待重新发布后人工验收。
16. **[[开发/韭菜盒子原生媒体编排能力SDD]]** — Desktop 创模式与 Web 直连可用受控素材 ID 编排本轮附件、项目/画布素材和同会话最近成功任务；确认后仍只走 CreationPanel 与 mediaTaskStore。自动验证、Web/Desktop 构建和产物审计通过；真实付费、刷新恢复与 Windows/Intel/Apple Silicon 安装包人工矩阵待验收。
17. **[[排障/ZX-Grok参考图视频真实失败交接-2026-07-21]]** — ZX Grok 选 1 参考图实测仍返回 `Alias.image` 对象类型 400；已停止局部补丁，交接页给出必须先抓代理端真实请求体的排查步骤。相关代码提交与自动测试不等于真实闭环验收。
18. **[[开发/三项生产故障闭环SDD-2026-07-21]]** — RH 失败终态要求 adapter 与 APP 双端对齐：adapter 不再把 `FAILED + errorCode/errorMessage` 变成 HTTP 500，而是返回 `status=failed` 并透传原因；APP 收到后立即停止轮询并持久化失败。定向回归通过，仍待部署新版 adapter 与 APP 后用真实失败任务验收。
19. **[[开发/绝对纯直连道模式实施记录]]** — 道模式已改为 Desktop / Web 共用的 Direct Engine 单次请求：不注册 OpenCode `dao` Agent，不带工具、项目记忆、Wiki、Skill、MCP、搜索、媒体计划、项目 pill 或产品插件钩子；保留当前模型、可见对话和原始附件。Desktop 道会话不按项目目录筛选，切换只投影用户/助手可见消息，不建立或恢复 `ses_*`，也不显示媒体任务或审批过程。focused、类型检查、Web/Desktop 产物审计通过；真实 Provider 和跨平台人工矩阵待验收。
20. **[[开发/通用记忆对话独立App SDD]]** — 第四阶段 4A 已完成 Mac 上传 → Web 下载真机闭环，Raw/Wiki 文字一致；媒体和空目录不参与同步。首次上传改用 Gateway 既有的最多 100 项批量合同，项目中心与设置页显示扫描、上传、下载进度。v2.0.4 暴露的独立 `sync_session` 启动恢复问题也已修正。

当前状态：手动“继续写”已从文、武、创全部模式移除；创模式仅保留首次最终正文 SSE 断流的自动续写。

显示系统共享代码已实施：[[开发/显示系统统一SDD]] 把主题、字号与 Markdown 排版收敛为变量驱动的单一显示系统。已定位并处理两个真根因——`MemoryWorkbench.vue` 消息容器的 `white-space: pre-wrap` 覆盖 `.markdown-body` 的 `normal`，以及 `markdown.css` 硬编码 px 导致大字/特大字号下 Markdown 层级反转。排版真源收归 `markdown.css`，`MessageBubble.vue` 重复定义整块删除；颜色只用主题变量、字号只用 em、方向只用逻辑属性（为 RTL 零成本预埋）。focused、TypeScript、Web quick build 和 Web 产物审计通过；跨端截图和人工验收仍待完成。多语言明确划为独立“语言系统”，本轮不做。

---

> 上次刷新: 2026-08-01（`v2.1.5` Web Production 与 RH adapter 已部署；海外 Suno 提交和查询闭环已验证，Web 轮询不再等待任务历史持久化。三平台 Actions `30690007566` 已触发，未等待完成。）

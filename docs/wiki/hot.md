# 🔥 热缓存

> 当前开发阶段最需要被 AI 读的十八份文档。

1. **[[开发/文武道模式OpenCode-v1.18.4官方对齐升级SDD]]**、[[开发/OpenCode官方信息流翻译SDD]] — v1.18.4 对齐已实施：sidecar 不再随目录切换重启，Shell 环境按 App 缓存，暖发送只等既有 ready/session/prompt，目录 bootstrap 按 Server generation 缓存，事件桥会持续重连。SDK、更新器、CI 与 ARM64 runtime 固定 `v1.18.4`；variants 来自官方目录并随 prompt/session 恢复。focused、类型检查和 Desktop 前端产物审计通过。仍待人工三平台安装包、真实 Provider 性能和 orphan 进程矩阵；本机 Intel/Windows runtime 下载器挂起，CI 仍从同一 tag 下载。
2. **[[开发/文武道模式OpenCodePrompt上下文对齐SDD]]** — 文、武、道的 `@` 引用现在经当前项目 `ProjectFileService` 搜索和发送前复核，写入 OpenCode `file`/`agent` parts；目录是 `application/x-directory` + `file://`。显式 Skill 在新会话创建时落 permission，既有会话在 prompt 前去重同步，失败保留草稿。OpenCode 会话快照只补全/更新事件流已确认消息，流式代码块也提供复制按钮；busy 状态改为当前用户 turn 的 thinking row，历史首屏 20 条并向上 cursor 分页。专项、完整 focused、类型检查通过，真实 Desktop Provider/续聊人工验收待补。
2. **[[开发/创模式Raw账本与对话Wiki移除SDD]]** — 创模式使用独立会话和模型原生能力优先的直连运行时，项目工具只按需进入工具循环；Desktop 文件适配与媒体任务均不启动 OpenCode。App 不再自动写项目 `.raw` 或打包 `jc-chat-wiki`；对话仍由 UI 会话保存，按模型容量装配最新完整对话，并按需只读 `CLAUDE.md` 与 `wiki/hot.md`。Desktop 合并 `public/skills` 内置 Skill 与 `~/.agents/skills` 本机 Skill，名称相同时内置优先，本机独有 Skill 正常可用；内置资源不复制到用户目录。
3. **[[开发/创模式MCP工具接入SDD]]** — 同一 `mcpStore` 中已启用且已连接的 MCP 工具构成创模式候选工具池，最终请求必须按模型 function calling 能力和任务需要裁剪；当前无条件追加是待修实现缺口。GitHub OAuth 连接、深链回调、Keychain 凭据和网关 token 代换已实现；真实验收前仍需配置 GitHub OAuth App 并发布网关。
4. **[[开发/创模式原生附件直连合同SDD]]** — 现行目标已收缩为“当前模型 + 当前 Provider/K + NewAPI 官方附件合同”。当前模型支持就发原件，不支持就明确结束；不自动换 Gemini，不询问本地工具补位。本轮只修 `video/quicktime` 等官方 MIME、最终请求预算、HTTP/`content_filter` 错误、失败历史污染和旧附件重发；不私改 NewAPI，不定义剧本或其他业务输出。
5. **[[开发/文件系统/Web云端项目Wiki媒体同步与APP升级SDD]]** — Web 项目适配已完成：项目树、画布、上传/导入导出、站内预览和创作媒体均使用当前浏览器 IndexedDB + OPFS；创作任务冻结提交时项目，媒体落 `jc-media`。无 D1/R2/服务器媒体存储或跨浏览器同步。
6. **[[开发/画布开发与排障]]** — 创作面板画布架构、保存恢复、工具、性能与已知问题的唯一入口；2026-07-16 项目文件树改为虚拟行渲染，视频缩略图由桌面后台生成并缓存，定向任务仍以 `owner:path` 队列和 scoped gate 保护 `read -> modify -> write`。
7. **[[开发/全仓测试失败审计-2026-07-13]]** — 测试债务已清理：Node 747/747、Rust 371/371；剩余是文→武、Intel/Ollama/交互人工矩阵。
8. **[[架构/对照表]]** — 韭菜盒子 ↔ OpenCode 文件映射，发现 Bug 的入口。
9. **[[开发/电商工作台SDD]]** — Desktop 商品图与反推试点已完成：同一创模式会话的工作台/协作记录视图，模型只编译媒体计划，CreationPanel 负责提交、轮询、落盘和画布；`workbench.json` 只允许显式声明的反推 Skill 挂载 UI，反推提示词可接用户产品图并提交 GPT Image 2 官方。Web 入口和通用自建表单尚未实现。
10. **[[开发/AI应用适配-交接-2026-07-17]]** — AI 应用白名单全链路：rh-adapter + 创作面板下拉菜单，5 个预置应用（极速数字人/数字人/我是导演/声音克隆/声音设计），运行时动态发现节点，通用 `rh-aiapp` 模型收敛。
11. **[[开发/文件系统/索引]]**、[[开发/文件系统/编辑区与Explorer稳定性修复SDD]] — 文件系统六期最终入口：`ProjectFileService` 是唯一项目文件总管，文件树是可视化入口，编辑区、创作面板和画布消费同一资源合同。编辑区旧草稿覆盖、Explorer 刷新折叠和底部右键菜单裁切已修复并完成自动测试、构建及 Web 真实验收；Desktop 人工验收待补。
12. **[[开发/对话Markdown正文紧凑化SDD]]** — 助手 Markdown 正文不再保留渲染 HTML 的源码换行；长文段落和列表已收紧，代码块、表格、标题及用户输入换行不变。
13. **[[开发/v1.3.0全仓53条失败清零SDD]]** — 发布门禁中的 53 条失败已全部清零：过期源码排版合同对齐当前语义，模型校验改用现存能力，创作面板多行事件表达式补齐语句分隔。focused 1096/1096、TypeScript、Web/Desktop 正式构建及两端产物审计全部通过；Production 部署、桌面签名和跨平台人工矩阵仍待执行。
14. **[[开发/Wiki四Skill产品化升级SDD]]** — 查询默认现行优先并输出结论/证据/风险/下一步；Raw 新增收尾预览与来源指纹；巡检分离现行风险和归档卫生并使用自包含 Markdown 解析器；修正新增精确预览与回执。专项、完整 focused 与 Web 正式构建通过，正式 Desktop 三平台工具环境和普通用户闭环待人工验收。
15. **[[排障/Web创作面板控制台红字排障-2026-07-20]]** — Web 创作面板三类控制台红字的根因与修复：启动脚本 CSP、创作模型接口误走 Pages、画布项目图片路径被当成网站 URL；RunningHub CORS 已在生产 Nginx 验证，前端修复待重新发布后人工验收。
16. **[[开发/韭菜盒子原生媒体编排能力SDD]]** — Desktop 创模式与 Web 直连可用受控素材 ID 编排本轮附件、项目/画布素材和同会话最近成功任务；确认后仍只走 CreationPanel 与 mediaTaskStore。自动验证、Web/Desktop 构建和产物审计通过；真实付费、刷新恢复与 Windows/Intel/Apple Silicon 安装包人工矩阵待验收。
17. **[[排障/ZX-Grok参考图视频真实失败交接-2026-07-21]]** — ZX Grok 选 1 参考图实测仍返回 `Alias.image` 对象类型 400；已停止局部补丁，交接页给出必须先抓代理端真实请求体的排查步骤。相关代码提交与自动测试不等于真实闭环验收。
18. **[[开发/三项生产故障闭环SDD-2026-07-21]]** — Word 转换已完成真实生产闭环：Nginx 路由、`markitdown[docx]` 依赖和 Web 上传均验收成功；画布项目图片路径修复及 RH 可恢复任务语义仍待发布和真实业务验收。

当前状态：手动“继续写”已从文、武、创全部模式移除；创模式仅保留首次最终正文 SSE 断流的自动续写。

---

> 上次刷新: 2026-07-23（OpenCode v1.18.4 文武道共用链路已实施并自动验证；续聊连续性与代码块复制待 Desktop 人工验收。）

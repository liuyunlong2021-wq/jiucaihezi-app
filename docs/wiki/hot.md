# 热缓存

## [2026-09-05] Skill Creator 修改入口与 v2.1.42 发布

- “我的 Skill”修改入口现在传递精确 Skill ID，并展示真实中央目录 `~/.agents/skills/<skill-id>/SKILL.md`；Skill Creator 按 ID 读取，安装卡确认后覆盖原 Skill。
- v2.1.42 已统一写入 `package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json` 和 `Cargo.lock`，提交 `14ce5a15` 已推送 `main`；桌面三平台仍需创建并推送 `v2.1.42` tag 才会触发 CI。

## [2026-09-05] Skill Creator 读取并更新“我的 Skill”

- 已安装 Skill 无法修改的根因不是安装失败，而是 `skill-creator` 缺少中央 Skill 只读入口，错误退回当前项目 Terminal 搜索。
- 新增 `skill_creator_load_installed_skill`：按精确 ID/唯一名称读取真实 `SKILL.md`，缺失、冲突、空文件和只读目标给出明确错误；禁止 Terminal、项目文件、Wiki 和绝对路径查找。
- 更新继续使用现有用户确认卡，同 ID 覆盖原 `SKILL.md`，包内其他文件不删除。focused `1212/1212`、TypeScript 和定向 lint 通过；真实 Desktop 更新与重启复查待人工验收。详见 [[排障/Skill Creator无法读取已安装Skill-2026-09-05]]。

## [2026-09-05] 顶部记忆开关文案精简

- 顶部两个开关仅显示“记忆”和“查询”，状态仍显示“开/关”，悬浮提示同步去掉“对话”；开关字段和行为不变。

## [2026-09-03] 原生长期记忆与连续 Skill 根治合同（待实施）

- 用户已确认四层记忆边界：最近三轮是工作记忆，Raw + 索引是情节记忆，`wiki/` 是语义记忆，Skill 是程序记忆。
- 待实施：所有轮次都装入最近三轮；Skill 在当前任务持续到用户移除或新建对话；每条完成回答在 Raw 落盘后自动建索引；项目级原生 `memory_search` 取代 `jc-jiyi`。
- 不新增“沉淀到 Wiki”按钮，不把现有“保存到文件”错改名为 Wiki 专用动作；不增加向量库、第二份正文或第二套 Agent Loop。详见 [[开发/通用记忆工作台原生长期记忆与连续Skill上下文根治TDD-2026-09-03]]。

## [2026-09-03] 对话切换保持中间文档

- `MemoryWorkbench.openResource()` 已隔离 conversation 与中间资源清理路径；新建/切换对话不会关闭当前文档预览，也不会退出 Markdown 编辑态。显式关闭预览、打开其他资源、切换创作面板或切换项目仍按原合同清理。
- 回归测试已加入 `memoryWorkbench.test.ts`，focused `1177/1177` 通过；`vue-tsc -b`、真实 Desktop/Web/Mobile 人工验收待执行。

## [2026-09-03] 对话记忆索引摘要模型接口约束（已实施）

- 用户确认索引模型必须继续返回 `summary + keywords`；请求改用严格 `response_format.json_schema`，程序二次校验后才拼装 Wiki。
- 不支持 `json_schema` 的模型明确失败且不写索引；不使用 Prompt-only、JSON 大括号截取或 reasoning fallback。详见 [[开发/通用记忆工作台对话记忆索引摘要模型接口约束TDD-2026-09-03]]。
- 摘要请求、严格 Schema、可见 `message.content` 解析和程序边界校验已落地；focused `1176/1176`、`vue-tsc -b`、格式检查和差异检查通过。真实 `jiucaihezi`、Ollama、MLX Provider 与三端人工验收仍待执行。

## [2026-09-02] 三平台发布指令（现行）

- `.github/workflows/build.yml` 只由 `v*` tag 触发桌面发布，目标是 macOS Apple Silicon、macOS Intel、Windows x64；完整成功还要等 GitHub Actions 的三个构建 job 和 `publish-download-manifest`。
- 已有提交和 tag 时只推送指定 ref：`git push origin main`、`git push origin vX.Y.Z`。**禁止** `git push origin main --tags` / `git push --tags`，否则会把本地全部 tag 一起推送，误触发旧版本或因远端已有 tag 被拒绝。
- `v2.1.39`、`main`、`origin/main` 当前均指向 `a58d49cf`；此前额外触发的 `v2.1.37` 属于推送范围错误，不是代码构建根因。完整指令与排错见 [[学习/GitHub推送与发布边界-2026-07-20]]。

## [2026-09-01] 对话记忆索引 V2 正确链路

- 写入只处理用户点击的当前 assistant 输出：一次模型请求生成 `summary + keywords`，程序生成 Raw 正链并按 conversation ID 直接更新固定索引文件；写入时不读 Raw、不扫描目录。
- 查询只读取当前 conversation 的固定索引，以简介和关键词确定命中后，再沿正链读取对应 assistant 输出；时间、顺序和 `userTurnId` 不再作为索引依赖。
- 当前代码仍是 V1，本结论是待 TDD 实施的 V2 合同；不增加向量库、Embedding、后台任务、复杂缓存或多 Skill 编排协议。详见 [[开发/通用记忆工作台对话记忆索引正确链路设计-2026-09-01]]。

## [2026-09-01] 对话记忆索引 V2 TDD

- V2 TDD 已实施：写入按固定路径更新，不调用 `list()` 且不读 Raw；查询无命中不读 Raw，同一 Raw 多命中只读一次；默认只返回 assistant 输出。详见 [[开发/通用记忆工作台对话记忆索引按钮TDD-V2-2026-09-01]]。

## [2026-09-01] 对话记忆索引按钮 TDD

- 记忆索引采用每条已完成 assistant 回答后的手动“写入索引”按钮；一次模型请求只生成 `summary + keywords`，程序补齐 conversation/turn/Raw 元数据并幂等写入 `.raw/记忆索引/<conversation-id>.md`。
- `jc-jiyi` Skill 继续只负责精准查询；本阶段不增加编排协议、后台自动索引、向量库或第二份聊天正文。详见 [[开发/通用记忆工作台对话记忆索引按钮TDD-2026-09-01]]。

## [2026-09-01] Skill 核心插件与普通文件统一执行链

- 产品只有一个 `runDirectChatCompletion` Agent Loop；基础组合为“用户信息 + 模型”，其他能力都是插件。
- Skill 是最核心的插件和强制执行合同；`allowed-tools` 声明的合法文件、MCP、媒体、3D、Terminal 工具自动进入本轮授权集合。
- 项目知识和资料都是普通文件，使用 `read/glob/grep/write/edit/mkdir/move/delete`；不再存在领域专用 Agent、二阶段模型协议、专用 Runtime 或专用工具。
- 已删除旧专用 Agent、计划解析、任务协议和确定性 Runtime 共 6000 余行；项目初始化不再强制创建领域专用目录，回答可保存到任意项目 Markdown 文件。
- focused Node `1160/1160`、TypeScript 和差异检查为本地自动验证；真实模型、三端和发布仍需单独验收。现行合同见 [[开发/通用记忆工作台Skill核心插件与统一插件架构SDD-2026-09-01]]、[[开发/通用记忆工作台单一插件协议与统一执行链路升级优化TDD-2026-09-01]]。

## [2026-08-31] 历史记录：Agent 收尾状态

- 当前开发分支为 `main`，合并提交为 `1c83690e`；WikiAgent 与 Skill-first 收尾已统一进入主线。
- `0829-rhapp-prompt-141` 的 RH 提示词框修复、最近对话恢复、底部操作、三行输入、`@图文`/`@影音`、历史图片缩略图、MLX 启动连接、Tool Search 和 Agent Loop 均已进入主线。
- 已删除 `0829-Agent`、`0829-WikiAgent`、`0829-rhapp-prompt-141`、`codex/0830-skill-first-agent` 临时分支；`codex/0830-openclaw-agent-core` 作为参考工作区保留。
- 合并后 Node focused `1243/1243`、Rust `403 passed / 1 ignored`、`vue-tsc -b` 和 `git diff --check` 通过；真实模型、安装包、跨平台和生产发布仍需单独验收。
- 自动测试通过不等于真实模型、安装包、跨平台和生产发布验收；这些边界继续按各 TDD 记录。

> 更新：2026-08-29 | 阶段：显式能力 Agent 总合同已定稿，按阶段实施

## 旧专用 Agent 执行规则（已于 2026-09-01 废止）

- **结果优先的索引递进流程。** ReadPlan 每轮只选择当前索引授权的最少页面，同层并发读取，按目录层级继续直到资料充分；`paths` 可以为空。入口为空、缺页、读取失败、计划解析失败或达到读取熔断都继续生成用户答案；存在合法 `changePlan` 时执行一次 Wiki apply，不能用资料覆盖率取消任务。`index.md`、链接、来源、日志、回滚和写后验证由程序负责，写入结果通过独立状态卡显示。历史合同见 [[开发/通用记忆工作台WikiAgent索引渐进读取与确定性事务规范-2026-08-29]]。

## 2026-08-31 历史结论（已被 2026-09-01 合同替代）

- **`@Wiki` 的索引递进读取与一次确定性提交已完成阶段 3 实现。** 模型沿 `wiki/index.md -> 子 index.md -> 事实页` 逐层选择，程序只读取被入口或用户精确路径授权的页面；空 Wiki、缺页和解析失败仍保留模型结果。需要写入时，模型只给正文操作，程序一次事务维护受影响入口、链接、来源、现有日志、回滚和验证；读取覆盖率不再成为写入门禁。固定两次/三次请求不再定义成功，12 次读取规划只作异常熔断。真实模型与 Desktop/Web/Mobile 仍待验收。见 [[开发/通用记忆工作台WikiAgent索引渐进读取与确定性事务规范-2026-08-29]]。

- **产品采用显式能力与 Skill-first 组合。** Skill 是方法树，Wiki 是事实树；`@Wiki + 具体 Skill` 沿 Wiki 索引渐进取得事实，再按 Skill 规则生成结果。模型请求次数由取得任务所需事实决定，不用固定次数定义成功；MCP、文件、Terminal、媒体和 3D 只在用户显式选择后接入。`wiki-creator` 只负责首次建库、整体重构或迁移，不恢复五个 Wiki Skill，不管理 Raw，不建工作流 DSL。见 [[开发/通用记忆工作台显式能力Agent与统一任务协议TDD-2026-08-28]]、[[开发/通用记忆工作台WikiAgent索引渐进读取与确定性事务规范-2026-08-29]]。

- **显式能力 Agent 与统一任务协议已完成阶段 1、阶段 2 协议核心和阶段 3 Wiki 适配。** 无 `@` 只发送当前消息；共享 `TaskEnvelope` 已提供能力白名单、schema 校验、依赖排序和真实回执字段，并已用于 Wiki 递进读取与一次提交校验；Skill 预加载不再开放通用加载器，MCP 只暴露用户选中的具体工具，取消/失败不会伪报成功。通用 File、Terminal、MCP、Media/3D Agent 和多 Agent 调度仍按 TDD 阶段 4-8 待实施。不恢复 64 轮循环、全局自主规划或隐式扩权。见 [[开发/通用记忆工作台显式能力Agent与统一任务协议TDD-2026-08-28]]。

- **原生 Wiki 能力与五 Wiki Skill 退役已实施。** 查询、规划、填充、巡检、修正复用现有 `wikiRuntime`，不再加载五个 Wiki Skill；新记忆空间有短 `wiki/index.md` 入口，百万字创作通过入口、搜索和链接按需取回相关事实，不新增 RAG、向量库、摘要 Store 或“创作资料包”。五个 Skill 已从 App catalog 和发行树移除，用户安装副本与 legacy 备份保留。见 [[开发/通用记忆工作台原生Wiki能力与五Skill退役TDD-2026-08-26]]。

- **旧轻上下文 Runtime 已停止继续扩展。** 已实现的请求上限、取消、路径保护、工具度量和并发执行作为可复用零件保留；关键词路由、模式分支、滚动对话记忆和通用 Agent 编排由 Skill-first TDD 逐项取代。见 [[开发/通用记忆工作台轻上下文任务运行时TDD-2026-08-26]]、[[开发/通用记忆工作台非Agent固定任务流重构TDD-2026-08-27]]。

- **附件“添加到规范范围”路由误判已修复。** 旧路由只识别“写入/更新/修改”等词，未把已附加文档的“添加/加入/合并/补充/沉淀”识别为写入意图，导致模型请求为 `工具 0 轮`。现在附件存在且出现这些写入动词时开放 `read/glob/grep/write/edit/mkdir`，单纯查看附件不开放写工具。路由回归测试已通过。

- **Wiki 任务执行提速已实施，真实模型性能验收未完成。** 已实现一次 `1-3` 词 Wiki 扫描、项目内连续只读工具并行、写入/Terminal/MCP/项目外操作串行屏障、顺序回填、取消收口、真实 HTTP 请求计数和工具耗时显示；Cha Skill 同步改为一次提交初始短词与同轮读取。完整 Node focused `1129/1129`、Rust `402 passed / 1 ignored`、Cha Skill `7/7`、TypeScript、定向 lint 与差异检查通过。本地三词检索读取从 `363` 次降到 `121` 次，中位 `48.66 ms -> 24.27 ms`，约 `2.0x`；这不是模型端到端成绩。当前正式 App 仍为旧版 `2.1.33`，新构建上的三次 `gpt-5.6-sol` / `jiucaihezi` 前向仍待执行。见 [[开发/通用记忆工作台Wiki任务执行提速TDD-2026-08-26]]。

- **工作台右侧对话 Dock 布局已实施并完成 Desktop 多尺寸实测。** 打开文档或创作面板后，中间主区与右侧对话可同时操作；Dock 默认约 `360px`，可拖至完整态下限或吸附为窄栏，临界宽度提前切换图标。创作与资源预览互斥并复用同一次画布关闭 Promise；设置仍是悬浮抽屉。文档大纲折叠后不再保留空列，正文恢复单列全宽。对话下拉菜单未修改。定向测试 `56/56`、TypeScript、`build:quick`、Web 产物审计和差异检查通过；移动端与真实触控拖拽仍待人工验收。见 [[开发/通用记忆工作台右侧对话Dock布局TDD-2026-08-23]]。

- **Desktop 文档转换已切换为内置 AnyDoc `0.2.3` 并通过用户验收。** 用户已在 macOS ARM 安装包实际验证 DOCX、XLSX、PPTX 成功；图片型 104 页 PDF 被正确识别为无文字层并提示需要 OCR，原件保留。Desktop 本地 AnyDoc 路径不调用 MarkItDown，也不要求本机 Python 或 LibreOffice；仅 `internal`/不可用错误可回退现有云端 MarkItDown，Web/Mobile 也仍使用该云端服务。云端 AnyDoc staging 和生产切换按用户决定暂缓。见 [[开发/通用记忆工作台AnyDoc内置格式转换升级TDD-2026-08-22]]。

- **迅虎支付 404 已完成生产修复与真实验收。** `jiucai-adapter` 和支付预览服务均未重启；故障在 Nginx 2026-08-20 06:09 重启后暴露：旧 `/xunhu/` 的 `rewrite +` 无尾斜杠 `proxy_pass` 没有可靠剥离前缀，容器收到不存在的 `/xunhu/submit.php`。现改为带尾斜杠的 `proxy_pass http://127.0.0.1:8081/;` 并 reload，公网探测返回 `200`，用户确认真实支付恢复。Nginx 备份不得留在 `sites-enabled`。见 [[运维/服务器运维#迅虎支付 `/xunhu/submit.php` 在 Nginx 重启后 404（2026-08-20）]]。

- **Codex 创作 MCP 核心链路已实施。** 采用“Codex stdio MCP -> Desktop 本机鉴权桥接 -> 现有 Creation Runtime / `mediaTaskStore`”的单一链路；不复制 `jc_media.py`、静态模型表、API Key、轮询器或历史数据库。支持自然语言指定模型、比例、分辨率、参考图和输出目录；参考图可传本机绝对路径、data URL 或 HTTPS URL，数量和大小继续由韭菜盒子模型表校验。Codex 任务进入创作面板同一历史，并复用项目落盘与显式画布动作。MCP/TypeScript/完整 focused `1104/1104` 已通过；正式安装包、跨平台人工验收和视频/音频内嵌播放仍待验证。见 [[开发/韭菜盒子Codex创作MCP服务TDD-2026-08-20]]。

- **`v2.1.30` 收口多对话主线写入规则与创作画布热修。** 同一仓库同一时间只允许一个写入负责人；新对话必须从最新已提交的 `main` 开始并先核对目录、分支、最新提交和未提交改动。画布已修正标注 inner 坐标、超大 Base64 污染恢复和媒体落点；无法稳定命中的画布视频播放入口按用户决定删除，视频仍保留静态首帧、选择、拖动和提交引用。Grok 下载已由用户确认正常；Veo 上游稳定性、iPhone 下载覆盖本地和正式跨端安装包验收仍未完成。见 [[开发/v2.1.30整合与创作画布热修TDD-2026-08-19]]、[[学习/AI编程生存手册#35 同一仓库不能由多个对话同时写主线]]。

- **ZX 视频路由已按生产配置更正。** Veo 3.1/Fast 与 Grok 6s/10s/15s 的 NewAPI 渠道均直连 ZX；用户截图确认 Grok 渠道 Base URL 为 `https://img-api.zxcode.vip`。只有 `omni-fast`、`omni-v2v` 和 ZX Seedance 2.5 进入独立 `zx-video-adapter`。仓库保留 Grok 适配代码仅作历史实现与备用能力，不代表生产正在使用。Omni 创建时按任务保存 ZX 渠道 Key，下载 `/content` 时使用该 Key流式请求官方 MP4；适配器 `12/12`、focused `1088/1088`、TypeScript 和差异检查通过。用户已确认 Veo 直连成功、Grok 6 秒直连生成落盘和 Omni Fast 生成完成；提交 `260803e3` 的 Omni 下载 Key修复尚待生产复验。RH 三个 Gemini Omni 与 RH Grok 均不进入 ZX 适配器。见 [[开发/ZX视频适配器多模型升级TDD-2026-08-18]]。

- **RunningHub Grok Video 低价渠道新合同已本地完成。** 文生和图生均为 `6-15秒`、UI `0.25元/秒`；图生支持 `1-7` 张参考图且单图 `10 MB`。前端和 RH adapter 共享边界都会阻止第 8 张图与 16 秒请求，endpoint、上传和轮询未变。focused `1081/1081`、RH 聚焦 `40/40`、TypeScript 通过；部署、真实渠道和账单验收待执行。见 [[开发/RunningHub Grok Video低价渠道合同变更TDD-2026-08-17]]。

- **3D 白模编辑器空白与高度为 0 已完成真实开发窗口验收。** Debug App 先修正为加载 Vite；最终根因是人物骨骼四元数仍保留 Vue Proxy，初始化撤销历史的 `structuredClone()` 抛出 `DataCloneError` 并中止 `setup()`。共享解析器现在返回新数组，用户已确认恢复；Scene3D `13/13`、工作台 `55/55`、TypeScript、Rust 和差异检查通过。见 [[排障/3D编辑器空白与高度为零-2026-08-17]]。

- **创作画布 Base64 泄漏与大文件问题已经用户实际验收。** 标注图片组内的运行时 URL 现在不会写入 `.jccanvas`；修复后画布保持 `14,858` 字节、无 Base64，用户已确认可以正常打开。该修复保证文件不随媒体字节膨胀；几百张图片的视口渲染性能仍需另行实测。见 [[开发/创作画布Base64泄漏与大文件恢复TDD-2026-08-17]]。

- **创作画布当前合同已收口。** 媒体永久单行从左到右；生成结果只有任务历史显式“放到画布”才进入；每张图片是独立 Group，标注随图烘焙后分别上传，不拼整张画布；画布写入按 `owner:path` 串行化，任务目标冻结 `owner/canvasId/canvasPath`。见 [[开发/画布开发与排障]]。

- **画布工具“全部无效”曾是旧 `dist`，不是选图逻辑。** 后台测试 APP 外壳没有连接 Vite，加载的是旧前端静态产物；看版本、查旧文案、确认 `1420` 监听并重建 bundle 是固定排障顺序。当前源码测试通过，最新 bundle 人工验收仍需单独登记。见 [[开发/画布开发与排障#10-工具全部无效：后台测试 APP 载入旧前端产物]]。

- **中文输入法候选回车不会再误发送。** 对话输入框在所有 `@` 候选和发送键盘分支之前，统一跳过 `isComposing` 与 `keyCode === 229` 事件；普通回车发送和 `Shift+Enter` 换行不变。记忆工作台定向 `55/55`、TypeScript 和差异检查通过，真实 WebView/三端人工验收待执行。见 [[开发/输入法组合态回车误发送修复TDD]]。

- **媒体任务取消边界与重新生成已收口。** 同一个 Store 统一处理创作历史与对话气泡：执行器未启动才显示“已取消（未提交）”；已提交但尚未获得任务 ID 显示“已停止等待（上游可能已接收）”；已有上游任务 ID 显示“已停止跟踪（上游可能继续生成）”。结果已被 APP 接收并进入项目保存后，取消入口立即消失，保存完成才进入 `success`，不再出现“仍可取消但结果正在落盘”的矛盾。成功、失败、已取消且有计划快照的创作任务均可“重新生成”，只回填参数、不自动提交。定向合同 `94/94`、完整 focused、Rust `396 passed / 1 ignored`、TypeScript 与差异检查通过；Web/Desktop/KIK 真实取消矩阵待验收。见 [[开发/创作任务统一取消TDD-2026-08-16]]。

- **`v2.1.23` 画布单图标注参考图上传已本地实现。** 旧标注是独立画布节点，提交只取原图，故不会上传；现在每张图片承载自身箭头、笔迹、编号和文字，提交时无标注直传原图，有标注只按原图尺寸导出该图 PNG。多选三张时上传三张各自带标注或原始图片，不拼整张画布。TypeScript、画布合同与 Runtime/Plan 定向测试通过；真实上游三张不同标注图的人工验收尚未执行，不能保证视觉模型必然理解微小标记。见 [[排障/小易GPT图片多参考图与账号池失败-2026-08-14]]。

- **小易适配器 Gemini 图片生成与参考图主链已生产验收，尺寸合同已本地纠正。** NewAPI 图片任务只可靠保留标准 `size`，不会保留非标准 `aspectRatio + resolution`；App 现将 10 种比例与 1K/2K/4K 统一换算为满足上游限制的 `size`，例如 `16:9 + 2K -> 2048x1152`。完整 30 组合约束测试已覆盖精确比例、16 像素倍数、最大边和总像素；本次尺寸修复尚待发布后复验。见 [[运维/小易图片异步适配与部署-2026-08-14]]。
- **MiniMax H3 的 NewAPI `seconds` 类型根因已本地修复。** 三个小易 MiniMax H3 模型现在只发送字符串 `seconds`，不再重复发送数字 `duration`；适配器 `/v1/models` 要求 Bearer Token，并按该 Token 的小易上游可见模型过滤公开别名。模型合同状态保持 `partial`。适配器 `12/12`、Runtime `29/29`、完整 focused、Rust `402 passed / 1 ignored`、TypeScript 和差异检查通过；尚未部署，也未执行真实付费生成、MP4 落盘或扣费验收。见 [[开发/MiniMaxH3视频seconds类型修复TDD-2026-08-24]]、[[运维/小易图片异步适配与部署-2026-08-14]]。

- **`v2.1.22` 小易图片适配器主链与官方渠道已生产验收，上游账号池仍有间歇波动。** 渠道 88 的 1K、此前等待中的三参考图，以及 `gpt-image-2-官方 -> gpt-image-2` 均已在 App 真实生成并落盘；官方价格为 `0.25/张`。适配器健康响应已列出该模型，`creation-models` 已重启为 active。官方渠道首次的 `model_price_error` 来自 NewAPI 未配置价格，配置后成功；`No available 1K/2K image accounts` 与 `fetch failed` 仍应判定为小易其它上游渠道的间歇不稳定。见 [[运维/小易图片异步适配与部署-2026-08-14]]、[[排障/小易GPT图片多参考图与账号池失败-2026-08-14]]。

- **创作面板异步保存方法缺失已根治。** `CreationPanel` 尚未完成 `defineExpose` 时，外层曾对临时组件代理强制调用 `flushCanvasSave()`，抛出 `is not a function` 并中断面板生命周期。组件 ref 类型和调用现均允许方法暂时缺席，回归测试禁止不安全调用重新进入；Web 连续开关 10 次、类型检查和 Desktop 构建审计通过，真实 Desktop 安装包点击待发布后验收。见 [[排障/创作面板异步保存方法缺失-2026-08-13]]。

- **创作画布图片、视频预览空白已修复。** Desktop `asset://` 地址不能稳定供 Leafer 图片和视频首帧读取，音频因仍走 `data:` 路径而正常；共享 `getMediaRuntimeUrl()` 已恢复 `dev_read_file -> data:`，用户确认图片预览恢复。见 [[排障/创作画布本地图片视频预览空白-2026-08-13]]。

- **3D 编辑器导出诊断与取消选中已补齐。** FFmpeg 可检测，截图/视频保存显示路径或失败原因，视频目标目录为 `.raw/jc-media/视频/`；空白左键、Esc 和捕获开始前都会取消选择，移动箭头不会进入成片。见 [[排障/3D编辑器导出与选中控件-2026-08-13]]。

- **本机 ComfyUI 的 Z-Image Turbo 图片和 Grok 视频工作流已完成 Desktop 真实生成验收。** Grok 已确认提示词节点 `16`、7 个参考图槽位 `22/10/13/9/11/12/23`、生成节点 `7` 与结果节点 `18`；本机请求必须走 Rust HTTP 桥、上传文件名必须唯一，结果不得经过当前版本不兼容的 `SaveVideo crf` 参数。开发 Runtime 修改后须完整重启，避免旧执行器制造“已保存 Key 仍未配置”的假象。首次空白创作面板已改为等待异步模块再打开，自动验证通过、Desktop 点击复验待执行。MiniMax H3 与未登记工作流仍未接入，见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#Grok 视频工作流首轮真机验收（2026-08-15）]]。

- **首个韭菜盒子 ComfyUI 自定义图片节点已由用户实际生成验收。** 插件独立安装在本机 ComfyUI；一个节点覆盖 5 个 GPT Image 2 档和 2 个 Gemini 图片模型，参数仅来自当前创作模型注册表。Key 必须在节点填写；结果只留在 ComfyUI，`Save Image` 才写本机 output，主 App 不读写此链路。后续同类节点必须先查注册表/Wiki、用模型选择器联动真实参数、再经 schema、自动测试和用户实际生成验收。见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13#韭菜盒子 ComfyUI 自定义节点首轮验收（2026-08-14）]]。

- **RH GPT2.0 的 `global:` 任务回收已修复；旧 GPT Image 2 VIP 渠道与两项 Grok 图片模型已下线。** `4e33901f` 使 URL 安全校验接受编码后的 `/rh/tasks/global%3A...`，但不放宽其它路径或查询；GPT2.0 文生图与图生图仍待真实付费回收复验。2026-08-13 下线的是当时已失效的旧 VIP 路由；2026-08-14 已通过小易适配器重新注册同名 `gpt-image-2-vip`，但其 2K 账号池当前不可用。`Grok Image 4.2 文生图/图生图` 仍保持移除，Grok 图生视频保留。`gpt-image-2` 直接请求 `b64_json`，避免临时 URL 在项目落盘前失效；旧失效 URL 不可恢复。见 [[排障/云端GPT图片与RunningHub任务回收-2026-08-13]]、[[排障/小易GPT图片多参考图与账号池失败-2026-08-14]]。

- **KIK 视频计费已确认。** NewAPI 成功任务记录 `is_task=true`、`prompt_tokens=0`、`completion_tokens=0`，仍按 `/v1/videos` 任务分支使用输入价格计费；补全价格当前不参与。最终按官方基础价配置，收益由 NewAPI 用户组/会员倍率叠加；错误 404 请求 `quota=0` 不扣费。

- **iPhone `下载并覆盖本地` 当前未解决。** `2.1.17` 开发签名版在真实 iPhone 13 Pro Max 点击云端项目并确认后无可见结果，操作前后四个本地项目的 `.raw/.sync/state.json` 修改时间全部未变化。自动测试、IPA 构建、安装和启动已通过，但不能证明真实下载执行；继续排障已暂停，见 [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]。

- **thinking 模型工具续请求已修复 `reasoning_content` 丢失。** Git `d98b72bf` 在共享 direct runtime 内仅临时保留并回传上游 `reasoning_content`，不显示、不写入 Raw Markdown；普通工具循环和流中断续传均覆盖。direct runtime `39/39`、TypeScript 与差异检查通过；截图对应真实 NewAPI 模型的多轮工具调用仍待验收，见 [[排障/thinking模型工具调用reasoning_content中断-2026-08-11]]。

- **新建记忆空间采用 Obsidian 兼容的最小 Wiki 骨架。** generic 只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`，不创建 README、CLAUDE、`方向.md`、业务目录或任何替代性的强制读取页；记忆请求也不自动注入 Wiki 页面。
- **五类 Wiki 操作已内化。** 查询、规划、填充、巡检、修正统一复用原生 `wikiRuntime` 的入口、证据、预览、审批和写后复查；五个旧 Wiki Skill 不再随 App 分发。关系图仍只在显式请求时生成局部 `.canvas`，不建设 RAG 或 Bases。
- **Raw、Cha、Jian 已共用一份证据合同。** 重要结论按“Wiki 章节 -> 来源角色 -> 原始来源 -> 已处理范围 -> 写入时 SHA-256 -> 记录时间”登记；Cha 回答时展示已登记来路，Jian 只读检查来源一致、变化、丢失、无法验证或登记不完整。来源变化只代表待复查，不自动判错或改写 Wiki。

- **唯一产品边界：保留记忆工作台现在拥有的全部功能；记忆工作台现在没有的功能全部迁出。** OpenCode、旧 Studio、文/武/道/创、电商、漫剧、制作工作台均属迁出范围。共享代码只要仍被记忆工作台直接或间接依赖，就必须保留，不能按目录名删除。唯一实施合同见 [[开发/通用记忆工作台单产品化分离SDD]]。
- 记忆工作台继续保留项目中心与文件树、Raw 对话、统一工作台模式、完整 Wiki 能力、项目内工具、附件与文档转换、Markdown 阅读编辑、`.canvas` / `.jccanvas` / `.jcscene`、媒体生成、登录/模型/Skill/MCP，以及当前 Desktop、Web、Mobile 各自已经具备的能力。
- **模型请求中断恢复已实施。** `502/503/504/524`、浏览器网络错误和 Tauri/reqwest `error sending request` 只重试当前模型请求两次，退避 `2 秒、4 秒`；耗尽后仅对明确的请求或流中断写一组 Raw 恢复点。Raw 追加按 `userTurn.id` 幂等，旧 generation 不再覆盖新项目状态，发送期间锁定输入与附件。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和差异检查通过；真实 NewAPI/Cloudflare 三端故障注入尚未验收。
- **模型上下文与长文预算已收口（2026-08-15）。** 云端模型统一兜底 `1M` 输入 / `128K` 输出，Gateway 精确字段优先；本地 Ollama/MLX 保持 `32K/4K`。历史按真实 token 估算保留最新完整轮次，删除每条消息固定 `16,000` 字符截断；请求动态计算可用输出，`length` 最多续写 3 次。上下文淘汰只提醒用户 Raw 仍完整可查，不自动摘要或写 Wiki。Codex 式 5 次请求重试、5 次流重连、客户端 `429` 重试和固定 300 秒总超时均不采用；当前两次请求重试、一次断流续传和三次长度续写已足够且避免请求放大。聚焦 `1047/1047`、TypeScript 和差异检查通过；真实上游故障注入及跨端人工长文验收未执行。
- **本机 MLX 采用“外部服务、App 只连接”的最小合同（2026-08-23）。** Desktop 设置只显示服务地址（默认 `http://127.0.0.1:8081`）、连接按钮、状态和自动识别的模型数量；用户自行下载模型、配置并启动 MLX 服务，韭菜盒子不读取模型目录、不下载文件、不管理进程。连接只接受 localhost/127.0.0.1/::1，通过 `/v1/models` 保存 `local-mlx` 模型并复用统一工作台的 OpenAI/SSE/工具链。见 [[开发/通用记忆工作台本机MLX兼容服务接入TDD-2026-08-21#10. 最终界面合同与首次使用流程（2026-08-23）]]。
- **统一工作台工具权限不受对话文字关闭。** 工具栏与显式能力选择是工具池唯一来源；历史或当前文字中的“不要调用工具”不移除候选工具。流式正文中断后的续写继续携带原工具池，续写产生的工具调用进入原审批和执行循环。提交 `055d8e8c`，完整 focused `1021/1021`、TypeScript 与差异检查通过；真实上游中断待人工验收。
- **媒体与 3D 迁出决定已撤销且从未实施。** 图片、视频、音频、创作画布、3D 白膜、GLB/GLTF 查看和 Desktop 动画导出继续随韭菜盒子保留；短视频工厂未被本计划修改。老电脑适配只优化空闲刷新与按需加载，不降低最终质量、不删除高性能设备能力，见 [[开发/韭菜盒子媒体与3D能力迁出SDD]]。
- **Seed Audio 1.0 已完成生产与创作面板验收。** 提交 `d1773603` 的独立适配器已部署；NewAPI 渠道 66 的文本、参考音频和创作面板画布音频均已真实返回有效 MP3。创作面板显示 `豆包音频生成1.0 · 1.2元/分钟`，最多支持 3 段参考音频；NewAPI 按 Token 计费配置为普通输入/补全/音频输入 `1`、音频输出 `1000`（美元/1M Token），前端 UI 不变。
- **媒体任务启动竞态已按 TDD 修复。** `initDB()` 并发调用现在共用同一个 Promise，`mediaTaskStore.init()` 等待 SQLite 真正完成后才读取和恢复历史；不再在首次挂载抛出 `SQLite storage is not ready`，也不增加定时重试或第二套任务状态。
- **项目文件树以流畅性优先。** 不再为图片、视频或音频生成缩略图、读取媒体或保留 Blob URL；统一显示类型图标并保留点击预览。后续生成媒体以“任务摘要、清理后提示词、模型名、任务 ID”顺序命名，旧文件不改名。
- **App 只随包提供 2 个产品 Skill：** `jc-new-user-guide` 和 `skill-creator`。20 个个人写作、视觉、旁白 Skill 已迁入 `/Users/by3/Documents/jiucaihezi-personal-skills`，用户自行安装的 Skill 不受影响。
- **Jina 网页工具已迁出产品。** App 不再提供 `@联网搜索`、`web_search` 或 `read_url`，也不再携带 `jina-adapter`；原实现完整备份于 `/Users/by3/Documents/jiucaihezi-jina-backup`。Desktop 仍可在用户批准后通过 Terminal 使用本机网络；Web 与 Mobile 不提供替代网页工具。生产服务器上的旧容器和 NewAPI 渠道尚未核验或下线，但新 App 已无调用入口。
- **Desktop 增加官方 Playwright MCP。** 设置里的内置卡片使用固定版本 `@playwright/mcp@0.0.79`，复用现有 stdio MCP 和统一工具桥接；App 不打包 Node、Playwright 或 Chromium。缺少 Node 时提供官方下载和重新连接，Windows 额外识别并正确启动 `npx.cmd`。该扩展拥有浏览、页面操作、上传下载和脚本执行等高权限，只有用户主动连接后才启用；Web 与 Mobile 不支持本地 stdio。
- **Tauri 自定义命令权限已闭环。** 开发地址使用 `http://localhost:1420/*`，`allow-app-commands` 与 Rust `generate_handler!` 全量一致；Playwright MCP 与现有文件、Skill、密钥等命令不会再因局部 ACL 出现“点击无反应”。
- **Playwright MCP 已完成本机点击验收。** 上一轮“下载 Node.js”是把 `Plugin not found` 误判为缺少 `npx`，且开发 URL 与自定义命令 ACL 同时阻断；当前开发版已连接成功。新版本发布后，外部 Desktop 用户仍需本机 Node/npx 和可访问 npm 的网络，干净 Windows/macOS 安装链待真机验收。
- **short-video-factory 本地 MCP 已在 Desktop 开发版连通。** Git `10553f10` 使 stdio 会话以 Node 启动 tsx、分离 stdout/stderr、记录完整超时诊断，并在失败后销毁旧会话和工具缓存。服务端真实返回 8 个工具；`open_project` 已成功打开 `0807功夫女友` 并返回 `episode-001`。`refresh_production_materials` 与断 pipe 重连仍待真实验收。
- **Playwright 的打包版 PATH 根因已二次修复，待 `v2.1.18` 发布验收。** 用户在 `v2.1.17` 仍复现 `env: node: No such file or directory`：绝对 Node 只能启动 `npx-cli.js`，其后继脚本仍依赖 PATH。共享 stdio 启动入口现将解析后的可执行文件目录加入子进程 PATH；MCP 专项 `5/5`、TypeScript、Rust 编译和空 PATH 等价验证通过，正式包点击“启用”尚未验收。
- **文字云合同只有两个手动动作：** `上传并覆盖云端`以本地完整可同步文字快照覆盖云端，`下载并覆盖本地`以云端完整可同步文字快照覆盖本地。两者都不合并、不创建冲突副本、不自动双向同步；媒体、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不比较、不传输、不删除。设置页只显示状态，操作只在项目中心。
- 发布身份不得因分离改变：Desktop `com.jiucaihezi.desktop`、iOS `com.jiucaihezi.mobile`、`jiucaihezi://`、正式 Web <https://jiucaihezi.studio>、应用数据目录、账号及云项目绑定全部保持连续；Android 当前无稳定独立身份，继续暂停。旧 OTA 使用 RSA 签名，与 Tauri 2 minisign 合同不兼容，下一版暂时关闭自动更新，继续通过 GitHub Release/官网下载安装包；生成新 signer 密钥并完成三平台旧版升级验收后再恢复 OTA。
- **附件拖放恢复与重复导入去重已实施。** `App.vue` 提供唯一 Desktop 原生拖放分发，明确命中对话区、画布和文件树各自接收；未命中具体区域时仅对话区可见可接收才回退到对话，创作画布必须明确命中。Web 只处理 `DataTransfer.files`，Mobile 选择器不变。共享导入边界按同项目、同分类、同规范化文件名和 SHA-256 复用已有资源，同名不同内容保留 keep-both；Office/PDF 复用或补齐 Markdown 副本。自动验收已通过，用户已确认当前真实产品中的对话框与创作画布拖拽上传正常；其余跨端、异常和去重人工矩阵待执行。见 [[开发/文件系统/通用记忆工作台统一拖拽路由与附件导入去重TDD]]。
- **附件图标与 Windows 启动修复（2026-08-07）：** 离线 Material Symbols 扫描器已支持连字符，输入框 `attach-file` 图标已重新打入 `icons-bundle.json`。Windows 发布同时提供 NSIS 安装器和便携 ZIP；普通用户优先运行安装器，由 `downloadBootstrapper` 引导安装 Microsoft Edge WebView2 Runtime。已具备 WebView2 的 Windows 用户已完成双击启动验收；缺少运行时的干净设备安装引导仍待人工验收。
- **Windows“闪退”真机根因已闭环。** 绝对 EXE 路径启动与清理 App 数据后普通启动均成功，证明程序和 WebView2 链路可用；失败来自 Windows 保存的零尺寸、`-32000` 坐标窗口状态，使运行中的窗口不可见。现在读写入口都拒绝无效状态，同时保留合法多显示器负坐标。
- **3D 手动运镜录制（2026-08-07）：** Desktop 3D 编辑器已增加开始/停止录制按钮。用户可以直接旋转、平移、推进和拉远视角；停止后复用现有 FFmpeg 链路保存 MP4。录制不生成关键帧，不改变现有 `.jcscene` 时间线能力；真实 Desktop 手动录制验收待执行。
- **3D 文件与对话编辑（2026-08-07）：** `.jcscene` 是 `.raw/jc-media/文档/` 中的可编辑源文件，截图进`图片`，自动动画和手动运镜进`视频`。打开场景后可在编辑器下方直接说“加、移、删、改镜头”，普通请求调用 `edit_3d_scene` 原子写回并刷新；只有明确“重做/重新生成”才使用 `create_3d_scene` 完整覆盖。本阶段只保留白模基础，不建设写实资产库。
- **下一版发布门禁（2026-08-07）：** Windows Release 上传步骤已在本步骤重新声明并校验 NSIS/ZIP 路径；失效 OTA 与 `latest.json` 发布任务已停用，避免发布无效签名。3D 默认只显示人物及人物编队标签，非人物对象不显示文字；场景指令发送后恢复主输入草稿。
- **`v2.1.11` Desktop 启动失败已定位并修复（2026-08-07）：** 关闭 OTA 配置后 Rust 仍注册 updater 插件，插件读取空配置时在 Tauri Builder 阶段 panic，导致 macOS 冒烟失败且 Windows EXE 双击秒退；这次故障与 WebView2 无关。updater 注册、依赖和未使用前端 composable 已全部移除；Windows CI 新增构建后 EXE 存活 15 秒门禁。本机 aarch64 macOS 生产 release 已构建并真实启动存活 15 秒，修复包需使用新版本号发布，不能覆盖 `v2.1.11` tag。
- **`v2.1.13` 发布链路修复（2026-08-07）：** 下载页读取 `/updates/latest.json`，不读取 GitHub Latest Release；桌面发布工作流已将 GitHub Release 预创建、三平台资产上传、官网下载清单三者解耦。OTA 签名仍停用，但官网下载清单不再依赖 OTA。v2.1.13 正常 tag 发布将完整验证“创建 Release → 三平台成功 → 自动发布官网下载清单”。

## 已验证 / 未验证

- **RH AI App 新增流程已完成真实验收（2026-08-29）。** 6 个 Minimax-h3 `webappId` 已加入 `rh-aiapp` 通用目录；服务器必须从 `/opt/jiucai-repo` 复制 `rh-adapter` 后执行 `docker compose up -d --force-recreate --build`，并将 ID 加入 `RH_AI_APP_WHITELIST`。公网 `app-directory` 已返回 11 项，创作面板已显示 6 个新应用。详见 [[运维/模型注册]]。

- **RH Seedance 2.5 双模型已完成本地接入。** NewAPI 模型名为 `rh-seedance25-no-video-ref`（输入 `$80/1M`）和 `rh-seedance25-with-video-ref`（输入 `$50/1M`）；两者固定 `native1080p`，有参考视频形态要求 `1-10` 个视频。Seedance 2.0、Fast、Mini 三套共 9 个旧 RH 模型已退出可选目录。RH `41/41`、focused `1087/1087`、TypeScript 和差异检查通过；服务器部署、生产并发与真实账单待验收。见 [[开发/RH Seedance 2.5双模型接入与旧模型退役TDD-2026-08-18]]。

- `v2.1.9` 已发布：`main` 与 tag 指向 `f302c251`；Web Production 正式域名返回 HTTP 200；GitHub Actions `30904082094` 的 macOS ARM、macOS Intel、Windows x64 和发布清单均成功；生产 `latest.json` 返回 `2.1.9`。
- 方向性文字覆盖曾通过 focused `1438/1446`、TypeScript、Web quick build 和产物审计；2026-08-10 真实 iPhone `2.1.17` 下载覆盖回归失败，当前 Mobile 下载链路不得登记为通过。Web/Desktop 覆盖删除矩阵仍待人工验收。
- Wiki 状态查询已按 append-only 合同改为从 `log.md` 末尾读取最新标题；应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 与 TypeScript 通过，当前状态正确显示 2026-08-04 的最新决策。
- iOS 仍是已提交审核的 `2.1.7 (2.1.7.1)`，Android 无公开版；桌面三平台发布不等于 App Store 或 Google Play 上架。
- 单产品化分离已按四组 TDD 实施：模型目录改用 Gateway，创作面板解除 OpenCode owner/session，搜索改用 Raw 对话，Rust 移除 OpenCode Runtime/命令；旧 Studio、OpenCode、四模式、电商、制作、漫剧工作台产品代码与发布物已从主仓迁出。
- 独立备份仓库 `../jiucaihezi-legacy-products/` 保留 `v2.1.9` / `f302c251` 完整历史，工作树干净且 `git fsck --full` 通过。主仓保留 Raw、Wiki、媒体、同步、身份、Gateway、云绑定、更新与发布路径。
- 自动验证通过：分离门禁 `11/11`、Rust `395 passed / 1 ignored`、Wiki Skill `38/38`、证据链相关原生/Web/Desktop/审批 `57/57`、完整 focused `986/986`、TypeScript 和两端产物审计；最终产物只有 7 个产品 Skill。五类独立模型前向检查尚未执行；真实 Windows、Intel Mac、iOS 升级与云绑定连续性待人工验收；Android 继续暂停。
- 媒体任务竞态红灯先确认旧实现缺少存储等待合同；绿色结果为媒体任务专项 `46/46`、完整 focused、TypeScript、Desktop quick build 与产物审计。两次干净 Desktop 启动中 SQLite 约 5.1 秒和 4.9 秒完成，均无 mounted-hook 未处理异常；中断的 Grok Video 任务自动恢复并最终 `success 100%`。Veo 3.1 与 Fast 的真实 `404 fail_to_fetch_task` 尚未修复，不属于本轮结果。

## 下一步

- **iPhone 文件树支线 `0902-shouji` 已完成本地根因修复。** iOS 不再调用 Desktop 文件夹选择器，导出改走系统文件分享/逐文件下载回退；“电脑中打开”在移动端隐藏；云下载按 `cloudProjectId` 精确绑定，同名未绑定项目不会被误覆盖。基线为 `v2.1.40`，文件树与项目中心回归、TypeScript 通过；真实 iPhone 文件落盘和 TestFlight 仍待验收，见 [[开发/文件系统/iPhone文件树与云端覆盖根治方案-2026-09-02]]。

- 先按 [[开发/通用记忆工作台原生Wiki能力与五Skill退役TDD-2026-08-26#9. 最小实施顺序]] 完成 TDD 一的入口、原生命令、行为等价与退役门禁；再实施 [[开发/通用记忆工作台轻上下文任务运行时TDD-2026-08-26]]，最后执行固定真实模型矩阵。完成前不登记为已实施或真实模型性能验收通过。
- 按 [[开发/通用记忆工作台RawChaJian证据链与可信检索TDD]] 执行五类独立模型前向验收；只有真实关键词检索持续漏召回时，才另写 TDD 评估全文检索或 BM25。提交、推送和发布须另行明确授权。
- 任何 3D 或媒体性能改造另写独立 TDD；先测真实空闲 CPU/GPU 和旧设备表现，再只优化非活动资源，不复用已撤销的迁出计划。

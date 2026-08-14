# 热缓存

> 更新：2026-08-14 | 阶段：v2.1.22 发布准备；小易图片适配器待生产部署

## 当前结论

- **`v2.1.22` 已完成本地发布准备，生产尚未部署。** 本版新增独立 `xiaoyi-image-adapter`，不修改 NewAPI 官方源码；六个图片模型统一走异步任务合同，修复 4 秒计费倍率、旧模型兼容、瞬时轮询失败、Gemini 无效参数和 Web 大 Base64 落盘。适配器 7/7、前端 focused 1037/1037、Rust 396 项、TypeScript、Web 正式构建与产物审计通过；真实付费生图和生产渠道切换待执行。见 [[运维/小易图片异步适配与部署-2026-08-14]]。

- **创作面板异步保存方法缺失已根治。** `CreationPanel` 尚未完成 `defineExpose` 时，外层曾对临时组件代理强制调用 `flushCanvasSave()`，抛出 `is not a function` 并中断面板生命周期。组件 ref 类型和调用现均允许方法暂时缺席，回归测试禁止不安全调用重新进入；Web 连续开关 10 次、类型检查和 Desktop 构建审计通过，真实 Desktop 安装包点击待发布后验收。见 [[排障/创作面板异步保存方法缺失-2026-08-13]]。

- **创作画布图片、视频预览空白已修复。** Desktop `asset://` 地址不能稳定供 Leafer 图片和视频首帧读取，音频因仍走 `data:` 路径而正常；共享 `getMediaRuntimeUrl()` 已恢复 `dev_read_file -> data:`，用户确认图片预览恢复。见 [[排障/创作画布本地图片视频预览空白-2026-08-13]]。

- **3D 编辑器导出诊断与取消选中已补齐。** FFmpeg 可检测，截图/视频保存显示路径或失败原因，视频目标目录为 `.raw/jc-media/视频/`；空白左键、Esc 和捕获开始前都会取消选择，移动箭头不会进入成片。见 [[排障/3D编辑器导出与选中控件-2026-08-13]]。

- **本机 ComfyUI 的 Z-Image Turbo 已完成 Desktop 真实生成验收。** 本机服务使用 `127.0.0.1:8000`，创作面板支持 `720p/1080p` 和五种比例；实现必须复刻已验证 API 工作流，只替换 `CR Text(47)` 的提示词及 `EmptyLatentImage(21)` 的宽高。初版 `8188` 地址、前端 Blob/Base64 保存、手写简化节点图、失联旧开发窗口和低范围随机种子均已成为后续接入的明确禁区。MiniMax H3 与其他工作流尚未接入，见 [[排障/本机ComfyUI模型接入与工作流复刻-2026-08-13]]。

- **RH GPT2.0 的 `global:` 任务回收已修复，GPT Image 2 VIP 与两项 Grok 图片模型已下线。** `4e33901f` 使 URL 安全校验接受编码后的 `/rh/tasks/global%3A...`，但不放宽其它路径或查询；GPT2.0 文生图与图生图仍待真实付费回收复验。GPT Image 2 VIP 的上游渠道失效已确认；`Grok Image 4.2 文生图/图生图` 已按用户决定从模型列表移除，Grok 图生视频保留。`gpt-image-2` 现直接请求 `b64_json`，避免临时 URL 在项目落盘前失效导致预览、下载和“放到画布”同时缺失；旧失效 URL 不可恢复，需重新生成。见 [[排障/云端GPT图片与RunningHub任务回收-2026-08-13]]。

- **KIK 视频计费已确认。** NewAPI 成功任务记录 `is_task=true`、`prompt_tokens=0`、`completion_tokens=0`，仍按 `/v1/videos` 任务分支使用输入价格计费；补全价格当前不参与。最终按官方基础价配置，收益由 NewAPI 用户组/会员倍率叠加；错误 404 请求 `quota=0` 不扣费。

- **iPhone `下载并覆盖本地` 当前未解决。** `2.1.17` 开发签名版在真实 iPhone 13 Pro Max 点击云端项目并确认后无可见结果，操作前后四个本地项目的 `.raw/.sync/state.json` 修改时间全部未变化。自动测试、IPA 构建、安装和启动已通过，但不能证明真实下载执行；继续排障已暂停，见 [[排障/iPhone云项目下载覆盖本地无响应-2026-08-10]]。

- **thinking 模型工具续请求已修复 `reasoning_content` 丢失。** Git `d98b72bf` 在共享 direct runtime 内仅临时保留并回传上游 `reasoning_content`，不显示、不写入 Raw Markdown；普通工具循环和流中断续传均覆盖。direct runtime `39/39`、TypeScript 与差异检查通过；截图对应真实 NewAPI 模型的多轮工具调用仍待验收，见 [[排障/thinking模型工具调用reasoning_content中断-2026-08-11]]。

- **新建记忆空间采用 Obsidian 兼容的最小 Wiki 骨架。** generic 只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`，不创建 README、CLAUDE、`方向.md`、业务目录或任何替代性的强制读取页；记忆请求也不自动注入 Wiki 页面。
- **`jc-everything-wiki` 只做按需结构规划。** 它沿用现有 Wiki 根目录，读取目标与现状，只追问会改变目录设计的问题；先给最小方案，用户确认后创建并复查。`index.md` 只导航顶层分类，目录 `_index.md` 只导航直属子目录。
- **`jc-raw-wiki` 已收缩为精准沉淀。** 它只把用户明确指定范围内的确认信息增量写入现有 Wiki 并登记来源；旧包已备份，项目类型模板、全 Raw 扫描和开发收尾脚本不再随 App 分发。关系图、标准 `.canvas` 和统计归 `jc-cha-wiki`，`.base` 等 App 支持后再做。
- **`jc-cha-wiki` 已收缩为精准检索。** 它用少量短词多轮召回、读取命中原页并带来源回答；重复 Reference 与 Python 查询器已移出产品包。关系图只在显式请求时生成有种子范围的局部、可点击 `.canvas`，禁止全库铺图和静默覆盖现有布局；本阶段不建设 RAG 或 Bases。
- **`jc-jian-wiki` 已收缩为精准只读巡检。** 机械检查复用原生 `wiki audit`，区分导航断链、同名歧义、普通未解析链接、孤儿候选和历史卫生；语义一致性只检查用户指定主题。旧个人创作规则、Reference、Python/Node 扫描器和目录数量启发式已移出产品包。
- **`jc-xiu-wiki` 精准修正已实施。** 只修已有 Wiki 中答案唯一的单文件错误；`replace` 强制 Markdown 路径，默认单命中，多命中须显式 `replaceAll`，先预览后批准，写后重读验证；结构扩展归 Everything，新事实归 Raw，复检归 Jian。
- **Raw、Cha、Jian 已共用一份证据合同。** 重要结论按“Wiki 章节 -> 来源角色 -> 原始来源 -> 已处理范围 -> 写入时 SHA-256 -> 记录时间”登记；Cha 回答时展示已登记来路，Jian 只读检查来源一致、变化、丢失、无法验证或登记不完整。来源变化只代表待复查，不自动判错或改写 Wiki。

- **唯一产品边界：保留记忆工作台现在拥有的全部功能；记忆工作台现在没有的功能全部迁出。** OpenCode、旧 Studio、文/武/道/创、电商、漫剧、制作工作台均属迁出范围。共享代码只要仍被记忆工作台直接或间接依赖，就必须保留，不能按目录名删除。唯一实施合同见 [[开发/通用记忆工作台单产品化分离SDD]]。
- 记忆工作台继续保留项目中心与文件树、Raw 对话、快速/记忆模式、完整 Wiki 能力、项目内工具、附件与文档转换、Markdown 阅读编辑、`.canvas` / `.jccanvas` / `.jcscene`、媒体生成、登录/模型/Skill/MCP，以及当前 Desktop、Web、Mobile 各自已经具备的能力。
- **模型请求中断恢复已实施。** `502/503/504/524`、浏览器网络错误和 Tauri/reqwest `error sending request` 只重试当前模型请求两次，退避 `2 秒、4 秒`；耗尽后仅对明确的请求或流中断写一组 Raw 恢复点。Raw 追加按 `userTurn.id` 幂等，旧 generation 不再覆盖新项目状态，发送期间锁定输入与附件。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和差异检查通过；真实 NewAPI/Cloudflare 三端故障注入尚未验收。
- **记忆模式工具权限不受对话文字关闭。** 模式选择器是工具池唯一来源；历史或当前文字中的“不要调用工具”不移除候选工具。流式正文中断后的续写继续携带记忆工具池，续写产生的工具调用进入原审批和执行循环。提交 `055d8e8c`，完整 focused `1021/1021`、TypeScript 与差异检查通过；真实上游中断待人工验收。
- **媒体与 3D 迁出决定已撤销且从未实施。** 图片、视频、音频、创作画布、3D 白膜、GLB/GLTF 查看和 Desktop 动画导出继续随韭菜盒子保留；短视频工厂未被本计划修改。老电脑适配只优化空闲刷新与按需加载，不降低最终质量、不删除高性能设备能力，见 [[开发/韭菜盒子媒体与3D能力迁出SDD]]。
- **Seed Audio 1.0 已完成生产与创作面板验收。** 提交 `d1773603` 的独立适配器已部署；NewAPI 渠道 66 的文本、参考音频和创作面板画布音频均已真实返回有效 MP3。创作面板显示 `豆包音频生成1.0 · 1.2元/分钟`，最多支持 3 段参考音频；NewAPI 按 Token 计费配置为普通输入/补全/音频输入 `1`、音频输出 `1000`（美元/1M Token），前端 UI 不变。
- **媒体任务启动竞态已按 TDD 修复。** `initDB()` 并发调用现在共用同一个 Promise，`mediaTaskStore.init()` 等待 SQLite 真正完成后才读取和恢复历史；不再在首次挂载抛出 `SQLite storage is not ready`，也不增加定时重试或第二套任务状态。
- **App 只随包提供 7 个产品 Skill：** `jc-cha-wiki`、`jc-everything-wiki`、`jc-jian-wiki`、`jc-new-user-guide`、`jc-raw-wiki`、`jc-xiu-wiki`、`skill-creator`。20 个个人写作、视觉、旁白 Skill 已迁入 `/Users/by3/Documents/jiucaihezi-personal-skills`，不再进入 App 索引、推荐指令或新手指南；用户自行安装的 Skill 不受影响。
- **Jina 网页工具已迁出产品。** App 不再提供 `@联网搜索`、`web_search` 或 `read_url`，也不再携带 `jina-adapter`；原实现完整备份于 `/Users/by3/Documents/jiucaihezi-jina-backup`。Desktop 仍可在用户批准后通过 Terminal 使用本机网络；Web 与 Mobile 不提供替代网页工具。生产服务器上的旧容器和 NewAPI 渠道尚未核验或下线，但新 App 已无调用入口。
- **Desktop 增加官方 Playwright MCP。** 设置里的内置卡片使用固定版本 `@playwright/mcp@0.0.79`，复用现有 stdio MCP 和统一工具桥接；App 不打包 Node、Playwright 或 Chromium。缺少 Node 时提供官方下载和重新连接，Windows 额外识别并正确启动 `npx.cmd`。该扩展拥有浏览、页面操作、上传下载和脚本执行等高权限，只有用户主动连接后才启用；Web 与 Mobile 不支持本地 stdio。
- **Tauri 自定义命令权限已闭环。** 开发地址使用 `http://localhost:1420/*`，`allow-app-commands` 与 Rust `generate_handler!` 全量一致；Playwright MCP 与现有文件、Skill、密钥等命令不会再因局部 ACL 出现“点击无反应”。
- **Playwright MCP 已完成本机点击验收。** 上一轮“下载 Node.js”是把 `Plugin not found` 误判为缺少 `npx`，且开发 URL 与自定义命令 ACL 同时阻断；当前开发版已连接成功。新版本发布后，外部 Desktop 用户仍需本机 Node/npx 和可访问 npm 的网络，干净 Windows/macOS 安装链待真机验收。
- **short-video-factory 本地 MCP 已在 Desktop 开发版连通。** Git `10553f10` 使 stdio 会话以 Node 启动 tsx、分离 stdout/stderr、记录完整超时诊断，并在失败后销毁旧会话和工具缓存。服务端真实返回 8 个工具；`open_project` 已成功打开 `0807功夫女友` 并返回 `episode-001`。`refresh_production_materials` 与断 pipe 重连仍待真实验收。
- **Playwright 的打包版 PATH 根因已二次修复，待 `v2.1.18` 发布验收。** 用户在 `v2.1.17` 仍复现 `env: node: No such file or directory`：绝对 Node 只能启动 `npx-cli.js`，其后继脚本仍依赖 PATH。共享 stdio 启动入口现将解析后的可执行文件目录加入子进程 PATH；MCP 专项 `5/5`、TypeScript、Rust 编译和空 PATH 等价验证通过，正式包点击“启用”尚未验收。
- **文字云合同只有两个手动动作：** `上传并覆盖云端`以本地完整可同步文字快照覆盖云端，`下载并覆盖本地`以云端完整可同步文字快照覆盖本地。两者都不合并、不创建冲突副本、不自动双向同步；媒体、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不比较、不传输、不删除。设置页只显示状态，操作只在项目中心。
- 发布身份不得因分离改变：Desktop `com.jiucaihezi.desktop`、iOS `com.jiucaihezi.mobile`、`jiucaihezi://`、正式 Web <https://jiucaihezi.studio>、应用数据目录、账号及云项目绑定全部保持连续；Android 当前无稳定独立身份，继续暂停。旧 OTA 使用 RSA 签名，与 Tauri 2 minisign 合同不兼容，下一版暂时关闭自动更新，继续通过 GitHub Release/官网下载安装包；生成新 signer 密钥并完成三平台旧版升级验收后再恢复 OTA。
- **通用附件合同保持现状：** Office/PDF/XLSX/PPTX 保存原件并生成 Markdown 可读副本，再把 Markdown 发送给 NewAPI；原件不被删除，图片、视频、音频继续走原生媒体链路。本轮不改附件逻辑。
- **附件图标与 Windows 启动修复（2026-08-07）：** 离线 Material Symbols 扫描器已支持连字符，输入框 `attach-file` 图标已重新打入 `icons-bundle.json`。Windows 发布同时提供 NSIS 安装器和便携 ZIP；普通用户优先运行安装器，由 `downloadBootstrapper` 引导安装 Microsoft Edge WebView2 Runtime。已具备 WebView2 的 Windows 用户已完成双击启动验收；缺少运行时的干净设备安装引导仍待人工验收。
- **Windows“闪退”真机根因已闭环。** 绝对 EXE 路径启动与清理 App 数据后普通启动均成功，证明程序和 WebView2 链路可用；失败来自 Windows 保存的零尺寸、`-32000` 坐标窗口状态，使运行中的窗口不可见。现在读写入口都拒绝无效状态，同时保留合法多显示器负坐标。
- **3D 手动运镜录制（2026-08-07）：** Desktop 3D 编辑器已增加开始/停止录制按钮。用户可以直接旋转、平移、推进和拉远视角；停止后复用现有 FFmpeg 链路保存 MP4。录制不生成关键帧，不改变现有 `.jcscene` 时间线能力；真实 Desktop 手动录制验收待执行。
- **3D 文件与对话编辑（2026-08-07）：** `.jcscene` 是 `.raw/jc-media/文档/` 中的可编辑源文件，截图进`图片`，自动动画和手动运镜进`视频`。打开场景后可在编辑器下方直接说“加、移、删、改镜头”，普通请求调用 `edit_3d_scene` 原子写回并刷新；只有明确“重做/重新生成”才使用 `create_3d_scene` 完整覆盖。本阶段只保留白模基础，不建设写实资产库。
- **下一版发布门禁（2026-08-07）：** Windows Release 上传步骤已在本步骤重新声明并校验 NSIS/ZIP 路径；失效 OTA 与 `latest.json` 发布任务已停用，避免发布无效签名。3D 默认只显示人物及人物编队标签，非人物对象不显示文字；场景指令发送后恢复主输入草稿。
- **`v2.1.11` Desktop 启动失败已定位并修复（2026-08-07）：** 关闭 OTA 配置后 Rust 仍注册 updater 插件，插件读取空配置时在 Tauri Builder 阶段 panic，导致 macOS 冒烟失败且 Windows EXE 双击秒退；这次故障与 WebView2 无关。updater 注册、依赖和未使用前端 composable 已全部移除；Windows CI 新增构建后 EXE 存活 15 秒门禁。本机 aarch64 macOS 生产 release 已构建并真实启动存活 15 秒，修复包需使用新版本号发布，不能覆盖 `v2.1.11` tag。
- **`v2.1.13` 发布链路修复（2026-08-07）：** 下载页读取 `/updates/latest.json`，不读取 GitHub Latest Release；桌面发布工作流已将 GitHub Release 预创建、三平台资产上传、官网下载清单三者解耦。OTA 签名仍停用，但官网下载清单不再依赖 OTA。v2.1.13 正常 tag 发布将完整验证“创建 Release → 三平台成功 → 自动发布官网下载清单”。

## 已验证 / 未验证

- `v2.1.9` 已发布：`main` 与 tag 指向 `f302c251`；Web Production 正式域名返回 HTTP 200；GitHub Actions `30904082094` 的 macOS ARM、macOS Intel、Windows x64 和发布清单均成功；生产 `latest.json` 返回 `2.1.9`。
- 方向性文字覆盖曾通过 focused `1438/1446`、TypeScript、Web quick build 和产物审计；2026-08-10 真实 iPhone `2.1.17` 下载覆盖回归失败，当前 Mobile 下载链路不得登记为通过。Web/Desktop 覆盖删除矩阵仍待人工验收。
- Wiki 状态查询已按 append-only 合同改为从 `log.md` 末尾读取最新标题；应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 与 TypeScript 通过，当前状态正确显示 2026-08-04 的最新决策。
- iOS 仍是已提交审核的 `2.1.7 (2.1.7.1)`，Android 无公开版；桌面三平台发布不等于 App Store 或 Google Play 上架。
- 单产品化分离已按四组 TDD 实施：模型目录改用 Gateway，创作面板解除 OpenCode owner/session，搜索改用 Raw 对话，Rust 移除 OpenCode Runtime/命令；旧 Studio、OpenCode、四模式、电商、制作、漫剧工作台产品代码与发布物已从主仓迁出。
- 独立备份仓库 `../jiucaihezi-legacy-products/` 保留 `v2.1.9` / `f302c251` 完整历史，工作树干净且 `git fsck --full` 通过。主仓保留 Raw、Wiki、媒体、同步、身份、Gateway、云绑定、更新与发布路径。
- 自动验证通过：分离门禁 `11/11`、Rust `395 passed / 1 ignored`、Wiki Skill `38/38`、证据链相关原生/Web/Desktop/审批 `57/57`、完整 focused `986/986`、TypeScript 和两端产物审计；最终产物只有 7 个产品 Skill。五类独立模型前向检查尚未执行；真实 Windows、Intel Mac、iOS 升级与云绑定连续性待人工验收；Android 继续暂停。
- 媒体任务竞态红灯先确认旧实现缺少存储等待合同；绿色结果为媒体任务专项 `46/46`、完整 focused、TypeScript、Desktop quick build 与产物审计。两次干净 Desktop 启动中 SQLite 约 5.1 秒和 4.9 秒完成，均无 mounted-hook 未处理异常；中断的 Grok Video 任务自动恢复并最终 `success 100%`。Veo 3.1 与 Fast 的真实 `404 fail_to_fetch_task` 尚未修复，不属于本轮结果。

## 下一步

- 按 [[开发/通用记忆工作台RawChaJian证据链与可信检索TDD]] 执行五类独立模型前向验收；只有真实关键词检索持续漏召回时，才另写 TDD 评估全文检索或 BM25。提交、推送和发布须另行明确授权。
- 任何 3D 或媒体性能改造另写独立 TDD；先测真实空闲 CPU/GPU 和旧设备表现，再只优化非活动资源，不复用已撤销的迁出计划。

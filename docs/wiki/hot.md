# 热缓存

## [2026-10-07] FK 本地参考图上传 Load failed 修复

- 两张参考图的失败任务没有上游任务 ID；桌面 FormData 绕过原生 HTTP，WebView 上传遇到缺少允许来源头的跨域响应。已改为原生 multipart 二进制上传。
- HTTP 13 项、Rust 上传 1 项、创作运行时 41 项回归及类型检查通过；公网素材上传/读回成功。当前发布 v2.2.18 尚不含修复，真实视频生成和安装版 UI 待验收。见 [[排障/FK参考图上传Load failed与桌面原生HTTP修复-2026-10-07]]。

## [2026-10-06] v2.2.18 三平台发布完成

- v2.2.17 run `37477588251` 中 macOS ARM、Windows 成功；Intel 在签名完成后，`hdiutil create` 返回 `Resource busy`，导致公证、Intel 产物和下载清单跳过。这是打包阶段资源忙，不是代码编译失败。
- Intel DMG 步骤现增加最多 3 次创建尝试、每次独立临时镜像、退避等待、失败时 `hdiutil info` 诊断及临时目录清理。GitHub Actions run `37485179907` 的 macOS ARM、macOS Intel、Windows、下载清单全部成功；Release 六项平台资产已上传，线上 `latest.json` 已返回 `2.2.18` 和三个平台地址。

## [2026-10-06] v2.2.16 三平台构建失败修复

- GitHub Actions run `37464731998` 的 macOS ARM、macOS Intel、Windows x64 均在共同的 Desktop TypeScript 构建阶段失败；不是平台工具链故障。错误为 `modeLabel` 未覆盖新增的 `prompt-enhancement`，以及文本轮询分支提前 return 后仍有不可能成立的 `kind === 'text'` 比较。
- 两处已修复；本地 `pnpm run typecheck` 与 `pnpm run build:desktop:quick` 通过。`v2.2.16` 标签已触发过失败构建，按发布边界保留不移动，修复版提升到 `v2.2.17`。
- `v2.2.17` 结果已确认：macOS ARM 与 Windows 成功，Intel 的 DMG 创建因 `hdiutil: Resource busy` 失败，下载清单因此跳过；修复版改用 `v2.2.18`，不移动既有 tag。

## [2026-10-06] 小易 Grok Imagine Image 2.0 恢复现有异步路由

- 原生 `/v1/images/generations` 路由在实际调用中返回 HTTP 404 `bad_response_status_code`。本仓现有记录显示该模型原先依赖异步图片适配链路；具体是上游路径不支持还是生产 Base URL/渠道仍指向旧适配器，需查对应 NewAPI 请求日志确认。
- 创作面板已恢复到兼容现有服务器的 `/v1/videos` 异步任务路由；模型 ID、显示名、价格和分辨率选项保留。服务器链路升级与同步图片路由验收前不再切换。
- 已更新旧测试断言但未运行；恢复后的生产生成、计费和落盘尚待用户复验。详见 [[运维/韭菜盒子GrokImagineImage2.0API对外接入-2026-09-08]]。

## [2026-10-06] 创作面板文武双修戏种按钮与本机视频模型隐藏

- AI 应用「文武双修」的动态戏种节点按 `65:index` / `0文1武` 识别，使用「文戏 / 武戏」选择按钮；实际值仍为 0/1。
- 视频模型选择列表过滤 `jc 本机` 分组；本机视频模型定义和其他任务的本机模型不删除。旧存储若选中该分组的视频模型，启动时回落到可见视频模型。
- 尚未运行测试或在应用内验收。

## [2026-10-06] Fk 渠道 Seedance 视频 API 对外文档

- 更新 [[运维/韭菜盒子Fk渠道Seedance视频API对外接入-2026-10-06]]：记录 NewAPI 公网 `/v1/videos` 创建、查询、`/content` 下载合同，8 个插件模型 ID、逐模型参数/参考素材限制、对外价格、请求示例、轮询与错误重试边界。
- 插件上传和渠道配置由用户确认完成；真实公网生成、扣费、下载、Range/HEAD 尚未核验。用户最初列出的 XZ Seedance 2.0「933全参」模型不在插件 7 个 ID 中，本页不宣称其可用。
- 创作面板已加入 `FK-Seedance` 分组与 8 个白名单模型项；新增 MiniMax H3-768p（¥0.08/秒），该分组已置于视频分组首位。面板真实提交、可用性读回与账单仍待验收。

## [2026-10-06] 创作面板独立提示词增强文本模型

- `MiniMax H3 Context IR 提示词增强` 作为独立创作模型登记在视频分类，以复用时长、画幅、提示词和参考素材输入；任务输出类型为文本，通过 Responses API 创建并轮询，不自动触发视频生成。
- 非空增强结果自动保存到当前项目 `.raw/jc-media/文档/` 下的 Markdown 文档；创建、恢复轮询、手动刷新结果均落盘，保存失败可从任务卡片重试。多模态素材及参数仍受文档列出的上游限制。
- 真实 UI、创作面板端到端调用和安装包尚未验收；多模态 API 也未专项验收。见 [[运维/韭菜盒子MiniMaxH3ContextIR提示词增强API对外接入-2026-10-06]]。

## [2026-10-06] 新增模型与 NewAPI 插件固定流程

- Wiki 新增统一接入入口 [[运维/新增模型与NewAPI插件固定流程]]：覆盖上游/公开/内网 URL、供应商 Key 与调用方 Token 边界、公开模型名与映射、App 注册、Task Plugin 创建和 `usageSchema`/`tier(..., u(...))` 收费表达式、第三方 API 文档结构及真实生产验收。
- 旧 [[运维/模型注册]] 保留 RH 专项细节，不再作为跨供应商通用流程；NewAPI Task Plugin 的宿主合同与逐线路证据仍以 [[运维/适配器收编任务插件总方案-2026-10-01]] 为准。

## [2026-10-06] 菠萝图片上游账号不可用

- 15:22:23 APP 收到 524；同用户 #136 的 `/v1/images/edits` 在 15:22:39、140854 ms 后仍返回 503 无可用兼容账号。渠道地址与模型映射已只读确认正确。约 125 秒的 APP 等待与公网 Cloudflare 读取时限吻合，外层先超时为高可信推断，尚无完整 Ray／Host 证据。同步长请求入口与供应商账号均待处理；仅增加 APP 超时不能解决 524。
- NewAPI 后台只读核实：用户 15:05:58 请求命中 #136「菠萝生图」，42 秒后上游返回 HTTP 503 `No available compatible accounts`；14:26:58 同渠道 53 秒后返回 502。其他用户同日有相同失败，同模型凌晨存在成功消耗记录；不能判定渠道未配置或 APP 没接上。
- APP 丢弃 503 原文的独立缺陷已修，JSON/multipart 均保留状态和原文；定向 25/25、差异检查通过。不自动重提生成。安装版尚未更新，供应商账号恢复、真实生成及发布未验证。见 [[排障/菠萝生图上游账号不可用与503错误展示-2026-10-06]]。

## [2026-10-06] MiniMax H3 Context IR 公网 API 基础验收

- NewAPI 插件上传后，公网 `POST /v1/responses` + `background: true`，再用顶层 `resp_...` ID 查询，纯文本请求已返回 `status: completed` 和非空增强提示词。查询必须用响应顶层 `id`，不能用 `metadata.task_id` 的 `task_...`。
- 外部接口文档现标记为「基础链路已验收」；多模态、stream、callback 尚未专项验收。当前成功样例 `usage` 为 0，与实际结算尚未对账，不得据此判成功或推断费用。见 [[运维/韭菜盒子MiniMaxH3ContextIR提示词增强API对外接入-2026-10-06]]。

## [2026-10-06] DSH Session 写锁与官方生命周期对齐

- 真实 SDK 红测复现：同运行时已激活 Agent，APP 冷恢复补丁再次 resume 撞写锁。现遵循官方 live 查询／共享创建／失败后复查，借用 Agent 不伪造销毁权；保留历史、审批、权限与 Skill 桥接。
- 原生登记保留 PID，修复 runner 被 wait 后失去进程组 ID 而漏收后代；stdin 写入不再持全局进程表锁，回收不再 try_lock 静默跳过。新 runner 等旧 realm 清理；关闭期限覆盖发送；回收失败保留旧句柄和登记，后续可重试。
- 双 SDK 进程／双 APP runner 验证：占用仍由官方 lease 拒绝，释放后被拒运行时可续原 Session；已受理历史保留、被拒消息未写入且无重复投递。相关 SDK 回归 **31/31**，Rust **477/0/1 ignored**；完整 focused **1836/1837**（唯一失败为既有文件树“新建窗口”旧断言）。桌面 quick build／产物审计、TypeScript 通过。macOS Apple Silicon 本地修复包已构建并签名，包内 Node／DSH 回归 **5/5**；未公证、未发布。
- 当前用户运行 `/Applications/韭菜盒子.app` 安装版，仓库修改不会热更新该实例；本机两个 runner 分属不同工作区，没有强杀用户任务。用户原报错对话、Windows/Intel Mac 原生操作与正式发布仍待验证。见 [[开发/DSH会话写锁与官方生命周期对齐方案-2026-10-06]]。

## [2026-10-06] 素材上传迁入 NewAPI 本地临时存储

- NewAPI rc.40 定制镜像已由用户切换生产；备份归档 411,562,741 字节目录校验通过（未恢复演练）。源站健康、未登录 401、图片上传读回、Range、HEAD 全部通过，备份目录 `/root/jc-media-switch-20261006T012353Z`。
- Gateway 已移除两条媒体路由及媒体鉴权/存储代码并部署，版本 `8e2806b7-dc14-412c-96e5-423d09e00752`；登录/同步等回归 39/39。存储由 NewAPI TokenAuth 与 `/data/creation-media` 承担，不再使用 KV/R2；公网 curl 已确认上传未登录 401（NewAPI 响应）及登录网关健康 200；用户服务器公网读回已通过：图片字节一致、Range、HEAD 全部通过。未验证公网授权上传、真实图片/音频/视频生成与 APP 操作。
- 第一次备份误用容器默认用户；第二次将 URI 当 PGDATABASE；现已读取实际 NewAPI DSN、分离数据库名与连接参数，脱敏错误，备份测试 5/5。Compose 仍必须同时带原配置和 media override。
- 逐模型直传迁移、生成、三平台验收、实际告警和恢复演练尚未完成。见 [[开发/APP使用者与NewAPI唯一后台实施方案-2026-10-06]]。

## [2026-10-05] 视频下载改为持久任务与断点恢复

- 原生下载覆盖整个文件传输，初始 + 三次有限重试；稳定断点保留字节，Range/If-Range 与版本/总长校验；不支持可靠续传时完整重下，普通 DNS 路径与手动 curl 对齐。
- 提交时固定项目、凭据引用；重启/网络恢复续下已有结果；取消只暂停下载，卡片可继续，不再三次永久放弃。项目流式与兼容 Base64 通道共用传输；视频结构检查 + 可选现有 ffprobe，缺少外部工具不阻断正常下载。
- Rust **475/0/1 ignored**；focused **1824/1825**（唯一既有文件树旧断言），TypeScript/差异检查通过。开发 App 自动重编译启动；生产该视频与 Windows/Intel Mac 真机、安装包发布未验证。合同与密钥存储边界见 [[排障/视频下载持久恢复与断点续传-2026-10-05]]。

## [2026-10-05] 取消任务保留已完成过程

- 根因：`stopRun()` 清空输入、流式正文与步骤；视图又只在运行中展示过程；取消分支不回读官方会话。首次取消不更新目录时间，重新打开也可能跳过会话读取。
- 实际截图对应 Session 的只读核对：21 次工具调用、21 次工具结果仍在官方日志，末尾为 aborted/disposed，未删除。取消只停止执行，保留观察到的正文／推理／过程，关闭流式动画；停止后等待宿主落盘并回读官方 Session，更新目录与投影。回读失败保留缓存；打开已有目录会话回读真实历史，远程停止同样同步。
- 先红测复现清空与运行态展示门槛；真实 SDK 回归验证取消后重启仍有原问题、工具调用／结果与已写文件。SDK **7/7**，完整 focused **1820/1821**（唯一失败仍是既有文件树“新建窗口”旧断言）；TypeScript、差异检查通过，定向 lint 无错误（2 个既有警告）。运行中的开发 App 已热更新，未原生点击验收／跨平台打包发布。

## [2026-10-05] DSH 实时权限与一次性审批闭环

- 用户 macOS 开发 App 实测成功：仅可查看下写入被拒，出现授权卡与调整权限入口；切换为工作区内修改后成功创建并读取 `permission-test.txt`，原取消任务的过程仍可见。版本提升至 **v2.2.15**；其他平台尚未真机验收。

- 权限从进程配置改为 Session 状态：运行中执行官方 `/permission`，同 Agent 继续任务；显示值以宿主回读为准，新任务偏好单独落盘。未开始会话不提前创建／锁住。
- SDK Agent scope 声明 `approval` 依赖并桥接官方请求；DH 卡片提供本次允许、拒绝、调整权限。主／子代理真实身份关联，取消、销毁、断连与过期答复关闭；视图重挂仍可答复，并行请求排队。长期权限切换不批准待答操作，旧内核始终允许保留。
- 红测后定向 **100/100**，随包 Node 真实 SDK／审批／补丁 **8/8**；TypeScript、差异检查通过。完整 focused **1818/1819**，唯一失败为既有文件树“新建窗口”旧断言。未原生点击／跨平台真机／发布；见 [[开发/DSH权限切换提醒最小执行方案-2026-10-05]]。

## [2026-10-04] 漫剧制作插件依赖根治，SDK 发送链回归通过

- 漫剧发送报 `cannot get property "skills" without inject` 的根因已复现：`pinManjuSkills()` 直接访问 Agent scope 的 `skills`，但官方 AgentLoop 未声明此依赖；SDK Server 声明不改变 Agent scope 的服务解析。
- 已核对官方 DSH 快照 `5badb15009ae1756c3afe0ae0cef1faafc290ccc` 与本仓 `0.2.0-rc.2`，统一 [[开发/漫剧制作合同]] §6.1：Agent scope 下挂载声明 `skills` 的子插件，确认实际完成登记再发送，以子插件句柄统一释放，失败回滚且不降级。
- 独立真实依赖复现确认子插件可登记、隔离与释放；缺服务时 `await` 返回不代表 `apply` 执行。此前作用域 4/4 的模拟父上下文已声明 `skills`，漏掉真实条件，不能作为发送链可用证据。
- 用户确认合同后已实施：声明依赖的子插件替代直接访问及逐 Skill 释放数组；SDK 按实际 Agent 用 WeakMap 复用绑定，准备后复核存活，失败回滚，组合释放确保两个清理均执行。
- 真实上下文红测先复现旧错；修复后作用域／SDK + 准备脚本 **13/13**，系统 Node 与随包 Node 22.23.2 均通过。实际 SDK + 回环模型替身验证内置正文、重复发送、退出恢复项目 Skill、同 Session 重启恢复。
- 完整 focused **1805/1806、0 取消**，唯一失败仍为既有文件树“新建窗口”旧断言；定向 lint 无错误、差异检查通过。未真实创作模型、付费生成、跨平台原生操作或打包发布，见 [[开发/漫剧制作入口与逐镜模型路由TDD-2026-10-04]] 最新修订。

## [2026-10-04] 漫剧制作入口与逐镜模型路由

- 漫剧入口只保留启用按钮，删除提示词模型选择器与模型偏好链。路由顺序：指定 Skill／模型、续改原产物、明确交付物、明确新手求起步、其余创作默认 H3。新手只选当前一步，不自动串制作流程；旧模型偏好不参与路由。现行规则见 [[开发/漫剧制作合同]]，本次验证另见 TDD 极简修订。
- 原导演 Skill 改名 `jc-seedance`，保留原导演表达、五份专项参考和用户可选时间戳；八个共同制作入口规则未重写。新增十一份内置包，加原四包共十五包，仍按需读取。`jc-shuaigemeinv` 保留独立使用，未加入漫剧路线。
- 模式状态在发送前即可按对话保存；Harness 通过 agent 范围的官方 SkillRegistry 固定内置版本，避免同名个人版本覆盖；退出释放绑定。默认不生媒体；明确生成时依原有影音开关及路由合同仅提交、不等待、不轮询。
- 极简修订验证：路由／目录／Harness 67/67，作用域 4/4；完整 focused 1776 通过／1 既有文件树旧断言失败／18 移动补读重连 Promise 取消。TypeScript、Vite、Desktop 审计、Skill 校验与差异检查通过。未付费生成、真实模型前向、跨平台原生点击或安装打包发布。细节见 [[开发/漫剧制作入口与逐镜模型路由TDD-2026-10-04]]。


## [2026-10-04] 视频保存链路与原生下载加固

- 视频项目保存已有原生流式写临时文件、完成后改名；本次复现并修复旧 Comfy 任务漏掉 content 路由、视频重试复用旧 CDN 链接、持续慢下载被固定总超时切断、无效响应误保存等缺口。
- 复用现有 reqwest：连续无数据超时、连接失败或 502/503/504 最多补一次 GET、保留 401/403/404 即时报错、底层连接诊断、失败清理临时文件。未增加依赖或强制改变其它视频供应商下载合同。
- 定向媒体 `150/150`，Rust `467/0/1 ignored`，TypeScript 通过；focused `1782/1783`，唯一无关文件树旧断言失败。未付费生成、用户真机验收、打包或发布；细节与 Base64 回退边界见 [[排障/视频保存链路与原生下载加固-2026-10-04]]。

## [2026-10-04] GPT 图片生成成功但保存失败

- 用户截图确认生成接口已完成，失败在 Desktop 从 `relay.xiaoyiapi.xyz` 下载结果到项目。开发机实测其中一条链接仍返回 HTTP 200 `image/png`；报障用户机器的具体连接故障尚未定位。
- 根因链路：GPT Image 2 系列同步请求固定要 `url`，响应同时有 `b64_json` 时又优先选 URL，项目保存因而依赖客户端直连中转域名；这与 [[运维/小易图片模型接口与NewAPI接入-2026-09-04]] 已写的 Base64 合同不符。现改为该系列请求 `b64_json` 并优先取图片字节，仍兼容只返回 URL。
- 旧任务不含图片字节，现有有效链接可复制到浏览器保存或待客户端连通后重试项目保存；不需重新生成。自动验证与未验收边界见 [[排障/GPT图片生成成功但项目保存失败-2026-10-04]]。

## [2026-10-03] 截图功能已实现，真机待验收；新建窗口入口位置已定

- **截图（P0/P1 代码已实现）**：桌面系统截图，**框选** → 复制 / 另存为 / 保存到项目；**给默认快捷键**（`Control+Shift+A`，可改）；**v1 不做标注**；应用内入口放**设置**里。
- 查证结论：复用 `arboard`、dialog/fs、`files.importBinary` 与 `nextMaterialPath`；新增 `png`、Windows `xcap`、仅 Rust 的桌面 `tauri-plugin-global-shortcut`，不需要前端快捷键插件或剪贴板插件。
- **2026-10-03 复审完善（用户确认）**：先抓目标屏快照，再显示**不透明**自绘框选窗，后续只裁剪快照；单进程注册快捷键、单活动任务与任务 ID 校验；项目绑定触发时来源窗口，保存交回该工作台；取消/松手预览不复制，自动复制仅保存成功后执行。坐标按实际快照/展示尺寸换算，补齐负坐标副屏、反向拖拽、取整/越界/拔屏。
- macOS 系统授权检查/引导纳入 **P0**，不以黑图判断权限；`screencapture -D` 目标屏映射待真机核实。截图窗独立最小 capability，不继承 default 工作台权限、不启动 Gateway/Harness。快捷键先注册新键、再注销旧键，失败保持旧配置。
- 详见 [[开发/韭菜盒子截图功能SDD-2026-10-03]]（P0/P1/P2、15 条验收、来源依据）；**自动验证通过，真机待验收**：focused 1780/1780；Rust 464/0/1 ignored；Intel Mac 编译、TypeScript、桌面构建与产物审计通过。Windows 交叉构建因本机缺 MSVC `assert.h` 阻塞；签名包 TCC、多屏/DPI、复制保存真机操作均未执行。独立入口 `screenshot/index.html`，设置由 Rust 原子写入 `screenshot-settings.json`。
- **新建窗口入口**：Windows 没有菜单栏（那段菜单整块在 `#[cfg(target_os = "macos")]`），文件树是唯一入口。已实现「空状态」+「动作行」两处（提交 `0047189f`/`19d9ca15`）；**2026-10-03 已移动**到 **logo 那一行**（`.pft-project-row`），紧挨隐藏文件树按钮左边；保留长目录名省略与空状态入口。详见 [[开发/韭菜盒子多窗口多开SDD-2026-09-29]] §10。

## [2026-10-03] Computer Use 定案：根因是「图外包 profile 解析不到」，已修好并真机验收

- 用户质疑「官方能实现，直接搬过来」，逼出了正解：官方 Loader 解析裸包名**锚在 profile 目录**，已发布 bundle **依赖图内**的包能命中；**图外的包解析不到时只记一条 `failed to import`** —— 不是 `pending`、不让启动失败，于是表现为「不报错 + runner 零 stderr + 工具表里空无一物」。
- 逼出这条静默记录的唯一办法：`DSH_HOME=<ws> node .../dsh/lib/bin.js --profile sdk --patch <route.cordis.yml> < nul` → `warning: 2 entries did not activate / computer-use (...): failed to import`。⚠️ **「runner 零 stderr」永远不能当生效证据**（SDK client 把子进程 stderr 收在 `stderrTail`、只在运行时死亡时才抛）；判定只看**模型实际收到的工具表**。
- 修法：`runner.mjs` 在开关打开时调 `profile-plugins.mjs` 的 `ensureProfilePluginLinks()` —— profile 目录缺失先用官方 `--dump-config` 催生骨架，再把运行时那两份包挂成 Windows **目录联接**（不能联网、不该跑 pnpm）；失败只跳过。启动前一行，`src/services/deepSeekHarness.ts` 把 `computerUse` 传下来。
- 真机对照（同一条命令、只改一处）：修前 `tools=24 cua=0 CUA指导=false` → 修后 **`tools=80 cua=56 CUA指导=true`**，同一轮里 `@skill` 硬限制照旧（点名 → 工具 79、`skill=false`）。
- 顺带查清：用户那次「操作电脑成功」是 `pwsh`×20 + `read_image`×2 走的路，不是 Computer Use；`dsh-file-reference-local` 不用这步也能激活，因为它是 `dsh-web-app` 的依赖（**图内包生效 ≠ 图外包生效**，这是本次误判来源）。
- 门禁：新增 `scripts/__tests__/deepseek-harness-profile-plugins.test.mjs`（6 用例）；聚焦套件 `1774 tests / 1773 pass / 1 fail`（唯一失败是既有的 creation-mcp Windows `/tmp` 用例）；`vue-tsc -b` 干净。详见 [[开发/韭菜盒子Harness-Computer-Use接入-2026-10-03]] §4。

## [2026-10-03] 点名 Skill 后本会话只许用这一个；@Jev 整个删掉

- 用户诉求：「@ 了某个 skill，后续任务只允许用这一个」。官方 skill 是**双通道**：`/name` 手势只把该 skill 正文**注入**这一轮（`source.kind: 'skill-invocation'`），而同一插件还会给模型一份**全量 skill 目录**并明确要求「Load all applicable skills」—— 所以「@ 了 A、模型又用 B」是官方语义下的正常行为，不是丢了用户的选择。官方只有**文件级**开关（`disable-model-invocation` / `user-invocable`），没有「本会话只许这几个」的粒度。
- 解法（100% 官方件，第 6 处 vendor patch）：点名时对 `agent.ctx.tools.restrict({ deny: ['skill'] })`。官方 `dsh-tool-skill` 在工具不可见时**不再发布目录**（`ctx.tools.get(skillTool.name, agent) === skillTool ? snapshot : { skills: [], complete: true }`），而手势注入是**另一个** pre-step 钩子、不看工具可见性 → 点名的指令照样进上下文，模型却看不到也调不到别的 skill。判定与官方 `invokedSkillNames()` 逐字同源（同一个 `SKILL_GESTURE` 正则 + 真去注册表查 + `isUserInvocable`），否则 `/permission` 这类命令会被误当成点名。
- **离线实测**（本地假模型回显本轮工具表，不花钱）：无手势 tool=24/skill=true → 点名 `/jc-daoju` tool=23/skill=**false** → 撤掉手势 tool=24/skill=**true**。语义是会话级粘性（芯片跨轮保留、清空后下一轮恢复）。
- ⚠️ 踩坑：漏在 `inject` 里声明 `skills` → `cannot get property "skills" without inject`，**整轮直接失败**（不是静默降级）。现在查注册表与掩工具各自 try/catch，失败只记一行。
- **@Jev 整体删除**（用户 2026-10-03 决定）：它会把用户手选的 Skill 换成自己挑的（`selectedSkillNames.value = result.skills`），正是本次要消灭的行为。删掉决策层 `src/runtime/decision/`、`jevScorerRuntime`、`scripts/jev-scorer|jev-eval`、Rust `jev_scorer` 命令与权限/资源映射、设置面板那一节。
- 门禁：`1768 tests / 1759 pass / 1 fail`（唯一失败是既有 Windows `/tmp` 用例）、`vue-tsc -b` 干净。**未验收**：真机 UI；`cargo check` 因 dev App 占着 `target` 而无法在本机跑（`os error 32`，已用全文检索确认 Rust/JSON 无残留）。详见 [[开发/韭菜盒子Harness点名Skill只挂一个-2026-10-03]]。

## [2026-10-03] 重试链可见 + 失败不丢过程 + 重试预算对齐官方（P1+P2 落地）

- **重试行进会话投影**：官方 `llm/retry` / `llm/retry-started` 与工具步共用同一条 `deepSeekSessionProcess()` 时间线，折叠成 `{label}（{retry}/{maximum}） · {seconds}s`（官方 `message.retry.status` 逐字），展开看「重试延迟 / 失败原因」。四态文案、`duration.milliseconds` 全部逐字取自官方 zh 字典；主动倒计时用 `事件时间 + delayMs - now`（比官方「挂载时刻 + delayMs」更准），靠每秒跳的 `runElapsed` 重渲染，下限 1 秒同官方。
- **失败不再丢过程**：`turnProcessOpen()` 改成「运行中**或**本轮失败」就保持展开——原来只看运行中，于是一轮失败时整个过程块立刻塌回一行，而那正是最需要看过程的时候。失败行改官方式（红点 + `本轮运行失败` + 原因 + code），并补 `attempts`（官方 `assistant/attempt` 条数）显示「第 N 次尝试」，不再只给一个终止 code。
- **重试预算 `1 → 5`（官方 `DEFAULT_MAX_RETRIES`）**：实测 253 步里 12 次传输故障（每请求约 4.5%、一轮 7 步约 27%、42 步约 85%），502 是秒级失败、多等 ~15 秒几乎必然救回，turns 33/34 的 524 正是被那唯一一次重试救回来的。**顺序约束**：先落地可见性再改次数，否则只看到「卡更久」。
- 两处有意偏离 TDD 原文（都是为了照官方，不是为了省事）：官方 `TurnErrorItem` **没有**续跑提示，所以失败行不自造提示句，只给一个「继续」按钮（填进输入框并聚焦，**不自动发送**）；没删 `restoreDraft()`（恢复草稿与「继续」两个出口不冲突，等真机反馈再收）。另：配对键不硬依赖 `retryId`，缺字段时用 `turn`+`retry` 序号兜底，避免整块重试行静默消失。
- 门禁：`1802 tests / 1793 pass / 1 fail`（既有 Windows `/tmp`）、`vue-tsc -b` 干净。⚠️ **未验收**：真实 524 时重试行在界面上的实际效果（本轮不做故障注入）；含 `llm/retry` 的那份真会话属于另一个工作区，还没在真日志上回放看到行。详见 [[开发/韭菜盒子Harness重试与失败对齐官方TDD-2026-10-03]]。

## [2026-10-03] Computer Use 接入（官方实验性 Cua Driver 原生提供方，设置开关默认开）

- 官方 Computer Use 是**两层**且**都发在 npm**：`@deepseek-ai/dsh-computer-use`（只占一个提供方注册位，无工具、无配置项）+ 一个提供方。提供方只有两个，**名字都带 `dsh-experimental-` 前缀**：`dsh-experimental-computer-use-cua-driver-native`（进程内原生，锁 `@trycua/cua-driver@0.28.0`）与 `...-cua-driver-mcp`（连本机已装的 `cua-driver` CLI）。**一次只能挂一个**，第二个注册会失败并报出已占用者名。
- 我们挂**原生**那个（不要求用户另装 CLI），两条条目走**同一个 `- insert:` seam**（顶层 `- name:` 会被 `applyEntryPatches` 按已有行匹配后静默丢掉）。开关 = `localStorage` 的 `jc_computer_use`（设置 → Computer Use，默认开），并进 `runtimeKey()` —— 否则关掉开关后旧 runtime 仍攥着桌面工具。
- 风险照抄官方口径：平台二进制走 optionalDependencies（win32-x64 **24.7 MB**，darwin-arm64 50.7 MB）**必须保留**；**原生与宿主同进程，原生崩溃可能终止 harness 进程**（要隔离就用 MCP 提供方）；截图走持久化附件、只有声明图片输入的模型路由收得到；挂载期间加固定指导文本 → token 与 KV 前缀变化一次。
- 已验证：`--dump-config` 退出 0 且 stderr 空、两条条目命中；**同一条 patch 真跑 `runner.mjs` → `ready` + `list-sessions` 正常 + 零 stderr**（无 `entry did not activate`）；提供方入口（`apply/inject/name`）与 `@trycua/cua-driver`（150 导出）均可加载；`attachment-local` 在组合里。聚焦 `1797 / 1788 pass / 1 fail`（既有 Windows `/tmp`）、`vue-tsc -b` 干净。详见 [[开发/韭菜盒子Harness-Computer-Use接入-2026-10-03]]。
- 未验收：真机让模型调 `cua_driver_native__*` 并接收截图（需一轮真实对话）；关开关后工具确实消失。

## [2026-10-03] Harness 运行时升到 0.2.0-rc.2（官方通道）

- 官方 `latest`/`next` = **`0.2.0-rc.2`**；我们原先锁在 `0.1.7-alpha.2`（`alpha` tag 至今就停在那）。现在 `src-tauri/resources/deepseek-harness/package.json` = `0.2.0-rc.2`。
- **升级换不到接口面**：官方 SDK 至今只公开 `initialize` / `session/prompt` / `shutdown` 三个请求与 4 个通知，与 `alpha.2` 逐字相同。我们的 5 处 vendor patch（会话读、权限切换、助手流、resume-stat）仍是必需——官方没开这个门，不是我们在自研。
- 升级的收益在**行为修复**：官方 0.2.0-rc.1 修了「工具调度异常后对话无法继续」并调整了过程展示默认值，rc.2 又优化了过程信息与耗时显示——正好是工作台 P1/P2 要处理的两件事，所以顺序定为「先升级，再按新版官方语义做 P1/P2」（见 [[开发/韭菜盒子Harness重试与失败对齐官方TDD-2026-10-03]]）。
- **版本已是单一真源**：`prepare-deepseek-harness.mjs` 从 `package.json` 读版本，不再另写常量；`deepSeekHarness.test.ts` 同时锁住「版本值」与「不得回写常量」两条。
- ⚠️ **npm 12 的 install-scripts 门禁会静默拿掉内置 Node**：`node` 包的 preinstall 被拦 → 打包里 `node/bin/node.exe` 不存在；`koffi`（`dsh-fs-local`、`dsh-session-persistence-jsonl` 的依赖）与 `node-pty` 同理。已在 `package.json` 写 pinned `allowScripts`，CI 可复现。
- 已验证：老会话格式仍是 **V4**（无 v5 迁移包），新运行时 `read-session` 出 **1832 个事件**、类型计数与升级前一致；`--dump-config` 零 `entry not found`；focused `1786 pass / 1 fail`（既有 Windows `/tmp` 用例）、`vue-tsc -b`、`oxlint` 干净。
- 未验收：真机 UI 全链路与三平台安装包。**524 不因升级变好**（上游/网关 ~126 秒零字节；与 [[log]] 2026-09-28 同源）。

## [2026-10-02] 本机链路公网化：图片改回 url（1 MiB 落库上限），H3 视频比例必须完整枚举

- **图片 502 的真因**：宿主任务插件把提交响应落库的上限是 **1 MiB**，2 MB 级 PNG 内联 base64 后约 2.8 MB → `task submit response exceeds size limit`。`comfy.plugin.js` **0.3.0** 改为显式 `response_format:"url"`，适配器 `config.yaml` 同时设了 `public_base_url: https://api.jiucaihezi.studio` + `default_response_format: url`。
- **VPS 侧把 `/files/` 打通**（否则回的是网页 HTML，客户端存下来的「图片」是 1573 字节的首页）：frps 加 `127.0.0.1:8796:8796` 映射，nginx `api.jiucaihezi.studio` 加 `location /files/ { limit_except GET HEAD { deny all; } proxy_pass http://127.0.0.1:8796/files/; }`。公网 HEAD 图片/视频均 `200` + 正确 `content-type`，`Range` 回 `206`（可拖动/续传）。
- **H3 参考生视频失败的真因**（`task_20261002_a0d3ccf9392e`，2 秒内 failed 且退款）：提交体里的 `aspect_ratio: '16:9'` 被节点 29 `ResolutionSelector` 拒（只认 `'16:9 (Widescreen)'`）→ `Prompt outputs failed validation`。适配器只记这一句（`node_errors` 挂在异常 detail 上，没进 message），ComfyUI 自己的 `comfyui.log` 才有节点级原文。
- 修法（三层收口）：`setAspect` 按模型枚举补全短式 → plan 入口 `validateSelectField` 拒短式 → 新增 `canonicalCreationRatio()` 在 comfy 视频提交体**出口**再收敛一次，兜住「旧版本存下来的计划被重试复用」这条绕过校验的路；认不出就不发（交工作流默认）。
- `comfy.plugin.js` 的失败原因原来 `String(body.error)`，而 `error` 是 `{message,type,code}` → 客户端一片空白（`[object Object]`）。已改成取 `error.message`；适配器侧也把 `node_errors` 压成一行塞进 `ComfyError.message`。
- **排障陷阱**：`comfy-adapter/logs/adapter.log` 是**混合编码** —— Python 写 UTF-8，`tools/cloud.ps1` 的 `*>> $AdapterLog` 追加的是**未对齐的 UTF-16LE**。`Select-String`/`grep 'task_...'` 一律 0 命中，直接 `Get-Content` 只是把 NUL 吞掉、看着像正常文本。
- ⚠️ **插件状态词表必须用 API 视图的词**（`comfy.plugin.js` **0.3.1** 修）：`adp/tasks.py` 内部状态机是 `running/succeeded`，但 `/v1/videos/{id}` 视图（`adp/api.py` 的 `_VIDEO_TASK_STATUS`）回的是 **`in_progress`/`completed`**。插件照抄了内部那套 → `completed` 判 `UNKNOWN` → 宿主不认终态 → 任务永远 SUBMITTED、客户端**一直转圈显示「排队中」**，而适配器早已 succeeded；只有 `failed` 两套拼写相同，所以**失败能看到报错、成功的反而卡住**。已修，并加**契约测试**直接读 `adp/api.py` 逐个状态词断言插件都认得。
- 配套两条排障口径：**App / 卡片上的 task id 是宿主生成的**（`task_nz5fZ7TS4DDc2Yc0VGW27rMbwfm0T1bk` 这种无日期随机串），拿它去 `adapter.log` 里 grep 搜不到 —— 适配器自己的 id 是 `task_20261002_<hex>`，只能按时间戳对齐；客户端轮询预算 **600 秒**，判不出状态时会在约 10 分钟后以 `[mediaTaskStore] _executeTask FAILED: 上游任务失败` 收场，那是**症状**而不是上游真失败。

## [2026-10-02] 灵动（满血）Seedance 2.5 上架：直连厂商的任务插件，面板默认视频模型改成 Sd 2.5 480P

- 灵动 API 的三条路径（`POST /v1/videos`、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`）与宿主 `openai_video` 的协议绑定**逐字相同**，所以这条线**没有适配器、没有隧道**：`newapi-plugins/lingdong.plugin.js`（0.2.0）直接打厂商端点，渠道密钥只进渠道。
- 5 条线路（面板分组 **满血seedance2.5**）：`cvk-2.5-480` 0.5/秒、`sd2.5-a` 0.5/秒、`cvk-2.5-720` 0.75/秒、`cvk-2.5-1080` 1.5/秒、`SD-2.5-特价` 2.5/次（**固定 30 秒、上游无分辨率参数、支持 21:9、提示词 12000 字**）。最初上架的是按次的 `cvk` / `满血-480p`（4–15 秒），用户当天换线删掉。
- **真机验收通过（2026-10-02）**：面板 `Sd 2.5 480P` + 4 秒出片成功，后台实扣 **2 元**（0.5/秒 × 4 秒对得上）→ 5 条全部 `verified`。
- 面板默认视频模型 = `Sd 2.5 480P`：默认值取的是 `availableModels[0]`，所以要「分组排最前 + 组内第一条」两处配合，并加了源码守卫测试钉住。
- 对外合同：[[运维/韭菜盒子灵动Seedance2.5API对外接入-2026-10-02]]。
- 顺带把山海适配器对齐官方契约：补 `scene`（有参考图 `image-to-video`，否则 `text-to-video`），成片地址改用任务返回的 `output.url`（只认同域，相对地址补全），写死的 `/media/runs/{id}` 降为回落。
## [2026-10-02] 本机 Qwen-Image 2.1 接回对外：插件加 openai_image 同步图片协议，并订正「显存不能交替」的错判

- 用户实测图/视频交替无问题，追问「显存装不下两套栈」的依据 → 复核后**我错了**：真实体积 H3 栈 ≈**40GB**（UNET 19.53 + 文本编码器 **14.61**（不是 32GB）+ 8 个以上 LoRA + 上采样 1.29）、Qwen 栈 ≈**23GB**（UNET 6.63 + 文本编码器 16.33），合计 ≈**63GB > 48GB** —— 「同时常驻装不下」成立，但**ComfyUI 用完会卸**（实测三笔跑完 `free 46.3GB`），交替只是慢一次重载。当年那次「卡死」的真因是**验证探针占住了唯一并发槽位**（任务排队 300 秒被拒），与交替无关；而撤下图片模型的直接原因是用户自己的产品决定（留视频、等独立机器）。
- 产物：`comfy.plugin.js` **0.2.0**（`jc-qwen-image-2.1` + `openai_image` 协议 + `image_count` 用量；图片走 `/v1/images/generations` 显式 `async:false` + `response_format:"b64_json"`；`parseSubmitResponse` 直接回 `immediate` 终态；`listArtifacts` 对图片返回空），夹具 10 → **19 例**（六个插件合计 93 例全绿）。
- 适配器加**换栈观测**：`stats.model_switches`（`/health` 可见）+ 日志 `栈切换 #N：X -> Y`；**不做卸载动作**（那是在应付臆想的问题）。`app.py --check` 四步全绿，重启后 `/health` 已带新字段。
- 订正文档：内部文档里「切换会把显存顶满、甚至卡死」那段与排障表那行（改成真实根因：探针占槽位）；对外图片文档「未上线」→「已上线」，并写明**图片/视频交替调用时下一笔会多几十秒**、`response_format` 固定 b64。
- **唯一未验**：图片是单个同步请求（`1080x1920` 约 35–50 秒），可能撞宿主的提交超时；退路是去掉那个同步开关改成宿主内轮询（预算 600 秒）。
- 上传又踩到一条宿主规则：**它对插件源码做静态检查，且扫整份源码（注释也算）** —— 图片同步开关的**点号写法**直接拒收（`unsupported plugin syntax ...`）。改成靠适配器默认（`default_async` 回落到 `output_kind == "video"`，图片天然同步），并在夹具里加了一条**源码守卫用例**逐 token 断言（这条守卫当场就抓出了我写在注释里的同一个词）。

## [2026-10-02] 本机 ComfyUI 云链路改成「开机自动就绪 + 每 5 分钟自愈」

- 用户问「关机再开机怎么让其他电脑用上本机 MiniMax H3」。查到底：**不是没配自启**（两个任务都有登录触发器，且本机 `AutoAdminLogon=1` 会自动登录），而是两条真因：① 两个服务任务的动作用 `cmd.exe /c ...` 包着，**桌面弹的黑窗口被点掉**就把 python / frpc 一起带走（退出码 `0xC000013A` = CONSOLE_CLOSE；证据：01:04 起好、08:33 两者同时死）；② ComfyUI 从来没进过启动项（它是 GUI，关机后没人开就永远没有 8188）。
- 修法：`comfy-adapter/tools/cloud.ps1`（一键起停/自愈/自查）+ `tools/install-autostart.ps1`（可反复重装的四个任务）。服务任务的动改成**隐藏窗口**的 `-Action run-adapter / run-frpc`；新增 `comfy-cloud-boot`（登录后 30 秒 `ensure-all`，含 ComfyUI）与 `comfy-cloud-guard`（登录后 120 秒起、每 5 分钟 `ensure-services`，只保适配器+隧道 —— ComfyUI 不进守护，否则你关掉它腾显卡会被反复拉起）。
- 日常自查一条命令：`cloud.ps1 -Action status`（三跳 + `/health` + frpc 最近连上时间）。
- 实测：从**服务器 NewAPI 容器内** `wget -qO- http://frps:8796/health` 拿到 `comfyui: ok` + RTX 4090；frps 日志 `new proxy [comfy-adapter] type [tcp] success`。未做真实出片（会占唯一并发槽与显存）。
- 两个 `.ps1` **必须 UTF-8 with BOM**：PS 5.1 读无 BOM 的 UTF-8 当 ANSI，中文乱码并报成「字符串缺少终止符」；另一个坑：`-RepetitionDuration MaxValue` 会被注册接口拒（0x80041318），XML 省略 `<Duration>` 才是无限期重复。

## [2026-10-01] 适配器收编为 NewAPI 任务插件：comfy / dola / boluo / rh 上线实测通过，shanhai / zx 代码就绲

- 根因：面板选中的画幅（`aspect_ratio` / `ratio` / `resolution`）与 `extra_fields` 被 NewAPI 的 `TaskSubmitReq` 白名单吃掉，只有 `metadata` 侥幸活着 —— 「选 4:3 出 9:16」不是偶发。修法不是打补丁，而是换**任务插件通道**（type 61）：`decodeRequest` 拿得到客户端原始 body，由插件决定发什么，原样送到适配器。
- 产物 `newapi-plugins/`：六个单文件插件 + 84 例夹具（已接入 `test:focused`）—— `comfy` / `dola` / `boluo` / `rh` 四个**已上传、已启用、已实测**，`shanhai`（Wave 3）与 `zx`（Wave 5）**代码就绲但未上传**。**适配器全部保留**：它们是执行器（comfy 的模板与 Topaz、dola 的 multipart 换字节、RH 的 `fileName` 令牌与节点发现、shanhai 的带 Key 成片、zx 的图片转文件字段），插件只是代理。
- 迁移做法比原方案更简：**不用新建渠道**，直接把现有渠道的类型改成 `Task Plugin` 并选上插件（也不会出现同名模型双渠道分流）。前提：那条渠道上每个模型都要被插件覆盖；RH 的 Custom Channel **不能整体改**（它还担着音频，宿主没有音频协议）。
- 实测：选 4:3 → ComfyUI 节点 29 = `4:3 (Standard)`（同一渠道走 type 1 时恒为该模板的默认值 `9:16`）。判定画幅只能用**非默认**取值，否则与兑底值撞车看不出来。
- 两个踩过的坑已写进方案 §3 铁律：① 声明 `openai_video` 的插件**必须**导出 `listArtifacts` + `buildContentRequest`，少一个直接拒收上传；② 先跑 9:16 那笔无法判定（模板 `defaults` 本身就是 9:16）。
- 今天第三、第四条铁律也是上传失败换来的：③ `meta.usageExamples` 里**每个例子都要带齐所有声明的用量 key**（`plugin meta usageExamples[0] facts missing key "seconds"`），推论是运行时 facts 也别省（没时长就报 0）；④ **宿主协议路径是封闭集合**（`openai_video` 只有 `POST /v1/videos`、`GET /v1/videos/:id`、`GET|HEAD /v1/videos/:id/content`）—— 面板 `endpoint` 不在这张表里的模型根本收编不了，`doubao-seedance-2-5-260628`（发到 `/v1/video/generations`）因此**有意不进** zx 插件。
- `openai_video` 的成品由**宿主的 artifact 通道**下发，所以插件的 `render` **不要**透适配器返回的相对成片路径（那是上游任务号 + 要带 Key）：shanhai 与 zx 的 Omni 都改成打回适配器的带 Key `/content`。
- 对外影响（待办）：插件通道下宿主会移除响应里的 legacy `task_id`，对外合同要改读 `id`；dola 对外文档写的参考图上限 30 与上游/适配器的 **9** 不一致。

## [2026-09-29] Harness 失败轮次按官方 Session 投影到工作台

- 根因：Harness 的 `turn/end(reason.kind=error)` 已持久化在官方 Session，但工作台失败分支只把错误写入临时 `MemoryRun`，随后清掉 `userTurn`；失败轮次因此从 UI 消失，而同一 Session 仍可由“继续”接上。
- 修复：失败时补读同一 Session，按本轮用户消息 id 关联 `turn/end(error)` 的 `code/message`，保留官方用户轮次和工具过程；UI 在过程区显示“任务失败”及原因，不伪造 assistant 正文、不写旧 Raw、不重放工具。
- 边界：本轮只对齐官方失败 Turn 投影；不引入任务账本、不要求所有任务跨重启恢复、不扩大自动重试策略。模型请求的官方 retry 仍按现有 Harness policy 执行。
- 验证：新增失败轮次投影用例通过；focused runner `1664 passed / 0 failed / 18 cancelled`，18 项为既有 Desktop Remote 连接测试取消。

## [2026-09-28] `deepseek-v4.1-flash-0910` 在上游已退化：首字 16s–2m49s

- 现象：Harness 对话经常「静默一分多钟」然后 `524 statu…`。先怀疑过 Provider 设计、请求太大、Cloudflare 网络抖动，逐条被排除。
- 定位靠四方日志对齐（NewAPI 日志 + 上游日志 + 本机 Session zstd + pi-ai 源码）：**同一渠道 #114（小易-DeepSeek-0.23）、同一上游、同一台机器，唯一变量是模型 id**。
  - `deepseek-v4.1-flash-0910`：首字 16.6s / 25.9s / 40.0s / 1m16s / 1m47s / 2m49s，1–2 t/s
  - `deepseek-v4.1-flash`：首字 3.2 / 3.3 / 3.7 / 4.3 / 3.9 秒，77–99 t/s
- 已排除：请求本就是流式的（pi-ai `openai-completions` 固定 `stream: true`）；输入不超标（`缓存 ↓ 54,528 / 输入 54,741` = 命中 99.6%）；Cloudflare 524 只是**判决书** —— 首字一超过 100 秒就被掐，病因在模型版本。31 token 的小请求一样慢，所以与请求形状无关。
- 结论：**不是 Provider 设计问题，一行代码都不用改。** 给 NewAPI 的动作是把 `deepseek-v4.1-flash-0910` 下架，默认用 `deepseek-v4.1-flash`。已撤回「加 `streamIdleTimeoutMs: 90000`」的提案 —— 上游首字能到 2m49s，固定秒数看门狗会误杀最终会成功的请求。
- 配套：过程行现在显示每秒跳的耗时与上游重试原因，所以这类等待能直接看出「是上游慢，不是死了」。

## [2026-09-28] Mobile V2 定案：Desktop Gateway + 可靠同步 + Mini Relay

- 现行合同改为 [[开发/韭菜盒子Mobile控制Desktop-Gateway与Mini-Relay统一合同TDD-V2-2026-09-28]]；旧局域网合同保留 P0/P1/P2 与真机排障证据，但其 fire-and-forget 全量投影、Vue `watch` 发布、无断档补拉和 P3–P5 顺序不再定义终态。目标是手机控制**韭菜盒子 Desktop 的 Harness 对话**并达到 Codex 手机版级别的远控闭环，不是直接接管官方 Codex Desktop App。
- 真机新证据是“Mobile 上行命令已让 Desktop 执行，手机没有反应”。根因边界不是 Harness，而是缺少独立 Gateway：当前 `accepted` 早于 run 建立，发布失败被吞，Mobile 不识别 seq gap，远程状态又依赖页面响应式生命周期。
- V2 采用 OpenClaw 的单常驻 Gateway/typed req-res-event/hello snapshot/版本恢复，采用 Happy 的 `localId`、receipt、游标补拉、前台恢复与 E2EE；Harness Session 仍是唯一历史真相，不引入第二 Agent、第二会话库或多渠道系统。
- 阶段固定为 G0 红灯 → G1 LAN 真机控制闭环 → G2 V2 信封/可靠同步与持久 ledger → G3 完整 Session 控制面 → G4 Mini Relay → G5 常驻/推送/发布。当前 LAN 仍是 V1 信封；G0 行为红灯已复现并在定向测试中转绿。G1 已有手机即时 pending、runId 回执、进程内去重、主动补读、attach 原型、应用级共享运行状态/发布和终态后官方历史补读；推送乐观轮次不再提前清除 pending，较新 attach 快照也不再被缓存旧事件覆盖。Desktop App 已改为启动时绑定应用级 Host，远程发送/停止/审批不再调用页面闭包，本地与远程共用 Harness 进度函数和 run 表；重复停止不再改写已完成结果，手机在任务结束后仍展示已收到的工具步骤。但 `watch` 发布与旧官方历史/持续流式竞态尚不能证明完整快照一致性，页面卸载后的真实 Harness+Noise TCP、纯工具轮完整闭环、故障补读和 iPhone 真机未验收，故 **G1 未完成**。G2 只有 epoch/序号、断档和前台恢复的部分原型；V2 信封、持久 ledger、跨重启 uncertain 均未完成；G3–G5 未实施。
- G1 最新增量：停止后的异步准备不再启动 Harness；Mobile 可显示 Desktop 临时用户轮次；空闲时每 10 秒兜底补读，避免电脑主动任务丢推送后手机永久无反应；低序号旧快照不能覆盖新投影；官方历史没出现本次用户轮次前不清临时态。focused `1648/1648`、Desktop/iOS quick build通过。这些不代替真实 Noise TCP→Harness 和 iPhone 闸门，G1 仍未完成。
- G1 又补掉一个丢推送后的卡死路径：Desktop 切换对话但 `context.changed` 丢失时，手机在旧 Session 读到 `SESSION_NOT_CURRENT` 后重新取 context/attach；电脑未打开对话时改为等待提示并继续侦测。状态机/UI 定向 `43/43`、focused `1653/1653`、Desktop/iOS quick build与产物审计通过；G1 真机闸门仍未过。
- 真机联调暴露 Desktop G1 新 `commandId` 合同与手机旧安装包不匹配：Noise 已连接，但旧 iOS 请求无 `commandId` 且发送错误未上屏；新版 iOS arm64 debug 包已构建、审计并覆盖安装到连接的 iPhone，等待重新发送只读消息确认。这是部署版本边界，尚不能写 G1 通过。
- 后续截图与日志确认粘贴配对其实成功，红色相机报错是旧错误残留。真正的下一处根因是长对话快照约 187 KB，超过 Noise 单帧 64 KB 上限，旧 Bridge 写失败后无声挂住。真实 Noise 红→绿测试覆盖双向 180 KB，认证 Gateway attach 大快照也通过；已加分块、8 MiB 总量上限和读取超时。手机状态页增加已连接但会话未进入时的重试，不再诱导重复配对。focused `1654/1654`、Rust `450 passed / 1 ignored`；新版 iPhone 包已构建并安装，真机复测待完成，G1 未通过。
- iOS 扫码还有独立权限缺口：已安装的 barcode-scanner 插件在 iOS 14+ 的 `scan()` 只检查权限、不自动申请；Mobile ACL 原先也没有开放 request-permissions。现扫码前显式申请，粘贴路径保持无相机依赖；权限红测转绿，新 iPhone 包已构建、审计并安装。真实扫码与发送/回传仍待用户确认。
- Rust 已新增复用生产认证连接循环的真实 TCP/Noise 假 Mobile 测试，覆盖授权设备认证、attach、发送、过程/终态推送与丢事件后纯工具轮补读；Rust 全量 `450 passed / 1 ignored`。执行端仍是假 Runtime，WebView→真实 Harness 和 iPhone 闭环待验，G1 仍未完成。
- 旧官方历史判定又补一条时间边界：若页面历史少载、用户重复相同正文，不能只凭正文和轮次数量清掉手机 pending；必须看到不早于本次发送的官方用户事件。focused `1648/1648`、Rust `450 passed / 1 ignored`、Desktop quick build通过；失败 attach 的空订阅回滚已由真实 Noise 测试确认。

## [2026-09-27] Mobile 桌面控制器已打通至真机最后复测

- 用户确认 [[开发/韭菜盒子Mobile桌面控制器统一合同与局域网MVP-TDD-2026-09-27]]：现有 Mobile 独立工作台继续冻结，解冻的只有 Desktop 控制器；Desktop 是 Harness Runtime、模型/密钥、Skill/MCP、项目文件和 Session 的唯一所有者，Mobile 不运行第二套 Agent。
- 首期只做局域网当前活动项目/当前活动 Session：扫码配对且 Desktop 必须确认、读取权威历史、订阅过程、发送纯文字、停止和审批。iOS 先行；全部项目/对话导航、公网 Relay、推送、媒体/文件和 Android 后置。
- 安全从首期生效：一次性二维码最长 5 分钟、每设备独立身份与可吊销、连接加密和重放保护；不以“同一局域网”代替认证，不先上明文协议。
- P0 已完成：协议/配对与 Desktop Host 新增 11 条红测，旧代码先因模块不存在失败，最小纯内存实现后新增 `11/11`、完整 focused `1561/1561`。
- P1 Desktop 端已完成：默认关闭的 Rust/Tauri 随机端口监听、Noise XX 加密、一次性二维码 + 本机确认、钥匙串身份/设备、吊销、帧/连接/频率/重放限制、单调启停代次，以及当前 Session 的读/订阅/发送/停止/审批桥；设置页可开启、配对与吊销。远程发送不夹带桌面输入框附件、文件引用、编辑态或 Jev。
- P2 iOS 控制器、扫码/粘贴配对、电脑审批、加密连接、手机收发与逐字同步已完成真机联调；提交 `831ee593` 修掉二维码、macOS socket、空闲超时、断线状态、事件序号与重复监听等问题。
- 最后一处 `session not found` 的根因是目录新对话早于官方 Harness Session：Desktop Remote 现先用官方 `session/list` 判断，未创建时返回空快照，首条手机消息再按既有链路惰性创建 Session。focused `1611/1611`、Rust `447 passed / 1 ignored`、Desktop/iOS quick build及产物审计通过；修复后的 iPhone 闭环待复测。

## [2026-09-27] 「保存到项目失败」的真因：`pollTask` 的 content 端点判据有四处各写一份

- 现象：comfy 成片生成成功（适配器 `static/` 里已有 15.4 MB 文件、任务 `task_20260927_4fed141a05f7` 执行 596 秒），但「保存到项目」永远失败：`HTTP 下载失败: error sending request for url (http://frps:8796/files/…mp4)`。
- 根因：`frps:8796` 是 **frp 隧道出口端口**（`frps.example.toml` 的 `allowPorts`），只在 Docker 网络内可达，桌面客户端解析不了 `frps`。而“要不要走 NewAPI `/v1/videos/{id}/content` 回收”这个判断**写了四份且互相矛盾**：首轮轮询（`creationMediaRuntime.ts`）用 apiStyle 白名单（`comfy-*` → 走 content）；保存/重试/刷新路径（`mediaTaskStore.ts`）只认 omni 或硬编码 `false`。于是对 `comfy-video` 两边结论相反，保存时把已经正确的 content 地址**换成了适配器的内网地址**。
- 修法：`usesNewApiContentEndpoint()` 成为唯一判据（`creationMediaPlan.ts`），四处 `pollTask` 调用点与重试守卫全部改用它；`normalizeAuthenticatedVideoResultUrl` 不再看旧地址长得对不对，而是**按已知的上游任务号重建** content 地址——这样已经被写坏的任务点「重试保存」也能救回来。
- 排障路径（可复用）：`%APPDATA%\com.jiucaihezi.desktop\data\jiucaihezi.db` 的 `kv_store` → `jc_media_tasks_v1`（**双重 JSON 编码**，要 parse 两次）里有 `resultUrl`/`upstreamTaskId`/`pollUrl`/`planSnapshot.apiStyle`，比猜快得多；适配器侧看 `comfy-adapter/logs/adapter.log`。
- 验证：新增 5 条用例（唯一判据单元测试、四处调用点契约、内网地址重建行为、失败必须走失败分支、保存单一互斥点与终态）；完整 focused `1550/1542/0/8`、Rust `422/0/1 ignored`、`vue-tsc -b`、lint、差异检查通过。**真机已验收**：11:05 那个新任务与 10:18 那个被写坏的旧任务**都落盘了**，旧任务的成片与适配器产物**逐字节相同**（15,386,931 bytes）。
- 验收同时暴露两个**独立缺陷**（不是本修复引入，但以前那个永远失败的地址让它进不到下载阶段）：① 同一任务会**并发下载**（实测项目目录里同时有两个同任务 `.part` 文件）；② 后到的失败会**覆盖“已保存”状态**——文件已在项目里，卡片却显示 `保存到项目失败：读取下载数据失败: error decoding response body`。两者均已根治：① `savingTaskIds` 收成**单一互斥点**，`assetStatus === 'local'` 且已有路径时直接返回；② 根因是 `downloadAndPersistMediaAsset` **吞掉自己的异常**并写下半截状态，上层 `completeMediaTask` 又按“成功”写了另一半（DB 里出现 `progressText=完成` + `assetStatus=remote-only` + `errorMsg=保存到项目失败` + `projectPath` 为空的自相矛盾记录），现在下载异常一律上抋、失败状态只由 `handleAssetDownloadFailure` 一处写，`markWebMediaPersistenceFailure` 不再把已是 `local` 的状态降级成 `remote-only`。
- 保存阶段的**进度反馈按用户 2026-09-27 决定不做**（已实现的 Rust 事件 + 前端订阅已回滚）。但事实仍记录：14.7 MB 走“客户端 ← Cloudflare ← Nginx ← NewAPI ← frp 隧道 ← 本机”实测 **3 分 11 秒**（≈ 80 KB/s），没有进度时慢与卡在界面上无法区分。
- 比对基准：适配器 `public_base_url` 指向 Docker 内网名时，客户端**取不回 `metadata.url`**；唯一正确通道是 `GET /v1/videos/{task}/content`（15 MB 级文件走这条链就是分钟级）。

## [2026-09-27] Harness 的过程与推理改挂到轮次上

- 根因不在运行时而在投影层：同一批 Session 事件，官方投影成结构化会话节点，我们只留了正文。`deepSeekAssistantText` 只取 `text` 块（丢掉 `reasoning`）、`applyDeepSeekAssistantStream` 只认 `text-delta`、`deepSeekProgress` 只给 `{id,label,state}`，所以**纯工具步（`blocks=[tool-call]`、无正文）根本不产出 turn**——真样本里一整轮 10 个工具步、11 次工具调用、约 1 分钟，在产品里完全不可见。
- 第一档只动投影与显示：新增 `deepSeekAssistantReasoning` / `deepSeekMessageUsage` / `deepSeekSessionProcess` / `deepSeekSessionReasoning`；`deepSeekProgress` 补参数摘要、`startedAt`/`endedAt`、`resultText`（截断 4000 字）、`errorReason`；UI 在轮次内渲染 Think 折叠行与工具行（摘要 + 时长 + 展开结果），过程不再只在“正在运行”时可见。**运行时 0 处改动**。
- 三条合同由真样本（本机工作区 `D:\0925测试`，经官方 `session/read`，未解析物理文件）确定而非推测：事件顺序是 `step/start` → `assistant/message` → `tool/call` → `tool/result` → `step/end`，所以按 `{turn, step}` 归并；参数键实测为 `file_path`（`read`/`read_image`，**不是** `path`）、`path`+`pattern`（`glob`）、`command`+`description`（`pwsh`）、`name`（`skill`）；失败的 `tool/result` 可以 `isError: true` 而 `error` 整个是 `undefined`，失败原因必须回退到结果正文首行。
- 过程**不需要新的持久化格式**：Harness 对话本来就以 Session 为唯一真相（`mergedHarnessTurns` 每次打开重建），所以按 UI 轮次侧存即可，`ConversationTurn` 与旧 Raw 序列化格式不动。工具步骤只从 `tool/call`+`tool/result` 事件取、按 `callId` 配对，不解析 message 里的 `tool-call` 块（同一 callId 两处都出现，只好事件源天然避免渲染两遍）。
- **归属必须落在“本轮发起人”（该轮的用户消息）上，不能落在 assistant message 上**：纯工具步没有正文、不产出 UI 轮次，挂在它上面就等于过程永远不可见——而那正是本轮要修的东西。没有真人发起人的注入式轮次退回该轮 assistant message id 兜底。过程与 Think 行因此渲染在用户轮次的正文之后（「问 → 它做了什么 → 答」）。
- **上游目前不产生推理**：真样本 16/16 `assistant/message` 无 `reasoning` 块、嵌入式 stream 无 `reasoning-chunks`。根因指向 route patch 未声明 `reasoningEfforts`（`gpt-5.6-sol` 不在已安装目录里，而 `dsh-llm-pi-ai` 的规则是“省略该字段时保留已安装目录条目的能力”）。Think 行因此是矦眠的，要让它出现得先单独决定要不要开推理。
- 验证：新增 11 条用例（含真样本 fixture 断言）；定向 `121/121`；完整 focused `1545/1537/0/8`、Rust `422/0/1 ignored`、`exit=0`；`vue-tsc -b`、lint、`git diff --check` 通过。**真机已验收通过**（过程行与刷新后保留），Think 行仍休眠（上游不产生推理）。
- 查事件 schema 不要再上网：官方全部包就在 `src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/`（`dsh-session`/`dsh-llm`/`dsh-agent` 的 `lib/types/*.d.ts`）。

## [2026-09-27] macOS 公证改为逐层签名并以 Accepted 为唯一成功条件

- `v2.2.3` 修复两个 Mac 架构共同的公证失败根因：App 内 231 个 Mach-O 原先没有由内向外签名，bundled Node 还继承了发行包禁止的 `get-task-allow`。现由 `scripts/fix-macos-app.mjs` 逐层签名，Node 使用不含调试权限的专用 entitlements，外层 App 最后签名并执行 `codesign --verify --deep --strict`。
- CI 不再把 `notarytool submit` 的零退出码直接当作通过；只有 JSON 状态为 `Accepted` 才 staple，并追加 `stapler validate`。被 Apple 拒绝时立即打印公证日志并失败。ARM 与 Intel 都先生成 `.app`、完成嵌套签名，再制作 DMG 和公证。
- Mac 冒烟测试只在 `Contents/MacOS` 查真实 OpenCode sidecar，不再把普通资源里的 `opencode.js` 误判为违规二进制。本地完整 focused `1525/1525`、Rust `427/427`（另 1 项人工检查 ignored）、Desktop 构建审计及本地 ARM ad-hoc 深度验签通过；Developer ID 时间戳与 Apple `Accepted` 以正式 CI 为准。

## [2026-09-26] Harness 能否看图，取决于路由 patch 的模态声明

- `route.cordis.yml` 里 `models[].input`（合法值 `text` / `image`）是官方唯一开关。不声明时官方取 `DEFAULT_INPUT = ["text"]`：图片既不内联进请求，`read_image` 也会点名拒绝（`does not declare image input`）。实测一次「查看图片内容」因此变成 11 步工具乱找 + 6 次上游 429/524，**973.7 秒后 524 失败**。修法：`imageInput` 由 `resolveModelInputModalities` 传入，只在为真时写 `input: ["text","image"]`，并进 `runtimeKey`。
- 两条配套：模型不支持视觉时 `deepSeekContentBlocks` **不发图片块**、改发降级文案（发块等于给模型一个它用不了的附件 id，正是乱找的起点）；`llm/retry` 的 `failure.code/message` 已上运行状态行。
- 官方图片预算在请求侧：每图 1 MiB 原始字节、总像素 2048²、每请求 20 MiB base64，超预算由 `dsh-compaction-image-offload` 最老优先卸载并写 `image/offload` 事件。客户端不需要再压一遍；排障先看 `%APPDATA%\com.jiucaihezi.desktop\deepseek-harness\workspaces\<hash>\sessions\*.jsonl.zstd`（多帧 zstd，需按 magic 切帧解）。

## [2026-09-24] Harness Session 成为对话真相，`.raw` 建库改为可选

- Desktop 已删除 `@DH` 按钮、芯片和选择态，所有对话自动运行 Harness；`@排版`、`@影音`、`@MCP`、`@3D` 已通过官方 `dsh-mcp-client` 进入同一个 Harness Session，并复用韭菜盒子既有执行器。旧 `dh-session-v1` 仅用于迁移识别。
- 524 属于 Harness 官方 `SERVER` 可重试错误；现行策略保留 `SERVER` 且 `maxRetries: 1`。本轮不增加 Harness 外层整轮定时器，避免误杀合法长任务。
- **订正（2026-09-28）**：本行原先写「官方 Provider 没有主请求首 token 超时配置」——**这句是错的**。`dsh-llm-pi-ai` 的 provider profile 有 `streamIdleTimeoutMs`（默认 `300000`），实现是 `idleWatchdog(…).next(iterator)` 包住**流的每一次等待**，首字节之前就已启动，超时抛 `TIMEOUT`（本就在可重试码里）；另有 `timeoutMs` 与 `transport: sse|websocket`。也就是说：上游一个字节不给时，官方默认允许我们等 5 分钟，而 Cloudflare 的 524 在 ~100 秒先到——**我们一直没有自己的判据，是在等别人报错**。要看全链路证据见 [[log]] 2026-09-28 条目。
- 用户确认 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]：打开项目即可聊天，不再先创建“记忆空间”；Harness Session 独占完整对话、工具轨迹、持久化与压缩，韭菜盒子只保存对话标题、排序、工作区和稳定 Session 映射。
- 现有文件树“建立改编 Wiki”按钮在原 Wiki 骨架之外补 `.raw/文档|图片|视频|音频`；未建库仍可文字聊天。本期不顺带重写既有 `.raw/jc-media` 媒体保存链路。
- UI 的“记忆”和“查询”按钮及后端 `.raw/记忆索引`、`memory_search` 预取、最近三轮拼装整体退役。正式 Wiki 仍是项目文件，按用户选择的文件/Skill/MCP 能力读取，与 Harness 对话上下文分层。
- 对话下拉继续保留。新对话固定映射 `jc-v1-<conversationId>`；旧 `.raw/对话记录` 在用户首次打开时一次移交，成功后只续写 Harness，Raw 保留为只读历史证据，不双写。
- 无缝显示不能只靠当前 SDK 的 `run()`：实施第一步必须用官方 `sessionQuery.listSessions/readSession` 把持久 Session 投影回现有聊天 UI；在完整历史可恢复前不得停止旧 Raw 读取，也不得自行解析 `$DSH_HOME` 文件。
- 当前 SDK 没有单 Session 删除方法：删除对话先移除 UI 目录映射，不私自解析 Harness 存储；等官方接口具备后再接物理回收。
- 生产迁移已完成：官方 Session Query 薄桥、Session 正文投影、AppData 按项目隔离、轻量对话目录、打开即聊、旧 Raw 惰性移交、Harness 成功后停止 Raw 双写、逻辑删除和一键建库四类目录均已接通。
- 旧索引 UI、摘要请求、`.raw/记忆索引` 生产实现、`memory_search` 与固定最近三轮拼装已退役。旧 Raw 解析仅为迁移保留；既有索引文件继续隐藏和保护但不再读取。
- 旧记忆系统纪念封存位于 `/Users/by3/Documents/韭菜盒子-旧记忆系统纪念-2026-09-24/`，不受生产退役影响。
- Harness Runtime 不再是可被任意异步读取替换的应用级单例：现按项目工作区持有，同项目共享启动，跨项目 Session 读取不会关闭正在执行的进程；取消只关闭所属实例。定向 `101/101`、完整 focused `1509/1509` 与 TypeScript 通过，真实 Desktop 跨项目并行待人工验收。
- Harness 判定必须按会话收敛：`subagent`（子代理）事件与主会话共用同一条通知流，`runner.mjs` 曾把子会话的 `turn/end` 失败当成本轮结论——实测一轮 34 分钟正常跑完、20 集全部落盘，却因一个早已失败的子会话报「处理失败」（失败分支还不落盘该轮）。现 `runner.mjs` 只认本会话的 `turn/end`。
- 官方 `sdk` 基线的 `subagent` 默认 `backgroundMode: continuable`（该模式下 `run_in_background` 默认 true，父代理只拿到 “started subagent <id>”，于是误判完成、重复派活——实测 `1.md`/`3.md` 各被写两遍）。已在 route patch 按官方字段收口为 `one-shot`，让调用等结果并回传失败；patch 按顶层键整体替换 `config`，必须给全量 `provider`/`toolName`，`subagent_fork` 基线本就是 `one-shot`。
- **Harness 工具面以官方为准**：`--profile sdk` 默认启用的 24 个官方工具（含 `web_search`/`web_fetch`/`subagent`/`workflow`）全部对模型可见，官方自带的工具不增不删、不按工具做产品级开关，官方新增默认生效，产品只补中文标签；自家能力（`@排版`/`@影音`/`@3D`、外部 MCP）走官方 `dsh-mcp-client` 挂载。与 2026-08-07「Web Search/Fetch 不做」不再冲突（那条针对自建工具）。工具清单、偏离登记（provider、重试 1 次、MCP 超时 900s、`@文件`→权限模式等）与 4 处待上游收口的 SDK vendor patch 见 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24#12. 与官方 Harness 的关系]]。

## [2026-09-23] @DH 改由官方 SDK Client 持有 Runtime

- 五分钟无结果的直接原因是 Provider 两次约 125 秒后返回 524，再被 `maxRetries: 5` 放大；集成根因是前端自写 JSON-RPC 生命周期只在 `session.status=idle` 时收尾，Helper 退出后等待 Promise 不会结束。
- Runtime 与 Client 已统一到官方 `@deepseek-ai/dsh-sdk-client@0.1.7-alpha.2`：bundled Node 的薄 bridge 只转交任务与通知，SDK 负责 Harness 子进程、订阅、退出、stderr 与错误传播；自动重试降为 1 次。
- 明确 `@文件` 已加载的正文与转换文档会进入首个 Harness prompt，不再先让模型逐个 `glob/read`。流式补丁仍只负责展示 `text-delta`，不承担生命周期。
- `@文件` 是明确的本机文件全权开关，给官方 Harness 传 `DSH_PERMISSION_MODE=danger-full-access`，关闭则恢复 `workspace-write`。权限模式进入 Runtime key，切换时不会复用旧权限进程。
- Harness 不套用普通模型的最近三轮合同：一个对话固定映射到一个 `jc-v1-<conversationId>` Harness Session，连续轮次只发送当前消息，由官方 Session 保存完整事件历史并负责 Compaction；旧 Raw 仅在首次迁移时完整移交。
- SDK Server `0.1.7-alpha.2` 首次见到持久 Session 时原本只会 `agents.create()`，现用官方 `sessionPersistence.stat()` + `agents.resume()` 补齐恢复；移除随机 nonce。停止时完整等待官方 `close()` 的有界回收梯子，不再 2 秒提前杀外层 runner 并遗留子进程。
- 本轮定向 `106/106`、`vue-tsc -b`、构建补丁连续两次幂等及 `git diff --check` 通过；完整 focused 仍有本轮前已存在的 Jev 源码形态断言与两项未登记测试清单失败。真实 Desktop 跨重启续接和简单文件任务耗时待人工验收。

## [2026-09-22] 文件写入收回任务事务 Runtime

- 用户确认核心目标不是“更好地标记失败”，而是让已经理解清楚的文件任务稳定成功。现行实施合同定为 [[开发/通用记忆工作台任务事务Runtime合同-2026-09-22]]：模型负责语义判断与变更提案，Runtime 负责账本、写入、读回验证、恢复与程序收尾。
- Skill Creator 是第一个适配器：草稿仍在 `.raw/jc-media/文档/skill-<id>/`，但不再让模型转调 `write/edit/write_text_batch`；Runtime 写回、验证后冻结快照并出现有安装卡。
- `@文件` 的“开关即全权”授权合同不变；执行改为公共事务内核。简单任务只用内存，只有分批/跨重启长任务才惰性创建 `.raw/临时任务/<run-id>/manifest.json`；对话 Raw 仍只存已完成的可见对话。
- Skill Creator 已由 Runtime 完成草稿提交、读回验证、冻结与出卡；`@文件` 的项目内 UTF-8 文本 `write/edit/write_text_batch` 已接入同一事务内核：副作用前写 manifest、写后精确读回、整批全部通过才程序收尾，完成即清理临时账本，失败账本保留。
- 尚未实施的是目录枚举后的模型分批调度、Office/PDF 规范化和跨重启自动续跑；这些继续沿用同一 manifest 合同增量补齐，不另建第二套 Runtime。

## [2026-09-19] 故事拆分自动识别不再被目录页拦下

- 用户实测《三国：中兴大汉，蜀之浪漫》：通篇 `# 第N章` 却报「未识别到边界」，只能手
填标记词。根因是候选打分按**条数**比分数，而 EPUB 目录页写成 `1. [第1章 …](#anchor)`，
条数和正文章节几乎一样多 → 两套规则「接近但位置不同」→ 直接拒绝导入。
- 现在规则按可靠度分层：**明确章词（第N章 / Chapter N）> markdown 标题层级 > 裸编
号**，只有同一层才判互斥。另外：目录行（页码导引线 `…… 6` 或锚点链接）自动规则与
手填标记词都跳过；卷不单独成节点（有章时按章）；边界行必须是标题，行首撞上单位词的
长句不算章节。
- 报错会点名冲突的两种写法，作者改为先看文件名、再读简介区的 `作者：` 行（AnyDoc 不
解析文档元数据）。
- 真样本：《三国》自动识别与手填「章」**逐节点路径完全一致**（101 节点）；真实 PDF
工具书从 138 节点（裸编号胜出）变为按章拆。定向 `25/25`、focused `1417/1417`、
 `vue-tsc -b` 通过；「章与幕混排」的工具书（正文段落以「第一幕是开端…」开头那种）
仍需人工确认。

## [2026-09-19] 故事导入补齐：格式真源、文件夹批量、长书分段

- 文档格式清单现在只有一处真源 `src/utils/documentFormats.ts`（等于 anydoc 0.2.3
 的 20 个扩展名），附件分类与故事导入共用同一份。
- 文件树里**选中文件夹**再点「故事拆分」= 批量导入：可导入的文档排队，弹窗显示
「第 N / 共 M 本」，每本都要看过预览才写盘，出错可以「跳过这一本」。
- 书名不再等于文件名：`书名(作者).epub` 这类写法会识别出作者，书名与作者都能在
预览里改，改完按新名字重建计划。
- **重导此前是彻底坏的**（上一版登记的「幂等，老节点跳过」不成立）：冲突闸门同时
覆盖 `原文.md`、`来源.md`、节点三处，任何重导都被整条拦下。现改为受控刷新——`原
文.md` 仅在纯追加时覆盖；`来源.md` 只刷新 Runtime 自己生成的记录
（`type: story-source`）并原样保留标记 `<!-- jc-story-source -->` 之后的用户笔记
；节点仅在正文是旧正文的延长时刷新（`source_range`/`source_hash` 本来就变，不参
与比较）。因此**正文只能追加，不要回头改写已拆过的旧章节**。
- `prepare_story_analysis` 加 `startOrder` 与 `progress`（`total`/`analyzed`/
 `remaining`/`nextOrder`）：1492 章的书可以只处理某一卷、某五十章，`nextOrder` 只
往前走，不会往回跳。
- 验证：故事导入与节点分析定向 `31/31`、文件树 `35/35`、完整 focused
 `1414/1414`、`vue-tsc -b` 通过；真实超长书分段推进、Web/Mobile 线上 EPUB 转换
（**需要重新部署 `document-converter`**）待人工验收。

## [2026-09-19] 文档转换白名单对齐引擎，EPUB 打通

- 格式清单散在三处（云端 `document-converter/src/converter.py`、前端 `useFileUpload.ts` 的 `OFFICE_EXT`、文件选择器的 `accept`），三处都落后于引擎：云端漏 9 个、附件链路漏得更多。`.epub` 以前在文件选择器里写着、传上去被 415 拒。现按 anydoc `0.2.3` 的 `Format::from_extension` 逐条对齐（20 个，**不含 `.csv`**——它走前端文本直通）。
- Desktop 一向不走白名单（内容识别），所以 `.epub` 在已安装的桌面版本就能转；卡住的是 Web / 移动端，**需要重新部署云端服务**才生效。
- 真 EPUB 实测：引擎 0.39s / 542 万字；本地服务 POST 得到 200 / 0.52s；拆分器 + 标记词「章」得到 1492 章，短名干净。注意这类 EPUB 走自动识别会被主动拒绝，**必须显式指定标记词**。
- 新手指南（`jc-new-user-guide`）三处格式列举已加 EPUB。**`attachment-processor`（8091）不做对齐**：该服务 2026-06-28 已停用、前端适配层已删、无调用方，且它的 Office 分支依赖本仓外的 LibreOffice 系 8090 服务，EPUB 在那边本来就读不了。

## [2026-09-19] 知识型资料有了专用沉淀规则

- `wiki-memory` 新增 `references/知识资料沉淀规则.md`（技术书/论文/规范/内部文档），与 `故事资料沉淀规则.md` 并列、由 `SKILL.md` 路由。复用来源树与拆分链路，只加 `知识/` 横向层：**术语索引只放「概念 → 节点」映射不放定义，速查只放决策规则/阈值/气味**；术语与框架先留分析页不建实体页，复用多了再提升。
- **知识型物料不走 `commit_story_analysis`**（它的字段与目录为故事资产设计），分析页由模型直接写；补偿是 `source_hash` 从原文节点原样复制、自己维护节点分析 `index.md` 与父级登记。
- 真实书实测两条纪律：① 目录页会被当成章节边界（17 章的书拆成 34 个节点，报重复编号 + 倒序），**拆前必须剔目录**；② **不要依赖自动识别**——同一本书自动识别给出 138 个节点（正文行首裸数字胜出），用标记词「章」才是 17 章。
- 顺带修了一个拆分器 bug（`ac1058c7`）：有前置内容的稿件生成的 `原文节点/index.md` 会写出两个 `## 页面` 标题。

## [2026-09-19] 通用 Wiki 骨架新增创作规划层，jc-novel 对齐现行合同

- `wiki/创作/` 成为故事类项目的**创作规划层**：一个项目一部作品一个，与 `改编方案/` 同级，放世界设定、大纲、逐章/逐集规划、伏笔、市场分析与包装文案。**通用合同只定三件事**：只在第一次产生真实内容时创建；必须有 `创作/index.md` 并登记本目录页面；页面文件名由创建它的 Skill 按项目类型定（小说写「章纲」、短剧写「集纲」是同类不同名），读取时以 index 登记的真实文件名为准，**不得凭名称推测**。规划层是模型产出，不走两阶段沉淀、不生成原文节点、不需要内容哈希。
- 长篇小说 Skill `jc-novel` 原先停在两代前的合同上：它引用的 `jc-jian-wiki` / `jc-raw-wiki` / `jiyiyasuo` / `yizhixing` 在当前环境**一个都加载不到**（五个 Wiki Skill 已退役，只剩 `wiki-memory`）；自建骨架 `wiki/{剧本,角色,世界,剧情,文案包装}` 与现行 `原始材料/资产` 分叉，角色会落成两份；它依赖的 `CLAUDE.md` / `hot.md` 自 2026-08-05 起已不再注入，写了没人读。
- `jc-novel` 改动：收窄 `description`/触发词（去掉「创作」「章节」「角色设计」这类会抢别的 Skill 活儿的词）、补启动闸门与 `allowed-tools`、新增 `references/落位与提交.md`（**不写死路径，按运行时注入的 index 定位**）、新增 `references/engines/index.md` 路由表（100 个引擎全覆盖，原先 61 个无任何地方指路）、删除自建库脚本 `scripts/scaffold_wiki.py`（第二真源，已备份 `/tmp/jc-novel-scripts-backup`）。
- 正文的归属也改了：**原创正文不再由模型手写记忆**，而是追加进 `原始材料/<作品>/原文.md`，重跑一次「故事拆分」（受控刷新：老节点跳过、正文延长时才刷新，见 2026-09-19 那条）后由原生节点分析从原文派生角色/场景/道具/关系。角色页按 `文件名 + title + aliases` 被原生链路匹配，匹配上只加双链、不重写，所以 Skill 先写的设计卡不会被冲掉。
- 验证：本轮只改 Markdown（`public/skills/wiki-memory/references/故事资料沉淀规则.md` + `~/.agents/skills/jc-novel/`），**无产品代码变更**；引擎路由表已用脚本核对 100/100 覆盖。`jc-novel` 的真实模型跑批验收待执行。

## [2026-09-19] 故事拆分支持自定义标记词，补 场/SC 白名单

- 剧本编号写法穷举不完：实测「第一场 雨夜」与「SC01 雨夜」两份稿子都直接报「没有识别到故事边界」（`CHAPTER_UNIT` 没有「场」、`ENGLISH_CHAPTER` 认不出 `SC`），而 `EP01`、`第一集` 能认。
- 用户可填一个**标记词**由代码生成规则：`normalizeStoryMarker` 收口（`SC01`/`第1场` 这种整段抄标题的写法也认），`probeStoryMarker` 前缀优先、前缀不足 2 处退回后缀式；短名剥离复用同一条规则；`marker` 进 plan `optionKey`。
- 白名单补 `场|場`，新增 `ABBREV_CHAPTER(sc|ep)`：缩写编号**只认数字**，认罗马数字会让「Sci-fi 的设定」被当成 SC+罗马数字 I 命中。
- 验证：`storyImport` 17/17（含两条误判陷阱）、`projectFileTreeCanvas` 35/35、与 `storyAnalysis`/`adaptationWikiScaffold` 合计 64/64、`vue-tsc -b` 通过；真实 UI 人工验收待执行。

## [2026-09-17] 创作面板隐藏七条视频线路

- 面板隐藏小易 MiniMax H3 三条、Kling Video V3、Grok Imagine Video 1.5、Seedance 2.5，以及 RunningHub Veo 3.1 Fast；同名 ZX Veo Fast、Dola/山海等其他线路不受影响。
- 仅使用注册表 `hidden` 退出 UI，保留模型合同供历史任务读取；Node focused `1368/1368` 与 `vue-tsc -b` 通过。

## [2026-09-17] 创作面板 GPT Image 2.5 官方档调整

- 创作面板移除 `gpt-image-2.5-flare-CF-超分`、`gpt-image-2.5-sunburst-CF-超分`，新增 `gpt-image-2.5-官方`、`gpt-image-2.5-flare-官方`、`gpt-image-2.5-sunburst-官方`。
- 三个新模型均按精确模型名提交 NewAPI，支持 1K/2K/4K，面板价统一 `0.15/张`；旧 CF 模型仅退出面板和可用性服务，不删除小易适配器/NewAPI 的兼容能力。
- 定向注册表与可用性测试 `59/59`、Node focused `1368/1368`、`vue-tsc -b` 与差异检查通过；真实渠道生成待验收。

## [2026-09-17] Skill Creator 草稿目录权限根因修复

- 根因不是 Skill 内容或用户电脑权限：Desktop 把草稿写到 `$TEMP/jiucaihezi-skill-drafts/**`，但 Tauri `fs:default` 未授权该目录，因此即使用户已选择 `@文件`，`plugin-fs` 仍必然返回 `forbidden path`。
- Tauri 现仅开放该应用专属草稿子目录，不开放整个 `$TEMP/**`；`@文件` 仍是用户侧本机操作开关，草稿持久化属于 App 内部事务。
- ACL 检查已加入 focused 回归；红灯可稳定复现，修复后 Node focused `1368/1368` 通过。真实 Desktop Skill Creator 修改、校验与安装仍待人工验收。

## [2026-09-16] 改编资产目录统一与建库索引双链化

- 规范资产目录由 `资产/人物/` 统一为 `资产/角色/`（`storyAnalysis.ts` 的 `ASSET_DIRECTORIES`），建库骨架补上 `资产/关系/index.md`；角色、场景、道具、关系一律平铺为 `资产/<类型>/<名称>.md`。
- 建库索引原先写相对 Markdown 链接（`- [场景](场景/index.md)`），而 `storyImport.ts` 的 `hasLink` 只识别 `[[…]]`，导致节点分析提交时在 `资产/index.md` 再追加一份同名导航：「角色」指向空目录且「场景/道具」各出现两次。索引现统一为 `[[资产/index|资产]]` 形式的双链。
- 建库现在会在发现旧 `资产/人物/` 目录时报冲突并停止，不与其并存。检测逻辑只定义一份（`legacyCharacterDirectoryConflict`），**建库、节点分析读取、节点分析提交**三个入口都会拦——曾经只拦了建库，用户不点建库直接跑节点分析会让同一角色在 `资产/角色/` 下被重建一份。
- 验证：focused Node `1364/1364`（含新增 3 条）、`vue-tsc -b`、`git diff --check` 通过；新断言已实测在旧链接格式与移除守卫两种情况下失败。真实 App 建库 → 拆分 → 节点分析全链人工验收待执行。
- 改编业务拆成两个入口：**`jc-gaibian-silu`（改编-思路）** 定方向并产出 `改编方案/改编思路.md`，含启动闸门与方法论（核心驱动判断、成对替换约定、依赖检查）；**`jc-gaibian-luobi`（改编-落笔，原 `jc-gaibian-duanju`）** 只负责已有方向后的逐集落笔，`改编思路.md` 缺失时只给 A/B/C 选项、不自行落盘。
- 拆开的原因是入口缺失：原 Skill 触发词是「adapting the next episode」，用户说「我要把这部小说改成短剧」时没有任何 Skill 被激活。
- Skill 目录用拼音 id，界面显示名在 **Skill 管理面板 → 详情/卡片 → 别名**里设「改编-思路」「改编-落笔」；别名是 UI 元数据（localStorage），写进 SKILL.md 的 `display_name` 对本地 Skill 无效。
- 改编落笔 Skill 已适配：原先要读的 `改编方案/总体改编方案.md`、`逐集改编方案.md` 与 `主线/原著分集情节点` 全都不存在，必然停摆。现改为读 `改编方案/改编思路.md` → 原文节点 → 按需资产 → 上一集剧本，剧本固定写 `剧本/第<集号>集.md`，资产正链改为平铺路径。
- `wiki-memory` 的 `references/故事资料沉淀规则.md` 已同步为 `资产/角色/` 与平铺文件。
- 待办：真实 App 上跑通「写改编思路 → 改编第 1 集 → 改编第 2 集」闭环；`public/skills/tests` 的 5 失败 22 错误是既有（已对 HEAD 复现，与本次无关）。

## [2026-09-16] 对话记忆索引改为文本摘要契约

- 对话索引摘要不再要求模型/网关支持 JSON Schema 或强制工具调用：所有模型仅返回“简介／关键词”两行文本，程序统一清洗、限长、去重并生成既有 `summary + keywords` 索引结构。
- 关键词行缺失时，程序用简介和回答中的技术标识补齐，保证索引仍可写入；索引路径、正链和查询格式保持不变。
- 验证：focused Node `1361/1361`、`vue-tsc -b` 与 `git diff --check` 通过；真实失败模型的手工重试待用户验收。
- 后续实测发现重开对话后的持续文本引用会丢失内联正文，发送时被错误编码为二进制 `file` 消息片段，触发网关 `400 invalid message format`；恢复时现按 `readablePath` 重新读取文本，保持纯文本消息格式。用户已用原失败场景确认成功。

## [2026-09-16] 对话项目文件持续引用

- 从项目树引用的文本/文档现在属于当前对话的持续引用：发送后不再清空，后续每轮自动携带，芯片显示“持续引用”，点击 `×` 即取消；拖入/上传附件、Skill 与工具选择仍保持单轮行为。
- 引用定位信息保存到该对话 Raw 的 `persistent-attachments` 元数据，不嵌入正文或二进制；切换对话、重启及文本同步后可恢复。文件移动时复用既有 Raw 路径重映射。
- 验证：focused 全绿；Rust `417 passed / 1 ignored`；`vue-tsc -b` 与 `git diff --check` 通过。真实 Desktop/Web/Mobile 交互验收尚未执行。

## [2026-09-15] v2.1.52 Desktop 错装 Web 首页与 v2.1.53 修复

- `v2.1.52` 三平台 CI 绕过 `build:desktop:quick`，只执行 Vite 构建；由于 Web 根页是官网、工作台在 `/try/`，正式安装包启动后错误显示官网。三个 Desktop 包均受影响，用户决定不回滚，直接发布 `v2.1.53`。
- 三个平台现统一在 `pnpm tauri` 前运行 `pnpm run build:desktop:quick`，由它完成工作台入口提升、官网文件清理和 Desktop 产物审计；合同测试逐 job 锁定，禁止 CI 再手工拼装 `vite build`。
- 本地真实 Desktop quick build 与 `audit:desktop-dist` 已通过；正式 `v2.1.53` 安装包首屏仍须人工确认，不能用 Actions 成功或进程存活代替。

## [2026-09-15] v2.1.51 发布准备

- Word 故事集标题兼容修复已收口，版本统一为 `2.1.51`。发布前验证通过：focused Node `1350/1350`、Rust `412 passed / 1 ignored`、TypeScript、定向 lint 与差异检查；真实三平台 CI 仍须由 `v2.1.51` tag 触发后验收。

## [2026-09-14] Word 故事按集拆分修复

- 用户文件《钓系恶女攻略疯批的正确姿势.docx》的段落全是正文样式，标题文字自带 `##` 且整段加粗；AnyDoc 因而输出 `**## 第一集…**`，旧拆分器只认行首裸 `##` / `第一集`，报“没有识别到故事边界”。
- 共享边界规范化现先解开整行 `**` / `__`，并继续把这类行视为 Markdown 标题，避免前置人物资料中的 `1. 江晚` 等标题进入独立数字段号候选、压过三个集标题。
- 真实 Word 经 AnyDoc 转换后复验为 `story_chapter`：前置资料保留 `0000.md`，三集分别生成 `0001_下错药的一夜.md`、`0002_疯批医生.md`、`0003_我死了,就挺突然.md`。focused `1350/1350`、TypeScript、定向 lint 与差异检查通过；真实 App 点击拆分待人工验收。

## [2026-09-13] App Store 1.5 拒审：支持页补上自有联系方式

- **拒审原文**：`https://jiucaihezi.studio/support/` "does not direct to a website with information users can use to ask questions and request support"。
- **根因**：`privacy` 和 `terms` 都把用户送到 `/support/`，而该页**唯一**通道是一个外部 GitHub issue 链接，**没有任何自有联系方式**——无邮箱、无表单、无 FAQ。页面 HTTP 200 正常，空的是内容本身。
- **已修**（只动 `public/support/index.html` 一个文件）：新增「联系我们」`mailto:` 邮箱 +「常见问题」4 条（要不要登录 / 登录失败怎么办 / 数据存哪 / 怎么反馈 Bug）；GitHub Issues 降级为次要通道；账号注销补邮件兜底；末尾加英文段方便英文审核员。
- 新增 `scripts/__tests__/legal-pages.test.mjs` 锁住这个形态（支持页必须含 `mailto:` 与常见问题；`privacy`/`terms` 必须指向 `/support/`），并登记进 `wave1FocusedTests`。
- 验证：focused `1338/1338`、Rust `412/412`、dev server 渲染正常、线上 `/support/` 200。
- **待办（Apple 2.1(a)）**：移动端账号页已放回 API Key + 保存按钮，只藏商业入口；待真机确认。
- **待办（提交必做）**：审核备注要写清「本地优先 + 自带 API Key」，并附一个可用测试 Key，否则审核员还是走不下去。
- **待办（本地调试）**：`iPad`（`00008027-000D495A1A06802E`）未注册进开发者账号 → `pnpm tauri ios dev` exit 65，需在 developer.apple.com 注册设备。

## [2026-09-13] MCP OAuth 打通 + 输入框三处修复

- **MCP OAuth 一直连不上（两个根因，均已修）**：① OAuth `state` 存在 `sessionStorage`，而深链回调（`jiucaihezi://mcp/oauth/callback`）会落在**新的 WebView 会话甚至新实例**上，那里的 `sessionStorage` 是空的 → `state` 校验必然失败、授权码被丢弃；改为 `localStorage`。② 回调监听器注册在 **MCP 设置面板组件**上（`onMounted`/`onBeforeUnmount`），面板没打开、被切走或换了窗口就没人接收，回调被**静默丢弃**；已提到应用级（`main.ts` 的 `handleDeepLinkUrls` 直接处理并写 store）。
- **真实环境已验证**：GitHub MCP 连接成功、工具可调用（云端 `gemini-3.8-flash` 与本地 `qwen3.8:9b-q5` 均已跑通）。本地模型曾经每轮工具调用都 400（`invalid message content type`），根因是回传工具结果时 assistant 消息**缺 `content` 字段**（OpenAI 允许省略，Ollama 类兼容层要求字符串）；已补 `content: ''`。
- **鼠标划过芯片出现无来由灰影**：芯片排是 `overflow-x: auto` 的滚动容器，会把 `overflow-y` 也算成 `auto`；画在按钮上方 7px 的自绘 tooltip 被裁掉本体、只剩 `box-shadow` 落回容器内。先试过原生 `title`，但它**改不了颜色、位置跟鼠标走**，最终改成 **`position: fixed` 的自绘提示**（`chipTip` + `getBoundingClientRect`）——躲开裁剪，正下方居中、走主题色；顺带修了 disabled 按钮不派发 `pointerleave` 导致提示卡住。
- **点 `@Skill` 弹出的却是工具列表**：空查询返回「7 个工具 + 前 5 个 Skill + MCP + 项目文件」，面板只渲染前 12 项。现在从芯片排进入**只列 Skill**（40 项、可滚动、可过滤）；手打 `@` 仍给全套候选。顺手删掉 `@Terminal` 合并时漏掉的 `mentionItems` Terminal 死入口（点了没反应）。
- **Skill 排序**：`jc-new-user-guide`、`skill-creator`、`wiki-memory` 三个永远置顶；其余按选中次数降序（`localStorage['jc_skill_use_counts']`），同次数保持原顺序。比较器在 `src/utils/skillPickerOrder.ts`，配真测试（置顶优先级、频率降序、同频稳定、不改原数组）。
- **排障知识**：`pnpm tauri build --debug` 出的 App **刻意连 `http://localhost:1420`**（`lib.rs` 的 `debug_assertions` 分支，注释写明"否则源码改动被旧 dist 盖住"），停了 Vite 就白屏；要独立可用的包必须走 release 构建。
- 验证：focused 全绿、Rust `412/412`、`vue-tsc -b` 与 `lint` 通过。

## [2026-09-13 晚] 开关即全权：@Terminal 并入 @文件，全部审批取消

- 用户原话："艾特文件这个功能本身就是把能力都给它。" 据此二次定稿 [[开发/记忆工作台文件能力合同与TDD-2026-09-13]]：**`@文件` = 本机全权**——10 项文件工具 + `terminal` + `skill_run_script` + `export_3d_scene_video` 一次给全；**`@Terminal` 芯片删除**（输入框 7 芯片 → 6）；**全部审批弹窗取消**（含 MCP 写工具、Skill 脚本、3D 导出，勾选即授权）。
- "约束打架"的真相：文件工具受路径边界管、终端完全不受管——**边界不一致**。修法是统一，不是取消：文件工具保留路径前缀校验（`/etc/hosts` 仍拒），终端按用户决策**不做命令级扫描**。写进合同的代价：终端挡住的是无意越界，挡不住刻意绕过，彻底隔离需 OS 沙箱（不值）。
- 上轮"正在就绪中"的两个真凶：① 没有 `copy` 工具，模型被迫逐字重写 46603 字节；② `maxToolRounds: 12` 到顶静默收走工具。**已修**：新增 `dev_copy_external`（复用 `skills::linker::copy_dir_all`，目标已存在则拒）+ `copy` 工具，`maxToolRounds` 提到 **64**。
- 用户列的 9 个能力模块里，`git`、代码搜索、测试/Build、Issue/Ticket **都是 shell 命令的别名**，放开终端即自动获得；真正不做的只有 Web Search/Fetch（2026-08-07 用户已砍，仓库有测试锁着）和 Subagent（需改引擎，串行场景收益不成比例）。
- 生成类（`@图文`/`@影音`/`@3D` 的生成部分）与 `@Skill`、`@MCP` **保持独立**：区分标准是"动本机"还是"生成内容"。
- 约束换地方：权限层不再设限，改由 Skill 与用户指令约束；系统提示新增两句——工作范围内直接用工具、搬移用 `copy` 或终端、多步任务一次做完。
- 验证：focused `1330/1330`、Rust `412/412`、`vue-tsc -b` 与 `lint` 通过。**真实 Desktop 已验证**：给中央 Skill 根目录一条消息建出 `jc-xiangshu-character`，4 个 reference 与原 `human-physiognomy` **md5 全同**（真复制）、`@Terminal` 已从芯片区消失；上轮的“只写 1/5 个文件 + 空口收尾”未再出现。详情见合同 §9.1；第 1–6 条仍待验证。

## [2026-09-13] 文件能力合同实施：@文件 + 绝对路径 = 会话内零弹窗读写

- 合同落于 [[开发/记忆工作台文件能力合同与TDD-2026-09-13]]：`@文件` 是唯一文件开关；授权只来自用户消息里的**绝对路径**，粒度是路径前缀（给目录 = 整棵子树，给文件 = 仅该文件）；相对路径只在项目内解析；授权本会话内累积；**授权范围内零弹窗**（`delete` 走系统废纸篓所以可恢复）；范围外硬失败并提示用户补路径。
- 权限归属：**文件权限规则只写在系统层，任何 Skill 不得声明、限制或绕过**。`skill-creator` 附录里“不得使用任意绝对路径”的越权条款已删除；`skill_creator_load_installed_skill` 保留为“未给路径时”的便捷入口。
- `read` 改回**原文**（行号不再混进可编辑内容，未读完时首行给定位头），这是“改了不生效 / 未找到 old_text”的根因修复。
- 桌面设置 → Skill「我的 Skill」的「修改」按钮改为填 **Skill 目录的绝对路径** + 自动打开 `@skill-creator` 和 `@文件`，用户直接写修改意见即可；工具栏新增「AI 新建」与其对称——预填**中央 Skill 根目录**（`WebSkillPanel` 的 `centralSkillsRoot`，取扫描结果或已装 Skill 包路径的父目录）后打开 `@skill-creator` + `@文件`，用户只写需求就能落盘（此前无入口，模型只能靠用户手打路径，容易退化成输出 `mkdir`/`cp` 命令）。
- Skill 包引用校验不再把示例/占位（`references/{相术类型}.md`）和句末标点当成真实依赖——这是 human-physiognomy 无法加载的直接原因。
- 验证：focused `1330/1330`、Rust `411/411`、`vue-tsc -b` 与 `lint` 通过（含路径折叠、占位引用、句末标点、AI 新建预填四组回归）；**真实 Desktop 点击验收未做**（见文档 §9 清单）。
- 四路并发审计（安全绕过 / 回归 / 并发状态 / 合同一致）后已修：`..` 逃逸、授权抽取漏授权、编辑重发残留授权、删除运行中会话、切项目早退残留、`stop()` 状态残留、7 处工具描述与合同不符。
- 用户决策（2026-09-13）：**符号链接逃逸不修**（总原则：点 `@文件` + 给出路径 = 授权范围内不设额外限制）；**`wiki-memory` 一行不改**（产品核心，Wiki 写作依赖 `allowed-tools: file`）；**授权范围不加 UI 回显**；**备份功能取消**（已删 `dev_backup_external_file` 及其调用/权限/测试/文档）；**项目外建目录/移动/删除要做**（已实现 `dev_create_dir_external`/`dev_move_external`/`dev_delete_external`）。详见文档 §8。

## [2026-09-12] 菠萝参考生适配器透传版生产出片成功

- 适配器按 MiniMax 链路已验证的 lumenx 范式重写：**已有 http URL 的参考图不重复上传**，删除 STS 申请、OSS 签名 PUT、素材下载转存与其环境变量（`main.py` 340+ 行 → 287 行，一次创建只发一次上游请求）。提交 `78ae5eb9` 已部署到 `/opt/boluo-minimax-adapter`。
- 两个图音参考模型均真实出片成功：增强版 `minimax_h3_zm_u24`（面板回执 2026-09-12 19:59:39，成片 `.raw/jc-media/视频/男人惊讶_ymr9j1.mp4`）与基础版 `minimax_h3_image_audio_to_video_v2_15s`。这证明**菠萝服务器能直接取到 Worker 托管的临时素材 URL**，此前担心的 Cloudflare 拦截未发生。
- 仍未验证：Worker KV `expirationTtl = 15 分钟` 的排队越界、上游 4xx/5xx 与超时重试、`Range` 续传；上游首尾帧与纯文生两个模型未接入。详见 [[运维/菠萝MiniMaxapi#9 韭菜盒子接入范围与差异]]。
- `v2.1.49` tag 已推送（此处四处版本文件均为 `2.1.49`，未 bump）；桌面三平台 CI 与 `latest.json` 结果尚未核对。

## [2026-09-07] 生产运维 | 存储治理与云端 AnyDoc

- 已清理确认无用的 Docker BuildKit 缓存、旧日志、历史更新包和过期输出；根盘最终已用 `25 GB`、可用 `41 GB`、使用率 `38%`。`cleanup-jiucaihezi-output.timer` 每日清理 `/opt/jiucaihezi/output` 中超过 24 小时的可再生产物。
- 云端 `document-converter` 已从 MarkItDown 切换至 AnyDoc `0.2.3`，生产 `127.0.0.1:8810/health` 和正式 Web DOC 转 Markdown 均通过用户验收。扫描版 PDF 仍需独立 OCR，不属于本次能力。详见 [[运维/服务器存储清理与AnyDoc生产切换-2026-09-07]]。

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

- **Desktop 文档转换已切换为内置 AnyDoc `0.2.3` 并通过用户验收。** 用户已在 macOS ARM 安装包实际验证 DOCX、XLSX、PPTX 成功；图片型 104 页 PDF 被正确识别为无文字层并提示需要 OCR，原件保留。Desktop 本地 AnyDoc 路径不调用 MarkItDown，也不要求本机 Python 或 LibreOffice；仅 `internal`/不可用错误可回退云端。云端已于 2026-09-07 切换至同版本 AnyDoc，并由 staging、生产健康检查和正式 Web `.doc` 转 Markdown 验收。见 [[开发/通用记忆工作台AnyDoc内置格式转换升级TDD-2026-08-22]]、[[运维/服务器存储清理与AnyDoc生产切换-2026-09-07]]。

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

- **产品定位与唯一产品边界（2026-09-25 更新定位）。** 韭菜盒子是**协作漫剧本地工作台**（「协作」= 人与 AI 协作，不是多人协作；「本地」= 数据与模型可留在本机）。边界规则不变：保留记忆工作台现在拥有的全部功能；现在没有的功能全部迁出。OpenCode、旧 Studio、文/武/道/创、电商、制作工作台仍属迁出范围；**漫剧已移出迁出名单**，但旧漫剧工作台的产品壳不搬回主仓（仍在 `../jiucaihezi-legacy-products/`），漫剧能力由现行记忆工作台与创作面板承接。共享代码只要仍被记忆工作台直接或间接依赖，就必须保留，不能按目录名删除。唯一实施合同见 [[开发/通用记忆工作台单产品化分离SDD]]。
- 记忆工作台继续保留项目中心与文件树、Raw 对话、统一工作台模式、完整 Wiki 能力、项目内工具、附件与文档转换、Markdown 阅读编辑、`.canvas` / `.jccanvas` / `.jcscene`、媒体生成、登录/模型/Skill/MCP，以及当前 Desktop、Web、Mobile 各自已经具备的能力。
- **模型请求中断恢复已实施。** `502/503/504/524`、浏览器网络错误和 Tauri/reqwest `error sending request` 只重试当前模型请求两次，退避 `2 秒、4 秒`；耗尽后仅对明确的请求或流中断写一组 Raw 恢复点。Raw 追加按 `userTurn.id` 幂等，旧 generation 不再覆盖新项目状态，发送期间锁定输入与附件。定向 `77/77`、完整前端 focused `1020/1020`、TypeScript、定向 lint 和差异检查通过；真实 NewAPI/Cloudflare 三端故障注入尚未验收。
- **模型上下文与长文预算已收口（2026-08-15）。** 云端模型统一兜底 `1M` 输入 / `128K` 输出，Gateway 精确字段优先；本地 Ollama/MLX 保持 `32K/4K`。历史按真实 token 估算保留最新完整轮次，删除每条消息固定 `16,000` 字符截断；请求动态计算可用输出，`length` 最多续写 3 次。上下文淘汰只提醒用户 Raw 仍完整可查，不自动摘要或写 Wiki。Codex 式 5 次请求重试、5 次流重连、客户端 `429` 重试和固定 300 秒总超时均不采用；当前两次请求重试、一次断流续传和三次长度续写已足够且避免请求放大。聚焦 `1047/1047`、TypeScript 和差异检查通过；真实上游故障注入及跨端人工长文验收未执行。
- **本机 MLX 采用“外部服务、App 只连接”的最小合同（2026-08-23）。** Desktop 设置只显示服务地址（默认 `http://127.0.0.1:8081`）、连接按钮、状态和自动识别的模型数量；用户自行下载模型、配置并启动 MLX 服务，韭菜盒子不读取模型目录、不下载文件、不管理进程。连接只接受 localhost/127.0.0.1/::1，通过 `/v1/models` 保存 `local-mlx` 模型并复用统一工作台的 OpenAI/SSE/工具链。见 [[开发/通用记忆工作台本机MLX兼容服务接入TDD-2026-08-21#10. 最终界面合同与首次使用流程（2026-08-23）]]。**（2026-09-25 更新：该独立入口已并入「自定义端点（OpenAI 兼容）」；`local-mlx` Provider、`start_mlx_service` 与 `mlx_lm.server` 自动启动已移除，本机 Ollama/自定义端点/打分器/ComfyUI 收进可折叠的「本机模型与服务」区。自定义端点只用自带 apiBase/apiKey，绝不回落云端凭据，并按本地保守预算 `32K/4K` 对待。）**
- **统一工作台工具权限不受对话文字关闭。** 工具栏与显式能力选择是工具池唯一来源；历史或当前文字中的“不要调用工具”不移除候选工具。流式正文中断后的续写继续携带原工具池，续写产生的工具调用进入原审批和执行循环。提交 `055d8e8c`，完整 focused `1021/1021`、TypeScript 与差异检查通过；真实上游中断待人工验收。
- **媒体与 3D 迁出决定已撤销且从未实施。** 图片、视频、音频、创作画布、3D 白膜、GLB/GLTF 查看和 Desktop 动画导出继续随韭菜盒子保留；短视频工厂未被本计划修改。老电脑适配只优化空闲刷新与按需加载，不降低最终质量、不删除高性能设备能力，见 [[开发/韭菜盒子媒体与3D能力迁出SDD]]。
- **Seed Audio 1.0 已完成生产与创作面板验收。** 提交 `d1773603` 的独立适配器已部署；NewAPI 渠道 66 的文本、参考音频和创作面板画布音频均已真实返回有效 MP3。创作面板显示 `豆包音频生成1.0 · 1.2元/分钟`，最多支持 3 段参考音频；NewAPI 按 Token 计费配置为普通输入/补全/音频输入 `1`、音频输出 `1000`（美元/1M Token），前端 UI 不变。
- **媒体任务启动竞态已按 TDD 修复。** `initDB()` 并发调用现在共用同一个 Promise，`mediaTaskStore.init()` 等待 SQLite 真正完成后才读取和恢复历史；不再在首次挂载抛出 `SQLite storage is not ready`，也不增加定时重试或第二套任务状态。
- **项目文件树以流畅性优先。** 不再为图片、视频或音频生成缩略图、读取媒体或保留 Blob URL；统一显示类型图标并保留点击预览。后续生成媒体以“任务摘要、清理后提示词、模型名、任务 ID”顺序命名，旧文件不改名。
- **App 只随包提供 4 个产品 Skill：** `jc-new-user-guide`、`skill-creator`、`wiki-memory` 和 `jc-watch`。20 个个人写作、视觉、旁白 Skill 已迁入 `/Users/by3/Documents/jiucaihezi-personal-skills`，用户自行安装的 Skill 不受影响。
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
# [2026-09-10] 改编 Wiki 建库与双链输入合同

- 已实施产品级增量合同：文件树顶部增加确定性“建库”入口；Markdown 编辑态增加双链按钮、`Command/Ctrl + Shift + K` 和输入 `[[` 的项目 Markdown 文件联想。程序负责结构、索引、文件和派生反链，编辑器负责人工连接，Skill 负责资料判断与创作；本期不做标题锚点、自动建页、批量改链或业务专用选择器。类型检查、相关测试和完整 focused 测试已通过，跨平台人工验收待执行。见 [[开发/通用记忆工作台改编Wiki建库与双链输入TDD-2026-09-10]]。

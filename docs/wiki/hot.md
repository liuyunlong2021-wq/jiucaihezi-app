# 热缓存

## [2026-09-23] @DH 改由官方 SDK Client 持有 Runtime

- 五分钟无结果的直接原因是 Provider 两次约 125 秒后返回 524，再被 `maxRetries: 5` 放大；集成根因是前端自写 JSON-RPC 生命周期只在 `session.status=idle` 时收尾，Helper 退出后等待 Promise 不会结束。
- Runtime 与 Client 已统一到官方 `@deepseek-ai/dsh-sdk-client@0.1.7-alpha.2`：bundled Node 的薄 bridge 只转交任务与通知，SDK 负责 Harness 子进程、订阅、退出、stderr 与错误传播；自动重试降为 1 次。
- 明确 `@文件` 已加载的正文与转换文档会进入首个 Harness prompt，不再先让模型逐个 `glob/read`。流式补丁仍只负责展示 `text-delta`，不承担生命周期。
- `@DH` 现只选择执行器，不再清除 `@文件`；`@文件` 是明确的本机文件全权开关，给官方 Harness 传 `DSH_PERMISSION_MODE=danger-full-access`，关闭则恢复 `workspace-write`。权限模式进入 Runtime key，切换时不会复用旧权限进程；两枚芯片按任意顺序选择、重开会话均能同时保留。
- @DH 不再套用普通模型的最近三轮合同：一个 Raw 对话固定映射到一个 `jc-v1-<conversationId>` Harness Session，连续轮次只发送当前消息，由官方 Session 保存完整事件历史并负责 Compaction。首次启用或中间经过非 DH 对话时，才按真实上下文容量一次移交尚未进入 Harness 的完整轮次。
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

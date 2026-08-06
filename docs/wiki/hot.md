# 热缓存

> 更新：2026-08-06 | 阶段：Wiki 证据链与可信检索已实施

## 当前结论

- **新建记忆空间采用 Obsidian 兼容的最小 Wiki 骨架。** generic 只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`，不创建 README、CLAUDE、`方向.md`、业务目录或任何替代性的强制读取页；记忆请求也不自动注入 Wiki 页面。
- **`jc-everything-wiki` 只做按需结构规划。** 它沿用现有 Wiki 根目录，读取目标与现状，只追问会改变目录设计的问题；先给最小方案，用户确认后创建并复查。`index.md` 只导航顶层分类，目录 `_index.md` 只导航直属子目录。
- **`jc-raw-wiki` 已收缩为精准沉淀。** 它只把用户明确指定范围内的确认信息增量写入现有 Wiki 并登记来源；旧包已备份，项目类型模板、全 Raw 扫描和开发收尾脚本不再随 App 分发。关系图、标准 `.canvas` 和统计归 `jc-cha-wiki`，`.base` 等 App 支持后再做。
- **`jc-cha-wiki` 已收缩为精准检索。** 它用少量短词多轮召回、读取命中原页并带来源回答；重复 Reference 与 Python 查询器已移出产品包。关系图只在显式请求时生成有种子范围的局部、可点击 `.canvas`，禁止全库铺图和静默覆盖现有布局；本阶段不建设 RAG 或 Bases。
- **`jc-jian-wiki` 已收缩为精准只读巡检。** 机械检查复用原生 `wiki audit`，区分导航断链、同名歧义、普通未解析链接、孤儿候选和历史卫生；语义一致性只检查用户指定主题。旧个人创作规则、Reference、Python/Node 扫描器和目录数量启发式已移出产品包。
- **`jc-xiu-wiki` 精准修正已实施。** 只修已有 Wiki 中答案唯一的单文件错误；`replace` 强制 Markdown 路径，默认单命中，多命中须显式 `replaceAll`，先预览后批准，写后重读验证；结构扩展归 Everything，新事实归 Raw，复检归 Jian。
- **Raw、Cha、Jian 已共用一份证据合同。** 重要结论按“Wiki 章节 -> 来源角色 -> 原始来源 -> 已处理范围 -> 写入时 SHA-256 -> 记录时间”登记；Cha 回答时展示已登记来路，Jian 只读检查来源一致、变化、丢失、无法验证或登记不完整。来源变化只代表待复查，不自动判错或改写 Wiki。

- **唯一产品边界：保留记忆工作台现在拥有的全部功能；记忆工作台现在没有的功能全部迁出。** OpenCode、旧 Studio、文/武/道/创、电商、漫剧、制作工作台均属迁出范围。共享代码只要仍被记忆工作台直接或间接依赖，就必须保留，不能按目录名删除。唯一实施合同见 [[开发/通用记忆工作台单产品化分离SDD]]。
- 记忆工作台继续保留项目中心与文件树、Raw 对话、快速/记忆模式、完整 Wiki 能力、项目内工具、附件与文档转换、Markdown 阅读编辑、`.canvas` / `.jccanvas` / `.jcscene`、媒体生成、登录/模型/Skill/MCP，以及当前 Desktop、Web、Mobile 各自已经具备的能力。
- **App 只随包提供 7 个产品 Skill：** `jc-cha-wiki`、`jc-everything-wiki`、`jc-jian-wiki`、`jc-new-user-guide`、`jc-raw-wiki`、`jc-xiu-wiki`、`skill-creator`。20 个个人写作、视觉、旁白 Skill 已迁入 `/Users/by3/Documents/jiucaihezi-personal-skills`，不再进入 App 索引、推荐指令或新手指南；用户自行安装的 Skill 不受影响。
- **文字云合同只有两个手动动作：** `上传并覆盖云端`以本地完整可同步文字快照覆盖云端，`下载并覆盖本地`以云端完整可同步文字快照覆盖本地。两者都不合并、不创建冲突副本、不自动双向同步；媒体、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不比较、不传输、不删除。设置页只显示状态，操作只在项目中心。
- 发布身份不得因分离改变：Desktop `com.jiucaihezi.desktop`、iOS `com.jiucaihezi.mobile`、`jiucaihezi://`、正式 Web <https://jiucaihezi.studio>、现有更新地址与公钥、应用数据目录、账号及云项目绑定全部保持连续；Android 当前无稳定独立身份，继续暂停。
- **通用附件合同保持现状：** Office/PDF/XLSX/PPTX 保存原件并生成 Markdown 可读副本，再把 Markdown 发送给 NewAPI；原件不被删除，图片、视频、音频继续走原生媒体链路。本轮不改附件逻辑。

## 已验证 / 未验证

- `v2.1.9` 已发布：`main` 与 tag 指向 `f302c251`；Web Production 正式域名返回 HTTP 200；GitHub Actions `30904082094` 的 macOS ARM、macOS Intel、Windows x64 和发布清单均成功；生产 `latest.json` 返回 `2.1.9`。
- 方向性文字覆盖已通过 focused `1438/1446`、TypeScript、Web quick build 和产物审计；真实 Web/Desktop/iPhone 覆盖删除矩阵仍待人工验收。
- Wiki 状态查询已按 append-only 合同改为从 `log.md` 末尾读取最新标题；应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 与 TypeScript 通过，当前状态正确显示 2026-08-04 的最新决策。
- iOS 仍是已提交审核的 `2.1.7 (2.1.7.1)`，Android 无公开版；桌面三平台发布不等于 App Store 或 Google Play 上架。
- 单产品化分离已按四组 TDD 实施：模型目录改用 Gateway，创作面板解除 OpenCode owner/session，搜索改用 Raw 对话，Rust 移除 OpenCode Runtime/命令；旧 Studio、OpenCode、四模式、电商、制作、漫剧工作台产品代码与发布物已从主仓迁出。
- 独立备份仓库 `../jiucaihezi-legacy-products/` 保留 `v2.1.9` / `f302c251` 完整历史，工作树干净且 `git fsck --full` 通过。主仓保留 Raw、Wiki、媒体、同步、身份、Gateway、云绑定、更新与发布路径。
- 自动验证通过：分离门禁 `11/11`、Rust `395 passed / 1 ignored`、Wiki Skill `38/38`、证据链相关原生/Web/Desktop/审批 `57/57`、完整 focused `986/986`、TypeScript 和两端产物审计；最终产物只有 7 个产品 Skill。五类独立模型前向检查尚未执行；真实 Windows、Intel Mac、iOS 升级与云绑定连续性待人工验收；Android 继续暂停。

## 下一步

- 按 [[开发/通用记忆工作台RawChaJian证据链与可信检索TDD]] 执行五类独立模型前向验收；只有真实关键词检索持续漏召回时，才另写 TDD 评估全文检索或 BM25。提交、推送和发布须另行明确授权。

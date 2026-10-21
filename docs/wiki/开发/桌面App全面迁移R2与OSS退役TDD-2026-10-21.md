# 桌面 App 全面迁移 R2 与 OSS 退役 TDD

> 日期：2026-10-21。状态：桌面/公共 R2 服务端源码已实施，本地验证见§11；生产未部署、OSS未退役。用户目标：桌面 App 全面转 R2，完全舍弃 OSS。用户已授权先提交全部既有改动，再执行 TDD。

## 1. 可验证目标与范围

终态：桌面 App 自有的临时云素材上传只使用私有 R2，不再签发、上传或回退到阿里 OSS；共享服务完成依赖迁移后，删除活跃 OSS 签名实现、生产凭据与部署依赖。不能只把客户端报错文字从 OSS 改成 R2 就宣布完成。

“全面”覆盖创作面板、@影音、创作 MCP、工作台画布引用、提示词增强、RH/远程 Comfy 适配及所有直接/间接调用公共上传函数的桌面路径。按调用闭包核对，不能只迁 FK、灵动、易红。

保留桌面全部现有功能、型号、参数、计费、任务恢复、本地项目与历史成果。小易 multipart、语音 Base64、本机 Comfy、本机文件和 NewAPI 已有结果取回仍按各自合同工作；不把原本无需云存储的文件强制上传 R2，不新增结果图床或通用下载代理。厂商自有输出域名不受我方存储控制，不能承诺所有第三方服务内部也完全不用 OSS。

两层完成条件必须分别记录：

- **桌面迁移完成**：新桌面构建在 OSS 禁用的隔离环境仍通过保留能力回归，新提交无 OSS 流量，无 OSS 回退。
- **OSS 退役完成**：画布、旧客户端、在途任务及历史唯一原件均已处理，生产不再需要 OSS 凭据/签名路由；完成凭据撤销和对象处置记录。第一层通过不能冒充第二层。

## 2. 实施计划与验证

1. 清点上传调用闭包、保留协议与历史依赖 → 验证：渠道合同卡、桌面入口/型号/素材矩阵及基线测试。
2. 先写 R2 合同与失败路径红测，再扩展现有签名器并切桌面公共上传 → 验证：Go 签名/路由测试、真实客户端请求夹具与原生 HTTP 字节一致性。
3. 逐渠道核验输入到本地结果、恢复与账单 → 验证：G0–G6 证据，Mac ARM/Intel、Windows 原生安装包分开登记。
4. 迁移共享 OSS 消费者、保存历史唯一原件，再退役 OSS → 验证：无活跃调用、无未保存原件、无生产凭据，R2-only 部署与回滚演练。

## 3. 根因与当前证据

| 位置 | 当前行为 | 迁移含义 |
| --- | --- | --- |
| `src/api/media-generation.ts:uploadCreationAsset` | 本地 data/blob/asset 素材申请 `/api/creations/upload-url`，读取 `form_fields` 并表单 POST OSS；普通远程 URL直接复用 | 在共享上传根部替换，不在各渠道复制上传代码 |
| `creationMediaPlan.ts:mediaInputTransportFor`、`creationMediaRuntime.ts:materializeRequestMedia` | 选择 multipart/url/base64；URL 模式复用公共上传 | 保留协议分流，不能全改 URL |
| `creationMediaRuntime.ts:executeDirectVideoRequest`、`media-generation.ts:generateVideo` | 另有公共上传调用 | 覆盖非主入口、音视频、重复物化与取消 |
| `extension/creation_media_router.go` | 公共入口仍签 OSS；灵动、易红有独立 R2 入口 | 当前 R2 不是桌面公共上传的替代品 |
| `extension/r2direct/signer.go` | 复用 AWS v4 signer；固定私有桶，灵动/易红精确白名单及独立目录 | 复用签名实现，保留旧入口合同 |
| `src/utils/httpClient.ts:serializeRustHttpBody` | 已支持 Blob/FormData 转原始字节 Base64，由 Rust 发出 | R2 PUT 直接复用 Blob，不重写 HTTP 传输层；实测长度/头与空响应 |
| `creationProtocolClient.ts`、`scripts/creation-protocol/server.mjs` | 动态协议素材经 `/v1/creation/assets` 转存 NewAPI 本地 `/api/creations/uploads` | 当前不是 OSS；保留 asset_id、owner、期限与原任务语义，不借本次改写动态协议 |
| 兄弟画布 `web/src/services/api/media-upload.ts` | 灵动/易红分流 R2，其余 URL 上传仍走公共 OSS 入口 | 共享入口不能原地改返回结构；最终 OSS 下线需要画布配套迁移 |

现有 OSS 支持 `image/gif`、`application/octet-stream`，现有 R2 类型表不含这两项。迁移必须保留原上传能力，并保留厂商更严格的类型约束；不能因 R2 类型表较窄而减少桌面能力。

前次渠道查询是源码与记录核对，未独立审计生产渠道名单。完整实施前读取用户实际可见模型与现行部署基线，不能把静态目录等同线上全部模型。`scripts/newapi-media/README.md` 存在旧“未部署”记录，线上状态以统一执行手册最新回执及本次只读核对为准。

## 4. 目标合同：复用 R2，新增唯一公共上传入口

### 4.1 API

新增 `POST /api/creations/r2/upload-url`，复用 NewAPI `TokenAuth()`、现有 `r2direct` 与服务器私有 R2 配置。请求体严格为：

```json
{"content_type":"image/png","size":2048}
```

返回沿用现有 R2 grant：`method=PUT`、`upload_url`、`headers={Content-Type}`、`asset_url`、`head_url`。PUT/GET/HEAD 对应同一固定桶、同一对象，分别签名。新对象目录固定为 `creation-temp/{鉴权用户ID}/{128bit随机名}.{扩展名}`，与灵动/易红目录隔离。用户不能传 owner、bucket、endpoint、key、prefix、回源地址或任意方法。

公共入口承接旧公共上传能力，因此不复制每渠道模型白名单，不维护第二份全模型目录。此授权只允许上传固定私有桶的用户临时素材，不代表获得某模型调用权限；模型权限和收费仍由 NewAPI 原生成链验证。保留现有灵动/易红入口与白名单，不能用公共入口重写它们的既有行为。

沿用现有限值：单文件 1–20 MiB、上传签名 5 分钟、GET/HEAD 签名 6 小时、现有客户端上传超时 120 秒。复用现有私有桶，不趁迁移改桶/域名/额度/超时/轮询。配置未就绪明确返回 503；未鉴权 401、非法参数 400。新入口沿用现有请求体上限与未知字段拒绝，不向客户端泄露私有配置。

### 4.2 桌面执行

```text
现有入口校验型号/参数/素材
→ 按原合同选择 multipart、base64 或 URL
→ URL 模式：本地原件 → 带用户Token申请公共R2授权
→ 校验grant → safeFetch PUT原始Blob到R2（无平台Token/Cookie）
→ PUT成功 → 仅把asset_url提交现有NewAPI生成端点
→ 原任务查询/结果取回 → 原本地项目保存及恢复
```

保持 `uploadCreationAsset` 名称和调用签名，集中替换其实现，调用方无需知道桶或凭据。删除此函数中的 OSS 表单拼装、`form_fields` 兼容与 OSS 错误文案；不提供存储选择开关、不保留隐藏回退。

客户端校验 HTTPS、固定账户端点/桶、用户目录形态与随机对象、三个 URL 同一对象、method、headers、签名参数和既定期限；拒绝凭据字段、用户名密码、fragment、意外端口、路径穿越和其他对象。固定公共部署目标复用现有配置方式，不信任服务端返回的任意上传主机。对象归属最终由服务端鉴权用户绑定，不能仅凭客户端路径检查证明归属。

不得向 R2 发送 NewAPI Authorization/Cookie，不在日志/错误/任务调试正文打印完整签名 URL。拒绝上传重定向；若现有 JS→Rust 桥未实现 redirect 控制，先给原生请求增加最小必要约束并测试，不能只在 JS 写 `redirect: error` 就称安全。PUT 不手设 multipart Content-Type，不把 Blob 转成文本；Content-Length 由原生请求对应实际字节。

取消、读取失败、授权失败、无效grant、PUT失败：本次不发生成 POST，不自动重试收费请求，不转 OSS。多素材任一失败也不提交生成；已上传孤立对象按生命周期处理，不为本次另建删除服务。

### 4.3 远程引用、历史与重试

普通非 OSS 远程素材继续按现有合同复用；不会为了“全部 R2”强抓第三方资源。对历史我方 OSS URL：本地原件可用时从原件重传 R2；原件缺失时进入历史恢复清单，在停用 OSS 前保存到项目并验证字节，不静默丢引用。不要把全部 `aliyuncs.com` 一概认定为我方对象，需核对桶/来源。

新建或明确重新生成任务不得直接提交我方旧 OSS 临时 URL；尚未迁回的引用给出“请恢复/选择本地原件”的错误。处理方案不从任意 URL 建通用服务器代理。已经提交的任务只续查原任务号，不因迁移重发生成；不要更改其冻结凭据、项目和请求标识。

R2 签名 URL 不是永久原件。新一轮生成从本地原件重新申请授权，不缓存已过期签名；有原任务号的恢复不再上传、不重新提交。上传5分钟和读取6小时的窗口必须覆盖真实厂商取材等待时间；若超出，作为上线阻塞项核实，不私自延长期限或开放公有桶。

### 4.4 保留能力矩阵

| 路径 | 目标行为 | 验证重点 |
| --- | --- | --- |
| FK图片、Seedance、H3 | URL参考改R2，JSON字段及公开名/ID不变 | 单/多图、视频/音频、首尾帧按现有合同；不把旧生成500归为OSS迁移已解决 |
| 灵动、易红、源流 | 桌面URL输入统一走公共R2入口 | 当前精确型号、时长、MIME、URL数组/内容结构不变 |
| 菠萝、山海、Dola及其他目录型号 | 凡调用公共上传均走R2 | 参数遍历与真实执行夹具，不能仅枚举几个渠道 |
| RH/远程Comfy、H3提示词增强 | 现有需要公网URL的本地素材走R2 | 适配器实际读取签名URL，不新增STS/OSS上传 |
| 小易、其他文件编辑与Veo文件协议 | 保留multipart | 不申请R2/OSS，不把文件替换成URL |
| 本机Comfy、语音Base64、普通对话附件 | 保留原本地/内联/附件链 | 无新增云上传；非OSS能力不被误改 |
| 动态creation协议与历史asset_id | 保留本地素材服务和原任务恢复 | 不因云存储更换破坏原owner/期限/asset_id |
| 图片/视频/音频生成结果 | 现有NewAPI内容取回及项目持久化 | 原图/原视频读回，断点恢复、项目归属；不强制结果再存R2 |

## 5. 先红后绿测试清单

每个用例先在旧实现运行，记录真实失败，再实现。已有正确行为只跑回归，不伪造红测。测试以实际HTTP请求、字节与任务调用次数为断言，不只匹配源码字符串。

| 编号 | 测试/预期 | 位置 |
| --- | --- | --- |
| R01 | 公共R2签名返回同对象PUT/GET/HEAD；用户目录、随机唯一、签名方法/Content-Length/Content-Type/期限正确 | `r2direct/signer_test.go` |
| R02 | 0/负数/20MiB+1、未知MIME、无效owner、取消context拒绝；20MiB边界通过；GIF/bin保留 | 同上 |
| R03 | 新入口401/400/503/成功；拒绝未知字段、任意桶/目录；原灵动/易红白名单行为不变 | 新增路由级Go回归，纳入固定宿主编译 |
| R04 | data/blob/asset、Windows asset.localhost的图/音/视频申请新入口→PUT原字节→返回GET URL；无OSS表单 | `src/api/__tests__/media-generation.test.ts`（不存在则新建） |
| R05 | 伪造主机/桶/目录、对象不一致、缺签名、错误TTL、错误方法/额外头、OSS grant均在PUT前拒绝 | 同上 |
| R06 | R2请求没有平台Token/Cookie；重定向被拒；非ASCII/零字节/二进制样本SHA-256与长度一致；200/204空响应可处理 | `httpClient.test.ts`及Rust真实HTTP夹具 |
| R07 | 授权/PUT失败、超时或取消、多素材中途失败：生成POST=0、OSS请求=0；正常提交=1 | `creationMediaRuntime.test.ts` |
| R08 | 参数别名/多数组引用同素材仅物化一次；不同运行不复用过期签名；媒体顺序不变 | 同上 |
| R09 | 用当前可执行模型目录生成保留矩阵，实际请求送入对应插件decode/build；覆盖所有上传调用方 | 现有plan/runtime/jcComfyAdapterPlan及插件测试 |
| R10 | multipart/base64/本机路径不调用公共上传；动态asset_id任务不改为R2 URL | plan/runtime/creationProtocolClient测试 |
| R11 | 本地原件历史重用改R2；缺原件的我方OSS引用阻止新提交；旧任务仅查询/下载，绝不新收费POST | runtime/mediaTaskStore/持久化恢复测试 |
| R12 | 无OSS env的R2-only镜像健康；客户端全部场景OSS请求=0；共享消费者迁移后旧OSS入口退役 | 部署模拟+完整宿主集成 |

额外用真实HTTP服务验证 PUT body 与签名绑定，不能仅断言 `X-Amz-SignedHeaders` 字符串就证明 R2 执行了长度约束。现有通用远程下载、URL安全、任务恢复和本地保存测试持续保留。

## 6. G0–G6 实施与验收闸门

| 闸门 | 必须交付的证据 | 停止条件 |
| --- | --- | --- |
| G0 基线/合同 | 读现行执行手册；实际模型、调用闭包、生产镜像/Compose/env字段名、旧OSS消费者及原件清单；保留协议基线 | 不明渠道/原件/部署基线不能猜 |
| G1 红测 | R01–R12中新增行为的旧实现失败记录，记录已通过的保留行为 | 只有静态搜索无执行用例 |
| G2 实现/本地回归 | 定向TS/Go/插件/Rust、类型、桌面构建；新入口与旧路由集成；隔离无OSS环境 | 任一保留能力退化、出现OSS回退 |
| G3 存储/原生 | 合成图/音/视频R2 PUT、独立GET/HEAD、SHA-256与长度；原生HTTP、API鉴权与需要时的CORS | 只验HTTP200；不核字节/签名约束 |
| G4 厂商执行 | 按渠道/精确型号记录用户可见名、参考类型、单次生成、任务号及厂商取材成功 | 某一型号成功扩大为整渠道；无授权收费 |
| G5 本地成果/恢复 | 原图/原视频保存后读回，重启恢复原任务、下载中断、失败不重扣；每笔费用/退款证据 | 外链能显示但原件未保存；重试重建任务 |
| G6 发布/退役 | 三类平台实际包记录；服务端先行、客户端升级；共享消费者迁移、凭据撤销及对象处置 | 旧消费者仍签OSS或历史唯一原件未保存 |

平台最低验收分别为 macOS Apple Silicon、macOS Intel、Windows；仓库其他受支持桌面目标按现有发布矩阵补齐。构建成功不等于目标机器运行成功。逐型号尚未收费验证的行保留“待验收”，不得隐藏/删掉型号来让“全通过”。

每条证据至少记录：时间、客户端构建/架构、宿主镜像、插件版本、公开模型、参考种类/数量/字节、授权/PUT/生成请求结果、task_id、文件校验、费用/退款、剩余问题。日志脱敏不含Key或完整签名。

## 7. 发布、共享消费者迁移与OSS退役

### 阶段A：服务端提供公共R2能力

核对实际生产基线，沿用现有构建/备份/比较/自动回滚模式；新prepare/activate入口必须按当前镜像与四Compose等真实基线生成，不直接重跑绑定旧ID的历史脚本。保留模型/插件/计费、Redis、数据库和本地结果缓存等无关配置。先验证新R2入口与旧客户端兼容，再发桌面版。

过渡期旧OSS入口仅服务尚未迁移的旧消费者，新桌面不得调用。过渡不是最终验收，也不设客户端OSS回退开关。

### 阶段B：发布桌面R2-only版

保持稳定上传函数与现有项目/任务数据结构；服务端能力先就绪。旧服务没有新入口时明确提示升级服务，不回退旧地址。Mac ARM/Intel与Windows按现有签名更新流程交付；先做合成上传，再按已授权范围一次生成验收。回滚优先保留已经验证的R2能力并回滚其他变化；任何临时恢复OSS的运维回滚须单独记录为退役未完成，不能称R2-only仍成立。

### 阶段C：消除剩余共享依赖

迁移兄弟画布中仍用OSS的FK等URL消费者，复用公共R2入口与校验；灵动/易红现有入口无需强制改名。读其AGENTS并独立验证/发布，不能在本次文档任务擅自改兄弟仓。盘点正式旧桌面版本和外部调用者，给出实际升级/停用处理记录；不能只凭新源码搜索无调用就判定生产已无人使用。

已提交任务继续按旧ID完成；旧OSS素材可能被排队厂商延迟读取，不能只等6小时就认定安全。按实际在途任务状态与保留期决定退役时点。盘点历史项目/任务中的我方OSS对象，唯一原件先下载到既有项目或经核验备份并校验；失效或缺失对象明确记为未恢复，不伪造迁移成功。

### 阶段D：真正移除OSS

前述依赖全部清零后，删除活跃 `ossdirect` 包、公共OSS签名路由、服务端OSS环境读取及生产Compose注入，更新当前构建/验收脚本使其不再要求OSS。旧URL接口退役后返回明确的升级错误或404/410，不将OSS grant悄悄改为R2 grant。历史部署脚本退出现行导航，避免误执行。

撤销运行环境的OSS RAM凭据；清理对象/关闭桶前保留可验证备份和明确清单，再执行对象处置。生产env/Compose删除与密钥撤销均需真实回执。历史文档、`归档/`、`log.md`、`开发历史.md`、CHANGELOG和用户历史引用保留，不用全仓删除“OSS”文字冒充退役。

R2临时对象清理复用桶生命周期，不新建定时清理服务；当前尚无自动清理验收。实施前核对现有规则与任务最长取材时间，单独确定保留期并记录；不能擅自设置10分钟或1天删除。仅作用于目标临时前缀，不误删成果或其他渠道对象。签名过期不等于对象删除；未配置清理时不得宣称存储治理完成。

## 8. 修改清单与明确不做

必改：公共上传函数及对应测试；`r2direct`公共签名方法/类型与测试；媒体路由及集成测试；现行部署/验证脚本与Wiki。按测试证据才修改plan/runtime/httpClient/Rust；不为重命名大面积改调用方，不新增SDK、Worker、通用代理、存储Provider抽象或后台开关。

最终退役阶段才删除 `ossdirect` 与生产OSS配置；兄弟画布及旧消费者配套迁移作为退役前置，不能当作可忽略的遗留。动态协议本地存储和结果缓存不是OSS依赖，不在本次强迁R2范围。模型价格、厂商Key、结果下载代理、自动续签平台、任务重提策略均不新增。

## 9. 执行检查命令与当前状态

以下为实施时验证入口，本次未运行这些代码测试：

```sh
pnpm run typecheck
pnpm run test:focused:build
pnpm run test:focused:run
pnpm run test:tauri
pnpm run build:desktop
```

Go扩展：在 `scripts/newapi-media/extension` 执行 `go test -mod=readonly ./r2direct ./ossdirect ./jcmedia`（过渡阶段）；最终移除OSS后更新为实际保留包，并在固定NewAPI源码中执行路由编译与集成回归。插件回归执行 `node --test newapi-plugins/__tests__/*.test.mjs`。定向新增测试须纳入已有focused清单；打包、安装、生产激活、收费生成分别留证。

完成勾选（当前全部待执行）：

- [ ] G0调用闭包/合同/生产依赖清单冻结。
- [ ] 新行为先红后绿，原能力矩阵回归通过。
- [ ] 服务端公共R2入口上线且真实字节读写通过。
- [ ] 新桌面全部公共上传R2-only，失败不生成、不回退。
- [ ] 逐渠道/型号和跨平台验收记录完整，历史恢复不重扣。
- [ ] 共享消费者迁移、唯一原件保存、在途任务处理完成。
- [ ] 活跃OSS实现/路由/env移除，生产凭据撤销与对象处置完成。
- [ ] R2生命周期已核验，不误删在途素材或成果。

## 10. 依据

- 仓库实际源码：本文件§3列出的函数、`r2direct/signer_test.go`、`ossdirect/signer.go`和画布公共上传函数，2026-10-21只读核对。
- 现行接入与验收：[[运维/URL素材渠道接入执行手册]]；历史成功与发布边界：[[运维/App参考素材直传阿里云OSS验收-2026-10-09]]。
- Cloudflare官方：[预签名URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)、[CORS](https://developers.cloudflare.com/r2/buckets/cors/)、[对象生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。预签名使用S3 API端点；PUT带匹配Content-Type，GET/HEAD按方法签名；生命周期是对象删除规则，与签名有效期分开验证。

原设计阶段仅完成源码追踪与文档检查；本次实施进展见下方，未完成的闸门仍保留。


## 11. 本轮执行记录

### G0 合同卡与边界

```yaml
channel: 桌面公共临时素材上传（保留各生成渠道合同）
record_status: 源码实施；生产基线与逐型号取材未验收
authorized_scope: 用户授权提交main全部既有改动并执行本TDD
baseline_commit: d89e74f2
storage: 复用既有私有R2桶及服务器凭据；不创建新存储服务
api: POST /api/creations/r2/upload-url
request_fields: [content_type, size]
object_prefix: creation-temp/{鉴权用户ID}/{128bit随机名}
limits: 单文件20MiB；上传300秒；读取21600秒；客户端上传120秒
references: 保留multipart、base64、本机Comfy与动态asset_id链路
production_access: 当前SSH身份被拒绝；未读取生产配置或凭据
legacy_consumers: 画布仍有OSS公共入口；兄弟仓存在未提交改动，本轮未覆盖
history_inventory: 未扫描用户项目、在途任务和OSS唯一原件；最终退役前必须完成
```

### 已实施

- 公共 R2 签名复用现有 AWS v4 实现，增加 `SignCreationUpload`；公共上传保留 GIF/bin 等原类型，灵动/易红白名单及类型不扩张。新入口保留 TokenAuth，严格字段/请求体/用户归属；可独立运行的 HTTP handler 测试不冒充完整宿主集成。
- 桌面 `uploadCreationAsset` 改为新入口与 Blob PUT，校验固定 R2 主机/桶/目录、同一对象、方法/头/签名/期限；不再消费 OSS grant，不提供回退。404 明确提示升级服务端；上传错误不展示签名地址。
- 数据物化失败或取消不提交生成；多参考图中任何一次 PUT 失败，生成 POST=0。旧临时 OSS 签名引用在公共上传、三种素材物化协议与动态新素材准备阶段拒绝并提示恢复本地原件，普通远程引用保持。此识别依赖平台式 `creation-temp` 路径与 OSS 签名形态，实际桶归属/历史原件仍须生产清点，不宣称全量历史已迁移。
- 原生 HTTP 将 `redirect:error` 传给 Rust，PUT不跟随重定向；保留二进制 Request 的 Blob 字节和原JSON/文本行为。删除会打印参考URL正文的运行时调试输出，HTTP诊断不打印查询签名。
- 已交付 `prepare-public-r2.sh`：精确当前镜像参数、固定源码及旧媒体路由/R2源码哈希检查、备份/失败恢复、测试和镜像构建；只准备镜像，不激活。已交付 `verify-public-r2.py`：隐藏读取用户Key，合成小图PUT/GET/HEAD及逐字节读回，绝不发生成请求。未执行服务器脚本。

### 红测与本地证据

- 首轮桌面红测实际请求旧 `/api/creations/upload-url`，未走新R2入口；Go公共方法用例因旧实现缺 `SignCreationUpload` 编译失败。新增 Request 二进制用例在旧文本物化逻辑下失败，再改为Blob保留。
- 上传/运行时/Comfy/HTTP定向82项通过（随后补上二进制Request字节断言并纳入最终focused回归）。全部任务插件148/148通过；Go `r2direct/ossdirect/jcmedia`三包通过；准备脚本保护3项、合成读回验证脚本3项通过。
- 最终完整Node回归2093通过/1跳过；Rust496通过/2忽略。第一次同时运行两套完整Rust测试，冲突于既有固定Skill夹具目录；该用例单跑通过，随后串行完整回归通过。没有为此改动Skill逻辑。
- 类型检查与 `pnpm run build:desktop` 通过，桌面分发产物审计通过。后补的跨协议旧OSS引用保护已通过最终focused、类型与Vite/桌面产物审计；未打包原生安装版。未执行完整NewAPI宿主编译、Docker镜像构建、真实R2上传、厂商生成、跨平台安装包或历史数据迁移。

### 当前停止边界与下一步

SSH尝试以现有身份连接生产 `47.82.86.196`，返回 `Permission denied (publickey,password)`，没有执行服务器命令。未访问/修改生产凭据、数据库、Compose、模型名单、定价或OSS对象。不能通过本地模拟推断服务已切换。

后续需取得可用连接，先只读核对最新镜像、源码哈希、Compose、API代理路径与R2规则；执行准备后基于实际回执生成对应激活步骤（保留原比较/数据库备份/自动回滚），不直接重跑旧activate脚本。再运行合成验证、桌面平台与逐型号G3–G5。公共路径若被既有网关/Nginx拦截，按真实配置补齐对应路由，不能改通用代理或开放任意存储目标。

共享OSS路由/包仍为未迁移画布和旧客户端保留，因此**OSS彻底退役尚未完成**；只有消费者迁移、在途任务与唯一原件核清后才执行§7阶段D。用户本次目标未因此被缩减或标记完成。


## 12. 生产准备实测（2026-10-21）

用户在Mac终端以复用SSH连接登录后，本轮继续只读核对并执行prepare，未切换生产：

- 当前健康镜像：`sha256:bfd510bc74c2fb4bf2d7dd7c687aa6228a74273a2b061ca773702a1d371af428`；固定NewAPI源码和四Compose均与既有记录一致，现有R2/OSS字段仍在。
- 源码基线实测：媒体路由`67d6620971d5b743c06ef66f19a28921ac8dfc98ea9887b9bd2e5f9046f676da`，R2 signer `356d4646af8ba7cc787618142105158f2c389e2d7a92199837aa5854eb761684`，与prepare保护一致。源码备份：`/root/jc-public-r2-source.EfIqa6`。
- 服务器完整NewAPI编译通过；断网容器内 `r2direct`、`ossdirect`、`jcmedia`、`router`、`relay/channel/task/jsplugin` 五包回归通过。
- 新镜像：`jiucaihezi/new-api:rc40-public-r2-20261021`，精确ID `sha256:311f21c7a4787a294028a56302b8257b6f0f35b611ffa506d3821b6c78d07eda`；构建日志在`/root/jc-public-r2-prep/build.log`，只在服务器保留，不含用户Key。
- 公网`r2/lingdong/yihong`三个上传路径的OPTIONS均204，允许画布Origin；现行Nginx兜底转发覆盖新公共路径，本次未改Nginx或Worker。预检成功不代表尚未激活的新POST已可用。
- 新增固定基线`activate-public-r2.py`及5项模拟测试；沿用已验证的镜像差异检查、Redis美元等价处理、数据库备份验证和失败自动回滚，增加公共R2合成读回，保留灵动/易红/旧OSS授权回归。已上传到`/root/jc-public-r2-prep/scripts/newapi-media/`。
- 新激活仍需交互隐藏输入NewAPI用户Key；这是上传接口鉴权，与SSH登录凭据不同。Key不在命令参数/聊天/落盘文件内。当前未获取该Key，未执行激活、模型生成或OSS退役。

本节取代§11“当前SSH身份被拒绝/未执行完整宿主构建”的阶段状态；数据库备份与生产切换仍待激活脚本实际回执，不提前标通过。

# 媒体模型接入与维修手册 / App、画布与 NewAPI

面向用户和执行接入、维修任务的 AI，覆盖图片、视频、音频模型从模型展示、素材输入、提交、后台生成、查询、结果传输到本地保存与计费的全链路。小易、灵动、易红与FK是已记录的渠道案例，后续渠道按同一诊断流程补充各自合同和证据。沿用原文件路径以保持两仓已有链接有效，不再维护第二份完整操作手册。这是**核对与验收流程，不是所有厂商共用的一套接口**。

本文件为两仓唯一标准操作手册。具体部署基线与历史见画布仓库 `deploy/lingdong-r2-experiment.md`；不要把历史镜像、旧脚本、临时 SSH socket 当成下一次可以直接执行的命令。

> **桌面公共上传迁移（2026-10-21）：** 已按用户授权实施 [[开发/桌面App全面迁移R2与OSS退役TDD-2026-10-21]] 的公共R2入口与桌面PUT链路，本地回归通过；公共R2服务端已由用户激活，合成读回与独立公网鉴权/CORS通过；桌面真实逐项验收仍待做。本文既有灵动/易红画布R2和其他渠道OSS状态仍作为生产记录保留，不等于桌面新实现已上线。共享OSS最终退役须先处理旧消费者和历史原件。

## 快速结论与当前状态（更新至2026-10-20）

| 项目 | 灵动 | 小易 |
| --- | --- | --- |
| 插件 / 版本 | `lingdong` / 0.4.0 | `xiaoyi-image` / 0.3.1 |
| 当前型号 | 两图片、两视频，均有 `灵动-` 前缀 | 五图片，均有 `xy-` 前缀；无视频 |
| 参考素材 | 画布读本地原件 → R2 私有签名 URL → JSON | 画布读本地原件 → NewAPI multipart → 小易文件编辑 |
| 输入是否经过 OSS/R2 | R2；不擅自切回 OSS | 不经过 OSS/R2 |
| 图片输出方案 | 插件向上游要 URL，画布向 NewAPI 要 Base64，由宿主下载转换 | 插件向上游请求 Base64；App经原生异步任务查询取回，旧标准图片同步接口保留 |
| 画布是否为本轮改动发版 | 已部署到 v0.20.7，保留其已成功链路 | 本轮未改画布源码，不新增 xy 名单或专用分流 |
| 生产证据 | 用户确认一次多参考图生图及画布显示成功 | 用户已激活0.3.1；App开发版的flare文生图取得结果并保存项目文件、写入画布 |
| 当前未解决 | 其他型号/视频、刷新读回、导出及账单须分别验收 | 该次结果交付延迟近6分钟待定位；其他型号/图生图、容量边界、恢复与实际人民币扣费待验收 |

用户已取消「整体移除前端渠道特例、改 NewAPI 自动上传」方案。**保持灵动；以后确需公网 URL 的渠道沿用其方式；支持文件的渠道不要强制转 URL。** 不得根据旧解耦计划删除已成功链路，也不得把本手册视作发布或收费调用授权。

### 本机文件定位

- 插件与价格：App 仓库 `newapi-plugins/lingdong.plugin.js`、`lingdong-pricing-2026-10-14.json`、`xiaoyi-image.plugin.js`、`xiaoyi-image-pricing.json`。
- 插件测试：App 仓库 `newapi-plugins/__tests__/lingdong.test.mjs`、`xiaoyi-image.test.mjs`。
- R2 宿主扩展：App 仓库 `scripts/newapi-media/extension/creation_media_router.go`、`r2direct/`；服务端变量模板 `scripts/newapi-media/r2.env.example`。
- 画布：`web/src/services/api/image.ts`、`video.ts`、`media-upload.ts`、`web/src/lib/newapi-media-contract.ts`；本地原图与结果保存见 `web/src/services/image-storage.ts`、`file-storage.ts`。
- 两仓真实根路径见下方 §0；其他机器必须重新定位。本文只列源码位置，不表示要求同时修改所有文件。

## A. NewAPI 后台共同设置：上传插件不等于模型已开放

按以下顺序核对目标渠道，不改其他渠道：

1. 管理员任务插件页上传 **`*.plugin.js`**，核对 key/版本并激活。`__tests__/*.test.mjs` 含 import，是测试文件，不能上传；价格 JSON 也不是插件。
2. 编辑已有目标渠道，保留原 Key、分组等已用配置；按当前宿主界面绑定正确 Task Plugin。新建时可使用 type 61「Task Plugin」，不要为了套模板重建已经工作的灵动渠道。
3. 填写下表中的上游 Base URL；这是 NewAPI 服务端访问的地址，不是画布填写的中转站地址。
4. 将该渠道模型列表设置为目标公开名。插件登记能力不会自动替换渠道模型，也不会自动写入售价。
5. 检查模型映射。两插件都内置公开名转换；最简单是移除该渠道对应型号的冗余旧映射。确需后台显式映射时，必须逐字采用下表上游名；不保留拼错或旧 CF 映射。
6. 在模型价格 / Task Usage 表达式中填写下表系数，保存。沿用现有「人民币售价与系数同数值」口径，但最终实扣还受账号/分组倍率影响，不能仅看表达式宣称账单已验收。
7. 确认渠道可用、分组与用户 Token 匹配、Token 模型限制没有排除目标型号。用同一个用户 Token 的 `/v1/models` 核对实际可见性；不要把管理员能看到模型当作用户可调用。
8. 画布渠道仍填写 `https://api.jiucaihezi.studio` 与用户自己的 Key，重新拉取模型。在图片/视频分类核对新模型；列表缺少完整能力时用现有配置手动分类，不假设仅靠 ID 能自动判断所有能力。
9. 旧自定义调用脚本可能抢先执行，必要时由用户确认后移除该型号的过期脚本，不能批量清空用户脚本。先观察请求路径和返回字段，再进行单次授权验收。

### A1. 灵动四模型：key `lingdong`，上游 Base URL `https://www.lingdongapi.com`

| NewAPI 公开模型名 | 上游模型名 | 售价 | Task Usage 表达式 |
| --- | --- | --- | --- |
| `灵动-gpt-image-2.5-flare` | `gpt-image-2.5-flare` | ¥0.08/张 | `tier("base", u("image_count") * 0.08)` |
| `灵动-gpt-image-2.5-sunburst` | `gpt-image-2.5-sunburst` | ¥0.10/张 | `tier("base", u("image_count") * 0.1)` |
| `灵动-sd2.5-满血-301010` | `sd2.5-满血-301010` | ¥6/次 | `tier("base", u("calls") * 6)` |
| `灵动-sd2.5-满血-301010-2` | `sd2.5-满血-301010-2` | ¥8/次 | `tier("base", u("calls") * 8)` |

这两个视频型号按次，不把时长乘进售价。该表记录用户选定配置，不保证厂商未来仍销售同名型号或接受原参数；接入新任务前仍以该账号当前能力为准，不擅自换名。

### A2. 小易五模型：key `xiaoyi-image`，上游 Base URL `https://image.xiaoyiapi.xyz`

| NewAPI 公开模型名 | 上游模型名 | 分辨率 | 售价 / Task Usage 表达式 |
| --- | --- | --- | --- |
| `xy-gpt-image-2-1k` | `gpt-image-2` | 仅1K | ¥0.04/张；`tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-1k` | `gpt-image-2.5` | 仅1K | ¥0.04/张；`tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-flare-1k` | `gpt-image-2.5-flare` | 仅1K | ¥0.04/张；`tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-sunburst-1k` | `gpt-image-2.5-sunburst` | 仅1K | ¥0.04/张；`tier("base", u("image_count") * 0.04)` |
| `xy-grok-imagine-image-2.0` | `grok-imagine-image-2.0` | 1K、2K | ¥0.08/张；`tier("base", u("image_count") * 0.08)` |

只保留这五项，不给 Grok 名称加 `-1k`，不添加视频。0.3.0 的用量 schema 只有 `image_count`，不沿用引用 `seconds` / `resolution` 的旧视频计费表达式。先等该渠道旧视频任务结束再切换版本；不顺手删除 App 的历史任务或其他渠道型号。

## B. 灵动：画布、R2 与 NewAPI 怎样配合

### B1. 图片和视频输入

```text
浏览器本地原图/媒体
→ 画布带用户 Token 申请 NewAPI /api/creations/lingdong/upload-url
→ NewAPI 返回固定私有桶的 PUT 上传授权与 asset_url
→ 浏览器直接 PUT 到 R2（不附带 NewAPI Token / Cookie）
→ 画布向 NewAPI 提交 JSON，images/videos/audios 为签名 URL
→ lingdong 插件翻译型号和字段，再提交灵动
```

图生图不是向灵动发送 multipart：画布对已登记的灵动图片型号改走 `/v1/images/generations` JSON `images` 数组。文生图没有参考素材，不申请 R2 上传。视频走现有 `/v1/videos` JSON 和真实任务号生命周期；普通参考与首尾帧按当前型号合同处理，不能从一次图片成功推断视频成功。

相关前端职责：`newapi-media-contract.ts` 登记精确型号和参数；`media-upload.ts` 选择灵动授权接口并校验固定上传目标；`image.ts` 处理 URL 参考与 Base64 结果；`video.ts` 保留提交/查询/内容取回；结果成功后进入现有浏览器本地保存。不要仅改模型下拉名称漏掉服务端白名单。

### B2. R2 和 API CORS

- 既有私有标准桶 `jiucaihezi-media-test`；域名托管在 Cloudflare 不会自动配置 R2 CORS，也不代表必须启用公有访问。
- 服务端变量：`R2_ACCOUNT_ID`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`；真实值只在服务器私有 env 文件，权限600，不进入插件、前端、聊天或 Git。
- 桶 CORS 来源：`https://huabu.jiucaihezi.studio`、`http://127.0.0.1:3000`、`http://localhost:3000`；方法 PUT/GET/HEAD；允许头 Content-Type，暴露 ETag。保持桶私有，不为排障开启 r2.dev 或公有读。
- NewAPI 公网授权接口另有 API CORS：需要允许画布 Origin、Authorization、Content-Type 和对应 OPTIONS/POST；R2 桶 CORS 不能替代 API CORS。
- 当前批准值：单文件20 MiB、PUT签名5分钟、读取签名6小时；不擅自调整。GET和HEAD签名分开使用；URL过期不等于对象自动删除，没有实现「10分钟自动清理」。
- 宿主保留 OSS 与本地素材路由，R2 不覆盖其他渠道配置；上传失败或取消，不提交生成、不偷偷回退 OSS。

### B3. 图片输出是另一条链

```text
画布向 NewAPI 要 b64_json
→ 插件向灵动要 url
→ 灵动生成后返回 data[].url
→ NewAPI 现有宿主下载原图，补入 data[].b64_json
→ 画布优先读取 Base64，解码并保存 IndexedDB，再显示结果
```

v0.20.6 已让输入通过，但浏览器 fetch 输出 URL 被 CORS 拦截；v0.20.7 修正画布响应格式后，用户确认该次图生图显示成功。不能改回浏览器直接抓厂商图片；宿主下载失败会保留 URL，因此仍须核对 Base64 和本地保存，不只看200。

### B4. 已知生产基线（历史已记录，执行前重新核验）

- 画布 v0.20.7：提交 `6633e08f314dca2dc5e17bf506bd841d1282e43e`；镜像 `ghcr.io/liuyunlong2021-wq/jiucaihezi-canvas:v0.20.7`，digest `sha256:6411a9daa8dd86c59b87ad241cb500fef97a5d5e319caf3a834bb36a0d04c88a`。
- NewAPI 固定源码 `0aec08fee811ec6136828fda790551b49e410301`，已记录镜像 `jiucaihezi/new-api:rc40-lingdong-fourmodels`；不是官方无补丁镜像，须保留本地素材、OSS、multipart 与易红容量补丁。
- 已记录四份 Compose：`/root/new-api-new/docker-compose.yml`、`docker-compose.media.yml`、`docker-compose.oss-direct.yml`、`docker-compose.r2.json`。端口、原env、挂载和网络保持原配置；画布映射 `127.0.0.1:3010:3000`。
- NewAPI 备份 `/root/jc-lingdong-fourmodels.DjCby8`；画布备份 `/root/canvas-v0.20.7.z70UHX`。这些是记录路径，不保证仍存在，回滚前验证；不展示其中的数据库、env或inspect正文。
- 不直接重跑首次试验的 `activate-r2.py` / 旧prepare脚本，其固定镜像和三Compose基线已过期。已有灵动成功环境不因小易插件升级而重新构建或切换。

## C. 小易：文件输入与App原生异步结果链路，画布旧接口保留

### C1. 输入、任务与输出（旧画布同步接口）

```text
文生图：画布 JSON /v1/images/generations
图生图：画布 multipart /v1/images/edits（单图image，多图重复image[]）
→ NewAPI xiaoyi-image 插件解码并保留宿主 fileRef
→ 上游同类端点增加 /async；参考文件由宿主直接转发
→ /v1/images/tasks/{task_id} 用同一渠道 Key 查询
→ result.data[] 的 Base64 / URL 转成标准 data[]
→ 画布优先用 Base64 保存本地
```

本地原图不上传 R2/OSS。Grok 同样必须走文件编辑接口，不能把 JSON images 当作参考图生效。小易插件0.3.0在文生图与编辑请求中均向上游发送 `response_format=b64_json`；这与灵动「厂商URL→宿主下载」不同，不要互相覆盖。

五个 xy 新名称不在旧小易前端名单中，但包含 image 关键词，可走已有通用图片请求；本轮没有为了它们修改画布名单或发布画布。即便画布 GPT 分支省略 response_format，插件仍显式向小易请求 Base64。最终是否确实返回 Base64，必须用真实响应验证，不能只凭请求字段断言。

### C2. 严格分辨率预设（用户已确认）

缺省 `1024x1024`；四个 GPT 只允许1K列，Grok允许1K和2K列。自定义尺寸、越级档位在插件解码/提交前拒绝，不自动缩小，不把 `quality=high` 当4K。预设是插件可提交范围，不保证供应商每个比例均已真实验收。

| 比例 | 1K | 2K（仅Grok） |
| --- | --- | --- |
| 1:1 | 1024x1024 | 2048x2048 |
| 2:3 | 1024x1536 | 1360x2048 |
| 3:2 | 1536x1024 | 2048x1360 |
| 4:3 | 1024x768 | 2048x1536 |
| 3:4 | 768x1024 | 1536x2048 |
| 16:9 | 1536x864 | 2048x1152 |
| 9:16 | 864x1536 | 1152x2048 |
| 21:9 | 2016x864 | 2688x1152 |
| 9:21 | 864x2016 | 1152x2688 |

显式传 Grok aspect_ratio 时还须满足其上游枚举及像素比例一致校验；不能把表中尺寸推断成任意 aspect_ratio 字段值都可用。

### C3. 历史错误（0.3.0时期，不代表当前停止点）

1. **上传后拉不到模型**：上传插件不是开放渠道；检查A节的渠道模型、分组、Key权限、版本绑定及刷新，不先改画布。
2. **`Unsupported Xiaoyi image model mapping`**：插件拒绝了不符合内置映射的上游名。用户截图第二行写成 `pt-image-2.5`，应为 `gpt-image-2.5`。随后返回了另一种错误，但不能据此把所有映射、全部型号都标已验收。
3. **`Upstream rate limit exceeded`**：用户提供两次完整响应，code为 `image_generation_failed`、type为 `invalid_request_error`。这是响应报告的上游限流，具体是账号、并发、模型池还是其他转发层限制尚未定位；不增加自动重试、不擅自换渠道或改插件。用户已决定暂停。
4. 浏览器另出现 HTTP/2 协议错误、连接关闭和400。它们不一定来自同一请求，不能仅凭限流响应把所有网络故障归为同一根因。本地 `127.0.0.1:17371/events` 是Codex连接，不是小易图片接口。

保留的两次请求ID（非密钥）：`202610190831245253994268268d9d6WE0I3z8Q`、`202610190833220351725948268d9d6eKZSAudJ`。后续关联 NewAPI/厂商日志与账单，不连续点击重新生成。以上为旧失败记录；0.3.1成功证据见C5，实际计费口径仍需核对。

### C4. 容量边界仍需分项验收

小易插件本地测试经历失败→修复，严格预设后全部插件 Node 测试148/148通过。这仅证明本地合同，未替代官方宿主运行时、大图或真实生成验收；本次文档整理不重跑测试。

既有大响应补丁只覆盖易红；小易改用异步 Base64 后，需要分别验证上游查询响应读取、JS hook传参/结果、taskData持久化上限，不能以「输入支持文件」推出「宿主无需任何容量调整」。当前没有为小易改宿主上限，也没有证据说明限流就是容量导致。

0.3.1已有一次约2.9MB图片落盘成功，证明该次容量可通过，不代表更大结果、多图或其他型号的容量上限已验证。后续先只读核实宿主容量与已有任务；如确需改变容量，说明环节、默认值与失败行为并取得确认。不要在文档里把容量问题标成已修复，或为此擅自发布新画布。

### C5. 2026-10-20成功案例：异步提交解除长连接等待

**已确认范围：App开发版 + xiaoyi-image 0.3.1 + xy-gpt-image-2.5-flare-1k文生图一次，结果已落项目并写入画布。** 用户已上传激活插件并确认此次成功；不能扩写为五型号、图生图、画布Web版或全渠道均通过。

旧故障：上游已返回任务号，但NewAPI的标准图片同步协议仍等待最终图像（日志task_sync=true）。客户端约126秒收到Cloudflare 524，Nginx记录499；请求日志末尾200不代表图片交付。修复复用NewAPI原生任务路由与后台轮询，保留原同步接口兼容旧客户端，没有新增代理或通过改DNS、延长超时解决。

```text
App文生图 POST /xiaoyi/v1/images/generations（JSON）
App图生图 POST /xiaoyi/v1/images/edits（multipart；本次真实未测）
→ NewAPI插件提交小易 /v1/images/generations/async 或 /edits/async
→ 返回NewAPI公共task_id；App先持久化任务号、查询地址和pollKind
→ NewAPI后台持渠道Key查询小易 /v1/images/tasks/{上游任务号}
→ App独立GET /xiaoyi/v1/images/tasks/{公共task_id}读取宿主任务快照
→ completed + data[].b64_json → App解码保存原文件 → 写入画布
```

两层轮询职责不同：NewAPI查厂商，App查NewAPI；客户端不持厂商Key，也不把公共task_id当厂商任务号。原生查询render只读取宿主快照，不触发第二次生成。新App依赖0.3.1原生路由，必须先激活插件再使用配套客户端；404不能回退到重新收费的同步提交。状态queued/in_progress/completed/failed与空结果、失败原因按合同处理。

本次证据（北京时间）：

| 阶段 | 时间/事实 | 证据 |
| --- | --- | --- |
| App创建任务 | 21:53:42.701 | 本地任务记录 |
| NewAPI提交/开始 | 21:53:48 / 21:54:04 | 用户后台任务详情截图，渠道166、插件0.3.1 |
| NewAPI标记成功 | 21:54:47，100% | 同一任务详情；不是App已收到结果的证明 |
| App接收结果并开始保存 | 22:00:30.724 | completedAt在completeMediaTask接受结果时写入，不能当文件保存结束时间 |
| 原图落盘 | 22:00:59.644，2,900,126字节 | 本机文件存在及mtime；任务status=success、assetStatus=local、downloadState=complete、canvasWriteStatus=written |
| 账单显示 | 后台额度字段显示$0.04 | 只记录界面原文；不能据此确认人民币¥0.04实扣、账号/分组倍率或上游成本 |

关联标识：公共任务号`task_nCg8MLF2fBXRzu5FEfGYF7Lde4kFqRwf`；请求号`20261020135347408228358268d9d61FlT70k9s`；上游任务号`canvas-task-mvgqut2o-7e0cf413b09b4780c7887b43`；App任务`mtask_mvgquofh_1tl0`。本机证据文件：`/Users/by3/Documents/列车/.raw/jc-media/图片/莱卡胶片_真人摄影_俯拍_日本美女总裁_皮肤真实_28岁_fh1tl0.png`。这些路径是本机证据位置，不是其他环境的默认目录；不记录Key或完整Base64。

**未解决的性能问题**：后台成功到App接收约5分44秒，随后落盘约29秒。不能归因于10秒轮询间隔，也不能凭这两个时间断定是Cloudflare、宿主render、网络传输或App恢复。后续按§8.2取同一任务查询耗时定位，只查原任务，不重新生成。程序的查询间隔、单次请求超时和总预算是不同概念，显示“查询30s”也未必是实际墙钟耗时。

G3：截图确认0.3.1运行；G4：该次flare文生图成功；G5：本地原文件与画布写入通过，刷新/重启/导出与跨平台未测；G6：金额显示有证据，实际币种/倍率/扣费与失败退款未核对。其他型号、素材编辑、多图/大图容量、服务重启后的后台任务持续性均未验收。

## D. 什么时候改插件、画布或宿主

| 变更 | 处理方式 |
| --- | --- |
| 小易这五个图片名、映射和售价 | 插件/渠道/计费设置；本轮画布不改 |
| 灵动已有四型号 | 保持已部署链路，不因小易改动重发 |
| 新URL渠道或灵动公开名变化 | 先核对厂商，复用现有上传方式；检查插件、前端精确合同/分流与服务端白名单，不能只上传插件就承诺可用 |
| 结果URL无法浏览器读取 | 区分输入上传与结果交付；复用已支持的Base64或宿主结果取回，不再次生成 |
| 宿主缺少必要路由/文件转换/容量 | 先证实缺口与取得授权，再单独改宿主、测试、备份及部署 |
| 厂商限流 | 查既有请求和账单；不按经验改前端或自动重试收费 |

官方插件文件占位符支持 Base64/data URL 或 multipart fileRef，不会自动上传R2生成公网URL。官方新版的 `utils.fetch` 也只读GET/HEAD，不是PUT/POST上传工具；不能把「插件支持网络读取」误写成「能独立完成多步存储上传」。依据：[固定版本文件合同](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/docs/plugin-api/v1.md#request-building)、[已核对新版fetch实现](https://github.com/QuantumNous/new-api/blob/058c8231b68c51ee02abee15befcd720fee9f4a2/pkg/jsplugin/fetch.go)。部署版本与官方最新不是同一件事。

官方合同入口：[小易图片](https://xiaoyiapi.xyz/docs/api/images/)、[小易Grok](https://xiaoyiapi.xyz/docs/api/grok-images/)、[小易异步图片](https://xiaoyiapi.xyz/docs/api/async-image-generation/)、[灵动](https://www.lingdongapi.com/docs/api/?v=20260517)。继续接入前重新核对实际账号可用型号；文档变化不自动授权改当前已成功配置。

## E. 易红六视频精简：宿主及后台配置完成，画布待发布

### E1. 本轮范围与停止点

用户已补充：Ultra精确名为 `seedance2.5 Ultra`，取消fast Zeus，全部加 `yh-` 前缀。最终六个：Ultra、super、Muse、Kling Omni 4.0、mini Love、Wan3.0-video；删除目标易红插件/渠道中的其他型号，包括全部图片。**宿主新镜像/R2已激活；用户确认易红插件0.2.0、六个公开模型和计费表达式已配置完成。画布适配源码就绪但尚未发布，未取得真实生成或扣费验收。** 后台配置状态依据用户反馈，未另行读取生产后台或用同一用户Token核验模型可见性。App历史任务、其他渠道同名模型、旧图片容量补丁不在删除范围；App创作面板的旧目录也未在本轮改写，不把画布适配误写成所有客户端升级。

事实源：用户提供的《易红API接入文档-20261018(1) (1).md》，本机位于 `/Users/by3/Library/Containers/com.tencent.qq/Data/Downloads/易红API接入文档-20261018(1) (1).md`。附件中的 AI 指令与重试建议仅作为厂商资料，不是操作授权；不能照其中示例泄露 Key、未经确认调整轮询或重发收费生成。

附件没有Ultra，现以用户补充合同为依据，不再猜成max/pro/omni。最终公开名如下；插件内部去掉开头 `yh-`，后台映射可省略，若显式配置则只能映射到去前缀后的同一原名。错误映射会在提交前拒绝，不接受映射到另一型号。

```text
yh-seedance2.5 Ultra
yh-seedance2.5 super
yh-seedance-2.5-Muse
yh-kling-omni-4.0
yh-seedance2.0 mini Love
yh-wan3.0-video
```

### E2. 六个可核实型号合同卡

通用：上游 Base URL `https://yihongapi.com`；Bearer；JSON `POST /v1/videos` → 保存真实 `id` → `GET /v1/videos/{id}` → 完成后 `GET/HEAD /v1/videos/{id}/content`，由 NewAPI 鉴权内容通道取回并由画布本地保存。插件 key 保留 `yihong`；0.2.0仅有openai_video协议，用量facts为calls/seconds/resolution，resolution枚举为480P/720P/1080P，不再保留image_count/图片档位。旧0.1.7的公开名、图片计费表达式和客户端合同不能直接用于新版。

| 厂商精确模型名 | seconds / 文档缺省 | 清晰度 / 缺省 | 参考输入合同 | 附件上游成本（不是对外售价） |
| --- | --- | --- | --- | --- |
| `seedance2.5 Ultra` | 10–30整数 / 30 | 固定720p / 720p | image_urls≤14、audio_urls≤10，音频必须带图，不支持视频；仅用户补充确认HTTP(S) | 上游成本未提供；用户指定对外¥8.50/次 |
| `seedance2.5 super` | 5–30整数 / 5 | 720p / 720p | image_urls≤30、video_urls≤10、audio_urls≤10；或media，二选一 | ¥0.38/秒 |
| `seedance-2.5-Muse` | 仅5/10/15/30 / 30 | 720p / 720p | image_urls≤9；不支持视频/音频/首尾帧 | ¥7.40/次 |
| `seedance2.0 mini Love` | 4–15整数 / 5 | 480p、720p / 720p | images≤9；或input_reference单首帧；或content图/音频，不支持视频 | 480p ¥0.10/秒；720p ¥0.20/秒 |
| `kling-omni-4.0` | 3–30整数 / 5 | 720p / 720p | image_urls≤10、audio_urls≤3；不支持视频/首尾帧 | ¥0.185/秒 |
| `wan3.0-video` | 2–30整数 / 5 | 480P、720P、1080P / 480P | media：图≤10、视频≤5、音频≤5、首尾帧各≤1 | 480P ¥0.15/秒；720P ¥0.28/秒；1080P ¥0.33/秒 |

画幅：super为16:9/9:16/4:3/3:4/1:1/21:9；Muse仅16:9/9:16；Love为adaptive/16:9/9:16/1:1/4:3/3:4/21:9；Kling为1:1/16:9/9:16/21:9；Wan为adaptive/16:9/9:16/4:3/3:4/1:1。

Love注意：`image_urls` 不生效却可能不报错，插件接受内侧该字段时必须转成上游 `images`。`content` 图项形状为 `{type:"image_url", image_url:{url}, role:"first_frame"|"last_frame"|"reference_image"}`；音频项为 `{type:"audio_url", audio_url:{url}, role:"reference_audio"}`，最多3段、每段2–15秒。插件保留content/单首帧语义，拒绝不同参考入口混用；已提供的音频时长元数据校验2–15秒，纯URL音频的真实时长仍需素材准备/上游核实，不谎称插件读了音频字节。默认无声；可选generate_audio、seed、watermark、camera_fixed、return_last_frame按文档传，不新增其他字段。fast Zeus已取消，不再注册。

Ultra的ratio在用户补充中只是「建议16:9/9:16」，不是完整枚举；插件不凭空把其他比例列为已支持或擅自增加枚举限制。后续界面开放范围须有完整证据；缺省seconds=30仅用于没有传时长的请求，不能覆盖已有节点显式选择。

Wan注意：resolution发上游必须大写P；media参考视频每项duration_seconds为1–15秒、总长≤15秒，参考音频总长≤15秒；首尾帧与reference_*互斥，不能只有尾帧。文档「参考视频建议480P」不是明确禁止其他档位，不擅自增加禁用规则。prompt_extend按文档布尔值处理。

Muse不能把5–30连续范围当成四个允许值，不能把20秒自动改成15或30。文档默认值不等于用户已批准修改已保存节点；新默认值、轮询和其他边界要先说明再确认。

### E3. 上传和画布路径：不得只改插件

- 这六个视频型号需要公网可直接下载的URL；附件五个型号为HTTPS，Ultra依用户补充接受HTTP(S)。不在视频创建接口直接传本地文件，也不因此放开其他型号HTTP。
- 附件提供厂商 `POST /v1/uploads`（multipart字段file）换取URL，也允许自备HTTPS直链。这与小易文件直接编辑、灵动R2签名上传是三个不同合同。
- 厂商上传文档记录100MB总上限、72小时有效期、每账号1000个未过期文件；具体模型的图片/音视频限制更低。这些是厂商条件，不自动替换本项目20MiB等既有边界，也不在本轮擅自加删除任务。
- 用户已选择R2：源码新增 `POST /api/creations/yihong/upload-url`，仅六个公开yh名可用，绑定私有同桶 `yihong-temp/{用户ID}/{随机对象}`；旧灵动入口仍只接受其四型号，目录仍为lingdong-temp。浏览器校验与当前渠道匹配的固定主机、桶、目录、同一对象、方法/请求头和签名有效期，不放开成任意存储代理。
- 画布六个精确公开名已替换旧易红视频合同，上传先做本地合同/音视频时长/所有文件大小检查，再申请易红授权并PUT；失败/取消不创建任务、不回退OSS。其他渠道存储路径未改。保留用户历史节点和脚本；过期自定义脚本可能优先执行，部署前按A节逐型号核对，不自动清空。
- Love画布用content逐项表达reference_image或first_frame/last_frame及reference_audio，上传前要求每段音频有2–15秒有效时长。Wan视频要求每段1–15秒、总长≤15秒；音频要求有正数时长、总长≤15秒，不套用视频的1秒下限。未知/NaN时长先拒绝，不把缺元数据当0秒绕过总长。这里只读取已有素材时长元数据，不宣称重新解析了媒体字节。Love画布尊重现有声音/水印选择，传generate_audio/watermark布尔值；独立调用插件省略generate_audio时才沿用厂商无声默认。其他不支持这两个字段的型号不强传通用开关。
- 0.2.0插件已逐合同转换：Love→images/input_reference/content，Wan→media，super→数组或media，Ultra/Muse/Kling→各自URL数组；Muse四档时长、越界素材和未知参数在提交前拒绝。openai_image及图片构建/计费/测试已移除，不删其他渠道/宿主共用修复。
- 历史 `scripts/newapi-media/repair-yihong-images.sh` 会复制当前插件做图片夹具；0.2.0不再提供图片协议，禁止用旧脚本配合此版本重跑图片容量升级。现有生产补丁保持，不为了精简视频清除宿主历史补丁。

### E4. 用户已确认的操作决策与价格

1. **型号已确认**：六个yh-名称如E1，Ultra补充合同已用于插件，fast Zeus退出。
2. **完整对外售价已确认**：见下表及 `newapi-plugins/yihong-pricing.json`。按次用calls、按秒用seconds、分档用大写resolution；不拿厂商成本顶替售价。清单不会自动写入后台；宿主表达式执行与分组倍率、实扣、失败退款仍须分别验收。
3. **存储已确认**：易红改R2，沿用单文件20MiB、上传签名5分钟、读取签名6小时。超限先拒绝，上传失败不生成、不回退OSS。签名失效不是删除对象，仍未实现10分钟清理。无需创建公有桶或把凭据发到前端；私有env沿用现有R2键。
4. **查询预算已确认**：仅这六个易红型号浏览器每15秒查询，最多120轮、30分钟轮询预算；其他渠道及NewAPI后台轮询不变。达到截止时间不再发起下一次查询；进行中的网络请求仍受原网络层行为约束，这不是服务端任务取消。任务号由既有画布逻辑保留，之后继续查询/下载原任务，不重发收费POST。真实浏览器断网、刷新恢复仍待验收。

| 公开型号 | 售价 | Task Usage表达式 |
| --- | --- | --- |
| `yh-seedance2.5 Ultra` | ¥8.50/次 | `tier("base", u("calls") * 8.5)` |
| `yh-seedance2.5 super` | ¥0.50/秒 | `tier("base", u("seconds") * 0.5)` |
| `yh-seedance-2.5-Muse` | ¥9/次 | `tier("base", u("calls") * 9)` |
| `yh-kling-omni-4.0` | ¥0.25/秒 | `tier("base", u("seconds") * 0.25)` |
| `yh-seedance2.0 mini Love` | 480P ¥0.15/秒；720P ¥0.25/秒 | `u("resolution") == "480P" ? tier("480P", u("seconds") * 0.15) : tier("720P", u("seconds") * 0.25)` |
| `yh-wan3.0-video` | 480P ¥0.20/秒；720P ¥0.30/秒；1080P ¥0.40/秒 | `u("resolution") == "720P" ? tier("720P", u("seconds") * 0.3) : u("resolution") == "1080P" ? tier("1080P", u("seconds") * 0.4) : tier("480P", u("seconds") * 0.2)` |

### E5. TDD状态与后续闸门

1. 插件六型号集合、图片/其他型号拒绝、仅视频协议、公开名/真实ID/错误映射已模拟覆盖。
2. 每个型号缺省/合法边界/非法参数；Muse四档、Love图/帧互斥及可配音频、Kling不支持视频/帧、Wan大小写与duration_seconds。
3. 上传授权、URL读回、取消/上传失败不生成；不得只测mock的model名单。
4. 从真实画布提交形状经过实际插件decode/build，断言每张参考图片和音频都进入正确上游字段；新增型号不会误走通用multipart或旧脚本。
5. 真实task id持久化、原任务查询/恢复、失败原因、NewAPI鉴权content、浏览器本地保存；只恢复不重发收费生成。
6. 保留灵动和小易回归；删除目标插件图片能力不改变用户原图、历史记录或其他插件。
7. 计费事实与用户确认的售价逐型号对照，再按G0–G6分别验收；本地清单测试不是实际后台账单测试。

本地验证：全部插件Node模拟144/144、画布Bun主测试29/29（包含隔离图片/视频服务夹具）、Go `r2direct/ossdirect/jcmedia` 三包通过。实际六型号画布提交形状经过当前yihong插件decode/build；Love帧+音频、Wan分数秒音频、目录隔离、上传失败不生成、超时仅查原任务及恢复有模拟用例。小易测试已对齐当前五个xy图片；其当前插件无视频，旧客户端小易视频分支不能当成现插件支持证据。

用户已在服务器执行准备脚本并提供完成回执：新镜像 `jiucaihezi/new-api:rc40-yihong-six-r2-20261019`，PREPARED ID `sha256:bfd510bc74c2fb4bf2d7dd7c687aa6228a74273a2b061ca773702a1d371af428`；脚本依次完成builder构建、r2direct/ossdirect/jcmedia/jsplugin测试及最终镜像构建，生产仍未切换；回执磁盘可用8.6G。不要清理回滚镜像/容器/卷。

当前宿主激活回执及后台配置确认见本节末尾。下一步：发布并部署画布适配版本，再以同一用户Token核对六型号可见性、分类和脚本优先级，进行浏览器素材上传及经授权的单任务验收。**宿主激活、插件上传和计费填写都不等于六型号端到端成功。** 逐模型真实生成、结果保存/导出/原任务恢复、失败退款与实扣账单仍待G4–G6验收；不直接让用户在旧画布点击收费试错，不因等待超时重新提交已收费任务。

准备脚本为 `scripts/newapi-media/prepare-yihong-r2.sh`，仅针对用户核实的NewAPI镜像 `sha256:c9ff2598d34790b2ee2848e7e75984198b9716788d98cf9f77d98737fd9a6ab4`、四份Compose与固定源码。先备份三项媒体源码，再构建并在Linux builder内跑回归；失败恢复这三项源码，不切换容器、不改数据库/env/插件、不清理Docker资源。服务器准备结果见上方回执；不得把准备脚本当成激活脚本。源码包需要先由Mac传至服务器，不能在服务器使用Mac本地路径。

切换脚本为 `scripts/newapi-media/activate-yihong-r2.py`，同包需要 `activate-r2.py`（仅导入共享函数，不运行旧main）和 `backup_db.py`。它检查固定新旧镜像ID、原四Compose、合并配置及实际env/挂载/网络/端口，只修改既有r2覆盖文件的image；验证数据库备份后只重建new-api，保留四文件标签。隐藏输入用户Key，检查易红与灵动各一个合成小图的R2上传/GET/HEAD、旧OSS授权和公网两入口CORS；不调用生成。失败恢复原r2覆盖文件及旧镜像并验健康，私有备份目录含rollback.sh。激活新脚本4项、本来R2脚本5项、数据库备份5项本地模拟通过，不是生产切换通过；等用户完整切换回执再更新状态。

首次激活在运行环境比较处停止，尚未备份数据库或切换。用户只读核对显示旧镜像仍运行，唯一差异名为REDIS_CONN_STRING，来源Compose；没有输出其值。不能据此断言Redis实际凭据不同：本机Docker Compose v5.0.2的真实`config --format json`复现会把字面美元符号序列化为双美元符号（参见[Docker插值规则](https://docs.docker.com/reference/compose-file/interpolation/)）。v2切换包仅修正比较：只有该Redis字段的双美元还原后与运行值完全相等，且所有其他变量仍一致，才允许继续；真实值/主机/缺字段或其他变量差异继续拒绝。**不改Redis值，不用密码猜测或重新录入替代检查，不重建新镜像。** 新激活5项、旧激活5项及备份5项模拟通过；服务器是否确为等价转义仍待v2回执。若仍不等价，停止核实实际配置漂移，不跳过保护。

v2回执已证实Redis等价转义检查通过，数据库备份验证完成；切换后HTTP验证返回403，自动回滚到健康旧镜像，备份 `/root/jc-yihong-r2-switch-7_3rehf5`。随后用户验证旧服务的灵动R2授权/OPTIONS/PUT/GET/HEAD及OSS授权全部通过；公网curl两入口预检均204、灵动未鉴权POST401、旧易红POST404且CORS正确。相同服务器Python对照：默认User-Agent四请求均403，明确应用标识 `jiucaihezi-media-check/1.0` 则返回204/401/204/404。证明存在按客户端标识区分的公网拒绝，未据此定位具体Cloudflare/Nginx规则，也不能扩大为易红新链路全部通过。

当前仅给激活脚本verify_public中的OPTIONS/未鉴权POST添加上述已实测的应用标识，不关闭安全规则、不跳过401或CORS断言、不改R2/Redis/镜像；本地5项激活模拟通过，并验证从服务器已有v2包做两处定点替换会逐字得到本地已测脚本。用户可在服务器解压v2到新私有目录后定点替换运行，无需再次上传包或构建。仍需实际激活回执，若有其他403继续按阶段排查并保留自动回滚。

**宿主成功回执（取代上方阶段性“未切换/待激活”状态）**：用户提供 `YIHONG R2 ACTIVE`。新镜像ID为 `sha256:bfd510bc74c2fb4bf2d7dd7c687aa6228a74273a2b061ca773702a1d371af428`；数据库备份已验证，只重建NewAPI；运行env/挂载/端口/网络保持原值，Redis连接未变。易红Ultra及灵动flare各一次合成小图的R2上传/GET/HEAD、既有OSS授权和公网两入口预检/未鉴权POST的CORS探测通过。私有备份与回滚脚本位于 `/root/jc-yihong-r2-switch-9cbhtita/rollback.sh`，回滚前先验证文件仍在；不要对已激活环境重复运行只接受旧镜像的激活脚本。该次宿主回执时插件、售价和画布尚未更新，未调用模型；其后后台配置完成见下一条。此回执不是浏览器生成、全部六型号上传权限、厂商素材读取、结果下载或账单验收证据。

**最新后台配置确认**：用户在插件/渠道配置步骤及收到E4六条Task Usage表达式后确认“OK了”，并要求更新文档。现记录为用户确认易红插件0.2.0、六个yh-视频模型与计费表达式配置完成，不再要求重复上传、重复填写或重建宿主。表达式保持E4及 `newapi-plugins/yihong-pricing.json` 的既定售价和大写分辨率facts；这不是独立后台审计，也不是实扣或退款验证。画布新版本仍未构建发布/部署，真实生成与账单尚未验收；后续从画布发布和逐项验收继续。

## F. FK官方视频增量与图生图对照：源码就绪，生产未切换

### F1. 范围、合同与模型

用户指定新增三个官方Seedance 2.0型号，已有官方2.5只调售价；其他图片/视频型号及价格保持不变。随后用户明确纠正：带参考视频时跟上游Token计费，不是统一按秒。依据为用户提供的《官方渠道API对接》和《图片API对接》全文；不是猜测型号规格。插件为 `fk` 0.3.5，价格增量清单 `newapi-plugins/fk-pricing.json`，不能用此四项替换整个FK模型列表。

合同卡：上游 `https://ai.fanke2026.xyz/api/open/v1`，Bearer与 `X-Public-Model-Ids: 1`；视频 `POST /video/generate`，JSON采用imageUrls/videoUrls/audioUrls公网HTTPS数组，或multipart重复images/videos/audios；多媒体顺序保留，客户端不手写boundary。保存jobId，`GET /video/status?jobId=...` 查询原任务，成功须有videoUrl；有参考视频另须billing.mode=token、settled=true、total_tokens及charged_cost_cents合法。结果由现有NewAPI鉴权content通道免鉴权抓取签名URL，画布本地保存。文件与URL不可混用。API本地素材解析规格不自动覆盖现有上传大小/超时边界。

| UI / NewAPI公开名 | 上游ID | 无视频对外售价 | 带视频上游同价 |
| --- | --- | --- | --- |
| 官方渠道-Seedance 2.0 Mini 720p | `ft-video-v1-e820a676bd820bff4a79d2571fdb7fde` | ¥0.4/秒 | ¥10.5/百万Token |
| 官方渠道-Seedance 2.0 Fast 720p | `ft-video-v1-0a4bb4e7f4e95d0bd4ef584f2a4db1a3` | ¥0.6/秒 | ¥16.5/百万Token |
| 官方渠道-Seedance 2.0 满血 720p | `ft-video-v1-24ee1a4df896ea53869d6a2e5ae59a30` | ¥0.7/秒 | ¥21/百万Token |
| 官方渠道-Seedance 2.5 满血 720p | `ft-video-v1-451adae35b0c4a3d275c2c46394abc98` | ¥1/秒 | ¥31.5/百万Token |

三款2.0均为720p、4–15整数秒、9图/3视频/3音频；2.5保留720p、4–30整数秒、30图/10视频/10音频。比例均16:9/9:16/1:1/21:9/4:3/3:4。不猜未声明的提示词上限、音频需图或参考时长限制；账户实际权限及将来规格以所属站点/models为准。新增三款不新增缺省时长，不改已保存节点，沿用用户当前选择并在提交前验证。

### F2. NewAPI设置与计费

1. 上传并激活 `newapi-plugins/fk.plugin.js` 0.3.5，不上传测试/价格文件；不改上游Key、地址、分组或其他渠道。
2. FK渠道原模型名单保留，追加上述三个2.0公开名；2.5保留。插件同时接受公开名和真实ID，后台显式映射必须逐字使用F1对应ID；映射不代替渠道模型匹配。使用ID作为公开请求名时，将同一表达式登记到该ID。
3. 只更新这四项Task Usage。无视频完成保留seconds；视频参考成功结算后seconds=0、video_reference_tokens=实际总量、upstream_cost_yuan=charged_cost_cents/100。按上游已结算人民币分金额收取，准确包含四舍五入和最低1分；不是把两种模式同时收费。百万Token单价作为报价说明，不把total_tokens分别乘输入与输出单价重复收费。

| 公开名简称 | Task Usage表达式 |
| --- | --- |
| 2.0 Mini | `u("seconds") > 0 ? tier("base", u("seconds") * 0.4) : tier("video_reference", u("upstream_cost_yuan"))` |
| 2.0 Fast | `u("seconds") > 0 ? tier("base", u("seconds") * 0.6) : tier("video_reference", u("upstream_cost_yuan"))` |
| 2.0 满血 | `u("seconds") > 0 ? tier("base", u("seconds") * 0.7) : tier("video_reference", u("upstream_cost_yuan"))` |
| 2.5 满血 | `u("seconds") > 0 ? tier("base", u("seconds") * 1) : tier("video_reference", u("upstream_cost_yuan"))` |

沿用用户确认人民币售价与表达式系数同数值口径，但账号/分组倍率仍需对账；要求最终与上游相等时须保证倍率没有额外加价。宿主预扣仍沿用现有请求秒数估算，不是上游按参考总时长和画幅计算的Token预扣，也不是费用上限；最终补扣/退差额和失败退款必须真实验收，不能仅凭插件测试标为通过。不得在未结算时把Token数缺失当0结算。

### F3. 画布与发布边界

当前画布有精确FK合同表，因此新增三款需补齐中文名与ID对应的合法时长、720p、参考数量；沿用FK既有OSS→JSON提交，不迁移R2、不新增代理、不改图片传输。源码仅追加三款，不重写既有H3/Seedance合同；现有其他型号默认时长保持，三新型号不覆盖当前选择。无需构建或切换NewAPI宿主；上传插件、配置后台和发布画布是独立步骤。本轮不改桌面App创作面板的旧目录，不宣称所有客户端均已升级。

本地插件先复现缺型号再补齐：FK17/17、全部插件146/146通过；画布合同10/10、视频生命周期夹具24/24通过，包括20个FK公开名/ID的既有OSS→JSON路径与实际插件decode/build。未构建、未提交、未发布画布、未上传激活插件、未保存后台价格、未执行视频收费生成；Sandbox表达式实算、真实出片/下载/账单/退款待G3–G6验收。

### F4. 当前图生图故障：不要用新增视频型号掩盖

用户提供NewAPI运行镜像 `sha256:bfd510bc74c2fb4bf2d7dd7c687aa6228a74273a2b061ca773702a1d371af428`，容器运行、无OOM/重启，源码有multipart请求头补丁；这些不能证明实际转发已正确。

- FK渠道150，GPT-image-2.5 ID `ft-image-v1-186289ba9d3263010c69372f8939dd94`：Mac绕过画布直连NewAPI `/v1/images/edits`，三图、2K/16:9，96.256664秒返回HTTP500 / fail_to_fetch_task，请求号 `202610200427226438786398268d9d6i7I65pru`。
- 相同Mac、三图、提示词及型号/画质/比例，按官方multipart images字段直连FK `/api/open/v1/image/generate`，109.068847秒HTTP200 / success，jobId `cmvg7mt8j01rnhq3ncv6z5bkl`，1条生成结果，costYuan=0.030。此证据证明这次请求不依赖画布即可失败，以及上游曾成功；不证明结果已下载，也不证明两次Key/网络/时序相同。
- 下一步是香港服务器复用同一官方请求单次对照；脚本与本机三图已准备，等待用户SSH登录后上传到私有临时目录。Key隐藏输入、仅一次POST，不自动重发；若已有jobId，只查原任务。尚无服务器直连成功/失败回执，不能提前断言是插件、出口网络或FK自身故障。
- 小易渠道167是另一个失败：xy-grok-imagine-image-2.0异步阶段报告upstream_http_502，截图显示退款；没有FK的证据能替它定位根因。

## G. 2026-10-20 App四渠道目录校准（源码就绪，真实任务待验收）

事实源是当前`yihong.plugin.js` 0.2.0、`yuanliu.plugin.js` 0.1.0、`fk.plugin.js` 0.3.5、`lingdong.plugin.js` 0.4.0；定价分别以本仓已确认的pricing清单及既有售价为准，不从厂商成本自动加价。此次不修改插件、NewAPI后台、宿主或存储配置；本机ComfyUI问题按用户要求暂缓。

| 渠道 | 当前App可选图片 | 当前App可选视频 | 本次校准 |
| --- | --- | --- | --- |
| 易红 | 0 | 六个yh-型号，见E1 | 新增精确公开名；旧11个视频与旧图片隐藏但保留历史ID；六型号时长/分辨率/参考数量与插件对齐，Muse只允许5/10/15/30秒；Ultra不捏造比例枚举 |
| 源流 | 0 | 两个yl_seedance型号 | 保留30图、0/10视频、0/10音频；只要求正整数时长；不发送未经核实的比例/分辨率，包括界面残留值 |
| FK | 六个ft-image型号 | 九个Seedance + H3，共10个 | 补齐官方2.0 Mini/Fast/满血；官方2.5面板价改回已确认清单的¥1/秒及参考视频¥31.5/百万Token，2.0三款¥0.4/0.6/0.7每秒；图片售价保持 |
| 灵动 | flare、sunburst | 两个sd2.5按次型号 | 保留四公开名；图片参考走上传URL后的JSON generations，不走multipart edits；客户端要Base64，插件仍向厂商要URL |

易红新请求仅发送插件接受的字段，避免旧通用请求同时附带image/imageUrl/imageUrls而被严格校验拒绝。Ultra音频配图在计划阶段检查；Wan按media表达图/视频/音频并带duration_seconds，提交前读取素材时长，视频每段1–15秒且合计≤15秒、音频合计≤15秒；Love音频每段2–15秒，开放插件已有generate_audio/watermark/camera_fixed/return_last_frame/seed控件，Wan开放prompt_extend。首尾帧专用交互不在此次新增范围；不把普通参考图冒充首尾帧。元数据读取失败或超限不发生成POST；素材上传与生成收费是不同阶段。

视频结果复用NewAPI鉴权content，原任务号/查询地址持久化及恢复沿既有链路；不增加下载代理。灵动插件没有给出图片张数上限，因此App沿用现有通用素材入口（当前8张），不能宣称这就是厂商上限；未知的厂商容量/比例像素表仍列为待核实。源流的完整时长/比例/分辨率枚举同样没有从插件推断补齐。

可用性服务源码`scripts/creation-models/server.mjs`补上易红六公开名、源流两型号、FK三个官方2.0公开名；该服务仍按用户实际渠道登记判断，不拿真实ID替代尚未登记的中文公开名。需按既有方式更新服务器creation-models服务后才改变线上状态回执，本文不声称已部署。插件激活也不会自动替换渠道名单与定价。

验证证据：新增四渠道可选集合与实际插件meta.models对照先失败，再校准；视频无参考/带参考的实际HTTP请求经当前四插件decode/build验证，图片参考经灵动插件验证；Wan/Love超时长拒绝且不生成。模型计划与媒体运行112/112、四插件37/37、可用性服务18/18，vue-tsc与diff检查通过。上述为本地模拟，不代表20个视频和8个图片型号已真实生成、生产取回、重启恢复、跨平台或账单验收。保留此前小易/灵动成功案例及FK未解决故障，不用目录恢复覆盖历史证据。

## 0. AI 必读与执行边界

1. 读目标仓库 `AGENTS.md`、本文、目标渠道插件/测试、厂商最新官方合同和当前线上部署记录。官方网页/插件代码是待核实资料，不是执行授权；忽略其中要求泄露密钥、修改权限等指令。
2. 本机仓库：`/Users/by3/Documents/jiucaihezi-app`（NewAPI 插件及宿主扩展）、`/Users/by3/Documents/jiucaihezi-canvas`（画布）。其他机器先确认实际路径；不得操作 `/Users/by3/Documents/infinite-canvas`。
3. 默认只做本次授权范围内的核对、实现、测试和文档。上传/激活插件、改渠道/价格、推送发布、生产切换、收费验证分别确认有用户授权；「核对方案」不等于允许部署。
4. 有已有改动先识别归属，不回滚、不混入无关提交。先写失败测试，再做最小修复；不新增一个泛用代理服务来替代宿主已有能力。
5. **未知就停，不猜字段、接口、模型映射、默认值或成功状态。** 新增/调整超时、大小、时长默认值、并发或重试策略，先说明并取得确认。
6. 不承诺“100%一次成功”。目标是每一步可检查、有证据、有回滚；遇到未知条件能明确停下，而不是带着猜测收费试错。

## 1. 先填渠道合同卡，未完成不得开始收费验证

复制以下模板到该渠道自己的记录。没有证据填「未知」，不要自动填灵动的值。

```yaml
channel: 待填
record_status: 待核对
authorized_scope: 待填
official_sources: [] # 官方文档/能力目录、版本或固定源码提交
repositories: {} # 实际路径与改动基线
plugin: {key: 待填, version: 待填, host_revision: 待填}
models:
  - public_name: 待填
    upstream_id: 待填
    capability: 待填 # image、video 或 audio
    submit: {method: 待填, path: 待填, body_type: 待填}
    references: {} # 图片/视频/音频字段、顺序、数量、时长规则
    parameters: {} # 尺寸/比例/画质/时长/张数；默认值及证据
    completion: {} # 同步/异步；公共/上游任务号、查询路径、终态及结果字段
    timing: {} # 生成/两层轮询/请求超时/结果传输/落盘，各阶段独立记录
    billing: {} # 张/次/秒/token、用量事实、表达式、分组倍率
storage: {} # R2/OSS/厂商上传，桶/路由/签名方法/有效期/CORS
result_delivery: {} # NewAPI Base64 或鉴权 artifact/content，失败如何恢复
deployment: {} # 当前镜像ID、Compose、端口/挂载、备份与回滚
acceptance: [] # 每条记录模型完整名、能力、版本、证据和未覆盖范围
```

核对维度必须分开：公开名不等于厂商 ID；URL 输入不等于 URL 输出；图生图不等于图生视频；某个渠道有该模型不等于当前用户 Key 有权限；脚本分支和内置分支也不等价。

## 2. 明确职责，不混淆两段 URL

| 环节 | 正确责任 | 不能据此宣称 |
| --- | --- | --- |
| 原图读取 | 客户端读取浏览器本地保存的原图，不拿缩略图冒充素材 | 看见缩略图就代表原图可读 |
| 素材传输 | 文件渠道经NewAPI宿主直接转发；URL渠道由NewAPI鉴权/签名，客户端直传存储 | 上传200/204就代表厂商读到素材 |
| 模型提交 | 插件翻译公开名与厂商合同；只发已核实字段 | 接口兼容OpenAI就能原样转发所有字段 |
| 生成结算 | NewAPI 保留真实任务/结算事实，按渠道规则收费 | 请求200就代表最终结果已取回 |
| 图片取回 | 优先复用宿主服务端下载转换，客户端接收Base64 | 生成URL能在新标签打开就代表浏览器fetch可读 |
| 视频/音频取回 | 按厂商合同和真实任务号查询，使用已有鉴权content/artifact或已核实的字节结果通道 | 能预览/播放就代表下载、落盘、刷新恢复通过 |
| 本地保存 | 客户端完成原始结果保存，再显示成功 | 外部URL可见就等于浏览器本地持久化 |

URL链路：原图 → 已授权存储直传 → 输入URL → 插件调用 → 输出URL → **NewAPI取回** → 客户端本地保存。文件链路：原图 → multipart → NewAPI/插件 → 厂商 → Base64或已支持的结果取回 → 本地保存。输入URL需要厂商可读；输出URL不应依赖浏览器跨域许可。两者的CORS、鉴权、故障环节不同。

## 3. 上传合同：复用已有实现，不擅自全站迁移

- 先确认厂商到底接受文件、Base64、URL还是上传令牌；文档未列文件接口，不能仅因OpenAI习惯就发multipart `/images/edits`。厂商支持文件时，也不要强迫它走URL。
- URL渠道优先复用 `web/src/services/api/media-upload.ts`。R2 PUT与OSS表单POST不是一个合同，不能交换请求方法或字段。
- 灵动使用私有R2：`/api/creations/lingdong/upload-url` → 签名PUT → `asset_url`。易红新增独立 `/api/creations/yihong/upload-url`（源码就绪，生产未部署）。两渠道均已批准20 MiB、上传5分钟、读取6小时，不是任意新渠道默认值；其余保留现有OSS/文件路径。
- 新公开名必须同时检查：插件模型集合、画布图片/视频合同、上传路由选择、服务端签名白名单、后台渠道模型与定价。改前缀不能只改下拉列表。
- 校验上传授权目的地、固定桶、同一对象、方法和头；R2不携带NewAPI Key、Cookie或厂商密钥。保留签名URL原始编码、参数和素材顺序。
- 签名GET不能用来做HEAD。若厂商会HEAD预检，必须核实兼容方式；不能因为自己GET通过就宣布厂商可读。
- 先用无敏感测试素材做上传/读回，不调用模型。上传失败、原图缺失或取消：不提交生成，不悄悄切OSS或压缩素材。

## 4. 图片结果取回：灵动成功的关键

固定NewAPI源码 `0aec08fee811ec6136828fda790551b49e410301` 的 `controller/plugin_protocol_image.go` 已实现宿主转换：

源码依据：[图片协议实现](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/plugin_protocol_image.go)、[同版本插件协议说明](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/docs/plugin-api/v1.md)。升级宿主后重新核对，不照旧结论跳过代码检查。

```text
画布 → NewAPI：response_format = b64_json
NewAPI插件 → 厂商：response_format = url（以厂商实际合同为准）
厂商 → 插件：data[].url
NewAPI：服务端下载URL，补入 data[].b64_json
画布：优先取 b64_json，解码并保存本地，不跨域抓厂商图片
```

- **客户端的响应格式和插件向厂商发的响应格式是两个不同合同。** 不要看到插件里是url，就把客户端也改成url；也不要未经厂商核实就让插件强求厂商返回Base64。
- 图片协议render只组装数据，不执行下载；不要添加import或浏览器fetch。新版宿主某些驱动hook有只读utils.fetch，但不等于当前部署或render能上传/下载任意媒体，更不能据此绕过宿主限制。
- 先查部署的宿主版本是否有这项能力，再复用；别把本宿主行为当成所有NewAPI版本通用事实。
- 该宿主下载失败会保留URL并记录警告。因此200不等于取回成功：验收必须看 `data[].b64_json` 或可证明的等价本地结果，并确认客户端保存。不要再把回落URL当作成功路径。
- 图片的即时结果可能不持久保存于宿主：此版本 `openai_image` 即时终态数据会被丢弃，不能保证事后能从任务表恢复结果URL。失败时保留已有响应/结果引用（脱敏、受控保存），禁止用重新生成代替下载恢复。
- 其他协议可能用宿主artifact/content能力；图片render没有视频那样的 `ctx.artifacts`。不能机械复制视频实现。

## 5. 最小TDD测试矩阵（先红后绿）

| 范围 | 必须验证 |
| --- | --- |
| 精确型号 | 每个实际公开名到厂商ID；删除的名字拒绝；前缀不丢失路由；图片/视频协议分开 |
| 素材 | 原图字节；多素材顺序；输入URL含签名仍原样；错误授权/非法目的地/取消/上传失败不生成 |
| 图片请求 | 文生图不上传；URL图生图先上传再JSON，文件图生图直接multipart；灵动客户端b64_json/厂商url，小易厂商b64_json；解析Base64优先于同条URL |
| 图片异常 | 空结果、未知形状、宿主取回失败/URL回落、本地保存失败不能冒充成功；下载恢复不重新收费 |
| 视频/音频请求 | 按型号验证时长/分辨率/音频格式/参考类型、对白或音色绑定；即时字节与异步任务分开；真任务号持久化、终态及原任务恢复 |
| 异步生命周期 | 提交受理后先保存公共任务号再查询；两层查询职责明确；终态有有效结果；查询404、网络中断或保存失败均不重新提交 |
| 费用 | 张数与实际结果数、按次不乘时长、按秒/token按对应事实；上传插件不会自动保存后台定价 |
| 回归隔离 | 其他渠道及用户自定义脚本不被改变；用真实插件decode/build而不只用自造mock |

现有入口：画布 `web/tests/newapi-media-contract.test.ts`、`web/tests/fixtures/image-request.case.ts`、`web/tests/fixtures/video-task-lifecycle.case.ts`；App `newapi-plugins/__tests__/*.test.mjs` 及 `scripts/newapi-media/extension/r2direct/` 测试。

按仓库规范与用户授权运行必要测试；未经允许不为文档任务构建、发布。mock通过只证明合同分支，不证明真实厂商、网络、读回或收费正确。

## 6. 部署顺序：按实际变更决定，不多做一层

1. 只读核对线上镜像ID、源码、插件版本、渠道映射、Compose文件列表、env/端口/挂载和磁盘。输出脱敏；不读取或展示Key。
2. 先备份受影响配置/源码；涉及NewAPI重建时保留实际数据库的可校验备份和原镜像。备份位于服务器私有目录，不进Git。
3. **仅响应格式变更：**像v0.20.7一样，只发画布；不动插件、NewAPI或存储。
4. **仅插件改动：**上传正确的 `*.plugin.js`，不是 `__tests__/*.test.mjs` 或价格JSON；激活新版并同步渠道名单/定价。保留旧版本回滚。
5. **白名单或宿主改动：**新镜像构建和测试成功后，先升级宿主，再部署依赖它的客户端；保留完整Compose/原环境/原补丁。不复用旧脚本固定的镜像ID或旧基线。
6. 运行时env按键值比较、挂载按目标路径比较，不因数组排列变化误判配置改变。就绪探测要区分启动瞬态与真实故障；按现有部署预算处理，不静默改变业务重试。
7. 只重建受影响容器，不重启服务器；失败恢复旧镜像/配置。成功后核对公网新资源、实际版本和所需CORS，不止看首页200。
8. 写入精确提交、tag、Actions结果、镜像digest、回滚位置、通过与未覆盖项。代码、构建、发布、生产运行、用户验收是五个独立状态。

## 7. 逐项验收闸门

| 闸门 | 通过证据 | 未通过时 |
| --- | --- | --- |
| G0 合同 | 官方资料+当前代码+合同卡；未知项已消除 | 停止猜测，向用户/厂商核实 |
| G1 本地 | 红测→绿测；真实公开名/插件/受影响调用者回归 | 不发布、不收费试错 |
| G2 无生成网络 | 上传授权、字节读回、CORS、签名方法正确 | 修当前环节，不提交模型 |
| G3 生产版本 | 备份/回滚可用，插件/白名单/客户端实际版本一致 | 恢复已验证基线 |
| G4 单次真实 | 经授权的非敏感最小任务，记录请求ID/任务ID与阶段 | 有任务就恢复原任务，不重复提交 |
| G5 结果闭环 | 图片本地显示；刷新读回；文件导出/视频下载分别确认 | 保存结果引用，只修取回/保存 |
| G6 费用 | 对上游成本、NewAPI实扣、张数/时长/分组倍率逐项核对 | 不标记计费已验收 |

不能用“某一次图生图成功”替代整个模型集合或图生视频验收。每个模型按能力、文生/图生、素材类型与结果链路分别登记。不将同一测试的费用扩大到未获授权的多模型批量测试。

## 8. 排障速查：只修断掉的那一段

| 症状 | 优先核对 | 禁止操作 |
| --- | --- | --- |
| 503 model_not_found / 无可用渠道 | 发送的完整公开名、渠道名单/映射、启用状态、用户分组与Token权限 | 有管理员渠道就认定用户必定能调用 |
| JSON body required | 客户端是不是误发multipart，协议/型号是否匹配 | 无证据换插件、改上传桶 |
| upload-url失败 | Key权限、公开名白名单、接口与授权字段 | 绕过鉴权、扩大到任意桶 |
| R2返回204但浏览器失败 | 上传响应CORS/Origin，而非只看状态码 | 直接开放公有桶来掩盖问题 |
| 生成200后img请求CORS | 客户端response_format、宿主是否下载成功 | 继续改输入素材上传或重新生成 |
| 524 / Nginx499，已有上游任务号 | 是否把异步生成包在同步HTTP等待中；查同一任务及后台生命周期 | 仅延长超时、反复切DNS或重新生成 |
| 后台成功、App仍处理中 | 两层查询时间、宿主快照/render、响应体传输、App恢复与落盘，见§8.2 | 把后台成功当客户端已收到，或直接缩短间隔掩盖问题 |
| 上游有结果，客户端超时 | 已有任务/结果、宿主取回、本地保存各阶段 | 自动增加重试次数或再次扣费 |
| 新模型不显示/走错协议 | 公开名、分类、通道映射、插件binding、画布合同 | 因名字包含image/video就代替合同核对 |
| 本地保存失败 | 原始结果是否仍在、浏览器存储与保存重试 | 直接丢弃结果并重新生成 |

### 8.1 所有媒体模型通用维修顺序

1. 固定一条失败请求：记录客户端/平台、精确公开名、能力、插件/宿主实际版本、请求ID、公共/上游任务号和北京时间；密钥、签名查询串、完整Base64及敏感素材不贴入日志。
2. 沿链路逐段核对：模型展示与权限 → 原件读取/上传 → 请求合同与映射 → 上游受理 → 后台生成/两层查询 → 结果传输 → 本地保存/画布写入 → 计费。在哪段首次偏离合同，就修哪段。
3. 先查原任务：受理后的连接超时不代表生成失败；生成失败、查询失败、下载失败、保存失败分别处理。恢复查询/下载/保存不得再次发收费POST；没有任务号也先关联请求日志，不能认定可以安全重提。
4. 异步厂商优先复用NewAPI已有任务生命周期，使创建请求只等受理；纯同步厂商需先核实能力，不能套用小易路由或凭空发明查询接口。视频/音频可沿已有异步/content合同处理，不要求全部转Base64。
5. 本地复现根因并补回归，最小范围修改；按§6部署、§7逐项留证。成功就登记具体型号/能力，未测项和残余故障继续保留，不以换服务器、重装客户端或全站迁移代替定位。

### 8.2 后台成功但客户端迟迟无结果：必须拆开计时

| 时间点 | 应记录的脱敏证据 | 用于区分 |
| --- | --- | --- |
| T0提交、T1受理 | 创建请求起止、HTTP状态、公共/上游任务号 | 提交慢或重复创建 |
| T2上游完成、T3宿主写入终态 | 上游查询起止/结果状态、任务终态时间；没有厂商时间就填未知 | 厂商排队/生成与宿主后台轮询、存储延迟 |
| T4客户端每次查询 | 请求发出、服务器接收/响应时间、状态、响应字节数 | 未发查询、请求阻塞、宿主渲染/结果读取、终态后仍回旧快照 |
| T5响应头、T6响应体读完/解析完成 | 客户端网络计时；代理request_time/upstream_response_time与body_bytes_sent | 首字节慢、Base64大响应传输慢或解析慢 |
| T7本地保存开始/结束、T8画布写入 | 接收结果时间、文件字节数、mtime、保存/画布状态 | 传输与落盘/索引/画布更新延迟 |

`apiCall`当前在收到响应头后才调用`res.json()`；源码中的超时清理点在safeFetch返回后，不能据“GET超时60秒”推断整个响应体读取一定60秒内结束。这是需要纳入测量的代码边界，不是本次延迟已确认的根因。禁止打印完整结果体；记录长度、状态与时间即可。

先查相同公共任务号在NewAPI与反向代理的日志；将每次GET与客户端日志对齐。后台截图的完成时间可能不同于厂商真实完成时间，也不能代替客户端收包时间。轮询10秒表示两次请求之间的等待，实际间隔还包含请求耗时；页面累计秒数不必然是墙钟时间。若历史日志缺少阶段计时，明确结论边界，下一次已获授权的测试再补证，不为收集耗时自动创建收费任务。

## 9. 已确认案例与未覆盖范围

- 灵动：画布v0.20.7，插件lingdong 0.4.0，用户明确反馈成功，截图中多参考图生图的结果节点已显示。证明此次R2输入→厂商生成→NewAPI结果取回→画布显示闭环通过。
- 小易：0.3.1已激活；App开发版xy-gpt-image-2.5-flare-1k文生图一次成功，原图落盘、画布写入通过。详情及延迟见C5。其他型号/编辑、刷新恢复、容量边界与实际计费仍待验收。
- 成功截图中的模型下拉被截断；不从截图推断四个型号都通过。前次失败账单对应flare，不据此补写本次成功型号；下次直接从成功配置补录完整公开名。
- 刷新后读回、导出原文件、sunburst逐模型结果、文生图、两个视频模型、视频下载/恢复和NewAPI实际账单，未由这张截图确认，继续保留待验收。
- 失败教训：0.20.5新公开名不匹配 → multipart被拒；0.20.6输入改通但结果URL被CORS拦；0.20.7仅修客户端b64_json合同，复用宿主已有下载能力后用户确认成功。

验收记录模板：`完整公开名｜能力/素材｜客户端+插件+宿主版本｜请求ID/任务ID（无密钥）｜上传/生成/显示/刷新/导出/计费分别状态｜证据｜未测项`。

## 10. 后续渠道实施顺序与可复制指令

先盘点已有渠道，区分文件、URL、厂商上传令牌与未明确合同。只选**一个用户指定的媒体渠道、一个模型、一种能力**复用流程验证；通过后再扩展同渠道型号，最后才评估是否需要共用目录/自动化。不要先批量迁移存储或建立新框架。

可直接交给AI的指令：

> 先完整读取《URL素材渠道接入执行手册》和两仓AGENTS.md。目标渠道是【名称】，官方资料是【链接/附件】，插件是【路径】，目标公开模型是【精确列表】。本次授权范围是【核对/实现/测试/发布/部署/收费验证，逐项说明】。先填合同卡并列出未知项、修改范围和TDD用例；有未知先核实，不猜接口。复用已有上传及NewAPI结果取回能力，分别验证输入URL和输出交付。保留已有改动，不动其他渠道，不变更未批准边界，不重复提交已收费任务。每完成一个闸门记录证据，未真实验证的项目不能写成成功。最后交付改动文件、版本、回滚位置、验收矩阵与剩余事项。

### 2026-10-20 App小易图片目录对齐0.3.0

合同卡：仅App创作面板五个小易图片型号；准源为 `newapi-plugins/xiaoyi-image.plugin.js` 与 `xiaoyi-image-pricing.json`。四个GPT仅1K、¥0.04/张，Grok1K/2K、¥0.08/张。既有内部ID保留，提交改为xy公开名，UI显示小易来源，Flare/Sunburst1K重新开放；历史其他渠道与任务不删除。参考图继续走现有multipart文件合同；NewAPI插件负责异步上游与结果取回，不新增代理。像素尺寸按插件预设映射，非预设尺寸在提交前拒绝。

证据：G0旧Grok提交未带xy前缀，两条提交回归复现；G1/G2五型号公开名、UI价格、分辨率及所有可选尺寸的文生图/文件编辑插件合同通过。模型计划+插件68/68，小易定向提交5/5，vue-tsc通过。完整媒体运行45/46，失败为易红旧 `grok-imagine-video-1.5-preview` 不在当前易红插件中，本次不改。G3–G6生产生成、取回、实扣及跨平台未执行；前端展示价不代表已改NewAPI表达式，账号/分组倍率仍需真实账单核对。

可用性路由同步：`scripts/creation-models/server.mjs` 的四个GPT 1K路由补上 `xy-` 公开名别名（保留旧名兼容）。生产 `/api/creation/models` 原先返回「NewAPI 未配置该模型渠道」，面板据此把发送键锁死；本地 `node --test scripts/creation-models/__tests__/server.test.mjs` 17/17 通过。服务部署到 `/opt/creation-models` 并重启 `creation-models` 后，重新打开创作面板即可生效，无需重装 App；部署与线上接口回执未执行。

### 2026-10-20 小易524改为原生异步任务（已激活，flare单次成功）

合同卡：五个xy图片模型，输入/尺寸/价格不变；插件0.3.1新增原生提交、查询路由，旧同步OpenAI接口保留。App复用现有onSubmitted保存公共task_id与查询地址，后台轮询取回Base64；不新增代理、不修改DNS、不重复提交已受理任务。其他渠道不迁移。依据为NewAPI官方docs/plugin-api/v1.md的meta.routes/native合同。

G0：服务器日志显示20:47:05请求已在20:47:27受理，返回公共任务号task_uxPnOf8woQy0lGLWU4xP5wDbbXMpqJLK，但task_sync=true继续等待；Nginx随后499，客户端约126秒收到524，20:50:04轮询上下文取消。200日志不能证明图片交付。

G1–G2本地：插件12项、计划与URL安全68项、定向运行6项及vue-tsc通过。涵盖五型号文生图/文件编辑、公共任务号先保存再查询、处理中到Base64结果、失败状态和404不退回重复提交。旧同步协议及其他渠道保留。

后续进展：用户已上传激活0.3.1并完成flare文生图测试；生产原生提交/查询和该次结果本地保存、画布写入已有证据，见C5。先前后台白屏与SSH拒绝是当时部署阻碍，不能继续写成当前未部署。重启恢复、容量边界、其余型号、账单与跨平台仍待验收；结果交付延迟尚未定位，不能宣称性能故障或全渠道均已修复。

### 2026-10-20 App恢复FK六图片型号与本机Qwen500排查

合同卡：以当前`newapi-plugins/fk.plugin.js`的六个图片ID为准，用户提供账号目录中的显示名；App只恢复可见性与显示映射，不修改FK插件或后台渠道/价格。四个GPT原先hidden=true导致面板缺失，两个banana保留旧简称；现六个均可见，内部ID与发送model仍用原ft-image编号，不用显示名替代厂商编号，避免与其他渠道同名GPT冲突。现有FK分组保留。1K/2K/4K与参考图上限沿插件，文生图走NewAPI generations，文件编辑走NewAPI edits，由插件转换到FK标准image/generate；不直接调用FK不存在的/v1/images/edits。

| App显示名 | 提交model（沿用NewAPI渠道登记） | 参考图上限 | 保留的面板售价 |
| --- | --- | --- | --- |
| GPT-image-2 | ft-image-v1-211f28f47b0355abb1798f72eb65f22d | 10 | ¥0.08/张 |
| GPT-image-2.5 | ft-image-v1-186289ba9d3263010c69372f8939dd94 | 10 | ¥0.08/张 |
| GPT-image-2.5-flare | ft-image-v1-eb47192eb578f340043911005a06fb6e | 10 | ¥0.08/张 |
| GPT-image-2.5-sunburst | ft-image-v1-3432bdee1a22da4ce8ff2bbfc6ef4c1d | 10 | ¥0.08/张 |
| nano-banana-2 | ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82 | 8 | ¥0.20/张 |
| nano-banana-pro | ft-image-v1-d51c811d3d74a5b2433e6916ab564db9 | 8 | ¥0.30/张 |

截图中的0.03/0.12/0.15/0.20元是上游账号使用价格，不据此自动替换对外售价或后台表达式。G1：先新增六项可见测试复现失败，再恢复；模型计划59/59、FK插件17/17与vue-tsc通过，测试包含实际插件decode/build的六型号三档画质、文生图/编辑路由和精确编号。G3–G6本轮未做新发布或收费生成，先前FK图生图故障仍见F4，恢复显示不等于修好生产生成。

本机Qwen：2026-10-20 22:02:20，jc-qwen-image-2.1经/v1/images/generations返回HTTP500/do_request_failed，请求号`202610201402201767677028268d9d6ICKVrGod`。仅有App错误不能判定显卡、工作流或Cloudflare故障。实际链为NewAPI → frps:8796 → Windows frpc → comfy-adapter:9000 → ComfyUI:8188；本机指GPU Windows，不是运行App的Mac。0.3.1小易异步路由不匹配此模型，本轮没有修改comfy插件/适配器。

只读诊断：Windows仓库comfy-adapter目录运行`powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action status`；服务器按请求号筛选NewAPI日志，核对实际访问地址、connect refused/timeout/HTTP错误和耗时。frpc进程存在或历史login成功不代表当前端到端可达，仍需从NewAPI容器GET http://frps:8796/health核实。8796是容器内出口，宿主ss未监听不能证明隧道断。8797聊天隧道是另一条链，不能拿其旧connect refused替本次Qwen定位。等待实际日志后修断点，不重启整台机器、不改显存策略、不反复收费试图复现。

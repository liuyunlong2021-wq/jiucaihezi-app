# FK Seedance 2.5 模型与标准视频合同对齐

## 2026-10-22 图片成功但结果未保留（0.3.7，本地修复）

合同卡：仅FK图片成功生命周期与图片制品声明/取回；不改模型、价格、素材提交、视频或历史账务。渠道150的三笔text_to_image成功任务data为SQL NULL、result_url非空；不能据此宣称上游文件已丢失或URL仍有效。固定宿主 `0aec08fee811ec6136828fda790551b49e410301` 的 `docs/plugin-api/v1.md` 说明openai_image即时终态直接交付且丢弃持久结果；后台 `resolveTaskPreviewMode` 根据result_discarded显示“结果未保留”，仅增加listArtifacts不能解除该标记。

0.3.7不再为图片提交成功返回immediate，而用已有GET image/status查询同一jobId后完成，复用宿主持久化，不重提生成；同步OpenAI图片返回格式不变，但多一次查询等待。制品按宿主真实action（制品上下文没有model）区分图片与视频；每张HTTPS图片声明image_N，通过credentialless GET/HEAD取回，不猜MIME。保留0.3.6零用量退款保护。

G0回归先复现immediate SUCCESS；G1–G2：FK19/19、全部插件149/149通过，覆盖原任务查询、多图列表/内容、签名URL、不带上游鉴权、非法编号/越界/非HTTPS拒绝、图片响应格式与视频保留。G3上传激活、G4真实生成、G5后台查看/下载、G6实际账单待验收；未运行真实宿主集成测试。不恢复历史result_discarded任务，不修改数据库。上传 `newapi-plugins/fk.plugin.js` 0.3.7前备份当前激活版本；旧任务是否使用生产时插件版本由宿主决定。

## 2026-10-21 成功任务被零用量结算全额退款（0.3.6，本地修复）

合同卡：仅修改 FK 插件完成用量提取；模型、价格表达式、素材、提交/查询/结果取回与历史账务不变。用户提供生产只读 SQL：渠道149的三笔成功任务最终 quota=0，其中 `task_NIi2lxUYaeydborbZ5j9cYMepkZ6pwfJ` 的结算日志显示预扣5500000、实际0、全额退款；完成响应无 duration/seconds/resolution，billing=null。生产插件缺失字段仍返回零用量。完成 hook 未获得有效请求回退值的具体宿主原因尚未查明。

0.3.6 对按秒完成结算要求有效时长；480p/720p分档型号另要求合法分辨率。缺失事实返回 null 保留预扣，不把缺失当免费；按次、已结算Token、图片与历史兼容查询保留。G0：新增回归先失败，实际返回全零用量。G1–G2：FK18/18、全部插件148/148通过，覆盖缺失/部分字段、非法分辨率、请求回退、上游实际秒数、嵌套响应、按次和Token结算。G3生产上传激活、G4真实生成、G5结果交付、G6修复后实扣尚未执行；不代表已生产止血，不自动补扣历史任务。上传文件为 `newapi-plugins/fk.plugin.js`，版本0.3.6；回滚前应从后台备份当前激活版本。

## 当前阻断修正：0.3.4 文件元数据字段

用户生产截图显示 `Unsupported video file field: undefined`。固定宿主 SHA `0aec08fee811ec6136828fda790551b49e410301` 的 `middleware/task_plugin.go` 提供 `{field, ref, filename, mimeType, size}`；插件 0.3.3 却读取 `name/fieldName`，原测试也手填同样错误的结构。0.3.4 只改为读取 `file.field`，两仓视频夹具同步真实结构；先复现与截图一致的错误再修复，不改模型、素材字段白名单、价格或上游端点。需上传激活 0.3.4；无需重新部署已有 v0.20.3 画布，真实转发/出片仍待验收。以下 0.3.3 记录是历史实施，不代表宿主已通过。

## 当前补充：H3 标准接口（插件 0.3.3，尚未生产激活）

用户最新上游文档及 NewAPI 截图确认七条公开映射：原六条 Seedance 保持，新增 `fk-MiniMaxh3` → `ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746`。H3 同样使用 `/api/open/v1/video/generate`，支持 JSON 公网 HTTPS URL 或 multipart 重复 images/audios 文件字段；768p、1–15 秒、9 图/0 视频/3 音频。旧的「H3 只能走兼容接口、必须 URL」结论已失效。

插件 0.3.3 移除按 H3 型号固定兼容分流，标准提交保存 jobId、按标准 status 查询；根据旧提交快照保留历史兼容查询。新增公开名、规格校验与字符串错误保留，图片和计费表达式不改。Canvas 仓库同时补齐 H3 文件合同与能力识别；已有分类/脚本不自动覆盖，需要用户核对视频分类及移除过期脚本。

TDD 先复现未知公开名、画布合同缺失和字符串错误丢失；修复后 FK 15/15、全部插件 152/152、Canvas 媒体定向回归 10/10。未构建、未提交、未上传激活插件、未执行生产收费生成。发布须配套激活 FK 0.3.3 与新版 Canvas，再验证参考图/音频、查询、下载与账单。此改动不升级 App 安装包或 NewAPI 宿主。

最新文档标注 `89e872…` 仅凌晨 1–11 点可用；`b8a797…` 未列入最新账号清单，保留原映射并待 FK 确认，不擅自改绑成 XN4。未新增客户端时间限制、重试或超时。以下保留原六型号实施历史。

日期：2026-10-14。依据：用户从 FK 官方页面复制的当前账号视频文档，已同步到 [[运维/FK上游api视频]]。用户限定只对齐 Seedance 2.5；保留既有图片及 MiniMax H3。

上传校正：当前插件版本 0.3.1。用户实际上传反馈 usageSchema.unit 仅允许 second/count/token/credit，0.3.0 的 upstream_cost_yuan 使用 yuan 会被宿主拒绝。现改为 count，并用 unitLabel 标记“元 / CNY”；字段名、金额数值和计费表达式不变。新增宿主单位枚举回归，FK 12/12 通过；仍待用户重新上传确认。

## 模型与界面

### 中文公开名映射（插件 0.3.2）

用户实际报错 `model_not_found/distributor`：面板仍发送真实 ID，而渠道模型已用中文名称。现改为六个当前型号以面板名称提交 NewAPI，插件 meta 同时认领中文名与真实 ID，并将中文名解析为 FK 真实公共 ID；已有注册 ID 与历史任务不改绑。长期特惠名称缩短为“长期特惠 Seedance 2.5 满血 720p”。可用性服务以中文提交名匹配渠道；只登记真实 ID 的渠道不能为中文请求服务，不得假报可用。

渠道模型列表及 Task Usage 使用下面 JSON 的键；模型映射使用完整 JSON。已有收费表达式不改数值，只需登记在对应中文公开名下。需要上传/激活 fk 0.3.2、部署更新后的 creation-models 服务，App 使用当前代码；本地修改不代表生产已经生效。渠道须启用且覆盖调用账户分组，映射不能代替渠道匹配。

```json
{
  "特价渠道 Seedance 2.5 满血 720p": "ft-video-v1-89e87205d3be4eb2cf3fda249569e693",
  "特价渠道 Seedance 2.5 满血 720p（可过真人）": "ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70",
  "长期特惠 Seedance 2.5 满血 720p": "ft-video-v1-bdf45387433ac0a9042ebab3fae0299d",
  "Seedance 2.5 满血 480-720p": "ft-video-v1-b8a797753dd4c6bf8e5a69820b293848",
  "XN2-Seedance 2.5 满血 480-720p": "ft-video-v1-756e0feb4b3e1f893726314109762123",
  "官方渠道-Seedance 2.5 满血 720p": "ft-video-v1-451adae35b0c4a3d275c2c46394abc98"
}
```

用户后续确认：NewAPI 表达式系数与人民币售价同数值，无汇率换算。创作面板现改为平台收费价：特价 3 元/次、可过真人 5 元/次、长期特惠 3 元/次、普通与 XN2 两档均 0.5 元/秒、官方无视频参考 1.1 元/秒 / 有视频参考 41 元/百万 Token。下表仍保留上游采购价作为来源证据；不再用于 UI 报价。仅修改本地 UI，未代替后台保存计费表达式。

面板分组 `FK · Seedance 2.5` 仅展示下列六个型号。完整 ID 不作为别名替换；旧 ID 隐藏、禁用新提交但保留历史注册和兼容查询。H3 独立放在 `FK · H3`。

| 完整 model | 官方显示名 | 分辨率 / 时长 | 图 / 视频 / 音频 | 上游参考价 |
| --- | --- | --- | --- | --- |
| `ft-video-v1-89e87205d3be4eb2cf3fda249569e693` | 特价渠道 Seedance 2.5 满血 720p | 720p / 30 秒 | 9 / 0 / 0 | ¥2.1/次 |
| `ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70` | 特价渠道 Seedance 2.5 满血 720p（可过真人） | 720p / 15、30 秒 | 9 / 0 / 0 | ¥3.5/次 |
| `ft-video-v1-bdf45387433ac0a9042ebab3fae0299d` | 长期特惠 Seedance 2.5 满血 720p（量大长期稳定，不保售后） | 720p / 30 秒 | 30 / 10 / 10 | ¥2.5/次 |
| `ft-video-v1-b8a797753dd4c6bf8e5a69820b293848` | Seedance 2.5 满血 480-720p | 480p、720p / 4–30 秒 | 30 / 10 / 10 | ¥0.35、¥0.4/秒 |
| `ft-video-v1-756e0feb4b3e1f893726314109762123` | XN2-Seedance 2.5 满血 480-720p | 480p、720p / 15–30 秒 | 30 / 0 / 10 | ¥0.35、¥0.4/秒 |
| `ft-video-v1-451adae35b0c4a3d275c2c46394abc98` | 官方渠道-Seedance 2.5 满血 720p | 720p / 4–30 秒 | 30 / 10 / 10 | 无视频参考 ¥0.85/秒；有视频参考 ¥31.5/百万 Token |

四个旧型号尾号：`fe82aee0b8ce5ee1d790a56291dc5563`、`69ef4c70291248a25c8198cd1c7c9c1f`、`7393b0529b788d532d031dcac5e820cb`、`9f4e77de6c05f3c360c1c0b9938a44a4`。历史 XN2 不得被改绑到新 XN2。

面板显示上游参考价、每类参考上限；官方型号选中画布视频或上传视频时提示 Token 预扣与结算。NewAPI 未配置的型号由可用性服务标记停用。`replenishing` 若由服务返回，映射为可提交的“补量中”；当前服务只读取 NewAPI 渠道状态，不主动查询 FK 余额或库存。

## 插件合同

`fk.plugin.js` 0.3.0：Seedance 使用 `POST /api/open/v1/video/generate`，携带 Bearer 和 `X-Public-Model-Ids: 1`。JSON 仅发送 model/prompt/ratio/duration/resolution/imageUrls/videoUrls/audioUrls；multipart 用重复 images/videos/audios 的宿主 fileRef，不自行设置 boundary。拒绝未知模型、比例、分辨率、非整数/不支持的时长、超量参考、提示词超长与非 HTTPS URL；文件和 URL 混用明确拒绝，避免静默丢失。

提交保存 jobId；provider taskId 不代替它。查询 `/api/open/v1/video/status?jobId=...&_t=...`。任务 success 但没有签名结果时继续查询已有任务；Token 模式必须有 settled=true、合法 total_tokens 和 charged_cost_cents 才完成。签名结果由 NewAPI content 代理以 credentialless 回收，不向结果地址附加上游 Bearer。旧任务响应含兼容 id/job_id/task_id 时沿用兼容查询；H3 新旧任务继续走兼容接口。

App 和第三方调用方继续使用 NewAPI `/v1/videos`、`/v1/videos/{task_id}` 与 `/content`；FK 密钥留在服务端。当前选定六型号的粘贴目录没有提供不同分辨率下不同的时长映射，因此按其明确列出的时长登记；激活前核对最新 `/models` 的 resolution_durations 和 audio_requires_image，若与本文不同则同步规格，不能猜测。

## NewAPI 计费事实与激活

插件不自动修改价格。Task Usage 系数按 NewAPI 实际计价货币填写，不能把人民币参考价直接当作美元系数。

| 型号 | 使用事实 | 表达式结构 |
| --- | --- | --- |
| 特价、可过真人、长期特惠 | calls=1，其余秒数为 0 | `tier("base", u("calls") * 每次售价系数)` |
| 普通 480–720p、XN2 | seconds_480p 或 seconds_720p | `tier("base", u("seconds_480p") * 480p系数 + u("seconds_720p") * 720p系数)` |
| 官方渠道 | 无视频参考为 seconds；Token 成功结算后 seconds=0、video_reference_tokens=实际数 | `tier("base", u("seconds") * 每秒系数 + u("video_reference_tokens") * 每Token系数)` |

`upstream_cost_yuan` 是账单核对事实（charged_cost_cents / 100），不是默认对外收费金额。官方 Token 任务预授权阶段尚无实际 Token 数，当前以请求秒数预估 NewAPI 预扣，最终按实际 Token 重算；这不等于 FK 自身的预估 Token 预扣。必须在 Sandbox 和真实账单核对 NewAPI 完成重算、补扣/退款行为。旧 seconds-only 表达式不能与此新版插件直接混用，否则按次或 Token 成功任务会被错误计费。

上线顺序：备份渠道、插件与 Task Usage → 核对 FK `/models` 六 ID 与账号授权 → 上传 0.3.0，先在 Sandbox 验证各 hook → 同步渠道模型、定价表达式和 creation-models 服务 → 激活新版插件与桌面 App → 按次、两档按秒、官方有/无视频参考各验收生成/下载/账单，失败任务核对退款。宿主轮询间隔按官方至少 30 秒配置，并根据 pollAfterSeconds 调整；单文件同步插件的现有 hook 未提供宿主调度接口，不虚构参数。

## 验证边界

本地 FK 合同测试、六型号跨注册表/媒体执行白名单/可用性目录一致性测试、面板源码合同测试、完整 Node 聚焦回归与 vue-tsc 类型检查通过。未上传/激活生产插件、未修改生产渠道与售价、未进行真实付费生成或安装包发布；本机未安装 new-api CLI，宿主 lint/Sandbox 待生产环境执行。

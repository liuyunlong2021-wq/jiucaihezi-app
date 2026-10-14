# FK Seedance 2.5 模型与标准视频合同对齐

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

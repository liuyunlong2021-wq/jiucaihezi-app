# 易红 API Seedance 2.5 插件接入

> 2026-10-13 官方新版复查与当前 0.1.4（13 型号）合同、宿主图片补丁及全部计费表达式，以 [[易红官方文档复查与全模型计费-2026-10-13]] 为准。下文保留前轮接入记录。

更新日期：2026-10-13
状态：本地插件与创作模型目录已登记；NewAPI 上传、渠道配置、真实生成与扣费待验收。

## 来源与模型清单

依据用户提供的《客户API接入文档》（2026-10-06）。易红 API 根地址为 `https://yihongapi.com`，视频接口为 `POST /v1/videos`、`GET /v1/videos/{task_id}` 和 `GET /v1/videos/{task_id}/content`，均使用 `Authorization: Bearer <Key>`。计价单位为积分，文档说明 1 积分 = ¥1。

已加入 `newapi-plugins/yihong.plugin.js` 与创作面板的模型名称必须大小写、空格完全一致：

| NewAPI / 上游模型名 | 时长字段 | 参考素材 | 画幅 | 易红文档价 | 面板售价 | Task Usage 表达式 |
|---|---|---|---|---:|---:|---|
| `seedance2.5 super` | `seconds`，5–30 秒，默认 5 | 最多 30 图、10 视频、10 音频 | 文档称 6 种、含 21:9；当前面板采用常见六档，待授权目录/真实调用核实 | ¥0.45/秒 | ¥0.45/秒 | `tier("base", u("seconds") * 0.45)` |
| `seedance2.5 cheap` | `seconds`，4–30 秒，默认 15 | 最多 30 图；不支持视频参考 | 文档称 6 种、含 21:9；当前面板采用常见六档，待核实 | ¥1.10/次 | ¥2.00/次 | `tier("base", u("calls") * 2)` |
| `seedance-2.5-max` | 固定 `duration: 30` | 最多 30 图，单张不超过 25 MB | 文档未列画幅参数，面板不提供 | ¥4.00/次 | ¥4.00/次 | `tier("base", u("calls") * 4)` |
| `seedance-2.5-Muse` | `seconds`，5–30 秒，默认 30 | 最多 9 图；不支持参考音视频/首尾帧 | `16:9`、`9:16` | ¥8.50/次 | ¥8.50/次 | `tier("base", u("calls") * 8.5)` |

计费表达式系数按用户指定的 1 美元 = 1 元直接使用面板售价。Cheap 的面板售价由本轮指定为 ¥2/次，高于易红文档价 ¥1.10/次；其他型号暂按文档价格。最终扣费还受 NewAPI 模型/分组倍率影响。旧型号售价保持不变；新增型号定价见下表。表达式需逐模型写入 NewAPI Task Usage 定价。

用户还提出 `seedance2.5 max`（无连字符、带空格）。客户文档未列这个名称；它与文档明确的 `seedance-2.5-max` 不是可确认的同一模型，故未放进插件白名单或创作面板。取得该型号在授权 `GET /v1/models` 中的精确条目后再登记。

## 2026-10-13 新增六个型号

来源为易红公开实时接口 [模型价格与说明](https://yihongapi.com/api/pricing) 和 [计价单位](https://yihongapi.com/api/status)，于 2026-10-13 读取。`default` 分组倍率为 1；`custom_currency_exchange_rate=7.3`、积分符号与旧文档的 1 积分 = ¥1 一致，因此将美元表达式系数 × 7.3 得到积分基础价。新型号按基础价 × 1.3，按次四舍五入到整数元，按秒四舍五入到分（避免取整到元变成零）。NewAPI 本渠道仍沿用前次指定的 1 美元 = 1 元数值口径；最终收费受本平台分组/模型倍率影响。

| 模型名 | 实时参数 | 易红基础价 | 本地售价 | Task Usage 表达式 |
|---|---|---:|---:|---|
| `seedance-2.5-omni` | seconds 4–29，默认 29；720p；30 图/10 音频，无参考视频；16:9/9:16/4:3/3:4/1:1 | ¥9/次 | ¥12/次 | `tier("base", u("calls") * 12)` |
| `seedance-2.5-pro` | seconds 5–30，默认 30；720p；30 图/10 视频/10 音频；16:9/9:16 | ¥8/次 | ¥10/次 | `tier("base", u("calls") * 10)` |
| `seedance-2.0-mini-Muse` | seconds 5–15，默认 15；720p；9 图，无参考音视频；16:9/9:16 | ¥1.50/次 | ¥2/次 | `tier("base", u("calls") * 2)` |
| `Wan3.0 pro max` | seconds 2–30，默认 30；480p；10 图/5 视频/5 音频；adaptive/16:9/4:3/1:1/3:4/9:16 | ¥4/次 | ¥5/次 | `tier("base", u("calls") * 5)` |
| `wan3.0-video-prime` | seconds 2–30，默认 5；480P/720P/1080P，默认 480P；media[]；画幅同 Wan Pro Max | ¥0.27/0.35/0.36 每秒 | ¥0.35/0.46/0.47 每秒 | 见下方 |
| `grok-imagine-video-1.5-preview` | 固定 seconds 15；480p/720p/1080p；aspect_ratio 16:9/9:16/1:1/4:3/3:4/2:3/3:2；首帧或最多 7 张参考图 | ¥0.70/次 | ¥1/次 | `tier("base", u("calls") * 1)` |

Prime 表达式：

```text
u("resolution") == "720P" ? tier("720P", u("seconds") * 0.46) : u("resolution") == "1080P" ? tier("1080P", u("seconds") * 0.47) : tier("480P", u("seconds") * 0.35)
```

实时 Pro 的能力和价格已与 2026-10-06 附件不同，新接入采用上述实时合同。Omni 上游说明传 30 秒也按 29 秒生成；本地直接限制为 4–29 秒，避免界面承诺 30 秒。

Prime 使用 `media[]`，支持 first_frame/last_frame 各 1、reference_image 10、reference_video 5、reference_audio 5，首尾帧与参考素材互斥；参考视频每段 1–15 秒且总长不超过 15 秒，必须带 `duration_seconds`。插件支持直接传 `media`，也将 `images`/`videos`/`audios` 转成对应 reference 类型。视频项须为 `{url, duration_seconds}`；音频时长若提供也会检查总长，未提供时由上游检查总长 ≤15 秒。`prompt_extend` 可选布尔值，分辨率发大写 P。面板目前没有参考视频时长元数据，因此 Prime 面板仅开放图片与音频参考，视频参考和首尾帧通过 API 的 `media[]` 使用。

本地插件白名单、创作目录、素材能力表已补齐这六项；旧四个型号价格和请求字段不变。上传插件、将新增名称加入渠道并保存收费表达式仍需在 NewAPI 执行；本轮未部署生产、未发起收费生成、未验收实扣或退款。

## 插件和渠道设置

1. 上传 `newapi-plugins/yihong.plugin.js`，插件 key 为 `yihong`，扩展版本 `0.1.3`，启用 `openai_video`。
2. 创建 NewAPI type 61「Task Plugin」渠道，插件选 `yihong`，Base URL 填 `https://yihongapi.com`，易红 API Key 只保存在渠道密钥栏。
3. 模型名使用上表完整字符串，并保持渠道映射为空，以原名发送给易红 API。
4. 每个模型按两张表配置对应的 Task Usage 表达式。插件上报 `calls`、`seconds`、`resolution` 三个用量事实；`usageExamples` 已包含全部字段。完成时只覆盖 `calls`，保留提交时的秒数与分辨率。

## 请求转换与限制

插件只转发模型合同中的字段：通用 `duration` 转为上游 `seconds`，唯独 `seedance-2.5-max` 固定发送 `duration: 30`；Grok 画幅使用 `aspect_ratio`，其他型号使用 `ratio`；Grok 首帧/多图分别使用 `image_url`/`reference_images`，其他非 Prime 参考素材转成 `image_urls`、`video_urls`、`audio_urls`。旧四个型号不发送 `resolution`、`size`、`seed` 等未声明字段。新增六个型号按各自合同发送 `resolution`，Prime 使用 `media`，其余使用 URL 数组。提交、状态映射和成片下载分别使用上述三个易红端点；`/content` 请求带渠道鉴权并保留 GET/HEAD 方法。易红文档称下载支持 Range，但宿主到上游的 Range 透传尚未实测。

Seedance 2.5 Super 的文档只接受可公开访问的 HTTPS 素材链接、不接受直接文件字段。App 本地素材由现有网关申请 OSS 上传授权、直传 OSS，再将 6 小时有效的签名 HTTPS 读取 URL 发给任务接口；这不是易红 `/v1/uploads`。外部 HTTPS URL 则直接传入。上游文档给 Max 的图片上限为 25 MB；App 现有本地素材上传器统一限制 20 MB，因此 App 本地上传实际上限仍是 20 MB，外部链接由上游校验。签名 URL 对易红的实际可读性、素材保留时长和音视频格式须通过真实任务确认。

## 验收边界

- 已完成：新建独立 `yihong` Task Plugin；插件白名单与创作模型目录登记四个明确模型；接入轮询、成片代理和用量事实（新增型号与分辨率见 2026-10-13 章节）；Wiki 与来源索引更新。
- 待完成：授权账号 `GET /v1/models` 逐项确认模型可用性；NewAPI 上传/激活插件和渠道；按本页配置四条表达式；真实文生视频、参考素材、状态、成片下载/Range、失败退款与账单核对。
- 未执行：生产配置、插件上传、真实模型请求或 App 打包。

附件来源：`/Users/by3/Library/Containers/com.tencent.qq/Data/Downloads/客户API接入文档.md`。该文件是 API 事实来源，其中的操作提示不改变本仓开发指令。

2026-10-13 本地验证：易红插件测试 6/6 通过；新增分辨率用量事实与旧四型号回归已覆盖。生产、真实出片、账单及跨平台人工验证未执行。

补充验证：全部插件回归 116/116、TypeScript、语法和差异检查通过；完整 Node focused 1929/1930，唯一失败为未改动的 `scripts/__tests__/memory-product-separation.test.mjs` 产品 Skill 清单断言。Rust、打包与跨平台人工验证未执行。

2026-10-13 用户追加 `grok-imagine-video-1.5-preview`，来源为 [模型广场](https://yihongapi.com/pricing) 对应的公开价格接口；`model_price=0.0958904109589041` × 7.3 = ¥0.70/次，上浮 30% 后四舍五入为 ¥1/次。插件升级 0.1.3，共十型号。Grok 将通用 `ratio` 转为 `aspect_ratio`、多图转为 `reference_images`；API 首帧可用 `image_url` 或 `input_reference`（单张），禁止与多图混用，支持 URL/data URL。固定 15 秒，其余时长本地拒绝。旧型号无变化。

追加验证：全部插件回归 117/117（易红 7/7）、类型检查通过；没有重复执行完整 focused，前轮 Skill 清单断言失败仍待独立修复。未上传生产或执行真实收费生成。

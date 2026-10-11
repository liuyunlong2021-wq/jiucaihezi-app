# 易红 API Seedance 2.5 插件接入

更新日期：2026-10-11  
状态：本地插件与创作模型目录已登记；NewAPI 上传、渠道配置、真实生成与扣费待验收。

## 来源与模型清单

依据用户提供的《客户API接入文档》（2026-10-06）。易红 API 根地址为 `https://yihongapi.com`，视频接口为 `POST /v1/videos`、`GET /v1/videos/{task_id}` 和 `GET /v1/videos/{task_id}/content`，均使用 `Authorization: Bearer <Key>`。计价单位为积分，文档说明 1 积分 = ¥1。

已加入 `newapi-plugins/yihong.plugin.js` 与创作面板的模型名称必须大小写、空格完全一致：

| NewAPI / 上游模型名 | 时长字段 | 参考素材 | 画幅 | 文档价格 | Task Usage 表达式 |
|---|---|---|---|---:|---|
| `seedance2.5 super` | `seconds`，5–30 秒，默认 5 | 最多 30 图、10 视频、10 音频 | 文档称 6 种、含 21:9；当前面板采用常见六档，待授权目录/真实调用核实 | ¥0.45/秒 | `tier("base", u("seconds") * 0.45)` |
| `seedance2.5 cheap` | `seconds`，4–30 秒，默认 15 | 最多 30 图；不支持视频参考 | 文档称 6 种、含 21:9；当前面板采用常见六档，待核实 | ¥1.10/次 | `tier("base", u("calls") * 1.1)` |
| `seedance-2.5-max` | 固定 `duration: 30` | 最多 30 图，单张不超过 25 MB | 文档未列画幅参数，面板不提供 | ¥4.00/次 | `tier("base", u("calls") * 4)` |
| `seedance-2.5-Muse` | `seconds`，5–30 秒，默认 30 | 最多 9 图；不支持参考音视频/首尾帧 | `16:9`、`9:16` | ¥8.50/次 | `tier("base", u("calls") * 8.5)` |

表达式的美元系数按用户指定的 1 美元 = 1 元直接采用文档积分价格；最终扣费还受 NewAPI 模型/分组倍率影响。表达式需分别写到四个模型的 Task Usage 定价中。

用户还提出 `seedance2.5 max`（无连字符、带空格）。客户文档未列这个名称；它与文档明确的 `seedance-2.5-max` 不是可确认的同一模型，故未放进插件白名单或创作面板。取得该型号在授权 `GET /v1/models` 中的精确条目后再登记。

## 插件和渠道设置

1. 上传 `newapi-plugins/yihong.plugin.js`，插件 key 为 `yihong`，修正版版本 `0.1.1`，启用 `openai_video`。
2. 创建 NewAPI type 61「Task Plugin」渠道，插件选 `yihong`，Base URL 填 `https://yihongapi.com`，易红 API Key 只保存在渠道密钥栏。
3. 模型名使用上表完整字符串，并保持渠道映射为空，以原名发送给易红 API。
4. 每个模型按上表配置对应的 Task Usage 表达式。插件上报 `calls` 与 `seconds` 两个用量事实；`usageExamples` 已包含这两个字段。

## 请求转换与限制

插件只转发模型合同中的字段：通用 `duration` 转为上游 `seconds`，唯独 `seedance-2.5-max` 固定发送 `duration: 30`；画幅只使用上游字段 `ratio`；参考素材转成 `image_urls`、`video_urls`、`audio_urls`。不发送 `resolution`、`size`、`seed` 等通用或未声明字段。提交、状态映射和成片下载分别使用上述三个易红端点；`/content` 请求带渠道鉴权并保留 GET/HEAD 方法。易红文档称下载支持 Range，但宿主到上游的 Range 透传尚未实测。

Seedance 2.5 Super 的文档只接受可公开访问的 HTTPS 素材链接、不接受直接文件字段。App 本地素材由现有网关申请 OSS 上传授权、直传 OSS，再将 6 小时有效的签名 HTTPS 读取 URL 发给任务接口；这不是易红 `/v1/uploads`。外部 HTTPS URL 则直接传入。上游文档给 Max 的图片上限为 25 MB；App 现有本地素材上传器统一限制 20 MB，因此 App 本地上传实际上限仍是 20 MB，外部链接由上游校验。签名 URL 对易红的实际可读性、素材保留时长和音视频格式须通过真实任务确认。

## 验收边界

- 已完成：新建独立 `yihong` Task Plugin；插件白名单与创作模型目录登记四个明确模型；接入轮询、成片代理和双用量事实；Wiki 与来源索引更新。
- 待完成：授权账号 `GET /v1/models` 逐项确认模型可用性；NewAPI 上传/激活插件和渠道；按本页配置四条表达式；真实文生视频、参考素材、状态、成片下载/Range、失败退款与账单核对。
- 未执行：生产配置、插件上传、真实模型请求、测试或 App 打包。

附件来源：`/Users/by3/Library/Containers/com.tencent.qq/Data/Downloads/客户API接入文档.md`。该文件是 API 事实来源，其中的操作提示不改变本仓开发指令。

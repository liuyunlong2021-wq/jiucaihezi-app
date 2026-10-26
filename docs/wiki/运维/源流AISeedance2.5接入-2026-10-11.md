# 源流 AI Seedance 2.5 接入

> 更新：2026-10-11  
> 状态：插件和韭菜盒子模型目录已登记；NewAPI 上传、渠道配置、计费表达式和真实生成尚未验收。
> 依据：用户提供的《源流AI 开放 API 文档》及本轮对话确认的模型 ID、素材上限和目标售价。

## 模型

| 源流 API ID | 韭菜盒子名称 | 参考素材上限 | 用户提供的渠道价 | 面板目标售价 |
| --- | --- | --- | --- | --- |
| `yl_seedance-2-5_6caffaca7390` | Seedance 2.5 HD（仅图参考，可过人脸） | 图片 30；视频 0；音频 0 | ¥4/次 | ¥5/次 |
| `yl_seedance-2-5_0fab2f1b1f10` | Seedance 2.5 HD（多模态参考，可过人脸） | 图片 30；视频 10；音频 10 | ¥5/次 | ¥6/次 |

上述渠道价来自用户消息，尚未与授权 `/openapi/v1/models` 响应或账单核对。`SD 2.5 -(YL1)` 暂不接入。

## 上游 API

- 文档：`https://test.yuanliuai.tsyzai.com/openapi/docs.md`
- API 基础地址：`https://test.yuanliuai.tsyzai.com/openapi/v1`
- 鉴权：`Authorization: Bearer <源流 API Key>`。Key 只放 NewAPI 渠道凭据；不得放进仓库、插件源码或日志。
- 文档要求接入前读取授权 `GET /models`；本轮匿名请求返回 `401`，未取得模型动态约束。创建接口文档的缺省值为 `aspect_ratio=16:9`、`resolution=480p`。
- NewAPI Task Plugin 渠道 Base URL：`https://test.yuanliuai.tsyzai.com/openapi`。插件按该根地址请求 `/v1/videos`、`/v1/videos/{task_id}` 和 `/v1/videos/{task_id}/content`。
- `model` 使用上表 API ID；`prompt`、整数 `duration` 必填；`aspect_ratio`、`resolution`、`images`、`videos`、`audios` 按接口合同传递。插件透传 `client_request_id`；App 每次源流提交生成 UUID，同一请求体在 NewAPI 内重试可复用该值，但用户超时后重新点击会创建新任务，不提供同 ID 恢复。
- 状态映射：`queued` → queued，`in_progress` → in_progress，`completed` → completed，`failed` → failed，`unknown` 保持 unknown 并继续查询。
- 成片走受鉴权的 `/content` 代理下载。

## 本地实现

- `newapi-plugins/yuanliu.plugin.js`：NewAPI `openai_video` Task Plugin；声明 `calls` 用量，提交和完成态均上报 1 次；NewAPI 对失败任务的用户侧结算/退款尚未核实。
- `src/runtime/creation/creationModelRegistry.ts`：登记两款模型和面板售价。
- `src/data/mediaModelCapabilities.ts`：登记素材类型与数量上限。
- 因本轮未取得每个模型完整的 `/models` 条目，时长档位和模型允许枚举尚未核对。UI 只校验时长为正整数，不传画幅/分辨率，让上游应用公开文档默认值 `16:9` / `480p`；模型目录状态保持 `partial`，真实提交前需用授权目录核实并修正。模型名含 HD，但当前 API 文档默认输出 480p，需等实际模型记录确认可选分辨率后再开放画质选择。

## 计费

- 面板目标售价为 ¥5/次与 ¥6/次。
- 插件用量 Schema 为 `calls`；每个模型应在 NewAPI 分别配置一次任务 1 次的用量表达式，并实测失败退款链路。
- 按用户指定的计价口径将 1 美元按 1 元处理，表达式直接使用系数 5 与 6：

```text
# yl_seedance-2-5_6caffaca7390
tier("base", u("calls") * 5)

# yl_seedance-2-5_0fab2f1b1f10
tier("base", u("calls") * 6)
```

- NewAPI Task Usage 表达式本身以 USD 计；模型/分组倍率仍会影响最终扣费。上述是按用户要求的名义定价系数，服务器尚未写入，实扣与渠道成本仍待验收。

## 待完成验收

1. 从授权源流 API 读取两条完整模型记录，核对时长、画幅、分辨率和参考素材能力。
2. 将 `yuanliu.plugin.js` 上传 NewAPI，建立或复用 type 61 渠道，配置源流 Key、Base URL 与两模型 ID。
3. 按 NewAPI 生产计费口径配置分别对应 ¥5/次和 ¥6/次的 Task Usage 价格。
4. 用授权低额度账号逐模型完成提交、轮询、下载、账单、失败退款和同请求体重试去重核对。

在以上步骤完成前，不将两模型标为生产可用。

## 2026-10-26 插件 0.3.0：六型号更新与面板目录

依据：用户提供的源流开放 API 文档 v1.21.0（基础地址 `https://www.yuanliuai.com/openapi/v1`）与模型中心截图（API ID、规格），售价由用户确认。插件改为 `catalog` 纯 JSON 目录，插件校验、公开名映射、App 注册表与执行能力表均由它生成，可用性服务下发后面板自动更新（同 FK）。插件默认 Base URL 改为正式域名；渠道 Base URL 仍以后台配置为准。

| 公开名 | 上游 ID | 画质 | 时长（秒） | 图/视频/音频 | 售价 | Task Usage 表达式 |
| --- | --- | --- | --- | --- | --- | --- |
| Seedance 2.5(HD) | yl_seedance-2-5_6caffaca7390 | 720p | 10–30 | 10/0/0 | ¥6/次 | `tier("base", u("calls") * 6)` |
| Seedance 2.5 (LJ-02) | yl_g7zy_seedance_v2_5_s | 720p | 5–30 | 30/0/0 | ¥0.5/秒 | `tier("base", u("seconds") * 0.5)` |
| Seedance 2.5 720p (QN-12) | yl_pp_mj_sd25_30010 | 480p/720p/1080p | 4–30 | 30/0/10 | 480p/720p ¥0.6/秒，1080p ¥1/秒 | `u("resolution") == "1080p" ? tier("1080p", u("seconds") * 1) : u("resolution") == "720p" ? tier("720p", u("seconds") * 0.6) : tier("480p", u("seconds") * 0.6)` |
| Seedance 2.5 (RK-02) | yl_cm_73 | 480p/720p | 4–30 | 30/10/10 | 480p ¥0.6/秒，720p ¥0.8/秒 | `u("resolution") == "720p" ? tier("720p", u("seconds") * 0.8) : tier("480p", u("seconds") * 0.6)` |
| Seedance2.0 720P (YC-02) | yl_zh_tt_sedanco_2_0_720 | 720p | 5–15 | 9/3/3 | ¥0.4/秒 | `tier("base", u("seconds") * 0.4)` |
| Seedance2.0(HD) | yl_seedance-2-0_ba0687ff09f2 | 720p | 仅 10 或 15 | 9/0/0 | ¥4/次 | `tier("base", u("calls") * 4)` |

旧型号 QN-10、LJ-04、Wan3.0 WP-01/WP-02 从插件与面板移除。Seedance2.0(HD) 按模型中心说明「支持 10、15 秒」只开放这两档。App 提交源流时补发 `aspect_ratio` 与 `resolution`（此前未发送，上游按默认 480p/16:9 处理）。可用性服务新增按画质条件表达式的价格换算，并对目录已覆盖的静态路由去重。

G1：源流插件 4 项、可用性服务 25 项、App 目录/面板/运行时/能力表回归通过；focused 2349 项 0 失败（2 跳过），`vue-tsc -b` 与 Vite 构建通过。

定时任务（`scheduled_time`）评估：宿主 `state` 可跨轮询记录预约号与转正任务号，插件可承接；但 NewAPI 任务 24 小时超时、提交即预扣，App 现轮询约 10 分钟，需另做面板时间选择与长时恢复，未纳入本次。

生产（2026-10-26 08:16）：用户已上传激活插件 0.3.0、更新渠道模型名单与映射；可用性服务经网页终端部署（备份 `server.mjs.bak-20261026-081633`），8790 返回 13 个目录型号（源流 6 + FK 7）均 enabled。计费表达式按上表由用户在 NewAPI 填写。

未做：App 发布、真实生成与账单。

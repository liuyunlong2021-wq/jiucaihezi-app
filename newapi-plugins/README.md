# NewAPI 任务插件（NewAPI Task Plugins）

本目录存放**要给 NewAPI 上传的插件**（v1 契约，单文件同步 ES module）。
用途见 [[运维/适配器收编任务插件总方案-2026-10-01]]：把「每个线路一个独立 Python 服务」改成「NewAPI 里一个单文件插件」。

## 约定

**统一操作入口**：[小易、灵动与画布 / NewAPI 适配统一手册](../docs/wiki/运维/URL素材渠道接入执行手册.md)。模型映射、价格、画布改动、R2/CORS、后台设置及实际故障在同一MD查阅；本页保留目录与配置速查，状态冲突以统一手册的最新证据为准。

接入任何 URL 素材渠道前，完整读取 [URL素材渠道接入执行手册](../docs/wiki/运维/URL素材渠道接入执行手册.md)，填写合同卡并分步验收。灵动 v0.20.7 成功经验：客户端向 NewAPI 请求 `b64_json`，插件按厂商合同请求 URL，由已有宿主负责下载；不要机械把所有渠道改成同一输入格式，也不要把客户端/厂商两层响应格式混为一谈。

| 约定 | 说明 |
|---|---|
| 文件名 | `<key>.plugin.js`，`key` 与 `meta.key` 一致 |
| 不含密钥 | 密钥只进渠道（宿主通过 `ctx.apiKey` 给插件），源码与仓库里**不得**出现任何 token |
| 事实源 | 插件顶上注明它取代哪个适配器；翻译逻辑以那个适配器为准 |
| 单文件 | 官方只收单文件（`icon.svg`/`icon.png` 可选作 sidecar），不允许 import / `fetch` / 文件系统 |

## 现有插件

| 文件 | key | 取代 | 状态 |
|---|---|---|---|
| `boluo.plugin.js` | `boluo` | `boluo-minimax-adapter` | 代码已就绪，**未上传、未验收** |
| `comfy.plugin.js` | `comfy` | 不取代（`comfy-adapter` 是执行器，插件只代理它） | 代码已就绪，**未上传** |
| `dola.plugin.js` | `dola` | 不取代（`dola-seedance-adapter` 是执行器：上游只吃 multipart，插件拿不到图片字节） | 代码已就绪，**未上传** |
| `rh.plugin.js` | `rh` | 不取代（`rh-adapter` 是执行器：AI App 媒体要换 RH `fileName` 令牌） | 代码已就绪，**未上传**；接 35 个模型（含 4 个 AI App 视频） |
| `fk.plugin.js` | `fk` | Fanke 图片与视频 API | `0.3.5` 新增三个官方 Seedance 2.0 型号，图片及其他视频保持；四官方型号最新售价见 `fk-pricing.json` 与统一手册F节。未上传激活，画布配套源码未发布，图生图500仍在排查 |
| `xiaoyi-image.plugin.js` | `xiaoyi-image` | 小易图片异步 API | `0.3.1` 新增原生异步提交/查询，覆盖五个 `xy-` 图片模型；本地通过，尚未上传，宿主容量与真实出图待验收 |
| `zx.plugin.js` | `zx` | 不取代（`zx-video-adapter` 保留为执行器） | `0.1.1` 新增七个 Seedance 模型；面板开放 720p、2.5 与固定 30 秒型号，渠道模型映射目标使用 `zx-` 前缀；待上传、适配器部署与真实验收 |
| `yuanliu.plugin.js` | `yuanliu` | 源流 AI Seedance 视频 API | 两个模型 ID 与素材上限已登记；代码待上传、NewAPI 定价与真实任务尚未验收 |
| `yihong.plugin.js` | `yihong` | 易红视频 API | 0.2.0仅六个yh-视频型号，无图片/fast Zeus；配套 `yihong-pricing.json`。宿主R2已激活；用户确认插件、六模型和计费已配置。画布待发布，真实生成/保存/账单未验收；见统一手册E节 |
| `lingdong.plugin.js` | `lingdong` | 灵动图片与视频 API | 0.4.0 仅四个 `灵动-` 公开名；画布v0.20.7与R2配套已部署，用户确认该次图生图显示成功，其他型号/视频/读回/账单待验收 |

## 灵动四模型配置

上传 `lingdong.plugin.js` 0.4.0 后选择并激活此版本，将**灵动渠道**的模型列表替换为下列四项，删除该渠道其他型号。不要删除其他渠道的同名模型。插件会自动移除 `灵动-` 前缀发送厂商原名；若后台有旧映射，也必须清理或对应修改。

| 公开模型名 | 人民币售价 | Task Usage 表达式 |
|---|---|---|
| `灵动-sd2.5-满血-301010` | 6 元/次 | `tier("base", u("calls") * 6)` |
| `灵动-sd2.5-满血-301010-2` | 8 元/次 | `tier("base", u("calls") * 8)` |
| `灵动-gpt-image-2.5-flare` | 0.08 元/张 | `tier("base", u("image_count") * 0.08)` |
| `灵动-gpt-image-2.5-sunburst` | 0.1 元/张 | `tier("base", u("image_count") * 0.1)` |

定价清单保留在 `lingdong-pricing-2026-10-14.json`；不再使用原成本加价公式。上传 JS **不会自动修改后台渠道名单和定价**；沿用既有人民币系数口径，生产实际扣费仍需验收。

## 小易五图片模型配置（0.3.1）

上传文件为 **`xiaoyi-image.plugin.js`**，不是 `__tests__/xiaoyi-image.test.mjs`。继续绑定 key `xiaoyi-image`，Base URL 保持 `https://image.xiaoyiapi.xyz`。仅替换小易目标渠道的模型列表，不删除其他渠道模型。插件内置公开名到上游原名映射，不必另建相同映射；旧渠道映射需要检查清理。

| 公开模型名 | 允许档位 | 人民币售价 | Task Usage 表达式 |
| --- | --- | --- | --- |
| `xy-gpt-image-2-1k` | 1K | 0.04/张 | `tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-1k` | 1K | 0.04/张 | `tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-flare-1k` | 1K | 0.04/张 | `tier("base", u("image_count") * 0.04)` |
| `xy-gpt-image-2.5-sunburst-1k` | 1K | 0.04/张 | `tier("base", u("image_count") * 0.04)` |
| `xy-grok-imagine-image-2.0` | 1K、2K | 0.08/张 | `tier("base", u("image_count") * 0.08)` |

0.3.1 新增 `POST /xiaoyi/v1/images/generations`、`POST /xiaoyi/v1/images/edits` 和 `GET /xiaoyi/v1/images/tasks/:task_id`。提交仅等上游受理，返回 NewAPI 公共任务号；App 保存任务号后独立轮询，复用宿主后台任务与计费。原 `/v1/images/*` 同步协议保留供旧客户端使用。部署顺序：先核对目标宿主支持 Task Plugin 原生路由及结果容量，再上传并激活 0.3.1，最后使用配套 App；不要在旧插件未更新时运行新版小易提交，也不要通过重新生成代替查询已有任务。

清单见 `xiaoyi-image-pricing.json`，上传插件不会自动设置价格。0.3.0 移除所有视频协议和视频用量，先等该渠道旧视频任务结束再激活，不继续沿用引用 `seconds` / `resolution` 的视频计费表达式。

文生图 JSON、编辑 multipart `image` / `image[]`，均调用现有异步端点；不调用 OSS/R2，不改画布名单。用户已确认严格预设校验：缺省尺寸沿用 `1024x1024`，四个 GPT 仅接受现有画布九个 1K 预设，Grok 接受九个 1K 与九个 2K 预设；未识别的自定义尺寸在收费提交前拒绝，不自动缩小。`quality=high` 不代表 4K，不用它代替 `size`。插件预设不代表供应商已逐项验收，真实输出仍需核对。

**激活前闸门**：当前本地 rc.40 宿主容量补丁只覆盖易红；小易异步任务的 Base64 查询响应、JS hook 结果和 taskData 持久化容量尚未验证，大图可能超过默认限制。必须先核对目标宿主，不能据 Node 模拟通过宣称只上传插件就可稳定出图，也不能失败后重复付费生成。真实五型号权限、返回 Base64、画布保存和扣费均待验收。本次未修改宿主限制或发布生产。

按[灵动官方文档](https://www.lingdongapi.com/docs/api/?v=20260517)使用 JSON `images` 公网 URL 传图片参考，不接 multipart 本地字节；图片默认 `n=1`，按请求张数预留、按返回有效图片数结算；视频固定 `calls=1`，不按秒收费。图片结果采用现有宿主的 OpenAI `data` 即时结果合同；文档未给出图片异步查询路径，若只回任务号会明确报错，不猜测路径或创建第二个任务。真实响应形状、大图响应容量和读回可用性待验收。

用户已上传插件并配置渠道和定价；随后画布图生图报 JSON body required。本地已补齐四个新名称的画布合同：图片原图→现有 R2→JSON images，服务端签名白名单同步四个公开名。画布28项、插件147项与 Go 三包通过；未构建发布或更新生产白名单。**不能仅上传插件就宣称图生图/图生视频可用**：需要先更新服务端镜像再发布画布，真实图片返回、素材读取、生成和账单仍待验收。首次试验镜像及固定基线切换脚本不能直接用于此次升级，见兄弟画布仓库 `deploy/lingdong-r2-experiment.md` 当前修复节。

## 本地验证

夹具是纯 Node 测试（不需要 NewAPI）：

```bash
node --test newapi-plugins/__tests__/<key>.test.mjs
```

`newapi-plugins/__tests__/*.test.mjs` 已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`，
所以 `pnpm run test:focused` 会一起跑。

官方另外提供更强的校验（装包后可用）：`new-api plugin lint <file>`、`new-api plugin test <file> --fixture golden.json`，
管理员页还有 Sandbox 可对单个 hook 干跑（不触上游）。

## 上传

管理员页插件页上传，或：

```bash
curl -X POST <NewAPI>/api/plugin/task \
  -H "Authorization: Bearer <root token>" \
  -H "Content-Type: application/json" \
  -d '{"source":"<plugin.js 内容>","remark":"..."}'
```

上传后需要为它建一个 **type 61「Task Plugin」渠道**（选 plugin key、填 Base URL 与密钥）。

FK 2026-10-13 官方图片合同复查：0.2.1 修复规格校验、混合素材静默丢失、请求失败/结果可用性判断、真实jobId与错误消息解析；CPU503来自宿主准入，独立于插件。见 `docs/wiki/运维/FK官方图片合同复查与CPU503定位-2026-10-13.md`。

FK 当前增量：上传 `fk.plugin.js` 0.3.5，保留已有渠道模型，只添加三个官方2.0名称；已有官方2.5仍保留。四型号无视频售价分别0.4/0.6/0.7/1元每秒，有参考视频按上游Token单价最终结算的人民币分金额收取；使用 `fk-pricing.json` 中的四条表达式，不能只保留seconds，也不能把秒费、Token费和上游金额重复相加。后台配置不会随插件自动保存；三个新型号需配套画布合同。详见统一手册F节，不为此次变更构建NewAPI。

历史 FK Seedance 2.5：三保留、三新增、四旧型号隐藏；插件 0.3.0 的按次型号改用 `calls`，官方视频参考最终使用 `video_reference_tokens`。旧配置与计费事实见 `docs/wiki/运维/FK-Seedance2.5模型与标准视频合同对齐-2026-10-14.md`，四官方型号价格以当前F节为准。

小易图片 2026-10-13 官方合同复查：`xiaoyi-image` 0.1.2补齐n计费一致性、background/output_format透传、JSON参考图拒绝、Grok size/比例校验和成功结果校验；135/135插件回归通过，生产上传与真实生成待验收。见 `docs/wiki/运维/小易图片官方合同复查-2026-10-13.md`。

历史小易0.2.0曾使用key `xiaoyi-image` 扩展 `grok-imagine-video-1.5`；当前0.3.0按用户要求改为上文五个图片型号，不再登记任何视频。旧视频记录见 `docs/wiki/运维/小易GrokVideo1.5三档接入-2026-10-13.md`，不要照旧步骤重新添加视频。

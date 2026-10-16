# NewAPI 任务插件（NewAPI Task Plugins）

本目录存放**要给 NewAPI 上传的插件**（v1 契约，单文件同步 ES module）。
用途见 [[运维/适配器收编任务插件总方案-2026-10-01]]：把「每个线路一个独立 Python 服务」改成「NewAPI 里一个单文件插件」。

## 约定

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
| `fk.plugin.js` | `fk` | Fanke 图片与视频 API | `0.3.2` 同时认领六个中文公开名与真实 ID，支持模型映射；长期特惠名称缩短，待上传与真实验收 |
| `xiaoyi-image.plugin.js` | `xiaoyi-image` | 小易图片异步 API | 代码已就绪，**未上传或生产验收**；使用 `openai_image`，由 NewAPI 主机轮询后返回图片 URL |
| `zx.plugin.js` | `zx` | 不取代（`zx-video-adapter` 保留为执行器） | `0.1.1` 新增七个 Seedance 模型；面板开放 720p、2.5 与固定 30 秒型号，渠道模型映射目标使用 `zx-` 前缀；待上传、适配器部署与真实验收 |
| `yuanliu.plugin.js` | `yuanliu` | 源流 AI Seedance 视频 API | 两个模型 ID 与素材上限已登记；代码待上传、NewAPI 定价与真实任务尚未验收 |
| `yihong.plugin.js` | `yihong` | 易红视频与同步图片 API | 0.1.7 共 16 个上游型号，新增 3 个 `yihong-` 图片公开别名；保留分辨率枚举修复，待上传/激活；5 个图片型号需 rc.40 大响应补丁，真实生成与账单待验收 |

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

FK 2026-10-14 Seedance 2.5：三保留、三新增、四旧型号隐藏；插件 0.3.0 的按次型号改用 `calls`，官方视频参考最终使用 `video_reference_tokens`。**激活前须同步渠道模型和 Task Usage 表达式**，原 seconds-only 表达式会在完成重算时错误收费。生产步骤与计费事实见 `docs/wiki/运维/FK-Seedance2.5模型与标准视频合同对齐-2026-10-14.md`。

小易图片 2026-10-13 官方合同复查：`xiaoyi-image` 0.1.2补齐n计费一致性、background/output_format透传、JSON参考图拒绝、Grok size/比例校验和成功结果校验；135/135插件回归通过，生产上传与真实生成待验收。见 `docs/wiki/运维/小易图片官方合同复查-2026-10-13.md`。

小易0.2.0继续使用key `xiaoyi-image`，扩展 `grok-imagine-video-1.5`；原图片模型保留，视频480p/720p/1080p按0.2/0.3/0.4每秒。渠道需新增精确名称并保存分档Task Usage表达式，见 `docs/wiki/运维/小易GrokVideo1.5三档接入-2026-10-13.md`。

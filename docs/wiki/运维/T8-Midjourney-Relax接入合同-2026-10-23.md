# T8 Midjourney Relax 接入合同

更新日期：2026-10-23
状态：本地适配器、插件、App 注册表与目录已登记；NewAPI 上传/渠道、真实出图、结果取回与扣费待验收。

## 合同卡

| 字段 | 内容 |
| --- | --- |
| 上游 | T8（`https://ai.t8star.org`）的 Midjourney 代理；文档 [[归档/模型文档/T8mj模型.md]] / 用户提供 [Midjourney 接入向导](https://gpt-best.apifox.cn/doc-6172523)，2026-10-23 核对 |
| 上游地址 | 提交 `POST https://ai.t8star.org/mj-relax/mj/submit/imagine`；查询 `GET https://ai.t8star.org/mj-relax/mj/task/{id}/fetch` |
| 认证 | `Authorization` 头，值即 T8 渠道 Key；Key 只存 NewAPI 渠道，不进代码、日志与本文 |
| 模型名 | 上游无独立型号名（模式段决定计费）；NewAPI 公开名、插件 `meta.models`、App `model`、面板发送值均为 `mj_relax_imagine` |
| 请求 | `{"prompt": string, "base64Array": string[]}`；`base64Array` 放垫图 data URL，可空 |
| 结果 | 提交返回 `{code:1, result:"<taskId>"}`；查询 `status` ∈ `NOT_START/SUBMITTED/MODAL/IN_PROGRESS/FAILURE/SUCCESS`，成功取 `imageUrl`；失败取 `failReason` |
| 计费 | 按张：用户指定面板售价 ¥0.2/张；NewAPI 侧用 `tier("base", u("calls") * 0.2)`（插件 `calls` 恒为 1） |
| 运行位置 | **只有 NewAPI 插件 `t8-mj`，直连 T8，不部署任何服务**；插件直接用渠道 Key 调上游两个路径（与 `fk` 插件直连供应商同形） |
| 对外合同 | 宿主 `POST /v1/videos` 提交、`GET /v1/videos/{task_id}` 查询；插件内部转成 T8 的 `/mj/submit/imagine` 与 `/mj/task/{id}/fetch`，成图是上游绝对直链 |
| 能力边界 | **仅文生图**：上游只收 `base64Array`，插件没有 fetch，拿不到面板上传的文件字节；面板对该模型不显示参考图。比例走 `--ar`；MJ 没有像素尺寸参数，输出固定为 1024²/格（四宫格整图 2048×2048） |

## 与 ZX fast 的关系：刻意不混

两者上游都是 MJ 代理（只有模式段不同：ZX `/mj-fast/mj`、T8 `/mj-relax/mj`），但渠道、Key、计费单位都不同，因此执行链路完全分开：

| | ZX fast | T8 relax |
| --- | --- | --- |
| App 模型 | `newapi/zx/mj_fast_imagine`（隐藏） | `newapi/t8/mj_relax_imagine`（可见） |
| 插件 key | `zx` | `t8-mj` |
| 执行 | `zx-video-adapter`（已部署） | 无，插件直连 T8 |
| 上游 | `https://zxai.work/mj-fast/mj` | `https://ai.t8star.org/mj-relax/mj` |

两次返工的原因记在这里，避免再走一遍：

1. 第一版把 relax 塞进 `zx-video-adapter` + `zx` 插件——T8 渠道会在插件模型下拉里看到 ZX 的 grok/seedance，误选会把 T8 的 Key 发给 ZX 上游；且共享容器生命周期。已撤销。
2. 第二版新建独立 `t8-mj-adapter` 服务——等于为了一个模型多一次部署，用户明确否决。已删除。
3. 终版：**只在插件里直连 T8**。MJ 的两个路径是普通 REST，插件可以直接请求（`fk` 插件同样直连 `ai.fanke2026.xyz`），代价是垫图暂不支持。

## 本次改动

- `newapi-plugins/t8-mj.plugin.js` 0.3.0：直连 T8，`baseUrl = https://ai.t8star.org`；**渠道 Base URL 一律忽略**（这个插件只服务 T8，渠道里填了过期的内网地址也不会把它带偏——2026-10-23 实测报 `do_request_failed` 后加固）。
  - 提交 `POST /mj-relax/mj/submit/imagine`，body 只有 `{prompt, base64Array}`（无参考图时为空数组）；`code: 1` 且带 `result` 才算受理，`22`（排队中）与其它 code 都报错。
  - 查询 `GET /mj-relax/mj/task/{id}/fetch`，状态按 MJ 自己的词映射：`NOT_START/SUBMITTED → queued`、`MODAL/IN_PROGRESS → in_progress`、`SUCCESS → completed`（取 `imageUrl`）、`FAILURE → failed`（取 `failReason`）；`SUCCESS` 却没有 `imageUrl` 判为失败，不空转。
  - 同时接受 JSON 与面板的 multipart。**面板的图片任务固定发 multipart**，插件 0.1.0 只认 JSON，真实提交时报 `JSON body required`（2026-10-23 复现并修正）。
  - 带参考图直接报错（「目前只支持文生图」），不让上游静默丢图；面板侧同样把该模型的参考图上限设为 0，不显示图槽。
- `src/runtime/creation/creationModelRegistry.ts`：新增 `newapi/t8/mj_relax_imagine`，0–8 张参考图，`contractStatus: 'partial'`。
- `scripts/creation-models/server.mjs`：登记可用性目录与别名。
- 测试：`t8-mj` 插件 14 项、创作模型计划与面板契约 128 项通过；`vue-tsc` 通过。

## 闸门

| 闸门 | 状态 |
| --- | --- |
| G0 合同 | 文档与用户指定的 Base URL、售价已确认；T8 的 `GET /models` 与真实 Key 权限未核对 |
| G1 本地 | 通过（见上）。插件测试钉住提交/查询的确切 URL（`ai.t8star.org/mj-relax/mj/...`）、`{prompt, base64Array}` body 与状态映射 |
| G2 无生成网络 | 未执行：未用真实 Key 验证提交被受理 |
| G3 生产生成 | 未执行 |
| G4 结果取回 | 未执行：`imageUrl` 是否需要鉴权、有效期未核对 |
| G5 计费 | 未执行：NewAPI 定价表达式与本模型实际扣费未对账 |
| G6 跨平台 | 未执行：桌面/移动取图未验收 |

## 剩余事项

1. 上传并激活 `t8-mj.plugin.js` 0.2.0，建 T8 的 type 61 渠道（插件 `t8-mj`、Base URL 随便填或留空都会被忽略、Key 填 T8、模型 `mj_relax_imagine`），Task Usage 写 `tier("base", u("calls") * 0.2)`。**不需要部署任何服务。**
2. 跑一笔真实 relax 任务，核对提交受理、成图直链可下载、NewAPI 消耗明细。
3. 若 T8 的 relax 实际是「令牌设置模式」而非路径模式（文档允许两种），把插件的 `MJ_PATH` 改为 `/mj` 并在 T8 令牌上设 relax。
4. 需要垫图时再回来加：要么让客户端把参考图转成 data URL 放进 JSON（插件已能透传 `base64Array`），要么恢复一个专职适配器。

## 比例与尺寸（2026-10-23 追加）

MJ 没有像素尺寸参数，只有比例。实现路径：

1. App 注册表给该模型声明 `ratios`（1:1 / 2:3 / 3:2 / 4:5 / 5:4 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9）与一个 `ratio` 下拉字段，面板因此出现「比例」选择。
2. `normalizeOpenAiImageParams` 对 `newapi/t8/mj*` 只保留 `{model, prompt, ratio}`，不再按比例推导 `size`——否则会算出一个上游不存在的像素尺寸并报错。
3. `newapi-image-task` 的 multipart 分支显式带上 `ratio`（这个分支原来只传 size）。
4. 插件把 `ratio` 拼成 `--ar W:H` 追加到提示词；只接受 `数字:数字`，用户自己写了 `--ar` 就不再追加。

尺寸：MJ 每格固定 1024²，`--ar` 只改变格子形状，不能指定像素。要更大只能用 U1–U4 放大（按钮动作是独立接口，尚未接入）。四宫格本身是 imagine 的固定输出，切图是下一步的独立功能。

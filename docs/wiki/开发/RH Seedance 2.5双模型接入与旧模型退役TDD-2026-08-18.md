# RH Seedance 2.5 双模型接入与旧模型退役 TDD

## 目标

- 接入 RunningHub `bytedance/seedance-2.5-global-token/multimodal-video`。
- 用是否包含参考视频区分两个 NewAPI 模型，避免把 `text` 误解为文生视频。
- 固定上游分辨率为 `native1080p`。
- 从可选模型中退役 Seedance 2.0、Fast、Mini 三套共 9 个 RH 模型。

## 最终合同

| NewAPI 模型 ID | 显示名称 | 参考视频 | UI / NewAPI 输入价格 |
|---|---|---|---|
| `rh-seedance25-no-video-ref` | Seedance 2.5 无参考视频 | 不接收 | `80/百万TOKEN` / `$80/1M` |
| `rh-seedance25-with-video-ref` | Seedance 2.5 有参考视频 | 必须 `1-10` 个 | `50/百万TOKEN` / `$50/1M` |

两个模型都支持提示词、最多 30 张图片和最多 10 段音频；单个媒体文件上限为 50 MB。时长为 4-30 秒，比例支持 `adaptive`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`。

NewAPI 使用“按 Token”模式，只填写输入价格。补全、缓存、图像输入和音频输入输出价格保持关闭或留空；当前 RH 视频任务链路按输入价格计费。

## 退役范围

Seedance 2.0、Seedance 2.0 Fast、Seedance 2.0 Mini 的多模态、文生视频和图生视频共 9 个旧模型不再出现在可选目录，新任务会拒绝旧 ID。旧注册规格和 RH 映射暂时保留，只用于读取历史任务，避免已有项目失效。

## 实施与问题

1. 先用注册表和适配器测试锁定两个模型、固定分辨率、参考视频数量和价格。
2. 两个形态共用一个 RH 上游端点，差异必须由本地素材合同强制执行，不能依赖上游自动判断。
3. 初始 ID `rh-seedance25-text` 容易被理解为文生视频；最终改为 `no-video-ref` / `with-video-ref`，让后台、客户端和适配器语义一致。
4. 退役旧模型时不能只删 UI 项；默认媒体计划同时切换到 Seedance 2.5，旧 ID 加入不可执行判断，并保留历史读取能力。
5. 两个 Seedance 2.5 ID 必须在 removed-model 判断中显式放行，否则会被宽泛的 `seedance` 旧模型规则误拦截。

## 验证

- RH 适配器定向测试：`41 passed`。
- 前端 focused tests：`1087 passed`。
- `vue-tsc -b` 与 `git diff --check` 通过。
- 并发审计未发现两个新模型共享任务状态或串用轮询 ID；自动测试覆盖连续提交和独立轮询。

## 未验证边界

- 尚未部署服务器。
- 尚未使用真实 RunningHub / NewAPI 生产请求验证生成结果、Token 数量和实际账单。
- 尚未进行生产压力并发；自动测试结果不能替代生产负载和扣费验收。

## 来源

- `docs/wiki/运维/RH-seedace25.md`
- 当前对话中确认的两个模型形态、价格、最终模型 ID 与旧模型退役范围
- 本轮代码、RH 适配器测试、focused tests、TypeScript 和差异检查输出

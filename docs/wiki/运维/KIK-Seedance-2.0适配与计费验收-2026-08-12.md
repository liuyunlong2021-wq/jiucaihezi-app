# KIK Seedance 2.0 适配与计费验收

> 验收日期：2026-08-12

## 生产链路

NewAPI 渠道 `111` 保持 OpenAI 类型、原有 KIK Key、模型列表和计费配置；Base URL 指向内网 `http://kik-seedance-adapter:8792`。适配器将标准 `/v1/videos` 转为 KIK 视频生成和任务查询接口。

已接入 `doubao-seedance-2`、`doubao-seedance-2-0-fast-260128`、`doubao-seedance-2-mini`。三者均支持文字、图片、视频、音频参考，时长 4-15 秒；标准版支持 `480p/720p/1080p/4k`，Fast/Mini 支持 `480p/720p`。

真实 Mini 4 秒图生视频完成 NewAPI 提交、渠道任务成功、轮询和 MP4 返回；本地 `pnpm tauri dev` Tauri 测试 App 已由用户确认成功。

## 计费原理

视频任务不是普通聊天请求。适配器返回任务状态和视频结果，不返回可拆分的 `prompt_tokens`、`completion_tokens`；NewAPI 成功日志中该类任务为 `is_task=true`，并按视频任务分支处理。

因此当前链路使用“输入价格”作为视频任务计费基准，补全价格当前不参与。最终按官方价格设置基础价，收益由 NewAPI 用户组/会员倍率叠加。例如会员倍率 `1.08` 时，基础价 `P` 的实际扣费为 `P × 1.08`。

验收日志显示成功任务 `prompt_tokens=0`、`completion_tokens=0` 但仍正常扣费；错误的 `/v1/chat/completions` 或 `/v1/video/generations` 404 记录 `quota=0`，不产生扣费。

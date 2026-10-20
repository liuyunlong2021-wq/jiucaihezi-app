# Strata 本地端点能力适配 TDD（2026-10-20）

## 目标与根因

用户使用 Strata，服务设置 256K 上下文，希望 App 直接适配。此前自定义端点检测仅保留 `/v1/models` 的 id，丢弃服务能力；模型目录固定套用本地 32K/4K。上一轮只将上下文兜底改成 262144，未解决输出与能力发现。

## 接口依据

- [Strata 官方源码](https://github.com/Niko1221/Strata/blob/main/serve/server.py)：模型列表的 `meta.n_ctx`、`architecture.input_modalities`；`/props?model=...` 的 `default_generation_settings.n_ctx` 和 `params.n_predict`。
- [官方说明](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md#using-it)：`n_predict=-1` 表示没有固定输出上限；思考计入输出；上下文为完整引擎窗口。
- 当前 DSH `compaction-basic` 要求有限的输出预留，不能把整个上下文同时作为输出预留，否则输入预算为零。

## 实施合同

1. 复用现有自定义 OpenAI 兼容端点、HTTP 桥与 Harness，不新建 provider 或代理。模型列表和可选 props 均只读，使用该端点自己的 Key。
2. 保存每个模型的上下文、输出和输入模态；地址或 Key 修改后清除表单旧能力。已保存连接检测保留手动模型 ID。
3. 首次使用旧连接时自动补查；同一连接 30 秒内共用发现结果。离线保留持久配置，普通兼容服务可不支持 props。模型能力变化进入已有 runtime key 与交接机制。
4. 明确的上下文与正数输出配置优先。Strata `n_predict=-1` 时，使用上下文一半作为 SDK 的有限输出预留，另一半留给输入；256K 时为 128K 输出预算，思考与正文共享。**这不是无限输出实现，也不意味着能同时放入 256K 输入并生成 128K 输出。** 服务未声明容量时仍使用本地 256K 上下文兜底；普通未知服务的 4K 输出兜底不变。
5. 服务明确 text-only 时不向 Harness 声明图片；支持图片时沿用原图片链路。不修改桌面工具、审批、Skill、文件与画布能力。

## 验证与边界

- HEAD 原 agentStore 对照新回归测试，复现保存的 131072 输出被丢弃成 4096；修复后通过。
- 定向测试验证 Strata 字段、无固定输出、正数输出、可选 props 缺失、凭据、持久保存和模型目录传递。
- 真 SDK / App runner + 本地模拟 SSE 服务验证 262144 上下文和 131072 请求输出预算；模拟 Strata 思考与文件工具调用，检查续请求。
- 完整 focused 首轮存在三项生命周期测试夹具缺少新依赖，已补齐夹具；另有易红视频插件 `Unsupported model: grok-imagine-video-1.5-preview`，属于本轮开始前已有媒体改动范围，不在此修改。
- 本机 `127.0.0.1:8080` 无服务。用户真实 Strata 地址、版本、长文、视觉与工具实测仍待验收；未打包发布，未声明 Windows / Intel Mac 真机通过。

### 最终自动验证记录

- 模型容量、目录、Harness 与凭据定向测试 **103/103**。
- SDK 生命周期专项 **22 通过 / 1 原有可选对照跳过**；补充最终 Strata SSE 思考/工具续请求、旧连接自动发现、三个交接回归 **5/5**。
- `pnpm run typecheck` 与 `git diff --check` 通过。定向 lint 无错误，7 条已有警告未顺手清理。
- 完整 focused 首轮 2038 项：2033 通过、4 失败、1 跳过；其中本次新增依赖引起的 3 项夹具失败已修并定向通过；余下易红插件失败未改，故不登记全量通过。

## 后续纠正：未知本地模型对齐官方输出兜底

2026-10-20 用户要求统一对齐 DSH。核对随包 `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2/lib/index.js`：`DEFAULT_CONTEXT_WINDOW=262144`、`DEFAULT_MAX_TOKENS=32768`；目录解析按明确配置 → 同 provider/model 内置目录 → 路由默认。4K 属 App 自设限制，现改为 32768，替代本文先前“普通未知服务 4K 不变”的记录。已识别 Strata 的 props 适配与 128K 输出预留保持不变；未将 Strata 特例称为官方默认，未改云端已有产品容量。新增直接与随包官方常量比对的回归测试；真实模型未新增实测。

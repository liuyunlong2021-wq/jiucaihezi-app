# MiniMax H3 视频 `seconds` 类型修复 TDD（2026-08-24）

> 状态：已实施，生产真实生成待验收
> 分支：`0824MiniMax`
> 范围：修复 App 提交 MiniMax H3 视频任务时的 NewAPI 请求合同，并补齐官方合同审计发现的模型可见性边界。

## 1. 问题与目标

创作面板提交 `MiniMaxH3-2k-pro-sec`、`MiniMaxH3-2k-sec` 或 `MiniMaxH3-720p-sec` 时，NewAPI 返回：

```text
HTTP 400: {"code":"invalid_json","message":"json: cannot unmarshal number into Go struct field Alias.seconds of type string","data":null}
```

目标是让三个 MiniMax H3 模型通过现有链路正常进入适配器，同时不改变其他视频模型的请求格式：

```text
App -> NewAPI /v1/videos -> xiaoyi-image-adapter -> 小易 /v1/videos
```

本 TDD 只定义修复和回归门禁，不把尚未执行的生产生成写成已通过。

## 2. 已确认合同

### 2.1 小易官方合同

小易视频生成文档规定：

- 推荐字段为字符串 `seconds`，例如 `"seconds": "8"`。
- 数字 `duration` 只是客户端无法传字符串时的兼容形式。
- 两者表达同一概念，不应同时提交不同值；新请求统一使用推荐字段。

来源：<https://xiaoyiapi.xyz/docs/api/video-generation/>

### 2.2 NewAPI 入站合同

NewAPI 的 `TaskSubmitReq` 将 `Seconds` 定义为 `string`，将 `Duration` 定义为 `int`。数字 `seconds` 会在渠道选择和转发之前反序列化失败，因此参数覆盖、渠道配置或下游适配器都无法修复本次 400。

OpenAI 任务适配器完成校验后会保留原始 JSON，只替换映射后的模型名再转发。现有参考素材字段无需随本次修复重写。

### 2.3 当前 App 与适配器合同

- `src/runtime/creation/creationMediaRuntime.ts` 的 `buildDirectVideoBody()` 当前为 MiniMax H3 同时提交数字 `duration: 8` 和数字 `seconds: 8`。
- `xiaoyi-image-adapter/src/main.py` 已接受数字或字符串时长，并向小易统一输出字符串 `seconds`、`aspect_ratio`、`resolution` 和 `content`。
- 当前 Runtime 测试把数字 `seconds` 写成期望值，因此没有覆盖真实 NewAPI 类型边界。
- 当前适配器测试直接请求适配器，绕过 NewAPI，因此不能发现 App 到 NewAPI 的反序列化失败。

## 3. 根因

```text
创作面板 duration = 15（UI 数字）
-> buildDirectVideoBody 同时生成 duration: 15、seconds: 15
-> NewAPI 反序列化 TaskSubmitReq.Seconds string
-> 数字 15 无法写入 string
-> HTTP 400 invalid_json
-> xiaoyi-image-adapter 和小易均未收到请求
```

根因位于 App 到 NewAPI 的请求构造边界，不在 MiniMax 模型能力、提示词、时长范围、适配器或小易上游。

## 4. 最小修复决定

只修改 `buildDirectVideoBody()`：

1. MiniMax H3 请求输出 `seconds: String(params.duration)`。
2. MiniMax H3 请求不再输出重复的 `duration`。
3. 非 MiniMax H3 请求继续沿用现有 `duration` 和各自专用合同。
4. 保留现有比例、分辨率、素材上传、轮询和 `/content` 下载链路。

目标请求：

```json
{
  "model": "MiniMaxH3-720p-sec",
  "prompt": "...",
  "seconds": "15",
  "aspect_ratio": "16:9",
  "resolution": "720p"
}
```

不修改：

- NewAPI 源码、版本或参数覆盖配置。
- `xiaoyi-image-adapter` 业务实现和生产部署。
- MiniMax H3 模型名、价格、5-15 秒范围、比例、分辨率或参考素材上限。
- Veo、Grok、Seedance、Omni、RunningHub 或本机 ComfyUI 请求。
- 未跟踪的 `docs/wiki/运维/RH-wan30.md` 及其 RH 模型接入事项。

## 5. TDD 步骤

### 红灯

修改现有 `Xiaoyi MiniMax H3 submits duration, ratio and all reference types` 测试，使其要求：

- `seconds === "8"`。
- 请求中不存在 `duration`。
- 比例、分辨率和全部参考素材字段保持原值。

该测试在当前实现上必须失败，失败差异应只指向 `duration` 和 `seconds`。

### 绿灯

在 `buildDirectVideoBody()` 内复用现有 MiniMax 模型判断，按模型条件输出字符串 `seconds` 或原有 `duration`。不新增 helper、配置项或适配层。

### 回归

1. Runtime 定向测试通过：`src/runtime/creation/__tests__/creationMediaRuntime.test.ts`。
2. 创作计划测试继续覆盖三个 MiniMax H3 模型、5-15 秒范围和素材上限。
3. `xiaoyi-image-adapter` 现有测试继续证明最终上游 payload 为字符串 `seconds` 和标准 `content`。
4. `pnpm run test:focused`、`pnpm run typecheck` 与 `git diff --check` 通过。
5. 不把自动测试写成真实 NewAPI、小易渠道或扣费验收。

## 6. 生产验收

代码和自动测试通过后，按最低成本执行一次真实链路：

1. 选择 `MiniMaxH3-720p-sec`、5 秒、无参考素材，确认不再返回 `invalid_json`，取得任务 ID并完成 MP4 落盘。
2. 再执行一次带参考素材任务，确认上传 URL、适配器 `content` 转换、轮询和 `/content` 下载均可用。
3. 核对 NewAPI 实际扣费时长为所选秒数。

只有以上真实请求完成后，才能把 MiniMax H3 生产链路登记为已验收。

## 7. 完成标准

- 红灯测试先失败，再由单点请求构造修复转绿。
- MiniMax H3 发往 NewAPI 的 `seconds` 只有字符串形式，且不重复发送 `duration`。
- 其他视频模型请求快照无变化。
- 自动验证结果与未执行的生产验证边界分别记录。

## 8. 实施结果

- 红灯：Runtime 定向测试 `28/29`，唯一失败为 MiniMax H3 请求仍含数字 `duration: 8`、`seconds: 8`。
- 绿灯：`buildDirectVideoBody()` 仅为 MiniMax H3 输出字符串 `seconds` 并省略 `duration`；Runtime 定向测试 `29/29` 通过。
- 回归：`pnpm run test:focused` 通过，其中 Rust `402 passed / 1 ignored`；`pnpm run typecheck`、小易适配器 `12/12` 和 `git diff --check` 通过。
- 未执行：尚未发布，也未执行真实 NewAPI、小易任务、MP4 落盘或扣费验收。

## 9. 官方合同审计补充修复

审计发现适配器 `/v1/models` 无鉴权返回硬编码全集，与小易“按当前令牌可见模型为准”的合同不符；模型注册表也在生产验收前把 MiniMax H3 标记为 `verified`。

补充红灯与修复：

1. 适配器测试先要求无 Token 返回 401、带 Token 时只返回小易上游对该 Token 可见的公开模型，并确认同一 Bearer Token 被转发。
2. `/v1/models` 改为查询小易上游并过滤公开别名；上游异常或无有效模型数组时明确返回网关错误。
3. 适配器视频测试改用 App 修复后的真实入站形式 `"seconds": "8"`。
4. 三个 MiniMax H3 的合同状态降为 `partial`；完成第 6 节生产验收后才能改回 `verified`。

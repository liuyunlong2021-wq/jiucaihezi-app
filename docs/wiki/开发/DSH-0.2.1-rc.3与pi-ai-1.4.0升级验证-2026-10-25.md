# DSH 0.2.1-rc.3 与 pi-ai 1.4.0 升级验证（2026-10-25）

## 状态与范围

用户质疑随包 pi 不是最新版，要求在主线把 DSH 三个包升到 `0.2.1-rc.3`、pi-ai 升到 `1.4.0`，跑现有测试并对 NewAPI 做真实对话与工具调用验证；不提交漫剧无关改动，不推送、不发布。

本次只升级依赖与同步版本字样，不改模型路由、适配器或重试策略。前一版见 [[开发/DSH-0.2.1-rc.2升级与SDK桥接收敛-2026-10-18]]，pi 在调用链中的位置见 [[排障/DSH的pi-ai依赖与Strata引擎退出错误溯源-2026-10-24]]。

## 1. 升级前核对

- npm：`@earendil-works/pi-ai` latest 为 `1.4.0`（2026-10-21），随包为 `1.3.0`；DSH `next` 为 `0.2.1-rc.3`（2026-10-23）。
- rc.3 的 `dsh-llm-pi-ai` 仍声明 `pi-ai: ^1.1.0`，`lib/` 与 rc.2 逐文件无差异。只升 DSH 时锁文件会继续停在 pi-ai `1.3.0`，因此两者需一起升级。
- pi-ai 1.4.0 的破坏性变化（`telemetryContext` 改名、删除 `getPiUserAgent`、`resolveTranscriptTools` 参数变化）在适配器中均无引用；适配器用到的 5 个导入路径（`providers/all`、三种 `api/*.lazy`、`utils/overflow`）在 1.4.0 中均存在。
- 与 NewAPI 相关的 1.4.0 修复：网关 `upstream_error` / `upstream_stream_read_error` 等可自动重试；请求 id 中的数字不再被误当作 HTTP 状态码；仅空白的工具输出改用占位，避免部分服务商返回 400。默认 `User-Agent` 改为 `pi/<version> (...)`，如 NewAPI 或前置 WAF 按 UA 过滤需留意。

## 2. 实施

- `src-tauri/resources/deepseek-harness/package.json`：`dsh-sdk-client`、`dsh-computer-use`、`dsh-experimental-computer-use-cua-driver-native` 及 `allowScripts` 中 `dsh-subprocess-local` 改为 `0.2.1-rc.3`。
- 直接 `npm install` 时，旧锁文件中 rc.2 的 peer 依赖互相冲突（ERESOLVE）。处理方式：只从锁文件删除 `@deepseek-ai/*` 与 `@earendil-works/pi-*` 条目，然后重新安装。DSH 以外只有 `pi-ai`、`pi-telemetry` 从 1.3.0 变为 1.4.0，新增 `dsh-client-ui-entry-customization`；Windows、Intel Mac、Linux 的平台包都未丢失。
- 同步写死 rc.2 的三处：`deepSeekHarness.test.ts` 的版本断言、`modelContextWindows.ts` 的注释、`deepseek-session-lifecycle.test.mjs` 的跳过说明。rc.3 适配器默认常量与 rc.2 一致，容量数值不变。
- `prepare-deepseek-harness.mjs` 运行后照常裁掉 Node 安装源、`.bin/node` 和 LibreOffice。

## 3. 验证

- 9 个 harness 测试文件：93 项通过、0 失败、2 项跳过。跳过项需要设置 `DSH_OFFICIAL_CONTROL_SERVER`，即一份未修改的官方服务端模块。
- `deepSeekHarness`、`deepSeekInbox`、`modelContextWindows` 单元测试（esbuild + `node --test`）：92 项全部通过。
- 真实 NewAPI（`https://api.jiucaihezi.studio/v1`，`openai-completions`，`gemini-3.8-flash`）：临时脚本通过官方 `runner.mjs`，以独立 dshHome 运行，key 从用户终端环境变量读取，不写入任何文件。
  - 无效 key：返回 NewAPI 格式的 `401 Invalid token`，说明请求链路通畅。
  - 第一次真实运行：首个请求遇到 Cloudflare 524（源站 120 秒内未完成响应），pi 将其归类为 SERVER 并自动重试 1/5 次；重试后模型调用 `read` 读取文件成功。之后因脚本自身 180 秒超时中止，不计为通过。
  - 第二次真实运行：85 秒内完成两步（第 35 秒调用 `read`，随后回复），回复的随机口令与文件内容一致，判定通过。

## 4. 未验证与观察

- 未测试 Claude 模型的 `anthropic-messages` 路线、安装版 App、Windows / Intel Mac 真机；未打包、未发布。
- 观察：`gemini-3.8-flash` 经 NewAPI 时，首个响应可能超过 Cloudflare 120 秒代理超时并返回 524，再由客户端重试，用户会感到卡顿一两分钟。这属于服务端或 CDN 侧问题，与本次升级无关，尚未排查。
- 观察：无效 key 的 401 也出现了 `llm/retry` 事件，该轮约 38 秒才结束。尚未核对这是否是 rc.2 时期已有的行为，本次未修改。

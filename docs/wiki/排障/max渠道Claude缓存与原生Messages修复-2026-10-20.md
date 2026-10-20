# max 渠道 Claude 缓存与原生 Messages 修复

## 证据与根因

用户在服务器只读查询渠道 #108「小易无限制max-1企业级」：启用，分组 `1.2`，模型映射、参数覆盖、请求头覆盖为空。

同渠道同模型 `claude-haiku-5-5` 的日志：原生 `/v1/messages` 请求 1202566 读取缓存 415798、写入 285；1202567 读取 416083。`/v1/chat/completions` 请求 1202565、1202569 的缓存读写均为零。不能归因为整个渠道不支持缓存。

用户提供的服务器源码（工作目录 HEAD `dac55f0f`）中，`RequestOpenAI2ClaudeMessage` 重建 system、文本、图片/PDF 块时未复制 `CacheControl`，也没有自动添加缓存标记。运行镜像与该源码是否完全一致未验证。`claude cli trace` 默认规则只是透传请求头及渠道亲和，不负责插入缓存块。

本地工作台桌面主对话通过 `createRuntime` 生成 Harness provider 配置，此前所有模型固定 `openai-completions`。随包 SDK 已支持 `anthropic-messages`，其默认短缓存策略会为 system 和对话添加 ephemeral 标记。

## 最小修复

仅韭菜盒子云端（provider 为 `jiucaihezi` 或缺省）的 `claude-` 模型改用 `anthropic-messages`；Anthropic SDK 使用不含结尾 `/v1` 的 baseURL，自行请求 `/v1/messages`。其他模型和自定义 provider 保留 OpenAI 兼容协议。复用 SDK 的缓存和工具消息处理，不重建生产 NewAPI，不增加手工缓存状态。

此次范围是桌面 Harness 主对话；辅助 Chat Completions 调用及服务端通用转换缺口未修改。不会使外部 OpenAI 兼容客户端自动获得缓存。

## 验证

- Harness 单元测试 70/70，通过协议选择、URL 规范化及自定义 provider 不变的断言。
- 新增真实随包 SDK + APP runner + 本地 HTTP 模拟服务测试：请求路径为 `/v1/messages`，system/对话携带 ephemeral 缓存标记，流式 read 工具调用成功执行，其结果进入下一次请求，最终回复返回。
- 会话生命周期回归 24 项通过，1 项因缺少未修改官方控制服务器而跳过。
- TypeScript `pnpm exec vue-tsc -b` 通过。
- 模拟返回的缓存数字仅用于协议测试，不是生产缓存命中的证明。

未打包、发布、修改生产服务或进行真实收费调用；安装版需更新后，连续请求稳定前缀并核对缓存写入/读取及账单。真实缓存仍取决于上游支持、前缀一致性与有效期。

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

上述自动验证完成时，未打包、发布、修改生产服务或进行真实收费调用。随后用户提供了真实请求截图，结果见下节；截图没有提供客户端版本、请求 ID 或渠道 ID，不能据此补记正式发布或所有渠道已验收。


## 用户真实验证回执（本次会话，2026-10-21 归档）

用户说明“刚刚测试了”，并提供 NewAPI 用量截图。截图显示同一用户、模型 `claude-haiku-5-5`、分组倍率 1.2 的三笔记录：

| 截图位置 | 普通输入 / 输出 | 缓存读取 ↓ | 缓存写入 ↑ | 页面费用 |
| --- | --- | --- | --- | --- |
| 顶部 | 2 / 606 | 56,166 | 19,108 | $0.003904 |
| 中部 | 2 / 641 | 未显示 | 74,424 | $0.011548 |
| 底部 | 4 / 1,474 | 未显示 | 56,701 | $0.00939 |

**验收结论：用户这次真实请求已经出现缓存读取，命中得到用量页面证实。** 顶部一笔同时有读取和写入，表示复用已有前缀并为新增内容建立缓存。按该笔页面输入构成计算，读取占比为 `56166 / (2 + 56166 + 19108) ≈ 74.6%`；这是该笔输入的 token 占比，不是费用节省率、整个会话命中率或模型总体命中率。

中部和底部只显示写入，不等于已经读取命中。费用为页面显示值，未独立对账。截图不含请求时间、请求 ID、渠道 ID、协议路径和客户端构建号；不能仅凭它证明三笔为同一对话，或把顶部命中严格归因于某个发布包。服务器原始响应、跨平台和其他型号仍未分别验收。

## 下次同类问题的排查顺序

1. **先取证，区分读缓存与写缓存。** 保存模型原名、provider、分组、渠道 ID、请求 ID/时间、客户端版本、请求入口、缓存读写数字。长输入、响应变快或费用变低都不能单独证明命中。
2. **比较同渠道、同模型的不同请求协议。** 原生入口可命中而兼容入口长期读写为零时，优先检查客户端构造及转换链路，不先改分组或计费倍率。不同用户/对话的记录只能用于证明能力存在，不能当作稳定前缀对照实验。
3. **沿完整链路检查字段。** 客户端模型路由 → SDK 请求构造 → NewAPI 入站解析 → DTO/转换 → 上游请求 → 上游 usage → 流式/非流式解析 → 日志和计费。查看转换是否复制缓存字段，是否因重建 system、文本、图片、工具定义而丢字段；避免只搜索字段名就断言已支持。
4. **优先复用 SDK 原生协议。** 若模型、网关及已有 SDK 都支持原生协议，优先消除多余转换。若必须兼容转换，再补字段保留与回归；客户端未发送标记时，仅修复制字段仍不足以生效。
5. **先做模拟回归，再做真实对照。** 模拟服务验证出站路径/正文、工具调用、流式和恢复；真实服务验证缓存读写与实际账单。两者的通过状态分别记录。

### 可复用的服务器只读查询

以下命令适用于本次生产 PostgreSQL 部署：容器 `postgres`、用户 `newapi`、数据库 `new-api`、日志字段 `channel_id`。其他部署先核对表结构与连接参数。只替换渠道 ID，保持只读；不查询渠道密钥、请求正文或整份配置。

```bash
docker exec -i postgres psql -X -U newapi -d new-api -P pager=off <<'SQL'
BEGIN READ ONLY;
SELECT id, name, type, status, "group", model_mapping
FROM channels WHERE id = 108;

WITH recent AS (
  SELECT id, created_at, model_name, prompt_tokens, completion_tokens,
         NULLIF(other, '')::jsonb AS usage
  FROM logs
  WHERE channel_id = 108 AND type = 2
  ORDER BY id DESC LIMIT 30
)
SELECT id, to_timestamp(created_at) AS request_time,
       model_name, usage->>'request_path' AS request_path,
       prompt_tokens, completion_tokens,
       usage->>'cache_tokens' AS cache_read_tokens,
       usage->>'cache_creation_tokens' AS cache_write_tokens,
       usage->>'usage_semantic' AS usage_semantic,
       usage->>'request_conversion' AS request_conversion
FROM recent ORDER BY id DESC;
ROLLBACK;
SQL
```

本次 `other.cache_tokens` 是缓存读取、`cache_creation_tokens` 是缓存写入；其他模型/协议先核对适配器的字段语义。字段缺失不应直接当作上游返回零。若 `other` 不是合法 JSON，先检查字段格式，不修改历史日志来让查询通过。`to_timestamp` 的显示时区由数据库会话决定，跨端比对时核对时区。

### 最小真实验收流程

1. 使用已加载修复的客户端运行时，记录构建版本，确认请求入口确实改变；运行中的旧进程未必已加载新代码。
2. 使用同一个账号、Key、分组、模型和对话，提交一段固定且满足该模型缓存最低长度的内容。模型最低长度、有效期、显式标记/自动缓存方式，以该渠道和模型当前官方合同为准，不套用其他型号参数。
3. 在有效期内追加一个简短问题，保持前面的内容、system 与工具定义稳定。不要为测试反复重建会话或更换模型；记录两次请求实际命中的渠道。
4. 查看第一次是否写入、后续是否读取；可能已有可复用缓存，因此不要求第一次读取一定为零。**后续真实 usage 的缓存读取大于零，才可记为读取命中。** 再核对普通输入、缓存读写和输出的计费。
5. 若仍未命中，比较实际出站前缀及路由：动态时间/随机 ID、工具集合变化、历史裁剪/压缩、会话重建、缓存过期、上游账号切换都作为待查假设，逐项用证据排除，不直接认定为本次根因。

### 迁移到其他模型时的边界

- 本次已验证的是云端 Claude + Messages 路线，不能给所有模型添加 `cache_control: ephemeral`。
- 对其他模型先核对当前原生协议与缓存机制：有些自动按前缀缓存，有些需要显式缓存资源或缓存键。参数是否生效应以实际出站请求和真实 usage 为准。
- 原生 SDK 的 baseURL 规则不同；本次 Anthropic SDK 会补 `/v1/messages`，所以去掉结尾 `/v1`。不能将这个 URL 处理无条件推广到 OpenAI 或自定义端点。
- 自定义 provider、其他模型及辅助 Chat Completions 请求仍保持原协议。本次修复不等于服务端通用转换缺口已修好。
- Redis、渠道亲和和提示词缓存不是同一层能力；会话亲和可影响路由稳定性，但不能代替上游缓存标记。缓存计费倍率控制计价，不能创建上游缓存。
- 一笔命中只证明这次请求成功；不要扩大成全渠道、全型号、所有对话或所有平台均通过，也不要承诺首字延迟一定降低。

## 下次交付的最小记录卡

```text
模型原名 / provider：
客户端版本 / SDK版本 / 请求协议：
分组 / 渠道 / 上游映射：
修复前请求ID / 缓存读写：
丢失字段或不稳定前缀的证据：
最小修复位置 / 保留能力：
自动回归结果：
真实请求ID或截图 / 缓存读写 / 账单核对：
未验证平台、型号及发布边界：
```

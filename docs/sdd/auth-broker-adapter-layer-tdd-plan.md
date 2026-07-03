# Auth Broker + Adapter Layer TDD 执行方案

## 目标

把当前“双 Gateway”结构收敛为更清晰的三层：

```text
一键登录：Studio -> Auth Broker -> NewAPI
普通对话：Studio -> NewAPI
未来媒体：Studio -> Media Adapter -> RunningHub / Suno / T8
```

当前阶段只做第一步：**Auth Broker 只负责登录换 Key，聊天不再经过 Gateway。**

UI 尽量不改：设置页按钮、登录弹窗、Key 输入框、高级配置入口都保留。

## 不做什么

- 不改现有设置页布局。
- 不接 RunningHub。
- 不做会员、模型权限、扣费、充值、签到、邀请。
- 不让 Gateway 代理普通聊天。
- 不把未来 Adapter 和 Auth Broker 混在一个大入口里。

## 最终行为

### 手动 Key

```text
用户粘贴 Key
-> App 保存 Key
-> 对话直连 https://api.jiucaihezi.studio/v1/chat/completions
```

### 一键登录

```text
用户输入 NewAPI 账号密码
-> Auth Broker 验证 NewAPI 登录
-> Auth Broker 创建或复用用户工作台 Key
-> 返回 api_key + base_url
-> App 调用 setApiKey(api_key)
-> 对话直连 https://api.jiucaihezi.studio/v1/chat/completions
```

### 未来 RunningHub

```text
Studio -> /adapters/runninghub/* -> RunningHub
```

这一步以后再做，不进入当前 TDD 范围。

## Phase 0：冻结当前可用能力

### RED

新增/调整测试，证明当前两条路线的目标契约：

- `gatewayLogin` 可以接收 `api_key` 响应。
- `gatewayLogin` 成功后会保存普通 API Key，而不是 Gateway session。
- `resolveApiConfig` 在有普通 Key 时返回真实 Key。
- `buildHeaders` 不带 `X-JC-Session`。

### GREEN

只改测试需要的最少代码，不碰 UI。

### 验收

- 一键登录后 `getApiKey()` 有值。
- `getGatewaySessionToken()` 不再作为聊天前置条件。

## Phase 1：Auth Broker 契约切换

### Gateway 测试

新增 `gateway/tests/auth-broker.test.mjs`：

- `POST /auth/login` 返回：

```json
{
  "success": true,
  "api_key": "sk-...",
  "base_url": "https://api.jiucaihezi.studio/v1",
  "username": "..."
}
```

- 登录失败返回 401 JSON。
- 找到已有工作台 Key 时复用。
- 没有工作台 Key 时创建并读取真实 Key。
- `/v1/chat/completions` 在 Auth Broker 阶段不由 Gateway 处理。

### App 测试

新增/调整：

- `newApiOneClickLogin.test.ts`
- `gatewayClient.test.ts`
- `apiConfig.test.ts`

覆盖：

- 一键登录拿到 `api_key` 后调用 `setApiKey(api_key)`。
- 不写入 `jcGatewaySessionToken`。
- 成功文案仍然是“已登录，可直接使用”。
- 手动 Key 优先级不变。

## Phase 2：移除聊天 Gateway 依赖

### RED

测试当前聊天请求头：

- 有 API Key 时：

```text
Authorization: Bearer sk-...
x-api-key: sk-...
```

- 不应出现：

```text
X-JC-Session
__JC_GATEWAY_SESSION__
```

### GREEN

修改 App 内部登录成功路径：

```ts
await setApiKey(result.api_key)
await clearGatewaySession()
```

保留设置页 UI。

## Phase 3：清理旧 Session 模式

### RED

测试确认这些旧行为不会再影响聊天：

- `jcGatewaySessionToken` 残留时，不覆盖手动 Key。
- 一键登录后不会调用 Gateway session chat。
- `checkAuth()` 主要判断普通 Key。

### GREEN

逐步降级旧 session：

- 保留 `clearGatewaySession()` 兼容旧用户迁移。
- 登录成功时主动清旧 session。
- 不再把 Gateway session 当聊天凭证。

## Phase 4：线上验证

部署前必须通过：

```bash
cd gateway && npm test
pnpm run test:focused
```

线上探针：

```bash
curl -i https://api.jiucaihezi.studio/health
curl -i -X POST https://api.jiucaihezi.studio/auth/login
curl -i -X POST https://api.jiucaihezi.studio/v1/chat/completions
```

预期：

- `/auth/login` 由 Auth Broker 处理。
- `/v1/chat/completions` 不再进入 Auth Broker Worker。
- App 一键登录后普通聊天直连 NewAPI。

## Phase 5：未来 Adapter 预留

当前不实现，只保留目录规划：

```text
gateway/
  src/
    auth/
    adapters/
      runninghub/
      suno/
      t8/
```

未来每个 Adapter 单独 TDD：

- 独立路由。
- 独立环境变量。
- 独立限流和错误处理。
- 不影响普通聊天。

## 风险与保护

- **Web 端保存 Key 风险**：先接受，桌面端优先使用 Rust 安全存储。
- **旧 session 残留**：一键登录成功后主动清理。
- **线上误路由**：部署后必须验证 `/v1/chat/completions` 是否已经不由 Auth Broker Worker 接管。
- **回滚**：当前 commit 前保留旧 Gateway 版本号和工作区变更，必要时重新部署旧版本。

## 成功标准

- 用户感知 UI 不变。
- 一键登录成功后能直接聊天。
- 手动粘贴 Key 仍然 100% 可用。
- 普通聊天不经过 Gateway。
- Gateway 只承担 Auth Broker 职责。
- 未来 RunningHub 走独立 Adapter，不污染聊天链路。


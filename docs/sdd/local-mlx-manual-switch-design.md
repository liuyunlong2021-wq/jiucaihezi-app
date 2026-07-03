# Local MLX Manual Switch Design

## Goal

让用户在设置里安装本地模型后，可以在对话区模型选择器中手动选择「韭菜盒子综合 / 创意写作 / 推理」。选中云端模型时只走韭菜盒子云端 API；选中本地模型时只走本机 MLX 服务，断网也能使用。

## Non-Goals

- 不做自动选择模型。
- 不做自动路由到本地或云端。
- 不在发送消息前替用户切换模型。
- 不暴露 MLX、端口、Provider、apiHost 给普通用户。

## Manual Routing Rule

```text
选择 GPT-5.5 → providerId = jiucaihezi → https://gateway.jiucaihezi.studio
选择 韭菜盒子综合 → providerId = local-mlx → 本机 MLX
```

模型选择器是唯一的使用入口。设置页只负责安装、移除和状态展示。

## Provider Model

新增本地 Provider：

```ts
{
  id: 'local-mlx',
  name: '本地模型',
  type: 'local-mlx',
  apiKey: '',
  apiHost: 'internal://local-mlx',
  enabled: true,
  models: [
    { id: 'local-mlx/jiucai-general', label: '韭菜盒子综合', providerId: 'local-mlx' },
    { id: 'local-mlx/jiucai-writing', label: '韭菜盒子创意写作', providerId: 'local-mlx' },
    { id: 'local-mlx/jiucai-reasoning', label: '韭菜盒子推理', providerId: 'local-mlx' },
  ],
}
```

云端 Provider 固定走 Gateway session，不再让普通用户填写 Key。

## Settings UI

位置：现有设置页中，`API 配置` 和 `外观` 之间。

状态：

- 未安装：每张模型卡片显示「下载」
- 安装中：显示当前安装/下载步骤
- 可用：显示「设为当前模型」「移除」

下载完成后只注册模型，不自动切换。用户必须在模型选择器里手动选择，或点击设置页的「设为当前模型」。

## Chat Flow

```text
用户发送消息
  ↓
resolveApiConfig()
  ↓
读取 jcModelProviderId
  ↓
jiucaihezi → 校验 Gateway session → Gateway /v1/chat/completions
local-mlx → 不校验 Gateway session → ensureLocalMlxServer() → 本机 /v1/chat/completions
```

本地模型请求继续复用现有 SSE 读取逻辑，降低聊天层改动范围。

## Runtime

第一版 Mac 使用 MLX：

- 韭菜盒子综合：`mlx-community/Qwen3.5-35B-A3B-OptiQ-4bit`
- 韭菜盒子创意写作：`mlx-community/gemma-4-31B-it-OptiQ-4bit`
- 韭菜盒子推理：`mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit`
- 本地端口：`127.0.0.1:17880`
- 本地目录：`~/.jiucaihezi/models/local-mlx/`
- 运行时目录：`~/.jiucaihezi/local-mlx/`

每个模型有独立 ready marker。运行时启动后必须校验 `/v1/models` 返回的是当前所选模型 repo，不能只看端口是否可用。

第一版允许先用 Python venv 安装 `mlx-lm` 跑通链路；正式发版前再评估把 MLX 运行时做成 sidecar，避免小白用户手动装依赖。

## Acceptance

- 模型选择器没有「自动选择」。
- 本地模型未安装时，模型选择器不显示本地模型。
- 本地模型安装后，模型选择器显示「云端模型 / 本地模型」两组。
- 选择本地模型后，无 Gateway session 也不会报「请填写 API Key」。
- 选择本地模型后，请求不访问 `api.jiucaihezi.studio`。
- 选择云端模型后，请求走 `gateway.jiucaihezi.studio` 并使用登录态计费。

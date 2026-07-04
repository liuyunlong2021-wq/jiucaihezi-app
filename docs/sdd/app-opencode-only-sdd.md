# SDD: 桌面 APP 取消直连模式，统一进入 OpenCode Agent 运行时

> **状态**: 已实施（分支 `0704-shanchuzhilian`，commit `5c8c23c`）
> **日期**: 2026-07-04
> **作者**: by3 / Codex
> **适用范围**: Tauri 桌面 APP。Web 端保持当前轻量聊天入口，不在本次改造范围内。

---

## 一、产品决策

桌面 APP 不再保留“普通聊天 / 直连模式”。所有桌面对话都进入 OpenCode Agent 运行时。

用户心智从“选择聊天引擎”改为：

| 入口 | 含义 | 引擎 | 典型用途 |
|---|---|---|---|
| 文 | 思考，不主动操控电脑 | OpenCode plan agent | 问答、分析、写作、方案 |
| 武 | 干活，可操控电脑 | OpenCode build agent | 编程、调试、文件管理、自动化 |
| 模型选择 | 决定成本和能力 | 云端模型 / 本地 Ollama / 自定义 provider | 本地模型承担低成本简单问题 |

原直连模式的核心价值是省 token。现在桌面端已经支持本地模型驱动文/武模式，简单问题可以用“本地模型 + 文模式”解决，成本近乎为 0。因此桌面直连模式的产品价值接近 0，继续保留只会增加 UI 心智和代码维护成本。

Web 端长期定位为轻量聊天入口，继续保持当前简单对话形态。不要把桌面 OpenCode 工作台概念搬到 Web 端。

---

## 二、架构边界

### 2.1 要删除的是“直连执行路径”

桌面端删除：

```
直连模式 UI
sendDirectLocalModelMessage()
sendDesktopDirectCloudMessage()
options.chatMode === 'direct' 分支
桌面侧对 src/runtime/direct/* 的依赖
```

### 2.2 不能删除的是“模型 / provider 基础设施”

必须保留：

```
src/utils/providerConfig.ts
src/opencodeClient/providerProjection.ts
src/stores/agentStore.ts 的云端 + 本地 + 自定义 provider 合并逻辑
```

原因：OpenCode 文/武模式本身需要这些能力来接入 NewAPI、Ollama、本地/自定义 OpenAI-compatible provider。删除直连不等于删除本地模型。

### 2.3 Web 端暂不重构

Web 端保持当前简单聊天能力，不做新功能、不改产品形态。若实施中必须切分代码，只允许做最小边界整理，目标是“不影响 Web 现状”。

---

## 三、目标状态

### 桌面 APP

```
ChatPanel
  ├── 模式: 文 / 武
  ├── 模型: 云端 / Ollama / 自定义 provider
  └── sendMessage()
        └── useChat OpenCode path
              ├── projectStoredNewApiForOpenCode()
              ├── ensureOpenCodeServer()
              ├── create/update OpenCode session
              └── session.prompt()
```

桌面端不存在“直连”按钮，也不存在绕开 OpenCode 的普通聊天执行路径。

### Web

```
Web Chat
  └── 保持当前轻量聊天入口
```

Web 不展示文/武、不展示 OpenCode 权限、不接本地 Ollama。

---

## 四、代码变更范围

### 4.1 修改

```
src/components/chat/ChatPanel.vue
  - AgentMode 移除 direct
  - 模式菜单只保留 文 / 武
  - 默认模式仍为 武，历史 localStorage 中 direct 自动迁移为 文或武

src/composables/useChat.ts
  - 删除桌面本地直连函数 sendDirectLocalModelMessage
  - 删除桌面云端直连函数 sendDesktopDirectCloudMessage
  - 删除桌面 direct 分支
  - 保留 Web 当前路径，直到有独立 Web 聊天 composable 再迁移

src/composables/__tests__/useChatControls.test.ts
  - 删除“direct 在 OpenCode 前分流”的断言
  - 新增“桌面本地模型文/武进入 OpenCode”的断言
```

### 4.2 可能删除

仅当确认无 Web 引用后再删：

```
src/runtime/direct/*
src/utils/directMessageBuilder.ts
src/composables/chatCloud.ts
```

如果 Web 仍依赖这些文件，本次不删。懒得返工的原则：先删除桌面直连入口和执行分支，Web 代码等实际无引用后再清理。

### 4.3 明确不做

```
不删除 opencodeClient/*
不删除本地 Ollama / 自定义 provider 支持
不修改 NewAPI / gateway / rh-adapter
不改创作面板
不改 Skill / 工具仓库
不把 Web 端升级成浏览器版工作台
```

---

## 五、迁移规则

### localStorage

历史值：

```
jc_agent_mode = direct
```

迁移为：

```
jc_agent_mode = plan
```

理由：直连模式主要用于普通问答，最接近“文模式”。如果用户想让 AI 干活，再手动切到“武”。

### 模型

历史选择的本地 Ollama 模型继续有效。它不再触发本地直连接口，而是通过 `providerProjection` 注入 OpenCode config。

---

## 六、风险与缓解

| 风险 | 等级 | 缓解 |
|---|---:|---|
| 用户找不到原直连入口 | 中 | 文案上强化“文 = 问答/分析，武 = 干活” |
| 简单问题走 OpenCode 事件流略重 | 低 | 推荐本地模型 + 文模式，成本近乎 0 |
| Web 端误伤 | 高 | 本次不改变 Web 产品形态；保留 Web 所需直连代码 |
| 误删 provider 基础设施 | 高 | 明确 providerProjection/providerConfig/agentStore 模型合并必须保留 |
| 本地模型工具调用能力差异 | 中 | 文模式先覆盖简单问答；复杂任务提示切云端强模型 |

---

## 七、实施顺序

```
Phase 1: 桌面 UI 去 direct
  ├── AgentMode 移除 direct
  ├── 模式菜单只保留 文 / 武
  └── direct 历史值迁移为 plan

Phase 2: useChat 删除桌面直连分支
  ├── 删除 sendDirectLocalModelMessage()
  ├── 删除 sendDesktopDirectCloudMessage()
  ├── 删除 options.chatMode === 'direct'
  └── 确认本地模型文/武仍进入 OpenCode

Phase 3: 引用审计
  ├── rg direct/runtime/direct/directMessageBuilder/chatCloud
  ├── Web 仍使用的文件保留
  └── 无引用文件再删除

Phase 4: 验证
  ├── 桌面：本地 Ollama + 文模式，发送“你好”
  ├── 桌面：本地 Ollama + 武模式，查看项目文件
  ├── 桌面：云端模型 + 文/武模式
  ├── Web：普通聊天不退化
  └── pnpm exec vue-tsc -b && pnpm exec vite build
```

---

## 八、验收标准

- 桌面端没有“直连”入口。
- 桌面端所有普通输入都进入 OpenCode session。
- 本地 Ollama 模型可用于文/武模式。
- 未登录/无 NewAPI Key 时，选择 Ollama 不触发 NewAPI Key 错误。
- Web 端轻量聊天保持当前体验。
- `providerProjection.ts`、`providerConfig.ts`、`agentStore.ts` 的 provider 基础设施仍保留。

---

## 九、决策记录

- **2026-07-02**: 初版提案创建，方向是 APP 专注 OpenCode。
- **2026-07-04**: 本地模型成功驱动文/武模式后，正式决策：桌面端删除直连模式；本地模型作为 OpenCode provider 保留；Web 端长期保持轻量聊天入口。

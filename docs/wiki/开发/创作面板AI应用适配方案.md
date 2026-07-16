# 创作面板 AI 应用适配方案

> **前提**：`rh-adapter/docs/ai-app-full-support-plan.md` 已实施完毕，后端支持 `app-info`、`app-list`、显式 nodeId:fieldName 精确修改。
> **目标**：创作面板支持"任意 RunningHub AI 应用"的发现→填参→提交→结果全流程。
> **策略**：最大程度复用现有 UI 基建（模型选择器、genericModelFields、任务提交/历史），不另起炉灶。

---

## 现状可复用盘点

创作面板已有这些能力，AI 应用可以直接挂上去：

| 现有能力 | AI 应用怎么用 |
|----------|-------------|
| 任务选择器（图片/视频/音频） | 新增「AI 应用」任务类型 |
| 模型选择器 + dropdown | AI 应用作为模型出现（预注册的已有，如数字人） |
| `genericModelFields` 动态表单 | AI 应用的每个 `apiCallDemo` 节点 → 一个 field（STRING→文本框, IMAGE→文件上传, LIST→下拉, BOOLEAN→开关, INT/FLOAT→数字） |
| 提示词输入框 (`showPromptInput`) | AI 应用的主 prompt 节点仍用此框 |
| 文件上传（参考图拖拽） | AI 应用的 IMAGE/VIDEO/AUDIO 节点用现有的文件上传 |
| 发送按钮 → `mediaTaskStore.submitTask()` | 同路径，payload 加 `extra_fields.webappId` + `extra_fields.nodes` |
| 进度条 + 历史 Modal | 不做任何改动，直接复用 |

---

## 推荐方案：三个阶段，渐进式交付

### 阶段 A（最小可行）：ad-hoc webappId 输入 + 节点发现

用户手动输入 webappId → 点「发现节点」→ 节点变表单 → 填参 → 提交。

**改动文件：3 个**

#### A1. `src/data/mediaModelCapabilities.ts` — 新增 AI 应用任务类型

在 `MEDIA_TASK_LABELS` 中加一条：
```
'ai-app': 'AI 应用',
```

在模型列表里加一个虚拟模型 `rh-aiapp-adhoc`：
```typescript
{
  id: 'rh-aiapp-adhoc',
  label: '自定义 AI 应用',
  task: 'ai-app',
  model: 'rh-aiapp',
  provider: 'runninghub-video',  // 或根据实际输出类型动态切换
  fields: [],  // 空，运行时动态填充
}
```

#### A2. `src/composables/useCreation.ts` — 新增 AI 应用节点发现 + 动态字段

新增两个函数：

```typescript
// AI 应用节点 → genericModelFields 格式
function aiAppNodeToField(node: AiAppNode): CreationFieldSpec {
  const kind = node.fieldType === 'IMAGE' || node.fieldType === 'VIDEO' || node.fieldType === 'AUDIO'
    ? 'file'
    : node.fieldType === 'LIST' ? 'select'
    : node.fieldType === 'BOOLEAN' ? 'boolean'
    : node.fieldType === 'INT' || node.fieldType === 'FLOAT' ? 'number'
    : 'text'
  return {
    key: `${node.nodeId}:${node.fieldName}`,
    label: node.description || node.fieldName,
    kind,
    defaultValue: node.fieldValue,
    options: node.options?.map((o: any) => ({ label: String(o), value: o })),
    required: false,
  }
}

// 点击「发现节点」调用
async function discoverAiAppNodes(webappId: string): Promise<CreationFieldSpec[]> {
  const resp = await fetch(`${apiBase}/api/runninghub/app-info?webappId=${webappId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })
  const data = await resp.json()
  const nodes = data.nodeInfoList || []
  return nodes.map(aiAppNodeToField)
}
```

#### A3. `src/components/creation/CreationPanel.vue` — UI：webappId 输入 + 发现按钮

在参数条（`.cp-params`）最前面，当 `cpState.task === 'ai-app'` 时，渲染：

```
┌──────────────────────────────────────────────────────────┐
│  webappId: [________________] [🔍 发现节点]              │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ prompt   │ │ steps    │ │ seed     │  ← 动态节点字段   │
│  │ [______] │ │ [__20__] │ │ [______] │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
│                                                          │
│  [提示词输入框]                              [⬆ 发送]     │
└──────────────────────────────────────────────────────────┘
```

关键交互：
1. 用户输入 webappId → 点「发现节点」
2. 调 `discoverAiAppNodes(webappId)` → 得到 fields
3. 把 fields 注入 `cpState.aiAppFields`（新增 state）
4. `genericModelFields` computed 合并：`[...existingGenericFields, ...aiAppFields]`
5. 用户填参 → 点发送
6. `buildCurrentCreationParams()` 把 `aiAppFields` 的值收集进 `extra_fields.nodes = {"52:prompt": "...", "39:steps": "20"}`
7. `extra_fields.webappId` 设为当前 webappId
8. 走现有的 `submitTask` 流程

---

### 阶段 B（浏览发现）：AI 应用市场

用户不输入 webappId，而是浏览热门/推荐应用列表，点一个就自动填好 webappId。

**改动：2 个文件**

#### B1. `src/components/creation/CreationPanel.vue` — 新增「浏览应用」弹窗

当 `cpState.task === 'ai-app'` 且 webappId 为空时，显示：

```
┌──────────────────────────────────────────┐
│  🔍 发现 AI 应用                         │
│                                          │
│  [推荐] [最热] [最新]                     │
│                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ 封面   │ │ 封面   │ │ 封面   │       │
│  │ 应用名  │ │ 应用名  │ │ 应用名  │       │
│  │ 描述    │ │ 描述    │ │ 描述    │       │
│  └────────┘ └────────┘ └────────┘       │
│                                          │
│  或直接输入 webappId: [__________]       │
└──────────────────────────────────────────┘
```

调 `/api/runninghub/app-list?sort=RECOMMEND` 拿列表，渲染成卡片。点卡片 → 自动填 webappId → 调 `discoverAiAppNodes` → 进阶段 A 的填参流程。

#### B2. `src/api/media-generation.ts` — 新增 `listAiApps()` 

```typescript
export async function listAiApps(sort: string, size: number, page: number) {
  const config = await ensureConfig()
  const resp = await fetch(`${config.apiBase}/api/runninghub/app-list?sort=${sort}&size=${size}&page=${page}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  })
  return resp.json()
}
```

---

### 阶段 C（智能填充）：节点值自动回填

用户从聊天框发了一个 AI 应用链接时，创作面板自动接收 webappId + 节点值，跳过发现/填参步骤直接提交。

这块是聊天→创作面板桥接，跟当前 `MediaTaskBubble.vue` 的「发送到创作面板」按钮逻辑类似，只是 payload 从 model+prompt 变成 webappId+nodes。

---

## 数据流总览

```
用户操作              创作面板                          rh-adapter / RH
───────              ────────                          ──────────────
输入 webappId
   │
   ├─[发现节点]──→  GET /api/runninghub/app-info  ──→  apiCallDemo
   │                 ← nodeInfoList                    ← ComfyUI 节点
   │
   ├─ 渲染表单
   │  (prompt/steps/seed/...)
   │
   ├─[发送]──────→  POST /v1/images/generations   ──→  _submit_via_app
   │                 { model: "rh-aiapp",              → 发现节点→覆盖→上传→提交
   │                   prompt: "...",                  → /task/openapi/ai-app/run
   │                   extra_fields: {
   │                     webappId: "...",
   │                     nodes: {"52:prompt":"cat"}
   │                   }}
   │                 ← { task_id }
   │
   ├─ mediaTaskStore 轮询 ──→  GET /rh/tasks/{id}?ai_app=true
   │                          ← { status, url }
   │
   └─ 结果显示（历史 Modal + 画布）
```

---

## 实施建议

1. **先做阶段 A**（约 200 行改动，3 个文件），这是最小闭环，用户就能输入任意 webappId 跑 AI 应用了
2. 阶段 B 是体验优化（约 150 行），让用户不用去 RunningHub 网站找 ID
3. 阶段 C 是聊天桥接（约 80 行），打通对话框→创作面板的链路

三个阶段互不依赖，可以独立交付。

# 创作面板模式化架构改造 SDD

> **状态**: 设计稿 · 待评审  
> **日期**: 2026-07-13  
> **分支**: `0711-canvas`  
> **适用范围**: 韭菜盒子 Desktop（Tauri + Vue）全端  
> **关联文件**: `WorkspaceLayout.vue` · `ActivityRail.vue` · `FileTreePanel.vue` · `CreationPanel.vue` · `EditorPanel.vue` · `ChatPanel.vue`  
> **设计原则参考**: `CLAUDE.md` 先审根因再修症状、最小代码原则

---

## 0. 一句话决断

产品核心价值已从"AI 对话"进化到"AI 创作"。现有布局把对话锁死在主位、把创作产出（画布/编辑器/流水线）塞在可选的右侧面板——这个优先级是反的。

改造目标：**Rail 定义创作模式 → FileTree 是数据真源 → 模式内容区（第三列）根据后端的 skill 管线展示结构化进度 → 基础功能区（第四列，创作画布 + 编辑器）默认展开且常驻。**

对话 UI 可隐藏，对话 session 不切断。一键成X 模式本质是同一个 agent session + 一层折叠皮。

---

## 1. 目标与非目标

### 1.1 目标

1. Rail 语义从"切换右侧面板"升级为"切换创作模式"——对话是其中一种模式，不是默认绑定态
2. FileTree 保留隐藏能力（适配小屏幕），但默认展开
3. 新用户冷启动默认看到：Rail + FileTree + 一键漫剧（模式内容区）+ 创作面板（基础功能区）——立刻能开干
4. 创作面板（画布/极速流水线）和编辑器从"右侧面板的可选项"升级为"默认展开的基础功能区"
5. 旧的 Rail 条目（skills/tools/editor/review/files/creation）归并到不挡视线的地方

### 1.2 明确不做

- 不改 skill 层：JC-manju-skills / JC-xiaoshuo / JC-meitichuangzuo 等已存在的 skill 文件不变，本次只改前端"怎么调用它们"
- 不改 useChat.ts 核心消息流：pipeline 面板只是折叠原始消息，不是新建通信通道
- 不改 mediaTaskStore / creationModelRegistry：创作面板的模型能力不变
- 不引入新的状态库或事件总线
- 不重构 FileTreePanel 内部逻辑，只改其"可隐藏策略"的默认值

---

## 2. 布局架构（4 列 → 目标态）

```
┌──────┬────────────┬──────────────────────┬──────────────────────┐
│ Rail │  FileTree  │     模式内容区        │      基础功能区       │
│ 固定  │  可隐藏    │  (Rail 选什么出什么)   │   ★默认展开★         │
│ 52px │  默认展开   │                      │   可隐藏/可调宽度     │
├──────┼────────────┼──────────────────────┼──────────────────────┤
│ 模式类│ 会话/项目  │  对话模式 → ChatPanel │  创作面板(画布/流水线)│
│ 工具类│  双Tab     │  一键漫剧 → Pipeline  │  编辑器(写作/笔记)    │
│(底部) │           │  一键小说 → Pipeline  │  设置(settings)      │
│       │           │  电商工具 → Pipeline  │                      │
│       │           │  漫剧剧本 → Pipeline  │                      │
└──────┴────────────┴──────────────────────┴──────────────────────┘
```

### 2.1 Rail 图标布局（重设计）

**上部 — 模式类（点击切换"模式内容区"，第一波平铺展示）**

Rail 不使用图标。每个模式是一个带文字的圆形按钮：两字名称单行展示；三个字及以上固定两行、每行两个字。例如"漫剧制作"显示为"漫剧"、"制作"。文字本身就是功能名，避免用户猜图标语义。

| 按钮文字 | mode | 第一波说明 |
|----------|------|------------|
| 对话 | `chat` | 传统聊天模式，col3 显示 ChatPanel |
| 漫剧／制作 | `pipeline:manju` | 一键漫剧：风格→角色/场景/道具→工程手册→分镜→音色→配音→合成 |
| 漫剧／剧本 | `pipeline:script` | 从零写漫剧剧本/临摹换皮 |
| 电商 | `pipeline:ecom` | 第一项为电商主图；后续接数字人和动作迁移 |
| PPT | `pipeline:ppt` | PPT 专用 skill + GPT Image 2；有必要时再接入 Remotion |
| 短故／事 | `pipeline:short-story` | 短故事创作与成稿 |
| 小说 | `pipeline:novel` | 一键小说：灵感→市场→核心梗→角色→大纲→章纲→文案→正文→复盘 |

> 第一波固定平铺以上 7 个模式。后续只有在 Rail 的垂直空间确实不足时，才为新增模式引入折叠分组；不提前设计下拉菜单。

**底部 — 工具类（不变，保持可用但不挡路）**

| 图标 | 名称 | 说明 |
|------|------|------|
| ❓ | 帮助 | 使用指南 |
| 🌐 | 语言切换 | 中/英切换 |
| ⚙️ | 设置 | 用户中心 + 旧 Rail 条目的归入位置 |

### 2.2 旧 Rail 条目的去向

当前 `ActivityRail.vue` 的 `allTabs` 数组包含 6 个条目。模式化后它们的归属：

| 旧条目 | 去向 | 理由 |
|--------|------|------|
| `skills`（技能仓库） | **设置 → 技能管理子页** | 安装/管理第三方 skill 是偶尔操作，不需要常驻 Rail |
| `tools`（工具仓库） | **设置 → 工具管理子页** | 同上 |
| `editor`（编辑区） | **基础功能区（col4）**，默认展开 | 编辑器是日常写作/笔记工具，不该藏在 Rail 后面 |
| `review`（变更审查） | **设置 → 审查记录子页** | 审查是后处理操作，不是入口级功能 |
| `files`（文件树） | **独立为 col2 FileTree**，不再走 Rail 切换 | FileTree 是数据真源，且 rail 已有独立的 files 图标，逻辑矛盾 |
| `creation`（创作面板） | **基础功能区（col4）**，默认展开 | 创作面板是核心工作区，不该是 Rail 的一个选项 |

> **关于编辑区**：你的直觉是对的——编辑区应该保留且可见。它的位置从"Rail 点一下才出现"改为"col4 基础功能区里的一个 Tab（创作面板/编辑器两个 Tab 切换）"，用户随时可以切过去写作，不用先找入口。

---

## 3. 打开 APP 第一眼（冷启动默认态）

```
┌──────┬──────────────┬───────────────────────┬──────────────────────┐
│ 💬   │ FileTree     │   一键漫剧 · 创作中     │  创作面板(画布)       │
│ 🎬→■ │  ├─ wiki/    │  ┌─ 流水线进度 ─────┐  │  ┌─ 角色图 ─┐         │
│ 📝   │  ├─ 作品/    │  │ ① 风格分析 ✅     │  │  │  (画布) │         │
│ 🛒   │  ├─ 角色/    │  │ ② 角色设计 ⏳     │  │  └─────────┘         │
│ 📖   │  ├─ 场景/    │  │ ③ 场景设计 ⬜     │  │                      │
│      │  ├─ assets/  │  │ ④ 工程手册 ⬜     │  │  编辑器 Tab          │
│ ⚙️   │  └─ ...      │  │ ⑤ 分镜设计 ⬜     │  │  (可切换)            │
│      │              │  │ ⑥ 音色设计 ⬜     │  │                      │
│      │              │  │ ⑦ 视频合成 ⬜     │  │                      │
│      │              │  │                   │  │                      │
│      │              │  │  [查看对话原文 ∨] │  │                      │
│      │              │  └───────────────────┘  │                      │
└──────┴──────────────┴───────────────────────┴──────────────────────┘
```

关键设计决策：
- **默认模式不是"对话"而是"漫剧制作"**——新用户打开就知道这是创作工具，不是聊天软件
- **col4 默认展开创作面板**，不是 settings——用户立刻能看到画布空间
- **FileTree 默认展开**，但保留隐藏按钮（col2 顶部加 × 或折叠图标）
- 右侧面板宽度记忆上次调整值，不再硬编码

---

## 4. 模式内容区（col3）设计

### 4.1 核心接口

```ts
// 概念定义，实际代码命名待定
type CreationMode =
  | 'chat'              // 传统对话
  | 'pipeline:manju'    // 一键漫剧制作
  | 'pipeline:script'   // 漫剧剧本
  | 'pipeline:ecom'     // 电商
  | 'pipeline:ppt'      // PPT
  | 'pipeline:short-story' // 短故事
  | 'pipeline:novel'    // 一键小说

interface ModeContentState {
  mode: CreationMode
  pipelineSessionId?: string   // 隐藏的 opencode session
  showRawChat: boolean         // "查看对话原文"展开开关
  pipelineStages: PipelineStage[]
}

interface PipelineStage {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  errorMsg?: string
  outputFiles?: string[]        // 指向 FileTree 下的真实文件路径
  outputMediaIds?: string[]     // 指向创作面板的媒体资产
}
```

### 4.2 Chat 模式（现状保留）

mode === 'chat' → col3 渲染现有的 `ChatPanel.vue`，行为与现在完全一致。用户从 Rail 点回"对话"时看到对话记录。

### 4.3 Pipeline 模式（新增组件）

mode === 'pipeline:*' → col3 渲染 `PipelineModePanel.vue`，该组件：

1. **读取 pipeline 注册表**（`pipelineRegistry.ts`），找到当前 mode 对应的 skill 映射和阶段定义
2. **通过 eventBus 订阅底层 session 的消息流**，用阶段识别规则（skill 输出的结构化标记或 LLM 约定的标签）把消息聚合成阶段卡片
3. 每个阶段卡片展示：图标/名称/状态（进行中/成功/失败）、产出文件列表（可点击在编辑器打开）、媒体预览缩略图
4. 底部有一个可折叠的 **「查看对话原文」** 区域，展开后看到原始消息流——用户排查问题时有用，日常收着不挡视线

### 4.4 对话记录去 FileTree

当前 col3 ChatPanel 里"对话记录"（历史会话列表）的功能从 col3 转移到 FileTree 的"会话"Tab——FileTree 已经有这个 Tab，但需要保证：
- 点击历史会话 → col3 切换到 Chat 模式并加载该会话
- 点击历史会话 → col4 的创作面板/编辑器保持不变（不切断工作流）

---

## 5. 基础功能区（col4）设计

col4 从"右侧面板各种东西平权切换"改为两层结构：

### 5.1 固定 tab 切换（创作面板 / 编辑器 / 设置）

```
┌─ 基础功能区 ───────────────────────────────┐
│ [ 创作面板 ] [ 编辑器 ] [ ⚙️ 设置 ]       │
│                                             │
│  当前 tab 内容...                           │
│                                             │
│  [收起 →]                                   │
└─────────────────────────────────────────────┘
```

- **创作面板**：现有的 `CreationPanel.vue`（画布 + 极速流水线模式），默认选中。单次创作的主要工作区。
- **编辑器**：现有的 `EditorPanel.vue`（Tiptap 富文本），用于写作/笔记/查看 pipeline 产出的文本文件。当 pipeline 产出一段文本（角色小传/剧本/小说章节）时，自动在编辑器打开；用户也可以主动切过来写。
- **设置**：原来的 `SettingsPanel.vue` + 旧 Rail 归入内容（技能管理 / 工具仓库 / 审查记录）。

**已确认决策**：创作面板与编辑器使用同一 col4 的两个固定 Tab，不拆成并列的第五列。这样既保证随时可达，也给小屏保留实际工作面积。

### 5.2 旧 Rail 条目归入"设置"后的结构

```
设置面板：
├─ 账户信息（现有）
├─ 模型配置（现有）
├─ 通用设置（现有）
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─
├─ 技能管理（原 skills → 安装/卸载/管理第三方 skill）
├─ 工具仓库（原 tools → 管理内置工具/插件）
├─ 审查记录（原 review → 变更历史/审查记录）
└─ 数据管理（缓存/导出/清理）
```

这样既不丢失功能，又不占用 Rail 的入口级空间。用户 90% 时间用不到这些管理功能，他们需要时在设置里能找到。

---

## 6. 数据流

```
Rail 点击模式
  │
  ├─ mode === 'chat'
  │   └─ col3: ChatPanel（现有，不变）
  │
  └─ mode === 'pipeline:*'
      ├─ pipelineRegistry 查表 → 找到绑定 skill + 阶段 schema
      ├─ 启动/复用隐藏的 opencode session（沿用已有 useChat 消息流）
      ├─ PipelineModePanel 订阅消息流 → 聚合成阶段卡片
      │   ├─ 文本产出 → emitEvent('open-in-editor', ...) → EditorPanel 显示
      │   ├─ 媒体产出 → emitEvent('canvas:add-media', ...) → CreationPanel 画布显示
      │   └─ 文件写入 → FileTree 自动刷新
      └─ 用户可随时展开「查看对话原文」看原始消息
```

---

## 7. 实现阶段

### 阶段 0：Rail 语义重定义 + col4 默认展开

**改动文件**: `ActivityRail.vue` · `WorkspaceLayout.vue`

- 修改 `allTabs`：去掉 editor / creation / files / review，保留 skills + tools（它们会在阶段 2 归入设置）
- Rail 新增模式类图标（漫剧制作、漫剧剧本、电商、小说），初始阶段只有"漫剧制作"是真的，其他暂时不可用（打 disabled 样式 + tooltip "即将推出"）
- col4 默认值从 `settings` 改为 `creation`
- col4 增加 tab 切换（创作面板 / 编辑器 / 设置），设置里包含旧条目
- 冷启动默认模式改为 `pipeline:manju`，不改为 `chat`

**可回退**：不改任何业务组件，纯样式/配置/默认值改动。

### 阶段 1：PipelineModePanel + pipelineRegistry

**新增文件**: `components/pipeline/PipelineModePanel.vue` · `runtime/pipeline/pipelineRegistry.ts` · `stores/pipelineStore.ts`（或并入已有 store）

- `pipelineRegistry.ts` 定义 mode → skill 映射 + 阶段 schema（各阶段的 label、预期产出类型）
- `PipelineModePanel.vue` 渲染阶段卡片列表 + "查看对话原文"折叠区
- 对接 useChat 的消息流做阶段聚合（初期用关键词/结构标记匹配，后续可升级为结构化输出解析）

### 阶段 2：JC-xiaoshuo 跑通（纯文本，风险最低）

- pipelineRegistry 注册 `pipeline:novel` → 绑定 JC-xiaoshuo
- PipelineModePanel 显示小说 9 阶段
- 文本产出逐阶段展现在 EditorPanel

### 阶段 3：JC-manju-skills 跑通（双面板联动）

- pipelineRegistry 注册 `pipeline:manju` → 绑定 JC-manju-skills
- 文本产出 → EditorPanel，媒体产出 → CreationPanel 画布
- 双面板联动：PipelineModePanel 的每一阶段产出完成后，自动推送到对应的基础功能区 tab

### 阶段 4：第一波模式入口与电商主图

- Rail 平铺文字圆钮：对话、漫剧制作、漫剧剧本、电商、PPT、短故事、小说
- 电商模式第一期只实现"电商主图"：新增专用 skill，调用 GPT Image 2；其产出进入 CreationPanel 画布和 FileTree
- PPT 模式绑定后续新增的 PPT skill，先用 GPT Image 2 产出视觉页；只有转场、动画或视频化导出确有需求时，才接入 Remotion
- 数字人、声音克隆、声音设计与动作迁移不塞进首期电商主图，按后续阶段逐项接入

### 阶段 5：电商数字人和动作迁移

- 数字人：复用创作面板的数字人模型，编排音频里的声音克隆和声音设计能力
- 动作迁移：复用现有动作迁移能力，定位为"我是导演"的镜头动作控制模式
- 三者均作为电商模式中的独立子流程，复用同一个隐藏 session、FileTree 真源和 CreationPanel 媒体任务

### 阶段 6：旧 Rail 条目最终归入设置

- Rail 移除 skills / tools / review 图标
- SettingsPanel 增加对应的子页面入口
- 预留兼容：已安装的第三方 skill 不丢失，只是入口从 Rail 移到设置

---

## 8. 已确认的第一波产品决策

1. Rail 使用平铺的文字圆钮，不使用抽象图标。第一波共七项：对话、漫剧制作、漫剧剧本、电商、PPT、短故事、小说。
2. 电商第一期只做电商主图：专用 skill + GPT Image 2。后续按顺序增加数字人（数字人模型 + 声音克隆 + 声音设计）和动作迁移（导演式动作控制）。
3. PPT 使用独立 skill + GPT Image 2；Remotion 是可选的后续能力，不进入第一期基础依赖。
4. 基础功能区固定为创作面板 / 编辑器两个 Tab，默认创作面板；不新增并列列。

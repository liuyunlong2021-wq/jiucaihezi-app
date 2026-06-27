# V8 画布重构 — 工作安排

> 日期: 2026-06-01
> 阅读对象: Grok（执行者）
> 权威依据: `docs/sdd/canvas-v8-v5-corrected-sdd.md` (v5.1) + `docs/sdd/canvas-v8-tdd-spec.md`
> 当前进度: Phase 0 基础设施已写但未装车（`src/components/canvas/v8/`）

---

## 一、概述

### 1.1 决策

**产品即将上线，画布功能暂时关闭。** 上线后画布作为 feature update 逐节点替换回来。

### 1.2 当前优先级

```
P0: 关闭画布入口，保证产品上线（今天）
P0: 冻结策略接入现有画布（今天）
P1: 逐节点替换（Week 1-9）
P2: 完成全部 14 节点后开启入口
```

### 1.3 你已有的资产

```
src/components/canvas/v8/
├── composables/
│   ├── useGlobalFreezeManager.ts    ← ✅ 冻结策略（已测，未装车）
│   ├── useV8NodeResize.ts           ← ✅ RAF 缩放（已测，未装车）
│   ├── useV8NodeBehavior.ts         ← ✅ 组合 Hook
│   ├── useCanvasInteractionFreeze.ts
│   └── ...
├── NodeFrame.vue                    ← ✅ 统一节点骨架（已测，未装车）
├── styles/                          ← ✅ 冻结 CSS + 节点基础样式
├── activate.ts                      ← ✅ 一键激活
└── examples/                        ← Demo，不要再写了
```

---

## 二、立即执行：关闭画布入口（今天）

### 任务 2.1：隐藏画布导航

在 `src/components/rail/ActivityRail.vue` 中找到画布 tab，注释掉或加 `v-if="false"`。

**一行代码**，不要删代码（以后要恢复）。

### 任务 2.2：保留数据

SQLite 里的画布数据不动，`canvasStore` 不要删。上线后 V8 完成时用户数据完好。

---

## 三、立即执行：冻结策略装车（今天）

### 任务 3.1

在 `CanvasWorkspace.vue` 中找到 VueFlow 的拖拽/缩放事件回调，接入冻结：

```ts
import { globalFreeze } from '@/components/canvas/v8/composables/useCanvasInteractionFreeze'

// 在 VueFlow 的 onNodeDragStart / onMoveStart 中：
globalFreeze.freeze()

// 在 onNodeDragStop / onMoveEnd 中：
globalFreeze.unfreeze()
```

**目标**：现有 42 节点画布拖拽立刻变丝滑。零风险，不改任何节点代码。

---

## 四、Phase 1：核心节点替换（Week 1-3）

### 替换策略

**一个节点文件换一个节点文件。** 新节点放在 `src/components/canvas/v8/nodes/`，在 `CanvasWorkspace.vue` 的 `nodeTypes` 里逐项替换注册。旧文件不动（避免依赖断裂），替换完一批后旧文件由我统一清理。

### 任务 4.1：TextNode（P0，第一优先级）

- 新文件: `v8/nodes/V8TextNode.vue`
- 基于 `NodeFrame.vue` 骨架
- 编辑态：内联 Tiptap（复用 EditorPanel 扩展），非 popover
- 折叠态：Markdown 预览（marked + dompurify）
- 性能约束：单编辑态原则、焦点离开降级、Tiptap 延迟 init/destroy
- 替换: `CanvasTextNode.vue` → `V8TextNode.vue`
- TDD 参考: TN-001, TN-002, TN-003

### 任务 4.2：LLM 节点（P0，第二优先级）

- 新文件: `v8/nodes/V8LlmNode.vue`
- Tab 式渐进披露: 📋摘要 → 📁知识库 → 🧩Skill → 🔧工具 → ⚙️高级
- 三路 context 输入: `left-prompt` + `left-context` × N
- 输出: `right-text`（prompt-flow）
- 上下文组装: 调用 `ConversationContextEngine.build()`
- Knowledge → user-side evidence（不进 system role）
- Tool → 暴露 definitions，LLM 自行判断（对齐 useChat.ts tool loop）
- 替换: `CanvasLlmNode.vue` → `V8LlmNode.vue`
- TDD 参考: LLM-001, LLM-002, LLM-003

### 任务 4.3：Context Provider 三节点（P0，第三优先级）

- `v8/nodes/V8VaultNode.vue` — 知识库选择器，无 ▶
- `v8/nodes/V8SkillNode.vue` — Skill 选择器，无 ▶
- `v8/nodes/V8ToolsetNode.vue` — 工具开关集合，无 ▶
- 全部基于 `NodeFrame.vue`
- 右侧 source Handle → 连 LLM 的 `left-context`
- TDD 参考: CP-001, CP-002

### 任务 4.4：媒体生成节点（P1，第四优先级）

- `v8/nodes/V8ImageGenNode.vue` — 3 层参数
- `v8/nodes/V8VideoGenNode.vue` — 4 层参数（含首尾帧）
- `v8/nodes/V8AudioGenNode.vue` — 3 层参数
- 异步状态机: idle → submitting → polling → success/cancelled/error
- 输入签名缓存（SHA256，相同输入秒出）
- TDD 参考: E-003, E-004

---

## 五、Phase 2：结果 + Group + 边验证（Week 4-6）

### 任务 5.1：结果节点

- `V8ImageResultNode.vue` / `V8VideoResultNode.vue` / `V8AudioResultNode.vue`
- 统一画廊模板 + 右键菜单（下载/设为参考/保存到知识库）

### 任务 5.2：Group 节点（最关键）

- `v8/nodes/V8GroupNode.vue`
- 折叠/展开双态
- **端口聚合规则**：prompt-flow 绝不丢数据（≥2 输入时暴露 N 个独立端口）
- Context 作用域隔离：内部 Context Provider 只对内部 LLM 生效
- 独立执行 + 模板导出（模板内 Context Provider → 占位符）
- TDD 参考: G-001, G-002, G-003（G-001 必须最先通过！）

### 任务 5.3：边验证系统

- 在 `CanvasWorkspace.vue` 实现 `isValidConnection`（14×14 矩阵 1:1）
- Group 折叠态动态验证
- 边类型自动推断（5 条规则）
- 非法连线拒绝 + 中文 toast
- TDD 参考: C-001~C-034

### 任务 5.4：编排节点

- `V8LoopNode.vue` / `V8TextSplitNode.vue`
- 从占位实现变成真正可用

---

## 六、Phase 3：体验层（Week 7-9）

### 任务 6.1：节点库三区重构

- `CanvasNodeLibrary.vue` 改为：①上下文（置顶浅紫）→ ②核心 → ③编排（折叠）

### 任务 6.2：Context 栏 + 视觉层级

- 画布顶部 Context 栏（默认 Skill/知识库/工具/模型）
- 执行时动态视觉（连线高亮 + Context Provider 呼吸 + 非活跃降暗）
- 性能约束：节点 >15 时动画自动降级

### 任务 6.3：默认起始模板

- 新建画布 → 五节点模板：`📝需求 → 🧠AI大脑 → 📝输出 → 🖼️生成 → 🖼️结果`
- 浮动提示卡（首次可见，可关闭）

### 任务 6.4：底部输入栏

- 自然语言 → AI 推荐节点链 → 用户确认才创建（两段式）
- 默认不自动执行

### 任务 6.5：迁移向导 + 旧节点清理

- 打开旧画布 → 自动备份 + 向导弹窗
- 一键升级/逐个处理/保留旧版（永不强制只读）
- 32 个废弃节点标记 @deprecated

### 任务 6.6：右键菜单

- 4 种场景全覆盖（画布空白/单节点/Handle/多选）
- 参考 TDD: M-001~M-008

---

## 七、编码规范

### 7.1 文件命名

```
v8/nodes/V8TextNode.vue        ← 新节点统一 V8 前缀
v8/composables/useXxx.ts       ← 组合函数
v8/styles/v8-canvas-xxx.css    ← 样式
```

### 7.2 测试先行

每个节点文件写完后的第一件事：写对应的 TDD 测试用例并让它通过。参考 `docs/sdd/canvas-v8-tdd-spec.md`。

### 7.3 不做的事

- ❌ 不要再写 Demo 组件
- ❌ 不要碰 `src/canvas/` 目录（旧服务层，Phase 3 再清理）
- ❌ 不要改 `canvasStore.ts` 的数据格式（V8 新增字段通过可选属性兼容）
- ❌ 不要提前删任何旧节点文件（统一清理在 Phase 3）

### 7.4 每天结束时更新

`src/components/canvas/v8/PHASE0_CURRENT_PROGRESS.md` 的「当前进展」段落。

---

## 八、上线检查清单

画布功能上线前必须通过：

- [ ] 14 个节点全部替换完成
- [ ] TDD 所有测试通过
- [ ] 30 节点画布拖拽 50fps+
- [ ] 默认五节点模板正确
- [ ] Group 端口聚合不丢数据（G-001 通过）
- [ ] LLM 三路上下文注入正确（LLM-001 通过）
- [ ] 旧画布迁移向导可工作
- [ ] 画布 Context 栏不影响对话区
- [ ] 工具连线不强制调用（LLM-002 通过）
- [ ] `pnpm run test:focused` 全部通过
- [ ] `pnpm build` 无报错

---

**开始吧。从任务 2.1（关闭入口）和任务 3.1（冻结装车）开始，今天完成。**
# 画布系统 V8 TDD 测试驱动开发文档

> 版本: v1.1  
> 基于: canvas-v8-v5-corrected-sdd.md (v5.1) + DeepSeek 3 个小补丁  
> 目的: 将 SDD 转化为可执行的测试规范，驱动实现  
> 原则：测试先行，所有功能必须有对应测试覆盖后再写生产代码

**v1.1 变更**：新增 C-015（LLM→text）、UI-001（底部栏两段式确认）、Mig-003/Mig-004（迁移数据正确性验证）

---

## 1. 目的与范围

本 TDD 文档将 SDD v5.1 中的所有需求转化为**可验证的测试用例**。

目标：
- 确保实现严格遵循“纯手动显式控制”哲学
- 防止 Group 端口聚合导致数据丢失
- 保证手感性能（30 节点可接受帧率）
- 验证 LLM 上下文注入三路同时到达 + 用户文本最高优先级
- 工具连线仅暴露定义，不强制调用

**范围**：V8 画布核心功能（不包含未来 V9 完整增量缓存和轨迹可视化）。

---

## 2. 测试策略

### 测试金字塔

- **单元测试 (60%)**：纯函数（端口聚合逻辑、脏检查传播算法、边类型推断、SHA256 签名计算等）
- **组件测试 (25%)**：单个节点组件（TextNode 编辑/降级、LLM Tab 切换、Group 折叠态端口渲染）
- **集成测试 (10%)**：节点间交互（连线验证、执行流、Group 内部隔离）
- **E2E + 视觉测试 (5%)**：完整工作流、手感、默认模板、迁移向导

### 特殊关注维度

- **哲学合规测试**（P1/P3/P4/P5）：必须作为独立测试类别
- **性能基准测试**：必须有可自动化跑的基准（30 节点 Jank < 200ms）
- **边界与异常**：环路、数据丢失场景、折叠态端口变化

---

## 3. 核心领域测试规范

### 3.1 通用 Node Frame & 手感

**验收标准**：
- 所有 14 个节点都使用统一轻量 Frame
- 拖拽/缩放期间必须冻结非必要渲染和动画
- Resize 使用原生 pointer + RAF，结束才批量写入 store

**测试用例**：

| ID | 场景 | Given | When | Then | 类型 |
|----|------|-------|------|------|------|
| F-001 | 缩放手柄基础 | 任意节点 | 拖拽右下角手柄 | 节点实时改变尺寸，松手后持久化到 node.data | 组件 |
| F-002 | 冻结策略 | 30 个节点画布，部分展开 | 开始拖拽/缩放任意节点 | 全局加 `.is-interacting`，所有节点内容区 `pointer-events: none`，transition 禁用 | E2E |
| F-003 | Collapsed 渲染优化 | 重节点（含 Tiptap 或视频预览） | 点击折叠 | 内容区 `display:none`，不再参与布局计算和渲染 | 组件 + 性能 |

---

### 3.2 连接系统与验证矩阵（含边类型自动推断）

**验收标准**：
- 14×14 矩阵 100% 实现
- Group 折叠态有独立验证规则
- `onConnect` 后自动推断边类型

**测试用例**（关键）：

- C-001 ~ C-014：覆盖矩阵中所有合法/非法组合（重点测试 Context Provider 只能连 LLM 的 left-context）
- **C-015: LLM→text 连线（五节点模板关键边）**  
  Given: LLM 节点有 `right-text` source Handle  
  When: 拖拽连线到 Text 节点的 `left-prompt` target Handle  
  Then: 边类型自动推断为 `prompt-flow`（蓝色实线），且符合五节点模板「AI大脑 → 输出」链路
- C-020：Group 折叠态尝试连入未暴露的 prompt 端口 → 拒绝 + 清晰提示
- C-030~C-034：边类型自动推断 5 条规则全部验证（包括 text → text 走 prompt-flow）

---

### 3.3 Context Provider 节点（选择器）

**验收标准**：
- Vault/Skill/Toolset 节点**永远没有** ▶ 按钮
- 连线仅标记引用关系

**测试用例**：
- CP-001：拖拽 VaultNode 到画布 → 右键菜单中无“执行”选项
- CP-002：VaultNode 连线到 LLM 后，LLM 底部正确显示“☑ 知识库名称”

---

### 3.4 TextNode（性能与编辑体验）

**硬约束测试**（必须全部通过）：

| ID | 约束 | 测试方式 | 预期 |
|----|------|----------|------|
| TN-001 | 同时最多一个全功能 Tiptap | 打开 3 个 TextNode 进入编辑态 | 只有最近一个保持完整 Tiptap，其他自动降级为 Markdown 预览 |
| TN-002 | 降级速度 | 从编辑态 blur | Tiptap 实例在 80ms 内销毁，切换为轻量预览无闪动 |
| TN-003 | 30 节点基准 | 30 个节点（含 5 个 TextNode 曾展开） | 连续拖拽 + 折叠/展开操作，主线程 Jank < 200ms（MacBook Air M1） |

---

### 3.5 LLM 节点（v5.1 上下文注入规则）

**核心哲学测试**（最高优先级）：

**LLM-001：三路同时注入 + 优先级**
- Given: 画布上有 VaultNode、SkillNode、ToolsetNode 分别连线到同一个 LLM，同时有上游 TextNode 通过 prompt-flow 连入
- When: 执行 LLM
- Then:
  1. 三个 context-inject 来源 + prompt-flow 同时到达 `ConversationContextEngine`
  2. 用户文本（prompt-flow）在最终 messages 中优先级最高（放在最后）
  3. Knowledge 召回结果只作为 user-side evidence，不出现在 system role
  4. Skill 通过 skillApplicability 判断后注入 system

**LLM-002：工具参与方式**
- Given: ToolsetNode 连线到 LLM
- When: LLM 执行
- Then: 工具定义被暴露，但 LLM 可根据 prompt 决定**不调用**任何工具（与 useChat.ts 行为一致）

**LLM-003：Tab 渐进披露**
- 默认只显示“摘要”行，其余 Tab 折叠

---

### 3.6 Group（最关键，防数据丢失）

**G-001：prompt-flow 端口聚合（防丢数据）**
- Given: Group 内有 3 个外部 TextNode 通过 prompt-flow 连入不同内容
- When: Group 折叠
- Then: 折叠后的 Group **必须同时暴露 3 个独立的 `left-prompt` 端口**（Prompt-1、Prompt-2、Prompt-3），内容不丢失

**G-002：Context 作用域隔离**
- Given: Group 内部有一个 VaultNode 连到内部 LLM
- When: Group 外部有另一个 LLM
- Then: 外部 LLM 不会自动获得 Group 内部的知识库召回（除非显式从 Group 边界连出 context 端口）

**G-003：独立执行**
- Given: 复杂画布，Group 内有多个节点
- When: 右键 Group → “仅执行此子图”
- Then: 只有 Group 内部节点进入执行状态，外部节点状态不变

---

### 3.7 执行引擎

**E-001：脏检查传递闭包**
- Given: TextNode A → LLM B → imageGen C
- When: 修改 TextNode A 内容
- Then: A、B、C 全部被标记为脏

**E-002：Context Provider 变化传播**
- Given: VaultNode 连线到 LLM
- When: 切换 VaultNode 选中的知识库页面
- Then: 对应 LLM 被标记为脏

**E-003：媒体输入签名缓存**
- Given: 相同 prompt + 相同参考图 + 相同模型参数的 videoGen 节点
- When: 第二次执行
- Then: 5 秒内命中缓存，显示“缓存命中”徽章，且不发起新请求

**E-004：异步状态机**
- 所有生成节点必须完整走 `idle → submitting → polling → success/cancelled/error`

---

### 3.8 视觉层级与动态反馈（性能安全）

**V-001：动态效果分级**
- 节点总数 ≤ 15 → 允许连线呼吸动画
- 节点总数 > 15 → 自动降级为仅高亮当前执行路径，不开复杂动画

**V-002：交互时冻结**
- 任何拖拽/缩放期间，所有动态视觉效果必须暂停

---

### 3.9 右键菜单与交互（新增）

**M-001 ~ M-008**：覆盖第十四章中定义的所有右键场景（画布空白、单节点、Handle、多选、Group 等）

**重点测试**：
- 多选节点 → “创建 Group” 能正确把选中节点打包
- Group 右键菜单包含“独立执行”和“导出为模板”

---

### 3.10 默认起始模板（v5.1 五节点）

**T-001：默认五节点模板**
- 新建画布必须默认生成 5 个节点：需求 → AI大脑 → 输出 → 生成 → 结果，并正确连线
- “输出”节点必须是 TextNode 类型

**T-002：手动审查关卡**
- LLM 输出必须先流入“输出”节点，用户必须手动点下游生成节点才能继续

---

### 3.11 底部输入栏与推荐功能（v5.1 新增）

**UI-001: 底部输入栏两段式确认（纯手动显式控制）**
- Given: 底部输入栏输入自然语言描述（如“生成一组产品图，正面+侧面+45度”）
- When: 点击「推荐节点链」
- Then:
  1. AI 仅返回建议（节点清单 + 推荐连线），**不创建任何节点**
  2. 用户必须显式点击「确认创建」后，节点才真正出现在画布上
  3. 默认**不自动执行**任何节点（符合 P1 纯手动原则）
- 额外验收：如果用户取消，画布状态完全不变

---

### 3.12 迁移策略

**Mig-001**：打开含废弃节点的旧画布 → 自动备份 + 弹出向导弹窗
**Mig-002**：选择“保留旧版” → 节点带黄色/红色警告角标，但**永远可以执行或查看**

**Mig-003: runninghub → videoGen 参数映射正确性**
- Given: 旧画布中 runninghub 节点数据 `{ webappId: "xxx", nodeInfoList: [...] }`
- When: 执行“一键智能升级”
- Then: 生成 videoGen 节点，且 `model` 字段正确映射为对应 Grok Video / Seedance 等模型名，参数尽量保留

**Mig-004: 批量升级不丢失连线**
- Given: 旧画布中存在 `text → runninghub → imageResult` 三节点链
- When: 对三个节点执行“一键升级”
- Then: 升级后链路完整保留为 `text → videoGen → imageResult`，连线数量和方向正确，无悬空边

---

### 3.12 画布与对话区隔离

**Iso-001**：
- 在画布 Context 栏切换 Skill / 知识库
- 对话区当前会话的 Skill / 知识库选择**不受任何影响**

---

## 4. 哲学合规专项测试套件

必须单独跑的测试集合（每次大版本必须全绿）：

- PH-001：任何自动编排功能默认关闭
- PH-002：Knowledge 永远不进入 system role
- PH-003：Tool 连线后 LLM 可选择不调用
- PH-004：用户文本永远是最高优先级信号
- PH-005：Group 内部操作不泄露上下文到外部（除非显式连线）

---

## 5. 性能基准（必须自动化）

| 场景 | 目标 | 测量工具 |
|------|------|----------|
| 30 节点画布（含 5 个 TextNode + 2 个 Group）连续拖拽 10 秒 | 主线程 Jank < 200ms | PerformanceObserver + 自定义脚本 |
| Group 折叠/展开（内部 12 个节点） | 视觉响应 < 120ms | RAF 测量 |
| 10 个 TextNode 同时从编辑态批量降级 | 无内存泄漏，Tiptap 实例全部销毁 | Chrome Memory 快照 |

---

## 6. 实施顺序建议（TDD 驱动）

1. Phase 0 先实现并通过：F-002（冻结策略）、F-003（Collapsed）、TN-003（30 节点基准）
2. 再实现连接矩阵 + 边类型推断（C 系列测试，**含新增 C-015 LLM→text**）
3. 实现 Group 端口聚合（G-001 必须最先通过，防止数据丢失）
4. LLM 三路注入 + 工具行为（LLM-001/002）
5. 底部输入栏两段式确认（UI-001） + 迁移数据正确性（Mig-003/004）
6. 脏检查传递闭包
7. 最后做视觉动态效果 + 右键菜单

---

## 7. 文档维护

- 每当 SDD 有重大变更，本 TDD 必须同步更新
- 实现代码 Merge Request 必须关联至少一个本 TDD 中的测试用例 ID
- 性能基准测试必须在 CI 中定期执行

---

**本 TDD 文档是 V8 画布实现的唯一权威测试来源。**

实现任何功能前，请先在本文档中找到或新增对应测试用例，并确保测试失败 → 再写实现代码。

需要我继续拆分出更细的 Jest / Vitest / Playwright 测试用例代码模板（带 Given/When/Then 注释），请随时说。
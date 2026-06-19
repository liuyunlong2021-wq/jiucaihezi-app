# 火宝画布移植 — 详细执行版（AI 协作者专用）

> 分支: `webhuabu` | 火宝源: `/Users/by3/Documents/huobao-canvas` @ `e750733`
> 原则: 逐组件搬运 → 立即验证 → 任何失败回退单个文件
> 步骤: 11 步，预计 ~10h

---

## 移植环境
```
我们的项目:  /Users/by3/Documents/jiucaihezi-app-main/  (branch: webhuabu)
火宝源码:    /Users/by3/Documents/huobao-canvas/          (main, e750733)
验证: 每步 vue-tsc -b && vite build
```

---

## 第 1 步: NodeHandleMenu（30min）
- 火宝: `src/components/nodes/NodeHandleMenu.vue`（186行）
- 我们: `src/components/canvas/v8/shared/NodeHandleMenu.vue`（新建）
- 功能: 节点右侧悬浮+按钮，hover显示，点击弹出操作菜单
- 操作: 复制文件→去NaiveUI→改CSS令牌→加TypeScript类型

### NaiveUI替换
`<n-icon :size="12"><XxxOutline /></n-icon>` → `<span class="mso">icon_name</span>`
图标: AddOutline→add, ImageOutline→image, VideocamOutline→movie, ChatbubbleOutline→chat

### Tailwind→令牌
bg-[var(--bg-secondary)]→var(--surface-alt), rounded-xl→12px, 等

---

## 第 2 步: TextNode → V8TextNode（45min）
- 火宝: `nodes/TextNode.vue`（860行）
- 我们: `v8/nodes/V8TextNode.vue`（替换）
- 功能: contenteditable文本编辑器+@提及+双击编辑标题+右键菜单
- 难点: @提及系统(contenteditable chip)，保留代码但禁用UI(P6+)

### 搬运细节
1. Script: 火宝的updateNode/removeNode/...→我们的canvasStore
2. Template: 保留火宝DOM结构, NaiveUI→原生, Tailwind→scoped CSS
3. Style: 全部Tailwind提取为scoped CSS, 用--jc-*令牌
4. 去掉: NDropdown, NInput, vicons导入

---

## 第 3 步: 三个边组件（30min）
- ImageRoleEdge: 覆盖 `edges/ImageRoleEdge.vue` - 标记首帧/尾帧
- PromptOrderEdge: 覆盖 `edges/PromptOrderEdge.vue` - 提示词顺序
- ImageOrderEdge: 新建 `edges/ImageOrderEdge.vue` - 参考图顺序
- 操作: 直接复制, 改scoped→lang=ts, Tailwind→令牌

---

## 第 4 步: LLMConfigNode → V8LlmNode（2h，最复杂）
- 火宝: `nodes/LLMConfigNode.vue`（1220行）
- 我们: `v8/nodes/V8LlmNode.vue`（完全重写）
- 功能: 模型选择+system prompt+执行+输出预览+拆分+@提及

### 四个层面的替换

**A. 模型选择器**
火宝: `modelStore.allChatModelOptions`(来自stores/pinia)
我们: `agentStore.textModels`(来自我们的agentStore)
```ts
// 火宝
const model = ref(props.data?.model || modelStore.selectedChatModel)
// 我们
const modelId = computed({
  get: () => d.value.modelId || agentStore.textModels.value[0]?.id,
  set: v => canvasStore.updateNodeData(props.id, { modelId: v })
})
```

**B. API调用**
火宝: `useChat({systemPrompt, model}).send(userMessage, true)`
我们: 保留Phase 2已实现的fetch+SSE流式（更完善）

**C. 上游输入聚合**
火宝: 遍历incomingEdges读sourceNode.data
我们: 保留Phase 2的edge.sourceHandle精确分流（更精确）

**D. 输出分发**
火宝: handleSplitToTextOnly/handleSplitToTextWithImage
我们: 保留Phase 3的createDownstream/splitToTextNodes

### NaiveUI具体替换
| 火宝 | 我们 |
|------|------|
| `<n-select v-model:value="model" :options="modelOptions" size="small" />` | `<select v-model="modelId"><option v-for="m in textModels"...>` |
| `<n-select v-model:value="outputFormat" :options="formatOptions" />` | 同上模式 |
| `<n-spin :size="14" />` | `<span class="v8-spinner">`+CSS动画 |
| `<n-icon :size="14"><ChatbubbleOutline /></n-icon>` | `<span class="mso">chat</span>` |
| `window.$message?.success('生成完成')` | 节点内error ref显示或用emit事件 |
| `window.$message?.warning('请先配置 API Key')` | 同上 |

### Tailwind→令牌（重点类）
```
bg-purple-500 hover:bg-purple-600  → background:#8b5cf6; &:hover{background:#7c3aed}
bg-gradient-to-r from-purple-500/10 → 用roleColor计算渐变
text-purple-500                     → color:#8b5cf6
bg-[var(--bg-tertiary)]             → background:var(--surface)
rounded-lg                          → border-radius:8px
disabled:opacity-50                 → &:disabled{opacity:.5}
```

---

## 第 5 步: ImageConfigNode → V8ImageGenNode（1h）
- 火宝: `nodes/ImageConfigNode.vue`（600行）
- 我们: `v8/nodes/V8ImageGenNode.vue`（重写）
- 关键替换: 火宝useImageGeneration() → 我们的generateImage()
- 模型列表: modelStore → agentStore.imageModels
- 参数面板: 火宝硬编码size→先照搬, Phase 4做动态生成
- Connected inputs badge: 火宝特色，保留（显示"提示词 ✓"、"参考图 ○"）

---

## 第 6 步: ImageNode → V8ImageResultNode（30min）
- 火宝: `nodes/ImageNode.vue`（980行）
- 我们: `v8/nodes/V8ImageResultNode.vue`（替换）
- 功能: 图片展示+右键菜单(图生图/图生视频/局部重绘)
- 操作: 直接复制, Tailwind→令牌, NaiveUI→原生

---

## 第 7 步: VideoConfigNode → V8VideoGenNode（1h）
- 火宝: `nodes/VideoConfigNode.vue`
- 关键: 保留ImageRoleEdge逻辑(首帧/尾帧角色切换)
- API: useVideoGeneration → generateVideo()

---

## 第 8 步: VideoNode → V8VideoResultNode（30min）
- 操作: 直接搬运, 改CSS

---

## 第 9 步: CanvasWorkspace集成（1h）
文件: `src/components/canvas/CanvasWorkspace.vue`
1. Import所有新节点+新边
2. 注册nodeTypes和edgeTypes
3. 保留我们的CanvasToolbar和CanvasNodeLibrary
4. 确认V8/T8节点共存

---

## 第 10 步: Store桥接+API替换（2h）

### canvasStore合入
| 火宝 | 我们 | 操作 |
|------|------|------|
| addNode(type,pos,data) | addNodeWithData(type,data,pos) | 已存在 |
| updateNode(id,data) | updateNodeData(id,patch) | 已存在 |
| removeNode(id) | 已有 | 已存在 |
| duplicateNode(id) | 检查 | 不存在则搬运 |
| addNodes(specs) | 检查 | 搬运批量创建 |
| startBatchOperation() | startBatch() | 已存在 |

### API层
火宝axios → 我们的gatewayFetch + media-generation.ts（已替换）

### modelStore
火宝stores/models.js → 我们的agentStore.textModels/imageModels/videoModels/audioModels

---

## 第 11 步: 保留节点共存（1h）
- V8SkillNode + V8ToolsetNode: 保留, 在CanvasWorkspace注册
- 31个T8旧节点: 保留
- CanvasNodeLibrary: 加入新节点入口

---

## 每步验证
```bash
npx vue-tsc -b   # 必须0错
npx vite build    # 必须通过
# 浏览器: pnpm dev → 画布 → 拖节点 → 测试功能
```

## 回滚
```bash
git stash         # 搬运前保存
# 失败 → git stash pop
# 成功 → git add <files> && git commit
```

## 完成标志
- [ ] vue-tsc 0错, vite build通过
- [ ] TextNode可编辑, LLMNode模型下拉有数据
- [ ] LLMNode执行能调通API, 流式输出
- [ ] ImageGenNode执行能生成图片
- [ ] SkillNode下拉有Skill, 连线LLM注入
- [ ] 所有移植节点UI和交互与火宝一致

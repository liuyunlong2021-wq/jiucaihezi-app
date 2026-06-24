# 画布 T8 全量迁入 — SDD

> 版本: V1 ｜ 日期: 2026-05-27 ｜ 原则: 先做加法，再做减法

---

## 一、总策略

将 T8-penguin-canvas 的 **所有 30+ 节点类型** 逐一迁入 jiucaihezi-app 画布系统，实现：
1. **类型对齐**：`src/types/canvas.ts` 补全所有 NodeType
2. **组件对齐**：为每个新节点类型创建 `.vue` 组件
3. **运行时对齐**：`canvasExecutor.ts` + `canvasMediaRuntime.ts` + 新 runtime 文件
4. **集成对齐**：`CanvasWorkspace.vue` + `canvasStore.ts` 全量注册

适配策略：
- 后端：复用现有 Gateway + `media-generation.ts`，不新增 proxy
- 复杂节点（Loop/TextSplit）：先做简化可用版，保留核心链路
- 纯 UI 节点（Idea/BP/Relay）：轻量组件，不做后端调用
- 隐藏节点：同时迁入但标记 `hidden: true`

---

## 二、完整节点迁移清单

### 2.1 核心生成节点（已有可复用后端）

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `image` | `imageGen`+`imageResult` | 已存在 | 已存在 | ✅ |
| `video` | `videoGen`+`videoResult` | 已存在 | 已存在 | ✅ |
| `audio` | `audioGen`+`audioResult` | 已存在 | 已存在 | ✅ |
| `llm` | `llm` | 已存在 | 已存在 | ✅ |
| `text` | `text` | 已存在 | 已存在 | ✅ |
| `runninghub` | `runninghub` | `CanvasRunningHubNode.vue` | `runCanvasRunningHubNode` | ✅ V1 已完成 |
| `seedance` | `seedance` | `CanvasSeedanceNode.vue` | 桥接 video 生成 | 🆕 本次实现 |
| `runninghub-wallet` | `runninghubWallet` | 复用 RunningHub 组件 | 同 runninghub | 🆕 |
| `rh-tools` | `rhTools` | `CanvasRhToolsNode.vue` | 同 runninghub | 🆕 |
| `rh-config` | `rhConfig` | `CanvasRhConfigNode.vue` | 纯配置节点 | 🆕 (hidden) |

### 2.2 素材输入/输出节点

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `upload` | `upload` | `CanvasUploadNode.vue` | 文件上传 → file store | 🆕 |
| `material-set` | `materialSet` | `CanvasMaterialSetNode.vue` | 集合管理 | 🆕 |
| `output` | `output` | `CanvasOutputNode.vue` | 预览+透传 | 🆕 |

### 2.3 流程控制节点

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `loop` | `loop` | `CanvasLoopNode.vue` | 串联循环 | 🆕 (简化版) |
| `pick-from-set` | `pickFromSet` | `CanvasPickFromSetNode.vue` | 索引选取 | 🆕 |
| `text-split` | `textSplit` | `CanvasTextSplitNode.vue` | 文本分段 | 🆕 |
| `frame-pair` | `framePair` | `CanvasFramePairNode.vue` | 视频抽首尾帧 | 🆕 |

### 2.4 图像处理节点

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `resize` | `resize` | `CanvasResizeNode.vue` | 本地/Gateway 尺寸调整 | 🆕 |
| `combine` | `combine` | `CanvasCombineNode.vue` | 图像合并 | 🆕 |
| `remove-bg` | `removeBg` | `CanvasRemoveBgNode.vue` | 抠图 | 🆕 (hidden) |
| `upscale` | `upscale` | `CanvasUpscaleNode.vue` | 放大 | 🆕 (hidden) |
| `grid-crop` | `gridCrop` | `CanvasGridCropNode.vue` | 宫格 | 🆕 |
| `image-compare` | `imageCompare` | `CanvasImageCompareNode.vue` | 双图对比 | 🆕 |
| `drawing-board` | `drawingBoard` | `CanvasDrawingBoardNode.vue` | 画板 | 🆕 (hidden) |
| `browser` | `browser` | `CanvasBrowserNode.vue` | 浏览器 | 🆕 (hidden) |
| `frame-extractor` | `frameExtractor` | `CanvasFrameExtractorNode.vue` | 抽帧 | 🆕 (hidden) |

### 2.5 特殊/工具箱节点

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `storyboard-grid` | `storyboardGrid` | 占位组件 | - | 🆕 (hidden) |
| `cinematic` | `cinematic` | `CanvasCinematicNode.vue` | 电影感组合器 | 🆕 |
| `video-motion` | `videoMotion` | `CanvasVideoMotionNode.vue` | 运镜组合器 | 🆕 |
| `multi-angle-visual` | `multiAngleVisual` | `CanvasMultiAngleVisualNode.vue` | 多角度可视化 | 🆕 |

### 2.6 辅助节点

| T8 type | 本地 type | 组件文件 | Runtime | 备注 |
|---------|----------|---------|---------|------|
| `idea` | `idea` | `CanvasIdeaNode.vue` | 灵感记录 | 🆕 |
| `bp` | `bp` | `CanvasBpNode.vue` | 蓝图 | 🆕 |
| `relay` | `relay` | `CanvasRelayNode.vue` | 中继透传 | 🆕 |
| `edit` | `edit` | `CanvasEditNode.vue` | 编辑 | 🆕 (hidden) |
| `video-output` | `videoOutput` | `CanvasVideoOutputNode.vue` | 视频输出 | 🆕 (hidden) |
| `groupBox` | `group` | 已存在 | - | ✅ |

### 2.7 已废弃/不迁移

| T8 type | 原因 |
|---------|------|
| `multi-angle-3d` | Hidden + 无后端 |
| `panorama-720` | Hidden + 无后端 |
| `penguin-portrait` | Hidden + 无后端 |
| `portrait-metadata` | Hidden + 无后端 |

---

## 三、文件变更清单

### 修改文件
1. `src/types/canvas.ts` — 新增 20+ 节点类型 + 数据接口
2. `src/components/canvas/CanvasWorkspace.vue` — 注册所有新节点组件
3. `src/components/canvas/runtime/canvasExecutor.ts` — 新增所有执行分支
4. `src/components/canvas/runtime/canvasMediaRuntime.ts` — 新增 seedance/framePair runtime

### 新增文件 (节点组件 ~29 个)
- `nodes/CanvasSeedanceNode.vue`
- `nodes/CanvasUploadNode.vue`
- `nodes/CanvasMaterialSetNode.vue`
- `nodes/CanvasOutputNode.vue`
- `nodes/CanvasLoopNode.vue`
- `nodes/CanvasPickFromSetNode.vue`
- `nodes/CanvasTextSplitNode.vue`
- `nodes/CanvasFramePairNode.vue`
- `nodes/CanvasCombineNode.vue`
- `nodes/CanvasResizeNode.vue`
- `nodes/CanvasRemoveBgNode.vue`
- `nodes/CanvasUpscaleNode.vue`
- `nodes/CanvasGridCropNode.vue`
- `nodes/CanvasImageCompareNode.vue`
- `nodes/CanvasDrawingBoardNode.vue`
- `nodes/CanvasBrowserNode.vue`
- `nodes/CanvasFrameExtractorNode.vue`
- `nodes/CanvasStoryboardGridNode.vue`
- `nodes/CanvasCinematicNode.vue`
- `nodes/CanvasVideoMotionNode.vue`
- `nodes/CanvasMultiAngleVisualNode.vue`
- `nodes/CanvasIdeaNode.vue`
- `nodes/CanvasBpNode.vue`
- `nodes/CanvasRelayNode.vue`
- `nodes/CanvasEditNode.vue`
- `nodes/CanvasVideoOutputNode.vue`
- `nodes/CanvasRhToolsNode.vue`
- `nodes/CanvasRhConfigNode.vue`
- `nodes/CanvasRunningHubWalletNode.vue`

---

## 四、实现优先级

### P0（本次全部实现）
- 所有类型定义
- 所有节点组件（含 hidden 标记的占位组件）
- canvasExecutor 全量执行分发
- CanvasWorkspace 全量注册

### P1（后续迭代）
- Loop 节点的子图克隆逻辑
- TextSplit 的分段输出节点生成
- FramePair 的浏览器端抽帧
- 图像处理节点的后端对接

---

## 五、审计检查清单

- [ ] 所有新节点类型在 `CanvasNodeType` 中声明
- [ ] 所有新节点数据接口在 `CanvasNodeData` union 中
- [ ] 所有节点组件在 `CanvasWorkspace.vue` 的 `nodeTypes` 中注册
- [ ] `canvasExecutor.ts` 可执行类型集合包含所有新可执行节点
- [ ] 无 TypeScript 编译错误
- [ ] 无循环依赖

# 画布媒体资产基础能力修复 SDD

**版本**: v1.0  
**日期**: 2026-06  
**作者**: Grok + 用户协作  
**状态**: 待评审  
**优先级**: P0（地基问题，阻塞后续复杂媒体工作流）

---

## 一、背景与问题

### 当前痛点（用小白话总结）

画布目前处理“图片、视频、音频”这些媒体文件的方式非常混乱：

- 有两个完全不同的玩法：
  - 通用上传节点（UploadNode）：必须联网、必须登录，文件必须上传到远程服务器。
  - 视频/音频结果节点（VideoResultNode / AudioResultNode）：可以直接使用你电脑本地的文件。
- 这两个系统互不认识，规则完全不一样。
- `MaterialSetNode`（素材集节点）目前是空壳子（“节点开发中”），完全不能用。
- 素材在节点之间拖拽流动的功能只在极少数节点生效，大部分媒体节点都不支持。
- 本地文件支持不统一，导致重启画布后、跨设备、或者要做复杂流程时经常出问题。

**最致命的影响**：
如果你未来想把 MoneyPrinterTurbo（大量依赖本地视频素材的短视频生成系统）的能力做成画布节点接入进来，目前这个地基会让接入工作变得极其痛苦、bug 多、用户体验差。

---

## 二、目标（Goals）

### 核心目标

1. **建立统一的 Canvas 媒体资产模型**  
   让“图片/视频/音频”在画布里有统一的类型、统一的处理方式，支持远程和本地两种来源，并且对上层节点透明。

2. **让本地文件支持成为一等公民**  
   桌面用户（Tauri 端）可以顺畅地使用本地大视频、大音频文件，不再被迫走远程。

3. **修复关键缺失节点**  
   让 `MaterialSetNode` 真正可用，成为媒体工作流里的重要拼图。

4. **提升素材流动体验**  
   让素材拖拽（Ctrl/Cmd + 拖）在更多媒体相关节点中可用，形成闭环。

5. **为后续 MoneyPrinterTurbo 集成铺路**  
   让未来把脚本生成、素材下载、视频合成等能力做成节点时，有干净的媒体资产抽象可以依赖。

### 非目标（Non-goals）

- 不做完整的离线媒体二进制存储（暂时继续使用 URL + convertFileSrc 方案）。
- 不重构整个远程媒体生成流程（保持现有 NewAPI Gateway）。
- 不要求所有老节点一次性全部改完（采用渐进式改造）。

---

## 三、设计原则

1. **本地优先，远程兼容**  
   优先让本地文件体验顺畅，远程作为补充。

2. **统一抽象，节点解耦**  
   引入 `CanvasMediaAsset` 类型，让节点只关心“我要图片/视频/音频”，而不关心它来自本地还是远程。

3. **渐进式改造**  
   先修最痛的点（MaterialSetNode + 统一本地支持 + 拖拽采用），再逐步收敛老代码。

4. **与现有 fileStore 体系协作**  
   复用 `useFileStore` + category（image/video/audio），不要重复造轮子。

5. **保持桌面端优势**  
   充分利用 Tauri 的 `convertFileSrc` + `sourcePath` 能力。

---

## 四、核心设计方案

### 4.1 引入统一媒体资产类型

新建文件：
`src/canvas/types/mediaAsset.ts`

```ts
export type MediaKind = 'image' | 'video' | 'audio';

export interface CanvasMediaAsset {
  id?: string;                    // fileStore 中的 fileId（可选）
  kind: MediaKind;
  url: string;                    // 最终可用于 <img>/<video>/<audio> 的地址
  sourcePath?: string;            // 本地原始路径（桌面端才有）
  name?: string;
  size?: number;
  mimeType?: string;
  origin: 'local' | 'remote' | 'generated';
}
```

所有需要处理媒体的节点，输入/输出优先使用 `CanvasMediaAsset` 或 `CanvasMediaAsset[]`。

### 4.2 统一本地文件处理能力

目标：
- `CanvasUploadNode` 也要支持本地文件（与 VideoResultNode 保持一致的体验）。
- 所有 Result 节点统一走同一套本地 + 远程处理逻辑。
- 提供辅助函数 `resolveMediaUrl(asset)`，节点里统一调用它来获取可显示的 URL。

### 4.3 修复并实现 MaterialSetNode

让它真正成为“媒体素材集合”节点：
- 支持添加多个媒体资产（本地或远程）。
- 支持拖入素材（接 useMaterialDropTarget）。
- 输出 `CanvasMediaAsset[]` 供下游节点使用。
- 提供基础的排序、删除、预览能力。

### 4.4 提升素材拖拽采用率

目标在第一阶段让以下节点支持素材拖拽：
- 所有 *Gen 节点（作为 target）
- 所有 *Result 节点（作为 source 和 target）
- MaterialSetNode、OutputNode 等关键节点

---

## 五、分阶段执行计划

### 阶段 1：基础统一模型 + MaterialSetNode（最高优先级，预计 4-6 人天）

**目标**：让“媒体资产”在画布里有统一的语言，MaterialSetNode 可用。

**具体任务**：
1. 新建 `src/canvas/types/mediaAsset.ts` + 辅助函数库。
2. 重构/增强 `CanvasUploadNode`，增加本地文件支持（对齐 VideoResultNode）。
3. 实现 `MaterialSetNode` 完整功能（UI + 数据 + 拖拽支持）。
4. 让主要 Result 节点（Image/Video/Audio）统一输出 `CanvasMediaAsset` 格式。
5. 编写基础的 `resolveMediaUrl` 工具函数。

**验收标准**：
- 用户可以在画布里混合使用本地和远程素材。
- MaterialSetNode 可以正常添加、展示、拖出素材。
- 重启画布后，本地素材路径仍然可用。

### 阶段 2：素材流动体验打通（预计 3-4 人天）

**目标**：让素材在节点间顺畅流动。

**具体任务**：
1. 大幅提升 `useMaterialDropTarget` 的采用率（至少覆盖 8-10 个关键媒体节点）。
2. 完善 `useUpstreamMaterials` 对 `CanvasMediaAsset` 的支持。
3. 在 OutputNode、MaterialSetNode 等节点中做好素材聚合与透传。
4. 增加拖拽时的视觉反馈和类型校验。

### 阶段 3：执行引擎与持久化加固（预计 3 人天）

**目标**：确保媒体资产在执行和持久化场景下可靠。

**具体任务**：
1. 在 `canvasMediaRuntime` 中统一处理本地与远程媒体资产。
2. 改进 canvasStore / persistence 对带 `sourcePath` 的节点的序列化。
3. 增加本地媒体资产的重启恢复能力测试。

### 阶段 4：清理与文档（可选）

- 逐步废弃老的分散字段（`videoUrl`、`imageUrls` 等在媒体上下文中的混乱使用）。
- 补充开发者文档和迁移指南。

---

## 六、风险与权衡

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 改造范围较大，影响现有流程 | 中 | 采用渐进式改造 + 充分测试 + 保留向后兼容字段 |
| 本地文件路径在不同机器上失效 | 中 | 明确文档说明（sourcePath 只在单机有效），提供“重新选择”入口 |
| 与远程媒体生成流程冲突 | 低 | 保持远程生成结果仍然走现有 fileStore.addMedia 流程 |
| 开发工作量被低估 | 中 | 先做阶段 1 MVP，验证价值后再决定是否继续 |

---

## 七、验收标准（整体）

- 用户可以在画布中顺畅混合使用本地视频 + 远程图片。
- MaterialSetNode 成为真正可用的节点。
- 素材拖拽在主要媒体节点间形成基本闭环。
- 重启应用后，包含本地媒体资产的画布可以正常恢复和执行。
- 为后续 MoneyPrinterTurbo 相关节点接入提供了清晰的媒体资产抽象。

---

## 八、下一步行动建议

1. **评审本 SDD**（确认范围、优先级、阶段划分）。
2. 确定阶段 1 的具体负责人和排期。
3. 先实现最小可验证的原型（MaterialSetNode + UploadNode 本地支持），快速验证方向。
4. 每完成一个阶段，更新本 SDD 的执行状态。

---

**附：相关代码位置参考（审计时发现）**

- `src/components/canvas/nodes/CanvasUploadNode.vue`
- `src/components/canvas/nodes/CanvasVideoResultNode.vue` / `CanvasAudioResultNode.vue`
- `src/composables/useFileStore.ts`（addMedia）
- `src/canvas/composables/useMaterialDragSource.ts` + `useMaterialDropTarget.ts`
- `src/components/canvas/nodes/CanvasMaterialSetNode.vue`（当前占位符）
- `src/components/canvas/runtime/canvasMediaRuntime.ts`

---

**本 SDD 目标**：把目前画布媒体处理这块最软、最乱的地基，变成能支撑后续复杂视频工作流（包括 MoneyPrinterTurbo 集成）的坚实基础。

评审通过后，我们可以立刻进入阶段 1 的具体任务拆解和编码。
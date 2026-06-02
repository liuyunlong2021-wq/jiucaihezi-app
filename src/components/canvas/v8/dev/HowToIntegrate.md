# 如何在现有画布中集成 V8 Phase 0 手感（开发参考）

## 最小侵入方式

1. 在 `CanvasWorkspace.vue` 顶部（开发模式）引入激活器：
```ts
if (import.meta.env.DEV) {
  import('@/components/canvas/v8/activate').then(m => m.activateV8Phase0())
}
```

2. 新节点使用 `NodeFrame` + `useV8NodeBehavior` 替代旧的 header + resize。

3. 旧节点可以逐步迁移。

## 当前推荐做法

- 使用 `DevV8Phase0Panel` 快速验证手感
- 所有新能力都在 `v8/` 目录下，与现有代码完全隔离
- 性能基准可直接在控制台调用 `runV8Phase0Benchmark()`

此文档仅供 Phase 0 开发参考，正式重构会在后续 Phase 进行。

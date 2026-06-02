# V8 Phase 0 使用指南（开发期）

## 安装样式
在开发时引入样式（临时）：
```ts
import '@/components/canvas/v8'   // 会自动加载 freeze + base 样式
```

## 推荐用法（Phase 0 收尾版）

```vue
<script setup>
import { NodeFrame, useV8NodeBehavior, globalFreezeManager } from '@/components/canvas/v8'

const { onResizeHandlePointerDown, resizingId } = useV8NodeBehavior(node, {
  onResizeEnd(id, width, height) {
    // 更新 store
  }
})

const isInteracting = globalFreezeManager.isFrozen
</script>

<template>
  <NodeFrame
    :id="node.id"
    :label="node.label"
    role="think"
    :collapsed="node.collapsed"
    executable
    @resize-start="onResizeHandlePointerDown"
  >
    <!-- 内容 -->
  </NodeFrame>
</template>
```

控制台调试：
```js
runV8Phase0Benchmark()   // 跑基准
resetV8Freeze()          // 手动清理冻结状态
```

## 关键特性已实现
- 拖拽/缩放时全局冻结（大幅提升复杂画布流畅度）
- 原生 RAF Resize（拖拽过程零响应式更新）
- Collapsed 状态下内容完全不渲染
- 统一角色色 + 底部执行条

## 验证方式
运行 `V8NodeDemoFull.vue` 可直观感受手感差异。

---

**注意**：此阶段所有代码仍在 `v8/` 目录下，与现有画布并存开发。

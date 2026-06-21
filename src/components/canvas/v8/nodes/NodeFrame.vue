<script setup lang="ts">
/**
 * NodeFrame.vue (V8)
 *
 * 统一轻量节点骨架
 * 目标：
 * - 所有 V8 节点统一使用
 * - 支持角色色左边条
 * - 支持 collapsed
 * - 底部统一执行控制条（▶ ■ ✕）
 * - 右下角缩放手柄
 *
 * 注意：此组件为 V8 全新实现，与当前 CanvasNodeHeader / ResizeHandle 并存开发
 */

import { computed } from 'vue'

export type NodeRole = 'input' | 'think' | 'context' | 'generate' | 'result' | 'orchestrate'

const props = defineProps<{
  id: string
  label: string
  icon?: string
  role: NodeRole
  status?: 'idle' | 'running' | 'success' | 'error' | 'stopped'
  collapsed?: boolean
  executable?: boolean
  showStop?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-collapse'): void
  (e: 'run'): void
  (e: 'stop'): void
  (e: 'delete'): void
  (e: 'resize-start', event: PointerEvent): void
}>()

const roleColor = computed(() => {
  const colors: Record<NodeRole, string> = {
    input: '#3b82f6',      // 蓝 - text
    think: '#8b5cf6',      // 紫 - llm
    context: '#a78bfa',    // 浅紫 - skill/toolset
    generate: '#10b981',   // 绿 - image/video/audio gen
    result: '#6b7280',     // 灰 - result nodes
    orchestrate: '#f59e0b' // 琥珀 - loop/textSplit/group
  }
  return colors[props.role]
})

const statusColor = computed(() => {
  const map: Record<string, string> = {
    running: '#f59e0b',
    success: '#10b981',
    error: '#ef4444',
    stopped: '#6b7280'
  }
  return props.status ? map[props.status] : '#9ca3af'
})
</script>

<template>
  <div
    class="v8-node-frame"
    :class="{ collapsed: collapsed }"
    :data-node-id="id"
    :data-role="role"
    :data-status="status"
  >
    <!-- 左边角色色条 -->
    <div class="v8-role-bar" :style="{ backgroundColor: roleColor }"></div>

    <!-- 头部 -->
    <div class="v8-header">
      <div class="v8-header-left">
        <JcIcon :name="icon" class="v8-icon" v-if="icon" />
        <span class="v8-label">{{ label }}</span>
        <div v-if="status" class="v8-status-dot" :style="{ backgroundColor: statusColor }"></div>
      </div>

      <div class="v8-header-actions">
        <button
          v-if="!collapsed"
          class="v8-action-btn"
          title="折叠"
          @click.stop="emit('toggle-collapse')"
        >
          <JcIcon name="unfold_less" />
        </button>
        <button
          v-else
          class="v8-action-btn"
          title="展开"
          @click.stop="emit('toggle-collapse')"
        >
          <JcIcon name="unfold_more" />
        </button>

        <button
          class="v8-action-btn danger"
          title="删除"
          @click.stop="emit('delete')"
        >
          <JcIcon name="delete" />
        </button>
      </div>
    </div>

    <!-- 内容区（slot） -->
    <div v-if="!collapsed" class="v8-content">
      <slot />
    </div>

    <!-- 底部执行条 -->
    <div v-if="!collapsed && (executable || showStop)" class="v8-footer">
      <div class="v8-footer-left">
        <slot name="footer-left" />
      </div>

      <div class="v8-footer-actions">
        <button
          v-if="executable"
          class="v8-btn-run"
          :disabled="status === 'running'"
          @click.stop="emit('run')"
        >
          <JcIcon :name="status === 'running' ? 'pause' : 'play_arrow'" />
          <span>{{ status === 'running' ? '运行中' : '执行' }}</span>
        </button>

        <button
          v-if="showStop && status === 'running'"
          class="v8-btn-stop"
          @click.stop="emit('stop')"
        >
          <JcIcon name="stop" />
        </button>
      </div>
    </div>

    <!-- 右下角缩放手柄 -->
    <div
      v-if="!collapsed"
      class="v8-resize-handle"
      title="拖拽缩放"
      @pointerdown.stop="$emit('resize-start', $event)"
    ></div>
  </div>
</template>

<style scoped>
.v8-node-frame {
  position: relative;
  min-width: 240px;
  min-height: 100px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--jc-shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow 0.1s ease;
}

.v8-node-frame:hover {
  box-shadow: var(--jc-shadow-md);
}

.v8-role-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
}

.v8-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 6px 12px;
  border-bottom: 1px solid var(--border2);
  font-size: 12px;
  font-weight: 700;
  user-select: none;
}

.v8-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.v8-icon {
  font-size: 15px;
  color: var(--olive-dark);
}

.v8-label {
  color: var(--ink1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.v8-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.v8-header-actions {
  display: flex;
  gap: 2px;
}

.v8-action-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--ink3);
  cursor: pointer;
  font-size: 14px;
}

.v8-action-btn:hover {
  background: var(--surface-alt);
  border-color: var(--border);
}

.v8-action-btn.danger:hover {
  color: var(--jc-error);
}

.v8-content {
  flex: 1;
  padding: 8px 10px;
  overflow: auto;
}

.v8-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-top: 1px solid var(--border2);
  background: var(--surface);
  font-size: 12px;
}

.v8-btn-run,
.v8-btn-stop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 11px;
  cursor: pointer;
}

.v8-btn-run {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.v8-btn-run:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
}

.v8-btn-stop {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.v8-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 0 48%, var(--ink3) 49% 56%, transparent 57%),
    linear-gradient(135deg, transparent 0 66%, var(--ink3) 67% 74%, transparent 75%);
  opacity: 0.5;
  border-radius: 2px;
}

.v8-resize-handle:hover {
  opacity: 0.85;
}

.v8-node-frame.collapsed {
  min-height: auto;
}

.v8-node-frame.collapsed .v8-content,
.v8-node-frame.collapsed .v8-footer {
  display: none;
}
</style>

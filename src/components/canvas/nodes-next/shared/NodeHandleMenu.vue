<template>
  <!-- Right handle with expandable menu | 右侧连接点带展开菜单 -->
  <div class="handle-menu-anchor">
    <!-- Vue Flow handle for edge connections | 可见且可拖拽的 Vue Flow 连接点 -->
    <Handle type="source" :position="Position.Right" id="right" :style="{ width: '12px', height: '12px' }" />

    <!-- Hover zone with + icon | 带 + 图标的悬浮区域 -->
    <div
      v-if="showHandleHoverZone"
      class="handle-hover-zone"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <JcIcon name="add" class="add-icon" />
      <transition name="menu-fade">
        <div
          v-if="showMenu"
          class="handle-menu"
          @mouseenter="handleMenuMouseEnter"
          @mouseleave="handleMenuMouseLeave"
          @mousedown.stop
        >
          <button
            v-for="item in menuItems"
            :key="item.type"
            @click.stop="handleCreate(item)"
            class="menu-item"
          >
            <JcIcon :name="item.icon" class="menu-item-icon" />
            <span class="menu-label">{{ item.label }}</span>
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

export interface NodeHandleOperation {
  type: string
  label: string
  icon: string // Material Symbols icon name, e.g. 'image', 'movie', 'chat'
}

const props = defineProps<{
  nodeId: string
  nodeType: string
  visible?: boolean
  dotColor?: string
  operations?: NodeHandleOperation[] | null
}>()

const emit = defineEmits<{
  select: [item: NodeHandleOperation]
}>()

const showMenu = ref(false)
let hideTimeout: ReturnType<typeof setTimeout> | null = null

const handleMouseEnter = () => {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  showMenu.value = true
}

const handleMouseLeave = () => {
  hideTimeout = setTimeout(() => {
    showMenu.value = false
  }, 150)
}

const handleMenuMouseEnter = () => {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  showMenu.value = true
}

const handleMenuMouseLeave = () => {
  hideTimeout = setTimeout(() => {
    showMenu.value = false
  }, 150)
}

const menuItems = computed(() => props.operations || [])

const showHandleHoverZone = computed(() => {
  return props.operations && props.operations.length > 0
})

const handleCreate = (item: NodeHandleOperation) => {
  emit('select', item)
  showMenu.value = false
}
</script>

<style scoped>
/* Anchor sits at the right edge center of the parent node | 锚点在父节点右边缘中心 */
.handle-menu-anchor {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translate(50%, -50%);
  z-index: 100;
}

/* Hover zone — shown when anchor is hovered | 悬浮区域 — 锚点 hover 时显示 */
.handle-hover-zone {
  position: absolute;
  left: 50%;
  top: -30px;
  transform: translate(-50%, -50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  opacity: 0;
  pointer-events: none;
  transition: all 0.2s ease;
}

/* Show hover zone when anchor is hovered */
.handle-menu-anchor:hover .handle-hover-zone {
  opacity: 1;
  pointer-events: auto;
}

.handle-hover-zone:hover {
  background: var(--olive);
  border-color: var(--olive);
  transform: translate(-50%, -50%) scale(1.1);
}

/* Add icon */
.add-icon {
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  color: var(--ink2);
  transition: color 0.2s ease;
}

.handle-hover-zone:hover .add-icon {
  color: #fff;
}

/* Menu floats to the right of the dot | 菜单浮在圆点右侧 */
.handle-menu {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--jc-shadow-sm);
  white-space: nowrap;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--ink2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--jc-font-body);
}

.menu-item:hover {
  background: var(--olive);
  color: #fff;
}

.menu-item:hover .menu-item-icon {
  color: #fff;
}

.menu-item-icon {
  font-size: 14px;
  color: var(--ink3);
  transition: color 0.15s ease;
}

.menu-label {
  line-height: 1;
}

/* Transition */
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(-4px);
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OpenCodeTodo } from '@/opencodeClient/interactive'

const props = defineProps<{
  todos: OpenCodeTodo[]
}>()

const collapsed = ref(true)
const doneCount = computed(() => props.todos.filter(todo => todo.status === 'completed').length)
const activeTodo = computed(() =>
  props.todos.find(todo => todo.status === 'in_progress')
  || props.todos.find(todo => todo.status === 'pending')
  || props.todos[props.todos.length - 1],
)

function iconFor(status: string): string {
  if (status === 'completed') return 'check_circle'
  if (status === 'in_progress') return 'radio_button_checked'
  if (status === 'cancelled') return 'cancel'
  return 'radio_button_unchecked'
}
</script>

<template>
  <div v-if="todos.length" class="todo-dock">
    <div class="todo-card">
      <button class="todo-head" type="button" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        <span class="todo-title">{{ doneCount }} / {{ todos.length }}</span>
        <span class="todo-preview">{{ collapsed ? (activeTodo?.content || '韭菜盒子任务') : '韭菜盒子任务' }}</span>
        <JcIcon :name="collapsed ? 'expand_less' : 'expand_more'" class="todo-chevron" />
      </button>
      <div v-if="!collapsed" class="todo-list">
        <div v-for="(todo, index) in todos" :key="todo.id || `${todo.content}-${index}`" class="todo-row" :class="`status-${todo.status}`">
          <JcIcon :name="iconFor(todo.status)" />
          <span class="todo-content">{{ todo.content }}</span>
          <span v-if="todo.priority" class="todo-priority">{{ todo.priority }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-dock {
  padding: 8px 12px 0;
}
.todo-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, var(--paper));
  overflow: hidden;
}
.todo-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
  padding: 8px 10px;
  text-align: left;
}
.todo-title {
  flex: 0 0 auto;
  color: var(--ink1);
  font-size: 13px;
  font-weight: 700;
}
.todo-preview {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.todo-chevron {
  flex: 0 0 auto;
  color: var(--ink3);
  font-size: 17px;
}
.todo-list {
  display: grid;
  gap: 5px;
  max-height: 190px;
  overflow: auto;
  border-top: 1px solid var(--line);
  padding: 8px 10px 10px;
}
.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.45;
}
.todo-row .mso {
  flex: 0 0 auto;
  color: var(--ink3);
  font-size: 16px;
}
.todo-row.status-in_progress .mso {
  color: var(--olive-dark);
}
.todo-row.status-completed {
  color: var(--ink3);
}
.todo-row.status-completed .todo-content {
  text-decoration: line-through;
}
.todo-content {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
.todo-priority {
  flex: 0 0 auto;
  color: var(--ink3);
  font-size: 10px;
  text-transform: uppercase;
}
</style>

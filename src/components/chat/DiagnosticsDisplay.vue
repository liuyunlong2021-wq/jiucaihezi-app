<script setup lang="ts">
/**
 * DiagnosticsDisplay.vue — LSP 诊断错误显示（对齐 OpenCode 官方 DiagnosticsDisplay）
 *
 * 官方源码: message-part.tsx:140-155
 * 功能：显示文件中 LSP 诊断错误（行号+消息），最多显示 3 条 error 级别
 */
export interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

defineProps<{
  diagnostics: Diagnostic[]
}>()
</script>

<template>
  <div v-if="diagnostics.length > 0" data-component="diagnostics">
    <div
      v-for="(d, i) in diagnostics"
      :key="i"
      data-slot="diagnostic"
    >
      <span data-slot="diagnostic-label">Error</span>
      <span data-slot="diagnostic-location">[{{ d.range.start.line + 1 }}:{{ d.range.start.character + 1 }}]</span>
      <span data-slot="diagnostic-message">{{ d.message }}</span>
    </div>
  </div>
</template>

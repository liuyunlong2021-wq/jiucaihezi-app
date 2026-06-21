<script setup lang="ts">
/**
 * SkillPreviewCard — SKILL.md 预览与编辑卡片
 * 
 * 在 SkillCreatorChat 中，当 LLM 输出 SKILL.md 时，自动捕获并渲染为此卡片。
 * 用户可编辑、查看测试结果、保存。
 */
import { ref, computed } from 'vue'
import { parseSkillMd } from '@/types/skill'

const props = defineProps<{
  skillMd: string       // 完整 SKILL.md 内容
  isGenerating?: boolean
  testSummary?: {
    withSkillPassRate?: number
    withoutSkillPassRate?: number
    deltaPassRate?: string
    totalTests?: number
    // 兼容旧字段
    avgScore?: number
    passCount?: number
    failCount?: number
    totalCount?: number
    avgTokens?: number
    avgDurationMs?: number
  } | null
}>()

const emit = defineEmits<{
  (e: 'save', skillMd: string): void
  (e: 'edit', skillMd: string): void
}>()

const isEditing = ref(false)
const editContent = ref('')

const parsed = computed(() => parseSkillMd(props.skillMd))

function startEdit() {
  editContent.value = props.skillMd
  isEditing.value = true
}

function confirmEdit() {
  isEditing.value = false
  emit('edit', editContent.value)
}

function scoreColor(score: number): string {
  if (score >= 8) return '#22c55e'
  if (score >= 6) return '#f59e0b'
  return '#ef4444'
}
</script>

<template>
  <div class="skill-preview-card">
    <!-- 头部：Skill名 + 操作 -->
    <div class="spc-header">
      <div class="spc-title">
        <JcIcon name="description" />
        <strong>{{ parsed.name || '未命名Skill' }}</strong>
        <span v-if="parsed.name" class="spc-badge">草稿</span>
      </div>
      <div class="spc-actions">
        <button class="spc-btn spc-btn-edit" @click="startEdit">
          <JcIcon name="edit" /> 编辑
        </button>
        <button class="spc-btn spc-btn-save" @click="$emit('save', skillMd)" :disabled="isGenerating">
          <JcIcon name="save" /> 保存Skill
        </button>
      </div>
    </div>

    <!-- 测试摘要 -->
    <div v-if="testSummary" class="spc-test-summary">
      <div class="spc-test-header">
        <JcIcon name="monitoring" />
        <strong>测试结果</strong>
      </div>
      <div class="spc-test-stats">
        <!-- 新版 summary -->
        <template v-if="testSummary.withSkillPassRate !== undefined">
          <div class="spc-stat">
            <span class="spc-stat-val" :style="{ color: scoreColor(testSummary.withSkillPassRate / 100 * 10) }">
              {{ testSummary.withSkillPassRate }}%
            </span>
            <span class="spc-stat-label">With Skill</span>
          </div>
          <div class="spc-stat">
            <span class="spc-stat-val" style="color: #999">
              {{ testSummary.withoutSkillPassRate }}%
            </span>
            <span class="spc-stat-label">Baseline</span>
          </div>
          <div class="spc-stat">
            <span class="spc-stat-val" :class="(testSummary.deltaPassRate || '').startsWith('+') ? 'green' : 'red'">
              {{ testSummary.deltaPassRate }}
            </span>
            <span class="spc-stat-label">Delta</span>
          </div>
        </template>
        <!-- 旧版 summary（兼容） -->
        <template v-else>
          <div class="spc-stat">
            <span class="spc-stat-val" :style="{ color: scoreColor(testSummary.avgScore || 0) }">
              {{ (testSummary.avgScore || 0).toFixed(1) }}
            </span>
            <span class="spc-stat-label">均分/10</span>
          </div>
          <div class="spc-stat">
            <span class="spc-stat-val green">{{ testSummary.passCount }}</span>
            <span class="spc-stat-label">通过</span>
          </div>
          <div class="spc-stat">
            <span class="spc-stat-val red">{{ testSummary.failCount }}</span>
            <span class="spc-stat-label">未通过</span>
          </div>
        </template>
      </div>
    </div>

    <!-- SKILL.md 内容 -->
    <div class="spc-body">
      <div v-if="isEditing" class="spc-editor">
        <textarea
          v-model="editContent"
          class="spc-textarea"
          rows="18"
          spellcheck="false"
        ></textarea>
        <div class="spc-editor-actions">
          <button class="spc-btn" @click="isEditing = false">取消</button>
          <button class="spc-btn spc-btn-save" @click="confirmEdit">确认修改</button>
        </div>
      </div>
      <pre v-else class="spc-preview">{{ skillMd }}</pre>
    </div>

    <!-- 描述摘要 -->
    <div v-if="parsed.description" class="spc-footer">
      <JcIcon name="info" />
      {{ parsed.description }}
    </div>
  </div>
</template>

<style scoped>
.skill-preview-card {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 10px;
  margin: 8px 0;
  overflow: hidden;
}
.spc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg, #f8f7f4);
  border-bottom: 1px solid var(--border, #e5e5e5);
}
.spc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.spc-badge {
  font-size: 10px;
  background: #fef3c7;
  color: #92400e;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}
.spc-actions {
  display: flex;
  gap: 6px;
}
.spc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  background: var(--surface, #fff);
  cursor: pointer;
  font-size: 12px;
  color: var(--ink, #333);
}
.spc-btn:hover { background: var(--bg, #f0f0f0); }
.spc-btn-save {
  background: var(--olive, #6B8E23);
  color: #fff;
  border-color: var(--olive, #6B8E23);
}
.spc-btn-save:hover { opacity: 0.9; }
.spc-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spc-test-summary {
  padding: 10px 14px;
  background: #f0fdf4;
  border-bottom: 1px solid #bbf7d0;
}
.spc-test-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 8px;
}
.spc-test-stats {
  display: flex;
  gap: 20px;
}
.spc-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.spc-stat-val {
  font-size: 20px;
  font-weight: 700;
}
.spc-stat-val.green { color: #22c55e; }
.spc-stat-val.red { color: #ef4444; }
.spc-stat-label {
  font-size: 10px;
  color: var(--ink2, #999);
}

.spc-body {
  max-height: 400px;
  overflow-y: auto;
}
.spc-preview {
  padding: 12px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
  color: var(--ink, #333);
}
.spc-editor {
  padding: 10px;
}
.spc-textarea {
  width: 100%;
  font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  padding: 10px;
  resize: vertical;
}
.spc-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.spc-footer {
  padding: 8px 14px;
  font-size: 11px;
  color: var(--ink2, #999);
  background: var(--bg, #f8f7f4);
  display: flex;
  align-items: center;
  gap: 4px;
}
.mso { font-family: 'Material Symbols Outlined'; font-size: 16px; vertical-align: middle; }
</style>

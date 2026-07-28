<script setup lang="ts">
/**
 * SkillPickerBar.vue — 输入框上方Skill控件栏
 *
 * 布局：[Skill选择器▼]  [Skill：自动/xxx]
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { OpenCodeSkillOption } from '@/opencodeClient/catalog'
import { searchSkills } from '@/utils/skillSearch'

const props = defineProps<{
  skills?: OpenCodeSkillOption[]
  selectedSkillName?: string
  autoDetectedName?: string
  loading?: boolean
  error?: string
  webMode?: boolean
  mentionActive?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{
  select: [name: string]
  refresh: []
}>()

const showPicker = ref(false)
const rootRef = ref<HTMLElement | null>(null)

watch(() => props.mentionActive, (active) => {
  if (active) showPicker.value = false
})
const searchText = ref('')

const mySkills = computed(() => {
  return searchSkills(searchText.value, props.skills || []) as OpenCodeSkillOption[]
})

const selectedSkill = computed(() =>
  (props.skills || []).find(skill => skill.name === props.selectedSkillName) || null
)
const compactLabel = computed(() => `Skill：${selectedSkill.value?.label || props.selectedSkillName || props.autoDetectedName || '自动'}`)

function selectSkill(name: string) {
  emit('select', name)
  showPicker.value = false
  searchText.value = ''
}

function clearSkill() {
  emit('select', '')
}

function closeOnOutside(event: PointerEvent) {
  if (showPicker.value && !rootRef.value?.contains(event.target as Node)) showPicker.value = false
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside))

</script>

<template>
  <div ref="rootRef" class="spb-root" :class="{ compact: props.compact }">
    <div class="spb">
      <button
        v-if="props.compact"
        type="button"
        class="spb-compact-trigger"
        :class="{ active: showPicker }"
        :aria-expanded="showPicker"
        aria-haspopup="listbox"
        @click="showPicker = !showPicker"
      >
        <span class="spb-current-name">{{ compactLabel }}</span>
        <span v-if="selectedSkillName" class="spb-clear" title="清除 Skill" @click.stop="clearSkill">×</span>
        <JcIcon :name="showPicker ? 'expand-more' : 'expand-less'" />
      </button>
      <template v-else>
        <button type="button" class="spb-picker" :class="{ active: showPicker }" @click="showPicker = !showPicker">
          <span>Skill</span>
        </button>
        <div class="spb-current" :class="{ off: !selectedSkillName && !props.autoDetectedName }" @click="showPicker = !showPicker">
          <span class="spb-current-name">{{ selectedSkill?.label || selectedSkillName || props.autoDetectedName || 'Skill：自动' }}</span>
          <span v-if="selectedSkillName" class="spb-clear" @click.stop="clearSkill">×</span>
        </div>
      </template>
    </div>

    <div v-if="showPicker" class="spb-panel" :class="{ 'spb-panel-up': props.compact }">
      <div class="spb-panel-head">
        <input v-model="searchText" class="spb-search" placeholder="搜索 Skill..." autofocus />
        <button class="spb-refresh" type="button" :disabled="loading" @click="emit('refresh')">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <div class="spb-list" role="listbox">
        <button
          class="spb-item"
          :class="{ selected: !selectedSkillName }"
          @click="selectSkill('')"
        >
          <div class="spb-item-name">自动选择</div>
          <div class="spb-item-desc">{{ props.compact ? '不加载额外 Skill' : (webMode ? 'Skill 轻量版 · 仅文本提示词生效。下载桌面 APP 解锁脚本执行等完整能力' : '韭菜盒子会根据 Skill 说明自动加载合适的 Skill') }}</div>
        </button>
        <button
          v-for="skill in mySkills" :key="skill.name"
          class="spb-item" :class="{ selected: selectedSkillName === skill.name }"
          :title="skill.location || skill.description || skill.name"
          @click="selectSkill(skill.name)"
        >
          <div class="spb-item-name">{{ skill.name }}</div>
          <div v-if="skill.description" class="spb-item-desc">{{ skill.description }}</div>
        </button>
        <div v-if="error" class="spb-empty spb-error">{{ error }}</div>
        <div v-if="mySkills.length === 0" class="spb-empty">
          {{ searchText ? '没有匹配的 Skill' : (props.compact ? '暂无已安装 Skill' : (webMode ? '暂无可选 Skill' : 'Central Skills 暂无可选 Skill，确认 SKILL.md 是否在官方扫描目录')) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spb {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}
.spb-root.compact { position: relative; min-width: 0; }
.spb-root.compact .spb { padding: 0; border-bottom: 0; }
.spb-compact-trigger {
  display: flex; height: 30px; max-width: min(240px, 42vw); align-items: center; gap: 5px;
  padding: 0 9px; border: 1px solid transparent; border-radius: 6px;
  background: var(--surface); color: var(--ink3); cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600;
}
.spb-compact-trigger:hover, .spb-compact-trigger.active { border-color: var(--olive); color: var(--olive); }
.spb-compact-trigger > :last-child { flex: 0 0 auto; font-size: 16px; }

.spb-picker {
  display: flex; align-items: center; gap: 3px;
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  transition: all .12s;
}
.spb-picker:hover, .spb-picker.active { border-color: var(--olive); color: var(--olive); }
.spb-arrow { font-size: 16px; }

.spb-current {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 6px;
  background: rgba(107,142,35,.1); color: var(--olive);
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.spb-current.off {
  background: var(--surface);
  color: var(--ink3);
}
.spb-current-name {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.spb-clear { font-size: 14px; color: var(--ink3); cursor: pointer; margin-left: 2px; }
.spb-clear:hover { color: #e53935; }

/* 展开面板 */
.spb-panel {
  padding: 8px 12px; border-bottom: 1px solid var(--line);
  background: var(--paper); animation: slide-down .15s ease;
}
.spb-panel-up {
  position: absolute; z-index: 40; right: 0; bottom: calc(100% + 8px);
  width: min(420px, calc(100vw - 48px)); box-sizing: border-box;
  border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 14%);
  animation-name: slide-up;
}
@keyframes slide-down { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:none } }
@keyframes slide-up { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
.spb-search {
  flex: 1; min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font-size: 12px; font-family: inherit;
  outline: none;
}
.spb-search:focus { border-color: var(--olive); }
.spb-panel-head { display: flex; gap: 6px; margin-bottom: 6px; }
.spb-refresh {
  padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); font-size: 11px; font-weight: 700;
  font-family: inherit; cursor: pointer;
}
.spb-refresh:hover { border-color: var(--olive); color: var(--olive); }
.spb-refresh:disabled { opacity: .55; cursor: default; }
.spb-list { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.spb-item {
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
}
.spb-item:hover { border-color: var(--olive); background: rgba(107,142,35,.04); }
.spb-item.selected { border-color: var(--olive); background: rgba(107,142,35,.1); }
.spb-item-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
.spb-item-desc { font-size: 10px; color: var(--ink3); margin-top: 2px; }
.spb-empty { text-align: center; padding: 16px; color: var(--ink3); font-size: 12px; }
.spb-error { color: #b3261e; }
@media (max-width: 768px) {
  .spb { flex-wrap: wrap; padding: 6px 10px; }
  .spb-current-name { max-width: 42vw; }
}
</style>

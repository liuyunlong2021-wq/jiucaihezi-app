<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLocale, type I18nKey } from '@/i18n'
import { isCloudLoggedIn, getCloudRequiredMessage } from '@/services/newApiAuth'
import { isTauriRuntime } from '@/utils/tauriEnv'
/**
 * ActivityRail — 左侧图标导航栏
 *
 * 功能：切换第5列（右侧面板）的内容
 */

const props = defineProps<{
  active: string
  isMember?: boolean
}>()

const emit = defineEmits<{
  (e: 'switch', mode: string): void
}>()

const { t: tr, languageLabel, toggleLocale } = useLocale()
const helpSeen = ref(localStorage.getItem('jc_help_seen') === 'true')
const isWebRuntime = computed(() => !isTauriRuntime())

function openHelp() {
  helpSeen.value = true
  localStorage.setItem('jc_help_seen', 'true')
  emit('switch', 'help')
}

function isLockedTab(mode: string) {
  return false  // All features now available when logged in
}

function switchTab(mode: string) {
  if (isLockedTab(mode)) {
    alert(getCloudRequiredMessage(mode))
    emit('switch', 'settings')
    return
  }
  emit('switch', mode)
}

// Rail 按钮 — 每个切换 Col 5 的内容
const webHiddenTabs = new Set(['files', 'review', 'ecommerce'])
const allTabs = [
  { key: 'ecommerce',      icon: 'storefront',             labelKey: 'rail.ecommerce' },
  { key: 'skills',         icon: 'paid',                   labelKey: 'rail.skillsManage' },
  { key: 'editor',         icon: 'edit_note',              labelKey: 'rail.editor' },
  { key: 'creation',       icon: 'photo_camera',           labelKey: 'rail.creation' },
  { key: 'review',         icon: 'rate_review',            labelKey: 'rail.review' },
  { key: 'files',          icon: 'folder_open',            labelKey: 'rail.files' },
]
const tabs = computed(() => allTabs.filter(tab => !isWebRuntime.value || !webHiddenTabs.has(tab.key)))

const bottomTabs = [
  { key: 'settings', icon: 'account_circle', labelKey: 'rail.userCenter' },
]
</script>

<template>
  <div class="ab">
    <!-- Logo -->
    <div class="ab-logo" :title="tr('rail.brand')">
      <img class="ab-logo-img" src="/logo.svg" alt="" />
    </div>

    <!-- Main tabs — 切换 Col 5 -->
    <div class="ab-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="ab-icon"
        :class="{ active: active === tab.key }"
        :title="isLockedTab(tab.key) ? `${tr(tab.labelKey as I18nKey)}：${tr('rail.memberOnly')}` : tr(tab.labelKey as I18nKey)"
        :disabled="isLockedTab(tab.key)"
        @click="switchTab(tab.key)"
      >
        <JcIcon :name="isLockedTab(tab.key) ? 'lock' : tab.icon" />
      </button>
    </div>

    <div class="ab-spacer" />

    <button class="ab-icon ab-help-btn" :class="{ pulse: !helpSeen }" :title="tr('rail.help')" @click="openHelp">
      <span class="ab-help-glyph">帮</span>
    </button>

    <button class="ab-icon ab-lang-btn" :title="tr('settings.language')" @click="toggleLocale">
      <span class="ab-lang-text">{{ languageLabel }}</span>
    </button>

    <!-- Bottom tabs -->
    <button
      v-for="tab in bottomTabs"
      :key="tab.key"
      class="ab-icon"
      :class="{ active: active === tab.key }"
      :title="tr(tab.labelKey as I18nKey)"
      @click="switchTab(tab.key)"
    >
      <JcIcon :name="tab.icon" />
    </button>
  </div>
</template>

<style scoped>
.ab {
  width: 52px;
  background: var(--surface-alt);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  flex-shrink: 0;
  z-index: 10;
}
.ab-logo {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  cursor: pointer;
}
.ab-logo-img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  display: block;
}
.ab-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ab-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--ink3);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 22px;
  border: none;
  background: none;
  text-decoration: none;
}
.ab-icon:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.ab-icon.active {
  background: rgba(213, 199, 135, 0.15);
  color: var(--olive-dark);
}
.ab-icon:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.ab-icon:disabled:hover {
  background: none;
  color: var(--ink3);
}
.ab-spacer { flex: 1; }
.ab-help-btn {
  position: relative;
  width: 36px;
  height: 36px;
  margin-bottom: 4px;
  border: 1.5px solid var(--olive);
  border-radius: 12px;
  background: rgba(213, 199, 135, 0.12);
}
.ab-help-btn:hover { background: var(--olive-pale); }
.ab-help-glyph {
  color: var(--olive-dark);
  font-size: 15px;
  font-weight: 900;
  line-height: 1;
}
.ab-help-btn.pulse::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 1px solid rgba(185, 171, 110, 0.65);
  border-radius: 15px;
  animation: help-pulse 1.35s ease-out 0s 4;
}
.ab-lang-btn {
  width: 36px;
  height: 30px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 82%, var(--olive-pale));
  font-size: 11px;
  font-weight: 900;
}
.ab-lang-text { color: var(--olive-dark); }
@keyframes help-pulse {
  0% { opacity: 0.9; transform: scale(0.92); }
  100% { opacity: 0; transform: scale(1.25); }
}

</style>

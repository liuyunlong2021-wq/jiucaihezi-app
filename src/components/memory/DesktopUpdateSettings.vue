<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { openExternal } from '@/utils/httpClient'
import { bindDesktopUpdater, desktopUpdateStatus as status, updaterAction, updateWaiting, waitForUpdateInstall } from '@/services/desktopUpdater'
const busy = computed(() => ['checking', 'downloading', 'preparing', 'installing'].includes(status.value.phase))
const progress = computed(() => status.value.total ? Math.min(100, Math.round(status.value.downloaded / status.value.total * 100)) : undefined)
const labels: Record<string, string> = { idle: '尚未检查更新', current: '已是最新版本', checking: '正在检查更新…', available: '发现新版本', downloading: '正在下载更新…', ready: '更新已下载并验证', preparing: '正在保存并准备升级…', installing: '正在安装更新…', error: '检查更新失败', unavailable: '更新服务暂不可用' }
onMounted(() => { void bindDesktopUpdater() })
</script>

<template>
  <section class="update-settings">
    <strong>应用更新</strong>
    <p>当前版本 {{ status.currentVersion || '读取中…' }}</p>
    <p>{{ labels[status.phase] || status.phase }}<span v-if="status.version"> · v{{ status.version }}</span></p>
    <p v-if="status.notes" class="notes">{{ status.notes }}</p>
    <template v-if="status.phase === 'downloading'">
      <progress :value="progress" max="100"></progress>
      <p>{{ (status.downloaded / 1024 / 1024).toFixed(1) }} MB<span v-if="status.total"> / {{ (status.total / 1024 / 1024).toFixed(1) }} MB</span></p>
    </template>
    <p v-if="status.error" role="alert">{{ status.error }}</p>
    <p v-if="status.message" role="status">{{ status.message }}</p>
    <p v-if="updateWaiting">等待任务完成后安装；可随时取消。</p>
    <div class="actions">
      <button :disabled="busy || updateWaiting || status.phase === 'unavailable'" @click="updaterAction('check')">检查更新</button>
      <button v-if="status.phase === 'available'" @click="updaterAction('download')">下载更新</button>
      <button v-if="status.phase === 'ready' && !updateWaiting" @click="updaterAction('install')">安装并重启</button>
      <button v-if="status.phase === 'ready' && !updateWaiting" @click="waitForUpdateInstall(true)">任务结束后安装</button>
      <button @click="openExternal('https://api.jiucaihezi.studio/download/')">手动下载安装包</button>
      <button v-if="updateWaiting" @click="waitForUpdateInstall(false)">取消等待</button>
    </div>
    <p>下载期间可以继续创作。安装前会检查所有工作窗口并保存内容。</p>
  </section>
</template>

<style scoped>
.update-settings { display: grid; gap: 12px; font-size: 13px; }
.update-settings p { margin: 0; color: var(--ink2); overflow-wrap: anywhere; }
.notes { white-space: pre-wrap; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink1); cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
progress { width: 100%; }
</style>

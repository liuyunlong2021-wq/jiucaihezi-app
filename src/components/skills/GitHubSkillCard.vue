<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { emitEvent } from '@/utils/eventBus'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { openExternal } from '@/utils/httpClient'

export interface ToolCommand {
  title: string
  desc: string
  template: string
}

export interface GitHubSkillEntry {
  id: string
  name: string
  description: string
  repo: string
  homepage: string
  stars?: number
  category: string
  tags: string[]
  installPrompt: string
  uninstallPrompt?: string
  note?: string
  commands?: ToolCommand[]
}

const props = defineProps<{
  skill: GitHubSkillEntry
}>()

const showCommands = ref(false)

// ── 安装状态检测（三段式回退：Rust命令 → plugin-fs → 静默失败）──
const isInstalled = ref(false)
const installPath = ref('')
const checkingInstall = ref(false)

async function checkInstalled() {
  if (!isTauriRuntime()) return
  checkingInstall.value = true
  try {
    // 方式1: Rust 命令（目录 + PATH 二进制两段式回退）
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string | null>('check_tool_installed', { toolId: props.skill.id })
      if (path) {
        isInstalled.value = true
        installPath.value = path
        return
      }
    } catch { /* 回退到 plugin-fs */ }

    // 方式2: plugin-fs 检查 ~/.jiucaihezi/tools/{id}/ 目录
    try {
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { homeDir } = await import('@tauri-apps/api/path')
      const home = await homeDir()
      const toolDir = `${home}.jiucaihezi/tools/${props.skill.id}`
      if (await exists(toolDir)) {
        isInstalled.value = true
        installPath.value = toolDir
        return
      }
    } catch { /* 静默失败 */ }
  } finally {
    checkingInstall.value = false
  }
}

onMounted(checkInstalled)

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return String(n)
}

function openGitHub() {
  openExternal(props.skill.homepage)
}

function install() {
  emitEvent('append-chat-input', props.skill.installPrompt)
}

function uninstall() {
  const prompt = props.skill.uninstallPrompt || `请帮我卸载 ${props.skill.name}。删除 ~/.jiucaihezi/tools/${props.skill.id}/ 目录即可。`
  emitEvent('append-chat-input', prompt)
}

function toggleCommands() {
  showCommands.value = !showCommands.value
}

function fillCommand(cmd: ToolCommand) {
  emitEvent('append-chat-input', cmd.template)
  showCommands.value = false
}

function closeCommands() {
  showCommands.value = false
}
</script>

<template>
  <div class="gh-card">
    <div class="gh-card-body">
      <div class="gh-card-head">
        <JcIcon name="magic_button" />
        <div class="gh-card-title">
          <span class="gh-name">{{ skill.name }}</span>
          <span v-if="skill.stars" class="gh-stars">⭐ {{ formatStars(skill.stars) }}</span>
        </div>
      </div>
      <p class="gh-desc">{{ skill.description }}</p>
      <div class="gh-meta">
        <span class="gh-repo">{{ skill.repo }}</span>
        <span v-if="skill.note" class="gh-note">{{ skill.note }}</span>
      </div>
      <div class="gh-tags">
        <span v-for="tag in skill.tags" :key="tag" class="gh-tag">{{ tag }}</span>
      </div>
    </div>
    <!-- 已安装：显示状态 + 路径 -->
    <div v-if="isInstalled" class="gh-installed-bar">
      <JcIcon name="check-circle" class="gh-installed-icon" />
      <span class="gh-installed-text">已安装</span>
      <span class="gh-installed-path" :title="installPath">{{ installPath }}</span>
    </div>

    <div class="gh-card-actions">
      <button v-if="checkingInstall" class="gh-btn" type="button" disabled>
        <JcIcon name="sync" />
        检测中…
      </button>
      <button v-else-if="!isInstalled" class="gh-btn gh-btn-install" type="button" @click="install">
        <JcIcon name="download" />
        安装
      </button>
      <button v-if="isInstalled && skill.uninstallPrompt !== undefined" class="gh-btn" type="button" @click="uninstall">
        <JcIcon name="delete" />
        卸载
      </button>
      <button v-if="skill.commands && skill.commands.length > 0" class="gh-btn gh-btn-cmd" type="button" title="查看指令" @click="toggleCommands">
        <JcIcon name="psychology" />
        指令
      </button>
      <button class="gh-btn gh-btn-gh" type="button" title="在 GitHub 打开" @click="openGitHub">
        <JcIcon name="open_in_new" />
      </button>
    </div>

    <!-- 指令弹窗 -->
    <div v-if="showCommands && skill.commands && skill.commands.length > 0" class="gh-cmd-overlay" @click.self="closeCommands">
      <div class="gh-cmd-panel">
        <div class="gh-cmd-head">
          <span>{{ skill.name }} 指令</span>
          <button class="gh-cmd-close" @click="closeCommands">
            <JcIcon name="close" />
          </button>
        </div>
        <div class="gh-cmd-grid">
          <button
            v-for="cmd in skill.commands"
            :key="cmd.title"
            type="button"
            class="gh-cmd-card"
            @click="fillCommand(cmd)"
          >
            <strong>{{ cmd.title }}</strong>
            <small>{{ cmd.desc }}</small>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gh-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--paper);
  transition: border-color .15s;
}
.gh-card:hover {
  border-color: var(--olive);
}
.gh-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gh-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.gh-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.gh-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.gh-stars {
  font-size: 11px;
  color: var(--olive-dark);
  background: var(--olive-pale);
  padding: 1px 6px;
  border-radius: 10px;
}
.gh-desc {
  font-size: 12px;
  color: var(--ink2);
  line-height: 1.5;
  margin: 0;
}
.gh-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
}
.gh-repo {
  color: var(--ink3);
  font-family: monospace;
}
.gh-note {
  color: var(--ink3);
  font-style: italic;
}
.gh-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.gh-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink3);
}
.gh-card-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.gh-btn {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all .15s;
}
.gh-btn:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
}
.gh-btn-install {
  background: var(--olive-pale);
  border-color: var(--olive);
  color: var(--olive-dark);
}
.gh-btn-install:hover {
  background: var(--olive);
  color: #fff;
}
.gh-btn-gh {
  width: 28px;
  padding: 0;
  justify-content: center;
}
.gh-btn-cmd {
  background: var(--surface);
  border-color: var(--olive);
  color: var(--olive-dark);
}
.gh-btn-cmd:hover {
  background: var(--olive-pale);
}

/* 已安装状态条 */
.gh-installed-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0 2px;
  font-size: 11px;
}
.gh-installed-icon {
  color: #2e7d32;
  font-size: 16px;
  flex-shrink: 0;
}
.gh-installed-text {
  color: #2e7d32;
  font-weight: 700;
  white-space: nowrap;
}
.gh-installed-path {
  color: var(--ink3);
  font-family: monospace;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* 指令弹窗 */
.gh-cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0,0,0,.25);
  display: flex;
  align-items: center;
  justify-content: center;
}
.gh-cmd-panel {
  width: min(480px, 90vw);
  max-height: 70vh;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.gh-cmd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink1);
}
.gh-cmd-close {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  color: var(--ink3); cursor: pointer;
  border-radius: 6px;
}
.gh-cmd-close:hover { background: var(--bg); color: var(--ink1); }
.gh-cmd-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 10px 14px;
  overflow-y: auto;
}
.gh-cmd-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all .12s;
}
.gh-cmd-card:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
}
.gh-cmd-card strong {
  font-size: 12px;
  color: var(--ink1);
}
.gh-cmd-card small {
  font-size: 11px;
  color: var(--ink3);
  line-height: 1.4;
}
</style>

<script setup lang="ts">
import { emitEvent } from '@/utils/eventBus'

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
  note?: string
}

const props = defineProps<{
  skill: GitHubSkillEntry
}>()

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return String(n)
}

function openGitHub() {
  window.open(props.skill.homepage, '_blank')
}

function install() {
  emitEvent('append-chat-input', props.skill.installPrompt)
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
    <div class="gh-card-actions">
      <button class="gh-btn gh-btn-install" type="button" @click="install">
        <JcIcon name="download" />
        安装
      </button>
      <button class="gh-btn gh-btn-gh" type="button" title="在 GitHub 打开" @click="openGitHub">
        <JcIcon name="open_in_new" />
      </button>
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
</style>

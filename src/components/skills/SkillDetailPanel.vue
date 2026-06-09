<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import SkillAiSummaryPanel from '@/components/skills/SkillAiSummaryPanel.vue'
import SkillFileTreePanel from '@/components/skills/SkillFileTreePanel.vue'
import SkillMarkdownPreview from '@/components/skills/shared/SkillMarkdownPreview.vue'
import SkillAliasEditor from '@/components/skills/shared/SkillAliasEditor.vue'
import PlatformBadge from '@/components/skills/shared/PlatformBadge.vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'

const emit = defineEmits<{
  (e: 'back'): void
}>()

const store = useSkillsManageStore()
const { agents, isLoadingDetail, selectedSkillContent, selectedSkillDetail } = storeToRefs(store)
const activeDetailTab = ref<'preview' | 'raw' | 'files' | 'ai'>('preview')

const detailTabs = [
  { key: 'preview', label: '说明', icon: 'article' },
  { key: 'raw', label: 'SKILL.md', icon: 'code' },
  { key: 'files', label: '文件', icon: 'folder_open' },
  { key: 'ai', label: 'AI Summary', icon: 'auto_awesome' },
] as const

const installedAgentIds = computed(() =>
  new Set(selectedSkillDetail.value?.installations.map((item) => item.agent_id) || [])
)

const displayAlias = computed(() =>
  selectedSkillDetail.value ? store.getSkillDisplayAlias(selectedSkillDetail.value.id)?.alias || '' : ''
)

const displayName = computed(() =>
  selectedSkillDetail.value ? store.getSkillDisplayName(selectedSkillDetail.value) : 'Skill 详情'
)

const frontmatterEntries = computed(() => {
  const match = selectedSkillContent.value.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return []
  return match[1]
    .split('\n')
    .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .slice(0, 8)
    .map((match) => ({ key: match[1], value: match[2] || '空' }))
})

watch(() => selectedSkillDetail.value?.id, () => {
  activeDetailTab.value = 'preview'
})
</script>

<template>
  <section class="detail">
    <header class="detail-head">
      <button class="back" @click="emit('back')"><span class="mso">arrow_back</span></button>
      <div>
        <h3>{{ displayName }}</h3>
        <div v-if="displayAlias && selectedSkillDetail" class="detail-official-name">Skill: {{ selectedSkillDetail.name }}</div>
        <p>{{ selectedSkillDetail?.canonical_path || selectedSkillDetail?.file_path }}</p>
      </div>
    </header>

    <div v-if="isLoadingDetail" class="state"><span class="mso spin">progress_activity</span> 读取 SKILL.md...</div>
    <div v-else-if="!selectedSkillDetail" class="state">请选择一个 Skill</div>

    <div v-else class="detail-body">
      <main class="content-pane">
        <nav class="detail-tabs" aria-label="Skill 详情">
          <button
            v-for="tab in detailTabs"
            :key="tab.key"
            type="button"
            :class="{ active: activeDetailTab === tab.key }"
            @click="activeDetailTab = tab.key"
          >
            <span class="mso">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </nav>

        <div class="tab-content">
          <SkillMarkdownPreview v-if="activeDetailTab === 'preview'" :content="selectedSkillContent" />
          <pre v-else-if="activeDetailTab === 'raw'" class="raw-skill">{{ selectedSkillContent || '暂无 SKILL.md 内容' }}</pre>
          <SkillFileTreePanel v-else-if="activeDetailTab === 'files'" />
          <SkillAiSummaryPanel v-else />
        </div>
      </main>
      <aside class="meta-pane">
        <section>
          <SkillAliasEditor :skill="selectedSkillDetail" />
        </section>
        <section v-if="frontmatterEntries.length">
          <h4>frontmatter</h4>
          <dl>
            <template v-for="entry in frontmatterEntries" :key="entry.key">
              <dt>{{ entry.key }}</dt>
              <dd>{{ entry.value }}</dd>
            </template>
          </dl>
        </section>
        <section>
          <h4>元数据</h4>
          <dl>
            <dt>ID</dt><dd>{{ selectedSkillDetail.id }}</dd>
            <dt>来源</dt><dd>{{ selectedSkillDetail.source || 'central' }}</dd>
            <dt>扫描时间</dt><dd>{{ selectedSkillDetail.scanned_at }}</dd>
            <dt>文件</dt><dd>{{ selectedSkillDetail.file_path }}</dd>
          </dl>
        </section>
        <section>
          <h4>安装状态</h4>
          <div class="badge-list">
            <PlatformBadge
              v-for="agent in agents"
              :key="agent.id"
              :agent="{ ...agent, is_detected: installedAgentIds.has(agent.id) }"
            />
          </div>
        </section>
        <section v-if="selectedSkillDetail.collections?.length">
          <h4>Collections</h4>
          <div class="chips">
            <span v-for="collection in selectedSkillDetail.collections" :key="collection.id">{{ collection.name }}</span>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.detail { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--surface); }
.detail-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border); }
.back { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
h3 { margin: 0; font-size: 16px; }
.detail-official-name { margin-top: 3px; color: var(--ink3); font-size: 11px; font-weight: 800; overflow-wrap: anywhere; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; overflow-wrap: anywhere; }
.detail-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 10px; padding: 10px; }
.content-pane, .meta-pane { min-height: 0; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.content-pane { display: flex; flex-direction: column; }
.detail-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--paper) 92%, var(--olive-pale));
}
.detail-tabs button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.detail-tabs button.active {
  border-color: var(--border);
  background: var(--paper);
  color: var(--olive-dark);
}
.tab-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.raw-skill {
  min-height: 100%;
  margin: 0;
  color: var(--ink1);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.meta-pane { padding: 10px; display: flex; flex-direction: column; gap: 12px; }
h4 { margin: 0 0 8px; font-size: 12px; color: var(--olive-dark); }
dl { margin: 0; display: grid; gap: 6px; }
dt { color: var(--ink3); font-size: 11px; }
dd { margin: 0; color: var(--ink1); font-size: 12px; overflow-wrap: anywhere; }
.badge-list, .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips span { padding: 4px 7px; border-radius: 999px; background: var(--olive-pale); color: var(--olive-dark); font-size: 11px; font-weight: 850; }
.state { flex: 1; display: grid; place-items: center; color: var(--ink3); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

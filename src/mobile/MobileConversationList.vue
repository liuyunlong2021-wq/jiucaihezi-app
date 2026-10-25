<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  MobileRemoteContext,
  MobileRemoteProject,
  MobileRemoteSessionSummary,
} from '@/services/mobileRemoteClient'

// M2 对话列表：先列项目，再列这个项目里的对话；选中后手机停在那个对话上。
const props = defineProps<{
  following: boolean
  currentSessionId: string
  listProjects: () => Promise<MobileRemoteProject[]>
  listSessions: (projectId: string) => Promise<MobileRemoteSessionSummary[]>
}>()

const emit = defineEmits<{
  open: [context: MobileRemoteContext]
  create: [projectId: string]
  follow: []
  close: []
}>()

const projects = ref<MobileRemoteProject[]>([])
const sessions = ref<Record<string, MobileRemoteSessionSummary[]>>({})
const loading = ref(true)
const failure = ref('')

async function load() {
  loading.value = true
  failure.value = ''
  try {
    projects.value = await props.listProjects()
    const lists = await Promise.all(projects.value.map(project => props.listSessions(project.projectId)))
    sessions.value = Object.fromEntries(projects.value.map((project, index) => [project.projectId, lists[index]!]))
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

function open(project: MobileRemoteProject, session: MobileRemoteSessionSummary) {
  emit('open', { projectName: project.name, conversationTitle: session.title, conversationId: '', sessionId: session.sessionId })
}

onMounted(() => { void load() })
</script>

<template>
  <section class="list">
    <header>
      <strong>选择对话</strong>
      <button type="button" title="返回" aria-label="返回" @click="$emit('close')">
        <JcIcon name="close" />
      </button>
    </header>

    <div class="body">
      <button type="button" class="follow" :class="{ active: following }" @click="$emit('follow')">
        <JcIcon name="computer" />
        <span>跟随电脑当前对话</span>
      </button>

      <p v-if="loading" class="hint">正在读取电脑上的对话…</p>
      <p v-else-if="failure" class="hint error">{{ failure }}</p>
      <p v-else-if="!projects.length" class="hint">请先在电脑上打开项目里的任一对话。</p>

      <div v-for="project in projects" :key="project.projectId" class="project">
        <div class="project-head">
          <span>{{ project.name }}</span>
          <button type="button" @click="$emit('create', project.projectId)">
            <JcIcon name="add" />
            <span>新建对话</span>
          </button>
        </div>
        <button
          v-for="session in sessions[project.projectId] || []"
          :key="session.sessionId"
          type="button"
          class="session"
          :class="{ active: !following && session.sessionId === currentSessionId }"
          @click="open(project, session)"
        >
          <span class="title">{{ session.title || '未命名对话' }}</span>
          <small v-if="session.running" class="running">电脑正在运行</small>
          <small v-else-if="session.current">电脑上正在看</small>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.list { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; color: var(--ink1); }
.list > header { display: flex; align-items: center; justify-content: space-between; padding: calc(env(safe-area-inset-top) + 10px) 14px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.list > header button { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink2); cursor: pointer; }
.body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.follow, .session { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.follow.active, .session.active { border-color: var(--olive); background: color-mix(in srgb, var(--olive) 12%, var(--surface)); }
.project { display: flex; flex-direction: column; gap: 6px; }
.project-head { display: flex; align-items: center; justify-content: space-between; color: var(--ink3); font-size: 12px; }
.project-head button { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink2); font: inherit; font-size: 12px; cursor: pointer; }
.session .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session small { color: var(--ink3); font-size: 11px; }
.session small.running { color: var(--olive); }
.hint { margin: 0; color: var(--ink3); font-size: 13px; text-align: center; }
.hint.error { color: var(--danger, #c0392b); }
</style>

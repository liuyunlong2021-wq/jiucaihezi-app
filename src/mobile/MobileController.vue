<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MobileConversationList from './MobileConversationList.vue'
import MobilePairingView from './MobilePairingView.vue'
import MobileSessionView from './MobileSessionView.vue'
import { useMobileRemote } from './useMobileRemote'

// 控制器入口：没连上时是设备页，连上后是聊天页，聊天页可切到对话列表（M2）。
const {
  view, status, error, busy,
  refreshStatus, pairByScan, pairByText, reconnect, disconnect, send, stop, respondApproval,
  listProjects, listSessions, openSession, createSession, followDesktop, setMode,
} = useMobileRemote()

const browsing = ref(false)
const pick = async (action: () => Promise<unknown>) => {
  browsing.value = false
  await action()
}

const connected = computed(() => view.value.state === 'connected' && Boolean(view.value.context))

onMounted(() => { void refreshStatus() })
</script>

<template>
  <MobileConversationList
    v-if="connected && browsing"
    :following="view.following"
    :current-session-id="view.context?.sessionId || ''"
    :list-projects="listProjects"
    :list-sessions="listSessions"
    @open="context => pick(() => openSession(context))"
    @create="projectId => pick(() => createSession(projectId))"
    @follow="pick(followDesktop)"
    @close="browsing = false"
  />
  <MobileSessionView
    v-else-if="connected"
    :view="view"
    :busy="busy"
    @send="send"
    @stop="stop"
    @approve="respondApproval"
    @disconnect="disconnect"
    @browse="browsing = true"
    @mode="setMode"
  />
  <MobilePairingView
    v-else
    :status="status"
    :waiting-for-conversation="view.state === 'connecting' && Boolean(status?.connected)"
    :busy="busy"
    :error="error"
    @scan="pairByScan"
    @pair="pairByText"
    @connect="reconnect"
    @disconnect="disconnect"
  />
</template>

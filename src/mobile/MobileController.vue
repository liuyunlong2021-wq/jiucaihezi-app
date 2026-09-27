<script setup lang="ts">
import { computed, onMounted } from 'vue'
import MobilePairingView from './MobilePairingView.vue'
import MobileSessionView from './MobileSessionView.vue'
import { useMobileRemote } from './useMobileRemote'

// P2 控制器入口：没连上时是设备页，连上后是单会话聊天页。
const {
  view, status, error, busy,
  refreshStatus, pairByScan, reconnect, disconnect, send, stop, respondApproval,
} = useMobileRemote()

const connected = computed(() => view.value.state === 'connected' && Boolean(view.value.context))

onMounted(() => { void refreshStatus() })
</script>

<template>
  <MobileSessionView
    v-if="connected"
    :view="view"
    :busy="busy"
    @send="send"
    @stop="stop"
    @approve="respondApproval"
    @disconnect="disconnect"
  />
  <MobilePairingView
    v-else
    :status="status"
    :busy="busy"
    :error="error"
    @scan="pairByScan"
    @connect="reconnect"
    @disconnect="disconnect"
  />
</template>

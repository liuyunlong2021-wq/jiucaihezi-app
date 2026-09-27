<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildQrCodeSvgDataUrl } from '@/utils/qrCode'
import {
  approveRemotePairing,
  createRemotePairingOffer,
  listenRemotePairingRequests,
  rejectRemotePairing,
  remoteBridgeStatus,
  revokeRemoteDevice,
  startRemoteBridge,
  stopRemoteBridge,
  type RemoteBridgeStatus,
  type RemotePairingOffer,
  type RemotePairingRequest,
} from '@/services/desktopRemoteBridge'

const status = ref<RemoteBridgeStatus | null>(null)
const offer = ref<RemotePairingOffer | null>(null)
const pending = ref<RemotePairingRequest | null>(null)
const busy = ref(false)
const error = ref('')
const copied = ref(false)
const payload = computed(() => offer.value ? JSON.stringify(offer.value) : '')
const qr = computed(() => payload.value ? buildQrCodeSvgDataUrl(payload.value) : '')
let unlisten: (() => void) | undefined

onMounted(async () => {
  status.value = await remoteBridgeStatus().catch(() => null)
  unlisten = await listenRemotePairingRequests(request => { pending.value = request })
})
onBeforeUnmount(() => unlisten?.())

async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action(); status.value = await remoteBridgeStatus() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

function start() { return run(async () => { status.value = await startRemoteBridge() }) }
function stop() { return run(async () => { status.value = await stopRemoteBridge(); offer.value = null; pending.value = null }) }
function pair() { return run(async () => { offer.value = await createRemotePairingOffer(); copied.value = false }) }

/** 扫码在这台手机上不触发识别（插件 iOS 上游问题），粘贴通道用同一份 offer 把链路走通。 */
async function copyPayload() {
  try {
    await navigator.clipboard.writeText(payload.value)
    copied.value = true
  } catch {
    error.value = '复制失败，请手动选中下面的配对信息复制'
  }
}
function approve() { if (pending.value) void run(async () => { await approveRemotePairing(pending.value!.offerId); pending.value = null; offer.value = null }) }
function reject() { if (pending.value) void run(async () => { await rejectRemotePairing(pending.value!.offerId); pending.value = null }) }
function revoke(deviceId: string) { return run(async () => { await revokeRemoteDevice(deviceId) }) }
</script>

<template>
  <div class="remote-settings">
    <section>
      <div class="remote-head">
        <div><strong>手机控制器</strong><span>{{ status?.listening ? '局域网 Bridge 已开启' : '默认关闭' }}</span></div>
        <button v-if="status?.listening" :disabled="busy" @click="stop">关闭</button>
        <button v-else :disabled="busy" @click="start">开启</button>
      </div>
      <p>只允许经本机确认的设备控制当前对话。关闭时不监听任何局域网端口。</p>
      <p v-if="status?.address">{{ status.address }}</p>
      <button v-if="status?.listening && !offer" :disabled="busy" @click="pair">生成一次性二维码</button>
      <div v-if="offer" class="remote-qr">
        <img :src="qr" alt="连接手机二维码" />
        <span>5 分钟内有效，只能使用一次</span>
        <button :disabled="busy" @click="copyPayload">{{ copied ? '已复制到剪贴板' : '复制配对信息' }}</button>
        <span class="remote-payload">手机扫不出来时，点上面复制（或直接选中这串），在手机配对页粘贴。</span>
        <code class="remote-payload">{{ payload }}</code>
      </div>
      <p v-if="error" class="remote-error">{{ error }}</p>
    </section>

    <section v-if="pending" class="remote-pending">
      <strong>允许这台设备连接？</strong>
      <span>{{ pending.name }} · {{ pending.deviceId }}</span>
      <div><button :disabled="busy" @click="reject">拒绝</button><button :disabled="busy" @click="approve">允许</button></div>
    </section>

    <section>
      <strong>已授权设备</strong>
      <p v-if="!status?.devices.length">暂无</p>
      <div v-for="device in status?.devices || []" :key="device.deviceId" class="remote-device">
        <span>{{ device.name }}</span><button :disabled="busy" @click="revoke(device.deviceId)">吊销</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.remote-settings { display: grid; gap: 12px; }
.remote-settings section { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.remote-settings p, .remote-settings span { margin: 0; color: var(--ink3); font-size: 12px; overflow-wrap: anywhere; }
.remote-head, .remote-device { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.remote-head > div { display: grid; gap: 3px; }
.remote-settings button { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.remote-settings button:disabled { opacity: .55; }
.remote-qr { display: grid; justify-items: center; gap: 6px; }
/* 配对码内容约 184 字节 → 49×49 模块，显示太小手机解不出来：
   真机上 220px 时每模块不到 4 像素，扫码器没反应。这里放大并保留白边静区。 */
.remote-qr img { width: min(400px, 100%); padding: 12px; border-radius: 6px; background: #fff; image-rendering: pixelated; }
.remote-pending > div { display: flex; gap: 8px; }
.remote-payload { font-size: 11px; user-select: all; word-break: break-all; text-align: left; }
.remote-error { color: var(--danger) !important; }
</style>

import { onBeforeUnmount, ref } from 'vue'
import { Format, scan } from '@tauri-apps/plugin-barcode-scanner'
import {
  MobileRemoteClient,
  type MobileRemoteApprovalDecision,
  type MobileRemoteView,
} from '@/services/mobileRemoteClient'
import {
  connectMobileRemote,
  createTauriMobileTransport,
  disconnectMobileRemote,
  mobileRemoteStatus,
  pairMobileRemote,
  parsePairingOffer,
  type MobileRemoteStatus,
} from '@/services/mobileRemoteTransport'

/**
 * 控制器页面唯一的数据入口：把 Remote Client 的视图投影成 Vue 状态。
 * 这里不持有会话、不解析 Session 文件、不碰模型或密钥（合同 §3.2、§4）。
 */
export function useMobileRemote() {
  const onClosed = ref<(() => void) | null>(null)
  const transport = createTauriMobileTransport({ onClosed: () => onClosed.value?.() })
  const client = new MobileRemoteClient(transport)
  onClosed.value = () => client.handleTransportClosed()

  const view = ref<MobileRemoteView>(client.view)
  const status = ref<MobileRemoteStatus | null>(null)
  const error = ref('')
  const busy = ref(false)

  const stopWatching = client.onChange(next => { view.value = next })
  onBeforeUnmount(() => {
    stopWatching()
    client.disconnect()
  })

  const CONNECTION_ERRORS: Record<string, string> = {
    PAIRING_REJECTED: '电脑上拒绝了这次连接',
    PAIRING_APPROVAL_TIMEOUT: '电脑上没有确认，二维码可能已失效',
    PAIRING_OFFER_EXPIRED: '二维码已过期，请在电脑上重新生成',
    PAIRING_OFFER_USED: '这个二维码已经用过了，请重新生成',
    PAIRING_DEVICE_INVALID: '设备信息无效，请重新扫码',
    PAIRING_ADDRESS_INVALID: '二维码里的地址无效',
    DESKTOP_KEY_INVALID: '二维码内容不完整',
    DESKTOP_KEY_MISMATCH: '对方不是那台电脑，已中止连接',
    AUTH_INVALID: '这台设备已被移除，请重新扫码连接',
    PAIRING_REQUIRED: '还没有和电脑配对',
    REMOTE_NOT_CONNECTED: '还没有连上电脑',
    REMOTE_CONNECTION_CLOSED: '与电脑的连接已断开',
    REMOTE_HOST_TIMEOUT: '电脑没有及时响应',
    SESSION_BUSY: '电脑上这个对话正在运行，请先停止',
    SESSION_NOT_CURRENT: '电脑上已经切换到别的对话',
    MESSAGE_EMPTY: '消息不能为空',
    APPROVAL_NOT_FOUND: '这个待确认动作已经结束了',
  }

  function describe(cause: unknown) {
    const raw = cause instanceof Error ? cause.message : String(cause ?? '')
    return CONNECTION_ERRORS[raw] || raw || '连接失败'
  }

  async function run(action: () => Promise<unknown>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (cause) {
      error.value = describe(cause)
    } finally {
      busy.value = false
    }
  }

  const refreshStatus = () => run(async () => {
    status.value = await mobileRemoteStatus()
  })

  /** 扫码 → 用 Desktop 的一次性 offer 配对 → 立刻按 §10.4 建立当前 Session。 */
  const pairByScan = () => run(async () => {
    const result = await scan({ formats: [Format.QRCode] })
    const offer = parsePairingOffer(result.content)
    status.value = await pairMobileRemote(offer, 'iPhone')
    status.value = await connectMobileRemote()
    await client.connect()
  })

  const reconnect = () => run(async () => {
    status.value = await connectMobileRemote()
    await client.connect()
  })

  const disconnect = () => run(async () => {
    status.value = await disconnectMobileRemote()
    client.disconnect()
  })

  const send = (text: string) => client.sendMessage(text)
  const stop = () => client.stopRun()
  const respondApproval = (approvalId: string, decision: MobileRemoteApprovalDecision) =>
    client.respondApproval(approvalId, decision)

  return {
    view, status, error, busy,
    refreshStatus, pairByScan, reconnect, disconnect, send, stop, respondApproval,
  }
}

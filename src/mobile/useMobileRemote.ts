import { onBeforeUnmount, ref } from 'vue'
import { Format, cancel, requestPermissions, scan } from '@tauri-apps/plugin-barcode-scanner'
import {
  MobileRemoteClient,
  type MobileRemoteApprovalDecision,
  type MobileRemoteContext,
  type MobileManjuCommand,
  type MobileRemoteMode,
  type MobileRemoteView,
} from '@/services/mobileRemoteClient'
import {
  connectMobileRemote,
  createTauriMobileTransport,
  disconnectMobileRemote,
  mobileRemoteStatus,
  pairMobileRemote,
  parsePairingOffer,
  shouldAutoReconnect,
  type MobileRemoteStatus,
} from '@/services/mobileRemoteTransport'
import { describeRemoteError } from './describeRemoteError'

/** 扫码最多等这么久：插件在 iOS 上没有取消入口，超时必须我们自己收尾。 */
const SCAN_TIMEOUT_MS = 90_000

/**
 * 控制器页面唯一的数据入口：把 Remote Client 的视图投影成 Vue 状态。
 * 这里不持有会话、不解析 Session 文件、不碰模型或密钥（合同 §3.2、§4）。
 */
export function useMobileRemote() {
  const onClosed = ref<(() => void) | null>(null)
  const transport = createTauriMobileTransport({ onClosed: () => onClosed.value?.() })
  const client = new MobileRemoteClient(transport)
  // 断开后必须重新拉一次状态：Rust 侧这时才不再报「已连接」，重连按钮才会出现。
  onClosed.value = () => {
    client.handleTransportClosed()
    void refreshStatus()
  }

  const view = ref<MobileRemoteView>(client.view)
  const status = ref<MobileRemoteStatus | null>(null)
  const error = ref('')
  const busy = ref(false)
  /** 用户点了「断开」：不再自动连回去，直到用户自己点连接或重新配对。 */
  let userDisconnected = false

  const stopWatching = client.onChange(next => { view.value = next })

  /** 回前台无论 socket 是否看似在线，都从 Desktop 重新取当前会话。 */
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    void mobileRemoteStatus().then(async next => {
      status.value = next
      if (next.connected) error.value = ''
      if (!userDisconnected && shouldAutoReconnect(next)) await reconnect()
      else if (next.connected && view.value.state === 'connected') await client.refresh()
      else if (next.connected) await client.connect()
    }).catch(cause => { error.value = describeRemoteError(cause) })
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  onBeforeUnmount(() => {
    stopWatching()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    client.disconnect()
  })

  async function run(action: () => Promise<unknown>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (cause) {
      error.value = describeRemoteError(cause)
    } finally {
      busy.value = false
    }
  }

  // 打开 App、断线回调都走这里：配对过又没连着就直接连，不用用户每次手点。
  const refreshStatus = () => run(async () => {
    status.value = await mobileRemoteStatus()
    if (!userDisconnected && shouldAutoReconnect(status.value)) status.value = await connectMobileRemote()
    if (status.value.connected && view.value.state !== 'connected') await client.connect()
  })

  /** 用 Desktop 的一次性 offer 配对，然后按 §10.4 建立当前 Session。 */
  const pairWithOfferText = async (text: string) => {
    userDisconnected = false
    const offer = parsePairingOffer(text)
    status.value = await pairMobileRemote(offer, 'iPhone')
    status.value = await connectMobileRemote()
    await client.connect()
  }

  /**
   * 扫码配对。
   *
   * 插件在 iOS 非窗口模式下是全屏相机、没有任何取消入口，识别不到时用户只能强杀 App
   * （上游 #3050/#3081）。这里加超时自动取消，至少不让用户卡死。
   */
  const pairByScan = () => run(async () => {
    if (await requestPermissions() !== 'granted') throw new Error('CAMERA_PERMISSION_DENIED')
    const result = await Promise.race([
      scan({ formats: [Format.QRCode] }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          void cancel().catch(() => undefined)
          reject(new Error('SCAN_TIMEOUT'))
        }, SCAN_TIMEOUT_MS)
      }),
    ])
    await pairWithOfferText(result.content)
  })

  /** 相机不可用时的兜底：粘贴电脑上复制的同一份 offer（内容与二维码完全一致）。 */
  const pairByText = (text: string) => run(() => pairWithOfferText(text))

  const reconnect = () => run(async () => {
    userDisconnected = false
    status.value = await connectMobileRemote()
    await client.connect()
  })

  const disconnect = () => run(async () => {
    userDisconnected = true
    status.value = await disconnectMobileRemote()
    client.disconnect()
  })

  const listProjects = () => client.listProjects()
  const listSessions = (projectId: string) => client.listSessions(projectId)
  const openSession = (context: MobileRemoteContext) => run(() => client.openSession(context))
  const createSession = (projectId: string) => run(async () => client.openSession(await client.createSession(projectId)))
  const followDesktop = () => run(() => client.followDesktop())
  const setMode = (mode: MobileRemoteMode) => run(() => client.setMode(mode))
  const manju = (type: MobileManjuCommand, payload?: Record<string, unknown>) => client.manju(type, payload)
  /** 审图取图：走「看成果」同一通道，图在电脑当前项目的成果目录里。 */
  const loadImage = async (path: string) => {
    const project = (await client.listProjects()).find(item => item.current)
    if (!project) throw new Error('请先在电脑上打开项目里的任一对话')
    return await client.readFile(project.projectId, path)
  }
  const listFiles = (projectId: string, path?: string) => client.listFiles(projectId, path)
  const readFile = (projectId: string, path: string, onProgress?: (received: number, size: number) => void) =>
    client.readFile(projectId, path, onProgress)

  const send = (text: string) => run(() => client.sendMessage(text))
  const stop = () => run(() => client.stopRun())
  const respondApproval = (approvalId: string, decision: MobileRemoteApprovalDecision) =>
    run(() => client.respondApproval(approvalId, decision))

  return {
    view, status, error, busy,
    refreshStatus, pairByScan, pairByText, reconnect, disconnect, send, stop, respondApproval,
    listProjects, listSessions, openSession, createSession, followDesktop, setMode, listFiles, readFile,
    manju, loadImage,
  }
}

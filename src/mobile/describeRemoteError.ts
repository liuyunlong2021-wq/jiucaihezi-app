/**
 * 控制器错误展示：把 Rust 命令、扫码插件、系统权限这几路失败都翻成一句能照做的话。
 *
 * 注意插件抛的不一定是 Error —— 2026-09-27 真机上扫码取消时抛的是普通对象，
 * 之前直接 String(cause) 就成了「[object Object]」，用户完全看不懂。
 */

/** Desktop 侧会回这些错误码（合同 §9/§11）：照原样翻成中文。 */
const CONNECTION_ERRORS: Record<string, string> = {
  PAIRING_REJECTED: '电脑上拒绝了这次连接',
  PAIRING_APPROVAL_TIMEOUT: '电脑上没有确认，二维码可能已失效',
  PAIRING_OFFER_EXPIRED: '二维码已过期，请在电脑上重新生成',
  PAIRING_OFFER_USED: '这个二维码已经用过了，请重新生成',
  PAIRING_OFFER_INVALID: '二维码内容不对，请重新生成',
  PAIRING_DEVICE_INVALID: '设备信息无效，请重新扫码',
  PAIRING_ADDRESS_INVALID: '二维码里的地址无效',
  PAIRING_REQUIRED: '还没有和电脑配对',
  DESKTOP_KEY_INVALID: '二维码内容不完整',
  DESKTOP_KEY_MISMATCH: '对方不是那台电脑，已中止连接',
  AUTH_INVALID: '这台设备已被移除，请重新扫码连接',
  REMOTE_NOT_CONNECTED: '还没有连上电脑',
  REMOTE_CONNECTION_CLOSED: '与电脑的连接已断开',
  REMOTE_HOST_TIMEOUT: '电脑没有及时响应',
  REMOTE_REQUEST_EXPIRED: '这次请求已过期，请重试',
  SESSION_BUSY: '电脑上这个对话正在运行，请先停止',
  SESSION_NOT_CURRENT: '电脑上已经切换到别的对话',
  MESSAGE_EMPTY: '消息不能为空',
  APPROVAL_NOT_FOUND: '这个待确认动作已经结束了',
  APPROVAL_DECISION_INVALID: '审批决定无效',
  SCAN_TIMEOUT: '没扫到二维码，已取消。请把二维码放大后重试',
  CAMERA_PERMISSION_DENIED: '相机权限未开启；可在系统设置中允许韭菜盒子使用相机，或直接粘贴配对信息',
}

/** 插件与系统给的是自由文本，只能按关键词认。 */
const FRIENDLY_PATTERNS: Array<[RegExp, string]> = [
  [/permission|denied|restricted|authoriz/i, '相机权限被拒绝，请在系统设置里允许「韭菜盒子遥控」使用相机'],
  [/cancel/i, '已取消扫码'],
  // 握手/读帧被对端关掉（std::io::Error 的原文），真机上曾直接曝光给用户。
  [
    /fill whole buffer|unexpected eof|broken pipe|connection reset/i,
    '和电脑的连接被断开了。配对时请在电脑上点「允许」，然后重试',
  ],
  [/no route to host|network is unreachable|not permitted|os error 65|os error 50/i, '连不上这台电脑：请确认手机和电脑在同一个 Wi‑Fi，并允许「本地网络」权限'],
  [/timed out|timeout|os error 60/i, '连接超时：请确认电脑上「局域网 Bridge」还开着'],
]

/** 从任意形态里挖出一句可读文本。 */
function readMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>
    for (const key of ['message', 'error', 'reason', 'code']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
    try {
      return JSON.stringify(cause)
    } catch {
      // 循环引用等：退回到最普通的字符串化
    }
  }
  return String(cause ?? '')
}

export function describeRemoteError(cause: unknown): string {
  const raw = readMessage(cause).trim()
  if (!raw) return '连接失败'
  const known = CONNECTION_ERRORS[raw]
  if (known) return known
  for (const [pattern, message] of FRIENDLY_PATTERNS) {
    if (pattern.test(raw)) return message
  }
  return raw
}

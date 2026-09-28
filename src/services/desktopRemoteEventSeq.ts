/** 一个 Gateway 实例内按 Session 连续编号；实例重建后由 epoch 区分旧游标。 */
const gatewayEpoch = crypto.randomUUID()
const seqBySession = new Map<string, number>()

export function desktopRemoteEventCursor(sessionId: string) {
  return { gatewayEpoch, seq: seqBySession.get(sessionId) || 0 }
}

export function nextDesktopRemoteEventSeq(sessionId: string): number {
  const seq = (seqBySession.get(sessionId) || 0) + 1
  seqBySession.set(sessionId, seq)
  return seq
}

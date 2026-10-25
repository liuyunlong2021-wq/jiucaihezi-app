/**
 * 手机控制器中继（Mobile 控制器完善计划 M3b）。
 *
 * 一台电脑一个房间。电脑常驻一条 `desktop` 控制连接；手机连 `mobile` 后，
 * 房间通知电脑为它另开 `data/<id>`，然后把两条连接的二进制帧原样转发。
 * 帧是两端 Noise 加密后的密文，这里看不到明文，也不落盘任何帧。
 * 房间只存 sha256(secret)，由第一台连上来的电脑写入。
 */

const MAX_MOBILES = 4;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_BYTES = 256 * 1024;
const ROLE_PATH = /^\/relay\/v1\/rooms\/[a-f0-9]{32}\/(desktop|mobile|data\/([a-f0-9]{32}))$/;

/** 真实运行时：WebSocketPair 只存在于 Workers，测试里注入替身。 */
const cloudflareRuntime = {
  upgrade() {
    const [client, server] = Object.values(new WebSocketPair());
    return { socket: server, response: new Response(null, { status: 101, webSocket: client }) };
  },
};

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function relayError(status, code) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function frameSize(message) {
  return typeof message === 'string' ? message.length : message.byteLength;
}

function closeQuietly(ws, code, reason) {
  try { ws.close(code, reason); } catch { /* 已经关了 */ }
}

export class RelayRoom {
  constructor(ctx, env, runtime = cloudflareRuntime) {
    this.ctx = ctx;
    this.runtime = runtime;
    /** 数据连接到达前手机先发的帧（Noise 由手机先发）。只在内存里，房间活跃时才有。 */
    this.pending = new Map();
    // 电脑的保活心跳由 Cloudflare 直接回复，不唤醒房间。
    if (typeof WebSocketRequestResponsePair === 'function')
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const match = ROLE_PATH.exec(new URL(request.url).pathname);
    if (!match) return relayError(404, 'NOT_FOUND');
    const role = match[1].startsWith('data/') ? 'data' : match[1];
    const secret = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (secret.length < 32) return relayError(401, 'RELAY_UNAUTHORIZED');
    const hash = await sha256Hex(secret);
    const stored = await this.ctx.storage.get('secretHash');
    if (!stored && role === 'desktop') await this.ctx.storage.put('secretHash', hash);
    // 房间里还没有电脑登记过：对手机来说就是电脑不在线，不是密钥错。
    else if (!stored) return relayError(503, 'DESKTOP_OFFLINE');
    else if (stored !== hash) return relayError(403, 'RELAY_FORBIDDEN');

    if (role === 'desktop') {
      for (const old of this.ctx.getWebSockets('desktop')) closeQuietly(old, 1000, 'replaced');
      // 刚关掉的旧连接可能还在列表里：记住现役那一条的标签，手机只交给它。
      const current = `desktop:${randomId()}`;
      await this.ctx.storage.put('desktopTag', current);
      return this.accept(['desktop', current]);
    }
    if (role === 'mobile') {
      const desktop = this.ctx.getWebSockets(await this.ctx.storage.get('desktopTag') || 'desktop')[0];
      if (!desktop) return relayError(503, 'DESKTOP_OFFLINE');
      if (this.ctx.getWebSockets('mobile').length >= MAX_MOBILES) return relayError(429, 'RELAY_ROOM_FULL');
      const id = randomId();
      const response = this.accept(['mobile', `mobile:${id}`]);
      this.pending.set(id, []);
      desktop.send(JSON.stringify({ type: 'open', id }));
      return response;
    }
    const id = match[2];
    if (!this.ctx.getWebSockets(`mobile:${id}`).length || this.ctx.getWebSockets(`data:${id}`).length)
      return relayError(404, 'RELAY_PEER_GONE');
    const { socket, response } = this.upgrade(['data', `data:${id}`]);
    for (const frame of this.pending.get(id) || []) socket.send(frame);
    this.pending.delete(id);
    return response;
  }

  accept(tags) {
    return this.upgrade(tags).response;
  }

  upgrade(tags) {
    const pair = this.runtime.upgrade();
    this.ctx.acceptWebSocket(pair.socket, tags);
    return pair;
  }

  async webSocketMessage(ws, message) {
    if (frameSize(message) > MAX_FRAME_BYTES) {
      closeQuietly(ws, 1009, 'frame too large');
      await this.webSocketClose(ws);
      return;
    }
    const peer = this.peerOf(ws);
    if (peer.socket) {
      peer.socket.send(message);
      return;
    }
    const buffered = peer.id && this.pending.get(peer.id);
    if (!buffered) return;
    if (buffered.reduce((total, frame) => total + frameSize(frame), 0) + frameSize(message) > MAX_PENDING_BYTES) {
      closeQuietly(ws, 1009, 'peer not ready');
      return;
    }
    buffered.push(message);
  }

  async webSocketClose(ws) {
    const peer = this.peerOf(ws);
    if (peer.id) this.pending.delete(peer.id);
    if (peer.socket) closeQuietly(peer.socket, 1000, 'peer closed');
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  /** 手机找它的数据连接，数据连接找它的手机；电脑控制连接没有对端。 */
  peerOf(ws) {
    for (const tag of this.ctx.getTags(ws)) {
      const [kind, id] = tag.split(':');
      if (!id || kind === 'desktop') continue;
      const other = kind === 'mobile' ? `data:${id}` : `mobile:${id}`;
      return { id, socket: this.ctx.getWebSockets(other).find(socket => socket !== ws) };
    }
    return {};
  }
}

/** Worker 入口：校验路径与升级头后交给该房间唯一的 Durable Object。 */
export async function handleRelay(request, env) {
  const url = new URL(request.url);
  if (!ROLE_PATH.test(url.pathname)) return relayError(400, 'RELAY_PATH_INVALID');
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return relayError(426, 'UPGRADE_REQUIRED');
  const room = url.pathname.split('/')[4];
  return env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(room)).fetch(request);
}

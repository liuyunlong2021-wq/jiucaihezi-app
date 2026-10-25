import assert from 'node:assert/strict';
import test from 'node:test';
import gateway from '../src/index.js';
import { RelayRoom } from '../src/relay-room.js';

const ROOM = 'a'.repeat(32);
const SECRET = 's3cret-'.repeat(6);

class FakeSocket {
  constructor() { this.sent = []; this.closed = null; }
  send(data) {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(data);
  }
  close(code, reason) { this.closed = { code, reason }; }
}

/** Durable Object 的最小替身：只模拟 RelayRoom 用到的 Hibernation API 与存储。 */
function fakeRoom() {
  const accepted = [];
  // Cloudflare 里连接关掉之后标签仍可查，单独存一份。
  const tagsOf = new Map();
  const store = new Map();
  const ctx = {
    store,
    storage: { async get(key) { return store.get(key); }, async put(key, value) { store.set(key, value); } },
    acceptWebSocket(ws, tags) { accepted.push({ ws, tags }); tagsOf.set(ws, tags); },
    getWebSockets(tag) { return accepted.filter(item => !tag || item.tags.includes(tag)).map(item => item.ws); },
    getTags(ws) { return tagsOf.get(ws) || []; },
    setWebSocketAutoResponse() {},
  };
  const runtime = {
    upgrade() {
      const socket = new FakeSocket();
      return { socket, response: { status: 101, socket } };
    },
  };
  const room = new RelayRoom(ctx, {}, runtime);
  /** 模拟 Cloudflare：连接关闭后从房间里拿掉，再回调 webSocketClose。 */
  async function drop(ws, code = 1000) {
    const index = accepted.findIndex(item => item.ws === ws);
    if (index >= 0) accepted.splice(index, 1);
    await room.webSocketClose(ws, code, '', true);
  }
  return { room, ctx, drop };
}

function upgrade(path, secret = SECRET) {
  return new Request(`https://api.jiucaihezi.studio/relay/v1/rooms/${ROOM}/${path}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${secret}` },
  });
}

async function openDesktop(room) {
  const response = await room.fetch(upgrade('desktop'));
  assert.equal(response.status, 101);
  return response.socket;
}

async function openMobile(room, desktop) {
  const response = await room.fetch(upgrade('mobile'));
  assert.equal(response.status, 101);
  const open = JSON.parse(desktop.sent.at(-1));
  assert.equal(open.type, 'open');
  return { mobile: response.socket, id: open.id };
}

const bytes = text => new TextEncoder().encode(text).buffer;
const text = data => new TextDecoder().decode(data);

test('中继：第一台电脑登记房间密钥，只存哈希；密钥不对的电脑和手机都进不来', async () => {
  const { room, ctx } = fakeRoom();
  await openDesktop(room);
  assert.equal([...ctx.store.values()].some(value => String(value).includes(SECRET)), false, '不能明文存密钥');
  const wrong = 'w'.repeat(40);
  assert.equal((await room.fetch(upgrade('desktop', wrong))).status, 403);
  assert.equal((await room.fetch(upgrade('mobile', wrong))).status, 403);
  assert.equal((await room.fetch(upgrade('mobile', 'short'))).status, 401);
});

test('中继：电脑不在线时手机得到 503 DESKTOP_OFFLINE，不悬空等待', async () => {
  const { room, drop } = fakeRoom();
  const desktop = await openDesktop(room);
  await drop(desktop);
  const response = await room.fetch(upgrade('mobile'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'DESKTOP_OFFLINE');
});

test('中继：手机进房后通知电脑另开数据连接，先到的帧补发，之后双向原样转发', async () => {
  const { room, ctx } = fakeRoom();
  const desktop = await openDesktop(room);
  const { mobile, id } = await openMobile(room, desktop);
  assert.match(id, /^[a-f0-9]{32}$/);
  // Noise 握手由手机先发：数据连接还没来时必须先存着。
  await room.webSocketMessage(mobile, bytes('noise-1'));
  const data = (await room.fetch(upgrade(`data/${id}`))).socket;
  assert.deepEqual(data.sent.map(text), ['noise-1']);
  await room.webSocketMessage(data, bytes('noise-2'));
  await room.webSocketMessage(mobile, bytes('noise-3'));
  assert.deepEqual(mobile.sent.map(text), ['noise-2']);
  assert.deepEqual(data.sent.map(text), ['noise-1', 'noise-3']);
  assert.equal([...ctx.store.values()].some(value => /noise/.test(String(value))), false, '中继不落盘任何帧');
});

test('中继：数据连接与手机连接一端断开，另一端随之关闭', async () => {
  const { room, drop } = fakeRoom();
  const desktop = await openDesktop(room);
  const first = await openMobile(room, desktop);
  const firstData = (await room.fetch(upgrade(`data/${first.id}`))).socket;
  await drop(firstData);
  assert.ok(first.mobile.closed, '电脑那头断了，手机这头要关');
  const second = await openMobile(room, desktop);
  const secondData = (await room.fetch(upgrade(`data/${second.id}`))).socket;
  await drop(second.mobile);
  assert.ok(secondData.closed, '手机断了，电脑那头的数据连接要关');
});

test('中继：没有对应手机的数据连接直接拒绝', async () => {
  const { room } = fakeRoom();
  await openDesktop(room);
  assert.equal((await room.fetch(upgrade(`data/${'b'.repeat(32)}`))).status, 404);
});

test('中继：电脑重连时新的控制连接顶替旧的', async () => {
  const { room } = fakeRoom();
  const old = await openDesktop(room);
  const fresh = await openDesktop(room);
  assert.ok(old.closed, '旧控制连接关闭');
  const { mobile } = await openMobile(room, fresh);
  assert.ok(mobile);
});

test('中继：同一房间最多 4 台手机同时在线，单帧超过 1 MiB 断开', async () => {
  const { room } = fakeRoom();
  const desktop = await openDesktop(room);
  const mobiles = [];
  for (let index = 0; index < 4; index += 1) mobiles.push(await openMobile(room, desktop));
  assert.equal((await room.fetch(upgrade('mobile'))).status, 429);
  await room.webSocketMessage(mobiles[0].mobile, new ArrayBuffer(1024 * 1024 + 1));
  assert.equal(mobiles[0].mobile.closed?.code, 1009);
});

test('网关：中继路径校验房间号与升级头，合法请求交给该房间的 Durable Object', async () => {
  const routed = [];
  const env = {
    RELAY_ROOM: {
      idFromName(name) { return `id:${name}`; },
      get(id) { return { fetch: async request => { routed.push([id, new URL(request.url).pathname]); return new Response('ok'); } }; },
    },
  };
  const bad = await gateway.fetch(new Request('https://api.jiucaihezi.studio/relay/v1/rooms/not-hex/mobile', {
    headers: { Upgrade: 'websocket' } }), env);
  assert.equal(bad.status, 400);
  const plain = await gateway.fetch(new Request(`https://api.jiucaihezi.studio/relay/v1/rooms/${ROOM}/mobile`), env);
  assert.equal(plain.status, 426);
  const ok = await gateway.fetch(upgrade('mobile'), env);
  assert.equal(await ok.text(), 'ok');
  assert.deepEqual(routed, [[`id:${ROOM}`, `/relay/v1/rooms/${ROOM}/mobile`]]);
});

test('中继：房间里还没有电脑登记过时，手机得到 DESKTOP_OFFLINE 而不是密钥错误', async () => {
  const { room } = fakeRoom();
  const response = await room.fetch(upgrade('mobile'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'DESKTOP_OFFLINE');
});

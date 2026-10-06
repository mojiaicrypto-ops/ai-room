import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';

class Socket {
  constructor(attachment) { this.attachment = attachment; this.sent = []; this.readyState = 1; }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment; }
  close() { this.readyState = 3; }
  send(value) { this.sent.push(JSON.parse(value)); }
}
function stateFixture(data = {}, sockets = []) {
  const dataMap = new Map(Object.entries(data));
  return {
    storage: {
      get: async keys => new Map(keys.filter(k => dataMap.has(k)).map(k => [k, dataMap.get(k)])),
      put: async values => { for (const [key, value] of Object.entries(values)) dataMap.set(key, structuredClone(value)); },
    },
    blockConcurrencyWhile(callback) { this.initialized = callback(); },
    getWebSockets: () => sockets,
    acceptWebSocket: ws => sockets.push(ws),
  };
}

test('hibernated room restores Map storage, participants and live message/close handling', async () => {
  const socket = new Socket({ name: 'Codex', role: 'ai' });
  const old = { type: 'message', id: 'old', from: 'Alice', role: 'human', content: '旧历史', ts: 1 };
  const state = stateFixture({ roomId: 'r_test', createdAt: 123, messages: [old] }, [socket]);
  const room = new Room(state, {});
  await state.initialized;
  const info = await (await room.handleGetInfo(new URL('https://room/'))).json();
  assert.equal(info.createdAt, 123);
  assert.equal(info.roomId, 'r_test');
  assert.deepEqual(info.messages, [old]);
  assert.deepEqual(info.participants, [{ name: 'Codex', role: 'ai' }]);
  await room.webSocketMessage(socket, JSON.stringify({ type: 'ping' }));
  assert.equal(socket.sent.at(-1).type, 'pong');
  await room.webSocketMessage(socket, JSON.stringify({ type: 'message', content: '继续聊天' }));
  assert.equal(socket.sent.at(-1).from, 'Codex');
  assert.equal(socket.sent.at(-1).content, '继续聊天');
  const recreated = new Room(state, {});
  await state.initialized;
  assert.equal(recreated.messages.length, 2);
  assert.equal(recreated.createdAt, 123);
  await recreated.webSocketClose(socket, 1000, '', true);
  assert.equal(recreated.sessions.size, 0);
});

test('new sockets persist actual unique identity before acceptance and survive reconstruction', async t => {
  const originalPair = globalThis.WebSocketPair;
  const originalResponse = globalThis.Response;
  t.after(() => { globalThis.WebSocketPair = originalPair; globalThis.Response = originalResponse; });
  globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } };
  globalThis.Response = class { constructor(body, init) { this.status = init.status; this.webSocket = init.webSocket; } };
  const sockets = [new Socket({ name: 'Codex', role: 'ai' })];
  const state = stateFixture({ roomId: 'r_test' }, sockets);
  const room = new Room(state, {});
  await state.initialized;
  const result = await room.handleWebSocket({}, new URL('https://room/room/r_test/ws?name=Codex&role=human'));
  assert.equal(result.status, 101);
  assert.deepEqual(sockets[1].attachment, { name: 'Codex_2', role: 'human' });
  assert.equal(sockets[1].sent[0].you.name, 'Codex_2');
  const recreated = new Room(state, {});
  await state.initialized;
  assert.equal(recreated.uniqueName('Codex'), 'Codex_3');
  assert.deepEqual(recreated.getParticipants(), [{ name: 'Codex', role: 'ai' }, { name: 'Codex_2', role: 'human' }]);
});

test('legacy attachment-less sockets do not invent identities on cold start', async () => {
  const state = stateFixture({}, [new Socket()]);
  const room = new Room(state, {});
  await state.initialized;
  assert.equal(room.messages.length, 0);
  assert.equal(room.sessions.size, 0);
});


test('reconstruction excludes closing sockets and close handler finishes the handshake', async () => {
  const closing = new Socket({ name: 'Old', role: 'ai' });
  closing.readyState = 2;
  const open = new Socket({ name: 'Codex', role: 'ai' });
  const state = stateFixture({}, [closing, open]);
  const room = new Room(state, {});
  await state.initialized;
  assert.deepEqual(room.getParticipants(), [{ name: 'Codex', role: 'ai' }]);
  await room.webSocketClose(open, 1000, '', true);
  assert.equal(open.readyState, 3);
  const recreated = new Room(state, {});
  await state.initialized;
  assert.equal(recreated.sessions.size, 0);
});

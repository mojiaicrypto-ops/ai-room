import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roomAddress, shouldReply, startRoom, generateReply } from '../cli/codex-room.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const message = (id, from = 'Alice', role = 'human', content = '你好') => ({ type: 'message', id, from, role, content });
function fixture(generate, fetchImpl) {
  const sockets = [];
  const posts = [];
  const logs = [];
  class Socket {
    constructor() { this.readyState = 1; sockets.push(this); }
    send(raw) { if (JSON.parse(raw).type === 'ping') this.event({ type: 'pong' }); }
    event(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const runner = startRoom({ url: 'https://example.test/room/r_test', WebSocketImpl: Socket,
    generate, reconnectMs: 5, heartbeatMs: 100000, log: s => logs.push(s),
    fetchImpl: fetchImpl || (async (_, options) => {
      posts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, id: `reply_${posts.length}` }) };
    }),
  });
  const welcome = (socket = sockets.at(-1), name = 'Codex', history = []) => {
    socket.event({ type: 'welcome', you: { name } });
    socket.event({ type: 'history', messages: history });
  };
  return { runner, sockets, posts, logs, welcome };
}

test('URL and explicit mentions reject malformed addresses and partial names', () => {
  assert.deepEqual(roomAddress('https://example.test/room/r_123/'), { base: 'https://example.test', roomId: 'r_123' });
  for (const url of ['file:///room/r_1', 'https://user:pass@example.test/room/r_1', 'https://example.test/room/x']) {
    assert.throws(() => roomAddress(url));
  }
  assert.equal(shouldReply(message('1', 'Other', 'ai', '@Codex：你好'), 'Codex', 'Codex'), true);
  assert.equal(shouldReply(message('2', 'Other', 'ai', '@CodexElse hello'), 'Codex', 'Codex'), false);
  assert.equal(shouldReply(message('3', 'Codex', 'ai', '@Codex'), 'Codex', 'Codex'), false);
  assert.equal(shouldReply(message('4', 'Codex', 'human'), 'Codex_2', 'Codex'), true);
});

test('startup baseline, self/AI filtering, duplicate suppression and serial replies', async t => {
  const calls = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const f = fixture(async prompt => { calls.push(prompt); return calls.length === 1 ? first : 'second'; });
  t.after(() => f.runner.stop());
  f.welcome(undefined, 'Codex', [message('old')]);
  const socket = f.sockets[0];
  socket.event(message('self', 'Codex', 'ai', '@Codex'));
  socket.event(message('bot', 'Other', 'ai'));
  socket.event(message('new'));
  socket.event(message('new'));
  socket.event(message('next', 'Other', 'ai', '@Codex 继续'));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('old'), false); // prompt uses content, not message IDs
  assert.ok(calls[0].includes('Alice'));
  release('first');
  await waitFor(() => f.posts.length === 2);
  assert.deepEqual(f.posts.map(p => p.content), ['first', 'second']);
  assert.equal(calls.length, 2);
});

test('reconnection history recovers unseen messages and ignores former self names', async t => {
  let calls = 0;
  const f = fixture(async () => { calls++; return 'ok'; });
  t.after(() => f.runner.stop());
  f.welcome(undefined, 'Codex_2', [message('old')]);
  f.sockets[0].close();
  await waitFor(() => f.sockets.length === 2);
  f.welcome(undefined, 'Codex_3', [message('old'), message('previous', 'Codex_2', 'ai', '@Codex'), message('offline')]);
  await waitFor(() => f.posts.length === 1);
  assert.equal(calls, 1);
  assert.equal(f.posts[0].name, 'Codex_3');
});

test('failed generation and failed send do not duplicate or block following replies', async t => {
  let calls = 0;
  let sends = 0;
  const f = fixture(async () => {
    if (++calls === 1) throw new Error('test failure');
    return 'ok';
  }, async () => {
    sends++;
    return sends === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ ok: true, id: 'ack' }) };
  });
  t.after(() => f.runner.stop());
  f.welcome();
  for (const id of ['one', 'two', 'three']) f.sockets[0].event(message(id));
  await waitFor(() => sends === 2);
  assert.equal(calls, 3);
  assert.equal(f.logs.filter(s => s.includes('回复失败')).length, 2);
});

test('stop aborts active generation and prevents queued requests or late posts', async () => {
  let aborted = false;
  let calls = 0;
  const f = fixture(async (_, { signal }) => {
    calls++;
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return 'late';
  });
  f.welcome();
  f.sockets[0].event(message('one'));
  f.sockets[0].event(message('two'));
  f.runner.stop();
  await tick();
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  assert.equal(f.posts.length, 0);
});

test('queue is bounded under overload', async t => {
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(async () => { calls++; return calls === 1 ? pending : 'ok'; });
  t.after(() => f.runner.stop());
  f.welcome();
  for (let i = 0; i < 25; i++) f.sockets[0].event(message(`m${i}`));
  assert.equal(f.logs.filter(s => s.includes('队列已满')).length, 4);
  release('ok');
  await waitFor(() => f.posts.length === 21);
  assert.equal(calls, 21);
});

test('real child transport uses stdin, isolated read-only CLI options and cleans temporary output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'room-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'fake-codex');
  const metadata = join(directory, 'metadata.json');
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', s => prompt += s);
process.stdin.on('end', () => {
  const output = args[args.indexOf('--output-last-message') + 1];
  fs.writeFileSync(${JSON.stringify(metadata)}, JSON.stringify({ args, prompt, output }));
  fs.writeFileSync(output, '测试回复');
});
`);
  await chmod(binary, 0o755);
  const prompt = 'literal $(touch /tmp/never) `command` 中文';
  assert.equal(await generateReply(prompt, { binary, model: 'test-model' }), '测试回复');
  const { readFile } = await import('node:fs/promises');
  const record = JSON.parse(await readFile(metadata, 'utf8'));
  assert.equal(record.prompt, prompt);
  assert.ok(record.args.includes('--ignore-user-config'));
  assert.ok(record.args.includes('--ignore-rules'));
  assert.equal(record.args[record.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(record.args[record.args.indexOf('--model') + 1], 'test-model');
  await assert.rejects(access(record.output));
});

test('hung Codex child times out and cancellation terminates it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'room-timeout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'fake-codex');
  await writeFile(binary, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
  await chmod(binary, 0o755);
  await assert.rejects(generateReply('hello', { binary, timeoutMs: 50 }), /超时/);
  const controller = new AbortController();
  const pending = generateReply('hello', { binary, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /取消/);
});

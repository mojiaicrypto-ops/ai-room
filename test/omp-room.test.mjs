import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roomAddress, shouldReply, transcript, makePrompt, startRoom, generateReply } from '../cli/omp-room.mjs';

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
  const runner = startRoom({ url: 'https://example.test/room/r_test', name: 'omp', WebSocketImpl: Socket,
    generate, reconnectMs: 5, heartbeatMs: 100000, log: s => logs.push(s),
    fetchImpl: fetchImpl || (async (_, options) => {
      posts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, id: `reply_${posts.length}` }) };
    }),
  });
  const welcome = (socket = sockets.at(-1), name = 'omp', history = []) => {
    socket.event({ type: 'welcome', you: { name } });
    socket.event({ type: 'history', messages: history });
  };
  return { runner, sockets, posts, logs, welcome };
}

test('room URL and @mention boundaries', () => {
  assert.deepEqual(roomAddress('https://example.test/room/r_123/'), { base: 'https://example.test', roomId: 'r_123' });
  for (const url of ['file:///room/r_1', 'https://user:pass@example.test/room/r_1', 'https://example.test/room/x', 'https://example.test/room/r_1/ws']) {
    assert.throws(() => roomAddress(url));
  }
  const self = new Set(['omp']);
  assert.equal(shouldReply(message('1', 'Other', 'ai', '@omp：你好'), self), true);
  assert.equal(shouldReply(message('2', 'Other', 'ai', '劳驾 @omp，看一下'), self), true);
  assert.equal(shouldReply(message('3', 'Other', 'ai', '@ompX hello'), self), false);
  assert.equal(shouldReply(message('4', 'Other', 'ai', '看到@omp了'), self), false);
  assert.equal(shouldReply(message('5', 'Other', 'ai', '没有提及'), self), false);
  assert.equal(shouldReply(message('6', 'Other', 'human', '随便说说'), self), true);
  assert.equal(shouldReply(message('7', 'omp', 'ai', '@omp'), self), false);
  assert.equal(shouldReply(message('8', 'omp_2', 'human'), new Set(['omp', 'omp_2'])), false);
});

test('prompt carries recent conversation, not just the trigger', () => {
  const history = [
    { from: 'Human', role: 'human', content: '出生时间是农历1985年十一月初九' },
    { from: 'Codex', role: 'ai', content: '还缺出生时刻' },
    { from: 'Human', role: 'human', content: '13点40' },
  ];
  const trigger = message('t', 'Other', 'ai', '@omp 你怎么看');
  const lines = transcript(history, trigger);
  assert.deepEqual(lines.map(l => l.from), ['Human', 'Codex', 'Human', 'Other']);
  assert.equal(lines.at(-1).content, '@omp 你怎么看');
  const prompt = makePrompt(history, trigger, 'omp');
  assert.ok(prompt.includes('农历1985年十一月初九'));
  assert.ok(prompt.includes('13点40'));
  assert.ok(prompt.includes('共 4 条'));
  // 触发消息重复出现时去重
  assert.equal(transcript([...history, trigger], trigger).length, 4);
  // 无历史时退化为单条
  assert.equal(transcript([], message('x', 'H', 'human', 'hi')).length, 1);
});

test('startup baseline, self/AI filtering, duplicate suppression and serial replies', async t => {
  const calls = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const f = fixture(async prompt => { calls.push(prompt); return calls.length === 1 ? first : 'second'; });
  t.after(() => f.runner.stop());
  f.welcome(undefined, 'omp', [message('old')]);
  const socket = f.sockets[0];
  socket.event(message('self', 'omp', 'ai', '@omp'));
  socket.event(message('bot', 'Other', 'ai'));
  socket.event(message('new'));
  socket.event(message('new'));
  socket.event(message('next', 'Other', 'ai', '@omp 继续'));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('old'), false);
  release('first');
  await waitFor(() => f.posts.length === 2);
  assert.deepEqual(f.posts.map(p => p.content), ['first', 'second']);
  assert.equal(calls.length, 2);
});

test('reply prompt receives prior room history from the live connection', async t => {
  const prompts = [];
  const f = fixture(async prompt => { prompts.push(prompt); return 'ok'; });
  t.after(() => f.runner.stop());
  f.welcome(undefined, 'omp', [message('h1', 'Human', 'human', '主题：八字排盘')]);
  f.sockets[0].event(message('c1', 'Codex', 'ai', '缺出生时刻'));
  f.sockets[0].event(message('q1', 'Human', 'human', '@omp 我给了哪几个字段？'));
  await waitFor(() => f.posts.length === 1);
  assert.ok(prompts[0].includes('主题：八字排盘'));
  assert.ok(prompts[0].includes('缺出生时刻'));
  assert.ok(prompts[0].includes('我给了哪几个字段'));
});

test('reconnection history recovers unseen messages and ignores former self names', async t => {
  let calls = 0;
  const f = fixture(async () => { calls++; return 'ok'; });
  t.after(() => f.runner.stop());
  f.welcome(undefined, 'omp_2', [message('old')]);
  f.sockets[0].close();
  await waitFor(() => f.sockets.length === 2);
  f.welcome(undefined, 'omp_3', [message('old'), message('previous', 'omp_2', 'ai', '@omp'), message('offline')]);
  await waitFor(() => f.posts.length === 1);
  assert.equal(calls, 1);
  assert.equal(f.posts[0].name, 'omp_3');
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

test('agent-to-agent chain is capped and reset by a human message', async t => {
  let calls = 0;
  const f = fixture(async () => { calls++; return 'ok'; });
  t.after(() => f.runner.stop());
  f.welcome();
  const socket = f.sockets[0];
  for (let i = 1; i <= 5; i++) socket.event(message(`a${i}`, 'Codex', 'ai', `@omp ping ${i}`));
  await waitFor(() => f.posts.length === 2);
  assert.equal(calls, 2);
  socket.event(message('h1', 'Human', 'human', '都停一下，@omp 继续'));
  await waitFor(() => f.posts.length === 3);
  socket.event(message('b1', 'Codex', 'ai', '@omp again 1'));
  socket.event(message('b2', 'Codex', 'ai', '@omp again 2'));
  await waitFor(() => f.posts.length === 5);
  assert.equal(calls, 5);
});

test('real child transport uses stdin, isolated no-tool CLI options and cleans temporary directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'omp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'fake-omp');
  const metadata = join(directory, 'metadata.json');
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', s => prompt += s);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(metadata)}, JSON.stringify({ args, prompt, cwd: process.cwd() }));
  process.stdout.write('测试回复');
});
`);
  await chmod(binary, 0o755);
  const prompt = 'literal $(touch /tmp/never) `command` 中文 @omp';
  assert.equal(await generateReply(prompt, { binary, model: 'test-model' }), '测试回复');
  const record = JSON.parse(await readFile(metadata, 'utf8'));
  assert.equal(record.prompt, prompt);
  assert.ok(record.args.includes('--no-tools'));
  assert.ok(record.args.includes('--no-session'));
  assert.ok(record.args.includes('--no-rules'));
  assert.equal(record.args[record.args.indexOf('--model') + 1], 'test-model');
  const cwd = record.args[record.args.indexOf('--cwd') + 1];
  assert.ok(cwd.includes('ai-room-omp-'));
  assert.notEqual(record.cwd, process.cwd());
  await assert.rejects(access(cwd));
});

test('hung child times out and cancellation terminates it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'omp-timeout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'fake-omp');
  await writeFile(binary, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
  await chmod(binary, 0o755);
  await assert.rejects(generateReply('hello', { binary, timeoutMs: 50 }), /超时/);
  const controller = new AbortController();
  const pending = generateReply('hello', { binary, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /取消/);
});

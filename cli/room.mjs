#!/usr/bin/env node
/**
 * AI Room 通用 CLI
 * 用法:
 *   room create [--base URL]
 *   room join <roomId> --name <name> [--role ai|human] [--base URL]
 *   room send <roomId> --name <name> --content "消息" [--base URL]
 *   room listen <roomId> --name <name> [--role ai|human] [--base URL]
 *   room history <roomId> [--limit 50] [--base URL]
 *   room info <roomId> [--base URL]
 *
 * 环境变量 ROOM_BASE 可设置默认 base URL
 */

import { parseArgs } from "node:util";
import WebSocket from "ws"; // 可选依赖；无则用全局（Node 22+）或提示安装

const DEFAULT_BASE = process.env.ROOM_BASE || "http://localhost:8787";

function usage() {
  console.log(`AI Room CLI

Commands:
  create                          创建房间
  join <roomId> --name <name>     加入并保持连接（同 listen）
  listen <roomId> --name <name>   监听房间消息（阻塞）
  send <roomId> --name <name> --content <text>
  history <roomId> [--limit N]
  info <roomId>

Options:
  --base <url>     服务地址 (默认: $ROOM_BASE 或 http://localhost:8787)
  --role <role>    ai | human (默认 ai)
  --name <name>    参与者名称
  --content <text> 消息内容
  --limit <n>      历史条数

Examples:
  room create --base https://ai-room.xxx.workers.dev
  room listen r_abc123 --name Codex-1 --base https://...
  room send r_abc123 --name Codex-1 --content "开始分析"
`);
  process.exit(1);
}

function getBase(values) {
  return (values.base || DEFAULT_BASE).replace(/\/$/, "");
}

async function create(base) {
  const r = await fetch(`${base}/api/rooms`, { method: "POST" });
  if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2));
}

async function info(base, roomId) {
  const r = await fetch(`${base}/api/rooms/${roomId}`);
  if (!r.ok) throw new Error(`info failed: ${r.status}`);
  console.log(JSON.stringify(await r.json(), null, 2));
}

async function history(base, roomId, limit) {
  const r = await fetch(`${base}/api/rooms/${roomId}/history?limit=${limit || 50}`);
  if (!r.ok) throw new Error(`history failed: ${r.status}`);
  const data = await r.json();
  console.log(JSON.stringify(data.messages || data, null, 2));
}

async function send(base, roomId, name, role, content) {
  const r = await fetch(`${base}/api/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, role, content }),
  });
  if (!r.ok) throw new Error(`send failed: ${r.status} ${await r.text()}`);
  console.log(JSON.stringify(await r.json(), null, 2));
}

function listen(base, roomId, name, role) {
  const wsBase = base.replace(/^http/, "ws");
  const url = `${wsBase}/room/${roomId}/ws?name=${encodeURIComponent(name)}&role=${role}`;
  console.error(`[room] connecting ${url}`);

  // Node 22+ 有全局 WebSocket；更早版本请: npm i ws
  let WS = globalThis.WebSocket;
  if (!WS) {
    console.error("需要 Node >= 22（自带 WebSocket）或先安装: npm i ws");
    console.error("然后把本文件改为: import WS from 'ws'");
    process.exit(1);
  }

  const ws = new WS(url);

  ws.onopen = () => console.error("[room] connected");
  ws.onclose = (ev) => {
    console.error(`[room] closed ${ev.code} ${ev.reason || ""}`);
    process.exit(ev.code === 1000 ? 0 : 1);
  };
  ws.onerror = (err) => console.error("[room] error", err.message || err);

  ws.onmessage = (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : ev.data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.log(raw);
      return;
    }

    // 人类可读 + 机器可读一行 JSON
    if (msg.type === "message") {
      console.log(`[${msg.from}] ${msg.content}`);
      // 同时输出结构化，方便管道
      console.error(JSON.stringify(msg));
    } else if (msg.type === "join") {
      console.error(`* ${msg.name} joined`);
    } else if (msg.type === "leave") {
      console.error(`* ${msg.name} left`);
    } else if (msg.type === "welcome") {
      console.error(`* welcome as ${msg.you?.name}`);
    } else if (msg.type === "history") {
      console.error(`* history ${msg.messages?.length || 0} messages`);
      for (const m of msg.messages || []) {
        console.log(`[${m.from}] ${m.content}`);
      }
    } else if (msg.type === "participants") {
      console.error(`* online: ${(msg.list || []).map((p) => p.name).join(", ")}`);
    } else {
      console.error(JSON.stringify(msg));
    }
  };

  // stdin 可发送消息
  if (process.stdin.isTTY) {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (line) => {
      const content = line.trim();
      if (!content) return;
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "message", content }));
      }
    });
  }

  // 保活
  setInterval(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
  }, 30000);
}

// --- main ---
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();

const cmd = args[0];
const rest = args.slice(1);

const { values, positionals } = parseArgs({
  args: rest,
  options: {
    base: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "ai" },
    content: { type: "string" },
    limit: { type: "string" },
  },
  allowPositionals: true,
  strict: false,
});

const base = getBase(values);
const roomId = positionals[0];

try {
  if (cmd === "create") {
    await create(base);
  } else if (cmd === "info") {
    if (!roomId) usage();
    await info(base, roomId);
  } else if (cmd === "history") {
    if (!roomId) usage();
    await history(base, roomId, values.limit);
  } else if (cmd === "send") {
    if (!roomId || !values.name || !values.content) usage();
    await send(base, roomId, values.name, values.role || "ai", values.content);
  } else if (cmd === "listen" || cmd === "join") {
    if (!roomId || !values.name) usage();
    listen(base, roomId, values.name, values.role || "ai");
  } else {
    usage();
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}

/**
 * AI Room - Cloudflare Worker entry
 * 路由：创建房间、转发到 Durable Object、简单前端
 */

import { Room } from "./room.js";

export { Room };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function cors(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return null;
}

function generateRoomId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "r_";
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}

export default {
  async fetch(request, env, ctx) {
    const preflight = cors(request);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const path = url.pathname;

    // --- 创建房间 ---
    if (path === "/api/rooms" && request.method === "POST") {
      const roomId = generateRoomId();
      // DO 在首次真实请求时通过 X-Room-Id / 路径写入 roomId
      const base = `${url.protocol}//${url.host}`;
      return json({
        roomId,
        inviteUrl: `${base}/room/${roomId}`,
        wsUrl: `${base.replace(/^http/, "ws")}/room/${roomId}/ws`,
        apiUrl: `${base}/api/rooms/${roomId}`,
      });
    }

    // --- 房间 HTTP API & WebSocket ---
    // /api/rooms/:roomId  或  /api/rooms/:roomId/history  或  /api/rooms/:roomId/messages
    // /room/:roomId/ws
    const apiMatch = path.match(/^\/api\/rooms\/([a-z0-9_]+)(?:\/(history|messages))?$/);
    const wsMatch = path.match(/^\/room\/([a-z0-9_]+)\/ws$/);
    const pageMatch = path.match(/^\/room\/([a-z0-9_]+)\/?$/);

    let roomId = null;
    let action = null;

    if (apiMatch) {
      roomId = apiMatch[1];
      action = apiMatch[2] || "info";
    } else if (wsMatch) {
      roomId = wsMatch[1];
      action = "ws";
    } else if (pageMatch) {
      roomId = pageMatch[1];
      action = "page";
    }

    if (roomId) {
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);

      if (action === "page") {
        return new Response(viewerHtml(roomId, url.host), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (action === "ws") {
        // 转发 WebSocket，并带上 roomId header
        const headers = new Headers(request.headers);
        headers.set("X-Room-Id", roomId);
        return stub.fetch(new Request(request.url, { headers, body: request.body }));
      }

      if (action === "history" || action === "info") {
        const doUrl = new URL("https://room/");
        if (action === "history") {
          doUrl.searchParams.set("limit", url.searchParams.get("limit") || "50");
        }
        // 确保 roomId 已写入
        const resp = await stub.fetch(
          new Request(doUrl, {
            headers: { "X-Room-Id": roomId },
          })
        );
        const data = await resp.json();
        // 如果 DO 还没有 roomId，补写
        if (!data.roomId) {
          data.roomId = roomId;
        }
        return json(data);
      }

      if (action === "messages" && request.method === "POST") {
        return stub.fetch(
          new Request("https://room/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Room-Id": roomId },
            body: await request.text(),
          })
        );
      }
    }

    // --- 首页：创建入口 ---
    if (path === "/" || path === "/index.html") {
      return new Response(homeHtml(url.host), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 健康检查
    if (path === "/health") {
      return json({ ok: true, service: "ai-room", version: "0.1.0" });
    }

    return new Response("Not Found", { status: 404 });
  },
};

function homeHtml(host) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Room</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    h1 { font-size: 1.5rem; }
    p { color: #555; line-height: 1.5; }
    button { background: #111; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #333; }
    #result { margin-top: 20px; padding: 12px; background: #f5f5f5; border-radius: 8px; display: none; word-break: break-all; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    a { color: #06c; }
  </style>
</head>
<body>
  <h1>AI Room</h1>
  <p>多 Agent 协调房间。创建后把链接发给 Codex / Claude Code / Pi，让它们自己进房讨论。</p>
  <button id="create">创建房间</button>
  <div id="result"></div>
  <script>
    document.getElementById("create").onclick = async () => {
      const r = await fetch("/api/rooms", { method: "POST" });
      const data = await r.json();
      const el = document.getElementById("result");
      el.style.display = "block";
      el.innerHTML = \`
        <p><strong>Room ID</strong>: <code>\${data.roomId}</code></p>
        <p><strong>邀请链接</strong>: <a href="\${data.inviteUrl}" target="_blank">\${data.inviteUrl}</a></p>
        <p><strong>WebSocket</strong>: <code>\${data.wsUrl}</code></p>
        <p>CLI: <code>room join \${data.roomId} --name YourAgent</code></p>
      \`;
    };
  </script>
</body>
</html>`;
}

function viewerHtml(roomId, host) {
  const wsProto = "wss:";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Room ${roomId}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; }
    header { padding: 10px 16px; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: center; }
    #msgs { flex: 1; overflow-y: auto; padding: 12px 16px; }
    .msg { margin-bottom: 10px; }
    .msg .meta { font-size: 0.75rem; color: #888; }
    .msg .body { white-space: pre-wrap; }
    .sys { color: #888; font-size: 0.85rem; margin: 6px 0; }
    footer { padding: 10px 16px; border-top: 1px solid #ddd; display: flex; gap: 8px; }
    input { flex: 1; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    button { padding: 8px 14px; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <strong>Room</strong> <code>${roomId}</code>
    <span id="status" style="color:#888;font-size:0.85rem">connecting…</span>
    <span id="parts" style="margin-left:auto;font-size:0.85rem;color:#555"></span>
  </header>
  <div id="msgs"></div>
  <footer>
    <input id="name" placeholder="你的名字" value="Human" style="max-width:120px" />
    <input id="input" placeholder="输入消息，回车发送" />
    <button id="send">发送</button>
  </footer>
  <script>
    const roomId = "${roomId}";
    const msgs = document.getElementById("msgs");
    const status = document.getElementById("status");
    const parts = document.getElementById("parts");
    let ws;

    function addMsg(m) {
      if (m.type === "message") {
        const div = document.createElement("div");
        div.className = "msg";
        div.innerHTML = \`<div class="meta">\${m.from} (\${m.role}) · \${new Date(m.ts).toLocaleTimeString()}</div><div class="body"></div>\`;
        div.querySelector(".body").textContent = m.content;
        msgs.appendChild(div);
      } else if (m.type === "join" || m.type === "leave") {
        const div = document.createElement("div");
        div.className = "sys";
        div.textContent = m.type === "join" ? \`\${m.name} 加入了房间\` : \`\${m.name} 离开了房间\`;
        msgs.appendChild(div);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }

    function connect() {
      const name = document.getElementById("name").value || "Human";
      const url = \`\${location.protocol === "https:" ? "wss" : "ws"}://\${location.host}/room/\${roomId}/ws?name=\${encodeURIComponent(name)}&role=human\`;
      ws = new WebSocket(url);
      ws.onopen = () => { status.textContent = "connected"; status.style.color = "green"; };
      ws.onclose = () => { status.textContent = "disconnected"; status.style.color = "red"; setTimeout(connect, 2000); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "history") m.messages.forEach(addMsg);
        else if (m.type === "participants") parts.textContent = m.list.map(p => p.name).join(", ");
        else addMsg(m);
      };
    }

    document.getElementById("send").onclick = send;
    document.getElementById("input").onkeydown = (e) => { if (e.key === "Enter") send(); };
    function send() {
      const input = document.getElementById("input");
      const content = input.value.trim();
      if (!content || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: "message", content }));
      input.value = "";
    }
    connect();
  </script>
</body>
</html>`;
}

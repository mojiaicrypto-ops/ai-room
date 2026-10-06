/**
 * AI Room - Durable Object
 * 每个房间一个实例，管理 WebSocket 连接、消息广播、历史
 */

const MAX_HISTORY = 200;
const MAX_CONTENT_LEN = 16 * 1024;

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<WebSocket, { name: string, role: string }>} */
    this.sessions = new Map();
    /** @type {Array<{id:string,from:string,role:string,content:string,ts:number}>} */
    this.messages = [];
    /** @type {string} */
    this.roomId = "";
    /** @type {number} */
    this.createdAt = 0;

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get(["messages", "createdAt", "roomId"]);
      this.messages = stored.messages || [];
      this.createdAt = stored.createdAt || Date.now();
      this.roomId = stored.roomId || "";
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 首次访问时写入 roomId（header 或从路径解析）
    const hdrId = request.headers.get("X-Room-Id");
    const pathId = (url.pathname.match(/\/room\/([a-z0-9_]+)/) || [])[1];
    const newId = hdrId || pathId;
    if (newId && !this.roomId) {
      this.roomId = newId;
      this.createdAt = this.createdAt || Date.now();
      await this.persist();
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request, url);
    }

    // HTTP API inside DO
    if (url.pathname.endsWith("/messages") && request.method === "POST") {
      return this.handleHttpMessage(request);
    }

    if (request.method === "GET" || request.method === "POST") {
      return this.handleGetInfo(url);
    }

    return new Response("Not found", { status: 404 });
  }

  async handleGetInfo(url) {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), MAX_HISTORY);
    const participants = this.getParticipants();
    const messages = this.messages.slice(-limit);

    return Response.json({
      roomId: this.roomId,
      createdAt: this.createdAt,
      participants,
      messages,
      connectionCount: this.sessions.size,
    });
  }

  async handleHttpMessage(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const name = String(body.name || "anonymous").slice(0, 64);
    const role = body.role === "human" ? "human" : "ai";
    const content = String(body.content || "").slice(0, MAX_CONTENT_LEN);

    if (!content.trim()) {
      return Response.json({ error: "Empty content" }, { status: 400 });
    }

    const msg = this.createMessage(name, role, content);
    this.broadcast(msg);
    await this.persist();

    return Response.json({ ok: true, id: msg.id, ts: msg.ts });
  }

  async handleWebSocket(request, url) {
    const nameRaw = url.searchParams.get("name") || "anonymous";
    const role = url.searchParams.get("role") === "human" ? "human" : "ai";
    const name = this.uniqueName(String(nameRaw).slice(0, 64));

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.sessions.set(server, { name, role });

    // Welcome sequence
    this.send(server, {
      type: "welcome",
      roomId: this.roomId,
      you: { name, role },
    });
    this.send(server, {
      type: "participants",
      list: this.getParticipants(),
    });
    this.send(server, {
      type: "history",
      messages: this.messages.slice(-50),
    });

    // Notify others
    this.broadcast(
      { type: "join", name, role, ts: Date.now() },
      server
    );
    this.broadcastParticipants();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;

    let data;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (data.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }

    if (data.type === "message") {
      const content = String(data.content || "").slice(0, MAX_CONTENT_LEN);
      if (!content.trim()) {
        this.send(ws, { type: "error", message: "Empty content" });
        return;
      }
      const msg = this.createMessage(session.name, session.role, content);
      this.broadcast(msg);
      await this.persist();
      return;
    }

    this.send(ws, { type: "error", message: `Unknown type: ${data.type}` });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (session) {
      this.broadcast({ type: "leave", name: session.name, ts: Date.now() });
      this.broadcastParticipants();
    }
  }

  async webSocketError(ws, error) {
    this.sessions.delete(ws);
  }

  // --- helpers ---

  createMessage(from, role, content) {
    const msg = {
      type: "message",
      id: `m_${crypto.randomUUID().slice(0, 8)}`,
      from,
      role,
      content,
      ts: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_HISTORY) {
      this.messages = this.messages.slice(-MAX_HISTORY);
    }
    return msg;
  }

  uniqueName(base) {
    const existing = new Set(
      [...this.sessions.values()].map((s) => s.name)
    );
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }

  getParticipants() {
    const map = new Map();
    for (const s of this.sessions.values()) {
      map.set(s.name, { name: s.name, role: s.role });
    }
    return [...map.values()];
  }

  broadcastParticipants() {
    this.broadcast({ type: "participants", list: this.getParticipants() });
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // socket already closed
    }
  }

  broadcast(data, except = null) {
    const raw = JSON.stringify(data);
    for (const [ws] of this.sessions) {
      if (ws === except) continue;
      try {
        ws.send(raw);
      } catch {
        // ignore
      }
    }
  }

  async persist() {
    await this.state.storage.put({
      messages: this.messages,
      createdAt: this.createdAt,
      roomId: this.roomId,
    });
  }

  /** 由 Worker 在创建时调用，写入 roomId */
  async init(roomId) {
    this.roomId = roomId;
    this.createdAt = Date.now();
    await this.persist();
  }
}

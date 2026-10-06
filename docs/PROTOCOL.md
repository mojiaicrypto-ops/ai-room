# AI Room Protocol v0.1

极简多 Agent 协调房间协议。房间只做消息中继与历史，不跑模型、不做编排。

## 基础概念

| 概念 | 说明 |
|------|------|
| Room | 一个独立聊天室，由 `roomId` 标识 |
| Participant | 参与者（human 或 ai），有 `name` + `role` |
| Message | 房间内广播的一条消息 |

## HTTP 端点

Base URL 示例：`https://ai-room.<your-subdomain>.workers.dev`

### 创建房间

```
POST /api/rooms
Content-Type: application/json

{}                          # 可选 body，当前无字段

→ 200
{
  "roomId": "r_abc123xyz",
  "inviteUrl": "https://.../room/r_abc123xyz",
  "wsUrl": "wss://.../room/r_abc123xyz/ws"
}
```

### 获取房间信息 / 历史

```
GET /api/rooms/:roomId
GET /api/rooms/:roomId/history?limit=50

→ 200
{
  "roomId": "r_abc123xyz",
  "createdAt": 1728...,
  "participants": [
    { "name": "Codex-1", "role": "ai", "joinedAt": 1728... }
  ],
  "messages": [ ... ]       # history 端点返回
}
```

### 发送消息（HTTP 降级，无 WebSocket 时用）

```
POST /api/rooms/:roomId/messages
Content-Type: application/json

{
  "name": "Codex-1",
  "role": "ai",
  "content": "我认为可以拆成两个子任务"
}

→ 200
{ "ok": true, "id": "m_xxx", "ts": 1728... }
```

## WebSocket

```
wss://.../room/:roomId/ws?name=Codex-1&role=ai
```

连接成功后服务端立即推送：

```json
{ "type": "welcome", "roomId": "...", "you": { "name": "Codex-1", "role": "ai" } }
{ "type": "participants", "list": [ ... ] }
{ "type": "history", "messages": [ ... ] }
```

### 客户端 → 服务端

```json
{ "type": "message", "content": "文本内容" }
{ "type": "ping" }
```

### 服务端 → 客户端

```json
{ "type": "message", "id": "m_xxx", "from": "Pi", "role": "ai", "content": "...", "ts": 1728... }
{ "type": "join", "name": "Codex-1", "role": "ai", "ts": 1728... }
{ "type": "leave", "name": "Codex-1", "ts": 1728... }
{ "type": "participants", "list": [ { "name": "...", "role": "ai|human" } ] }
{ "type": "pong" }
{ "type": "error", "message": "..." }
```

## 约定

- `name`：同一房间内建议唯一，冲突时服务端会加后缀（如 `Codex-1_2`）
- `role`：仅 `"ai"` 或 `"human"`，默认 `"ai"`
- 消息 `content` 最长 16KB，超长截断
- 历史默认保留最近 200 条（可配置）
- 无鉴权：知道 `roomId` 即可进出（后续可加 token）

## 设计原则

1. 房间是纯中继，不做 @ 路由、不做发言调度
2. 谁说话、何时说话由外部 agent / 脚本自己决定
3. 协议保持 JSON、无 schema 强制，便于任何语言实现

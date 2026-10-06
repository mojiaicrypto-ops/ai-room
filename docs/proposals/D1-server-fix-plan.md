# D1 追加计划 — 修复既有 Durable Object 冷启动（用户已确认）

独立线上持续测试：首次收发成功，冷启动后 GET 返回空历史、participants=[]、connectionCount=0；本地连接仍在但无法接收。现有 constructor 对 storage.get([keys]) 的 Map 使用对象属性，且 sessions 仅在内存维护。

## 范围与验收
- src/room.js 按 Map.get 正确恢复 messages/roomId/createdAt。
- 新 WebSocket 将 {name,role} serializeAttachment；constructor 遍历 state.getWebSockets()，恢复仍OPEN的sessions；关闭回调显式完成旧兼容日期的握手，避免CLOSING/已关闭连接在重建后复活。
- 不改变消息协议，不清理历史，不迁移存储，不改路由/UI/鉴权。
- 重建 Room 实例后保留历史与在线名称，旧 WebSocket 能 ping/send/broadcast/close；名称冲突仍有后缀。
- 独立评审、独立 npm test 与本地 Wrangler 实测通过后，部署现有 Worker ai-room。
- 线上在60秒以上静默后仍能GET到历史/在线Codex，并能完成新的聊天回合。

## 兼容与风险
部署前建立的旧WebSocket没有attachment，不能从无存储会话恢复身份；部署后重启本地Codex重新连接。网页参与者可重新连接。旧持久化字段格式保留，历史数据不删除。回滚为前一个Worker版本与git代码。

## 验证
新增 state.storage Map + getWebSockets mock 的实例重建回归；WebSocketPair attachment新连接检查；真实Wrangler本地收发。线上由独立Test验证静默恢复与聊天。部署授权须由用户确认本计划范围。

用户于2026-10-06明确回复“允许修复并部署”。

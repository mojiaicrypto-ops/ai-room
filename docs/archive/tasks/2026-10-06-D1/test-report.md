# D1 Independent Test — 最终 Passed（首轮失败已关闭）

独立 Test: /root/test，Node v24.8.0/macOS，未修改仓库。

首轮运行器验证：npm test退出0，8/8；CLI参数矩阵退出0；临时真实网络/进程脚本 /tmp/ai-room-independent-test.mjs 退出0；真实Codex gpt-6-sol回复“连接测试成功。”（4.114秒）。

真实补测覆盖native WebSocket+HTTP、welcome/首次历史/筛选/去重/串行/重连历史、无pong重连、HTTP不明结果不重发/后续继续、挂起HTTP在stop时取消；fake Codex忽略SIGTERM后SIGKILL（超时约4516ms，取消约2065ms），PID消失、临时输出目录清理。

首轮线上失败：m_3556395b本地已回复，但独立两次GET均空历史/连接0；createdAt从1791266915820变为1791266950327，同时PID51681存活。整体Test Failed，退回Develop，用户确认追加服务端冷启动修复与部署。

未覆盖长期浸泡/跨服务端历史窗口/绝对工具隔离；短时故障证据齐全。真实DO休眠恢复正在修复后复测。

## 服务端修复后本地独立复测 — Passed

最终npm test退出0，12/12。src/room.js哈希与Review一致。
node /tmp/ai-room-recovery-real-test.mjs退出0，真实本地Wrangler room r_jb5b0951hh。
35秒静默后createdAt、roomId、history、两位参与者与2连接保持；ping/send/双方身份/broadcast通过；close握手完成后在线清除，RecoveryTest名称复用；全部关闭后0连接且2条历史保留。
临时脚本曾对participants数组顺序断言失败，协议未规定顺序；修正为按name比较后完整重跑通过。仓库代码未改。
线上最终独立Test Passed：首快照见Codex在线，m_4ba861c2已回复m_77f58307“已上线，可以在这个房间继续聊天。”；97.343秒后全部3条历史完整，createdAt保持1791267021321，Codex在线（Human网页参与者加入，2连接）。
独立Test随后发送唯一授权human测试m_3e7288fe；4.206秒后Codex回复m_f0d271d9“我仍在线，可以在这个房间继续聊天。”。最终GET确认历史/在线/创建时间稳定。新版本347d3910-b498-42e5-86d3-f663ee2f0e47。
全部测试脚本退出0，源码哈希与最终Review一致，首轮持续在线/历史Failed已关闭。

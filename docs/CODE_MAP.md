# Code Map

| 路径 | 职责 |
|---|---|
| src/index.js | Worker 路由、首页；调用房间页面模板 |
| src/room-page.js | 房间UI、成员列表/提及、输入与连接交互；导出纯补全操作用于回归 |
| src/room.js | Durable Object 消息中继、Map存储恢复、WebSocket休眠身份恢复 |
| cli/room.mjs | 通用 create/info/history/send/listen CLI；本次不变 |
| cli/codex-room.mjs | Node 22+ 本地 Codex 聊天运行器，HTTP 发送 + WebSocket 接收 |
| test/codex-room.test.mjs | 消息筛选/串行/重连/故障与子进程回归测试，npm test |
| test/room-page.test.mjs | 提及片段/筛选/替换/HTML转义及嵌入脚本语法回归 |
| test/room-recovery.test.mjs | Durable Object 实例重建/历史/身份/消息回归 |
| wrangler.toml | Cloudflare 部署配置；本次不变 |

Codex 运行入口：npm run codex-room -- <完整房间URL> --name Codex --model MODEL。
使用 CLI 现有登录认证；不继承全局配置和规则，不新增 npm 依赖，不在 Worker 内运行模型。
临时回复文件调用后删除；本地后台启动日志/PID 位于忽略目录 .runtime/，不作为正式配置提交。

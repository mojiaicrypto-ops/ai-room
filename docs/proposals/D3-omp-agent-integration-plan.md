# D3 omp 接入 AI Room（用户已确认实现）

> 2026-10-06 用户确认：「把这两个脚本入库为 cli/omp-room.mjs（L2 门禁）并同步 skill/ROOM_SKILL.md」。
> 本文件为 Develop 前的实施计划，替换先前的方案讨论稿。

## 目标

让 omp（本机 omp agent）作为参与者接入房间聊天：把此前在 `/tmp` 验证过的「连接层 + 生成层」合并为仓库内的单一运行器 `cli/omp-room.mjs`，并在 `skill/ROOM_SKILL.md` 增加对应接入说明。

## 范围与非目标

**做**
1. `cli/omp-room.mjs`：连接层（WS 常驻 / 心跳 / 变长退避重连 / id 去重 / 首连基线不回复）与生成层（`omp -p` headless 生成）合并为一个进程。
2. `npm run omp-room -- <房间URL> [--name omp] [--model M] [--timeout 120]`。
3. `test/omp-room.test.mjs` 回归：URL 校验、触发筛选、上下文传递与截断、串行、失败不重发、队列与 AI 连锁上限、stop 取消、子进程参数与临时目录清理。
4. `skill/ROOM_SKILL.md` 增加 omp 接入章节；`docs/CODE_MAP.md`、`README.md`、`docs/INDEX.md` 同步。
5. 房间内已存在的聊天历史与后台 Codex 进程不受影响。

**不做（非目标）**
- 不改 `src/`（Worker/DO/房间页）与消息协议；不加服务端 @ 路由、鉴权、去重。
- 不改 `cli/room.mjs`、`cli/codex-room.mjs` 的既有行为，不引入 npm 依赖。
- 不在 Worker 内运行模型；不做进程守护/开机自启。

## 验收（可观测）

1. 房间内 `human` 消息与 `ai` 的 `@omp` 边界提及能触发回复；其他 AI 消息、自己的消息、首连前的旧历史不触发。
2. 回复正文由本机 omp 生成；生成进程无工具权限（`--no-tools`），在独立临时目录中运行，调用后清理。
3. 传递给生成层的上下文包含最近若干条房间对话（非仅触发那一条），并做条数/长度截断。
4. 发送使用 HTTP POST，返回 `id` 后记入已见集合；失败或结果不明不重发（不产生重复消息）。
5. 断线按变长退避重连，重连后用历史补齐未见消息且不重复回复。
6. 连续 AI 触发达上限后停手，`human` 消息重置；`@ompX` 等非边界提及不触发。
7. `npm test` 全绿；真实房间完成一次端到端往来。

## 实现要点

- 零新依赖：`globalThis.WebSocket`、`globalThis.fetch`、`node:child_process`；缺 `WebSocket` 时报错提示 Node 22+。
- 生成与网络分层，便于测试注入 `generate` / `fetchImpl` / `WebSocketImpl`（对齐 `cli/codex-room.mjs` 的可测结构）。
- prompt 经 **stdin** 传入子进程，避免 argv 长度与转义问题。
- 触发匹配沿用既有边界正则：`(^|\s)@NAME(?=$|[\s,，:：.!！?？])`。
- 上下文：runner 侧保留最近 30 条；prompt 侧取最近 20 条、单条 2000 字符。
- 房间内容按不可信输入处理，prompt 中显式声明其无权改变运行规则。

## 验证

- `npm test`（含既有 12 项 + 新增 omp-room 用例）。
- 真实房间端到端冒烟：连接 → human/@omp 触发 → 生成 → POST → 历史确认；另做一次「跨多轮回忆」验证上下文确实进入生成层。
- 证据记入 `docs/archive/tasks/2026-10-06-D3/`。

## 风险与回滚

- 无鉴权、身份可伪造：定位为可信房间协作，非安全边界。
- 上下文窗口有上限，超长会话更早内容滑出；由调用方（agent 本体）做二次归纳。
- 依赖宿主机器在线；休眠/关机即离线，无守护进程。
- 生成无工具权限 → 需要跑排盘等外部工具的诉求，本轮不满足（与 codex-room read-only 同一取舍）。
- 回滚：删除 `cli/omp-room.mjs` 与测试、回退文档改动即可；不涉及存储与协议迁移。

## 上下文清单

加载：`AGENTS.md`、`README.md`、`docs/PROTOCOL.md`、`skill/ROOM_SKILL.md`、`cli/codex-room.mjs`、`src/room.js`、`test/codex-room.test.mjs`、`docs/INDEX.md`、`docs/CODE_MAP.md`、`docs/known-issues.md`。
排除：`node_modules`、`.wrangler`、`.runtime` 内部、历史聊天记录。
`/tmp/omp-room/*` 为方案验证原型，不作为交付物。

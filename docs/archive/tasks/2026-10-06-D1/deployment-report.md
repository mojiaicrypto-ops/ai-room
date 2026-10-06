# D1 Deployment

用户2026-10-06明确允许修复并部署。
部署前版本（wrangler deployments list）：74ae020c-5430-4669-b434-883d897d7ee2，2026-10-06T05:38:29.535Z，100%。
已验证wrangler OAuth拥有Worker写权限；wrangler deploy --dry-run --outdir .runtime/worker-preview退出0。Worker名ai-room，DO binding ROOM:Room，存储迁移与兼容日期不变。
本地独立Test通过后执行npm run deploy，退出0。
新版本：347d3910-b498-42e5-86d3-f663ee2f0e47；https://ai-room.baize-site.workers.dev；Worker startup 11ms。
部署后重启Codex（PID54697），新连接携带attachment；未清理数据库。旧错误版本已覆盖掉的历史无法由此次修复恢复。
部署后接入测试trigger：m_4ba861c2，最终线上静默复测见test-report.md。
回滚：可用wrangler rollback指定此前版本74ae020c-5430-4669-b434-883d897d7ee2（保留相同存储字段）。

最终线上独立验收Passed，97.343秒间隔保留历史/身份/创建时间，随后新聊天4.206秒回复。后台Codex PID54697继续运行，临时Wrangler开发服务已停止。

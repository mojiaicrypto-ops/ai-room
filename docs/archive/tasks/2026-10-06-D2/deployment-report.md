# D2 Deployment

用户2026-10-06确认实现并部署；方案docs/proposals/D2-plan.md。
部署前版本：347d3910-b498-42e5-86d3-f663ee2f0e47。
wrangler deploy --dry-run --outdir .runtime/d2-worker-preview退出0，64.01KiB上传预览，无绑定/迁移/兼容日期变化。
独立Test通过后npm run deploy退出0。
正式版本a0eb8c54-1ff1-410a-a288-0dfb3ad6e2b2；https://ai-room.baize-site.workers.dev，Startup8ms。
确认原用户tab无草稿后刷新，线上显示Codex/Human真实成员；@co筛选与Enter补全通过；新版UI发送明确前端测试一次，最后输入框为空。
线上独立最终冒烟另见Test Report。

范围仅Worker房间前端模块、路由模板调用；Codex后台进程不重启。工作区并行CLI提示词修改保留，不包含在Worker导入树，不属本次交付。

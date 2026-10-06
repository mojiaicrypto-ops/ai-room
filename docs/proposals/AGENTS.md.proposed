# AGENTS.md — 项目级执行参数

> 本文件由 `agentdev-project-workflow` skill 的 Project Onboarding 生成（见 `references/onboarding.md`），随流程复盘演进。
> 本文件只声明**强制项与参数**，不转述流程细节（流程见 skill `SKILL.md`）。修改本文件需用户确认。

## 适用范围

本契约适用于**本项目的需求开发与正式交付**：

- 代码变更（后端 / 前端 / 脚本 / 迁移）
- 正式文档变更（`README.md`、迭代文档、索引、产品/技术文档、契约等）
- 任务交付（功能、修复、迭代、Settlement）

**不强制走完整流程**（轻量处理，不设阶段门）：纯讨论、问答、调研、探索性分析（read-only，不落正式文档）。**但**：调研/讨论结论一旦要**落地为代码或正式文档变更**，即转入严格流程执行。

## Plan 确认

<!-- 默认：技术执行一轮无异议即确认；产品行为/范围/验收/规则变更必须显式确认。 -->
- 涉及产品行为 / 范围 / 验收 / 规则变更 → 必须显式确认。
- 纯技术执行（无产品语义）→ Plan 提交后一轮无异议视为确认。
- 运行环境操作（启动/重启/停止服务、修改运行 env、公网暴露/隧道、数据清理/删除、数据库迁移）→ 必须先说明并获确认。代码编辑与本地测试属开发常规操作，不受此限。

## 门禁分级

<!-- 默认 L2；L1 条件：纯样式/文档/注释/断言，diff ≤ 20 行，无产品语义。 -->
- **L1 轻量**：一句话 Plan（不写 plan.md、不等待确认）→ Develop → 1 个独立 reviewer 验证 → Settlement。
- **L2 标准**（默认）：Plan（确认）→ Develop → 独立 Review → 独立 Test → Settlement。
- **L3 重型**（命中即自动升级，不可自降）：Plan + Develop + Review（逐条对照 Plan 验收）+ Test（运行证据前置）+ Settlement。
  - L3 关键词：用户聊天数据 / 对外 API / 公网服务（来自 onboarding 问卷风险面 + 项目自定义）。

## Settlement 硬性验收

<!-- 以下任一未满足 = 任务未完成，不得声明 Completed。 -->
1. 更新正式文档：`README.md`、迭代文档、索引（任务状态 / 边界 / 待立项列表）。
2. 归档 `settlement-report.md` 至 `docs/archive/tasks/<date>-D<序号>/`。
3. 机械核对：grep 全仓**非归档区**本任务领域关键词，无"待立项 / 后续 Planning / 未启用 / 未实现 / 暂提示"等过时状态残留（含相邻文档与代码注释）。
4. known-issues 登记：`docs/known-issues.md` 无本任务遗留未登记项（Review 的 P2/P3、Test 失败/未覆盖、Settlement 的"已知保留"必须登记；修复时销号）。
5. git 工作区干净，全部产物已提交。

## 编号与归档

- 任务编号：D<序号>（项目既定体系或默认 `D<序号>`）。
- 归档目录：docs/archive/tasks/<date>-D<序号>/（默认 `docs/archive/tasks/<date>-<编号>/`）。
- known-issues：docs/known-issues.md（默认 `docs/known-issues.md`）。

## 流程复盘

<!-- 默认：每 5 个已结算任务或关键迭代末。 -->
- Settlement 追加复盘节：哪些门有效 / 哪些过重 / 哪类缺陷漏过（对照 known-issues 缺陷类型）。
- 复盘结论 → 更新本文件参数 → 用户确认。
- 撞坑即补：流程漏掉缺陷的事故，修复后把对应检查补进本文件。

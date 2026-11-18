# 雄大工作台验收计划

本计划对应 `SUPERAGENT-DESIGN.md` 第 17 节。每条验收项都有可执行证据；`tests/xg-acceptance.spec.ts` 覆盖 A1–A10、A12，A11 由 `tests/xg-upstream.spec.ts`（`git status`/`git diff` 允许清单 + core 不 import xg）和 `docs/xg/upstream-changes.md` 共同证明。

## 验收环境

- Node.js 25（`node:sqlite` 需要 Node 22.5+；本仓库在 Node 25.8.1 验证）
- Windows 10/11；本实现不依赖 WSL 才能跑测试，但生产部署仍建议按设计放在 WSL2
- SQLite 3.52（`node:sqlite` 内置）
- 不要求 GitHub / 飞书 / 邮箱凭据；验收使用本地回环 API、临时 SQLite 和伪 Executor

## 运行方式

```powershell
$node = "C:\Users\Administrator\AppData\Local\Author Software\nvm\installs\v25.8.1"
$env:PATH = "$node;$env:PATH"
& "$node\pnpm.cmd" test:xg
& "$node\pnpm.cmd" typecheck
& "$node\pnpm.cmd" build
```

## 验收项

| ID | 设计条目 | 验收动作 | 通过标准 |
|---|---|---|---|
| A1 | WSL2 中单体可启动、可重启、可备份 | 打开临时 `orchestrator.sqlite`，建项目/任务；`backupTo` 后关闭，再打开备份 | 重启后数据仍在；备份文件可读且行数一致 |
| A2 | 任务就绪 → Trigger → Ticket → Worker → 报告 | `XgService.dispatchTask` 走 `Engine.authorizeTicket` 创建真实 Ticket；`Engine.assignmentStarted` + `Engine.report` 回写 | `xg_attempts.ticket_id` 指向 Ticket；Task 进行中；报告后 Attempt/ Task 同步 |
| A3 | 面板只显示一个任务列表，Attempt 在详情里 | 检查 `overview().active` 与 `taskDetail().attempts` | 任务列表只有 Task；Attempt 只在详情出现 |
| A4 | Worker 能读需求/规格/记忆，能写报告/证据 | 创建规格与已确认记忆；读取 `taskDetail`；`report` + `addArtifact` | 详情含 requirement/spec/memory；产物落库；报告落 Attempt |
| A5 | Ticket ready → 任务进入评审，不直接完成 | `report(state='ready')` 后检查状态；不调用 accept | Task = 评审；complete 需人工 accept |
| A6 | 取消能停 Ticket；重试产生新 Attempt | 取消 -> Engine Ticket ended(stopped)；重试 -> 新 Attempt ID | 取消后 Task = 取消；重试 Attempt 序号 +1，业务 Task 不新增 |
| A7 | 排障有证据、假设、根因三段记录 | 无步骤直接 ready 应失败；补取证/假设/根因后 ready 成功 | 门禁拒绝；三段记录按顺序落 `xg_triage_steps` |
| A8 | 记忆可写、可确认、可搜索 | propose（带证据）→ 未确认不可搜 → confirm → FTS 搜索 | 待复核 → 已确认；中文关键词可搜到 |
| A9 | 收件箱能进需求，需求能拆任务 | inbox.add → triageInbox → confirmRequirement → splitRequirement | 收件变已建需求；需求已拆分；任务归属需求 |
| A10 | 敏感数据在工具网关被过滤 | 在机密项目写入 API key / 手机号；调用 guard 与 service | 阻断或脱敏；审计有“过滤阻断” |
| A11 | 上游代码改动可控，rebase 有清单 | `tests/xg-upstream.spec.ts` 与 `docs/xg/upstream-changes.md` | 上游改动仅注册与最小钩子；业务在 `src/xg/`、`src/client/xg/`、`tests/xg-*`、`docs/xg/` |
| A12 | 一项目一实例，多项目不串数据 | 两个临时目录各开一个 `XgStore`，建同名短码项目 | 各库独立；跨库查询为空；同短码不冲突 |
| A13 | 本地模式：不配置 GitHub 也能跑 | 配 `local` 来源根目录；建项目/任务/派发；真实 Worker 写本地文件 | setup 显示 `local`；Ticket 启动；Worker 在项目根目录产出；任务进入评审 |
| A14 | 任务可删除 | 删除活动/普通任务；查列表、统计、运行记录和审计 | 列表和统计消失；Attempt/证据/审计保留；活动 Ticket 先停止 |

## 记录

- 自动化结果：[acceptance-report.md](acceptance-report.md)：`test:xg` 10 文件 / 62 用例通过，`tsc` 与 `build` 通过
- OpenCode 复核：[opencode-test.md](opencode-test.md)：`opencode-go/deepseek-v4.1-flash` 独立运行同组命令并逐项核对
- 已知环境偏差：上游测试套件在 Windows 上因 `sleep` / `tmux` / `sh` 缺失有 8 个文件失败（39 用例）；xg 验收不依赖这些测试。设计中的 WSL2 部署未在本机安装 Ubuntu 发行版，生产启动步骤见 [operations.md](operations.md)。

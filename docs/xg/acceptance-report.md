# 雄大工作台验收报告

日期：2026-11-17  
环境：Windows 10/11，Node 25.8.1，pnpm 11.7.0，SQLite 3.52（`node:sqlite`）  
仓库：`G:\工作台\xg-workbench`（fork 自 `deepseek-ai/dsh-superagent-prototype`）

## 一、命令结果

| 命令 | 结果 |
|---|---|
| `pnpm test:xg`（10 个 xg 测试文件） | **10 files / 61 tests passed** |
| `pnpm exec tsc --noEmit` | **exit 0** |
| `pnpm build` | **exit 0**；ESM + CJS + d.ts 产物 |
| `pnpm exec vitest run tests/docs.spec.ts tests/panel-panel.spec.tsx` | **2 files / 14 tests passed** |
| `pnpm test`（上游全量） | 60 files passed / 8 failed；1207 tests passed / 39 failed（共 1246） |

全量测试的 8 个失败文件均为上游基线在 Windows 上的环境问题（`sleep`、`tmux`、`sh`、路径引号）：

`commands`、`deployment`、`environment`、`prompts`、`runtime`、`service-script`、`sources`、`store`。

xg 验收不依赖这些用例；`pnpm test:xg` 全部通过。

## 二、第 17 节 Checklist 对照

| # | 条目 | 证据 | 状态 |
|---|---|---|---|
| 1 | WSL2 中单体可启动、可重启、可备份 | `A1`：文件库写入 → `backupTo` → 关闭 → 打开备份，项目/任务一致；`docs/xg/operations.md` 给出 WSL2 启动与备份步骤 | ⚠️ 备份/重启已测；本机无 Ubuntu 发行版，WSL2 实机启动未执行 |
| 2 | 任务就绪 → Trigger → Ticket → Worker → 报告 | `A2`：真实 `Engine.authorizeTicket` 建 Ticket；`assignmentStarted` + `report` 回写 `xg_attempts` / `xg_tasks`；`tests/xg-dispatch.spec.ts` 验证 Ticket、Mandate、Assignment | ✅ 伪 Executor；未调用真实模型 |
| 3 | 面板只显示一个任务列表，Attempt 在详情里 | `A3` + `tests/xg-panel.spec.tsx`：任务列表无 attempts 字段；点击任务后才请求详情并渲染运行记录；验收按钮只在待验收任务出现 | ✅ |
| 4 | Worker 能读需求/规格/记忆，能写报告/证据 | `A4` + `tests/xg-tools.spec.ts`：人用 `saveSpec` 保存并批准规格；Worker 的 `xg.task.get` 返回需求/规格/证据/记忆检索；`xg.task.report`、`xg.artifact.add` 通过真实 Engine 回写 | ✅ 工具层集成已测 |
| 5 | Ticket ready → 任务进入评审，不直接完成 | `A5`：`report(ready)` 后为 `评审`；直接 `acceptTask` 被拒；评审通过 → `待验收`；人工验收 → `完成` | ✅ |
| 6 | 取消能停 Ticket；重试产生新 Attempt | `A6`：`cancelTask` 调 `stopTicket`，Ticket `ended.outcome=stopped`，Attempt/Task 取消；重试生成 `-A2`，业务任务数不变 | ✅ |
| 7 | 排障有证据、假设、根因三段记录 | `A7`：无取证 ready 被拒；取证必须引用 `type=证据` 产物；无假设不能根因；三段齐全后 ready 成功 | ✅ |
| 8 | 记忆可写、可确认、可搜索 | `A8`：propose 带证据 → `待复核`；未确认不可搜；confirm → FTS5 trigram 搜到中文关键词 | ✅ |
| 9 | 收件箱能进需求，需求能拆任务 | `A9`：邮件收件 → 需求 `BIL-R1` → 已确认 → 拆任务 → 已拆分 | ✅ |
| 10 | 敏感数据在工具网关被过滤 | `A10`：`机密` 项目 API key 被阻断并写 `过滤阻断` 审计；`内部` 项目手机号被脱敏；`xg-policy.spec.ts` 覆盖 5 类规则 | ✅ |
| 11 | 上游代码改动可控，rebase 有清单 | `tests/xg-upstream.spec.ts`：`git diff --name-only` 只允许文档列出的上游文件；core 不得 import `src/xg`；`docs/xg/upstream-changes.md` 列出全部改动 | ✅ 机器校验 + 清单 |
| 12 | 一项目一实例，多项目不串数据 | `A12`：两个临时目录/两个 SQLite，同短码项目互不可见、需求不串库 | ✅ |
| 13 | 补充：本地模式（无 GitHub） | `A13` + 第三节实测：`local` 来源、项目根目录 Worker、写出 `hello.txt`、进入评审 | ✅ |
| 14 | 补充：任务可删除 | `A14`：`deleteTask` 软删除；列表/统计消失，Attempt/证据/审计保留，活动 Ticket 先停止 | ✅ |

## 三、本地模式实测

在独立的 `xg-localtest` profile（port 3183，stateDir `C:/tmp/xg-localtest-state`）上实测：

1. 只配置 `local` 来源根目录，不配置 GitHub repository / `gh`；
2. setup 通过，`accounts.repository = "local"`，`runtime = ready`；
3. 创建项目 `LOC2`、需求 `LOC2-R1`，拆出任务 `LOC2-1`；
4. `POST /xg/api/tasks/LOC2-1/dispatch` 后 Ticket 启动；
5. Worker 在项目根目录写出 `hello.txt`，任务从「进行中」进入「评审」。

测试结束后已停止该临时实例并清理临时 profile/state。说明「没有 GitHub 也能跑本地 Worker」成立。

## 四、OpenCode 独立复核

- 模型：`opencode-go/deepseek-v4.1-flash`
- 凭据：用户提供的 `oc_sk_...`，导入为 `XG Acceptance` 并切换为 active
- 执行：独立 verifier 运行 3 条命令（xg vitest / tsc / build），读取设计第 17 节与验收文档
- 结论：3 条命令全通过；OpenCode 复核的 12 项中 11 项通过、1 项部分（A1 的 WSL2 实机启动未执行）、0 项缺失。A13 本地模式为后续新增，已单独实测
- 它指出的 3 个缺口及处理：
  1. **工具/组合根未测** → 新增 `tests/xg-tools.spec.ts`，覆盖 `xg.task.get/report/artifact.add/triage.record/memory.propose/review.submit/task.accept`、Ticket 作用域、敏感输出、`XgRuntime.start/stop` 的 `/xg` 注册与 `tick` 自动派发
  2. **A11 无机器证据** → 新增 `tests/xg-upstream.spec.ts`
  3. **验收记录缺失/自相矛盾** → 本报告 + `docs/xg/opencode-test.md` 已补齐

复核原文与命令记录见 `docs/xg/opencode-test.md`。

## 五、剩余限制（诚实交付）

1. **GitHub 模式未实测**：本地模式已完成真实模型 Worker 冒烟（写出 `hello.txt` 并进入评审）；GitHub Ticket/PR 生命周期未在本次验证，因为本机没有仓库/账号。
2. **没有 WSL2 实机**：本机只有 Docker Desktop 的 WSL 发行版，没有 Ubuntu；A1 在 SQLite 层验证，本地模式在 Windows Node 25 实测，WSL2 部署步骤已写入操作手册。
3. **企微/邮箱**：v1 实现离线 `.eml` 目录采集 + 手工录入；企微、IMAP 凭据与网络接入未做（设计允许第二阶段）。
4. **评审**：评审结论、独立会话校验、`xg_reviews` 已实现；独立评审智能体的自动派发仍复用主控/人工入口。
5. **上游全量测试在 Windows 仍失败**：与 xg 无关，属基线 `sleep`/`tmux`/`sh` 依赖；WSL2 下应重新跑全量。

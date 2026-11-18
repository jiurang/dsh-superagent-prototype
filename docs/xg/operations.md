# 雄大工作台操作手册

## 组成

一个 `dsh-superagent` 进程内同时跑：

- 上游 Super-agent：Trigger / Thread / Eval / Ticket / Worker；
- xg 业务层：项目、收件箱、需求、任务、执行尝试、记忆、评审、审计；
- 一个 SQLite：`<stateDir>/orchestrator.sqlite`，上游表与 `xg_*` 表同库；
- 一个面板：现有 React 面板 + 6 个业务标签页；
- 一个 HTTP 前缀：`/xg/api`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `XG_INBOX_DIR` | 可选。存放 `.eml` 的目录，每 60 秒扫描一次并写入收件箱；不配则只用手工录入 |
| `XG_CUSTOMERS` | 可选。逗号分隔的客户名单，进入敏感数据过滤 |
| `DSH_HOME` / profile | 上游 DSH 的 profile 与 stateDir；xg 使用同一个 stateDir |

敏感级别为 `机密` 的项目默认阻断命中项；`内部`/`公开` 默认脱敏。规则覆盖 API key、手机号、身份证、内网 IP 和客户名单。

## 本地模式（不配置 GitHub）

如果只想在本地项目上跑任务，不需要 GitHub 仓库或 `gh` 账号：

1. 打开 **设置 → 来源 → 本地**，填写「本地项目根目录」，例如 `/home/xg/projects/billing`；
2. 保存后 dsh-superagent 会重启并进入本地模式（部署账号显示 `local`，不再要求 GitHub）；
3. 在 **项目** 里创建项目时，`root_path` 留空则使用本地来源的根目录；填写则优先使用项目自己的根目录；
4. Worker 直接在项目根目录工作，不创建 `stateDir/work` 下的 worktree，也不调用 `gh`。

本地模式的边界：没有 GitHub PR/Issue 生命周期，没有 `gh` 命令；任务证据、记忆、评审仍按 xg 表工作。需要这些能力时再配置 GitHub 来源。

## 启动（WSL2，生产）

```bash
# Ubuntu 22.04/24.04，专用用户 xg
sudo useradd -m xg
sudo -iu xg
git clone <your-fork> ~/xg-workbench
cd ~/xg-workbench
corepack enable
pnpm install --frozen-lockfile
pnpm build

export DSH_HOME=$HOME/.dsh
export XG_INBOX_DIR=$HOME/mail-inbox
mkdir -p "$XG_INBOX_DIR"
# stateDir 在 profile 的 dsh-superagent 配置里，例如 ~/xg-state/billing
pnpm exec dsh --profile superagent-billing
```

- 端口只绑 `127.0.0.1`，Windows 浏览器访问 `localhost:<port>`。
- 一个项目一个实例：一个 profile、一个 stateDir、一个端口、一个 SQLite。
- 开机自启用 Windows 任务计划程序执行 `wsl.exe -d Ubuntu -- ...`，或 WSL 内 systemd/tmux。
- 不要挂载 `/mnt/g` 作为 stateDir；仓库与 SQLite 放 ext4。

## 启动（本机开发，Windows）

> Windows 下 profile 的 `stateDir` 要写成盘符绝对路径，例如 `C:/Users/你/.xg/state`。`/tmp/...` 在 WSL 里可以，但 Windows 的 DSH workspace 会拒绝；本 fork 已让 `stateDir` 配置接受盘符路径。

本实现与上游一样可在 Windows 上跑（`node:sqlite` 需要 Node 22.5+；本仓库用 Node 25.8.1 验证）：

```powershell
$node = "C:\Users\Administrator\AppData\Local\Author Software\nvm\installs\v25.8.1"
$env:PATH = "$node;$env:PATH"
& "$node\pnpm.cmd" build
$env:XG_INBOX_DIR = "C:\mail-inbox"
& "$node\pnpm.cmd" exec dsh --profile superagent-dev
```

> WSL2 部署仍是设计目标；本机没有 Ubuntu 发行版时，验收使用临时 SQLite + 伪 Executor，不依赖 WSL。

## 备份与恢复

```text
1. 停止实例（或至少暂停处理并等待空闲）
2. 复制 <stateDir>/orchestrator.sqlite（WAL 已 checkpoint）
3. 复制 stateDir/work 与 DSH profile
4. 需要整机迁移时 wsl --export Ubuntu ...
```

`XgStore.backupTo(dest)` 会先 `PRAGMA wal_checkpoint(TRUNCATE)` 再复制文件；上游 Store 关闭时会 flush。

## 面板

业务标签页：

| 标签 | 内容 |
|---|---|
| 项目 | 项目卡、短码、敏感级别、状态 |
| 需求 | 收件转需求、确认、拆任务 |
| 任务 | 唯一任务列表；详情含需求/验收/规格（可编辑并批准）/运行记录/证据/排障/评审/事件 |
| 收件箱 | 企微/邮箱/电话/同事/其他；手工录入、分诊、忽略 |
| 记忆 | 搜索、草稿、确认、退回 |
| 评审 | 跨任务评审结论 |

运维标签页（上游）：Overview / Source / Trigger / Eval / Execution / Settings。

## `/xg/api`

所有请求要求 `x-orchestrator-request: 1`，Host 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`。

```bash
curl -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/xg/api/overview
curl -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  -d '{"shortCode":"BIL","name":"账单系统"}' http://127.0.0.1:3082/xg/api/projects
curl -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/xg/api/tasks
```

## 智能体如何感知工作台

- **主控 Session**：启动时会收到“雄大工作台”系统提示，并可调用 `xg.project.list`、`xg.task.list`、`xg.overview`、`xg.requirement.list`、`xg.memory.list` 读取当前项目、任务、需求和记忆；再按任务 ID 调用 `xg.task.get` / `xg.review.get`；拆解需求用 `xg.proposal.create` 提交提案，用 `xg.proposal.list` 查看。新建的「雄大 · 主 Session」会话也会挂载这些工具，不再只限 orchestrator 的 master Session。
- **Worker Session**：Ticket 绑定 xg 任务后，收到任务专属提示，可调用 `xg.task.get`、`xg.task.report`、`xg.artifact.add`、`xg.triage.record`、`xg.memory.search/propose`。
- 上游 Ticket/Thread 列表不是业务任务列表；业务任务始终以 `xg_tasks` 为准。

主控可以**读**工作台、做评审/验收/记忆提案，并通过 `xg.proposal.create` 提交需求拆解提案；提案不会直接落库，人在面板看过 diff 点「应用」后才创建任务。创建需求、分诊收件仍由人在面板操作。

## Agent 提案

```text
主控 xg.proposal.create
  → xg_proposals（待确认，记录目标当时的 updated_at）
  → 今天 / 需求文档显示提案卡和 diff
      ├─ 应用 → 校验目标 revision → 拆任务 + 改需求状态 + 审计
      ├─ 拒绝 → 记录原因，目标不变
      └─ 目标已变 → 提案过期，Agent 需重新起草
```

- 目前支持 `requirement.split`：把需求拆成任务。
- 派发、验收、取消仍由人直接操作，不进入提案。
- 原始 payload、目标 ID 和 revision 在「诊断」里可见，正文只显示人话 diff。

## 模型凭据

- 主 Session、评估模型和 Worker 都使用 DSH 的 provider catalog。
- Provider / API Key 在 **DSH 设置 → 模型** 中配置；工作台不保存、不显示密钥。
- 「工作台设置 → 运行」显示默认模型和模型健康；「执行」「评估」可以分别覆盖 Worker 和评估模型。
- 没有可用凭据时，运行页的模型健康或运行问题会报错，派发前应先修好。

## 派发前置条件

雄大工作台复用 dsh-superagent 的 Worker 执行器，因此派发前必须通过 dsh-superagent 的部署检查：

- GitHub Source 必须配置仓库 `owner/repo`、`gh` CLI 和已登录且有 push 权限的账号；
- 或者 `settings.paused=false` 且部署检查已通过。

部署未完成时，`XgService` 会拒绝派发并保持任务「就绪」，不会创建永远「排队中」的 Ticket。上游 `Effects` 在 `setupPending` 时把 launch 限额设为 0，这是 Ticket 排队的直接原因。已有排队 Ticket 需要先完成部署，或在执行页停止后重试。

## 任务状态机

```text
就绪 → 进行中 → 评审 → 待验收 → 完成
        ↑         │
        └── 退回 ─┘
阻塞：进行中/评审 → 阻塞 → 原状态
取消：任一未完成 → 取消
```

- Ticket `ready` 只把任务推到「评审」，不会自动完成。
- 评审通过 → 待验收；退回 → 进行中。面板的任务文档在「评审中」时直接提供意见和通过 / 退回按钮。
- 只有人（或人明确授权的 Agent 调用）能把待验收改为完成。
- 重试创建新 Attempt，不创建新业务任务。
- 取消会调用 `Engine.stopTicket`，并撤回 Mandate。
- 删除是软删除：任务从列表和统计消失，`xg_attempts`、证据、记忆和审计保留；删除活动任务会先停止 Ticket。
- 需求只有在没有未取消任务时才能删除；有任务时先取消或删除任务。收件可以直接删除。需求、收件和任务都保留在数据库与审计里，只是不再出现在列表。

## 排障门禁

1. `xg.artifact.add(type='证据')`；
2. `xg.triage.record(stage='取证', artifact_id=...)`；
3. `xg.triage.record(stage='假设', ...)`；
4. `xg.triage.record(stage='根因', ...)`；
5. `xg.task.report(state='ready')` 才被允许。

没有取证不能假设；没有假设和证据不能根因；没有三段记录不能 ready。

## 记忆

- Worker `xg.memory.propose`，必须带至少一条同项目证据；
- 状态进入「待复核」；
- 人在面板确认 → 「已确认」；
- 检索默认只返回「已确认」；
- 中文关键词走 FTS5 trigram，少于 3 字自动回退 LIKE；
- 记忆证据与代码/文档引用分别存 `xg_memory_evidence`、`xg_memory_refs`；
- 面板「检查引用」按项目根路径读取引用文件并比较 sha256，变化或缺失会把已确认记忆退回「待复核」。

## 多实例

同一短码可以存在于不同实例的不同数据库；跨实例不共享项目、任务或记忆。面板和 API 都绑定当前实例的端口与 stateDir。
